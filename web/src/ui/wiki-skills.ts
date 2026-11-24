/**
 * "Good against" for hero skills (U19): the enemies whose 5-turn timeline (inventory/timelines.json, E13/E14b) makes a
 * hero skill worth taking, each with a one-line reason. Deterministic rules on the skill's tags and effects and the
 * enemy's slots and effect windows (no fight simulation):
 *
 * - cleanse: removable debuffs, damage over time, stuns… the enemy puts on the heroes (cleanse-self: on the front row);
 * - dispel (Silence, Song of Negation): removable buffs, shields and reflects the enemy puts on itself;
 * - taunt: heavy hits on one hero or one row (most when they reach the back row);
 * - shields, the reflect song and Def / Mdef buffs: heavy hits, matched to their physical / magical share;
 * - party heals (and heal over time): hits on everyone and damage over time; single heals and Revive: heavy hits;
 * - enemy Atk cuts (Ambush, Serenade…): heavy hitters; Def / Mdef cuts (Sunder, Terrify): the enemy's Def / Mdef buffs;
 * - Eva cut (Slow) and Acc buffs: the enemy's Eva buffs;
 * - damage: true damage through shields, reflects and Def / Mdef buffs; magic or physical damage where the enemy's
 *   filters let that kind through and stop the other;
 * - no direct damage (buffs, heals…): a safe action while the enemy reflects or shields itself.
 *
 * Score = sum of the rules that fire (window length × weight); the list is sorted by it.
 */
import type { EffectInfo, EnemyTimeline, SkillProfile } from "../tools/schedule.ts";
import { enemyTimeline, skillProfile } from "../tools/schedule.ts";
import { enemyIds, hasRare } from "./wiki-data.ts";
import { skillName } from "./names.ts";

export interface Matchup {
  quest: number;
  rare: boolean;
  name: string;
  score: number;
  /** one line: the strongest reason first */
  reason: string;
  /** Every reason (score order) with the enemy turns (1–5) it is about; [] = the whole fight, no one turn. */
  reasons: Reason[];
}

/** [score, text, enemy turns 1–5 the reason is about ([] = the whole fight)]. */
export type Reason = [number, string, number[]];

interface Hit { slot: number; name: string; power: number; tags: string[]; hits: number[]; magic: number }
interface Fx { slot: number; e: EffectInfo; turns: number[] }

const STAT: Record<string, string> = {
  atk: "Atk", matk: "Matk", def: "Def", mdef: "Mdef", acc: "Acc", eva: "Eva", maxHP: "max HP", crit: "Crit", critMod: "crit damage",
  atkBns: "Atk", matkBns: "Matk", accBns: "Acc", lckMod: "luck",
};
const FLAT = new Set(["atkBns", "matkBns", "accBns", "crit", "lckMod"]);

/** "+50% Atk", "immune to physical damage", "−25% Matk", "+86 Matk". */
export function effectStats(stats: Record<string, number> | undefined): string {
  return Object.entries(stats ?? {}).filter(([k, v]) => v && STAT[k]).map(([k, v]) => {
    if (!FLAT.has(k) && v >= 50 && (k === "def" || k === "mdef")) return `immune to ${k === "def" ? "physical" : "magic"} damage`;
    const s = v < 0 ? "−" : "+";
    return FLAT.has(k) ? `${s}${Math.abs(Math.round(v))} ${STAT[k]}` : `${s}${Math.round(Math.abs(v) * 100)}% ${STAT[k]}`;
  }).join(", ");
}

const KIND: Record<string, string> = {
  dot: "damage over time", stun: "stun", "force-action": "forced action", "stat-swap": "stat swap", "miss-chance": "miss chance",
  shield: "shield", reflect: "reflect", counter: "counter", hot: "heal over time", vulnerability: "vulnerability",
};
const describe = (e: EffectInfo) => {
  // a damage-over-time "stat" is its damage source (Matk × 100…), not a stat change
  const st = e.kind === "dot" || e.kind === "hot" ? "" : effectStats(e.stats);
  return `${e.name} (${[KIND[e.kind] ?? "", st, e.until === "permanent" ? "permanent" : ""].filter(Boolean).join(", ") || e.kind})`;
};

/** "turn 2", "turns 1–3", "turns 4, 5, 1". */
export function turnsText(turns: number[]): string {
  const t = [...new Set(turns)];
  if (!t.length) return "";
  if (t.length >= 5) return "every turn";
  if (t.length === 1) return `turn ${t[0]}`;
  const run = t.every((x, i) => !i || x === t[i - 1] + 1);
  return run ? `turns ${t[0]}–${t[t.length - 1]}` : `turns ${t.join(", ")}`;
}

const slotTurn = (slot: number, d: number) => ((slot - 1 + d) % 5) + 1;

function readTimeline(tl: EnemyTimeline): { hits: Hit[]; onHeroes: Fx[]; onEnemy: Fx[] } {
  const hits: Hit[] = [], onHeroes: Fx[] = [], onEnemy: Fx[] = [];
  tl.slots.forEach((s, i) => {
    const slot = i + 1;
    if (s.power > 0) {
      const mix = s.mix ?? { physical: 1, magical: 0, true: 0 };
      const all = mix.physical + mix.magical + mix.true || 1;
      hits.push({ slot, name: s.name, power: s.power, tags: s.tags, hits: s.hits ?? [], magic: mix.magical / all });
    }
    for (const e of s.effects) {
      if (e.on === "heroes") onHeroes.push({ slot, e, turns: e.ownerTurns.map((d) => slotTurn(slot, d)) });
      else if (e.on === "self" || e.on === "party") onEnemy.push({ slot, e, turns: e.facingTurns.map((d) => slotTurn(slot, d)) });
    }
  });
  return { hits, onHeroes, onEnemy };
}

/** How much a debuff on the heroes hurts (the cleanse value of one turn of it). */
function severity(e: EffectInfo): number {
  if (e.kind === "stun") return 3;
  if (e.kind === "force-action" || e.kind === "stat-swap") return 2;
  if (e.kind === "dot") return 1.5;
  if (e.kind === "miss-chance") return 1;
  return Math.min(2, Object.values(e.stats ?? {}).reduce((a, v) => a + (v < 0 ? -v : 0), 0));
}

/** Weight of an enemy self-effect for a dispel. */
function buffWeight(e: EffectInfo): number {
  if (e.kind === "reflect" || e.kind === "shield" || e.kind === "counter") return 2;
  if (e.kind === "hot") return 1;
  const s = e.stats ?? {};
  return Math.min(3, Math.max(0.5, Object.entries(s).reduce((a, [k, v]) => a + (v > 0 ? (FLAT.has(k) ? v / 100 : Math.min(v, 1.5)) : 0), 0)));
}

const HEAVY = 1.5;
const heavyHits = (hits: Hit[]) => hits.filter((h) => h.power >= HEAVY && !h.tags.includes("damage-split"));
const strongest = <T>(xs: T[], f: (x: T) => number) => xs.reduce<T | undefined>((b, x) => (b === undefined || f(x) > f(b) ? x : b), undefined);
const hitWords = (h: Hit) => `${skillName(h.name)} (×${h.power.toFixed(1)}${h.tags.includes("damage-aoe") ? ", everyone" : h.hits.length === 1 ? ", one hero" : h.tags.includes("damage-row") ? ", one row" : ""}, turn ${h.slot})`;

/** Effects listed once per name (Arkyos casts Hellfire twice). */
const byName = <T extends { e: EffectInfo }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.e.name === x.e.name) === i);

const statSum = (s: Record<string, number> | undefined, keys: string[], sign: 1 | -1) =>
  keys.reduce((a, k) => a + Math.max(0, sign * (s?.[k] ?? 0)), 0);

/** The reasons (score, text) a hero skill is good against one enemy timeline. */
export function reasons(p: SkillProfile, tl: EnemyTimeline): Reason[] {
  const { hits, onHeroes, onEnemy } = readTimeline(tl);
  const out: Reason[] = [];
  const turnsOf = (xs: Fx[]) => [...new Set(xs.flatMap((x) => x.turns))].sort((a, b) => a - b);
  const tags = p.tags;
  const fx = p.effects;
  const mix = p.mix ?? { physical: 0, magical: 0, true: 0 };
  const heavy = heavyHits(hits);
  const big = strongest(heavy, (h) => h.power);

  // cleanse: what it removes from the party (or the caster, in the front row)
  if (tags.includes("cleanse") || tags.includes("cleanse-self")) {
    const self = !tags.includes("cleanse");
    const on = onHeroes.filter((x) => x.e.removable && (!self || !x.e.locations || x.e.locations.some((l) => l % 2 === 0)));
    if (on.length) {
      const score = on.reduce((a, x) => a + severity(x.e) * Math.max(1, x.turns.length) / 2, 0);
      const top = byName([...on].sort((a, b) => severity(b.e) * b.turns.length - severity(a.e) * a.turns.length));
      out.push([score, `${self ? "clears" : "cleanses"} ${top.slice(0, 2).map((x) => describe(x.e)).join(" and ")}${self ? " off the caster" : ""}, on ${turnsText(top[0].turns)}`, turnsOf([top[0]])]);
    }
  }
  // dispel: the enemy's removable self-buffs, shields and reflects
  if (tags.includes("dispel")) {
    const on = onEnemy.filter((x) => x.e.removable);
    if (on.length) {
      const score = on.reduce((a, x) => a + buffWeight(x.e) * Math.max(1, x.turns.length) / 2 * (x.e.until === "permanent" ? 1.5 : 1), 0);
      const top = byName([...on].sort((a, b) => buffWeight(b.e) * b.turns.length - buffWeight(a.e) * a.turns.length));
      out.push([score, `dispels ${top.slice(0, 2).map((x) => describe(x.e)).join(" and ")}${top[0].e.until === "permanent" ? "" : `, on ${turnsText(top[0].turns)}`}`, turnsOf([top[0]])]);
    }
  }
  // taunt: pull a heavy single / row hit onto the taunter (most useful when it would reach the back row)
  if (tags.includes("taunt") && big) {
    const back = heavy.filter((h) => h.hits.some((l) => l % 2 === 1) && !h.tags.includes("damage-aoe"));
    const t = strongest(back.length ? back : heavy.filter((h) => !h.tags.includes("damage-aoe")), (h) => h.power);
    if (t) out.push([t.power * (back.includes(t) ? 1.5 : 1), `draws ${hitWords(t)} onto the taunter${back.includes(t) ? ", away from the back row" : ""}`, [t.slot]]);
  }
  // shields, the reflect song and Def / Mdef buffs on the heroes: heavy hits of the kind they stop
  const defBuff = fx.filter((e) => e.on !== "enemy" && (statSum(e.stats, ["def"], 1) > 0 || statSum(e.stats, ["mdef"], 1) > 0));
  const protects = tags.includes("shield") || tags.includes("reflect") || defBuff.length > 0;
  if (protects && heavy.length) {
    const physOnly = defBuff.length > 0 && !tags.includes("shield") && !tags.includes("reflect") && defBuff.every((e) => !statSum(e.stats, ["mdef"], 1));
    const magOnly = defBuff.length > 0 && !tags.includes("shield") && !tags.includes("reflect") && defBuff.every((e) => !statSum(e.stats, ["def"], 1));
    const fit = (h: Hit) => (physOnly ? 1 - h.magic : magOnly ? h.magic : 1);
    const t = strongest(heavy.filter((h) => fit(h) > 0.4), (h) => h.power * fit(h));
    if (t) {
      const what = tags.includes("reflect") ? "sends back part of" : tags.includes("shield") ? "absorbs" : magOnly ? "softens the magic of" : physOnly ? "softens the physical hit of" : "softens";
      out.push([t.power * fit(t), `${what} ${hitWords(t)}`, [t.slot]]);
    }
  }
  // heals
  const aoe = hits.filter((h) => h.tags.includes("damage-aoe"));
  const dots = onHeroes.filter((x) => x.e.kind === "dot");
  if (tags.includes("heal-party") || tags.includes("heal-over-time")) {
    const score = aoe.reduce((a, h) => a + h.power, 0) + dots.length * 0.75;
    if (score >= 0.5) {
      const t = strongest(aoe, (h) => h.power);
      out.push([score, [t ? `${skillName(t.name)} hits everyone (×${t.power.toFixed(1)}, turn ${t.slot})${aoe.length > 1 ? ` and ${aoe.length - 1} more party-wide hit${aoe.length > 2 ? "s" : ""}` : ""}` : "",
        dots.length ? `${dots[0].e.name} burns the party over time` : ""].filter(Boolean).join("; "),
        aoe.length ? [...new Set(aoe.map((h) => h.slot))].sort((a, b) => a - b) : turnsOf(dots)]);
    }
  } else if ((tags.includes("heal-ally") || tags.includes("heal-self") || tags.includes("revive")) && big) {
    const per = hits.reduce((a, h) => a + h.power, 0);
    const self = tags.includes("heal-self") && !tags.includes("heal-ally");
    out.push([(tags.includes("revive") ? big.power : per / 2) * (self ? 0.6 : 1),
      tags.includes("revive") ? `${hitWords(big)} can drop a hero` : `${self ? "the caster recovers from" : "patches up the hero hit by"} ${hitWords(big)}`, [big.slot]]);
  }
  // Atk cuts on the enemy against heavy hitters
  const atkCut = fx.find((e) => e.on === "enemy" && statSum(e.stats, ["atk", "matk"], -1) > 0);
  if (atkCut && big) {
    const cut = statSum(atkCut.stats, ["atk", "matk"], -1);
    out.push([big.power * Math.min(1, cut) * 1.5, `cuts ${effectStats(atkCut.stats)} before ${hitWords(big)}`, [big.slot]]);
  }
  // Def / Mdef cuts against the enemy's Def / Mdef buffs; Eva cut / Acc buffs against Eva buffs
  for (const [stat, label] of [["def", "Def"], ["mdef", "Mdef"], ["eva", "Eva"]] as const) {
    const cut = fx.some((e) => e.on === "enemy" && (e.stats?.[stat] ?? 0) < 0)
      || (stat === "eva" && fx.some((e) => e.on !== "enemy" && ((e.stats?.acc ?? 0) > 0 || (e.stats?.accBns ?? 0) > 0)));
    if (!cut) continue;
    // an immunity (Obsidian Shield: +10000 % Def) is not worth cutting
    const buffs = onEnemy.filter((x) => (x.e.stats?.[stat] ?? 0) > 0 && (x.e.stats?.[stat] ?? 0) < 50);
    const t = strongest(buffs, (x) => (x.e.stats?.[stat] ?? 0) * x.turns.length);
    if (t) out.push([Math.min(2, t.e.stats![stat]) * Math.max(1, t.turns.length) / 2 + 0.5, `${stat === "eva" && !fx.some((e) => e.on === "enemy" && (e.stats?.eva ?? 0) < 0) ? "more Acc against" : `cuts ${label} under`} ${describe(t.e)}`, turnsOf([t])]);
  }
  // damage through the enemy's filters
  if (p.power > 0) {
    const all = mix.physical + mix.magical + mix.true || 1;
    const tr = mix.true / all, mg = mix.magical / all, ph = mix.physical / all;
    for (const x of byName(onEnemy)) {
      const e = x.e, t = e.test, span = Math.max(1, x.turns.length);
      // share of a hit that does not get through: the probe's test hit, else the Def / Mdef buff (+100 % ≈ half)
      const cut = (k: "def" | "mdef") => {
        const v = statSum(e.stats, [k], 1);
        return v >= 50 ? 1 : v / (1 + v);
      };
      const physBlocked = t ? 1 - t.physical : cut("def");
      const magBlocked = t ? 1 - t.magical : cut("mdef");
      if (physBlocked <= 0.2 && magBlocked <= 0.2) continue;
      // what this skill gets through, against a hit of the other kind (true damage: against the better of the two)
      const through = tr + ph * (1 - physBlocked) + mg * (1 - magBlocked);
      const other = tr >= 0.5 ? Math.max(1 - physBlocked, 1 - magBlocked) : mg >= 0.5 ? 1 - physBlocked : 1 - magBlocked;
      const gain = through - other;
      if (gain < 0.3) continue;
      const kind = tr >= 0.5 ? "true damage" : mg >= 0.5 ? "magic damage" : "physical damage";
      const verb = e.kind === "reflect" || e.kind === "counter" ? "is not reflected by" : "goes through";
      out.push([gain * span / 2 * p.power, `${kind} ${verb} ${describe(e)}, ${turnsText(x.turns)}`, turnsOf([x])]);
    }
  } else if (!tags.includes("cleanse") && !tags.includes("dispel") && !tags.includes("taunt")) {
    // no direct damage: a safe action while the enemy reflects or shields itself
    const walls = onEnemy.filter((x) => x.e.kind === "reflect" || x.e.kind === "counter");
    const t = strongest(walls, (x) => x.turns.length);
    if (t) out.push([0.4 * Math.max(1, t.turns.length), `no direct damage: a safe action during ${describe(t.e)}, ${turnsText(t.turns)}`, turnsOf([t])]);
  }
  return out;
}

let cache: Map<string, Matchup[]> | null = null;

/**
 * Per enemy turn (1–5) the reasons that are about it, and the whole-fight ones ("all"), for the Good against table:
 * a ✓ in the turn's cell, the reasons in its tooltip.
 */
export function turnMarks(m: Matchup): { turns: string[][]; all: string[] } {
  const turns: string[][] = [[], [], [], [], []];
  const all: string[] = [];
  for (const [, text, ts] of m.reasons) {
    if (!ts.length) all.push(text);
    else for (const t of ts) turns[t - 1].push(text);
  }
  return { turns, all };
}

/** Enemies (normal and rare variants) a hero skill is good against, best first; [] for enemy-only skills. */
export function goodAgainst(skill: string): Matchup[] {
  cache ??= new Map();
  const hit = cache.get(skill);
  if (hit) return hit;
  let p: SkillProfile | undefined;
  try {
    p = skillProfile(skill, "hero");
  } catch {
    return []; // timelines not loaded
  }
  if (!p || p.side !== "hero") return [];
  const out: Matchup[] = [];
  const seen = new Set<string>();
  for (const id of enemyIds()) {
    for (const rare of hasRare(id) ? [false, true] : [false]) {
      let tl: EnemyTimeline;
      try {
        tl = enemyTimeline(id, rare);
      } catch {
        continue;
      }
      const rs = reasons(p, tl).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
      if (!rs.length) continue;
      // one entry per name and variant (a quest reused under the same name counts once)
      const key = `${tl.name}|${rare}|${rs[0][1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ quest: id, rare, name: tl.name, score: rs.reduce((a, [s]) => a + s, 0), reason: rs.slice(0, 2).map(([, t]) => t).join("; "), reasons: rs });
    }
  }
  out.sort((a, b) => b.score - a.score || a.quest - b.quest);
  cache.set(skill, out);
  return out;
}

/** True for a hero skill that cleanses debuffs or dispels buffs (its "?" links to Battle › Buffs and debuffs). */
export function removesEffects(skill: string): boolean {
  try {
    const tags = skillProfile(skill, "hero")?.tags ?? [];
    return tags.includes("cleanse") || tags.includes("cleanse-self") || tags.includes("dispel");
  } catch {
    return false; // timelines not loaded
  }
}
