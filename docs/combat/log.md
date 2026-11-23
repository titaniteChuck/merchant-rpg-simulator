# Update Log

[Root](../index.md) > [Combat](./index.md) > Update Log

## 2026-11-23
- **HP, heals and revives**: HP carried between map rooms, heals capped at max HP (not at start-of-battle HP; overload exception), revive amounts, end-of-map `min(questHP, hp)`, with file:line in decompiled/ and the port.
- **Schedule (E13)**: turn order and slot timetable, enemy and hero targeting, effect timing (durations in the owner's actions), cleanse/dispel rules, skill probe findings (reflects, counters, dodges); enemy never skips its rotation.
- **Creation**: Combat rules documented from Battle, Combatant, Enemy, Party and statsService.
