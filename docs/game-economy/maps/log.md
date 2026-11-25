# Update Log

[Root](../../index.md) > [Game Economy](../index.md) > [Maps](./index.md) > Update Log

## 2026-11-25
- **Maps without a run time (U55)**: the six level-70 maps (27–32) have `baseMapTime` 0; none can be obtained in 3.18 (no Scribe recipe passes the level and region checks, nothing else adds a map).
- **Speed prefixes (U53)**: Quick +4 / Swift +8 cut a run's walk (base) time and fights by the speed % (with the party's speed, capped at 75 %); no other modifier changes the base time.

## 2026-11-24
- **Map-only enemies (E20)**: `questType` 8 never on the quest board; which map holds each boss; room XP formula; craft time with lower maps; level 10 to join a map.

## 2026-11-23
- **Scrolls**: Documented the 10 map scrolls, their kinds and when they act.
- **Level-70 maps**: Documented the six uncraftable level-70 maps and their latent treasure-room crash.
- **Enchanting**: Map suffix tiers, their essence multiplier and climb cost documented.
- **Modifiers**: Documented the effect of map modifiers on essence yield.
- **Creation**: Map crafting, run loot and essence rules documented from `Map` and `Campaign`.
- **Update**: Map essence includes party luck (× (1 + luck/100)).
