// Battle Simulator and Solver U61: the Party view's HP chart (web/src/ui/hp-chart.ts) (U62: in the Party view's third column),
// drawn by battle-page.ts from a traced fight (U70: the worst of the runs each change makes). No browser: the series from known
// traces, the chart built in the fake DOM, and battle-page.ts / style.css read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { fightSeed } from "../src/tools/combat.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs, planTimeline } from "../src/ui/battle-plan.ts";
import { drawHpChart, fightStart, HP_EMPTY, hpChart, hpData, type HpFighter, hpSummary } from "../src/ui/hp-chart.ts";
import { fmt } from "../src/ui/dom.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const fighters: HpFighter[] = IDX.flatMap((row, r) => row.map((idx, i): HpFighter => {
  const raw = sv.raw.hero[idx];
  return { who: locationOf(r ? "back" : "front", i), name: String(raw.name), cls: Number(raw.class) };
}));
const party = (skills: Record<number, string[]> = {}) => IDX.map((row) => row.map((i) => {
  const h = sim.hero(sv.raw.hero[i]);
  if (skills[i]) sim.setSkills(h, skills[i]);
  return h;
}));
const traceOf = (quest: number, skills: Record<number, string[]> = {}) => {
  const [f, b] = party(skills);
  return traceFight(sim, quest, [...f], [...b]);
};
const box = () => {
  const b = document.createElement("section") as unknown as FakeElement;
  (document.body as unknown as FakeElement).append(b);
  return b as unknown as HTMLElement & FakeElement;
};

// ---------------------------------------------------------------- 1. the series from a known trace
test("series: the start, then every turn's end; HP from the trace's life, deaths at 0 and marked", () => {
  const trace = traceOf(72); // Odin: a long fight the party loses, heroes fall
  const d = hpData([{ trace, enemy: "Odin" }], fighters)!;
  assert.equal(d.steps.length, trace.turns + 1);
  assert.deepEqual(d.steps.slice(0, 3).map((s) => s.label), ["Start", "Turn 1", "Turn 2"]);
  assert.deepEqual(d.runStarts, [0]);
  assert.deepEqual(d.series.map((s) => s.who), [0, ...fighters.map((f) => f.who)], "the enemy first, then the heroes");
  assert.equal(d.series[0].name, "Odin");
  assert.ok(d.series[0].enemy && d.series.slice(1).every((s) => !s.enemy && s.cls !== undefined));
  // every turn's end: the last life the trace recorded for that fighter up to that turn
  for (const s of d.series) {
    for (let t = 1; t <= trace.turns; t++) {
      const lives = trace.actions.filter((a) => a.turn <= t).flatMap((a) => a.life).filter((l) => l.who === s.who);
      const last = lives[lives.length - 1];
      assert.equal(s.values[t]!.hp, Math.max(0, last.hp), `${s.name}, turn ${t}`);
      assert.equal(s.values[t]!.maxHP, last.maxHP);
      assert.ok(s.values[t]!.pct >= 0 && s.values[t]!.pct <= 100);
    }
  }
  // the start (fightStart, U70: moved from Flow 2 to hp-chart.ts), full HP here
  const start = fightStart(trace);
  for (const s of d.series) assert.equal(s.values[0]!.hp, start[s.who].hp);
  // deaths: 0 there, above 0 the step before; at least one hero falls against Odin
  const deaths = d.series.flatMap((s) => s.deaths.map((i) => [s, i] as const));
  assert.ok(deaths.length >= 1, "someone falls");
  for (const [s, i] of deaths) {
    assert.equal(s.values[i]!.hp, 0);
    assert.equal(s.values[i]!.pct, 0);
    assert.ok(s.values[i - 1]!.hp > 0);
  }
  // the drawing: one line per fighter, one cross per fall (titled), the summary names the falls
  const fig = hpChart(d) as unknown as FakeElement;
  assert.equal(fig.querySelectorAll("path.hp-line").length, d.series.length);
  assert.equal(fig.querySelectorAll("path.hp-line.hp-enemy").length, 1, "the enemy's line, in the trim colour");
  for (const f of fighters) assert.equal(fig.querySelectorAll(`path.hp-line.cls-${f.cls}`).length >= 1, true, "class colours");
  assert.equal(fig.querySelectorAll("path.hp-death").length, deaths.length);
  assert.ok(fig.querySelectorAll("path.hp-death").every((p) => p.querySelector("title")!.textContent.includes(" falls: turn ")));
  // U65: the plot is the turn slider, described by the summary (was a role=img named by it)
  const svg = fig.querySelector("svg")!;
  assert.equal(svg.getAttribute("role"), "slider");
  assert.equal(fig.querySelector('p[id="hp-sum"]')!.textContent, hpSummary(d));
  assert.equal(svg.getAttribute("aria-describedby"), "hp-sum");
  assert.match(hpSummary(d), new RegExp(`over ${trace.turns} turns, lost\\.`));
  // legend (U66): every fighter's colour and name, nothing else; the table: one row per step, one column per fighter
  const legend = fig.querySelector("ul.hp-legend")!.children;
  assert.equal(legend.length, d.series.length);
  for (const [k, s] of d.series.entries()) {
    assert.deepEqual(legend[k].children.map((c) => c.className), ["hp-swatch", "hp-name"]);
    assert.equal(legend[k].textContent, s.name);
  }
  const last = d.series[1].values[trace.turns]!;
  assert.ok(fig.querySelector("tbody")!.children[trace.turns].textContent.includes(`${fmt.format(last.hp)} / ${fmt.format(last.maxHP)}`));
  assert.equal(fig.querySelector("tbody")!.children.length, d.steps.length);
  assert.equal(fig.querySelector("thead")!.querySelectorAll("th").length, d.series.length + 1);
  assert.equal(fig.querySelector("details.hp-fold")!.hasAttribute("open"), false, "the table is folded");
});

test("a fight won on turn 1: two steps, the enemy falls and is marked", () => {
  const trace = traceOf(92); // Murlok Monarch falls on turn 1
  const d = hpData([{ trace, enemy: "Murlok Monarch" }], fighters)!;
  assert.equal(d.steps.length, 2);
  assert.deepEqual(d.series[0].deaths, [1]);
  assert.equal(d.series[0].values[1]!.hp, 0);
  assert.match(hpSummary(d), /over 1 turn, won\. Murlok Monarch falls \(turn 1\)/);
});

// ---------------------------------------------------------------- 2. the chart's trace
test("the chart reads a trace's turn ends; run 0 of the worst-of runs is Simulate's first fight (same seed)", () => {
  const trace = traceOf(72);
  const d = hpData([{ trace, enemy: "Odin" }], fighters)!;
  const tl = planTimeline(trace, fighters.map((f) => f.who));
  for (const [k, turn] of tl.turns.entries()) {
    for (const s of d.series) assert.equal(s.values[k + 1]!.hp, Math.max(0, turn.hp[s.who].hp), `turn ${k + 1}, ${s.name}`);
  }
  // the trace is Simulate's first fight (fightSeed(1, 0)): the same series again from that seed
  const [f, b] = party();
  const again = traceFight(sim, 72, [...f], [...b], { seed: fightSeed(1, 0) });
  assert.deepEqual(hpData([{ trace: again, enemy: "Odin" }], fighters), d);
  // battle-page.ts (U70): the chart draws the worker's worst run, never a fight of its own
  const show = fn(page, "showHp");
  assert.doesNotMatch(show, /trace(Fight|MapRun)|new Sim/, "the chart never simulates");
  assert.match(show, /chart = runs \? hpData\(runs, fighters\) : null;/);
  // U73: and the step within the turn, its arrows and the sticky host of the turn and step controls
  assert.match(show, /drawHpChart\(box, chart, \{ hide, selected: turnAt, onSelect: selectTurn, step: stepAt, onStep: selectStep, nav: navHost\(\) \}\);/);
  assert.match(fn(page, "drawShown"), /showHp\(rooms\.flatMap\(\(r, k\): HpRun\[\] => \(r\.trace \? \[\{ trace: r\.trace,/, "a map run: every fought room");
  // the box: made once in its column (U65: #hp-col, the first row; U62: the third column; until then #opp-col)
  assert.match(fn(page, "hpBox"), /col\.querySelector<HTMLElement>\("#hp-chart"\)/);
  assert.match(fn(page, "hpBox"), /col\.append\(box\);/);
});

test("a map run: the fought rooms one after the other, each with its turn 0 on the last room's last turn's x", () => {
  const [f, b] = party();
  const rooms = traceMapRun(sim, { id: 1, prestigeLevel: 0, grade: 3 }, [...f], [...b]);
  const tabs = mapRoomTabs(rooms);
  const runs = rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label }] : []));
  assert.ok(runs.length >= 2);
  const d = hpData(runs, fighters)!;
  assert.equal(d.runStarts.length, runs.length);
  // U66 (c5f59a5 reverted): every room has its turn 0
  assert.equal(d.steps.length, runs.reduce((n, r) => n + r.trace.turns + 1, 0));
  assert.equal(d.steps[d.runStarts[1]].label, `${tabs[1].label}: start`);
  // each room's enemy starts full; no fall marked at a room's start
  for (const i of d.runStarts) assert.equal(d.series[0].values[i]!.pct, 100);
  for (const s of d.series) for (const i of s.deaths) assert.ok(!d.runStarts.includes(i));
  const fig = hpChart(d) as unknown as FakeElement;
  assert.equal(fig.querySelectorAll("line.hp-room").length, runs.length - 1);
  // U68: the enemy line starts again at each room (U66 drew one line, a vertical segment at each boundary)
  assert.equal((fig.querySelector("path.hp-enemy")!.getAttribute("d")!.match(/M/g) ?? []).length, runs.length);
  assert.match(hpSummary(d), new RegExp(`over ${runs.length} rooms`));
});

// ---------------------------------------------------------------- 3. an edit redraws the chart, only the chart
test("an edit: the re-traced fight redraws the chart in its box (new series), the table fold's state and focus kept", () => {
  const b = box();
  drawHpChart(b, hpData([{ trace: traceOf(72), enemy: "Odin" }], fighters));
  const before = b.querySelector("path.hp-enemy")!.getAttribute("d");
  b.querySelector("details.hp-fold")!.setAttribute("open", "");
  b.querySelector("details.hp-fold")!.querySelector<HTMLElement>("summary")!.focus();
  // a skill changed: the front-1 hero only plays Basic
  const edited = traceOf(72, { [IDX[0][0]]: ["Basic", "Basic", "Basic", "Basic", "Basic"] });
  drawHpChart(b, hpData([{ trace: edited, enemy: "Odin" }], fighters));
  assert.equal(b.children.length, 1, "the box's content replaced, not added to");
  assert.notEqual(b.querySelector("path.hp-enemy")!.getAttribute("d"), before, "the new fight's line");
  assert.ok(b.querySelector("details.hp-fold")!.hasAttribute("open"), "the table stays open");
  assert.equal((document as unknown as { activeElement: unknown }).activeElement, b.querySelector("details.hp-fold")!.querySelector("summary"), "focus kept");
  // battle-page.ts: every edit ends in renderPlan (renderParty calls it), which redraws the chart's box only
  assert.match(fn(page, "renderParty"), /\n\s*renderPlan\(\);/);
  assert.doesNotMatch(fn(page, "showHp"), /renderParty|#setup-grid|#party"/);
});

// ---------------------------------------------------------------- 4. nothing to show
test("empty state: no fight, one muted line; no opponent, nothing; a trace without actions is no fight", () => {
  assert.equal(hpData([], fighters), null);
  assert.equal(hpData([{ trace: { won: false, turns: 0, actions: [] }, enemy: "x" }], fighters), null);
  const b = box();
  drawHpChart(b, null);
  assert.equal(b.hidden, false);
  assert.equal(b.querySelector("p.hp-empty")!.textContent, HP_EMPTY);
  assert.equal(b.querySelectorAll("svg").length, 0);
  drawHpChart(b, null, { hide: true });
  assert.equal(b.hidden, true);
  assert.equal(b.children.length, 0);
  // the page (U70): no fight to run (no members, a party problem) is the empty line, no opponent built nothing; a
  // failed run the empty line too
  const plan = fn(page, "renderPlan");
  assert.match(plan, /showHp\(null, chartMembers\(\), !built\);/);
  assert.equal((fn(page, "startRuns").match(/showHp\(null, next\.members\);/g) ?? []).length, 2);
});

// ---------------------------------------------------------------- 5. the CSS
test("CSS: the U61 block, theme tokens only, full width", () => {
  const block = css.slice(css.indexOf("/* U61 */"), css.indexOf("/* end U61 */"));
  assert.ok(block.length > 200);
  assert.match(block, /\.hp-svg \{ display: block; width: 100%; height: auto;/);
  assert.match(block, /\.hp-line \{[^}]*stroke: var\(--c/);
  // U65: the enemy's colour is the U65 block's (--enemy-line)
  assert.doesNotMatch(block, /--boss/);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b/i, "colours from the theme tokens");
});
