---
type: Mechanic
title: Quests
description: Quests cost launch gold and hero time and drop raw materials through fixed rewards and parcels.
timestamp: 2026-11-23
---

# Quests

[Root](../../index.md) > [Game Economy](../index.md) > [Quests](./index.md) > Quests

A quest is one enemy (or gathering spot) in `questData` (104 entries).
They are also the enemies inside [maps](../maps/maps.md).

## Table of contents

- [Cost](#cost)
- [Drops](#drops)
  - [Fixed rewards](#fixed-rewards)
  - [Parcels](#parcels)
- [Rare variant](#rare-variant)
- [Code](#code)

## Cost

- Launch cost: `gold` per enemy. Gathering quests cost 0.
- Hero time: `time × gradeTime[grade]` per enemy, plus battle time.
- Multi-enemy runs multiply cost and fixed drops.

## Drops

Two fixed rewards and two parcels per quest.

### Fixed rewards

`rewardA1`, `rewardA2` = `{materialID, min, max}`.

- Roll `x` uniformly in `[min·gradeBonus·10, max·gradeBonus·10]` (floats truncated).
- Quantity = `clamp(round((x + partyLuck) / 10), 0, 5)`.

### Parcels

`rewardA3`, `rewardA4` name a loot table in `parcelData` (124 tables).

- One roll per parcel. Nil weight = `max(nilOdds · gradeParcelBonus[grade] − partyLuck, 1)`.
- Each entry has `odds`, an id and an `amount`:
  - `id = {materialID}`: material. `amount = {a1, w1, a2, w2…}` is a weighted amount, `{n}` a fixed one.
  - `id = {itemType, itemID}`: one item (e.g. an equipment drop).
- Better grade and luck shrink the nil weight, so more drops.

## Rare variant

- Quests with `questType > 2` can show up as a rare version: `nameB`, `goldB`, `expB`.
- Rare drops use `rewardB1..B4`.
- Boss trophies (e.g. Venom's Fang, Balorn's Fur) only drop from rare variants or inside maps.
- Which version is offered is random, so the player can't pick it.

## Code

- `decompiled/obj.combat.lootService.lua`, `decompiled/obj.Quest.lua`, `decompiled/obj.combat.questService.lua`.
- Data: `decompiled/data.QuestData.lua`, `decompiled/data.ParcelData.lua`.
