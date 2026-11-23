# Porting rules (Lua → TypeScript)

The simulator re-implements the game's combat rules. Correctness is defined by the
differential test (`npm run difftest`): the same fights, with the same random
generator, must give the same trace as the game's own code. So the port is
**faithful first**: same order of operations, same rounding, same random draws.

## Reference fixtures

`web/test/fixtures/{fights,maps,items}.json` were recorded from the game's own code
(`tools/sim/fixtures.py`, running `harness.lua` in Lua 5.1 with the shared LCG) and are frozen:
final set of 2026-11-23, 3000 fights, 400 map runs, 1949 item rolls, all matching.
They embed the player's heroes, so they stay local (git-ignored). Any change to `web/src/sim/`
must keep `npm run difftest`, `difftest:maps` and `difftest:items` at 100 %.

## Module map

| Lua (decompiled) | TypeScript |
|---|---|
| `Utilities` (`round`, `copyTable`, `tableSum`), `math.random`, `math.round` | `lua.ts` |
| `data.*` literal tables | `inventory/gamedata.json`, loaded by `data.ts` (`G`) |
| `data.Default` functions used by combat | `defaults.ts` |
| `obj.combat.statsService`, `obj.combat.CombatStatistics`, `obj.combat.CombatantLogger` | `stats.ts`, `combatStatistics.ts`, `logger.ts` (no-op) |
| `obj.Combatant`, `obj.Hero`, `obj.Enemy`, `obj.Party` | `combatant.ts`, `hero.ts`, `enemy.ts`, `party.ts` |
| `obj.combat.Battle`, `questService.determineBattleGrade` | `battle.ts` |
| `obj.Item`, `obj.Equipment` (compact save strings) | `equipment.ts` |
| `obj.Map`, `obj.ItemCompact` (maps), map functions of `data.Default` | `map.ts`, `defaults.ts` |
| `obj.combat.Campaign`, `lootService`, `QuestInventory`, `ScrollsComponent`, `data.ScrollsData`, map timings of `questService` | `campaign.ts` |
| Lua 5.1 table internals (`pairs` order, `#` with holes) | `lua-table.ts` |
| `data.AbilityFunc` (skills, passives) | `abilities/*.ts` |
| `tools/sim/harness.lua` API (`sim.*`) | `api.ts` (public slot arrays are 0-based: `[h1, h2, h3]`) |

## Conventions

- **Same names.** Fields and methods keep their Lua names (`questHP`, `sendAttack`,
  `addEffect`, `partyLocation`, `effectList`…), so the Lua can be read side by side.
- **Indexes.**
  - Anything indexed by a game position keeps Lua's 1-based index: hero rows
    (`frontRow[1..3]`, index 0 unused), party locations and damage ratios
    (`[1..6]`, arrays of length 7 with index 0 unused), rotation slots
    (`attackList[1..5]`, index 0 unused), prestige levels.
  - Data from `gamedata.json` keeps Lua keys as object keys (`heroList[cls].hpPlv[p]`).
    Use `len(t)` for `#t` and `seq(t)` to get a 0-based array of `t[1..n]`.
  - Lists that are only iterated or appended (`effectList`, `turnOrder`,
    the list returned by `Party.receiveAttack`) are plain 0-based arrays.
    Translate `for n = #list, 1, -1` to `for (let n = list.length - 1; n >= 0; n--)`
    and `table.remove(list, n)` to `list.splice(n, 1)`.
- **Truthiness.** In Lua only `nil` and `false` are false; `0` and `""` are true.
  Use `truthy(x)` from `lua.ts` whenever the value can be `0` or `""`
  (`if self.reviveCooldown then`, `params.hitChance`, `attack.luck`…).
  `a or b` → `truthy(a) ? a : b` unless `a` can only be nil/object (then `a ?? b`).
- **Numbers.** Lua 5.1 numbers are doubles, like JS. Keep every `math.floor`,
  `math.round` (`mathRound`), `round` and the order of float operations.
  `math.max/min` with NaN behave differently: avoid introducing NaN.
- **Random.** Only `random()` from `lua.ts`, called exactly where Lua calls
  `math.random`, with the same arguments, in the same order.
- **Iteration order.** `pairs()` over hero rows is ascending index order (checked on
  Lua 5.1). `pairs()` that only adds numbers per key can use any order. Where the
  order changes random draws or output (loot `weightedRandom`, `default.bonusStat`,
  map room lists with a nil treasure), build the table with `LuaTable` (`lua-table.ts`),
  which emulates ltable.c. `gamedata.json` keeps source field order for that reason.
- **Effects** are plain objects; `dmgFunc(attack)`, `statFunc(combatant)`,
  `triggerFunc(combatant, actionName)` are closures. `copyTable` is shallow.
- **Logging** (`self.logger:…`, `self.log`) has no effect on the fight: calls go to
  the no-op logger, keep them only if trivial.
- **Text** (`print`, `TEXT.*`, localisation) is dropped.
