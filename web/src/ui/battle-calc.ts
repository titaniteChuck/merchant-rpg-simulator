/**
 * The Flow tab's numbers explained (U40), as data for timeline.ts to draw. Pure (no DOM), so Node tests can check it.
 *
 * - effectText(): what an effect on a fighter does, as plain text ("+15% Def", "−20% Atk", "Taunt", "Shield 340"),
 *   from the effect's live numbers in the trace (stacks, amplify, a shield wearing down), never from the skill's data.
 * - attackFormula() / healFormula(): the exact calculation of one hit or one heal, from the values the engine really
 *   used (sim/api.ts CalcAttack, CalcHeal), as terms with a value and a tooltip: "ATK 575 × 1.6 × 75.8% DEF 32 = 697".
 *   Evaluating the terms gives back the number dealt (evalLine), which the tests check.
 */
import type { CalcAttack, CalcHeal, CalcStats, TraceCalc } from "../sim/api.ts";
import { skillName } from "./names.ts";

const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const fmt3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
/** A stat or an amount: whole above 1,000, one decimal below (a stat can be 676.5). */
export const fmtNum = (v: number): string => (Math.abs(v) >= 1000 ? fmt0 : fmt1).format(v);
/** A multiplier (1.6, 0.22, 1.35). */
const fmtMul = (v: number): string => fmt3.format(v);
/** A fraction as a percent (0.15 → "15%"). */
const pct = (v: number): string => `${fmt1.format(Math.round(v * 1000) / 10)}%`;
const signed = (v: number, s: string): string => `${v < 0 ? "−" : "+"}${s}`;

/**
 * An effect's name in the visitor's language: effects are named after their skill ("Tidal Wave"), sometimes with a
 * suffix ("Ancient Mist Eva↑"); the skill part is translated, the suffix kept.
 */
export function effectName(name: string): string {
  const own = skillName(name);
  if (own !== name) return own;
  const words = name.split(" ");
  for (let k = words.length - 1; k > 0; k--) {
    const head = words.slice(0, k).join(" "), t = skillName(head);
    if (t !== head) return `${t} ${words.slice(k).join(" ")}`;
  }
  return name;
}

// ---------------------------------------------------------------- effects as text
/** Stat words on the page. */
const STAT: Record<string, string> = {
  atk: "Atk", matk: "MAtk", def: "Def", mdef: "MDef", acc: "Acc", eva: "Eva", maxHP: "HP", crit: "Crit", critMod: "Crit dmg",
  lckMod: "Luck", atkBns: "Atk", matkBns: "MAtk", defBns: "Def", mdefBns: "MDef", accBns: "Acc",
};
/** Stats an effect raises by a fraction (0.15 = +15%); the others add points. */
const PCT_STATS = new Set(["atk", "matk", "def", "mdef", "acc", "eva", "maxHP"]);
/** The damage parts an on-damage or damage-received effect multiplies. */
const PART: Record<string, string> = { atk: "Phys", matk: "Mag", dmg: "True", physicalDamage: "Phys", magicDamage: "Mag", trueDamage: "True" };

/** Effects whose work is code, not numbers (dmgFunc, triggerFunc, statFunc): what each does, in a few words. */
const FIXED: Record<string, string> = {
  Taunt: "Taunt", "Magic Missile II": "60% MDef pen next hit", "Double Image": "50% to lose its attack",
  Stun: "Stunned", "Stunning Blow": "Stunned", Drown: "Basic only",
  Enrage: "+10% Atk per hit taken", Elusion: "50% hit chance vs it", "Shadow Veil": "Dodges all hits", Retaliation: "Counterattacks",
  Absorb: "Absorbs 50% Mag", "Absorb Atk": "Absorbs 75% Phys", "Absorb Matk": "Absorbs 75% Mag", "Absorb All": "Absorbs 50%",
  "Devouring Cold": "Absorbs 50%", "Unbreakable Will": "Reflects 75% Phys", "Glacial Prism": "Reflects 50%", "Grand Duel": "Reflects 100% Phys",
  "Reflect Atk": "Reflects 80% Phys", "Reflect Matk": "Reflects 80% Mag", "Reflect All": "Reflects 50%", Reflect: "Reflects 50% Mag",
  "Soul Barrier": "Reflects all dmg", "Song of Defense": "Reflects 40% dmg", "Master Decoy Heal": "Heals party 50% of dmg taken",
  "Swap Attack": "Atk ⇄ MAtk", "Alternate Reality": "Atk ⇄ MAtk", "Swap Defense": "Def ⇄ MDef",
};

/** What the trace says of an effect (sim/api.ts TraceEffect). */
export interface FxData {
  name: string;
  debuff: boolean;
  turns?: number;
  stats?: Record<string, number>;
  trigger?: string;
  heal?: number;
  absorb?: number;
  value?: number;
}

/** Damage-taken multipliers ({atk: 0.22} or {physicalDamage: 1.25}) as text: "−78% Phys taken", "+25% Dmg taken", "Immune". */
function takenText(stats: Record<string, number>): string {
  const byValue = new Map<number, string[]>();
  for (const [k, v] of Object.entries(stats)) {
    if (!PART[k]) continue;
    byValue.set(v, [...(byValue.get(v) ?? []), PART[k]]);
  }
  const out: string[] = [];
  for (const [v, parts] of byValue) {
    const all = parts.length >= 3;
    if (v === 0) out.push(all ? "Immune" : `No ${parts.join("/")} dmg`);
    else out.push(`${signed(v - 1, pct(Math.abs(v - 1)))} ${all ? "Dmg" : parts.join("/")} taken`);
  }
  return out.join(", ");
}

/** "+15% Def", "−20% Atk", "+25% Crit", "+123 Atk", "+3 Luck": one stat of a stat effect. */
export function statText(k: string, v: number): string {
  const label = STAT[k] ?? k;
  if (PCT_STATS.has(k)) return `${signed(v, pct(Math.abs(v)))} ${label}`;
  if (k === "crit") return `${signed(v, `${fmt1.format(Math.abs(v))}%`)} ${label}`;
  if (k === "critMod") return `${signed(v, `${fmtMul(Math.abs(v))}×`)} ${label}`;
  return `${signed(v, fmtNum(Math.abs(v)))} ${label}`;
}

/**
 * What an effect does, as plain text from its live numbers: "+15% Def +40% MDef", "1,234 MAtk/turn", "+120 HP/turn",
 * "Shield 340", "Taunt". Falls back on the effect's name for one the page has no words for.
 */
export function effectText(f: FxData): string {
  const s = f.stats ?? {};
  const t = f.trigger;
  if (t === "DamageOnTurn") {
    const a = s.atk ?? 0, m = s.matk ?? 0;
    return [a ? `${fmtNum(a)} Atk` : "", m ? `${fmtNum(m)} MAtk` : ""].filter(Boolean).join(" + ") + "/turn";
  }
  if (t === "HealingOnTurn") return `+${fmtNum(f.heal ?? 0)} HP/turn`;
  if (f.name === "Mana Shield" && f.absorb !== undefined) return `Shield ${fmtNum(f.absorb)}`;
  if (f.name === "Holy Shield" && f.value !== undefined) return `MDef ${fmtNum(f.value)}`;
  if (FIXED[f.name]) return FIXED[f.name];
  const once = f.turns === undefined ? " (next hit)" : "";
  if ((t === "OnDamage" || t === "DamageReceived") && Object.keys(s).length) return takenText(s) + once;
  const parts = Object.entries(s).filter(([k, v]) => v !== 0 && STAT[k]).map(([k, v]) => statText(k, v));
  if (parts.length) return parts.join(" ");
  if (t === "OnDetermineAction") return "Stunned";
  return effectName(f.name);
}

// ---------------------------------------------------------------- formulas
/** One term of a formula: how it combines with what comes before (none for the first), its value, its words, its source. */
export interface CalcTerm {
  op: "" | "×" | "+" | "−" | "=" | "→";
  /** The value: the factor for ×, the amount for + and −, the result for = (rounded where the game rounds) and → (capped). */
  v: number;
  text: string;
  tip: string;
  /** "result": a value the game computed (after =); "stat", "skill", "fx", "crit", "def" for the styling. */
  kind?: string;
}
export interface CalcLine {
  /** "Physical", "Magic", "True damage", "Heal". */
  label: string;
  terms: CalcTerm[];
  /** What the line comes to (the last "=" term). */
  value: number;
}
export interface CalcView {
  /** "Paladin → Treasure Bush · Divine Strike". */
  head: string;
  lines: CalcLine[];
  /** The number shown on the page for this hit or heal (damage dealt, HP healed). */
  shown: number;
  /** Words under the lines (the total of several parts, a heal capped at max HP, a hit on a fallen fighter). */
  notes: string[];
  /** A hit that landed on a fallen fighter: it changes nothing. */
  void?: boolean;
}

/**
 * The value a line's terms come to: × multiplies, + and − add, = and → take the term's value (the game's rounded
 * result, a heal capped at max HP), so a line always ends on the number the engine computed. The tests check each
 * step against the record.
 */
export function evalLine(terms: CalcTerm[]): number {
  let x = 0;
  for (const t of terms) {
    if (t.op === "") x = t.v;
    else if (t.op === "×") x *= t.v;
    else if (t.op === "+") x += t.v;
    else if (t.op === "−") x -= t.v;
    else x = t.v;
  }
  return x;
}

type Names = (who: number) => string;
/** "Paladin → Treasure Bush · Divine Strike"; "Treasure Bush · Fire Shield" on itself. */
const headOf = (from: number, to: number, name: Names, src: string): string =>
  from === to || from < 0 ? `${name(to)} · ${src}` : `${name(from)} → ${name(to)} · ${src}`;
const STAT_WORD: Record<string, string> = { atk: "ATK", matk: "MATK", acc: "ACC", def: "DEF", mdef: "MDEF", maxHP: "max HP" };

/** The attacker's stat effects that touch a stat, for its tooltip ("Holy Blessing +15%"). */
function statBuffs(st: CalcStats, keys: string[]): string {
  const bits: string[] = [];
  for (const e of st.fx ?? []) {
    for (const k of keys) {
      for (const sk of [k, `${k}Bns`]) {
        const v = e.stats[sk];
        if (typeof v === "number" && v !== 0) bits.push(`${effectName(e.name)} ${statText(sk, v)}`);
      }
    }
  }
  return bits.length ? ` Its effects then: ${bits.join(", ")}.` : "";
}

/**
 * A skill's base as "stat × multiplier" when it is one ("ATK 575 × 1.6", "(ATK + ACC) 820 × 1.45"): the stat (or sum)
 * whose product with a skill-like multiplier (up to 6, at most 2 decimals) gives back exactly the value the skill sent;
 * the plainest multiplier wins (1.6 before 1.53), then the skill's own stat. A round stat (an enemy's ACC 100) only
 * with a plain multiplier, since nearly any amount divides it. Null when none does (the skill mixes in other things: a
 * share of another hit, the level, the target's HP). `single`: one stat only (heals: a sum there is a share of damage).
 */
function decompose(base: number, st: CalcStats, prefer: string[], single = false): { keys: string[]; stat: number; mult: number } | null {
  const sums: string[][] = [...prefer.map((k) => [k]), ["atk"], ["matk"], ["acc"], ["def"], ["mdef"], ["atk", "acc"], ["atk", "def"],
    ["matk", "acc"], ["atk", "matk"], ["matk", "atk"], ["acc", "atk"], ["def", "atk"], ["acc", "matk"], ["maxHP"]];
  let best: { keys: string[]; stat: number; mult: number; score: number } | null = null;
  for (const keys of sums) {
    const stat = keys.reduce((a, k) => a + ((st as unknown as Record<string, number>)[k] ?? 0), 0);
    if (!(stat > 0) || (single && keys.length > 1)) continue;
    const mult = Math.round((base / stat) * 100) / 100;
    if (!(mult > 0 && mult <= 6) || !(stat * mult === base || mult * stat === base)) continue;
    const decimals = Number.isInteger(mult) ? 0 : Number.isInteger(mult * 10) ? 1 : 2;
    if (decimals === 2 && stat % 10 === 0) continue;
    if (!best || decimals < best.score) best = { keys, stat, mult, score: decimals };
  }
  return best && { keys: best.keys, stat: best.stat, mult: best.mult };
}

/** The first terms of a line: the attacker's stat × the skill's multiplier, or the skill's amount as it is. */
function baseTerms(base: number, st: CalcStats | null, prefer: string[], src: string, who: string, single = false): CalcTerm[] {
  const skill = skillName(src);
  const d = st ? decompose(base, st, prefer, single) : null;
  if (!d) {
    return [{ op: "", v: base, text: `${skill} ${fmtNum(base)}`, kind: "skill",
      tip: `What ${skill} sends: its own formula on ${who}'s stats when it acted (or a share of another hit).` }];
  }
  const word = d.keys.map((k) => STAT_WORD[k] ?? k).join(" + ");
  const statTip = `${who}'s ${word} when it acted (${fmtNum(d.stat)}), its gear, level and buffs included.${statBuffs(st!, d.keys)}`;
  const first: CalcTerm = { op: "", v: d.stat, text: `${d.keys.length > 1 ? `(${word})` : word} ${fmtNum(d.stat)}`, kind: "stat", tip: statTip };
  if (d.mult === 1) {
    first.tip += ` ${skill} uses it as it is (×1).`;
    return [first];
  }
  return [first, { op: "×", v: d.mult, text: `${fmtMul(d.mult)}`, kind: "skill", tip: `${skill}: ${fmtMul(d.mult)} × ${word}.` }];
}

/** A step that changed a value (an effect): × factor, or + / − an amount when it is not a factor. */
function stepTerm(before: number, after: number, name: string, tip: string, kind = "fx"): CalcTerm | null {
  if (after === before) return null;
  const label = effectName(name);
  if (before !== 0 && after / before > 0) {
    const f = after / before;
    return { op: "×", v: f, text: `${fmtMul(f)} ${label}`, kind, tip };
  }
  if (after < before) return { op: "−", v: before - after, text: `${fmtNum(before - after)} ${label}`, kind, tip };
  return { op: "+", v: after - before, text: `${fmtNum(after - before)} ${label}`, kind, tip };
}

const ON_ATTACK_TIP = (name: string, who: string) => `${effectName(name)} on ${who}: changes its next attack.`;
const ON_DAMAGE_TIP = (name: string, who: string) => `${effectName(name)} on ${who}: changes the damage it takes (before its defence).`;
const RECEIVED_TIP = (name: string, who: string) => `${effectName(name)} on ${who}: changes the damage it takes (after its defence).`;

/** The exact calculation of one hit (sim/api.ts CalcAttack). */
export function attackFormula(c: CalcAttack, name: Names): CalcView {
  const from = name(c.from), to = name(c.to), src = skillName(c.src);
  const lines: CalcLine[] = [];
  const parts: ["atk" | "matk" | "dmg", "p" | "m" | "t", string][] = [["atk", "p", "Physical"], ["matk", "m", "Magic"], ["dmg", "t", "True damage"]];
  for (const [k, d, label] of parts) {
    const used = c.used?.[k] ?? 0;
    if (!(used > 0) && !(c.raw?.[d])) continue;
    const terms: CalcTerm[] = [];
    let x: number;
    if (c.tick) {
      x = c.arrived[k];
      terms.push({ op: "", v: x, text: `${src} ${fmtNum(x)}`, kind: "skill",
        tip: `${src}: damage over time from ${from}, set from its stats when it was cast (an amplify doubles it).` });
    } else if (c.base) {
      x = c.base[k];
      terms.push(...baseTerms(x, c.stat, k === "matk" ? ["matk"] : ["atk"], c.src, from));
      for (const s of c.onAttack) {
        if (!s.after) continue;
        const t = stepTerm(x, s.after[k], s.name, ON_ATTACK_TIP(s.name, from));
        if (t) terms.push(t);
        x = s.after[k];
      }
    } else {
      x = c.arrived[k];
      terms.push({ op: "", v: x, text: `${src} ${fmtNum(x)}`, kind: "skill", tip: `What ${src} sends.` });
    }
    if (c.ratio !== undefined && c.ratio !== 1) {
      terms.push({ op: "×", v: c.ratio, text: `${fmtMul(c.ratio)} share`, kind: "mod",
        tip: `${to}'s share of the attack: an attack on several heroes is split between them, or aims at one row or place.` });
      x = x * c.ratio;
    }
    for (const s of c.onDamage) {
      const t = stepTerm(x, s.after[k], s.name, ON_DAMAGE_TIP(s.name, to));
      if (t) terms.push(t);
      x = s.after[k];
    }
    if (c.crit && k !== "dmg") {
      terms.push({ op: "×", v: c.dmgMod ?? 1, text: `${fmtMul(c.dmgMod ?? 1)} crit`, kind: "crit",
        tip: `Critical hit (${from}'s crit chance ${fmt1.format(c.critChance ?? 0)}%): × its critical damage.` });
    } else if (c.luck) {
      terms.push({ op: "×", v: c.dmgMod ?? 1.35, text: `${fmtMul(c.dmgMod ?? 1.35)} lucky`, kind: "crit", tip: `Lucky hit (${from}'s luck): × 1.35.` });
    }
    if (k !== "dmg") {
      const phys = k === "atk";
      const stat = phys ? c.def ?? 0 : c.mdef ?? 0, pen = phys ? c.defPen ?? 0 : c.mdefPen ?? 0, red = phys ? c.defRed ?? 1 : c.mdefRed ?? 1;
      const w = phys ? "DEF" : "MDEF";
      const penText = pen > 0 ? `, ${fmt1.format(pen)}% of it ignored (penetration) → ${fmtNum(Math.max(0, stat * (100 - pen) / 100))}` : "";
      terms.push({ op: "×", v: red, text: `${pct(red)} ${w} ${fmtNum(stat)}`, kind: "def",
        tip: `${to}'s ${w} ${fmtNum(stat)} (its buffs and debuffs included${penText}): damage × 100 / (100 + ${w}).` });
    }
    const raw = c.raw?.[d] ?? 0;
    terms.push({ op: "=", v: raw, text: fmtNum(raw), kind: "result", tip: "Rounded to a whole number, as the game does." });
    let y = raw;
    for (const s of c.received) {
      const t = stepTerm(y, s.after[d], s.name, RECEIVED_TIP(s.name, to));
      if (t) terms.push(t);
      y = s.after[d];
    }
    if (y !== raw) terms.push({ op: "=", v: y, text: fmtNum(y), kind: "result", tip: "After the effects on the target." });
    lines.push({ label, terms, value: y });
  }
  const notes: string[] = [];
  if (lines.length > 1 || (c.received.length && lines.length && lines[0].value !== c.total)) {
    notes.push(`Total: ${lines.map((l) => fmtNum(l.value)).join(" + ")}${c.received.length ? " (rounded)" : ""} = ${fmt0.format(c.total)}`);
  }
  const dead = c.hpBefore <= 0;
  if (dead) notes.push(`${to} was already down: the game still plays the hit (it ends the fight only once the turn is over), but it changes nothing.`);
  return { head: headOf(c.from, c.to, name, src), lines, shown: dead ? 0 : c.total, notes, ...(dead ? { void: true } : {}) };
}

/** The exact calculation of one heal (sim/api.ts CalcHeal): the amount, rounded, then what really went back (max HP). */
export function healFormula(c: CalcHeal, name: Names): CalcView {
  const from = c.from >= 0 ? name(c.from) : name(c.to), to = name(c.to), src = skillName(c.src);
  const terms: CalcTerm[] = [];
  if (c.tick) {
    terms.push({ op: "", v: c.amount, text: `${src} ${fmtNum(c.amount)}`, kind: "skill",
      tip: `${src}: heal over time from ${from}, set from its stats when it was cast.` });
  } else if (c.isPercent) {
    terms.push({ op: "", v: c.maxHP, text: `max HP ${fmtNum(c.maxHP)}`, kind: "stat", tip: `${to}'s max HP.` },
      { op: "×", v: c.amount, text: pct(c.amount), kind: "skill", tip: `${src}: ${pct(c.amount)} of max HP.` });
  } else {
    terms.push(...baseTerms(c.amount, c.stat, ["matk"], c.src, from, true));
  }
  terms.push({ op: "=", v: c.total, text: fmtNum(c.total), kind: "result", tip: "Rounded to a whole number, as the game does." });
  const healed = Math.max(0, c.hpAfter - Math.max(0, c.hpBefore));
  const notes: string[] = [];
  if (c.revive) notes.push(`${to} comes back with ${fmt0.format(c.total)} HP.`);
  if (healed !== c.total && !c.revive) {
    terms.push({ op: "→", v: healed, text: `+${fmt0.format(healed)} healed`, kind: "result",
      tip: `HP can't go over max HP: ${to} had ${fmt0.format(Math.max(0, c.hpBefore))} of ${fmt0.format(c.maxHP)}.` });
  }
  return { head: headOf(c.from, c.to, name, src), lines: [{ label: "Heal", terms, value: healed }], shown: healed, notes };
}

/** A record's formula. */
export function calcView(c: TraceCalc, name: Names): CalcView {
  return c.kind === "dmg" ? attackFormula(c, name) : healFormula(c, name);
}

/** The number a hit's records add up to on the page: damage dealt while standing, HP really healed. */
export function shownTotal(calc: TraceCalc[], kind: "dmg" | "heal"): number {
  return calc.filter((c) => c.kind === kind && !(c.kind === "dmg" && c.missed)).reduce((s, c) => s + calcView(c, () => "").shown, 0);
}
