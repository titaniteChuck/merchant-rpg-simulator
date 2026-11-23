# Merchant balancing tools

All tools read the decompiled Lua in `../decompiled/` (produced by `unluac.jar` from `../merchant/*.lu`).
Those game files are local only and never committed (see the root README for setup).
Python 3 standard library only, except the combat simulator (`lupa`, see `requirements.txt`).

| Script | What it does |
|---|---|
| `luadata.py` | Parser/evaluator for the literal tables in `data.*.lua` |
| `gamedata.py` | Loads the game data; sell value, recipes, ascension essence cost |
| `export_inventory.py` | Writes `../inventory/` (JSON + CSV for equipment, materials, consumables, maps, quests, parcels, crafters, classes) |
| `profit.py` | Ranks items by sell value against full production cost; writes `../reports/` |
| `enchant.py` | Enchanter model used by `profit.py` |
| `combat.py` | Combat simulator: fights, damage per skill, solo matrix, best skills / gear / party |
| `sim/harness.lua`, `sim/engine.py` | Run the game's own decompiled combat Lua in Lua 5.1 (via `lupa`) |
| `savegame.py` | Finds the player's save (detects the OS, `--save-dir`/`--save`/`--slot`), copies it to `../saves/snapshot/`, parses the copy |

## Re-decompile after a new build

```bash
for f in merchant/*.lu; do java -jar tools/unluac.jar "$f" > "decompiled/$(basename "$f" .lu).lua"; done
python3 tools/export_inventory.py
```

## savegame.py

The game's save files are never modified: they are copied to `saves/snapshot/`, and only the copy is parsed.

```bash
python3 tools/savegame.py --list                      # detected OS, candidate folders, slots
python3 tools/savegame.py                             # slot 1 summary (auto-detected folder)
python3 tools/savegame.py --save-dir DIR --slot 2     # explicit folder (or env MERCHANT_SAVE_DIR)
python3 tools/savegame.py --save path/PlayerDataBackup1.txt --json out.json
python3 tools/savegame.py --show maps --show inventory   # sections: summary crafters heroes gear maps inventory
python3 tools/savegame.py --export                    # saves/inventory.csv, maps.csv, heroes.csv, hero_gear.csv
python3 tools/profit.py --from-save                   # crafter/Enchanter levels from the save + 'owned' column
```

## profit.py

```bash
python3 tools/profit.py                       # grade 3, cost split by value, top 25 by best strategy profit
python3 tools/profit.py --sort margin% --type equipment
python3 tools/profit.py --alloc full          # pessimistic: each farmed drop carries the whole run cost
python3 tools/profit.py --grade 4 --luck 10
python3 tools/profit.py --essence-from "Forest Essence=Hard Tuvale Map"   # force where orbs come from
python3 tools/profit.py --essence-from "Nature Essence=Tuvale Map@1"      # asc-1 map as the source
python3 tools/profit.py --hero-hour-cost 200  # charge hero time spent on quests/maps
python3 tools/profit.py --crafter-level 45    # modifier odds and craft grade for a level-45 crafter
python3 tools/profit.py --no-map-mods         # essence yield without map prefix/suffix
python3 tools/profit.py --enchanter-level 0   # no enchanting, sell items as crafted
python3 tools/profit.py --map-suffix-max 5    # enchanted maps only up to suffix +5
```

### Cost model (from the game code)

- **Quest** (`lootService`): the launch `gold` buys the expected `rewardA1/A2` drops and `rewardA3/A4`
  parcel rolls at the chosen grade (`gradeBonus`, `gradeParcelBonus`, luck). Rare variants
  (`nameB`/`goldB`/`rewardB*`) also count as sources; they're the only quest source of boss trophies.
  - `--alloc value` (default): the run cost is split between drops in proportion to their sell value.
  - `--alloc full`: each drop carries the whole run cost divided by its expected quantity.
- **Map run** (`Map`, `Campaign`, `default.mapEssenceReward`): consumes the map. It yields essence plus the
  loot of every room, the boss and the expected treasure rooms. Loot is credited at sell value (none with
  `--alloc full`), and the remaining cost is the essence cost. Normal maps give asc-1 essences, asc-1 maps
  give asc-2 essences, and there are no asc-2 maps. A drop found only in maps is priced at its sell value.
- **Craft** (`Crafter:startCraft`): `cost` gold plus ingredients. Equipment, map and consumable ingredients
  must have the item's ascension level. An ascended craft also pays `default.prestigeItemMaterial` essence.
- **Ascend** an existing item (`AscendItem`): the item at asc-1 plus 4× the essence, no gold.
  The cheaper of crafting or ascending wins.
- **Modifiers**: each prefix/suffix raises rarity one step (capped), so only their count changes the price.
  A fresh craft rolls them (`ev_sell`, `ev_profit` = expected values). Crafted maps roll them too and get
  more essence. Upgrading a modded item costs ×(4 + mods) essence at its bumped rarity.
- **Enchanter** (`enchant.py`): expected cost of a first prefix or +1 suffix on an owned item (Markov chain
  over the attempt counter). `best_strategy` = sell as crafted, or enchant up to 1 or 2 modifiers.
  Enchanted maps (suffix +N, prefix) also compete as essence sources (`enchant` column in essence_sources).
- **Sell value**: `value × rarityMod[rarity][1]` (stackables: average of `sell`), ×2·asc when ascended.
  This is the base customer price, before customer preference and counter-position bonuses.

Maps need essence and produce essence, so costs are solved by iteration until they converge.
Items with no source (placeholders, event/weekly/shop items, random maps) are left unpriced.

### Outputs

- `reports/profit_g<grade>_<alloc>.csv`: every (item, ascension level) with sell, cost, profit, margin,
  craft time, profit per craft-hour, and the cheapest production route.
- `reports/enchant_g<grade>_<alloc>.csv`: enchant odds, attempts, cost, time and net gain per item.
- `reports/ascend_modded_g<grade>_<alloc>.csv`: gain of upgrading an owned item with 0/1/2 modifiers.
- `reports/essence_sources_g<grade>_<alloc>.csv`: each map that yields each essence, with map cost,
  loot credit and cost per essence (the "where do I get my orbs" comparison).

### Not modelled yet

Reset before enchanting, stronger map enemies from suffixes, modifier boost from modded ingredients, customer
preference bonuses, buying materials from customers, events and the weekly shop, crafter level and unlock
requirements, multi-enemy quest runs.

## combat.py

Needs `lupa` once: `python3 -m pip install -r requirements.txt` (or `--target tools/_vendor` for a local copy).

```bash
python3 tools/combat.py --save saves/snapshot/PlayerData.txt roster
python3 tools/combat.py --save saves/snapshot/PlayerData.txt fight  --quest 80 --front 1,9 --back 6,2
python3 tools/combat.py --save saves/snapshot/PlayerData.txt damage --hero 5 --quest 80
python3 tools/combat.py --save saves/snapshot/PlayerData.txt solo   -n 40          # -> reports/solo.csv
python3 tools/combat.py --save saves/snapshot/PlayerData.txt skills --hero 5 --quest 50
python3 tools/combat.py --save saves/snapshot/PlayerData.txt gear   --hero 5 --quest 80 --pool catalog --asc 2
python3 tools/combat.py --save saves/snapshot/PlayerData.txt party  --quest 72
python3 tools/combat.py --save saves/snapshot/PlayerData.txt map    --map 22 --front 1,9,12 --back 6,2,5
python3 tools/combat.py --save saves/snapshot/PlayerData.txt party  --map 22 --n-quick 10 --n-final 100
python3 tools/combat.py --save saves/snapshot/PlayerData.txt maps   --front 1,9,12 --back 6,2,5   # -> reports/maps_survey.csv
```

Fights use the game's own combat code, so stats, skills, passives, effects and turn order are exact.
Details and limits: `docs/tooling/combat-simulator/combat-simulator.md`.
