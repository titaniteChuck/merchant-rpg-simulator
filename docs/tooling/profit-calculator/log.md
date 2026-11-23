# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Profit Calculator](./index.md) > Update Log

## 2026-11-23
- **Enchant rules (E7)**: enchant order (before/after ascending), Reset before enchanting and modded-ingredient boosts modelled as opt-in options and tables; findings: enchanting after ascending always cheaper, Reset helps some prefixes (~3%), modded ingredients almost never pay.
- **Farming report**: `farming.ts` simulates quests and map runs for a party (grade, time, loot, essence, costs per run and per hour); Solver `sourceStats` takes simulated grades/time per source; quest loot scales with the enemy count.
- **Python removed**: `profit.py`, `enchant.py`, `gamedata.py` deleted; the model lives on in `profit.ts` (library, no command line).
- **TypeScript port**: `profit.py`, `enchant.py` and the `gamedata.py` model ported to `web/src/tools/` (profit.ts, enchant.ts, gamedata.ts); output byte-identical to Python on 8 option sets.
- **Map enchanting**: Enchanted maps as essence sources, exact Markov solvers (5 s full run, was 4 min), `--no-map-enchant`, `--map-suffix-max`.
- **Enchanter**: `tools/enchant.py`; best strategy (sell / enchant to 1 / to 2 modifiers), `enchant_*.csv`, `--enchanter-level`; default sort `best_profit`.
- **Modifiers**: Prefix/suffix roll odds, expected sell value, map essence with modifiers, `ascend_modded` report, `--crafter-level`, `--no-map-mods`; default sort is now `ev_profit`.
- **Creation**: First version: quest, rare quest, map, craft and ascend sources; maps capped at asc 1.
