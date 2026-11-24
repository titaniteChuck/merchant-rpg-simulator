# Update Log

[Root](../index.md) > [Combat](./index.md) > Update Log

## 2026-11-24
- **Effect durations (E24)**: an effect at `turns` 0 stays on until its owner's next action, so an enemy self-buff with `turns` t covers t hero actions but t − 1 enemy actions (Ancient Mist Eva↑: 3 enemy, 4 hero); verified in a real fight. Game texts that match neither count: Tidal Wave, Unholy Cleave, Piercing strike, Weaken, Ice Barrier (the code wins).
- **Party setup rules (E21)**: solo quests take one hero in front 1, party quests up to `questSize` heroes with front 2 always filled (the party screen opens with the quest's hero there and never lets it be emptied), maps have no required slot; from the quest and map party screens.

## 2026-11-23
- **Rule fixes (E17b, from U25)**: `midline` attacks hit locations 3-4 (only party *effects* treat unknown strings as everyone); a skill's own penetration never applies (lower of skill and attacker, attacker always 0); potions use a charge per map room (heroes page).
- **HP, heals and revives**: HP carried between map rooms, heals capped at max HP (not at start-of-battle HP; overload exception), revive amounts, end-of-map `min(questHP, hp)`, with file:line in decompiled/ and the port.
- **Schedule (E13)**: turn order and slot timetable, enemy and hero targeting, effect timing (durations in the owner's actions), cleanse/dispel rules, skill probe findings (reflects, counters, dodges); enemy never skips its rotation.
- **Creation**: Combat rules documented from Battle, Combatant, Enemy, Party and statsService.
