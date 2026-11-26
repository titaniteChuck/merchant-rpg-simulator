// Battle Simulator and Solver U73: the Party view's turn navigation. Beside `‹ Turn X ›` a `‹ <actor> k/n ›` control
// walks the selected turn's actions in game order (wrapping, staying in the turn); a turn picked lands on its last
// step (its end, the cards as before); the cards show the state right after the step's action, the actor's card
// marked. Both controls stick under the Simulator's figures (#hp-nav). The legend is a compact wrapping row of
// swatch + name. The cards select no text on a long press. No browser: real traces, the chart in the fake DOM, the
// page code and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { locationOf, mapRoomTabs } from "../src/ui/battle-plan.ts";
import { cardTurnOf, hpAt, hpDeltaAt, modsAt, outcomeAt, stepStates, stepWrap, turnSteps } from "../src/ui/card-turn.ts";
import { fighterCard, paintCard } from "../src/ui/fighter-card.ts";
import { actorName, drawHpChart, type HpChartData, hpChart, hpData, type HpFighter, stepsOf, stepText } from "../src/ui/hp-chart.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), css = read("site/style.css");
const block = css.slice(css.indexOf("/* U73 */"), css.indexOf("/* end U73 */"));
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
type F = FakeElement & HTMLElement;

const [f0, b0] = party();
const odinTrace = traceFight(sim, 72, [...f0], [...b0]);
const odin: HpChartData = hpData([{ trace: odinTrace, enemy: "Odin" }], fighters)!;
const [f1, b1] = party();
const rooms = traceMapRun(sim, { id: 1, prestigeLevel: 0, grade: 3 }, [...f1], [...b1]);
const tabs = mapRoomTabs(rooms);
const map: HpChartData = hpData(rooms.flatMap((r, k) => (r.trace ? [{ trace: r.trace, enemy: r.name, room: tabs[k].label }] : [])), fighters)!;

// ---------------------------------------------------------------- 1. the steps of a turn
test("turnSteps: one step per fighter that acted, in game order; a dead fighter's record is no step; turn 0 none", () => {
  const t = {
    actions: [
      { turn: 1, who: 2, did: "Slash" }, { turn: 1, who: 1, did: false }, { turn: 1, who: 0, did: "Bite" },
      { turn: 2, who: 2, did: "Slash" }, { turn: 2, who: 1, did: null }, { turn: 2, who: 0, did: "Bite" }, { turn: 2, who: 3, did: null },
    ],
  } as Parameters<typeof turnSteps>[0];
  assert.deepEqual(turnSteps(t, 0), []);
  assert.deepEqual(turnSteps(t, 1), [{ who: 2, at: 0, upTo: 0 }, { who: 1, at: 1, upTo: 1 }, { who: 0, at: 2, upTo: 2 }], "a stunned fighter is a step");
  // the dead ones' records count in the step before them, so the last step is the turn's end
  assert.deepEqual(turnSteps(t, 2), [{ who: 2, at: 3, upTo: 4 }, { who: 0, at: 5, upTo: 6 }]);
  assert.deepEqual(turnSteps(t, 3), []);
});

test("stepWrap: the step arrows wrap within the turn", () => {
  assert.equal(stepWrap(0, 1, 5), 1);
  assert.equal(stepWrap(4, 1, 5), 0, "› on the last: the first");
  assert.equal(stepWrap(0, -1, 5), 4, "‹ on the first: the last");
  assert.equal(stepWrap(2, -1, 5), 1);
  assert.equal(stepWrap(0, 1, 1), 0);
  assert.equal(stepWrap(0, 1, 0), 0);
});

test("a real fight: every turn's steps are its acting fighters, the enemy among them, the turn's actions all counted", () => {
  for (let t = 1; t <= odinTrace.turns; t++) {
    const acts = odinTrace.actions.map((a, i) => ({ a, i })).filter((x) => x.a.turn === t);
    const steps = turnSteps(odinTrace, t);
    assert.deepEqual(steps.map((s) => s.who), acts.filter((x) => x.a.did !== null).map((x) => x.a.who));
    if (steps.length) assert.equal(steps[steps.length - 1].upTo, acts[acts.length - 1].i, "the last step is the turn's end");
    assert.equal(new Set(steps.map((s) => s.who)).size, steps.length, "one action per fighter and turn");
  }
  assert.ok(turnSteps(odinTrace, 1).some((s) => s.who === 0), "the enemy acts");
});

// ---------------------------------------------------------------- 2. the trace: a snapshot after every action
test("trace: every action records every fighter's HP, max HP, live stats and stat parts right after it (read only)", () => {
  const start = odinTrace.start!.life.map((l) => l.who).sort();
  for (const a of odinTrace.actions) {
    assert.deepEqual(a.life.map((l) => l.who).sort(), start, `turn ${a.turn}: every fighter`);
    for (const l of a.life) {
      assert.equal(typeof l.hp, "number");
      assert.ok(l.maxHP > 0);
      assert.ok(l.stats && typeof l.stats.atk === "number", "live stats");
      assert.ok(l.mods === undefined || Array.isArray(l.mods), "stat parts (none: no part)");
    }
  }
  // the same seed, the same fight: the trace changes nothing
  const [f, b] = party();
  const again = traceFight(sim, 72, [...f], [...b]);
  assert.equal(again.turns, odinTrace.turns);
  assert.deepEqual(again.actions.map((a) => a.life.map((l) => l.hp)), odinTrace.actions.map((a) => a.life.map((l) => l.hp)));
});

// ---------------------------------------------------------------- 3. the state at a step
test("stepStates: the last step is the chart's turn end; an earlier one the state right after its action", () => {
  for (let i = 1; i < odin.steps.length; i++) {
    const st = odin.steps[i];
    const steps = stepsOf(odin, i);
    if (!steps.length) continue;
    const end = stepStates(odinTrace, st.turn, steps[steps.length - 1].upTo, st.states);
    for (const [w, s] of Object.entries(st.states)) {
      assert.equal(end[Number(w)].hp, s.hp, `turn ${st.turn}: HP at the last step = the turn's end`);
      assert.deepEqual(end[Number(w)].stats, s.stats);
      assert.equal(end[Number(w)].active, s.active, "every acted row as before");
    }
    steps.forEach((step, k) => {
      const at = stepStates(odinTrace, st.turn, step.upTo, st.states);
      const life = odinTrace.actions[step.upTo].life;
      for (const l of life) {
        assert.equal(at[l.who].hp, Math.max(0, l.hp), `turn ${st.turn} step ${k}: HP right after the action`);
        assert.deepEqual(at[l.who].stats, l.stats);
      }
      // the rows played: the fighters that acted by then, this step's actor included
      const acted = new Set(steps.slice(0, k + 1).filter((s) => typeof odinTrace.actions[s.at].did === "string").map((s) => s.who));
      for (const [w, s] of Object.entries(at)) assert.equal(s.active, acted.has(Number(w)) ? (st.turn - 1) % 5 : null);
    });
  }
});

test("the card readers at a step: mods, HP, HP change and outcome up to that action; none given: the turn's end", () => {
  const t = 2;
  const steps = turnSteps(odinTrace, t);
  assert.ok(steps.length >= 2);
  const first = steps[0], last = steps[steps.length - 1];
  for (const l of odinTrace.actions[first.upTo].life) {
    assert.equal(hpAt(odinTrace, t, l.who, first.upTo), Math.max(0, l.hp));
    assert.deepEqual(modsAt(odinTrace, t, l.who, first.upTo), l.mods ?? []);
    const d = hpDeltaAt(odinTrace, t, l.who, first.upTo)!;
    assert.equal(d.net, Math.max(0, l.hp) - hpAt(odinTrace, t - 1, l.who)!);
  }
  const names = (w: number) => (w ? `Hero ${w}` : "Odin");
  // only the first actor has an outcome after the first action; at the end every actor does
  const later = steps[1].who;
  assert.equal(outcomeAt(odinTrace, t, later, names, first.upTo), null, "not acted yet");
  assert.deepEqual(outcomeAt(odinTrace, t, later, names, last.upTo), outcomeAt(odinTrace, t, later, names));
  for (const s of steps) {
    assert.deepEqual(cardTurnOf(odinTrace, t, s.who, names, last.upTo), cardTurnOf(odinTrace, t, s.who, names), "the last step: the turn's end");
  }
});

// ---------------------------------------------------------------- 4. the step control
test("stepText: the actor's name and k/n; null (the arrows off) at turn 0; a map run names its room's enemy", () => {
  assert.equal(stepText(odin, 0, null), null, "turn 0: no action");
  const steps = stepsOf(odin, 1);
  const end = stepText(odin, 1, null)!;
  assert.equal(end.count, `${steps.length}/${steps.length}`, "a turn picked: its last step");
  assert.equal(end.name, actorName(odin, 0, steps[steps.length - 1].who));
  assert.deepEqual(stepText(odin, 1, 0), { name: actorName(odin, 0, steps[0].who), count: `1/${steps.length}` });
  assert.equal(actorName(odin, 0, 0), "Odin");
  assert.equal(actorName(odin, 0, fighters[0].who), fighters[0].name);
  const later = map.runStarts[1] + 1;
  assert.equal(actorName(map, map.steps[later].run, 0), map.runs[map.steps[later].run].enemy);
});

test("the chart: ‹ › walk the turn's steps, wrapping; a turn picked lands on its last step; turn 0 disables them", () => {
  const picks: number[] = [], steps: number[] = [];
  const fig = hpChart(odin, { selected: 0, onSelect: (i) => picks.push(i), onStep: (k) => steps.push(k) }) as unknown as F;
  const nav = fig.querySelector(".hp-nav")!;
  assert.ok(nav.querySelector(".hp-turn") && nav.querySelector(".hp-act"), "the turn and the step controls, one row");
  const actPrev = fig.querySelector('button[data-act="-1"]')!, actNext = fig.querySelector('button[data-act="1"]')!;
  assert.ok(actPrev.hasAttribute("disabled") && actNext.hasAttribute("disabled"), "turn 0: no action");
  assert.equal(fig.querySelector(".hp-act-name")!.textContent, "–");
  fig.querySelector('button[data-dir="1"]')!.dispatch("click");
  assert.deepEqual(picks, [1]);
  const n = stepsOf(odin, 1).length;
  assert.ok(!actNext.hasAttribute("disabled"));
  assert.equal(fig.querySelector(".hp-act-count")!.textContent, ` ${n}/${n}`, "the turn's end");
  actNext.dispatch("click");
  assert.deepEqual(steps, [0], "› on the last: the first");
  assert.equal(fig.querySelector(".hp-act-count")!.textContent, ` 1/${n}`);
  actPrev.dispatch("click");
  assert.deepEqual(steps, [0, n - 1], "‹ on the first: the last");
  actPrev.dispatch("click");
  assert.deepEqual(steps, [0, n - 1, n - 2]);
  assert.deepEqual(picks, [1], "the steps stay in the turn");
  // a turn picked: its last step again
  fig.querySelector('button[data-dir="1"]')!.dispatch("click");
  const m = stepsOf(odin, 2).length;
  assert.equal(fig.querySelector(".hp-act-count")!.textContent, ` ${m}/${m}`);
  // a step given (a redraw): kept
  const kept = hpChart(odin, { selected: 1, step: 0 }) as unknown as F;
  assert.equal(kept.querySelector(".hp-act-count")!.textContent, ` 1/${n}`);
});

test("drawHpChart: the controls go to the page's sticky host; no chart, the host is hidden", () => {
  const doc = (globalThis as unknown as { document: Document }).document;
  const box = doc.createElement("div") as unknown as F, host = doc.createElement("div") as unknown as F;
  const got: number[] = [];
  drawHpChart(box, odin, { selected: 1, onStep: (k) => got.push(k), nav: host });
  assert.equal(host.hidden, false);
  assert.ok(host.querySelector(".hp-nav"), "the controls in the host");
  assert.equal(box.querySelector(".hp-nav"), null, "not under the plot");
  host.querySelector('button[data-act="1"]')!.dispatch("click");
  assert.deepEqual(got, [0]);
  drawHpChart(box, null, { nav: host });
  assert.equal(host.hidden, true);
  assert.equal(host.querySelector(".hp-nav"), null);
});

test("cards: the step's actor marked; the page paints the state at the step", () => {
  const card = fighterCard({ kind: "hero", head: document.createElement("span"), stats: null, rotation: [] }) as unknown as F;
  paintCard(card, { stats: null, acting: true });
  assert.ok(card.classList.contains("acting"));
  paintCard(card, { stats: null });
  assert.ok(!card.classList.contains("acting"));
  // the page: a turn picked resets the step (its end), a step arrow repaints the cards, nothing runs again
  assert.match(fn(page, "selectTurn"), /stepAt = null;/);
  assert.match(fn(page, "selectStep"), /stepAt = k;\n\s*paintTurn\(\);/);
  assert.doesNotMatch(fn(page, "selectStep"), /renderPlan|startRuns|showHp/);
  const view = fn(page, "turnView");
  assert.match(view, /stepStates\(trace, at\.turn, steps\[k\]\.upTo, at\.states\)/);
  assert.match(view, /if \(k === steps\.length - 1\) return \{ at, states: at\.states, actor: steps\[k\]\.who \};/, "the last step: the chart's own turn end");
  assert.match(fn(page, "turnOfCard"), /acting: view\?\.actor === who/);
  assert.match(fn(page, "navHost"), /col\.after\(nav\)/);
  assert.match(fn(page, "navHost"), /setProperty\("--sim-stats-h", `\$\{stats\.offsetHeight\}px`\)/);
});

// ---------------------------------------------------------------- 5. CSS
test("CSS: the legend a compact wrapping row; names never broken per character, an ellipsis at worst", () => {
  assert.match(block, /\.hp-legend \{ display: flex; flex-wrap: wrap;/);
  assert.match(block, /\.hp-legend li \{[^}]*display: inline-flex; flex-wrap: nowrap;[^}]*min-width: 0; max-width: 100%;/);
  assert.match(block, /\.hp-legend \.hp-name \{[^}]*text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal;/);
});

test("CSS: the controls stick under the figures, opaque, the figures' layer; one line on a phone", () => {
  assert.match(block, /\.setup-grid > \.hp-nav-host \{[^}]*grid-row: 2 \/ -1;[^}]*position: sticky; top: var\(--sim-stats-h, 0px\); z-index: 30;\s*background: var\(--bg\);/);
  assert.match(css, /\.sim-stats \{ position: sticky; top: 0; z-index: 30;/, "the figures' layer");
  assert.match(block, /\.hp-nav \{ display: flex; flex-wrap: nowrap;/);
  assert.match(block, /@media \(max-width: 960px\) \{\s*\.setup-grid \{ grid-template-areas: "hp" "nav" "party" "opp";/);
  assert.match(block, /\.opp-col \{ top: calc\(var\(--sim-stats-h, 0px\) \+ var\(--hp-nav-h\) \+ 12px\); \}/);
});

test("CSS: the cards select no text on a long press, no iOS callout; form fields keep theirs", () => {
  assert.match(block, /\.fc \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/);
  assert.match(block, /\.fc input, \.fc select, \.fc textarea \{ -webkit-user-select: text; user-select: text; \}/);
});
