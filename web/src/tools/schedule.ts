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
}

/**
 * Real stats for the score's units: with it, damage counts as % of the enemy's HP and protection (defence, heals)
 * as % of a hero's HP, so both sides weigh the same; without it, both are in Basic-attack units.
 */
export interface ScheduleContext {
  enemyHP: number;
  /** By party location: a Basic hit on the enemy and an enemy Basic hit on the hero (after def / mdef), its max HP. */
  heroes: Record<number, { hit: number; taken: number; maxHP: number; stats: Record<string, number> }>;
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
      stats: { atk: h.atk, matk: h.matk, acc: h.acc, def: h.def, mdef: h.mdef },
    };
  };
  front.forEach((h, i) => add(h, 2 * i + 2));
  back.forEach((h, i) => add(h, 2 * i + 1));
  return { enemyHP: e.maxHP, heroes };
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
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  damage: 1, reflect: 2, counter: 0.5, cleanse: 0.5, wastedCleanse: 0.5, defence: 0.6, heal: 0.6, idleHeal: 0.1,
  dispel: 0.4, stunLoss: 1,
};

const slotOf = (turn: number) => ((turn - 1) % 5) + 1;
const ORDER = [1, 2, 3, 4, 5, 6];

/** Offensive weight of an effect's stats (atk / matk %, accuracy, crit). */
function offence(e: EffectInfo): number {
  const s = e.stats ?? {};
  return Math.max(0, (s.atk ?? 0) + (s.matk ?? 0) + 0.5 * (s.acc ?? 0) + (s.crit ?? 0) / 100 + 0.3 * (s.critMod ?? 0) +
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
  let heroFx: Active[] = []; // hero-applied effects on heroes (self or party)
  let enemyFx: Active[] = []; // hero-applied effects on the enemy
  const cleansed = new Map<string, number>(); // "slot:location" -> turn that hero's debuff from that slot was cleansed
  const dispelled = new Map<number, number>();
  const hurt = new Map<number, number>(); // damage taken since the hero was last healed
  // utility (cleanse, dispel) in the same units: the party's mean of both
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
      const targets = order.filter((l) => hits.includes(l));
      const n = targets.length || 1;
      let saved = 0;
      for (const l of targets) {
        const fx = heroFacing(l, t);
        const def = Math.min(1, fx.reduce((a, x) => a + defence(x.e), 0));
        saved += (def * s.power * hU(l) * targets.length) / n;
        hurt.set(l, (hurt.get(l) ?? 0) + s.power * hU(l) * (1 - def));
        for (const x of fx) if (x.e.until === "next-hit") x.used = true;
      }
      // hero debuffs on the enemy that weaken its attack (Ambush: atk -35 %); a taunt counts as cover
      const weak = enemyOwn(t).reduce((a, x) => a + Math.max(0, -(x.e.stats?.atk ?? 0) - (x.e.stats?.matk ?? 0)), 0);
      for (const x of enemyOwn(t)) if (x.e.until === "next-attack") x.used = true;
      saved += weak * s.power * targets.reduce((a, l) => a + hU(l), 0);
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
      const name = m.rotation[slot - 1] ?? "Basic";
      const p = skillProfile(name, "hero");
      let v = 0;
      const why: string[] = [];
      // enemy-cast effects on this hero now (not cleansed)
      const onMe = enemyWindow(t, (e) => e.ownerTurns, (e) => e.on === "heroes").filter((x) =>
        (x.e.locations ?? ORDER).includes(loc) && !isRemoved(`${x.k}:${loc}`, t, cleansed));
      const stunned = onMe.find((x) => x.e.kind === "stun");
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
          let dmg = W.damage * pw * dU(loc) * Math.max(0, 1 + buffs + debuffs - mine2);
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
        if (p.tags.some((g) => g.startsWith("heal") || g === "revive")) {
          const who = p.tags.includes("heal-party") || p.tags.includes("heal-over-time") ? order
            : p.tags.includes("heal-ally") ? [order.find((l) => l === loc + 1) ?? loc] : [loc];
          let back = 0;
          for (const l of who) {
            const got = Math.min(HEAL_CAP, hurt.get(l) ?? 0);
            back += got;
            hurt.set(l, (hurt.get(l) ?? 0) - got);
          }
          v += back > 0 ? W.heal * back : W.idleHeal;
          why.push(back > 0 ? "heals after enemy damage" : "heals with no damage taken");
        }
        if (p.tags.includes("taunt")) v += 0.3 * (tl.slots[slotOf(tl.enemyFirst ? t + 1 : t) - 1].power) * hU(loc);
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
  const total = perTurn.reduce((a, b) => a + b, 0);
  return { total, perTurn, notes };
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
