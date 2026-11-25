---
type: Review
title: Accessibility and performance review
description: axe-core audit of every page except Balance (dark and light, 1280 and 375 px, after a run, a solve, a plan and a rank) and a performance pass (bytes by type, load times, long tasks, heap) on the local build; 21 findings grouped by shared component, each a quick fix or a design choice.
timestamp: 2026-11-25
---

# Accessibility and performance review

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Accessibility and performance review

## Table of contents

- [Scope](#scope)
- [Top 10](#top-10)
- [Accessibility by rule](#accessibility-by-rule)
- [Accessibility findings](#accessibility-findings)
- [Performance by page](#performance-by-page)
- [Performance findings](#performance-findings)
- [Quick fixes](#quick-fixes)
- [Counts](#counts)

## Scope

Local build of `d1e453d` (`web/scripts/assemble-site.sh` into a scratch folder), served by the QA server with
`cache-control: no-store`, driven in a separate headless Windows Chrome 158 through the DevTools protocol, with the
example save loaded.

Accessibility: axe-core 4.10.2 (pinned, from cdnjs), default rule set (WCAG 2 A/AA and best practice), injected after
each page state was reached. 21 states: Home; Save Overview, Heroes, Inventory, Maps, Crafters and a hero page
(`#hero=1`); Simulator after a run (Party tab, Flow tab); Solver after a 5 s solve and Show; Wiki home, Equipment list,
an item, an enemy, a class, Stats, Battle, Expansions; Levelling after a plan; Profit (default answer); Farming after a
rank. Each in dark and light at 1280 and 375 px: **84 runs, 8 rules, 8,448 failing nodes** (526 without the one
helper behind 7,864 of them, F03). axe sees only what is rendered and visible: closed `<details>`, hidden tabs and
tooltips are not tested (the hero radar at 375 sits in a closed details, so its F02 nodes are missing from that width),
and keyboard order and focus were already covered by the QA rounds.

Performance: per page, a fresh load with the cache disabled at 1280 and 375 px. Bytes from the server's request log
(worker fetches included, which the page's Resource Timing misses), DOMContentLoaded and load from Navigation Timing,
long tasks from a `longtask` PerformanceObserver installed before any script, JS heap from `Runtime.getHeapUsage`
after a forced GC. A second pass at 375 px with 4× CPU throttling (a mid-range phone) and CPU profiles of the three
heaviest moments. Local server, so times are CPU, not network. GitHub Pages gzips text: gzip sizes are given next to
raw ones.

Severity: high = content or structure a screen-reader user can't get, or a freeze a phone user notices (≥ 500 ms at
4×); med = WCAG AA failure or noisy reading, or a heavy load with an easy cut; low = best practice or polish.

## Top 10

| Id | Sev | Area | Finding |
|---|---|---|---|
| F03 | high | Wiki lists | Sell value / Cost cells (`ascValues`) put the text on an `aria-label` of a plain span and hide the numbers: screen readers read an empty cell; 1,966 nodes on Equipment |
| F01 | high | Flow (Simulator, Solver) | The turn-by-turn grid is an ARIA table with broken structure (rowheader outside a row, status inside the table): 22 nodes a run |
| F17 | high | Wiki lists, Profit | Equipment list builds 21,179 nodes: an 890 ms long task at 4× CPU; Profit "Show more" 12,553 nodes, 1,205 + 857 ms |
| F12 | high | Profit | `profit-default.json` is 2.27 MB (229 KB gzip); load long tasks 472 and 669 ms at 4× |
| F11 | med | All tool pages | Whole result areas are `aria-live` (wiki `<main>`, save `#result`, battle `#results` …): each re-render reads full tables aloud |
| F04 | med | Save Heroes, Solver | Class and status pills fail contrast: 2.27–4.0 in dark, 2.67–4.42 in light (34 + 21 nodes on Heroes) |
| F13 | med | Simulator, Solver, Levelling, Farming | `gamedata.json` fetched and parsed twice (page and worker), `timelines.json` too on Simulator and Solver |
| F14 | med | Every page | No code splitting: nav.js's modules are also inside every page bundle; `battle.js` and `solver.js` share 58 of 59 modules |
| F18 | med | Simulator | Setup build: 208 ms long task on desktop, 891 ms at 4× |
| F07 | med | Wiki Stats, Battle | Reference tables scroll sideways but can't take keyboard focus (3 at 1280, 12 at 375) |

## Accessibility by rule

Node counts are summed over the 84 runs (dark 1280 / light 1280 / dark 375 / light 375 where they differ).

| Rule | Impact | Nodes | Where | Shared component (source) | Example selector | Finding |
|---|---|---|---|---|---|---|
| aria-prohibited-attr | serious | 7,922 | Wiki Equipment (1,966 a run) | `ascValues()` in `web/src/ui/dom.ts` | `.reg-1:nth-child(1) > .num:nth-child(11) > .asc-vals` | F03 |
| | | (58 of them) | Hero page (7, 1280 only), Simulator Party (5), Wiki class (6) | `radar()` hit circles, `web/src/ui/radar.ts` | `circle[aria-label="HP 2,203"]` | F02 |
| region | moderate | 216 | every state (2–3 a run) | static top bar and hidden `<h1>` in `site/*.html` | `.topbar > .brand[href="./"]`, `.gh > span`, `h1.visually-hidden` | F10 |
| color-contrast | serious | 176 | Save Heroes 34/21/34/21, Solver 16/1/16/1, Flow 13/0/13/0, Party 1, Stats 1, Battle 1 | `.pill` tokens (`site/style.css` `.pill`, `--ink`), Flow chips (`.tc-fx`, `.tc-calc-btn`), `.ref-tag` | `tr:nth-child(1) > td:nth-child(14) > .t-violet.pill` | F04, F05, F06 |
| aria-required-children | critical | 48 | Flow, Solver (6 a run) | `flowChart()` / `unreachedRows()` in `web/src/ui/timeline.ts` | `.pg-grid.tc-grid[role=table]`, `.tc-turn[role=rowgroup]` | F01 |
| aria-required-parent | critical | 40 | Flow, Solver (5 a run) | same | `.tc-turn > .tc-turnlab[role=rowheader]` | F01 |
| scrollable-region-focusable | serious | 30 | Wiki Stats 1/1/8/8, Battle 2/2/4/4 | `tbl()` in `web/src/ui/wiki-ref.ts` | `#stats-enchant > .ref-body > .table-wrap` | F07 |
| empty-table-header | minor | 12 | Wiki Stats (3 a run) | `gradeHead` and two other tables in `web/src/ui/wiki-stats.ts` | `#stats-item-stats … th[scope=col]:nth-child(1)` | F08 |
| nested-interactive | serious | 4 | Home (1 a run) | the "?" added into `<summary>` by `web/src/ui/home.ts` | `details.tools-other > summary` | F09 |

Clean in every run apart from the top-bar landmarks (F10): Save Overview, Inventory, Maps, Crafters; Wiki home, item,
enemy, Expansions; Levelling after a plan; Profit; Farming after a rank.

## Accessibility findings

| Id | Sev | Viewport | Finding | Fix | Kind |
|---|---|---|---|---|---|
| F01 | high | all | Flow grid (`timeline.ts` `flowChart()` l. 473–474, `unreachedRows()` l. 435–436) is `role=table` whose children are `role=rowgroup` turns holding a `role=rowheader` "T1" directly (no `row`), plus the `p.tc-result role=status` inside the table body. axe: aria-required-children 6 and aria-required-parent 5 per run on Simulator Flow and Solver. Screen readers fall back or refuse table navigation over the main output of both pages. | Drop the role on `.tc-turnlab` (or `role="presentation"`) and name the rowgroup instead (`aria-label: "Turn N"`, as the unreached turns already do); move `tc-result` after the `role=table` element. | quick fix |
| F02 | med | all | Radar hit targets (`radar.ts` l. 92–93) are focusable `<circle tabindex=0 aria-label="HP 2,203">` with no role: the name is prohibited and dropped by most readers, so each Tab stop reads nothing. Hero page (7), Simulator Party (5), Wiki class (6); also in the closed radar details at 375. | `role="img"` on the circle (keeps the label), or `role="button"` with `aria-describedby` to the tooltip. | quick fix |
| F03 | high | all | `ascValues()` (`dom.ts` l. 175–180) puts "Sell value, ascension 0: 10 g, …" in `aria-label` on a plain `<span class="asc-vals">` and marks the three number boxes `aria-hidden`. A name on a generic span is prohibited and not read: the cell is silent. 1,966 nodes on Equipment (every Sell value, Cost, Total cost cell), also on Maps and wherever the helper is used. | Keep the boxes `aria-hidden` and add a visually-hidden text child with the label (or `role="img"` on the span). | quick fix |
| F04 | med | all | Pills (`style.css` `.pill`: text `color-mix(--c --ink, --fg)` on a `--tint` fill) fail AA for saturated hues. Dark (`--ink: 80%`): violet "on a map" 2.66, blue "on a quest" / Mage 2.91, Dark Knight 2.6, Warrior 2.77, Bard 2.89, Cleric 3.56, Rogue 3.68, Paladin gold 4.0; Solver hero chips 2.27–3.68 on the loaded row's tint. Light (`--ink: 70%`): gold 2.67, green 3.05, teal 3.25, orange 3.47, blue 4.22. The light fix exists but only for `.slot-head .pill, .solver-party .pill` (`--ink: 38%`, style.css ~l. 1831). | Move the light override to `.pill` everywhere and give dark pills a lower ink (≈ 50–55 %, toward `--fg`); recheck with axe on Save Heroes and Solver. | quick fix |
| F05 | med | all (dark) | Flow chips: buff text `.tc-fx.buff` (#98e287) on the actor's tinted cell 3.57–4.48, debuff 2.85, heals 3.59, `.tc-miss` and `.tc-calc-btn` (muted) 3.43–4.34; at 0.62 rem (9.9 px) and 0.58 rem (9.3 px), under the 12 px most guidelines take as the floor. 13 nodes on Flow, 3 on Solver. Light passes. | Colour: mix the chip colours further toward `--fg` (≈ 70 %) or lower the actor tint (`.tc-cell.actor` 22 % → 14 %). Size: ≥ 0.7 rem belongs with the Flow phone layout (R2 F27). | quick fix (colour); needs design choice (size, with R2 F27) |
| F06 | low | all (dark) | `.pill.plain` "level 49" on hero cards 4.33; `.ref-tag` "Unconfirmed" (`.ref-note.unsure`) 4.19 on Stats and Battle. | Same token change as F04; `.unsure .ref-tag` fill 28 % → 35 % or dark text. | quick fix |
| F07 | med | 375 (also 1280 on 3 tables) | Wiki reference tables (`wiki-ref.ts` `tbl()`, l. 97–99) scroll horizontally in `.table-wrap` but hold no link or button, so a keyboard user can't scroll them: Stats (enchant at 1280; defence, hit chance, grade … 8 at 375), Battle (targeting, buffs/debuffs, rotation, effects). | `tabindex="0"`, `role="region"` and an `aria-label` (the section title) on the wrapper; same option in `dom.ts` `table()` for tables without links. | quick fix |
| F08 | low | all | Three tables on Wiki Stats start with an empty `<th scope="col">` (grade table `gradeHead` l. 61 and two others). | Text for the corner ("Stat", "Grade") or a visually-hidden label. | quick fix |
| F09 | med | all | Home "Older tools (4)": the "?" help button is inside `<summary>` (`home.ts` adds `helpTip` to the summary's h2), a button within a button; on touch the first tap can toggle the details instead of opening the tip. | Put the "?" outside the summary (next to the details, or as the first line inside it). | needs design choice (where the ? sits on the closed row) |
| F10 | low | all | No banner landmark: the top bar is `<div class="topbar">` in all `site/*.html`, so the brand link and GitHub are outside landmarks; on Save, Simulator, Solver, Levelling, Profit, Farming the `h1.visually-hidden` sits between the bar and `<main>`. 2–3 nodes on every run. | `<header class="topbar">` in each page and the `<h1>` inside `<main>`; on Home turn `<header class="home-head">` into a `div` inside `main` so there is one banner. | quick fix |
| F11 | med | all | Whole result areas are live regions: `wiki.html` `<main id="wiki" aria-live="polite">` (every route change re-reads the page), `save.html` `#result` (Inventory is a 167-row table), `battle.html` `#results`, `solver.html` `#search-results`, `farming.html` `#farm-results`, `levelling.html` `#plan-out` / `#prestige-out`, `class-balance.html` `#out`. Not an axe rule, found reading the markup. | Remove `aria-live` from the containers; announce one short line per update through the existing toast/status helper (`dom.ts` l. 504) or a small `role=status` line ("Won 96 %", "12 rows"). | needs design choice (what each page announces) |

## Performance by page

Fresh load, cache off, 1280 px; KB raw (gzip in brackets) from the server log, worker fetches included. Long tasks:
desktop at 1280, then 4× CPU at 375. Heap: JS heap after load + action, after a forced GC.

| Page | JS | JSON | CSS | DCL / load | Long tasks desktop | Long tasks 4× (load) | Heap | DOM nodes |
|---|---|---|---|---|---|---|---|---|
| Home | 32 (11) | 0 | 165 (37) | 48 / 52 ms | none | 71 | 0.8 MB | 302 |
| Save (Overview → hero) | 169 (56) | 473 (58) | 165 | 60 / 63 ms | none | 264 (Heroes) | 2.4 MB | 339 |
| Simulator (after a run) | 429 (145) | 2,157 (165): gamedata ×2, timelines ×2, warmstart, wikidata | 165 | 226 / 230 ms | **208** (load), none during the run | **891**, 226 | 4.2 MB | 2,606 → 2,763 |
| Solver (after solve + Show) | 429 (145) | 2,157 (165) | 165 | 110 / 111 ms | 99 (solve) | not run | 4.6 MB | 1,335 → 1,883 |
| Wiki (home) | 276 (96) | 821 (74): gamedata, timelines, wikidata | 165 | 98 / 99 ms | 56; Equipment list 138 | 356; Equipment list **890** | 3.9 MB | 341; Equipment 21,179 |
| Levelling (after a plan) | 273 (89) | 914 (107): gamedata ×2, wikidata | 165 | 227 / 243 ms | none (58 plan) | 101 | 3.8 MB | 486 → 534 |
| Profit (default answer) | 193 (65) | 2,745 (287): profit-default 2,273, gamedata, wikidata | 165 | 118 / 142 ms | 79; Show more 140 + 104 | **472, 669**, 191, 187; Show more **1,205, 857** | 7.3 MB | 3,606; after Show more 12,553 |
| Farming (after a rank) | 280 (91) | 914 (107): gamedata ×2, wikidata | 165 | 165 / 172 ms | 72 | 373 | 4.2 MB | 1,556 → 2,204 |

Solves and ranks run in workers and leave the main thread free (Solver 12 s with its 5 s budget, Farming rank 9 s,
Levelling plan 5 s on this machine: no long task above 100 ms during them). No console error, no 404. Heap after GC
stays at 1–7 MB on every page: no leak seen across the 84 runs.

## Performance findings

| Id | Sev | Page | Finding | Fix | Kind |
|---|---|---|---|---|---|
| F12 | high | Profit | `data/profit-default.json` is 2,328,525 B (229 KB gzip): `items` 1.26 MB (2,199 rows × ~30 keys, key names repeated on every row, derived fields like `ev_*` equal to their base when there is no mod, a prose `how` string), `enchant` 645 KB, `costs` 406 KB. At 4× CPU the load has 472 and 669 ms long tasks (parse and first table). Over the network it is small; the cost is parse and memory. | Columnar or array-of-arrays rows with one key list; drop fields the page derives (`ev_*` when equal, `how`, `margin%`); round to what the table shows; load `enchant` and `costs` when their tab or the cost breakdown first opens. | quick fix (trim and round); needs design choice (split by tab) |
| F13 | med | Simulator, Solver, Levelling, Farming | The page fetches and parses `gamedata.json` (442 KB) and the worker does it again (`battle-worker.ts` l. 93, `levelling-worker.ts` l. 38, `farming-worker.ts` l. 39); Simulator and Solver also load `timelines.json` (349 KB) on both sides. Seen as two requests here (`no-store`); on Pages (`max-age=600`) the second is a cache hit only if the first has finished, and it is always parsed twice. | Fetch once in the page as an `ArrayBuffer` and transfer a copy to the worker on start, or start the worker after the page's fetch resolves so it hits the HTTP cache. | quick fix |
| F14 | med | every page | No code splitting (`assemble-site.sh`: esbuild `--bundle --format=esm`, no `--splitting`). nav.js's modules (`dom.ts`, `names.ts`, `save-menu.ts`, `nav-data.ts`, `i18n.ts`) are in all 8 page bundles too: loaded twice on every page, and two module instances (two copies of the language and save-menu state). The engine (`sim/*`, `expansions.ts`, `wiki-data.ts`) is in 8 of the 14 bundles (pages and workers); `battle.js` and `solver.js` are 242 KB each and share 58 of their 59 modules, so going Simulator → Solver downloads it all again. | Add `--splitting` (ESM output and module workers are already in place): shared chunks cached across pages, nav state single. Check the `js/*.js` names the pages load stay the same. | quick fix |
| F15 | low | Wiki | `wiki.ts` l. 55 loads `timelines.json` (349 KB, 16 KB gzip) on every wiki route, home included; only enemy and skill pages use it. | Call `loadTimelineData()` from the enemy and skill routes. | quick fix |
| F16 | low | Simulator | The battle worker loads `warmstart.json` (545 KB, 26 KB gzip) with the game data on every Simulator visit; only searches (`searchSkills`, `optimiseFight`) use it. | Load it on the first search request. | quick fix |
| F17 | high | Wiki lists, Profit | Equipment list renders all 670 rows at once: 21,179 nodes (each cost cell is 4 spans, F03), 138 ms on desktop, one 890 ms task at 4×; the CPU profile is mostly style and layout. Profit "Show more" grows the table to 12,553 nodes: 1,205 + 857 ms at 4×. | `content-visibility: auto` with `contain-intrinsic-size` on `tbody tr` (or row groups) as a first step; then paging or windowed rendering (100 rows + "Show more") on the long wiki lists. | quick fix (CSS); needs design choice (paging) |
| F18 | med | Simulator | Page build is one 208 ms task on desktop, 891 ms (then 226) at 4×: five hero cards with their selects and stat blocks, 2,606 nodes before any run; the profile shows `addItemStats` / `determineStats` (stats per card) and DOM building. | Build empty slots as one line (R2 F54) and the per-turn skill selects on first focus; measure again after R2 F22. | needs design choice (with R2 F22, F54) |
| F19 | low | every page | Scroll memory's restore (`scroll-memory.ts` `step()`) reads `scrollHeight` every frame for up to 15 s while a page builds, forcing a layout each frame: 158–254 ms self time at 4× on Simulator and Profit loads (only when a position is saved). | Watch `document.body` with a `ResizeObserver` and check height in its callback. | quick fix |
| F20 | low | every page | `style.css` is one 165 KB (37 KB gzip) render-blocking sheet for all pages, with the rules of every tool. | Fine gzipped; worth a split (base + page sheet) only with F14. | needs design choice |
| F21 | low | every page | Source maps (≈ 10.3 MB, `--sourcemap`) are published; browsers only fetch them with DevTools open. | Keep, or `--sourcemap=external` without upload if the size of the Pages artifact matters. | quick fix |

## Quick fixes

F01, F02, F03, F04, F05 (colour), F06, F07, F08, F10, F12 (trim and round), F13, F14, F15, F16, F17 (CSS), F19, F21
(17). Tied to a design choice: F05 (font size, with R2 F27), F09 (where the ? sits), F11 (what each page announces),
F12 (split by tab), F17 (paging), F18 (with R2 F22, F54), F20 (7).

Best value first: F03 and F01 (screen readers get the wiki values and the Flow back, a few lines each), F04 (one token
change clears ~150 contrast nodes), F14 (one esbuild flag), F13, F12 trim.

## Counts

21 findings: 4 high (F01, F03, F12, F17), 10 medium, 7 low. 11 accessibility (F01–F11), 10 performance (F12–F21).
axe: 84 runs, 8 rules, 8,448 nodes (7,864 from F03, 216 landmark, 176 contrast, 88 Flow table, 58 radar, 30 scroll
regions, 12 empty headers, 4 nested). Raw results, scripts and the axe copy stay local (agent scratchpad,
`a11y-out/`, `a11y-tools/`, `axe-dl/`).
