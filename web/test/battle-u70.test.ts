// Battle Simulator U70: Flow 2, Flow 3 and their tabs gone (the Party view only); no Simulate button, runs count or
// result tiles: every change runs WORST_RUNS traced runs in the worker (debounced, a newer change drops the older run)
// and the chart and cards show the worst one (tools/worst-run.ts); four sticky figures over the runs (win rate, grade
// when won, heroes dead, life left) between the Simulate panel and the party; the chart draws no focus ring after a
// click. No browser: the ordering and the figures as pure functions, the runs on the game data, the worker, the chart's
// focus mode in the fake DOM, and the pages, the page code and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluate, fightSeed } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import {
  compareRuns, gradeLetter, outcomeOfFight, outcomeOfMap, type RunOutcome, runStats, traceWorst, WORST_RUNS, worstRun,
} from "../src/tools/worst-run.ts";
import { focusMode } from "../src/ui/hp-chart.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), sim0 = read("site/battle.html"), solver = read("site/solver.html");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* U70 */"), css.indexOf("/* end U70 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

const run = (o: Partial<RunOutcome>): RunOutcome => ({ won: true, rooms: 1, turns: 10, grade: 3, dead: 0, alive: [1, 1, 1], ...o });

// ---------------------------------------------------------------- 1. the worst run
test("compareRuns: a loss is worse than any win", () => {
  assert.ok(compareRuns(run({ won: false, rooms: 0, turns: 99, dead: 0, alive: [1] }), run({ grade: 1, dead: 5, alive: [0.01] })) < 0);
  assert.ok(compareRuns(run({ grade: 1 }), run({ won: false, rooms: 0 })) > 0);
});

test("compareRuns: among losses the one that ends earliest: fewer rooms cleared, then fewer turns", () => {
  const early = run({ won: false, rooms: 2, turns: 50 }), late = run({ won: false, rooms: 3, turns: 10 });
  assert.ok(compareRuns(early, late) < 0, "fewer rooms cleared is worse, whatever the turns");
  assert.ok(compareRuns(run({ won: false, rooms: 0, turns: 4 }), run({ won: false, rooms: 0, turns: 9 })) < 0, "a quest: fewer turns survived");
  // the same end: more heroes down, then less life left
  assert.ok(compareRuns(run({ won: false, rooms: 0, turns: 4, dead: 3, alive: [0.5] }), run({ won: false, rooms: 0, turns: 4, dead: 2, alive: [0.1, 0.1] })) < 0);
});

test("compareRuns: among wins the lowest grade, then the most heroes dead, then the lowest life left of the survivors", () => {
  assert.ok(compareRuns(run({ grade: 2, dead: 0 }), run({ grade: 4, dead: 5 })) < 0, "grade first");
  assert.ok(compareRuns(run({ dead: 2, alive: [1] }), run({ dead: 1, alive: [0.1, 0.1] })) < 0, "then heroes dead");
  assert.ok(compareRuns(run({ dead: 1, alive: [0.2, 0.4] }), run({ dead: 1, alive: [0.5, 0.5] })) < 0, "then the survivors' average life");
  assert.equal(compareRuns(run({}), run({})), 0);
});

test("worstRun: the index of the worst; a tie keeps the earlier run; -1 without runs", () => {
  const runs = [run({ grade: 4 }), run({ won: false, rooms: 0, turns: 30 }), run({ grade: 1 }), run({ won: false, rooms: 0, turns: 12 }), run({ won: false, rooms: 0, turns: 12 })];
  assert.equal(worstRun(runs), 3);
  assert.equal(worstRun([run({ grade: 3 }), run({ grade: 2 }), run({ grade: 2 })]), 1);
  assert.equal(worstRun([]), -1);
});

// ---------------------------------------------------------------- 2. the figures
test("runStats: win rate, grade over the wins, heroes dead over all runs, life left over every standing hero", () => {
  const st = runStats([
    run({ grade: 5, dead: 0, alive: [1, 0.5] }),
    run({ grade: 3, dead: 1, alive: [0.3] }),
    run({ won: false, rooms: 0, grade: 1, dead: 3, alive: [] }),
    run({ won: false, rooms: 0, grade: 1, dead: 2, alive: [0.2] }),
  ]);
  assert.equal(st.n, 4);
  assert.equal(st.win, 0.5);
  assert.equal(st.grade, 4, "a loss's grade doesn't count");
  assert.equal(st.dead, 1.5);
  assert.equal(st.life, 0.5, "(1 + 0.5 + 0.3 + 0.2) / 4 heroes standing");
  // no win: no grade; nobody ever standing: no life left; no runs at all
  const none = runStats([run({ won: false, rooms: 0, dead: 3, alive: [] })]);
  assert.equal(none.grade, null);
  assert.equal(none.life, null);
  assert.equal(none.win, 0);
  assert.deepEqual(runStats([]), { n: 0, win: 0, grade: null, dead: 0, life: null });
});

test("gradeLetter: the nearest letter, clamped", () => {
  assert.deepEqual([1, 1.4, 1.5, 3, 4.6, 5, 0, 9].map(gradeLetter), ["D", "D", "C", "B", "S", "S", "D", "S"]);
});

test("outcomes from the engine's results: who is down, HP left of the others, a map run's rooms and turns", () => {
  const hero = (hp: number, maxHP: number, dead = false) => ({ hp, maxHP, dead }) as never;
  const f = outcomeOfFight({ won: true, turns: 7, grade: 4, heroes: [hero(50, 100), hero(0, 80, true), hero(-5, 60), hero(100, 100)] });
  assert.deepEqual(f, { won: true, rooms: 1, turns: 7, grade: 4, dead: 2, alive: [0.5, 1] });
  assert.equal(outcomeOfFight({ won: false, turns: 3, grade: 1, heroes: [] }).rooms, 0);
  const m = outcomeOfMap({ won: false, cleared: 4, grade: 3, heroes: [hero(10, 40)],
    combats: [{ status: 1, name: "a", isRare: false, turns: 5 }, { status: 2, name: "b", isRare: false, turns: 8 }, { status: 0, name: "c", isRare: false }] });
  assert.deepEqual(m, { won: false, rooms: 4, turns: 13, grade: 3, dead: 0, alive: [0.25] });
});

// ---------------------------------------------------------------- 3. the runs on the game data
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));

test("traceWorst (a quest): 20 runs on Simulate's seeds, the worst one's trace (U74: kept with the first and the best); the engine's results unchanged", () => {
  assert.equal(WORST_RUNS, 20);
  const quest = 53;
  const [f, b] = party();
  const w = traceWorst(sim, { quest: { id: quest, rare: false, amount: 1 } }, [...f], [...b]);
  assert.equal(w.outcomes.length, 20);
  assert.equal(w.worst, worstRun(w.outcomes));
  assert.equal(w.errors, 0);
  // the trace is that run's own fight (its seed), and run 0 is Simulate's first fight
  const [f2, b2] = party();
  assert.deepEqual(w.traces[w.worst].quest, traceFight(sim, quest, [...f2], [...b2], { seed: fightSeed(1, w.worst) }));
  assert.equal(w.traces[w.worst].quest!.won, w.outcomes[w.worst].won);
  assert.equal(w.traces[w.worst].quest!.turns, w.outcomes[w.worst].turns);
  // the same 20 fights as an evaluation of 20 (seeds fightSeed(1, 0..19)): same win rate, same average grade
  const [f3, b3] = party();
  const ev = evaluate(sim, quest, [...f3], [...b3], 20);
  const st = runStats(w.outcomes);
  assert.equal(st.win, ev.win);
  if (st.grade !== null) assert.ok(Math.abs(st.grade - ev.grade) < 1e-9);
  // the same party again: the same runs (fixed seeds)
  const [f4, b4] = party();
  assert.deepEqual(traceWorst(sim, { quest: { id: quest, rare: false, amount: 1 } }, [...f4], [...b4]).outcomes, w.outcomes);
});

test("traceWorst (a map run): the worst run's rooms, each fought room traced", () => {
  const [f, b] = party();
  const spec = { id: 1, prestigeLevel: 0, grade: 3 };
  const w = traceWorst(sim, { map: { spec, scrolls: [] } }, [...f], [...b], 4);
  assert.equal(w.outcomes.length + w.errors, 4);
  const map = w.traces[w.worst].map;
  assert.ok(map && map.length > 0);
  const [f2, b2] = party();
  const again = traceMapRun(sim, spec, [...f2], [...b2], { seed: fightSeed(1, w.worst) });
  assert.deepEqual(map, again);
  assert.equal(map!.filter((r) => r.trace).length > 0, true);
  assert.throws(() => traceWorst(sim, {}, [...f], [...b], 1), /nothing to simulate/);
});

test("the worker answers a worst-of request with its id; an error carries the id too", async () => {
  (globalThis as Record<string, unknown>).self ??= { location: { href: "http://localhost/js/battle-worker.js" } };
  const gamedata = read("inventory/gamedata.json");
  const was = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => JSON.parse(gamedata) })) as unknown as typeof fetch;
  try {
    const { runBattle } = await import("../src/ui/battle-worker.ts");
    const front = IDX[0].map((i) => sv.raw.hero[i]), back = IDX[1].map((i) => sv.raw.hero[i]);
    const r = await runBattle({ gameMode: "Standard", front, back, n: 5, worst: true, id: 7, quest: { id: 53, rare: false, amount: 1 } });
    assert.ok(r.ok && r.kind === "worst", JSON.stringify(r).slice(0, 200));
    assert.equal(r.id, 7);
    assert.equal(r.runs.outcomes.length, 5);
    assert.ok(r.runs.traces[0].quest);
    // structured-cloneable (it crosses the worker boundary)
    assert.deepEqual(structuredClone(r.runs), r.runs);
    const bad = await runBattle({ gameMode: "Standard", front, back, n: 2, worst: true, id: 8, quest: { id: 999999, rare: false, amount: 1 } });
    assert.equal(bad.ok, false);
    assert.equal(bad.id, 8);
  } finally {
    globalThis.fetch = was;
  }
});

// ---------------------------------------------------------------- 4. the page
test("the Flows, their tabs and the old results are gone, modules and code", () => {
  for (const f of ["flow2", "flow3", "flow-layouts", "flow-parts", "flow-planned", "flow-hp", "battle-results"]) {
    assert.equal(existsSync(new URL(`web/src/ui/${f}.ts`, root)), false, f);
  }
  assert.doesNotMatch(page, /flowLayout|planTrace|mapTrace|roomScroller|showTab|initTabs|questResults|mapResults|heroTable|#sim-summary|#results|#runs|"#run"/);
  for (const html of [sim0, solver]) assert.doesNotMatch(html, /b3-tab-row|flow-panel|tab-flow|id="plan"/);
  assert.doesNotMatch(css, /\/\* Flow 2 \*\/|\/\* Flow 3 \*\/|\.f2-|\.f3-|\.tc-grid|\.room-bar|\.sim-summary/);
});

test("every change that matters runs the 20 runs after a pause; the same fight is drawn again, not run", () => {
  assert.match(page, /export const AUTO_DELAY_MS = 200;/);
  const plan = fn(page, "renderPlan");
  // no fight to run: nothing waits or runs, the chart's empty line and the figures' dashes
  assert.match(plan, /if \(!next\) \{\s*cancelRuns\(\);\s*shown = null;/);
  // the same request (a language or expansion redraw): the shown runs, again
  assert.match(plan, /if \(shown\?\.key === next\.key\) \{\s*cancelRuns\(\);\s*drawShown\(\);\s*return;\s*\}/);
  // a newer change restarts the pause
  assert.match(plan, /if \(autoTimer !== null\) clearTimeout\(autoTimer\);\s*autoTimer = setTimeout\(\(\) => \{\s*autoTimer = null;\s*startRuns\(next\);\s*\}, AUTO_DELAY_MS\);/);
  // the key is the worker's request: party (gear, levels), rotations and passives, who fights, the opponent, the map,
  // its scrolls; WORST_RUNS runs, worst-of
  const auto = fn(page, "autoRun");
  assert.match(auto, /const req: BattleRequest = \{ gameMode: [^}]*front, back, skills, n: WORST_RUNS, worst: true, \.\.\.targetOf\(\) \};/);
  assert.match(auto, /key: JSON\.stringify\(req\)/);
  assert.doesNotMatch(auto, /turnAt|turnPick|zoom|chartTab|scroll/i);
  // picking a turn never runs again
  assert.doesNotMatch(fn(page, "selectTurn"), /renderPlan|startRuns/);
  // every edit goes through renderPlan (renderParty draws it; the opponent's controls too)
  assert.match(fn(page, "renderParty"), /renderPlan\(\);/);
  // U72: the quest size, the map, and one listener for its ascension, grade, prefix and suffix (no scrolls)
  assert.equal(fn(page, "renderTarget").match(/renderPlan\(\)/g)?.length, 3, "the quest size, the map, its modifiers");
  assert.match(fn(page, "renderTarget"), /for \(const x of \[asc, grade, pre, suf\]\) x\.addEventListener\("change", \(\) => \(sync\(\), renderPlan\(\)\)\);/);
});

test("a run still going is dropped for a newer one; a stale answer is ignored", () => {
  const start = fn(page, "startRuns");
  assert.match(start, /if \(running !== null\) \{\s*simWorker\?\.terminate\(\);\s*simWorker = null;\s*\}/);
  assert.match(start, /simWorker \?\?= dataWorker\("battle-worker\.js", \["gamedata\.json"\]\);/);
  assert.match(start, /if \(r\.ok \? r\.kind !== "worst" \|\| r\.id !== id : r\.id !== id\) return;/);
  assert.match(start, /worker\.postMessage\(\{ \.\.\.next\.req, id \}\);/);
  const cancel = fn(page, "cancelRuns");
  assert.match(cancel, /clearTimeout\(autoTimer\)/);
  assert.match(cancel, /simWorker\?\.terminate\(\);/);
  // a new save or Forget: nothing left shown or running
  assert.equal(page.match(/cancelRuns\(\);\n\s*shown = null;\n\s*runError = null;/g)?.length, 3, "no fight, a new save, Forget");
});

test("the chart and the cards: the picked run (U74; U70: the worst); a hero changed since shows its own stats", () => {
  const shown = fn(page, "drawShown");
  assert.match(shown, /const run = pickedTrace\(runs, pickNow\(\)\);/);
  assert.match(shown, /showHp\(\[\{ trace: run\.quest, enemy: /);
  assert.match(shown, /showHp\(rooms\.flatMap/);
  assert.match(fn(page, "showHp"), /chartHeroes = new Map\(members\.map\(\(m\) => \[locationOf\(m\.row, m\.i\), m\.idx\]\)\);/);
  assert.match(fn(page, "paintTurn"), /const inFight = at && now && inc\.has\(key\) && chartHeroes\.get\(w\) === idx;/);
  assert.match(fn(page, "drawEnemyCard"), /\(run\.quest\.id !== foe\.id \|\| run\.quest\.rare !== foe\.rare\) \? undefined : turnView\(\)\?\.states\[0\]/);
});

test("the four figures: one row of tiles, short labels on a phone, dashes without runs, busy while runs wait", () => {
  const stats = fn(page, "drawStats");
  for (const [long, short] of [["Win rate", "Win"], ["Grade when won", "Grade"], ["Avg heroes dead", "Dead"], ["Life left", "Life"]]) {
    assert.match(stats, new RegExp(`statTile\\("${long}", "${short}"`), long);
  }
  assert.match(stats, /st\?\.grade != null \? gradeLetter\(st\.grade\) : "–"/);
  assert.match(stats, /st\?\.life != null \? pct\(st\.life\) : "–"/);
  assert.match(stats, /const busy = running !== null \|\| autoTimer !== null;\s*box\.classList\.toggle\("busy", busy\);\s*box\.setAttribute\("aria-busy", String\(busy\)\);/);
  assert.match(stats, /const box = document\.querySelector<HTMLElement>\("#sim-stats"\);\s*if \(!box\) return;/, "the Solver has none");
});

test("HTML: the figures between the Simulate panel and the party, on the Simulator only; no Simulate button", () => {
  const at = (s: string) => sim0.indexOf(s);
  assert.ok(at('<div class="run-box"') < at('id="sim-stats"') && at('id="sim-stats"') < at('id="setup-grid"'));
  // a child of #setup (not of a section), so it sticks over the whole party view
  const setup = sim0.slice(at('<div id="setup"'));
  assert.match(setup, /<\/section>\s*<!--[^>]*-->\s*<div id="sim-stats" class="sim-stats" role="group" aria-label="Results" aria-busy="false"><\/div>\s*<section>/);
  assert.doesNotMatch(sim0, /id="run"|id="runs"|sim-summary|id="results"/);
  assert.doesNotMatch(solver, /sim-stats/);
  // the panel keeps the opponent's controls (U72: no Clear all, no "?"s)
  for (const id of ["opp-switch", "target"]) assert.ok(sim0.includes(`id="${id}"`), id);
  for (const id of ["party-tools", "sim-help", "party-help"]) assert.ok(!sim0.includes(`id="${id}"`), id);
});

test("CSS: the U70 block: sticky, opaque, one row at every width, under the picker and the tooltips", () => {
  assert.equal(css.split("/* U70 */").length, 2);
  assert.ok(css.lastIndexOf("/* end U70 */") > css.lastIndexOf("/* end U69 */"), "the last block");
  assert.match(block, /\.sim-stats \{ position: sticky; top: 0; z-index: 30;[^}]*background: var\(--bg\); \}/);
  assert.ok(30 < 55, "under the floating picker (U69, z-index 55)");
  assert.match(block, /\.sim-stats-row \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(block, /\.sim-stats-row \{[^}]*wrap/);
  assert.match(block, /\.sim-stats \.tile-label, \.sim-stats \.tile-value \{[^}]*white-space: nowrap; \}/);
  assert.match(block, /@media \(max-width: 520px\) \{[\s\S]*\.sim-stats \.st-long \{ display: none; \}\s*\.sim-stats \.st-short \{ display: inline; \}/);
  // busy: only opacity changes (no layout shift)
  assert.match(block, /\.sim-stats\.busy \.tile-value, \.sim-stats\.busy \.bar \{ opacity: \.45; \}/);
  assert.match(block, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.sim-stats\.busy \.tile-value \{ animation:/);
  // theme tokens only
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i);
});

// ---------------------------------------------------------------- 5. the chart's focus ring
test("the chart: no focus ring after a click or a tap, the accent ring for the keyboard", () => {
  const box = document.createElement("section") as unknown as FakeElement & HTMLElement;
  focusMode(box);
  focusMode(box); // once per box
  assert.equal(box.listeners.get("pointerdown")?.length, 1);
  assert.equal("pointer" in box.dataset, false);
  box.dispatch("pointerdown");
  assert.equal(box.dataset.pointer, "");
  box.dispatch("keydown");
  assert.equal("pointer" in box.dataset, false);
  assert.match(fn(read("web/src/ui/hp-chart.ts"), "drawHpChart"), /back\?\.focus\(\);\s*focusMode\(box\);/);
  assert.match(block, /\.hp-chart-box :focus:not\(:focus-visible\), \.hp-chart-box\[data-pointer\] :focus \{ outline: none; \}/);
  // the keyboard ring stays (U65 / U66: the accent outline on the plot, the tabs, ‹ › and the fight tabs)
  assert.match(css, /\.hp-tab:focus-visible, \.hp-svg:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/);
});
