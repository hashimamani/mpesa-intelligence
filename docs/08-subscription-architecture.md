# Subscription & Billing Architecture

## Tiers

**Free** — statement upload, basic (rule/merchant-layer) categorization,
basic analytics, limited history window (e.g. last 3 months — exact limit is
a product decision, not fixed here), basic insights only (no AI-generated
insights).

**Premium (individual)** — unlimited history, advanced analytics, AI-grounded
insights, savings goals, financial health score, period comparisons.

**Business** — organization support, multiple team members with roles,
business dashboard and analytics, exports, advanced reports, higher
processing limits.

Tier boundaries are a product decision to be finalized before Stage 11
(premium) — this doc fixes the *architecture* for entitlements, not the
final price/feature cutoffs.

## Central entitlement system

Subscription/tier logic is never scattered as ad-hoc checks across features.
A single `EntitlementService` resolves "can this owner (user or organization)
do X" from their current `Subscription` state, and every premium/business
feature — API route and UI affordance alike — checks it through that one
service. This is what prevents the spec's failure mode of tier logic
duplicated (and inevitably drifting) across a dozen call sites.

Critically: **entitlement checks are enforced server-side, on every request**,
not just hidden/shown in the UI. A free user calling a premium API endpoint
directly gets rejected by the same `EntitlementService` check the UI uses to
decide what to render — the frontend check is a UX nicety, never the
authorization boundary.

## Billing provider

Not yet selected — this requires evaluating providers against Kenya-market
support for M-Pesa/card billing, webhook reliability, and subscription
lifecycle features. Candidates to evaluate at Stage 11: a payments provider
with native M-Pesa support plus recurring billing, versus a global provider
(e.g. Stripe) for card billing with a separate M-Pesa top-up flow. **This is
a decision item, not committed** — see [10-risks-and-decisions.md](10-risks-and-decisions.md), item D-4.

## Subscription lifecycle (provider-agnostic contract)

```
create → active → (renewal | payment_failed → grace_period → (recovered | canceled)) → canceled/expired
```

- The backend's `Subscription` table is the source of truth for entitlement
  decisions at request time — never a live call to the billing provider on
  the hot path.
- The billing provider's webhooks (payment succeeded, payment failed,
  subscription canceled, subscription renewed) are the only way
  `Subscription.status` changes; webhook handlers are idempotent (a
  replayed/duplicate webhook must not double-apply a state change) and
  verify the provider's signature before trusting the payload.
- Failed payment enters a grace period (proposed default: 3–7 days,
  finalized as a product decision) during which entitlements remain active,
  after which they downgrade to Free — not deleted, not blocked from
  re-subscribing.
- Every subscription state change is an `AuditEvent` and generates a
  `Notification` where relevant (renewal reminder, payment failed, grace
  period ending).

## What this architecture explicitly avoids

- No feature ships with subscription logic hardcoded as `if (user.plan ===
  'premium')` scattered in controllers — always through `EntitlementService`.
- No simulated/fake billing in any non-test code path — mocks belong only in
  automated tests (per the platform-wide "no fake implementations" rule).
- No client-submitted subscription/entitlement claim is ever trusted; the
  server always re-resolves entitlement from its own `Subscription` record.
