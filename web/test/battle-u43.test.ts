// Battle Simulator U43: compact results (win rate and grade first, the rest behind "Show details", remembered for the
// tab), each hero's HP left, the turn figures and the game's turn cap (turn 200: the enemy wins). Game data and the
// site's example save only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { evaluate, evaluateMap, fightSeed, TURN_CAP } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { cappedNote, DETAILS_KEY, detailsLabel, detailsOpen, essenceLines, hpLeftCell, rememberDetails, turnCapNote } from "../src/ui/battle-results.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sv = loadSaveText(readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const hero = (i: number) => sim.hero(sv.raw.hero[i]);
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const party = () => [[hero(8), hero(0), hero(4)], [hero(5), hero(1), hero(2)]];
const read = (path: string) => readFileSync(new URL(path, new URL("../../", import.meta.url)), "utf8");
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

test("texts: the cap note, the capped count, HP left with the HP in its tooltip, essence lines", () => {
  assert.equal(turnCapNote(37), "max 37 of 200 turns (at 200 the enemy wins)");
  assert.equal(cappedNote(0, 500, "fights"), null);
  assert.match(cappedNote(3, 500, "fights")!, /^3 of 500 fights \(0[.,]6%\) reached turn 200 and were lost$/);
  const c = hpLeftCell({ hp_left: 734, hp_left_frac: 0.715, max_hp: 1026 }, "run");
  assert.match(c.text, /^71[.,]5%$/);
  assert.match(c.title, /734 of 1,?026 HP on average at the end of the run/);
  assert.deepEqual(essenceLines({}, (k) => k), ["none"]);
  assert.deepEqual(essenceLines({ "Fire Essence": 2.4 }, (k) => k.toUpperCase()).map((s) => s.replace(",", ".")), ["2.4 FIRE ESSENCE"]);
});

test("details: closed by default, remembered for the tab, and storage that fails leaves them closed", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(detailsOpen(store), false);
  assert.equal(detailsOpen(null), false);
  rememberDetails(true, store);
  assert.equal(data.get(DETAILS_KEY), "open");
  assert.equal(detailsOpen(store), true);
  rememberDetails(false, store);
  assert.equal(detailsOpen(store), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(detailsOpen(broken), false);
  assert.doesNotThrow(() => rememberDetails(true, broken));
  assert.deepEqual([detailsLabel(false), detailsLabel(true)], ["Show details", "Hide details"]);
});

test("page: the summary is the win rate and the grade, the rest behind the toggle; essence with the map-run figures", () => {
  const page = read("web/src/ui/battle-page.ts");
  assert.doesNotMatch(page, /Before XP bonuses/i);
  const summaries = [...page.matchAll(/tiles\(\{ class: "result-summary" \},\s*tile\("Win rate"[^\n]*\n\s*gradeTile\(ev\.win, ev\.grade\),\s*\)/g)];
  assert.equal(summaries.length, 2, "quest and map results");
  assert.equal([...page.matchAll(/return compactResult\(/g)].length, 2);
  // R2 F24: the essence comes last of the one details grid, after the map-run figures.
  assert.match(page, /\.\.\.xp,\s*essence,\s*\),/);
  assert.doesNotMatch(page, /Essence per run: /);
  assert.match(page, /\{ key: "hp_left", label: "HP left"/);
  // The compact tiles are scoped to the Simulator's results.
  assert.match(read("site/style.css"), /#results \.tiles > \.tile \{ grid-column: auto; padding: 7px 10px;/);
  assert.match(read("web/src/ui/battle-results.ts"), /box\.hidden = !open;/);
});
