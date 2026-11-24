// Battle page U39: the traced fight behind the plan's timeline chart (tools/fight-trace.ts, the trace's display data in
// sim/api.ts) and the timeline data (battle-plan.ts planTimeline). Game data and the site's example save only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { fightSeed } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight, traceMapRun } from "../src/tools/fight-trace.ts";
import { assignHero, type PartyState, setRotationSkill, slotKeyOfLoc } from "../src/ui/battle-edit.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { effectName, mapRoomTabs, planTimeline, type TracedFight } from "../src/ui/battle-plan.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sv = loadSaveText(readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const hero = (i: number) => sim.hero(sv.raw.hero[i]);
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const party = () => [[hero(8), hero(0), hero(4)], [hero(5), hero(1), hero(2)]] as const;

test("traced fight: the same fight as Simulate's first one, results unchanged by the trace", () => {
  for (const q of [72, 89, 92]) {
    const [f, b] = party();
    const plain = sim.fight(q, [...f], [...b], { seed: fightSeed(1, 0) });
    const [f2, b2] = party();
    const t = traceFight(sim, q, [...f2], [...b2]);
    assert.equal(t.won, plain.won, `quest ${q} won`);
    assert.equal(t.turns, plain.turns, `quest ${q} turns`);
    // and the same again after tracing (the trace leaves nothing behind)
    const [f3, b3] = party();
    const again = sim.fight(q, [...f3], [...b3], { seed: fightSeed(1, 0) });
    assert.deepEqual([again.won, again.turns, again.enemyHP, again.heroes.map((h) => h.hp)], [plain.won, plain.turns, plain.enemyHP, plain.heroes.map((h) => h.hp)]);
  }
});

test("traced fight: one action per fighter per turn, in action order (Odin acts first), with damage, healing and effects", () => {
  const [f, b] = party();
  const t = traceFight(sim, 72, [...f], [...b]);
  const t1 = t.actions.filter((a) => a.turn === 1);
  // Odin (questType 6) first, then back 1, front 1, back 2 …
  assert.deepEqual(t1.map((a) => a.who), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(t1.map((a) => a.order), [0, 1, 2, 3, 4, 5, 6]);
  // the damage the enemy took adds up to its HP loss, healing included
  const dealt = t.actions.flatMap((a) => a.hits).filter((h) => h.who === 0);
  const lost = dealt.reduce((s, h) => s + h.dmg - h.heal, 0);
  const last = [...t.actions].reverse().find((a) => a.hits.some((h) => h.who === 0))!.hits.find((h) => h.who === 0)!;
  assert.ok(Math.abs(lost - (last.maxHP - last.hp)) <= dealt.length, `enemy HP lost ${last.maxHP - last.hp}, traced ${lost}`);
  // effects on every fighter after each action, buffs and debuffs
  assert.ok(t.actions.some((a) => a.fx.some((x) => x.who > 0 && !x.debuff)));
  assert.ok(t.actions.some((a) => a.hits.some((h) => h.heal > 0)), "a heal");
  for (const a of t.actions) for (const h of a.hits) assert.ok(h.dmg >= 0 && h.heal >= 0 && (h.dmg > 0 || h.heal > 0));
});

test("traced fight: a stunned hero's action is lost (did: false), the planned skill kept", () => {
  const [f, b] = party();
  const t = traceFight(sim, 89, [...f], [...b]); // Balor stuns
  const stunned = t.actions.filter((a) => a.did === false);
  assert.ok(stunned.length > 0);
  for (const a of stunned) assert.equal(typeof a.planned, "string");
});

test("flow data: every turn of the fight up to its end, lines in action order, HP each turn, effects merged on every hero", () => {
  const [f, b] = party();
  const t = traceFight(sim, 72, [...f], [...b]); // Odin: lost on turn 14
  const tl = planTimeline(t, [1, 2, 3, 4, 5, 6]);
  assert.equal(tl.won, false);
  assert.equal(tl.capped, false);
  assert.equal(tl.lastTurn, t.turns);
  // every turn, 1 to the end, none skipped
  assert.deepEqual(tl.turns.map((x) => x.turn), Array.from({ length: t.turns }, (_, k) => k + 1));
  assert.ok(t.turns > 10, "a fight longer than two rounds");
  // turns 1-5 are the rotation, a new 5-turn round every 5 turns
  assert.deepEqual(tl.turns.map((x) => x.rotation), tl.turns.map((x) => x.turn <= 5));
  assert.deepEqual(tl.turns.map((x) => x.round), tl.turns.map((x) => Math.floor((x.turn - 1) / 5)));
  // Odin first, then the heroes still standing, in order
  assert.deepEqual(tl.turns[0].lines.map((l) => l.who), [0, 1, 2, 3, 4, 5, 6]);
  for (const x of tl.turns) {
    const order = x.lines.map((l) => l.who);
    assert.equal(order[0], 0);
    assert.ok(order.every((w, k) => k === 0 || w > order[k - 1]), `turn ${x.turn}: ${order}`);
  }
  // every fighter's HP at the end of every turn; a hero who fell stays at 0 or less, and its KO is marked once
  for (const x of tl.turns) for (const w of [0, 1, 2, 3, 4, 5, 6]) assert.ok(x.hp[w] && x.hp[w].maxHP > 0, `turn ${x.turn} fighter ${w}`);
  const last = tl.turns[tl.turns.length - 1];
  const down = [1, 2, 3, 4, 5, 6].filter((w) => last.hp[w].hp <= 0);
  assert.equal(down.length, 6, "lost: every hero is down at the end");
  const kos = tl.turns.flatMap((x) => x.lines.flatMap((l) => Object.entries(l.cells).filter(([, c]) => c.ko).map(([w]) => Number(w))));
  assert.deepEqual([...kos].sort(), [...new Set(kos)].sort(), "one KO per fighter");
  assert.deepEqual(new Set(kos), new Set(down));
  // the damage of an action is in the column of whoever took it
  const t1 = tl.turns[0];
  assert.ok(t1.lines.find((l) => l.who === 3)!.cells[0].dmg > 0); // Mind Blast II on Odin
  // a party buff on every hero at the end of turn 1 is one shared chip, not six
  assert.ok(t1.shared.length > 0);
  for (const c of t1.shared) {
    assert.equal(c.who, -1);
    for (let w = 1; w <= 6; w++) assert.ok(!(t1.status[w] ?? []).some((x) => x.name === c.name), `${c.name} not repeated on ${w}`);
  }
  // effects with no turn left don't show
  for (const x of tl.turns) for (const chips of Object.values(x.status)) for (const c of chips) assert.ok(c.turns === undefined || c.turns > 0);
});

test("flow data: a short fight ends where it ends, won", () => {
  const [f, b] = party();
  const t = traceFight(sim, 92, [...f], [...b]); // Murlok Monarch falls on turn 1
  const tl = planTimeline(t, [1, 2, 3, 4, 5, 6]);
  assert.equal(tl.won, true);
  assert.equal(tl.lastTurn, 1);
  assert.equal(tl.turns.length, 1);
  assert.ok(tl.turns[0].hp[0].hp <= 0);
});

test("map run flow: the room bar lists the battles in map order, the boss last, each from its real start state", () => {
  const [f, b] = party();
  const spec = { id: 1, prestigeLevel: 0, grade: 3 };
  const rooms = traceMapRun(sim, spec, [...f], [...b]);
  // the same run as the Map run mode's first one
  const [f2, b2] = party();
  const run = sim.mapRun(spec, [...f2], [...b2], fightSeed(1, 0));
  assert.deepEqual(rooms.map((r) => [r.name, r.isRare, r.status]), run.combats.map((c) => [c.name, c.isRare, c.status]));
  const tabs = mapRoomTabs(rooms);
  assert.equal(tabs.length, run.combats.length);
  assert.deepEqual(tabs.map((x) => x.index), tabs.map((_, k) => k));
  tabs.slice(0, -1).forEach((x, k) => assert.equal(x.label, `${k + 1} · ${run.combats[k].name}`));
  assert.equal(tabs[tabs.length - 1].label, `Boss · ${run.combats[run.combats.length - 1].name}`);
  assert.ok(tabs[tabs.length - 1].boss && tabs.slice(0, -1).every((x) => !x.boss));
  // each fought room has its own fight, from turn 1; HP carries over: a later room starts below full when a hero was hit
  const fought = rooms.filter((r) => r.trace);
  assert.ok(fought.length >= 2);
  for (const r of fought) assert.equal(r.trace!.actions[0].turn, 1);
  // the run's own state carries over: each room's fight shows the six heroes' HP from its first action on
  for (const r of fought) assert.equal(r.trace!.actions[0].life.filter((x) => x.who > 0).length, 6);
  // each room's flow covers its whole fight
  for (const r of fought) assert.equal(planTimeline(r.trace!, [1, 2, 3, 4, 5, 6]).turns.length, r.trace!.turns);
  // rooms not reached have no fight
  for (const r of rooms) assert.equal(r.trace === null, r.status === 0);
});

test("shared state: an edit in the flow is the Party tab's edit (hero swap, rotation slot), and the rules hold", () => {
  const s: PartyState = { slots: { front0: 3, front1: 5, back0: 7 }, skills: {}, locked: {}, excluded: { front0: true } };
  // the flow's column at Front 2 (location 4) takes hero 9: the Party tab's slot front1 changes
  assert.equal(slotKeyOfLoc(4), "front1");
  assert.equal(slotKeyOfLoc(1), "back0");
  assert.equal(slotKeyOfLoc(6), "front2");
  assignHero(s, slotKeyOfLoc(4), 9);
  assert.equal(s.slots.front1, 9);
  // a hero stands in one slot only: picking Back 1's hero for Front 1 empties Back 1
  assignHero(s, slotKeyOfLoc(2), 7);
  assert.equal(s.slots.front0, 7);
  assert.equal(s.slots.back0, null);
  assert.equal(s.excluded.front0, undefined, "the new hero fights");
  // in a search mode, a hero picked by hand is locked; emptying unlocks
  assignHero(s, "back1", 2, true);
  assert.equal(s.locked.back1, true);
  assignHero(s, "back1", null, true);
  assert.equal(s.locked.back1, undefined);
  // rotation slot 3 of hero 9 from the flow: the Party tab's rotation of hero 9 changes, the rest kept
  setRotationSkill(s, 9, 2, "Sunder", { attackList: ["Basic", "Taunt", "Basic", "Basic", "Basic"], passive: "Tough" });
  assert.deepEqual(s.skills[9], { attackList: ["Basic", "Taunt", "Sunder", "Basic", "Basic"], passive: "Tough" });
  // and again on top of it (the Party tab's edit reads the same state)
  setRotationSkill(s, 9, 0, "Slash", s.skills[9]);
  assert.deepEqual(s.skills[9].attackList, ["Slash", "Taunt", "Sunder", "Basic", "Basic"]);
});

test("shared state round trip: the flow's rotation edit changes the simulated fight", () => {
  // Hero 0 (Warrior) alone at Front 1 against Desolation Wolf … with a rotation of Basic only, then Shield Slam II in slot 1
  const s: PartyState = { slots: {}, skills: {}, locked: {}, excluded: {} };
  assignHero(s, slotKeyOfLoc(4), 8);
  assignHero(s, slotKeyOfLoc(2), 0);
  const fightOf = () => {
    const front = [0, 1, 2].map((i) => {
      const idx = s.slots[`front${i}`];
      if (idx === null || idx === undefined) return null;
      const h = sim.hero(sv.raw.hero[idx]);
      if (s.skills[idx]) sim.setSkills(h, s.skills[idx].attackList, s.skills[idx].passive);
      return h;
    });
    return traceFight(sim, 81, front, [null, null, null]);
  };
  setRotationSkill(s, 0, 0, "Basic", { attackList: ["Basic", "Basic", "Basic", "Basic", "Basic"] });
  const before = fightOf();
  assert.equal(before.actions.find((a) => a.turn === 1 && a.who === 2)!.planned, "Basic");
  const skill = sim.skillInfo(sim.hero(sv.raw.hero[0])).skills[0].name;
  setRotationSkill(s, 0, 0, skill, s.skills[0]);
  const after = fightOf();
  assert.equal(after.actions.find((a) => a.turn === 1 && a.who === 2)!.planned, skill);
});

test("timeline data: new effects and recasts land as dots on their fighter, KO, stun and forced actions kept", () => {
  const fx = (who: number, name: string, turns: number, debuff = false) => ({ who, name, debuff, turns });
  const trace: TracedFight = {
    won: false, turns: 2,
    actions: [
      { turn: 1, who: 2, planned: "Taunt", did: "Taunt", misses: 0, hits: [], fx: [fx(0, "Taunt", 2, true)] },
      { turn: 1, who: 0, planned: "Drown", did: "Drown", misses: 0, hits: [{ who: 2, dmg: 500, heal: 0, hp: -10 }], fx: [fx(0, "Taunt", 1, true), fx(4, "Drown", 2, true)] },
      { turn: 2, who: 4, planned: "Sunder", did: "Basic", misses: 1, hits: [], fx: [fx(0, "Taunt", 1, true), fx(4, "Drown", 1, true)] },
      { turn: 2, who: 0, planned: "Tidal Wave", did: false, misses: 0, hits: [{ who: 4, dmg: 0, heal: 120, hp: 300 }], fx: [fx(0, "Taunt", 3, true), fx(4, "Drown", 0, true)] },
    ],
  };
  const tl = planTimeline(trace, [2, 4]);
  const [l1, l2] = tl.turns[0].lines!;
  assert.deepEqual(l1.cells[0].added.map((c) => c.name), ["Taunt"]);
  assert.equal(l2.cells[2].dmg, 500);
  assert.equal(l2.cells[2].ko, true);
  assert.deepEqual(l2.cells[4].added.map((c) => c.name), ["Drown"]);
  // KO only on the hit that takes the fighter down, not on hits after it
  const after = planTimeline({ won: true, turns: 1, actions: [
    { turn: 1, who: 1, planned: "Basic", did: "Basic", misses: 0, hits: [{ who: 0, dmg: 50, heal: 0, hp: -20 }], fx: [] },
    { turn: 1, who: 2, planned: "Basic", did: "Basic", misses: 0, hits: [{ who: 0, dmg: 40, heal: 0, hp: -60 }], fx: [] },
  ] }, [1, 2]).turns[0].lines!;
  assert.deepEqual(after.map((l) => l.cells[0].ko), [true, false]);
  assert.equal(l2.cells[0], undefined, "Taunt ticking down is not new");
  const [m1, m2] = tl.turns[1].lines!;
  assert.equal(m1.did, "Basic");
  assert.equal(m1.planned, "Sunder");
  assert.equal(m1.misses, 1);
  assert.equal(m2.did, false);
  assert.deepEqual(m2.cells[0].added.map((c) => c.name), ["Taunt"], "a recast (more turns left) is new again");
  assert.equal(m2.cells[4].heal, 120);
  // end of turn 2: Drown has no turn left, Taunt has 3
  assert.equal(tl.turns[1].status[4], undefined);
  assert.deepEqual(tl.turns[1].status[0].map((c) => [c.name, c.turns, c.debuff]), [["Taunt", 3, true]]);
  assert.match(tl.turns[1].status[0][0].title, /Taunt on the enemy: debuff, 3 turns left/);
  // one hero only: nothing is "on every hero"
  assert.deepEqual(tl.turns[0].shared, []);
  // effect names keep their suffix
  assert.equal(effectName("Ancient Mist Eva↑"), "Ancient Mist Eva↑");
});
