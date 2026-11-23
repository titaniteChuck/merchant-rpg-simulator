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
- [Potions and enchants](#potions-and-enchants)
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

## Potions and enchants

- **Potion** ("Boost" consumable, 28): flat stats (Atk Boost +1: +120 atk, HP Boost: +500 HP, Crit Boost: +10 crit,
  Speed/XP/Luck boosts) for `duration` quests (3; Witch's Brew 6). One map run counts as one (`Campaign` calls
  `reduceBoost`). One potion at a time; the same potion again extends it (`Hero:applyBoost`).
  Usable from hero level `itemLevel − 5 − 4 × (tier − 1)` (`default.heroBoostLevelReq`).
- **Enchant** ("Enchant" consumable, 10): permanent, flat (+3 atk/matk/acc/def/mdef) or per level ("Plv": +0.1 growth,
  so +6 atk at level 60). Up to `8 + 4 × (tier − 1)` per hero. Enchant bonuses to luck, XP, AP, crit multiplier and
  percent stats are applied before those fields are reset in `determineStats`, so they have no effect.
- Ascended potions and enchants: stats × `potionStat` (×2 at asc 1, ×3 at asc 2 for atk/matk/acc/def/mdef/HP/str/int/dex
  and Plv; ×1.25/×1.5 for speed and crit; ×1.75/×2.5 for luck).
- Flat bonuses are added before percent stats, so a passive like Might (+10 % atk) also multiplies them.

## Code

- `decompiled/obj.Hero.lua` (`determineStats`, `loadSkillList`, `calculateAPRemainder`).
- `decompiled/data.HeroData.lua` (classes), `decompiled/data.AbilityFunc.lua` (`passiveData`), `decompiled/data.Default.lua`
  (`attackListUnlocked`, `heroMaxActionPoints`, `heroCost`).
