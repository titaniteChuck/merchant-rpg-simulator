---
type: Toolchain
title: Tooling
description: Pipeline from the compiled build to inventory and profitability reports.
timestamp: 2026-11-23
---

# Tooling

[Root](../index.md) > [Tooling](./index.md) > Tooling

The deliverable is the GitHub Pages site; everything is TypeScript on Node 24 (`cd web && npm ci`), plus Java 11 for
the decompiler. No command-line tools are shipped: the commands below build and check the site locally.

## Table of contents

- [Rerun everything](#rerun-everything)
- [Design choices](#design-choices)
- [Code](#code)

## Rerun everything

```bash
for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
cd web && npm run export:gamedata && npm test && npm run site
```

Steps: [decompilation](./decompilation/decompilation.md) > [inventory-export](./inventory-export/inventory-export.md)
> [profit-calculator](./profit-calculator/profit-calculator.md).
Fights: [combat-simulator](./combat-simulator/combat-simulator.md) (battle page).

## Design choices

- **All TypeScript.** The data files are plain literal tables, so a small evaluator (`luadata.ts`) is enough.
  The combat code (classes, 223 skill functions) is ported to `web/src/sim/` and checked against the game's own Lua
  output, recorded once and frozen (`npm test` runs the comparison when the local fixtures exist).
- **Python tools removed (2026-11-23).** They were the first implementation (Lua run through `lupa`). The TypeScript
  port reproduced their outputs byte for byte (reports, CSVs, JSON, save report) before they were deleted, and the
  game gets no more updates, so nothing needs the Lua runtime any more.
- **Website only.** After the port, the TypeScript command lines (combat, profit, savegame, inventory export) were
  dropped too: the site is the only product, and local runs are for validation (`npm test`, `npm run site`).
- **Game formulas reimplemented**, each tagged with its source function. Ported code keeps the Lua names.
- **Generated folders** (`decompiled/`, `inventory/`, `reports/`, `saves/`) are never edited by hand.
- **Game save files are read-only**: they are copied to `saves/snapshot/` and only the copy is parsed.

## Code

- `tools/README.md`: command reference.
- `web/src/tools/`: `luadata.ts` + `export-gamedata.ts` (game data), `gamedata.ts`, `profit.ts`, `enchant.ts` (profit model).
- `web/src/tools/combat.ts`, `engine.ts` and `web/src/sim/` (combat).
- `web/src/tools/save.ts`: decodes the player's save in the browser, see [save-loader](./save-loader/save-loader.md).
- `site/`, `.github/workflows/pages.yml`: website, see [website](./website/website.md).
