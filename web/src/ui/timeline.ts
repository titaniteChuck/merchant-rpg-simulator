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
import { skillLink } from "./wiki-data.ts";

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
        const seg = el("span", { class: cls, style: `grid-column: ${col0 + a - 1} / ${col0 + b}`, tabindex: "0" },
          `${i > 0 ? "↪ " : ""}${e.name}${permanent ? " (rest of fight)" : ""}${i < segs.length - 1 ? " ↩" : ""}`);
        tip(seg, () => effectTip(e, cast, onEnemy, permanent ? [1, 2, 3, 4, 5] : turns));
        row.append(seg);
      });
      rows.push(row);
    }
  });
  return rows;
}

function enemyCell(s: Any, turn: number): HTMLElement {
  const name = el("span", { class: "tl-skill" }, s.name === "Basic" ? "Basic" : skillLink(s.name));
  const cell = el("div", { class: "tl-cell enemy" }, tagIcons(s.tags, "enemy"), name);
  cell.title = `Turn ${turn}: ${s.name}${s.tags.length ? ` (${s.tags.map((t: SkillTag) => tagWords(t, "enemy")).join(", ")})` : ""}`;
  return cell;
}

/** The enemy's 5 turns and its effect windows. */
export function enemyStrip(tl: EnemyTimeline): HTMLElement {
  return el("div", { class: "tl", role: "group", "aria-label": `${tl.name}: 5-turn timeline` },
    el("div", { class: "tl-grid" }, ...[1, 2, 3, 4, 5].map((t) => el("div", { class: "tl-head" }, `T${t}`)),
      ...tl.slots.map((s, k) => enemyCell(s, k + 1))),
    ...windowRows(tl, 1),
    el("p", { class: "muted small tl-note" }, `${tl.enemyFirst ? "Acts before the heroes every turn. " : ""}Bars: how long each effect lasts, in the turns the heroes act. `
      + "Turn 6 is turn 1 again."));
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
  return el("span", { class: `tl-noteline ${good ? "good" : "bad"}` }, good ? "✓ " : "⚠ ", withTurn ? `T${n.turn} ${n.skill}: ` : "", n.why);
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
  const heroRows = [1, 2, 3, 4, 5, 6].filter((loc) => byLoc.has(loc)).map((loc) => {
    const m = byLoc.get(loc)!;
    return [el("div", { class: `tl-actor cls-${m.raw.class}` }, el("strong", {}, String(m.raw.name)), el("span", { class: "muted small" }, label(loc))),
      ...[1, 2, 3, 4, 5].map((t) => {
        const sk = m.rotation[t - 1] ?? "Basic";
        const notes = score.notes.filter((n) => n.location === loc && n.turn === t && Math.abs(n.delta) > 1e-9);
        const cell = el("div", { class: `tl-cell hero${notes.some((n) => n.delta < 0) ? " warn" : notes.length ? " ok" : ""}` },
          tagIcons(skillTags(sk, "hero"), "hero"), el("span", { class: "tl-skill" }, sk === "Basic" ? "Basic" : skillLink(sk)),
          ...notes.map((n) => noteLine(n)));
        return cell;
      })];
  });
  const enemyRow = [el("div", { class: "tl-actor enemy" }, el("strong", {}, tl.name), el("span", { class: "muted small" }, "enemy")),
    ...tl.slots.map((s, k) => enemyCell(s, k + 1))];
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
      + `✓ / ⚠: the schedule score's reasons (cleanse after a debuff, no damage into a reflect, heal after a big hit …). `
      + `Score ${fmtScore(score.total)} per 5 turns, a quick guide: the simulation decides.`));
}
