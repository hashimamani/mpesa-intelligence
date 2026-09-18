# M-Pesa Financial Intelligence Platform

A commercial-grade financial analytics platform that turns an M-Pesa statement into
a clear picture of how money moves — for individuals and for businesses.

## Status: Stage 9 — Consumer dashboard

Phase 0 (discovery) is done — see `/docs`. Stage 2 produced a real, buildable
monorepo; Stage 3 added a real design system (`packages/ui`); Stage 4 added a
full backend auth system; Stage 5 added statement upload end-to-end. Stage 6
added real M-Pesa transaction extraction — a header-driven statement parser,
group-level reconciliation, normalization — then **calibrated against one
real M-Pesa statement**: 77/77 rows, 100% reconciled. Stage 7 added real
categorization: a six-group taxonomy and a layered classifier (deterministic
rules → merchant recognition → this owner's own correction history). Stage 8
added deterministic analytics: totals, spend by category, spend by month
(trend), top merchants — recomputed live from `Transaction` on every read,
never trusted from cache. See
[docs/15-extraction-engine.md](docs/15-extraction-engine.md),
[docs/16-categorization-engine.md](docs/16-categorization-engine.md), and
[docs/17-analytics-engine.md](docs/17-analytics-engine.md) for the full story
on each.

Stage 9 (this one) gives that backend work an actual screen: a real consumer
dashboard (`apps/web/app/dashboard`) — financial snapshot, "where your money
went" category breakdown, spending trend, top merchants — and a transaction
list (`apps/web/app/transactions`) with inline manual category correction,
matching docs/01-prd.md's MVP feature list exactly. Per docs/02's "aha
moment" journey, the dashboard's empty state *is* the first-upload prompt —
a first-time user lands on the same screen that will later show their real
numbers, not a separate marketing page. Three new reusable design-system
components (`StatTile`, `BarList`, `TrendChart`) plus a `Select`, and two
small backend additions this stage's UI needed (`GET /categories`,
`GET /transactions?month=`). Manually verified end-to-end against the real
running stack (register → upload → dashboard renders correct totals →
correct a category → dashboard updates live) — see
[docs/18-consumer-dashboard.md](docs/18-consumer-dashboard.md) for exactly
what was built, two real bugs found and fixed while testing in an actual
browser (a stat tile truncating a real money figure, a table not actually
scrolling on narrow viewports), and its honest gaps. See
[docs/11-development.md](docs/11-development.md) to run it.

No AI insights, premium tiers, or business dashboards exist yet — that's
Stage 10+. Items flagged in
[10-risks-and-decisions.md](docs/10-risks-and-decisions.md) still need an
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
18. [18-consumer-dashboard.md](docs/18-consumer-dashboard.md) — dashboard/transactions screens, new UI primitives, bugs found testing in-browser

## What this repository deliberately does not include (yet)

- No AWS resources have been provisioned. No AWS account/credentials exist in this workspace
  — `infrastructure/` contains placeholder Terraform, not working config (see its own README).
- No app store (Apple/Google) developer accounts have been set up.
- No payment/billing provider has been integrated or contracted.
- No AI-grounded insights, premium tiers, or business dashboards exist yet.
- No month-switcher on the dashboard/transaction list, and no pagination on
  the transaction list — fine at MVP data volumes, see
  docs/18-consumer-dashboard.md.
- No automated frontend tests — `apps/web` has no test runner configured
  (a gap inherited from Stage 3/4/5, not introduced at Stage 9); this
  stage's UI was verified manually against the real running stack instead.
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
