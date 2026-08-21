#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PLATFORM_DIR"
npm run typecheck
npm run lint
npm run build
echo "Deploying the verified Control Platform build..."
echo "Vercel will apply pending migrations using its protected production environment."
npx vercel deploy --prod --yes
