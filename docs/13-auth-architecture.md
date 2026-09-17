# Authentication (Stage 4)

## Scope

Individual user auth only — registration, email verification, login, session
(refresh) management, logout, password reset, and a `JwtAuthGuard` for
protected routes. Organization/role-based auth (owner/admin/analyst/viewer)
is Stage 12, once organizations exist at all; nothing here assumes it yet.

## Decisions made (none of these were pre-committed in earlier docs)

**ORM: Prisma.** `docs/03-architecture.md` specified Postgres but not an ORM.
Chose Prisma over Drizzle/TypeORM/raw SQL for: mature migration tooling
(`prisma migrate dev`/`deploy`), a generated client that makes the
tenant-isolation pattern from `docs/04-database-erd.md` easy to enforce
(every query takes an explicit `where`, nothing implicit), and — not
incidental — its `Decimal` type is backed by the same family of decimal math
as `packages/financial`'s `Money` type, which matters once statement/
transaction models with real money columns land in a later stage. Schema
lives at `apps/api/prisma/schema.prisma`; only auth-relevant models exist so
far (`User`, `RefreshToken`, `EmailVerificationToken`,
`PasswordResetToken`) — statement/transaction/organization models are added
when the stages that need them start, not preemptively.

**Password hashing: Argon2id** (the `argon2` package's default), OWASP's
current first recommendation — deliberately slow/memory-hard. This is a
different hashing use case from refresh/verification tokens below, which are
hashed with fast SHA-256 because they're high-entropy random values, not
user-chosen secrets that need brute-force resistance.

**Sessions: DB-backed opaque refresh tokens, not JWT refresh tokens.** A JWT
refresh token can't be individually revoked without a blocklist; an opaque
random token stored (hashed) in `RefreshToken` can be revoked by row, which
is what "session/device management" in `docs/05-security-threat-model.md`
actually requires. Access tokens are short-lived JWTs (`JWT_ACCESS_TOKEN_TTL`,
default 15m) — cheap to verify on every request, no DB hit needed except to
re-check the user still exists (see `JwtStrategy.validate` — a deleted/
deactivated account loses access as soon as its next request is checked, not
whenever its access token happens to expire).

**Refresh token rotation + reuse detection.** Every `/auth/refresh` call
revokes the presented token and issues a new one (rotation). If a token that's
*already revoked* is presented again, that's a theft signal — the legitimate
client already moved past it — so `TokenService.rotateRefreshToken` responds
by revoking every active session for that user, not just rejecting the one
request. Verified in `apps/api/test/auth.e2e-test.ts`: reusing a rotated-out
cookie fails, and so does the session it was rotated into.

**Refresh token transport: httpOnly cookie, `Path=/auth`.** Chosen over
returning it in the JSON body so client-side JS (and therefore XSS) can't
read it. `POST /auth/refresh` and `/auth/logout` also accept a `refreshToken`
body field as a fallback for clients that can't rely on a cookie jar — there's
no mobile client yet (Stage 14), so this is a forward-compatibility seam, not
something exercised today. Access tokens go in the JSON response body and are
sent as a normal `Authorization: Bearer` header — they're short-lived enough
that XSS exposure is a smaller window, and every client (web now, mobile
later) needs to hold them in memory to attach to API calls regardless.

**Email verification/password reset: single-use opaque tokens**, same
storage pattern as refresh tokens (hashed, not raw). Verification links are
valid 24h, reset links 1h — hardcoded constants in `token.service.ts`, not
environment config; these aren't values anyone needs to tune per-environment,
so adding config surface for them would be complexity without a use.

**No email provider is integrated yet — by design, not oversight.** See
`EmailModule` (`apps/api/src/email`): a `ConsoleEmailService` logs
verification/reset emails in development, clearly labeled `[DEV EMAIL — not
actually sent]`. Setting `NODE_ENV=production` with no real provider
configured is a **fatal startup error**, not a silent fallback — the
alternative (real users' verification emails vanishing into a log line) is a
correctness bug, not an acceptable degradation. Implementing a real provider
(SES, most likely, given the AWS architecture) is Stage 15 work, blocked on
an AWS account existing at all (`docs/10-risks-and-decisions.md`).

**Validation: reused, not reimplemented.** `packages/validation`'s zod
schemas (`registerSchema`, `loginSchema`, etc.) are the same ones a future
web/mobile form would use for inline feedback — `apps/api/src/common/
zod-validation.pipe.ts` enforces them server-side, which is what's actually
authoritative (client-side validation is UX only, per the schema file's own
comment).

**Rate limiting.** `@nestjs/throttler` globally (100 req/min default), with
`register`/`login`/`forgot-password` tightened further via `@Throttle()` on
those routes specifically — brute-force/credential-stuffing protection per
the threat model.

**Account enumeration.** `login` returns the identical "Invalid email or
password" whether the email doesn't exist or the password is wrong.
`forgot-password` always returns `{ ok: true }` and only actually queues an
email if the account exists. Both are tested explicitly, not just asserted in
a comment.

## What's deliberately not built yet

- OTP/MFA — flagged "(planned)" in the threat model, not required for Stage 4.
- A "manage your devices" UI listing/revoking individual sessions — the data
  model (`RefreshToken.userAgent`) supports it, but no product surface needs
  it yet.
- Account enumeration hardening on `register` (a taken email currently
  returns a distinct 409, which is a smaller enumeration surface than login/
  forgot-password already close) — flagged as a hardening item for later,
  not blocking.
- Any web/mobile UI for these flows — this stage is the API. Login/register
  screens are built once Stage 5 needs an authenticated upload flow to hang
  off of.

## Verifying changes to this module

```bash
npm run dev:services --workspace=@mpesa/api    # or: npm run dev:services (root)
npm run prisma:migrate --workspace=@mpesa/api  # after any schema.prisma change
npm run test:e2e --workspace=@mpesa/api        # full auth flow against real Postgres
```

`test:e2e` uses `ts-node`, not `tsx` — see
[11-development.md](11-development.md)'s troubleshooting note on why `tsx`
silently breaks Nest's dependency injection.
