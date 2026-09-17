# Product Requirements Document

## A. Vision

Turn an M-Pesa statement into an understood financial life:

```
UPLOAD → EXTRACT → NORMALIZE → CATEGORIZE → ANALYZE → VISUALIZE → INSIGHTS → ACTIONS
```

The product succeeds if a first-time user uploads a statement and, within
seconds of processing finishing, feels the app already understands their money
better than they do. That moment — not feature count — is the product.

## B. Personas

**Amina, 27, individual consumer.** Salaried, paid via M-Pesa and bank, spends
mostly on M-Pesa (transport, food, sending money home). Wants to know where
her money leaks and whether she can hit a savings goal. Not a spreadsheet
person — will not build her own budget.

**Brian, 34, small business owner (business persona).** Runs a shop or service
business, receives payments via Till/Paybill, pays suppliers via M-Pesa. Wants
revenue/expense visibility without hiring a bookkeeper, and needs to hand a
report to an accountant or a SACCO loan officer.

**Faith, finance manager at a growing SME (business/team persona).** Not the
owner, but manages day-to-day money movement for the org, needs role-scoped
access and export-ready reports, does not want owner-level control.

## C. MVP feature list (must ship to validate the core loop)

- Account creation, login, password reset (consumer)
- Single M-Pesa statement upload (PDF, text-based)
- Async processing pipeline with visible progress
- Deterministic transaction extraction + normalization
- Rule/merchant-based categorization (layers 1–2 only; no ML/AI classification yet)
- Deterministic analytics: totals, spend by category, spend by month, top merchants
- Consumer dashboard: financial snapshot, where money went, category breakdown, trend
- Transaction list with manual category correction
- Basic empty/loading/error states
- Minimal admin visibility into processing job status (internal only, not a full admin UI)

MVP explicitly excludes AI insights, premium tiers, business/org accounts, and
mobile apps — it is web-only and consumer-only, to validate extraction accuracy
and category quality before building anything more expensive.

## D. V1 feature list (first commercial release)

- Everything in MVP
- Mobile apps (iOS + Android via React Native)
- AI-grounded insights (trend, anomaly, recurring, positive, warning) with
  validation against verified analytics
- Premium subscription tier (unlimited history, advanced analytics, savings
  goals, financial health score)
- Business/organization accounts with roles (owner, admin, analyst, viewer)
- Business dashboard: revenue, expenses, cash flow, top customers/suppliers
- CSV/PDF export
- Billing integration (subscription create/cancel/renew, webhook-driven entitlement sync)
- Production AWS infrastructure, CI/CD, monitoring, backups

## E. V2 (post-launch, once V1 is stable and has real usage data)

- Financial coach / goal-based recommendations
- Recurring payment detection and subscription tracking
- Multi-statement / multi-account aggregation per user
- Team invites with email-based onboarding flow
- Scanned/OCR statement support
- Notification system (push/email) for insights and renewals
- Admin panel with audit logs

## F. Future (not scoped, explicitly parked)

- Direct M-Pesa API/account linking (requires Safaricom partnership, separate
  compliance track — out of scope until statement-upload product is validated)
- Additional currencies/countries
- Swahili localization
- Bank statement support beyond M-Pesa
- Lending/credit decisioning products built on top of this data

## G. Non-functional requirements

- **Money correctness**: every displayed monetary figure must trace to a
  deterministic calculation chain from raw transaction data (see
  [07-ai-architecture.md](07-ai-architecture.md) for the AI grounding rule).
  DECIMAL/NUMERIC only, never floating point, for any monetary value.
- **Security**: statements and transactions are sensitive financial data —
  encrypted in transit and at rest, tenant-isolated, least-privilege access,
  audited. Full threat model in [05-security-threat-model.md](05-security-threat-model.md).
- **Processing UX**: statement processing is async; no HTTP request blocks for
  document parsing. User sees real, stage-accurate progress, not simulated progress.
- **Availability target for V1**: no formal SLA pre-launch; target 99.5% API
  uptime once in production, revisited after real traffic data exists.
- **Scale target**: architecture must not require a rewrite to reach ~100k
  consumer users and ~10k organizations. It is explicitly allowed to require
  re-tuning (bigger DB instance, more workers) — not a rewrite.
- **Accessibility**: keyboard navigation, screen reader support, sufficient
  contrast, semantic HTML from Stage 3 (design system) onward — not a
  pre-launch bolt-on.
- **Privacy/compliance**: designed with Kenya Data Protection Act in mind;
  formal legal review is a launch blocker, not a nice-to-have (see risks doc).

## H. Risks (see [10-risks-and-decisions.md](10-risks-and-decisions.md) for full list and owners)

- Statement format variability could make extraction accuracy the actual
  bottleneck, not a solved problem — MVP scope is deliberately narrow (one
  format family) to de-risk this first.
- AI insight hallucination/trust risk if grounding validation is weak — MVP
  ships without AI insights specifically to keep this off the critical path
  until the analytics engine is proven.
- Legal/compliance review has not happened yet — this is a hard blocker for
  handling real user statements in production, not just for AI or billing.
- No AWS account, Apple/Google developer accounts, or payment provider
  contract exist yet — these are real-world setup dependencies, not
  engineering tasks, and each has a lead time.

## I. Assumptions

- Initial market is Kenya only, KES only, English only.
- Users provide statements themselves (PDF export from the M-Pesa app); no
  direct Safaricom API integration in V1.
- "Business" in V1 means SME-scale (single till/paybill, small team), not
  enterprise multi-entity accounting.
