---
type: Mechanic
title: Crafting
description: Crafters turn gold plus ingredients into materials, equipment, consumables and maps.
timestamp: 2026-11-23
---

# Crafting

[Root](../../index.md) > [Game Economy](../index.md) > [Crafting](./index.md) > Crafting

Eight crafters: Blacksmith, Armorsmith, Woodworker, Clothworker, Alchemist, Jeweler, Enchanter, Scribe.
Scribe makes [maps](../maps/maps.md).

## Table of contents

- [Recipe fields](#recipe-fields)
- [Cost](#cost)
- [Modifiers](#modifiers)
- [Enchanter](#enchanter)
- [Time and grade](#time-and-grade)
- [Code](#code)

## Recipe fields

On any item with a `crafterID`:

| Field | Meaning |
|---|---|
| `materialID` | Ingredient ids |
| `materialAmount` | Amount per ingredient |
| `materialType` | Ingredient type per index; missing = `material`. Seen: `equipment`, `consumable`, `map` |
| `cost` | Gold per craft |
| `runTime` | Seconds per craft |
| `experience` | Crafter XP |
| `itemLevel` | Crafter level needed |

- Crafted materials exist too (e.g. Iron Ingot = 2 Iron Ore + 5 g).
- Recipes chain: e.g. Hard Tuvale Map needs a Tuvale Map.

## Cost

- Gold: `cost × count`. Not scaled by ascension.
- Ingredients consumed. Equipment, map and consumable ingredients must have the crafted item's
  [ascension](../ascension/ascension.md) level.
- An ascended craft also consumes essence.

## Modifiers

A fresh craft can roll a prefix, then a suffix (`Item:determineStats`).

- Equipment rolls only if craft grade > 2. Slot-6 items never get a suffix. Maps always roll. Consumables never.
- `effLevel = round(crafterLevel + 2 × grade − 4)` (crafter prestige level for ascended crafts).
- Prefix chance `min((effLevel − itemLevel) × 2, 25)%`, suffix `min(… × 2, 40)%` (+20 / +3 per boost
  when ingredients carry modifiers).
- Pick: weighted (`weight`) among entries with `minLevel ≤ effLevel ≤ maxLevel`; suffixes also need `ascLevel`.
- A prefix raises grade by `round(2 × sell)`, which improves the suffix odds.
- Max-level crafter on a level-60 item: craft grade 2, so **no modifiers** (3% with grade-4 ingredients).
  Modifiers on top gear come from the Enchanter.
- Value effect: [selling](../selling/selling.md#base-value). Map effect: [maps](../maps/maps.md#prefix-and-suffix).

## Enchanter

Adds or upgrades modifiers on an existing item (equipment or map). Three actions: Prefix, Suffix, Reset.
Modelled for equipment and maps in the [profit calculator](../../tooling/profit-calculator/profit-calculator.md#enchanting).

- Each action has its own attempt counter, +1 per attempt, reset to 0 on a break.
  Rune amount `1 + fibo[min(attempts, 5)]`: 1, 2, 2, 3, 4, 6, 6…
- Ascended items also pay `prestigeEnchantMaterial` essence per attempt: `(2 + frac × 10) × rarityMod`.
- Rune by item level band (≤10, ≤20 … ≤60). None above 60, so level-70 maps can't be enchanted.

| Action | Rune (crafted by Enchanter) | Gold |
|---|---|---|
| Prefix | Emerald, Sapphire, Topaz, Amethyst, Ruby, Obsidian | `itemLevel × 40` |
| Suffix | Nature, Water, Earth, Death, Fire, Oblivion Rune | `itemLevel × 60` |
| Reset | Forest … Oblivion Crystal | `itemLevel × 20 + attempts × 20` |


- Prefix: `itemLevel × 40` gold (if already prefixed: − `prefix.minLevel × 10`, min `itemLevel × 20`)
  + a rune by level band, amount `1 + fibo[attempts]`.
  Chance `clamp((effLevel − itemLevel) × 2 + 2 × grade (+15 if already prefixed), 10, 80)%`.
  Re-rolling an existing prefix can break it: `attempts × 4`%, max 40%, prefix removed.
- Suffix: `itemLevel × 60` gold (+ `suffix.minLevel × 20` if suffixed) + a rune, amount `1 + fibo[attempts]`.
  Success steps the suffix +1. Chance `clamp((effLevel' − nextSuffix.minLevel) × 2, 10, 95)%`,
  with `effLevel' = crafterLevel + 10 + 2 × attempts + 4 × grade`. Break (`attempts × 4`%) drops one step.
- Reset: re-rolls grade and base stats, keeps modifiers. New grade
  `clamp(round(startGrade(enchanterLevel + 5, itemLevel) + 0.4 × attempts), grade − 1, 5)`.
- A roll succeeds when `odds > random(1, 100)`, so the real chance is `odds − 1`%.
- Time: prefix `itemLevel × 10` s, suffix `itemLevel × 5` s, reset `itemLevel × 2.5` s.

## Time and grade

- Start grade from crafter level vs. item level, averaged with ingredient grades.
- Craft time = `runTime × craftGradeSpeed[grade] × count`.
- Ascending an existing item takes `itemLevel × 60` s.

## Code

- `decompiled/obj.Crafter.lua` (`startCraft`), `decompiled/obj.Craft.lua` (`removeMaterials`, `startCrafting`).
- `decompiled/obj.Player.lua` (`removeItemForCrafting`, `removeMapFromInventory`).
- `decompiled/obj.Item.lua` (`determinePrefix`, `determineSuffix`, `applyPrefix`, `applySuffix`).
- `decompiled/obj.Enchant.lua`; `decompiled/data.Default.lua` (`__craftPrefixOdds`, `__craftSuffixOdds`,
  `__prefixChance`, `__suffixChance`, `prefixEnchantCost`, `suffixEnchantCost`).
- Data: `decompiled/data.PrefixData.lua` (43 prefixes), `decompiled/data.SuffixData.lua` (+1…+16, *1…*8, **1…**8).
