#!/usr/bin/env bash
# One-command local setup for a new developer. See docs/09-testing-deployment-strategy.md
# and the "Developer Experience" principle: clone → this script → running locally,
# no undocumented tribal knowledge required.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Creating .env from .env.example ..."
  cp .env.example .env
else
  echo ".env already exists, leaving it alone."
fi

echo "Installing dependencies ..."
npm install

echo "Starting local services (Postgres, Redis, MinIO) ..."
npm run dev:services

echo "Building workspace packages ..."
npm run build --workspace=@mpesa/types --workspace=@mpesa/financial --workspace=@mpesa/validation --workspace=@mpesa/config --workspace=@mpesa/ui

echo "Applying database migrations ..."
npm run prisma:migrate --workspace=@mpesa/api -- --name init

cat <<'EOF'

Done. Next steps:
  npm run dev --workspace=@mpesa/api    # start the API on :4000
  npm run dev --workspace=@mpesa/web    # start the web app on :3000
  npm run dev --workspace=@mpesa/admin  # start the admin app on :3001
  npm run dev --workspace=@mpesa/mobile # start Expo

Check API health once it's running:
  curl http://localhost:4000/health
EOF
