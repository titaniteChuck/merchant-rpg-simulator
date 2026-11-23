# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Update Log

## 2026-11-23
- **Party order and rotation timing (E14a)**: `optimiseFight` adds order within rows (36 layouts), front-back swaps and rotation phase shifts, each on the same seeds and in the trace with readable step names; `startParty`, `lock` and quest amounts above the prestige limit (skipped, not fatal); the gear step restores a rotation reset by an AP-lowering candidate. Odin 33.5 → 35.1 % lowest HP, Archon 6.3 → 9.9 %.
- **Schedule (E13)**: new [schedule](./schedule.md) page: skill probe, `inventory/timelines.json`, `schedule.ts` lookups and counter-schedule score with validation; `searchParty` takes `lock` and skips parties that can't take the quest amount; `searchGear` keeps the hero's rotation and passive.
- **Levelling and prestige (E12)**: `levelling.ts` (XP/h per quest, levelling plan per band, prestige payoff); farming rows add XP per hour and revive gold; map runs report XP per hero; prestige tables exported to gamedata.json.
- **Potions and enchants (E10)**: `consumables.ts` ranks potions and enchants per hero and fight, and per class; `Hero.applyBoost` ported; fights keep a potion a tool applied (`_keepBoost`).
- **Quest amount**: described as enemy HP × amount (not several enemies); `maxQuestAmount` and validation in `evaluate` / farming report.
- **Joint optimiser (E9)**: `optimiseFight` tunes party, rotations, gear and scrolls together for one quest or map run (coordinate descent, common random numbers, trace, 2-minute budget); `searchSkills`/`searchGear` accept map targets; `evaluateTarget`.
- **Class matrix search (E8)**: `classMatrix` uses the combat.ts `searchSkills` (cheaper defaults, ~30 s for 9 classes); rows add `enemyHpRemovedPeak`; `searchSkills` respects the AP budget of each passive (Wisdom) and never scores a rotation the game would replace.
- **Class balance on equal gear** (E3): `classes.ts` with `standardHero` (catalog gear policies best/fit/none, default or searched rotation) and `classMatrix` (class × quest rows, pure, progress and cancel); tests in `classes.test.ts`.
- **Healing enemies**: fights report the enemy's lowest HP and total damage taken (`enemy_dmg_peak`, `enemy_dmg_total`); the score uses the lowest point, so lost fights vs Archon no longer read 0 %. Gear search now restores empty slots too.
- **Search API**: skills, gear, party, solo, maps and scrolls searches split into pure functions with typed results, progress and cancel (`SearchControl`), for the battle page's worker; the `cmd*` reports are built on them, results unchanged.
- **Python removed**: `combat.py`, `sim/engine.py`, `sim/harness.lua` deleted; the searches live in `combat.ts` (library); the battle page runs fights and map runs. No command line.
- **TypeScript port, maps**: map/maps/scrolls/party --map checked against Python (identical); scroll prices from `profit.ts`; catalog gear identical after the engine's makeItem fix.
- **TypeScript port**: `combat.py`, `engine.py`, save decoding and sell values ported to `web/src/tools/`; same output as Python on the LCG except catalog gear (unverified `makeItem`) and map commands (engine `mapRun` pending). Two `combat.py` CLI bugs found (solo quest ranges, party options).
- **Scrolls**: `--scrolls` on map/party/maps, `scrolls` loadout search; map runs made reproducible (re-seed after map generation).
- **Map runs**: `map`, `party --map` and `maps` commands on top of the game `Campaign`; game-code crashes counted per run.
- **Creation**: Harness running the decompiled combat code in Lua 5.1 (lupa); `combat.py` with roster, fight, damage, solo, skills, gear and party commands.
