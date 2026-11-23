#!/usr/bin/env bash
# Build the website into $1 (default: _site at the repo root): static pages from
# site/, game data, Python tools and the bundled TypeScript pages.
# Used by .github/workflows/pages.yml; run locally to preview:
#   web/scripts/assemble-site.sh && python3 -m http.server -d _site 8000
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(realpath -m "${1:-$ROOT/_site}")"
rm -rf "$OUT"
mkdir -p "$OUT/data" "$OUT/py" "$OUT/js"
cp -r "$ROOT/site/." "$OUT/"
cp "$ROOT/inventory/inventory.json" "$ROOT/inventory/gamedata.json" "$OUT/data/"
cp "$ROOT/tools/"*.py "$OUT/py/"
cd "$ROOT/web"
npx esbuild src/ui/save-viewer.ts --bundle --format=esm --target=es2020 --minify --sourcemap --outdir="$OUT/js"
