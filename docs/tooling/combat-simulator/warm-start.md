---
type: Tool
title: Warm start
description: Offline table of the best rotation per class, tier and enemy, generated locally and tried first by the rotation searches.
timestamp: 2026-11-24
---

# Warm start

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Warm start

The rotation searches don't start from scratch: `inventory/warmstart.json` holds a searched rotation and passive for
every class × prestige tier × enemy (normal and rare). `searchSkills` always simulates it next to its own candidates.

## Table of contents

- [Table](#table)
- [Use in the searches](#use-in-the-searches)
- [Measured](#measured)
- [Code](#code)

## Table

For each class (9) × tier (1–3) × enemy (104 quests, 37 of them with a rare variant), 3,807 entries:

- **Hero:** `standardHero` ([class balance](./combat-simulator.md#class-balance-on-equal-gear)) at the tier's max
  level (50 / 50 / 60), with the class-blind "best" catalog gear at grade 5, asc 0, crafter level 60.
- **Fight:** the hero alone against the enemy, in the game's slot: front 2 in a party quest, front 1 in a solo quest
  ([party setup rules](../../combat/combat.md#party-setup-rules); rebuilt 2026-11-24, 182 entries changed).
- **Search:** `searchSkills` with nQuick 10, nFinal 30, top 3 and the schedule pre-filter ([schedule](./schedule.md)).
- **Entry:** `{ rotation, passive, win, peak, turns }` (peak = enemy HP removed at its lowest point), under the key
  `class:tier:quest`, with a `B` suffix for a rare.

`npm run export:warmstart` rebuilds it in worker threads (one per core minus one, at most 8), after
`export:timelines`. `-- --classes 1,5` redoes only those classes and keeps the rest. `test/warmstart.test.ts` checks
that every class × tier × enemy has an entry, and that two entries are what the build gives today.

## Use in the searches

```ts
loadWarmStart(json); hasWarmStart(); warmStart(classId, tier, quest, rare) // exact entry, else the nearest tier
searchSkills(sim, hero, front, back, { quest }, { warmStart: true })      // default true once loaded
```

- The table's rotation for the hero's class, tier and enemy is always simulated and kept as a finalist, like the hero's current rotation.
- Adapted to the hero: the table's standard hero can have other skills unlocked or another AP budget (gear, passive).
  Skills the hero hasn't unlocked become Basic, then the most expensive skill becomes Basic until the hero affords the
  rotation, with the table's passive or its own. For example, the save's Paladin (21 AP) can't afford the Odin entry's
  23 AP.
- The result reports it as `warm`, with `adapted: true` when it had to change. `optimiseFight`'s skill step gets it through `searchSkills`.
- It is a starting point, not an answer: one standard hero, alone, on equal gear. A real hero in a party, with its own gear, often has a better rotation. The search then finds it, and the warm entry only guarantees a decent floor.
- The page workers must load `warmstart.json` (like `timelines.json`); without it, the searches behave as before.

## Measured

Real save, `searchSkills` with the pre-filter (nQuick 30, nFinal 150, top 8), warm start off vs on, picks re-scored
on 300 other fights. 8 cases: Odin and Archon with the full party; Gnoll Khan ×5 and Demon Mage ×5 with Warrior +
Cleric.

- **Result:** the same pick in all 8 cases. The warm rotation is simulated but ranks 2nd to 25th among the finalists, and the search's own candidates win.
- **Adaptation:** every entry had to be adapted to the real hero. The table's standard heroes, on "best" catalog gear and alone, afford more AP, or other skills, than the save's heroes.
- **Use:** a sound rotation to fall back on when a search is cut short (time budget, cancel), and a start for heroes without a search. It doesn't improve full searches, which already find better rotations for the real party.

## Code

- `web/src/tools/warmstart.ts` (lookup), `web/src/tools/warmstart-build.ts` (one entry, job list),
  `web/src/tools/export-warmstart.ts` (generator).
- Tests: `web/test/warmstart.test.ts`.
- Data: `inventory/warmstart.json`.
