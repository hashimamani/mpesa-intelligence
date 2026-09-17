# Local Development

## Prerequisites

- Node.js 20+ (this repo uses npm workspaces, not pnpm — see note below)
- Docker (for local Postgres, Redis, and a MinIO stand-in for S3)
- Xcode + iOS Simulator / Android Studio, only once you're working on
  `apps/mobile` specifically

## Quick start

```bash
./scripts/bootstrap.sh
```

This copies `.env.example` to `.env`, installs all workspace dependencies,
starts local services via Docker, and builds the shared packages. It's
idempotent — safe to re-run.

## Manual steps (what the script does)

```bash
cp .env.example .env
npm install
npm run dev:services        # docker-compose up: postgres, redis, minio
npm run build                # builds packages/* (apps depend on their dist output)
```

Then, in separate terminals:

```bash
npm run dev --workspace=@mpesa/api      # http://localhost:4000
npm run dev --workspace=@mpesa/web      # http://localhost:3000
npm run dev --workspace=@mpesa/admin    # http://localhost:3001
npm run dev --workspace=@mpesa/mobile   # Expo dev server
```

Verify the API is actually talking to Postgres and Redis (not just that the
process started):

```bash
curl http://localhost:4000/health
```

## Why npm workspaces instead of pnpm

[docs/03-architecture.md](03-architecture.md) originally proposed pnpm +
Turborepo. The pnpm version available in this environment requires Node
22.13+, and this environment runs Node 20. npm workspaces + Turborepo give
the same monorepo shape (shared `packages/*` consumed by `apps/*`) without
that constraint. This is flagged as decision D-7 in
[10-risks-and-decisions.md](10-risks-and-decisions.md) — low-risk and
reversible; switch to pnpm later if the team's tooling prefers it once
everyone's on Node 22+.

## Monorepo mechanics

`packages/*` are TypeScript source compiled to `dist/` (`npm run build`
per package, or `turbo run build` for the whole graph in dependency order).
Apps import the built `dist/` output — the same way they'd import any other
npm package — rather than importing raw `.ts` source across package
boundaries. If you change a package and don't see the change in an app,
rebuild the package first.

## Running tests

```bash
npm run test        # turbo run test across every workspace that defines one
```

Only `packages/financial` has real tests so far (Stage 2) — money arithmetic,
because a bug there is a wrong number shown to a user about their own money.
Test coverage grows with each subsequent stage per
[09-testing-deployment-strategy.md](09-testing-deployment-strategy.md).

## Common issues

- **`npm run dev --workspace=@mpesa/api` fails with a config error** — check
  `.env` exists and matches `.env.example`'s keys; `packages/config` fails
  startup loudly (by design) rather than falling back to defaults for
  anything security-sensitive.
- **Postgres/Redis connection refused** — `npm run dev:services` needs Docker
  running; `docker compose ps` to check container health.
- **Postgres health check says "unreachable" even though the container is
  healthy** — you likely have a native Postgres already listening on
  `localhost:5432` (check with `lsof -nP -iTCP:5432 -sTCP:LISTEN`); on macOS
  it silently wins over Docker's loopback binding for the same port. This is
  why the compose file publishes Postgres on host port **5433**, not 5432 —
  don't "fix" `DATABASE_URL` back to 5432.
- **Mobile app dependency install is slow** — Expo/React Native pull in large
  native-module packages; this is normal on first install.
