---
type: Review
title: Levelling page review
description: Code review of the reopened Levelling page (2026-11-24, at 8b2ef45), with calculations checked against the engine and game data, feature ideas, a first batch and the choices left to the user.
timestamp: 2026-11-24
---

# Levelling page review

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Levelling page review

## Table of contents

- [Scope](#scope)
- [The page today](#the-page-today)
  - [Murlok Monarch chaining](#murlok-monarch-chaining)
- [Findings](#findings)
- [Feature ideas](#feature-ideas)
- [First implementation batch](#first-implementation-batch)
- [Needs a design choice](#needs-a-design-choice)
- [Needs visual confirmation](#needs-visual-confirmation)

## Scope

Code-only review: `site/levelling.html`, `web/src/ui/levelling.ts`, `levelling-worker.ts`, `web/src/tools/levelling.ts`
and what it calls (engine, `combat.ts` party rules, `quest-stats.ts`, `consumables.ts`), `site/style.css`, the website
and combat-simulator docs, and the game code (`scene.QuestMenu.lua`, `obj.UIObject.lua`, `data.Default.lua`). No
browser (Chrome is used by another session). Numbers come from `levellingPlan` / `mapXpRate` run in Node 24 on the
example save (17 heroes, 15 at level 60 of ascension 2), 30 fights per quest, 10 map runs, game code 3.18.

## The page today

- Drop zone (or the Save dropdown), then three steps.
- Step 1 Hero: a native select ("Name · Class lv N"; default the lowest hero below its max level), a header with
  avatar, class, "level N of max" and ascension, and five companion selects labelled Front 2–3, Back 1–3.
- Step 2 Plan: seven fields (from, target, levels per step, quest size, minimum win, XP potion, fights per quest), a
  Plan button and a sentence. The worker simulates every board quest × (×1, max size) and every craftable map at each
  5-level band and keeps the best XP/h won often enough. Result: three tiles (time, runs, revive gold), a 9-column
  table and a 3-line explanation.
- Step 3 Next ascension: a 2-line intro, a reference quest select and a Compare button; result: now / after table
  (max level, enchant slots, size cap, 7 stats, win and HP removed), a cost card and the relevel plan in a fold.
- What a player wants: "which quest do I run now, at what size, and how long until max level?", the gold it costs,
  and "is ascending worth it?". Today the answer is there but behind 12 controls, a long run and a wide table.

### Murlok Monarch chaining

The earlier idea is covered and answered. Since E20 the Monarch (92) is not a quest (`isBoardQuest`: questType 8,
never on the board); the plan weighs whole Murlok Madness Map runs (map 7) instead, craft + run time. Measured for
the example Cleric: solo 0 % runs won at levels 46 and 56; with two level-60 companions 100 % won at asc 0, 12,679 XP
per run but 2.3 h per run, about 5,500 XP/h; asc 1 0 % won. The best quest at that level (Maexna ×5) gives 22,860 XP/h,
4× more. Nothing to add beyond F20 (show the best map in the alternatives, feature 2).

## Findings

| Id | Area | Severity | Problem | Fix |
|---|---|---|---|---|
| F01 | correctness | high | The plan ignores the expansion switches: map runs (Scribe) and Frentir quests (Frozen; open to an ascension-1 hero from level 49) are candidates whatever is owned. Only the step 3 quest list is filtered. | Build the plan's quest list with `isVisible("enemy", id)`; pass `maps: "none"` when `isHidden("Scribe")`, else only visible maps. Re-run hint on `subscribe`. |
| F02 | correctness | high | Quest access uses the join rule only (`heroPartyLevelReq`: level > min(levelReq − 5, 0.75 × levelReq)). The hero who starts a quest needs level ≥ levelReq − 2 × (tier − 1) (the quest board shows "Required level" otherwise), and the plan always makes the hero the starter (front 1 solo, front 2 party). It can pick quests up to 5 levels above what the hero may start. | `openableQuests(level, tier)` in `levelling.ts` for the hero; keep the join rule for companions. Test at a band start. |
| F03 | correctness | high | Quest launch gold is ignored: each quest costs `gold` × size (bushes 0). Example Cleric plan: about 60,000 g of launches (Maexna 30 g, ×5 = 150 g), shown as "0 g". Party plan (Guerrier + 5): Goblin Footman ×5 for 1,820 runs = 136,500 g. | `launchGold` per step and in the plan; one "Gold" tile (launch + revive + maps), the split in its tooltip. |
| F04 | correctness | high | The XP potion is applied to every fight and every map room from level 1, for free. In the game a Boost lasts 3 quests (3 rooms of a map), is usable from level itemLevel − 5 − 4 × (tier − 1) (XP Boost +2: level 50 at ascension 0, 42 at ascension 2) and costs gold. | Per band, the strongest XP Boost the hero may drink; potions = ceil(runs / 3) for quests; maps get the bonus on 3 rooms only; potion count and gold on the step. Option labels = item names from `names.ts` (XP Boost, +1, +2). |
| F05 | bug | high | "Back to max level" stops at the current tier's target: the relevel plan gets the page's `to` (50 for ascension 1), so for ascension 1 → 2 it counts hours to 50, not 60. A lowered target shortens it too. | Relevel with the new tier's max (drop `to`), and say which level ("Back to 60"). |
| F06 | correctness | medium | Solo quests take the whole party's size cap: `maxQuestAmount` sees every companion. Verified: an ascension-0 hero with an ascension-2 companion runs Forest Gathering ×5 alone (50 XP per run). | Size cap from the heroes `questRows` actually puts in the fight. |
| F07 | correctness | medium | Companions always join party quests and take an XP share; the hero alone (or with fewer) is never tried. A companion that isn't needed to win halves the XP, so adding companions (the "Stuck" advice) can slow the plan. | For a party quest evaluate both the hero alone and with the companions; keep the better XP/h among the winning ones and show who joined. |
| F08 | bug | medium | `questXpRate` and `mapXpRate` find the hero in the result by name and class. The example save has 3 "Cleric", 3 "Paladin", 2 "Magicien": with a same-named companion the death check (party quests put the companion in front 1, found first) or the map XP reads the companion. | Match by slot, or by `heroID`. |
| F09 | bug | medium | One hero can be picked in several companion slots (only the levelled hero is disabled); it then fights twice. | Disable the heroes already chosen in the other slots (or the chip picker of D3). |
| F10 | correctness | medium | The hero's current XP is ignored (rebuilt with `exp: 0`). Example Cleric at 59 has 61,519 of 92,000 XP: the last level is overstated by 67 %. | When From is the hero's level, subtract `raw.exp` from the first band. |
| F11 | UX | high | Results go stale: changing the hero, a companion or an option keeps the old plan and payoff on screen (and the remembered reference quest). | Clear or dim the results with a one-line "run again" when an input changes, as Battle does. |
| F12 | UX | medium | A hero at max level (15 of 17 in the example save) gets a 59 → 60 plan and "nothing more to unlock". | At max level, From defaults to 1 (plan a fresh hero of that class and ascension); say so in the hero header pill. |
| F13 | presentation | high | Twelve controls before the button (7 option fields + 5 companion selects), against "minimum at first glance". | First row: hero, target level, Plan. Companions and potion next; levels per step, quest size, minimum win and fights in an "Options" fold, same defaults. Layout: D1. |
| F14 | presentation | medium | Explanation sentences: under the button, the companion heading's parenthesis, the 3-line plan footnote, the 2-line step 3 intro (wrong for ascension 0 → 1: max level stays 50; "4 more enchant slots" hardcoded), the payoff note, "Simulated in X s with fixed seeds". | Remove them; one-line tooltips on the column headers that need it (XP/h, Win, Gold). |
| F15 | mobile | medium | Help lives in `title` attributes on inputs and selects: never shown on touch screens. | `tip()` (`tooltip.ts`) on the field labels, or drop the text (F14). |
| F16 | consistency | medium | Local helpers instead of the shared ones: own `hours()` ("3 d 4 h" only from 48 h; `duration()` switches at 24 h), `${fmt} g` instead of `gold()`, selects for 3–4-way choices instead of `segmented()`, "XP / hour" while Battle and the wiki show "XP / min" (`xpText`). | `duration(h × 3600)`, `gold()`, `segmented()` for quest size, minimum win and potion, XP / min with `xpText`. |
| F17 | presentation | medium | 9-column result table (levels, quest, size, win, XP/run, runs, hours, XP/h, revive gold): sideways scroll on a phone, unlike Battle's compact results. | Quick part: size in the quest cell ("Maexna ×5"), XP/run in a tooltip, revive gold only when > 0. Full layout: D2. |
| F18 | wording | low | "gathering" pill (the site says "Quest bush"), "Enemy HP removed", "Win (reference quest)", "Size", tile emoji 🪦. | "quest bush" pill, "Best damage" or "HP removed (best)", "Win", "Quest size"; drop the emoji (R1 F26). |
| F19 | correctness | low | A merged step shows its first band's win, XP/run and XP/h; runs are rounded up per band then summed (up to bands − 1 extra). | Show the step's average XP/h (XP needed / hours); runs = ceil(XP needed / XP per run) when XP per run doesn't change. |
| F20 | correctness | low | Map runs: asc 0 only, grade 3 fixed, the craft time added in full (the Scribe can craft the next map during a run); `mapGold` and the craft / run split are computed but never shown. | Show map gold and craft + run time in the step's tooltip; the rest stays a documented limit (maps lose by 4× here, see Murlok Monarch). |
| F21 | performance | high | Solo ascension-2 Cleric 1 → 60: 16 s in Node on a desktop, the last two bands 4–5 s each; with 5 companions 115 s. Phones are several times slower; the bar only moves once per band (stuck 5–25 s); band 1 with 500 fights runs for tens of minutes. | Progress per candidate; stop a quest's fights once its win can no longer reach the minimum (as `mapXpRate` `stopBelow`); try candidates best upper bound first; cap fights at 100 on the page. |
| F22 | performance | medium | Compare re-runs a full relevel plan on every click, and each run starts a new Worker that re-parses the game data. | Keep the worker alive between runs; cache the relevel plan by hero, tier and options. |
| F23 | mobile | medium | `.pf-options` (min 170 px) is one column at 375 px (343 px wide), the companion grid too: about 13 full-width controls before the button; the table scrolls sideways. | With F13: two-column options on phones (`minmax(140px, 1fr)`), companions as chips. |
| F24 | UX | medium | Hero selects show no ascension, and same-named heroes look identical (three "Paladin · Paladin lv 60"). | Add the ascension and a number for duplicates, or the Battle hero chips (D3). |
| F25 | UX | low | Companion slot labels are wrong: the "Front 2" companion goes to front 1 on a party quest (the hero takes front 2); companions never join solo quests; the heading says "the hero stands in Front 1". | No slot labels: "Companions" (up to 5), placed by the game rules; one tooltip says they join party quests and maps. |
| F26 | UX | low | Reference quest picker: 80+ quests, toughest first, no grouping. | Group by region (`regionName` optgroups), same default. |

## Feature ideas

Ranked by value for effort (V = value, E = effort).

1. **Gold of the plan** (V high, E low): launch + revive + potions + maps (F03, F04, F20), and the loot value of the
   runs from the profit Solver as a net figure.
2. **Alternatives per step** (V high, E low): keep the top 3 sources of each band (already simulated) in a fold under
   the step, with the best map run among them: answers "why not X?" (e.g. Murlok Madness Map).
3. **Open the step in the Simulator** (V medium, E low): quest, size and party passed through `battle-opponent` /
   `battle-party:<save>`.
4. **Companions from the Battle party** (V medium, E low): prefill from `battle-party:<save>`.
5. **Remember the options** per save (V medium, E low), and the last plan for the session.
6. **Level / time chart** (V medium, E low): `line-chart.ts`, level against cumulative hours, one colour per step.
7. **Fresh hero of any class** (V high, E medium): any class and ascension, gear from the save or none; makes the
   example save useful (15 heroes at max).
8. **Ascend-now verdict** (V medium, E medium): one line, hours and gold to get back to today's power on the reference
   quest.
9. **Level a whole party** (V high, E high): several heroes at once, the time until all reach the target.
10. **Best companions search** (V medium, E high): which companions unlock a better quest without halving the XP.

## First implementation batch

Obvious fixes and quick wins, no design choice needed:

1. F01: plan follows the expansion switches (quests via `isVisible`, maps off without Scribe).
2. F02: `openableQuests` for the hero (start rule levelReq − 2 × (tier − 1)); join rule for companions.
3. F03: launch gold per step and in a "Gold" tile (launch + revive + maps, split in the tooltip).
4. F04: XP Boost by level and charges (3 quests / 3 rooms), potion count and gold; option labels from `names.ts`.
5. F05: relevel to the new tier's max level, labelled "Back to N".
6. F06: size cap from the heroes in the fight.
7. F08: match the hero in results by slot or `heroID`.
8. F09: a hero can be picked in one companion slot only.
9. F10: subtract the hero's current XP from the first band.
10. F11: clear or dim results when an input changes.
11. F12: From defaults to 1 for a hero at max level.
12. F14, F15, F18: remove the explanation sentences and `title` help; short `tip()` tooltips; wording fixes.
13. F16, F19: `duration()`, `gold()`, `segmented()`, XP / min; step averages and runs.
14. F21, F22: progress per candidate, early stop under the minimum win, worker kept alive, relevel cached, fights
    capped at 100.
15. F25, F26: companion labels and the grouped reference quest list.
16. Tests (`levelling.test.ts`: start rule, size cap, potion charges, relevel target, current XP) and docs
    (website.md Levelling section, combat-simulator Levelling and prestige, logs).

## Needs a design choice

- **D1 First glance and options (F13, F23).**
  - A: Command bar. Hero picker, target level and Plan on one line; companions and potion on the next; an "Options"
    fold for levels per step, quest size, minimum win and fights.
  - B: Two tabs, "Plan" and "Next ascension", under a shared hero bar (Battle-style segmented); each tab has its own
    button and options fold.
  - C: One card per hero: the hero bar with "Plan to 60" and "Compare ascension" buttons; every setting in one
    "Options" fold shared by both.
- **D2 Plan results (F17).**
  - A: Battle style (`battle-results.ts`). Tiles (time, runs, gold), a compact step list (levels, quest ×size, time),
    "Show details" opens the full table (state remembered with `detailsOpen`).
  - B: Level bar. A horizontal 1 → 60 bar with one coloured segment per step; tap a segment for its card (quest, win,
    XP/min, runs, gold, alternatives).
  - C: Keep the table with a 4-column phone set (levels, quest, win, time) and a row expander for the rest.
- **D3 Companions (F07, F24, F25).**
  - A: Solo only, plus a "With my Battle party" switch that uses the Battle page's party on party quests and maps.
  - B: Hero chips (Battle style): pick up to 5, placed by the game rules; the engine tries the hero alone and with
    them on each party quest.
  - C: Automatic: per band, the engine picks the companions (none to 5) that give the best XP/h (slower: feature 10).
- **D4 Who starts a party quest (F02, F07).**
  - A: Always the levelled hero (strict start rule).
  - B: A higher-level companion may start a party quest (front 2) and the hero joins under the join rule: how players
    power-level, and it opens tougher quests earlier.
- **D5 XP potion (F04).**
  - A: Potion select as today, modelled per band (count and gold shown).
  - B: "Use XP Boost when it pays" switch: per band the engine compares the XP/h gain with the potion's gold.
  - C: Drop the option; show "with XP Boost +N: −X h, Y g" as a line under the plan.
- **D6 Next ascension (step 3).**
  - A: Keep it, compact: a verdict line (gains, gold, hours back) and the now / after table in a fold.
  - B: Move it to the save viewer's hero page as an "Ascend?" card; the Levelling page keeps one link.
  - C: Merge it into the plan: a "then ascend" switch makes a two-phase plan (now → max, ascend, 1 → new max).
- **D7 Map runs (F20).**
  - A: Keep them, with map gold, asc 1 and the craft overlap.
  - B: Drop them from the plan (4× worse here) and show the best map run only in the alternatives (feature 2).
  - C: Off by default, a chip "Include map runs".

## Needs visual confirmation

- 375 px: the option and companion stacks (F23), the 9-column table's sideways scroll, the tiles.
- The payoff table next to the cost card at 800–1280 px, and stacked below 800.
- Up / down colours (`--good`, `--bad`) and win-rate colours in dark mode.
- The progress bar and Cancel during a long run on a phone.
- The hero header: avatar with the ascension outline, pill wrapping.
- French names in the quest cell (`nowrap` with the pill) and the reference quest list.
- The drop zone on this page next to the Save dropdown (U44): both, or one?
