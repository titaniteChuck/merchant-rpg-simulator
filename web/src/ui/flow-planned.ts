/**
 * U63: the rotation as planned, what Flow 2 and Flow 3 show when there is no traced fight (no party, a party that
 * can't fight, a map room not reached). The smallest part kept of Flow 1 (U36's plan, timeline.ts `partyPlan` until
 * U63): one column per actor in action order (heroes by party location, then the enemy; the enemy first on questType
 * 6), a head row with the hero and opponent pickers, then turns 1-5, each with its band: hero cells with the planned
 * skill (struck out under a stun or a forced action), its ▾ and the enemy's effects on that hero; enemy cells with its
 * skill, its buffs still on and what the heroes put on it. Compact words ("[Tidal Wave] atk −50%"), the full sentence
 * on hover. CSS: the `pg-` rules of style.css.
 */
import { type EnemyCell, type HeroCell, locationLabel, type PlanColumn, type PlanMark, type PlanMember, planGrid } from "./battle-plan.ts";
import type { EnemyTimeline } from "../tools/schedule.ts";
import { el } from "./dom.ts";
import { nameEdit, type PlanEdit, skillEdit, turnRow } from "./flow-parts.ts";
import { timelineOf, tlName } from "./timeline.ts";
import { skillLink } from "./wiki-data.ts";
import { skillName } from "./names.ts";

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

function enemyCellEl(c: EnemyCell): HTMLElement {
  return el("div", { class: "pg-cell enemy", role: "cell", "aria-label": `Enemy, turn ${c.turn}` },
    el("span", { class: "tl-skill" }, skillLink(c.skill)),
    ...(c.short ? [el("span", { class: "pg-words", title: c.long }, c.short)] : []),
    ...c.own.map((m) => markEl(m, "own")), ...c.maluses.map((m) => markEl(m, "malus")));
}

/** The column heads: the heroes (name, place; the name picks another hero) and the enemy (its name picks the opponent). */
function planHeads(tl: EnemyTimeline, cols: PlanColumn[], edit?: PlanEdit): HTMLElement[] {
  return cols.map((c) => {
    if (c.kind === "enemy") {
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

/** The rotation's 5 turns as planned; `edit`: the pickers and ▾. Null without a timeline for this enemy. */
export function plannedRotation(quest: { id: number; rare: boolean }, members: PlanMember[], edit?: PlanEdit): HTMLElement | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl) return null;
  const cols = planGrid(tl, members, 5).columns;
  const rows = cols[0].cells.map((_, k) => k + 1).map((t) => el("div", { class: "pg-turngroup", role: "rowgroup", "aria-label": `Turn ${t}` }, turnRow(t, cols.length),
    el("div", { class: "pg-row", role: "row" },
      ...cols.map((c) => (c.kind === "enemy" ? enemyCellEl(c.cells[t - 1] as EnemyCell) : heroCellEl(c.cells[t - 1] as HeroCell, c.loc!, edit))))));
  return el("div", { class: "tl pg", role: "group", "aria-label": "The party's rotation against the enemy's" },
    el("div", { class: "pg-scroll" }, el("div", { class: "pg-grid", role: "table", style: `--pg-cols: ${cols.length}` },
      el("div", { class: "pg-row pg-heads", role: "row" }, ...planHeads(tl, cols, edit)), ...rows)));
}

/** The planned rotation's part of a Flow's "?". */
export const PLANNED_NOTE = "Without a fight to show: the rotation as planned, turns 1–5. [Skill]: where an effect comes from.";
