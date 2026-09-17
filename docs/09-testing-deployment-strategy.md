# Testing & Deployment Strategy

## Testing pyramid

**Unit tests** — money/decimal calculations, categorization rule matching,
analytics formulas, date/statement parsing, anomaly scoring, entitlement
resolution. These are the highest-value tests in the system: a bug here is a
wrong number shown to a user about their own money, which is the one thing
this product cannot get wrong.

**Integration tests** — database access (including tenant-isolation
enforcement, tested as an explicit negative case: "user A cannot read org B's
data"), API contract tests, the full processing pipeline against fixture
statements, auth/session flows, S3 upload/signed-URL behavior, SQS job
processing including retry/idempotency.

**End-to-end tests** — full user journeys from [02-user-journeys.md](02-user-journeys.md):
register → login → upload → processing → dashboard → category correction →
insight; and business: create org → invite member → assign role → upload →
analytics → export → verify tenant isolation.

## Statement fixture library

A library of synthetic, non-real M-Pesa-style statement fixtures: normal
statements, large statements (thousands of transactions, for performance
testing), malformed statements, unusual/edge-case descriptions, duplicate
transactions, missing fields, different statement periods. **No real
person's statement is ever committed to the repository** — fixtures are
generated/synthetic data built to exercise known edge cases.

## Quality gates (a stage is not "done" without all of these)

Build passes, all test tiers pass, typecheck passes, lint passes, security
scan passes (no new high/critical findings), migrations run forward cleanly
against a fresh database, the feature works when actually exercised (browser/
simulator for anything UI-facing — see 03-architecture's UI verification
expectation from the base instructions), and loading/empty/error states are
implemented, not just the happy path.

## CI/CD

Every PR runs: lint, format check, typecheck, unit tests, relevant
integration tests, dependency vulnerability scan, build validation. Merge to
`main` triggers: image build → push to ECR → automatic deploy to `staging` →
smoke tests → **manual approval gate** → deploy to `production` → health
checks. A failed health check or smoke test blocks/rolls back automatically;
a human always approves the staging→production step for at least the first
several releases (revisit full automation once production deploys have a
track record).

## Staged rollout (maps to the 19 build stages in the original spec, sequenced here at a project-plan level)

```
Stage 0  Discovery              ← this document set (complete)
Stage 1  Architecture sign-off  ← blocked on decisions in 10-risks-and-decisions.md
Stage 2  Repository scaffold
Stage 3  Design system
Stage 4  Authentication
Stage 5  Statement upload
Stage 6  Extraction engine       ← gated on fixture-measured accuracy, not a deadline
Stage 7  Categorization
Stage 8  Analytics engine
Stage 9  Consumer dashboard      ← MVP scope ends here; candidate first real-user checkpoint
Stage 10 AI insights
Stage 11 Premium/billing
Stage 12 Business/organizations  ← tenant isolation tests are mandatory before this ships
Stage 13 Admin
Stage 14 Mobile polish
Stage 15 AWS production infrastructure
Stage 16 Hardening (security/perf/load/DR testing)
Stage 17 Release candidate checklist
Stage 18 Production launch
Stage 19 Post-launch monitoring
```

Each stage's completion is reported as: what was built, files changed, tests
created/passed, known issues, architectural decisions made, and what's next
— not just "done."

## Rollback & recovery

Deploy rollback = redeploy the previous ECS task definition revision
(seconds, not a rebuild). Database migrations follow an expand/contract
pattern so a code rollback never needs a matching schema rollback within a
release window. Backup/restore and full disaster-recovery runbooks (RPO/RTO
targets, restoration drill) are written and *tested* at Stage 16 — a backup
that has never been restored is not a backup.
