/**
 * U78: the hero page's parts that know about edits (save-viewer.ts draws the page): the stat grid with "<old> → <new>"
 * cells, the radar with the new shape under the old one, the actions at the top right (Edit, Reset or Delete; Save and
 * Cancel while editing) and the small "new" / "edited" mark of a created or edited hero.
 */
import { parseSave } from "../tools/save.ts";
import { el, fmt, pill } from "./dom.ts";
import { type HeroMark } from "./hero-overlay.ts";
import { radarDiff, statDiff, statText } from "./hero-diff.ts";
import { radar } from "./radar.ts";
import { gridStats, type HeroView, heroViews } from "./save-tables.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** One hero's view (stats by the engine, as every tool) from a raw hero alone. */
export const rawView = (raw: Any, gameMode = "Standard"): HeroView => heroViews(parseSave({ gameMode, hero: [raw] }))[0];

export type Best = Record<string, { max: number; who: string }>;

/**
 * The stat grid (4 per row); with `old`, each changed stat reads "<old> → <new>" and its arrow, in the up / down tone.
 * Each radar stat's tooltip names the save's best.
 */
export function statGridDiff(stats: Record<string, number>, best: Best, hasApBudget: boolean, labels: Record<string, string>,
  old?: Record<string, number>): HTMLElement {
  return el("dl", { class: "stats hero-stat-grid" }, ...gridStats(stats, hasApBudget).map((k) => {
    const name = labels[k] ?? k;
    const b = best[k];
    const attrs: Record<string, string> = b?.who ? { title: `${name}: best in this save ${fmt.format(b.max)} (${b.who})` } : {};
    if (!old || !(k in old)) return el("div", attrs, el("dt", {}, name), el("dd", {}, statText(k, stats[k])));
    const d = statDiff(k, name, old[k], stats[k]);
    const dd = d.tone === "same" ? el("dd", {}, d.text)
      : el("dd", { class: `sd sd-${d.tone}`, "aria-label": d.label },
        el("span", { class: "sd-old" }, statText(k, old[k])), el("span", { class: "sd-to", "aria-hidden": "true" }, " → "),
        el("span", { class: "sd-new" }, statText(k, stats[k])), el("span", { class: "sd-arrow", "aria-hidden": "true" }, ` ${d.arrow}`));
    return el("div", attrs, el("dt", {}, name), dd);
  }));
}

/** The radar: the old stats on top, the new ones under them in the edit colour (.radar-new), rims raised to fit. */
export function radarWithDiff(keys: string[], labels: Record<string, string>, old: Record<string, number>, now: Record<string, number>,
  best: Best, title: string, size: number): HTMLElement {
  const d = radarDiff(keys, labels, old, now, best);
  return radar(d.axes, { title, size, ...(d.changed ? { layers: [{ values: d.layer, cls: "radar-new", label: "After the edit" }] } : {}) });
}

/** "new" (created in this browser) or "edited" chip; nothing for a hero as saved. */
export function markPill(mark: HeroMark): HTMLElement[] {
  if (!mark) return [];
  const p = pill(mark === "created" ? "new" : "edited", `he-mark he-${mark}`);
  p.title = mark === "created" ? "Created on this site: not in the save file" : "Edited on this site: the save file is unchanged";
  return [p];
}

export interface HeroActions {
  editing: boolean;
  mark: HeroMark;
  name: string;
  edit: () => void;
  save: () => void;
  cancel: () => void;
  /** Reset (a save hero) or Delete (a created one), after the visitor confirms */
  drop: () => void;
}

/** The page's top-right buttons: Edit and Reset / Delete, or Save and Cancel. */
export function heroActions(a: HeroActions): HTMLElement {
  const btn = (label: string, cls: string, key: string, run: () => void, title = "") => {
    const b = el("button", { type: "button", class: cls, "data-focus-key": key, ...(title ? { title } : {}) }, label);
    b.addEventListener("click", run);
    return b;
  };
  const ask = (q: string, run: () => void) => () => {
    if (typeof confirm !== "function" || confirm(q)) run();
  };
  if (a.editing) {
    return el("div", { class: "he-actions" }, btn("Save", "primary", "he-save", a.save), btn("Cancel", "secondary", "he-cancel", a.cancel));
  }
  const drop = a.mark === "created"
    ? [btn("Delete", "secondary he-danger", "he-delete", ask(`Delete ${a.name}?`, a.drop), "Delete this hero created on this site")]
    : a.mark === "modified" ? [btn("Reset", "secondary", "he-reset", ask(`Reset ${a.name} to the save?`, a.drop), "Back to the hero as in the save file")] : [];
  return el("div", { class: "he-actions" }, btn("Edit", "secondary", "he-edit", a.edit), ...drop);
}
