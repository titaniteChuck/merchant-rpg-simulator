/**
 * Simulator API, mirroring the `sim.*` API of the former Lua harness (tools/sim/harness.lua,
 * which ran the game's own code and recorded the reference fixtures).
 *
 *   loadGameData(json)               // inventory/gamedata.json
 *   setMode("Standard")              // the save's gameMode
 *   const h = newHero(saveEntry)     // a hero from the save file
 *   const r = fight(81, [h], [], { seed: 1 })
 */
import { Battle, current, determineBattleGrade } from "./battle.ts";
import { type CalcSink, calcState, Combatant, type Effect, hooks, statToPct } from "./combatant.ts";
import { G, loadGameData as loadData } from "./data.ts";
import { attackListUnlocked, D, heroMaxActionPoints, setMode as setDefaultsMode } from "./defaults.ts";
import { Equipment } from "./equipment.ts";
import { Campaign, determineQuestTime } from "./campaign.ts";
import { LuaTable } from "./lua-table.ts";
import { GameMap } from "./map.ts";
import { Hero } from "./hero.ts";
import { len, randomseed, rng, seq } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Load inventory/gamedata.json and apply the Standard mode (call setMode after for another one). */
export function loadGameData(json: Any): void {
  loadData(json);
  setDefaultsMode("Standard");
}
export { Hero } from "./hero.ts";
export { Equipment } from "./equipment.ts";
export { GameMap } from "./map.ts";

export function setMode(mode = "Standard"): void {
  setDefaultsMode(mode);
}

// ---------------------------------------------------------------- per-skill damage + trace
const dealt = (c: Any) => (c.combatStatistics.physicalDmgDealt ?? 0) + (c.combatStatistics.magicDmgDealt ?? 0);

export interface TraceEntry {
  turn: number;
  who: number;
  act: string;
  rng: number;
  enemyHP: number;
  hp: (number | false)[];
  effects: string[];
  /**
   * Display data (U39), never compared with the game's recordings. What the actor really played: the skill (another
   * one than `act` under a forced action), false when an effect took its action (stun), null when it was dead.
   */
  did?: string | false | null;
  /** Each fighter hit or healed during this action (0 = the enemy, 1-6 = party locations). */
  hits?: TraceHit[];
  /** The effects on every fighter after this action. */
  fx?: TraceEffect[];
  /** The actor's attacks that missed during this action. */
  misses?: number;
  /** Which battle of the traced run (0 = the first since traceStart): a map run fights one battle per room. */
  battle?: number;
  /**
   * Every fighter's HP and max HP after this action, by location (0 = the enemy). U65: and its stats then, as the
   * engine computes them (its effects applied): Atk, Matk, Def, Mdef, Acc, Eva, Crit.
   */
  life?: TraceLife[];
  /**
   * U65: on a battle's first action only, every fighter as the battle began, before any action (the Party view's
   * turn 0): HP, max HP, stats and effects.
   */
  start?: { life: TraceLife[]; fx: TraceEffect[] };
  /** U67: the effect that took the action (did false: a stun, a freeze) or changed it (a forced skill). */
  by?: string;
  /** U67: what the actor's own action did to each fighter it aimed at (damage, healing, misses, crits). */
  out?: TraceOutcome[];
}
/** U65: a fighter's HP, max HP and live stats at one moment of a traced fight. */
export interface TraceLife {
  who: number;
  hp: number;
  maxHP: number;
  stats?: Record<string, number>;
  /** U67: the parts of its live stats (none when it has none). */
  mods?: TraceMod[];
}
/**
 * U67: one part of a fighter's live stat, as the game builds it (Hero / Enemy.determineStats, then statsService
 * calculatePercentStats): stat = (base + flat parts) × (1 + sum of % parts), the sum floored (stats.ts pctFloor).
 * - "pct": a share in the stat's % sum (0.15 = +15%), from an effect, the passive, an item, an enchant, a potion, the
 *   map's scrolls, or "other": what the engine's sum holds beyond those (a % the game keeps from earlier stat
 *   updates, as an enemy's Acc %);
 * - "flat": points an effect adds before the % (Inspiration's Atk, Expose Weakness's Crit);
 * - "set": an effect that sets the stat itself (Holy Shield's Mdef, Swap Attack, Swap Defense).
 * Max HP is "maxHP"; Eva is left out for heroes (the cards don't show it).
 */
export interface TraceMod {
  stat: string;
  kind: "pct" | "flat" | "set";
  value: number;
  src: "effect" | "passive" | "item" | "enchant" | "potion" | "scroll" | "other";
  /** Engine name (English): the effect, the passive, the item (prefix and suffix included), the potion. */
  name: string;
  /** An effect's: who put it on (0 the enemy, 1-6 a party location) and with which skill, its turns left, a debuff. */
  from?: number;
  skill?: string;
  turns?: number;
  debuff?: boolean;
}
/** U67: one fighter the actor's own action aimed at (0 the enemy, 1-6 a party location). */
export interface TraceOutcome {
  who: number;
  /** Damage of the hits that landed on it while standing (crits included), and HP really healed. */
  dmg: number;
  heal: number;
  /** Hits that landed, heals received, attacks that missed, landed hits that were critical. */
  hits: number;
  heals: number;
  miss: number;
  crit: number;
}
/** U65: the stats the trace records per fighter (the Party view cards' eight, max HP apart). */
export const TRACE_STATS = ["atk", "matk", "def", "mdef", "acc", "eva", "crit"] as const;
export interface TraceHit {
  who: number;
  /** Damage taken while standing, and HP really healed (no overheal). */
  dmg: number;
  heal: number;
  /** HP after the action. */
  hp: number;
  maxHP: number;
  /** U40: the fighter fell during this action (standing before one of its hits, down after it). */
  ko?: boolean;
  /**
   * U40: hits that landed on this fighter while it was already down, and their damage. The game plays every action of
   * a turn even after the enemy falls (Battle.combatLoop checks for the end only once the turn is over), so those
   * hits change nothing; they are not counted in `dmg`.
   */
  deadHits?: number;
  deadDmg?: number;
  /** U40: each hit and heal behind `dmg` and `heal` (and the hits on a fallen fighter), in the order they happened. */
  calc?: TraceCalc[];
}
export interface TraceEffect {
  who: number;
  name: string;
  debuff: boolean;
  /** Turns left (the effect's own count), when it has one. */
  turns?: number;
  /** The effect's numbers as they are now (stacks, amplified values included). */
  stats?: Record<string, number>;
  /** U40: who put it on (0 = the enemy, 1-6 = party location) and with which skill. */
  from?: number;
  skill?: string;
  /** U40: when it acts (OnTurn, Permanent, OnDamage, DamageReceived, OnAttack, DamageOnTurn, HealingOnTurn …). */
  trigger?: string;
  /** U40: healing per turn (heal over time), shield left (Mana Shield), the stat a stat-setting effect gives now. */
  heal?: number;
  absorb?: number;
  value?: number;
  /** U40: doubled by an amplify (Amplify Magic). */
  amp?: boolean;
  /** U40: spent or ended (a one-hit effect that worked, every effect of a fighter that fell): removed at its owner's next action. */
  gone?: boolean;
}

/** The attack's three parts as sent (physical from ATK, magic from MATK, true damage). */
export interface Calc3 {
  atk: number;
  matk: number;
  dmg: number;
}
/** The damage's three parts once rounded (physical, magic, true). */
export interface CalcDmg3 {
  p: number;
  m: number;
  t: number;
}
/** A fighter's stats when it sent the attack or the heal, and the stat effects on it then. */
export interface CalcStats {
  atk: number;
  matk: number;
  acc: number;
  def: number;
  mdef: number;
  maxHP: number;
  level?: number;
  fx: { name: string; stats: Record<string, number> }[];
}
/**
 * U40: one hit, stage by stage, with the values the engine really used (Combatant.sendAttack / receiveAttack):
 * the skill's attack (base) → the attacker's on-attack effects → the share for this target (ratio) → the target's
 * on-damage effects (used) → × crit or lucky hit × DEF / MDEF reduction, each part rounded (raw) → the target's
 * damage-received effects (final) → total.
 */
export interface CalcAttack {
  kind: "dmg";
  seq: number;
  from: number;
  to: number;
  /** The skill, or the effect, that sent it. */
  src: string;
  /** Damage over time (a tick of an effect). */
  tick: boolean;
  stat: CalcStats | null;
  base: Calc3 | null;
  onAttack: { name: string; after: Calc3 | null }[];
  arrived: Calc3;
  ratio?: number;
  onDamage: { name: string; after: Calc3; hitChance?: number }[];
  missed?: boolean;
  hitChance: number;
  crit?: boolean;
  luck?: boolean;
  critChance?: number;
  dmgMod?: number;
  used?: Calc3;
  def?: number;
  defPen?: number;
  defRed?: number;
  mdef?: number;
  mdefPen?: number;
  mdefRed?: number;
  raw?: CalcDmg3;
  received: { name: string; after: CalcDmg3 }[];
  final?: CalcDmg3;
  total: number;
  hpBefore: number;
  hpAfter: number;
}
/** U40: one heal (Combatant.receiveHeal): the amount sent, rounded (total), and the HP it really gave back. */
export interface CalcHeal {
  kind: "heal";
  seq: number;
  from: number;
  to: number;
  src: string;
  tick: boolean;
  stat: CalcStats | null;
  amount: number;
  isPercent: boolean;
  revive: boolean;
  overload: boolean;
  maxHP: number;
  total: number;
  hpBefore: number;
  hpAfter: number;
}
export type TraceCalc = CalcAttack | CalcHeal;

let trace: TraceEntry[] | undefined;

/** The fighters of a battle with their location (0 = the enemy). */
function fighters(b: Battle): [number, Any][] {
  const out: [number, Any][] = [[0, b.enemy]];
  for (let i = 1; i <= 3; i++) {
    if (b.backRow[i]) out.push([i * 2 - 1, b.backRow[i]]);
    if (b.frontRow[i]) out.push([i * 2, b.frontRow[i]]);
  }
  return out;
}
/** While tracing, before an action: the actor's misses so far. */
let snap: { misses: number } | undefined;
/** The battle the last traced action was in, and its number since traceStart (-1: none yet). */
let traceBattle: { b?: Battle; no: number } = { no: -1 };
/** While tracing: the hits and heals of the current action, the fighter acting, and who put each effect on. */
let calcs: TraceCalc[] = [];
let actor: Any;
let fxSource = new WeakMap<Effect, { from: number; skill: string }>();

const whoOf = (c: Any): number => (c ? c.partyLocation ?? 0 : -1);
const num = (v: Any): number => (typeof v === "number" ? v : 0);

/** The trace's calc sink (U40): turns the engine's records into plain data (locations instead of fighters). */
const sink: CalcSink = {
  attack(r) {
    calcs.push({ ...r, kind: "dmg", from: whoOf(r.from), to: whoOf(r.to), src: String(r.src ?? "?") });
  },
  heal(r) {
    calcs.push({ ...r, kind: "heal", from: whoOf(r.from), to: whoOf(r.to), src: String(r.src ?? "?") });
  },
  effect(_target, e) {
    // A stacked effect keeps who first put it on; a new one, or one cast again (a new object), is the actor's.
    if (!fxSource.has(e) && actor) fxSource.set(e, { from: whoOf(actor), skill: String(actor._did ?? e.name) });
  },
};

/** An effect as the trace shows it: its live numbers (stacks, amplify), who put it on, and what it does. */
function traceEffect(who: number, f: Any, e: Effect): TraceEffect {
  const stats = e.stats && typeof e.stats === "object"
    ? Object.fromEntries(Object.entries(e.stats).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined;
  const src = fxSource.get(e);
  // Mana Shield's dmgFunc lowers the shield on the skill's own object (the effect is a copy of it): read that one.
  const absorb = e._live?.absorb ?? e.absorb;
  // Holy Shield sets MDEF (statFunc): the fighter's MDEF now is what it gives.
  const value = e.name === "Holy Shield" ? f.mdef : undefined;
  return {
    who, name: e.name ?? "?", debuff: Boolean(e.debuff), ...(typeof e.turns === "number" ? { turns: e.turns } : {}),
    ...(stats && Object.keys(stats).length ? { stats } : {}),
    ...(src ? { from: src.from, skill: src.skill } : {}),
    ...(e.trigger ? { trigger: e.trigger } : {}),
    ...(typeof e.heal === "number" ? { heal: e.heal } : {}),
    ...(typeof absorb === "number" ? { absorb } : {}),
    ...(typeof value === "number" ? { value } : {}),
    ...(e._isAmplified ? { amp: true } : {}),
    ...(e.remove ? { gone: true } : {}),
  };
}

/** U65: every fighter's HP, max HP and live stats now (read only). */
function lifeOf(b: Battle): TraceLife[] {
  return fighters(b).map(([who, f]) => ({ who, hp: f.questHP, maxHP: f.maxHP,
    stats: Object.fromEntries(TRACE_STATS.map((k) => [k, num(f[k])])) }));
}
/** U67: the fighter field of each % sum, by the stat it multiplies. */
const PCT_FIELD: Record<string, string> = { maxHP: "hpPct", atk: "atkPct", matk: "matkPct", def: "defPct", mdef: "mdefPct", acc: "accPct", eva: "evaPct" };
const PCT_STAT: Record<string, string> = Object.fromEntries(Object.entries(PCT_FIELD).map(([k, v]) => [v, k]));
/** U67: the stats an effect may add points to (before the %). */
const FLAT_STATS = new Set(["maxHP", "atk", "matk", "def", "mdef", "acc", "eva", "crit"]);
/** U67: the effects whose statFunc sets stats, and which ones. */
const SET_STATS: Record<string, string[]> = { "Holy Shield": ["mdef"], "Swap Attack": ["atk", "matk"], "Swap Defense": ["def", "mdef"] };

/**
 * U67: the parts of a fighter's live stats (read only): its stat effects (determineEffectStats: OnTurn and Permanent
 * ones), then the rest of each % sum: a hero's enchants, potion, gear, scrolls and passive (Hero.determineStats), and
 * what the engine's sum holds beyond them ("other").
 */
function modsOf(f: Any): TraceMod[] {
  const out: TraceMod[] = [];
  const hero = Boolean(f.heroInventory);
  const counted: Record<string, number> = {};
  for (const e of f.effectList as Effect[]) {
    if (e.trigger !== "OnTurn" && e.trigger !== "Permanent") continue;
    const src = fxSource.get(e);
    const meta = { src: "effect" as const, name: e.name ?? "?", ...(src ? { from: src.from, skill: src.skill } : {}),
      ...(typeof e.turns === "number" ? { turns: e.turns } : {}), ...(e.debuff ? { debuff: true } : {}) };
    if (e.statFunc) {
      for (const stat of SET_STATS[e.name] ?? []) out.push({ stat, kind: "set", value: 0, ...meta });
      continue;
    }
    for (const [k, v] of Object.entries(e.stats ?? {})) {
      if (typeof v !== "number" || !v) continue;
      const field = statToPct[k] ?? k;
      const pctOf = PCT_STAT[field];
      if (pctOf) {
        counted[field] = (counted[field] ?? 0) + v;
        if (!(hero && pctOf === "eva")) out.push({ stat: pctOf, kind: "pct", value: v, ...meta });
      } else if (FLAT_STATS.has(field) && !(hero && field === "eva")) out.push({ stat: field, kind: "flat", value: v, ...meta });
    }
  }
  for (const [stat, field] of Object.entries(PCT_FIELD)) {
    if (hero && stat === "eva") continue;
    let rest = num(f[field]) - (counted[field] ?? 0);
    const add = (src: TraceMod["src"], name: string, v: Any) => {
      if (typeof v === "number" && v) {
        out.push({ stat, kind: "pct", value: v, src, name });
        rest -= v;
      }
    };
    if (hero) {
      for (const e of f.enchantList ?? []) add("enchant", "Enchantment", e.stat?.[field]);
      if (f.boost) add("potion", String(G.itemData?.consumable?.[f.boost.id]?.name ?? "Potion"), f.boost.stats?.[field]);
      for (let i = 1; i <= len(f.heroInventory); i++) {
        const item = f.heroInventory[i];
        if (item && !(item.itemLevel > f.level)) add("item", String(item.name ?? "?"), item[field]);
      }
      if (f.campaignID !== -1 && f.campaign?.battleBuff) add("scroll", "Scrolls", f.campaign.battleBuff[field]);
      add("passive", String(f.passiveSelect), G.passiveData[f.passiveSelect]?.stats?.[field]);
    }
    if (Math.abs(rest) > 1e-9) out.push({ stat, kind: "pct", value: rest, src: "other", name: "Other" });
  }
  return out;
}
/** U67: life records with each fighter's stat parts. */
function withMods(b: Battle, life: TraceLife[]): TraceLife[] {
  const fs = new Map(fighters(b));
  return life.map((l) => {
    const mods = modsOf(fs.get(l.who));
    return mods.length ? { ...l, mods } : l;
  });
}
/**
 * U67: what the actor's own action did to each fighter it aimed at, from the action's calculations: its hits and
 * heals (not a damage or heal over time, not a hit on a fighter already down).
 */
function outcomeOf(me: number, evs: TraceCalc[]): TraceOutcome[] {
  const out = new Map<number, TraceOutcome>();
  for (const x of evs) {
    if (x.from !== me || x.tick || x.to < 0) continue;
    if (x.kind === "dmg" && !x.missed && x.hpBefore <= 0) continue;
    if (!out.has(x.to)) out.set(x.to, { who: x.to, dmg: 0, heal: 0, hits: 0, heals: 0, miss: 0, crit: 0 });
    const o = out.get(x.to)!;
    if (x.kind === "heal") {
      o.heals++;
      o.heal += Math.max(0, x.hpAfter - Math.max(0, x.hpBefore));
    } else if (x.missed) o.miss++;
    else {
      o.hits++;
      o.dmg += x.total;
      if (x.crit) o.crit++;
    }
  }
  return [...out.values()].sort((a, b) => a.who - b.who);
}

/** U65: the battle as it begins, taken before its first action (read only), handed to that action's entry. */
let startSnap: TraceEntry["start"];

/** What the trace adds for display (U39, U40): reads the fighters and the action's records, changes nothing. */
function traceDetail(b: Battle, c: Combatant): Pick<TraceEntry, "did" | "hits" | "fx" | "misses" | "battle" | "life" | "by" | "out"> {
  const hits: TraceHit[] = [], fx: TraceEffect[] = [];
  const evs = [...calcs].sort((x, y) => x.seq - y.seq);
  for (const [who, f] of fighters(b)) {
    const mine = evs.filter((x) => x.to === who && !(x.kind === "dmg" && x.missed));
    if (mine.length) {
      let dmg = 0, heal = 0, deadHits = 0, deadDmg = 0, ko = false;
      for (const x of mine) {
        if (x.kind === "dmg") {
          if (x.hpBefore > 0) {
            dmg += x.total;
            if (x.hpAfter <= 0) ko = true;
          } else {
            deadHits++;
            deadDmg += x.total;
          }
        } else heal += Math.max(0, x.hpAfter - Math.max(0, x.hpBefore));
      }
      if (dmg > 0 || heal > 0 || deadHits > 0) {
        hits.push({ who, dmg, heal, hp: f.questHP, maxHP: f.maxHP, ...(ko && f.questHP <= 0 ? { ko: true } : {}),
          ...(deadHits ? { deadHits, deadDmg } : {}), calc: mine });
      }
    }
    for (const e of f.effectList) fx.push(traceEffect(who, f, e));
  }
  if (b !== traceBattle.b) traceBattle = { b, no: traceBattle.no + 1 };
  const life = withMods(b, lifeOf(b));
  return { did: c._did ?? null, hits, fx, misses: snap ? num(c.combatStatistics.misses) - snap.misses : 0, battle: traceBattle.no, life,
    ...(c._didBy ? { by: String(c._didBy) } : {}), out: outcomeOf(whoOf(c), evs) };
}

hooks.beforeAction = (c) => {
  if (trace && current.battle) {
    snap = { misses: num(c.combatStatistics.misses) };
    calcs = [];
    actor = c;
    // U65: a battle's first action (traceDetail moves traceBattle on after it): the state before anything happened.
    if (current.battle !== traceBattle.b) {
      const b = current.battle;
      startSnap = { life: withMods(b, lifeOf(b)), fx: fighters(b).flatMap(([who, f]) => f.effectList.map((e: Effect) => traceEffect(who, f, e))) };
    }
  }
  return dealt(c);
};
hooks.afterAction = (c: Combatant, name: Any, before: Any) => {
  if (c._skillDmg) {
    c._skillDmg[name] = (c._skillDmg[name] ?? 0) + dealt(c) - before;
    c._skillUses[name] = (c._skillUses[name] ?? 0) + 1;
  }
  const b = current.battle;
  // Lowest enemy HP between actions: a self-healing enemy (Archon's Aeon Lash) can end a lost fight at full HP.
  if (b) b._enemyMinHP = Math.min(b._enemyMinHP ?? Infinity, b.enemy.questHP);
  if (trace && b) {
    const hp: (number | false)[] = [];
    for (let i = 1; i <= 3; i++) {
      hp[i * 2 - 2] = b.backRow[i] ? b.backRow[i].questHP : false;
      hp[i * 2 - 1] = b.frontRow[i] ? b.frontRow[i].questHP : false;
    }
    trace.push({
      turn: b.turns, who: c.partyLocation ?? 0, act: name, rng: rng.calls, enemyHP: b.enemy.questHP, hp,
      effects: c.effectList.map((e) => e.name ?? "?"),
      ...traceDetail(b, c),
      ...(startSnap ? { start: startSnap } : {}),
    });
    startSnap = undefined;
    snap = undefined;
    calcs = [];
    actor = undefined;
  }
};

/**
 * Record every action of the next fights (like sim.traceStart / sim.traceStop). U40: the damage and heal calculations
 * are recorded only from here to traceStop (the calc sink), so a plain simulation builds none of them.
 */
export function traceStart(): void {
  trace = [];
  traceBattle = { no: -1 };
  startSnap = undefined;
  calcs = [];
  actor = undefined;
  fxSource = new WeakMap();
  Object.assign(calcState, { sends: [], heals: [], effects: [], tick: undefined, seq: 0 });
  hooks.calc = sink;
}
export function traceStop(): TraceEntry[] {
  const t = trace ?? [];
  trace = undefined;
  hooks.calc = undefined;
  calcs = [];
  actor = undefined;
  return t;
}

// ---------------------------------------------------------------- heroes
/** A hero from a save entry (heroInventory = compact item strings, skillSet/attackList = skill indices). */
export function newHero(params: Any): Hero {
  const p = structuredClone(params);
  p.campaignID = -1;
  p.boost = p.boost ?? false;
  const hero = new Hero(p, false);
  hero.hp = hero.maxHP;
  hero.questHP = hero.maxHP;
  return hero;
}

/** 5 skill names or class-skill indices (0 = Basic), and optionally a passive. Returns the rotation. */
export function setSkills(hero: Hero, attackList: Any[], passive?: string): string[] {
  hero.attackList = hero.loadSkillList(attackList);
  if (passive) hero.passiveSelect = passive;
  hero.determineStats();
  return hero.attackList.slice(1);
}

export function equip(hero: Hero, slot: number, compact: string): void {
  hero.heroInventory[slot] = new Equipment(compact);
  hero.determineStats();
}

/** A fresh catalog item (no prefix/suffix), base stats rolled within the grade's range. */
export function makeItem(id: number, grade: number, prestige = 0, charLevel = 60, seed?: number): Equipment {
  if (seed !== undefined) randomseed(seed);
  const item = new Equipment({ id, itemType: "equipment", grade, prestigeLevel: prestige, isNew: true, charLevel });
  item.grade = grade;
  return item;
}

export function equipItem(hero: Hero, slot: number, item: Equipment): void {
  hero.heroInventory[slot] = item;
  hero.determineStats();
}

export function skillInfo(hero: Hero): Any {
  const skills = seq<string>(G.heroList[hero.class].skillList);
  return {
    unlocked: attackListUnlocked(hero),
    maxAP: heroMaxActionPoints(hero),
    skills: skills.map((name) => ({ name, ap: G.abilityData[name]?.apCost ?? 0 })),
    passives: seq<string>(G.heroList[hero.class].passiveList),
  };
}

export function heroStats(h: Hero): Any {
  h.determineStats();
  const out: Any = {};
  for (const k of ["maxHP", "atk", "matk", "acc", "crit", "critMod", "def", "mdef", "eva", "str", "int", "dex",
    "speed", "lckMod", "defPen", "mdefPen", "maxActionPoints", "actionPoints"]) out[k] = h[k];
  return out;
}

// ---------------------------------------------------------------- fights
function heroSummary(h: Any): Any {
  const s = h.combatStatistics;
  return {
    name: h.name, class: h.class, level: h.level, prestige: h.prestigeLevel,
    hp: h.questHP, maxHP: h.maxHP, dead: Boolean(h.isDead) || (h.questHP ?? 0) <= 0,
    physicalDmgDealt: s.physicalDmgDealt, magicDmgDealt: s.magicDmgDealt,
    dmgTaken: s.physicalDmgTaken + s.magicDmgTaken,
    skillDmg: h._skillDmg ?? {}, skillUses: h._skillUses ?? {},
    healingDone: s.healingDone, hits: s.hits, misses: s.misses, crits: s.crits,
  };
}

export interface FightOptions {
  isRare?: boolean;
  amount?: number;
  seed?: number;
  mapStats?: Any;
}

/** One fight. front/back: up to 3 heroes each, by slot (null/undefined for an empty slot). */
export function fight(questID: number, front: (Hero | null | undefined)[], back: (Hero | null | undefined)[],
  opts: FightOptions = {}): Any {
  if (opts.seed !== undefined) randomseed(opts.seed);
  const f: Any[] = [undefined, front[0] ?? undefined, front[1] ?? undefined, front[2] ?? undefined];
  const b: Any[] = [undefined, back[0] ?? undefined, back[1] ?? undefined, back[2] ?? undefined];
  for (let i = 1; i <= 3; i++) {
    for (const row of [f, b]) {
      const h = row[i];
      if (h) {
        h._skillDmg = {};
        h._skillUses = {};
        // potions are dropped before a fight (as the reference harness did) unless a tool applied one on purpose
        if (!h._keepBoost) h.boost = false;
        h.determineStats();
        h.hp = h.maxHP;
        h.questHP = h.maxHP;
      }
    }
  }
  const battle = new Battle({
    questID, frontRow: f, backRow: b, isRare: opts.isRare ?? false, amount: opts.amount ?? 1, mapStats: opts.mapStats,
  });
  battle.setup();
  battle.combatLoop();
  const es = battle.enemy.combatStatistics;
  const result: Any = {
    won: Boolean(battle.hasWon), turns: battle.turns, actions: battle.actions,
    enemyHP: battle.enemy.questHP, enemyMaxHP: battle.enemy.maxHP,
    // lowest enemy HP after any action (<= enemyHP; lower when the enemy healed) and all damage it took
    enemyMinHP: Math.min(battle._enemyMinHP ?? Infinity, battle.enemy.questHP),
    enemyDmgTaken: (es?.physicalDmgTaken ?? 0) + (es?.magicDmgTaken ?? 0),
    heroes: [],
  };
  for (let i = 1; i <= 3; i++) {
    if (b[i]) result.heroes.push({ ...heroSummary(b[i]), slot: `back${i}` });
    if (f[i]) result.heroes.push({ ...heroSummary(f[i]), slot: `front${i}` });
  }
  result.grade = result.won ? determineBattleGrade(battle, questID, opts.isRare ?? false) : 0;
  // As a quest (Quest:endQuesting, Quest:createRewards): its duration, and the luck its loot rolls use.
  result.questTime = determineQuestTime(battle, questID, opts.amount ?? 1, result.grade);
  result.partyLuck = battle.getSumOfStat("lckMod");
  return result;
}

export { D, len };

// ---------------------------------------------------------------- map runs
// Map runs fold combat statistics into lifetime totals after every room; keep the
// healing too (as the former harness's Hero.addToTotals wrapper did).
const origAddToTotals = Hero.prototype.addToTotals;
Hero.prototype.addToTotals = function (this: Any) {
  this._runHeal = (this._runHeal ?? 0) + (this.combatStatistics.healingDone ?? 0);
  return origAddToTotals.call(this);
};

export interface MapSpec {
  id: number;
  prestigeLevel?: number;
  grade?: number;
  prefix?: number;
  suffix?: number;
  seed?: number;
}

/**
 * A map item: from a compact save string, or {id, prestigeLevel, grade, prefix, suffix, seed}.
 * The seed fixes rooms, enemies, rares and boss (Map:determineSeedBasedStats).
 */
export function makeMap(spec: MapSpec | string, seed?: number): GameMap {
  if (typeof spec === "string") {
    const map = new GameMap(spec);
    if (seed !== undefined) {
      map.seed = seed;
      map.determineSeedBasedStats();
    }
    return map;
  }
  return new GameMap({
    id: spec.id, prestigeLevel: spec.prestigeLevel ?? 0, grade: spec.grade ?? 3,
    prefix: spec.prefix, suffix: spec.suffix, seed: seed ?? spec.seed ?? 1,
  });
}

export interface MapRunOptions {
  seed?: number;
  mapSeed?: number;
  /** Up to 3 scrolls: consumable ids 60-69. */
  scrolls?: { id: number; prestigeLevel?: number }[];
}

/**
 * One full map run with the game's Campaign: rooms in order, HP carried over, loot per
 * won fight, essence at the end. Hero level/exp and lifetime totals are restored afterwards.
 * front/back: up to 3 heroes each, by slot (null/undefined for an empty slot), like fight().
 */
export function mapRun(spec: MapSpec | string, front: (Hero | null | undefined)[], back: (Hero | null | undefined)[],
  opts: MapRunOptions = {}): Any {
  const f: Any[] = [undefined, front[0] ?? undefined, front[1] ?? undefined, front[2] ?? undefined];
  const b: Any[] = [undefined, back[0] ?? undefined, back[1] ?? undefined, back[2] ?? undefined];
  if (opts.seed !== undefined) randomseed(opts.seed);
  const map = makeMap(spec, opts.mapSeed ?? opts.seed);
  // Map:determineSeedBasedStats ends with math.randomseed(os.time()): re-seed so
  // the fights are reproducible (same seed = same run).
  if (opts.seed !== undefined) randomseed(opts.seed * 7919 + 17);
  const saved = new Map<Any, Any>();
  for (let i = 1; i <= 3; i++) {
    for (const h of [f[i], b[i]]) {
      if (!h) continue;
      saved.set(h, {
        exp: h.exp, level: h.level, totalQuests: h.totalQuests, totalHits: h.totalHits,
        attackList: h.attackList, passiveSelect: h.passiveSelect, currentSkillSet: h.currentSkillSet,
        taken: h.totalPhysicalDmgTaken + h.totalMagicDmgTaken,
        tP: [h.totalPhysicalDmgDealt, h.totalMagicDmgDealt, h.totalPhysicalDmgTaken, h.totalMagicDmgTaken],
      });
      h._runHeal = 0;
      h._xpGained = 0;
      h._skillDmg = {};
      h._skillUses = {};
      if (!h._keepBoost) h.boost = false;
      h.campaignID = -1;
      h.resetStatsAndStatus();
      h.hp = h.maxHP;
      h.questHP = h.maxHP;
      h.isDead = false;
      h.timeDied = false;
    }
  }
  // Scrolls as Game:startMap builds them: one entry per slot.
  const scrolls = opts.scrolls?.map((sc) => ({ id: sc.id, amount: 1, chargesUsed: 0, prestigeLevel: sc.prestigeLevel ?? 0 }));
  const camp = new Campaign({ map, frontRow: f, backRow: b, scrolls });
  for (const h of saved.keys()) {
    h.campaignID = 1;
    h.campaign = camp; // Game.campaigns.campaigns[1]
    h.questHP = h.hp;
    h.determineStats();
  }
  let guard = 0;
  while (!camp.isFinished && guard < 100) {
    camp.runCombat();
    guard++;
  }
  const out: Any = {
    won: Boolean(camp.isWin), escaped: Boolean(camp.isEscape), rooms: camp.combats.length,
    mapName: map.name, mapAsc: map.prestigeLevel, enemyMod: map.enemyMod,
    combats: [], rewards: [], heroes: [], time: 0,
  };
  let cleared = 0;
  for (const c of camp.combats) {
    out.combats.push({ questId: c.questId, name: G.questData[c.questId].name, isRare: Boolean(c.isRare),
      status: c.status, grade: c.grade ?? 0, ...(c.turns !== undefined ? { turns: c.turns } : {}) });
    if (c.status === 1) cleared++;
    out.time = out.time + (c.timeTaken ?? 0) + (c.walkTime ?? 0);
  }
  out.cleared = cleared;
  out.scrollsUsed = (scrolls ?? []).map((sc) => ({ id: sc.id, chargesUsed: sc.chargesUsed }));
  out.lastEnemyRemoved = 0;
  const last = current.battle;
  if (!out.won && last && last.enemy.maxHP > 0) out.lastEnemyRemoved = 1 - Math.max(last.enemy.questHP, 0) / last.enemy.maxHP;
  out.grade = camp.getGrade();
  for (const r of camp.lootInventory.rewards) {
    out.rewards.push({ itemType: r.itemType, itemID: r.itemID, amount: r.amount ?? 1, prestigeLevel: r.prestigeLevel ?? 0 });
  }
  for (let i = 1; i <= 3; i++) {
    // former harness: pairs({["back"..i] = back[i], ["front"..i] = front[i]}) -> Lua's order for that constructor
    const slots = LuaTable.fromRecord([[`back${i}`, b[i]], [`front${i}`, f[i]]]);
    for (const [slot, h] of slots.entries() as [string, Any][]) {
      const s = heroSummary(h);
      const st = saved.get(h);
      s.slot = slot;
      s.physicalDmgDealt = h.totalPhysicalDmgDealt - st.tP[0];
      s.magicDmgDealt = h.totalMagicDmgDealt - st.tP[1];
      s.dmgTaken = h.totalPhysicalDmgTaken + h.totalMagicDmgTaken - st.taken;
      s.healingDone = h._runHeal ?? 0;
      s.xp = h._xpGained ?? 0; // XP gained over the run (rooms won, alive), before the restore below
      s.hp = h.questHP;
      s.dead = (h.questHP ?? 0) <= 0;
      out.heroes.push(s);
    }
  }
  for (const [h, st] of saved) {
    h.exp = st.exp;
    h.level = st.level;
    h.totalQuests = st.totalQuests;
    h.totalHits = st.totalHits;
    h.attackList = st.attackList;
    h.passiveSelect = st.passiveSelect;
    h.currentSkillSet = st.currentSkillSet;
    [h.totalPhysicalDmgDealt, h.totalMagicDmgDealt, h.totalPhysicalDmgTaken, h.totalMagicDmgTaken] = st.tP;
    h.campaignID = -1;
    h.campaign = undefined;
    h.determineStats();
  }
  return out;
}
