/**
 * Enemy timeline UI (U11) on web/src/tools/schedule.ts: what the enemy does on each of its 5 turns and how long each
 * effect lasts, so cleanses, heals and big hits can be timed around it.
 *
 * - enemyStrip() (wiki enemy pages): the enemy's 5 turns (skill, tags) with its effect windows drawn across the turns
 *   they cover, in hero-action turns: an effect on the enemy (reflect, shield, buff) covers the turns heroes act while
 *   it is on (facingTurns); an effect on the heroes (debuff, stun) covers the turns they act with it (ownerTurns).
 *   Offsets are from the cast turn, so a window can wrap from turn 5 to turn 1 (the rotation repeats).
 * - partyPlan() (battle page, U36): the 5-turn plan as a grid, one column per actor in action order (the heroes, then
 *   the enemy; the enemy first on questType 6) and one row per turn, from battle-plan.ts: compact words ("[Tidal Wave]
 *   atk −50%", "[Drown] → Basic"), the full sentence on hover. No schedule score.
 * Every skill name shown (cells, bars, tooltips) goes through names.ts: it follows the language picker (U36).
 * Data: data/timelines.json (inventory/timelines.json), loaded once per page by loadTimelineData().
 */
import { type EffectInfo, type EnemyTimeline, enemyTimeline, loadTimelines, type SkillTag } from "../tools/schedule.ts";
import { compactEffect, type EnemyCell, type HeroCell, lasts, locationLabel, type PlanMark, type PlanMember, planGrid } from "./battle-plan.ts";
import { el } from "./dom.ts";
import { tip } from "./tooltip.ts";
import { skillDesc, skillLink } from "./wiki-data.ts";
import { enemyName, skillName } from "./names.ts";

export type { PlanMember };

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

/**
 * An effect's name in the visitor's language (U36): effects are named after their skill ("Tidal Wave"), sometimes
 * with a suffix ("Ancient Mist Eva↑"); the skill part is translated, the suffix kept.
 */
export function effectLabel(e: EffectInfo, skill: string): string {
  if (e.name === skill) return skillName(skill);
  if (e.name.startsWith(`${skill} `)) return `${skillName(skill)}${e.name.slice(skill.length)}`;
  const own = skillName(e.name);
  return own !== e.name ? own : e.name;
}

function effectTip(e: EffectInfo, label: string, cast: number, onEnemy: boolean, turns: number[]): HTMLElement {
  // U36: durations from the measured windows (E24: lastsEnemyActions / lastsHeroActions), never the game's text.
  const until = lasts(e, onEnemy ? "enemy" : "hero").replace(/^for /, "");
  const stats = compactEffect(e).long;
  return el("span", { class: "tip-body" }, el("strong", {}, label), el("span", { class: "tip-kind" }, `${e.kind} on ${onEnemy ? "the enemy" : "the heroes"}`),
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
      const label = effectLabel(e, s.name);
      const row = el("div", { class: "tl-winrow" });
      segs.forEach(([a, b], i) => {
        // .tl-when (the turns, as text) shows only where the strip is stacked one turn per line (narrow box, CSS).
        const seg = el("span", { class: cls, style: `grid-column: ${col0 + a - 1} / ${col0 + b}`, tabindex: "0" },
          `${i > 0 ? "↪ " : ""}${label}${permanent ? " (rest of fight)" : ""}${i < segs.length - 1 ? " ↩" : ""}`,
          el("span", { class: "tl-when" }, permanent ? " · T1–T5" : a === b ? ` · T${a}` : ` · T${a}–T${b}`));
        tip(seg, () => effectTip(e, label, cast, onEnemy, permanent ? [1, 2, 3, 4, 5] : turns));
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

// ---------------------------------------------------------------- party plan (U36: a grid, turns down, actors across)
/** A plan marker: "[Source] compact", the full sentence on hover. */
function markEl(m: PlanMark, cls: string): HTMLElement {
  return el("span", { class: `pg-mark ${cls} k-${m.kind}`, title: m.title, "aria-label": m.title }, m.text);
}

/** A compact word list with the full words on hover ("dmg · debuff"). */
function wordsEl(words: { short: string; long: string }[]): HTMLElement[] {
  if (!words.length) return [];
  const short = words.map((w) => w.short).filter((w, k, a) => a.indexOf(w) === k).join(" · ");
  return [el("span", { class: "pg-words", title: words.map((w) => w.long).join(", ") }, short)];
}

function heroCellEl(c: HeroCell, loc: number): HTMLElement {
  const planned = skillLink(c.planned);
  const changed = c.does !== c.planned;
  const skill = changed
    ? el("span", { class: "tl-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(c.planned)}` }, planned), " ",
      el("span", { class: "tl-forced", title: c.does === null ? `Stunned by ${skillName(c.stunBy ?? "")}: the action is lost`
        : `Abilities disabled by ${skillName(c.forcedBy ?? "")}: Basic attack only` }, c.does === null ? "stun" : "→ Basic"))
    : el("span", { class: "tl-skill" }, planned);
  return el("div", { class: `pg-cell hero${c.marks.length ? " hit" : ""}${changed ? " forced" : ""}`, role: "cell",
    "aria-label": `${locationLabel(loc)}, turn ${c.turn}` }, skill, ...wordsEl(c.tags), ...c.marks.map((m) => markEl(m, "on-hero")));
}

function enemyCellEl(c: EnemyCell): HTMLElement {
  return el("div", { class: "pg-cell enemy", role: "cell", "aria-label": `Enemy, turn ${c.turn}` },
    el("span", { class: "tl-skill" }, skillLink(c.skill)),
    ...(c.short ? [el("span", { class: "pg-words", title: c.long }, c.short)] : []),
    ...c.own.map((m) => markEl(m, "own")), ...c.maluses.map((m) => markEl(m, "malus")));
}

/**
 * The party's 5-turn plan against the enemy's (U36): one column per actor in action order (heroes by party location,
 * then the enemy; the enemy first on questType 6), one row per turn. Hero cells: the planned skill (struck out under a
 * stun or a forced action), what it does, and the enemy's effects on that hero with their source. Enemy cells: its
 * skill, a compact summary, its buffs still on, and what the heroes put on it, with their source. Null without a
 * timeline for this enemy.
 */
export function partyPlan(quest: { id: number; rare: boolean }, members: PlanMember[]): HTMLElement | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl) return null;
  const cols = planGrid(tl, members).columns;
  const head = cols.map((c) => c.kind === "enemy"
    ? el("div", { class: "pg-head enemy", role: "columnheader" }, el("strong", {}, tlName(tl)), el("span", { class: "muted small" }, "enemy"))
    : el("div", { class: `pg-head hero cls-${c.member!.cls}`, role: "columnheader", title: `${c.member!.name}, ${locationLabel(c.loc!)}` },
      el("strong", {}, c.member!.name), el("span", { class: "muted small" }, locationLabel(c.loc!))));
  const rows = [1, 2, 3, 4, 5].map((t) => el("div", { class: "pg-row", role: "row" }, el("div", { class: "pg-turn", role: "rowheader" }, `T${t}`),
    ...cols.map((c) => (c.kind === "enemy" ? enemyCellEl(c.cells[t - 1] as EnemyCell) : heroCellEl(c.cells[t - 1] as HeroCell, c.loc!)))));
  return el("div", { class: "tl pg", role: "group", "aria-label": "The party's 5-turn plan against the enemy's" },
    el("div", { class: "pg-scroll" }, el("div", { class: "pg-grid", role: "table", style: `--pg-cols: ${cols.length}` },
      el("div", { class: "pg-row pg-heads", role: "row" }, el("div", { class: "pg-turn", role: "columnheader" }, "Turn"), ...head), ...rows)),
    el("p", { class: "muted small tl-note" }, `Each hero plays slot k of its rotation on turn k, left to right${tl.enemyFirst ? ", after the enemy" : ", then the enemy"}; `
      + "turn 6 is turn 1 again. [Skill]: where an effect comes from; hover for the full text."));
}

