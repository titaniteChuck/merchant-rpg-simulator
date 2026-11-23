# Development reference

The project ships one thing: the GitHub Pages site (`site/` + the TypeScript in `web/`). There are no
command-line tools to install or share; the commands below are for developing and checking the site locally.
Node 24, from `web/` (`npm ci` once).

| Command | What it does |
|---|---|
| `npm run site` | Builds the site into `_site/` (pages, `data/gamedata.json`, bundled `js/`); preview with `npx --yes serve _site` |
| `npm test` | Unit tests, and the engine's Lua parity tests when the local fixtures (`web/test/fixtures/`) exist |
| `npm run test:update-snapshots` | Rewrites the regression snapshots (`web/test/snapshots/`) from the current code; review the diff before committing |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run difftest`, `difftest:maps`, `difftest:items` | The Lua parity checks one by one, with details on the first divergence |
| `npm run export:gamedata` | Rebuilds `inventory/gamedata.json` (the site's game data) from `decompiled/` |
| `node scripts/check-site.ts` | Site regression sweep (local only, needs Chrome; run `npm run site` first): see below |

Code: `web/src/sim/` (combat engine, a port of the game's Lua, see `PORTING.md`), `web/src/tools/` (libraries the
pages use: save decoding, combat searches, profit model, game-data export), `web/src/ui/` (page scripts).

This folder only keeps the decompiler, `unluac.jar` (local, not committed). The Python tools and the TypeScript
command lines that replaced them were removed on 2026-11-23; see `docs/tooling/tooling.md`.

## Re-decompile and re-export

Only needed to change what `gamedata.json` contains (the game itself gets no more updates):

```bash
for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
cd web && npm run export:gamedata
```

`inventory/inventory.json` and `inventory/*.csv` are frozen reference tables from the former exporter; the site
doesn't use them.

## Site regression sweep

`web/scripts/check-site.ts` opens every page (and the hero, enemy and class pages) at 1280 and 375 px, light and
dark, with and without a save loaded, and fails on console errors, uncaught errors, failed requests (404s) or a page
wider than the viewport. Not in CI: it needs a browser.

```bash
cd web && npm run site && node scripts/check-site.ts
```

- Options: `--only battle,wiki` (keys: index, save, hero, battle, profit, farming, levelling, wiki, enemy,
  class-page, balance), `--jobs 3` (browsers at a time; from about 5, Windows Chrome launches start failing), `--settle 8000` (ms each page gets before the report),
  `--save path/to/PlayerData.txt` (default `saves/snapshot/PlayerData.txt`; without a save the "with save" runs are
  skipped).
- Browser: `$CHROME`, else Chrome or Chromium on `PATH`, else Windows Chrome from WSL (its leftover processes are
  stopped with PowerShell). The Playwright Chromium in `~/.cache/ms-playwright` needs system libraries (libgbm) that
  a bare WSL doesn't have.
- 88 runs take about 15 minutes with 3 jobs. Exit code 1 when a run fails; each failure lists its errors, 404s and
  the elements wider than the page.

