# M-Pesa Financial Intelligence Platform

A commercial-grade financial analytics platform that turns an M-Pesa statement into
a clear picture of how money moves — for individuals and for businesses.

## Status: Stage 8 — Analytics engine

Phase 0 (discovery) is done — see `/docs`. Stage 2 produced a real, buildable
monorepo; Stage 3 added a real design system (`packages/ui`); Stage 4 added a
full backend auth system; Stage 5 added statement upload end-to-end (presigned
S3/MinIO uploads, a BullMQ/Redis job queue with a separate worker process).
Stage 6 added real M-Pesa transaction extraction — a header-driven statement
parser, group-level reconciliation, normalization — then **calibrated against
one real M-Pesa statement** (read locally for testing only, never committed):
77/77 rows, 100% reconciled. Stage 7 added real categorization: a six-group
taxonomy (Spending, Transfers, Savings & Investments, Loans & Credit, Cash,
Uncategorized) and a layered classifier — deterministic rules → merchant
recognition → this owner's own correction history — with a
`POST /transactions/category-corrections` endpoint for the user-always-wins
layer. See [docs/15-extraction-engine.md](docs/15-extraction-engine.md) and
[docs/16-categorization-engine.md](docs/16-categorization-engine.md) for the
full story on each.

Stage 8 (this one) adds real deterministic analytics: totals (received/spent/
fees/net movement), spend by category, spend by month (trend), and top
merchants — matching docs/01-prd.md's MVP scope exactly (no AI-grounded
insights, no anomaly/recurring detection — that's Stage 10). Every summary is
recomputed live from `Transaction` on every read, write-through into a
`SpendingSummary` cache table, rather than trusted from cache — a stale money
figure shown to a user about their own money is a real trust failure, not
just a performance nitpick. A clean statement finally reaches `processed`
status now that the full `extraction → categorization → analytics` pipeline
(docs/06) is complete. See
[docs/17-analytics-engine.md](docs/17-analytics-engine.md) for exactly how
totals are computed and its honest gaps. See
[docs/11-development.md](docs/11-development.md) to run it.

No dashboard UI or AI insights exist yet — that's Stage 9/10. Items flagged
in [10-risks-and-decisions.md](docs/10-risks-and-decisions.md) still need an
explicit answer from the product owner before production-facing stages (11+)
begin in earnest.

## Reading order

1. [01-prd.md](docs/01-prd.md) — product vision, personas, MVP/V1/V2/Future scope, non-functional requirements
2. [02-user-journeys.md](docs/02-user-journeys.md) — consumer and business journeys, "aha moment" definition
3. [03-architecture.md](docs/03-architecture.md) — system architecture, tech stack, AWS architecture, rationale
4. [04-database-erd.md](docs/04-database-erd.md) — domain model and entity-relationship diagram
5. [05-security-threat-model.md](docs/05-security-threat-model.md) — threat model, privacy, compliance flags
6. [06-statement-processing-architecture.md](docs/06-statement-processing-architecture.md) — ingestion, extraction, categorization pipeline
7. [07-ai-architecture.md](docs/07-ai-architecture.md) — AI insight engine, grounding, prompt-injection defense, cost control
8. [08-subscription-architecture.md](docs/08-subscription-architecture.md) — entitlements, billing, tiers
9. [09-testing-deployment-strategy.md](docs/09-testing-deployment-strategy.md) — testing pyramid, CI/CD, staged rollout
10. [10-risks-and-decisions.md](docs/10-risks-and-decisions.md) — major risks and decisions that need sign-off
11. [11-development.md](docs/11-development.md) — how to run this repo locally
12. [12-design-system.md](docs/12-design-system.md) — visual language, tokens, and component set
13. [13-auth-architecture.md](docs/13-auth-architecture.md) — Prisma, token rotation, session model, email fallback
14. [14-statement-upload.md](docs/14-statement-upload.md) — presigned uploads, BullMQ queue, worker, PDF validation
15. [15-extraction-engine.md](docs/15-extraction-engine.md) — statement parsing, reconciliation, duplicate detection, known limitations
16. [16-categorization-engine.md](docs/16-categorization-engine.md) — taxonomy, layered classifier, corrections, known gaps
17. [17-analytics-engine.md](docs/17-analytics-engine.md) — totals, category/merchant breakdowns, trend, live-recompute design

## What this repository deliberately does not include (yet)

- No AWS resources have been provisioned. No AWS account/credentials exist in this workspace
  — `infrastructure/` contains placeholder Terraform, not working config (see its own README).
- No app store (Apple/Google) developer accounts have been set up.
- No payment/billing provider has been integrated or contracted.
- No dashboard UI or AI-grounded insights exist yet — Stage 8 stops at the
  analytics API, not a rendered screen.
- The statement parser has been calibrated against exactly one real
  statement (see docs/15-extraction-engine.md) — not multiple accounts,
  statement types, or edge cases. Tested-once, not proven-general.
- The categorization engine's merchant list is a small, hand-picked seed
  (~11 real merchants/billers) — most real pay_bill/buy_goods transactions
  still land at the deterministic rule layer's generic default until a real
  merchant is added or a user corrects it once (see
  docs/16-categorization-engine.md).
- No `RecurringTransaction`/`Anomaly` detection — read as Stage 10 (AI-
  grounded insights) territory per docs/01's V1 feature list, not MVP
  deterministic analytics (see docs/17-analytics-engine.md).

These require real-world setup (accounts, credentials, legal review) that only
the product owner can authorize. See [10-risks-and-decisions.md](docs/10-risks-and-decisions.md)
for the specific decisions blocking each one.
