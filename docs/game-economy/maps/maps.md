---
type: Mechanic
title: Maps
description: Maps are crafted by the Scribe, consumed when run, and yield essence plus room loot.
timestamp: 2026-11-23
---

# Maps

[Root](../../index.md) > [Game Economy](../index.md) > [Maps](./index.md) > Maps

32 maps in `itemData.map`, crafted by the Scribe (crafter 8). The only source of essence.

## Table of contents

- [Crafting a map](#crafting-a-map)
- [Running a map](#running-a-map)
  - [Rooms](#rooms)
  - [Essence](#essence)
  - [Loot](#loot)
- [Prefix and suffix](#prefix-and-suffix)
- [Enchanting a map](#enchanting-a-map)
- [Scrolls](#scrolls)
- [Level-70 maps](#level-70-maps)
- [Code](#code)

## Crafting a map

- Normal [crafting](../crafting/crafting.md): gold + materials, often a lower map + essence.
  Example: Hard Tuvale Map = Tuvale Map + 2 Forest Crystal + 50 Forest Essence + 1000 g.
- Asc-1 map: same recipe at asc 1 + asc-1 essence. Max asc 1.

## Running a map

- The map is **consumed** (`Player:useMap`).
- Base time `baseMapTime`. Enemy strength `enemyMod`, ×2 at asc 1.

### Rooms

- Rooms = `baseEnemyAmount` ±1 random, −1 at grade ≤ 2, +1 at grade ≥ 4.
- Rooms − 1 enemies drawn from `enemyList` (quest id ranges), then the boss from `bossList`.
- Each enemy can be rare with chance `abRand`%. `isRareBoss` makes the boss rare.
- Treasure rooms: chance per room by grade 0, 0, 1, 8, 10 %. Treasure Bush quest by tier (ids 99–104).
  Maps above level 60 get no treasure (index out of range).

### Essence

- `baseReward = {essenceIds…, amounts…}`.
- Amount = `round(gradeBonus[grade] × amount × essenceBase × (1 + partyLuck / 100))` (`data.Default.lua:757`). Campaign grade = average of fights.
  Party luck raises map essence; it does not change gold or XP.
- Asc-1 map: each base essence becomes its asc-2 tier (see [ascension](../ascension/ascension.md)).

### Loot

- Every fight rolls normal [quest](../quests/quests.md) drops at its own grade (rare drops if rare).

## Prefix and suffix

- Rolled at craft like equipment, but with no grade condition (see [crafting](../crafting/crafting.md#modifiers)).
- Essence: prefix × `(1 + sell)`, suffix × `(1 + stats.atk)`. Suffix uses `stats.atk`, not `sell`.
- Also raise rarity (sell value), cost and run time; prefixes add map stats; suffixes raise enemy strength.
- With a level-60 Scribe on low-level maps: 24% prefix, 39% suffix, so about +26% essence on average.

## Enchanting a map

- Same Enchanter actions and costs as equipment ([crafting](../crafting/crafting.md#enchanter)); maps up to level 60 only.
- The suffix **tier** matters on maps: essence × `(1 + stats.atk)`: +1 ×1.1, +5 ×1.3, +9 ×1.5, +12 ×1.65, +16 ×1.85.
  Asc-1 maps continue to *1…*8 (×1.9 … ×2.6). Asc-2 tiers (**1…) need asc-2 items, so maps can't reach them.
- Each step costs `itemLevel × 60 + currentSuffix.minLevel × 20` gold + runes per attempt; failures can break a step.
  From a plain map with a level-60 Enchanter: +1 ≈ 1.06 attempts, +5 ≈ 5.4, +16 ≈ 24 (≈ 26k gold + 103 runes on a level-1 map).
- A higher suffix also multiplies enemy strength (`mapEnemyMod × (1 + stats.atk)`), so the map gets harder.

## Scrolls

Up to 3 scroll slots per map run (duplicates allowed), consumed at the start (`Game:startMap`).

| Id | Scroll | Kind | Effect |
|---|---|---|---|
| 60 | Escape | escape | Ends the run (no essence) once ≥ 50% of the party is dead, after a won room |
| 61 | Healing | post-battle | +500 HP to the first hero ≤ 25% HP |
| 62 | Revive | post-battle | Full HP to a dead hero (1 charge) |
| 63 / 64 / 65 | Str / Int / Dex | buff-stats | +8% atk / matk / acc for the whole party, whole run |
| 66 | Swap | post-battle | Switches every hero to its other skill set before the boss |
| 67 | Speed | map-stats | +20% map speed (shorter run) |
| 68 | Revive +1 | post-battle | As Revive, 3 charges |
| 69 | Healing +1 | post-battle | +500 HP to heroes ≤ 50% HP, 6 charges |

- Post-battle and escape scrolls only act **between rooms**, after a won fight. Nothing helps inside the
  fight that kills the party.
- Ascended scrolls scale their stats (`consumablePrestigeStat`). Scroll 70 has behaviour (map-stats) but no item.

## Level-70 maps

- Six maps are defined at `itemLevel = 70`: Hard Boss Rush (27), Weekly Boss Rush (28), the three Random maps
  (29–31) and The Mighty Bush (32). Crafters cap at level 60 and recipes need `itemLevel ≤ crafter level`,
  so players can't craft them: dormant data (confirmed by the game's author: level 70 shouldn't exist).
- Latent crash: `treasureId` has 6 tiers, so a level-70 map gets a `nil` treasure room. Generation then fails
  at `obj.Map.lua:164`: 6% of seeds at grade 3, 66% at grade 4, 82% at grade 5 (0% at grades 1–2).
  Only matters if these maps are ever enabled.

## Code

- `decompiled/obj.Map.lua`, `decompiled/obj.combat.Campaign.lua`, `decompiled/obj.Player.lua` (`useMap`).
- Scrolls: `decompiled/obj.combat.ScrollsComponent.lua`, `decompiled/data.ScrollsData.lua`, `decompiled/obj.GameClass.lua` (`startMap`).
- `decompiled/data.Default.lua`: `mapRoomQuantity`, `mapEssenceReward`, `mapEnemyMod`.
- Data: `decompiled/data.MapData.lua`.
