/** Joint fight optimiser (web/src/tools/optimise.ts) on made-up heroes: no save file needed, so CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluateTarget, SearchCancelled } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { optimiseFight } from "../src/tools/optimise.ts";
import { parseSave } from "../src/tools/save.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number, inv: string[] = [WEAPON]) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: inv,
});
// a made-up save: three heroes (one on the bench wearing a second weapon) and two spare weapons in the inventory
const RAW = {
  inventory: [WEAPON, "3|5|4|1|0|0|A20B2C8D2|0|A0B0C0|0"], sales: [],
  hero: [raw(1, 1, 20), raw(2, 5, 20), raw(3, 2, 18, ["3|5|4|1|0|0|A20B2C8D2|0|A0B0C0|0"])],
};
const pool = () => {
  const save = parseSave(structuredClone(RAW));
  // deno-lint-ignore no-explicit-any
  return { save, pool: new Map<number, any>(save.raw.hero.map((h: { id: number }) => [h.id, sim.hero(h)] as const)) };
};

test("optimiseFight: a party from the pool, only steps that gain are kept, heroes restored", () => {
  const { save, pool: p } = pool();
  const before = [...p.values()].map((h) => [sim.rotation(h).join(), h.heroInventory.map((i: { name?: string }) => i?.name).join()]);
  const calls: string[] = [];
  const res = optimiseFight(sim, p, { quest: 3 }, { save, size: 2, nQuick: 6, nFinal: 10, maxRounds: 2 },
    { onProgress: (_d, _t, s) => void calls.push(s) });
  const ids = [...res.config.party.front, ...res.config.party.back].filter((x) => x !== null);
  assert.ok(ids.length >= 1 && ids.length <= 2 && ids.every((id) => p.has(id!)));
  for (const s of res.trace) assert.ok(s.after === s.before || s.after >= s.before + 5, `${s.step}: ${s.before} -> ${s.after}`);
  for (const id of ids) assert.equal(res.config.skills[id!].rotation.length, 5);
  assert.ok(calls.some((c) => c.startsWith("party")));
  assert.deepEqual([...p.values()].map((h) => [sim.rotation(h).join(), h.heroInventory.map((i: { name?: string }) => i?.name).join()]), before);
  // an owned item is given to one hero at most
  const froms = Object.values(res.config.gear).flat().map((g) => g.from + g.item);
  assert.equal(new Set(froms).size, froms.length);
  // the result is reproducible and at least as good as its first party
  assert.ok(res.ev.score >= res.firstPartyEv!.score - 1e-9 || res.trace.every((s) => s.after === s.before));
  const again = optimiseFight(sim, pool().pool, { quest: 3 }, { save, size: 2, nQuick: 6, nFinal: 10, maxRounds: 2 });
  assert.deepEqual(again.config, res.config);
});

test("optimiseFight applies to a map run (scroll step) and honours a stop", () => {
  const { pool: p } = pool();
  const res = optimiseFight(sim, p, { map: { id: 1, prestigeLevel: 0, grade: 3 } }, { size: 2, nQuick: 1, nFinal: 2, maxRounds: 1 });
  assert.ok(res.trace.some((s) => s.step === "scrolls"));
  assert.ok("cleared" in res.ev);
  assert.throws(() => optimiseFight(sim, pool().pool, { quest: 3 }, { size: 2, nQuick: 4, timeBudgetMs: 0 }),
    (e: unknown) => e instanceof SearchCancelled, "stopped before any party: nothing to return");
  let afterParty = false;
  const stopped = optimiseFight(sim, pool().pool, { quest: 3 }, { size: 2, nQuick: 4 },
    { onProgress: (_d, _t, s) => void (afterParty ||= !s.startsWith("party")), shouldStop: () => afterParty });
  assert.equal(stopped.stopped, true);
  assert.ok(stopped.trace.length >= 1 && stopped.trace[0].step === "party");
});

test("evaluateTarget runs a quest or a map on the same seeds", () => {
  const h = sim.hero(raw(1, 1, 20));
  assert.deepEqual(evaluateTarget(sim, { quest: 3 }, [h], [], 5), evaluateTarget(sim, { quest: 3 }, [h], [], 5));
  assert.ok("cleared" in evaluateTarget(sim, { map: { id: 1, prestigeLevel: 0, grade: 3 } }, [h], [], 1));
});
