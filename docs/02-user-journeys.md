# User Journeys

## The "aha moment" (applies to every journey below)

```
WHAT HAPPENED → WHERE THE MONEY WENT → WHAT CHANGED → WHAT IS UNUSUAL → WHAT MATTERS → WHAT I CAN DO
```

The dashboard is not a transaction dump. Every journey below ends at this
narrative, not at a table.

## Consumer journeys

### J1 — First upload (MVP)

1. Amina signs up with email + password, verifies email.
2. Lands on an empty dashboard: "Upload your M-Pesa statement and we'll show
   you where your money went." One button, no questionnaire.
3. Picks a PDF exported from the M-Pesa app. Upload starts immediately;
   she sees real progress: Uploaded → Reading transactions → Categorizing →
   Calculating insights.
4. Processing finishes (seconds to low minutes depending on statement size).
5. Dashboard renders: total received/sent/fees, "where your money went"
   breakdown, biggest categories, spending trend, top merchants.
6. She notices "Transport: KSh 8,400" feels high and taps in — sees the
   underlying transactions.

**Success criteria**: time from upload to first rendered insight; whether she
returns without being prompted.

### J2 — Correcting a category (MVP)

1. Amina sees a transaction miscategorized ("Java House" under "Other").
2. Taps the transaction, changes category to "Food → Restaurants".
3. Correction is stored per-user; category totals recalculate immediately;
   future "Java House" transactions in her statements classify correctly.
4. Her correction does not affect any other user's classification of "Java House".

### J3 — Setting a savings goal (V1, premium)

1. From Goals, Amina creates "Emergency fund, KSh 60,000 by December."
2. System computes required monthly saving from the target and date.
3. Compares that requirement against her actual discretionary spending
   history and surfaces concrete, evidenced opportunities (e.g. "restaurant
   spending rose 48% vs. last period — reducing it could free roughly
   KSh 3,000–4,000/month"), each tagged as an estimate, never a guarantee.

### J4 — Monthly return visit (V1)

1. Amina gets a notification: "Your spending increased 18% this month."
2. Opens the app, sees the month-over-month comparison and the AI insight
   that generated the notification, with the underlying numbers shown
   alongside the claim.
3. Reviews financial health score and taps through to see the score's
   explanation (never an opaque number).

## Business journeys

### J5 — Business onboarding (V1)

1. Brian creates an account, chooses "Business," creates an organization.
2. Invites Faith as Finance Manager; she gets a scoped role, not owner access.
3. Uploads the shop's M-Pesa statement (till/paybill export).
4. Business dashboard renders: revenue, expenses, net cash flow, top
   customers, top suppliers, recurring expenses — a different layout from
   the consumer dashboard, not a relabeled copy of it.

### J6 — Monthly reporting for a lender (V1)

1. Ahead of a SACCO loan review, Brian needs a clean revenue/expense summary.
2. From Business → Reports, exports a monthly PDF/CSV covering the requested
   period.
3. Export respects his role's permissions and the organization's tenant
   boundary — Faith could generate the same export if her role allows it;
   a viewer-role user could not.

### J7 — Tenant isolation sanity check (continuous, not a one-time journey)

Every business journey is paired with an explicit negative test: a user from
Organization A must not be able to view, export, or infer any data belonging
to Organization B via URL manipulation, ID guessing, or API replay. This is
tested at Stage 12 (business features) and re-verified at every stage after
that touches auth or data access.

## What's explicitly out of scope for journeys in V1

- Any journey that assumes live M-Pesa account linking (statement upload only).
- Any journey requiring Swahili or non-KES currency.
- Any journey requiring more than one uploaded statement to be merged into a
  single unified account view (V2: multi-statement aggregation).
