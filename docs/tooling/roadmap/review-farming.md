---
type: Review
title: Farming page review
description: Code review of the reopened Farming planner (2026-11-24, at 8b2ef45), with findings, feature ideas, a first batch and the choices left to the user.
timestamp: 2026-11-24
---

# Farming page review

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Farming page review

## Table of contents

- [Scope](#scope)
- [The page today](#the-page-today)
- [Findings](#findings)
- [Feature ideas](#feature-ideas)
- [First implementation batch](#first-implementation-batch)
- [Needs a design choice](#needs-a-design-choice)
- [Needs visual confirmation](#needs-visual-confirmation)

## Scope

Code-only review: `site/farming.html`, `web/src/ui/farming.ts`, `farming-worker.ts`, `web/src/tools/farming.ts` and
what it calls (engine, `quest-stats.ts`, profit `Solver`), `site/style.css`, the website doc. No browser (Chrome is
used by another session). Numbers below come from `farmingReport` run in Node on the example save (six level-60 heroes,
40 fights, 10 map runs, Solver grade 3), game code 3.18.

## The page today

- Step 1 Party: six plain selects (Front / Back × 3), restored from the Battle page's `battle-party:<save>`, otherwise
  the six highest-level heroes.
- Step 2 Sources: every quest with an enemy, grouped by level band in a fold, preselected at (max level − 12) to max level; a global
  "rare variants" box; the save's maps (all ticked); catalog maps at asc 0 / 1 (grade S) in a fold; 3 scroll selects
  for every map run.
- Step 3 Rank: fights per quest (40) and runs per map (10), then a worker simulates each source with common seeds and
  prices it with the profit Solver.
- Result: a "best use of your heroes' time" card (old `.enemy` style), three podium tiles, a 12-column sortable table
  (value/h, gold/h, essence/h, win, average grade, min/run, cost, loot, essence, deaths), and an explanation paragraph.

What a player wants: "with my party, what should I send it to, to earn the most gold or essence per hour?" One
trustworthy answer at a glance (where, how much per hour, is it safe), then the reasons and the runner-ups on demand,
on a phone. Every row must be a party the game would really start, and the figures must count every cost.

## Findings

| Id | Area | Severity | Problem | Fix |
|---|---|---|---|---|
| F01 | correctness | high | Party rules ignored: every quest is fought with the whole party. Solo quests (Hoarfrost Gathering, all bushes) get 6 heroes, party size caps are exceeded (Glacial Goliath takes 2, Desolation Wolf 3), Front 2 isn't required. More heroes also means more luck, so more loot. Example: Glacial Goliath +539 g/h with 6 heroes, −162 g/h with a legal 2-hero party; Hoarfrost Gathering 3,041 g/h with 6 heroes, 1,059 g/h with 2. | Per quest source, apply the Battle rules: `rulesOf` + `includedSlots` (`battle-rules.ts`, `battle-setup.ts`) give the heroes that fight (required slots first, then game slot order, capped). When `problemOf` is still set (Front 2 empty), show the row as "can't start" with the reason instead of figures. |
| F02 | bug | high | `persistParty` writes `battle-party:<save>` with only `slots` and `skills`, so editing the party here erases the Battle page's `locked` and `excluded`. Heroes ticked out on the Battle page still fight here. | Read and write the full `StoredParty` (`battle-links.ts`), keeping fields it doesn't edit, and leave out excluded slots when building the party. |
| F03 | correctness | high | Revive gold is computed (`revive_gold`, a lost quest kills everyone) but never subtracted from gold/h or value/h. Fatalis: 33 % deaths, 3,600 g per run left out; any 0 % source misses 10,800 g per run. | Add revive gold to the run's cost in `finish()` (`cost.revive`), and show it in the cost cell's tooltip. |
| F04 | correctness | high | Placeholder and out-of-tier quests are offered: "Region 5" ×3 (58–60, preselected at level 60), "Region 4 Other" ×3, "Weekly 15", "Region 6" (level 99), and the level-61 bosses (Karthas, Balor, Azuros, The Mighty Bush), although the max hero level is 60. | Build the list with `isFightable` (Battle's filter, `PLACEHOLDER_QUEST_IDS`) and `levelReq ≤ 60`. |
| F05 | correctness, UX | high | Map bosses and Treasure Bushes (questType 8) are listed as quests, and 6 are preselected at level 60. Each one is silently run as a whole grade-3 map run. The row still reads "👹 Treasure Bush · level 60", and the engine's note ("only in map runs, farmed with …") is never shown. Example: Treasure Bush L60 becomes Golem Revenge Map at 0.10 bushes per run, −12,520 g/h. | List board quests only (`isBoardQuest`, as roadmap U33 asked). The maps lists already cover them. |
| F06 | performance | medium | The page terminates the worker after every result (`stop()`), so the price Solver (about 2–2.5 s) runs again on every click. The doc says it is solved once per worker. | Keep the worker after `done`. Terminate it only on Cancel or on a new run while one is still busy. |
| F07 | correctness | medium | One "rare variants" box adds the rare version of every ticked quest. Rare quests only show up at random on the board, so they can't be farmed on purpose, yet they are ranked with the others. | See D4. Until then, tag rare rows "random offer". |
| F08 | correctness | medium | The quest level rule isn't checked: a hero can take a quest only when level > min(levelReq − 5, 0.75 × levelReq) (`levelling.ts`). The list shows quests far above the party. | See D7. |
| F09 | presentation | high | The results don't follow the Battle pattern. The headline card (old `.enemy` style, inline styles) and the #1 tile say the same thing. The 12-column table and a 5-line explanation paragraph come next, and the grade isn't first. | See D1. Win rate and grade first, value per hour as the main figure, the economics in collapsible details (`compactResult` from `battle-results.ts`). |
| F10 | presentation | medium | The grade is an average number ("4.3"). The site shows grade letters (`gradeBadge`, Battle's nearest letter). | Show the nearest-letter badge; keep the average in its tooltip. |
| F11 | mobile | high | 12 columns at 375 px: the table scrolls sideways, and the Source cell is `nowrap`. The party rows hold 3 selects with long "Name · Class lv 60" options. | Phone column set (#, Source, Value/h, Win, Grade) with the rest in row details (D1). Shorter option labels in the party picker (D2). |
| F12 | UX | medium | Setup is three long steps, and the Rank button sits under the source lists. Quests are about 100 checkboxes in fieldsets, catalog maps up to 52. There are no "none / near my level / all" shortcuts, and the fold's summary is a sentence. | See D3. As a quick win, put the run box above the lists (as the Simulator does) and keep the summaries short ("Quests · 12 ticked"). |
| F13 | presentation | medium | Explanation sentences break the no-explanation rule: the party paragraph, "Fewer runs is faster; map runs are the slow part.", "Scrolls on every map run (bought for each run)", the summary sentences, and the results paragraph. | Remove them. Put the value formula in a "?" tooltip on the Value column, and the shared-party note in the party header's tooltip. |
| F14 | conventions | low | Not using the shared helpers: a local `GRADES` (`dom.ts` has `GRADE_LETTERS`); owned map names built by hand (`modItemName` in `names.ts`, R1 F12 naming); "g/h" and minutes formatted by hand (`gold()`, `duration()`); "level" vs the site's "Lv"; inline styles; an emoji on every quest row and heading. | Switch to the helpers and CSS classes; drop the per-row emoji. |
| F15 | expansions | medium | With Scribe hidden (or no maps at all), the empty "Catalog maps" fold and the 3 scroll selects still show. On the Battle page, maps disappear in that case (U42). | Hide the maps blocks and the scrolls when no map can be picked. |
| F16 | CSS | medium | The Battle results rules (`/* u43 battle results */`, `#results .tiles …`) target the `#results` id, which this page uses too: the farming tiles get the Battle's compact sizing by accident. | Scope those rules to `.b3-results`, or rename this page's container. Check visually. |
| F17 | bug | low | Sorting by Source does nothing (the column has no value). "Essence / run" sorts as text. | `sortBy`: the shown name; the essence total. |
| F18 | correctness | low | Map runs that crash in the game's own code are dropped (`errors`) without a word, so a row can stand on fewer runs than asked. | Show "N of M runs" in the row's details when `errors > 0`. |
| F19 | correctness | low | The cached Solver ignores the game mode: Quick and Legendary saves are priced with Standard times and costs. The quest XP uses `D.questXpMod`, not `modeFactors` (`quest-stats.ts`). | Pass the mode to the Solver cache key, or document the limit in the value tooltip. Use `modeFactors`. |
| F20 | economy | medium | A map row adds the Scribe's craft time to the heroes' hours (E20 decision). An owned map is also charged its full production cost and craft time, although it is already made. Nothing on the row shows craft vs run time. | Show "craft X + run Y" in the time tooltip; owned-map pricing in D5. |
| F21 | accuracy | medium | 10 runs per map by default, and no sign of noise. Map rows swing a lot between seeds (rooms, treasure rooms). | See D6. Until then, raise the default to 30 (`farmingReport` default; map runs take about 15–60 ms each in Node). |
| F22 | UX | low | Event bosses (questType 6: Galam, Cragus, Odin, Faust) are preselected like regular quests, with no "Event" group or tag, unlike the Battle picker. | Group by region / event like `enemyGroups` (D3). |
| F23 | UX | low | A result stays on screen after the party or the sources change, with nothing to say it is out of date. | Dim the result and say "Party or sources changed: rank again". |

## Feature ideas

Ranked by value for effort (V = value, E = effort).

1. **Quest size ×N** (V high, E low): `FarmSource.amount` and `maxQuestAmount` already exist. Rank each quest at its
   best size (or ×1 and max, as Levelling does). Bigger quests change gold/h a lot.
2. **Open in Simulator from a row** (V medium, E low): the row's source becomes the Battle opponent
   (`battle-opponent`) and the same party is kept, to check a fight in detail.
3. **XP/h column for heroes below the cap** (V medium, E low): `xp_per_hour` is already computed (`quest-stats`
   rules). Show it when a hero in the party isn't at its tier's max level.
4. **Goal switch: gold, essence, XP or one item** (V high, E medium): rank by gold/h, by essence/h of a chosen
   essence, by XP/h, or by the cost per unit of a map-only drop (`map_only_unit_cost` is already computed).
5. **Per-source legal party, then best party** (V high, E high): after F01, run the Solver's party search per source
   (time budget) so each row shows its best legal party.
6. **Time budget instead of counts** (V medium, E low-medium): one "time" input like the Solver; the runs are spread
   over the sources, more on the top candidates.
7. **Daily plan** (V medium, E medium): "I play N hours": the top source's runs, gold, essence and revive cost for
   that time.
8. **Scroll loadout per map / best scrolls** (V medium, E high): reuse the Battle scroll search per map row.

## First implementation batch

Obvious fixes and quick wins, no design choice needed:

1. F01: legal party per quest source (`rulesOf` + `includedSlots`); "can't start" rows with the reason.
2. F02: keep `locked` / `excluded` in the shared party; leave out excluded heroes.
3. F03: subtract revive gold from gold/h and value/h; show it in the cost tooltip.
4. F04: drop placeholder and level-61+ quests (`isFightable`, `levelReq ≤ 60`).
5. F05: board quests only in the quest list (`isBoardQuest`).
6. F06: keep the worker (and its Solver) alive between runs.
7. F10: grade as a letter badge, the average in the tooltip.
8. F13: remove the explanation sentences; value formula in a tooltip.
9. F14: shared helpers (`GRADE_LETTERS`, `modItemName`, `gold()`, `duration()`), no inline styles, no per-row emoji.
10. F15: hide the map folds and scroll selects when no map can be picked.
11. F16: scope the Battle `#results` tile rules to the Battle page.
12. F17, F18: sortable Source and Essence columns; failed map runs counted on the row.
13. F21: default 30 runs per map.
14. Docs: update the Farming section of `website.md` and its log.

## Needs a design choice

- **D1 Results layout (F09, F11).**
  - A: Battle style. Summary tiles for the best source (win rate, grade, value/h, time per run), then a compact
    ranked list (source, value/h, win, grade); "Show details" opens the full table.
  - B: One card per source, ranked, mobile first: value/h big, win and grade badges, a fold for loot, costs, essence
    and deaths.
  - C: Keep the table, with a 5-column phone set and a row expander for the rest.
- **D2 Party editing (F11).**
  - A: Read-only party line (avatars, names, the slot of each) with "Edit in Simulator".
  - B: Reuse the Battle hero cards (include boxes, locks) on this page.
  - C: No party here: each row uses its best legal party (feature 5).
- **D3 Picking sources (F12, F22).**
  - A: The Battle picker's groups (region, event, map) as a multi-select with "near my level" ticked by default.
  - B: Preset chips ("My level", "Quest bushes", "My maps", "All maps asc 0", "All maps asc 1"), plus the full list
    folded.
  - C: A search box with chips for the picked sources, and presets as in B.
- **D4 Rare variants (F07).**
  - A: Remove them from farming (they can't be farmed on purpose).
  - B: Keep them as an extra row tagged "random offer", unticked by default.
  - C: No separate row: show the rare variant's value/h in the base quest's details.
- **D5 Owned maps and craft time (F20).**
  - A: Keep the current rule: production cost and Scribe craft time for every map.
  - B: Owned maps cost nothing and take no craft time; catalog maps pay both.
  - C: A "count Scribe time" switch (on: as today; off: run time only, since the Scribe works in parallel).
- **D6 Run counts (F21).**
  - A: One "Runs" input for quests and maps, like the Simulator.
  - B: A time budget, like the Solver.
  - C: Adaptive: a first pass, then more runs on the sources within reach of the best, and a ± on each figure.
- **D7 Level eligibility (F08).**
  - A: Hide the quests no party hero can take.
  - B: Show them greyed, with "needs level N" in the tooltip.
  - C: Per hero: leave out the heroes too low for the quest, like the party cap.

## Needs visual confirmation

- The results' old `.enemy` card and the podium tiles, with the Battle `#results` tile rules applied by accident
  (F16): sizes and spacing at 1280 and 375, before and after the scoping fix.
- The party rows at 375 px: three long selects per row, wrapping.
- The quest fieldsets and the 52 catalog-map checkboxes on a phone: height, tap targets.
- The table's sideways scroll inside `.table-wrap` on a phone, and the `nowrap` source cell.
- The drop zone on this page next to the Save dropdown of the menus (U44): both, or one?
- Win-rate colours (`rateTone`) and grade badges in dark mode (R1 F05 contrast).
- French names in the quest list, the map labels and the essence column.
