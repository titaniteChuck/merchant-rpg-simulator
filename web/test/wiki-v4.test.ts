// Wiki v4 (U21): map tables' Skills column (the real rotation, not just "Basic") and the exact drop tables of enemy pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { weightedRandom } from "../src/sim/campaign.ts";
import { G } from "../src/sim/data.ts";
import { LuaTable } from "../src/sim/lua-table.ts";
import { Rng, setRng } from "../src/sim/lua.ts";
import { mapEnemies, parcelRoll } from "../src/ui/wiki-data.ts";
import { rotationSummary, skillSummaryText } from "../src/ui/wiki-enemies.ts";
import { amountRange, fixedAmounts, lootTable, pctText, weightedOdds } from "../src/ui/wiki-loot.ts";
import { goodAgainst, turnMarks } from "../src/ui/wiki-skills.ts";
import { loadTimelines } from "../src/tools/schedule.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
loadTimelines(JSON.parse(readFileSync(new URL("../../inventory/timelines.json", import.meta.url), "utf8")));

test("good against table: each reason marks the enemy turns it is about", () => {
  for (const skill of ["Silence", "Taunt", "Greater Heal", "Cleanse"]) {
    for (const m of goodAgainst(skill)) {
      const { turns, all } = turnMarks(m);
      assert.equal(turns.length, 5);
      // every reason lands in at least one cell (a turn or "All"), and the turns are 1–5
      for (const [, text, ts] of m.reasons) {
        assert.ok(ts.every((t) => t >= 1 && t <= 5), `${skill} ${m.name}: ${ts}`);
        assert.ok(all.includes(text) || ts.some((t) => turns[t - 1].includes(text)));
      }
      assert.ok(turns.some((t) => t.length) || all.length, `${skill} ${m.name}: no mark`);
    }
  }
  // Taunt draws one heavy hit: one turn, the hit's slot (Eternus: Death Touch on turn 3)
  const eternus = goodAgainst("Taunt").find((m) => m.name === "Eternus")!;
  assert.deepEqual(turnMarks(eternus).turns.map((t) => t.length > 0), [false, false, true, false, false]);
  // Archon's Unleashed Power is in the tooltip of a Silence cell
  const archon = goodAgainst("Silence").find((m) => m.name === "Archon")!;
  assert.ok(turnMarks(archon).turns.some((t) => t.some((x) => x.includes("Unleashed Power"))));
});

test("map Skills column: each variant's own rotation, Basic counted last", () => {
  // Murlok Priest: Mind Blast, Basic ×4 (data.QuestData attackList)
  assert.deepEqual(rotationSummary(["Mind Blast", "Basic", "Basic", "Basic", "Basic"]), [{ skill: "Mind Blast", count: 1 }, { skill: "Basic", count: 4 }]);
  assert.deepEqual(rotationSummary(["Basic", "Shadow Flame", "Shadow Flame", "Terrify II", "Basic"]),
    [{ skill: "Shadow Flame", count: 2 }, { skill: "Terrify II", count: 1 }, { skill: "Basic", count: 2 }]);
  assert.equal(skillSummaryText(15, false), "Mind Blast");
  assert.equal(skillSummaryText(50, false), "Terrify II, Shadow Flame ×2");
  // the rare variant reads attackListB: Murlok Tidehunter adds Slash to Streamline
  assert.equal(skillSummaryText(18, true), "Streamline, Slash");
  // Murlok Madness: every room enemy except Sand Lizard has a real skill
  const rooms = mapEnemies(G.itemData.map[7]).map((q) => skillSummaryText(q, false));
  assert.deepEqual(rooms, ["Mind Blast", "Basic only", "Piercing strike", "Streamline", "Mind Blast ×2"]);
  // Tuvale Map: the game data gives every room enemy Basic on all 5 turns, so "Basic only" there is right
  for (const q of mapEnemies(G.itemData.map[1])) assert.equal(skillSummaryText(q, false), "Basic only", `quest ${q}`);
});

test("weightedRandom odds: exact, threshold 0 goes to the first choice in pairs() order", () => {
  const t = new LuaTable();
  t.set(0, 62 * 1.25);
  [15, 15, 8].forEach((w, i) => t.set(i + 1, w));
  const odds = weightedOdds(t);
  assert.ok(Math.abs([...odds.values()].reduce((a, b) => a + b, 0) - 1) < 1e-12);
  // total 115.5 -> math.random(0, 115): 116 thresholds; item 1 comes first in pairs() order and also wins 0
  assert.deepEqual(t.keys(), [1, 2, 3, 0]);
  assert.equal(odds.get(1), 16 / 116);
  assert.equal(odds.get(0), 77 / 116);
  // matches the engine's weightedRandom
  setRng(new Rng(11));
  const n = 200000, hits = new Map<unknown, number>();
  for (let i = 0; i < n; i++) {
    const k = weightedRandom(t);
    hits.set(k, (hits.get(k) ?? 0) + 1);
  }
  for (const [k, p] of odds) assert.ok(Math.abs((hits.get(k) ?? 0) / n - p) < 0.004, `${k}`);
});

test("loot rolls: Nothing is a row, every grade column adds up to 100 %", () => {
  const t = lootTable("Arachne")!;
  assert.equal(t.rows.length, 3);
  for (let g = 0; g < 5; g++) assert.ok(Math.abs(t.nothing[g] + t.rows.reduce((s, r) => s + r.chance[g], 0) - 100) < 1e-9);
  // a better grade shrinks "nothing" (nilOdds × 1.25 … × 0.75)
  for (let g = 1; g < 5; g++) assert.ok(t.nothing[g] < t.nothing[g - 1]);
  // grade B: odds { 1: 30, 2: 10, 3: 10, 0: 50 }, total 100 -> 101 thresholds, the ring (first in order) gets 31
  assert.equal(t.rows[0].type, "equipment");
  assert.ok(Math.abs(t.rows[0].chance[2] - 3100 / 101) < 1e-9);
  assert.equal(amountRange(t.rows[1].amounts), "1–3");
  assert.equal(parcelRoll("Arachne")!.nilPct, t.nothing[2]);
});

test("every-win amounts by grade: × gradeBonus, rounded, at most 5, 0 = nothing", () => {
  // Spider Silk 1–3: grade D (×0.6) 6..18 -> 1 or 2; grade S (×1.5) 15..45 -> 2..5
  assert.deepEqual([...fixedAmounts([12, 1, 3], 1).keys()], [1, 2]);
  assert.deepEqual([...fixedAmounts([12, 1, 3], 5).keys()], [2, 3, 4, 5]);
  // a 0–1 reward can give nothing: grade B 0..10, round(x / 10) = 0 for x < 5 -> 5 of 11
  assert.ok(Math.abs(fixedAmounts([1, 0, 1], 3).get(0)! - 5 / 11) < 1e-12);
  assert.equal(pctText(100), "100%");
  assert.equal(pctText(9.9), "9.9%");
  assert.equal(pctText(0.01), "<0.1%");
});
