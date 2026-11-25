# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Profit Calculator](./index.md) > Update Log

## 2026-11-25
- **Map essence**: `mapEssenceMultiplier` multiplies in the prefix's essence modifier (Skilled ×1.25, Expert's ×1.5) from the game data, rounded once; Profit matches the engine's `mapEssenceReward`.

## 2026-11-24
- **Docs**: the library now backs the [Profit page](../website/website.md#profit-page) (the "no profit page yet" line was stale); level-70 maps stay priced by the library but the page drops rows above level 60.
- **Map-only content (E20)**: map bosses and Treasure Bushes (`questType` 8) are no longer quest sources; map-only loot costs run cost / drops per run (Khan's Horn 350 → 47,390 g); `Solver.hoursPerUnit` (craft + run hours per unit), `crafterHourCost`; map essence × (1 + luck / 100); farming map rows add craft time, `map_only` drops and their unit cost, and run a map-only quest source as its map. Snapshots updated (see [map-only content](./profit-calculator.md#map-only-content)).

## 2026-11-23
- **Essence pricing (E11)**: forced sources that need their own essence solved as a fixed point (no more dropped rows; explicit error when impossible); free by-product essences kept at 0 and flagged (`free_byproduct`).
- **Enchant rules (E7)**: enchant order (before/after ascending), Reset before enchanting and modded-ingredient boosts modelled as opt-in options and tables; findings: enchanting after ascending always cheaper, Reset helps some prefixes (~3%), modded ingredients almost never pay.
- **Farming report**: `farming.ts` simulates quests and map runs for a party (grade, time, loot, essence, costs per run and per hour); Solver `sourceStats` takes simulated grades/time per source; quest loot scales with the enemy count.
- **Python removed**: `profit.py`, `enchant.py`, `gamedata.py` deleted; the model lives on in `profit.ts` (library, no command line).
- **TypeScript port**: `profit.py`, `enchant.py` and the `gamedata.py` model ported to `web/src/tools/` (profit.ts, enchant.ts, gamedata.ts); output byte-identical to Python on 8 option sets.
- **Map enchanting**: Enchanted maps as essence sources, exact Markov solvers (5 s full run, was 4 min), `--no-map-enchant`, `--map-suffix-max`.
- **Enchanter**: `tools/enchant.py`; best strategy (sell / enchant to 1 / to 2 modifiers), `enchant_*.csv`, `--enchanter-level`; default sort `best_profit`.
- **Modifiers**: Prefix/suffix roll odds, expected sell value, map essence with modifiers, `ascend_modded` report, `--crafter-level`, `--no-map-mods`; default sort is now `ev_profit`.
- **Creation**: First version: quest, rare quest, map, craft and ascend sources; maps capped at asc 1.
