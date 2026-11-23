---
type: Tool
title: Save loader
description: Finds the player's Merchant save on the current OS, copies it locally and parses the copy.
timestamp: 2026-11-23
---

# Save loader

[Root](../../index.md) > [Tooling](../index.md) > [Save Loader](./index.md) > Save loader

## Table of contents

- [Rule: never touch the game files](#rule-never-touch-the-game-files)
- [Location](#location)
- [Files](#files)
- [Encoding](#encoding)
- [Compact items](#compact-items)
- [Usage](#usage)
- [Exported tables](#exported-tables)

## Rule: never touch the game files

- The game files are only ever opened read-only, to copy them into `saves/snapshot/` (regenerated on every run).
- Parsing always runs on that copy.
- Steam Cloud syncs the folder (`steam_autocloud.vdf`), so an edit there could also reach the cloud copy.

## Location

Solar2D `system.DocumentsDirectory`, company `Retora`, app `Merchant`, Steam app `346750` (`config.lua`).

| OS (`detect_os()`) | Folders searched |
|---|---|
| any | `$MERCHANT_SAVE_DIR` first |
| windows | `%APPDATA%\Retora\Merchant\Documents` |
| wsl | `/mnt/*/Users/*/AppData/Roaming/Retora/Merchant/Documents` |
| linux, wsl | `<steam library>/steamapps/compatdata/346750/pfx/drive_c/users/steamuser/AppData/Roaming/Retora/Merchant/Documents` (libraries read from `libraryfolders.vdf`) |
| macos | `~/Library/Application Support/Merchant/Documents` and a few variants (not checked on a real Mac) |

- If several folders hold a save, the one with the newest slot file wins.
- `--save-dir DIR` / `--save FILE` override the search.
- `%LOCALAPPDATA%\Retora\Merchant` only holds caches, not saves.

## Files

- `PlayerData.txt`, `Slot2Data.txt` .. `Slot5Data.txt`: slots 1-5 (`saveSlotsHelper.saveFileNames`).
- `ScribeExpData.txt`: Scribe expansion slot.
- `<slot>Backup1..4.txt`: written at most once every 24 h, numbers rotate 1 to 4 (`GameObject:saveGame`).
- `UserInfo.usr`: plain JSON (settings, achievements, `backupSave`, `sfn` = active slot); `purchaseList` and `moreInfo` are encoded inside.
- `camp_*.clog2`, `quest_*.clog2`: combat logs in plain JSON (not parsed).

## Encoding

- Slot file = `baseEncode(json.encode(save))` (`Utilities.lua`).
- `baseEncode` is standard base64 with the alphabet
  `ABva12+rsKghixL6EueCl78fV5OPQmnopzTUyWXYZwb/RHIJqcdD0FG9MN34Sjkt`, so decoding means translating to the
  standard alphabet and running `b64decode`.
- Mobile builds may store raw JSON; `decode_save_text` accepts both.
- Top-level keys come from `GameObject:createSaveObject`: `gold`, `inventory`, `mapInventory`, `sales`, `hero`,
  `crafter`, `currentQuest`, `ccs` (campaigns), `qAmounts`, `dailyOrders`, `customer`, totals, `version`.

## Compact items

`obj.ItemCompact`: fields separated by `|`, item id in hex, type `1` material, `2` consumable, `3` equipment, `4` map.

| Type | Fields |
|---|---|
| material | type, id, amount, grade |
| consumable | type, id, amount, grade, prestigeLevel |
| map | type, id, seed, grade, prefix, suffix, enchantAttempt `A.B.C.`, prestigeLevel |
| equipment | type, id, grade, itemSlot, prefix, suffix, stats `A..D`, bonuses (letter = index in `equipBonusStat`), enchantAttempt, prestigeLevel |

- A stack's grade is either a number or a split by grade letter (`B93A100` = 93 B + 100 A; D=1 .. S=5).
- Sale slots add a tail `S<price>B<sellTime>C<startTime>`.
- Hero `attackList` / `skillSet[].attackList`: indices into `heroList[class].skillList`, `0` = Basic.
- `crafter[n].isCrafting` = `type|id|grade|amount|startTime|craftTime|prestigeLevel|suffixBoost|prefixBoost`.

## Usage

```bash
python3 tools/savegame.py --list                 # OS, candidate folders, slots found
python3 tools/savegame.py                        # slot 1: summary, crafters, heroes, maps, inventory
python3 tools/savegame.py --show maps --show inventory   # only some sections (summary crafters heroes gear maps inventory)
python3 tools/savegame.py --export               # also write saves/*.csv (see below)
python3 tools/savegame.py --slot PlayerDataBackup2 --json /tmp/save.json
python3 tools/profit.py --from-save              # crafter/Enchanter levels from the save + 'owned' column
```

- In Python: `load_save()` returns a `Save` object (`raw`, `inventory`, `map_inventory`, `sales`, `heroes`, `crafters`, `info`, `owned()`).
- `profit.py --from-save` sets `--crafter-level` to the lowest level among crafters 1-6 and
  `--enchanter-level` to crafter 7's level, unless those flags are given.
  The `owned` column counts inventory, maps, sale slots and hero gear per (item, asc).

## Exported tables

`--export [DIR]` (default `saves/`; refuses the game folder):

| File | One row per | Main columns |
|---|---|---|
| `inventory.csv` | inventory stack, then counter item | where, slot, name (with modifiers), subtype, item_level, asc, grade (split per letter), amount, unit_sell, total_sell, sale_price |
| `maps.csv` | owned map | name, item_level, asc, grade, prefix/suffix, essence per run, boss, enemies, base_time_min, enchant_attempts, seed |
| `heroes.csv` | hero | class, level, asc, quests, deaths, status (campaign/quest/idle), active passive and attacks, gear_min_ilvl, gear_mods |
| `hero_gear.csv` | equipped item | hero, slot, item columns, stored stats (atk..crit, def/mdef, bonuses) |

- `unit_sell` = `Game.sell_value` (base customer price, rarity bumped by each modifier, ×2·asc).
- Map essence per run = `profit.map_essence` at the map's own grade with its prefix/suffix multipliers.
- Python: `inventory_rows`, `map_rows`, `hero_rows`, `hero_gear_rows`, `export_csv`.
