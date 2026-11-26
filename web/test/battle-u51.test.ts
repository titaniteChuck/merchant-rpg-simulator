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
test("solverFigures: the grade letter of the won fights, life remaining, heroes dead (sum of death rates)", () => {
  // U74: life remaining = the standing heroes' HP shares over their count: (0.2 + 0.3 + 0.55) / (0.5 + 0.75 + 1) = 1.05 / 2.25
  const ev = { win: 0.8, grade: 3.6, heroes: { f0: { death_rate: 0.5, hp_left_frac: 0.2 }, b0: { death_rate: 0.25, hp_left_frac: 0.3 },
    b1: { death_rate: 0, hp_left_frac: 0.55 } } };
  const life = 1.05 / 2.25;
  const f0 = solverFigures(ev);
  assert.ok(Math.abs(f0.life! - life) < 1e-12);
  assert.deepEqual({ ...f0, life: 0 }, { grade: "A", gradeAvg: 3.6, life: 0, dead: 0.75, size: 3 });
  // never won: no grade
  assert.deepEqual({ ...solverFigures({ ...ev, win: 0, grade: 0 }), life: 0 }, { grade: null, gradeAvg: 0, life: 0, dead: 0.75, size: 3 });
  // the letters D (1) to S (5), clamped
  assert.equal(solverFigures({ ...ev, grade: 1 }).grade, "D");
  assert.equal(solverFigures({ ...ev, grade: 4.5 }).grade, "S");
  assert.equal(solverFigures({ ...ev, grade: 9 }).grade, "S");
  // life stays a share; nobody standing: none
  assert.equal(solverFigures({ ...ev, heroes: { f0: { death_rate: 0, hp_left_frac: 1.2 } } }).life, 1);
  assert.equal(solverFigures({ ...ev, heroes: { f0: { death_rate: 0, hp_left_frac: Number.NaN } } }).life, 0);
  assert.equal(solverFigures({ ...ev, heroes: { f0: { death_rate: 1, hp_left_frac: 0 } } }).life, null);
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
  // U74: the standing heroes' average, not the engine's party share (hp_left, where a fall counts 0)
  const heroes = Object.values(ev.heroes);
  const standing = heroes.reduce((a, h) => a + 1 - h.death_rate, 0);
  if (standing > 0) assert.ok(Math.abs(f.life! - heroes.reduce((a, h) => a + h.hp_left_frac, 0) / standing) < 1e-12);
  else assert.equal(f.life, null);
  assert.equal(f.grade === null, !(ev.win > 0));
});

test("the Solver's table: Win, Grade, Turns (a quest), Life remaining, Dead; heads with their tooltips", () => {
  const paint = search.slice(search.indexOf("const paint = () =>"), search.indexOf("if (!res.results.length)"));
  // U74: no Scrolls or Progress column, "Life remaining" (was "Life")
  assert.match(paint, /const head = \["", "Party", "Win", "Grade", \.\.\.\(isMap \? \[\] : \["Turns"\]\), "Life remaining", "Dead"\];/);
  assert.match(paint, /const f = solverFigures\(ev\);/);
  assert.match(paint, /gradeBadge\(f\.grade\)/);
  assert.match(paint, /pct\(f\.life, 0\)/);
  for (const h of ["Grade", "Life remaining", "Dead"]) assert.match(search, new RegExp(`  "${h}": "`), `${h} has a tooltip`);
});
