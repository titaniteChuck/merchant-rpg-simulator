/** The game's party rules (partyRules in web/src/tools/combat.ts), on made-up heroes: no save file needed, so CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { evaluate, evaluateTarget, partyProblem, partyRules, requiredSlots, searchParty, soloRows } from "../src/tools/combat.ts";
import { optimiseFight } from "../src/tools/optimise.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [WEAPON],
});
const pool = () => new Map([1, 2, 3, 4, 5].map((id) => [id, sim.hero(raw(id, [1, 5, 3, 2, 9][id - 1], 30))] as const));
const MAP = { map: { id: 1, prestigeLevel: 0, grade: 3 } };
const ids = (p: { front: (number | null)[]; back: (number | null)[] }) => [...p.front, ...p.back].filter((x) => x !== null);

test("rules: solo quests one hero in front 1, party quests front 2 and questSize, maps free", () => {
  assert.deepEqual(partyRules({ quest: 3 }), { kind: "solo", maxSize: 1, required: [{ row: "front", i: 0 }] });
  // Desolation Wolf: a 3-hero party quest
  assert.deepEqual(partyRules({ quest: 81 }), { kind: "party", maxSize: 3, required: [{ row: "front", i: 1 }] });
  assert.deepEqual(requiredSlots({ quest: 81 }), [{ row: "front", i: 1 }]);
  assert.deepEqual(partyRules(MAP), { kind: "map", maxSize: 6, required: [] });
  // a map room (the map's boss, to tune rotations) follows the map's rules
  assert.deepEqual(requiredSlots({ quest: 81, mapRoom: true }), []);
  assert.deepEqual(soloRows({ quest: 3 }, "h"), [["h", null, null], [null, null, null]]);
  assert.deepEqual(soloRows({ quest: 81 }, "h"), [[null, "h", null], [null, null, null]]);
  assert.deepEqual(soloRows(MAP, "h"), [["h", null, null], [null, null, null]]);
});

test("evaluate refuses a layout the game would not start, with the reason", () => {
  const [a, b, c, d] = [...pool().values()];
  assert.throws(() => evaluate(sim, 81, [a, null, null], [b, null, null], 1), /quest 81 \(.+\) needs a hero in front 2/);
  assert.throws(() => evaluate(sim, 81, [a, b, null], [c, d, null], 1), /takes at most 3 heroes, not 4/);
  assert.throws(() => evaluate(sim, 3, [a, null, null], [b, null, null], 1), /solo quest: one hero, in front 1/);
  assert.throws(() => evaluate(sim, 3, [null, a, null], [], 1), /solo quest/);
  assert.throws(() => evaluate(sim, 81, [], [], 1), /the party is empty/);
  assert.equal(partyProblem({ quest: 81 }, [a, b, null], [c, null, null]), null);
  assert.equal(evaluate(sim, 81, [null, a, null], [b, null, c], 1).n, 1);
  // maps: any slot; a map room skips the quest's own rules
  assert.ok("cleared" in evaluateTarget(sim, MAP, [], [null, null, a], 1));
  assert.equal(evaluate(sim, 81, [a, null, null], [b, c, d], 1, false, 1, 1, true).n, 1);
});

test("searchParty and optimiseFight keep a party quest's front 2 filled and its size", () => {
  // Treasure Bush (99): a 6-hero party quest; Maexna (10): 2 heroes
  const one = searchParty(sim, pool(), { quest: 99 }, { size: 6, nQuick: 2, nFinal: 2 });
  assert.notEqual(one.party.front[1], null);
  const two = searchParty(sim, pool(), { quest: 10 }, { size: 6, nQuick: 2, nFinal: 2 });
  assert.ok(ids(two.party).length <= 2 && two.party.front[1] !== null, JSON.stringify(two.party));
  const solo = searchParty(sim, pool(), { quest: 3 }, { size: 6, nQuick: 2, nFinal: 2 });
  assert.equal(ids(solo.party).length, 1);
  assert.notEqual(solo.party.front[0], null);
  assert.throws(() => searchParty(sim, pool(), { quest: 10 }, { lock: [1, 2, 3] }), /at most 2 heroes/);

  // order and row swaps never empty front 2 (the start has one hero per row: emptying it would be a candidate)
  const start = { front: [null, 1, null], back: [2, null, 3] };
  const steps = { party: false, order: true, swap: true, phase: false, skills: false, gear: false };
  const res = optimiseFight(sim, pool(), { quest: 99 }, { startParty: start, nQuick: 2, nFinal: 2, maxRounds: 1, steps });
  assert.notEqual(res.config.party.front[1], null);
  assert.deepEqual(ids(res.config.party).sort(), [1, 2, 3]);
  // a manual layout without front 2: a clear error; with the party step on, a valid party replaces it
  const bad = { front: [1, null, null], back: [2, null, null] };
  assert.throws(() => optimiseFight(sim, pool(), { quest: 99 }, { startParty: bad, steps }), /needs a hero in front 2/);
  const fixed = optimiseFight(sim, pool(), { quest: 10 }, { startParty: bad, size: 6, nQuick: 2, nFinal: 2, maxRounds: 1,
    steps: { ...steps, party: true } });
  assert.ok(fixed.config.party.front[1] !== null && ids(fixed.config.party).length <= 2, JSON.stringify(fixed.config.party));
});

test("E23: a hero id of 0 is a hero, not an empty slot (only null / undefined are empty)", () => {
  // party quest: hero id 0 in front 2 is valid
  assert.equal(partyProblem({ quest: 81 }, [null, 0, null], [null, null, null]), null);
  assert.equal(partyProblem({ quest: 81 }, [1, 0, null], [2, null, null]), null);
  // solo quest: hero id 0 alone in front 1 is valid
  assert.equal(partyProblem({ quest: 3 }, [0, null, null], [null, null, null]), null);
  assert.match(partyProblem({ quest: 3 }, [0, null, null], [1, null, null]) ?? "", /solo quest/);
  // an empty front 2 is still invalid, whether null or undefined
  assert.match(partyProblem({ quest: 81 }, [0, null, null], [1, null, null]) ?? "", /needs a hero in front 2/);
  assert.match(partyProblem({ quest: 81 }, [0, undefined, 2], []) ?? "", /needs a hero in front 2/);
  assert.match(partyProblem({ quest: 3 }, [null, 0, null], []) ?? "", /solo quest/);
  assert.match(partyProblem({ quest: 81 }, [null, null, null], [null, null, null]) ?? "", /the party is empty/);
});
