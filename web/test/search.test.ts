/**
 * Search API (web/src/tools/combat.ts) on made-up heroes and the item catalog: no save needed, so CI runs it.
 * Equality with the former text commands was checked on a real save when the API was split out (2026-11-23).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import {
  catalogGearCandidates, evaluate, score, ownedGearCandidates, SearchCancelled, type SearchControl, searchGear, searchParty, searchScrolls,
  searchSkills, soloMatrix, soloQuests, soloSummary, surveyMapIds, surveyMaps,
} from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { parseSave } from "../src/tools/save.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");

const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [WEAPON],
});
const warrior = () => sim.hero(raw(1, 1, 20));
const cleric = () => sim.hero(raw(2, 5, 20));

/** Records progress calls. */
function recorder(): SearchControl & { calls: [number, number, string][] } {
  const calls: [number, number, string][] = [];
  return { calls, onProgress: (d, t, s) => void calls.push([d, t, s]) };
}

test("solo matrix: one row per hero x quest, deterministic, summary per hero and class", () => {
  const heroes: [number, ReturnType<typeof warrior>][] = [[1, warrior()], [2, cleric()]];
  const quests = soloQuests("1-4");
  const ctl = recorder();
  const rows = soloMatrix(sim, heroes, quests, { n: 10 }, ctl);
  assert.equal(rows.length, 2 * quests.length);
  assert.deepEqual(ctl.calls.at(-1), [8, 8, "solo"]);
  assert.deepEqual(soloMatrix(sim, heroes, quests, { n: 10 }), rows, "same seeds, same rows");
  const sum = soloSummary(rows, 90);
  assert.deepEqual(sum.heroes.map((h) => h.heroId), [1, 2]);
  assert.deepEqual(sum.classes.map((c) => c.class).sort(), ["Cleric", "Warrior"]);
  assert.throws(() => soloQuests("1-3", true), /no quest with a rare variant/);
});

test("skills: ranked best first, hero left as it was", () => {
  const h = warrior();
  const before = [...h.attackList];
  const ctl = recorder();
  const res = searchSkills(sim, h, [h], [], { quest: 2 }, { nQuick: 3, nFinal: 6, top: 2 }, ctl);
  assert.ok(res.ranked.length > 0 && res.ranked.length === res.counts.final);
  for (let i = 1; i < res.ranked.length; i++) assert.ok(res.ranked[i - 1].ev.score >= res.ranked[i].ev.score);
  for (const c of res.ranked) assert.equal(c.rotation.length, 5);
  assert.deepEqual(h.attackList, before);
  assert.deepEqual([...new Set(ctl.calls.map((c) => c[2]))], ["current", "skill sets", "orderings", "final"]);
});

test("gear: catalog candidates, never worse than the current gear, hero gear restored", () => {
  const h = warrior();
  const names = () => [1, 2, 3, 4, 5, 6].map((s) => h.heroInventory[s]?.name);
  const before = names();
  const cands = catalogGearCandidates(sim, h, { itemGrade: 3, levelWindow: 5 });
  assert.ok(cands.size > 0);
  const res = searchGear(sim, h, [h], [], { quest: 3 }, cands, { n: 5, passes: 1 });
  assert.ok(res.final.score >= res.base.score);
  assert.equal(res.gear.length, 6);
  assert.ok(res.gear.every((g) => g.from === null || typeof g.from === "string"));
  assert.deepEqual(names(), before);
});

test("owned gear candidates come from the inventory, sale slots and other heroes", () => {
  const save = parseSave({ inventory: [WEAPON], sales: [], hero: [raw(1, 1, 20), raw(2, 5, 20)] });
  const cands = ownedGearCandidates(save, 1);
  assert.deepEqual(cands.get(1)?.map((c) => c[0]), ["inventory", "worn by #2 Test 2"]);
});

test("map survey covers every boss map at asc 0 and 1", () => {
  const ids = surveyMapIds();
  const entries = surveyMaps(sim, [warrior()], [], { n: 1 });
  assert.equal(entries.length, ids.length * 2);
  assert.ok(entries.every((e) => (e.row && e.ev) || e.error));
});

test("scrolls: ranked loadouts include no-scrolls, with costs from the given prices", () => {
  const res = searchScrolls(sim, { id: 1, prestigeLevel: 0, grade: 3 }, [warrior()], [],
    { pool: [61, 69], nQuick: 1, nFinal: 2, top: 2, prices: { 61: 100, 69: 50 } });
  assert.ok(res.ranked.some((x) => x.loadout.length === 0));
  for (const x of res.ranked) assert.equal(x.cost, x.loadout.reduce((s, id) => s + ({ 61: 100, 69: 50 } as Record<number, number>)[id], 0));
  assert.equal(res.priceError, undefined);
});

test("party: picks heroes from the pool into slots", () => {
  const pool = new Map([[1, warrior()], [2, cleric()]]);
  const res = searchParty(sim, pool, { quest: 2 }, { size: 2, nQuick: 3, nFinal: 5 });
  const placed = [...res.party.front, ...res.party.back].filter((x) => x !== null);
  assert.ok(placed.length >= 1 && placed.every((id) => pool.has(id!)));
  assert.equal(res.added.length >= 1, true);
  assert.ok("win" in res.ev);
});

test("shouldStop cancels a search and leaves the hero as it was", () => {
  const h = warrior();
  const before = [...h.attackList];
  let evals = 0;
  assert.throws(() => searchSkills(sim, h, [h], [], { quest: 2 }, { nQuick: 2, nFinal: 2 }, { shouldStop: () => ++evals > 3 }),
    (e: unknown) => e instanceof SearchCancelled);
  assert.deepEqual(h.attackList, before);
});

test("healing enemies: lowest HP reached and total damage are reported and scored", () => {
  // Goblin Warlord (quest 91) heals with Feast/Gluttony: against this hero it ends higher than its lowest point.
  const ev = evaluate(sim, 91, [warrior()], [], 10);
  assert.ok(ev.enemy_dmg_peak > ev.enemy_dmg, `peak ${ev.enemy_dmg_peak} vs end ${ev.enemy_dmg}`);
  assert.ok(ev.enemy_dmg_total > 0 && ev.enemy_dmg_total_frac > 0);
  assert.equal(ev.score, score(ev));
  // The score counts the peak, not the end HP; total damage only breaks ties.
  assert.ok(score({ ...ev, enemy_dmg_peak: ev.enemy_dmg }) < ev.score);
  assert.ok(score({ ...ev, enemy_dmg_total_frac: 0 }) < ev.score && ev.score - score({ ...ev, enemy_dmg_total_frac: 0 }) <= 0.1);
  // An enemy that does not heal: peak = end.
  const plain = evaluate(sim, 1, [warrior()], [], 10);
  assert.equal(plain.enemy_dmg_peak, plain.enemy_dmg);
});

test("skills: every ranked rotation is really played with its passive (AP budget per passive, Wisdom +2)", async () => {
  const { standardHero } = await import("../src/tools/classes.ts");
  const mage = standardHero(sim, 3, 60, 3, "best");
  const res = searchSkills(sim, mage, [mage], [], { quest: 60 }, { nQuick: 2, nFinal: 3, top: 2 });
  assert.ok(res.ranked.length > 0);
  for (const c of res.ranked) {
    sim.setSkills(mage, c.rotation, c.passive);
    assert.deepEqual(sim.rotation(mage), c.rotation, `${c.rotation.join("/")} with ${c.passive} must not fall back to the default`);
    assert.equal(mage.passiveSelect, c.passive);
  }
});

test("class matrix: enemy HP removed at its lowest point is reported next to the end value", async () => {
  const { classMatrix } = await import("../src/tools/classes.ts");
  // Protector of the Forest (95) regenerates above its max HP: the end value can be negative
  const rows = classMatrix(sim, { classes: [3], quests: [95], n: 5 });
  assert.ok(rows[0].enemyHpRemovedPeak >= rows[0].enemyHpRemoved);
  assert.ok(rows[0].enemyHpRemovedPeak >= 0);
});
