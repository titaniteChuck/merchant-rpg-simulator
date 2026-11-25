// Battle Simulator and Solver U51: the Solver's rows show grade, life left and heroes dead (solverFigures). U70: the
// tab row's "?", the Flow's turn bands (turnBand) and calculation columns (calcColumn) went with the Flows, and their
// tests with them. No browser: the pure parts and the page code read as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluate } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { solverFigures } from "../src/ui/battle-setup.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const search = read("web/src/ui/battle-search.ts");

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
