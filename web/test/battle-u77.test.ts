// Battle Simulator U77: the chart's scroll and zoom across results and run switches. A new result starts scrolled to
// its end (the last fight); a run switch (Worst / Random / Best) keeps the same logical time of the map run (the same
// fight by its identity, the map room, and its turn, clamped as U76) at the same place on screen; a zoom is a fight
// (its identity), laid out again from the new run (worst 5 turns → best 3 → worst 5 again). No browser: real traces,
// the chart in the fake DOM, the page code read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs, type TracedFight } from "../src/ui/battle-plan.ts";
import {
  anchorScroll, chartLayout, clampStep, drawHpChart, endScroll, fightOf, type HpChartData, hpData, type HpFighter, type HpRun, HP_W,
  pickStep, runOfFight, timeOf,
} from "../src/ui/hp-chart.ts";
import { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
type F = FakeElement & HTMLElement;

// The fake DOM has no layout: the scroll box is 300 px wide (a phone), every other box 0 (the chart then 360 units,
// HP_W, and 1 unit = 1 px).
const VIEW = 300;
const widths = new WeakMap<object, number>();
Object.defineProperty(FakeElement.prototype, "clientWidth", {
  configurable: true,
  get(this: FakeElement) {
    return widths.get(this) ?? (this.classList.contains("hp-scroll") ? VIEW : 0);
  },
  set(this: FakeElement, v: number) {
    widths.set(this, v);
  },
});

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const fighters: HpFighter[] = IDX.flatMap((row, r) => row.map((idx, i): HpFighter => {
  const raw = sv.raw.hero[idx];
  return { who: locationOf(r ? "back" : "front", i), name: String(raw.name), cls: Number(raw.class) };
}));
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
/** A trace cut after turn `n` (a shorter run of the same fight). */
const cut = (t: TracedFight, n: number): TracedFight => ({ ...t, turns: Math.min(n, t.turns), actions: t.actions.filter((a) => a.turn <= n) });

const [f1, b1] = party();
const rooms = traceMapRun(sim, { id: 15, prestigeLevel: 0, grade: 3 }, [...f1], [...b1]);
const tabs = mapRoomTabs(rooms);
// as the page gives them (drawShown): every fought room with its index in the map, the fight's identity
const roomRuns: HpRun[] = rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label, fight: k }] : []));
/** The room of five turns: the worst run's; the best run clears it in three. */
const FIVE = roomRuns.findIndex((r) => r.trace.turns === 5);
const worst: HpChartData = hpData(roomRuns, fighters)!;
const best: HpChartData = hpData(roomRuns.map((r, k) => (k === FIVE ? { ...r, trace: cut(r.trace, 3) } : r)), fighters)!;
/** A run that ended in room 3 (index 2) after its turn 2. */
const short: HpChartData = hpData([roomRuns[0], roomRuns[1], { ...roomRuns[2], trace: cut(roomRuns[2].trace, 2) }], fighters)!;
/** A run where room 2 (index 1) left no step (hpData drops a room without actions): later rooms' indexes shift. */
const gap: HpChartData = hpData(roomRuns.map((r, k) => (k === 1 ? { ...r, trace: { ...r.trace, actions: [] } } : r)), fighters)!;
const box = () => {
  const b = document.createElement("section") as unknown as F;
  (document.body as unknown as FakeElement).append(b);
  return b;
};
const scrollOf = (b: F) => b.querySelector(".hp-scroll")! as F;
const selOf = (b: F) => Number(b.querySelector("svg.hp-svg")!.getAttribute("aria-valuenow"));
const zoomTicks = (b: F) => b.querySelectorAll("text.hp-axis").map((t) => t.textContent).filter((t) => !t.endsWith("%"));

test("the data: a map room keeps its identity (fightOf), found again by it (runOfFight); timeOf is a fight and a turn", () => {
  assert.ok(FIVE > 0 && worst.runs.length > 6, "a map run with a five-turn room");
  assert.equal(worst.runs[FIVE].turns, 5);
  assert.equal(best.runs[FIVE].turns, 3);
  for (let k = 0; k < worst.runs.length; k++) assert.equal(fightOf(worst, k), k);
  assert.equal(gap.runs.length, worst.runs.length - 1);
  assert.equal(fightOf(gap, 1), 2, "room 3 is the gap run's second fight");
  assert.equal(runOfFight(gap, 1), -1, "room 2 left no step");
  assert.equal(runOfFight(gap, 4), 3);
  assert.deepEqual(timeOf(gap, gap.runStarts[3] + 2), { run: 4, turn: 2 });
  // no identity given (a quest, an old caller): the fight's own index
  const plain = hpData(roomRuns.map(({ fight: _, ...r }) => r), fighters)!;
  assert.equal(fightOf(plain, 3), 3);
  assert.equal(plain.runs[3].fight, undefined);
});

test("clampStep and pickStep go by the fight's identity, never by the step index", () => {
  // the same room and turn in a run whose earlier room left no step: another step index, the same logical time
  const i = worst.runStarts[4] + 1;
  const j = clampStep(gap, timeOf(worst, i));
  assert.notEqual(j, i);
  assert.deepEqual(timeOf(gap, j), timeOf(worst, i));
  assert.equal(pickStep(gap, timeOf(worst, i)), j, "an edit keeps it too");
  // past the room's end in the new run: its last turn; a room the new run never reached: the last room's last turn
  assert.deepEqual(timeOf(best, clampStep(best, { run: FIVE, turn: 5 })), { run: FIVE, turn: 3 });
  assert.deepEqual(timeOf(short, clampStep(short, timeOf(worst, worst.runStarts[FIVE] + 2))), { run: 2, turn: 2 });
  assert.equal(clampStep(gap, { run: 1, turn: 1 }), gap.steps.length - 1, "a room this run has no step of: the last one");
  assert.equal(pickStep(gap, { run: 1, turn: 1 }), 0, "an edit: turn 0");
});

test("endScroll and anchorScroll: the chart's end; a point kept at its place on screen, within the chart's ends", () => {
  assert.equal(endScroll(900, 300), 600);
  assert.equal(endScroll(250, 300), 0, "a chart that fits");
  assert.equal(endScroll(900, 0), 900, "no layout yet: as far as it goes");
  assert.equal(anchorScroll(500, 120, 900, 300), 380, "the point stays 120 px from the left edge");
  assert.equal(anchorScroll(50, 120, 900, 300), 0, "never before the start");
  assert.equal(anchorScroll(880, 10, 900, 300), 600, "never past the end");
});

// ---------------------------------------------------------------- 1. a new result starts at its end
test("the chart: a new result starts scrolled to its end; a tab switch or a redraw keeps the scroll", () => {
  const b = box();
  drawHpChart(b, worst, { selected: 0, toEnd: true });
  const L = chartLayout(worst, HP_W);
  assert.ok(L.overflow);
  assert.equal(scrollOf(b).scrollLeft, L.W - VIEW, "the last fight in view");
  // the user scrolls, then a tab: kept
  scrollOf(b).scrollLeft = 120;
  b.querySelector('[data-tab="dmg"]')!.dispatch("click");
  assert.equal(scrollOf(b).scrollLeft, 120);
  b.querySelector('[data-tab="hp"]')!.dispatch("click");
  assert.equal(scrollOf(b).scrollLeft, 120);
  // the same result drawn again (a language change): kept
  drawHpChart(b, worst, { selected: 0 }, false);
  assert.equal(scrollOf(b).scrollLeft, 120);
  // another result (an edit ran again): its end
  drawHpChart(b, best, { selected: 0, toEnd: true });
  assert.equal(scrollOf(b).scrollLeft, chartLayout(best, HP_W).W - VIEW);
  // zoomed, nothing scrolls
  const z = box();
  drawHpChart(z, worst, { selected: worst.runStarts[FIVE], zoom: FIVE, toEnd: true });
  assert.ok(!scrollOf(z).classList.contains("overflow"));
});

test("the page: a worker's answer draws fresh (the chart at its end), a redraw of the same runs or a pick does not", () => {
  const start = fn(page, "startRuns");
  assert.match(start, /runError = null;\s*drawShown\(undefined, true\);/);
  assert.match(fn(page, "renderPlan"), /if \(shown\?\.key === next\.key\) \{\s*cancelRuns\(\);\s*drawShown\(\);/);
  assert.match(fn(page, "setPick"), /drawShown\(\{ who \}\);/);
  const show = fn(page, "showHp");
  assert.match(show, /follow: Boolean\(keep\), toEnd: fresh \}, !keep\);/);
  assert.match(show, /if \(chart\) turnPick = timeOf\(chart, turnAt\);/);
  assert.match(fn(page, "selectTurn"), /turnPick = timeOf\(chart, i\);/);
  // the map rooms carry their index in the map
  assert.match(fn(page, "drawShown"), /quest: \{ id: r\.questId, rare: r\.isRare \}, \.\.\.ids\[k\] \}/); // U79: roomIds
});

// ---------------------------------------------------------------- 2. a run switch in All: the same time, the same place
test("the chart: a run switch in All keeps the selected fight and turn at the same place on screen", () => {
  const b = box();
  const sel = worst.runStarts[FIVE] + 2;
  drawHpChart(b, worst, { selected: sel }, false);
  const L0 = chartLayout(worst, HP_W);
  scrollOf(b).scrollLeft = Math.round(L0.xs[sel] - 140);
  const before = L0.xs[sel] - scrollOf(b).scrollLeft;
  // Worst → Best: the room of five turns is three now, every x after it moves
  const to = clampStep(best, timeOf(worst, sel));
  assert.deepEqual(timeOf(best, to), timeOf(worst, sel), "the same room and turn");
  const L1 = chartLayout(best, HP_W);
  assert.notEqual(L1.xs[to], L0.xs[sel], "another x in the new run");
  drawHpChart(b, best, { selected: to, follow: true }, false);
  assert.equal(selOf(b), to);
  assert.ok(Math.abs(L1.xs[to] - scrollOf(b).scrollLeft - before) < 1e-6, "the turn where it was on screen");
  // and back: the same place again
  const back = clampStep(worst, timeOf(best, to));
  assert.equal(back, sel);
  drawHpChart(b, worst, { selected: back, follow: true }, false);
  assert.ok(Math.abs(L0.xs[sel] - scrollOf(b).scrollLeft - before) < 1e-6);
});

test("the chart: a run switch to a run that ended sooner lands on its last fight's last turn, kept on screen as far as the chart goes", () => {
  const b = box();
  const sel = worst.runStarts[FIVE] + 2;
  drawHpChart(b, worst, { selected: sel }, false);
  // U79: the selected turn in view (one off screen gives way to the fight in the middle of the box, battle-u79)
  const left = Math.round(chartLayout(worst, HP_W).xs[sel] - 100);
  scrollOf(b).scrollLeft = left;
  const before = chartLayout(worst, HP_W).xs[sel] - left;
  const to = clampStep(short, timeOf(worst, sel));
  assert.equal(to, short.steps.length - 1);
  drawHpChart(b, short, { selected: to, follow: true }, false);
  const L = chartLayout(short, HP_W);
  assert.equal(scrollOf(b).scrollLeft, L.overflow ? anchorScroll(L.xs[to], before, L.W, VIEW) : 0);
});

// ---------------------------------------------------------------- 3. a zoom is a fight, laid out from the new run
test("the chart: zoomed, Worst (5 turns) → Best (3) → Worst shows 5, 3, then 5 turns again", () => {
  const b = box();
  drawHpChart(b, worst, { selected: 0 }, false);
  // zoom on the five-turn room by its tab, pick its turn 5
  b.querySelector(`button.hp-fight[data-run="${FIVE}"]`)!.dispatch("click");
  const end = worst.runStarts[FIVE] + 5;
  drawHpChart(b, worst, { selected: end }, false);
  const right = HP_W - 10; // the plot's right edge
  const lastX = () => Number(b.querySelector("line.hp-sel")!.getAttribute("x1"));
  assert.deepEqual(zoomTicks(b), ["0", "1", "2", "3", "4", "5"]);
  assert.equal(lastX(), right, "turn 5 on the right edge");
  // Best: the room's turn 5 is past its end, its turn 3; the room fills the plot with 3 turns
  let sel = clampStep(best, timeOf(worst, end));
  drawHpChart(b, best, { selected: sel, follow: true }, false);
  assert.ok(b.querySelector(".hp-fights")!.classList.contains("zoomed"));
  assert.deepEqual(zoomTicks(b), ["0", "1", "2", "3"]);
  assert.equal(lastX(), right, "turn 3 on the right edge");
  // Worst again: 5 turns, the turn kept (3, U76: no memory per run), at 3/5 of the plot
  sel = clampStep(worst, timeOf(best, sel));
  drawHpChart(b, worst, { selected: sel, follow: true }, false);
  assert.deepEqual(timeOf(worst, sel), { run: FIVE, turn: 3 });
  assert.deepEqual(zoomTicks(b), ["0", "1", "2", "3", "4", "5"]);
  const L = chartLayout(worst, HP_W, FIVE);
  assert.equal(L.spans[FIVE].width, HP_W - 38 - 10, "the room fills the plot");
  assert.ok(Math.abs(lastX() - Math.round(L.xs[sel] * 10) / 10) < 1e-9);
  assert.deepEqual(b.querySelectorAll("button.hp-fight").map((x) => x.getAttribute("data-run")), [null, String(FIVE)]);
});

test("the chart: a zoom is kept by the fight's identity when the new run's room indexes differ", () => {
  const b = box();
  const sel = worst.runStarts[4] + 1;
  drawHpChart(b, worst, { selected: sel, zoom: 4 });
  // the gap run has room 5 (identity 4) at index 3
  const to = clampStep(gap, timeOf(worst, sel));
  drawHpChart(b, gap, { selected: to }, false);
  assert.deepEqual(b.querySelectorAll("button.hp-fight").map((x) => x.getAttribute("data-run")), [null, "3"], "an edit keeps it too");
  drawHpChart(b, worst, { selected: clampStep(worst, timeOf(gap, to)), follow: true }, false);
  assert.deepEqual(b.querySelectorAll("button.hp-fight").map((x) => x.getAttribute("data-run")), [null, "4"]);
  assert.equal(selOf(b), sel);
});
