# AI Architecture

## Core rule: the AI interprets, it never calculates

```
Raw transaction → normalized transaction → deterministic analytics calculation → displayed number
```

The AI receives the output of that chain as verified input; it is never the
source of a monetary figure. Every insight the AI produces must reference
numbers that already exist in the analytics engine's output — if it states a
figure that doesn't match a verified metric, the insight is rejected before
it ever reaches a user (see §Output validation).

## Where AI is used

- Turning structured analytics deltas into a plain-language insight
  ("Food spending increased ~36%, mainly driven by restaurants").
- Classifying transactions only after deterministic rules, merchant lookup,
  and per-owner history have all failed to resolve a category (categorization
  layer 4 — see [06-statement-processing-architecture.md](06-statement-processing-architecture.md)).
- Premium financial-coach recommendations, grounded in the same verified
  spending data as insights.

## Where AI is explicitly not used

- Never computes totals, category sums, trends, or any monetary figure —
  that's exclusively the deterministic analytics engine.
- Never receives a raw, full statement document. It receives aggregated,
  structured metrics (category name, current period total, previous period
  total, percent change, top contributing merchants) — not line-by-line raw
  transaction text, and not personal identifiers beyond what's needed for the
  insight to make sense (e.g. "Restaurant" as a category, not the counterpart's
  phone number).

## Input/output contract

**Input example** (what the AI actually receives):
```json
{
  "category": "Food",
  "current_period": {"total": 42000, "start": "2026-08-01", "end": "2026-08-31"},
  "previous_period": {"total": 31000, "start": "2026-07-01", "end": "2026-07-31"},
  "change_pct": 35.5,
  "top_contributors": [
    {"merchant": "Restaurant", "total": 14500},
    {"merchant": "Groceries", "total": 27500}
  ]
}
```

**Output contract** (structured, not free prose only):
```json
{
  "type": "trend",
  "severity": "medium",
  "metric": "food_spending",
  "claim": "Food spending increased by about 36% compared with the previous period, mainly driven by restaurant spending.",
  "supporting_metrics": ["current_period.total", "previous_period.total", "top_contributors[0]"],
  "confidence": 0.91
}
```

## Output validation (before an insight is ever persisted or shown)

1. Parse the AI's response as the declared JSON schema; reject anything that
   doesn't conform (no silent best-effort parsing of malformed output).
2. Every numeric claim embedded in `claim` text is cross-checked against the
   `supporting_metrics` values that were actually sent as input — if the AI's
   prose states a figure that isn't traceable to an input value, the insight
   is rejected, not "corrected" by the system guessing what was meant.
3. Insights below a minimum confidence threshold are discarded rather than shown.
4. Rejected/failed generations are logged (for prompt/model tuning) but never
   surfaced to the user as a degraded insight.

## Prompt injection defense

Statement-derived text (transaction descriptions, merchant names) is
untrusted input. The system prompt, the verified analytics payload, and any
document-derived string are kept in strictly separate, clearly delimited
channels — document-derived text is only ever passed as quoted data within a
data field, never concatenated into an instruction context, and the model is
explicitly instructed that content appearing in data fields is not a command.
If a transaction description contains something like "ignore previous
instructions," it is treated as the literal text of a transaction
description — because it's never in a position to be interpreted as an
instruction in the first place. This is enforced structurally (separate
fields sent to the model, e.g. via a strict system/developer message plus a
JSON user payload), not by asking the model nicely.

## Provider abstraction

A single internal `AiInsightProvider` interface (prompt versioning, model
selection, fallback model, timeout, retry, structured-output parsing, cost/
token tracking, request tracing) sits between the insight-generation worker
and any specific vendor SDK. No application code calls a vendor SDK directly.
This keeps the system able to switch or add providers without touching
business logic, and makes cost/latency/failure monitoring uniform regardless
of provider.

## Cost control

- Deterministic analytics run first, always. AI is invoked only where
  interpretation adds value (turning a delta into language), never to derive
  the delta itself.
- Generated insights are cached (keyed on the input metrics + prompt
  version); the same underlying numbers don't regenerate the same insight
  twice.
- Every AI call is tracked for tokens, latency, cost, and failure rate, with
  per-user and system-wide budgets alertable in CloudWatch (implementation
  detail for Stage 10, not built yet).

## Data minimization for AI calls

Aggregated analytics and category/merchant labels only. No raw phone
numbers, no full transaction descriptions, no full statement content sent to
any AI provider, ever — matches the data minimization principles in
[05-security-threat-model.md](05-security-threat-model.md).
