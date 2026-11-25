/**
 * Farming review, second batch (docs/tooling/roadmap/review-farming.md): event bosses grouped apart and unticked
 * (F22), the fold summaries (F12), quest XP by the save's mode and the value tooltip's mode note (F19), the map row's
 * craft + run tooltip (F20), the setup signature behind the "rank again" note (F23), the "random offer" tag (F07).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { Sim } from "../src/tools/engine.ts";
import { farmingReport } from "../src/tools/farming.ts";
import { gameFromData } from "../src/tools/gamedata.ts";
import { Solver } from "../src/tools/profit.ts";
import { farmQuestIds, isEventQuest, questGroups, tickedByDefault } from "../src/ui/farming-party.ts";
import { foldSummary, RANDOM_OFFER, setupSignature, timeTip, valueHelp } from "../src/ui/farming-view.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const solver = new Solver(gameFromData()).solve();
const idOf = (name: string) => Number(Object.keys(G.questData).find((id) => G.questData[id].name === name));

test("F22: event bosses (questType 6) get their own group, last, and start unticked", () => {
  const ids = farmQuestIds();
  const events = ids.filter(isEventQuest);
  assert.ok(events.length >= 4, `event bosses offered: ${events.length}`);
  for (const name of ["Galam", "Cragus", "Odin", "Faust"]) {
    assert.ok(events.some((id) => String(G.questData[id].name).includes(name)), `${name} is an event boss`);
  }
  const groups = questGroups(ids);
  const last = groups[groups.length - 1];
  assert.equal(last.label, "Event");
  assert.deepEqual(last.ids, events);
  for (const g of groups.slice(0, -1)) {
    assert.match(g.label, /^Lvl \d+–\d+$/);
    assert.ok(!g.ids.some(isEventQuest), `${g.label} holds no event boss`);
  }
  assert.equal(groups.reduce((n, g) => n + g.ids.length, 0), ids.length, "every quest in one group");
  for (const id of events) assert.equal(tickedByDefault(id, Number(G.questData[id].levelReq) || 0), false);
  const goliath = idOf("Glacial Goliath");
  assert.equal(tickedByDefault(goliath, 60), true);
  assert.equal(tickedByDefault(goliath, 30), false, "above the party");
  assert.equal(tickedByDefault(goliath, 70), false, "more than 12 levels under the party");
  assert.deepEqual(questGroups([]), []);
});

test("F12: fold summaries", () => {
  assert.equal(foldSummary("Quests", 12), "Quests · 12 ticked");
  assert.equal(foldSummary("Catalog maps", 0), "Catalog maps · 0 ticked");
});

test("F07: the rare-quest tag", () => {
  assert.equal(RANDOM_OFFER, "random offer");
});

test("F19: quest XP follows the save's mode; the value tooltip says when prices stay Standard", () => {
  // a level-20 tier-2 hero (under its tier's cap) alone against the first quest: won every time in both modes
  const raw = {
    id: 1, heroID: 1, name: "Test", class: 1, level: 20, exp: 0, prestigeLevel: 2, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: ["3|3|3|1|0|0|A10B2C5D1|0|A0B0C0|0"],
  };
  const q = farmQuestIds().find((id) => !G.questData[id].party && (Number(G.questData[id].levelReq) || 0) <= 1)!;
  const xp = (mode: string) => {
    const sim = new Sim(mode);
    const [r] = farmingReport(sim, { front: [sim.hero(raw), null, null], back: [null, null, null] }, [{ kind: "quest", quest: q }], { n: 5, solver });
    assert.equal(r.win, 1, `${mode}: won`);
    assert.ok(r.xp_per_run > 0);
    return r.xp_per_run;
  };
  const std = xp("Standard");
  assert.ok(Math.abs(xp("Legendary") / std - 2) < 1e-9, "Legendary: x2");
  assert.ok(Math.abs(xp("Quick") / std - 4) < 1e-9, "Quick: x4");
  new Sim("Standard");
  assert.doesNotMatch(valueHelp("Standard"), /Standard mode/);
  assert.doesNotMatch(valueHelp(), /Standard mode/);
  assert.match(valueHelp("Legendary"), /Prices follow Standard mode, not Legendary\.$/);
});

test("F20: a map row's time splits into craft and run", () => {
  assert.equal(timeTip({ kind: "map", craft_h: 2, run_h: 0.5 }), "Craft 2 h + run 30 min");
  assert.equal(timeTip({ kind: "quest", craft_h: 0, run_h: 0.5 }), undefined);
  assert.equal(timeTip({ kind: "map", craft_h: 0, run_h: 0.5 }), undefined);
});

test("F23: the setup signature changes with the party or the sources, not with their order", () => {
  const base = { slots: { front0: 0, front1: 1, back0: null }, excluded: {}, sources: ["quest:1", "cat:22:0"], scrolls: ["", "60", ""], n: 40, mapRuns: 30 };
  const sig = setupSignature(base);
  assert.equal(setupSignature({ ...base, sources: ["cat:22:0", "quest:1"] }), sig);
  assert.equal(setupSignature({ ...base, excluded: { back0: true } }), sig, "an empty slot ticked out changes nothing");
  assert.notEqual(setupSignature({ ...base, excluded: { front1: true } }), sig);
  assert.notEqual(setupSignature({ ...base, slots: { front0: 1, front1: 0 } }), sig);
  assert.notEqual(setupSignature({ ...base, sources: ["quest:1"] }), sig);
  assert.notEqual(setupSignature({ ...base, sources: [...base.sources, "rare"] }), sig);
  assert.notEqual(setupSignature({ ...base, scrolls: ["61", "", ""] }), sig);
  assert.notEqual(setupSignature({ ...base, mapRuns: 10 }), sig);
});
