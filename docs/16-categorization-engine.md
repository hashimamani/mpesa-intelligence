# Categorization Engine (Stage 7)

## Scope

Every reconciled, normalized `Transaction` (Stage 6) gets a `category`/
`subcategory` before it's persisted. Explicitly **not** in scope: ML/AI
classification (layer 4 below — deliberately deferred, see §Why no AI
layer), analytics/spend summaries (Stage 8), a `Contact`/`counterparty_id`
entity for P2P transfers (docs/04-database-erd.md lists one; this stage
scopes it out — send_money/receive_money categorize correctly from
`transactionType` alone without it).

## The taxonomy

Self-referential, two-level (`categorization/taxonomy.ts`): six top-level
groups — **Spending, Transfers, Savings & Investments, Loans & Credit,
Cash, Uncategorized** — mirroring docs/06's "Accounting distinction"
section, which is explicit that a cash withdrawal or a P2P transfer is a
money *movement*, not proof of spending. Subcategories nest under the first
five (e.g. Spending → Food & Dining, Bills & Utilities, Airtime & Data...).

No **Income** bucket. A credited M-Pesa transaction (salary, refund, gift,
business receipt) can't be told apart from a plain P2P transfer by
`transactionType` or description alone — every `receive_money` lands under
Transfers → Received until a real signal (merchant recognition, user
correction) says otherwise. Not a hedge; a real limit of what deterministic
rules can know from a description string.

Seeded idempotently at the start of every processing job
(`categorization/taxonomy-seeder.ts`, keyed by `slug`, not a generated id)
rather than a separate migration-adjacent step someone has to remember to
run before a deploy. A ~20-row upsert per job is cheap and makes the
taxonomy self-healing across a redeploy that adds a new category.

## The layered classifier (docs/06's design, followed exactly)

1. **Deterministic rule** (`classifyByRule`, `categorization/classifier.ts`)
   — `transactionType`-first (fee → Fees & Charges, airtime → Airtime &
   Data, withdraw → Cash, send_money/receive_money → Transfers, ...), with
   a description-keyword override for two shapes Stage 6's `TransactionType`
   enum doesn't distinguish (see docs/15's "Known gaps"):
   - `/fuliza|overdraft|od loan/i` → Loans & Credit → Loan Repayment
   - `/bundle/i` (on `TransactionType: "other"`) → Airtime & Data

   `pay_bill`/`buy_goods` default to Spending → Other Spending at low
   confidence (0.5) — almost always real spending, just not yet specific;
   merchant recognition usually refines it. `reversal` and unrecognized
   `other` land in Uncategorized rather than guessing which bucket a
   reversal reverses.
2. **Merchant recognition** — the extracted `merchantName` (Stage 6),
   normalized (`merchant-normalization.ts`: uppercased, punctuation
   stripped, whitespace collapsed) and substring-matched against the
   `merchants` table (longest match wins, so a specific seed beats a
   shorter generic one). Overrides layer 1 when it matches. A small curated
   list of real, well-known Kenyan merchants/billers is seeded
   (`taxonomy.ts`'s `SEED_MERCHANTS`) — meant to grow as real statements
   reveal real recurring merchants, not be padded with guesses now.
3. **Historical classification** — has this owner corrected a transaction
   with this exact (normalized) merchant name (or description, when there's
   no merchant name at all) before? Outranks both layers 1 and 2. Built
   once per job from this owner's real `CategoryCorrection` rows
   (`categorization/lookups.ts`'s `loadHistoryLookup`), not queried per row.
4. **ML/AI classification** — **not implemented.** See §Why no AI layer.
5. **User correction** — always wins, lives outside the extraction
   pipeline entirely: `POST /transactions/category-corrections`
   (`transactions/transactions.service.ts`). Creates an immutable
   `CategoryCorrection` audit row and updates the `Transaction` with
   `classificationSource: "user_correction"`, `confidence: 1`. Never
   mutates `Merchant.defaultCategoryId` directly — that's reserved for a
   future reviewed aggregate process (N independent owners agreeing),
   consistent with docs/06.

Layers 1-3 are **pure and synchronous** (`classifyTransaction` in
`classifier.ts`) — every DB read (categories, merchants, this owner's
correction history) is loaded once per job by `statement-processor.ts` and
passed in as plain in-memory lookups, not queried per row. Fully
unit-testable with zero database (`classifier.test.ts`).

## Why no AI layer

docs/10-risks-and-decisions.md's own risk list: *"Categorization quality
drives the entire product's perceived intelligence... Layer 1-3
(deterministic + merchant + history) needs to be solid before layer 4 (AI
classification) is worth adding."* This project's own principle (docs/07)
is that AI interprets, it never calculates or silently authoritatively
classifies financial data — and a placeholder/fake AI call would violate
this project's "no fake implementations" rule just as much as a fake
extraction result would. `ClassificationSource.ai` stays in the schema
(reserved), and nothing writes it yet.

## Correcting how a transaction's category is normalized

`Transaction` stores `categoryId` (always top-level) and `subcategoryId`
(the specific child, when resolved) as two separate columns, both FKs to
the same self-referential `Category` table. A user's correction can name
either a top-level category or a specific subcategory — `TransactionsService.correctCategory`
and `classifier.ts`'s `resolveCategoryPair` both do the identical
normalization: a category with a `parentId` becomes `(categoryId:
parentId, subcategoryId: id)`; a top-level category becomes `(categoryId:
id, subcategoryId: null)`.

## Reprocessing never discards a correction

`statement-processor.ts`'s idempotent-retry path (delete + re-derive raw
rows, upsert transactions) re-runs classification from scratch every time.
Before overwriting a transaction's category on that `update` path, it
checks the existing row's `classificationSource` — if it's
`"user_correction"`, the fresh classification is discarded and the existing
category/confidence/source/merchant are kept as-is. Without this, a retry
after a worker crash (or any future re-run) would silently overwrite a
user's own explicit correction with whatever the automatic classifier
produces this time — verified by an e2e test (`categorization.e2e-test.ts`)
that corrects a transaction, reprocesses the same job, and asserts the
correction survived.

## Schema

`Category` (self-referential via `parentId`, unique `slug`, `isActive`,
`version`), `Merchant` (`canonicalName`, unique `normalizedName`,
`defaultCategoryId`, `source: global | learned` — only `global` is ever
written), `CategoryCorrection` (`transactionId`, owner, `previousCategoryId`,
`newCategoryId`, append-only/immutable). `Transaction.categoryId`,
`subcategoryId`, and `classificationSource` existed as plain nullable
columns since Stage 6 (with a comment saying Stage 7 would convert them);
this stage adds real FK relations plus a new `merchantId` FK. `Statement.classificationVersion`
existed since Stage 6 too, unset until now — set to `CLASSIFICATION_VERSION`
(`"mpesa-categorization-v1"`) alongside `parserVersion` once a statement's
transactions are classified.

The `StatementProcessingJob.stage` enum already had a `categorizing` value
reserved (Stage 4/5 scaffolding); this stage is the first to actually
transition into it, so a job's real final stage is now `"categorizing"`,
not `"reading_transactions"` — an existing Stage 5/6 e2e assertion was
updated to match (docs/06's own stated principle: "real, non-simulated
progress").

## Known gaps, honestly

- **The merchant seed list is small and hand-picked** (~11 entries:
  supermarkets, KPLC, a couple of telcos/ride-hailing apps, TerraPay). Most
  real pay_bill/buy_goods transactions will still resolve only to the
  layer-1 default (Spending → Other Spending, confidence 0.5) until a real
  merchant is added or the owner corrects it once (after which layer 3
  handles that owner's future transactions with the same merchant/
  description). This is the single biggest lever on perceived category
  quality per docs/10's own risk framing — expected to grow from real usage,
  not be pre-populated with guesses.
- **No Income category.** Explained above — a deliberate scope limit, not
  an oversight.
- **No `Contact`/counterparty entity.** docs/04's ERD lists one for P2P
  transfers (`counterparty_id`); this stage doesn't add it. send_money/
  receive_money categorize correctly without it (rule layer alone), but
  "who did I send money to, categorized by person" isn't answerable yet.
- **Merchant matching is substring-based, not fuzzy.** A typo or unusual
  formatting in a real merchant name (that the Stage 6 `extractMerchantName`
  regex itself extracted differently than expected) could miss a seed
  match entirely and fall through to the layer-1 default — no Levenshtein/
  fuzzy matching, on purpose, to keep this layer's behavior fully
  predictable and auditable.
- **History matching is exact (normalized), not fuzzy either.** A
  correction on "NAIVAS SUPERMARKET" won't automatically apply to "NAIVAS
  SUPERMARKET - WESTGATE" unless the normalized merchant name happens to
  be identical — deliberately conservative (docs/06: a wrong automatic
  category is worse than an unresolved one), not yet validated against
  real correction behavior at any scale.

## Verifying changes to this stage

```bash
npm run test --workspace=@mpesa/api      # classifier.test.ts — layered logic, no DB needed
npm run dev:services                     # postgres, redis, minio
npm run test:e2e --workspace=@mpesa/api  # categorization.e2e-test.ts drives the full pipeline
```

`categorization.e2e-test.ts` covers: the rule layer for every unambiguous
`transactionType`, merchant recognition overriding the rule layer's
default, the Fuliza-keyword override, a full correction → history feedback
loop (correct one transaction, upload a second statement with the same
merchant for the same owner, confirm it auto-classifies to the corrected
category), a correction surviving job reprocessing, and cross-tenant
correction rejection.
