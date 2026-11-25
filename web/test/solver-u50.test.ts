// Battle Solver U50: no 🔒 locks; a table of the save's heroes, each Must include / Neutral / Exclude (a radio group
// per hero), stored per save, old locks migrated; the search keeps every Must include hero in every result party.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { type PartyConfig, searchParties } from "../src/tools/parties.ts";
import { heroPick, migrateOldLocks, picksFromOldLocks, picksSummary, readHeroPicks, solverHeroesKey, solverPick } from "../src/ui/solver-heroes.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const HEROES = [{ id: 11, name: "Ann" }, { id: 12, name: "Bo" }, { id: 13, name: "Cy" }, { id: 14, name: "Di", hidden: true }];

test("solverPick: Exclude leaves the pool, Must include is the search's lock; a hidden class starts as Exclude", () => {
  const r = solverPick(HEROES, { 11: "must", 12: "exclude" }, 3, 6);
  assert.deepEqual(r, { pool: [11, 13], must: [11] });
  // the hidden-class hero set back to Neutral is in the pool
  assert.deepEqual(solverPick(HEROES, { 14: "neutral" }, 3, 6), { pool: [11, 12, 13, 14], must: [] });
  assert.equal(heroPick({}, 14, true), "exclude");
  assert.equal(heroPick({}, 11), "neutral");
});

test("solverPick: too many must-include heroes is one short error (opponent's limit first, then the largest size)", () => {
  const all = { 11: "must", 12: "must", 13: "must" } as const;
  assert.deepEqual(solverPick(HEROES, all, 2, 2), { error: "3 heroes must be included: this opponent takes at most 2." });
  assert.deepEqual(solverPick(HEROES, all, 2, 6), { error: "3 heroes must be included: raise the largest party size to 3." });
  assert.ok("pool" in solverPick(HEROES, all, 3, 3));
});

test("stored states: only known heroes and states; old locks become Must include, once", () => {
  assert.deepEqual(readHeroPicks('{"11":"must","12":"bogus","99":"exclude","13":"exclude"}', [11, 12, 13]), { 11: "must", 13: "exclude" });
  assert.equal(readHeroPicks(null, [11]), null);
  assert.equal(readHeroPicks("{broken", [11]), null);
  // old party: slot key -> save hero index; locked slot keys
  const party = JSON.stringify({ slots: { front0: 2, back1: 0, front1: 1 }, locked: { front0: true, back1: true, front1: false } });
  assert.deepEqual(picksFromOldLocks(party, [11, 12, 13]), { 13: "must", 11: "must" });
  const mem = new Map<string, string>([["battle-party:Slot2Data.txt", party]]);
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  migrateOldLocks(store, "Slot2Data.txt", [11, 12, 13]);
  assert.deepEqual(JSON.parse(mem.get(solverHeroesKey("Slot2Data.txt"))!), { 11: "must", 13: "must" });
  // states already stored: never overwritten
  mem.set(solverHeroesKey("Slot2Data.txt"), '{"11":"neutral"}');
  migrateOldLocks(store, "Slot2Data.txt", [11, 12, 13]);
  assert.equal(mem.get(solverHeroesKey("Slot2Data.txt")), '{"11":"neutral"}');
  assert.equal(picksSummary(HEROES, { 11: "must", 12: "exclude" }), "Heroes · 1 must · 2 out");
});

test("the search: every result party holds the Must include hero, the party quest's Front 2 filled, sizes kept", () => {
  api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
  const sim = new Sim("Standard");
  const raw = (id: number, cls: number, level: number) => ({
    id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
  });
  const pool = new Map([[1, sim.hero(raw(1, 1, 30))], [2, sim.hero(raw(2, 5, 30))], [3, sim.hero(raw(3, 3, 10))], [4, sim.hero(raw(4, 2, 5))]]);
  // the weakest hero (4) must be in; a Treasure Bush (quest 99) is a party quest a strong hero wins alone
  const r = searchParties(sim, pool, { quest: 99 }, { nQuick: 4, nFinal: 8, beam: 3, refine: 2, rotations: false, minSize: 1, maxSize: 3, topK: 6, lock: [4] });
  assert.ok(r.results.length > 0);
  const ids = (c: PartyConfig) => [...c.layout.front, ...c.layout.back].filter((x): x is number => x !== null);
  for (const c of r.results) {
    assert.ok(ids(c).includes(4), `must-include hero in ${JSON.stringify(c.layout)}`);
    assert.ok(c.layout.front[1] !== null, "Front 2 filled on a party quest");
    assert.ok(c.size >= 1 && c.size <= 3);
  }
});

test("the page: no 🔒 on the Solver, the hero table is a radio group per hero, the solve sends the must-include heroes", () => {
  const page = read("web/src/ui/battle-page.ts"), search = read("web/src/ui/battle-search.ts"), css = read("site/style.css");
  assert.doesNotMatch(page, /🔓|state\.locked|locks:/);
  assert.doesNotMatch(search, /excludePicker|, "Leave heroes out"\)|ctx\.locks/);
  assert.match(search, /segmented\(`solver-hero-\$\{me\.id\}`, `\$\{me\.name\}: in the solve`/);
  assert.match(search, /lock: pick\.must/);
  assert.match(search, /const pick = solverPick\(excl\.heroes, excl\.picks\(\), hi, cap\);/);
  const block = css.slice(css.indexOf("/* U50 */"), css.indexOf("/* end U50 */"));
  assert.ok(block.length > 100, "one marked U50 block");
  assert.match(block, /\.hero-pick \.pick-must:has\(input:checked\)/);
  assert.match(block, /\.hero-pick \.pick-exclude:has\(input:checked\)/);
});
