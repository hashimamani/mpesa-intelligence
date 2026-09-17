# M-Pesa Financial Intelligence Platform

A commercial-grade financial analytics platform that turns an M-Pesa statement into
a clear picture of how money moves — for individuals and for businesses.

## Status: Stage 2 — Repository scaffold

Phase 0 (discovery) is done — see `/docs`. Stage 2 (this one) has produced a
real, buildable monorepo: `apps/api` (NestJS), `apps/web` and `apps/admin`
(Next.js), `apps/mobile` (Expo/React Native), and `packages/*` (shared types,
money handling, validation, config, design-system stub), plus a local dev
environment (`docker-compose.yml`: Postgres, Redis, MinIO) and CI-ready
lint/typecheck/test/build scripts. See [docs/11-development.md](docs/11-development.md)
to run it.

No product features exist yet — no auth, no upload, no real UI. That starts
at Stage 3 (design system) and Stage 4 (auth). Items flagged in
[10-risks-and-decisions.md](docs/10-risks-and-decisions.md) still need an
explicit answer from the product owner before those stages begin in earnest.

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

## What this repository deliberately does not include (yet)

- No AWS resources have been provisioned. No AWS account/credentials exist in this workspace
  — `infrastructure/` contains placeholder Terraform, not working config (see its own README).
- No app store (Apple/Google) developer accounts have been set up.
- No payment/billing provider has been integrated or contracted.
- No product features — auth, statement upload, categorization, dashboards — exist yet.
  What exists is the scaffold: bootable apps, shared packages, and local dev infra.

These require real-world setup (accounts, credentials, legal review) that only
the product owner can authorize. See [10-risks-and-decisions.md](docs/10-risks-and-decisions.md)
for the specific decisions blocking each one.
