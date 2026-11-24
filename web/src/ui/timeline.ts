/**
 * Enemy timeline UI (U11) on web/src/tools/schedule.ts: what the enemy does on each of its 5 turns and how long each
 * effect lasts, so cleanses, heals and big hits can be timed around it.
 *
 * - enemyStrip(): the enemy's 5 turns (skill, tags) with its effect windows drawn across the turns they cover, in
 *   hero-action turns: an effect on the enemy (reflect, shield, buff) covers the turns heroes act while it is on
 *   (facingTurns); an effect on the heroes (debuff, stun) covers the turns they act with it (ownerTurns). Offsets are
 *   from the cast turn, so a window can wrap from turn 5 to turn 1 (the rotation repeats).
 * - partyPlan(): the party's rotations under the enemy's, one row per actor in the real action order (back 1, front 1,
 *   back 2, front 2, back 3, front 3, then the enemy; the enemy first on questType 6), with scoreSchedule's notes.
 *   U32: the hero cells also show what the enemy does to the heroes on that turn (enemyHitsOn: a forced action such
 *   as Drown strikes the planned skill out for Basic, a stun reads "Stunned", debuffs and damage over time are small
 *   markers), and the enemy cells say what each effect does and on whom (castLines).
 * - scheduleFor() / notesFor(): the same notes for the search results ("why this rotation").
 * Data: data/timelines.json (inventory/timelines.json), loaded once per page by loadTimelineData().
 */
import * as api from "../sim/api.ts";
import {
  type EffectInfo, type EnemyTimeline, enemyTimeline, loadTimelines, type PartyMember, scheduleContext, type ScheduleScore,
  scoreSchedule, type ScoreNote, type SkillTag, skillTags,
} from "../tools/schedule.ts";
import { el } from "./dom.ts";
import { tip } from "./tooltip.ts";
import { skillDesc, skillLink } from "./wiki-data.ts";
import { enemyName, skillName } from "./names.ts";

/** The timeline's enemy in the visitor's language (U29). */
const tlName = (tl: EnemyTimeline): string => enemyName(tl.quest, tl.rare) ?? tl.name;

// deno-lint-ignore no-explicit-any
type Any = any;

let ready: Promise<void> | null = null;
let loaded = false;
/** Fetches data/timelines.json once; the strip and the plan render nothing until it is in. */
export function loadTimelineData(): Promise<void> {
  ready ??= fetch("data/timelines.json").then((r) => {
    if (!r.ok) throw new Error(`timelines: HTTP ${r.status}`);
    return r.json();
  }).then((j) => {
    loadTimelines(j);
    loaded = true;
  });
  return ready;
}
export const timelinesLoaded = () => loaded;

/** The enemy's timeline, or null (not loaded, or no timeline for this quest). */
export function timelineOf(quest: number, rare = false): EnemyTimeline | null {
  if (!loaded) return null;
  try {
    return enemyTimeline(quest, rare);
  } catch {
    return null;
  }
}

/** Icon and words for each skill tag. */
const TAGS: Record<SkillTag, [string, string]> = {
  "damage-single": ["🗡️", "hits one"], "damage-split": ["⚔️", "hits, split"], "damage-row": ["↔️", "hits a row"], "damage-aoe": ["💥", "hits everyone"],
  "heal-self": ["💚", "heals itself"], "heal-ally": ["💚", "heals an ally"], "heal-party": ["💚", "heals the party"], "heal-over-time": ["💗", "heal over time"],
  "revive": ["✨", "revives"], "cleanse": ["🧼", "cleanses"], "cleanse-self": ["🧼", "cleanses itself"], "dispel": ["🌀", "dispels"],
  "buff-self": ["⬆️", "buffs itself"], "buff-party": ["⬆️", "buffs the party"], "debuff-enemy": ["⬇️", "debuffs the enemy"],
  "debuff-party": ["⬇️", "debuffs the heroes"], "dot": ["☠️", "damage over time"], "stun": ["💫", "stuns"], "force-action": ["🎯", "forces an action"],
  "shield": ["🛡️", "shield"], "reflect": ["🪞", "reflects damage"], "counter": ["↩️", "counters"], "taunt": ["📢", "taunts"],
  "stat-swap": ["🔀", "swaps stats"], "amplify": ["🔊", "amplifies"], "miss-chance": ["🌫️", "makes attacks miss"],
};
/** For the enemy, "party" and "enemy" read from its side. */
const enemyWords: Partial<Record<SkillTag, string>> = { "debuff-enemy": "debuffs the heroes", "buff-party": "buffs itself", "heal-party": "heals itself" };
const tagWords = (t: SkillTag, side: "hero" | "enemy") => (side === "enemy" ? enemyWords[t] : undefined) ?? TAGS[t]?.[1] ?? t;

const RULES = "Durations count in the owner's own actions. The enemy always follows its rotation and hits the front row, "
  + "split evenly, unless the skill says otherwise.";

function tagIcons(tags: SkillTag[], side: "hero" | "enemy"): HTMLElement {
  return el("span", { class: "tl-tags" }, ...tags.map((t) => {
    const s = el("span", { class: `tl-tag tl-${t}`, role: "img", "aria-label": tagWords(t, side) }, TAGS[t]?.[0] ?? "•");
    s.title = tagWords(t, side);
    return s;
  }));
}

const slotOf = (turn: number) => ((turn - 1) % 5 + 5) % 5 + 1;

/** Who an enemy-cast effect is on, and the hero-action turns (offsets from the cast) it covers. */
function windowOf(e: EffectInfo): { onEnemy: boolean; offsets: number[] } {
  const onEnemy = e.on === "self" || e.on === "party";
  return { onEnemy, offsets: onEnemy ? e.facingTurns : e.ownerTurns };
}

function effectTip(e: EffectInfo, cast: number, onEnemy: boolean, turns: number[]): HTMLElement {
  const until = e.until === "permanent" ? "until the end of the fight" : e.until === "next-hit" ? "until the next hit"
    : e.until === "next-attack" ? "until its next attack" : e.until === "toggle" ? "until cast again" : `${e.turns ?? "?"} of its owner's actions`;
  const stats = Object.entries(e.stats ?? {}).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ");
  return el("span", { class: "tip-body" }, el("strong", {}, e.name), el("span", { class: "tip-kind" }, `${e.kind} on ${onEnemy ? "the enemy" : "the heroes"}`),
    el("span", {}, `Cast on turn ${cast}, lasts ${until}: heroes act ${onEnemy ? "against it" : "with it"} on turn${turns.length > 1 ? "s" : ""} ${turns.join(", ")}.`),
    ...(stats ? [el("span", { class: "muted" }, stats)] : []), ...(e.removable ? [el("span", { class: "muted" }, onEnemy ? "A dispel removes it." : "A cleanse removes it.")] : []),
    el("span", { class: "muted" }, RULES));
}

/** One row per effect window, as segments over the 5 turn columns (wrapping windows split in two). */
function windowRows(tl: EnemyTimeline, col0: number): HTMLElement[] {
  const rows: HTMLElement[] = [];
  tl.slots.forEach((s, k) => {
    const cast = k + 1;
    for (const e of s.effects) {
      const { onEnemy, offsets } = windowOf(e);
      const permanent = e.until === "permanent" || offsets.length >= 5;
      // Covered turns in the 5-turn cycle, in order from the cast.
      const turns = [...new Set(offsets.map((o) => slotOf(cast + o)))];
      if (!turns.length) continue;
      const cls = `tl-win ${onEnemy ? "on-enemy" : "on-heroes"} k-${e.kind}`;
      const segs: [number, number][] = [];
      if (permanent) segs.push([1, 5]);
      else {
        // consecutive runs of covered turns (in cycle order from the cast)
        let start = turns[0], prev = turns[0];
        for (const t of turns.slice(1)) {
          if (t === prev + 1) prev = t;
          else {
            segs.push([start, prev]);
            start = prev = t;
          }
        }
        segs.push([start, prev]);
      }
      const row = el("div", { class: "tl-winrow" });
      segs.forEach(([a, b], i) => {
        // .tl-when (the turns, as text) shows only where the strip is stacked one turn per line (narrow box, CSS).
        const seg = el("span", { class: cls, style: `grid-column: ${col0 + a - 1} / ${col0 + b}`, tabindex: "0" },
          `${i > 0 ? "↪ " : ""}${e.name}${permanent ? " (rest of fight)" : ""}${i < segs.length - 1 ? " ↩" : ""}`,
          el("span", { class: "tl-when" }, permanent ? " · T1–T5" : a === b ? ` · T${a}` : ` · T${a}–T${b}`));
        tip(seg, () => effectTip(e, cast, onEnemy, permanent ? [1, 2, 3, 4, 5] : turns));
        row.append(seg);
      });
      rows.push(row);
    }
  });
  return rows;
}

/**
 * U24: the whole card opens the skill's page. The skill name stays the one real link (keyboard, middle-click, screen
 * readers); CSS stretches its click area over the card (`.tl-cell.tl-link a.wl.skill::after`), so hovering anywhere on
 * the card also shows the skill's tooltip. "Basic" has no page and stays a plain card.
 */
function linkCard(cell: HTMLElement, name: string): HTMLElement {
  if (name !== "Basic") cell.classList.add("tl-link");
  return cell;
}

/** An enemy turn: tags, the skill (linked) and, with `desc`, what the skill does. */
function enemyCell(s: Any, turn: number, desc = true): HTMLElement {
  const name = el("span", { class: "tl-skill" }, s.name === "Basic" ? "Basic" : skillLink(s.name));
  const text = desc && s.name !== "Basic" ? skillDesc(s.name) : "";
  const cell = el("div", { class: "tl-cell enemy" }, el("span", { class: "tl-turn", "aria-hidden": "true" }, `T${turn}`),
    tagIcons(s.tags, "enemy"), name, ...(text ? [el("span", { class: "tl-desc" }, text)] : []));
  cell.title = `Turn ${turn}: ${skillName(s.name)}${s.tags.length ? ` (${s.tags.map((t: SkillTag) => tagWords(t, "enemy")).join(", ")})` : ""}`;
  return linkCard(cell, s.name);
}

/** What the strip's bars mean (the wiki puts it in a "?" next to the title; enemyStrip prints it under the strip). */
export function stripNote(tl: EnemyTimeline): string {
  return `${tl.enemyFirst ? "Acts before the heroes every turn. " : ""}Bars: how long each effect lasts, in the turns the heroes act. `
    + "Turn 6 is turn 1 again.";
}

/**
 * The enemy's 5 turns (each card: tags, skill, its effect; the whole card opens the skill page) and its effect windows.
 * Five columns, or one turn per line in a narrow box (container query, `wiki v5` block of style.css).
 * `note: false` leaves out the line under it (stripNote) for pages that explain it elsewhere.
 */
export function enemyStrip(tl: EnemyTimeline, opts: { note?: boolean } = {}): HTMLElement {
  return el("div", { class: "tl tl-strip", role: "group", "aria-label": `${tlName(tl)}: 5-turn timeline` },
    el("div", { class: "tl-grid" }, ...[1, 2, 3, 4, 5].map((t) => el("div", { class: "tl-head" }, `T${t}`)),
      ...tl.slots.map((s, k) => enemyCell(s, k + 1))),
    ...windowRows(tl, 1),
    ...(opts.note === false ? [] : [el("p", { class: "muted small tl-note" }, stripNote(tl))]));
}

// ---------------------------------------------------------------- what the enemy does to the heroes (U32)
const STAT_WORDS: Record<string, string> = {
  atk: "Atk", matk: "Matk", def: "Def", mdef: "Mdef", acc: "Acc", eva: "Eva", crit: "Crit", critMod: "crit damage", maxHP: "max HP",
  atkBns: "Atk", matkBns: "Matk", defBns: "Def", mdefBns: "Mdef",
};
/** "Atk −50 %" for a timeline effect's stat: fractions read as percents, bigger numbers as they are. */
function fxStat(k: string, v: number): string {
  const sign = v < 0 ? "−" : "+", a = Math.abs(v);
  return `${STAT_WORDS[k] ?? k} ${sign}${a <= 5 ? `${Math.round(a * 100)} %` : String(Math.round(a))}`;
}
const fxStats = (e: EffectInfo) => Object.entries(e.stats ?? {}).filter(([, v]) => v !== 0).map(([k, v]) => fxStat(k, v));

/** What an effect does to its owner, in plain words. */
function fxWhat(e: EffectInfo): string {
  switch (e.kind) {
    case "force-action": return "abilities disabled (Basic only)";
    case "stun": return "stunned (the action is lost)";
    case "dot": return "damage over time";
    case "stat-swap": return "stats swapped";
    case "miss-chance": return "attacks may miss";
    case "shield": return "a shield";
    case "reflect": return "reflects damage";
    case "counter": return "counters attacks";
    case "taunt": return "taunts";
    case "hot": return "heals over time";
    case "vulnerability": return "takes more damage";
    default: return fxStats(e).join(", ") || e.kind;
  }
}

/** Icon and short label of an enemy effect on a hero's plan cell. */
function fxMark(e: EffectInfo): [string, string] {
  switch (e.kind) {
    case "force-action": return ["🎯", `${e.name}: Basic only`];
    case "stun": return ["💫", "Stunned"];
    case "dot": return ["☠️", e.name];
    case "stat-swap": return ["🔀", e.name];
    case "miss-chance": return ["🌫️", e.name];
    default: return ["⬇️", fxStats(e).join(", ") || e.name];
  }
}

const LOC_LABEL = (loc: number) => `${loc % 2 ? "Back" : "Front"} ${Math.ceil(loc / 2)}`;

/**
 * The party locations an enemy effect on the heroes lands on, for this party. The probe hit a full party; with a row
 * empty, a row effect falls on the other row (as the schedule scorer counts row attacks).
 */
function fxTargets(e: EffectInfo, occupied: number[]): number[] {
  const locs = e.locations ?? [1, 2, 3, 4, 5, 6];
  const hit = occupied.filter((l) => locs.includes(l));
  if (hit.length || !occupied.length) return hit;
  if (locs.every((l) => l % 2 === 0)) return occupied.filter((l) => l % 2 === 1);
  if (locs.every((l) => l % 2 === 1)) return occupied.filter((l) => l % 2 === 0);
  return [];
}

/** "all heroes", "the front row", "Back 2 and Front 3". */
function whomText(locs: number[]): string {
  const s = [...locs].sort((a, b) => a - b);
  if (s.length === 6) return "all heroes";
  if (s.length === 3 && s.every((l) => l % 2 === 0)) return "the front row";
  if (s.length === 3 && s.every((l) => l % 2 === 1)) return "the back row";
  const names = s.map(LOC_LABEL);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "nobody";
}

/** The hero turns (1-5, in order from the cast) an enemy effect cast on `cast` covers: its owner's turns for the heroes. */
const coveredTurns = (e: EffectInfo, cast: number) => [...new Set(windowOf(e).offsets.map((o) => slotOf(cast + o)))];

export interface EnemyHit {
  /** Enemy turn (1-5) that cast it. */
  cast: number;
  e: EffectInfo;
}

/**
 * Enemy effects on the hero at `loc` while it plays its slot `turn` (steady state: the 5-turn cycle repeats, so a
 * window cast on turn 5 covers turn 1 from the second cycle on). Durations count in the heroes' own actions; the
 * probe's offsets already put the enemy last (first on questType 6). `occupied`: the party's locations.
 */
export function enemyHitsOn(tl: EnemyTimeline, loc: number, turn: number, occupied: number[]): EnemyHit[] {
  const out: EnemyHit[] = [];
  tl.slots.forEach((s, k) => {
    for (const e of s.effects) {
      if (e.on !== "heroes" || !fxTargets(e, occupied).includes(loc)) continue;
      if (coveredTurns(e, k + 1).includes(turn)) out.push({ cast: k + 1, e });
    }
  });
  // The same effect cast again (Tidal Wave on T1 and T4) replaces itself: keep the latest cast before this turn.
  const recent = (h: EnemyHit) => ((turn - h.cast + 5) % 5) || (tl.enemyFirst ? 0 : 5);
  const byName = new Map<string, EnemyHit>();
  for (const h of out) {
    const was = byName.get(h.e.name);
    if (!was || recent(h) < recent(was)) byName.set(h.e.name, h);
  }
  return [...byName.values()];
}

/** The plan's enemy cell: what each effect of this turn does, and on whom, in plain words. */
function castLines(s: Any, cast: number, occupied: number[]): HTMLElement[] {
  return (s.effects as EffectInfo[]).map((e) => {
    const turns = coveredTurns(e, cast).map((t) => `T${t}`).join(", ");
    if (e.on === "heroes") {
      // In the skill's own words (all heroes, a row) when it lands where the probe saw it; else the heroes it falls on.
      const hit = fxTargets(e, occupied), locs = e.locations ?? [1, 2, 3, 4, 5, 6];
      const who = hit.length && hit.every((l) => locs.includes(l)) ? locs : hit;
      const long = e.until === "next-attack" || e.until === "next-hit" ? "for their next action"
        : e.until === "permanent" ? "for the rest of the fight" : `for their next ${e.turns ?? "?"} action${e.turns === 1 ? "" : "s"}`;
      return el("span", { class: `tl-cast on-heroes k-${e.kind}` }, el("strong", {}, `${e.name} → ${who.length ? whomText(who) : "nobody here"}`),
        `: ${fxWhat(e)}, ${long}${turns ? ` (${turns})` : ""}.`);
    }
    if (e.on === "self" || e.on === "party") {
      return el("span", { class: `tl-cast on-enemy k-${e.kind}` }, el("strong", {}, `${e.name} → itself`),
        `: ${fxWhat(e)}${turns ? `, heroes face it on ${turns}` : ""}.`);
    }
    return el("span", { class: `tl-cast k-${e.kind}` }, el("strong", {}, e.name), `: ${fxWhat(e)}.`);
  });
}

// ---------------------------------------------------------------- party plan
export interface PlanMember {
  row: "front" | "back";
  /** 0-2 */
  i: number;
  raw: Any;
  rotation: string[];
}

/** Party location as schedule.ts counts it: back row 1, 3, 5, front row 2, 4, 6 (back 1 acts first). */
export const locationOf = (row: "front" | "back", i: number) => (row === "back" ? 2 * i + 1 : 2 * i + 2);

/** scoreSchedule for this party against the quest's enemy (stats from the save heroes), or null without a timeline. */
export function scheduleFor(quest: { id: number; rare: boolean; amount: number }, members: PlanMember[]): { tl: EnemyTimeline; score: ScheduleScore } | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl || !members.length) return null;
  const front: Any[] = [null, null, null], back: Any[] = [null, null, null];
  for (const m of members) (m.row === "front" ? front : back)[m.i] = api.newHero(m.raw);
  let ctx;
  try {
    ctx = scheduleContext(quest.id, front, back, { rare: quest.rare, amount: quest.amount });
  } catch {
    ctx = undefined;
  }
  const party: PartyMember[] = members.map((m) => ({ location: locationOf(m.row, m.i), rotation: m.rotation }));
  return { tl, score: scoreSchedule(party, tl, {}, ctx) };
}

/** A note as a small line: ✓ helps, ⚠ hurts. */
function noteLine(n: ScoreNote, withTurn = false): HTMLElement {
  const good = n.delta >= 0;
  return el("span", { class: `tl-noteline ${good ? "good" : "bad"}` }, good ? "✓ " : "⚠ ", withTurn ? `T${n.turn} ${skillName(n.skill)}: ` : "", n.why);
}

/** The notes of one hero (by location), for the search results: "why this rotation". */
export function notesFor(score: ScheduleScore, location: number): HTMLElement | null {
  const mine = score.notes.filter((n) => n.location === location && Math.abs(n.delta) > 1e-9);
  if (!mine.length) return null;
  return el("div", { class: "tl-why" }, el("span", { class: "muted small" }, "Against the enemy's timeline:"),
    ...mine.slice(0, 6).map((n) => noteLine(n, true)), ...(mine.length > 6 ? [el("span", { class: "muted small" }, `+${mine.length - 6} more`)] : []));
}

/** The party's 5-turn plan under the enemy's, with the scorer's notes per cell. */
export function partyPlan(quest: { id: number; rare: boolean; amount: number }, members: PlanMember[]): HTMLElement | null {
  const res = scheduleFor(quest, members);
  if (!res) return null;
  const { tl, score } = res;
  const byLoc = new Map(members.map((m) => [locationOf(m.row, m.i), m]));
  const label = (loc: number) => `${loc % 2 ? "Back" : "Front"} ${Math.ceil(loc / 2)}`;
  const occupied = [...byLoc.keys()];
  const heroRows = [1, 2, 3, 4, 5, 6].filter((loc) => byLoc.has(loc)).map((loc) => {
    const m = byLoc.get(loc)!;
    return [el("div", { class: `tl-actor cls-${m.raw.class}` }, el("strong", {}, String(m.raw.name)), el("span", { class: "muted small" }, label(loc))),
      ...[1, 2, 3, 4, 5].map((t) => {
        const sk = m.rotation[t - 1] ?? "Basic";
        const notes = score.notes.filter((n) => n.location === loc && n.turn === t && Math.abs(n.delta) > 1e-9);
        // U32: what the enemy does to this hero on this turn. A stun loses the action; a forced action (Drown)
        // turns the planned skill into Basic: the planned one is struck out.
        const hits = enemyHitsOn(tl, loc, t, occupied);
        const stun = hits.find((h) => h.e.kind === "stun");
        const forced = hits.find((h) => h.e.kind === "force-action");
        const planned = sk === "Basic" ? el("span", {}, "Basic") : skillLink(sk);
        const skill = stun ? el("span", { class: "tl-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(sk)}` }, planned), " ",
          el("span", { class: "tl-forced" }, "Stunned"))
          : forced && sk !== "Basic" ? el("span", { class: "tl-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(sk)}` }, planned), " ",
            el("span", { class: "tl-forced" }, "→ Basic"))
          : el("span", { class: "tl-skill" }, planned);
        const marks = hits.map((h) => {
          const [ico, text] = fxMark(h.e);
          const why = `${h.e.name}, cast by ${tlName(tl)} on turn ${h.cast}: ${fxWhat(h.e)}.${h.e.removable ? " A cleanse removes it." : ""}`
            + `${h.cast >= t && !(tl.enemyFirst && h.cast === t) ? " From the second cycle on (the rotation repeats)." : ""}`;
          return el("span", { class: `tl-hit k-${h.e.kind}`, title: why, "aria-label": why }, el("span", { "aria-hidden": "true" }, `${ico} `), text);
        });
        const cell = el("div", { class: `tl-cell hero${notes.some((n) => n.delta < 0) ? " warn" : notes.length ? " ok" : ""}${hits.length ? " hit" : ""}${stun || forced ? " forced" : ""}` },
          // The tags of what the hero really does: nothing when stunned, Basic when its abilities are disabled.
          tagIcons(stun ? [] : skillTags(forced ? "Basic" : sk, "hero"), "hero"), skill, ...marks, ...notes.map((n) => noteLine(n)));
        return linkCard(cell, sk);
      })];
  });
  const enemyRow = [el("div", { class: "tl-actor enemy" }, el("strong", {}, tlName(tl)), el("span", { class: "muted small" }, "enemy")),
    ...tl.slots.map((s, k) => {
      const cell = enemyCell(s, k + 1, false);
      cell.append(...castLines(s, k + 1, occupied));
      return cell;
    })];
  const rows = tl.enemyFirst ? [enemyRow, ...heroRows] : [...heroRows, enemyRow];
  const fmtScore = (x: number) => x.toFixed(1);
  return el("div", { class: "tl tl-plan", role: "group", "aria-label": "The party's 5-turn plan against the enemy's" },
    el("div", { class: "tl-grid plan" }, el("div", { class: "tl-head" }, "Acts in order ↓"),
      ...[1, 2, 3, 4, 5].map((t) => el("div", { class: "tl-head", title: `Schedule score of turn ${t} (higher is better)` }, `T${t}`,
        el("span", { class: "muted small" }, ` ${fmtScore(score.perTurn[t - 1] ?? 0)}`))),
      ...rows.flat()),
    ...windowRows(tl, 2).map((r) => {
      r.classList.add("plan");
      return r;
    }),
    el("p", { class: "muted small tl-note" }, `Each hero plays slot k of its rotation on turn k, in this order${tl.enemyFirst ? " (the enemy first)" : ", then the enemy"}. `
      + "On the hero cells, what the enemy does to them on that turn (🎯 abilities disabled: the planned skill is struck out and the hero plays Basic; "
      + "💫 stunned; ⬇️ debuffs; ☠️ damage over time), unless a cleanse removes it first. "
      + `✓ / ⚠: the schedule score's reasons (cleanse after a debuff, no damage into a reflect, heal after a big hit …). `
      + `Score ${fmtScore(score.total)} per 5 turns, a quick guide: the simulation decides.`));
}
