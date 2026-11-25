// Battle page U40: the Flow tab's calculations (each damage and heal recomputed from the values the engine recorded),
// effects as text from their live values, hits on a fallen fighter, the AP limit on edits, rooms skipped after the
// party died in a map run, and the tab order. Game data and the site's example save only, CI runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { hooks } from "../src/sim/combatant.ts";
import { mathRound } from "../src/sim/lua.ts";
import { fightSeed } from "../src/tools/combat.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { type ApBudget, apRefusal, apUsed, assignHeroChecked, editRotationSkill, type PartyState } from "../src/ui/battle-edit.ts";
import { calcView, effectText, evalLine } from "../src/ui/battle-calc.ts";
import { mapRoomTabs, planTimeline } from "../src/ui/battle-plan.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const sv = loadSaveText(readFileSync(new URL("../../site/data/example-save.txt", import.meta.url), "utf8"));
const sim = new Sim(sv.raw.gameMode || "Standard");
const hero = (i: number) => sim.hero(sv.raw.hero[i]);
/** Six level-60 heroes of the example save: front Paladin, Warrior, Berserker; back Cleric, Mage, Bard. */
const party = () => [[hero(8), hero(0), hero(4)], [hero(5), hero(1), hero(2)]] as const;
const QUESTS = [39, 53, 55, 70, 72, 74, 88, 89, 92];

test("tracing changes no result, and the calc recording is off outside a trace", () => {
  for (const q of QUESTS) {
    const [f, b] = party();
    const plain = sim.fight(q, [...f], [...b], { seed: fightSeed(1, 0) });
    const [f2, b2] = party();
    const t = traceFight(sim, q, [...f2], [...b2]);
    assert.equal(hooks.calc, undefined, "no sink once the trace stops");
    assert.deepEqual([t.won, t.turns], [plain.won, plain.turns], `quest ${q}`);
    const [f3, b3] = party();
    const again = sim.fight(q, [...f3], [...b3], { seed: fightSeed(1, 0) });
    assert.deepEqual([again.enemyHP, again.heroes.map((h) => h.hp)], [plain.enemyHP, plain.heroes.map((h) => h.hp)]);
  }
});

test("every hit and heal recomputes exactly from its recorded parts, and the formula ends on the number shown", () => {
  let hits = 0, heals = 0;
  for (const q of QUESTS) {
    const [f, b] = party();
    const t = traceFight(sim, q, [...f], [...b]);
    for (const a of t.actions) {
      for (const h of a.hits) {
        let dmg = 0, heal = 0;
        for (const c of h.calc ?? []) {
          if (c.kind === "dmg") {
            if (c.missed) continue;
            hits++;
            const u = c.used!, m = c.dmgMod!;
            // the game's own steps: each part × crit or luck × the target's reduction, rounded
            assert.equal(mathRound(c.defRed! * u.atk * m), c.raw!.p);
            assert.equal(mathRound(c.mdefRed! * u.matk * m), c.raw!.m);
            assert.equal(mathRound(u.dmg * (c.luck ? m : 1)), c.raw!.t);
            const fin = c.final!;
            assert.equal(c.total, c.received.length ? mathRound(fin.p + fin.m + fin.t) : c.raw!.p + c.raw!.m + c.raw!.t);
            // the stages chain: what arrived × the share = what the on-damage effects got
            if (c.ratio !== undefined && !c.onDamage.length) assert.equal(c.arrived.atk * c.ratio, u.atk);
            if (c.base && !c.onAttack.length) assert.deepEqual(c.base, c.arrived);
            assert.equal(c.hpAfter, c.hpBefore - c.total);
            // the displayed formula: each line's terms evaluate to its value, the steps before "=" to the game's result
            const v = calcView(c, (w) => `F${w}`);
            for (const l of v.lines) {
              assert.equal(evalLine(l.terms), l.value);
              const k = l.terms.findIndex((x) => x.op === "=");
              const pre = evalLine(l.terms.slice(0, k));
              assert.ok(Math.abs(pre - l.terms[k].v) <= 0.5 + 1e-6 * Math.max(1, pre), `${v.head}: ${pre} → ${l.terms[k].v}`);
              for (const x of l.terms) assert.ok(x.tip.length > 0, `a tooltip on ${x.text}`);
            }
            assert.equal(v.lines.reduce((s2, l) => s2 + l.value, 0) === c.total || v.notes.some((n) => n.startsWith("Total")), true);
            dmg += v.shown;
          } else {
            heals++;
            assert.equal(c.total, c.isPercent ? mathRound(c.maxHP * c.amount) : mathRound(c.amount));
            const v = calcView(c, (w) => `F${w}`);
            assert.equal(evalLine(v.lines[0].terms), v.shown);
            heal += v.shown;
          }
        }
        // the numbers on the page are the sums of their calculations
        assert.equal(dmg, h.dmg, `quest ${q} turn ${a.turn}: damage`);
        assert.equal(heal, h.heal, `quest ${q} turn ${a.turn}: healing`);
      }
    }
  }
  assert.ok(hits > 500 && heals > 20, `${hits} hits, ${heals} heals`);
});

test("a skill's base reads as stat × multiplier: ATK × 1.6 for Slash, the attacker's ATK as it was", () => {
  const [f, b] = party();
  const t = traceFight(sim, 53, [...f], [...b]);
  const slash = t.actions.flatMap((a) => a.hits).flatMap((h) => h.calc ?? []).find((c) => c.kind === "dmg" && c.src === "Vicious Strike" && !c.missed);
  assert.ok(slash && slash.kind === "dmg");
  const line = calcView(slash, () => "x").lines[0];
  assert.match(line.terms[0].text, /^ATK /);
  assert.equal(line.terms[0].v, slash.stat!.atk);
  assert.deepEqual([line.terms[1].op, line.terms[1].v], ["×", 1.6]);
  assert.match(line.terms.find((x) => x.kind === "def")!.text, /DEF/);
});

test("hits on a fallen enemy are 'no target': counted apart, not as damage; the KO once", () => {
  const [f, b] = party();
  const t = traceFight(sim, 92, [...f], [...b]); // Murlok Monarch falls on turn 1, the rest of the turn still plays
  assert.equal(t.won, true);
  const onEnemy = t.actions.flatMap((a) => a.hits.filter((h) => h.who === 0));
  assert.equal(onEnemy.filter((h) => h.ko).length, 1);
  const ko = onEnemy.findIndex((h) => h.ko);
  const after = onEnemy.slice(ko + 1);
  assert.ok(after.length > 0, "the game plays the turn's last actions on the fallen enemy");
  for (const h of after) {
    assert.equal(h.dmg, 0);
    assert.ok(h.deadHits! > 0 && h.deadDmg! > 0);
    for (const c of h.calc!) if (c.kind === "dmg" && !c.missed) assert.equal(calcView(c, () => "x").void, true);
  }
  const tl = planTimeline(t, [1, 2, 3, 4, 5, 6]);
  const cells = tl.turns[0].lines.map((l) => l.cells[0]).filter(Boolean);
  assert.equal(cells.filter((c) => c.ko).length, 1);
  assert.ok(cells.some((c) => c.deadHits > 0 && c.dmg === 0));
});

test("effects as text from their live values: Enraged grows as the Berserker is hit, Amplify Magic doubles a debuff", () => {
  const [f, b] = party();
  const t = traceFight(sim, 72, [...f], [...b]);
  const enraged = t.actions.flatMap((a) => a.fx).filter((x) => x.name === "Enraged").map((x) => x.stats!.atk);
  assert.ok(Math.max(...enraged) > 0.6 + 1e-9, "Enraged above its cast value");
  assert.ok(t.actions.flatMap((a) => a.fx).some((x) => x.name === "Enraged" && x.skill === "Enrage" && x.from === 6));
  // Sunder (−40% Def) on the enemy, then Amplify Magic: −80%
  const rogue = sim.hero(sv.raw.hero[7]);
  sim.setSkills(rogue, ["Sunder", "Basic", "Basic", "Basic", "Basic"]);
  const mage = sim.hero(sv.raw.hero[1]);
  sim.setSkills(mage, ["Basic", "Amplify Magic", "Basic", "Basic", "Basic"]);
  const t2 = traceFight(sim, 72, [hero(8), rogue, null], [mage, null, null]);
  const sunder = t2.actions.flatMap((a) => a.fx.filter((x) => x.name === "Sunder").map((x) => ({ ...x, turn: a.turn, did: a.did })));
  assert.equal(effectText(sunder[0]), "−40% Def");
  const amp = sunder.find((x) => x.amp)!;
  assert.equal(effectText(amp), "−80% Def");
  // the flow shows the stronger debuff landing on the Amplify Magic line, "<skill> from <fighter>" on hover
  const tl = planTimeline(t2, [1, 2, 4], (w) => ["Enemy", "Mage", "Paladin", "", "Rogue"][w]);
  const line = tl.turns.flatMap((x) => x.lines).find((l) => l.did === "Amplify Magic")!;
  const landed = line.cells[0].added.find((c) => c.name === "Sunder")!;
  assert.equal(landed.label, "−80% Def");
  assert.match(landed.title, /^Sunder from Rogue/);
  // text for the effects whose work is code
  assert.equal(effectText({ name: "Taunt", debuff: true, trigger: "OnAttack" }), "Taunt");
  assert.equal(effectText({ name: "Holy Blessing", debuff: false, turns: 3, trigger: "OnTurn", stats: { mdef: 0.4, atk: 0.15 } }), "+40% MDef +15% Atk");
  assert.equal(effectText({ name: "Mortal Wound", debuff: true, turns: 0, trigger: "DamageReceived", stats: { physicalDamage: 1.25, magicDamage: 1.25, trueDamage: 1.25 } }), "+25% Dmg taken");
  assert.equal(effectText({ name: "Mana Shield", debuff: false, turns: 3, trigger: "DamageReceived", absorb: 340 }), "Shield 340");
  assert.equal(effectText({ name: "Poison", debuff: true, turns: 2, trigger: "DamageOnTurn", stats: { atk: 0, matk: 1234.5, crit: 0 } }), "1,235 MAtk/turn");
});

test("AP limit: an edit that takes a hero over is refused and the state stays the same", () => {
  const b: ApBudget = { cost: (s) => ({ Slash: 6, Enrage: 8, "Slash II": 10 } as Record<string, number>)[s] ?? 0, max: 20 };
  const s: PartyState = { slots: { front0: 4 }, skills: { 4: { attackList: ["Slash", "Enrage", "Basic", "Basic", "Basic"] } }, excluded: {} };
  const before = structuredClone(s);
  const r = editRotationSkill(s, 4, 2, "Slash II", s.skills[4], b); // 6 + 8 + 10 = 24 > 20
  assert.deepEqual(r, { ok: false, used: 24, max: 20 });
  assert.deepEqual(s, before, "refused: nothing changed");
  assert.equal(apRefusal("Berserker", r.used, r.max), "Berserker: 24 / 20 AP. Change refused.");
  // within the limit: done
  assert.equal(editRotationSkill(s, 4, 2, "Slash", s.skills[4], b).ok, true);
  assert.deepEqual(s.skills[4].attackList, ["Slash", "Enrage", "Slash", "Basic", "Basic"]);
  assert.equal(apUsed(s.skills[4].attackList, b), 20);
  // a rotation already over (an old saved party) can still be lowered, not raised
  const over: PartyState = { slots: {}, skills: { 1: { attackList: ["Slash II", "Slash II", "Slash II", "Basic", "Basic"] } }, excluded: {} };
  assert.equal(editRotationSkill(over, 1, 3, "Slash", over.skills[1], b).ok, false);
  assert.equal(editRotationSkill(over, 1, 0, "Basic", over.skills[1], b).ok, true);
  // a hero whose rotation is over can't be put in a slot
  const p: PartyState = { slots: { front1: 2 }, skills: {}, excluded: {} };
  const pb = structuredClone(p);
  assert.equal(assignHeroChecked(p, "front1", 3, { used: 30, max: 20 }).ok, false);
  assert.deepEqual(p, pb);
  assert.equal(assignHeroChecked(p, "front1", 3, null).ok, true);
  assert.equal(p.slots.front1, 3);
});

test("map run: the rooms after the party died are skipped (no battle)", () => {
  const room = (status: number, boss = false) => ({ questId: 1, name: "X", isRare: false, boss, status });
  assert.deepEqual(mapRoomTabs([room(1), room(2), room(0), room(0, true)]).map((x) => x.skipped), [false, false, true, true]);
  assert.deepEqual(mapRoomTabs([room(1), room(1), room(0, true)]).map((x) => x.skipped), [false, false, false]);
});

test("step 3: the Party tab comes first, Flow second, Party selected without a remembered tab", () => {
  const html = readFileSync(new URL("../../site/battle.html", import.meta.url), "utf8");
  const party = html.indexOf('id="tab-party"'), flow = html.indexOf('id="tab-flow1"'); // U58: Flow 1 · 2 · 3
  assert.ok(party > 0 && flow > party);
  assert.match(html, /id="tab-party"[^>]*aria-selected="true"/);
  assert.match(html, /id="flow-panel"[^>]*hidden/);
  const ui = readFileSync(new URL("../src/ui/battle-page.ts", import.meta.url), "utf8");
  // U58: per page, through parseTab (Party unless a Flow was remembered)
  assert.match(ui, /parseTab\(sessionStorage\.getItem\(tabKey\(\)\)\)/);
});
