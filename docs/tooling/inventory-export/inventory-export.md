---
type: Tool
title: Inventory export
description: Parses data.*.lua and writes inventory/ (game data, wiki text, frozen CSVs) and the game translations (inventory/i18n).
timestamp: 2026-11-23
---

# Inventory export

[Root](../../index.md) > [Tooling](../index.md) > [Inventory Export](./index.md) > Inventory export

## Table of contents

- [Parser](#parser)
- [Game model](#game-model)
- [Output files](#output-files)
- [Translations](#translations)
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

## Translations

`npm run export:i18n` (`web/src/tools/export-i18n.ts`, E19) writes `inventory/i18n/<lc>.json` and `index.json`,
committed like `wikidata.json` (game text, no assets).

- Source: the local game install, `Resources/Localization/<LC>/TextData-<LC>.json` (`--src`, default the Steam path
  under `/mnt/c`). Languages: EN FR DE ES BR RU IT PL. CN, JP, KO ship only `Flag.png`; `EScom` is ignored.
- Game lookup (`obj.common.localizationService`): `getItemText(key, id, type)` for `Equipment`, `Materials`,
  `Consumables`, `Maps` by item id (missing id → `itemData` English name); `getTextByKey(table, index, key)` for
  `Quests`, `Heroes`, `Prefixes` by id, `skills` by English skill name (abilities and passives), `crafterNames` by
  English crafter name. `regionText` is a JSON array: region r is element r − 1. Suffixes have no table.
- Kept: names and descriptions only. UI, tutorial, menu, combat log, orders, game modes and stat labels are dropped.
- Cleaning: BOM dropped, `\ddd` byte escapes decoded as UTF-8 (none in the current files), NFC, trimmed.
  `desc1` + `desc2` joined by one space (as the wiki's `itemText`). Empty values left out.
- Format (`{lang, items:{equipment|material|consumable|map:{id:{n,d}}}, skills:{englishName:{n,d}},
  quests:{id:{n,nb,t,tb}}, classes:{id:{n,d}}, prefixes:{id:{n}}, crafters:{crafterId:{n}}, regions:{1-6:{n}}}`):
  `n` name, `d` description, `nb` rare name, `t`/`tb` title (normal/rare). Placeholders such as `{hp}` are kept.
- `index.json`: per language `code`, `game` code, `name` (game's `knownLanguages`), `native` (the game has none;
  set in the exporter), `bcp47`, `file`, `coverage` (% of English fields present), `translated` (% that differ
  from English) and `missing` fields. All 8 languages are 100% covered; anything missing falls back to English.
- Sizes: 69 KB (en) to 105 KB (ru) per language, index 5 KB.
- Runtime: `web/src/tools/i18n.ts` (pure, browser-safe): `loadLanguage(json)`, `setLanguage(code)`,
  `currentLanguage()`, `tr(kind, id, field = "n")` → string or `undefined` (caller keeps its English). Not wired
  into the UI yet.
- Findings: placeholder items and quests (77 equipment, 12 materials, 8 consumables, quests 39–41, 58–60, 75, 76) have
  no text. 6 English skill texts differ from `abilityData.desc` (Absorb Atk/Matk, Demon Slash, Disharmony, Siphon
  Soul, Sunder); the game shows the TextData one. Quest nicknames and titles are often left in English (FR 71%
  translated), stat labels are translated in Russian only.

## Verification

- Counts match a `grep` of the raw files: 780 equipment, 278 materials, 69 consumables, 32 maps, 104 quests.
- Skipped statements in the economy files are all functions or code, not data.
- `data.EventData`, `data.DefaultHeroes`, `data.WeeklyItemsData` need function calls; not parsed yet.
