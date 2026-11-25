// Battle section U42: the Solver's one full-width Solve panel (the quest / map toggle and its pickers, party sizes,
// Include scrolls, the time budget, Solve and its progress), no enemy card or tabs during setup, no step headings, and
// the results section hidden until a solve is done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const html = read("site/solver.html");
const at = (s: string) => html.indexOf(s);
/** The markup of the element that opens at `open`, up to its matching close tag (no nesting of the same tag inside). */
const block = (open: string, close = "</section>") => html.slice(at(open), html.indexOf(close, at(open)) + close.length);

test("Solver: the spoiler guard first, then one Solve panel, the results, the party", () => {
  const order = ['id="search-panel"', 'id="solve-box"', 'id="search-results"', 'id="party-box"'];
  for (const id of order) assert.ok(at(id) > 0, id);
  for (let k = 1; k < order.length; k++) assert.ok(at(order[k - 1]) < at(order[k]), `${order[k - 1]} before ${order[k]}`);
  // The guard is the first section of #setup (the guard's CSS hides every later one).
  const setup = html.slice(at('<div id="setup"'));
  assert.ok(setup.indexOf("<section") === setup.indexOf('<section id="search-panel"'));
});

test("Solver: the Solve panel holds the quest / map toggle, its pickers and the options; no enemy card or tabs in it", () => {
  const panel = block('<section id="solve-box"');
  for (const id of ["opp-switch", "target", "search-form"]) assert.ok(panel.includes(`id="${id}"`), id);
  assert.match(panel, /class="seg compact" id="opp-switch"/);
  assert.doesNotMatch(panel, /id="target-card"|opp-card|role="tab"/);
  // No "Quest enemy / Map run" tabs anywhere, and no opponent column during setup: the card waits beside the party.
  assert.doesNotMatch(html, /Quest enemy|Map run|solve-what|solve-opp"/);
  assert.ok(at('id="target-card"') > at('id="party-box"'), "the opponent card is in the panel a result's Show brings");
  // The page puts the card apart when there is a #target-card (the Simulator has none: its card stays under its pickers).
  const page = read("web/src/ui/battle-page.ts");
  assert.match(page, /function placeTarget\(box: HTMLElement, controls: HTMLElement, card: HTMLElement\): void \{/);
  assert.equal(page.match(/placeTarget\(box, /g)?.length, 2, "quest and map");
  assert.doesNotMatch(page, /box\.replaceChildren\(el\("div", \{ class: "opp-controls" \}/);
  assert.doesNotMatch(read("site/battle.html"), /id="target-card"/);
});

test("Solver: no step headings for what to solve and the results", () => {
  assert.doesNotMatch(html, /What to solve|>\s*Results\s*</);
  assert.doesNotMatch(html, /class="step"/);
  // The only h2 is the party panel's, after a Show.
  assert.equal(html.split("<h2").length, 2);
  assert.ok(at("<h2") > at('id="party-box"'));
});

test("Solver: the results stay hidden until a solve is done; the progress is in the Solve panel", () => {
  assert.match(html, /<section id="search-results" class="b3-results solve-results" aria-live="polite" hidden><\/section>/);
  const search = read("web/src/ui/battle-search.ts");
  const run = search.slice(search.indexOf("function runSearch"), search.indexOf("function base()"));
  // A new solve hides the last results; only a finished one shows them.
  assert.ok(run.indexOf("showResults(false)") < run.indexOf("dataWorker("));
  assert.equal(run.match(/showResults\(true\)/g)?.length, 1);
  assert.ok(run.indexOf("showResults(true)") > run.indexOf('if (m.type === "error")'));
  // Progress, Cancel and errors in the panel's status line (kept across the form's rebuilds), never in the results.
  assert.match(run, /status\.replaceChildren\(el\("div", \{ class: "search-progress" \}/);
  assert.doesNotMatch(run, /out\.replaceChildren\(el\(/);
  assert.match(search, /form\.replaceChildren\(\.\.\.\(panel\?\.form \? \[panel\.form, status\] : \[\]\)\);/);
  // The Solver no longer scrolls to the results when a solve starts.
  const init = read("web/src/ui/battle-page.ts");
  const solver = init.slice(init.indexOf("function initSolver"), init.indexOf("function onLanguage"));
  assert.doesNotMatch(solver, /onStart:/);
});

test("Solver: the time budget is back, a seconds input (30 by default) the search gets", () => {
  const search = read("web/src/ui/battle-search.ts");
  assert.match(search, /const TIME_MIN = 5, TIME_MAX = 600;/);
  assert.match(search, /scrolls: true, time: 30 \}/);
  assert.match(search, /const budget = el\("input", \{ type: "number", class: "solve-time"/);
  // R2 F31: sentence-case label.
  assert.match(search, /field\("Time budget \(s\)", budget\), go\)/);
  assert.match(search, /const budgetMs = prefs\.time \* 1000;/);
  assert.match(search, /minSize: lo, maxSize: hi, scrolls, timeBudgetMs: budgetMs \}/);
  // The order in the panel: sizes ("Party 1 – 5", R2 F31), scrolls, time, Solve.
  const form = search.slice(search.indexOf('el("div", { class: "toolbar search-form" }'));
  const pos = ["sizes", "...scrollOpt", 'field("Time budget (s)"', "go)"].map((s) => form.indexOf(s));
  for (let k = 1; k < pos.length; k++) assert.ok(pos[k - 1] >= 0 && pos[k - 1] < pos[k], String(k));
});

test("Solver: without Include scrolls a map run is solved with none", () => {
  const search = read("web/src/ui/battle-search.ts");
  assert.match(search, /if \(target\.map && !scrolls\) target\.map = \{ \.\.\.target\.map, scrolls: \[\] \};/);
  assert.match(search, /poolSkills: ctx\.poolSkills\(\), \.\.\.target,/);
});
