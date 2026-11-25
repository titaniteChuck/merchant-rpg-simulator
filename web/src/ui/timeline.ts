/**
 * Enemy timeline UI (U11) on web/src/tools/schedule.ts: what the enemy does on each of its 5 turns and how long each
 * effect lasts, so cleanses, heals and big hits can be timed around it.
 *
 * - enemyStrip() (wiki enemy pages): the enemy's 5 turns (skill, tags) with its effect windows drawn across the turns
 *   they cover, in hero-action turns: an effect on the enemy (reflect, shield, buff) covers the turns heroes act while
 *   it is on (facingTurns); an effect on the heroes (debuff, stun) covers the turns they act with it (ownerTurns).
 *   Offsets are from the cast turn, so a window can wrap from turn 5 to turn 1 (the rotation repeats).
 * - partyPlan() (battle page's Flow tab, U36, U39): one column per actor in action order (the heroes, then the enemy;
 *   the enemy first on questType 6). With a traced fight, every turn of it to the end, one line per action (flowChart);
 *   without one, the rotation's 5 turns as planned, from battle-plan.ts: compact words ("[Tidal Wave] atk −50%",
 *   "[Drown] → Basic"), the full sentence on hover. ▾ controls edit heroes and turns 1-5 (PlanEdit).
 * Every skill name shown (cells, bars, tooltips) goes through names.ts: it follows the language picker (U36).
 * Data: data/timelines.json (inventory/timelines.json), loaded once per page by loadTimelineData().
 */
import { type EffectInfo, type EnemyTimeline, enemyTimeline, loadTimelines, type SkillTag } from "../tools/schedule.ts";
import {
  compactEffect, type EnemyCell, type HeroCell, lasts, locationLabel, type PlanColumn, type PlanMark, type PlanMember, planGrid, planTimeline,
  type TimelineCell, type TimelineChip, type TimelineLine, type TimelineTurn, type TracedFight,
} from "./battle-plan.ts";
import { type CalcTerm, calcView } from "./battle-calc.ts";
import type { TraceCalc } from "../sim/api.ts";
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

/**
 * U39: the flow diagram edits the party in place. Both views of the battle page change one party state through these
 * (battle.ts, battle-edit.ts), then draw again and simulate again.
 */
export interface PlanEdit {
  /** The hero choices for a party location's column ([value, label]) and its current value. */
  heroes(loc: number): { options: [string, string][]; value: string };
  setHero(loc: number, value: string): void;
  /** The skills the hero at a location can play in its rotation ([skill, label]), or null. */
  skills(loc: number): [string, string][] | null;
  /** Rotation slot k (0-4) of the hero at a location. */
  setSkill(loc: number, k: number, skill: string): void;
  /**
   * U40: the opponent choices of the enemy column's head, the Party tab's own (a quest enemy, its rare variant; or a
   * map for a map run), grouped, and the current value; null when it can't be changed there.
   */
  enemies?(): { label: string; groups: OptionGroups; value: string } | null;
  setEnemy?(value: string): void;
}
/** Options, flat ([value, label]) or in groups ([group label, options]). */
export type OptionGroups = [string, [string, string][]][];

/** A <select> with these options, flat or grouped. */
function selectEl(label: string, options: [string, string][] | OptionGroups, value: string, onChange: (v: string) => void): HTMLSelectElement {
  const grouped = options.length > 0 && Array.isArray(options[0][1]);
  const opt = ([v, l]: [string, string]) => el("option", { value: v }, l);
  const s = el("select", { "aria-label": label, class: "fl-select" }, ...(grouped
    ? (options as OptionGroups).map(([g, list]) => el("optgroup", { label: g }, ...list.map(opt)))
    : (options as [string, string][]).map(opt))) as HTMLSelectElement;
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/**
 * A small ▾ over a transparent <select> (U39): unobtrusive until hover or focus, keyboard-reachable (Tab, then the
 * arrow keys or Enter). `focus`: a key the page uses to put the focus back after the redraw.
 */
function editControl(label: string, options: [string, string][], value: string, focus: string, onChange: (v: string) => void): HTMLElement {
  return el("span", { class: "fl-edit", title: label, "data-flow-focus": focus }, el("span", { class: "fl-caret", "aria-hidden": "true" }, "▾"),
    selectEl(label, options, value, onChange));
}

/**
 * A column head's name with a ▾ (U40): the transparent <select> covers the name and the ▾, so clicking the name opens
 * the choices, as on the heroes' heads.
 */
function nameEdit(name: Node | string, label: string, options: [string, string][] | OptionGroups, value: string, focus: string,
  onChange: (v: string) => void): HTMLElement {
  return el("span", { class: "fl-name", title: label, "data-flow-focus": focus }, el("strong", {}, name),
    el("span", { class: "fl-caret", "aria-hidden": "true" }, "▾"), selectEl(label, options, value, onChange));
}

function heroCellEl(c: HeroCell, loc: number, edit?: PlanEdit): HTMLElement {
  const planned = skillLink(c.planned);
  const changed = c.does !== c.planned;
  const skill = changed
    ? el("span", { class: "tl-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(c.planned)}` }, planned), " ",
      el("span", { class: "tl-forced", title: c.does === null ? `Stunned by ${skillName(c.stunBy ?? "")}: the action is lost`
        : `Abilities disabled by ${skillName(c.forcedBy ?? "")}: Basic attack only` }, c.does === null ? "stun" : "→ Basic"))
    : el("span", { class: "tl-skill" }, planned);
  return el("div", { class: `pg-cell hero${c.marks.length ? " hit" : ""}${changed ? " forced" : ""}`, role: "cell",
    "aria-label": `${locationLabel(loc)}, turn ${c.turn}` }, skill, ...skillEdit(edit, loc, c.turn, c.planned),
  ...wordsEl(c.tags), ...c.marks.map((m) => markEl(m, "on-hero")));
}

/** The rotation slot's ▾ (turns 1-5 only: later turns repeat it). */
function skillEdit(edit: PlanEdit | undefined, loc: number, turn: number, planned: string): HTMLElement[] {
  const opts = turn <= 5 ? edit?.skills(loc) : null;
  if (!edit || !opts) return [];
  const list = opts.some(([v]) => v === planned) ? opts : [...opts, [planned, skillName(planned)] as [string, string]];
  return [editControl(`${locationLabel(loc)}: turn ${turn} skill`, list, planned, `skill-${loc}-${turn}`, (v) => edit.setSkill(loc, turn - 1, v))];
}

function enemyCellEl(c: EnemyCell): HTMLElement {
  return el("div", { class: "pg-cell enemy", role: "cell", "aria-label": `Enemy, turn ${c.turn}` },
    el("span", { class: "tl-skill" }, skillLink(c.skill)),
    ...(c.short ? [el("span", { class: "pg-words", title: c.long }, c.short)] : []),
    ...c.own.map((m) => markEl(m, "own")), ...c.maluses.map((m) => markEl(m, "malus")));
}

/** The column heads: the heroes (name, place; a ▾ to change the hero) and the enemy, in action order. */
function planHeads(tl: EnemyTimeline, cols: PlanColumn[], edit?: PlanEdit): HTMLElement[] {
  return cols.map((c) => {
    if (c.kind === "enemy") {
      // R1 F11: a rare variant by its own name and a "rare" pill, as the wiki lists it. U40: its name opens the
      // opponent choices (the Party tab's), with a ▾.
      const e = edit?.enemies?.() ?? null;
      return el("div", { class: "pg-head enemy", role: "columnheader", title: tlName(tl) },
        e ? nameEdit(tlName(tl), e.label, e.groups, e.value, "enemy", (v) => edit!.setEnemy?.(v)) : el("strong", {}, tlName(tl)),
        el("span", { class: "muted small" }, "enemy", ...(tl.rare ? [" ", el("span", { class: "pill t-pink pg-rare" }, "rare")] : [])));
    }
    const h = edit?.heroes(c.loc!);
    return el("div", { class: `pg-head hero cls-${c.member!.cls}`, role: "columnheader", title: `${c.member!.name}, ${locationLabel(c.loc!)}` },
      h ? nameEdit(c.member!.name, `${locationLabel(c.loc!)}: hero`, h.options, h.value, `hero-${c.loc}`, (v) => edit!.setHero(c.loc!, v))
        : el("strong", {}, c.member!.name),
      el("span", { class: "muted small" }, locationLabel(c.loc!)));
  });
}

// ---------------------------------------------------------------- the flow diagram (U39, U40)
const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Past this many turns the rest of a fight waits behind a button (a 200-turn stalemate is thousands of lines). */
export const FLOW_PAGE = 100;

/** An effect as plain text of what it does ("+15% Def", "Taunt"); "<skill> from <fighter>" on hover (U40). */
function fxEl(c: TimelineChip): HTMLElement {
  return el("span", { class: `tc-fx ${c.debuff ? "debuff" : "buff"}`, title: c.title }, c.label,
    ...(c.turns !== undefined && c.turns > 0 ? [el("span", { class: "tc-left", "aria-hidden": "true" }, ` ${c.turns}`)] : []));
}

/** The actor's cell: the skill it played (the planned one struck out under a stun or a forced action). */
function actorEl(l: TimelineLine): HTMLElement[] {
  if (l.did === null) return [el("span", { class: "tc-skill tc-down", title: "Down: no action" }, "down")];
  const played = l.did === false ? null : l.did;
  const skill = played === null
    ? el("span", { class: "tc-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(l.planned)}` }, skillName(l.planned)), " ",
      el("span", { class: "tl-forced", title: "Stunned: the action is lost" }, "stun"))
    : played !== l.planned
    ? el("span", { class: "tc-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(l.planned)}` }, skillName(l.planned)), " ",
      el("span", { class: "tl-forced", title: "Forced: another action than the planned one" }, played === "Basic" ? "Basic" : skillLink(played)))
    : el("span", { class: "tc-skill" }, played === "Basic" ? "Basic" : skillLink(played));
  return [skill, ...(l.misses ? [el("span", { class: "tc-miss", title: `${l.misses} attack${l.misses > 1 ? "s" : ""} missed` }, "miss")] : [])];
}

/**
 * One term of a formula: its operator, then its words; where it comes from in the shared tooltip (R3 QA: tip(), so it
 * shows on hover, keyboard focus and tap, and is announced through aria-describedby; a `title` only showed on hover).
 */
function termEl(t: CalcTerm): HTMLElement[] {
  const term = el("span", { class: `cf-term${t.kind ? ` cf-${t.kind}` : ""}`, tabindex: "0" }, t.text);
  tip(term, () => t.tip);
  return [...(t.op ? [el("span", { class: "cf-op", "aria-hidden": t.op === "=" ? "false" : "true" }, ` ${t.op} `)] : []), term];
}

/** The calculation of a fighter's damage or healing in one action (U40): one block per hit or heal, then their sum. */
function calcPanel(calc: TraceCalc[], kind: "dmg" | "heal", nameOf: (w: number) => string, shown: number): HTMLElement {
  const views = calc.filter((c) => c.kind === kind && !(c.kind === "dmg" && c.missed)).map((c) => calcView(c, nameOf));
  const blocks = views.map((v) => el("div", { class: `cf-block${v.void ? " void" : ""}` }, el("div", { class: "cf-head" }, v.head),
    ...v.lines.map((l) => el("div", { class: "cf-line" }, ...(v.lines.length > 1 || l.label !== "Heal" ? [el("span", { class: "cf-label" }, `${l.label}: `)] : []),
      ...l.terms.flatMap(termEl))),
    ...v.notes.map((n) => el("div", { class: "cf-note" }, n))));
  const counted = views.filter((v) => !v.void);
  const sum = counted.length > 1
    ? [el("div", { class: "cf-sum" }, `${kind === "dmg" ? "Damage" : "Healing"} this action: ${counted.map((v) => fmtInt.format(v.shown)).join(" + ")} = ${fmtInt.format(shown)}`)]
    : [];
  // a cell of the action's calculation row (`tc-calcs`, role row; a11y review F01: a table row holds cells only)
  return el("div", { class: `tc-calc ${kind}`, role: "cell" }, ...blocks, ...sum);
}

/**
 * A number's "▾ calculation" toggle (U40): it opens the calculation under the action's line (in `box`, full width,
 * in column order), and turns to "▸"; clicking again closes it.
 */
function calcToggle(open: () => HTMLElement, box: HTMLElement, order: number, what: string): HTMLElement {
  const btn = el("button", { type: "button", class: "tc-calc-btn", "aria-expanded": "false" }, el("span", { class: "tc-caret", "aria-hidden": "true" }, "▾"), " calculation");
  tip(btn, () => `How ${what} was worked out`);
  let panel: HTMLElement | null = null;
  btn.addEventListener("click", () => {
    if (panel) {
      panel.remove();
      panel = null;
      btn.firstElementChild!.textContent = "▾";
      btn.setAttribute("aria-expanded", "false");
    } else {
      panel = open();
      panel.dataset.order = String(order);
      const after = [...box.children].find((x) => Number((x as HTMLElement).dataset.order) > order);
      box.insertBefore(panel, after ?? null);
      btn.firstElementChild!.textContent = "▸";
      btn.setAttribute("aria-expanded", "true");
    }
    box.hidden = box.children.length === 0;
  });
  return btn;
}

/**
 * What a fighter took during one action: damage (−) and healing (+), each with its calculation, the KO, hits that
 * landed once it was already down ("no target"), and what each effect that landed does.
 */
function takenEl(c: TimelineCell | undefined, w: number, nameOf: (w: number) => string, box: HTMLElement, col: number): HTMLElement[] {
  if (!c) return [];
  const name = nameOf(w);
  const voidTip = `${name} was already down: the game still plays the rest of the turn (it ends the fight only once the turn is over), `
    + "so these hits land on a fallen fighter and change nothing.";
  return [
    ...(c.dmg ? [el("span", { class: "tc-dmg", title: `${fmtInt.format(c.dmg)} damage to ${name}` }, `−${fmtInt.format(c.dmg)}`),
      calcToggle(() => calcPanel(c.calc, "dmg", nameOf, c.dmg), box, col * 2, `the damage to ${name}`)] : []),
    ...(c.deadHits ? [el("span", { class: "tc-void", title: voidTip }, c.dmg ? "then no target" : "no target"),
      ...(c.dmg ? [] : [calcToggle(() => calcPanel(c.calc, "dmg", nameOf, 0), box, col * 2, `the hits on ${name}`)])] : []),
    ...(c.heal ? [el("span", { class: "tc-heal", title: `${fmtInt.format(c.heal)} HP healed on ${name}` }, `+${fmtInt.format(c.heal)}`),
      calcToggle(() => calcPanel(c.calc, "heal", nameOf, c.heal), box, col * 2 + 1, `the healing on ${name}`)] : []),
    ...(c.ko ? [el("span", { class: "tc-ko", title: "Falls" }, "✝ KO")] : []),
    ...c.added.map(fxEl),
  ];
}

/**
 * A fighter's HP at the end of a turn (U40): the bar and the number in fixed places, so every bar has the same place
 * and width in every column and every turn; an empty bar and "✝ down" once it fell.
 */
function hpEl(v: { hp: number; maxHP: number } | undefined, name: string, turn: number): HTMLElement[] {
  if (!v) return [];
  const down = v.hp <= 0;
  const f = !down && v.maxHP > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHP)) : 0;
  const tone = down ? "down" : f > 0.5 ? "ok" : f > 0.25 ? "mid" : "low";
  const text = down ? `${name} is down (end of turn ${turn})` : `${name}: ${fmtInt.format(v.hp)} / ${fmtInt.format(v.maxHP)} HP at the end of turn ${turn}`;
  return [el("span", { class: `tc-hp ${tone}`, title: text, role: "img", "aria-label": text },
    el("span", { class: "tc-hpbar", "aria-hidden": "true" }, el("span", { style: `width: ${(f * 100).toFixed(1)}%` })),
    el("span", { class: "tc-hpnum", "aria-hidden": "true" }, down ? "✝ down" : fmtInt.format(v.hp)))];
}

/** The light line between two 5-turn rounds. */
function roundDivider(round: number): HTMLElement {
  const a = round * 5 + 1;
  return el("div", { class: "pg-cycle", role: "row" }, el("span", { role: "cell" }, `↻ Turns ${a}–${a + 4}: the rotations again`));
}

/**
 * R3 QA: the rotation turns (1-5) the fight never reached (it ended sooner), one compact muted row each, "planned, not
 * reached": each hero's planned skill with its ▾ (the same PlanEdit, so the same party state and AP limit refusal as
 * the reached turns). Nothing when every rotation turn was played.
 */
function unreachedRows(cols: PlanColumn[], reached: Set<number>, edit?: PlanEdit): HTMLElement[] {
  const turns = [1, 2, 3, 4, 5].filter((t) => !reached.has(t));
  if (!turns.length) return [];
  return [el("div", { class: "pg-cycle tc-unreached-head", role: "row" }, el("span", { role: "cell" }, "Planned, not reached")),
    ...turns.map((t) => el("div", { class: "tc-turn tc-unreached", role: "rowgroup", "aria-label": `Turn ${t}: planned, not reached` },
      el("div", { class: "tc-turnlab", "aria-hidden": "true" }, `T${t}`),
      el("div", { class: "tc-lines" }, el("div", { class: "tc-line", role: "row" }, ...cols.map((c) => {
        if (c.kind !== "hero") return el("div", { class: "tc-cell", role: "cell" });
        const planned = (c.cells[t - 1] as HeroCell).planned;
        return el("div", { class: "tc-cell tc-planned", role: "cell" },
          el("span", { class: "tc-skill" }, planned === "Basic" ? "Basic" : skillLink(planned)), ...skillEdit(edit, c.loc!, t, planned));
      })))))];
}

/**
 * The flow diagram (U39, U40): every turn of one simulated fight, from turn 1 to its end. Per turn, one line per
 * action in action order (the actor's column: the skill; the others: damage −, healing +, each with its "▾
 * calculation", and what a landed effect does), then the end-of-turn summary on its own background: each fighter's HP
 * (bars aligned) and its effects as text. Turns 1-5 carry the rotation's ▾ (with `edit`); a light divider every 5
 * turns; the result at the end.
 */
function flowChart(tl: EnemyTimeline, cols: PlanColumn[], trace: TracedFight, edit?: PlanEdit): HTMLElement {
  const whoOf = (c: PlanColumn) => (c.kind === "enemy" ? 0 : c.loc!);
  const nameOf = (w: number) => (w ? cols.find((c) => c.loc === w)?.member?.name ?? locationLabel(w) : tlName(tl));
  const occupied = cols.filter((c) => c.kind === "hero").map((c) => c.loc!);
  const data = planTimeline(trace, occupied, nameOf);
  const turnEl = (t: TimelineTurn): HTMLElement[] => {
    const rows: HTMLElement[] = t.lines.flatMap((l) => {
      const box = el("div", { class: "tc-calcs", role: "row", "aria-label": `${nameOf(l.who)}: calculations` });
      box.hidden = true;
      const line = el("div", { class: "tc-line", role: "row", "aria-label": `${nameOf(l.who)} acts` }, ...cols.map((c, k) => {
        const w = whoOf(c), actor = w === l.who;
        const cls = actor ? ` actor ${c.kind === "enemy" ? "enemy" : `cls-${c.member!.cls}`}` : "";
        return el("div", { class: `tc-cell${cls}`, role: "cell" }, ...(actor ? actorEl(l) : []),
          ...(actor && c.kind === "hero" ? skillEdit(edit, w, t.turn, l.planned) : []), ...takenEl(l.cells[w], w, nameOf, box, k));
      }));
      return [line, box];
    });
    rows.push(el("div", { class: "tc-line tc-status", role: "row", "aria-label": `End of turn ${t.turn}: HP and effects` }, ...cols.map((c) =>
      el("div", { class: "tc-cell", role: "cell" }, ...hpEl(t.hp[whoOf(c)], nameOf(whoOf(c)), t.turn),
        ...((t.status[whoOf(c)] ?? []).length ? [el("span", { class: "tc-fxs" }, ...(t.status[whoOf(c)] ?? []).map(fxEl))] : [])))));
    return [...(t.round > 0 && (t.turn - 1) % 5 === 0 ? [roundDivider(t.round)] : []),
      el("div", { class: `tc-turn${t.rotation ? " rotation" : ""}`, role: "rowgroup", "aria-label": `Turn ${t.turn}` },
        el("div", { class: "tc-turnlab", "aria-hidden": "true" }, `T${t.turn}`), el("div", { class: "tc-lines" }, ...rows))];
  };
  // The result, and the "Show turns" button, each in a row of one cell: inside role=table, only rows (a11y F01).
  const oneCell = (cls: string, ...kids: HTMLElement[]) => el("div", { class: cls, role: "row" }, el("div", { role: "cell" }, ...kids));
  const result = oneCell("tc-result-row", el("p", { class: `tc-result ${data.won ? "won" : "lost"}`, role: "status" },
    data.won ? `🏆 Won on turn ${data.lastTurn}` : data.capped ? `⏱ Stopped at the game's turn cap (${data.lastTurn} turns): lost`
      : `💀 Lost on turn ${data.lastTurn}`));
  const body = el("div", { class: "tc-body" }, ...data.turns.slice(0, FLOW_PAGE).flatMap(turnEl));
  if (data.turns.length > FLOW_PAGE) {
    const more = el("button", { type: "button", class: "secondary tc-more" }, `Show turns ${FLOW_PAGE + 1}–${data.lastTurn}`);
    const moreRow = oneCell("tc-more-row", more);
    more.addEventListener("click", () => {
      moreRow.replaceWith(...data.turns.slice(FLOW_PAGE).flatMap(turnEl));
    });
    body.append(moreRow);
  }
  body.append(result, ...unreachedRows(cols, new Set(data.turns.map((t) => t.turn)), edit));
  return el("div", { class: "tl pg tc", role: "group", "aria-label": "The fight, turn by turn and action by action" },
    el("div", { class: "pg-scroll tc-scroll" }, el("div", { class: "pg-grid tc-grid", role: "table", style: `--pg-cols: ${cols.length}` },
      // the turn is each rowgroup's name ("Turn 3"), not a column: the "Turn" head is hidden so the heads match the cells
      el("div", { class: "pg-row pg-heads", role: "row" }, el("div", { class: "pg-turn", "aria-hidden": "true" }, "Turn"), ...planHeads(tl, cols, edit)),
      body)));
}

/**
 * The flow tab's diagram (U36 plan, U39 flow): one column per actor in action order (heroes by party location, then
 * the enemy; the enemy first on questType 6). With a traced fight, its every turn (flowChart); without one (no party,
 * or a party that can't fight), the rotation's 5 turns as planned: hero cells with the planned skill (struck out under
 * a stun or a forced action) and the enemy's effects on that hero; enemy cells with its skill, its buffs still on and
 * what the heroes put on it. `edit`: the ▾ controls. Null without a timeline for this enemy.
 */
export function partyPlan(quest: { id: number; rare: boolean }, members: PlanMember[], trace: TracedFight | null = null, edit?: PlanEdit): HTMLElement | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl) return null;
  const cols = planGrid(tl, members, 5).columns;
  if (trace && members.length) return flowChart(tl, cols, trace, edit);
  const rows = cols[0].cells.map((_, k) => k + 1).map((t) => el("div", { class: "pg-row", role: "row" }, el("div", { class: "pg-turn", role: "rowheader" }, `T${t}`),
    ...cols.map((c) => (c.kind === "enemy" ? enemyCellEl(c.cells[t - 1] as EnemyCell) : heroCellEl(c.cells[t - 1] as HeroCell, c.loc!, edit)))));
  return el("div", { class: "tl pg", role: "group", "aria-label": "The party's rotation against the enemy's" },
    el("div", { class: "pg-scroll" }, el("div", { class: "pg-grid", role: "table", style: `--pg-cols: ${cols.length}` },
      el("div", { class: "pg-row pg-heads", role: "row" }, el("div", { class: "pg-turn", role: "columnheader" }, "Turn"), ...planHeads(tl, cols, edit)), ...rows)));
}

/** How to read the flow (R1 F20: in the "?" beside its title, not a caption under it). */
export function planNote(quest: { id: number; rare: boolean }): string {
  const tl = timelineOf(quest.id, quest.rare);
  return [`Each hero plays slot k of its rotation on turn k, left to right${tl?.enemyFirst ? ", after the enemy" : ", then the enemy"}; `
    + "turn 6 is turn 1 again. Turns 1–5 are the rotation: ▾ changes a skill or a hero, and the enemy's name changes the opponent (the Party tab follows).",
  "Each turn shows the fight action by action, one line per fighter in the order they act: the skill in the actor's column, the "
    + "damage (−) or healing (+) in the column of whoever takes it, and what an effect that lands does (+15% Def). ▾ calculation after a "
    + "number opens how it was worked out. Under the lines, on their own band, each fighter's HP and effects at the end of the turn, with "
    + "their turns left. \"No target\": a hit on a fighter already down (the game plays the rest of the turn), which changes nothing. "
    + "A fight over before turn 5: the turns it never reached follow the result, muted, with their ▾.",
  "Without a party that can fight, the rotation as planned. [Skill]: where an effect comes from. Hover anything for the full text."].join(" ");
}
