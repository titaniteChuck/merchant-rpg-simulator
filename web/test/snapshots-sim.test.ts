/**
 * CI-safe regression snapshots of the combat engine: fixed-seed fights and map runs with
 * heroes built from catalog data only (no save, unlike the local Lua-parity fixtures).
 * Snapshots: test/snapshots/{fights,maps,feast}.json; regenerate with UPDATE_SNAPSHOTS=1 npm test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fight, loadGameData, mapRun, traceStart, traceStop } from "../src/sim/api.ts";
import type { Hero, TraceEntry } from "../src/sim/api.ts";
import { catalogHero } from "./helpers/catalog-heroes.ts";
import { matchSnapshot } from "./helpers/snapshot.ts";

loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));

const SEEDS = [1, 2, 3];

interface Party {
  name: string;
  level: number;
  prestige: number;
  grade: number;
  front: number[];
  back: number[];
}
/** Class ids: 1 Warrior, 2 Rogue, 3 Mage, 4 Berserker, 5 Cleric, 6 Assassin, 7 Paladin, 8 Dark Knight, 9 Bard. */
const party = (name: string, level: number, prestige: number, grade: number, front: number[], back: number[] = []): Party =>
  ({ name, level, prestige, grade, front, back });

/** Fresh heroes for every fight/run (no state carried between snapshots). */
function build(p: Party): [Hero[], Hero[]] {
  const mk = (cls: number) => catalogHero({ cls, level: p.level, prestige: p.prestige, grade: p.grade });
  return [p.front.map(mk), p.back.map(mk)];
}

// [party, [quest id, isRare, enemy amount][]]
const FIGHTS: [Party, [number, boolean, number][]][] = [
  [party("solo L10", 10, 1, 3, [1]), [[7, false, 1], [7, false, 3], [7, true, 1], [9, false, 2]]],
  [party("duo L20", 20, 1, 3, [2], [3]), [[14, false, 2], [17, true, 1], [20, false, 1]]],
  [party("trio L30", 30, 1, 3, [4, 6], [5]), [[24, false, 4], [26, true, 2], [28, false, 1]]],
  [party("five L45", 45, 2, 3, [2, 6, 4], [9, 8]), [[45, false, 3], [37, true, 1], [52, false, 1]]],
  [party("six L60", 60, 3, 5, [7, 8, 1], [3, 5, 9]),
    [[80, false, 1], [81, true, 1], [84, false, 2], [87, false, 1], [53, false, 1], [72, false, 1]]],
];

test("fixed-seed fights match their snapshot", () => {
  const out: unknown[] = [];
  for (const [p, quests] of FIGHTS) {
    for (const [quest, isRare, amount] of quests) {
      for (const seed of SEEDS) {
        const [front, back] = build(p);
        const r = fight(quest, front, back, { seed, isRare, amount });
        out.push({ party: p.name, quest, isRare, amount, seed, ...r });
      }
    }
  }
  matchSnapshot("fights", out);
});

// [party, map id, asc, prefix, suffix, scroll ids]
const MAPS: [Party, number, number, number, number, number[]][] = [
  [party("six L10", 10, 1, 5, [1, 7, 4], [3, 5, 9]), 1, 0, 0, 0, []],
  [party("six L40", 40, 2, 5, [1, 7, 4], [3, 5, 9]), 8, 0, 1, 0, []],
  [party("six L48", 48, 2, 5, [1, 7, 4], [3, 5, 9]), 13, 1, 3, 3, [61, 63]],
  [party("six L60", 60, 3, 5, [7, 8, 6], [2, 5, 9]), 17, 0, 0, 4, [60]],
  [party("six L60", 60, 3, 5, [1, 7, 4], [3, 5, 9]), 21, 1, 20, 5, [62, 67, 69]],
];

test("fixed-seed map runs match their snapshot", () => {
  const out: unknown[] = [];
  for (const [p, id, asc, prefix, suffix, scrolls] of MAPS) {
    for (const seed of SEEDS.slice(0, 2)) {
      const [front, back] = build(p);
      const r = mapRun({ id, prestigeLevel: asc, grade: 3, prefix: prefix || undefined, suffix: suffix || undefined },
        front, back, { seed, scrolls: scrolls.map((sid) => ({ id: sid })) });
      out.push({ party: p.name, map: id, asc, prefix, suffix, scrolls, seed, ...r });
    }
  }
  matchSnapshot("maps", out);
});

/** The enemy's HP after each action, compact (for the Feast snapshot). */
const enemyTrace = (t: TraceEntry[]) => t.map((e) => ({ turn: e.turn, who: e.who, act: e.act, enemyHP: e.enemyHP }));

/** Turns where the enemy's Feast (self-heal: 2x its current atk, capped at max HP) raised its HP. */
function feastHeals(t: TraceEntry[], maxHP?: number): number[] {
  const turns: number[] = [];
  t.forEach((e, i) => {
    if (e.act !== "Feast" || e.who !== 0 || i === 0) return;
    if (maxHP !== undefined) assert.ok(e.enemyHP <= maxHP, `Feast on turn ${e.turn} overheals: ${e.enemyHP} > ${maxHP}`);
    if (e.enemyHP > t[i - 1].enemyHP) turns.push(e.turn);
  });
  return turns;
}

test("Goblin Warlord's Feast heal matches its snapshot", () => {
  // Quest 91 (Goblin Warlord) x10, solo Warrior L30: Feast every 5 turns from turn 3.
  traceStart();
  const r = fight(91, [catalogHero({ cls: 1, level: 30 })], [], { seed: 1, amount: 10 });
  const ft = traceStop();
  const fightHeals = feastHeals(ft, r.enemyMaxHP);
  assert.deepEqual(fightHeals.slice(0, 2), [3, 8], "the Warlord heals on turns 3 and 8");

  // Goblin's Feast Map (id 3) at asc 1, solo Warrior L60: the Warlord is the last room.
  traceStart();
  const m = mapRun({ id: 3, prestigeLevel: 1, grade: 3 }, [catalogHero({ cls: 1, level: 60, prestige: 3 })], [], { seed: 1 });
  const mt = traceStop();
  assert.equal(m.combats.at(-1).questId, 91);
  let start = 0; // first action of the last room (turn counter restarts)
  mt.forEach((e, i) => { if (i > 0 && e.turn < mt[i - 1].turn) start = i; });
  const room = mt.slice(start);
  const mapHeals = feastHeals(room);
  assert.equal(mapHeals[0], 3, "the Warlord heals on turn 3 of the map's last room");

  matchSnapshot("feast", {
    fight: { quest: 91, amount: 10, seed: 1, hero: "Warrior L30", won: r.won, turns: r.turns, enemyMaxHP: r.enemyMaxHP,
      healTurns: fightHeals, trace: enemyTrace(ft) },
    map: { map: 3, asc: 1, seed: 1, hero: "Warrior L60 asc3", won: m.won, cleared: m.cleared, rooms: m.rooms,
      healTurns: mapHeals, lastRoomTrace: enemyTrace(room) },
  });
});
