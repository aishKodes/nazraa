#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PLATFORM_DIR"
if [[ "${1:-}" != "--verify-only" ]]; then
  echo "Refusing obsolete Vercel deployment: Nazraa production runs on the existing Hostinger VPS." >&2
  echo "Use --verify-only for local release checks; deploy using the documented VPS backup/rollback workflow." >&2
  exit 2
fi
npm run typecheck
npm run lint
npm run build
echo "Local verification completed. No production deployment or migration was performed."
