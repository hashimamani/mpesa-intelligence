# Extraction Engine (Stage 6)

## Scope

Real M-Pesa transaction extraction: parse the transaction table out of the
PDF, reconcile it against the running balance, normalize each row into a
`Transaction`, detect duplicates, and decide whether the statement is
trustworthy enough to leave un-flagged. Explicitly **not** in scope:
category taxonomy (Food, Transport, ...), merchant deduplication tables,
user corrections — that's Stage 7. Nothing here assumes Stage 7 exists.

## The most important caveat in this document

**The parser targets the publicly documented M-Pesa statement layout — it
has not been validated against a real Safaricom statement PDF**, because
none was available to build against (no real user statement may be used per
docs/09 §Statement fixture testing, and no sample was otherwise provided).
Every layout assumption below (column order, receipt number format, date/
time format, the exact header text) is best-effort, not verified fact.
Treat this as a real, open risk — flagged here rather than glossed over —
that needs closing with an actual sample before this is trusted with real
user statements in production.

## How extraction actually works

1. **Row reconstruction.** `pdf-inspector.ts`'s `inspectPdf` now also
   returns `lines`: text items from `pdfjs-dist` grouped by y-position
   (within 2pt) and sorted by x within each group. A naive left-to-right/
   top-to-bottom text dump loses which words belong to which table row; this
   is what makes row-by-row parsing possible at all.
2. **Row parsing** (`extraction/mpesa-statement-parser.ts`). A line is a
   transaction candidate if it starts with something matching the receipt-
   number shape (`[A-Z]{2}[A-Z0-9]{8}`). A candidate is then matched against
   the full expected row pattern (receipt no, date, time, description,
   status, amount, balance); a candidate that doesn't match is recorded as
   `unparsed`, not silently dropped.
3. **Reconciliation** (`extraction/reconciliation.ts`). Rather than guessing
   credit vs. debit from description keywords, direction comes from the
   **change in running balance** between consecutive rows — this is a
   layout-agnostic invariant, and it doubles as the validation check: if a
   row's stated amount doesn't match its balance delta, that row is flagged
   `reconciled: false`. Only the very first row (no prior balance to diff
   against) falls back to a keyword heuristic.
4. **Normalization** (`extraction/transaction-classifier.ts`). Deterministic,
   keyword-based `transactionType` (pay_bill, send_money, fee, ...) and
   best-effort merchant-name extraction from "to/from NAME" phrasing. This
   is normalization, not Stage 7's richer category taxonomy.
5. **Persistence.** Every candidate row becomes a `RawTransaction` (immutable
   record of what was found, including unparsed/rejected ones — see
   docs/04-database-erd.md's raw/normalized separation). Reconciled,
   "Completed"-status rows become `Transaction`s via `upsert` keyed on
   `(statementId, referenceNumber)` — retry-safe by construction, not by a
   separate idempotency-key mechanism.
6. **Duplicate detection.** Before inserting, a check runs for an existing
   `Transaction` with the same `(ownerType, ownerId, referenceNumber)` from
   a *different* statement (e.g. an overlapping re-upload). If found, the
   new row is still persisted (visible, auditable) but `isDuplicateOf` is
   set — Stage 8's analytics can exclude it from totals without losing the
   record.

## What decides needs_review vs. processing vs. failed

- **`failed`**: not a valid PDF, no pages, no text layer (Stage 5's checks,
  unchanged), or zero transaction rows found at all.
- **`needs_review`**: **any** unparsed candidate row, or **any**
  reconciliation mismatch. This is deliberately maximally conservative —
  docs/06 is explicit that low-confidence extraction must never be silently
  accepted for financial data, and there's no real-world calibration data
  yet to justify a looser threshold. Transactions are still persisted and
  visible; needs_review is a flag for review, not a rejection.
- **`processing`** (never `processed` yet): extraction succeeded cleanly,
  but categorization/analytics (Stage 7/8) haven't run, so the pipeline
  isn't fully done. No statement can reach `processed` until those stages
  exist — that's a deliberate constraint, not an oversight.

## Schema decision: `Transaction.direction`

Not in `docs/04-database-erd.md`'s original field list. Added because
reconciliation already determines credit/debit unambiguously from the
balance delta, and `transactionType` alone can't reliably imply direction
(what's the direction of "other" or "reversal"?). Storing it now means
Stage 8's analytics never has to re-derive it heuristically.

## A real limitation, found by testing against actually-rendered PDFs

Row reconstruction groups text strictly by y-coordinate. If a real M-Pesa
statement wraps a long description onto a second line **within the same
logical row** (plausible for a long Pay Bill account reference on a
narrower/portrait export), the wrapped continuation lands on its own line
and the row fails to match the full pattern — it's recorded as `unparsed`
rather than silently mis-parsed, but it does mean the statement gets flagged
`needs_review` more often than it should. This was found empirically: a
synthetic test fixture with long descriptions actually reproduced this
(wrapped even with reduced margins under `pdfkit`'s default portrait page;
switching the fixture to landscape avoided it). Multi-line row stitching
isn't built — flagged as a concrete, known gap for whenever a real statement
sample is available to design against, not a hypothetical concern.

## Verifying changes to this stage

```bash
npm run test --workspace=@mpesa/api      # extraction/reconciliation/classifier unit tests — fast, no infra needed
npm run dev:services                     # postgres, redis, minio
npm run test:e2e --workspace=@mpesa/api  # extraction.e2e-test.ts drives the full pipeline against real infra
```

`extraction.e2e-test.ts` covers: clean extraction with correct types/
directions/amounts, a broken-balance statement landing in `needs_review`,
zero-transaction documents failing outright, cross-statement duplicate
flagging, idempotent retry (no duplicate rows), and tenant isolation on the
new `/statements/:id/transactions` endpoint.

Beyond the automated suite: a real synthetic 7-transaction statement was
pushed through the actually-running API + worker + MinIO, and the extraction
result (types, directions, amounts, merchant names, a genuine cross-
statement duplicate flag) was verified rendering correctly in a live browser
against `apps/web`'s `/upload` page, which now shows extracted transactions
in a table and lets you click into any past statement to inspect it.
