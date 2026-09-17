# Statement Upload (Stage 5)

## Scope

Upload mechanics, storage, job/queue infrastructure, and basic document
validation. Deliberately **not** in scope: any M-Pesa-specific parsing,
transactions, categories, or analytics — that's Stage 6 ("Extraction
engine"), which continues from where this stage's worker stops.

## Decisions made

**Queue: BullMQ over Redis, not SQS.** `docs/03-architecture.md` originally
proposed SQS for durable job processing. Redis was already provisioned for
both local dev and the AWS architecture (ElastiCache); adding SQS too would
mean running/paying for two queueing systems where one (BullMQ, which many
teams run in production, not just for local dev) covers the need. Simpler
operationally, matches "the simplest architecture that can scale." Revisit
only if a concrete SQS-specific need shows up (e.g. needing to cross
AWS-account boundaries with a queue).

**Upload flow: presigned PUT, not proxying through the API.** The client
(`POST /statements/upload-url`) gets a short-lived (5 min), scoped S3
PutObject URL and uploads directly to storage — the API server never sees
the file bytes in transit. This is the standard pattern for large files and
matches docs/03's "signed URLs where required." A second call
(`POST /statements/:id/confirm`) makes the API verify (via `HeadObject`)
that the upload actually landed and matches the declared size before
trusting it — a client claiming success isn't enough.

**Statement fingerprint: S3's ETag, not a server-side hash.** For a
non-multipart PUT, S3/MinIO's ETag is the object's MD5 — good enough for
dedup (`docs/06-statement-processing-architecture.md`'s idempotency
requirement) without downloading the file server-side just to hash it.

**A new `pending_upload` status** was added to `StatementStatus`
(`@mpesa/types`) for the window between "client asked for an upload URL" and
"upload confirmed" — a statement that never gets confirmed (abandoned
upload) stays visibly in this state rather than being incorrectly marked
`uploaded`.

**Worker separation, one BullMQ queue.** `apps/api/src/worker.ts` is a
distinct entrypoint/process (`npm run worker:dev` / `worker:start`) from the
API (`main.ts`) — matches the eventual production split (a separate ECS
service, per `docs/03-architecture.md`) even though both currently live in
the same codebase and get built by the same `nest build`.

**What the Stage 5 worker actually does — and doesn't.** It downloads the
object, checks the PDF magic bytes, opens it, and extracts page count + full
text via `pdfjs-dist`. If that succeeds, `pageCount` is recorded and the job
is marked complete *at the `reading_transactions` stage* — the statement
stays `processing`, not `processed`, because no real extraction has
happened. If the document is corrupt, not a PDF, has no pages, or has no
extractable text layer (e.g. a scanned image with no OCR — OCR is
out-of-scope future work per docs/06), the statement is marked `failed` with
a specific `errorCode`. This is the honest stopping point for what Stage 5
can legitimately claim to have verified.

## Real bugs found via testing, not just written around

- **`@UsePipes()` at the method level applies to every pipeable parameter**,
  including a custom decorator like `@CurrentUser()` — not just `@Body()`.
  `requestUploadUrl` combined both, so the validation pipe was validating
  the *user* object against the upload schema, always failing. Fixed by
  scoping every `ZodValidationPipe` to its `@Body()` parameter specifically,
  in both `statements.controller.ts` and (retroactively, for consistency)
  `auth.controller.ts`. Found by the e2e test, not by inspection.
- **`pdf-parse`'s bundled `pdf.js` (frozen at v1.10.100, ~2018) can't read
  PDFs from a modern `pdfkit`** — real test fixtures generated with the
  current `pdfkit` failed with `bad XRef entry`. Switched to `pdfjs-dist`
  directly (actively maintained; pinned to `4.10.38` for Node 20
  compatibility — the current major requires Node ≥22, same constraint that
  drove the pnpm decision in Stage 2).
- **TypeScript's CommonJS emit rewrites `import()` into `require()`**, which
  breaks loading `pdfjs-dist`'s ESM-only Node build (`require() of ES Module
  ... not supported`). Worked around via a `Function`-constructed dynamic
  import (`apps/api/src/statements/pdf-inspector.ts`) that hides the
  `import()` expression from TypeScript's static rewrite — the standard
  pattern for this specific CJS/ESM interop gap.
- **BullMQ/ioredis leaves at least one connection in a lingering
  "connecting" state past `queue.close()`**, confirmed by inspecting
  `process._getActiveHandles()` directly rather than assumed. Storing and
  explicitly `.disconnect()`-ing the Redis connection (instead of only
  calling `queue.close()`) closed one of three dangling sockets; the
  remainder is BullMQ-internal and outside this codebase's control. Rather
  than chase it further, `test:e2e` runs with Node's built-in
  `--test-force-exit` — the officially supported fix for exactly this class
  of issue, and it still respects a real test failure's exit code.
- **React 18 StrictMode double-invokes effects in development** — the
  `/verify-email` page's `useEffect` called the (single-use-token, non-
  idempotent) verify endpoint twice; the second call's 401 (token already
  consumed) raced the first call's 200 and overwrote the UI into showing
  failure despite the verification having actually succeeded. Fixed with a
  ref-based guard so the network call fires once regardless of how many
  times the effect body runs. Found by actually clicking through the flow
  in a browser, not by code review.
- **A browser-context `fetch()` PUT to a MinIO presigned URL** was verified
  directly (not assumed safe because curl worked) — curl doesn't enforce
  CORS, so it couldn't have caught a real browser-blocking issue. It
  worked without any additional CORS configuration needed.

## Verifying changes to this stage

```bash
npm run dev:services                              # postgres, redis, minio
npm run prisma:migrate --workspace=@mpesa/api      # after any schema change
npm run test:e2e --workspace=@mpesa/api            # full upload+processing flow, real infra
npm run dev --workspace=@mpesa/api                 # API on :4000
npm run worker:dev --workspace=@mpesa/api          # separate process, consumes the real queue
npm run dev --workspace=@mpesa/web                 # :3000 — /register, /login, /upload
```

The e2e suite (`apps/api/test/statements.e2e-test.ts`) calls the processor
function directly rather than waiting on a live worker, for deterministic
tests — but the worker itself is also exercised manually against real
Postgres/Redis/MinIO before considering a change done (see the commit
history for this stage: a real synthetic PDF was uploaded through the actual
running worker process, not just the test's direct invocation).
