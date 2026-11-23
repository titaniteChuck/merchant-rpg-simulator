/** Offline warm start (warmstart.ts, warmstart-build.ts) and its use in searchSkills: game data only, CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { searchSkills } from "../src/tools/combat.ts";
import { standardHero } from "../src/tools/classes.ts";
import { Sim } from "../src/tools/engine.ts";
import { loadTimelines } from "../src/tools/schedule.ts";
import { warmJobs, warmStartEntry } from "../src/tools/warmstart-build.ts";
import { loadWarmStart, warmKey, warmStart, type WarmStartData } from "../src/tools/warmstart.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
loadTimelines(JSON.parse(readFileSync(new URL("../../inventory/timelines.json", import.meta.url), "utf8")));
const committed: WarmStartData = JSON.parse(readFileSync(new URL("../../inventory/warmstart.json", import.meta.url), "utf8"));
const sim = new Sim("Standard");

test("the committed table covers every class x tier x enemy, and an entry is what the build gives today", () => {
  const jobs = warmJobs();
  assert.equal(Object.keys(committed.entries).length, jobs.length);
  for (const j of jobs) assert.ok(committed.entries[warmKey(j.classId, j.tier, j.quest, j.rare)], `${j.classId}:${j.tier}:${j.quest}`);
  // two entries rebuilt (npm run export:warmstart to refresh the file)
  for (const j of [jobs.find((x) => x.classId === 5 && x.tier === 3 && x.quest === 3)!, jobs.find((x) => x.classId === 1 && x.tier === 1 && x.quest === 50)!]) {
    const [k, e] = warmStartEntry(sim, j);
    assert.deepEqual(e, committed.entries[k], k);
  }
});

test("lookup: exact entry, else the same class and enemy at the nearest tier", () => {
  const e = { rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"], passive: "None", win: 1, peak: 1, turns: 3 };
  loadWarmStart({ version: 1, params: {}, entries: { [warmKey(1, 3, 2)]: e } });
  assert.deepEqual(warmStart(1, 3, 2), e);
  assert.deepEqual(warmStart(1, 1, 2), e, "tier 1 falls back to tier 3");
  assert.equal(warmStart(1, 3, 2, true), undefined, "rare is its own entry");
  assert.equal(warmStart(2, 3, 2), undefined);
});

test("searchSkills tries the warm-start rotation and keeps it as a finalist", () => {
  const h = standardHero(sim, 1, 30, 1, "best");
  const rot = ["Slash", "Basic", "Slash", "Basic", "Basic"];
  loadWarmStart({ version: 1, params: {}, entries: { [warmKey(1, 1, 3)]: { rotation: rot, passive: h.passiveSelect, win: 1, peak: 1, turns: 1 } } });
  const r = searchSkills(sim, h, [h], [], { quest: 3 }, { nQuick: 2, nFinal: 3, top: 1, prefilter: 2 });
  assert.deepEqual(r.warm, { rotation: rot, passive: h.passiveSelect });
  assert.ok(r.ranked.some((x) => x.rotation.join() === rot.join()));
  const off = searchSkills(sim, h, [h], [], { quest: 3 }, { nQuick: 2, nFinal: 3, top: 1, prefilter: 2, warmStart: false });
  assert.equal(off.warm, undefined);
  // a skill the hero has not unlocked becomes Basic (adapted)
  loadWarmStart({ version: 1, params: {}, entries: { [warmKey(1, 1, 3)]: { rotation: ["Taunt", "Basic", "Basic", "Basic", "Basic"], passive: "None", win: 1, peak: 1, turns: 1 } } });
  const low = standardHero(sim, 1, 5, 1, "best");
  const lw = searchSkills(sim, low, [low], [], { quest: 3 }, { nQuick: 2, nFinal: 3, top: 1, prefilter: 2 }).warm;
  assert.deepEqual([lw?.rotation, lw?.adapted], [["Basic", "Basic", "Basic", "Basic", "Basic"], true], "a locked skill becomes Basic");
});
