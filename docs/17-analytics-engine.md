# Analytics Engine (Stage 8)

## Scope

Deterministic analytics only, per docs/01-prd.md's MVP feature list:
**totals (received/spent/fees/net), spend by category, spend by month,
top merchants.** Explicitly not in scope: AI-grounded insights
("trend"/"anomaly"/"recurring"/"positive"/"warning" narrative claims — V1,
Stage 10), a `RecurringTransaction`/`Anomaly` detector (docs/04's ERD lists
these entities; nothing populates them yet — they read as Stage 10
territory, grounded-insight inputs rather than plain aggregation), business/
organization analytics (Stage 12), and any dashboard UI (Stage 9 — this
stage is the API only).

## Periods are always full calendar months

A statement's own date range ("01 Aug 2026 - 14 Aug 2026") is an
extraction-time concept; analytics periods are always full calendar months
(`analytics/period.ts`'s `calendarMonthOf`), computed in UTC. Every one of
an owner's transactions in that month counts toward that month's summary,
regardless of which statement(s) they came from — re-uploading an
overlapping statement, or uploading two statements that both touch the same
month, both stay correct because a summary is always recomputed from
scratch (see below), never incrementally accumulated.

## The summary is always recomputed live, never trusted from cache

`SpendingSummary` (docs/04's ERD: "precomputed period aggregate — cache,
rebuildable from Transaction") exists as a real table, but
`analytics/summary.ts`'s `computeSpendingSummary` **never reads it** — every
call (a statement finishing processing, a category correction, a plain
`GET /analytics/summary`) recomputes the full aggregate straight from
`Transaction` and upserts the result. Deliberate, not an oversight: a stale
cached money figure shown to a user about their own money is exactly the
trust failure docs/10-risks-and-decisions.md's risk list warns about, and a
cache-invalidation bug is a notoriously easy way to introduce exactly that
silently. The table still earns its place — it's what a future trend query
across many months, or a future admin view, can read without recomputing
everything — but nothing in this stage trusts it as a read path.

Three write-through call sites, all going through the same
`computeAndStoreSpendingSummary`:
1. `statement-processor.ts`, once per distinct calendar month the just-
   reconciled transactions touch (usually one, sometimes two if a statement
   spans a month boundary).
2. `transactions.service.ts`'s `correctCategory`, for the corrected
   transaction's month — otherwise a correction would leave that month's
   summary stale until the next statement upload happened to touch it.
3. `AnalyticsService`, on every `GET /analytics/summary` and
   `GET /analytics/trend` call.

## What's actually computed

- **totalReceived** — sum of every credit transaction's amount.
- **totalSpent** — sum of debit transactions whose top-level category is
  "Spending" specifically. Excludes Transfers, Cash, Savings, and Loans —
  docs/06's accounting distinction: a P2P transfer or an ATM withdrawal
  moves money but isn't consumption.
- **totalFees** — sum of `transactionType: "fee"` rows. M-Pesa's own
  charges render as their own transaction rows (a Pay Bill payment and its
  "Pay Bill Charge" line are two separate `Transaction`s sharing one
  receipt number — docs/15), not a sub-field on the transaction they're
  attached to, so `Transaction.fee` (an ERD-inherited column) stays 0 and
  isn't what this sums.
- **netMovement** — totalReceived minus every debit in the period,
  regardless of category. Deliberately the literal balance-level truth
  ("how did your balance actually change"), not a category-filtered figure
  — kept separate from totalSpent on purpose.
- **byCategory** — one entry per Spending *subcategory* with any activity
  (Food & Dining, Transport & Fuel, Bills & Utilities, ...), sorted biggest
  first — this is "where your money went" / "biggest categories" from
  docs/02's aha-moment definition. Transfers/Cash/Savings/Loans never
  appear here; a P2P transfer counterparty isn't a "category" of spending.
- **topMerchants** — up to 10 real merchants (Spending category only,
  `merchantName` grouped, non-null) by total spend, with a transaction
  count each. A P2P transfer's counterparty (also populated into
  `merchantName` by Stage 6's generic "to/from `<code>` - NAME" pattern)
  never appears — the same Spending-category filter that keeps
  `byCategory` honest keeps this honest too.

All queries exclude `isDuplicateOf`-flagged rows — a cross-statement
duplicate stays visible for review but must never double-count (docs/15).

## Defaulting behavior

`GET /analytics/summary` with no `month` query param doesn't default to the
real-world current month — it defaults to the most recent calendar month
this owner actually has a transaction in. A user who uploads a statement
from four years ago should see that statement's numbers immediately, not an
empty "no data this month" dashboard for the actual present month — matches
docs/02's "aha moment" requirement (processing finishes, she sees her data,
full stop). An owner with zero transactions at all correctly falls back to
the real current month, all-zero — a genuine empty state, not a wrong one.

`GET /analytics/trend?months=N` (default 6, max 24) returns N consecutive
calendar months ending at that same default month, oldest first, including
any zero-activity months in between — a trend chart needs a continuous
x-axis, not gaps where a month happened to have no statements.

## Statement lifecycle: `processed` is finally reachable

docs/06's pipeline is `extraction -> categorization -> analytics -> status`.
Through Stage 7, no statement could ever reach `processed` — this stage is
what completes the chain: a statement with zero unparsed rows and full
reconciliation confidence now lands in `processed`, not stuck at
`processing` forever. `StatementProcessingJob.stage` correspondingly now
reaches `calculating_analytics` as its real final stage (the enum's
`generating_insights`/`complete` values stay reserved for Stage 10).
`Statement.analyticsVersion` (`"mpesa-analytics-v1"`) is set alongside
`parserVersion`/`classificationVersion`.

## Schema

`SpendingSummary`: `ownerType`, `ownerId`, `periodStart`/`periodEnd` (always
a calendar month's first/last day), `totalsJson` (the full computed
`SpendingSummaryDTO`, stored as JSON rather than a rigid column set — see
docs/04's own description of it as a flexible cache), `analyticsVersion`.
Unique on `(ownerType, ownerId, periodStart, periodEnd)`.

## Known gaps, honestly

- **No incremental computation.** Every summary request re-aggregates every
  transaction in that owner's month from scratch. Fine at MVP data volumes
  (hundreds to low-thousands of transactions per owner per month); would
  need real optimization work before it'd hold up at much larger scale —
  not attempted preemptively.
- **`RecurringTransaction` and `Anomaly` (docs/04's ERD) are unbuilt.**
  Read as Stage 10 (AI-grounded insights) inputs given docs/01's V1 feature
  list groups "recurring"/"anomaly" under AI insights specifically, not
  under MVP's "deterministic analytics" bullet — a judgment call about
  where the line sits, flagged here rather than silently assumed.
- **No business/organization analytics.** `SpendingSummaryDTO` and the
  classifier both already carry `ownerType`/`ownerId` generically, so the
  same code should work once Stage 12 adds organizations — untested against
  that case, since organizations don't exist yet.
- **No premium tier gating (history window, "advanced analytics").**
  docs/08 reserves a limited history window for the free tier; nothing
  enforces that yet since billing/subscriptions (Stage 11) don't exist.
  Every owner currently gets unlimited trend history.

## Verifying changes to this stage

```bash
npm run test --workspace=@mpesa/api      # period.test.ts — calendar-month math, no DB needed
npm run dev:services                     # postgres, redis, minio
npm run test:e2e --workspace=@mpesa/api  # analytics.e2e-test.ts drives the full pipeline
```

`analytics.e2e-test.ts` covers: totals (received/spent/fees/net) computed
correctly with a Spending-vs-Transfers mix, category breakdown sorted and
scoped to Spending only, top merchants excluding a P2P counterparty,
default-month behavior (both with and without any transactions), malformed
`month` rejection, a multi-month trend including a zero-activity gap month,
a correction updating its month's summary immediately, and the statement
reaching `processed` with `analyticsVersion` set.
