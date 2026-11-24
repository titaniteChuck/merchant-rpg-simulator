---
type: Review
title: Mobile presentation review R2
description: Presentation review of the site focused on phones (375 px), with checks at 768 and 1280 px, light and dark, with and without a save; 58 findings by page plus cross-cutting patterns.
timestamp: 2026-11-24
---

# Mobile presentation review R2

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Mobile presentation review R2

## Table of contents

- [Scope](#scope)
- [Top 10](#top-10)
- [Home](#home)
- [Menus](#menus)
- [Save viewer](#save-viewer)
- [Battle Simulator](#battle-simulator)
- [Solver](#solver)
- [Wiki](#wiki)
- [Cross-cutting](#cross-cutting)
- [Counts](#counts)

## Scope

Local build of `643bd7c` (plus the uncommitted 3-line `web/src/ui/nav.ts` change in the working tree), served from a
separate folder. Pages: Home, Save viewer (5 sections and a hero page), Battle Simulator (Party, Flow, results closed
and open, a map run), Solver (setup, results, Show), Wiki (search, item lists and pages, maps, enemies, classes, skills,
passives, Stats, Battle, Expansions), menus (top bar, Save dropdown, drawer). Frozen pages (Profit, Farming, Levelling,
Balance) excluded. 375 px first, then 768 and 1280, light and dark, with the example save and without.

Errors: a check-site sweep of 12 pages × 3 widths × 2 themes × save/no save (144 runs) found **no console error, no
uncaught error, no 404, no page wider than the viewport and no wrapped one-line row**. The only flags are menu checks:
the Save viewer is never marked as current (F08) and a 768 px false positive in the checker (F12). The real layout
errors are clipping ones the sweep can't see: a dropdown off screen (F06), and tables and the Flow whose main columns
and buttons sit off screen at 375 (F13, F27, F32, F40, F44).

Severity: high = blocks or hides the main task on a phone; med = costs a screen or more, or confuses; low = polish.

## Top 10

| Id | Sev | Page | Finding |
|---|---|---|---|
| F21 | high | Simulator | The opponent starts ~3,100 px down at 375, after 5 hero cards; Simulate runs against something not on screen |
| F33 | high | Solver | After Show, the 2-hero setup sits under three empty 390 px "to be found" cards (~2,700 px down) |
| F32 | high | Solver | Results table: the Show button is off screen (x 423–485 in a 375 viewport) |
| F06 | high | Menus | Save dropdown clipped at left (−38 px) on Home and Wiki at 375 |
| F22 | high | Simulator | Each hero card is ~390 px tall; empty slots as tall as filled ones |
| F27 | high | Simulator | Flow at 375: 4th hero column cut, 5th and enemy off screen, a turn is ~450 px tall |
| F13 | high | Save viewer | Inventory/Heroes/Maps show 4 of 10–16 columns; qty, value and stats are off screen |
| F40 | high | Wiki lists | Equipment, Enemies, Skills show the least useful columns; Level, Effect, Sell value off screen |
| F44 | high | Wiki enemy | XP and time table hides XP/run and XP/min at 375 |
| F08 | med | Menus / Save | Save sections have no drawer entry, no current marker and no title on a phone |

## Home

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F01 | med | 375 | First screen: 2-line title, 3-line lead, "Tools" heading and three tall cards (40 px icon tile, 3–4 line paragraph, ~240 px each): only the Save viewer card fits above the fold. | Compact rows (icon, title, one short line, ~64 px); full descriptions into the card's title tooltip; drop the "Tools" heading; lead cut to one line at 600 px and less. |
| F02 | med | all | The Solver is not on the home page: the Tools cards are Save viewer, Battle simulator, Wiki. | Add a Solver card (or make the Battle card two links: Simulator · Solver). |
| F03 | low | 375 | "Other tools" (frozen tools) with the sentence "Older tools, kept as they are: no longer updated with the rest of the site." and four cards fills the second and third phone screens. | A closed `<details>` "Older tools (4)" on phones; the sentence becomes its ? tooltip. |
| F04 | low | all | The lead "Unofficial balancing tools for *Merchant*: crafting profit, essence sources, save viewer and battle simulation." lists the frozen tools first. | Lead in the current order: save viewer, battle, solver, wiki (or drop it). |
| F05 | low | all | With a save loaded, Home is identical to the no-save page. | With a save: one line of quick links (Heroes · Inventory · Simulator · Solver). |

## Menus

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F06 | high | 375 | The Save dropdown opens off screen on Home and Wiki pages: measured left −38 px, right 212 px; first letters cut ("ave pages", "verview", "eroes", Wiki: "nership guessed from …erData.txt"). On save.html it fits (57–307 px). `fitMenu` doesn't clamp the left edge. | At 600 px and less, open dropdowns as a fixed sheet (left/right 8–16 px) or clamp `left >= 8px`; add the case to check-site's menu checks. |
| F07 | med | all | Top-bar order and Save chip differ by page: Home and Wiki = chip, theme, EN, GitHub; Save, Simulator, Solver = theme, EN, chip, GitHub. Chip content: Home "📜 ▾" / "Save", Wiki "📜 ❄ 🖋 ▾", Save page "PlayerData.txt" at 768+. | One fixed order (chip first, it's the page-level control) and one chip format; expansion icons either everywhere or nowhere. |
| F08 | med | 375, 768, 1280 | The Save viewer has no menu entry since U44: the drawer lists Home, Battle, Wiki, More only; on save.html nothing is marked current (check-site: "no current page in the drawer" at 375, "no current section in the main menu" at 768/1280). At 375 the section pills (shown at 768) are hidden, so Overview…Crafters are reachable only through the Save dropdown, and the sections have no title: the Overview is 8 tiles with no heading. | Add a "Save" group to the drawer (Overview…Crafters, current marked); show the section pill row at 375 as one horizontally scrolling line; teach check-site that the marked Save chip counts as current. |
| F09 | med | 375 | Save dropdown on save.html is ~785 px tall (bottom at 861 px): the Expansions block is below the fold on an 812 px phone and far below on a 667 px one. Head is two lines ("PlayerData.txt / opened today 11:45 PM · kept in this browser only"). | Expansions as a submenu like "Export (CSV) ▸"; head on one line ("PlayerData.txt · 11:45 PM"), the rest in its tooltip. |
| F10 | low | all | With a save loaded, the Wiki's Save dropdown says "Open a save" (its head knows PlayerData.txt) while Home says "Open the save viewer". | Same label and same head on every page. |
| F11 | low | 375 | Drawer: 4 rows and 75% empty, and the theme / language / save controls are not in it (fine), but nothing in the drawer tells which save is loaded. | Put the Save group (F08) with the file name as its label. |
| F12 | low | 768 | Tooling: check-site flags "main menu shown on a phone / burger hidden" at 768 on every page that scrolls: the probe compares `clientWidth` (753 px with a scrollbar) with 760, the CSS uses the 768 px viewport. False positive (34 runs). | Probe with `matchMedia("(max-width: 760px)")`. |

## Save viewer

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F13 | high | 375 | Tables show the wrong columns first and the rest off screen without a cue. Inventory: Item, Type, Lvl, Asc visible; S/A/B/C/D, Total, Unit value, Total value are in the hidden 541 px (table 882 px in a 341 px wrapper). Heroes: 4 of 16 columns (Hero, Class, Lvl, Asc; HP…Deaths in 1,178 px), "ASC" header cut. Maps: 4 of 10 (Grade cut; Time, Essence/run, Value off screen). | Phone column sets: Inventory = Item (type · lv as subline) / Total / Value; Heroes = card rows (avatar + name, class · lv · asc subline, status chip, HP/ATK/DEF) with tap to the hero page; Maps = Map / Grade / Essence. Right-edge fade on any table that still scrolls. |
| F14 | med | 375 | Inventory: filter input, then the type chips on two lines ("All Equipment Consumables Materials" / "Maps On the counter"), then "167 stacks · 2,004,759 g base value": ~160 px before the table. | One scrolling chip row (or a select), the count on the filter's line. |
| F15 | med | 375 | Hero page: first screen is the name and a ~330 px radar; then a lone "Crit damage ×2.00" tile, a one-row Passive table with its own header row, and three "Basic · 0 · Basic attack" rotation rows. | 7 stats + crit damage as a compact 4×2 number grid (radar collapsible or ≤200 px); passive as one line "Juggernaut · +25% HP"; consecutive Basic rows merged ("3–5 Basic"). |
| F16 | med | 375 dark | Hero page gear cards use a light tan fill with dark text in dark mode (look like light-mode cards); "Titan's Earring" has an unexplained white glossy frame around its name. | Theme tokens for the gear card fill; give the frame a tooltip/legend or remove it. |
| F17 | low | all | Inventory: the second "Major Potion +1" row draws its name inside an outlined pill, the first doesn't; the outline isn't explained. | Tooltip on the outline (what it marks) or a legend in the ? of the table. |
| F18 | low | 375 | Crafters: paragraph under the table "Each crafter has its own level per ascension: crafting items of its current ascension uses that level (it restarts at 1 when the crafter ascends)…"; headers "Level / Level 🥈 / Level 🥇" are ambiguous. | Paragraph → ? on the header row; headers "Lv · Asc 1 · Asc 2". |
| F19 | med | 375 | No-save state (Save, Simulator, Solver): "Drop your save file here, or click to choose it" on a phone (no drop), "The file is read by your browser and kept there for the other pages. It is never uploaded.", then "No save at hand? Use an anonymised one from a real game." under the example button. | Two buttons side by side: "📂 Choose save file" and "🧪 Example save"; privacy and example sentences → ? tooltip; keep "Where is my save file?". |

## Battle Simulator

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F20 | med | 375 | Step 1 box: "Your party against an enemy or a map run, hundreds of times, on the same rolls every time. Set them up in step 3." and step 2 "Results / No run yet." cost ~250 px before any party or opponent. | Sentence → ? on "Simulate"; hide step 2 until the first run (as the Solver does since U42). |
| F21 | high | 375 | The Opponent block (Quest enemy / Map run, enemy picker) starts at ~3,100 px, after five hero cards; the first screen never shows what you fight. With a map run the map card is at the very end too. | Show the opponent as one tappable line in the Simulate box ("vs Lv 49 · Cerberus ▾") or move the Opponent block above the Party at 600 px and less. |
| F22 | high | 375 | Hero cards are ~390 px each: slot badge row ("BACK 1" + "PALADIN · 60"), a select that repeats it ("Paladin · Paladin lv 60"), the 7-stat strip, passive row, 5 rotation rows. An empty slot ("BACK 3 · AT MOST 5 HEROES", all dashes) is just as tall. "FRONT 2" + "REQUIRED" wraps to a second line. | Collapsed one-line card by default on phones (avatar, slot, name · class · lv, AP 20/20, ✓, ▸ to edit); empty slot = one "+ Add hero (Back 3)" row; drop the class badge when the select shows the class. |
| F23 | low | 375 | "Party" named three times: tab "👥 Party", heading "👥 Party", then "Party quest: Front 2 always filled, at most 5 heroes.". | Drop the inner heading; the rule line → ? next to the tab (slots already say REQUIRED). |
| F24 | med | 375 | Results details: 7 tiles (map run: 9) in two columns with orphans (Party HP left, XP/min, Essence per run alone on a row), each with an explanation subline: "4.7 when won · max 8 of 200 turns (at 200 the enemy wins)", "each hero alive after a win, 5 in the party", "fight 2 min 41 s + quest 18 min, at grade S", "average 5.0 (D = 1 … S = 5)"; then "How these are counted: XP · time"; "200 fights · 655 ms". | Tile = label + value, sublines in the tile's ? tooltip; 3 narrower columns or a 2-column key/value list with no orphans; drop "655 ms". |
| F25 | med | 375 | Per-hero results table: Slot, Hero, Damage/fight visible, "Taken" cut, more off screen. | Drop the Slot column (slot as the hero's subline); Hero / Dmg / Taken. |
| F26 | low | 375 | Results: the per-hero "Hero" column shows class-coloured pills, the same pill style as classes in the party, so "Paladin" (hero) reads as a class. | Hero name plain text with the class colour as a left bar. |
| F27 | high | 375 | Flow: five hero columns plus the enemy don't fit: "Guerrier / Front 2" cut, 5th hero and enemy columns off screen; each turn repeats the full status per hero ("+40% MDef +15% Atk 5 / +48.8 HP/turn 5") in both the action and the summary row, so one turn is ~450 px. | Phone Flow as a per-turn list (actor → skill → target, damage, one line each) with buffs as small icon chips with tooltips; status row only when it changed; or a column picker (2–3 heroes + enemy). |
| F28 | med | 375 | Flow: paragraph "One concrete fight: the first of the Simulator's runs (same seed), so its hits, misses and critical hits are that run's rolls." (map: "One concrete run: the first of the Map run's runs (same seed), so its layout, rolls and the HP carried from room to room are that run's.") right next to an existing ? ; heading "🗓️ The fight, turn by turn" repeats the "Flow" tab. | Move the paragraph into that ? tooltip; drop the heading, keep "vs Cerberus · change" as the first line. |
| F29 | low | 375 | Map run room bar ("1 · Treasure Bush", "2 · Gnoll Hunter", "3 · Reygar" …) scrolls sideways, the 3rd chip cut, no cue that 11 rooms follow. | Fade/arrow at the edge or a "Room 1 / 11 ▾" select on phones. |
| F30 | low | 375 light | Class badges "PALADIN · 60" (pale gold on cream) and "BERSERKER · 60" (orange on peach) are low contrast in light mode. | Darker text tokens for light-mode class badges (AA 4.5:1). |

## Solver

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F31 | med | 375 | Setup: "smallest party [1]" and "largest party [5]" on two rows with wide inputs, "this quest takes at most 5 heroes", and "Include scrolls (map runs only)" shown disabled on a quest. Labels lower case ("time budget (s)") unlike the rest of the site. | One row "Party 1 – 5" (two narrow inputs), the limit in its ?; hide the scrolls row for quests; sentence-case labels. |
| F32 | high | 375 | Results table: the Show button is off screen (measured x 423–485 in a 375 px viewport), "Lowest enemy HP" cut; "Heroes" repeats the count of the chips. | Row tap = Show, or Show as the first column; drop "Heroes"; "Lowest enemy HP" only when a row loses, else in a tooltip. |
| F33 | high | 375 | After Show the party shows three empty "BACK · TO BE FOUND" cards (~390 px each) before the two heroes the solver found; the first real hero starts ~2,700 px down. | Hide empty slots after a solve (or one line "3 empty back slots"); scroll to the party on Show. |
| F34 | med | 375 | Five status lines around the table: "Stopped early (time budget or Cancel): these are the setups found so far.", "3 setups win 90 % of the fights or more.", "✓ Setup #1 is shown in the Party and Flow tabs below.", "292 evaluations · 3 weaker setups not shown.", "Searched in 5.0 s.". "Stopped early" reads as a failure when the user's own budget ran out. | One line "3 setups ≥ 90 % · 5.0 s ⓘ" (details in the tooltip); the "shown below" line only as the highlighted row. |
| F35 | low | all | Party chips carry a lone 🛡 / 🏹 icon on its own line above the class chips and an unexplained "rough" chip (row 3 at 1280). | Row icon inline before its chips with a tooltip ("Front row"); tooltip on "rough". |
| F36 | low | 375 | "Party and flow" + "▶ Open in Simulator" + tabs + "👥 Party" + "The setup you showed. Edit it freely; 🔒 keeps a hero in the next solve." | Sentence → ? on the Party tab; drop the inner heading (as F23). |

## Wiki

| Id | Sev | Viewport | Finding | Fix |
|---|---|---|---|---|
| F37 | med | 375 | Wiki home: search, then 11 cards of 210–280 px with paragraphs ("Every skill with its action-point cost and effect. Hero skills are learnt by class; the rest are enemy skills."; the Equipment card has 5 lines defining Bonus stats and sell value). Only two cards per screen. | 2-column tiles (icon, name, count) ~64 px high; descriptions as tooltips; definitions moved to the list pages' header ?. |
| F38 | low | all | Count mismatch: home Skills card "235 entries", Skills list "189 of 189". | Same count (or "189 shown · 46 hidden"). |
| F39 | low | 375 | Search: results list above the cards, the cards stay under it; kind as grey text after each link. | Hide the cards while a query is typed; kind as a small chip. |
| F40 | high | 375 | Lists show low-value columns first. Equipment: Item, Region, Slot (cut); Kind, Level, Rarity, Bonus stats, Cost, Sell value in the hidden 1,050 px; Region is "Tuvale" on every row of the group. Enemies: Enemy, "Rare variant" (with a redundant "rare" pill that itself overflows); Level, HP off screen. Skills: Effect off screen, so enemy skills look like empty rows and row heights vary (40–64 px) from the hidden wrapped Effect. Passives: Classes column a 4 px sliver. Classes: MDEF cut. Maps list: Level cut, Region repeats the group. | Phone column sets: Equipment = Item (slot · lv subline) / Bonus / Sell; Enemies = Enemy (rare variant as subline) / Lv / HP; Skills = Skill (classes as coloured subline) / AP / Effect; Region as group header, not a column. |
| F41 | med | 375 | Equipment and Maps lists: "asc 0 / asc 1 / asc 2" legend chips plus "Gold per ascension variant. Cost: one craft (an ascended craft also uses orbs). Total cost: the whole recipe, materials at their sell value. Sell value: the game's price." above the table; the same paragraph is copied on Maps. | ? tooltip on the Cost / Sell value headers carrying both the legend and the definitions. |
| F42 | med | 375 | Item page (Worn Dagger): 5 fact tiles (~270 px): Type, Level, Region + "Item Lv 0" (repeats Level), Rarity, Sell value as three stacked unlabeled outlined chips "10 g / 20 g / 40 g". "Stats by grade" shows five identical rows (D–S all 11 / 3 / 13 / 5). Empty sections get a 40 px brown bar each: "Recipe · Not craftable.", "Used in · Not used in any recipe.". | One fact strip ("Weapon · Dagger · Lv 0 · Tuvale · Rarity 1 · 10 / 20 / 40 g ⓘ"); identical grade rows merged ("D–S"); empty sections as one muted line. |
| F43 | med | 375 | Map page: 8 fact tiles in 4 rows (~330 px) before the Boss table; Room enemies ATK cut, Treasure MATK cut. | 3-column compact facts or key/value rows; phone tables Enemy / Lv / HP / ATK. |
| F44 | high | 375 | Enemy page "XP and time": three toggle rows (Grade, Party, Ascension), then the table shows Map / As / Craft / R…; "XP per hero / run" and "XP / min" (the point of the block) are off screen. "Left out, not craftable (level 70): …" is a 4-line list of links. | Phone columns Map / XP per run / XP/min (craft and run time in the row tooltip); toggles on one row; "Left out" in a closed `<details>`. |
| F45 | med | 375 | Enemy drops: per-grade columns cut after C ("AMOUNT BY GRAD…", "CHANCE"), tables nested in the "Timeline and drops" card with its own 16 px padding. | On phones a grade toggle (reuse the XP block's) and one Chance / Amount column; un-nest the tables. |
| F46 | med | all | Rarity pills: "Rarity 7" red pill with dark red text (low contrast), "Rarity 5" pure yellow, "Rarity 1" bright white in dark mode, all louder than the content. | Rarity tokens with AA contrast and muted fills, in the style of the grade badges. |
| F47 | med | 375 | Class page: 7 stat tiles (HP 600, ATK 25 … ~290 px) repeat the radar's labels just below; then six stacked growth charts (~1,300 px) with "hover to read a level, click to pick it" (no hover on touch). | Drop the tiles (the radar shows the values); one growth chart with a stat selector on phones; "tap a level". |
| F48 | med | 375 | Expansions: the two-column grid stays at 375, so "What it adds" and "In detail" are ~150 px columns of bold text; Frozen Tome alone is ~1,000 px. Intro "You own Frozen Tome and Scribe (guessed from PlayerData.txt). Change it under Expansions in the top bar's 📜 Save menu." | One column at 600 px and less; "In detail" in a closed `<details>`; intro as one line with a button that opens the Save menu's Expansions. |
| F49 | low | 375 | Stats reference ("Hero stats"): the 10-step list comes before the formula box. | Formula first, step list in a `<details>` on phones. |
| F50 | low | 768 | The wiki section pill row wraps to two lines at 768 (Search … Skills / Passives, Stats, Battle, Expansions), ~80 px. | One horizontally scrolling line. |

## Cross-cutting

| Id | Sev | Viewport | Pattern | Fix |
|---|---|---|---|---|
| F51 | high | 375 | **Tables on phones**: at least 12 tables (save Inventory, Heroes, Maps; wiki Equipment, Materials, Maps, Enemies, Skills, Passives, Classes; enemy XP, drops; battle per-hero; solver results) scroll inside a 341 px `.table-wrap` holding 526–1,391 px, with no cue, and the useful columns are on the right. check-site passes them (the wrapper scrolls). | A phone column policy in the shared table helper: each column gets a priority, low-priority ones fold into a row subline or a tap-to-expand row; a right-edge fade whenever a wrapper still scrolls. |
| F52 | med | all | **Explanation paragraphs → ? tooltips**: F03, F18, F19, F20, F23, F24, F28, F31, F34, F36, F41, F48, the Equipment card text on the wiki home (F37), the "Other ascensions capped at their max level. Rim = best class at that level." note under the class radar. | One rule: no sentence above a control or table; a ? next to its heading holds it (the site already has the tooltip helper). |
| F53 | med | 375 | **Tiles and cards scale**: fact/stat tiles (save Overview, results, item, map, class, enemy facts) are 70–90 px tall in a 2-column grid with a 12 px label over an 18 px value and 16 px padding; home and wiki-home cards have 24 px padding and a 40 px icon tile. Inside the 16 px page gutter content is ~300 px wide. | Phone tile ≈ 52 px (label and value on one or two tight lines), 3 columns where values are short; cards 12 px padding, 28 px icon. |
| F54 | med | all | **Empty states take full height**: empty party slots (~390 px), "2 Results / No run yet.", "Not craftable." / "Not used in any recipe." sections, the "–" Rare variant column, "to be found" slots. | Empty = one muted line or hidden. |
| F55 | med | all | **Section headers**: full-width dark-brown gradient bars (~40 px) for every wiki section, also inside cards (Timeline, Drops) and in light mode where they are the heaviest thing on the page; the battle steps use red number badges + 22 px headings with ~48 px gaps. | Top-level h2 as text + thin rule; nested headers as small caps labels; section gap 24 px on phones. |
| F56 | low | all | **Inconsistent formats**: "90 %" (solver, wiki Stats "100 %") vs "100.0%"; lower-case labels ("smallest party", "time budget (s)") vs Title-case elsewhere; "Level" vs "Lvl" vs "LV" headers. | One number formatter for percentages, sentence-case labels, one level abbreviation. |
| F57 | low | 375 | **Footers**: two to four lines of small print on every page ("Fights use a TypeScript re-implementation of the game's combat rules, checked action by action against the game's own code. Fan project, …"). | One line ("Fan project · not affiliated · source") with the rest in a tooltip or the About/GitHub link. |
| F58 | low | 375 | **Horizontal chip rows** (room bar, save sections, wiki sections, filter chips) either wrap or scroll with no cue. | One shared scroll-row style with edge fades. |

## Counts

58 findings: 10 high (F06, F13, F21, F22, F27, F32, F33, F40, F44, F51), 27 medium, 21 low. Screenshots stay local (agent
scratchpad, `r2/` and `r2/crops/`). Nothing here is covered by work in progress yet; it is a backlog for the user to
prioritise.
