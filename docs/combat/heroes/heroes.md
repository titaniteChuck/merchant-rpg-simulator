---
type: Mechanic
title: Heroes
description: How a hero's combat stats, skills and passives are built from class, level, prestige and gear.
timestamp: 2026-11-23
---

# Heroes

[Root](../../index.md) > [Combat](../index.md) > [Heroes](./index.md) > Heroes

9 classes in `heroList`: Warrior, Rogue, Mage, Berserker, Cleric, Assassin, Paladin, Dark Knight, Bard.
Rules for the fight itself: [combat](../combat.md).

## Table of contents

- [Stats](#stats)
- [Prestige](#prestige)
- [Gear](#gear)
- [Skills and action points](#skills-and-action-points)
- [Passives](#passives)
- [Code](#code)

## Stats

`Hero:determineStats`, in order:

1. Permanent enchants (consumables used on the hero), active boost potion, gear stats and bonuses.
2. `atk += str × strMod`, `matk += int × intMod`, `acc += dex × dexMod`.
3. Passive stats.
4. Class base + growth: `stat += base + statPlv × level` for HP, atk, matk, acc, def, mdef, crit.
5. Percent stats (`atkPct`, `hpPct`…) multiply the totals.

Max level 60 per tier (`heroLevelRequirement`).

## Prestige

- 3 tiers (`prestigeLevel` 1–3). Each tier has its own growth (`hpPlv[tier]`…) and str/int/dex multipliers.
- Max permanent enchants: `8 + 4 × (tier − 1)`.
- Hiring cost by hero count: `heroCost` 200, 400, 750, 1500, 2500, 4000, 7500, 15000.

## Gear

- 6 slots: weapon, head, body, hands, feet, trinket (slot 6).
- **No class restriction**: any hero can wear any item of the right slot with `itemLevel ≤ hero level`.
- Weapon gives atk/matk/acc/crit, armor def/mdef, trinket only bonuses; plus each item's bonus stats.

## Skills and action points

- Rotation: 5 slots, each a class skill or Basic; repeats allowed.
- Unlocked skills: first `min(floor((level − 5) / 5), n − 1)` of the class list from level 10; all past level 50.
- AP budget = `5 + floor((min(level, 40) − 10) / 2) + apMod` (20 at level 40+). Sum of skill `apCost` must fit,
  else the game resets the rotation to default.
- Two saved skill sets per hero (`skillSet`), one active.

## Passives

- One active, from the class `passiveList` (3 each), all available from level 10. Examples: Might atk +10%,
  Vitality def +12% & atk +6%, Juggernaut HP +25%, Critical Strike crit dmg +35%, Wisdom AP +2.

## Code

- `decompiled/obj.Hero.lua` (`determineStats`, `loadSkillList`, `calculateAPRemainder`).
- `decompiled/data.HeroData.lua` (classes), `decompiled/data.AbilityFunc.lua` (`passiveData`), `decompiled/data.Default.lua`
  (`attackListUnlocked`, `heroMaxActionPoints`, `heroCost`).
