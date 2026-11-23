# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Profit Calculator](./index.md) > Update Log

## 2026-11-23
- **Python removed**: `profit.py`, `enchant.py`, `gamedata.py` deleted; the model lives on in `profit.ts` (library, no command line).
- **TypeScript port**: `profit.py`, `enchant.py` and the `gamedata.py` model ported to `web/src/tools/` (profit.ts, enchant.ts, gamedata.ts); output byte-identical to Python on 8 option sets.
- **Map enchanting**: Enchanted maps as essence sources, exact Markov solvers (5 s full run, was 4 min), `--no-map-enchant`, `--map-suffix-max`.
- **Enchanter**: `tools/enchant.py`; best strategy (sell / enchant to 1 / to 2 modifiers), `enchant_*.csv`, `--enchanter-level`; default sort `best_profit`.
- **Modifiers**: Prefix/suffix roll odds, expected sell value, map essence with modifiers, `ascend_modded` report, `--crafter-level`, `--no-map-mods`; default sort is now `ev_profit`.
- **Creation**: First version: quest, rare quest, map, craft and ascend sources; maps capped at asc 1.
