# Update Log

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Update Log

## 2026-11-23
- **TypeScript port, maps**: map/maps/scrolls/party --map checked against Python (identical); scroll prices from `profit.ts`; catalog gear identical after the engine's makeItem fix.
- **TypeScript port**: `combat.py`, `engine.py`, save decoding and sell values ported to `web/src/tools/`; same output as Python on the LCG except catalog gear (unverified `makeItem`) and map commands (engine `mapRun` pending). Two `combat.py` CLI bugs found (solo quest ranges, party options).
- **Map runs**: `map`, `party --map` and `maps` commands on top of the game `Campaign`; game-code crashes counted per run.
- **Creation**: Harness running the decompiled combat code in Lua 5.1 (lupa); `combat.py` with roster, fight, damage, solo, skills, gear and party commands.
