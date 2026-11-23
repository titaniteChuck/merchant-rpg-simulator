---
type: Mechanic
title: Expansions
description: The two paid expansions, Frozen and Scribe, what each one gates, where ownership is stored and how the site infers it.
timestamp: 2026-11-23
---

# Expansions

[Root](../../index.md) > [Game Economy](../index.md) > [Expansions](./index.md) > Expansions

Two paid expansions, `Game.expansion.Frozen` and `Game.expansion.Scribe`. The "everything" bundle includes both.
Boost potions are a separate purchase, not an expansion. Code: `web/src/tools/expansions.ts`.

## Table of contents

- [The two expansions](#the-two-expansions)
- [Where ownership is stored](#where-ownership-is-stored)
- [Gate kinds](#gate-kinds)
- [Frozen gates](#frozen-gates)
- [Scribe gates](#scribe-gates)
- [Content behind both](#content-behind-both)
- [Not an expansion: boost potions](#not-an-expansion-boost-potions)
- [Without an expansion](#without-an-expansion)
- [How the site infers ownership](#how-the-site-infers-ownership)
- [Code](#code)

## The two expansions

| Id | In-game name | Store title | Product id | Store text |
|---|---|---|---|---|
| `Frozen` | Frozen Tome | Frozen Expansion | `bearface.games.merchant.expansion.frozen` | A new region, more inventory, 2 hero slots, a new hero type and a new hero prestige level. |
| `Scribe` | Scribe | Scribe Expansion | `bearface.games.merchant.expansion.scribe` | Item ascension, a new crafter, maps & dungeons, more inventory, 3 hero slots, and more. |

- Store texts: `data.TextData-EN.lua:552-568` (`TEXT.expansionPurchase`). The name "Frozen Tome" is used in the
  news (`obj.GameClass.lua:1569`) and on the locked Bard (`data.HeroData.lua:875`).
- Products: `data.PurchaseData.lua:180-194`, purchase screen `scene.UnlockExpansionOverlay.lua:4-6`.
  Frozen also has a `.discount` product, bought with 200,000 gold off (`default.expansionDiscountGold`, `obj.GameClass.lua:1291-1307`).
- Unlocking: `GameObject:unlockExpansion` (`obj.GameClass.lua:534-555`).

## Where ownership is stored

- **`UserInfo.usr`**, `purchaseList`: product id → purchase time. Loaded at `obj.GameClass.lua:1171`;
  `checkPurchases` (`obj.GameClass.lua:523-532`) calls `unlock()` of every product whose time is > 0.
  The site never reads this file.
- **Steam DLC files**: `steamWrapper.checkPurchases` (`obj.gameNetworks.steamWrapper.lua:16-46`) reads marker files:
  `UI/Extra/froz.dlc` → `steam_frozen`, `UI/Extra/mm.dlc` → `steam_scribe`, `UI/Extra/all.dlc` → `steam_everything`.
  `steam_frozen`/`steam_scribe` add the product to `purchaseList` (`data.PurchaseData.lua:277-294`).
- **Everything bundle** `bearface.games.merchant.everything` (`data.PurchaseData.lua:213-243`): both expansions,
  all themes and skins, the boost potion recipes, crafters 6 and 7, 3 hero slots, full inventory; sets `Game.unlockAll`
  (`obj.GameClass.lua:1176-1178`).
- **Offline builds**: the "inlogic" and "offline" profiles set `NO_IAP` and `UNLOCK_ALL_PURCHASES` (`main.lua:16-33`).
- **PlayerData.txt has no ownership field.** It only carries side effects (see [inference](#how-the-site-infers-ownership)).

## Gate kinds

- **access**: the game blocks the feature itself and opens the purchase screen (region, class, prestige, crafter,
  maps, ascension).
- **obtain**: the thing exists for everyone, but its only sources are behind an expansion (items, materials).
  The site derives these from the data: an item is gated when no source (quest drop, parcel, craft, map) is reachable
  without the expansion.

## Frozen gates

| Gate | Kind | Where |
|---|---|---|
| Region 6, Frentir | access | `default.regionExpansions[6] = "Frozen"` (`data.Default.lua:778-785`), checked by `rightRegion` (`scene.QuestMenu.lua:130-137`) |
| Bard (class 9) | access | `scene.NewHeroMenu.lua:137-145` |
| Hero prestige 3, levels 51–60 | access | prestige 2 → 3 opens the Frozen screen (`scene.HeroStatsMenu.lua:61-62`); tiers 1–2 cap at level 50 (`heroLevelRequirement`) |
| +2 hero slots | access | `scene.HeroMenu.lua:561-584` |
| +16 inventory slots | access | `getExpansionSlots` (`obj.GameClass.lua:557-566`); more gold-bought slots (`scene.AddSlotOverlay.lua:16-29`) |
| Shop theme 7, merchant skin 12 | access | `obj.GameClass.lua:538-539` |
| Region-6 quests | access | `questData[q].region == 6` on the quest board: 72, 73, 77–90 (76 is a placeholder) |
| Region-6 materials | obtain | see below |
| Equipment 51–60, plus 654 and 660 | obtain | every craftable item above level 50; Glacial Dagger (654) and Glacial Wand (660) are level 50 but use Glacial Ingot/Lumber |
| Consumables 43–54, 56 | obtain | made from region-6 materials |

Frozen-only materials (48): 206–215 (the "Glacial" level-50 rarity-1 tier, incl. crafted 207, 209, 211, 213),
217–224, 226–233, 235–241 (region-6 drops), 243–250 (trophies of region-6 rare variants, e.g. Balorn, Pheramus),
252–254 (Obsidian, Oblivion Rune, Oblivion Crystal), 260–263 (Odin and Faust epic-boss drops).
The game itself uses the same rule when picking "collect" daily orders: no `itemLevel == 50 and rarity == 1`
material without Frozen (`data.OrderData.lua:67`).

## Scribe gates

| Gate | Kind | Where |
|---|---|---|
| Crafter 8, the Scribe | access | `scene.CrafterMenu.lua:122, 160`; unlocked by `unlockExpansion` (`obj.GameClass.lua:546-548`) |
| Maps & dungeons | access | map box on the main menu only with Scribe (`scene.MainMenu.lua:386-388`); maps are Scribe recipes |
| Map-only quests (questType 8) | access | never on the quest board (`scene.QuestMenu.lua:175`): map bosses 91–94, treasure bushes 99–103 |
| Crafter and item ascension | access | `scene.CrafterStatsMenu.lua:214`, `scene.EnchanterStatsMenu.lua:156`, `scene.CrafterMenu.lua:259, 306, 447` |
| Map-run orders | access | "Map Victory"/"Map Kill" daily orders (`obj.orders.OrdersComponent.lua:77`) |
| +3 hero slots, +16 inventory slots | access | `scene.HeroMenu.lua:561`, `obj.GameClass.lua:562` |
| Scribe recipes | obtain | `crafterID == 8`: maps 1–32, scrolls 60–69 |
| Essences | obtain | map rewards only: 33, 55, 84, 109, 140, 255 (tier 1), 273–278 (tier 2, asc-1 maps); excluded from orders without Scribe (`data.OrderData.lua:68`) |
| Map-boss trophies | obtain | 265–268 (bosses 91–94) |
| Locked recipes 764–780 | obtain | rarity 7, `locked = true` until Scribe (`obj.GameClass.lua:551-553`) |
| Ascended items | obtain | any item at ascension ≥ 1 |

## Content behind both

- Maps 21–28: Scribe recipes made from region-6 materials or Glacial Essence (27, 28 are level 70, uncraftable).
- Map-only quests 95–98 and 104: Protector of the Forest and King of the Mountain (region 1 in the data, level 60, fought
  only in maps 24 and 25), Archon, The Mighty Bush (map 32, uncraftable), and the region-6 Treasure Bush.
- Materials 255 (Glacial Essence), 269–272 (their trophies), 278 (Arctic Essence).
- Equipment 772–780 (locked recipes made from those trophies).
- Ascended level-51+ items: ascending costs the region's essence, Glacial (255) or Arctic (278)
  (`default.prestigeItemMaterial`, `data.Default.lua:574-603`).

## Not an expansion: boost potions

- Consumables 10, 11, 14, 25, 26, 32, 53, 54, 56 have `locked = true` and unlock with `boost.all` (`data.PurchaseData.lua:100-145`) or the
  everything bundle (`data.PurchaseData.lua:223-231`). `contentExpansion` returns no expansion for them,
  except 53, 54 and 56 (the +2 tier), which also need Frozen materials.

## Without an expansion

- Frozen: the region arrow past region 5, the Bard slot, prestige on a prestige-2 hero, and hero slots 14–15 open
  the Frozen purchase screen. Region-6 material, gear and potion recipes are listed but cannot be fed.
- Scribe: the Scribe slot in the crafter menu shows a price instead of gold; no map box, no ascension bars or buttons;
  the 17 locked recipes stay locked.
- With neither, hero slots 14–15 open the Frozen screen and 16–18 the Scribe screen.
- Hero slots above 13 are assigned to owned expansions first (`getExpansionNameForHeroSlot`, `scene.HeroMenu.lua:564-584`).
- Saving without Scribe drops the crafters' `ascLevel`, `prestigeLevel`, `prestigeXP` (`obj.Crafter.lua:144-148`).

## How the site infers ownership

`inferExpansions(save)` reads PlayerData.txt. It only proves ownership; it never disproves it.
The user can override each expansion by hand (`effectiveExpansions`).

| Signal | Proves |
|---|---|
| A Bard (class 9) hero | Frozen |
| A hero at prestige 3, or above level 50 | Frozen |
| A hero standing in region 6 | Frozen |
| A remembered quest amount (`qAmounts`) for a region-6 board quest | Frozen |
| Crafter entries with an `ascLevel` key (saved only with Scribe) | Scribe |
| Crafter 8 | Scribe |
| Maps in `mapInventory`, ascended items, essences, equipment 764–780 | Scribe |
| More than 13 heroes | at least one |
| More than 15 heroes (Frozen alone allows 15) | Scribe |
| More than 16 heroes (Scribe alone allows 16) | Frozen |
| More than 96 gold-bought inventory slots | at least one |
| More than 112 gold-bought inventory slots | both |

The committed example save (`site/data/example-save.txt`, an "unlock all" account) proves both.

## Code

- Library: `web/src/tools/expansions.ts` (`EXPANSIONS`, `contentExpansion`, `inferExpansions`, `effectiveExpansions`,
  `gatedItems`, `gatedQuests`). Tests: `web/test/expansions.test.ts`.
- `decompiled/obj.GameClass.lua`: `unlockExpansion`, `getExpansionSlots`, `checkPurchases`, `expansionPurchaseSelected`.
- `decompiled/data.PurchaseData.lua`, `decompiled/obj.gameNetworks.steamWrapper.lua`, `decompiled/scene.UnlockExpansionOverlay.lua`.
