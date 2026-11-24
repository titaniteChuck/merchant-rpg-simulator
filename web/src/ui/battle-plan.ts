/**
 * The battle page's 5-turn plan as data (U36), for timeline.ts to draw: a grid whose columns are the heroes in action
 * order plus the enemy, and whose rows are turns 1-5. Pure (no DOM), so Node tests can check it.
 *
 * - Hero cells: the planned skill, what the hero really does (Basic under a forced action, nothing when stunned), and
 *   the enemy's effects on that hero for that turn, each with its SOURCE skill: "[Tidal Wave] atk −50%",
 *   "[Drown] → Basic". Windows come from the timeline (ownerTurns: the heroes' own actions, offsets from the cast).
 * - Enemy cells: its skill with a compact summary ("AoE · atk −50%"), its own buffs still on from earlier turns
 *   ("[Ancient Mist] eva +50%"), and the maluses the heroes put on it, each with its source ("[Sunder] def −40%",
 *   "[Silence] dispel", "[Taunt] taunt").
 * Compact words ("atk", "AoE", "→ Basic" …) everywhere, the full words in `title`. Skill names go through names.ts, so
 * the grid follows the language picker; the keys stay English.
 */
import { type EffectInfo, type EnemyTimeline, skillProfile, type SkillTag } from "../tools/schedule.ts";
import { enemyName, skillName } from "./names.ts";

/** Compact stat words, and the full ones for tooltips. */
const STAT_SHORT: Record<string, [string, string]> = {
  atk: ["atk", "attack"], matk: ["matk", "magic attack"], def: ["def", "defence"], mdef: ["mdef", "magic defence"],
  acc: ["acc", "accuracy"], eva: ["eva", "evasion"], lck: ["lck", "luck"], lckMod: ["lck", "luck"], crit: ["crit", "critical chance"],
  critMod: ["crit dmg", "critical damage"], maxHP: ["HP", "max HP"], atkBns: ["atk", "attack"], matkBns: ["matk", "magic attack"],
  defBns: ["def", "defence"], mdefBns: ["mdef", "magic defence"], accBns: ["acc", "accuracy"],
};
/** "atk −50%" (fractions read as percents, bigger numbers as they are), and its long form. */
export function compactStat(k: string, v: number): { short: string; long: string } {
  const sign = v < 0 ? "−" : "+", a = Math.abs(v);
  const n = a <= 5 ? `${Math.round(a * 100)}%` : String(Math.round(a));
  const [s, l] = STAT_SHORT[k] ?? [k, k];
  return { short: `${s} ${sign}${n}`, long: `${l} ${sign}${n}` };
}

/** Compact words for an effect kind without stats. */
const KIND_SHORT: Record<string, [string, string]> = {
  "force-action": ["→ Basic", "abilities disabled: Basic attack only"], stun: ["stun", "stunned: the action is lost"],
  dot: ["DoT", "damage over time"], hot: ["heal", "heals over time"], "stat-swap": ["swap", "stats swapped"],
  "miss-chance": ["miss", "attacks may miss"], shield: ["shield", "a shield"], reflect: ["reflect", "reflects damage"],
  counter: ["counter", "counters attacks"], taunt: ["taunt", "taunted: attacks the taunter"], buff: ["buff", "a buff"], debuff: ["debuff", "a debuff"],
};

/** What an effect does, compact and in full ("atk −50%" / "attack −50%", "→ Basic" / "abilities disabled …"). */
export function compactEffect(e: EffectInfo): { short: string; long: string } {
  if (e.kind === "vulnerability") {
    const m = Math.max(...Object.values(e.stats ?? { x: 1 }));
    const n = `+${Math.round((m - 1) * 100)}%`;
    return { short: `dmg taken ${n}`, long: `takes ${n} damage` };
  }
  if ((e.kind === "buff" || e.kind === "debuff") && e.stats) {
    const parts = Object.entries(e.stats).filter(([, v]) => v !== 0).map(([k, v]) => compactStat(k, v));
    if (parts.length) return { short: parts.map((p) => p.short).join(", "), long: parts.map((p) => p.long).join(", ") };
  }
  const [s, l] = KIND_SHORT[e.kind] ?? [e.kind, e.kind];
  return { short: s, long: l };
}

/** Compact words for the skill tags, and the full ones ("AoE" / "hits everyone"). */
const TAG_SHORT: Record<SkillTag, [string, string]> = {
  "damage-single": ["dmg", "hits one"], "damage-split": ["split dmg", "hits, split"], "damage-row": ["row dmg", "hits a row"],
  "damage-aoe": ["AoE", "hits everyone"], "heal-self": ["heal", "heals itself"], "heal-ally": ["heal", "heals an ally"],
  "heal-party": ["heal all", "heals the party"], "heal-over-time": ["HoT", "heal over time"], revive: ["revive", "revives"],
  cleanse: ["cleanse", "cleanses"], "cleanse-self": ["cleanse", "cleanses itself"], dispel: ["dispel", "dispels"],
  "buff-self": ["buff", "buffs itself"], "buff-party": ["buff all", "buffs the party"], "debuff-enemy": ["debuff", "debuffs the enemy"],
  "debuff-party": ["debuff all", "debuffs the heroes"], dot: ["DoT", "damage over time"], stun: ["stun", "stuns"],
  "force-action": ["→ Basic", "forces Basic attacks"], shield: ["shield", "shield"], reflect: ["reflect", "reflects damage"],
  counter: ["counter", "counters"], taunt: ["taunt", "taunts"], "stat-swap": ["swap", "swaps stats"], amplify: ["amp", "amplifies"],
  "miss-chance": ["miss", "makes attacks miss"],
};
/** For the enemy, "party" and "enemy" read from its side. */
const ENEMY_TAG: Partial<Record<SkillTag, [string, string]>> = {
  "debuff-enemy": ["debuff all", "debuffs the heroes"], "buff-party": ["buff", "buffs itself"], "heal-party": ["heal", "heals itself"],
};
export function compactTag(t: SkillTag, side: "hero" | "enemy"): { short: string; long: string } {
  const [s, l] = (side === "enemy" ? ENEMY_TAG[t] : undefined) ?? TAG_SHORT[t] ?? [t, t];
  return { short: s, long: l };
}

const slotOf = (turn: number) => ((turn - 1) % 5 + 5) % 5 + 1;
/** Party location as schedule.ts counts it: back row 1, 3, 5, front row 2, 4, 6 (back 1 acts first). */
export const locationOf = (row: "front" | "back", i: number) => (row === "back" ? 2 * i + 1 : 2 * i + 2);
export const locationLabel = (loc: number) => `${loc % 2 ? "Back" : "Front"} ${Math.ceil(loc / 2)}`;

/**
 * The party locations an enemy effect on the heroes lands on, for this party. The probe hit a full party; with a row
 * empty, a row effect falls on the other row (as the schedule scorer counts row attacks).
 */
export function fxTargets(e: EffectInfo, occupied: number[]): number[] {
  const locs = e.locations ?? [1, 2, 3, 4, 5, 6];
  const hit = occupied.filter((l) => locs.includes(l));
  if (hit.length || !occupied.length) return hit;
  if (locs.every((l) => l % 2 === 0)) return occupied.filter((l) => l % 2 === 1);
  if (locs.every((l) => l % 2 === 1)) return occupied.filter((l) => l % 2 === 0);
  return [];
}

/** The hero turns (1-5, from the cast) an enemy effect cast on `cast` covers: its owner's turns for the heroes. */
const coveredTurns = (offsets: number[], cast: number) => [...new Set(offsets.map((o) => slotOf(cast + o)))];

const turnsText = (n: number, who: string) => `${n} ${who} turn${n === 1 ? "" : "s"}`;
/**
 * How long an effect lasts, in words. E24 (timelines.json v6) measures `until: "turns"` effects in both sides' turns
 * (`lastsHeroActions`, `lastsEnemyActions`): an effect on the enemy lasting t of its turns covers t + 1 hero turns
 * (Ancient Mist Eva↑: "3 enemy turns (covers 4 hero turns)"). Never the game's description, which is sometimes wrong.
 * Without them (older data), the effect's own `turns` in its owner's actions.
 */
export function lasts(e: EffectInfo, owner: "hero" | "enemy"): string {
  if (e.until === "permanent") return "for the rest of the fight";
  if (e.until === "next-hit") return "until the next hit";
  if (e.until === "next-attack") return `until ${owner === "hero" ? "the hero's" : "its"} next attack`;
  if (e.until === "toggle") return "until cast again";
  const x = e as EffectInfo & { lastsHeroActions?: number; lastsEnemyActions?: number };
  if (owner === "hero" && x.lastsHeroActions !== undefined) return `for ${turnsText(x.lastsHeroActions, "hero")}`;
  if (owner === "enemy" && x.lastsEnemyActions !== undefined) {
    return `for ${turnsText(x.lastsEnemyActions, "enemy")}${x.lastsHeroActions !== undefined ? ` (covers ${turnsText(x.lastsHeroActions, "hero")})` : ""}`;
  }
  return `for ${e.turns ?? "?"} of ${owner === "hero" ? "the hero's" : "its"} actions`;
}

/** One marker in a plan cell: "[Source] compact", with the full sentence for the tooltip. */
export interface PlanMark {
  /** English skill key of the source (the wiki route); `text` and `title` already use the visitor's language. */
  source: string;
  text: string;
  title: string;
  kind: string;
  /** Turn (1-5) of the cast. */
  cast: number;
}

const mark = (source: string, short: string, title: string, kind: string, cast: number): PlanMark =>
  ({ source, text: `[${skillName(source)}] ${short}`, title, kind, cast });

/** Keep the latest cast of each marker (the same effect cast again replaces itself), in cast order. */
function latest(marks: PlanMark[], turn: number, enemyFirst: boolean, heroCast: boolean): PlanMark[] {
  // A hero's cast in this turn acts before the enemy (unless it acts first): distance 0. An enemy cast in this turn
  // reaches the heroes from the next turn, so the same-turn cast is the oldest (distance 5), unless the enemy acts first.
  const recent = (m: PlanMark) => ((turn - m.cast + 5) % 5) || (heroCast || enemyFirst ? 0 : 5);
  const by = new Map<string, PlanMark>();
  for (const m of marks) {
    const was = by.get(m.text);
    if (!was || recent(m) < recent(was)) by.set(m.text, m);
  }
  return [...by.values()].sort((a, b) => recent(b) - recent(a));
}

export interface PlanMember {
  row: "front" | "back";
  /** 0-2 */
  i: number;
  /** Hero name and class, for the column head. */
  name: string;
  cls: number;
  /** 5 skill names (English keys). */
  rotation: string[];
}

export interface HeroCell {
  turn: number;
  planned: string;
  /** What the hero really plays: the planned skill, "Basic" under a forced action, null when stunned. */
  does: string | null;
  /** The source skill of the stun or forced action, if any. */
  stunBy?: string;
  forcedBy?: string;
  tags: { short: string; long: string }[];
  marks: PlanMark[];
}

export interface EnemyCell {
  turn: number;
  skill: string;
  /** Compact summary of the skill ("AoE · atk −50%") and its long form. */
  short: string;
  long: string;
  /** Its own buffs still on from earlier casts (heroes act against them on this turn). */
  own: PlanMark[];
  /** What the heroes put on it for this turn (debuffs, DoT, taunt, dispel, cleanse), with their sources. */
  maluses: PlanMark[];
}

export interface PlanColumn {
  kind: "hero" | "enemy";
  /** Hero: party location 1-6. */
  loc?: number;
  member?: PlanMember;
  cells: (HeroCell | EnemyCell)[];
}

export interface PlanGrid {
  enemyFirst: boolean;
  /** In action order: the heroes (back 1, front 1, back 2 …) then the enemy, or the enemy first (questType 6). */
  columns: PlanColumn[];
}

/** The enemy's effects on the hero at `loc` while it plays its slot `turn` (steady state: the 5-turn cycle repeats). */
export function enemyHitsOn(tl: EnemyTimeline, loc: number, turn: number, occupied: number[]): { cast: number; e: EffectInfo }[] {
  const out: { cast: number; e: EffectInfo }[] = [];
  tl.slots.forEach((s, k) => {
    for (const e of s.effects) {
      if (e.on !== "heroes" || !fxTargets(e, occupied).includes(loc)) continue;
      if (coveredTurns(e.ownerTurns, k + 1).includes(turn)) out.push({ cast: k + 1, e });
    }
  });
  const recent = (h: { cast: number }) => ((turn - h.cast + 5) % 5) || (tl.enemyFirst ? 0 : 5);
  const byName = new Map<string, { cast: number; e: EffectInfo }>();
  for (const h of out) {
    const was = byName.get(h.e.name);
    if (!was || recent(h) < recent(was)) byName.set(h.e.name, h);
  }
  return [...byName.values()];
}

const BY_EFFECT = new Set<SkillTag>(["buff-self", "buff-party", "debuff-enemy", "debuff-party", "dot", "stun", "force-action", "stat-swap",
  "miss-chance", "shield", "reflect", "counter", "taunt", "heal-over-time"]);
/** The compact summary of an enemy skill: damage and heal tags, then each effect ("AoE · atk −50%"). */
function enemySummary(s: EnemyTimeline["slots"][number]): { short: string; long: string } {
  const parts: { short: string; long: string }[] = [];
  // Tags the effects say better ("debuff all" → "atk −50%") are left out when the skill has effects.
  for (const t of s.tags) if (!(s.effects.length && BY_EFFECT.has(t))) parts.push(compactTag(t, "enemy"));
  for (const e of s.effects) parts.push(compactEffect(e));
  const seen = new Set<string>();
  const uniq = parts.filter((p) => !seen.has(p.short) && seen.add(p.short));
  return { short: uniq.map((p) => p.short).join(" · "), long: uniq.map((p) => p.long).join(", ") };
}

/**
 * The plan grid of a party (its members, any order) against an enemy timeline. Hero effects on the enemy: offsets from
 * the probe (caster first, the enemy last); the enemy's own actions (ownerTurns) shift one turn when it acts first.
 * Defensive maluses (def, mdef, eva, damage taken) count over the turns the heroes act against them (facingTurns).
 */
export function planGrid(tl: EnemyTimeline, members: PlanMember[]): PlanGrid {
  const byLoc = new Map(members.map((m) => [locationOf(m.row, m.i), m]));
  const occupied = [...byLoc.keys()].sort((a, b) => a - b);
  const foe = enemyName(tl.quest, tl.rare) ?? tl.name;
  const heroCols: PlanColumn[] = occupied.map((loc) => {
    const m = byLoc.get(loc)!;
    const cells: HeroCell[] = [1, 2, 3, 4, 5].map((t) => {
      const planned = m.rotation[t - 1] || "Basic";
      const hits = enemyHitsOn(tl, loc, t, occupied);
      const stun = hits.find((h) => h.e.kind === "stun"), forced = hits.find((h) => h.e.kind === "force-action");
      const does = stun ? null : forced ? "Basic" : planned;
      const marks = hits.map((h) => {
        const src = tl.slots[h.cast - 1].name;
        const c = compactEffect(h.e);
        const again = h.cast >= t && !(tl.enemyFirst && h.cast === t) ? " From the second cycle on (the rotation repeats)." : "";
        return mark(src, c.short, `${skillName(src)}, cast by ${foe} on turn ${h.cast}: ${c.long}, ${lasts(h.e, "hero")}.`
          + `${h.e.removable ? " A cleanse removes it." : ""}${again}`, h.e.kind, h.cast);
      });
      const tags = does ? (skillProfile(does, "hero")?.tags ?? []).map((x) => compactTag(x, "hero")) : [];
      return { turn: t, planned, does, ...(stun ? { stunBy: tl.slots[stun.cast - 1].name } : {}),
        ...(forced ? { forcedBy: tl.slots[forced.cast - 1].name } : {}), tags, marks: latest(marks, t, tl.enemyFirst, false) };
    });
    return { kind: "hero", loc, member: m, cells };
  });

  // What the heroes put on the enemy, by enemy turn.
  const maluses: PlanMark[][] = [[], [], [], [], []];
  for (const col of heroCols) {
    for (const cell of col.cells as HeroCell[]) {
      const sk = cell.does;
      if (!sk || sk === "Basic") continue;
      const c = cell.turn, who = col.member!.name;
      const p = skillProfile(sk, "hero");
      if (!p) continue;
      for (const e of p.effects) {
        if (e.on !== "enemy") continue;
        const defensive = e.kind === "vulnerability" || (!!e.stats && Object.keys(e.stats).every((k) => ["def", "mdef", "eva"].includes(k)));
        let offs = defensive ? e.facingTurns : e.ownerTurns.map((o) => o + (tl.enemyFirst ? 1 : 0));
        if (e.until === "next-attack" || e.until === "next-hit") offs = offs.slice(0, 1);
        const turns = e.until === "permanent" ? [1, 2, 3, 4, 5] : coveredTurns(offs, c);
        const x = compactEffect(e);
        for (const t of turns) {
          maluses[t - 1].push(mark(sk, x.short, `${skillName(sk)}, cast by ${who} on turn ${c}: ${foe} ${x.long}, ${lasts(e, "enemy")}.`, e.kind, c));
        }
      }
      const at = slotOf(c + (tl.enemyFirst ? 1 : 0));
      if (p.tags.includes("dispel")) maluses[at - 1].push(mark(sk, "dispel", `${skillName(sk)}, cast by ${who} on turn ${c}: removes ${foe}'s buffs.`, "dispel", c));
      if (p.tags.includes("cleanse")) maluses[at - 1].push(mark(sk, "cleanse", `${skillName(sk)}, cast by ${who} on turn ${c}: removes ${foe}'s debuffs from the heroes.`, "cleanse", c));
    }
  }

  // The enemy's own buffs from earlier casts, over the turns the heroes act against them (not the cast turn itself).
  const own: PlanMark[][] = [[], [], [], [], []];
  tl.slots.forEach((s, k) => {
    for (const e of s.effects) {
      if (e.on !== "self" && e.on !== "party") continue;
      const x = compactEffect(e);
      const turns = e.until === "permanent" ? [1, 2, 3, 4, 5] : coveredTurns(e.facingTurns.filter((o) => o > 0), k + 1);
      for (const t of turns) {
        if (t === k + 1) continue;
        own[t - 1].push(mark(s.name, x.short, `${skillName(s.name)}, cast by ${foe} on turn ${k + 1}: ${x.long}, ${lasts(e, "enemy")}.`
          + `${e.removable ? " A dispel removes it." : ""}`, e.kind, k + 1));
      }
    }
  });

  const enemyCol: PlanColumn = {
    kind: "enemy",
    cells: tl.slots.map((s, k): EnemyCell => {
      const sum = enemySummary(s);
      return { turn: k + 1, skill: s.name, short: sum.short, long: sum.long, own: latest(own[k], k + 1, tl.enemyFirst, false),
        maluses: latest(maluses[k], k + 1, tl.enemyFirst, true) };
    }),
  };
  return { enemyFirst: tl.enemyFirst, columns: tl.enemyFirst ? [enemyCol, ...heroCols] : [...heroCols, enemyCol] };
}
