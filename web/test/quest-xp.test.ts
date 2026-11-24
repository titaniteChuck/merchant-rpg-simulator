// U33: XP, time and XP / min of quests and map runs as the pages show them (ui/quest-xp.ts): the wiki enemy page's
// "XP and time" section and the battle page's result tiles. Committed game data only: CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import type { FightEval } from "../src/tools/combat.ts";
import { mapRunStats, questStats } from "../src/tools/quest-stats.ts";
import { setShowAll } from "../src/ui/expansion-state.ts";
import {
  fightBattleSeconds, mapResultXp, mapXpRows, partySizes, questResultXp, questSizes, questXpRows, timeText, xpText,
} from "../src/ui/quest-xp.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const MAEXNA = 10, MONARCH = 92, BUSH = 100;

test("quest sizes by hero tier and party sizes from the engine's party rules", () => {
  assert.deepEqual(questSizes(), [{ amount: 1, tier: 1 }, { amount: 3, tier: 2 }, { amount: 5, tier: 3 }]);
  assert.deepEqual(partySizes(MAEXNA), [1, 2], "Maexna: a party quest of 2");
  assert.deepEqual(partySizes(1), [1], "a solo quest");
});

test("quest XP rows: ×1 / ×3 / ×5 and the rare variant, at a grade and party size (Maexna)", () => {
  const b1 = questXpRows(MAEXNA, { grade: 3, heroes: 1 });
  assert.deepEqual(b1.map((r) => [r.amount, r.rare, r.xpPerHero, r.seconds]), [[1, false, 400, 100], [3, false, 1200, 300], [5, false, 2000, 500], [1, true, 500, 100]]);
  assert.ok(b1.every((r) => Math.abs(r.xpPerMin - r.xpPerHero / (r.seconds / 60)) < 1e-9));
  assert.equal(b1[0].xpPerMin, 240);
  // the XP is split between the heroes; the time is not
  const b2 = questXpRows(MAEXNA, { grade: 3, heroes: 2 });
  assert.deepEqual(b2.map((r) => r.xpPerHero), [200, 600, 1000, 250]);
  // grade S: quest time × 0.75, grade D × 1.25
  assert.equal(questXpRows(MAEXNA, { grade: 5 })[0].seconds, 75);
  assert.equal(questXpRows(MAEXNA, { grade: 1 })[0].seconds, 125);
  // the same figures as questStats
  const s = questStats(MAEXNA, { grade: 4, amount: 3, heroes: 2 });
  const r = questXpRows(MAEXNA, { grade: 4, heroes: 2 })[1];
  assert.deepEqual([r.xpPerHero, r.seconds, r.xpPerMin], [s.xpPerHero, s.seconds, s.xpPerMin]);
  // a map-only enemy has no quest rows
  assert.deepEqual(questXpRows(MONARCH), []);
});

test("map-only enemies: the maps they are fought in, craft + run time and XP per run (Murlok Monarch)", () => {
  setShowAll(true);
  try {
    const { rows, hidden } = mapXpRows(MONARCH, { grade: 3, heroes: 1 });
    assert.equal(hidden, 0);
    assert.deepEqual(rows.map((r) => [r.map, r.role]), [[7, "boss"], [12, "boss"]]);
    const m7 = mapRunStats(7, { grade: 3, heroes: 1 });
    assert.deepEqual([rows[0].craftSeconds, rows[0].runSeconds, rows[0].xpPerHero, rows[0].xpPerMin], [m7.craftSeconds, m7.runSeconds, m7.xpPerHero, m7.xpPerMin]);
    assert.ok(Math.abs(rows[1].perRun - 1 / 3) < 1e-12);
    // six heroes split the XP; ascension 1 doubles the enemy modifier (more XP per room)
    assert.ok(mapXpRows(MONARCH, { heroes: 6 }).rows[0].xpPerHero < rows[0].xpPerHero / 5);
    assert.ok(mapXpRows(MONARCH, { asc: 1 }).rows[0].xpPerHero > rows[0].xpPerHero * 1.5);
    // a Treasure Bush: only from map grade B
    assert.deepEqual(mapXpRows(BUSH, { grade: 2 }).rows, []);
    assert.ok(mapXpRows(BUSH, { grade: 5 }).rows.every((r) => r.role === "treasure"));
    assert.deepEqual(mapXpRows(MAEXNA).rows, [], "a quest-board quest has no map rows");
  } finally {
    setShowAll(false);
  }
  // maps are Scribe content: hidden (and counted) for a visitor without it
  const off = mapXpRows(MONARCH);
  assert.deepEqual([off.rows.length, off.hidden], [0, 2]);
});

const fight = (o: Partial<FightEval>): FightEval => ({
  n: 1, win: 1, turns: 4, turns_win: 4, grade: 4.4, enemy_dmg: 1, enemy_dmg_peak: 1, enemy_dmg_total: 0, enemy_dmg_total_frac: 1, hp_left: 1, score: 0,
  heroes: {
    front1: { name: "A", dmg: 0, taken: 0, heal: 0, deaths: 0, death_rate: 0, skillDmg: {}, skillUses: { Basic: 2, Slash: 2 } },
    front2: { name: "B", dmg: 0, taken: 0, heal: 0, deaths: 0, death_rate: 0, skillDmg: {}, skillUses: { Basic: 4 } },
  }, ...o,
});

test("battle results: simulated fight time, quest time and XP / min", () => {
  // won in 4 turns: 8 hero actions + 3 enemy actions (dead before its 4th), 5 s each, + 4 turns × 5 s
  assert.equal(fightBattleSeconds(fight({})), (8 + 3) * 5 + 4 * 5);
  // an enemy acting first (event bosses) acts every turn; a lost fight: every turn too
  assert.equal(fightBattleSeconds(fight({}), true), (8 + 4) * 5 + 4 * 5);
  assert.equal(fightBattleSeconds(fight({ win: 0 })), (8 + 4) * 5 + 4 * 5);
  const x = questResultXp(fight({}), { quest: MAEXNA, rare: false, amount: 3, heroes: 2, speed: 20 });
  assert.equal(x.grade, 4, "average grade 4.4 → A");
  const s = questStats(MAEXNA, { grade: 4, amount: 3, heroes: 2, speed: 20, battleSeconds: 75 });
  assert.deepEqual([x.xpPerHero, x.seconds, x.xpPerMin, x.battleSeconds, x.questSeconds], [s.xpPerHero, s.seconds, s.xpPerMin, s.battleSeconds, s.questSeconds]);
  assert.equal(x.xpPerHero, 600);
  assert.equal(x.seconds, (75 + 100 * 3 * 0.9) * 0.8);
  // never won: the time at grade B
  assert.equal(questResultXp(fight({ win: 0, grade: 0 }), { quest: MAEXNA, rare: false, amount: 1, heroes: 1 }).grade, 3);
  // map run: the measured run time, the craft time of the map's grade
  const m = mapResultXp({ time_h: 1.5 }, { map: 7, grade: 3, asc: 0, heroes: 3 });
  const ms = mapRunStats(7, { grade: 3, heroes: 3, runSeconds: 5400 });
  assert.deepEqual([m.runSeconds, m.craftSeconds, m.xpPerHero, m.xpPerMin], [5400, ms.craftSeconds, ms.xpPerHero, ms.xpPerMin]);
  // R1 F06: only the rooms won give XP: 40 % of the rooms cleared on average = 40 % of the XP; none = no figure
  const part = mapResultXp({ time_h: 1.5, cleared: 0.4 }, { map: 7, grade: 3, asc: 0, heroes: 3 });
  assert.ok(Math.abs(part.xpPerHero! - 0.4 * ms.xpPerHero) < 1e-9);
  assert.ok(Math.abs(part.xpPerMin! - 0.4 * ms.xpPerMin) < 1e-9);
  assert.equal(part.xpFull, ms.xpPerHero);
  const none = mapResultXp({ time_h: 0.2, cleared: 0 }, { map: 7, grade: 3, asc: 0, heroes: 3 });
  assert.equal(none.xpPerHero, null);
  assert.equal(none.xpPerMin, null);
});

test("time and XP text", () => {
  assert.deepEqual([45, 100, 300, 500, 765, 7200, 10800 + 600, 90000].map(timeText),
    ["45 s", "1 min 40 s", "5 min", "8 min 20 s", "13 min", "2 h", "3 h 10 min", "1 d 1 h"]);
  assert.deepEqual([240, 30030.4, 2.345, 0].map(xpText), ["240", "30,030", "2.3", "0"]);
});

test("the enemy page and battle results link XP and time to the Stats page, without formulas", () => {
  const src = (f: string) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");
  for (const f of ["wiki-enemies.ts", "battle.ts"]) {
    assert.match(src(f), /statLink\("xp"/, f);
    assert.match(src(f), /statLink\("time"/, f);
  }
  const help = src("wiki-enemies.ts").match(/const (QUEST|MAP)_XP_HELP = \[[\s\S]*?\];/g)!.join("\n");
  assert.doesNotMatch(help, /round\(|×\s*\(|\/ heroes|gradeTime/, "the \"?\" texts say what, not the formula");
});
