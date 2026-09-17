# Statement Processing Architecture

## Pipeline

```
Upload → S3 (private) → Job enqueued (SQS) → Worker picks up job
  → Document detection (format/layout)
  → Extraction (text-based PDF parser; OCR path reserved for later)
  → Validation (dates, amounts, balance continuity, duplicates)
  → Normalization (raw → canonical Transaction rows)
  → Categorization (see below)
  → Analytics calculation
  → Status: processed  |  needs_review  |  failed
```

Every stage transition updates `StatementProcessingJob.stage` so the client
can render real, non-simulated progress. No HTTP request blocks on this —
upload returns immediately with a job id; the client polls or subscribes for
status.

## Extraction

MVP scope: text-based PDF statements from the official M-Pesa app export,
one layout family. The parser is built in explicit stages (document
detection → layout detection → field extraction → normalization) so that
supporting a second layout later is "add a detector + extractor," not a
rewrite. OCR (for scanned statements) and CSV/XLSX are explicitly V2 —
attempting all formats in MVP is how extraction accuracy becomes the
project's bottleneck instead of a solved input.

## Validation, before anything is trusted as a real transaction

- Date validity and statement-period consistency
- Amount validity (parses to a valid decimal, matches expected format)
- Balance continuity where the statement provides a running balance:
  `previous_balance + credit - debit - fee == new_balance`, checked per row
- Duplicate detection via reference number + amount + timestamp fingerprint
- Statement-level reconciliation: sum of extracted transactions plus fees
  should account for the statement's own opening/closing balance movement,
  within the statement's stated semantics

If confidence is low or a reconciliation check fails, the statement is marked
`needs_review`, not silently accepted. **No financial number is ever shown to
a user that came from a document the system itself flagged as
inconsistent.**

## Idempotency

Every upload is fingerprinted (hash of file content). Re-uploading the same
document resolves to the same `Statement` record rather than creating a
duplicate. Job processing uses an idempotency key per job attempt so a retry
after a worker crash cannot double-insert transactions — inserts are
upserts keyed on `(statement_id, source_row_fingerprint)`.

## Categorization engine (layered, per the product principle: never rely on an LLM alone for authoritative classification)

1. **Deterministic rules** — exact/pattern matches on transaction type and
   known M-Pesa system descriptions (e.g. "Pay Bill," "Send Money," "Withdraw").
2. **Merchant recognition** — lookup against the `Merchant` table (global,
   curated + crowd-observed canonical merchants) for a default category.
3. **Historical classification** — has this owner classified this exact
   merchant/description before? Prefer their own history over the global default.
4. **ML/AI classification** — only for what layers 1–3 leave unresolved;
   produces a category + confidence, never overrides a higher-confidence
   deterministic match.
5. **User correction** — always wins, is stored as a `CategoryCorrection`
   scoped to the owner (personal or organization), and feeds back into layer 3
   for that owner. A single user's correction never silently mutates the
   global `Merchant.default_category_id` — global merchant knowledge updates
   only through a reviewed, aggregate process (e.g. N independent owners
   agreeing), not one person's override.

Every `Transaction` stores `category_id`, `subcategory_id`,
`classification_confidence`, and `classification_source` so the origin of
every category is always inspectable — matches the "where did this number
come from" rule from the PRD's non-functional requirements.

## Accounting distinction (critical to output quality)

Not every outgoing M-Pesa transaction is "spending." The categorization and
analytics layers distinguish consumption from transfers, savings/investment
movements, loan repayments, cash withdrawals (which are a movement of money,
not proof of consumption), and business transfers. This distinction lives in
the category taxonomy (top-level categories separate "Spending" from
"Transfers," "Savings," "Loans," "Cash") and in how the analytics engine
labels "total spent" vs. "total money moved out."

## Versioning

Every `Statement` records `parser_version`, `classification_version`,
`analytics_version`, and `insight_version` at the time it was processed, so a
parser or taxonomy change never silently reinterprets historical data without
a record of which version produced which numbers — and reprocessing (if ever
needed) is an explicit, auditable action.
