/**
 * Class page stats (U19): stat cards, a level / ascension picker, the radar with the three ascensions on one chart, and
 * one growth chart per stat with each ascension's level cap and the level where the next ascension unlocks.
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
import { ascText, el, segField, segmented } from "./dom.ts";
import { group, type LineChart, lineChart } from "./line-chart.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { classes } from "./wiki-data.ts";
import { isVisible } from "./expansion-state.ts";
import { className } from "./names.ts";
import { withHelp } from "./wiki-help.ts";
import { type StatTopic, statLink } from "./wiki-ref.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** [growth key, base key, label]. */
export type Growth = [string, string, string];
export const GROWTH: Growth[] = [["hpPlv", "hp", "HP"], ["atkPlv", "atk", "Atk"], ["matkPlv", "matk", "Matk"], ["accPlv", "acc", "Acc"],
  ["defPlv", "def", "Def"], ["mdefPlv", "mdef", "Mdef"], ["critPlv", "crit", "Crit"]];
/** Charted stats: Crit left out of the curves and the radar (on request; the cards still show it). */
export const CHARTED = GROWTH.filter(([, b]) => b !== "crit");
/** U30: stat cards whose label links to its own Stats section (the others: the growth "?"). */
const CARD_TOPIC: Record<string, StatTopic> = { hp: "max-hp", crit: "crit" };

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

/** The highest level any tier reaches (the charts' x axis). */
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

/**
 * The class's stat cards (for the top of the page) and the stats block (picker, radar, growth charts), wired together.
 * `onSelect` is told every new selection (the page keeps it in the URL).
 */
export function classStats(id: number, start: Partial<Selection> = {}, onSelect?: (s: Selection) => void): { cards: HTMLElement; block: HTMLElement } {
  const c = G.heroList[id];
  // U28: hero ascension 2 (prestige 3, levels 51-60) needs the Frozen Tome; hidden when the visitor hides it.
  const tiers = tiersOf(c).filter((p) => isVisible("prestige", p));
  const top = topLevel(tiers);
  const levels = Array.from({ length: top }, (_, i) => i + 1);
  let sel = clampSelection(tiers, { level: start.level ?? tierMaxLevel(1), asc: start.asc ?? 0 });

  // ---- cards (top of the page)
  const cardVals = new Map<string, HTMLElement>();
  const cardHead = el("p", { class: "cls-cards-head muted small" });
  const cards = el("div", { class: "cls-cards-wrap" }, cardHead,
    el("dl", { class: "facts cls-cards" }, ...GROWTH.map((g) => {
      const dd = el("dd", {});
      cardVals.set(g[1], dd);
      return el("div", {}, el("dt", {}, CARD_TOPIC[g[1]] ? statLink(CARD_TOPIC[g[1]], g[2]) : g[2]), dd);
    })));

  // ---- picker: ascension switch + level slider
  const ascSeg = segmented(`cls-asc-${id}`, "Ascension", tiers.map((p) => ({
    value: String(p - 1), label: String(p - 1), cls: `asc-opt tier-${p - 1}`, title: `${ascName(p - 1)}: up to level ${tierMaxLevel(p)}`,
  })), String(sel.asc), (v) => set({ level: sel.level, asc: Number(v) }));
  const radios = [...ascSeg.querySelectorAll<HTMLInputElement>("input")];
  const slider = el("input", { type: "range", min: "1", step: "1", "aria-label": "Level" }) as HTMLInputElement;
  const out = el("output", { class: "cls-lv-out" });
  slider.addEventListener("input", () => set({ level: Number(slider.value), asc: sel.asc }));
  let lvBox: HTMLElement;
  const picker = el("div", { class: "cls-pick" },
    ...(tiers.length > 1 ? [segField("Ascension", ascSeg, "cls-asc")] : []),
    lvBox = el("label", { class: "cls-lv" }, el("span", { class: "muted small" }, "Level"), slider, out));

  // ---- radar: every ascension at the selected level (each capped at its tier's max), the selected one on top
  const radarHolder = el("div", { class: "cls-radar-fig" });
  const radarCap = el("figcaption", { class: "muted small" });
  const drawRadar = () => {
    const at = (p: number) => Math.min(sel.level, tierMaxLevel(p));
    const axes: RadarAxis[] = CHARTED.map((g) => {
      let max = 0, best = "";
      for (const [cid, o] of classes()) {
        if (!isVisible("class", cid)) continue; // the rim compares with the classes the visitor can have
        for (const p of tiersOf(o).filter((t) => isVisible("prestige", t))) {
          const v = statAt(o, g, p, at(p));
          if (v > max) [max, best] = [v, `${className(cid) ?? o.name}, ${ascText(p - 1)}`];
        }
      }
      const value = statAt(c, g, sel.asc + 1, at(sel.asc + 1));
      return { label: g[2], value, max, best, display: dec.format(value) };
    });
    const layers = tiers.filter((p) => p - 1 !== sel.asc).map((p) => ({
      values: CHARTED.map((g) => statAt(c, g, p, at(p))), cls: `tier-${p - 1}`, label: `${ascName(p - 1)}, level ${at(p)}`,
    }));
    const fig = radar(axes, { title: `${className(id) ?? c.name} · level ${at(sel.asc + 1)} · ${ascText(sel.asc)}`, layers, shapeClass: `tier-${sel.asc}` });
    // R1 F18: the level, ascension and "no gear" are in the line above the cards; the caption only says what the
    // chart adds (the other ascensions' shapes and the rim).
    radarCap.textContent = "Other ascensions capped at their max level. Rim = best class at that level.";
    fig.append(radarCap);
    radarHolder.replaceChildren(fig);
  };

  // ---- growth charts: one per stat, one line per ascension up to its cap, the unlock level ringed
  const charts: LineChart[] = CHARTED.map((g) => lineChart(tiers.map((p) => ({
    label: tiers.length > 1 ? `ascension ${p - 1}` : "", cls: `tier-${p - 1}`,
    values: levels.slice(0, tierMaxLevel(p)).map((lv) => statAt(c, g, p, lv)),
  })), {
    title: g[2], x: levels, xName: "Level", xTicks: [1, 20, 40, top],
    start: sel.level - 1,
    marks: tiers.flatMap((p, k) => {
      const u = unlockLevel(p);
      return u && tiers.includes(p + 1) ? [{ series: k, i: u - 1, label: `Level ${u} of ${ascText(p - 1)}: ascension ${p} unlocks` }] : [];
    }),
    caption: `${dec.format(c[g[1]] ?? 0)} + ${tiers.map((p) => dec.format(c[g[0]]?.[p] ?? 0)).join(" / ")} × level`,
    onPick: (i) => set({ level: i + 1, asc: sel.asc }),
  }));
  group(charts);
  const unlocks = tiers.map((p) => [p, unlockLevel(p)] as const).filter(([p, u]) => u && tiers.includes(p + 1));
  const legend = el("p", { class: "lc-legend muted small" },
    ...(tiers.length > 1 ? ["Ascension: ", ...tiers.map((p) => el("span", { class: "lc-key" },
      el("i", { class: `lc-swatch tier-${p - 1}`, "aria-hidden": "true" }), ` ${p - 1} (max ${tierMaxLevel(p)})`))] : []),
    el("span", { class: "lc-key" }, el("i", { class: "lc-ring", "aria-hidden": "true" }),
      ` next ascension unlocks${unlocks.length ? ` (level ${unlocks.map(([, u]) => u).join(", ")})` : ""}`),
    el("span", {}, " · hover to read a level, click to pick it"));

  const block = el("div", { class: "cls-v3" }, picker,
    el("div", { class: "cls-stats" },
      el("div", { class: "cls-radar" }, radarHolder),
      el("div", { class: "cls-growth" }, withHelp(el("h3", { class: "wiki-banner sub" }, "Growth per level"),
        "The class's own stats: base + growth × level, before gear, potions, passive and attribute points.", "growth per level", [statLink("hero-stats")]), legend, el("div", { class: "lc-grid-wrap" }, ...charts.map((ch) => ch.el)))));
  cards.classList.add("cls-v3");

  function set(s: Selection, quiet = false): void {
    sel = clampSelection(tiers, s);
    const p = sel.asc + 1;
    for (const g of GROWTH) cardVals.get(g[1])!.textContent = dec.format(statAt(c, g, p, sel.level));
    cardHead.replaceChildren(el("strong", {}, `Level ${sel.level}`), `, ${ascText(sel.asc)} · no gear, passive or attribute points`);
    radios.forEach((r, k) => (r.checked = tiers[k] === p));
    lvBox.className = `cls-lv tier-${sel.asc}`;
    slider.max = String(tierMaxLevel(p));
    slider.value = String(sel.level);
    slider.setAttribute("aria-valuetext", `Level ${sel.level} of ${tierMaxLevel(p)}`);
    out.textContent = `${sel.level} / ${tierMaxLevel(p)}`;
    for (const ch of charts) ch.pin(sel.level - 1);
    drawRadar();
    if (!quiet) onSelect?.(sel);
  }
  set(sel, true);
  return { cards, block };
}
