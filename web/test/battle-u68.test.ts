// Battle Simulator U68: the Party view's chart (web/src/ui/hp-chart.ts), round 3. Every turn at least as wide as
// before U66 (the even share); the enemy's line starts again at a room change (no vertical segment); a tab switch
// keeps the sideways scroll; ‹ Turn X › centred under the plot; zoom on a map room (a fight tab, a click in All) and
// back (All), animated by an eased lerp; the y axis tops at the view's largest value. No browser: the pure layout
// functions, known traces, the chart in the fake DOM with a fake requestAnimationFrame.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs } from "../src/ui/battle-plan.ts";
import {
  axisTop, CHART_ANIM_MS, chartLayout, drawHpChart, ease, fightLayout, fightName, fightTabs, hpChart, type HpChartData, hpData,
  type HpFighter, lerp, lerpView, linePath, minTurnWidth, nearestStep, plotted, scrollForSpan, turnText, windowOf, zoomOf,
} from "../src/ui/hp-chart.ts";
import { fmtCompact } from "../src/ui/dom.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css"), chartSrc = read("web/src/ui/hp-chart.ts");

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const fighters: HpFighter[] = IDX.flatMap((row, r) => row.map((idx, i): HpFighter => {
  const raw = sv.raw.hero[idx];
  return { who: locationOf(r ? "back" : "front", i), name: String(raw.name), cls: Number(raw.class) };
}));
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
type F = FakeElement & HTMLElement & Record<string, unknown>;

const [f0, b0] = party();
const odin = hpData([{ trace: traceFight(sim, 72, [...f0], [...b0]), enemy: "Odin" }], fighters)!;
const [f1, b1] = party();
const rooms = traceMapRun(sim, { id: 1, prestigeLevel: 0, grade: 3 }, [...f1], [...b1]);
const tabs = mapRoomTabs(rooms);
const map: HpChartData = hpData(rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label }] : [])), fighters)!;
/** The plot's margins in viewBox units (hp-chart.ts M): left 38, right 10. */
const ML = 38, MR = 10;
const lastOf = (d: HpChartData, k: number) => d.runStarts[k] + d.runs[k].turns;
const box = () => {
  const b = document.createElement("section") as unknown as F;
  (document.body as unknown as FakeElement).append(b);
  return b;
};
/** A plot whose box is `w` px wide at the page's left (the fake DOM has no layout). */
const sized = (fig: F, w: number) => {
  const svg = fig.querySelector("svg")! as F;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: 200, width: w, height: 200 }) as never;
  return svg;
};
const clickAt = (svg: F, clientX: number) => svg.listeners.get("click")![0]({ clientX } as never);

// ---------------------------------------------------------------- 1. the least turn width
test("every turn is at least as wide as before U66: the plot shared evenly by the run's turns", () => {
  assert.equal(minTurnWidth(10, 400), 40);
  assert.equal(minTurnWidth(0, 400), 400, "no turns: one");
  // a quest: just as 973f49a (PW / (n − 1), the steps evenly over the plot)
  const W = 800, room = W - ML - MR;
  const L = chartLayout(odin, W);
  assert.ok(!L.overflow);
  for (let i = 1; i < odin.steps.length; i++) assert.ok(Math.abs(L.xs[i] - L.xs[i - 1] - room / odin.runs[0].turns) < 1e-9);
  // a map run: every turn at least the even share over all its turns; a longer fight is wider
  const total = map.runs.reduce((n, r) => n + r.turns, 0);
  for (const width of [300, 800, 1600]) {
    const M2 = chartLayout(map, width);
    const min = minTurnWidth(total, width - ML - MR);
    for (const p of M2.perTurn) assert.ok(p >= min - 1e-9, `${p} ≥ ${min} at ${width}`);
    assert.ok(M2.plot >= width - ML - MR - 1e-9, "the fights fill the plot at least");
  }
  // a 13-turn fight and a 5-turn one with short names: 13 × the share against 5 ×
  const f = fightLayout([{ turns: 13, tab: 30 }, { turns: 5, tab: 30 }], 360);
  assert.deepEqual(f.spans.map((s) => s.width), [260, 100]);
  assert.ok(!f.overflow);
  // a long name over a short fight: its turns widen, the others keep their share, the chart scrolls
  const w = fightLayout([{ turns: 13, tab: 30 }, { turns: 2, tab: 150 }], 300);
  assert.deepEqual(w.perTurn, [20, 75]);
  assert.ok(w.overflow && w.plot === 410);
});

// ---------------------------------------------------------------- 2. the enemy's line at a room change
test("linePath: a break starts a new move on the same x, no segment from the point before", () => {
  assert.equal(linePath([0, 10, 10, 20], [184, 184, 16, 50]), "M0,184L10,184L10,16L20,50");
  assert.equal(linePath([0, 10, 10, 20], [184, 184, 16, 50], [2]), "M0,184L10,184M10,16L20,50");
  assert.equal(linePath([0, 10, 20], [1, null, 3]), "M0,1M20,3", "a gap");
  assert.equal(linePath([0, 10], [null, null]), "");
  // the chart: the enemy's path moves once per room, each move at 100 % on the room's shared x
  const fig = hpChart(map, { width: 800 }) as unknown as F;
  const d = fig.querySelector("path.hp-enemy")!.getAttribute("d")!;
  const moves = [...d.matchAll(/M([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const L = chartLayout(map, 800);
  assert.deepEqual(moves.map((m) => m[0]), map.runStarts.map((i) => Math.round(L.xs[i] * 10) / 10));
  for (const m of moves) assert.equal(m[1], 16, "100 % at the plot's top");
  // the heroes' lines go on through a room change (one move unless a fall)
  for (const s of map.series.filter((s) => !s.enemy && !s.deaths.length)) {
    assert.equal(fig.querySelector(`path.hp-line.cls-${s.cls}`)!.getAttribute("d")!.match(/M/g)!.length, 1, s.name);
  }
});

// ---------------------------------------------------------------- 3. zoom
test("zoom layout: the room fills the plot, the others on its scale off the plot; a quest has nothing to zoom on", () => {
  const W = 500;
  for (let k = 0; k < map.runs.length; k++) {
    const L = chartLayout(map, W, k);
    assert.equal(L.zoom, k);
    assert.ok(!L.overflow && L.W === W, "no scroll");
    assert.equal(L.xs[map.runStarts[k]], ML, "turn 0 on the left edge");
    assert.ok(Math.abs(L.xs[lastOf(map, k)] - (W - MR)) < 1e-9, "the last turn on the right edge");
    for (const [i, st] of map.steps.entries()) {
      if (st.run < k) assert.ok(L.xs[i] <= ML + 1e-9, "an earlier room off to the left");
      if (st.run > k) assert.ok(L.xs[i] >= W - MR - 1e-9, "a later room off to the right");
    }
    assert.deepEqual(windowOf(map, k), [map.runStarts[k], lastOf(map, k)]);
  }
  assert.equal(zoomOf(odin, 0), null);
  assert.equal(zoomOf(map, map.runs.length), null);
  assert.equal(zoomOf(map, undefined), null);
  assert.equal(chartLayout(odin, W, 0).zoom, null);
  assert.deepEqual(windowOf(map, null), [0, map.steps.length - 1]);
  // a zoomed click picks only in the room: its left edge is its turn 0, not the room before's last turn
  const L1 = chartLayout(map, W, 1), [lo, hi] = windowOf(map, 1);
  assert.equal(nearestStep(ML, L1.xs, lo, hi), map.runStarts[1]);
  assert.equal(nearestStep(W, L1.xs, lo, hi), lastOf(map, 1), "not the next room's turn 0");
  // the room centred when the zoom goes back to a run wider than the box
  assert.equal(scrollForSpan(600, 200, 1500, 400), 500);
  assert.equal(scrollForSpan(0, 100, 1500, 400), 0);
  assert.equal(scrollForSpan(1400, 100, 1500, 400), 1100);
  assert.equal(scrollForSpan(10, 100, 300, 400), 0, "fits: no scroll");
});

test("fight tabs: one per fight in All; zoomed, All then the room; a quest only its fight", () => {
  assert.deepEqual(fightTabs(map, null).map((t) => t.run), map.runs.map((_, k) => k));
  assert.deepEqual(fightTabs(map, 1), [{ run: null, label: "All" }, { run: 1, label: fightName(map, 1) }]);
  assert.deepEqual(fightTabs(odin, 0), [{ run: 0, label: "Odin" }]);
  // the chart: a fight tab zooms, All zooms back
  const picks: number[] = [], zooms: (number | null)[] = [];
  const fig = hpChart(map, { width: 500, onSelect: (i) => picks.push(i), onZoom: (z) => zooms.push(z) }) as unknown as F;
  const names = () => fig.querySelectorAll("button.hp-fight").map((b) => b.textContent);
  fig.querySelectorAll("button.hp-fight")[1].dispatch("click");
  assert.deepEqual(names(), ["All", fightName(map, 1)]);
  assert.deepEqual(picks, [map.runStarts[1]], "the room's turn 0");
  assert.ok(fig.querySelector(".hp-fights")!.classList.contains("zoomed"));
  assert.equal(fig.querySelector("button.hp-all")!.style.left, "0%");
  const tab = fig.querySelector('button.hp-fight[data-run="1"]')!;
  assert.equal(tab.style.left, `${Math.round(1000 * ML / 500) / 10}%`);
  assert.equal(tab.style.width, `${Math.round(1000 * (500 - ML - MR) / 500) / 10}%`, "over the whole plot");
  assert.ok(!fig.querySelector(".hp-scroll")!.classList.contains("overflow"));
  // the zoomed room's ticks start at its turn 0
  const ticks = fig.querySelectorAll("text.hp-axis").filter((t) => t.getAttribute("text-anchor") === "middle");
  assert.equal(ticks[0].textContent, "0");
  assert.equal(Number(ticks[0].getAttribute("x")), ML);
  fig.querySelector("button.hp-all")!.dispatch("click");
  assert.deepEqual(names(), map.runs.map((_, k) => fightName(map, k)));
  assert.deepEqual(zooms, [1, null]);
  assert.deepEqual(picks, [map.runStarts[1]], "All picks nothing");
  // a quest: one tab, a click zooms nothing
  const q = hpChart(odin, { onZoom: (z) => zooms.push(z) }) as unknown as F;
  q.querySelector("button.hp-fight")!.dispatch("click");
  assert.equal(q.querySelectorAll("button.hp-fight").length, 1);
  assert.equal(zooms.length, 2);
});

test("a click in the plot: in All it picks the turn and zooms on its room; zoomed, it picks in the room only", () => {
  const W = 800, L = chartLayout(map, W);
  const picks: number[] = [], zooms: (number | null)[] = [];
  const fig = hpChart(map, { width: W, onSelect: (i) => picks.push(i), onZoom: (z) => zooms.push(z) }) as unknown as F;
  // in All the plot is L.W px wide (1 unit = 1 px when it overflows), zoomed the box's W
  const svg = sized(fig, L.W);
  // the shared x of room 1's turn 0: that step (the later one), its room zoomed
  const i = map.runStarts[1];
  clickAt(svg, L.xs[i]);
  assert.deepEqual(picks, [i]);
  assert.deepEqual(zooms, [1], "one zoom, with the pick");
  // zoomed: the right edge is the room's last turn
  sized(fig, W);
  clickAt(svg, W);
  assert.deepEqual(picks, [i, lastOf(map, 1)]);
  assert.deepEqual(zooms, [1], "no new zoom");
  // the keys walking out of the room take the zoom along
  svg.listeners.get("keydown")![0]({ key: "ArrowRight", preventDefault() {} } as never);
  assert.deepEqual(picks.at(-1), map.runStarts[2] ?? lastOf(map, 1));
  if (map.runs.length > 2) assert.deepEqual(zooms, [1, 2]);
  assert.match(chartSrc, /a click in the plot in All, zooms on that room/);
});

// ---------------------------------------------------------------- 4. the y axis
test("the y axis tops at the view's largest value: the zoomed room, or the whole run", () => {
  for (const tab of ["dmg", "heal"] as const) {
    const all = Math.max(...map.series.flatMap((s) => plotted(map, s, tab)).map((v) => v ?? 0));
    assert.equal(axisTop(map, tab, null), all || 10);
    for (let k = 0; k < map.runs.length; k++) {
      const [lo, hi] = windowOf(map, k);
      const m = Math.max(...map.series.flatMap((s) => plotted(map, s, tab).slice(lo, hi + 1)).map((v) => v ?? 0));
      assert.equal(axisTop(map, tab, k), m || 10, `${tab} room ${k + 1}`);
      assert.ok(axisTop(map, tab, k) <= axisTop(map, tab, null));
    }
  }
  assert.equal(axisTop(map, "hp", 0), 100, "the enemy starts full");
  // drawn: the top grid label is the top itself; a line's highest point touches the plot's top (y 16)
  const k = [...map.runs.keys()].find((k) => axisTop(map, "dmg", k) < axisTop(map, "dmg", null))!;
  assert.notEqual(k, undefined, "a room with less damage than the run's top");
  const fig = hpChart(map, { tab: "dmg", width: 600, selected: map.runStarts[k], zoom: k }) as unknown as F;
  const labels = fig.querySelectorAll("text.hp-axis").filter((t) => t.getAttribute("text-anchor") === "end").map((t) => t.textContent);
  assert.equal(labels.at(-1), fmtCompact.format(Math.round(axisTop(map, "dmg", k))));
  const ys = fig.querySelectorAll("path.hp-line").flatMap((p) => [...p.getAttribute("d")!.matchAll(/[ML]([\d.]+),([\d.]+)/g)]
    .filter((m) => Number(m[1]) >= ML && Number(m[1]) <= 600 - MR).map((m) => Number(m[2])));
  assert.equal(Math.min(...ys), 16);
});

// ---------------------------------------------------------------- 5. the animation
test("lerp and ease: the frames between two views", () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(lerp(10, 20, 1), 20);
  assert.deepEqual([ease(-1), ease(0), ease(1), ease(2)], [0, 0, 1, 1]);
  assert.ok(ease(0.5) > 0.5 && ease(0.5) < 1, "out: fast first");
  const a = { W: 400, xs: [0, 100, 200], top: 100 }, b = { W: 400, xs: [0, 300, 600], top: 50 };
  assert.deepEqual(lerpView(a, b, 0.5), { W: 400, xs: [0, 200, 400], top: 75 });
  assert.deepEqual(lerpView(a, b, 1), b);
  assert.equal(CHART_ANIM_MS, 250);
});

test("a zoom animates over requestAnimationFrame frames; reduced motion: at once", () => {
  const g = globalThis as Record<string, unknown>;
  const frames: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (f: (t: number) => void) => frames.push(f);
  g.cancelAnimationFrame = () => {};
  try {
    const W = 500, from = chartLayout(map, W), to = chartLayout(map, W, 1);
    const fig = hpChart(map, { width: W }) as unknown as F;
    const x = () => Number(fig.querySelector("line.hp-room")!.getAttribute("x1"));
    const at = map.runStarts[1];
    assert.equal(x(), Math.round(from.xs[at] * 10) / 10);
    fig.querySelectorAll("button.hp-fight")[1].dispatch("click");
    assert.equal(x(), Math.round(from.xs[at] * 10) / 10, "the first frame: where it was");
    frames.shift()!(1000);
    frames.shift()!(1000 + CHART_ANIM_MS / 2);
    const mid = Math.round(lerp(from.xs[at], to.xs[at], ease(0.5)) * 10) / 10;
    assert.equal(x(), mid, "half way, eased");
    frames.shift()!(1000 + CHART_ANIM_MS);
    assert.equal(x(), Math.round(to.xs[at] * 10) / 10, "the end: the zoom's place");
    assert.equal(frames.length, 0, "no frame after the end");
    // reduced motion: no frame at all
    g.matchMedia = (q: string) => ({ matches: q.includes("reduce") });
    const fig2 = hpChart(map, { width: W }) as unknown as F;
    fig2.querySelectorAll("button.hp-fight")[1].dispatch("click");
    assert.equal(frames.length, 0);
    assert.equal(Number(fig2.querySelector("line.hp-room")!.getAttribute("x1")), Math.round(to.xs[at] * 10) / 10);
  } finally {
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
    delete g.matchMedia;
  }
});

// ---------------------------------------------------------------- 6. tabs keep the scroll; the zoom across redraws
test("switching HP / Damage dealt / Heals keeps the sideways scroll, no move to the selected turn", () => {
  const b = box();
  drawHpChart(b, map, { selected: 0 });
  const sc = b.querySelector(".hp-scroll")! as F;
  assert.ok(sc.classList.contains("overflow"), "the run is wider than the default box");
  const moves: number[] = [];
  Object.assign(sc, { scrollLeft: 123, clientWidth: 360, scrollTo: (o: { left: number }) => moves.push(o.left) });
  b.querySelector('[data-tab="dmg"]')!.dispatch("click");
  const sc2 = b.querySelector(".hp-scroll")! as F;
  assert.notEqual(sc2, sc, "redrawn");
  assert.equal(sc2.scrollLeft, 123);
  assert.deepEqual(moves, []);
  b.querySelector('[data-tab="hp"]')!.dispatch("click");
});

test("the zoom is kept across redraws while the selected turn is in its room", () => {
  const b = box();
  let at = 0;
  drawHpChart(b, map, { selected: 0, onSelect: (i) => (at = i) });
  b.querySelectorAll("button.hp-fight")[1].dispatch("click");
  assert.equal(at, map.runStarts[1]);
  // a tab switch: still zoomed
  b.querySelector('[data-tab="heal"]')!.dispatch("click");
  assert.equal(b.querySelector("button.hp-all")?.textContent, "All");
  // the page redraws (an edit) with the same turn: still zoomed; another room's turn: All
  drawHpChart(b, map, { selected: at });
  assert.ok(b.querySelector("button.hp-all"));
  drawHpChart(b, map, { selected: 0 });
  assert.equal(b.querySelector("button.hp-all"), null);
  b.querySelector('[data-tab="hp"]')!.dispatch("click");
});

// ---------------------------------------------------------------- 7. ‹ Turn X ›
test("‹ Turn X ›: arrow buttons named for screen readers around the turn, under the scroll box", () => {
  assert.equal(turnText(odin, 3), "Turn 3");
  const room = (k: number) => map.runs[k].room!.split(" · ")[0];
  for (const k of map.runs.keys()) {
    const head = /^\d+$/.test(room(k)) ? `Room ${room(k)}` : room(k);
    assert.equal(turnText(map, map.runStarts[k] + 1), `${head} · Turn 1`);
  }
  const fig = hpChart(map, { selected: 0 }) as unknown as F;
  const ctl = fig.querySelector(".hp-turn")!;
  assert.equal(ctl.getAttribute("role"), "group");
  assert.equal(fig.querySelector(".hp-scroll")!.querySelector(".hp-turn"), null, "not in the scroll box");
  const [prev, text, next] = ctl.children;
  assert.deepEqual([prev.getAttribute("aria-label"), next.getAttribute("aria-label")], ["Previous turn", "Next turn"]);
  assert.ok(prev.querySelector("svg") && prev.querySelector("svg")!.getAttribute("aria-hidden") === "true", "an icon");
  assert.equal(text.textContent, turnText(map, 0));
  assert.ok(prev.hasAttribute("disabled"));
  next.dispatch("click");
  assert.equal(text.textContent, turnText(map, 1));
  assert.ok(!prev.hasAttribute("disabled"));
  // centred: the U68 CSS block, at the end of style.css
  const block = css.slice(css.indexOf("/* U68 */"), css.indexOf("/* end U68 */"));
  assert.match(block, /\.hp-turn \{[^}]*justify-content: center/);
  assert.ok(css.indexOf("/* U68 */") > css.indexOf("/* end U67 */"));
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b/i, "theme tokens only");
});
