// Battle page v4 (U36): enemy picker groups, radar rims, the solver's shortlist, the include / size-cap rule and the
// 5-turn plan grid (battle-setup.ts, battle-plan.ts). Game data only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { enemyTimeline, loadTimelines } from "../src/tools/schedule.ts";
import { partyRules } from "../src/tools/combat.ts";
import { enemyGroups, enemyStatMax, includedSlots, isFightable, solveShortlist } from "../src/ui/battle-setup.ts";
import { compactEffect, type EnemyCell, type HeroCell, planGrid } from "../src/ui/battle-plan.ts";
import { regionOf } from "../src/ui/wiki-data.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
loadTimelines(JSON.parse(readFileSync(new URL("../../inventory/timelines.json", import.meta.url), "utf8")));

const fightable = () => Object.keys(G.questData).map(Number).filter(isFightable);

test("enemy picker: region by region, Region / Event / Map, the Map group only map bosses and map Treasure Bushes", () => {
  const groups = enemyGroups(fightable());
  // every enemy once
  assert.equal(groups.flatMap((g) => g.ids).length, fightable().length);
  // region order, then region / event / map
  for (let k = 1; k < groups.length; k++) {
    const a = groups[k - 1], b = groups[k];
    assert.ok(a.region < b.region || (a.region === b.region && a.group < b.group), `${a.label} before ${b.label}`);
  }
  const tuvale = groups.filter((g) => g.region === 1).map((g) => g.label);
  assert.deepEqual(tuvale, ["Tuvale Forest", "Tuvale Forest – Map"]);
  assert.ok(groups.some((g) => g.label === "Yarsol Cove – Event"));
  for (const g of groups.filter((x) => x.group === 2)) {
    for (const id of g.ids) {
      const q = G.questData[id];
      assert.equal(q.questType, 8, `${q.name} is map-only`);
    }
  }
  // Murlok Monarch (map boss of Yarsol) and the Treasure Bush 99 (Tuvale's maps) are in Map groups; no level bands
  const of = (id: number) => groups.find((g) => g.ids.includes(id))!.label;
  assert.equal(of(92), "Yarsol Cove – Map");
  assert.equal(of(99), "Tuvale Forest – Map");
  assert.equal(of(81), `${regionOf("enemy", 81)!.full}`);
  assert.ok(!groups.some((g) => /Level \d/.test(g.label)));
});

test("enemy radar rims: the highest value of each stat over every enemy, rare variants included", () => {
  const max = enemyStatMax();
  for (const id of fightable()) {
    const q = G.questData[id];
    for (const k of ["enemyHp", "enemyAtk", "enemyMatk", "enemyDef", "enemyMdef", "enemyEva"]) {
      assert.ok((q[k] ?? 0) <= max[k] && (q[`${k}B`] ?? 0) <= max[k], `${q.name} ${k}`);
    }
  }
  assert.ok(fightable().some((id) => G.questData[id].enemyHp === max.enemyHp || G.questData[id].enemyHpB === max.enemyHp));
});

test("solver shortlist: no 0 % result, within 25 % of the best, at most 5", () => {
  const c = (win: number, score: number) => ({ ev: { win }, score });
  const res = [c(0.95, 950000), c(0.8, 800000), c(0.7, 700000), c(0.9, 900000), c(0, 5000), c(0.72, 720000), c(0.71, 710000), c(0.75, 750000)];
  const s = solveShortlist(res);
  assert.equal(s.length, 5);
  assert.ok(s.every((x) => x.ev.win >= 0.75 * 0.95 && x.ev.win > 0));
  // the solver's order is kept
  assert.deepEqual(s.map((x) => x.ev.win), [0.95, 0.8, 0.9, 0.72, 0.75]);
  assert.deepEqual(solveShortlist([c(0, 100), c(0.0001, 90)]), []);
  // the ranking score rule: same win, a much lower score is dropped
  assert.deepEqual(solveShortlist([c(1, 1_000_000), c(1, 700_000)]).length, 1);
});

test("include rule: ticked-out heroes don't fight; over the size cap, the first in slot order (required first) are kept", () => {
  const slot = (row: "front" | "back", i: number) => ({ key: `${row}${i}`, row, i });
  const all = [slot("front", 0), slot("front", 1), slot("front", 2), slot("back", 0), slot("back", 1), slot("back", 2)];
  // Desolation Wolf: party quest, at most 3, Front 2 required
  const wolf = partyRules({ quest: 81 });
  const r = includedSlots(all, new Set(), wolf);
  assert.deepEqual(r.included.map((s) => s.key), ["front1", "back0", "front0"]);
  assert.deepEqual(r.capped.map((s) => s.key), ["back1", "back2", "front2"]);
  const r2 = includedSlots(all, new Set(["back0"]), wolf);
  assert.deepEqual(r2.included.map((s) => s.key), ["front1", "front0", "back1"]);
  // a map run takes six
  assert.equal(includedSlots(all, new Set(), partyRules({ map: { id: 1, prestigeLevel: 0, grade: 3 } })).capped.length, 0);
});

test("plan grid: Murlok Monarch, heroes then the enemy, effects with their source", () => {
  const tl = enemyTimeline(92);
  const grid = planGrid(tl, [
    { row: "front", i: 0, name: "Tank", cls: 1, rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"] },
    { row: "back", i: 0, name: "Rogue", cls: 2, rotation: ["Sunder", "Basic", "Basic", "Silence", "Basic"] },
  ]);
  assert.deepEqual(grid.columns.map((c) => c.kind === "hero" ? c.loc : "enemy"), [1, 2, "enemy"]);
  const tank = grid.columns[1].cells as HeroCell[];
  // Drown on T3 disables the heroes' T4 and T5: "[Drown] → Basic"
  assert.ok(tank[3].marks.some((m) => m.text === "[Drown] → Basic"));
  assert.ok(tank[4].marks.some((m) => m.text === "[Drown] → Basic"));
  assert.ok(tank[1].marks.some((m) => m.text === "[Tidal Wave] atk −50%"));
  const rogue = grid.columns[0].cells as HeroCell[];
  // Silence planned on T4 is forced to Basic by Drown
  assert.equal(rogue[3].planned, "Silence");
  assert.equal(rogue[3].does, "Basic");
  assert.equal(rogue[3].forcedBy, "Drown");
  const enemy = grid.columns[2].cells as EnemyCell[];
  assert.equal(enemy[0].skill, "Tidal Wave");
  assert.match(enemy[0].short, /AoE/);
  assert.match(enemy[0].short, /atk −50%/);
  // Sunder (def −40 %) on T1, over the turns the heroes act against it
  assert.ok(enemy[0].maluses.some((m) => m.text === "[Sunder] def −40%"));
  // no dispel: Silence never happens (forced to Basic)
  assert.ok(!enemy.some((c) => c.maluses.some((m) => m.text.includes("dispel"))));
  // Ancient Mist's evasion buff is still on in the next turns (own buffs, with their source)
  const mist = enemy[0].own.find((m) => m.text === "[Ancient Mist] eva +50%");
  assert.ok(mist);
  // E24: durations from the measured windows, in both sides' turns
  assert.match(mist.title, /3 enemy turns \(covers 4 hero turns\)/);
});

test("compact words for effects", () => {
  assert.deepEqual(compactEffect({ name: "x", kind: "debuff", on: "heroes", stats: { atk: -0.5 }, until: "turns", ownerTurns: [], facingTurns: [], removable: true }).short, "atk −50%");
  assert.equal(compactEffect({ name: "x", kind: "stun", on: "heroes", until: "turns", ownerTurns: [], facingTurns: [], removable: true }).short, "stun");
  assert.equal(compactEffect({ name: "x", kind: "force-action", on: "heroes", until: "turns", ownerTurns: [], facingTurns: [], removable: true }).short, "→ Basic");
});
