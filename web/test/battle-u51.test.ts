// Battle Simulator and Solver U51: the Solver's rows show grade, life left and heroes dead (solverFigures); one "?"
// beside the Party / Flow tabs, the open tab's; the Flow without a "Turn" column, a full-width turn band before each
// turn (turnBand); a calculation panel exactly its column's width, panels of several columns side by side
// (calcColumn). No browser: the pure parts, the Flow built in the fake DOM, and the page code read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluate } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { calcColumn, turnBand } from "../src/ui/battle-layout.ts";
import { solverFigures } from "../src/ui/battle-setup.ts";
import { loadTimelineData } from "../src/ui/timeline.ts";
import { renderFlow2 } from "../src/ui/flow2.ts";
import { plannedRotation } from "../src/ui/flow-planned.ts";
import type { PlanMember } from "../src/ui/battle-plan.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), search = read("web/src/ui/battle-search.ts"), css = read("site/style.css");
const u51 = css.slice(css.indexOf("/* U51 */"), css.indexOf("/* end U51 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

// ---------------------------------------------------------------- 1. the Solver's rows
test("solverFigures: the grade letter of the won fights, life left, heroes dead (sum of death rates)", () => {
  const ev = { win: 0.8, grade: 3.6, hp_left: 0.42, heroes: { f0: { death_rate: 0.5 }, b0: { death_rate: 0.25 }, b1: { death_rate: 0 } } };
  assert.deepEqual(solverFigures(ev), { grade: "A", gradeAvg: 3.6, life: 0.42, dead: 0.75, size: 3 });
  // never won: no grade
  assert.deepEqual(solverFigures({ ...ev, win: 0, grade: 0 }), { grade: null, gradeAvg: 0, life: 0.42, dead: 0.75, size: 3 });
  // the letters D (1) to S (5), clamped
  assert.equal(solverFigures({ ...ev, grade: 1 }).grade, "D");
  assert.equal(solverFigures({ ...ev, grade: 4.5 }).grade, "S");
  assert.equal(solverFigures({ ...ev, grade: 9 }).grade, "S");
  // life stays a share
  assert.equal(solverFigures({ ...ev, hp_left: 1.2 }).life, 1);
  assert.equal(solverFigures({ ...ev, hp_left: Number.NaN }).life, 0);
});

test("solverFigures on a real evaluation: the figures the search already measured", () => {
  api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
  const sv = loadSaveText(read("site/data/example-save.txt"));
  const sim = new Sim(sv.raw.gameMode || "Standard");
  const [front, back] = [[8, 0, 4], [5, 1, 2]].map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  const ev = evaluate(sim, 72, front, back, 20);
  const f = solverFigures(ev);
  assert.equal(f.size, 6);
  assert.ok(f.dead >= 0 && f.dead <= 6);
  assert.equal(f.life, ev.hp_left);
  assert.equal(f.grade === null, !(ev.win > 0));
});

test("the Solver's table: Win, Grade, Turns or Progress, Life, Dead; short heads with their tooltips", () => {
  const paint = search.slice(search.indexOf("const paint = () =>"), search.indexOf("if (!res.results.length)"));
  assert.match(paint, /const head = \["", "Party", \.\.\.\(isMap \? \["Scrolls"\] : \[\]\), "Win", "Grade", isMap \? "Progress" : "Turns", "Life", "Dead"\];/);
  assert.match(paint, /const f = solverFigures\(ev\);/);
  assert.match(paint, /gradeBadge\(f\.grade\)/);
  assert.match(paint, /pct\(f\.life, 0\)/);
  for (const h of ["Grade", "Life", "Dead"]) assert.match(search, new RegExp(`  "${h}": "`), `${h} has a tooltip`);
  // every head at most 8 letters (375 px)
  for (const h of ["Party", "Scrolls", "Win", "Grade", "Progress", "Turns", "Life", "Dead"]) assert.ok(h.length <= 8);
});

// ---------------------------------------------------------------- 2. one "?" beside the tabs
test("the tab row's one \"?\" follows the open tab, on the Simulator and the Solver", () => {
  for (const html of [read("site/battle.html"), read("site/solver.html")]) {
    const row = html.slice(html.indexOf('<div class="b3-tab-row">'), html.indexOf('<div id="flow-panel"'));
    assert.match(row, /<span id="party-help"><\/span><span id="plan-help" hidden><\/span>/);
    assert.equal(html.match(/id="plan-help"/g)!.length, 1, "no second \"?\" on the flow's own line");
  }
  const show = fn(page, "showTab");
  assert.match(show, /partyTip\.hidden = tab !== "party";/);
  assert.match(show, /flowTip\.hidden = !flow;/); // U58: any of the Flow tabs
  assert.match(u51, /#plan-help:empty \{ display: none; \}/);
});

// ---------------------------------------------------------------- 3. the Flow: turn bands, no "Turn" column
test("turnBand: \"Turn N\", the rotations again on turns 6, 11, …", () => {
  assert.deepEqual(turnBand(1), { label: "Turn 1", again: false });
  assert.deepEqual(turnBand(5), { label: "Turn 5", again: false });
  assert.deepEqual(turnBand(6), { label: "Turn 6", again: true });
  assert.equal(turnBand(7).again, false);
  assert.equal(turnBand(11).again, true);
});

test("calcColumn: a panel's grid column is its number's column (damage and healing alike), clamped", () => {
  assert.equal(calcColumn(0, 7), 1);
  assert.equal(calcColumn(1, 7), 1, "a heal in column 0");
  assert.equal(calcColumn(4, 7), 3);
  assert.equal(calcColumn(13, 7), 7);
  assert.equal(calcColumn(40, 7), 7, "clamped to the last column");
  assert.equal(calcColumn(-3, 7), 1);
  assert.equal(calcColumn(4, 0), 1);
});

await loadTimelinesForTests();
async function loadTimelinesForTests(): Promise<void> {
  api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
  const timelines = JSON.parse(read("inventory/timelines.json"));
  (globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
  await loadTimelineData();
}
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
  const raw = sv.raw.hero[idx];
  return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6) };
}));
const flow = (quest: number) => {
  const [f, b] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
  return renderFlow2({ id: quest, rare: false }, members, traceFight(sim, quest, [...f], [...b])) as unknown as FakeElement;
};

test("the Flow: no \"Turn\" column; each turn starts with its full-width band", () => {
  const plan = flow(72); // Odin: lost on turn 14
  assert.equal(plan.querySelectorAll(".pg-turn").length + plan.querySelectorAll(".tc-turnlab").length, 0);
  const heads = plan.querySelector("div.f2-cards")!.children; // U63: Flow 2, a card per actor (Flow 1 had heads)
  assert.equal(heads.length, 7, "one card per actor, nothing else");
  const turns = plan.querySelectorAll("div.tc-turn").filter((t) => !t.classList.contains("f2-end")); // U63: Flow 2, its "End" group aside
  assert.ok(turns.length >= 10);
  for (const [k, t] of turns.entries()) {
    const band = t.children[0];
    assert.ok(band.classList.contains("tc-turnrow"));
    assert.equal(band.getAttribute("role"), "row");
    const h = band.children[0];
    assert.equal(h.getAttribute("role"), "rowheader");
    assert.equal(h.getAttribute("aria-colspan"), "7");
    assert.ok(h.textContent.startsWith(`Turn ${k + 1}`));
    assert.equal(Boolean(h.querySelector("span.tc-again")), turnBand(k + 1).again);
  }
  // the old round divider is the band's "rotations again"
  assert.equal(plan.querySelectorAll("div.pg-cycle").length, 0);
});

test("the planned rotation (no fight): the same turn bands, no \"Turn\" column", () => {
  const plan = plannedRotation({ id: 72, rare: false }, members) as unknown as FakeElement;
  assert.equal(plan.querySelectorAll(".pg-turn").length, 0);
  const groups = plan.querySelectorAll("div.pg-turngroup");
  assert.deepEqual(groups.map((g) => g.querySelector("div.tc-turnhead")!.textContent), ["Turn 1", "Turn 2", "Turn 3", "Turn 4", "Turn 5"]);
  for (const g of groups) assert.equal(g.querySelector("div.pg-row")!.children.length, 7);
});

test("calculations: each in its column's grid cell, several columns open side by side under one line", () => {
  const plan = flow(72);
  // a line with numbers in at least two columns (a hit on several heroes)
  const line = plan.querySelectorAll("div.tc-line").find((l) => new Set(l.children.filter((c) => c.querySelector("button.tc-calc-btn"))).size >= 2)!;
  assert.ok(line, "a line with two calculations");
  const lines = line.parentNode!.children;
  const box = lines[lines.indexOf(line) + 1];
  assert.ok(box.classList.contains("tc-calcs"));
  assert.equal(box.dataset.cols, "7");
  const cells = line.children;
  const withBtn = cells.map((c, k) => [c, k] as const).filter(([c]) => c.querySelector("button.tc-calc-btn"));
  const [[a, ka], [b, kb]] = withBtn;
  a.querySelector("button.tc-calc-btn")!.dispatch("click");
  b.querySelector("button.tc-calc-btn")!.dispatch("click");
  assert.equal(box.hidden, false);
  const panels = box.children;
  assert.equal(panels.length, 2, "both stay open");
  assert.deepEqual(panels.map((p) => p.style.gridColumn), [String(ka + 1), String(kb + 1)]);
  // closing one keeps the other
  a.querySelector("button.tc-calc-btn")!.dispatch("click");
  assert.deepEqual(box.children.map((p) => p.style.gridColumn), [String(kb + 1)]);
  // no positioning by margin any more
  assert.doesNotMatch(read("web/src/ui/flow-parts.ts"), /marginLeft|calcPanelLeft|ResizeObserver/);
});

test("CSS: the lines, heads and calculation boxes share the actors' columns; a panel is never wider than its column", () => {
  assert.match(u51, /\.pg-row \{ display: grid; gap: 3px; grid-template-columns: repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.tc-line \{ display: grid; grid-template-columns: repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\); gap: 3px; \}/);
  assert.match(u51, /\.tc-calcs \{ display: grid; grid-template-columns: repeat\(var\(--pg-cols\), minmax\(0, 1fr\)\); grid-auto-flow: row dense; gap: 3px;/);
  assert.match(u51, /\.tc-calc \{ box-sizing: border-box; min-width: 0;[^}]*overflow-wrap: anywhere; \}/);
  assert.doesNotMatch(css, /max-content; max-width: min\(100%, 34rem\)/);
  // no turn column left anywhere (desktop 36px, phone 22px)
  assert.doesNotMatch(css, /\.(pg-turn|tc-turnlab)\b/);
  assert.doesNotMatch(css, /\.(pg-row|tc-turn) \{[^}]*grid-template-columns: (36|22)px /);
});
