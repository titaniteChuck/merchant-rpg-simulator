---
type: Tool
title: Inventory export
description: Parses data.*.lua into a Python game model and writes inventory/ as JSON and CSV.
timestamp: 2026-11-23
---

# Inventory export

[Root](../../index.md) > [Tooling](../index.md) > [Inventory Export](./index.md) > Inventory export

## Table of contents

- [Parser](#parser)
- [Game model](#game-model)
- [Output files](#output-files)
- [Verification](#verification)

## Parser

`web/src/tools/luadata.ts`:

- Tokenizes Lua 5.1 and evaluates assignments whose right side is a literal: numbers, strings,
  booleans, tables, simple arithmetic, names already defined.
- Skips functions, control flow and calls, and records each skip in `Env.skipped`.
- File-level `local` tables are kept in `Env.file_locals` (needed for `prestigeItemID`).
- `toPy()` turns tables keyed 1..n into lists. Values keep Python's int/float distinction and dict key order,
  so the exports are byte-identical to the former Python tools.

## Game model

The former `gamedata.py` `load_game()` (removed); the website uses `web/src/tools/gamedata.ts`, built from
`inventory/gamedata.json`:

- `items[type][id]`, `quests`, `parcels`, `crafters`, `heroes` (classes), prefixes, suffixes, grade tables.
- Helpers: `recipe()`, `sell_value()`, `essence_for_ascension()`, `prestiged_essence()`.
- Mirrors `math.round` as `floor(x + 0.5)`.

## Output files

`npm run export:gamedata` (`export-gamedata.ts`) writes `inventory/gamedata.json`, the Lua-shaped tables the engine
and the pages read. The other files below come from the former inventory exporter (removed 2026-11-23); they are kept
frozen as reference tables and are not used by the site:

| File | Rows |
|---|---|
| `inventory.json` | Everything, raw field names |
| `equipment.csv` | Value, sell value at asc 0/1/2, craft gold, recipe |
| `materials.csv` | Recipe if crafted, every quest/parcel/map that drops it |
| `consumables.csv` | Recipe, stats |
| `maps.csv` | Essence reward, enemy range, boss, recipe |
| `quests.csv` | Launch gold, time, enemy stats, drops, rare drops |
| `parcels.csv` | One row per loot-table entry with grade-3 chance |
| `crafters.csv`, `classes.csv` | Crafters and the 9 hero classes |

## Verification

- Counts match a `grep` of the raw files: 780 equipment, 278 materials, 69 consumables, 32 maps, 104 quests.
- Skipped statements in the economy files are all functions or code, not data.
- `data.EventData`, `data.DefaultHeroes`, `data.WeeklyItemsData` need function calls; not parsed yet.
