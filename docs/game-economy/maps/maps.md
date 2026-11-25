---
type: Mechanic
title: Maps
description: Maps are crafted by the Scribe, consumed when run, and yield essence plus room loot.
timestamp: 2026-11-25
---

# Maps

[Root](../../index.md) > [Game Economy](../index.md) > [Maps](./index.md) > Maps

32 maps in `itemData.map`, crafted by the Scribe (crafter 8). The only source of essence.

## Table of contents

- [Crafting a map](#crafting-a-map)
- [Running a map](#running-a-map)
  - [Rooms](#rooms)
  - [Map-only enemies](#map-only-enemies)
  - [Experience](#experience)
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

### Map-only enemies

- `questType` 8: the map bosses 91–98 and the Treasure Bushes 99–104. The quest board draws a quest only when
  `quest.region == currentRegion and quest.questType ~= 8` (`scene.QuestMenu.lua:175`), so they are never a quest.
- Where: Goblin Warlord (91) ends Goblin's Feast Map, Murlok Monarch (92) Murlok Madness Map, Gnoll Khan (93) Gnoll
  Vendetta Map, Beast King (94) Beastly Burden Map; Goons of Evil Map draws one of 91–93 (1 in 3 each).
  Protector of the Forest (95) and King of the Mountain (96) end Treant / Golem Revenge Map, Archon (97) Archon's
  Reality Map; The Mighty Bush (98) only the uncraftable level-70 map 32. Treasure Bushes: treasure rooms of the tier.
- Getting anything they drop (trophies 265–272) means crafting the whole map and running it room by room to the boss:
  the site prices one at (map cost) / (drops per run) and (craft + run time) / (drops per run)
  ([profit calculator](../../tooling/profit-calculator/profit-calculator.md#map-only-content)).
- A hero below level 10 can't join a map (`scene.maps.MapAssignHeroMenu.lua:235`); there is no other level
  requirement, only a "low chance" warning when the party's score is below `round((itemLevel / 4 + 8) ^ 1.2)`
  (`scene.maps.mapFlowState.lua`).

### Experience

- Every room won gives each living hero round(exp × mapEnemyMod × 0.2 / heroes) (`obj.combat.Campaign.lua`,
  `runCombat`), then × (1 + expMod / 100) × questXpMod. mapEnemyMod = `enemyMod` (× 2 at asc 1) + `mapGradeMod[grade]`
  (−0.2, 0, 0, +0.1, +0.25). A lost run keeps the XP of the rooms won before.
- Example: Murlok Madness Map (enemyMod 10, grade 3): the Monarch room alone gives 12,000 × 10 × 0.2 = 24,000 XP
  solo; the full run ~33,300.
- Craft time (`obj.Craft:startCrafting`): ceil(floor(runTime × craftGradeSpeed[grade]) × craftTimeMod) s, the map's
  grade being its craft grade; a recipe that needs a lower map adds that map's craft (Murlok Madness = Yarsol Map +
  …: 675 + 90 s at grade 3). Helpers: `web/src/tools/quest-stats.ts` (`mapRunStats`, `mapCraftSeconds`).

### Essence

- `baseReward = {essenceIds…, amounts…}`.
- Amount = `round(gradeBonus[grade] × amount × essenceBase × (1 + partyLuck / 100))` (`data.Default.lua:757`). Campaign grade = average of fights.
  `essenceBase` = `(1 + prefix sell) × (1 + suffix stats.atk) × prefix essenceMod` (see [Prefix and suffix](#prefix-and-suffix)),
  one rounding only.
  Party luck raises map essence; it does not change gold or XP.
- Asc-1 map: each base essence becomes its asc-2 tier (see [ascension](../ascension/ascension.md)).

### Loot

- Every fight rolls normal [quest](../quests/quests.md) drops at its own grade (rare drops if rare).

## Prefix and suffix

- Rolled at craft like equipment, but with no grade condition (see [crafting](../crafting/crafting.md#modifiers)).
- Essence: prefix × `(1 + sell)`, suffix × `(1 + stats.atk)`. Suffix uses `stats.atk`, not `sell`.
- A prefix's `mapStats.essenceMod` multiplies on top (`data.PrefixData.lua`): Skilled ×1.25, Expert's ×1.5.
  `default.finalMapMod` folds it into `essenceBase` before the run, so `mapEssenceReward` rounds once (its second
  `round(amount × essenceMod)` branch never fires). Map 22 (100 / 50) at grade C: 130 / 65 with Titan's (sell 0.3),
  195 / 98 with Expert's (sell 0.3 × 1.5), 156 / 78 with Skilled.
- Speed prefixes (`mapStats.speed`, not scaled by the map's tier): Quick +4, Swift +8. The run splits
  `baseMapTime` over the rooms and the boss as walk time (`walkBaseTime = round(baseMapTime / #combats)`,
  `obj.combat.Campaign`); each walk and each fight takes `time × questTimeMod × (1 − min((party speed + map speed)
  / 100, 0.75))` (`questService.determineMapWalkTime` / `determineMapBattleTime`). So the base time drops by the
  speed %: map 22 (105 min) 96 min 36 s with Swift, map 1 (15 min) 14 min 24 s with Quick (per-room rounding aside).
- Also raise rarity (sell value) and cost; prefixes add map stats; suffixes raise enemy strength.
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
- Quest board filter: `decompiled/scene.QuestMenu.lua:175`; craft time: `decompiled/obj.Craft.lua:82`, `data.GameModsData.lua`.
- Scrolls: `decompiled/obj.combat.ScrollsComponent.lua`, `decompiled/data.ScrollsData.lua`, `decompiled/obj.GameClass.lua` (`startMap`).
- `decompiled/data.Default.lua`: `mapRoomQuantity`, `mapEssenceReward`, `mapEnemyMod`.
- Data: `decompiled/data.MapData.lua`.
