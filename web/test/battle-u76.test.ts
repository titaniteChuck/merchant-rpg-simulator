// Battle Simulator U76: the chart and the opponent panel on a phone. A tap on the chart draws no blue highlight, no
// selection, no focus ring (the keyboard's ring stays); switching Worst / Random / Best or HP / Damage dealt / Heals
// keeps the turn (clampStep: past the new run's end, its last turn; a fight it never reached, the last fight's last
// turn), the actor's step, the zoom and the scroll; the map's modifiers have short faces (asc 0, A, the prefix's
// name, the suffix's "+1") and fit at 360 px; a swipe that starts at the plot's visible edges scrolls the chart
// (edgeZones). No browser: real traces, the chart in the fake DOM, the page code and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs, type TracedFight } from "../src/ui/battle-plan.ts";
import { select, shortLabel, shortOf, shortPick } from "../src/ui/dom.ts";
import {
  clampStep, drawHpChart, EDGE_PX, edgeZones, type HpChartData, hpChart, hpData, type HpFighter, keepStep, stepsOf, zoomAfter,
} from "../src/ui/hp-chart.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), chartSrc = read("web/src/ui/hp-chart.ts"), css = read("site/style.css");
const block = css.slice(css.indexOf("/* U76 */"), css.indexOf("/* end U76 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));
type F = FakeElement & HTMLElement;

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

const [f0, b0] = party();
const odinTrace = traceFight(sim, 72, [...f0], [...b0]);
const odin: HpChartData = hpData([{ trace: odinTrace, enemy: "Odin" }], fighters)!;
const odin3: HpChartData = hpData([{ trace: cut(odinTrace, 3), enemy: "Odin" }], fighters)!;
const [f1, b1] = party();
const rooms = traceMapRun(sim, { id: 15, prestigeLevel: 0, grade: 3 }, [...f1], [...b1]);
const tabs = mapRoomTabs(rooms);
const roomRuns = rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label }] : []));
const map: HpChartData = hpData(roomRuns, fighters)!;
/** The same map run ending in its third room, after that room's turn 2 (of 3). */
const short: HpChartData = hpData([roomRuns[0], roomRuns[1], { ...roomRuns[2], trace: cut(roomRuns[2].trace, 2) }], fighters)!;
const at = (d: HpChartData, i: number) => ({ run: d.steps[i].run, turn: d.steps[i].turn });
const box = () => {
  const b = document.createElement("section") as unknown as F;
  (document.body as unknown as FakeElement).append(b);
  return b;
};

// ---------------------------------------------------------------- 1. the run switch keeps the turn (clamped)
test("clampStep: the same fight and turn when the new run has them; else its last turn; a fight never reached, the last one's", () => {
  assert.ok(odinTrace.turns > 5 && map.runs.length > 2, "a long fight and a map run of three rooms or more");
  for (let i = 0; i < odin.steps.length; i++) assert.equal(clampStep(odin, at(odin, i)), i, "a run of the same length: every turn kept");
  assert.equal(clampStep(odin3, { run: 0, turn: 2 }), 2);
  assert.deepEqual(at(odin3, clampStep(odin3, { run: 0, turn: 7 })), { run: 0, turn: 3 }, "past the end: the last turn");
  assert.deepEqual(at(odin3, clampStep(odin3, { run: 0, turn: 0 })), { run: 0, turn: 0 });
  // a map run that ends sooner: room 2's turn 2 is its end
  assert.equal(short.runs.length, 3);
  assert.equal(map.runs[2].turns, 3);
  assert.deepEqual(at(short, clampStep(short, { run: 2, turn: 1 })), { run: 2, turn: 1 }, "a turn it has");
  assert.deepEqual(at(short, clampStep(short, { run: 2, turn: 3 })), { run: 2, turn: 2 }, "the same fight, its last turn");
  assert.deepEqual(at(short, clampStep(short, { run: 0, turn: 999 })), { run: 0, turn: short.runs[0].turns }, "an earlier fight keeps its own");
  assert.deepEqual(at(short, clampStep(short, { run: 3, turn: 1 })), { run: 2, turn: 2 }, "a fight the run never reached: the last fight's last turn");
  assert.equal(clampStep(short, { run: 5, turn: 0 }), short.steps.length - 1);
  // a longer run afterwards: the clamped turn is kept as it is (no memory per run of where it was)
  const back = clampStep(map, at(short, clampStep(short, { run: 3, turn: 1 })));
  assert.deepEqual(at(map, back), { run: 2, turn: 2 });
});

test("keepStep: the actor shown before keeps its step in the new run's turn; an actor not acting there, the turn's end", () => {
  const i = 2; // turn 2
  const steps = stepsOf(odin, i);
  assert.ok(steps.length > 1);
  steps.forEach((s, k) => assert.equal(keepStep(odin, i, s.who), k));
  assert.equal(keepStep(odin, i, null), null, "the turn's end stays the turn's end");
  assert.equal(keepStep(odin, i, 99), null, "an actor not in the turn");
  assert.equal(keepStep(odin, 0, steps[0].who), null, "turn 0 has no step");
  // a fighter that fell earlier in this run: its step is gone, the same actor elsewhere moves to its new index
  const fake = { ...odin, runs: [{ ...odin.runs[0], trace: { ...odinTrace, actions: odinTrace.actions.filter((a) => !(a.turn === 2 && a.who === steps[0].who)) } }] };
  assert.equal(keepStep(fake, i, steps[0].who), null);
  assert.equal(keepStep(fake, i, steps[1].who), 0);
});

test("zoomAfter: a redraw keeps the zoom while the turn is in its room; a run switch (follow) takes it to the turn's room", () => {
  const r1 = map.runStarts[1] + 1, r2 = map.runStarts[2] + 1;
  assert.equal(zoomAfter(map, r1, 1), 1);
  assert.equal(zoomAfter(map, r2, 1), null, "an edit's new turn in another room: All");
  assert.equal(zoomAfter(map, r2, 1, true), 2, "a run switch clamped into another room: the zoom goes with it");
  assert.equal(zoomAfter(map, r2, null, true), null, "no zoom: none");
  assert.equal(zoomAfter(odin, 3, 0, true), null, "a quest: nothing to zoom on");
});

test("the page: a run switch keeps the turn (clamped), the actor's step, the zoom and the scroll; nothing runs again", () => {
  const set = fn(page, "setPick");
  assert.match(set, /const who = chart && stepAt !== null \? stepsOf\(chart, turnAt\)\[stepAt\]\?\.who \?\? null : null;\s*drawShown\(\{ who \}\);/);
  assert.doesNotMatch(set, /renderPlan|startRuns|postMessage|turnPick =|Map\(|\[runPick\]/, "no run, no memory per run");
  const draw = fn(page, "drawShown");
  assert.equal(draw.match(/members, false, keep\)/g)?.length, 2, "a quest and a map run both keep");
  const show = fn(page, "showHp");
  assert.match(show, /turnAt = chart \? \(keep \? clampStep\(chart, want\) : pickStep\(chart, want\)\) : 0;/);
  assert.match(show, /stepAt = chart && keep && !clamped \? keepStep\(chart, turnAt, keep\.who\) : null;/);
  // the scroll is kept (no move to the turn) unless the turn was clamped; the zoom follows the turn
  assert.match(show, /follow: Boolean\(keep\) \}, !keep \|\| clamped\);/);
  // an edit (a new trace) is unchanged: pickStep, turn 0 when the turn is gone, the turn's end
  assert.match(fn(page, "renderPlan"), /drawShown\(\);/);
});

test("the chart: a tab switch keeps the turn, the step, the zoom and the scroll", () => {
  const b = box();
  const sel = map.runStarts[1] + 2;
  drawHpChart(b, map, { selected: sel, step: 1, zoom: 1 });
  b.querySelector('[data-tab="heal"]')!.dispatch("click");
  const svg = b.querySelector("svg.hp-svg")!;
  assert.equal(svg.getAttribute("aria-valuenow"), String(sel));
  assert.ok(b.querySelector(".hp-fights")!.classList.contains("zoomed"), "still zoomed");
  assert.match(b.querySelector(".hp-act-count")!.textContent, /^ 2\//, "the step kept");
  b.querySelector('[data-tab="hp"]')!.dispatch("click");
  // in All, wider than the box: the scroll stays where it was
  const c = box();
  drawHpChart(c, map, { selected: sel, zoom: null });
  const sc = c.querySelector(".hp-scroll")! as F;
  assert.ok(sc.classList.contains("overflow"));
  const moves: number[] = [];
  Object.assign(sc, { scrollLeft: 77, clientWidth: 300, scrollTo: (o: { left: number }) => moves.push(o.left) });
  c.querySelector('[data-tab="dmg"]')!.dispatch("click");
  assert.equal((c.querySelector(".hp-scroll")! as F).scrollLeft, 77);
  assert.deepEqual(moves, []);
  c.querySelector('[data-tab="hp"]')!.dispatch("click");
});

test("the chart: a run switch's redraw (follow) keeps a zoom on the clamped turn's room and the scroll", () => {
  const b = box();
  drawHpChart(b, map, { selected: map.runStarts[3] + 1, zoom: 3 });
  // the shorter run has no room 4: the last room's last turn, zoomed there
  const to = clampStep(short, { run: 3, turn: 1 });
  drawHpChart(b, short, { selected: to, follow: true }, true);
  assert.ok(b.querySelector(".hp-fights")!.classList.contains("zoomed"));
  assert.deepEqual(b.querySelectorAll("button.hp-fight").map((x) => x.getAttribute("data-run")), [null, "2"], "All, then room 3");
  // without follow (an edit) the zoom on another room gives way to All
  const c = box();
  drawHpChart(c, map, { selected: map.runStarts[3] + 1, zoom: 3 });
  drawHpChart(c, short, { selected: to });
  assert.ok(!c.querySelector(".hp-fights")!.classList.contains("zoomed"));
});

// ---------------------------------------------------------------- 2. the edge zones
test("edgeZones: at the box's visible edges while the chart scrolls; the left one covers the axis seen; none otherwise", () => {
  assert.equal(EDGE_PX, 28);
  assert.equal(edgeZones(0, 340, false, 38), null, "a chart that fits: no zone, a drag moves the cursor everywhere");
  assert.equal(edgeZones(0, 0, true, 38), null, "no layout yet");
  // at the start: the left zone is the y axis's gutter (38 px), the right one 28 px at the box's right
  assert.deepEqual(edgeZones(0, 340, true, 38), { left: { at: 0, width: 38 }, right: { at: 312, width: 28 } });
  // scrolled by 20: the gutter seen is 18 px, the zone keeps 28; they follow the scroll
  assert.deepEqual(edgeZones(20, 340, true, 38), { left: { at: 20, width: 28 }, right: { at: 332, width: 28 } });
  assert.deepEqual(edgeZones(500, 340, true, 38), { left: { at: 500, width: 28 }, right: { at: 812, width: 28 } });
  // a narrow box: a zone is at most a quarter of it, the middle drags the cursor
  const z = edgeZones(0, 80, true, 38)!;
  assert.deepEqual(z, { left: { at: 0, width: 20 }, right: { at: 60, width: 20 } });
  assert.equal(edgeZones(-5, 340, true)!.left.at, 0, "an overscroll counts as 0");
});

test("the chart: the edge zones over the plot act as the plot for a tap and a mouse; placed by the scroll", () => {
  const fig = hpChart(map, { width: 360 }) as unknown as F;
  const edges = fig.querySelectorAll(".hp-edge");
  assert.equal(edges.length, 2);
  for (const e of edges) {
    assert.equal(e.parentNode, fig.querySelector(".hp-plot"));
    assert.equal(e.getAttribute("aria-hidden"), "true");
    for (const t of ["pointermove", "pointerleave"]) assert.equal(e.listeners.get(t)?.length, 1, t);
    assert.equal(e.listeners.get("click")?.length, 2, "the plot's click, then the plot focused");
  }
  // the plot's own handlers are the very same functions (mouse unchanged)
  const svg = fig.querySelector("svg.hp-svg")!;
  assert.equal(svg.listeners.get("click")![0], edges[0].listeners.get("click")![0]);
  assert.equal(svg.listeners.get("pointermove")![0], edges[1].listeners.get("pointermove")![0]);
  const sc = fig.querySelector(".hp-scroll")!;
  assert.equal(sc.listeners.get("scroll")?.length, 1, "moved with the scroll");
  assert.match(fn(chartSrc, "hpChart"), /edgeZones\(scroller\.scrollLeft \|\| 0, scroller\.clientWidth \|\| 0, L\.overflow && zoom === null, M\.l\)/);
});

// ---------------------------------------------------------------- 3. the opponent's modifiers row
test("shortPick: the closed face shows the short text, the options keep the full one; follows a change and fillMods", () => {
  const s = select({ id: "map-prefix", "aria-label": "Map prefix" }, [["0", "No prefix"]]);
  const opt = (v: string, full: string, short?: string) => {
    const o = document.createElement("option");
    o.setAttribute("value", v);
    if (short) o.setAttribute("data-short", short);
    o.textContent = full;
    return o;
  };
  s.replaceChildren(opt("0", "No prefix"), opt("7", "[Ardent] · essence ×1.3, enemy Atk +10%", "Ardent"));
  const w = shortPick(s) as unknown as F;
  assert.ok(w.classList.contains("short-pick"));
  const text = w.querySelector(".short-text")!;
  assert.equal(text.getAttribute("aria-hidden"), "true", "screen readers read the select (its options' full text)");
  s.value = "0";
  shortLabel(s);
  assert.equal(text.textContent, "No prefix");
  s.value = "7";
  (s as unknown as F).dispatch("change");
  assert.equal(text.textContent, "Ardent");
  assert.equal(w.title, "[Ardent] · essence ×1.3, enemy Atk +10%", "the full text on hover");
  assert.equal(s.querySelectorAll("option")[1].textContent, "[Ardent] · essence ×1.3, enemy Atk +10%", "the open list: the full text");
  assert.equal(shortOf(s), "Ardent");
  s.hidden = true;
  shortLabel(s);
  assert.equal(w.hidden, true, "hidden with its select");
});

test("the page: asc 0 / asc 1, grades A…, the prefix's name and the suffix's short form on the closed pickers", () => {
  assert.match(page, /select\(\{ id: "map-asc", "aria-label": "Map ascension" \}, \[\["0", "asc 0"\], \["1", "asc 1"\]\]\)/);
  assert.match(page, /select\(\{ id: "map-grade", "aria-label": "Map grade" \}, GRADES\.map\(\(g, i\): \[string, string\] => \[String\(i \+ 1\), g\]\)\)/);
  assert.match(page, /mods\.append\(asc, grade, shortPick\(pre\), shortPick\(suf\)\);/);
  assert.match(fn(page, "mapPrefixOptions"), /`\[\$\{prefixTag\(p\)\}\] · \$\{prefixEffect\("map", id, p\)\}`, prefixTag\(p\)\]/);
  assert.match(fn(page, "mapSuffixOptions"), /`\$\{suffixName\(x\)\} · \$\{suffixEffect\("map", x\)\}`, suffixName\(x\)\]/);
  const fill = fn(page, "fillMods");
  assert.match(fill, /"data-short": short/);
  assert.match(fill, /shortLabel\(s\);/, "a list filled from code updates the face");
  // the quest size is short already
  assert.match(page, /el\("option", \{ value: String\(k \+ 1\) \}, `×\$\{k \+ 1\}`\)/);
});

// ---------------------------------------------------------------- 4. CSS
test("CSS: the U76 block, after U74's (U75 follows): no tap highlight or selection on the chart, edge zones pan, row 3 shrinks", () => {
  assert.ok(block.length > 300);
  assert.ok(css.lastIndexOf("/* end U76 */") > css.lastIndexOf("/* end U74 */"), "after U74");
  assert.match(block, /\.hp-chart-box, \.hp-chart-box \*, \.hp-nav-host, \.hp-nav-host \* \{ -webkit-tap-highlight-color: transparent; \}/);
  assert.match(block, /\.hp-chart-box, \.hp-nav-host, \.hp-svg, \.hp-svg \* \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/);
  assert.match(block, /\.hp-fold \.table-wrap \{ -webkit-user-select: text; user-select: text; \}/, "the table stays selectable");
  // the keyboard's ring stays: nothing in the block removes a :focus-visible outline
  assert.doesNotMatch(block, /(?<!not\():focus-visible[^{]*\{[^}]*outline: none/);
  assert.match(block, /\.hp-edge \{ position: absolute; top: 0; bottom: 0; z-index: 1; touch-action: pan-x pan-y;/);
  assert.match(css, /\.hp-svg \{ display: block; width: 100%; height: auto; touch-action: pan-y;/, "the plot itself: a horizontal drag moves the cursor");
  assert.match(block, /#target \.opp-mods \{ flex-wrap: nowrap;[^}]*min-width: 0; \}/);
  assert.match(block, /#target \.opp-mods > \.short-pick \{ flex: 0 1 auto; min-width: 0; \}/);
  assert.match(block, /\.short-text \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  assert.match(block, /\.short-pick > select \{ position: absolute; inset: 0;[^}]*opacity: 0;/);
  assert.match(block, /\.short-pick:has\(> select:focus-visible\) \{ outline: 2px solid var\(--accent\)/);
});
