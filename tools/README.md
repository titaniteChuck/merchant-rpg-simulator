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
