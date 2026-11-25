/**
 * Class page stats (U19, U54): a level / ascension picker, a stat table (gained per lvl, lvl 1, the picked lvl, the
 * tier's max lvl) and the class's stat shape on a radar. U54 (the user, 2026-11-25): no growth charts; the radar shows
 * only the shape (every class grows in proportion), at lvl 50 ascension 0, each axis's rim the best class, no values.
 *
 * Game rules (decompiled data.Default, obj.Hero, obj.mods.modLoader):
 * - stat = base + growth[prestigeLevel] × level (Hero.determineStats, no gear, passive or attribute points);
 * - max level of a tier = #heroLevelRequirement[prestigeLevel] (default.maxHeroLevel): 50, 50, 60;
 * - default.canHeroPrestige: level >= heroPrestigeLevelRequirement[prestigeLevel + 1], so ascension 1 unlocks at level
 *   40 of ascension 0 (requirement[2]) and ascension 2 at level 50 of ascension 1 (requirement[3]); requirement[1] is
 *   never read. Ascending resets the hero to level 1 (Hero.prestigeUp).
 * Colours: ascension 0 in the page's standard colour, 1 silver, 2 gold (the ascension outline tokens of style.css).
 */
import { G } from "../sim/data.ts";
import { ascText, el, LV, lv, lvStart, segField, segmented } from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { classes } from "./wiki-data.ts";
import { badgeFor, isVisible } from "./expansion-state.ts";
import { className } from "./names.ts";
import { statLink } from "./wiki-ref.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** [growth key, base key, label]. */
export type Growth = [string, string, string];
export const GROWTH: Growth[] = [["hpPlv", "hp", "HP"], ["atkPlv", "atk", "Atk"], ["matkPlv", "matk", "Matk"], ["accPlv", "acc", "Acc"],
  ["defPlv", "def", "Def"], ["mdefPlv", "mdef", "Mdef"], ["critPlv", "crit", "Crit"]];
/** The radar's stats: Crit left out (on request; the stat table gives it). */
export const CHARTED = GROWTH.filter(([, b]) => b !== "crit");

/** U54: the radar's shape is the class at this level, ascension 0 (the rims: the best class there). */
export const SHAPE_LEVEL = 50;

/** R2-D F47 / F52, U54: the Stats section's "?". */
export const RADAR_HELP = ["Stats: base + growth × lvl, before gear, passive and attribute points.",
  `Shape: ${lv(SHAPE_LEVEL)}, ascension 0; each axis's rim is the best class.`];

const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The class's own stat at a level (prestige 1-3 = ascension 0-2). */
export const statAt = (c: Any, [plv, base]: Growth, prestige: number, level: number): number =>
  (c?.[base] ?? 0) + (c?.[plv]?.[prestige] ?? 0) * level;

/** Prestige levels (1 = ascension 0) the class's growth table has. */
export const tiersOf = (c: Any): number[] => [1, 2, 3].filter((p) => GROWTH.some(([k]) => typeof c?.[k]?.[p] === "number"));

/** default.maxHeroLevel[prestige] = #heroLevelRequirement[prestige] (50, 50, 60). */
export function tierMaxLevel(prestige: number): number {
  const t = G.heroLevelRequirement?.[prestige];
  const n = t ? Object.keys(t).length : 0;
  return n || 60;
}

/** Level of this tier at which the hero can ascend to the next one (40, 50), or null on the last tier. */
export function unlockLevel(prestige: number): number | null {
  const maxTier = Number(G.heroMaxPrestigeLevel) || 3;
  if (prestige >= maxTier) return null;
  const v = G.heroPrestigeLevelRequirement?.[prestige + 1];
  return typeof v === "number" ? v : null;
}

/** The highest level any tier reaches. */
export const topLevel = (tiers: number[]): number => Math.max(...tiers.map(tierMaxLevel));

export interface Selection { level: number; asc: number }

/** Clamp a selection to the class's tiers: a level above the tier's cap moves to the first tier that reaches it. */
export function clampSelection(tiers: number[], s: Selection): Selection {
  const asc = Math.max(0, Math.min(tiers.length - 1, Math.trunc(s.asc) || 0));
  const top = topLevel(tiers);
  const level = Math.max(1, Math.min(top, Math.trunc(s.level) || 1));
  if (level <= tierMaxLevel(asc + 1)) return { level, asc };
  const up = tiers.find((p) => p - 1 >= asc && tierMaxLevel(p) >= level) ?? tiers[tiers.length - 1];
  return { level: Math.min(level, tierMaxLevel(up)), asc: up - 1 };
}

const ascName = (a: number) => ascText(a)[0].toUpperCase() + ascText(a).slice(1);

/** One row of the stat table: gained per level, at lvl 1, at the picked lvl, at the tier's max lvl. */
export interface StatRow { base: string; label: string; perLevel: number; first: number; at: number; max: number }

/** The stat table's values for a class, a tier (prestige 1-3 = ascension 0-2) and a level. */
export function statRows(c: Any, prestige: number, level: number): StatRow[] {
  const top = tierMaxLevel(prestige);
  return GROWTH.map((g) => ({
    base: g[1], label: g[2], perLevel: c?.[g[0]]?.[prestige] ?? 0,
    first: statAt(c, g, prestige, 1), at: statAt(c, g, prestige, level), max: statAt(c, g, prestige, top),
  }));
}

/**
 * The radar's axes (U54): the class's stats at lvl 50, ascension 0; each axis's rim is the highest value of that stat
 * among all classes. Only the shape is drawn (radar() with fixedRims and values off).
 */
export function shapeAxes(id: number): RadarAxis[] {
  const c = G.heroList?.[id];
  return CHARTED.map((g) => ({
    label: g[2], value: statAt(c, g, 1, SHAPE_LEVEL),
    max: Math.max(0, ...classes().map(([, o]) => statAt(o, g, 1, SHAPE_LEVEL))),
  }));
}

/** The class's shape radar: the best class's rims (not the fixed Crit / Acc rims), axis names only. */
export const shapeRadar = (id: number): HTMLElement =>
  radar(shapeAxes(id), { title: `${className(id) ?? G.heroList?.[id]?.name ?? "Class"} stat shape`, size: 260, fixedRims: false, values: false });

/** A level column's header ("Lvl 60"), with the expansion badge when the level needs one (51-60: Frozen Tome). */
function lvHead(level: number, cls = "n"): HTMLElement {
  const badge = badgeFor("level", level);
  return el("th", { scope: "col", class: cls }, lvStart(level), ...(badge ? [" ", badge] : []));
}

const STAT_LABEL: Record<string, () => Node | string> = { hp: () => statLink("max-hp", "HP"), crit: () => statLink("crit", "Crit") };

/** The stat table (one row per stat) of a class on a tier at a level. */
export function statTable(c: Any, prestige: number, level: number): HTMLElement {
  const head = el("tr", {}, el("th", { scope: "col" }, statLink("hero-stats", "Stat")), el("th", { scope: "col", class: "n" }, `Per ${LV.toLowerCase()}`),
    lvHead(1), lvHead(level, "n cur"), lvHead(tierMaxLevel(prestige)));
  const rows = statRows(c, prestige, level).map((r) => el("tr", {},
    el("th", { scope: "row" }, STAT_LABEL[r.base]?.() ?? r.label), el("td", { class: "n" }, dec.format(r.perLevel)),
    el("td", { class: "n" }, dec.format(r.first)), el("td", { class: "n cur" }, dec.format(r.at)), el("td", { class: "n" }, dec.format(r.max))));
  return el("table", { class: "cls-stat-table" }, el("thead", {}, head), el("tbody", {}, ...rows));
}

/**
 * The class's stats block (picker, stat table, shape radar), wired together. `onSelect` is told every new selection
 * (the page keeps it in the URL).
 */
export function classStats(id: number, start: Partial<Selection> = {}, onSelect?: (s: Selection) => void): { block: HTMLElement } {
  const c = G.heroList[id];
  // U28: hero ascension 2 (prestige 3, levels 51-60) needs the Frozen Tome; hidden when the visitor hides it.
  const tiers = tiersOf(c).filter((p) => isVisible("prestige", p));
  let sel = clampSelection(tiers, { level: start.level ?? tierMaxLevel(1), asc: start.asc ?? 0 });

  // ---- picker: ascension switch + level slider
  const ascSeg = segmented(`cls-asc-${id}`, "Ascension", tiers.map((p) => ({
    value: String(p - 1), label: String(p - 1), cls: `asc-opt tier-${p - 1}`, title: `${ascName(p - 1)}: up to ${lv(tierMaxLevel(p))}`,
  })), String(sel.asc), (v) => set({ level: sel.level, asc: Number(v) }));
  const radios = [...ascSeg.querySelectorAll<HTMLInputElement>("input")];
  const slider = el("input", { type: "range", min: "1", step: "1", "aria-label": LV }) as HTMLInputElement;
  const out = el("output", { class: "cls-lv-out" });
  slider.addEventListener("input", () => set({ level: Number(slider.value), asc: sel.asc }));
  let lvBox: HTMLElement;
  const picker = el("div", { class: "cls-pick" },
    ...(tiers.length > 1 ? [segField("Ascension", ascSeg, "cls-asc")] : []),
    lvBox = el("label", { class: "cls-lv" }, el("span", { class: "muted small" }, LV), slider, out));

  const tableHolder = el("div", { class: "table-wrap cls-table" });
  const block = el("div", { class: "cls-v3" }, picker,
    el("div", { class: "cls-stats" }, tableHolder, el("div", { class: "cls-shape" }, shapeRadar(id))));

  function set(s: Selection, quiet = false): void {
    sel = clampSelection(tiers, s);
    const p = sel.asc + 1;
    radios.forEach((r, k) => (r.checked = tiers[k] === p));
    lvBox.className = `cls-lv tier-${sel.asc}`;
    slider.max = String(tierMaxLevel(p));
    slider.value = String(sel.level);
    slider.setAttribute("aria-valuetext", `${lvStart(sel.level)} of ${tierMaxLevel(p)}`);
    out.textContent = `${sel.level} / ${tierMaxLevel(p)}`;
    tableHolder.replaceChildren(statTable(c, p, sel.level));
    if (!quiet) onSelect?.(sel);
  }
  set(sel, true);
  return { block };
}
