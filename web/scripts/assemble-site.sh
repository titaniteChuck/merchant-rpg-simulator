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
cp "$ROOT/inventory/gamedata.json" "$ROOT/inventory/wikidata.json" "$ROOT/inventory/timelines.json" "$ROOT/inventory/warmstart.json" "$OUT/data/"
# U29: game-name translations, one file per language (loaded only for a language other than English) and the list.
mkdir -p "$OUT/data/i18n"
cp "$ROOT"/inventory/i18n/*.json "$OUT/data/i18n/"
cd "$ROOT/web"
# nav.ts: the menus of every page (U35). node:* = CLI-only code paths (profit.ts main) that never run in a page.
# Review F14: no code splitting (shared chunks made every first visit 30-90 % bigger: a chunk carries what any page
# uses from its modules). Each tool page's bundle imports nav.ts itself, so nav and the page share one copy of dom,
# names, language, tooltip and the Save menu, and the page loads no separate js/nav.js. js/nav.js stays for Home
# (menus only) and Balance. The workers are self-contained module workers.
# Review F21: no source maps in the published site (about 10 MB nobody downloads); SOURCEMAP=1 adds them for local
# debugging.
MAPS=()
if [[ "${SOURCEMAP:-}" == 1 ]]; then MAPS=(--sourcemap); fi
npx esbuild src/ui/nav.ts src/ui/save-viewer.ts src/ui/battle.ts src/ui/solver.ts src/ui/battle-worker.ts src/ui/wiki.ts src/ui/profit.ts src/ui/profit-worker.ts src/ui/farming.ts src/ui/farming-worker.ts src/ui/levelling.ts src/ui/levelling-worker.ts src/ui/class-balance.ts src/ui/class-balance-worker.ts \
  --bundle --format=esm --target=es2020 --platform=browser --external:'node:*' --minify ${MAPS[@]+"${MAPS[@]}"} --outdir="$OUT/js"
# P2 (F16): the profit page's answer for its default settings, so a first visit solves nothing in the browser
# (review F12: stored by column, profit-compact.ts).
node src/tools/export-profit-default.ts "$OUT/data/profit-default.json"
