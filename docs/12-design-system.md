# Design System (Stage 3)

## Scope

Targets `apps/web` and `apps/admin` — the two surfaces that exist in the
MVP/V1 web-only plan (see [01-prd.md](01-prd.md)). `apps/mobile` is
deliberately out of scope here: React Native can't consume DOM components or
CSS Modules, and mobile UI work doesn't start until Stage 14. What mobile
*can* reuse today is `packages/ui/src/tokens.ts` — the plain-JS-object half of
the token system — once real native screens are built.

## Visual language

Not a copy of M-Pesa/Safaricom's green branding — this is a third-party
analytics product, not an extension of Safaricom's brand, and shouldn't read
as one. Palette is an independent indigo/slate system common in fintech
(Mercury, Ramp-style): trustworthy without borrowing someone else's identity.

- **Brand**: indigo (`primary.600` `#4F46E5`)
- **Neutrals**: slate scale, `neutral.50` background through `neutral.900` text
- **Semantic**: success/danger/warning/info, used for system feedback (form
  errors, processing status)
- **Money-specific, separate from semantic**: `money.positive` (green, for
  received/credit), `money.neutral` (slate, for ordinary spending —
  spending is not "bad"), `money.negative` (red, reserved for genuinely
  negative net movement or a flagged anomaly). See
  [01-prd.md](01-prd.md) §Design for trust and
  [06-statement-processing-architecture.md](06-statement-processing-architecture.md)
  §Accounting distinction — this separation exists specifically so the UI
  never colors an ordinary M-Pesa withdrawal the same alarming red as an
  actual problem.
- **Typography**: Inter, loaded via `next/font/google` (self-hosted at build
  time by Next.js — no runtime request to Google, no CSP exception needed).

All tokens live in `packages/ui/src/tokens.ts` (plain values) and
`tokens.css` (the same values as CSS custom properties, hand-kept in sync —
there are few enough of them that a generation step isn't worth it yet).

## Components shipped at Stage 3

`Button`, `Input`, `Card`, `Badge`, `Alert`, `Spinner`, `Skeleton`,
`EmptyState`, `Table` (a scrollable wrapper, not a data-grid — no real
transaction/revenue shape exists yet to build column configs around),
`Dialog` (built on the native `<dialog>` element for its built-in focus trap
and Escape handling), `AppShell` (structural top-nav layout only — real nav
items are wired in at Stage 4/12), and `ProcessingSteps` (the statement
pipeline stepper — built now because [09](09-testing-deployment-strategy.md)'s
"progress must reflect real pipeline stages" rule means the component's shape
needs to exist before Stage 5 wires it to a real job).

**Not built yet, on purpose**: charts (no real analytics data to visualize —
building empty chart shells now would violate "every visualization must
answer a question", [01-prd.md](01-prd.md) §Charts) and a full data-grid
(same reasoning as `Table` above).

## Why `packages/ui` ships raw source, unlike the other shared packages

`packages/types`, `financial`, `validation`, and `config` compile to `dist/`
because `apps/api` runs as plain compiled Node — it has no bundler to hand
raw TypeScript to. `packages/ui` is different: it's CSS-Modules-heavy and only
ever consumed by Next.js apps, which already have to run every component
through their own pipeline (for JSX, CSS Modules, etc.) regardless. So its
`package.json` `main`/`types` point straight at `src/index.ts`, and every
consuming app declares `transpilePackages: ["@mpesa/ui"]` in `next.config.mjs`
— the standard Turborepo pattern for a source-level design-system package.
One consequence: `packages/ui` is not (and shouldn't be) imported from
`apps/api` or any other non-bundled, non-browser context.

## Verifying changes to this package

```bash
npm run dev --workspace=@mpesa/web
# then open http://localhost:3000/style-guide
```

`apps/web/app/style-guide/page.tsx` renders every token and component
together — it's a living reference, not a product screen, and isn't linked
from product navigation. Check it after any token or component change before
considering the change done.
