---
type: Review
title: Profit page review
description: Code and data review of the reopened Profit page (2026-11-24, main 8b2ef45): findings, verified numbers, feature ideas, a first batch and the choices left to the user.
timestamp: 2026-11-24
---

# Profit page review

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Profit page review

## Table of contents

- [Scope](#scope)
- [The page today](#the-page-today)
- [Findings](#findings)
- [Numbers checked](#numbers-checked)
- [Feature ideas](#feature-ideas)
- [First implementation batch](#first-implementation-batch)
- [Needs a design choice](#needs-a-design-choice)
  - [D1 Map-only drops](#d1-map-only-drops)
  - [D2 One cost story with the wiki](#d2-one-cost-story-with-the-wiki)
  - [D3 Ranking metric](#d3-ranking-metric)
  - [D4 Columns](#d4-columns)
  - [D5 Ascension rows](#d5-ascension-rows)
  - [D6 Options on a phone](#d6-options-on-a-phone)
  - [D7 Orbs tab](#d7-orbs-tab)
- [Needs visual confirmation](#needs-visual-confirmation)

## Scope

- Code: `site/profit.html`, `web/src/ui/profit.ts`, `profit-tables.ts`, `profit-worker.ts`, `web/src/tools/profit.ts`,
  `wiki-items.ts` (U37 totals), `dom.ts`, the `pf-` block of `site/style.css`.
- Docs: [website](../website/website.md#profit-page), [profit calculator](../profit-calculator/profit-calculator.md).
- Data: `profitReport` run in Node 24 with the page defaults (grade B, luck 0, crafter and Enchanter 60, map modifiers
  on, Shared), and with Full. No browser, no screenshots: layout risks are inferred from the CSS.

## The page today

- One form: run grade, party luck, crafter level, Enchanter level, who pays for a run (Shared / Full), map modifiers,
  a forced map per orb. Any change re-solves the whole economy in a worker (3.6 s on a desktop in Node).
- Four tiles: most profit, most profit without orbs, items priced, cheapest orb.
- Tab "What to make": 2,203 rows (each item × ascension), 13 columns, sorted by profit of the best plan
  (sell / enchant to 1 / to 2 modifiers); filters name, type, ascension, level range, owned.
- Tab "Enchanting": 1,971 rows, suffix and prefix odds, tries, cost and net gain side by side (14 columns).
- Tab "Orb sources": cheapest map per orb (two tier tables), then all 77 map × orb rows.
- Optional save (in-page drop zone): "You have" column and "Only what I own" filter.
- What a player wants: "what should each of my crafters make next, and is it worth enchanting or ascending it",
  in one glance, with their own crafter levels; then "why does it cost that" on demand; orbs only when they ascend.

## Findings

| Id | Area | Severity | Problem | Fix |
|---|---|---|---|---|
| F01 | calculation | high | Map-only drops (trophies) still cost a whole run each: Khan's Horn 47,390 g (Shared) / 52,851 g (Full), 135× its 350 g sell value. The user's "really high price per unit" is **not resolved**. The same run is charged in full to every map-only drop and again to its orbs: Treant Revenge Map (99,782 g) makes Eternity Stone 99,782 g (1/run) **and** Log of the Protector 332,606 g (0.3/run), and its Glacial Essence pays (run − loot credit) / orbs, the credit counting the trophies at sell value. "Who pays for a run" is ignored for them. Effect: Eternity Fists, Master's Crown, Archon's Embrace, Archanos cost 5.38 M g (profit −5.2 M), Heart of Aeon 3.93 M (Aeon Soul 1.45 M) | [D1](#d1-map-only-drops); in every design, one run is never charged in full to two products |
| F02 | calculation | high | Level-70 maps (Hard Boss Rush 27, Weekly Boss Rush 28) are live: 4 ranking rows (112k–182k g), 4 orb-source rows (Glacial 271 / 475 g, Arctic 333 / 597 g per orb), entries in the orb selects; the level filter goes to 70. Max level is 60 | Drop rows with level > 60 in the worker (items, enchant, essence); level inputs 1–60. Engine follow-up: Solver skips maps with `itemLevel` > 60 |
| F03 | calculation, consistency | high | Profit "Cost to make" vs wiki "Total cost" (U37) disagree: median ratio 0.94, asc 1 median 1.62, 10th / 90th percentile 0.39 / 2.1, max 151 (Eternity Fists 5.38 M vs 35,510). "Sell − cost" has a different sign on 625 of 2,176 rows (29 %). Tuvale Map 555 vs 1,816; Iron Sword asc 2 165 vs 664 | [D2](#d2-one-cost-story-with-the-wiki) |
| F04 | calculation | high | Tier-2 orbs are priced below their own sell value: Nature 5.33 g (sells 25), Tidal 9.08 (35), Mountain 22.91 (45), Death 47.6 (55). Ascending to 2 looks cheaper than selling the orbs; an asc-1 map run that sells its orbs earns ~1,240 g (Tuvale Map asc 1, ~63 Nature Essence) and the page never says so. The Orbs intro "worth what it costs to farm, not its few gold of sell price" is false for tier 2 | [D2](#d2-one-cost-story-with-the-wiki) option C (orb cost = max(farm cost, sell value)); meanwhile remove the sentence |
| F05 | UX | high | Ranked by gold per item: level-60 asc-2 gear tops it (Eternal Wrath asc 2 +517k, 7 h 49 min of crafter time). Per crafter hour the top is different (Goons of Evil Map asc 1 140k g/h, Orous Spear asc 2 125k g/h, Neptune's Trident asc 2 111k g/h). Crafter time is the player's bottleneck; the page has no per-hour column (the model has `ev_profit_per_craft_hour`, not for the best plan) | [D3](#d3-ranking-metric) |
| F06 | mobile | high | `.pf-options` is `minmax(170px, 1fr)`: one column at 375 px (343 px content < 2 × 170 + 16), so 6 fields, a checkbox and the orb panel stack (~550 px) before any result. Tables of 13–14 columns scroll sideways with no sticky name column; `th { position: sticky }` sits in `.table-wrap { overflow-x: auto }`, so headers don't stick when the page scrolls | Grid `minmax(min(150px, 42vw), 1fr)` (2 columns); sticky first column ≤ 600 px; options collapsed on phones ([D6](#d6-options-on-a-phone)) |
| F07 | presentation | medium | 13 columns at first glance (Sells for, Average sale, Return, Modifier chance, Craft time, Cheapest way…). "Cheapest way" reads "Craft (crafter)" on 2,166 of 2,203 rows (98 %) | [D4](#d4-columns) |
| F08 | presentation | medium | Three rows per item (asc 0/1/2); the wiki shows one row with per-ascension outlined boxes (U37) | [D5](#d5-ascension-rows) |
| F09 | presentation | medium | Tiles "Items priced 2,203" and "Cheapest orb Forest Essence 4.0 g" tell the player nothing to do. "Cheapest orb" takes the min over all orbs, hidden ones included | Drop both; keep the two profit tiles (a per-hour tile with D3) |
| F10 | text | medium | Explanation sentences: the status line ("2,203 prices (each item at each ascension level); 136 items have no known source (events, weekly shop)… Worked out in 3.6 s." — the 136 also counts placeholders, random maps and materials, none of which are in the table), the Enchanting intro, the 3-sentence Orbs intro, the Items footnote, the "Orb sources" help line, count lines "N items and ascension levels" | Delete; the count goes into the "Show all N" line; meanings stay in header tooltips; errors stay |
| F11 | conventions | medium | Own helpers instead of `dom.ts`: local `gold`, `signed`, `percent`, `mins` ("7.8 h", "45.0 min" instead of `duration()` "7 h 49 min"); "Cost per orb" `fmt1 + " g"` instead of `gold(v, 1)`; the orb tier table hand-built | `gold()`, `goldNumber()` in tight cells, `duration(min × 60)`; `signed` built on `goldNumber` |
| F12 | conventions | medium | Old controls: grade `<select>` (battle pages use `segmented` D C B A S), static `.mode-switch` (the `dom.ts` comment keeps it only because the page was frozen), map-modifier checkbox, type / ascension `<select>` filters | `segmented()` for grade, who pays, ascension (Any / 0 / 1 / 2); `chipToggle()` for map modifiers, "Only what I own" and the type filters |
| F13 | translation | medium | "Cheapest way" stays English: crafter names ("Craft (Woodworker)") and quest names ("Quest: Reygar (40 g, 0.05 per run)"); Type column capitalises the raw key; orb tables show "1–10" bands, not region names | `crafterName`, `questTitle` (parse the id from the worker's `how`, or send ids); `ITEM_TYPE_LABELS`; `regionName` |
| F14 | expansions | medium | With Scribe hidden: the Orbs tab stays (empty tables), the "Cheapest orb" tile shows a value, "Orb sources" and "Count map modifiers" stay in the form | `isHidden("Scribe")`: no Orbs tab, orb tile, orb panel or map-modifier toggle (as the Solver in U42) |
| F15 | save | medium | The page has its own "Mark the items you own" panel with a drop zone and a `#save-status` line, beside the top-bar Save dropdown (U44) which already opens a save | Drop the panel; keep only hidden `#file` / `#drop` for `initSaveSource` (drop anywhere still works) |
| F16 | performance | medium | Every visit solves from scratch (3.6 s desktop; likely 8–15 s on a mid phone), though most visitors keep the defaults. Default result: 1.87 MB JSON, 201 KB gzipped. "Show all" builds 2,203 × 13 cells and rebuilds them on every search keystroke (180 ms debounce) and sort | Precomputed default result at build time (feature idea 4); cap rendering at 300 rows with "More" |
| F17 | text, docs | low | The forced-orb error says "the map you picked needs that orb to be made, so it can't be its only source": since E11 such sources solve as a fixed point; only maps that use at least as many orbs as a run yields fail (Treant / Golem Revenge, Archon's Reality with Glacial; Vanquishers with Necro). [Website](../website/website.md#profit-page) "Known engine limit" and the profit calculator's "no profit page yet" are stale | Reword: "<orb> can't come from <map> alone: a run yields fewer than its recipe uses"; fix both docs |
| F18 | presentation | low | Emoji in tab labels (💰 ✨ 🔮), unlike R1 F26 | Text labels: "What to make", "Enchanting", "Orbs" |
| F19 | UX | low | Crafter level, Enchanter level and luck are typed by hand; a loaded save knows each crafter's level and the heroes' luck | Feature idea 3 |
| F20 | UX | low | Enchanting lists 1,971 rows; a suffix pays on 419, a prefix on 236 | `chipToggle` "Only gains" (suffix or prefix net > 0), on by default |
| F21 | UX | low | Hero time is free (model `heroHourCost` 0, not exposed): quests and map runs cost only gold | Feature idea 5 |
| F22 | UX | medium | No way to see why something costs what it costs (Eternity Fists 5.38 M shows only "Craft (Armorsmith)") | Feature idea 2 |

## Numbers checked

- Sell multipliers ×2 / ×4 at asc 1 / 2 (`sellValue`): match the Asc tooltip.
- Orb cost = (map cost − loot credit) / orbs: Gnoll Vendetta Map (14,217.1 − 1,425.8) / 312.8 = 40.89 g ✓.
- Modifier chance `p_any` = prefix + suffix − both ✓. Return = profit / cost (Eternal Wrath asc 2: 517,496 / 94,983 =
  545 %) ✓. Best plan above the plain sell value comes from the modifier price (sell_1mod 622,500) ✓.
- Ascend route: Gnoll Ring asc 1 = 24 + 192 × 18.13 = 3,505 g ✓ (sells 144: a loss, correctly shown).
- Strategies: sell as crafted 1,678, enchant to 1 413, to 2 112; 406 of 2,203 rows lose money.
- Map-only drops (Shared / Full): Warlord's Edge 20,007 / 22,062; Tidal Hilt 31,483 / 35,302; Khan's Horn 47,390 /
  52,851; Beastly Fang 118,034 / 125,186; Eternity Stone 99,782 / 107,798; Log of the Protector and Ore of the King
  332,606 / 359,327; Aeon Soul 1,452,983 / 1,581,748.
- Orb sell vs farm cost: tier 1 Forest 5 / 4.04, Water 7 / 7.58, Earth 8 / 18.13, Necro 11 / 40.56, Fire 12 / 60.97,
  Glacial 15 / 113.07; tier 2 Nature 25 / 5.33, Tidal 35 / 9.08, Mountain 45 / 22.91, Death 55 / 47.6,
  Inferno 65 / 78.71, Arctic 75 / 125.64.

## Feature ideas

Ranked by value for effort.

| # | Idea | Value | Effort |
|---|---|---|---|
| 1 | Profit per crafter hour (best plan, craft + enchant minutes) as a column and tile; ranking per [D3](#d3-ranking-metric) | high | low |
| 2 | "Why this cost": a row expands to the recipe chain, each ingredient with its source and gold (reuse `recipe-chain.ts`) | high | medium |
| 3 | Settings from the save: each crafter's level (Blacksmith, Woodworker…), the Enchanter's, party luck; "Best per crafter" cards | high | medium |
| 4 | Precomputed default result shipped with the site (first view instant; solve only on a change) | medium | medium |
| 5 | "Value my heroes' time" (gold per hour, model `heroHourCost`) and a single sell multiplier for haggling and shop bonuses | medium | low |
| 6 | "What to do with what I own": sell, enchant or ascend each owned item (model `ascend_modded` rows) | medium | medium |
| 7 | Orb farming as income: map runs ranked by orb sell value − run cost (tier-2 orbs, F04) | medium | low |
| 8 | Settings in the URL (shareable), CSV export of the current table | low | low |

## First implementation batch

No design choice needed; one agent, one evening.

- B1 (F02): drop level > 60 rows (items, enchant, essence, orb selects); level filter 1–60.
- B2 (F11): `gold()`, `goldNumber()`, `duration()` from `dom.ts`; local helpers removed.
- B3 (F12): `segmented()` for grade, who pays and the ascension filter; `chipToggle()` for map modifiers, owned and type.
- B4 (F14): with Scribe hidden, no Orbs tab, orb tile, orb panel or map-modifier toggle.
- B5 (F09): tiles "Items priced" and "Cheapest orb" removed.
- B6 (F10, F04): explanation sentences removed (status line, intros, footnote, help line, count lines); the false orb
  sentence first.
- B7 (F13): crafter, quest, type and region names through `names.ts`.
- B8 (F18): tab labels without emoji.
- B9 (F06): options grid at 2 columns on a phone; sticky first column ≤ 600 px.
- B10 (F17): forced-orb error reworded; stale lines in [website](../website/website.md#profit-page) and the
  [profit calculator](../profit-calculator/profit-calculator.md) fixed.
- B11 (F20): Enchanting "Only gains" chip.
- B12 (F15): in-page save panel removed (top-bar Save dropdown only).

## Needs a design choice

### D1 Map-only drops

Khan's Horn today 47,390 g; Gnoll Vendetta Map run 14,217 g, 0.3 horns, 312.8 Earth Essence, 1,321 g other loot.

- **A. What the run costs beyond its other output.** unit = (run − other loot at sell − orbs at their cheapest cost)
  / drops, never below sell value; joint trophies (Eternity Stone + Log of the Protector) split that remainder by sell
  value. Khan's Horn ≈ 24,100 g. Still "farm this for that", without double charging.
- **B. Follow "Who pays for a run".** Shared: the run splits by value, orbs at their cost, trophies at sell. Khan's
  Horn ≈ 700 g, Eternity Stone ≈ 5,400 g (Archon gear drops from 5.38 M to tens of thousands). Full: today's whole
  run. One rule for quests, maps and trophies.
- **C. Not in gold.** Trophies show "3.3 runs of Gnoll Vendetta Map (9.2 h)"; items that need one get a badge, are
  left out of the default ranking (chip "Include map-boss gear") and show runs + hours instead of a profit.

### D2 One cost story with the wiki

The wiki prices raw materials and orbs at sell value; Profit prices everything at its cheapest source (quest share,
farm cost), but map by-products at sell value.

- **A. One model.** The wiki's Total cost becomes Profit's cost at default settings (precomputed table). Consistent;
  the wiki then shows farm costs (and D1's trophy prices) that depend on hidden settings.
- **B. Two named costs.** Wiki "Ingredients' value" (sell basis), Profit "Farm cost", each tooltip names the other;
  Profit gets a segmented "Price ingredients at: farm cost / sell value" that reproduces the wiki's number.
- **C. One rule, both pages (recommended).** An ingredient costs what you give up: raw materials and drops at sell
  value (the margin is what crafting adds); orbs at max(farm cost, sell value), since tier-1 orbs barely sell and
  tier-2 orbs sell above their farm cost (F04); trophies per D1. Profit's "farm everything" view becomes a toggle.
  The wiki keeps a simple per-item total, and the two pages differ only by the toggle.

### D3 Ranking metric

- **A. Per crafter hour by default.** Column "Profit / h" first, profit per item second; tiles "Best per hour",
  "Best per item".
- **B. Switch.** `segmented` "Per item · Per hour" above the table drives the sort, the Profit column and the tiles.
- **C. Per crafter.** One compact card per crafter (Blacksmith, Woodworker, Scribe…) with its best 3 per hour at the
  player's level; the full table below, collapsed.

### D4 Columns

- **A. Six fixed columns.** Item, Profit (or / h), Plan, Cost, Sells for, Craft time; the rest (average sale,
  modifier odds, return, source) in the row's expand panel (feature idea 2).
- **B. Column chooser.** "Columns ▾" with presets "Simple" (5) and "All" (13), kept in `localStorage`.
- **C. Cards on a phone.** ≤ 600 px: one card per row (name, profit, plan, cost), tap to expand; table on desktop.

### D5 Ascension rows

- **A. One row per item.** Profit, Cost, Sells for as U37 per-ascension boxes (`ascValues`); sort by the best box.
- **B. One ascension at a time.** `segmented` 0 / 1 / 2 above the table (default 0 without orbs owned); rows stay
  per variant but only one shows.
- **C. Best variant.** One row per item with its best ascension's numbers and its swatch; the other two in the
  expand panel.

### D6 Options on a phone

- **A. Summary line.** A `<details>` "B · luck 0 · crafter 60 · Enchanter 60 ▾", closed on phones, open on desktop.
- **B. Settings sheet.** A ⚙ button in the table toolbar opens a bottom sheet; results start under the top bar.
- **C. From the save.** With a save, settings come from it and the form is hidden behind "Change"; without one, A.

### D7 Orbs tab

- **A. One table grouped by orb.** One row per orb (chosen map, cost, orbs per run), expand for the other maps with a
  "Use this map" button that replaces the selects in the form.
- **B. Keep the two tier tables.** The 77-row list goes into a collapsed panel; the forced-map selects move here.
- **C. Out of Profit.** Orb sources live on the wiki's essence pages; Profit keeps a one-line "Orb prices" panel.

## Needs visual confirmation

- B9 at 375 px: two-column options, sticky first column with the asc outline, header row.
- B3: segmented grade and who pays inside the options grid, light and dark.
- Header tooltips on touch: a tap on a sortable header both sorts and should show its tip; the "Modifier chance"
  per-cell tooltip.
- Tabs row on one line at 375 after B8; long FR / RU item names (`nowrap`) in the Item column.
- B4 with Scribe hidden: no empty space where the Orbs tab and toggle were.
- "Show all" (2,203 rows) on a phone: scroll and re-render jank.
- `pf-gain` / `pf-loss` contrast in dark mode; the busy dimming (0.55 / 0.45).
