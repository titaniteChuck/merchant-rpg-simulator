---
type: Toolchain
title: Tooling
description: Pipeline from the compiled build to inventory and profitability reports.
timestamp: 2026-11-23
---

# Tooling

[Root](../index.md) > [Tooling](./index.md) > Tooling

Python 3 (standard library only; `lupa` for combat) plus Java 11 for the decompiler. Run everything from the project root.

## Table of contents

- [Rerun everything](#rerun-everything)
- [Design choices](#design-choices)
- [Code](#code)

## Rerun everything

```bash
for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
python3 tools/export_inventory.py
python3 tools/profit.py
```

Steps: [decompilation](./decompilation/decompilation.md) > [inventory-export](./inventory-export/inventory-export.md)
> [profit-calculator](./profit-calculator/profit-calculator.md).
Fights: [combat-simulator](./combat-simulator/combat-simulator.md) (needs `tools/_vendor/lupa`, installed with
`python3 -m pip install --target tools/_vendor lupa==2.2`).

## Design choices

- **Python parser for data, real Lua for combat.** The data files are plain literal tables, so a small evaluator is
  enough. Combat logic (224 skill functions) runs as the game's own Lua via `lupa` instead of being ported.
- **Game formulas reimplemented in Python**, each tagged with its source function. When the game changes,
  check those functions in `decompiled/` again.
- **Generated folders** (`decompiled/`, `inventory/`, `reports/`, `saves/`) are never edited by hand.
- **Game save files are read-only**: they are copied to `saves/snapshot/` and only the copy is parsed.

## Code

- `tools/README.md`: command reference.
- `tools/luadata.py`, `tools/gamedata.py`, `tools/export_inventory.py`, `tools/profit.py`, `tools/enchant.py`.
- `tools/combat.py`, `tools/sim/` (combat), `tools/savegame.py` (save files).
- `tools/savegame.py`: reads the player's save, see [save-loader](./save-loader/save-loader.md).
- `site/`, `.github/workflows/pages.yml`: website, see [website](./website/website.md).
