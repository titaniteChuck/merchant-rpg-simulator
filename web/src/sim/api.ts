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
import { Combatant, hooks } from "./combatant.ts";
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
  /** Every fighter's HP and max HP after this action, by location (0 = the enemy). */
  life?: { who: number; hp: number; maxHP: number }[];
}
export interface TraceHit {
  who: number;
  /** Damage taken, and HP really healed (no overheal). */
  dmg: number;
  heal: number;
  /** HP after the action. */
  hp: number;
  maxHP: number;
}
export interface TraceEffect {
  who: number;
  name: string;
  debuff: boolean;
  /** Turns left (the effect's own count), when it has one. */
  turns?: number;
  stats?: Record<string, number>;
}
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
const takenOf = (c: Any) => (c.combatStatistics.physicalDmgTaken ?? 0) + (c.combatStatistics.magicDmgTaken ?? 0);
/** While tracing, before an action: every fighter's HP, damage taken and healing taken so far, and the actor's misses. */
let snap: { at: Map<Any, [number, number, number]>; misses: number } | undefined;
/** The battle the last traced action was in, and its number since traceStart (-1: none yet). */
let traceBattle: { b?: Battle; no: number } = { no: -1 };

/** What the trace adds for display (U39): reads the fighters, changes nothing. */
function traceDetail(b: Battle, c: Combatant): Pick<TraceEntry, "did" | "hits" | "fx" | "misses" | "battle" | "life"> {
  const hits: TraceHit[] = [], fx: TraceEffect[] = [];
  for (const [who, f] of fighters(b)) {
    const was = snap?.at.get(f);
    if (was) {
      const taken = Math.max(0, takenOf(f) - was[1]), healed = (f.combatStatistics.healingTaken ?? 0) - was[2];
      const net = f.questHP - was[0];
      // Damage from the damage taken (an HP loss without it, e.g. a sacrifice, counts too); healing as the HP it gave back.
      const dmg = taken || Math.max(0, -net);
      const heal = healed > 0 ? Math.max(0, net + dmg) : 0;
      if (dmg > 0 || heal > 0) hits.push({ who, dmg: Math.round(dmg), heal: Math.round(heal), hp: f.questHP, maxHP: f.maxHP });
    }
    for (const e of f.effectList) {
      const stats = e.stats && typeof e.stats === "object"
        ? Object.fromEntries(Object.entries(e.stats).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined;
      fx.push({ who, name: e.name ?? "?", debuff: Boolean(e.debuff), ...(typeof e.turns === "number" ? { turns: e.turns } : {}),
        ...(stats && Object.keys(stats).length ? { stats } : {}) });
    }
  }
  if (b !== traceBattle.b) traceBattle = { b, no: traceBattle.no + 1 };
  const life = fighters(b).map(([who, f]) => ({ who, hp: f.questHP, maxHP: f.maxHP }));
  return { did: c._did ?? null, hits, fx, misses: snap ? (c.combatStatistics.misses ?? 0) - snap.misses : 0, battle: traceBattle.no, life };
}

hooks.beforeAction = (c) => {
  const b = current.battle;
  if (trace && b) {
    snap = { at: new Map(fighters(b).map(([, f]) => [f, [f.questHP, takenOf(f), f.combatStatistics.healingTaken ?? 0]])),
      misses: c.combatStatistics.misses ?? 0 };
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
    });
    snap = undefined;
  }
};

/** Record every action of the next fights (like sim.traceStart / sim.traceStop). */
export function traceStart(): void {
  trace = [];
  traceBattle = { no: -1 };
}
export function traceStop(): TraceEntry[] {
  const t = trace ?? [];
  trace = undefined;
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
      status: c.status, grade: c.grade ?? 0 });
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
