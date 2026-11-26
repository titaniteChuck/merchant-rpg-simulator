// Battle Simulator U79: the run picker (Worst / Random / Best) on a map run, on the real runs the worker answers with
// (traceWorst: 20 map runs, each with its own map, 8 to 11 rooms). The page's chart flow (drawShown → showHp →
// drawHpChart, setPick, selectTurn) is run as battle-page.ts has it (checked against its source below), driven by the
// picker's own radios and the plot's keys, in the fake DOM with a browser's scroll: scrollLeft clamped to
// [0, scrollWidth − clientWidth], scrollWidth the track's width.
// Root cause: U77 named a room by its index in the map, but every run's map differs (the boss is room 11 in one run
// and room 8 in another, whose room 8 is an Antares), so a switch landed on (and zoomed on) another room; and in All
// an off-screen selected turn (a new result starts at its end, the turn kept far off it) was the scroll's anchor.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { pickedRun, pickedTrace, randomRun, type RunPick, traceWorst, worstRun, bestRun } from "../src/tools/worst-run.ts";
import { locationOf, mapRoomTabs } from "../src/ui/battle-plan.ts";
import {
  anchorStep, chartLayout, clampStep, drawHpChart, type FightTime, type HpChartData, hpData, type HpFighter, type HpRun, HP_W, nearFight,
  pickStep, roomIds, timeOf,
} from "../src/ui/hp-chart.ts";
import { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
type F = FakeElement & HTMLElement;
/** The fake DOM's elements with the layout this test gives them. */
type Box = FakeElement & { clientWidth: number; scrollLeft: number };

// ---------------------------------------------------------------- a browser's horizontal scroll in the fake DOM
const VIEW = 300; // the scroll box (a phone); the chart is 360 units (HP_W), 1 unit = 1 px when it overflows
const widths = new WeakMap<object, number>();
const scrolls = new WeakMap<object, number>();
const scrollWidth = (e: Box): number => {
  const track = e.children[0];
  const w = parseFloat(String(track?.style.width ?? ""));
  return Number.isFinite(w) ? Math.max(w, e.clientWidth) : e.clientWidth;
};
Object.defineProperty(FakeElement.prototype, "clientWidth", {
  configurable: true,
  get(this: Box) {
    return widths.get(this) ?? (this.classList.contains("hp-scroll") ? VIEW : 0);
  },
  set(this: FakeElement, v: number) {
    widths.set(this, v);
  },
});
Object.defineProperty(FakeElement.prototype, "scrollWidth", {
  configurable: true,
  get(this: Box) {
    return scrollWidth(this);
  },
});
Object.defineProperty(FakeElement.prototype, "scrollLeft", {
  configurable: true,
  get(this: FakeElement) {
    return scrolls.get(this) ?? 0;
  },
  // as a browser: never before the start nor past the end of what there is to scroll
  set(this: Box, v: number) {
    scrolls.set(this, Math.max(0, Math.min(scrollWidth(this) - this.clientWidth, Number(v) || 0)));
  },
});
(FakeElement.prototype as unknown as { scrollTo(o: { left: number }): void }).scrollTo = function (this: Box, o: { left: number }) {
  this.scrollLeft = o.left;
};

// ---------------------------------------------------------------- the worker's answer: 20 real map runs
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const members = IDX.flatMap((row, r) => row.map((idx, i) => ({ row: (r ? "back" : "front") as "front" | "back", i, name: String(sv.raw.hero[idx].name), cls: Number(sv.raw.hero[idx].class) })));
const fighters: HpFighter[] = members.map((m) => ({ who: locationOf(m.row, m.i), name: m.name, cls: m.cls }));
const [front, back] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
const runs = traceWorst(sim, { map: { spec: { id: 15, prestigeLevel: 0, grade: 3 }, scrolls: [] } }, front, back);

// ---------------------------------------------------------------- the page's chart flow (battle-page.ts)
let runPick: RunPick = "best";
let chart: HpChartData | null = null;
let turnAt = 0;
let turnPick: FightTime = { run: 0, turn: 0 };
let stepAt: number | null = null;
let box: F;
/** drawShown: the picked run's fought rooms, with their identity (roomIds). */
const runsOf = (pick: RunPick): HpRun[] => {
  const rooms = pickedTrace(runs, pick)!.map!;
  const tabs = mapRoomTabs(rooms);
  const ids = roomIds(rooms);
  return rooms.flatMap((r, k): HpRun[] => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label, quest: { id: r.questId, rare: r.isRare }, ...ids[k] }] : []));
};
function selectTurn(i: number): void {
  turnAt = i;
  turnPick = timeOf(chart!, i);
  stepAt = null;
}
function showHp(hp: HpRun[], keep?: { who: number | null }, fresh = false): void {
  chart = hpData(hp, fighters);
  const want = turnPick;
  turnAt = chart ? (keep ? clampStep(chart, want) : pickStep(chart, want)) : 0;
  if (chart) turnPick = timeOf(chart, turnAt);
  stepAt = null;
  drawHpChart(box, chart, { selected: turnAt, onSelect: selectTurn, step: stepAt, pick: { value: runPick, onPick: setPick }, follow: Boolean(keep), toEnd: fresh }, !keep);
}
const drawShown = (keep?: { who: number | null }, fresh = false) => showHp(runsOf(runPick), keep, fresh);
function setPick(p: RunPick): void {
  runPick = p;
  drawShown({ who: null });
}
/** The worker answered (a new page view): Best picked, the chart drawn fresh. */
const answer = (pick: RunPick) => {
  runPick = pick;
  turnPick = { run: 0, turn: 0 };
  box = document.createElement("section") as unknown as F;
  (document.body as unknown as FakeElement).append(box);
  drawShown(undefined, true);
};
/** A click on the picker's option (its radio's change, as a browser fires it). */
const pick = (p: RunPick) => {
  const input = box.querySelectorAll("input").find((i) => i.getAttribute("value") === p)! as FakeElement & { checked: boolean };
  input.checked = true;
  input.dispatch("change");
};
const key = (k: string) => {
  const plot = box.querySelector("svg.hp-svg")!;
  for (const f of plot.listeners.get("keydown") ?? []) (f as unknown as (e: object) => void)({ key: k, preventDefault() {} });
};
const scroller = () => box.querySelector(".hp-scroll")! as F;
const isBoss = (d: HpChartData, run: number) => Boolean(d.runs[run].room?.startsWith("Boss"));
/** The share of the boss fight's width in view (All). */
const bossSeen = () => {
  const L = chartLayout(chart!, HP_W), k = chart!.runs.length - 1;
  assert.ok(isBoss(chart!, k));
  const a = 38 + L.spans[k].left, b = a + L.spans[k].width, s = scroller().scrollLeft;
  return Math.max(0, Math.min(b, s + VIEW) - Math.max(a, s)) / (b - a);
};
const selected = () => Number(box.querySelector("svg.hp-svg")!.getAttribute("aria-valuenow"));
const selX = () => chartLayout(chart!, HP_W).xs[selected()] - scroller().scrollLeft;
const zoomTicks = () => box.querySelectorAll("text.hp-axis").map((t) => t.textContent).filter((t) => !t.endsWith("%"));
const zoomTab = () => box.querySelectorAll("button.hp-fight").map((b) => b.textContent).filter((t) => t !== "All");

// ---------------------------------------------------------------- the data the bug needs
test("the runs: each has its own map; the worst and the best differ in rooms and turns; Random is neither", () => {
  const ws = runsOf("worst"), bs = runsOf("best");
  assert.notEqual(runs.worst, runs.best);
  assert.notEqual(ws.length, bs.length, "another number of rooms");
  const turns = (r: HpRun[]) => r.reduce((n, x) => n + x.trace.turns, 0);
  assert.ok(turns(ws) > turns(bs), "Best has fewer turns than Worst");
  // a room's index names another room in the other run: the best's boss index is a plain room in the worst
  const bossAt = bs.findIndex((r) => r.room!.startsWith("Boss"));
  assert.ok(!ws[bossAt].room!.startsWith("Boss"), "U77's identity (the index) is another room there");
  // U79: the identity is the room's enemy and which of them it is: the boss is the boss in both
  const wd = hpData(ws, fighters)!, bd = hpData(bs, fighters)!;
  const bossB = bd.runs.length - 1;
  assert.ok(isBoss(wd, nearFight(wd, timeOf(bd, bd.runStarts[bossB]))));
  assert.notEqual(wd.runs[bossB]?.turns, undefined);
});

test("roomIds: the enemy and which of them it is, the boss its own; nearFight: the same room, else the one standing for it", () => {
  const rooms = [
    { questId: 10, isRare: false, boss: false }, { questId: 10, isRare: false, boss: false }, { questId: 11, isRare: true, boss: false },
    { questId: 12, isRare: false, boss: false }, { questId: 12, isRare: false, boss: true },
  ];
  const ids = roomIds(rooms);
  assert.equal(new Set(ids.map((x) => x.fight)).size, 5, "every room its own");
  assert.equal(ids[1].fight, ids[0].fight + 1, "the second of an enemy");
  assert.notEqual(ids[4].fight, ids[3].fight, "the boss is not the room of the same enemy");
  assert.deepEqual(ids.map((x) => x.at), [0, 0.25, 0.5, 0.75, 1]);
  const trace = runsOf("worst")[0].trace;
  const mk = (rs: typeof rooms) => hpData(rs.map((r, k) => ({ trace, enemy: "E", room: r.boss ? "Boss · E" : `${k + 1} · E`, ...roomIds(rs)[k] })), [])!;
  const one = mk([rooms[0], rooms[2], rooms[3], rooms[4]]); // one 10 only, no second
  const full = mk(rooms);
  assert.equal(nearFight(one, timeOf(full, full.runStarts[4])), 3, "the boss");
  assert.equal(nearFight(one, timeOf(full, full.runStarts[1])), 0, "the second 10 → the first 10");
  const none = mk([rooms[0], rooms[1], rooms[3], rooms[4]]); // no 11
  assert.equal(nearFight(none, timeOf(full, full.runStarts[2])), 1, "a room it has none of: the nearest in the map (a tie: the earlier)");
  // a run that ended sooner: the boss it never reached is its last turn (U76)
  // (its map is the full one, the rooms it never reached left out by the page: their places are the map's)
  const fullIds = roomIds(rooms);
  const short = hpData(rooms.slice(0, 3).map((r, k) => ({ trace, enemy: "E", room: `${k + 1} · E`, ...fullIds[k] })), [])!;
  assert.equal(clampStep(short, timeOf(full, full.runStarts[4] + 1)), short.steps.length - 1);
  // no `at` (a quest, an old caller): U76 / U77 as they were
  const plain = hpData([{ trace, enemy: "E" }, { trace, enemy: "F" }], [])!;
  assert.equal(nearFight(plain, { run: 5, turn: 0 }), -1);
});

test("anchorStep: the selected step while it is in view, else the step in the middle of the box", () => {
  const xs = [0, 100, 200, 300, 400, 500, 600];
  assert.equal(anchorStep(xs, 4, 300, 300), 4);
  assert.equal(anchorStep(xs, 0, 300, 300), 5, "far off: the middle (450: 400 or 500, the later)");
  assert.equal(anchorStep(xs, 0, 0, 0), 0, "no layout: the selected one");
});

// ---------------------------------------------------------------- the user's report, All
test("All: the chart at its end (the boss) stays on the boss through Best → Worst → Best", () => {
  answer("best");
  assert.equal(bossSeen(), 1, "a new result starts at its end: the boss");
  assert.equal(selected(), 0, "the selected turn is far off (turn 0, the first room)");
  for (const p of ["worst", "best", "worst", "random", "best"] as RunPick[]) {
    pick(p);
    assert.equal(bossSeen(), 1, `${p}: the boss still in view`);
  }
});

test("All: the boss's last turn selected stays the boss's turn at the same place on screen through Best → Worst → Best", () => {
  answer("best");
  key("End"); // the boss's last turn, brought into view
  assert.ok(isBoss(chart!, chart!.steps[selected()].run), `the boss: ${selected()}`);
  const x = selX();
  assert.ok(x >= 0 && x <= VIEW, `in view: ${x}`);
  pick("worst");
  assert.ok(isBoss(chart!, chart!.steps[selected()].run), "Worst: still the boss (not the room at the best's boss index)");
  assert.ok(Math.abs(selX() - x) < 1e-6, `at the same place on screen: ${selX()} ${x}`);
  pick("best");
  assert.ok(isBoss(chart!, chart!.steps[selected()].run));
  assert.ok(Math.abs(selX() - x) < 1e-6);
});

// ---------------------------------------------------------------- the user's report, zoomed
test("zoomed on the boss: Worst → Best → Worst shows each run's own boss turns", () => {
  answer("worst");
  const bossTurns = (p: RunPick) => runsOf(p).at(-1)!.trace.turns;
  assert.notEqual(bossTurns("worst"), bossTurns("best"));
  const bossTab = box.querySelectorAll("button.hp-fight").find((b) => b.textContent.startsWith("Boss"))!;
  bossTab.dispatch("click");
  // zoomed, the room fills the 312 px plot: a tick every turn up to 11 turns (28 px apart at least)
  const ticks = (p: RunPick) => Array.from({ length: bossTurns(p) + 1 }, (_, t) => String(t));
  assert.ok(Math.max(bossTurns("worst"), bossTurns("best")) <= 11);
  assert.deepEqual(zoomTicks(), ticks("worst"));
  for (const p of ["best", "worst", "best", "worst"] as RunPick[]) {
    pick(p);
    assert.ok(zoomTab()[0]?.startsWith("Boss"), `${p}: still zoomed on the boss`);
    assert.deepEqual(zoomTicks(), ticks(p), `${p}: its boss's ${bossTurns(p)} turns`);
  }
});

// ---------------------------------------------------------------- Random
test("randomRun: the first run that is neither the worst nor the best", () => {
  assert.equal(randomRun(20, 0, 5), 1);
  assert.equal(randomRun(20, 1, 0), 2);
  assert.equal(randomRun(20, 3, 4), 0);
  assert.equal(randomRun(20, 0, 0), 1, "all runs alike: worst = best = 0");
  assert.equal(randomRun(2, 0, 1), 0, "two runs: no third, run 0");
  assert.equal(randomRun(1, 0, 0), 0);
  assert.equal(randomRun(0, -1, -1), -1);
  assert.equal(pickedRun({ outcomes: [{}, {}, {}] as never, worst: 0, best: 2 }, "random"), 1);
});

test("traceWorst keeps the Random run's trace (and the worst's and the best's), three at most", () => {
  assert.equal(runs.worst, worstRun(runs.outcomes));
  assert.equal(runs.best, bestRun(runs.outcomes));
  const r = pickedRun(runs, "random");
  assert.ok(r !== runs.worst && r !== runs.best);
  assert.deepEqual(Object.keys(runs.traces).map(Number).sort((a, b) => a - b), [r, runs.worst, runs.best].sort((a, b) => a - b));
  assert.ok(pickedTrace(runs, "random")?.map);
});

// ---------------------------------------------------------------- the flow above is the page's
test("the page: drawShown gives each room its identity (roomIds); showHp, setPick and selectTurn as run above", () => {
  const shown = fn(page, "drawShown");
  assert.match(shown, /const ids = roomIds\(rooms\);/);
  assert.match(shown, /quest: \{ id: r\.questId, rare: r\.isRare \}, \.\.\.ids\[k\] \}\] : \[\]\)\), members, false, keep, fresh\);/);
  assert.match(shown, /const run = pickedTrace\(runs, pickNow\(\)\);/);
  const show = fn(page, "showHp");
  assert.match(show, /turnAt = chart \? \(keep \? clampStep\(chart, want\) : pickStep\(chart, want\)\) : 0;/);
  assert.match(show, /if \(chart\) turnPick = timeOf\(chart, turnAt\);/);
  assert.match(show, /follow: Boolean\(keep\), toEnd: fresh \}, !keep\);/);
  assert.match(fn(page, "setPick"), /drawShown\(\{ who \}\);/);
  assert.match(fn(page, "selectTurn"), /turnPick = timeOf\(chart, i\);/);
  assert.match(page, /let turnPick: FightTime = \{ run: 0, turn: 0 \};/);
});
