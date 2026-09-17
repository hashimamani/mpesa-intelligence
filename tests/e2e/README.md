# End-to-end tests

Full user journeys from [docs/02-user-journeys.md](../../docs/02-user-journeys.md)
(register → login → upload → processing → dashboard; business: create org →
invite → upload → analytics → export → verify tenant isolation), run against
a real staging-like environment via Playwright.

Not yet implemented — there's no auth or upload flow to test against until
Stage 4/5. Scaffolded here as a placeholder so the directory structure from
[docs/03-architecture.md](../../docs/03-architecture.md) exists from day one.
