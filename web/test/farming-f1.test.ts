/**
 * Farming review, first batch (docs/tooling/roadmap/review-farming.md): legal parties per source (F01), the shared
 * party kept whole (F02), revive gold in the cost (F03), the quest list (F04, F05). On the example save and a made-up
 * hero, so CI runs it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport, type FarmSource } from "../src/tools/farming.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { Solver } from "../src/tools/profit.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { farmQuestIds, fightingSlots, MAX_HERO_LEVEL, readStoredParty, storedPartyWith } from "../src/ui/farming-party.ts";
import { PLACEHOLDER_QUEST_IDS } from "../src/ui/wiki-data.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sv = loadSaveText(readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8"));
const sim = new Sim("Standard");
const solver = new Solver(gameFromData()).solve();
const idOf = (name: string) => Number(Object.keys(G.questData).find((id) => G.questData[id].name === name));
const GOLIATH = idOf("Glacial Goliath"), HOARFROST = idOf("Hoarfrost Gathering");

// the page's default party: the six highest-level heroes, front then back
const SLOTS: Record<string, number> = { front0: 0, front1: 1, front2: 2, back0: 3, back1: 4, back2: 5 };
const heroes = [0, 1, 2, 3, 4, 5].map((i) => sim.hero(sv.raw.hero[i]));
const FRONT = heroes.slice(0, 3), BACK = heroes.slice(3);
const only = (keys: string[]) => ({
  front: FRONT.map((h, i) => (keys.includes(`front${i}`) ? h : null)),
  back: BACK.map((h, i) => (keys.includes(`back${i}`) ? h : null)),
});

test("the quests used here have the rules the review names", () => {
  assert.equal(G.questData[GOLIATH].party, true);
  assert.equal(G.questData[GOLIATH].questSize, 2);
  assert.ok(!G.questData[HOARFROST].party, "Hoarfrost Gathering is a solo quest");
});

test("F01: Glacial Goliath is fought by 2 heroes, Front 2 first, then the game's slot order (as the Battle page)", () => {
  const keys = fightingSlots({ kind: "quest", quest: GOLIATH }, SLOTS);
  assert.deepEqual(keys, ["front1", "back0"]);
  // a hero ticked out on the Simulator is skipped: the next in slot order fights
  assert.deepEqual(fightingSlots({ kind: "quest", quest: GOLIATH }, SLOTS, { back0: true }), ["front1", "front0"]);
  // Front 2 empty: the game wouldn't start it
  const { front1: _, ...noFront2 } = SLOTS;
  const p = fightingSlots({ kind: "quest", quest: GOLIATH }, noFront2);
  assert.ok(!Array.isArray(p) && /Front 2/.test(p.problem), JSON.stringify(p));

  const src: FarmSource[] = [{ kind: "quest", quest: GOLIATH }];
  const [legal] = farmingReport(sim, { front: FRONT, back: BACK }, src, { n: 8, solver, partyFor: () => only(keys as string[]) });
  assert.equal(legal.blocked, undefined);
  assert.equal(legal.n, 8);
  assert.deepEqual(farmingReport(sim, only(keys as string[]), src, { n: 8, solver }), [legal], "the same as a 2-hero party");
  // the whole party of 6 is over the cap: a can't-start row, no figures
  const [six] = farmingReport(sim, { front: FRONT, back: BACK }, src, { n: 8, solver });
  assert.match(six.blocked ?? "", /at most 2 heroes/);
  assert.equal(six.n, 0);
  assert.equal(six.value_per_hour, 0);
});

test("F01: a solo quest is fought by the Front 1 hero alone, else it can't start", () => {
  const src: FarmSource = { kind: "quest", quest: HOARFROST };
  assert.deepEqual(fightingSlots(src, SLOTS), ["front0"]);
  const out = fightingSlots(src, SLOTS, { front0: true });
  assert.ok(!Array.isArray(out) && /solo quest/.test(out.problem), JSON.stringify(out));
  const [six, solo, told] = farmingReport(sim, { front: FRONT, back: BACK }, [src, src, src], {
    n: 6, solver, partyFor: (_s, i) => (i === 0 ? { front: FRONT, back: BACK } : i === 1 ? only(["front0"]) : "Put a hero in Front 1."),
  });
  assert.match(six.blocked ?? "", /solo quest/);
  assert.equal(solo.blocked, undefined);
  assert.ok(solo.win > 0 && solo.time_h > 0);
  assert.equal(told.blocked, "Put a hero in Front 1.");
  // map runs: any layout of up to 6
  assert.deepEqual(fightingSlots({ kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }, SLOTS, { back2: true }),
    ["back0", "front0", "back1", "front1", "front2"]);
});

test("F03: revive gold is part of the run's cost and comes off gold/h and value/h", () => {
  // a level-20 hero alone in Front 2 against the level-52 Glacial Goliath loses: every hero dies, 20 x 10 x tier 2 gold a run
  const weak = sim.hero({
    id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 2, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
  });
  const [r] = farmingReport(sim, { front: [null, weak, null], back: [null, null, null] }, [{ kind: "quest", quest: GOLIATH }], { n: 5, solver });
  assert.equal(r.win, 0);
  assert.equal(r.revive_gold, 400);
  assert.equal(r.cost.revive, 400);
  assert.equal(r.cost.total, r.cost.gold + r.cost.map + r.cost.scrolls + 400);
  assert.ok(Math.abs(r.gold_per_hour - (r.loot_value - r.cost.total) / r.time_h) < 1e-6);
  assert.ok(Math.abs(r.value_per_hour - (r.loot_value + r.essence_value - r.cost.total) / r.time_h) < 1e-6);
});

test("F04, F05: no placeholder, no map boss or Treasure Bush, nothing over level 60 in the quest list", () => {
  const ids = farmQuestIds();
  assert.ok(ids.includes(GOLIATH) && ids.includes(HOARFROST));
  for (const id of ids) {
    const q = G.questData[id];
    assert.ok(!PLACEHOLDER_QUEST_IDS.has(id), `placeholder ${id} ${q.name}`);
    assert.notEqual(q.questType, 8, `map-only ${id} ${q.name}`);
    assert.ok((q.levelReq ?? 0) <= MAX_HERO_LEVEL, `${q.name} is level ${q.levelReq}`);
    assert.doesNotMatch(String(q.name), /^(Region \d|Weekly \d)/);
  }
  for (const id of PLACEHOLDER_QUEST_IDS) assert.ok(!ids.includes(id));
  assert.ok(!ids.some((id) => G.questData[id].name === "Treasure Bush"));
  assert.ok(!farmQuestIds((id) => id !== GOLIATH).includes(GOLIATH), "the visibility filter applies");
});

test("F02: an edit here keeps the Battle page's ticked-out heroes (and an old `locked`, U50 migrates it)", () => {
  const stored = JSON.stringify({ slots: { front0: 0, front1: 1, back0: 9 }, skills: { 1: { attackList: ["Basic"] }, 40: { attackList: [] } },
    locked: { front0: true, back0: false }, excluded: { front1: true } });
  const p = readStoredParty(stored, 6)!;
  assert.deepEqual(p.slots, { front0: 0, front1: 1 }, "a hero index this save doesn't have is dropped");
  assert.deepEqual(Object.keys(p.skills), ["1"]);
  assert.equal("locked" in p, false);
  assert.deepEqual(p.excluded, { front1: true });
  const next = storedPartyWith(JSON.parse(stored), { ...p.slots, front2: 4 }, p.skills);
  assert.deepEqual(next.slots, { front0: 0, front1: 1, front2: 4 });
  assert.deepEqual((next as unknown as { locked: unknown }).locked, { front0: true, back0: false }, "other stored fields kept");
  assert.deepEqual(next.excluded, { front1: true });
  assert.deepEqual(storedPartyWith(null, {}, {}), { excluded: {}, slots: {}, skills: {} });
  assert.equal(readStoredParty(null, 6), null);
  // the ticked-out hero doesn't fight
  assert.deepEqual(fightingSlots({ kind: "map", map: { id: 1, prestigeLevel: 0, grade: 3 } }, next.slots, next.excluded), ["front0", "front2"]);
});
