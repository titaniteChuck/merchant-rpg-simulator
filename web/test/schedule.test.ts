/** Skill probe, enemy timelines and the counter-schedule score (skill-probe.ts, schedule.ts): game data only, CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { buildTimelines, probeHeroSkill } from "../src/tools/skill-probe.ts";
import {
  enemyTimeline, loadTimelines, scheduleContext, scoreSchedule, skillProfile, skillTags, spearman,
} from "../src/tools/schedule.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const committed = JSON.parse(readFileSync(new URL("../../inventory/timelines.json", import.meta.url), "utf8"));
loadTimelines(committed);
const sim = new Sim("Standard");

test("inventory/timelines.json is what the probe gives today (npm run export:timelines)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildTimelines(sim))), committed);
});

test("turn order and effect windows follow the engine", () => {
  assert.equal(enemyTimeline(72).enemyFirst, true, "Odin (questType 6) acts first");
  assert.equal(enemyTimeline(97).enemyFirst, false);
  // Archon slot 4: Soul Barrier (2 turns, enemy acts last) reflects the heroes' actions of the next two turns
  const sb = enemyTimeline(97).slots[3].effects[0];
  assert.equal(sb.kind, "reflect");
  assert.deepEqual(sb.facingTurns, [1, 2]);
  assert.equal(sb.removable, false, "cannotDispell");
  // Odin's Grand Duel reflects physical damage only, and also on its cast turn (it acts first)
  const gd = enemyTimeline(72).slots[0].effects[0];
  assert.deepEqual([gd.kind, gd.test?.physical, gd.test?.magical], ["reflect", 0, 1]);
  assert.deepEqual(gd.facingTurns, [0, 1, 2]);
  // Gnoll Khan: Stunning Blow skips every hero's next action; Bulawa Strike hits the back row's matk
  const stun = enemyTimeline(93).slots[2].effects[0];
  assert.deepEqual([stun.kind, stun.until, stun.ownerTurns], ["stun", "next-attack", [1]]);
  assert.deepEqual(enemyTimeline(93).slots[0].effects[0].locations, [1, 3, 5]);
  // Holy Shield: the whole party, until the enemy's next action
  const hs = probeHeroSkill(sim, "Holy Shield").effects[0];
  assert.deepEqual([hs.on, hs.facingTurns], ["party", [0]]);
});

test("skill tags", () => {
  assert.deepEqual(skillTags("Taunt"), ["taunt"]);
  assert.ok(skillTags("Cleanse").includes("cleanse"));
  assert.ok(skillTags("Unbreakable").includes("cleanse-self"), "Unbreakable cleanses its caster only");
  assert.ok(skillTags("Silence").includes("dispel"));
  assert.ok(skillTags("Lesser Heal").includes("heal-ally"));
  assert.ok(skillTags("Pulverize", "enemy").includes("stun"));
  assert.ok(skillTags("Retaliation", "enemy").includes("counter"));
  assert.ok(skillTags("Basic", "enemy").includes("damage-split"), "enemy Basic: shared over the front row");
  assert.ok(skillProfile("Slash II")!.power > skillProfile("Slash")!.power);
});

test("schedule score: no damage into a reflect, cleanse after the debuff", () => {
  const mage = (rot: string[]) => [{ location: 1, rotation: rot }];
  // Archon: Soul Barrier on turn 4 reflects turns 5 and 1 (offsets 1, 2): a big hit on turn 3 beats one on turn 5
  const archon = enemyTimeline(97);
  const good = scoreSchedule(mage(["Basic", "Basic", "Mind Blast II", "Basic", "Basic"]), archon);
  const bad = scoreSchedule(mage(["Basic", "Basic", "Basic", "Basic", "Mind Blast II"]), archon);
  assert.ok(good.total > bad.total, `${good.total} > ${bad.total}`);
  assert.ok(bad.notes.some((n) => n.why.includes("Soul Barrier")));
  // Demon Mage: Terrify II (turn 1, def / mdef cut on all) — a cleanse on turn 2 removes it, one on turn 1 is wasted
  const dm = enemyTimeline(50);
  const after = scoreSchedule(mage(["Basic", "Cleanse", "Basic", "Basic", "Basic"]), dm);
  const before = scoreSchedule(mage(["Cleanse", "Basic", "Basic", "Basic", "Basic"]), dm);
  assert.ok(after.total > before.total, `${after.total} > ${before.total}`);
  assert.ok(before.notes.some((n) => n.why.includes("nothing to cleanse")));
});

test("schedule context: units from real stats", () => {
  const h = sim.hero({
    id: 1, heroID: 1, name: "T", class: 1, level: 30, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const ctx = scheduleContext(3, [h], []);
  assert.ok(ctx.enemyHP > 0 && ctx.heroes[2].hit > 0 && ctx.heroes[2].maxHP > 0);
  assert.ok(scheduleContext(3, [h], [], { amount: 3 }).enemyHP === 3 * ctx.enemyHP);
  const s = scoreSchedule([{ location: 2, rotation: ["Slash", "Basic", "Basic", "Basic", "Basic"] }], enemyTimeline(3), {}, ctx);
  assert.ok(Number.isFinite(s.total) && s.perTurn.length === 5);
});

test("spearman", () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 2], [5, 5, 9]), 1);
});

test("searchSkills with the schedule pre-filter: ranks every ordering, simulates the top ones and the current rotation", async () => {
  const { searchSkills } = await import("../src/tools/combat.ts");
  const h = sim.hero({
    id: 1, heroID: 1, name: "T", class: 1, level: 30, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const rot = sim.rotation(h);
  const pre = searchSkills(sim, h, [h], [], { quest: 3 }, { nQuick: 2, nFinal: 3, top: 2, prefilter: 3 });
  assert.ok(pre.counts.prefiltered! > pre.counts.orderings, `${pre.counts.prefiltered} ranked, ${pre.counts.orderings} simulated`);
  assert.ok(pre.counts.orderings <= 7, "top 3 + damage-only top 3 + current");
  assert.ok(pre.ranked.some((r) => r.rotation.join() === rot.join()), "the current rotation is always a finalist");
  assert.deepEqual(sim.rotation(h), rot);
  const full = searchSkills(sim, h, [h], [], { quest: 3 }, { nQuick: 2, nFinal: 3, top: 2, prefilter: false });
  assert.equal(full.counts.prefiltered, undefined);
});

test("schedule score with stats: HP race, real heal sizes, split damage shared by the heroes there", () => {
  const mk = (cls: number, id: number) => sim.hero({
    id, heroID: id, name: `T${id}`, class: cls, level: 40, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const warrior = mk(1, 1), cleric = mk(5, 2);
  const ctx = scheduleContext(50, [warrior], [cleric]);
  const tl = enemyTimeline(50);
  const party = (rot: string[]) => [{ location: 2, rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"] }, { location: 1, rotation: rot }];
  const s = scoreSchedule(party(["Basic", "Basic", "Basic", "Basic", "Basic"]), tl, {}, ctx);
  assert.ok(s.race && s.race.dealt > 0 && Number.isFinite(s.race.killCycles));
  // Basic is split over the front row: alone there, the warrior takes all of it (probe: a third each of 3)
  const front = s.race.heroes.find((x) => x.location === 2)!, back = s.race.heroes.find((x) => x.location === 1)!;
  assert.ok(front.incoming > 0 && back.incoming > 0 && front.healed === 0);
  const healed = scoreSchedule(party(["Basic", "Basic", "Greater Heal", "Basic", "Basic"]), tl, {}, ctx);
  const gh = skillProfile("Greater Heal")!.healScaling!;
  const amount = gh.matk! * ctx.heroes[1].stats.matk + gh.acc! * ctx.heroes[1].stats.acc + gh.level! * 40;
  const got = healed.race!.heroes.find((x) => x.location === 2)!.healed;
  assert.ok(got > 0 && got <= (100 * amount) / ctx.heroes[2].maxHP + 1e-9, "a heal gives back at most its real size");
  // the healed front hero dies later (the kill may get slower: the heal costs a damage action)
  assert.ok(healed.race!.heroes.find((x) => x.location === 2)!.deathCycles > front.deathCycles);
});
