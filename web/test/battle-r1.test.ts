// Battle page fixes of the live-site review R1 (R1-A): a fresh save's opponent and party (F02), the party problem in the
// page's words with translated names and no ids (F24), and the damage without overkill (F22). Game data only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { partyProblem, partyRules } from "../src/tools/combat.ts";
import { loadLanguage, setLanguage } from "../src/tools/i18n.ts";
import { isBoardQuest } from "../src/tools/quest-stats.ts";
import { problemOf } from "../src/ui/battle-rules.ts";
import { defaultQuest, defaultSlots, effectiveDamage, enemyMaxHp, type HeroPick } from "../src/ui/battle-setup.ts";
import { enemyName } from "../src/ui/names.ts";
import { isGathering, regionOf, regionOfLevel } from "../src/ui/wiki-data.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
api.loadGameData(read("inventory/gamedata.json"));
loadLanguage(read("inventory/i18n/fr.json"));

test("F02: a fresh save starts on the toughest board quest of its strongest heroes' region, never a bush", () => {
  for (const level of [5, 20, 35, 60]) {
    const id = defaultQuest(level);
    assert.ok(id !== null, `level ${level}`);
    const q = G.questData[id!];
    assert.ok(isBoardQuest(id!) && !isGathering(id!) && q.questType !== 6 && !/boss/i.test(q.title ?? ""), `${q.name}: a plain board quest`);
    assert.ok(q.levelReq <= level, `${q.name} (level ${q.levelReq}) at most ${level}`);
    assert.equal(regionOf("enemy", id!)?.id, regionOfLevel(level), `${q.name} in region ${regionOfLevel(level)}`);
  }
  // what the visitor hides is skipped
  const first = defaultQuest(60)!;
  assert.notEqual(defaultQuest(60, (q) => q !== first), first);
  assert.equal(defaultQuest(0), null);
});

test("F02: the fresh party follows the rules: required slot first, at most maxSize, strongest heroes, toughest in front", () => {
  const heroes: HeroPick[] = [
    { idx: 0, level: 10, prestige: 1, maxHP: 300 },
    { idx: 1, level: 60, prestige: 2, maxHP: 900 },
    { idx: 2, level: 60, prestige: 2, maxHP: 2000 },
    { idx: 3, level: 55, prestige: 1, maxHP: 1500 },
    { idx: 4, level: 40, prestige: 1, maxHP: 700 },
  ];
  // Desolation Wolf (81): party quest, 3 heroes, Front 2 required
  const wolf = defaultSlots(heroes, partyRules({ quest: 81 }));
  assert.deepEqual(wolf, { front1: 2, front0: 3, front2: 1 });
  const at = (s: Record<string, number>, row: string) => [0, 1, 2].map((i) => s[`${row}${i}`] ?? null);
  assert.equal(partyProblem({ quest: 81 }, at(wolf, "front"), at(wolf, "back")), null);
  // solo quest: the strongest hero, in Front 1
  const solo = defaultSlots(heroes, partyRules({ quest: 5 }));
  assert.deepEqual(solo, { front0: 2 });
  assert.equal(partyProblem({ quest: 5 }, at(solo, "front"), at(solo, "back")), null);
  // a map run: everyone (5 here), front row first
  const map = defaultSlots(heroes, partyRules({ map: { id: 11, prestigeLevel: 0, grade: 3 } }));
  assert.equal(Object.keys(map).length, 5);
  assert.deepEqual([map.front0, map.front2, map.front1], [2, 3, 1]);
});

test("F24: the party problem in the page's words: the enemy's translated name, no quest id", () => {
  const H = {};
  setLanguage("fr");
  try {
    const wolf = enemyName(81)!;
    const p = problemOf({ quest: { id: 81 } }, [H, H, null], [H, H, null]) ?? "";
    assert.match(p, /at most 3/);
    assert.ok(p.includes(wolf), `${p} names ${wolf}`);
    assert.doesNotMatch(p, /81|quest \d/);
    const solo = problemOf({ quest: { id: 5 } }, [null, H, null], [null, null, null]) ?? "";
    assert.match(solo, /solo/);
    assert.doesNotMatch(solo, /quest 5|\(.*\)/);
    assert.match(problemOf({ quest: { id: 81 } }, [null, null, null], [null, null, null]) ?? "", /at least one hero/);
  } finally {
    setLanguage("en");
  }
});

test("F22: damage per fight without overkill: the party's total capped at the enemy's max HP, shares kept", () => {
  const ev = { heroes: { front1: { dmg: 1391 }, back1: { dmg: 2237 } }, enemy_dmg_total: 3628, enemy_dmg_total_frac: 3628 / 250 };
  assert.ok(Math.abs(enemyMaxHp(ev)! - 250) < 1e-9);
  const e = effectiveDamage(ev);
  assert.ok(Math.abs(e.front1[0] + e.back1[0] - 250) < 1e-9);
  assert.ok(Math.abs(e.front1[0] / e.back1[0] - 1391 / 2237) < 1e-9);
  assert.deepEqual([e.front1[1], e.back1[1]], [1391, 2237]);
  // below the enemy's HP (a lost fight), or no HP known: unchanged
  assert.deepEqual(effectiveDamage({ heroes: { front1: { dmg: 100 } }, enemy_dmg_total: 100, enemy_dmg_total_frac: 0.4 }).front1, [100, 100]);
  assert.deepEqual(effectiveDamage({ heroes: { front1: { dmg: 100 } } }).front1, [100, 100]);
});
