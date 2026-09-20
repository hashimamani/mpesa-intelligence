# Extraction Engine (Stage 6)

## Scope

Real M-Pesa transaction extraction: parse the transaction table out of the
PDF, reconcile it against the running balance, normalize each row into a
`Transaction`, detect duplicates, and decide whether the statement is
trustworthy enough to leave un-flagged. Explicitly **not** in scope:
category taxonomy (Food, Transport, ...), merchant deduplication tables,
user corrections — that's Stage 7. Nothing here assumes Stage 7 exists.

## Status: calibrated against one real statement, now header-driven

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

Row extraction was then rewritten to be **header-driven** rather than
assuming a fixed column order (`extraction/column-mapper.ts`): it reads
column positions from the statement's own header row instead of a hardcoded
layout, so a reordered column order, relabeled headers ("Money In"/"Money
Out" instead of "Paid In"/"Withdrawn"), a merged signed Amount column
instead of split Paid In/Withdrawn, or a different date format all parse
without a code change — see §How extraction actually works below. The
original fixed-regex parser is kept as a fallback for when no row in the
document has a header the column-mapper recognizes at all; it's what ran
this project's very first real-statement calibration, so it stays as a
safety net rather than being deleted. Re-running the real statement through
the *new* dynamic path reproduces the exact same result (77/77, 100%
reconciled) — and its header now actually drives the dynamic parser rather
than silently falling back (see the changelog below for why the first
attempt at detection missed it). Still scoped to M-Pesa PDF statements
specifically — a bank statement, a CSV export, or a screenshot needs its own
header vocabulary or its own parser, not this one.

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
   grouped by y-position (within 2pt) into rows, sorted by x within each row
   — a naive text dump loses which words belong to which table row.
   `inspectPdf` returns both the flattened `lines: string[]` (used for
   period-text scanning and raw-text storage) and the underlying
   `rows: PositionedItem[][]` (item-level x positions, used by the
   column-mapper below).
2. **Header-driven row parsing** (`extraction/column-mapper.ts`, the primary
   path). Scans every reconstructed row for one containing enough
   recognizable column-header labels — Receipt, Details, Balance, plus
   either both Paid In/Withdrawn or a single Amount column — matched against
   a synonym dictionary (e.g. "Paid In"/"Money In"/"Credit" all recognized as
   the same column), not one fixed set of literal strings. That row's item
   x-positions become the column boundaries (as midpoints between adjacent
   columns, which tolerates right-aligned numeric columns). Every later row
   has each of its items assigned to whichever column's zone its x falls in,
   the column's text cells are read off, and each field is validated before
   use — an unrecognized status, a non-decimal amount, or an ambiguous
   Paid In/Withdrawn (both filled) becomes an `unparsed` row with a specific
   reason rather than a guess. `extraction/date-utils.ts` parses the
   Completion Time cell in ISO, slash-dated, or month-name form. If **no**
   row in the document has a recognizable header at all, this returns null
   and extraction falls back to:
2b. **Fixed-column fallback** (`extraction/mpesa-statement-parser.ts`'s
   `ROW_PATTERN`, `PARSER_VERSION`'s predecessor path). A line is a
   transaction candidate if it starts with something matching the receipt
   shape (`[A-Z]{2}[A-Z0-9]{8}`), then matched against one fixed row pattern
   (receipt, date, time, description, status, signed amount, balance) in
   that exact order. Kept only as a safety net for a statement shape the
   column-mapper's header detection can't recognize — extend the header
   synonym dictionary first if a real statement ever needs this path.
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

## Changelog: making extraction header-driven

The row parser started as a single fixed-order regex, calibrated against one
real statement (see the findings above). That's brittle in a specific way:
it assumes Safaricom's column order, labels, and amount-column shape never
change, and has no way to handle a business/Till statement or a future
template revision that reorders or relabels columns. Rewritten to read
column positions from the statement's own header row instead
(`extraction/column-mapper.ts`) — see §How extraction actually works above.

Re-running the real statement through the new path was not a rubber stamp:
the **first attempt at header detection silently failed** and fell back to
the legacy fixed parser without either code path saying so out loud in the
output — same 77/77 result, but for the wrong reason (the new dynamic path
wasn't actually exercised). Tracing it down: the real statement's header row
reads exactly `"Receipt Completion Time Details Status Paid In Withdrawn
Balance"` — bare `"Receipt"`, not `"Receipt No."`. The header-matching regex
required `"No."`/`"Number"` after `"Receipt"` and had no bare-word fallback,
so it never matched. Fixed by adding `\breceipt\b` as a fallback alternative;
re-verified afterward that the dynamic path now genuinely fires (confirmed
via `detectHeaderColumns` returning real column positions, not null) and
reproduces the identical 77/77, 100%-reconciled result. Worth stating
plainly: catching this required actually checking that the new path *ran*,
not just that the end-to-end output matched — a silent fallback to old,
already-correct code would have looked identical from the outside while
adding zero real coverage of the new capability.

Also added one e2e test (`extraction.e2e-test.ts`) that builds a PDF with
genuinely *positioned* columns (explicit x/y placement via pdfkit, not one
flowing text line per row) in a different order and with relabeled headers,
run through the real upload → worker → pdfjs-extraction pipeline — proving
the dynamic parser works against real PDF-extracted item positions, not only
the hand-built `PositionedItem` fixtures in column-mapper.test.ts's unit
tests. (The project's pre-existing extraction fixtures all render one row as
a single flowing text string, which — now-understood — never exercises the
header-driven path at all; they still validate the fixed-column fallback,
which is why they were left alone rather than rewritten.)

## Known gaps, honestly

- **"Header-driven" means recognized-vocabulary-driven, not truly unbounded.**
  The column-mapper still needs the header row to use wording its synonym
  dictionary knows (`extraction/column-mapper.ts`'s `HEADER_PATTERNS`) — a
  completely novel label it's never seen (not a synonym of Receipt/Details/
  Status/Paid In/Withdrawn/Amount/Balance) won't be recognized, and that
  statement falls back to the fixed-column parser, which itself only matches
  one exact layout. A genuinely unrecognized statement still correctly lands
  in `needs_review`/`failed` rather than extracting garbage — the parser
  never guesses past what it can validate — but "regardless of format" is
  bounded by that dictionary, which should grow as real statement variants
  are actually seen, not be pre-populated with guesses now.
- **Transaction types not in the original taxonomy fall through to
  `"other"`**: Fuliza-related entries ("OverDraft of Credit Party", "OD Loan
  Repayment") and bundle purchases appear in real data but aren't
  classified specifically — no schema type exists for them, and adding one
  wasn't a decision to make unilaterally mid-stage. They still get a
  correct `direction` and are persisted, just genericized.
- **Only one statement, one account, one period has been fully verified as
  extracting correctly.** Pending/failed transaction rows, a business
  (Till/Paybill-owner) statement, a statement spanning a full month or
  year, and multi-page wrapping at scale are all unverified.
- **A second real statement, uploaded by the user, turned out to be a
  scanned/photographed document (7 pages, ~450KB/page, one embedded raster
  image per page, only ~119 characters of real extractable text per page)
  — not a native text-based export.** This is squarely OCR territory,
  explicitly out of MVP scope (docs/06 §Extraction: "OCR only when
  necessary," V2). The real bug this surfaced wasn't in extraction itself —
  it was in the *diagnosis*: `statement-processor.ts`'s only text-layer
  check was `=== 0` length, and pdfjs still pulls a few dozen characters of
  header/footer text off a rasterized page, so this fell through to the
  generic `no_transactions_found` (implying "we found real text but no
  transaction table in it") instead of anything pointing at the actual
  cause. Fixed with a second, more precise check — average characters per
  page below a floor (300, chosen with real margin below both this scanned
  document's ~119/page and any genuine text-based statement's page, which
  carries thousands of characters just from its own transaction rows) —
  applied only *after* normal parsing has already found zero rows, not as
  an earlier blanket gate (a real, short statement — or a small test
  fixture — must still get a real parse attempt, not a pre-emptive
  rejection by page-density alone). Result: `looks_like_scanned_document`,
  a precise, actionable error instead of a misleading one. OCR support
  itself remains unbuilt — this only makes the failure honest about why.
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
other as duplicates), idempotent retry, tenant isolation on
`/statements/:id/transactions`, and — via `buildColumnarStatementPdf` — a
genuinely reordered/relabeled column layout extracted correctly through the
real pdfjs pipeline. `column-mapper.test.ts` unit-tests the header-driven
parser directly against hand-built `PositionedItem` fixtures: standard
order, fully reordered columns, relabeled headers, a merged signed Amount
column, slash/month-name date formats, and every "don't guess, flag it"
path (ambiguous Paid In/Withdrawn, unrecognized status, non-decimal
balance).
