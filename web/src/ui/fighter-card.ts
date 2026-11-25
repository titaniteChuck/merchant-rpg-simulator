/**
 * U62: the Party view's one card, for a hero and for the enemy (battle-page.ts), one CSS family (`.fc`, style.css U62).
 * Top to bottom:
 * - the head: the picker (the hero's or the enemy's <select>; read-only, the plain name), then the card's tools at
 *   the right (a hero's include box, the enemy's quest size);
 * - optional lines under it (the size cap, "attacks first");
 * - the stats on two lines, the same eight for both: HP Atk Matk Def / Mdef Acc Eva Crit (statGrid);
 * - a hero's passive (with the rotation's AP total at its right), then the rotation: one row per turn 1-5, the skill
 *   and its AP. No turn numbers (the list is ordered) and no titles. A row with a picker is a button opening the
 *   choices with their effects in place (pick-list.ts); otherwise plain text. Both carry the effect on hover.
 */
import { apBadge, el, fmt, fmtCompact } from "./dom.ts";
import { pickButton, type PickOption } from "./pick-list.ts";

/** The card stats in the game's order, four per line. */
export const CARD_STATS: [key: string, label: string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"],
  ["mdef", "Mdef"], ["acc", "Acc"], ["eva", "Eva"], ["crit", "Crit"]];
export const STAT_LINES = [CARD_STATS.slice(0, 4), CARD_STATS.slice(4)];

/**
 * The stats as a 4 × 2 grid of "label value" pairs (a <dl>); dashes without stats (an empty slot). From five digits a
 * value is shortened ("12.3K"), the whole one in its tooltip.
 */
export function statGrid(stats: Record<string, number> | null): HTMLElement {
  return el("dl", { class: "fc-stats" }, ...STAT_LINES.flat().map(([k, label]) => {
    const v = Number(stats?.[k] ?? 0);
    const dd = !stats ? el("dd", {}, "–")
      : Math.abs(v) >= 10_000 ? el("dd", { title: `${label} ${fmt.format(v)}` }, fmtCompact.format(v)) : el("dd", {}, fmt.format(v));
    return el("div", {}, el("dt", {}, label), dd);
  }));
}

/** A passive or rotation row. */
export interface CardRow {
  /** The text shown ("—" for an empty slot). */
  text: string;
  /** The skill's AP (a badge); null: a greyed "–" badge; undefined: no AP cell (the passive). */
  ap?: number | null;
  /** The hover card (wiki-data skillTip / passiveTip) on the name. */
  tip?: (e: HTMLElement) => void;
  /** Editable: the name is a button opening these choices. */
  pick?: { label: string; value: string; options: () => PickOption[]; onPick: (v: string) => void; focus: string };
  /** Something at the row's right end (the passive row: the rotation's AP total). */
  end?: Node;
}

function rowEl(r: CardRow, cls: string): HTMLElement {
  const li = el("li", { class: `fc-row ${cls}` });
  const name = r.pick
    ? pickButton({ ...r.pick, text: r.text, host: () => li })
    : el("span", { class: `fc-skill${r.text === "—" ? " muted" : ""}` }, r.text);
  if (r.tip) r.tip(name);
  li.append(name);
  if (r.ap !== undefined) li.append(r.ap === null ? el("span", { class: "ap-badge off", "aria-hidden": "true" }, "–") : apBadge(r.ap));
  if (r.end) li.append(r.end);
  return li;
}

export interface FighterCardSpec {
  kind: "hero" | "enemy";
  /** More classes: the class colour (cls-N), the slot's state (filled, empty, required, excluded, off-limits), rare. */
  classes?: string;
  /** Attributes: the drag and drop's data-slot / data-drag, a title. */
  attrs?: Record<string, string>;
  /** The picker, or the plain name on a read-only page. */
  head: Node;
  tools?: Node[];
  /** Lines under the head. */
  lines?: Node[];
  stats: Record<string, number> | null;
  /** A hero's passive row (the enemy has none). */
  passive?: CardRow;
  rotation: CardRow[];
}

/** One card, a hero's or the enemy's. */
export function fighterCard(s: FighterCardSpec): HTMLElement {
  return el("article", { class: `fc fc-${s.kind}${s.classes ? ` ${s.classes}` : ""}`, ...(s.attrs ?? {}) },
    el("div", { class: "fc-head" }, s.head, ...(s.tools?.length ? [el("span", { class: "fc-tools" }, ...s.tools)] : [])),
    ...(s.lines ?? []),
    statGrid(s.stats),
    ...(s.passive ? [el("ul", { class: "fc-rows fc-passive", "aria-label": "Passive" }, rowEl(s.passive, "fc-pas"))] : []),
    el("ol", { class: "fc-rows fc-rot", "aria-label": "Rotation, turns 1 to 5" }, ...s.rotation.map((r) => rowEl(r, "fc-turn"))));
}
