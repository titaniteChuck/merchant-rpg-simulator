/** Joint fight optimiser (web/src/tools/optimise.ts) on made-up heroes: no save file needed, so CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { evaluateTarget, SearchCancelled } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { optimiseFight, shiftRotation } from "../src/tools/optimise.ts";
import { parseSave } from "../src/tools/save.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sim = new Sim("Standard");
const WEAPON = "3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0";
const raw = (id: number, cls: number, level: number, inv: string[] = [WEAPON], attackList = [0, 0, 0, 0, 0]) => ({
  id, heroID: id, name: `Test ${id}`, class: cls, level, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
  attackList, campaignID: -1, questListID: -1, heroInventory: inv,
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

// five made-up heroes for the layout steps, on Leviathan (quest 61, a 5-hero party quest): Warrior, a level-5 Berserker, Rogue in front; Mage and Bard at the back
const layoutPool = (rotations: Record<number, number[]> = {}) => new Map<number, ReturnType<typeof sim.hero>>(
  ([[1, 1, 20], [2, 4, 5], [3, 2, 18], [4, 3, 15], [5, 9, 15]] as const)
    .map(([id, cls, lvl]) => [id, sim.hero(raw(id, cls, lvl, [WEAPON], rotations[id]))] as const));
const START = { front: [1, 2, 3], back: [4, 5, null] };
const ONLY = { party: false, order: false, swap: false, phase: false, skills: false, gear: false };
const perms3 = <T>([a, b, c]: T[]) => [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];

test("order step: finds the best of the 36 row orders on the same seeds", () => {
  const p = layoutPool();
  const row = (r: (number | null)[]) => r.map((id) => (id === null ? null : p.get(id)!));
  let best = { score: -Infinity, front: START.front as (number | null)[], back: START.back as (number | null)[] };
  for (const front of perms3<number | null>(START.front)) {
    for (const back of perms3<number | null>(START.back)) {
      const sc = evaluateTarget(sim, { quest: 61 }, row(front), row(back), 10).score;
      if (sc > best.score) best = { score: sc, front, back };
    }
  }
  const start = evaluateTarget(sim, { quest: 61 }, row(START.front), row(START.back), 10).score;
  assert.ok(best.score >= start + 5, "the made-up case has a better order");
  const res = optimiseFight(sim, p, { quest: 61 }, { startParty: START, nQuick: 10, nFinal: 10, steps: { ...ONLY, order: true } });
  const step = res.trace.find((s) => s.step === "Order within rows")!;
  assert.equal(step.before, start);
  assert.equal(step.after, best.score);
  assert.deepEqual(res.config.party, { front: best.front, back: best.back });
  assert.equal(res.ev.score, best.score);
  // same heroes, same rows: only their order changed
  assert.deepEqual(new Set(res.config.party.front), new Set(START.front));
  // disabled: the starting layout is kept
  const off = optimiseFight(sim, layoutPool(), { quest: 61 }, { startParty: START, nQuick: 10, nFinal: 10, steps: ONLY });
  assert.deepEqual(off.config.party, START);
  assert.equal(off.trace.length, 0);
});

test("row swap step: tries one front-back exchange per pair, then re-orders the rows", () => {
  const res = optimiseFight(sim, layoutPool(), { quest: 61 }, { startParty: START, nQuick: 10, nFinal: 10, maxRounds: 1,
    steps: { ...ONLY, order: true, swap: true } });
  const steps = res.trace.map((s) => s.step);
  const swap = res.trace.find((s) => s.step.startsWith("Swap rows"))!;
  assert.ok(swap);
  if (swap.after > swap.before) {
    assert.match(swap.step, /^Swap rows: .+ ↔ .+$/);
    assert.ok(steps.includes("Order within rows (after swap)"));
  } else assert.equal(swap.step, "Swap rows");
  for (const s of res.trace) assert.ok(s.after === s.before || s.after >= s.before + 5, `${s.step}: ${s.before} -> ${s.after}`);
  const ids = [...res.config.party.front, ...res.config.party.back].filter((x) => x !== null).sort();
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});

test("phase step: cyclic shifts of each rotation, passive kept, heroes restored", () => {
  assert.deepEqual(shiftRotation(["a", "b", "c", "d", "e"], 1), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(shiftRotation(["a", "b", "c", "d", "e"], 4), ["e", "a", "b", "c", "d"]);
  const rotations = { 1: [1, 0, 0, 0, 0], 3: [1, 0, 1, 0, 0], 4: [1, 2, 0, 0, 0], 5: [3, 0, 0, 0, 0] };
  const p = layoutPool(rotations);
  const before = [...p.values()].map((h) => [sim.rotation(h).join(), h.passiveSelect]);
  const progress: string[] = [];
  const res = optimiseFight(sim, p, { quest: 61 }, { startParty: START, nQuick: 10, nFinal: 10, maxRounds: 1,
    steps: { ...ONLY, phase: true } }, { onProgress: (_d, _t, s) => void progress.push(s) });
  assert.deepEqual([...p.values()].map((h) => [sim.rotation(h).join(), h.passiveSelect]), before);
  // all-Basic hero 2 has no other phase: still a (kept) trace entry
  assert.deepEqual(res.trace.map((s) => s.step.replace(/: \+\d$/, "")), [1, 2, 3, 4, 5].map((id) => `Phase of Test ${id} (#${id})`));
  assert.ok(progress.includes("Phase of Test 4 (#4)"));
  for (const [id, h] of p) {
    const got = res.config.skills[id].rotation;
    const own = sim.rotation(h);
    assert.ok([0, 1, 2, 3, 4].some((s) => shiftRotation(own, s).join() === got.join()), `#${id}: ${got} is a shift of ${own}`);
    assert.equal(res.config.skills[id].passive, h.passiveSelect);
  }
  const kept = res.trace.filter((s) => s.change !== "kept");
  for (const s of kept) assert.match(s.change, /^shift [1-4]: /);
  // known case: the Bard's Inspirational Song one turn later doubles the win rate (20 % -> 40 % on these seeds)
  const bard = res.trace.find((s) => s.step.startsWith("Phase of Test 5"))!;
  assert.equal(bard.step, "Phase of Test 5 (#5): +4");
  assert.ok(bard.after >= bard.before + 5 && bard.change.startsWith("shift 4: Basic / Inspirational Song"), bard.change);
});

test("layout steps honour a stop and restore the phase being tried", () => {
  const rotations = { 4: [1, 2, 0, 0, 0] };
  const p = layoutPool(rotations);
  const rot4 = sim.rotation(p.get(4)!).join();
  let n = 0;
  const res = optimiseFight(sim, p, { quest: 61 }, { startParty: START, nQuick: 4, nFinal: 4, steps: { ...ONLY, order: true, phase: true } },
    { onProgress: (_d, _t, s) => void (s.startsWith("Phase") && n++), shouldStop: () => n >= 3 });
  assert.equal(res.stopped, true);
  assert.equal(sim.rotation(p.get(4)!).join(), rot4);
  assert.ok(res.trace.some((s) => s.step === "Order within rows"));
});

test("lock: locked heroes stay in the party found, wherever the layout steps put them", () => {
  // unlocked, the party step drops the level-5 Berserker (#2) on this quest
  const free = optimiseFight(sim, layoutPool(), { quest: 61 }, { size: 3, nQuick: 6, nFinal: 6, maxRounds: 1,
    steps: { ...ONLY, party: true } });
  const ids = (r: typeof free) => [...r.config.party.front, ...r.config.party.back].filter((x) => x !== null);
  assert.ok(!ids(free).includes(2));
  const res = optimiseFight(sim, layoutPool(), { quest: 61 }, { size: 3, lock: [2], nQuick: 6, nFinal: 6, maxRounds: 1,
    steps: { ...ONLY, party: true, order: true, swap: true } });
  assert.ok(ids(res).includes(2));
  assert.equal(ids(res).length, 3);
  // a starting party without the locked hero: the party step adds it even when that scores lower
  const added = optimiseFight(sim, layoutPool(), { quest: 61 }, { startParty: { front: [1, 3, null], back: [4, 5, null] },
    lock: [2], nQuick: 6, nFinal: 6, maxRounds: 1, steps: { ...ONLY, party: true } });
  assert.ok(ids(added).includes(2));
  assert.throws(() => optimiseFight(sim, layoutPool(), { quest: 61 }, { startParty: START, lock: [9] }), /not in the pool/);
  assert.throws(() => optimiseFight(sim, layoutPool(), { quest: 61 }, { startParty: { front: [null, 1], back: [] }, lock: [2], steps: ONLY }),
    /locked heroes not in the starting party/);
});

test("quest amount: parties the game would not offer the amount to are skipped, not fatal", () => {
  // prestige 1 heroes are offered amount 1 only; one prestige-2 hero makes amount 3 available to the party
  const mk = () => new Map<number, ReturnType<typeof sim.hero>>([
    [1, sim.hero(raw(1, 1, 20))], [2, sim.hero(raw(2, 5, 20))], [3, sim.hero({ ...raw(3, 2, 18), prestigeLevel: 2 })]]);
  const res = optimiseFight(sim, mk(), { quest: 3, amount: 3 }, { size: 2, nQuick: 4, nFinal: 4, maxRounds: 1 });
  const ids = [...res.config.party.front, ...res.config.party.back].filter((x) => x !== null);
  assert.ok(ids.includes(3), `the prestige-2 hero makes the party valid: ${ids}`);
  for (const s of res.trace) assert.ok(Number.isFinite(s.after), s.step);
  // an invalid starting party is replaced; a pool with no valid party at all reports it
  const fixed = optimiseFight(sim, mk(), { quest: 3, amount: 3 }, { startParty: { front: [1], back: [2] }, size: 2, nQuick: 4, nFinal: 4,
    maxRounds: 1, steps: { ...ONLY, party: true } });
  assert.ok([...fixed.config.party.front, ...fixed.config.party.back].includes(3));
  const low = new Map([...mk()].filter(([id]) => id !== 3));
  assert.throws(() => optimiseFight(sim, low, { quest: 3, amount: 3 }, { size: 2, nQuick: 4, nFinal: 4, maxRounds: 1 }),
    /no party could be formed/);
});
