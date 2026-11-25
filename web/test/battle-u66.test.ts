// Battle Simulator U66: the Party view's chart (web/src/ui/hp-chart.ts). Every map room keeps its turn 0, on the x of
// the room before's last turn (the heroes' lines go on, the enemy's drops to 0 and rises to 100 % there); one tab per
// fight over the plot, each over its fight's turns (a name wider than its turns widens them), scrolling sideways with
// the plot when too wide (the room bar's helpers); per-turn damage and heals; Turn −1 / Turn +1; the legend only
// names; a hero's line stops where it falls; Clear all in the Simulate panel. No browser: known traces, the chart in
// the fake DOM, the page code, HTML and CSS as text.
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
  chartLayout, fightLayout, fightName, fightTabWidth, hpChart, type HpChartData, hpData, type HpFighter, HP_W, nearestStep, plotted,
} from "../src/ui/hp-chart.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css"), html = read("site/battle.html");
const chartSrc = read("web/src/ui/hp-chart.ts");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

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

// ---------------------------------------------------------------- 1. turn 0 of every room, on a shared x
test("a map room's turn 0 shares its x with the last room's last turn: heroes go on, the enemy drops and rises", () => {
  assert.ok(map.runs.length >= 2);
  const L = chartLayout(map);
  const enemy = map.series[0];
  const hp = plotted(map, enemy, "hp");
  for (const i of map.runStarts.slice(1)) {
    assert.equal(map.steps[i].turn, 0);
    assert.equal(map.steps[i - 1].turn, map.runs[map.steps[i - 1].run].turns, "the step before: the last room's last turn");
    assert.equal(L.xs[i], L.xs[i - 1], "one x for both");
    // the enemy: room N's at 0 (it fell), room N+1's fresh one at 100 %
    assert.equal(hp[i - 1], 0);
    assert.equal(hp[i], 100);
    // a standing hero: the same HP (rounded at most), so the line goes straight on
    for (const s of map.series.filter((s) => !s.enemy)) {
      const p = plotted(map, s, "hp");
      if (p[i - 1] !== null && p[i] !== null) assert.ok(Math.abs(p[i]! - p[i - 1]!) < 1, `${s.name} at room ${map.steps[i].run + 1}`);
    }
    // damage and heals: nobody acts at a turn 0, the point repeats the last turn's so the line goes straight on
    for (const s of map.series) {
      for (const tab of ["dmg", "heal"] as const) {
        const p = plotted(map, s, tab);
        if (p[i - 1] !== null) assert.equal(p[i], p[i - 1]);
      }
    }
  }
  // the enemy's path: one move; a vertical segment on each shared x
  const d = (hpChart(map) as unknown as F).querySelector("path.hp-enemy")!.getAttribute("d")!;
  assert.equal(d.match(/M/g)!.length, 1);
  const pts = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const vertical = pts.filter((p, k) => k > 0 && p[0] === pts[k - 1][0] && p[1] < pts[k - 1][1]);
  assert.equal(vertical.length, map.runs.length - 1, "one rise per new room");
});

test("picking on a shared x: a click there is the next room's turn 0; one step back is the last room's last turn", () => {
  assert.deepEqual([nearestStep(10, [0, 10, 10, 20]), nearestStep(8, [0, 10, 10, 20]), nearestStep(3, [0, 10, 10, 20]), nearestStep(99, [0, 10, 10, 20])], [2, 2, 0, 3]);
  const L = chartLayout(map);
  const i = map.runStarts[1];
  assert.equal(nearestStep(L.xs[i], L.xs), i);
  const picks: number[] = [];
  const fig = hpChart(map, { selected: i, onSelect: (k) => picks.push(k) }) as unknown as F;
  fig.querySelector('button[data-dir="-1"]')!.dispatch("click");
  fig.querySelector('button[data-dir="1"]')!.dispatch("click");
  fig.querySelector('button[data-dir="1"]')!.dispatch("click");
  assert.deepEqual(picks, [i - 1, i, i + 1]);
  assert.match(chartSrc, /Two steps share that\n \* {3}x: room N's last turn, then room N\+1's turn 0\. A click or tap there picks room N\+1's turn 0/);
});

// ---------------------------------------------------------------- 2. per-turn damage and heals; falls end the line
test("damage dealt and heals are per turn, not added up", () => {
  for (const s of odin.series) {
    const dmg = plotted(odin, s, "dmg"), heal = plotted(odin, s, "heal");
    for (let i = 0; i < odin.steps.length; i++) {
      if (dmg[i] !== null) assert.equal(dmg[i], s.dealt[i]);
      if (heal[i] !== null) assert.equal(heal[i], s.healed[i]);
    }
  }
  const hero = odin.series.find((s) => !s.enemy && s.dealt.filter((v) => v).length > 1)!;
  const dmg = plotted(odin, hero, "dmg").filter((v): v is number => v !== null);
  assert.ok(dmg.some((v, k) => k > 0 && v < dmg[k - 1]), "a per-turn line goes down too");
  assert.equal(chartSrc.match(/dealtSum|healedSum|cumulative\(/g), null, "no sums left");
});

test("a hero that falls: its fall at 0 is its last point on every tab, nothing while it is down", () => {
  const fallen = odin.series.filter((s) => !s.enemy && s.deaths.length);
  assert.ok(fallen.length >= 1);
  for (const s of fallen) {
    for (const tab of ["hp", "dmg", "heal"] as const) {
      const p = plotted(odin, s, tab);
      for (const i of s.deaths) assert.notEqual(p[i], null, `${s.name} falls at ${i}: a point (${tab})`);
      s.values.forEach((v, i) => {
        if (v && v.hp <= 0 && !s.deaths.includes(i)) assert.equal(p[i], null, `${s.name} down at ${i} (${tab})`);
        if (v && v.hp > 0) assert.notEqual(p[i], null, `${s.name} standing at ${i} (${tab})`);
      });
    }
    assert.equal(plotted(odin, s, "hp")[s.deaths[0]], 0);
  }
  // the drawing: a line with no points after the fall (a stand-up starts a new move)
  const fig = hpChart(odin) as unknown as F;
  const s = fallen[0];
  const path = fig.querySelector(`path.hp-line.cls-${s.cls}`)!.getAttribute("d")!;
  const pts = path.match(/[ML]/g)!.length;
  assert.equal(pts, plotted(odin, s, "hp").filter((v) => v !== null).length);
});

// ---------------------------------------------------------------- 3. the fight tabs
test("fightLayout: one px per turn for all, unless a name is wider than its turns; too wide, it overflows", () => {
  assert.deepEqual(fightLayout([{ turns: 10, tab: 50 }, { turns: 10, tab: 50 }], 400),
    { perTurn: [20, 20], spans: [{ left: 0, width: 200 }, { left: 200, width: 200 }], plot: 400, overflow: false });
  // a 2-turn fight with a 100 px name: its turns widen to 50 px, the other shares the 300 px left
  const w = fightLayout([{ turns: 2, tab: 100 }, { turns: 18, tab: 40 }], 400);
  assert.equal(w.perTurn[0], 50);
  assert.ok(Math.abs(w.perTurn[1] - 300 / 18) < 1e-9);
  assert.equal(w.spans[0].width, 100);
  assert.ok(Math.abs(w.plot - 400) < 1e-9 && !w.overflow);
  // a widened fight can push another one under its name too: filled in rounds
  const r = fightLayout([{ turns: 1, tab: 150 }, { turns: 4, tab: 90 }, { turns: 5, tab: 20 }], 300);
  assert.deepEqual(r.spans.map((s) => Math.round(s.width)), [150, 90, 60]);
  // names wider than the room: every tab at its name's width, the plot wider than the room
  const o = fightLayout([{ turns: 1, tab: 100 }, { turns: 1, tab: 100 }, { turns: 1, tab: 100 }], 200);
  assert.deepEqual(o.spans, [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }]);
  assert.ok(o.overflow && o.plot === 300);
  // the tab's width: its name's
  assert.ok(fightTabWidth("Boss · Murlok Monarch") > fightTabWidth("Odin"));
});

test("the fight tabs: one per fight, each exactly over its turns; a click picks its turn 0", () => {
  // a quest: one tab, the enemy's name, over the whole plot
  const q = hpChart(odin) as unknown as F;
  const one = q.querySelectorAll("button.hp-fight");
  assert.equal(one.length, 1);
  assert.equal(one[0].textContent, "Odin");
  assert.equal(one[0].getAttribute("aria-current"), "true");
  // a map run: one per fought room, named as the room bar, placed as fightLayout says (in % of the chart's width)
  const L = chartLayout(map);
  const picks: number[] = [];
  const fig = hpChart(map, { onSelect: (i) => picks.push(i) }) as unknown as F;
  const bs = fig.querySelectorAll("button.hp-fight");
  assert.deepEqual(bs.map((b) => b.textContent), map.runs.map((_, k) => fightName(map, k)));
  for (const [k, b] of bs.entries()) {
    const from = L.xs[map.runStarts[k]], to = L.xs[map.runStarts[k] + map.runs[k].turns];
    assert.equal(b.style.left, `${Math.round((1000 * from) / L.W) / 10}%`);
    assert.equal(b.style.width, `${Math.round((1000 * (to - from)) / L.W) / 10}%`);
  }
  assert.equal(fig.querySelector(".hp-fights")!.getAttribute("role"), "group");
  const last = map.runs.length - 1;
  bs[last].dispatch("click");
  assert.deepEqual(picks, [map.runStarts[last]]);
  assert.equal(bs[last].getAttribute("aria-current"), "true");
  assert.equal(bs[0].getAttribute("aria-current"), null);
});

test("too wide for the box: the fight tabs and the plot scroll together, the wheel too, the selection kept in view", () => {
  const L = chartLayout(map, 300);
  assert.ok(L.overflow, "the map's room names don't fit 300 px");
  assert.ok(L.W > 300);
  for (const [k, s] of L.spans.entries()) assert.ok(s.width >= fightTabWidth(fightName(map, k)) - 1e-9, "each name fits");
  const fig = hpChart(map, { width: 300 }) as unknown as F;
  const scroller = fig.querySelector(".hp-scroll")! as F, track = fig.querySelector(".hp-track")! as F;
  assert.ok(scroller.classList.contains("overflow"));
  assert.equal(track.style.width, `${L.W}px`);
  assert.equal(fig.querySelector("svg")!.getAttribute("viewBox"), `0 0 ${L.W} 200`);
  assert.ok(track.querySelector(".hp-fights") && track.querySelector("svg"), "one scroll box for both");
  // the wheel: the room bar's rule (battle-layout.ts roomBarWheel)
  Object.assign(scroller, { scrollLeft: 0, scrollWidth: L.W, clientWidth: 300 });
  let stopped = false;
  scroller.listeners.get("wheel")![0]({ deltaX: 0, deltaY: 100, preventDefault: () => (stopped = true) } as never);
  assert.equal(scroller.scrollLeft, 100);
  assert.ok(stopped);
  // a pick out of view scrolls to it (scrollToShow)
  const to: number[] = [];
  Object.assign(scroller, { scrollLeft: 0, scrollTo: (o: { left: number }) => to.push(o.left) });
  Object.assign(track, { clientWidth: L.W });
  const bs = fig.querySelectorAll("button.hp-fight");
  bs[bs.length - 1].dispatch("click");
  assert.equal(to.length >= 1, true);
  assert.ok(to[0] > 0);
  // the helpers are the room bar's, not copies
  assert.match(chartSrc, /import \{ roomBarWheel, scrollToShow \} from "\.\/battle-layout\.ts";/);
  // fits: no overflow class, no fixed width
  const wide = hpChart(odin, { width: HP_W }) as unknown as F;
  assert.ok(!wide.querySelector(".hp-scroll")!.classList.contains("overflow"));
  assert.equal(wide.querySelector(".hp-track")!.style.width, undefined);
});

// ---------------------------------------------------------------- 4. Turn −1 / Turn +1, the legend
test("Turn −1 / Turn +1: move the selected turn, disabled at the ends, the focus kept on a button", () => {
  const n = odin.steps.length;
  const picks: number[] = [];
  const fig = hpChart(odin, { selected: 0, onSelect: (i) => picks.push(i) }) as unknown as F;
  const prev = fig.querySelector('button[data-dir="-1"]')!, next = fig.querySelector('button[data-dir="1"]')!;
  assert.deepEqual([prev.textContent, next.textContent], ["Turn −1", "Turn +1"]);
  assert.equal(prev.getAttribute("type"), "button");
  assert.ok(prev.hasAttribute("disabled") && !next.hasAttribute("disabled"));
  next.dispatch("click");
  next.dispatch("click");
  prev.dispatch("click");
  assert.deepEqual(picks, [1, 2, 1]);
  assert.equal(fig.querySelector("svg")!.getAttribute("aria-valuenow"), "1");
  assert.ok(!prev.hasAttribute("disabled"));
  const end = hpChart(odin, { selected: n - 1 }) as unknown as F;
  assert.ok(end.querySelector('button[data-dir="1"]')!.hasAttribute("disabled"));
  // the buttons sit beside the chart's tabs
  assert.ok(fig.querySelector(".hp-head")!.querySelector(".hp-steps")!.querySelector('button[data-dir="1"]'));
});

test("the legend: colour and name only", () => {
  for (const tab of ["hp", "dmg", "heal"] as const) {
    const items = (hpChart(map, { tab }) as unknown as F).querySelector("ul.hp-legend")!.children;
    assert.deepEqual(items.map((li) => li.textContent), map.series.map((s) => s.name));
    for (const li of items) assert.deepEqual(li.children.map((c) => c.className), ["hp-swatch", "hp-name"]);
  }
});

// ---------------------------------------------------------------- 5. Clear all, the CSS
test("Clear all is in the Simulate panel, with its undo; no longer over the cards", () => {
  const panel = html.slice(html.indexOf('<div class="run-box"'), html.indexOf('id="results"'));
  assert.ok(panel.includes('<span id="party-tools" class="party-tools"></span>'));
  assert.ok(panel.indexOf('class="toolbar sim-bar"') < panel.indexOf('id="party-tools"') && panel.indexOf('id="party-tools"') < panel.indexOf('id="runs"'));
  const party = fn(page, "renderParty");
  assert.match(party, /document\.querySelector\("#party-tools"\)\?\.replaceChildren\(\.\.\.\(ctl\.edit \? \[clear, \.\.\.\(clearUndo \? \[clearUndo\] : \[\]\)\] : \[\]\)\);/);
  assert.doesNotMatch(party.slice(party.indexOf('$("#party").replaceChildren(')), /clear/);
  assert.match(fn(page, "clearAll"), /#party-tools \.clear-all/);
});

test("CSS: the U66 block closes style.css; theme tokens only", () => {
  const block = css.slice(css.indexOf("/* U66 */"), css.indexOf("/* end U66 */"));
  assert.ok(block.length > 200);
  assert.ok(css.trimEnd().endsWith("/* end U66 */"));
  for (const sel of [".hp-scroll", ".hp-fight", ".hp-step", ".sim-bar .party-tools"]) assert.ok(block.includes(sel), sel);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b/i);
});
