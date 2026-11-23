---
type: Analysis
title: Balancing findings
description: Profitability results from the profit model at grade 3, value allocation, crafter and Enchanter level 60, modifiers and enchanting included.
timestamp: 2026-11-23
tags: [balancing, ascension, essence, maps, modifiers]
---

# Balancing findings

[Root](../index.md) > [Findings](./index.md) > Balancing findings

Produced by the former `tools/profit.py`, now `profitReport` in `web/src/tools/profit.ts` (grade 3, luck 0, `--alloc value`, crafter and Enchanter level 60, map modifiers on,
hero time free), 2026-11-23. Model and its limits: [profit calculator](../tooling/profit-calculator/profit-calculator.md).
Rerun after any data change. The numbers are model output, not observed in play.

## Table of contents

- [Modifiers](#modifiers)
- [Enchanting](#enchanting)
  - [Order, Reset and modded ingredients](#order-reset-and-modded-ingredients)
- [Map enchanting](#map-enchanting)
- [Essence sources](#essence-sources)
  - [Forced sources and free by-products](#forced-sources-and-free-by-products)
- [Ascension margins](#ascension-margins)
- [Losers](#losers)
- [Top earners](#top-earners)
- [Class balance](#class-balance)
  - [Equal gear](#equal-gear)
  - [Potions and enchants](#potions-and-enchants)
  - [Levelling and prestige](#levelling-and-prestige)
- [Map runs](#map-runs)
  - [Scrolls](#scrolls)
- [Open questions](#open-questions)

## Modifiers

- Price effect is a rarity step, not the modifier itself ([selling](../game-economy/selling/selling.md#base-value)):
  - +1 modifier: ×1.14 to ×1.5 depending on base rarity; +2: up to ×1.71 (rarity 4).
  - Rarity 5: the 2nd modifier adds nothing. Rarity 6: modifiers add nothing. Rarity 7: ×1.25 max.
  - Modifier tier is ignored: a +12 suffix sells like a +1.
- Crafting rolls ([crafting](../game-economy/crafting/crafting.md#modifiers)), crafter level 60:
  - Item level 1–50: ~50% chance of at least one modifier, expected sell +14%.
  - Level 51–55: 31%, +7.5%. Level 56–60: 3%, +1%.
  - **Top gear (level 60) gets no modifiers from crafting** (craft grade 2). Only the Enchanter gives them.
- Ascending a modded item costs more essence (bumped rarity, ×5 or ×6) for the same ×2·asc value:
  - Upgrade to asc 1 pays for 5% of equipment plain, 3% with 1 modifier, 1% with 2.
  - Upgrade to asc 2 pays for 14% plain, 9% / 6% modded.
  - Exception: Archanos asc 1 → 2 gains 206k plain and 217k with 1 modifier.
- Map modifiers raise essence yield ~26%, which makes every essence ~20% cheaper.

## Enchanting

Rules: [crafting](../game-economy/crafting/crafting.md#enchanter). Model: [profit calculator](../tooling/profit-calculator/profit-calculator.md#enchanting).

- **+1 suffix is the cheap rarity step**: 94% per attempt on any item with a level-60 Enchanter, ~1.06 attempts.
  Cost ≈ `itemLevel × 60` gold + one rune (+ essence if ascended).
- First prefix is hard on top gear: 79% at level 1–20, 34% at 41–50, 10% at 56–60 (~11 attempts, rising rune cost).
- Slot-6 items (jewelry: rings, amulets; 61 priced) can't take a suffix; only the prefix route is open.
- When enchanting pays (best strategy per equipment):

| Asc | Sell as crafted | Enchant to 1 | Enchant to 2 | Median best margin |
|---|---|---|---|---|
| 0 | 529 | 123 | 5 | +113% |
| 1 | 503 | 128 | 26 | +15% |
| 2 | 412 | 163 | 82 | +100% |

- Level 56–60: a +1 suffix pays for 53 of 61 items. Below level 50 it rarely pays: the flat gold + rune
  cost exceeds the rarity step on cheap items.
- **Biggest single lever in the game**: Archanos asc 2 sells 673,760 plain, 842,200 after a ~9,900 g suffix (+168k).

### Order, Reset and modded ingredients

Rules confirmed in the game code, modelled as opt-in Solver options (E7, 2026-11-23; default report unchanged).

- **Enchant after ascending, never before.** 0 of 2,506 item × asc × modifier cases favour enchanting first: a modded
  item's ascension costs essence × (4 + mods) at its higher rarity. Iron Longsword asc 1 + prefix: 443 g after vs
  1,125 g before (210 vs 140 Forest Essence). The "before" route typically costs ~2×.
- **Reset before a prefix** pays for 214 of 1,971 item-asc combinations (high-level items crafted at grade C),
  1–5 resets, median ~3% / ~313 g saved. Fenrir's Shiv lv 58 grade C: 3 resets to A, prefix 34,063 → 31,591 g.
  Reset before a suffix never pays.
- **Modded ingredients** (prefix: +20% prefix odds and cap; suffix: +3% odds and cap per tier) almost never pay:
  1 of 339 equipment recipes (Neptune's Trident: +1,605 g EV for 1,051 g of enchanting); median +181 g EV against
  ~4.7k g to enchant the ingredient.
- All options on: best_profit improves for only 3 of 1,971 equipment rows (+595 g average). The base model was
  already near-optimal.

## Map enchanting

- **Enchanting maps doesn't change where orbs should come from**: every cheapest source stays a map "as crafted".
- It helps only expensive maps, by 3–15% per essence (11 of 66 map/essence sources), never enough to beat
  base or bridge maps:
  - Archon's Reality Map: Glacial 525 → 445 with +6 suffix & prefix (−15%).
  - Goons of Evil Map: Earth 80.8 → 77.0 with +2 suffix & prefix (−5%).
- Why: the climb costs `itemLevel × 60` gold + runes per attempt and rises with the tier, while the craft roll
  already gives ~+26% essence for free.
- Same result with `--alloc full`.

## Essence sources

Cheapest source per essence (cost per unit, maps crafted with their modifier rolls):

| Essence | Cost | Map |
|---|---|---|
| Forest | 4.0 | Tuvale Map |
| Water | 7.6 | Tuvale-Yarsol Map |
| Earth | 18.1 | Yarsol-Aldur Map |
| Necro | 40.6 | Aldur-Vulkrum Map |
| Fire | 61.0 | Vulkrum-Grimhal Map |
| Glacial | 113.1 | Grimal-Frentir Map |
| Nature (asc 2) | 5.3 | Tuvale Map asc 1 |
| Tidal (asc 2) | 9.1 | Tuvale-Yarsol Map asc 1 |
| Mountain (asc 2) | 22.9 | Yarsol-Aldur Map asc 1 |
| Death (asc 2) | 47.6 | Aldur-Vulkrum Map asc 1 |
| Inferno (asc 2) | 78.7 | Vulkrum-Grimhal Map asc 1 |
| Arctic (asc 2) | 125.6 | Grimal-Frentir Map asc 1 |

- **Hard and event maps are worse essence sources than base or bridge maps**, despite 4–10× the yield.
  Forest: Tuvale 4.0, Hard Tuvale 5.3, Goblin's Feast 8.6. Glacial: Grimal-Frentir 113, Treant Revenge ~946.
- Bridge maps (two regions, e.g. Yarsol-Aldur) win often: cheap, with good loot credit.
- With `--alloc full` the winners shift (Forest goes to Hard Tuvale at 8.3).
- Essence sells for ~5 g but costs 4–126 g to make: its sell price says nothing about its worth.

### Forced sources and free by-products

Profit model after E11 (2026-11-23).

- Forcing an essence to come from a map that consumes it is now priced as a fixed point. Forest Essence from Hard
  Tuvale: 5.65 g, from Tuvale-Yarsol 5.64 g, against 4.04 g from the cheapest source (Tuvale). Before, 196 of 2,203
  rows dropped out.
- Impossible cycles (a run yields no more than it consumes): Treant Revenge, Golem Revenge, Archon's Reality
  (Glacial Essence), Vanquishers (Necro Essence: 500 in, 500 out).
- **Free by-products**: at grade A, Tuvale Map pays for itself with its other loot (+32 g/run plus ~78 Forest/Nature
  Essence); at grade S, Tuvale and Yarsol Maps make +148 to +198 g/run plus ~95 essence. None at grade B. Essence
  cost is floored at 0 g, so these show as free rather than negative.

## Ascension margins

Median expected margin (`ev_margin%`) per (type, asc), with money-losing count:

| Type | Asc 0 | Asc 1 | Asc 2 |
|---|---|---|---|
| equipment | +104% (1/657 lose) | +15% (242/657 lose) | +97% (24/657 lose) |
| consumable | +1% (30/60) | +14% (27/58) | +110% (12/58) |
| map | −7% (18/28) | +49% (0/28) | — |

- **Asc 1 is the weak step**: value only doubles while essence is the main cost.
  Its median goes from −17% to +15% when map modifiers are counted, so it hinges on the essence price.
- Asc 2 (×4 value) pays, mostly for level-60 items.
- Normal maps mostly lose money when sold. They are worth it for the essence, not as goods.

## Losers

- Cheap rings/amulets ascended: Gnoll Ring asc 1 sells 144, costs ~3,500.
  Cause: essence amount follows level and rarity, not value.

## Top earners

- Best profit with enchanting: level-60 asc-2 gear + one suffix. Archanos ~756k, Protector's Stave ~663k,
  Archon's Embrace ~663k (vs ~597k / 524k / 524k sold as crafted).
- Expected margin at asc 0: Kraken's Grips +460%, Warlord's Ring +459%, Leviathan's Bite +455%.
- Maps at asc 1 per craft-hour: Goons of Evil Map ~140k g/h, Hard Tuvale Map ~77k g/h.

## Class balance

First combat simulator results, **your roster with its current gear** (former `tools/combat.py`, now `web/src/tools/combat.ts` and the battle page, 2026-11-23).
Model: [combat simulator](../tooling/combat-simulator/combat-simulator.md).

- Solo vs all 104 quests (40 fights each, ≥ 90% wins = soloable):

| Class | Heroes | Soloable quests | Avg win % | Avg turns (wins) |
|---|---|---|---|---|
| Berserker | 2 | 67.5 | 65.4 | 2.8 |
| Rogue | 2 | 64.5 | 64.7 | 1.9 |
| Assassin | 1 | 66.0 | 63.4 | 2.3 |
| Warrior | 1 | 64.0 | 62.9 | 6.1 |
| Paladin | 3 | 62.7 | 61.2 | 7.0 |
| Dark Knight | 2 | 61.5 | 60.2 | 3.3 |
| Mage | 2 | 60.0 | 59.7 | 2.4 |
| Cleric | 3 | 58.7 | 57.3 | 7.1 |
| Bard | 1 | 52.0 | 50.0 | 5.3 |

- Spread is narrow (52–68 soloable) but the Bard trails: support kit, little solo damage.
- Tanks (Warrior, Paladin) and Cleric win slowly (6–7 turns) → lower grades on timed quests.
- Matchups matter: the Warrior beats Twin Shadow but loses to Demon Mage (magic); Mages beat Demon Mage.
- Skill rotation: Berserker vs Demon Mage, `Enrage, Slash II, Vicious Strike, Basic, Blind Fury` kills in 2.5 turns
  instead of 3.2 with the saved rotation (77% vs 67% HP left).
- Gear: Berserker solo vs Nightmare Bison: best owned gear only removes 26% → 32% of its HP; a grade-S asc-2
  catalog set wins 100% in 3 turns.
- Endgame: best 6-hero party from the roster removes only ~7% of Odin's HP; Archon (quest 97) *shows* 0% but is not
  immune: 200k HP, def 1200 / mdef 1500 / eva 500 let ~1.8k damage through per fight, and Aeon Lash (attack all +
  self-heal 1× matk, twice per rotation, growing with the stacking Unleashed Power) heals it back to full; Soul Barrier
  reflects hits for 2 turns. The 0% is the end-of-fight HP. Game design, not a bug; the port matches the Lua
  (32 reference Archon fights).
- Joint optimiser (`optimiseFight`: party, rotations, owned gear, scrolls together; E9) on the full roster:
  Odin 8.9% → 19.8% of its HP removed at the lowest point in the 2-minute budget, 33.5% unbounded (288 s), still
  0% wins. Desolation Wolf was already 100% with the best party alone; Gnoll Vendetta asc 1 stays at 93% wins.
  Better rotations, not gear, gave most of the gain: Odin is out of reach for this roster, not misconfigured.
- Party order, row swaps and rotation timing (E14a): Odin 33.5% → 35.1% HP removed (Mage rotation one turn later
  alone: score 791 → 918), Archon 6.3% → ~10%. No fight flipped to a win. Enemy rotations are fixed 5-turn cycles
  that heroes can't interrupt (E13), so timing cleanses, heals and big hits against them is the lever.
- Lost fights are now scored by the enemy's lowest HP and total damage, with surviving longer a small plus (E14b).
  With that, Archon's best Mage rotation uses **Silence**, which removes Unleashed Power: the party survives 15
  turns instead of 10. The old score ranked it last. Still no win.
- The timing pre-filter (E14b) simulates 10–19× fewer rotations on won fights and ~2.5× fewer on lost ones, with
  the same win rates and equal or slightly better results.

### Equal gear

Every class at level 60, prestige 3, same-rule catalog gear (`fit`: grade 5, asc 0, the item that maximises the
class's main offence per slot), rotation and passive searched per quest, 50 fights per cell, same seeds
(`classMatrix`, `web/src/tools/classes.ts`, 2026-11-23). 10 quests from level 40 to 54.

| Class | Mean win | Soloable (≥ 90%) | Enemy HP removed | Damage dealt / fight | Damage taken / fight |
|---|---|---|---|---|---|
| Warrior | 79% | 8/10 | 88% | 6514 | 607 |
| Rogue | 79% | 8/10 | 88% | 6761 | 461 |
| Cleric | 78% | 7/10 | 85% | 6009 | 635 |
| Berserker | 77% | 7/10 | 88% | 6378 | 499 |
| Mage | 77% | 6/10 | 86% | 6506 | 508 |
| Dark Knight | 74% | 6/10 | 85% | 5975 | 647 |
| Paladin | 73% | 7/10 | 82% | 5581 | 1207 |
| Assassin | 67% | 5/10 | 82% | 5582 | 764 |
| Bard | 48% | 5/10 | 73% | 5045 | 971 |

- With gear equalised, **Bard is clearly the weakest solo class** (48% vs 73–79%): it loses Cerberus, Oni and
  Pumpking outright. Solo only, so its party support is not credited.
- **Assassin** trails mainly on Pumpking (0%, 83% HP removed); **Paladin** wins slowly (Pumpking in 18 turns) and takes
  twice the damage of the others.
- Your roster's Assassin ranked 3rd: its standing there came from gear, not class.
- Level-54 region-6 bosses (Desolation Wolf, Skorge) can't be soloed by any class at level 60.
- The game's default rotation is all Basic for every class; ranking with it measures stats + passive only.

### Potions and enchants

Potions (flat stats for 3 quests; a map run counts as one) and permanent enchants (E10, `rankConsumables`,
`consumableMatrix`, 2026-11-23).

- Your Odin party: the best potion per hero adds at most +2.2 points of Odin's HP removed (Berserker with Dex/Acc
  Boost +1 asc 2); no win. Your heroes use **0 of their 16 enchant slots**.
- Potions flip borderline fights. Standard level-60 heroes solo vs Demon Mage: Mage 14% → 100% and Cleric 4% → 100%
  with HP Boost asc 2; Bard 96% → 100% with Atk Boost +1 asc 2. Classes that already win gain only noise.
- The best potion depends on the opponent: Str/Atk Boost +1 asc 2 first for every class vs Arkyos, HP Boost asc 2
  first vs Region 5.

### Levelling and prestige

E12 (`levellingPlan`, `prestigePayoff`, 2026-11-23). Hero tier caps are level 50 / 50 / 60.

- Your level-60 tier-3 party earns 0 XP everywhere: it is at the cap.
- A tier-3 Berserker solo from level 1 to 60 takes **~34 h / 334 quests** on the best quest per band: Forest Gathering ×5
  (levels 1–16, ~6k XP/h), Goblin Enchanter, Maexna, Goblin Warlord (26–41, ~17k XP/h), Murlok Monarch ×5
  (41–60, ~41k XP/h). Quest size ×5 multiplies XP, so the size cap from prestige speeds levelling.
- Prestige tier 2 (level 50) → tier 3: HP 823 → 1,183, atk 919 → 1,159, def 404 → 444, enchant slots 12 → 16,
  quest size cap ×3 → ×5; costs 50,000 g and ~34 h of relevelling (enchants, potion and skills are reset).
  Against Nightmare Bison the lowest HP reached improves from 4% to 26% removed, still no win.
- Gathering quests (e.g. Forest Gathering) are excluded from the wiki's enemies but do give XP and are the best
  early levelling source.

## Map runs

Former `tools/combat.py maps` (now `cmdMaps` in `web/src/tools/combat.ts`) with front Guerrier, Paladin, Paladin and back Cleric, Mage, Berserker (20 runs per map),
2026-11-23. Full table: `reports/maps_survey.csv`.

- 29 of 52 map × asc combinations are farmable (≥ 90% wins; 20 seeded runs each). Bosses that stop the party: Balor
  (Grimal-Frentir), Gnoll Khan (Gnoll Vendetta asc 1), Fatalis, Karthas, the Revenge and Archon maps.
- **Won runs end at grade 5** (one at 4.6), not the grade 3 the profit calculator assumes: essence per run is
  ×1.5. Use grade 5 in the profit model for this party (roadmap E2 feeds the simulated grade in).
- Most essence per hour: Hard Tuvale 544 Forest/h (asc 1: 536 Nature/h), Goblin's Feast 479/h, Tuvale-Yarsol 310/h.
- Asc-1 maps give ~3–4× the loot value per hour (Hard Tuvale asc 1: 14.4k g/h), mostly the higher-value asc-2 essence.
- The tank dies in many won runs (Gnoll Vendetta +5: Guerrier 100% deaths, run still won).
- Level-70 maps can't be crafted (see [maps](../game-economy/maps/maps.md#level-70-maps)).

### Scrolls

- **Speed Scroll** is the farming scroll: −20% run time (Goons of Evil asc 1: 3.24 → 2.59 h), so ~+25% essence/h.
- Heal and revive scrolls only act between rooms. With the 6-hero party, damage happens in the fight that
  decides the run, so they change nothing: Goons of Evil asc 1 stays at 60% wins with any of the 286 loadouts.
- With a weaker party they decide the run: 3 heroes (Guerrier, Berserker, Cleric) on Hard Vulkrum go from
  2.5% to 87.5% wins with Healing +1 (1.7 charges used per run), Revive +1, Revive.
- Revive charges went unused: heroes only died in the fight that lost the run, never in a won room.
- Str/Int/Dex (+8%) don't flip boss fights for this roster.

## Open questions

- Should essence cost follow item value instead of level × rarity? It would fix cheap items at asc 1.
- Should the ascension cost of modded items stay higher when the price gain is capped by rarity?
- Should the price reflect the modifier tier (+12 vs +1)? Today only the count matters.
- Level-60 gear can't roll modifiers by crafting at max level. Intended?
- Are hard maps meant to be worse essence sources than base maps?
- Is a ~10k g suffix adding +25% to a 670k item intended? Price gain scales with value, enchant cost with level.
- Order of operations: enchant before or after ascending? Before raises the ascension essence (×5),
  after pays essence per enchant attempt. Not optimised yet.
- Next: Reset-to-raise-grade before a prefix; enchant-before-or-after-ascending order.
- Class balance on equal gear (standard heroes per class) to separate class power from gear.
- Remove or fix the level-70 maps (ids 27–32)? They're dormant but their generation crashes at grade ≥ 3.
