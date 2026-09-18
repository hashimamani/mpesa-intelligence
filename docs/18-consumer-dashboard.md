# Consumer Dashboard (Stage 9)

## Scope

The web-only MVP screens docs/01-prd.md lists: **consumer dashboard**
(financial snapshot, where money went, category breakdown, trend) and
**transaction list with manual category correction**. This is the first
stage that gives Stage 6/7/8's backend work an actual screen — everything
here is `apps/web`, consuming the real `/analytics`, `/transactions`, and
`/categories` endpoints with no mocked data. Explicitly not in scope: AI
insights (Stage 10), premium tiers, business dashboards, mobile apps.

## Two small backend additions this stage needed

Stage 9 surfaced two gaps that only become visible once a screen actually
needs the data:

- **`GET /categories`** — nothing previously listed the taxonomy; the
  correction picker needs to know what categories exist. Not owner-scoped
  (the taxonomy is global) — `categories/categories.service.ts`.
- **`GET /transactions?month=YYYY-MM`** — `StatementsService.listTransactions`
  is scoped to one statement, but "Transaction list with manual category
  correction" is inherently cross-statement (a user's whole month, not one
  upload). Reuses the exact same "most recent active month" default as
  analytics via a new shared `analytics/resolve-month.ts` (extracted out of
  `AnalyticsService` once `TransactionsService` needed the identical logic —
  both screens now mean the same thing by "this month" with zero
  duplication).

## Navigation: `AppShell`'s `nav` slot gets real content for the first time

`AppShell` has carried a `nav` prop since Stage 3, unused until now —
Stage 9 is the first stage with more than one real destination behind
login. `lib/nav.tsx`'s `AppNav` (Dashboard / Transactions / Upload,
active-route bolded via `usePathname()`) is shared across all three
authenticated pages rather than each page inlining its own links.

Populating `nav` for the first time exposed a real layout bug: `AppShell`'s
header was a fixed 64px single flex row, which only ever had to fit a brand
name and a side slot before. Three nav links plus an email address and a
logout button doesn't fit one row at phone width — found by actually
resizing to 375px and looking, not assumed. Fixed with a `max-width: 640px`
rule that lets the header wrap onto multiple rows instead of overlapping
the page content below it (`AppShell.module.css`).

## New design system primitives

Three new `packages/ui` components, none tied to this product's business
logic (they take plain label/value/points props):

- **`StatTile`** — one labeled figure (docs/02's financial snapshot row:
  Received/Spent/Fees/Net). Not a chart — the dataviz skill's own guidance
  is that a single headline number doesn't need one. `tone` is `"positive"`/
  `"neutral"`/`"negative"`, matching `tokens.ts`'s money-color philosophy:
  ordinary spending stays neutral, not alarming.
  - Its value font-size uses a CSS `clamp()` sized off a CSS container
    query (`container-type: inline-size` on the tile), not a fixed
    `1.75rem` — found by testing with a real 5-digit KES figure
    ("KSh 15000.00"), which silently ellipsis-truncated at the original
    fixed size. A real money figure being truncated is worse than a
    slightly smaller font, so this is a `clamp()`, not a smaller fixed value.
- **`BarList`** — a ranked, direct-labeled horizontal bar list ("biggest
  categories," "top merchants"). Deliberately skips a categorical color
  palette — docs/02's ranking is an identity+magnitude job each row's own
  label already carries, not one needing per-category hues (also sidesteps
  needing a categorical palette this design system has never defined/
  validated). One tone (`"neutral"` or `"primary"`) carries magnitude.
- **`TrendChart`** — a single-series monthly bar chart ("spending trend").
  Bar, not line: `analytics/trend`'s zero-value gap months (docs/17) are
  real discrete buckets, not points a line would have to interpolate
  across. No legend (single series — the section title names it, per the
  dataviz skill), every bar direct-labeled (at most 24 points, still
  readable without hover).
- **`Select`** — a native `<select>` styled to match `Input`, for the
  category-correction picker (grouped by top-level category via
  `<optgroup>`, passed as plain children — the caller controls its own
  group structure rather than a data-driven API). Added a `hideLabel` prop
  (visually hidden, still screen-reader-reachable) for the one-per-
  table-row case, where a visible label repeated on every row would be
  noise `Input` never needed to solve.

Also fixed a pre-existing `Table` bug this stage's wider row content (a
220px `Select` per row) exposed: `.table` was `width: 100%`, which forces
every column to squeeze into the scrollable wrapper's width instead of
ever actually triggering `overflow-x: auto` — so at phone width, columns
clipped instead of scrolling. Changed to `width: max-content; min-width:
100%` so the table can grow past its wrapper when content demands it,
which is what "a scrollable wrapper" was supposed to mean.

## The dashboard's empty state IS the empty state

Per docs/02's J1 journey ("Lands on an empty dashboard: 'Upload your
M-Pesa statement...'"), the empty-state upload prompt lives on
`/dashboard` itself now, not on `/upload` — a first-time user lands on the
exact screen that will later show their real numbers, rather than a
separate marketing-ish upload page. `/upload` still exists (statement
upload + per-statement processing progress, unchanged from Stage 5/6/7)
and is reachable from the dashboard's own "Upload your first statement"
button and the nav bar.

## Defaulting behavior matches the backend exactly

Neither the dashboard nor the transaction list defaults to the real-world
current month — both default to the most recent calendar month the owner
actually has a transaction in (`resolveMonth`, shared by `AnalyticsService`
and `TransactionsService`). Verified manually: uploading a statement dated
August 2026 while the "current" date is September 2026 still shows August's
numbers immediately on both screens, not an empty "no data this month."

## Manually verified end-to-end (real API, real Postgres/Redis/MinIO, real browser)

Registered a user, uploaded a synthetic statement (8 rows: a credit, four
Spending-category debits across four different subcategories, a P2P
transfer, and a cash withdrawal), confirmed: the dashboard's snapshot
totals matched hand-computed expected values exactly (Received 15000,
Spent 8900 — Spending-category debits only, excluding the transfer and
withdrawal — Fees 0, Net 2600 — every debit including the transfer/
withdrawal); the category breakdown and top-merchants lists matched and
were sorted correctly; the trend chart showed five zero-activity months
plus the one real month. Then corrected one transaction's category via the
transactions page's `Select` and confirmed, live, that both the
transaction row (a "corrected" badge appeared) and the dashboard's category
breakdown updated immediately — the Stage 8 live-recompute-on-correction
design actually holding up through a real click, not just an e2e test
mocking the HTTP layer.

## Known gaps, honestly

- **No month-switcher control.** Both the dashboard and transaction list
  show only the (same) default month — a user can't yet click back to a
  different past month from the UI, even though the API already supports
  `?month=YYYY-MM` for both. Not in docs/01's explicit MVP bullet list;
  flagged rather than silently added or silently skipped.
- **No pagination on the transaction list.** Fine at MVP data volumes (one
  month's transactions, typically dozens to low hundreds); would need it
  before a business account's transaction volume (Stage 12) made this
  screen unusable.
- **No mobile-native app** — this is the responsive *web* app, verified
  down to 375px viewport width, not `apps/mobile` (Stage 14, React Native,
  can't consume any of these DOM components).
- **No visible legend/alternate table view for the trend chart's screen-
  reader path** beyond a single `aria-label` summarizing all points as one
  string — meets the dataviz skill's letter for a chart this simple (few
  points, all direct-labeled) but a truly robust accessible-data-table
  toggle wasn't built.

## Verifying changes to this stage

```bash
npm run typecheck --workspace=@mpesa/ui   # new components
npm run typecheck --workspace=@mpesa/web
npm run build --workspace=@mpesa/web      # production build + Next.js's own type/lint pass
npm run test --workspace=@mpesa/api       # unaffected backend logic
npm run test:e2e --workspace=@mpesa/api   # unaffected backend logic, plus the 2 new endpoints
```

No automated frontend tests were added this stage (none existed before it
either — `apps/web` has no test runner configured yet, a gap inherited from
Stage 3/4/5, not introduced here). Verification for this stage was a real
browser session against the real running stack, described above.
