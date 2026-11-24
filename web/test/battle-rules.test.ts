import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { problemOf, rulesOf } from "../src/ui/battle-rules.ts";

// The battle page's party setup rules (game 3.18): solo quests, party quests (front 2, questSize), maps.
api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const H = {};

test("solo quest: one hero, front 1", () => {
  const r = rulesOf({ quest: { id: 5 } });
  assert.equal(r.kind, "solo");
  assert.equal(r.maxSize, 1);
  assert.equal(problemOf({ quest: { id: 5 } }, [H, null, null], [null, null, null]), null);
  assert.match(problemOf({ quest: { id: 5 } }, [null, H, null], [null, null, null]) ?? "", /solo/);
  assert.match(problemOf({ quest: { id: 5 } }, [H, null, null], [H, null, null]) ?? "", /solo/);
});

test("party quest: front 2 required, at most questSize heroes (Desolation Wolf: 3)", () => {
  const t = { quest: { id: 81 } };
  assert.deepEqual(rulesOf(t), { kind: "party", maxSize: 3, required: [{ row: "front", i: 1 }] });
  assert.match(problemOf(t, [H, null, null], [H, null, null]) ?? "", /Front 2/);
  assert.equal(problemOf(t, [null, H, null], [H, H, null]), null);
  assert.match(problemOf(t, [H, H, null], [H, H, null]) ?? "", /at most 3/);
});

test("map runs and an unknown opponent: no rule", () => {
  assert.deepEqual(rulesOf({ map: {} }), { kind: "map", maxSize: 6, required: [] });
  assert.equal(problemOf(null, [H, H, H], [H, H, H]), null);
});
