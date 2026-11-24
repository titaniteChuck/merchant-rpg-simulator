/**
 * The battle page's plan as data (U36), for timeline.ts to draw: a grid whose columns are the heroes in action
 * order plus the enemy, and whose rows are turns 1-10 (U39: two rounds of the 5-turn rotation, counted from the start
 * of the fight, so turn 1 carries nothing over and turns 6-10 show the rotation coming back with what round one left
 * on). Pure (no DOM), so Node tests can check it.
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

/** How many turns the plan shows (U39): two rounds of the 5-turn rotation, so turns 6-10 show it coming back. */
export const PLAN_TURNS = 10;
/** The turns of the plan (1..n). */
const planTurns = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
/** The fight's turns (absolute, from 1) an effect cast on turn `cast` covers, offsets from the cast. */
const coveredTurns = (offsets: number[], cast: number) => [...new Set(offsets.map((o) => cast + o))];
/** The turns (absolute) the enemy casts its rotation's slot k (1-5) on, up to turn n. */
const castsOf = (k: number, n: number) => planTurns(n).filter((t) => slotOf(t) === k);

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
  /** Turn of the fight (from 1) of the cast. */
  cast: number;
}

const mark = (source: string, short: string, title: string, kind: string, cast: number): PlanMark =>
  ({ source, text: `[${skillName(source)}] ${short}`, title, kind, cast });

/** Keep the latest cast of each marker (the same effect cast again replaces itself), in cast order. */
function latest(marks: PlanMark[], turn: number): PlanMark[] {
  // U39: turns count from the start of the fight, so a cast is never after the turn it shows on.
  const recent = (m: PlanMark) => turn - m.cast;
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

/**
 * The enemy's effects on the hero at `loc` while it plays turn `turn` of the fight (U39: counted from turn 1, so turn 1
 * carries nothing over; from turn 6 on, the casts of the previous round still on show again).
 */
export function enemyHitsOn(tl: EnemyTimeline, loc: number, turn: number, occupied: number[]): { cast: number; e: EffectInfo }[] {
  const out: { cast: number; e: EffectInfo }[] = [];
  tl.slots.forEach((s, k) => {
    for (const e of s.effects) {
      if (e.on !== "heroes" || !fxTargets(e, occupied).includes(loc)) continue;
      for (const c of castsOf(k + 1, turn)) if (coveredTurns(e.ownerTurns, c).includes(turn)) out.push({ cast: c, e });
    }
  });
  const recent = (h: { cast: number }) => turn - h.cast;
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
export function planGrid(tl: EnemyTimeline, members: PlanMember[], n = PLAN_TURNS): PlanGrid {
  const byLoc = new Map(members.map((m) => [locationOf(m.row, m.i), m]));
  const occupied = [...byLoc.keys()].sort((a, b) => a - b);
  const foe = enemyName(tl.quest, tl.rare) ?? tl.name;
  const slotName = (cast: number) => tl.slots[slotOf(cast) - 1].name;
  const heroCols: PlanColumn[] = occupied.map((loc) => {
    const m = byLoc.get(loc)!;
    const cells: HeroCell[] = planTurns(n).map((t) => {
      const planned = m.rotation[slotOf(t) - 1] || "Basic";
      const hits = enemyHitsOn(tl, loc, t, occupied);
      const stun = hits.find((h) => h.e.kind === "stun"), forced = hits.find((h) => h.e.kind === "force-action");
      const does = stun ? null : forced ? "Basic" : planned;
      const marks = hits.map((h) => {
        const src = slotName(h.cast);
        const c = compactEffect(h.e);
        return mark(src, c.short, `${skillName(src)}, cast by ${foe} on turn ${h.cast}: ${c.long}, ${lasts(h.e, "hero")}.`
          + `${h.e.removable ? " A cleanse removes it." : ""}`, h.e.kind, h.cast);
      });
      const tags = does ? (skillProfile(does, "hero")?.tags ?? []).map((x) => compactTag(x, "hero")) : [];
      return { turn: t, planned, does, ...(stun ? { stunBy: slotName(stun.cast) } : {}),
        ...(forced ? { forcedBy: slotName(forced.cast) } : {}), tags, marks: latest(marks, t) };
    });
    return { kind: "hero", loc, member: m, cells };
  });

  // What the heroes put on the enemy, by enemy turn (index t - 1; turns past n are dropped).
  const maluses: PlanMark[][] = planTurns(n).map(() => []);
  const onTurn = (arr: PlanMark[][], t: number, m: PlanMark) => (t >= 1 && t <= n ? arr[t - 1].push(m) : 0);
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
        // The enemy's first turn under it: the cast turn, or the next one when the enemy acts first.
        const from = c + (tl.enemyFirst ? 1 : 0);
        const turns = e.until === "permanent" ? planTurns(n).filter((t) => t >= from) : coveredTurns(offs, c);
        const x = compactEffect(e);
        for (const t of turns) {
          onTurn(maluses, t, mark(sk, x.short, `${skillName(sk)}, cast by ${who} on turn ${c}: ${foe} ${x.long}, ${lasts(e, "enemy")}.`, e.kind, c));
        }
      }
      const at = c + (tl.enemyFirst ? 1 : 0);
      if (p.tags.includes("dispel")) onTurn(maluses, at, mark(sk, "dispel", `${skillName(sk)}, cast by ${who} on turn ${c}: removes ${foe}'s buffs.`, "dispel", c));
      if (p.tags.includes("cleanse")) onTurn(maluses, at, mark(sk, "cleanse", `${skillName(sk)}, cast by ${who} on turn ${c}: removes ${foe}'s debuffs from the heroes.`, "cleanse", c));
    }
  }

  // The enemy's own buffs from earlier casts, over the turns the heroes act against them (not the cast turn itself).
  const own: PlanMark[][] = planTurns(n).map(() => []);
  tl.slots.forEach((s, k) => {
    for (const e of s.effects) {
      if (e.on !== "self" && e.on !== "party") continue;
      const x = compactEffect(e);
      for (const c of castsOf(k + 1, n)) {
        const turns = e.until === "permanent" ? planTurns(n).filter((t) => t > c) : coveredTurns(e.facingTurns.filter((o) => o > 0), c);
        for (const t of turns) {
          if (t === c) continue;
          onTurn(own, t, mark(s.name, x.short, `${skillName(s.name)}, cast by ${foe} on turn ${c}: ${x.long}, ${lasts(e, "enemy")}.`
            + `${e.removable ? " A dispel removes it." : ""}`, e.kind, c));
        }
      }
    }
  });

  const enemyCol: PlanColumn = {
    kind: "enemy",
    cells: planTurns(n).map((t): EnemyCell => {
      const s = tl.slots[slotOf(t) - 1];
      const sum = enemySummary(s);
      return { turn: t, skill: s.name, short: sum.short, long: sum.long, own: latest(own[t - 1], t), maluses: latest(maluses[t - 1], t) };
    }),
  };
  return { enemyFirst: tl.enemyFirst, columns: tl.enemyFirst ? [enemyCol, ...heroCols] : [...heroCols, enemyCol] };
}

// ---------------------------------------------------------------- the flow of one fight (U39)
/*
 * The flow diagram's data (U39), from one simulated fight (tools/fight-trace.ts: Simulate's first fight, or one room
 * of the Map run mode's first run), every turn from 1 until the fight ends. Inside each turn, one line per action in
 * the order the fighters act: the actor's column holds the skill it played (the planned one struck out under a stun or
 * a forced action), each other column the damage or healing that fighter took, and a dot where an effect landed. Under
 * the lines, each fighter's HP and its effects at the end of the turn, as chips; an effect on every standing hero is
 * one chip over the hero columns. Turns 1-5 are the rotation (editable on the page); a light divider every 5 turns.
 */
export interface TimelineChip {
  /** 0 = the enemy, 1-6 = party location, -1 = every hero. */
  who: number;
  /** Engine name (English) and its label in the visitor's language. */
  name: string;
  label: string;
  debuff: boolean;
  /** Turns left, when the effect counts them. */
  turns?: number;
  title: string;
}
export interface TimelineCell {
  dmg: number;
  heal: number;
  /** The fighter fell during this action. */
  ko: boolean;
  /** Effects that landed on this fighter during this action (new, or cast again). */
  added: TimelineChip[];
}
export interface TimelineLine {
  /** 0 = the enemy, 1-6 = party location. */
  who: number;
  planned: string;
  /** The skill played; false: stunned (the action is lost); null: down. */
  did: string | false | null;
  misses: number;
  /** By fighter (0 = the enemy). */
  cells: Record<number, TimelineCell>;
}
export interface TimelineTurn {
  turn: number;
  /** Turns 1-5: the rotation itself (the page edits it there); later turns repeat it. */
  rotation: boolean;
  /** The 5-turn round (0 = turns 1-5, 1 = turns 6-10 …): a divider between rounds. */
  round: number;
  /** The actions of this turn, in order. */
  lines: TimelineLine[];
  /** End of the turn: each fighter's HP, and its own effects (those on every standing hero are in `shared`). */
  hp: Record<number, { hp: number; maxHP: number }>;
  status: Record<number, TimelineChip[]>;
  shared: TimelineChip[];
}
export interface PlanTimeline {
  turns: TimelineTurn[];
  /** How the fight ended: won, lost, or stopped at the game's turn cap (lost too, for the game). */
  won: boolean;
  capped: boolean;
  lastTurn: number;
}

/** The game's turn cap (Battle.combatLoop): at 200 turns the fight stops, lost. */
export const TURN_CAP = 200;

type TracedFx = { who: number; name: string; debuff: boolean; turns?: number; stats?: Record<string, number> };
/** What the timeline needs of a traced fight (tools/fight-trace.ts FightTrace). */
export interface TracedFight {
  won: boolean;
  turns: number;
  actions: { turn: number; who: number; planned: string; did: string | false | null; misses: number;
    hits: { who: number; dmg: number; heal: number; hp: number }[]; fx: TracedFx[];
    life?: { who: number; hp: number; maxHP: number }[] }[];
}

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

function chipOf(f: TracedFx, who: (w: number) => string): TimelineChip {
  const label = effectName(f.name);
  const stats = Object.entries(f.stats ?? {}).filter(([, v]) => v !== 0).map(([k, v]) => compactStat(k, v).long);
  const left = f.turns === undefined ? "" : `, ${f.turns} turn${f.turns === 1 ? "" : "s"} left`;
  return { who: f.who, name: f.name, label, debuff: f.debuff, ...(f.turns === undefined ? {} : { turns: f.turns }),
    title: `${label} on ${who(f.who)}: ${f.debuff ? "debuff" : "buff"}${stats.length ? ` (${stats.join(", ")})` : ""}${left}.` };
}

/** Effects still on: with 0 turns left an effect ends at its owner's next action, so it no longer shows. */
const liveFx = (fx: TracedFx[]) => fx.filter((f) => f.turns === undefined || f.turns > 0);

/**
 * The flow of a traced fight, every turn from 1 to its end. `occupied`: the party locations in the fight (for "on
 * every hero"); `who`: a fighter's name for the tooltips.
 */
export function planTimeline(trace: TracedFight, occupied: number[],
  who: (w: number) => string = (w) => (w ? locationLabel(w) : "the enemy")): PlanTimeline {
  const turns: TimelineTurn[] = [];
  let prev: TracedFx[] = [];
  const hp: Record<number, { hp: number; maxHP: number }> = {};
  const byTurn = new Map<number, TracedFight["actions"]>();
  for (const a of trace.actions) {
    if (!byTurn.has(a.turn)) byTurn.set(a.turn, []);
    byTurn.get(a.turn)!.push(a);
  }
  for (let t = 1; t <= trace.turns; t++) {
    const acts = byTurn.get(t) ?? [];
    const lines: TimelineLine[] = acts.map((a) => {
      const before = new Map(liveFx(prev).map((f) => [`${f.who}|${f.name}`, f.turns ?? Infinity]));
      const cells: Record<number, TimelineCell> = {};
      const cell = (w: number) => (cells[w] ??= { dmg: 0, heal: 0, ko: false, added: [] });
      // KO: standing before this action (HP before = after + damage − healing), down after it.
      for (const h of a.hits) Object.assign(cell(h.who), { dmg: h.dmg, heal: h.heal, ko: h.hp <= 0 && h.hp + h.dmg - h.heal > 0 });
      for (const f of liveFx(a.fx)) {
        const was = before.get(`${f.who}|${f.name}`);
        // New, or cast again (more turns left than before).
        if (was === undefined || (f.turns ?? Infinity) > was) cell(f.who).added.push(chipOf(f, who));
      }
      for (const l of a.life ?? []) hp[l.who] = { hp: l.hp, maxHP: l.maxHP };
      prev = a.fx;
      return { who: a.who, planned: a.planned, did: a.did, misses: a.misses, cells };
    });
    const end = liveFx(prev);
    const standing = occupied.filter((l) => l > 0 && (hp[l]?.hp ?? 1) > 0);
    const names = [...new Set(end.filter((f) => f.who > 0).map((f) => f.name))];
    const sharedNames = standing.length > 1 ? names.filter((nm) => standing.every((h) => end.some((f) => f.who === h && f.name === nm))) : [];
    const shared = sharedNames.map((nm) => {
      const on = end.filter((f) => f.who > 0 && f.name === nm);
      const left = new Set(on.map((f) => f.turns));
      // One chip for the party: its turns left only when every hero has the same.
      return { ...chipOf({ ...on[0], turns: left.size === 1 ? on[0].turns : undefined }, () => "every hero"), who: -1 };
    });
    const status: Record<number, TimelineChip[]> = {};
    for (const f of end) {
      if (f.who > 0 && sharedNames.includes(f.name)) continue;
      (status[f.who] ??= []).push(chipOf(f, who));
    }
    turns.push({ turn: t, rotation: t <= 5, round: Math.floor((t - 1) / 5), lines, hp: structuredClone(hp), status, shared });
  }
  return { turns, won: trace.won, capped: !trace.won && trace.turns >= TURN_CAP, lastTurn: trace.turns };
}

/** One entry of the flow's room bar (map runs): "1 · Wolf Pack" … "Boss · Murlok Monarch", in map order. */
export interface RoomTab {
  index: number;
  label: string;
  boss: boolean;
  /** 0 not reached in this run, 1 won, 2 lost. */
  status: number;
}
/** The room bar's entries, in map order; `name`: an enemy's name in the visitor's language. */
export function mapRoomTabs(rooms: { questId: number; name: string; isRare: boolean; boss: boolean; status: number }[],
  name: (questId: number, rare: boolean) => string | undefined = () => undefined): RoomTab[] {
  return rooms.map((r, k) => {
    const n = name(r.questId, r.isRare) ?? r.name;
    return { index: k, label: r.boss ? `Boss · ${n}` : `${k + 1} · ${n}`, boss: r.boss, status: r.status };
  });
}

