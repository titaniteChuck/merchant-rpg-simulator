---
type: Review
title: Mobile presentation review R3
description: Presentation review of the reworked Levelling, Profit and Farming pages on phones (375 px), with checks at 768 and 1280 px, light and dark, with and without a save, and after a plan, a solve and a rank; 38 findings, each a quick fix or tied to a page design choice.
timestamp: 2026-11-25
---

# Mobile presentation review R3

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Mobile presentation review R3

## Table of contents

- [Scope](#scope)
- [Top 10](#top-10)
- [Levelling](#levelling)
- [Profit](#profit)
- [Farming](#farming)
- [Cross-cutting](#cross-cutting)
- [Quick fixes](#quick-fixes)
- [Counts](#counts)

## Scope

Local build of `e3c8ab7` (after P1/P2, F1/F2, L1/L2), served from a separate folder. Pages: Levelling (setup, a plan,
a Next ascension compare), Profit (default answer, a re-solve at grade S, Enchanting tab, Orbs tab with a save, a cost
breakdown opened), Farming (setup, sources, a rank). 375 px first, then 768 and 1280, light and dark, with the example
save and without. The example save has every hero at ascension 2, so the compare was shot with a copy where Guerrier is
ascension 1, level 50.

Errors: a check-site sweep of the three pages × 3 widths × 2 themes × save / no save (36 runs) passed: **no console
error, no 404, no page wider than the viewport, no broken menu**. Run times on a desktop: plan 1.0 s, compare 2.0 s,
Profit re-solve under 2 s, rank 4 s. The real problems are clipping the sweep can't see: on all three pages the figure
the page exists for sits off screen at 375 (Profit F13, Farming F25, Levelling compare F06), and segmented controls wrap
at 768 and 1280 (F05, F17).

Design choices D1–D7 of [Levelling](./review-levelling.md#needs-a-design-choice),
[Profit](./review-profit.md#needs-a-design-choice) and [Farming](./review-farming.md#needs-a-design-choice) (mockups in
`drafts/`) are not re-reported; a finding names one only when it adds evidence. Where a choice is pending but the page
is unusable meanwhile, the fix column gives an interim step.

Severity: high = blocks or hides the main task on a phone; med = costs a screen or more, or confuses; low = polish.

## Top 10

| Id | Sev | Page | Finding |
|---|---|---|---|
| F13 | high | Profit | At 375 the table shows Item and Type only (with a save); Profit is at x 464, "Cost to make" (P2's tap feature) at x 1,008 |
| F25 | high | Farming | At 375 Value / h, the ranking metric, is off screen; the visible Win / Grade are 100 % · S on 17 rows, so the order looks random |
| F06 | high | Levelling | Compare table at 375 shows only "Now"; After and Change, the point of step 3, are off screen |
| F26 | high | Farming | Podium tiles don't name the source: "#1 · map 3,544 g/h"; the name is only in the table 330 px lower |
| F02 | high | Levelling | After Plan nothing visible changes: the result starts below the button and the answer (quest) is at y 1,304 |
| F12 | high | Profit | P1's two-column options fix doesn't apply at 375: still one column, the first result row at y 1,052–1,269 |
| F01 | high | Levelling | Plan button at y 938 on an 812 px screen, after 5 empty companion selects and 7 option fields |
| F37 | high | All three | Tables still scroll sideways with no edge fade (R2 F51); the useful columns are the hidden ones |
| F05 | med | Levelling | Segmented controls wrap at 768 and 1280 ("Max", "99%", "XP Boost +2" alone on a second line) |
| F27 | med | Farming | Tiles and Value / h say "g/h" for a value that includes essence: #1 "3,544 g/h" while its Gold / h is −1,283 |

## Levelling

| Id | Sev | Viewport | Finding | Fix | Kind |
|---|---|---|---|---|---|
| F01 | high | 375 | First screen: hero select, a 70 px hero card, "Companions" and five "— none —" selects (3 rows, ~170 px), then the plan card with 4 number fields and 3 segmented rows. The Plan button is at y 938–981, below the fold of an 812 px phone. | Covered by the open choice; evidence: with all defaults kept, 12 controls and ~500 px sit between the hero and the button. | needs design choice (→ D1 of Levelling, D3 for the companions) |
| F02 | high | 375 | After Plan (1 s), the results appear under the button: tiles at y 999, the steps table (the answer: "Maexna ×5") at y 1,304. The user who just tapped the button at the bottom of the screen sees no change. Same for Compare (table at y 1,212). | Scroll `#plan-out` / `#prestige-out` into view when a run ends (`scrollIntoView({ block: "start" })`), as the Solver does on Show. | quick fix |
| F03 | med | 375 | Steps table 565 px in a 341 px wrapper: Time cut ("21 I"), XP / min and Gold off screen. Time and Gold repeat the tiles. | Phone set Levels / Quest / Win / Time, the rest in the row tooltip. | needs design choice (→ D2 of Levelling) |
| F04 | med | 375, 768, 1280 | Three tiles take 279 px at 375 (Gold alone on a full-width row, 130 px tall each with icon and decorative disc) for three numbers. Sublines repeat: "levels 53 → 60" is the table's first cell, "launch 28,960 g" equals the value when there is one part. | Three tiles on one row at 375 (R2 F53 tile size); subline only when the gold has two or more parts; drop the levels subline. | quick fix |
| F05 | med | 768, 1280 (375: potion only) | Segmented controls wrap inside the options grid: at 768 "Max", "99%" and "XP Boost +2" each sit alone on a second line; at 1280 the same three, with the 4-button win rate in a 2×2 block. At 375 the XP potion wraps ("XP Boost +2" alone). | `.seg { flex-wrap: nowrap }` and let a segmented field span the columns it needs (`grid-column: span 2` above 600 px); potion labels "None · Boost · +1 · +2" with the full name in the tooltip. | quick fix |
| F06 | high | 375 | Compare table (536 px in 341): only Stat and "Now (ascension 1)" show; "After (ascension 2)" and "Change" are off screen. The first header cell is empty. | Phone columns Stat / After / Change (Now in the Change tooltip), or the Change column right after the stat. | quick fix |
| F07 | med | all | The default reference quest says nothing: for a level-50 ascension-1 Warrior it is "Lv 50 · Skorge", won 0 % now and 0 % after ("Win =", "HP removed 1.1 % → 3.4 %"). | Default to a quest the hero wins now (the plan's last quest, else the toughest quest below the hero's level − 5); keep the toughest one in the list. | quick fix |
| F08 | low | 375 | For an ascension-2 hero (every hero of the example save), step 3 is a red-numbered heading plus "Cleric is at the last ascension: nothing more to unlock." (~90 px). | Hide the section (or one muted line under the plan with no heading). | quick fix |
| F09 | low | 375 | The hero card repeats the select: "Cleric (3) · Cleric · Lv 53 · Asc 2" above, then "Cleric" with pills "Cleric", "level 53 of 60", "ascension 2". Name and class are the same word for this save's heroes. "level 53 of 60" breaks the Lv rule (R2 F56). | Keep the avatar and only the information the select lacks ("Lv 53 / 60", the "planned from level 1" pill), on one line beside the select. | quick fix |
| F10 | low | 375 | Two red primary buttons per screen on an ascension-0/1 hero ("Plan levelling", "Compare with ascension 2"), 80 px apart when no plan is shown. | Compare as a secondary button. | quick fix |

## Profit

| Id | Sev | Viewport | Finding | Fix | Kind |
|---|---|---|---|---|---|
| F11 | med | 375 | No save: the Orbs tab, the "Most profit, no orbs" tile and the map-modifier chip are gone (nothing is owned without a save, U28), so the default answer is Neptune's Trident 46,550 g; with the example save it is Eternal Wrath 517,496 g. Nothing on the page says the no-save view is the base game only. | One muted line under the tiles when no expansion is owned: "Base game · add expansions in 📜 ▾" (or the expansion badge). | quick fix |
| F12 | high | 375 | P1's F06 fix (`minmax(min(150px, 42vw), 1fr)`) gives one column: the card's inner width is 313 px < 2 × 150 + 16. Run grade, luck, crafter, Enchanter and hero time stack (~400 px); results start at y 641 (no save) / 726 (save), the first table row at y 1,052 / 1,269. | `.pf-options { grid-template-columns: repeat(2, minmax(0, 1fr)) }` at 600 px and less (segmented fields full row). | quick fix (D6 of Profit still decides the fold) |
| F13 | high | 375 | The table shows the wrong columns: without a save Item / Type / Lvl, with a save Item / Type only (the item cell is ~230 px with icons and badge). Profit is at x 409–464, "Cost to make" at x 958–1,008: P2's "tap a cost to see how it's built" needs 600 px of sideways scrolling. Type is "Equipment" on every row the chips leave. | Evidence for D4: on a phone the table shows none of the six columns of option A. Interim: column order Item / Profit / Cost to make / Best plan, Type and Lvl at the end. | needs design choice (→ D4 of Profit) |
| F14 | med | 375 | With a save, "Most profit" tiles: the item name at ~24 px wraps to two lines inside its ascension outline with ❄ 🖋 icons; "MOST PROFIT, NO ORBS" wraps; the two tiles take 188 px. | Name at body size on one line (ellipsis, full name in the link), no expansion icons in tiles, label "No orbs". | quick fix |
| F15 | med | 375, 768 | Each row's item cell carries the ascension three times (outline, P2's badge, Asc column) plus the ❄ 🖋 expansion icons, on 2,000 rows. At 768 the badge and the Asc column are both visible (P2 meant the badge for phones). | No expansion icons in Profit tables (the expansion menu already filters); badge only at 600 px and less, where the Asc column is off screen. | quick fix |
| F16 | low | no save, all | With orbs hidden the Asc column is "–" on every row, in What to make and Enchanting. | Hide the Asc column when `orbsHidden()`. | quick fix |
| F17 | med | 768, 1280 | Run grade (D C B A S) wraps "S" to a second line at 768 and at 1280; "Count map modifiers" wraps to two lines at 768. | Same as F05: segmented fields don't wrap and span what they need; chip `white-space: nowrap`. | quick fix |
| F18 | med | all | Form help is in `title` attributes (Run grade, Party luck, Crafter level, Enchanter level, Hero time, Shared / Full, the modifier chip): never shown on touch. Column tips say "Hover a name…", "Click a value…", "Hover a value…". | `labelTip()` / `tip()` as Levelling does since L1; "tap" wording in the tips. | quick fix |
| F19 | low | 375, 1280 | Cost breakdown: at 375 the amounts wrap ("2,002 / g", "3,593 / g"); at 1280 the expandable ingredient lines put their amount right after the text while plain lines align it right (1,000 g, 637 g, Total). | `white-space: nowrap` on amounts; the `<summary>` rows full width so their amount aligns with the others. | quick fix |
| F20 | low | all | ~55 px of empty space between the "2 Results" heading and the tiles: the empty `#status` line keeps its height after a result. | Collapse `#status` when empty (`:empty { display: none }`). | quick fix |
| F21 | low | 1280, no save | The lone "Most profit" tile stretches across 1,248 px (130 px tall). | Cap tile width (or tiles in a row with the tabs). | quick fix |
| F22 | low | 375 | Rows of the sticky Item column lose their bottom border on some rows (every few rows the line starts at x 207), seen with a breakdown open. | Border (or inset box-shadow) on the sticky cell itself; confirm on a real phone. | quick fix |
| F23 | low | 1280 | What to make is 1,453–1,591 px wide at 1280: Craft time cut, "Cheapest way" and "You have" off screen on a desktop. | Covered by D4. | needs design choice (→ D4 of Profit) |
| F24 | low | all | Header "Lvl" while the site rule is "Lv" (R2 F56, `LV` in dom.ts). | `LV` in the Profit headers. | quick fix |

## Farming

| Id | Sev | Viewport | Finding | Fix | Kind |
|---|---|---|---|---|---|
| F25 | high | 375 | Table 1,144 px in 341: # / Source / Win / Grade show, Value / h starts at x 368. Win and Grade are "100.0 %" and "S" on 17 of 23 rows, so the ranking looks arbitrary: rank 4 is grade A among S rows, three 0 % rows rank above a 62.5 % row. | Evidence for D1: F2 put Win and Grade beside Source, which pushed the ranking figure off the phone screen. Interim: Value / h as the third column, drop the # column (row order is the rank). | needs design choice (→ D1 of Farming) |
| F26 | high | all | The podium tiles don't say what to farm: "#1 · map / 3,544 g/h / 100.0% wins · 79.2 essence/h". The name is only in the table, 330 px further down at 375. | Tile label = the source name (with its map icon), "#1" as the icon. | quick fix |
| F27 | med | all | "g/h" on a figure that is not gold: #1 shows "3,544 g/h" while its Gold / h is −1,283 (the rest is 79 essence/h priced in gold). 6 of the 23 rows have a positive Gold / h. | Tile value "3,544 value/h", subline "−1,283 g + 79.2 essence /h"; same wording in the Value / h header tip. | quick fix |
| F28 | med | 375 | Three tiles take 329 px (third alone on a full-width row); the table's first row is at y 1,133. | Evidence for D1 (option A or B); meanwhile three tiles on one row (F04). | needs design choice (→ D1 of Farming) |
| F29 | med | 768, 1280 | Negative Value / h is bold black like the positives; 17 of 23 rows lose gold and nothing marks it, while Win is coloured. | Loss colour (Profit's `pf-loss`) on negative values, muted for zero. | quick fix |
| F30 | med | 375 | Party: six full-width selects (~350 px) with "Cleric · Cleric Lv 60": no ascension, no number for same-named heroes (3 Clerics, 3 Paladins in the example save), unlike Levelling since L2. | `heroLabels()` from `levelling-view.ts`; the layout stays with D2. | quick fix (layout → D2 of Farming) |
| F31 | low | 768 | Party rows wrap: two selects beside "Front", the third alone under the label; same for "Back". | Grid: label column + 3 equal columns, or 2 per row below 900 px. | quick fix |
| F32 | low | 375 | Scroll selects cut: "— no scr" × 3. | Option label "None" (or "–"), selects sized to content. | quick fix |
| F33 | med | all | Help is in `title` attributes: cost split (Quest gold · Map · Scrolls · Revives), F20's craft + run time split, average grade, the "random offer" tag, "left out", the Party heading, Scrolls. None shows on touch. | `tip()` as on Levelling. | quick fix |
| F34 | low | all | Map rows show two grade badges side by side: the map item's own grade next to its name, then the run grade in the Grade column (both "S" on rows 1–3). | Map item grade as plain text or in the map's tooltip in this table. | quick fix |
| F35 | low | 375 | Source cells wrap their "· Lv 51" (and "+5", the badge) to a second line, so row heights vary 40–64 px. | Level as a muted subline on every quest row (fixed two-line rows) or no level for maps. | quick fix |
| F36 | low | 768, 1280 | "Essence / run" is blank on quest rows while "Essence / h" shows "0.0". | "–" in both. | quick fix |

## Cross-cutting

| Id | Sev | Viewport | Pattern | Fix | Kind |
|---|---|---|---|---|---|
| F37 | high | 375 | **Tables scroll with no cue** (R2 F51, still open): Levelling steps (565 px) and compare (536), Profit What to make (1,453–1,591), Enchanting, Farming (1,144) all scroll inside a 341 px `.table-wrap`. R2-A's edge fade covers `.tabs`, `.topnav` and `.scroll-row`, not tables. On all three pages the hidden part holds the main figure (F06, F13, F25). | The same scroll-driven mask on `.table-wrap` at 600 px and less; the per-page column orders above. | quick fix |
| F38 | med | all | **Touch help**: Levelling moved to `tip()` in L1, Profit and Farming still use `title` (F18, F33), and Profit column tips say "hover" / "click". | One rule for the three pages: no `title` for help, "tap" wording. | quick fix |

## Quick fixes

F02, F04, F05, F06, F07, F08, F09, F10, F11, F12, F14, F15, F16, F17, F18, F19, F20, F21, F22, F24, F26, F27, F29,
F30, F31, F32, F33, F34, F35, F36, F37, F38 (32). Tied to a pending design choice: F01 (Levelling D1, D3), F03
(Levelling D2), F13 and F23 (Profit D4), F25 and F28 (Farming D1) (6). F12 and F30 are quick fixes that leave the rest
of their layout to Profit D6 and Farming D2.

## Counts

38 findings: 8 high (F01, F02, F06, F12, F13, F25, F26, F37), 15 medium, 15 low. Errors: none found by check-site
(36 runs). Screenshots stay local (agent scratchpad, `r3/`).
