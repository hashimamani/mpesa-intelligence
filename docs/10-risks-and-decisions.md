# Major Risks & Decisions Requiring Sign-Off

This is the actionable output of Phase 0. Nothing past Stage 1 should start
until the items below are either answered or explicitly deferred by the
product owner.

## Decisions requiring sign-off

**D-1. Tech stack confirmation.** Proposed: React Native, Next.js, NestJS,
PostgreSQL/Aurora, Redis, SQS, S3, AWS Fargate, Terraform. Alternative
stacks were not deeply evaluated against this one — flag now if there's a
strong reason to prefer something else (e.g. existing AmaniLabs tooling/
infra patterns from your other repos that this should align with).

**D-2. Legal/compliance engagement.** No lawyer has reviewed data protection,
privacy policy, ToS, or billing/consumer-protection obligations. This blocks
handling any real user's statement in production, not just AI or billing
specifically. Needs an owner and a timeline before Stage 15 (production
infra) — ideally started much earlier since legal review has its own lead time.

**D-3. Tenant isolation defense-in-depth.** Application-layer scoping only,
or also PostgreSQL Row-Level Security as a second enforcement layer? RLS adds
setup/maintenance cost but removes a class of "developer forgot the WHERE
clause" bugs entirely. Recommend RLS given the sensitivity of the data, but
this is a real cost/benefit call for the product owner.

**D-4. Billing provider selection.** Needs evaluation of M-Pesa-native
recurring billing support vs. a global provider (e.g. Stripe) for cards, and
how each handles the Kenya market specifically. Affects Stage 11 timeline
since provider integration and testing takes real calendar time.

**D-5. AI provider selection and budget.** Which model/vendor, and what
per-user/system-wide cost ceiling is acceptable before AI insight generation
throttles or degrades. Needed before Stage 10.

**D-6. Data retention defaults.** Proposed 24-month statement retention / 30-day
soft-delete grace window (see [05-security-threat-model.md](05-security-threat-model.md))
are engineering defaults, not product or legal decisions — need explicit
confirmation, ideally as part of the D-2 legal review rather than ahead of it.

**D-7. Monorepo tooling.** Proposed pnpm workspaces + Turborepo for
`/apps` + `/packages`. Low-risk, reversible choice, flagged for awareness
rather than requiring deep deliberation.

## Real-world setup dependencies (not engineering tasks)

These block specific later stages and have their own lead times — starting
them early is worth doing in parallel with Stage 1–2 engineering work rather
than waiting:

- **AWS account** — needed before Stage 15, but org/billing setup is worth
  doing early so IAM structure exists before infra-as-code is written against it.
- **Apple Developer Program + Google Play Console accounts** — needed before
  Stage 14 (mobile polish) but Apple's review/enrollment can take time; worth
  starting well ahead.
- **Payment/billing provider contract** — tied to D-4; contract and
  compliance paperwork can lag behind engineering integration work but not by much.
- **Domain + DNS** — needed before Stage 15, trivial lead time, no reason to
  defer.

## Top product/technical risks (beyond the decisions above)

1. **Extraction accuracy is the real bottleneck, not a solved input.**
   M-Pesa statement layouts vary; MVP deliberately narrows to one layout
   family first and measures accuracy against the fixture library before any
   layout-expansion work is scheduled.
2. **AI insight trust.** A single ungrounded/hallucinated insight shown to a
   user about their own money is a serious trust failure for a financial
   product. Mitigated architecturally (see [07-ai-architecture.md](07-ai-architecture.md)),
   but AI insights are deliberately excluded from MVP so the grounding/
   validation logic can be proven against real analytics output before it's
   user-facing.
3. **Categorization quality drives the entire product's perceived
   intelligence.** If categories are wrong often, every downstream metric
   (spend by category, trends, insights) feels wrong even if the arithmetic
   is correct. Layer 1–3 (deterministic + merchant + history) needs to be
   solid before layer 4 (AI classification) is worth adding.
4. **Scope size.** The full spec this discovery package is based on covers a
   multi-platform, multi-quarter commercial product. Treat the staged plan
   in [09-testing-deployment-strategy.md](09-testing-deployment-strategy.md)
   as the actual execution order — building broad-but-shallow across all 19
   stages at once is how this kind of project stalls.

## What happens next

On sign-off (even partial — e.g. "proceed on D-1, D-3, D-7, defer D-2/D-4/D-5
pending real accounts"), Stage 2 begins: repository scaffold (`/apps`,
`/packages`, `/infrastructure` per [03-architecture.md](03-architecture.md)),
local dev environment (docker-compose Postgres/Redis/MinIO), and `.env.example`
— no cloud resources, no real credentials, fully local and reversible.
