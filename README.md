# M-Pesa Financial Intelligence Platform

A commercial-grade financial analytics platform that turns an M-Pesa statement into
a clear picture of how money moves — for individuals and for businesses.

## Status: Stage 6 — Extraction engine

Phase 0 (discovery) is done — see `/docs`. Stage 2 produced a real, buildable
monorepo; Stage 3 added a real design system (`packages/ui`); Stage 4 added a
full backend auth system; Stage 5 added statement upload end-to-end (presigned
S3/MinIO uploads, a BullMQ/Redis job queue with a separate worker process).
Stage 6 (this one) adds real M-Pesa transaction extraction: a statement
parser (row reconstruction from PDF text positions → pattern matching →
balance-delta reconciliation → normalization), duplicate detection across
statements, and a transactions table in `apps/web`'s upload page. See
[docs/15-extraction-engine.md](docs/15-extraction-engine.md) for exactly how
it works, its most important caveat (the parser has **not** been validated
against a real Safaricom statement — none was available to build against),
and a real layout limitation found by testing against actually-rendered
PDFs. See [docs/11-development.md](docs/11-development.md) to run it.

No category taxonomy, merchant table, or analytics yet — that's Stage 7/8.
Items flagged in [10-risks-and-decisions.md](docs/10-risks-and-decisions.md)
still need an explicit answer from the product owner before production-facing
stages (11+) begin in earnest, and the extraction layout risk above should be
closed with a real statement sample before this handles real user data.

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

## What this repository deliberately does not include (yet)

- No AWS resources have been provisioned. No AWS account/credentials exist in this workspace
  — `infrastructure/` contains placeholder Terraform, not working config (see its own README).
- No app store (Apple/Google) developer accounts have been set up.
- No payment/billing provider has been integrated or contracted.
- No category taxonomy, merchant table, analytics, or insights exist yet —
  extraction (Stage 6) stops at normalized transactions, not a dashboard.
- The statement parser is unvalidated against a real M-Pesa statement (see
  docs/15-extraction-engine.md) — a real, open risk, not a solved problem.

These require real-world setup (accounts, credentials, legal review) that only
the product owner can authorize. See [10-risks-and-decisions.md](docs/10-risks-and-decisions.md)
for the specific decisions blocking each one.
