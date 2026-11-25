// Battle Simulator U43: each hero's HP left, the turn figures and the game's turn cap (turn 200: the enemy wins), as
// the evaluations measure them. U70: the Simulator's result tiles and details (battle-results.ts) are gone, and their
// tests with them. Game data and the site's example save only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { evaluate, evaluateMap, fightSeed, TURN_CAP } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { loadSaveText } from "../src/tools/save.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sv = loadSaveText(readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const hero = (i: number) => sim.hero(sv.raw.hero[i]);
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const party = () => [[hero(8), hero(0), hero(4)], [hero(5), hero(1), hero(2)]];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("the turn cap is the game's: 200 turns, and a fight still running then is lost", () => {
  assert.equal(TURN_CAP, 200);
  // Skorge with a huge HP pool and no attack: the party can't kill it, it can't kill the party.
  const q = 53, d = G.questData[q];
  const saved = { enemyHp: d.enemyHp, enemyAtk: d.enemyAtk, enemyMatk: d.enemyMatk };
  Object.assign(d, { enemyHp: d.enemyHp * 1e7, enemyAtk: 0, enemyMatk: 0 });
  try {
    const [f, b] = party();
    const r = sim.fight(q, f, b, { seed: 1 });
    assert.deepEqual([r.turns, r.won, r.grade], [200, false, 0]);
    const [f2, b2] = party();
    const ev = evaluate(sim, q, f2, b2, 3);
    assert.deepEqual([ev.turns_max, ev.turns_capped, ev.win], [200, 3, 0]);
  } finally {
    Object.assign(d, saved);
  }
});

test("quest results: each hero's HP left and the turn figures, from the same fights (results unchanged)", () => {
  const q = 72, n = 20;
  const [f, b] = party();
  const ev = evaluate(sim, q, f, b, n);
  const runs = Array.from({ length: n }, (_, k) => {
    const [f2, b2] = party();
    return sim.fight(q, f2, b2, { seed: fightSeed(1, k) });
  });
  assert.equal(ev.turns, mean(runs.map((r) => r.turns)));
  assert.equal(ev.turns_max, Math.max(...runs.map((r) => r.turns)));
  assert.equal(ev.turns_capped, 0);
  assert.equal(ev.win, runs.filter((r) => r.won).length / n);
  for (const [slot, h] of Object.entries(ev.heroes)) {
    const mine = runs.map((r) => r.heroes.find((x) => x.slot === slot)!);
    assert.ok(Math.abs(h.hp_left - mean(mine.map((x) => Math.max(x.hp, 0)))) < 1e-9, slot);
    assert.ok(Math.abs(h.hp_left_frac - mean(mine.map((x) => Math.max(x.hp, 0) / x.maxHP))) < 1e-9, slot);
    assert.ok(h.hp_left_frac >= 0 && h.hp_left_frac <= 1);
    assert.equal(h.max_hp, mean(mine.map((x) => x.maxHP)));
  }
});

test("map results: HP left at the end of the whole run, turns per room and per run, the longest room", () => {
  const spec = { id: 7, prestigeLevel: 0, grade: 3 }, n = 6;
  const [f, b] = party();
  const ev = evaluateMap(sim, spec, f, b, n);
  const runs = Array.from({ length: n }, (_, k) => {
    const [f2, b2] = party();
    return sim.mapRun(spec, f2, b2, fightSeed(1, k));
  });
  const rooms = runs.flatMap((r) => r.combats.filter((c) => c.status !== 0).map((c) => c.turns!));
  // Every room fought has its turns; a room never reached has none.
  for (const r of runs) for (const c of r.combats) assert.equal(c.turns === undefined, c.status === 0);
  assert.ok(rooms.every((t) => t > 0 && t <= TURN_CAP));
  assert.equal(ev.room_turns, mean(rooms));
  assert.equal(ev.room_turns_max, Math.max(...rooms));
  assert.equal(ev.run_turns, mean(runs.map((r) => r.combats.reduce((s, c) => s + (c.turns ?? 0), 0))));
  assert.equal(ev.rooms_capped, 0);
  for (const [slot, h] of Object.entries(ev.heroes)) {
    const mine = runs.map((r) => r.heroes.find((x) => x.slot === slot)!);
    assert.ok(Math.abs(h.hp_left - mean(mine.map((x) => Math.max(x.hp, 0)))) < 1e-9, slot);
    assert.ok(Math.abs(h.hp_left_frac - mean(mine.map((x) => Math.max(x.hp, 0) / x.maxHP))) < 1e-9, slot);
  }
});
