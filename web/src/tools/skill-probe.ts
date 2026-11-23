/**
 * Skill probe: casts one skill in a controlled battle and records what it actually does (attacks, heals, effects,
 * cleanses) and how long each effect stays on its owner, measured in battle turns. Source of the effect tags and
 * enemy timelines (schedule.ts, inventory/timelines.json).
 *
 * Set-up: a full party of 6 identical heroes (level 60, tier 3, 1e9 HP so nobody dies) against the quest's own enemy
 * (or quest 1 for hero skills). Every other action is a no-op (`false` in the rotation, which the game skips but still
 * ticks effects on), so an effect's window is exactly what its `turns` and trigger give. One test debuff and one test
 * buff are put on each side first, so cleanses and dispels show; a hero-skill probe also has one dead hero (revives).
 *
 * The probe patches Combatant methods while it runs and restores them; it is synchronous, so worker-safe.
 */
import { abilityFunc } from "../sim/abilities/index.ts";
import { Battle, current, hasFirstAttack } from "../sim/battle.ts";
import { Combatant } from "../sim/combatant.ts";
import { G } from "../sim/data.ts";
import { enemyAttackList } from "../sim/defaults.ts";
import { random, randomseed } from "../sim/lua.ts";
import type { Sim } from "./engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type SkillTag =
  | "damage-single" | "damage-split" | "damage-row" | "damage-aoe"
  | "heal-self" | "heal-ally" | "heal-party" | "heal-over-time" | "revive"
  | "cleanse" | "cleanse-self" | "dispel" | "buff-self" | "buff-party" | "debuff-enemy" | "debuff-party" | "dot"
  | "stun" | "force-action" | "shield" | "reflect" | "counter" | "taunt" | "stat-swap" | "amplify" | "miss-chance";

export type EffectKind =
  | "buff" | "debuff" | "dot" | "hot" | "stun" | "force-action" | "shield" | "reflect" | "counter" | "taunt"
  | "stat-swap" | "vulnerability" | "miss-chance";

export interface EffectInfo {
  name: string;
  kind: EffectKind;
  /** Owner relative to the caster: itself, its side (party / heroes) or the other side (enemy / heroes). */
  on: "self" | "party" | "enemy" | "heroes";
  /** Party locations that got it (1-6; back row odd, front row even) when heroes own it. */
  locations?: number[];
  stats?: Record<string, number>;
  turns?: number;
  trigger?: string;
  /** How it ends: after `turns` owner actions, at the next hit / attack, never, or when cast again (toggle). */
  until: "turns" | "next-hit" | "next-attack" | "permanent" | "toggle";
  /** Battle turns (0 = the cast turn) in which the owner acts with the effect on. */
  ownerTurns: number[];
  /** Battle turns in which the other side acts while the effect is on the owner. */
  facingTurns: number[];
  /** Removed by a cleanse (debuffs on heroes) or a dispel (buffs on the enemy). */
  removable: boolean;
  /** For damage filters (shield, reflect...): what a test attack did against the owner, relative to no effect. */
  test?: { physical: number; magical: number; reflected: boolean };
}

export interface SkillProfile {
  name: string;
  side: "hero" | "enemy";
  tags: SkillTag[];
  /**
   * Raw damage (atk + matk + true, before defences) per target hit, over the caster's Basic attack. Hero skills: for
   * a caster with every stat equal (from `scaling`; %-of-enemy-HP extras like Berserk Smash's are left out).
   */
  power: number;
  /** Hero skills: raw damage (all hits) per point of each caster stat; Basic is { atk: 1, matk: 1 }. */
  scaling?: Partial<Record<(typeof SCALE_STATS)[number], number>>;
  /** Hero skills: direct heal per hero healed, as a linear function of the caster (stats, level, constant). */
  healScaling?: Partial<Record<(typeof SCALE_STATS)[number] | "level" | "const", number>>;
  /** Hero skills: extra damage on a crit, as a share of the enemy's current HP (Berserk Smash: 0.03). */
  critHpPct?: number;
  /** Share of the raw damage that is physical (atk), magical (matk) and true (dmg). */
  mix?: { physical: number; magical: number; true: number };
  /** Party locations an enemy skill hit (1-6). */
  hits?: number[];
  effects: EffectInfo[];
}

export interface EnemyTimeline {
  quest: number;
  name: string;
  rare: boolean;
  questType: number;
  /** questType 6: the enemy acts before the heroes every turn. */
  enemyFirst: boolean;
  /** Slots 1-5 (index 0 = slot 1): what the enemy does on turns k, k + 5, ... */
  slots: SkillProfile[];
}

interface Rec {
  turn: number;
  actor?: Combatant;
  events: { turn: number; actor?: Combatant; kind: string; target: Any; data: Any }[];
  acts: { turn: number; actor: Combatant; present: Map<Combatant, Set<string>> }[];
}

const PROBE_DEBUFF = "__probe_debuff", PROBE_BUFF = "__probe_buff";
const isProbe = (n: string) => n === PROBE_DEBUFF || n === PROBE_BUFF;

/** Effects still active at the start of the owner's action (the game removes `turns <= 0` and flagged ones first). */
const activeAtOwnAction = (e: Any) => !e.remove && !(e.turns !== undefined && e.turns !== null && e.turns <= 0);

function instrument(rec: Rec, all: () => Combatant[]): () => void {
  const P = Combatant.prototype as Any;
  const orig = {
    determineAction: P.determineAction, receiveAttack: P.receiveAttack, receiveHeal: P.receiveHeal,
    addEffect: P.addEffect, removeAllEffects: P.removeAllEffects, amplifyEffects: P.amplifyEffects,
  };
  P.determineAction = function (this: Any, t: number) {
    const present = new Map<Combatant, Set<string>>();
    for (const c of all()) {
      present.set(c, new Set((c.effectList as Any[]).filter((e) => (c === this ? activeAtOwnAction(e) : !e.remove)).map((e) => e.name)));
    }
    rec.acts.push({ turn: rec.turn, actor: this, present });
    const prev = rec.actor;
    rec.actor = this;
    try {
      return orig.determineAction.call(this, t);
    } finally {
      rec.actor = prev;
    }
  };
  const log = (kind: string, target: Any, data: Any) => rec.events.push({ turn: rec.turn, actor: rec.actor, kind, target, data });
  P.receiveAttack = function (this: Any, attack: Any) {
    const mod = attack.damageRatio ? attack.damageRatio[this.partyLocation] : 1;
    log("attack", this, {
      mod, atk: attack.atk ?? 0, matk: attack.matk ?? 0, dmg: attack.dmg ?? 0,
      raw: (attack.atk ?? 0) + (attack.matk ?? 0) + (attack.dmg ?? 0), isDot: Boolean(attack.isDot), source: attack.damageSource,
    });
    return orig.receiveAttack.call(this, attack);
  };
  P.receiveHeal = function (this: Any, amount: number, revive?: boolean, overload?: boolean, isPercent?: boolean) {
    // a heal-over-time tick (HealingOnTurn, end of the owner's action) is not the skill's direct heal
    const tick = (this.effectList as Any[]).some((x) => x.trigger === "HealingOnTurn" && x.heal === amount);
    log("heal", this, { amount, revive: Boolean(revive), tick });
    return orig.receiveHeal.call(this, amount, revive, overload, isPercent);
  };
  P.addEffect = function (this: Any, params: Any) {
    log("effect", this, { ...params, stats: params.stats ? { ...params.stats } : undefined });
    return orig.addEffect.call(this, params);
  };
  P.removeAllEffects = function (this: Any, debuffOnly?: boolean, isSpell?: boolean) {
    const before = (this.effectList as Any[]).map((e) => e.name);
    const r = orig.removeAllEffects.call(this, debuffOnly, isSpell);
    const after = new Set((this.effectList as Any[]).map((e) => e.name));
    log("removeAll", this, { debuffOnly, removed: before.filter((n) => !after.has(n)) });
    return r;
  };
  P.amplifyEffects = function (this: Any, isDebuffs: Any, modifier: number) {
    log("amplify", this, { isDebuffs, modifier });
    return orig.amplifyEffects.call(this, isDebuffs, modifier);
  };
  return () => Object.assign(P, orig);
}

const NOOP = () => [undefined, false, false, false, false, false];

function dummyParty(sim: Sim): Any[] {
  return [1, 2, 3, 4, 5, 6].map((id) => {
    const h = sim.hero({
      id, heroID: id, name: `Probe ${id}`, class: 1, level: 60, exp: 0, prestigeLevel: 3, hp: 300, questHP: 300,
      attackList: [0, 0, 0, 0, 0], campaignID: -1, questListID: -1, heroInventory: [],
    });
    h.hp = 1e6 + id; // nobody dies; distinct, so lowest-HP targeting (Execute) picks one hero
    // no AP check: the probe puts any skill (and no-op slots) in the rotation
    h.calculateAPRemainder = () => {};
    h.attackList = NOOP();
    return h;
  });
}

/** Battle with heroes by party location (1-6): back row 1, 3, 5; front row 2, 4, 6. */
function newBattle(heroes: Any[], quest: number, rare: boolean): Battle {
  const front = [undefined, heroes[1], heroes[3], heroes[5]], back = [undefined, heroes[0], heroes[2], heroes[4]];
  const b = new Battle({ questID: quest, frontRow: front, backRow: back, isRare: rare, amount: 1 });
  b.setup();
  b.enemy.attackList = NOOP();
  b.determineTurnOrder();
  return b;
}

const seed = (c: Combatant) => {
  // an inert stat: real ones would shift the fight (and enemies have no accPct, so acc would turn NaN)
  c.addEffect({ name: PROBE_DEBUFF, debuff: true, turns: 99, stats: { _probe: 0 } });
  c.addEffect({ name: PROBE_BUFF, turns: 99, stats: { _probe: 0 } });
};

interface Cast {
  battle: Battle;
  rec: Rec;
  caster: Combatant;
  heroes: Any[];
  castTurn: number;
}

/** Runs `battle` from turn 1 to castTurn + after; the caster's slot is cleared after its cast. */
function run(battle: Battle, caster: Combatant, slot: number, castTurn: number, after: number | "cast", all: () => Combatant[]): Rec {
  const rec: Rec = { turn: 0, events: [], acts: [] };
  const restore = instrument(rec, all);
  const prev = current.battle;
  current.battle = battle;
  try {
    for (let t = 1; t <= castTurn + (after === "cast" ? 0 : after); t++) {
      rec.turn = t;
      battle.turns = t;
      for (let a = 0; a < battle.turnOrder.length; a++) {
        battle.runAction(a);
        if (after === "cast" && t === castTurn && battle.turnOrder[a] === caster) return rec;
      }
      if (t === castTurn) caster.attackList[slot] = false;
    }
  } finally {
    restore();
    current.battle = prev;
  }
  return rec;
}

/** Caster stats fixed for the damage scaling probe (effects on the caster are then ignored). */
const SCALE_STATS = ["atk", "matk", "acc", "def", "mdef"] as const;

function heroSkillCast(sim: Sim, name: string, after: number | "cast" = 7, stats?: Record<string, number>): Cast {
  const heroes = dummyParty(sim);
  if (stats) {
    heroes[0].determineStats = function (this: Any) {
      Object.assign(this, { crit: 0, critMod: 2, lckMod: 0, eva: 0, maxHP: 1e7 }, stats);
    };
  }
  const battle = newBattle(heroes, 1, false);
  battle.enemy.questHP = battle.enemy.maxHP = 1e9;
  const caster = heroes[0]; // back 1 (location 1), acts first among heroes
  for (const h of heroes) seed(h);
  seed(battle.enemy);
  const dead = heroes[5]; // front 3, dead: for revives
  dead.questHP = 0;
  dead.isDead = true;
  caster.attackList[1] = name;
  const all = () => [...heroes, battle.enemy];
  return { battle, rec: run(battle, caster, 1, 1, after, all), caster, heroes, castTurn: 1 };
}

function enemySkillCast(sim: Sim, quest: number, rare: boolean, slot: number, name: string, after: number | "cast" = 7): Cast {
  const heroes = dummyParty(sim);
  const battle = newBattle(heroes, quest, rare);
  for (const h of heroes) seed(h);
  seed(battle.enemy);
  battle.enemy.questHP = Math.round(battle.enemy.maxHP / 2); // room for self-heals
  battle.enemy.attackList[slot] = name;
  const all = () => [...heroes, battle.enemy];
  return { battle, rec: run(battle, battle.enemy, slot, slot, after, all), caster: battle.enemy, heroes, castTurn: slot };
}

/** Raw damage of the caster's plain Basic attack (the power unit). */
const basicRaw = (c: Combatant) => (c.atk ?? 0) + (c.matk ?? 0);

/** Source text tells a damage filter that strikes back (sendAttack) from one that only reduces. */
const fnText = (f: unknown) => (typeof f === "function" ? f.toString() : "");

function effectKind(p: Any, ownSide: boolean, heroCaster: boolean): EffectKind {
  const src = fnText(p.dmgFunc) + fnText(p.statFunc) + fnText(p.triggerFunc);
  if (p.trigger === "HealingOnTurn") return "hot";
  if (p.trigger === "DamageOnTurn") return "dot";
  if (p.trigger === "OnDetermineAction") {
    const r = p.triggerFunc?.(undefined, "Basic");
    return r === false ? "stun" : "force-action";
  }
  if (p.statFunc && /\.(atk|def)\s*=\s*\w+\.(matk|mdef)/.test(src)) return "stat-swap";
  if (p.trigger === "OnDamage" || p.trigger === "DamageReceived") {
    if (/sendAttack/.test(src)) return /attacker/.test(src) ? "counter" : "reflect";
    if (!ownSide) return "vulnerability";
    const st = p.stats ? Object.values<number>(p.stats) : [];
    if (st.some((v) => v > 1) && !st.some((v) => v < 1)) return "buff"; // Enrage-like: grows when hit
    return "shield";
  }
  if (p.trigger === "OnAttack") {
    if (!ownSide && heroCaster && /damageRatio/.test(src)) return "taunt";
    if (!ownSide && /return false/.test(src)) return "miss-chance";
    return ownSide ? "buff" : "debuff";
  }
  if (!ownSide) return "debuff";
  if (p.debuff) return "debuff";
  const st = p.stats ? Object.values<number>(p.stats).filter((v) => typeof v === "number") : [];
  if (st.length && st.every((v) => v < 0)) return "debuff"; // a drawback on your own side (Peaceful Respite)
  return "buff";
}

/** A test hit on the owner (physical, then magical), on a fresh copy of the cast, to measure a damage filter. */
function damageTest(make: (after: number | "cast") => Cast, ownerIsEnemy: boolean, effectName: string): NonNullable<EffectInfo["test"]> {
  // averaged over 20 seeds: some filters roll (Elusion: 50 % hit chance) and counters can miss
  const hit = (kind: "atk" | "matk", withEffect: boolean) => {
    let taken = 0, back = 0;
    for (let sd = 1; sd <= 20; sd++) {
      const c = make("cast");
      const owner = ownerIsEnemy ? c.battle.enemy
        : c.heroes.find((h: Any) => h.effectList.some((e: Any) => e.name === effectName)) ?? c.heroes[1];
      if (!withEffect) owner.effectList = owner.effectList.filter((e: Any) => e.name !== effectName);
      const attacker = ownerIsEnemy ? c.heroes[1] : c.battle.enemy;
      attacker.effectList = [];
      attacker.determineStats(true);
      const hpOwner = owner.questHP, hpAttacker = attacker.questHP;
      randomseed(sd);
      for (let k = 0; k < 5; k++) random(); // small seeds give small first rolls (Park-Miller)
      const params: Any = { [kind]: 1000, hitChance: 100, crit: 0, luck: 0 };
      params[kind === "atk" ? "matk" : "atk"] = 0;
      if (!ownerIsEnemy) {
        params.damageRatio = [0, 0, 0, 0, 0, 0, 0];
        params.damageRatio[owner.partyLocation] = 1;
      }
      attacker.sendAttack(params);
      taken += hpOwner - owner.questHP;
      back += hpAttacker - attacker.questHP;
    }
    return { taken, back };
  };
  const p0 = hit("atk", false), p1 = hit("atk", true), m0 = hit("matk", false), m1 = hit("matk", true);
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) / 100 : 1);
  return { physical: ratio(p1.taken, p0.taken), magical: ratio(m1.taken, m0.taken), reflected: p1.back > 0 || m1.back > 0 };
}

function profile(cast: Cast, name: string, side: "hero" | "enemy", make: (after: number | "cast") => Cast): SkillProfile {
  const { rec, caster, heroes, castTurn, battle } = cast;
  const heroCaster = side === "hero";
  const isHero = (c: Any) => heroes.includes(c);
  const sameSide = (c: Any) => (heroCaster ? isHero(c) : c === battle.enemy);
  const during = rec.events.filter((e) => e.turn === castTurn && e.actor === caster);
  const tags = new Set<SkillTag>();
  // damage
  const hits = during.filter((e) => e.kind === "attack" && !e.data.isDot && !sameSide(e.target) && e.data.mod > 0);
  let power = 0;
  const hitLocs = new Set<number>();
  const mix = { physical: 0, magical: 0, true: 0 };
  for (const h of hits) {
    mix.physical += h.data.atk;
    mix.magical += h.data.matk;
    mix.true += h.data.dmg;
    power += (h.data.raw * h.data.mod) / Math.max(basicRaw(caster), 1);
    if (isHero(h.target)) hitLocs.add(h.target.partyLocation);
  }
  if (hits.length) {
    if (heroCaster) tags.add("damage-single");
    else {
      const locs = [...hitLocs], mods = hits.map((h) => h.data.mod);
      if (locs.length >= 6) tags.add("damage-aoe");
      else if (locs.length === 1) tags.add("damage-single");
      else if (mods.some((m) => m < 1)) tags.add("damage-split");
      else tags.add("damage-row");
    }
    power /= heroCaster ? 1 : Math.max(hitLocs.size, 1);
  }
  // heals
  const heals = during.filter((e) => e.kind === "heal" && sameSide(e.target) && !e.data.tick);
  if (heals.some((e) => e.data.revive)) tags.add("revive");
  const healed = new Set(heals.filter((e) => !e.data.revive).map((e) => e.target));
  if (healed.size > 1) tags.add("heal-party");
  else if (healed.size === 1) tags.add([...healed][0] === caster ? "heal-self" : "heal-ally");
  // cleanses, dispels, amplify
  for (const e of during.filter((x) => x.kind === "removeAll")) {
    const removed: string[] = e.data.removed;
    if (sameSide(e.target) && removed.includes(PROBE_DEBUFF)) tags.add(e.target === caster ? "cleanse-self" : "cleanse");
    if (!sameSide(e.target) && removed.includes(PROBE_BUFF)) tags.add("dispel");
  }
  if (tags.has("cleanse")) tags.delete("cleanse-self");
  if (during.some((e) => e.kind === "amplify")) tags.add("amplify");
  // effects, grouped by name
  // by name and side (Peaceful Respite puts the same name on both sides)
  const byName = new Map<string, { name: string; params: Any; owners: Any[] }>();
  for (const e of during.filter((x) => x.kind === "effect" && !isProbe(x.data.name))) {
    const key = `${e.data.name}|${sameSide(e.target)}`;
    const g = byName.get(key) ?? { name: e.data.name, params: e.data, owners: [] as Any[] };
    if (!g.owners.includes(e.target)) g.owners.push(e.target);
    byName.set(key, g);
  }
  const effects: EffectInfo[] = [];
  for (const { name: ename, params, owners } of byName.values()) {
    const ownSide = sameSide(owners[0]);
    let kind = effectKind(params, ownSide, heroCaster);
    const rep = owners.includes(caster) ? caster : owners[0];
    const ownerTurns: number[] = [], facingTurns: number[] = [];
    for (const a of rec.acts) {
      if (a.turn < castTurn) continue;
      const d = a.turn - castTurn;
      if (!a.present.get(rep)?.has(ename)) continue;
      if (a.actor === rep) {
        if (!ownerTurns.includes(d)) ownerTurns.push(d);
      } else if (sameSide(a.actor) !== sameSide(rep) && !facingTurns.includes(d)) facingTurns.push(d);
    }
    // the cast itself: an effect put on yourself during your own action is not active for that action
    const until: EffectInfo["until"] = params.trigger === "Permanent" ? "permanent"
      : params.reversible && (params.turns === undefined || params.turns === null) ? "toggle"
      : params.turns === undefined || params.turns === null
      ? (params.trigger === "OnDamage" || params.trigger === "DamageReceived") ? "next-hit"
        : params.trigger === "OnAttack" ? "next-attack" : params.trigger === "OnDetermineAction" ? "next-attack" : "permanent"
      : "turns";
    const ownerIsEnemy = rep === battle.enemy;
    const info: EffectInfo = {
      name: ename, kind,
      on: ownSide ? (owners.length > 1 ? "party" : rep === caster ? "self" : "party") : heroCaster ? "enemy" : "heroes",
      ...(isHero(rep) ? { locations: owners.filter(isHero).map((h: Any) => h.partyLocation).sort((a: number, b: number) => a - b) } : {}),
      ...(params.stats && Object.keys(params.stats).length ? { stats: numeric(params.stats) } : {}),
      ...(params.turns !== undefined && params.turns !== null ? { turns: params.turns } : {}),
      ...(params.trigger ? { trigger: params.trigger } : {}),
      until, ownerTurns, facingTurns,
      removable: !params.cannotDispell && (isHero(rep) ? Boolean(params.debuff) : !params.debuff),
    };
    if (["shield", "reflect", "counter", "vulnerability"].includes(kind)) {
      // the test hit decides: damage sent back (reflect: the owner takes less; counter: it takes it all), less taken
      // (shield), or no change (a buff that grows when hit, like Enrage)
      const t = damageTest(make, ownerIsEnemy, ename)!;
      info.test = t;
      const less = t.physical < 0.99 || t.magical < 0.99;
      if (ownSide && t.reflected) kind = less ? "reflect" : "counter";
      else if (ownSide && !less) kind = "buff";
      info.kind = kind;
    }
    effects.push(info);
    const tag: Partial<Record<EffectKind, SkillTag>> = {
      dot: "dot", hot: "heal-over-time", stun: "stun", "force-action": "force-action", shield: "shield", reflect: "reflect",
      counter: "counter", taunt: "taunt", "stat-swap": "stat-swap", "miss-chance": "miss-chance", vulnerability: heroCaster ? "debuff-enemy" : "debuff-party",
    };
    if (tag[kind]) tags.add(tag[kind]!);
    else if (kind === "buff") tags.add(owners.length > 1 || (heroCaster && rep !== caster) ? "buff-party" : "buff-self");
    else if (kind === "debuff") tags.add(ownSide ? (heroCaster ? "debuff-party" : "debuff-enemy") : heroCaster ? "debuff-enemy" : "debuff-party");
  }
  return {
    name, side, tags: [...tags], power: Math.round(power * 100) / 100,
    ...(hits.length ? { mix: shares(mix) } : {}),
    ...(!heroCaster && hitLocs.size ? { hits: [...hitLocs].sort((a, b) => a - b) } : {}), effects,
  };
}

const shares = (m: { physical: number; magical: number; true: number }) => {
  const t = m.physical + m.magical + m.true || 1;
  const r = (x: number) => Math.round((100 * x) / t) / 100;
  return { physical: r(m.physical), magical: r(m.magical), true: r(m.true) };
};

const numeric = (s: Any) =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, Math.round((v as number) * 1e4) / 1e4])) as Record<string, number>;

/** What a hero skill does (cast by the back-1 hero of a full party, on turn 1). */
export function probeHeroSkill(sim: Sim, name: string): SkillProfile {
  if (!abilityFunc[name]) throw new Error(`unknown skill ${name}`);
  randomseed(1);
  const make = (after: number | "cast" = 7) => {
    randomseed(1);
    return heroSkillCast(sim, name, after);
  };
  const p = profile(make(), name, "hero", make);
  // damage as a linear function of the caster's stats: one cast at 1000 in every stat, then each stat at 1100
  const raw = (stats: Record<string, number>) => {
    randomseed(1);
    const c = heroSkillCast(sim, name, "cast", stats);
    return c.rec.events.filter((e) => e.kind === "attack" && e.actor === c.caster && e.target === c.battle.enemy && !e.data.isDot)
      .reduce((a, e) => a + e.data.raw * e.data.mod, 0);
  };
  // extra damage on a crit that scales with the enemy's HP (Berserk Smash: 3 % of its current HP); the probe enemy
  // has 1e9 HP, so stat-scaled damage is negligible next to it
  {
    const base = Object.fromEntries(SCALE_STATS.map((k) => [k, 1000]));
    const extra = raw({ ...base, crit: 100, critMod: 1 }) - raw({ ...base, crit: 0 });
    if (extra > 1e5) p.critHpPct = Math.round((extra / 1e9) * 1e4) / 1e4;
  }
  const base = Object.fromEntries(SCALE_STATS.map((k) => [k, 1000]));
  const r0 = raw(base);
  if (r0 > 0) {
    const sc: SkillProfile["scaling"] = {};
    for (const k of SCALE_STATS) {
      const d = (raw({ ...base, [k]: 1100 }) - r0) / 100;
      if (Math.abs(d) > 1e-6) sc[k] = Math.round(d * 1000) / 1000;
    }
    p.scaling = sc;
    // power for a hero with every stat equal (its Basic = atk + matk); with real stats, schedule.ts recomputes it
    p.power = Math.round((100 * r0) / 2000) / 100;
  }
  // direct heals (not revives, not heal-over-time ticks) per hero healed, the same way, plus level and a constant
  const healed = (stats: Record<string, number>) => {
    randomseed(1);
    const c = heroSkillCast(sim, name, "cast", stats);
    const hs = c.rec.events.filter((e) => e.kind === "heal" && e.actor === c.caster && !e.data.revive && !e.data.tick &&
      c.heroes.includes(e.target));
    const n = new Set(hs.map((e) => e.target)).size;
    return n ? hs.reduce((a, e) => a + e.data.amount, 0) / n : 0;
  };
  const hbase = { ...base, level: 60 };
  const h0 = healed(hbase);
  if (h0 > 0) {
    const hsc: SkillProfile["healScaling"] = {};
    let rest = h0;
    for (const k of [...SCALE_STATS, "level"] as const) {
      const step = k === "level" ? 10 : 100;
      const d = (healed({ ...hbase, [k]: hbase[k] + step }) - h0) / step;
      if (Math.abs(d) > 1e-6) {
        hsc[k] = Math.round(d * 1000) / 1000;
        rest -= d * hbase[k];
      }
    }
    if (Math.abs(rest) > 1e-3) hsc.const = Math.round(rest * 100) / 100;
    p.healScaling = hsc;
  }
  return p;
}

/** What an enemy skill does in slot `slot` of this quest's enemy. */
export function probeEnemySkill(sim: Sim, quest: number, rare: boolean, slot: number, name?: string): SkillProfile {
  const skill = name ?? enemyAttackList(quest, rare)[slot];
  if (!abilityFunc[skill]) throw new Error(`unknown skill ${skill}`);
  const make = (after: number | "cast" = 7) => {
    randomseed(1);
    return enemySkillCast(sim, quest, rare, slot, skill, after);
  };
  return profile(make(), skill, "enemy", make);
}

/** The enemy's 5 slots with what each does and its effect windows. */
export function probeTimeline(sim: Sim, quest: number, rare = false): EnemyTimeline {
  const q = G.questData[quest];
  const list = enemyAttackList(quest, rare);
  const slots: SkillProfile[] = [];
  for (let k = 1; k <= 5; k++) slots.push(probeEnemySkill(sim, quest, rare, k, list[k]));
  return { quest, name: q.name, rare, questType: q.questType, enemyFirst: hasFirstAttack({ questType: q.questType }), slots };
}

/** Quests with an enemy rotation (normal, and rare when the quest has a rare variant). */
export function enemyQuests(): { quest: number; rare: boolean }[] {
  const out: { quest: number; rare: boolean }[] = [];
  for (const [k, q] of Object.entries<Any>(G.questData)) {
    if (!q?.attackList || q.enemyHp === undefined) continue;
    out.push({ quest: Number(k), rare: false });
    if (q.enemyHpB !== undefined && q.questType > 2) out.push({ quest: Number(k), rare: true });
  }
  return out.sort((a, b) => a.quest - b.quest || Number(a.rare) - Number(b.rare));
}

/** Every skill a hero class can learn (heroList skillList) plus Basic. */
export function heroSkillNames(): string[] {
  const s = new Set<string>(["Basic"]);
  for (const h of Object.values<Any>(G.heroList)) for (const n of Object.values<string>(h.skillList ?? {})) s.add(n);
  return [...s].sort();
}

export interface TimelinesData {
  /** Bumped when the probe or the tag rules change. */
  version: number;
  heroSkills: Record<string, SkillProfile>;
  /** Enemy skills as first met in a quest rotation (windows depend on the enemy's turn order: see timelines). */
  enemySkills: Record<string, SkillProfile>;
  /** "97" (normal) or "97B" (rare). */
  timelines: Record<string, EnemyTimeline>;
}

export const TIMELINES_VERSION = 4;

export const timelineKey = (quest: number, rare = false) => `${quest}${rare ? "B" : ""}`;

/** Every hero skill and every enemy rotation (inventory/timelines.json is this, frozen). */
export function buildTimelines(sim: Sim): TimelinesData {
  const heroSkills: Record<string, SkillProfile> = {};
  for (const n of heroSkillNames()) heroSkills[n] = probeHeroSkill(sim, n);
  const enemySkills: Record<string, SkillProfile> = {};
  const timelines: Record<string, EnemyTimeline> = {};
  for (const { quest, rare } of enemyQuests()) {
    const t = probeTimeline(sim, quest, rare);
    timelines[timelineKey(quest, rare)] = t;
    for (const s of t.slots) enemySkills[s.name] ??= s;
  }
  return { version: TIMELINES_VERSION, heroSkills, enemySkills, timelines };
}
