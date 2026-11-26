// Battle Simulator and Solver U74: the Simulator's run picker (Worst / Random / Best, Random the first run and the
// default; switching never runs again: the worker keeps the first, worst and best run's traces); the Solver's Show
// draws the first run; the Solver's Party cell a small table (Back / Front / Scrolls, class colours as backgrounds),
// no "rough", no Scrolls or Progress column, "Life remaining" = the standing heroes' average HP left, the same value
// as the Simulator's Life left and the one compareSolutions reads. No browser: pure functions, the runs on the game
// data, the picker in the fake DOM, and the page code and the stylesheet read as text.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluate, fightSeed } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import {
  bestRun, compareRuns, DEFAULT_PICK, parsePick, pickedRun, pickedTrace, RUN_PICKS, type RunOutcome, runStats, traceWorst, worstRun,
} from "../src/tools/worst-run.ts";
import { compareSolutions, lifeRemaining, partyLines, solverFigures } from "../src/ui/battle-setup.ts";
import { inPicker, runPicker } from "../src/ui/hp-chart.ts";
import type { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/battle-page.ts"), search = read("web/src/ui/battle-search.ts"), chart = read("web/src/ui/hp-chart.ts");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* U74 */"), css.indexOf("/* end U74 */"));
const fn = (src: string, name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf("\n}\n", src.indexOf(`function ${name}`)));

const run = (o: Partial<RunOutcome>): RunOutcome => ({ won: true, rooms: 1, turns: 10, grade: 3, dead: 0, alive: [1, 1, 1], ...o });

// ---------------------------------------------------------------- 1. the best run and the picks
test("bestRun: a win before any loss, then the highest grade, the fewest dead, the most life left; a tie keeps the earlier", () => {
  assert.equal(bestRun([run({ won: false, rooms: 0 }), run({ grade: 1, dead: 5, alive: [0.01] })]), 1, "any win beats a loss");
  assert.equal(bestRun([run({ grade: 3 }), run({ grade: 5, dead: 2, alive: [0.1] }), run({ grade: 4 })]), 1, "grade first");
  assert.equal(bestRun([run({ dead: 1, alive: [1, 1] }), run({ dead: 0, alive: [0.2, 0.2, 0.2] })]), 1, "then the fewest dead");
  assert.equal(bestRun([run({ alive: [0.5, 0.5, 0.5] }), run({ alive: [0.9, 0.9, 0.9] })]), 1, "then the most life left");
  assert.equal(bestRun([run({ won: false, rooms: 2, turns: 9 }), run({ won: false, rooms: 3, turns: 4 })]), 1, "a loss that gets further");
  assert.equal(bestRun([run({}), run({}), run({})]), 0, "a tie keeps the earlier run");
  assert.equal(bestRun([]), -1);
  // the same ordering as the worst run, reversed
  const runs = [run({ grade: 2 }), run({ won: false, rooms: 0, turns: 5 }), run({ grade: 5, dead: 1, alive: [0.7, 0.7] }), run({ grade: 5, alive: [0.4, 0.6, 1] }), run({ grade: 4 })];
  const sorted = runs.map((_, k) => k).sort((a, b) => compareRuns(runs[a], runs[b]));
  assert.equal(worstRun(runs), sorted[0]);
  assert.equal(bestRun(runs), sorted.at(-1));
});

test("the picks: Worst, Random, Best in that order; Random (the first run) is the default; a stored value parsed", () => {
  assert.deepEqual(RUN_PICKS.map((p) => [p.id, p.label]), [["worst", "Worst"], ["random", "Random"], ["best", "Best"]]);
  assert.equal(DEFAULT_PICK, "random");
  assert.deepEqual(["worst", "random", "best"].map(parsePick), ["worst", "random", "best"]);
  for (const v of [null, undefined, "", "first", "WORST", 3]) assert.equal(parsePick(v), "random", String(v));
  const runs = { outcomes: [run({}), run({ grade: 1 }), run({ grade: 5 })], worst: 1, best: 2 };
  assert.equal(pickedRun(runs, "random"), 0, "Random is run 0, whatever it is");
  assert.equal(pickedRun(runs, "worst"), 1);
  assert.equal(pickedRun(runs, "best"), 2);
  assert.equal(pickedRun({ outcomes: [], worst: -1, best: -1 }, "random"), -1);
});

// ---------------------------------------------------------------- 2. the runs on the game data
api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
const sv = loadSaveText(read("site/data/example-save.txt"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const IDX = [[8, 0, 4], [5, 1, 2]] as const;
const party = () => IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));

test("traceWorst keeps the first, the worst and the best run's traces only, each its own seed's fight", () => {
  const quest = 72; // Odin: a fight the party can lose, so the runs differ
  const [f, b] = party();
  const w = traceWorst(sim, { quest: { id: quest, rare: false, amount: 1 } }, [...f], [...b]);
  assert.equal(w.worst, worstRun(w.outcomes));
  assert.equal(w.best, bestRun(w.outcomes));
  assert.deepEqual(Object.keys(w.traces).map(Number).sort((x, y) => x - y), [...new Set([0, w.worst, w.best])].sort((x, y) => x - y),
    "never more than the three a pick can show");
  for (const k of [0, w.worst, w.best]) {
    const [f2, b2] = party();
    assert.deepEqual(w.traces[k].quest, traceFight(sim, quest, [...f2], [...b2], { seed: fightSeed(1, k) }), `run ${k}`);
  }
  // a pick reads one of them, nothing runs again
  assert.equal(pickedTrace(w, "random"), w.traces[0]);
  assert.equal(pickedTrace(w, "worst"), w.traces[w.worst]);
  assert.equal(pickedTrace(w, "best"), w.traces[w.best]);
  assert.deepEqual(structuredClone(w), w, "it crosses the worker boundary");
});

test("the four figures are over all 20 runs, Life left counts only the heroes standing; the Solver's life remaining is the same value", () => {
  const quest = 72;
  const [f, b] = party();
  const w = traceWorst(sim, { quest: { id: quest, rare: false, amount: 1 } }, [...f], [...b]);
  const st = runStats(w.outcomes);
  assert.equal(st.n, 20);
  assert.equal(st.win, w.outcomes.filter((o) => o.won).length / 20);
  assert.equal(st.dead, w.outcomes.reduce((a, o) => a + o.dead, 0) / 20);
  const alive = w.outcomes.flatMap((o) => o.alive);
  assert.equal(alive.length, w.outcomes.reduce((a, o) => a + 6 - o.dead, 0), "one share per standing hero, the fallen left out");
  if (alive.length) assert.ok(Math.abs(st.life! - alive.reduce((a, x) => a + x, 0) / alive.length) < 1e-12);
  // the worst run's own figures can be far below the averages (the U74 report: 70 % Life left over 20 runs while the
  // chart showed the worst run's heroes down)
  const worst = w.outcomes[w.worst];
  assert.ok(worst.dead >= st.dead);
  // the same 20 fights as an evaluation (the Solver's figures): the same life remaining and heroes dead
  const [f3, b3] = party();
  const ev = evaluate(sim, quest, [...f3], [...b3], 20);
  const life = lifeRemaining(ev);
  if (st.life === null) assert.equal(life, null);
  else assert.ok(Math.abs(life! - st.life) < 1e-9, `${life} vs ${st.life}`);
  assert.ok(Math.abs(solverFigures(ev).dead - st.dead) < 1e-9);
});

// ---------------------------------------------------------------- 3. life remaining and the Solver's order
test("lifeRemaining: the standing heroes' HP shares over their count; the fallen left out; none standing: null", () => {
  // two runs, two heroes: A ends at 50 % then falls (0); B ends at 100 % then 60 %. Standing: A once, B twice → (0.5 + 1 + 0.6) / 3
  const ev = { heroes: { a: { death_rate: 0.5, hp_left_frac: 0.25 }, b: { death_rate: 0, hp_left_frac: 0.8 } } };
  assert.ok(Math.abs(lifeRemaining(ev)! - 0.7) < 1e-12);
  assert.equal(lifeRemaining({ heroes: { a: { death_rate: 1, hp_left_frac: 0 } } }), null);
  assert.equal(lifeRemaining({ heroes: {} }), null);
  assert.equal(lifeRemaining({}), null);
  assert.equal(lifeRemaining({ heroes: { a: { death_rate: 0, hp_left_frac: 1.3 } } }), 1, "clamped");
});

test("compareSolutions reads life remaining: healthy survivors beat a party whose share counted the fallen as 0", () => {
  // same win rate and heroes dead; X's survivors are at 90 %, Y's at 60 %
  const x = { ev: { win: 1, heroes: { a: { death_rate: 0.5, hp_left_frac: 0.45 }, b: { death_rate: 0, hp_left_frac: 0.9 } } } };
  const y = { ev: { win: 1, heroes: { a: { death_rate: 0.5, hp_left_frac: 0.3 }, b: { death_rate: 0, hp_left_frac: 0.6 } } } };
  assert.ok(compareSolutions(x, y) < 0);
  assert.equal(solverFigures({ win: 1, grade: 4, heroes: x.ev.heroes }).life, lifeRemaining(x.ev));
  assert.match(fn(read("web/src/ui/battle-setup.ts"), "compareSolutions"), /const life = \(c: Ranked\) => lifeRemaining\(c\.ev\) \?\? 0;/);
});

test("partyLines: Back, Front (slot order, empty slots left out), then the scrolls (repeats kept)", () => {
  const lines = partyLines({ layout: { front: [11, null, 12], back: [null, null, 13] }, scrolls: [7, 7, 9] });
  assert.deepEqual(lines, [
    { label: "Back", kind: "hero", ids: [13] }, { label: "Front", kind: "hero", ids: [11, 12] }, { label: "Scrolls", kind: "scroll", ids: [7, 7, 9] },
  ]);
  const quest = partyLines({ layout: { front: [1, null, null], back: [null, null, null] } });
  assert.deepEqual(quest.map((l) => [l.label, l.ids.length]), [["Back", 0], ["Front", 1], ["Scrolls", 0]], "always three lines");
});

// ---------------------------------------------------------------- 4. the Solver's table
test("the Solver's table: the Party cell a small table, no rough, no Scrolls or Progress column, Life remaining", () => {
  const code = search.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /rough|ROUGH_HELP|scrollCell|hero-chip|row-ico|solver-lead|No scrolls|"Progress"|"Scrolls"\]|pct\(ev\.cleared/);
  const cell = search.slice(search.indexOf("const partyCell = "), search.indexOf("const showSetup = "));
  assert.match(cell, /const lines = partyLines\(c\);/);
  assert.match(cell, /el\("table", \{ class: "solver-party" \}, el\("tbody", \{\}, \.\.\.lines\.map\(\(l\) => el\("tr", \{\},\s*el\("th", \{ scope: "row" \}, l\.label\)/);
  assert.match(search, /el\("td", \{ class: `sp-hero cls-\$\{h\?\.class \?\? 0\}`/, "a hero cell in its class colour");
  assert.match(cell, /el\("td", \{ class: "sp-scroll" \}, itemLink\("consumable", id\)\)/);
  assert.match(cell, /el\("td", \{ class: "sp-none", colspan: String\(span\) \}, "–"\)/, "an empty line: one dash cell");
  assert.match(search, / {2}"Life remaining": "Average HP left of the heroes still standing at the end \(fallen heroes left out\)\.",/);
  assert.match(search, /f\.life === null \? el\("span", \{ class: "muted", title: "Nobody left standing" \}, "–"\) : pct\(f\.life, 0\)/);
});

test("CSS: the U74 block; hero cells reach AA in both themes; the chips' and rough's rules are gone", () => {
  assert.ok(block.length > 200);
  assert.ok(css.lastIndexOf("/* end U74 */") > css.lastIndexOf("/* end U73 */"), "after U73 (U76 follows)");
  assert.doesNotMatch(css, /\.solver-lead|\.rough-wrap|\.solver-party \.hero-chip|\.solver-scrolls|\.no-scrolls|\.solver-row/);
  assert.match(block, /td\.sp-hero[^{]*\{\s*color: var\(--fg\); font-weight: 650; background: color-mix\(in srgb, var\(--c, var\(--accent\)\) 30%, var\(--pill-base\)\); \}/);
  const tint = 0.3;
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a: number[], b: number[], p: number) => a.map((x, i) => x * p + b[i] * (1 - p));
  const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const theme = (sel: string) => {
    const at = css.indexOf(sel);
    const body = css.slice(at, css.indexOf("}", at));
    return (name: string) => body.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1];
  };
  const dark = theme(":root, :root[data-theme=\"dark\"] {"), light = theme(':root[data-theme="light"] {');
  // --pill-base: the page's --bg in the dark theme, the --card in the light one (a11y block)
  for (const [name, fg, base] of [["dark", dark("fg"), dark("bg")], ["light", light("fg"), light("card")]]) {
    for (const [, n, c] of css.matchAll(/^\.cls-(\d) \{ --c: (#[0-9a-f]{6}); \}/gm)) {
      const r = ratio(hex(fg), mix(hex(c), hex(base), tint));
      assert.ok(r >= 4.5, `${name}, class ${n}: ${r.toFixed(2)}`);
    }
  }
  assert.match(css, /:root, :root\[data-theme="dark"\] \{ --pill-ink: 55%; --pill-base: var\(--bg\); \}/);
  assert.match(css, /:root\[data-theme="light"\] \{ --pill-ink: 38%; --pill-base: var\(--card\); \}/);
});

// ---------------------------------------------------------------- 5. the picker
test("runPicker: a radiogroup of Worst, Random, Best, the value checked; a change says the pick", () => {
  const picks: string[] = [];
  const seg = runPicker({ value: "random", onPick: (p) => picks.push(p) }) as unknown as FakeElement;
  assert.equal(seg.getAttribute("role"), "radiogroup");
  assert.equal(seg.getAttribute("aria-label"), "Run shown");
  assert.ok(seg.classList.contains("hp-pick"));
  const inputs = seg.querySelectorAll("input") as unknown as (FakeElement & { checked: boolean; value: string })[];
  assert.deepEqual(inputs.map((i) => i.getAttribute("value")), ["worst", "random", "best"]);
  assert.deepEqual(inputs.map((i) => i.checked), [false, true, false]);
  assert.deepEqual(seg.querySelectorAll("label").map((l) => l.textContent), ["Worst", "Random", "Best"]);
  assert.ok(inputs.every((i) => i.getAttribute("name") === "hp-run-pick"), "one group: the arrow keys move the choice");
  inputs[0].checked = true;
  inputs[0].dispatch("change");
  inputs[2].checked = true;
  inputs[2].dispatch("change");
  assert.deepEqual(picks, ["worst", "best"]);
  // the focus goes back to the picker after a redraw when it was in it
  const box = document.createElement("section") as unknown as FakeElement;
  box.append(seg);
  assert.equal(inPicker(box as unknown as HTMLElement, inputs[1] as unknown as Element), true);
  const other = document.createElement("button") as unknown as FakeElement;
  box.append(other);
  assert.equal(inPicker(box as unknown as HTMLElement, other as unknown as Element), false);
  assert.equal(inPicker(box as unknown as HTMLElement, null), false);
});

test("the chart's head holds the picker when given one; drawHpChart passes it and puts the focus back on it", () => {
  assert.match(chart, /el\("div", \{ class: "hp-head" \}, tabs, \.\.\.\(o\.pick \? \[runPicker\(o\.pick\)\] : \[\]\)\)/);
  assert.match(chart, /onStep, pick: o\.pick \?\? null \}\) : null;/);
  assert.match(chart, /: inPicker\(box, active\) \? "pick" : null;/);
  assert.match(chart, /focused === "pick" \? \[\.\.\.\(box\.querySelector\("\.hp-pick"\)\?\.querySelectorAll<HTMLInputElement>\("input"\) \?\? \[\]\)\]\.find\(\(i\) => i\.checked\)/);
});

test("the page: the picker on the Simulator only, remembered, switching draws another kept run and never runs", () => {
  assert.match(page, /const PICK_KEY = "battle-run-pick";/);
  // remembered in localStorage, both ways in try / catch
  assert.match(page, /let runPick: RunPick = \(\(\) => \{\s*try \{\s*return parsePick\(localStorage\.getItem\(PICK_KEY\)\);\s*\} catch \{\s*return DEFAULT_PICK;\s*\}\s*\}\)\(\);/);
  const set = fn(page, "setPick");
  assert.match(set, /runPick = p;\s*try \{\s*localStorage\.setItem\(PICK_KEY, p\);\s*\} catch/);
  assert.match(set, /drawShown\(\{ who \}\);/, "U76: the actor's step kept");
  assert.doesNotMatch(set, /renderPlan|startRuns|postMessage|autoRun/, "a pick never runs again");
  // the Solver's Show: the first run (Random)
  assert.match(page, /const pickNow = \(\): RunPick => \(state\.mode\.key === "simulate" \? runPick : DEFAULT_PICK\);/);
  assert.match(fn(page, "drawShown"), /const run = pickedTrace\(runs, pickNow\(\)\);/);
  assert.match(fn(page, "showHp"), /pick: state\.mode\.key === "simulate" \? \{ value: runPick, onPick: setPick \} : null, follow: Boolean\(keep\) \}, !keep \|\| clamped\);/);
  // the pick is not part of the runs' key (the request): the same request, the same runs
  assert.doesNotMatch(fn(page, "autoRun"), /pick/i);
  // stale-run cancellation kept
  assert.match(fn(page, "startRuns"), /if \(r\.ok \? r\.kind !== "worst" \|\| r\.id !== id : r\.id !== id\) return;/);
});
