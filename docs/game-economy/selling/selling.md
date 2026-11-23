---
type: Mechanic
title: Selling
description: Base sell value per item type, and the customer modifiers applied on top.
timestamp: 2026-11-23
---

# Selling

[Root](../../index.md) > [Game Economy](../index.md) > [Selling](./index.md) > Selling

## Table of contents

- [Base value](#base-value)
- [Customer price](#customer-price)
- [Code](#code)

## Base value

| Type | Base sell value |
|---|---|
| material, consumable (stackable) | `round(avg(sell[1], sell[2])) × amount` |
| equipment, map | `round(value × rarityMod[rarity][1])`; `value` falls back to `cost` |

- `rarityMod[r][1]`: 1, 1.2, 1.5, 1.75, 2, 3, 4, 5 for rarity 1..8.
- [Ascension](../ascension/ascension.md) multiplies value (or the `sell` range) by `2 × asc`.
- Each prefix or suffix raises rarity one step: below 7 capped at 6, from 7 capped at 8.
  Only the **count** of modifiers changes the price, not which one or its tier (+1 and +12 sell the same).
- Effect by base rarity: 1 → ×1.2 / ×1.5, 4 → ×1.14 / ×1.71, 5 → ×1.5 / ×1.5 (2nd modifier useless),
  6 → no effect, 7 → ×1.25 / ×1.25. See [crafting](../crafting/crafting.md#modifiers) for how they roll.
- Essence `sell` is tiny (Forest Essence 4–6 g) compared with what it costs to make.

## Customer price

`location` is the haggle position, 1..5, default 3.

- Customer buys from the player (`getBuyInfo`): `base × (1 + buyPref[subType] × 2 / 100) × (1 + (location − 3) / 10)`.
  `buyPref` is randomised per customer from its `itemPref`.
- Customer sells to the player (`getSellInfo`): `base × (1 + sellPref[subType] × 2 / 100) × (1 + location / 10)`.
  Another source of items, not modelled yet.

## Code

- `decompiled/obj.Item.lua` (`getSellValue`), `decompiled/obj.Customer.lua` (`getSellInfo`, `getBuyInfo`).
- `decompiled/data.Default.lua`: `itemValue`, `itemSellValue`, `rarityMod`.
