#!/usr/bin/env bash
# Build the website into $1 (default: _site at the repo root): static pages from
# site/, game data and the bundled TypeScript pages.
# Used by .github/workflows/pages.yml; run locally to preview:
#   web/scripts/assemble-site.sh && npx --yes serve _site
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(realpath -m "${1:-$ROOT/_site}")"
rm -rf "$OUT"
mkdir -p "$OUT/data" "$OUT/js"
cp -r "$ROOT/site/." "$OUT/"
cp "$ROOT/inventory/gamedata.json" "$ROOT/inventory/wikidata.json" "$OUT/data/"
cd "$ROOT/web"
# node:* = CLI-only code paths (profit.ts main) that never run in a page.
npx esbuild src/ui/save-viewer.ts src/ui/battle.ts src/ui/battle-worker.ts src/ui/wiki.ts src/ui/profit.ts src/ui/profit-worker.ts \
  --bundle --format=esm --target=es2020 --platform=browser --external:'node:*' --minify --sourcemap --outdir="$OUT/js"
