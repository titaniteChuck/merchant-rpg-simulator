/** Skill probe, enemy timelines and the counter-schedule score (skill-probe.ts, schedule.ts): game data only, CI runs it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { current } from "../src/sim/battle.ts";
import { hooks } from "../src/sim/combatant.ts";
import { Sim } from "../src/tools/engine.ts";
import { buildTimelines, probeHeroSkill } from "../src/tools/skill-probe.ts";
import {
  DAMAGE_ONLY, enemyTimeline, loadTimelines, raceOutcome, scheduleContext, scoreSchedule, skillProfile, skillTags, spearman,
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

test("effect durations in hero and enemy actions (lastsHeroActions / lastsEnemyActions)", () => {
  // Murlok Monarch slot 5, Ancient Mist: Eva↑ turns 4 on the enemy itself (ticked at the end of its cast) = 3 enemy
  // actions but 4 hero actions; Acc↓ turns 3 on the heroes = 3 of their actions. Tidal Wave: turns 4 = 4 hero actions
  // (the game's description says 3).
  const [eva, acc] = enemyTimeline(92).slots[4].effects;
  assert.deepEqual([eva.name, eva.facingTurns, eva.lastsHeroActions, eva.lastsEnemyActions], ["Ancient Mist Eva↑", [1, 2, 3, 4], 4, 3]);
  assert.deepEqual([acc.name, acc.ownerTurns, acc.lastsHeroActions, acc.lastsEnemyActions], ["Ancient Mist Acc↓", [1, 2, 3], 3, 3]);
  const tw = enemyTimeline(92).slots[0].effects[0];
  assert.deepEqual([tw.turns, tw.lastsHeroActions, tw.lastsEnemyActions], [4, 4, 4]);
  // every enemy effect that lasts `turns`, whatever the turn order: on the heroes, `turns` actions of each side; on
  // the enemy itself, `turns` hero actions and `turns` − 1 enemy actions
  for (const t of Object.values(committed.timelines) as ReturnType<typeof enemyTimeline>[]) {
    for (const s of t.slots) for (const e of s.effects) {
      if (e.until !== "turns") continue;
      const exp = e.on === "heroes" ? [e.turns, e.turns] : [e.turns, e.turns! - 1];
      assert.deepEqual([e.lastsHeroActions, e.lastsEnemyActions], exp, `${t.quest}${t.rare ? "B" : ""} ${s.name} ${e.name}`);
    }
  }
});

test("Ancient Mist windows match a real fight (engine stats per hero action)", () => {
  const heroes = [1, 2, 3, 4, 5, 6].map((id) => sim.hero({
    id, heroID: id, name: `H${id}`, class: 1, level: 60, exp: 0, prestigeLevel: 3, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  }));
  const h1 = heroes[0];
  const rows: { turn: number; acc: number; eva: number }[] = [];
  let first = true;
  const prev = { ...hooks }; // api.ts's own hooks (skill damage stats): keep them running
  hooks.beforeAction = (c) => {
    const b = current.battle!;
    if (first) { // nobody dies: the fight runs past turn 15
      b.enemy.questHP = b.enemy.maxHP = 1e8;
      for (const h of heroes) h.questHP = h.maxHP = 1e8;
      first = false;
    }
    return { turn: b.turns, prev: prev.beforeAction?.(c) };
  };
  hooks.afterAction = (c, n, before) => {
    prev.afterAction?.(c, n, before.prev);
    if (c === h1) rows.push({ turn: before.turn, acc: h1.acc, eva: current.battle!.enemy.eva });
  };
  try {
    sim.fight(92, [heroes[1], heroes[3], heroes[5]], [heroes[0], heroes[2], heroes[4]], { seed: 7 });
  } finally {
    Object.assign(hooks, prev);
  }
  // cast on turn 10 (slot 5, enemy last): hero acc halved on turns 11-13, enemy eva up on turns 11-14
  const at = (t: number) => rows.find((r) => r.turn === t)!;
  const [acc0, eva0] = [at(10).acc, at(10).eva];
  assert.deepEqual([11, 12, 13, 14].map((t) => at(t).acc < acc0), [true, true, true, false]);
  assert.deepEqual([11, 12, 13, 14, 15].map((t) => at(t).eva > eva0), [true, true, true, true, false]);
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
  assert.ok(pre.counts.orderings <= 13, "per ranking (schedule, damage only): top 3 orderings + best of the top 3 sets; + current");
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

test("death and revive race: a hero falls, a revive brings it back, area damage is not redistributed", () => {
  const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  // front hero 2 takes 40 % HP per cycle (all targeted), back hero 1 takes 10 % (area); both deal 10 % of the enemy
  const inc = m({ 1: 10, 2: 40 }), tgt = m({ 2: 40 }), dealt = m({ 1: 10, 2: 10 });
  const none = raceOutcome([1, 2], inc, tgt, dealt, new Map(), new Map());
  assert.ok(none.deaths >= 1 && !none.won, "the front hero falls; its targeted damage then hits the back hero");
  const rev = raceOutcome([1, 2], inc, tgt, dealt, new Map(), m({ 1: 1 }));
  assert.ok(rev.revives >= 1, "the back hero's Revive brings the front hero back");
  assert.ok(rev.won || rev.enemyLeft < none.enemyLeft);
  // area damage of a dead hero vanishes instead of moving: with no targeted damage, the back hero's HP drops slower
  const area = raceOutcome([1, 2], inc, new Map(), dealt, new Map(), new Map());
  assert.ok(area.cycles >= none.cycles);
  // a revive with nobody dead is wasted
  assert.equal(raceOutcome([1, 2], m({ 1: 1, 2: 1 }), new Map(), dealt, new Map(), m({ 1: 2 })).revives, 0);
  // heals keep a hero up: 40 % taken, 40 % healed by hero 1
  const healed = raceOutcome([1, 2], inc, tgt, dealt, new Map([["1>2", 40]]), new Map());
  assert.equal(healed.deaths, 0);
  assert.ok(healed.won);
});

test("taunt: the next enemy attack hits the taunter alone", () => {
  const mk = (cls: number, id: number) => sim.hero({
    id, heroID: id, name: `T${id}`, class: cls, level: 60, exp: 0, prestigeLevel: 3, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const a = mk(1, 1), b = mk(1, 2);
  const ctx = scheduleContext(50, [a, b], []);
  const tl = enemyTimeline(50);
  const s = scoreSchedule([{ location: 2, rotation: ["Taunt", "Basic", "Basic", "Basic", "Basic"] }, { location: 4, rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"] }], tl, {}, ctx);
  assert.ok(s.notes.some((n) => n.why.startsWith("taunted") && n.location === 2));
  const inc = (l: number) => s.race!.heroes.find((x) => x.location === l)!.incoming;
  assert.ok(inc(2) > inc(4), "the taunter takes more");
});

test("forced actions: Drown turns the planned skill into Basic in the score itself, not just the notes", () => {
  // Murlok Monarch slot 3: Drown (acting last) forces every hero's next 2 actions to Basic: turns 4 and 5
  const mm = enemyTimeline(92);
  const drown = mm.slots[2];
  assert.deepEqual([drown.name, drown.effects[0].kind, drown.effects[0].ownerTurns], ["Drown", "force-action", [1, 2]]);
  const mage = (rot: string[]) => [{ location: 1, rotation: rot }];
  const basic = scoreSchedule(mage(["Basic", "Basic", "Basic", "Basic", "Basic"]), mm, DAMAGE_ONLY);
  const drowned = scoreSchedule(mage(["Basic", "Basic", "Basic", "Mind Blast II", "Mind Blast II"]), mm, DAMAGE_ONLY);
  const free = scoreSchedule(mage(["Mind Blast II", "Mind Blast II", "Basic", "Basic", "Basic"]), mm, DAMAGE_ONLY);
  // the drowned turns score as Basic (the same as all Basic); the same skills before Drown score more
  assert.deepEqual(drowned.perTurn, basic.perTurn);
  assert.ok(free.total > drowned.total, `${free.total} > ${drowned.total}`);
  assert.ok(drowned.notes.some((n) => n.turn === 4 && n.skill === "Basic" && n.why.includes("forced to Basic by Drown (planned Mind Blast II)")));
  // with stats (the HP race): the hero's damage on turns 4 and 5 is a Basic's
  const h = sim.hero({
    id: 1, heroID: 1, name: "T", class: 3, level: 40, exp: 0, prestigeLevel: 1, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const ctx = scheduleContext(92, [], [h]);
  const dealt = (rot: string[]) => scoreSchedule(mage(rot), mm, {}, ctx).race!.dealt;
  assert.equal(dealt(["Basic", "Basic", "Basic", "Mind Blast II", "Basic"]), dealt(["Basic", "Basic", "Basic", "Basic", "Basic"]));
  assert.ok(dealt(["Mind Blast II", "Basic", "Basic", "Basic", "Basic"]) > dealt(["Basic", "Basic", "Basic", "Mind Blast II", "Basic"]));
  assert.deepEqual(scoreSchedule(mage(["Slash", "Basic", "Basic", "Mind Blast II", "Slash"]), mm).played[1], ["Slash", "Basic", "Basic", "Basic", "Basic"]);
});

test("pre-filter: orderings that play the same under Drown count once (the one planning Basic there)", async () => {
  const { prefilterRotations, rotations, soloRows } = await import("../src/tools/combat.ts");
  const h = sim.hero({
    id: 1, heroID: 1, name: "T", class: 4, level: 50, exp: 0, prestigeLevel: 2, hp: 300, questHP: 300,
    attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
  });
  const [front, back] = soloRows({ quest: 92 }, h);
  const info = sim.skillInfo(h);
  const sk = info.skills.slice(0, info.unlocked);
  const combos = [...rotations(sk.map((x) => x.name), sk.map((x) => x.ap), info.maxAP)];
  const pre = prefilterRotations(sim, h, front, back, { quest: 92 }, combos, 15)!;
  // Drown forces turns 4 and 5: every pick plans Basic there, and no two picks open the same way
  assert.ok(pre.picked.length > 1);
  for (const p of pre.picked) assert.deepEqual(p.slice(3), ["Basic", "Basic"], p.join());
  const openings = pre.picked.map((p) => p.slice(0, 3).join());
  assert.equal(new Set(openings).size, openings.length);
});
