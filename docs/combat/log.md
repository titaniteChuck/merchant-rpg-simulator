# Update Log

[Root](../index.md) > [Combat](./index.md) > Update Log

## 2026-11-24
- **Turn cap (U43)**: checked in the decompiled `Battle:combatLoop`: at turn 200 the fight stops as a loss (grade 0), after the win test, so an enemy killed on turn 200 is still a loss; named `TURN_CAP` in the port, unchanged behaviour.
- **Empty front row (E22)**: an empty front row is targeted like a dead one: the default and `front` attacks fall back to the back row, no early end, no skipped enemy turn (`obj.Enemy.lua:99`, `obj.Party.lua:208`; 635 Lua-recorded empty-front fights). Back-row-only wins in 1.0 turns against Murlok Monarch are turn-1 kills before it acts; the port was already right.
- **Effect durations (E24)**: an effect at `turns` 0 stays on until its owner's next action, so an enemy self-buff with `turns` t covers t hero actions but t − 1 enemy actions (Ancient Mist Eva↑: 3 enemy, 4 hero); verified in a real fight. Game texts that match neither count: Tidal Wave, Unholy Cleave, Piercing strike, Weaken, Ice Barrier (the code wins).
- **Party setup rules (E21)**: solo quests take one hero in front 1, party quests up to `questSize` heroes with front 2 always filled (the party screen opens with the quest's hero there and never lets it be emptied), maps have no required slot; from the quest and map party screens.

## 2026-11-23
- **Rule fixes (E17b, from U25)**: `midline` attacks hit locations 3-4 (only party *effects* treat unknown strings as everyone); a skill's own penetration never applies (lower of skill and attacker, attacker always 0); potions use a charge per map room (heroes page).
- **HP, heals and revives**: HP carried between map rooms, heals capped at max HP (not at start-of-battle HP; overload exception), revive amounts, end-of-map `min(questHP, hp)`, with file:line in decompiled/ and the port.
- **Schedule (E13)**: turn order and slot timetable, enemy and hero targeting, effect timing (durations in the owner's actions), cleanse/dispel rules, skill probe findings (reflects, counters, dodges); enemy never skips its rotation.
- **Creation**: Combat rules documented from Battle, Combatant, Enemy, Party and statsService.
