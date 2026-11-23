---
type: Tool
title: Website
description: GitHub Pages site that exposes the tools in the browser, and the public-repo rules behind it.
timestamp: 2026-11-23
---

# Website

[Root](../../index.md) > [Tooling](../index.md) > [Website](./index.md) > Website

## Table of contents

- [Public repo rules](#public-repo-rules)
- [Deployment](#deployment)
- [Save viewer](#save-viewer)
- [Battle simulator](#battle-simulator)
- [What can run in the browser](#what-can-run-in-the-browser)
- [Battle simulation in the browser](#battle-simulation-in-the-browser)
- [TypeScript combat engine](#typescript-combat-engine)
- [Roadmap](#roadmap)

## Public repo rules

- Repo: `git@github.com:titaniteChuck/merchant-rpg-simulator.git`, branch `main`.
- Never committed (`.gitignore`): game bytecode `merchant/`, `decompiled/`, every `*.lu`/`*.lua` except
  `tools/sim/harness.lua` (our own), `saves/` (personal), `reports/` (generated), `tools/unluac.jar`, `tools/_vendor/`.
- Committed: `tools/`, `inventory/` (exported data, the website's data source), `docs/`, `site/`.

## Deployment

```mermaid
flowchart LR
  A[site/] --> D[_site/]
  B[inventory/inventory.json] -->|data/| D
  C[tools/*.py] -->|py/| D
  W[web/src/ui/*.ts] -->|esbuild| D
  D -->|.github/workflows/pages.yml| E[GitHub Pages]
```

- Runs on push to `main` touching `site/`, `tools/`, `inventory/`, `web/` or the workflow, or by hand.
- `web/scripts/assemble-site.sh [out]` builds the same `_site/` locally (esbuild bundles `web/src/ui/*.ts` into `js/`).
  Preview: `python3 -m http.server -d _site 8000`.
- Repo setting needed once: Settings > Pages > Source = GitHub Actions.

## Save viewer

`site/save.html` + `web/src/ui/save-viewer.ts`. The save is read in the browser, never uploaded.

- Decoding: `web/src/tools/save.ts` (port of `savegame.py` parsing).
- Tables: `web/src/ui/save-tables.ts`, same columns as `savegame.py --export`; checked equal to the Python CSVs on a real
  save (inventory 167, maps 5, heroes 17, gear 102 rows).
- Hero combat stats: built with the TypeScript engine (`api.newHero` + `heroStats`).
- Sections: summary tiles, heroes (stats, rotation, passive, gear), inventory (filter, sort, base value), maps, crafters;
  CSV download per table.
- Not shown yet: essence per map run (needs `profit.ts`).

## Battle simulator

`site/battle.html` + `web/src/ui/battle.ts` (page) + `web/src/ui/battle-worker.ts` (web worker).

- Party: six slots (front/back × 3) filled from the save's heroes; per hero, an optional rotation and passive editor
  with the AP budget (`api.skillInfo`). Over budget, the game falls back to the default rotation: shown as a warning.
- Opponent: a quest enemy (rare variant, 1-4 enemies) or a map run (owned map from the save, or any catalog map
  with ascension 0/1 and grade, up to 3 scrolls).
- The worker runs `evaluate` / `evaluateMap` from `web/src/tools/combat.ts` with seeds 1..n, like the CLI, so the page
  gives the same numbers as `npm run combat` (checked: quest 80, 200 fights; map 22, 20 runs).
- Results: win rate, turns, grade, enemy HP removed, party HP left; for maps progress, time, loot value, essence,
  where runs are lost, scroll charges; per hero damage, taken, healing, death rate, damage by skill.
- Bundles: `js/battle.js` (page, ~100 KB) and `js/battle-worker.js` (~115 KB); `node:*` imports (CLI-only code paths)
  are external.
- Not yet: skill, gear and party search (`cmdSkills`, `cmdGear`, `cmdParty` exist in `web/src/tools/combat.ts`).

## What can run in the browser

| Tool | Browser? | Why |
|---|---|---|
| Save decoding (`savegame.py`) | Yes | Ported to `web/src/tools/save.ts`; used by `save.html`. File stays local. |
| Item names, recipes, sell values | Yes | `data/inventory.json`. |
| Profit calculator (`profit.py`) | Needs work | `gamedata.load_game()` reads `decompiled/`; needs a loader from `inventory.json`. |
| Combat engine (fights, map runs) | Yes | Ported to TypeScript in `web/src/sim/` (see below). |

## Battle simulation in the browser

Game code the simulator runs (decompiled line counts):

| Part | Lines |
|---|---|
| Skill functions `data.AbilityFunc` (253 functions) | 2467 |
| Combat classes: Hero 616, Combatant 552, Campaign 348, Party 258, Map 228, Battle 206, Enemy 140 | 2348 |
| Item, Equipment, statsService, Utilities and `data.Default` / `data.FormulaData` parts actually used | ~600 |
| Data tables (abilities, heroes, quests, maps, gear) | export to JSON, no port |

| Option | Cost | Game files needed by the visitor | Speed | Drift on game update |
|---|---|---|---|---|
| A. Port to TypeScript | ~5.5k Lua lines, 3-5 sessions, plus a differential test against the local lupa harness | No | Fast (JS) | Re-port changed functions (diff `decompiled/`) |
| B. Lua 5.1 in WebAssembly + visitor's own game files | ~1 session (Emscripten build, loader, file picker); `harness.lua` reused | Yes (bytecode loads directly: 4-byte `size_t` matches wasm32) | ~2-3x slower than native | None |
| C. Publish the decompiled code | none | No | - | None |

- C is excluded: no game code in the public repo.
- B depends on visitors being able to supply the `.lu` files (where the PC build keeps them is not checked yet).
- A's test oracle: same seed and a shared PRNG injected in both engines, compare logs fight by fight.

## TypeScript combat engine

Option A was chosen: the game's combat rules re-written in TypeScript, `web/src/sim/` (rules: `PORTING.md`).

```mermaid
flowchart LR
  A[decompiled/*.lua] -->|harness.lua + USE_LCG| B[tools/sim/fixtures.py]
  B --> C[web/test/fixtures/*.json]
  D[web/src/sim] --> E[difftest*.ts]
  C --> E
  F[tools/export_gamedata.py] --> G[inventory/gamedata.json] --> D
```

- **Shared random generator**: Park-Miller LCG with Lua 5.1 `math.random` argument rules, in `lua.ts` and
  `harness.lua`. `USE_LCG` installs it before the game loads, so locals like `data.Default`'s `random` use it too.
- **Differential tests** (local only, need the game files): every action compared (turn, actor, skill,
  RNG draw count, all HP, effect names) plus the full result.

| Test | Result |
|---|---|
| `node test/difftest.ts` (single fights) | 3000/3000 |
| `node test/difftest-maps.ts` (full map runs, 119 with a map prefix, 102 with a suffix) | 400/400 |
| `node test/difftest-items.ts` (`makeItem` rolls) | 1949/1949 |

- **Lua quirks emulated**: `pairs()` order and `#t` with holes (`lua-table.ts`, an ltable.c emulation checked
  against 400 real tables); Lua truthiness of `0`; level-70 map nil treasure (crash or dropped rooms).
- **Final reference set** (frozen 2026-11-23, scenario seed 2): covers 189 of the 223 skill functions and all 10
  scrolls. The other 34 skill functions belong to no hero class and no quest enemy, so the game never runs them.
  Fixtures embed the player's save heroes: they stay local (`web/test/fixtures/`, git-ignored).
- **Not verified**: crafting new maps (`isNew`) and new heroes with starting gear throw "not supported"
- **Speed**: about 0.34 ms per single-hero fight in Node.
- Search/optimisation tools (port of `combat.py`, `profit.py`) live in `web/src/tools/`.

## Roadmap

1. Save viewer: done (`save.html`).
2. Profit tables from `inventory.json` (pre-computed or in Pyodide).
3. Battle simulator: done (`battle.html`). Next: skill, gear and party search on the same page.
