/**
 * Schedule-aware view of a fight: enemy timelines and skill effect tags (inventory/timelines.json, from the skill
 * probe), and a cheap counter-schedule score for a party's rotations against an enemy's timeline.
 *
 * A fight is a 5-turn timetable: on turn t every combatant plays slot ((t - 1) mod 5) + 1 of its rotation, heroes in
 * the order back 1, front 1, back 2, front 2, back 3, front 3, then the enemy (the enemy first on questType 6). So
 * hero slot k always meets enemy slot k, and a rotation can be timed against the enemy's: cleanse right after its
 * debuff, no damage into its reflect, buffs before the damage dealers act, heals after its big hits.
 *
 * The score is a heuristic (no randomness, no HP), meant to rank candidate rotations before simulating them.
 * Pure, worker-safe.
 */
import { G } from "../sim/data.ts";
import { Enemy } from "../sim/enemy.ts";
import { calculateReduction } from "../sim/stats.ts";
import type { Row } from "./engine.ts";
import type { EffectInfo, EnemyTimeline, SkillProfile, SkillTag, TimelinesData } from "./skill-probe.ts";
import { timelineKey } from "./skill-probe.ts";

export type { EffectInfo, EnemyTimeline, SkillProfile, SkillTag, TimelinesData };

let data: TimelinesData | undefined;

/** Loads inventory/timelines.json (once per page or worker). */
export function loadTimelines(json: TimelinesData): void {
  data = json;
}

/** True once loadTimelines ran (searches use the schedule pre-filter only then). */
export const hasTimelines = (): boolean => data !== undefined;

function need(): TimelinesData {
  if (!data) throw new Error("timelines not loaded (loadTimelines)");
  return data;
}

export function enemyTimeline(quest: number, rare = false): EnemyTimeline {
  const t = need().timelines[timelineKey(quest, rare)];
  if (!t) throw new Error(`no timeline for quest ${quest}${rare ? " (rare)" : ""}`);
  return t;
}

/** What a skill does; `side` picks the hero or the enemy version when both exist (Basic, Slash...). */
export function skillProfile(name: string, side: "hero" | "enemy" = "hero"): SkillProfile | undefined {
  const d = need();
  return side === "hero" ? d.heroSkills[name] ?? d.enemySkills[name] : d.enemySkills[name] ?? d.heroSkills[name];
}

export function skillTags(name: string, side: "hero" | "enemy" = "hero"): SkillTag[] {
  return skillProfile(name, side)?.tags ?? [];
}

// ---------------------------------------------------------------- scorer

export interface PartyMember {
  /** Party location 1-6: back row 1, 3, 5 and front row 2, 4, 6 (back 1 acts first). */
  location: number;
  /** 5 hero skill names. */
  rotation: string[];
}

export interface ScoreNote {
  turn: number;
  location: number;
  skill: string;
  delta: number;
  why: string;
}

export interface ScheduleScore {
  total: number;
  /** Score per turn of the 5-turn cycle (index 0 = turn 1). */
  perTurn: number[];
  notes: ScoreNote[];
  /**
   * By party location: the 5 skills each hero really plays in the scored cycle, a forced action (Drown) in place of the
   * planned skill. Rotations that play the same are the same rotation for the score (the pre-filter keeps one).
   */
  played: Record<number, string[]>;
  /**
   * With stats (ctx): the HP race over the scored cycle. Enemy HP dealt (%), cycles to kill it; per hero, HP taken and
   * healed (%) and cycles until it dies (Infinity when healing keeps up); ratio = first death / kill (>= 1: in time).
   */
  race?: { dealt: number; killCycles: number; ratio: number;
    heroes: { location: number; incoming: number; healed: number; deathCycles: number }[];
    /** The multi-cycle race (deaths, revives): won or not, after how many cycles, deaths and revives on the way. */
    outcome: { won: boolean; cycles: number; enemyLeft: number; deaths: number; revives: number } };
}

/**
 * Real stats for the score's units: with it, damage counts as % of the enemy's HP and protection (defence, heals)
 * as % of a hero's HP, so both sides weigh the same; without it, both are in Basic-attack units.
 */
export interface ScheduleContext {
  enemyHP: number;
  /** By party location: a Basic hit on the enemy and an enemy Basic hit on the hero (after def / mdef), its max HP. */
  heroes: Record<number, { hit: number; taken: number; maxHP: number; stats: Record<string, number> }>;
  /** The enemy's raw atk and matk (its Basic hit before the hero's defences). */
  enemy?: { atk: number; matk: number };
}

/** Context from the party (front / back rows of engine heroes) and the quest's enemy. */
export function scheduleContext(quest: number, front: Row, back: Row, o: { rare?: boolean; amount?: number } = {}): ScheduleContext {
  if (!G.questData[quest]) throw new Error(`unknown quest ${quest}`);
  const e = new Enemy({ questID: quest, isRare: o.rare ?? false, amount: o.amount ?? 1 });
  const heroes: ScheduleContext["heroes"] = {};
  const add = (h: Row[number], loc: number) => {
    if (!h) return;
    h.determineStats();
    heroes[loc] = {
      hit: h.atk * calculateReduction(e.def, h.defPen) + h.matk * calculateReduction(e.mdef, h.mdefPen),
      taken: e.atk * calculateReduction(h.def) + e.matk * calculateReduction(h.mdef),
      maxHP: h.maxHP,
      stats: { atk: h.atk, matk: h.matk, acc: h.acc, def: h.def, mdef: h.mdef, crit: h.crit ?? 0, critMod: h.critMod ?? 2, level: h.level ?? 1 },
    };
  };
  front.forEach((h, i) => add(h, 2 * i + 2));
  back.forEach((h, i) => add(h, 2 * i + 1));
  return { enemyHP: e.maxHP, heroes, enemy: { atk: e.atk, matk: e.matk } };
}

export interface ScoreWeights {
  damage: number;
  reflect: number;
  counter: number;
  cleanse: number;
  wastedCleanse: number;
  defence: number;
  heal: number;
  idleHeal: number;
  dispel: number;
  stunLoss: number;
  /** HP race (with ctx): its result, scored like evaluate's score / 100, times W; the per-cycle terms then weigh 0.1. 0 = off. */
  race: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  damage: 1, reflect: 2, counter: 0.5, cleanse: 0.5, wastedCleanse: 0.5, defence: 0.6, heal: 0.6, idleHeal: 0.1,
  dispel: 0.4, stunLoss: 1, race: 1,
};

/** Damage only: every utility and survival term off (the pre-filter's second list, and the baseline). */
export const DAMAGE_ONLY: Partial<ScoreWeights> = {
  reflect: 0, counter: 0, cleanse: 0, wastedCleanse: 0, defence: 0, heal: 0, idleHeal: 0, dispel: 0, stunLoss: 0, race: 0,
};

const slotOf = (turn: number) => ((turn - 1) % 5) + 1;
const ORDER = [1, 2, 3, 4, 5, 6];

/** Offensive weight of an effect's stats (atk / matk %, accuracy, crit). */
function offence(e: EffectInfo): number {
  const s = e.stats ?? {};
  // crit and critMod are counted through the expected crit multiplier (scoreSchedule)
  return Math.max(0, (s.atk ?? 0) + (s.matk ?? 0) + 0.5 * (s.acc ?? 0) +
    (s.atkBns ? 0.3 : 0) + (s.matkBns ? 0.3 : 0) + (s.lckMod ? 0.05 : 0));
}

/** Defensive weight on the owner: def / mdef / eva %, shields (less damage taken in the probe's test hit). */
function defence(e: EffectInfo): number {
  if (e.kind === "shield" || e.kind === "reflect") {
    const t = e.test;
    return t ? Math.max(0, 1 - (t.physical + t.magical) / 2) : 0.3;
  }
  if (e.kind === "hot") return 0.3;
  const s = e.stats ?? {};
  return Math.max(0, 0.5 * ((s.def ?? 0) + (s.mdef ?? 0)) + 0.5 * (s.eva ?? 0) + (s.maxHP ?? 0));
}

/** How much an effect on heroes hurts them (cleanse value). */
function severity(e: EffectInfo): number {
  if (e.kind === "stun") return 3;
  if (e.kind === "force-action" || e.kind === "stat-swap") return 2;
  if (e.kind === "dot" || e.kind === "miss-chance") return 1;
  const s = e.stats ?? {};
  return Math.min(2, Object.values(s).reduce((a, v) => a + (v < 0 ? -v : 0), 0));
}

/** A hero-applied effect: windows are the probe's offsets from its cast turn. */
interface Active {
  e: EffectInfo;
  from: number;
  caster: number;
  /** next-hit / next-attack effects end at their first use. */
  used?: boolean;
}

/** Locations that act after `loc` in a turn (heroes act back 1, front 1, back 2...: by location). */
const after = (a: number, b: number) => b > a;

/**
 * Counter-schedule score of a party's rotations against an enemy timeline, over one steady-state 5-turn cycle
 * (a first cycle warms buffs up). Higher is better. Components, per hero action:
 * - damage: the skill's power (raw damage over Basic) x (1 + active offensive buffs and enemy debuffs);
 *   minus what the enemy's reflect / counter / shield windows take back on that turn;
 * - cleanse: the hero debuffs it removes (severity x turns they had left), or a penalty when nothing is there;
 * - dispel: the enemy buffs it removes; defence: shields and def buffs active when the enemy hits, x its power;
 * - heal: after enemy damage (more when it hit hard), little otherwise; stuns: the stunned action counts 0.
 */
export function scoreSchedule(party: PartyMember[], tl: EnemyTimeline, w: Partial<ScoreWeights> = {},
  ctx?: ScheduleContext): ScheduleScore {
  const W = { ...DEFAULT_WEIGHTS, ...w };
  // units: % of the enemy's HP per hero power point, % of a hero's HP per enemy power point (1 without context)
  const dU = (loc: number) => (ctx?.heroes[loc] ? (100 * ctx.heroes[loc].hit) / ctx.enemyHP : 1);
  const hU = (loc: number) => (ctx?.heroes[loc] ? (100 * ctx.heroes[loc].taken) / ctx.heroes[loc].maxHP : 1);
  const HEAL_CAP = ctx ? 25 : 2; // what one heal can give back, per hero
  /** A hero skill's power for this hero: its damage scaling on the hero's stats, over the hero's Basic (atk + matk). */
  const powerOf = (p: SkillProfile, loc: number) => {
    const st = ctx?.heroes[loc]?.stats;
    if (!st || !p.scaling) return p.power;
    const raw = Object.entries(p.scaling).reduce((a, [k, c]) => a + (c ?? 0) * (st[k] ?? 0), 0);
    return raw / Math.max(st.atk + st.matk, 1);
  };
  const byLoc = new Map(party.map((m) => [m.location, m]));
  const order = ORDER.filter((l) => byLoc.has(l));
  const perTurn = [0, 0, 0, 0, 0];
  const notes: ScoreNote[] = [];
  const played: Record<number, string[]> = Object.fromEntries(party.map((m) => [m.location, [...m.rotation]]));
  let heroFx: Active[] = []; // hero-applied effects on heroes (self or party)
  let enemyFx: Active[] = []; // hero-applied effects on the enemy
  const cleansed = new Map<string, number>(); // "slot:location" -> turn that hero's debuff from that slot was cleansed
  const dispelled = new Map<number, number>();
  const hurt = new Map<number, number>(); // damage taken since the hero was last healed
  const incoming = new Map<number, number>(), healed = new Map<number, number>(); // scored cycle, % HP
  let dealt = 0; // scored cycle, % of the enemy's HP (with ctx)
  const dealtBy = new Map<number, number>(); // per hero, scored cycle
  const healCap = new Map<string, number>(); // "from>to": HP % a hero's heals can give a target per cycle
  const revivesBy = new Map<number, number>(); // Revive casts per cycle
  const targeted = new Map<number, number>(); // the part of `incoming` from attacks that pick targets (not area)
  // utility (cleanse, dispel) in the same units: the party's mean of both
  /**
   * Damage (% of the hero's max HP per point of enemy power) of the enemy's skill `s` on hero `loc` at turn t: its
   * physical / magical / true mix against the hero's def / mdef, with the enemy's def / mdef cuts on that hero active
   * then (Terrify II: mdef -50 %). Without stats: 1.
   */
  const hUAt = (loc: number, t: number, s: SkillProfile, own: { def: number; mdef: number; phys: number; mag: number } =
    { def: 0, mdef: 0, phys: 1, mag: 1 }) => {
    const c = ctx?.heroes[loc];
    if (!c || !ctx?.enemy) return hU(loc);
    // own: the hero's def / mdef % buffs and shield multipliers (physical / magical damage kept) at that moment
    let defPct = own.def, mdefPct = own.mdef;
    for (const x of enemyWindow(t, (e) => e.facingTurns, (e) => e.on === "heroes")) {
      if (!(x.e.locations ?? ORDER).includes(loc) || isRemoved(`${x.k}:${loc}`, t, cleansed)) continue;
      defPct += x.e.stats?.def ?? 0;
      mdefPct += x.e.stats?.mdef ?? 0;
    }
    const mix = s.mix ?? { physical: 0.5, magical: 0.5, true: 0 };
    const raw = ctx.enemy.atk + ctx.enemy.matk;
    const taken = raw * (mix.physical * own.phys * calculateReduction(c.stats.def * Math.max(0, 1 + defPct)) +
      mix.magical * own.mag * calculateReduction(c.stats.mdef * Math.max(0, 1 + mdefPct)) + mix.true);
    return (100 * taken) / c.maxHP;
  };
  const U = ctx ? order.reduce((a, l) => a + (dU(l) + hU(l)) / 2, 0) / Math.max(order.length, 1) : 1;

  /** Enemy effects cast at slot k whose window (offsets) covers turn t. */
  const enemyWindow = (t: number, pick: (e: EffectInfo) => number[], filter: (e: EffectInfo) => boolean) => {
    const out: { k: number; e: EffectInfo; d: number; offsets: number[] }[] = [];
    for (let k = 1; k <= 5; k++) {
      for (const e of tl.slots[k - 1].effects) {
        if (!filter(e)) continue;
        const offs = pick(e);
        // the cycle repeats every 5 turns: a window of d turns after slot k reaches turn t when (t - k) mod 5 = d
        for (let back = 0; back <= 10; back += 5) {
          const d = ((t - k) % 5 + 5) % 5 + back;
          if (offs.includes(d) && t - d >= 1) {
            out.push({ k, e, d, offsets: offs });
            break;
          }
        }
      }
    }
    return out;
  };
  // a hero-applied effect is on when the offset from its cast is in its window; the cast turn (offset 0) counts for
  // heroes acting after the caster (the probe's caster is back 1, so its windows are those of a first actor)
  const onHero = (loc: number, t: number) => heroFx.filter((x) => !x.used && (x.e.on === "party" || x.caster === loc) &&
    ((x.e.on === "party" && loc !== x.caster ? [0, ...x.e.ownerTurns] : x.e.ownerTurns).includes(t - x.from)) &&
    !(t === x.from && !after(x.caster, loc)));
  const heroFacing = (loc: number, t: number) => heroFx.filter((x) => !x.used && (x.e.on === "party" || x.caster === loc) &&
    x.e.facingTurns.includes(t - x.from));
  const enemyFacing = (loc: number, t: number) => enemyFx.filter((x) => !x.used && x.e.facingTurns.includes(t - x.from) &&
    !(t === x.from && !after(x.caster, loc)));
  const enemyOwn = (t: number) => enemyFx.filter((x) => !x.used && x.e.ownerTurns.includes(t - x.from));
  const isRemoved = <K>(k: K, t: number, map: Map<K, number>) => {
    const c = map.get(k);
    return c !== undefined && c <= t && t - c < 5;
  };

  const enemyAct = (t: number) => {
    const s = tl.slots[slotOf(t) - 1];
    if (s.power > 0) {
      const hits = s.hits ?? [];
      // the probe hit a full party; this one may have fewer heroes: a row attack on an empty row falls on the other
      // row, and split damage (Basic: shared over the front row) is shared by the heroes actually there
      let targets = order.filter((l) => hits.includes(l));
      if (!targets.length && hits.length) {
        targets = hits.every((l) => l % 2 === 0) ? order.filter((l) => l % 2 === 1)
          : hits.every((l) => l % 2 === 1) ? order.filter((l) => l % 2 === 0) : [];
      }
      let per = s.tags.includes("damage-split") ? (s.power * hits.length) / Math.max(targets.length, 1) : s.power;
      // a taunt sends this whole attack to the taunter alone (its damage ratio becomes the taunter's location)
      const taunt = enemyOwn(t).find((x) => x.e.kind === "taunt");
      if (taunt) {
        taunt.used = true;
        targets = [taunt.caster];
        per = s.tags.includes("damage-split") ? s.power * hits.length : s.power;
        if (t > 5) notes.push({ turn: slotOf(t), location: taunt.caster, skill: s.name, delta: 0, why: `taunted: ${s.name} hits only location ${taunt.caster}` });
      }
      let saved = 0;
      for (const l of targets) {
        const fx = heroFacing(l, t);
        let hUt: number, def: number;
        if (ctx?.heroes[l] && ctx.enemy) {
          // with stats: def / mdef buffs go into the damage formula, shields cut their damage type (probe test hit)
          const own = { def: 0, mdef: 0, phys: 1, mag: 1 };
          for (const x of fx) {
            if ((x.e.kind === "shield" || x.e.kind === "reflect") && x.e.test) {
              own.phys *= x.e.test.physical;
              own.mag *= x.e.test.magical;
            } else {
              own.def += x.e.stats?.def ?? 0;
              own.mdef += x.e.stats?.mdef ?? 0;
            }
          }
          const bare = hUAt(l, t, s);
          hUt = bare;
          def = bare > 0 ? 1 - hUAt(l, t, s, own) / bare : 0;
        } else {
          hUt = hUAt(l, t, s);
          def = Math.min(1, fx.reduce((a, x) => a + defence(x.e), 0));
        }
        saved += def * per * hUt;
        hurt.set(l, (hurt.get(l) ?? 0) + per * hUt * (1 - def));
        if (t > 5) incoming.set(l, (incoming.get(l) ?? 0) + per * hUt * (1 - def));
        if (t > 5 && !s.tags.includes("damage-aoe")) targeted.set(l, (targeted.get(l) ?? 0) + per * hUt * (1 - def));
        for (const x of fx) if (x.e.until === "next-hit") x.used = true;
      }
      // hero debuffs on the enemy that weaken its attack (Ambush: atk -35 %); a taunt counts as cover
      const weak = enemyOwn(t).reduce((a, x) => a + Math.max(0, -(x.e.stats?.atk ?? 0) - (x.e.stats?.matk ?? 0)), 0);
      for (const x of enemyOwn(t)) if (x.e.until === "next-attack") x.used = true;
      saved += weak * per * targets.reduce((a, l) => a + hU(l), 0);
      if (saved > 0) {
        const v = W.defence * saved;
        if (t > 5) perTurn[slotOf(t) - 1] += v;
        if (t > 5) notes.push({ turn: slotOf(t), location: 0, skill: s.name, delta: v, why: "defence up when the enemy hits" });
      }
    }
  };

  for (let t = 1; t <= 10; t++) {
    const slot = slotOf(t);
    const score = t > 5;
    if (tl.enemyFirst) enemyAct(t);
    for (const loc of order) {
      const m = byLoc.get(loc)!;
      const planned = m.rotation[slot - 1] ?? "Basic";
      let v = 0;
      const why: string[] = [];
      // enemy-cast effects on this hero now (not cleansed)
      const onMe = enemyWindow(t, (e) => e.ownerTurns, (e) => e.on === "heroes").filter((x) =>
        (x.e.locations ?? ORDER).includes(loc) && !isRemoved(`${x.k}:${loc}`, t, cleansed));
      const stunned = onMe.find((x) => x.e.kind === "stun");
      // a forced action (Drown: the hero's next 2 actions, Combatant:determineAction's OnDetermineAction trigger)
      // replaces the planned skill: the hero plays Basic, so the planned skill's damage, heal, cleanse or buff is lost.
      // Drown is the only one in the game, and it forces Basic (data.AbilityFunc.lua:2247).
      const forced = stunned ? undefined : onMe.find((x) => x.e.kind === "force-action");
      const name = forced ? "Basic" : planned;
      if (score) played[loc][slot - 1] = name;
      if (forced && planned !== "Basic") why.push(`forced to Basic by ${tl.slots[forced.k - 1].name} (planned ${planned})`);
      const p = skillProfile(name, "hero");
      const mine = onHero(loc, t);
      if (stunned) {
        why.push(`stunned by ${tl.slots[stunned.k - 1].name}`);
      } else if (p) {
        // damage
        const pw = powerOf(p, loc);
        if (pw > 0) {
          const buffs = mine.reduce((a, x) => a + offence(x.e), 0);
          for (const x of mine) if (x.e.until === "next-attack") x.used = true;
          const debuffs = enemyFacing(loc, t).reduce((a, x) => a + (x.e.kind === "vulnerability"
            ? Math.max(0, ((x.e.stats?.physicalDamage ?? 1) - 1))
            : Math.max(0, -(x.e.stats?.def ?? 0) * (p.mix?.physical ?? 1) - (x.e.stats?.mdef ?? 0) * (p.mix?.magical ?? 0))), 0);
          const mine2 = onMe.reduce((a, x) => a + Math.max(0, -((x.e.stats?.atk ?? 0) * (p.mix?.physical ?? 1) + (x.e.stats?.matk ?? 0) * (p.mix?.magical ?? 0))), 0);
          // expected crit: chance (hero crit + crit buffs, %) x (critMod - 1); plus %-of-enemy-HP damage on a crit
          // (Berserk Smash: 3 % of its current HP, taken as 80 % of its max on average)
          const st = ctx?.heroes[loc]?.stats;
          const pc = Math.min(1, Math.max(0, ((st?.crit ?? 0) + mine.reduce((a, x) => a + (x.e.stats?.crit ?? 0), 0)) / 100));
          const cm = Math.max(1, (st?.critMod ?? 2) + mine.reduce((a, x) => a + (x.e.stats?.critMod ?? 0), 0));
          const critF = 1 + pc * (cm - 1);
          let dmg = W.damage * pw * dU(loc) * critF * Math.max(0, 1 + buffs + debuffs - mine2);
          if (p.critHpPct && pc > 0) {
            dmg += W.damage * p.critHpPct * pc * 100 * 0.8 * (ctx ? 1 : 1 / Math.max(dU(loc), 1e-9));
            why.push(`crit ${Math.round(100 * pc)} %: +${(100 * p.critHpPct).toFixed(0)} % enemy HP`);
          }
          if (buffs + debuffs > 0) why.push(`damage x${(1 + buffs + debuffs).toFixed(2)}`);
          // enemy windows facing this hero action
          for (const x of enemyWindow(t, (e) => e.facingTurns, (e) => e.on === "self" || e.on === "party")) {
            if (isRemoved(x.k, t, dispelled)) continue;
            const mix = p.mix ?? { physical: 1, magical: 0, true: 0 };
            const tt = x.e.test;
            if (x.e.kind === "reflect" && tt) {
              const back = mix.physical * (1 - tt.physical) + mix.magical * (1 - tt.magical);
              if (back > 0) {
                dmg -= (W.reflect / 2) * pw * back * (dU(loc) + (ctx?.heroes[loc] ? (100 * ctx.heroes[loc].hit) / ctx.heroes[loc].maxHP : 1));
                why.push(`into ${x.e.name}`);
              }
            } else if (x.e.kind === "counter" && tt?.reflected) {
              dmg -= W.counter;
              why.push(`into ${x.e.name} (counter)`);
            } else if (x.e.kind === "shield" && tt) {
              const cut = mix.physical * (1 - tt.physical) + mix.magical * (1 - tt.magical);
              if (cut > 0) {
                dmg -= W.damage * pw * dU(loc) * cut;
                why.push(`into ${x.e.name} (shield)`);
              }
            }
          }
          v += dmg;
          if (score && dmg > 0) {
            dealt += dmg / W.damage;
            dealtBy.set(loc, (dealtBy.get(loc) ?? 0) + dmg / W.damage);
          }
        }
        // cleanse: removes the removable debuffs on the party (or itself) now. Their effect on later actions (lost
        // damage, stuns) then simply stops counting; harm the score doesn't model (damage over time, stat swaps,
        // def / mdef cuts) is credited here: severity x the turns it had left.
        if (p.tags.includes("cleanse") || p.tags.includes("cleanse-self")) {
          const scope = p.tags.includes("cleanse") ? order : [loc];
          const on = enemyWindow(t, (e) => e.ownerTurns, (e) => e.on === "heroes" && e.removable)
            .flatMap((x) => scope.filter((l) => (x.e.locations ?? ORDER).includes(l) && !isRemoved(`${x.k}:${l}`, t, cleansed))
              .map((l) => ({ ...x, l })));
          if (on.length) {
            let gain = 0;
            for (const x of on) {
              const left = x.offsets.filter((d) => d > x.d).length;
              const st = x.e.stats ?? {};
              const unmodelled = ["dot", "stat-swap", "force-action", "miss-chance"].includes(x.e.kind) ? severity(x.e)
                : Math.max(0, -(st.def ?? 0) - (st.mdef ?? 0)) * 0.5;
              gain += unmodelled * left * (x.l === loc ? hU(loc) : hU(x.l)) ;
              cleansed.set(`${x.k}:${x.l}`, t);
            }
            v += W.cleanse * gain;
            why.push(`cleanses ${[...new Set(on.map((x) => x.e.name))].join(", ")}`);
          } else {
            v -= W.wastedCleanse * U;
            why.push("nothing to cleanse");
          }
        }
        // dispel: removable enemy buffs active now
        if (p.tags.includes("dispel")) {
          const on = enemyWindow(t, (e) => e.facingTurns, (e) => (e.on === "self" || e.on === "party") && e.removable)
            .filter((x) => !isRemoved(x.k, t, dispelled));
          for (const x of on) {
            const left = x.offsets.filter((d) => d > x.d).length + 1;
            v += W.dispel * U * left * (x.e.kind === "reflect" || x.e.kind === "shield" ? 2 : Math.max(0.5, offence(x.e) + defence(x.e)));
            dispelled.set(x.k, t);
          }
          if (on.length) why.push(`dispels ${on.map((x) => x.e.name).join(", ")}`);
        }
        // heals: worth more right after enemy damage
        if (p.tags.includes("revive") && score) revivesBy.set(loc, (revivesBy.get(loc) ?? 0) + 1);
        if (p.tags.some((g) => g.startsWith("heal"))) {
          const who = p.tags.includes("heal-party") || p.tags.includes("heal-over-time") ? order
            : p.tags.includes("heal-ally") ? [order.find((l) => l === loc + 1) ?? loc] : [loc];
          // with stats: the heal's real size (probe's healScaling on the caster), in % of each target's max HP
          const st = ctx?.heroes[loc]?.stats, hs = p.healScaling;
          const amount = st && hs ? Object.entries(hs).reduce((a, [k, c]) => a + (c ?? 0) * (k === "const" ? 1 : st[k] ?? 0), 0) : undefined;
          let back = 0;
          for (const l of who) {
            const cap = amount !== undefined && ctx?.heroes[l] ? (100 * amount) / ctx.heroes[l].maxHP : HEAL_CAP;
            const got = Math.min(cap, hurt.get(l) ?? 0);
            if (score) healCap.set(`${loc}>${l}`, (healCap.get(`${loc}>${l}`) ?? 0) + cap);
            back += got;
            hurt.set(l, (hurt.get(l) ?? 0) - got);
            if (score) healed.set(l, (healed.get(l) ?? 0) + got);
          }
          v += back > 0 ? W.heal * back : W.idleHeal;
          why.push(back > 0 ? "heals after enemy damage" : "heals with no damage taken");
        }
        // a taunt's worth comes through the race (it moves the next attack onto the taunter); without stats, a flat bit
        if (p.tags.includes("taunt") && !ctx) v += 0.3 * (tl.slots[slotOf(tl.enemyFirst ? t + 1 : t) - 1].power);
        if (p.tags.includes("amplify")) v += 0.3 * enemyFacing(loc, t).length;
        // new effects from this skill (same name: replaced; permanent stacking ones keep their first window here)
        for (const e of p.effects) {
          if (e.on === "enemy") enemyFx = [...enemyFx.filter((x) => x.e.name !== e.name), { e, from: t, caster: loc }];
          else if (e.on === "self" || e.on === "party") {
            heroFx = [...heroFx.filter((x) => !(x.e.name === e.name && (e.on === "party" || x.caster === loc))), { e, from: t, caster: loc }];
          }
        }
      }
      if (score) {
        perTurn[slot - 1] += v;
        if (why.length) notes.push({ turn: slot, location: loc, skill: name, delta: v, why: why.join("; ") });
      }
    }
    if (!tl.enemyFirst) enemyAct(t);
  }
  let total = perTurn.reduce((a, b) => a + b, 0);
  // HP race over the cycles, from this cycle's per-hero rates: damage dealt, damage taken, heal capacity, revives.
  // A hero falls when its HP runs out: it stops dealing damage, and its share of the targeted attacks goes to the heroes
  // left (area attacks just hit one fewer). A
  // living reviver brings a dead hero back at 50 % HP (Revive: 50 % of max). Lost at 40 cycles (the 200-turn limit).
  // Heals that can't keep up, or too little damage, lose it however well they are timed.
  let race: ScheduleScore["race"];
  if (ctx) {
    const killCycles = dealt > 0 ? 100 / dealt : Infinity;
    const heroes = order.map((l) => {
      const inc = incoming.get(l) ?? 0, hl = healed.get(l) ?? 0, net = inc - hl;
      return { location: l, incoming: inc, healed: hl, deathCycles: net > 1e-9 ? 100 / net : Infinity };
    });
    const outcome = raceOutcome(order, incoming, targeted, dealtBy, healCap, revivesBy);
    // the race's result scored like evaluate's `score` (combat.ts), / 100: a win first, then fewer turns and HP left;
    // a loss by the enemy HP removed, then surviving longer. The per-cycle terms (damage, cleanse, buff timing...)
    // already shaped its rates, so they only break ties (x 0.1); their heal and defence credits would count twice.
    const turns = outcome.cycles * 5, removed = 1 - outcome.enemyLeft / 100;
    const simLike = outcome.won ? 1e6 + 1e4 - turns * 10 + outcome.hpLeft * 5 : removed * 1e4 + removed * 1e3 + Math.min(turns, 200) * 0.5;
    const ratio = outcome.won ? 1.5 + outcome.hpLeft / 2 : removed;
    race = { dealt, killCycles, ratio, heroes,
      outcome: { won: outcome.won, cycles: outcome.cycles, enemyLeft: outcome.enemyLeft, deaths: outcome.deaths, revives: outcome.revives } };
    if (W.race > 0) total = W.race * (simLike / 100) + 0.1 * total;
  }
  return { total, perTurn, notes, played, ...(race ? { race } : {}) };
}

/** The race simulated in steps of 1/20 cycle (see scoreSchedule). Rates are per 5-turn cycle, in % HP. */
export function raceOutcome(order: number[], incoming: Map<number, number>, targeted: Map<number, number>, dealtBy: Map<number, number>,
  healCap: Map<string, number>, revivesBy: Map<number, number>) {
  const hp = new Map(order.map((l) => [l, 100]));
  const alive = new Set(order);
  const credit = new Map<number, number>();
  let enemy = 100, deaths = 0, revives = 0, c = 0;
  const dt = 0.05;
  for (; c < 40; c += dt) {
    const living = order.filter((l) => alive.has(l));
    if (!living.length) break;
    // a dead hero's share of targeted attacks goes to the others (area attacks just hit one hero fewer)
    const extra = order.filter((l) => !alive.has(l)).reduce((a, l) => a + (targeted.get(l) ?? 0), 0) / living.length;
    for (const l of living) {
      const heal = living.reduce((a, h) => a + (healCap.get(`${h}>${l}`) ?? 0), 0);
      hp.set(l, Math.min(100, hp.get(l)! - ((incoming.get(l) ?? 0) + extra - heal) * dt));
    }
    enemy -= living.reduce((a, l) => a + (dealtBy.get(l) ?? 0), 0) * dt;
    if (enemy <= 0) break;
    for (const l of living) if (hp.get(l)! <= 0) (alive.delete(l), hp.set(l, 0), deaths++);
    for (const h of order.filter((l) => alive.has(l) && (revivesBy.get(l) ?? 0) > 0)) {
      credit.set(h, (credit.get(h) ?? 0) + revivesBy.get(h)! * dt);
      while (credit.get(h)! >= 1) {
        const dead = order.find((l) => !alive.has(l));
        if (dead === undefined) {
          credit.set(h, 0); // a revive with nobody dead is a wasted action
          break;
        }
        alive.add(dead);
        hp.set(dead, 50);
        revives++;
        credit.set(h, credit.get(h)! - 1);
      }
    }
  }
  const won = enemy <= 0;
  const hpLeft = won ? order.reduce((a, l) => a + (alive.has(l) ? hp.get(l)! : 0), 0) / (100 * order.length) : 0;
  return { won, cycles: Math.round(c * 100) / 100, enemyLeft: Math.max(0, Math.round(enemy * 10) / 10), hpLeft, deaths, revives };
}

/** Spearman rank correlation (average ranks for ties). */
export function spearman(a: number[], b: number[]): number {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(x.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
