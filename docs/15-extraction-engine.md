# Extraction Engine (Stage 6)

## Scope

Real M-Pesa transaction extraction: parse the transaction table out of the
PDF, reconcile it against the running balance, normalize each row into a
`Transaction`, detect duplicates, and decide whether the statement is
trustworthy enough to leave un-flagged. Explicitly **not** in scope:
category taxonomy (Food, Transport, ...), merchant deduplication tables,
user corrections — that's Stage 7. Nothing here assumes Stage 7 exists.

## Status: calibrated against one real statement

The parser was originally written against the *publicly documented* M-Pesa
statement layout with no real sample to check it against — and when a real
statement (the user's own, provided for local testing only — never
committed, see §Real-data testing hygiene below) became available, several
of those assumptions turned out to be wrong. All are now fixed and verified:
**the real statement extracts cleanly end-to-end — 77/77 candidate rows
parsed, 100% reconciled, correct statement period, zero errors** — but this
is validation against a *single* statement from one account. Different
statement periods, business accounts, pending/failed transactions, or a
future Safaricom template change could all still surface new gaps. Treat
this as tested-once, not proven-general.

## What was actually wrong, and the real data that proved it

- **Withdrawn amounts render with a leading `-` in the real PDF** (Paid In
  amounts don't). The original parser's amount pattern (`[\d,]+\.\d{2}`)
  had no sign handling at all — it matched **8 of 77** real candidate rows
  (only the ones that happened to be credits). Fixed by allowing an
  optional sign on both amount fields, and — since amounts are signed —
  **direction now comes directly from the sign**, not from inferring it via
  balance movement.
- **A receipt number is only unique per real-world transaction, not per
  row.** A Pay Bill payment and its own "Pay Bill Charge" line, or a Fuliza
  payment and its "OverDraft of Credit Party" line, share the *same* receipt
  number as two separate rows — true for **30 of 47** unique receipt numbers
  in the real statement. The original schema's
  `@@unique([statementId, referenceNumber])` was fundamentally wrong for
  real data (upserting the charge row would silently overwrite the payment
  row it belongs to). Fixed: `Transaction` now has a `rowIndex` column
  (position among reconstructed PDF lines) as the idempotency key;
  `referenceNumber` stays a plain indexed field used for cross-statement
  duplicate detection, not uniqueness.
- **Individual rows within such a group don't reliably show incremental
  per-row balances** — a payment and its charge sometimes show the
  *identical* balance rather than the charge's own delta. Reconciliation was
  redesigned to work at the *group* level (consecutive rows sharing one
  receipt number, chronologically): the group's net signed total is checked
  against the transition from the previous group's balance to this group's
  stated balance. Validated empirically against the real statement before
  being adopted — 0 mismatches across all 47 groups — not just reasoned
  through.
- **Cross-statement duplicate detection needed the same fix**: matching on
  `referenceNumber` alone would flag a transaction's own sibling charge row
  as a "duplicate" of itself. Now matched on
  `(ownerType, ownerId, referenceNumber, description, amount)` together.
- **The statement period renders as `"01 Aug 2026 - 14 Aug 2026"`** (day,
  month name, year), not the originally-assumed `DD/MM/YYYY`. Both formats
  are now accepted.
- **Merchant names sit after a numeric identifier**, not immediately after
  "to"/"from" — real examples: `"to 522533 - Lipa na KCB"`,
  `"to -2547******338 GRACE OTIENO"` (a masked phone number, name after it —
  the exact digits and name here are illustrative, not from the real
  statement; see §Real-data testing hygiene below),
  `"from 573388 - TERRAPAY MONEY TRANSFER SERVICES (KENYA) LIMITED."`. The
  extraction pattern was rewritten around this shape.
- **A "limitation" documented before real data existed turned out to be
  wrong, and worth correcting rather than quietly dropping.** The original
  write-up warned that a description wrapping onto a second line within one
  row would break that row's extraction. Real M-Pesa PDFs don't actually
  have this problem: Status/Paid In/Withdrawn/Balance sit in genuine
  fixed-position table columns that stay on the row's first reconstructed
  line regardless of how many lines the Details column wraps to — the
  wrapped continuation simply doesn't start with a receipt number, so it's
  ignored, not stitched. The *actual* limitation was in this project's own
  synthetic test fixtures: building them from flowing `pdfkit` `doc.text()`
  calls (not real fixed-width columns) could wrap a long single-line fixture
  row and break it — fixed by rendering fixtures in landscape with reduced
  margins. This is now understood precisely instead of guessed at.

## How extraction actually works (current)

1. **Row reconstruction** (`pdf-inspector.ts`). Text items from `pdfjs-dist`
   grouped by y-position (within 2pt) and sorted by x — a naive text dump
   loses which words belong to which table row.
2. **Row parsing** (`extraction/mpesa-statement-parser.ts`). A line is a
   transaction candidate if it starts with something matching the receipt
   shape (`[A-Z]{2}[A-Z0-9]{8}`), then matched against the full row pattern
   (receipt, date, time, description, status, signed amount, balance). A
   candidate that doesn't match is recorded as `unparsed`, not dropped.
3. **Reconciliation** (`extraction/reconciliation.ts`). Direction comes from
   the amount's sign; consecutive same-receipt-number rows are grouped, and
   each group's net total is checked against the balance transition from the
   previous group — see above for why this is group-level, not per-row.
4. **Normalization** (`extraction/transaction-classifier.ts`). Deterministic
   `transactionType` (pay_bill, send_money, fee, ...) and merchant-name
   extraction. Normalization, not Stage 7's category taxonomy.
5. **Persistence.** Every candidate row becomes an immutable `RawTransaction`
   (including unparsed ones). Reconciled, "Completed"-status rows become
   `Transaction`s via `upsert` keyed on `(statementId, rowIndex)`.
6. **Duplicate detection**, matched on
   `(ownerType, ownerId, referenceNumber, description, amount)` against
   other statements — see above.

## What decides needs_review vs. processing vs. failed

- **`failed`**: not a valid PDF, no pages, no text layer, or zero
  transaction rows found at all.
- **`needs_review`**: **any** unparsed candidate row, or **any**
  reconciliation mismatch. Deliberately conservative — docs/06 is explicit
  that low-confidence extraction must never be silently accepted for
  financial data. The real statement reconciled at 100% confidence with this
  threshold, so it hasn't yet been tested under real-world pressure to loosen it.
- **`processing`** (never `processed` yet): extraction succeeded, but
  categorization/analytics (Stage 7/8) haven't run. No statement can reach
  `processed` until those stages exist.

## Schema decision: `Transaction.direction` and `Transaction.rowIndex`

Neither is in `docs/04-database-erd.md`'s original field list.
`direction` — reconciliation determines credit/debit unambiguously from the
amount's sign, and `transactionType` alone can't always imply it (what's the
direction of "other" or "reversal"?). `rowIndex` — see the receipt-number
finding above; it's the real idempotency key, not `referenceNumber`.

## Known gaps, honestly

- **Transaction types not in the original taxonomy fall through to
  `"other"`**: Fuliza-related entries ("OverDraft of Credit Party", "OD Loan
  Repayment") and bundle purchases appear in real data but aren't
  classified specifically — no schema type exists for them, and adding one
  wasn't a decision to make unilaterally mid-stage. They still get a
  correct `direction` and are persisted, just genericized.
- **Only one statement, one account, one period has been tested.** Pending/
  failed transaction rows, a business (Till/Paybill-owner) statement, a
  statement spanning a full month or year, and multi-page wrapping at scale
  are all unverified.
- **Amount magnitude assumes no arithmetic ambiguity beyond what was
  observed** — e.g. it's not yet known how a statement would render a
  reversed transaction's sign, or whether Pending/Failed rows ever carry a
  balance that should participate in reconciliation (currently excluded
  entirely from the reconciliation chain, per their status).

## Real-data testing hygiene

The real statement used to find and fix the issues above was read directly
from its local path on the user's machine (`fs.readFileSync`) for one-off
debug scripts and manual end-to-end verification (via the actual running
API + worker + local MinIO) — never copied into this repository, never
committed, and never used as a checked-in test fixture. All committed test
fixtures remain entirely synthetic (docs/09 §Statement fixture testing),
built to replicate the *structural patterns* the real statement revealed
(signed amounts, shared receipt-number groups, the month-name period
format) without containing any real person's transaction data.

## Verifying changes to this stage

```bash
npm run test --workspace=@mpesa/api      # extraction/reconciliation/classifier unit tests — fast, no infra needed
npm run dev:services                     # postgres, redis, minio
npm run test:e2e --workspace=@mpesa/api  # extraction.e2e-test.ts drives the full pipeline against real infra
```

`extraction.e2e-test.ts` covers: clean extraction with correct types/
directions/amounts, a payment-plus-charge group sharing one receipt number,
a broken-balance statement landing in `needs_review`, zero-transaction
documents failing outright, cross-statement duplicate flagging (including
the regression case — a payment and its own charge must never flag each
other as duplicates), idempotent retry, and tenant isolation on
`/statements/:id/transactions`.
