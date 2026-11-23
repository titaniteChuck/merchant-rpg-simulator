/**
 * Tables of the profit page: column sets with plain-language headers and the explanation shown on hover,
 * and a sortable table (dom.ts `table`) that keeps its sort when the rows are filtered and shows only the
 * first rows until asked for all.
 */
import { type Column, el, fmt, fmt1, GRADE_LETTERS, gradeBadge, type Row, table } from "./dom.ts";
import type { Row as ProfitRow } from "./profit-worker.ts";
import { tip } from "./tooltip.ts";
import { itemLink } from "./wiki-data.ts";

/** A column with the text that explains it (header tooltip). */
export interface InfoColumn extends Column {
  tip?: string;
}

export interface SortState {
  key: string;
  desc: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const gold = (v: unknown) => (isNum(v) ? `${fmt.format(v)} g` : "—");
const signed = (v: unknown) => (isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.format(Math.abs(v))} g` : "—");
const percent = (v: unknown) => (isNum(v) ? `${fmt1.format(v)}%` : "—");
const mins = (v: unknown) => (!isNum(v) ? "—" : v >= 120 ? `${fmt1.format(v / 60)} h` : `${fmt1.format(v)} min`);

/** Gold with a sign, green when it gains and red when it loses. */
function money(v: unknown): Node | string {
  if (!isNum(v)) return "—";
  return el("span", { class: `pf-money ${v > 0 ? "pf-gain" : v < 0 ? "pf-loss" : ""}`.trim() }, signed(v));
}

export const STRATEGY: Record<string, string> = {
  "sell as crafted": "Sell as made",
  "enchant to 1 mod": "Enchant to 1 modifier",
  "enchant to 2 mods": "Enchant to 2 modifiers",
};

/** "craft (Woodworker) at asc 2" and friends, in words. */
export function howText(how: string): string {
  return how.replace(/^craft \((.+?)\)( at asc \d)?$/, "Craft ($1)")
    .replace(/^ascend asc(\d) item \(\+(\d+)x (.+)\)$/, "Ascend the asc $1 item ($2 × $3)")
    .replace(/^quest (.+) \((.+)g, (.+)\/run\)$/, "Quest: $1 ($2 g, $3 per run)")
    .replace(/^map loot (.+) \(valued at sell price\)$/, "Loot of $1")
    .replace(/\basc(\d)\b/g, "asc $1");
}

const itemCell = (r: Row) => el("span", { class: "nowrap" }, itemLink(String(r.type ?? "equipment"), Number(r.id), String(r.name), r.rarity),
  ...(Number(r.owned) > 0 ? [el("span", { class: "pf-owned", title: `You have ${r.owned}` }, `✓ ${fmt.format(Number(r.owned))}`)] : []));
const ascCell = (r: Row) => (Number(r.asc) > 0 ? el("span", { class: "pill plain" }, `asc ${r.asc}`) : el("span", { class: "muted" }, "0"));

/** What to make and sell, ranked. */
export function itemColumns(withOwned: boolean): InfoColumn[] {
  return [
    { key: "name", label: "Item", render: itemCell, tip: "Hover a name for its stats, click it for its wiki page." },
    { key: "type", label: "Type", show: (v) => String(v ?? "").replace(/^./, (c) => c.toUpperCase()) },
    { key: "level", label: "Lvl", num: true, tip: "Item level." },
    { key: "asc", label: "Asc", num: true, render: ascCell, tip: "Ascension: 0 is the plain item; 1 and 2 are ascended with orbs (essence) and sell for 2× and 4×." },
    { key: "best_profit", label: "Profit", num: true, render: (r) => money(r.best_profit),
      tip: "Gold you keep per item with the best plan: average sale price minus everything it took to make it (gold, ingredients, orbs, enchanting)." },
    { key: "best_margin%", label: "Return", num: true, show: percent,
      tip: "Profit as a share of the cost. 100% means you get back twice what you spent." },
    { key: "best_strategy", label: "Best plan", show: (v) => STRATEGY[String(v)] ?? String(v ?? ""),
      tip: "What to do once it is made: sell it as it comes out, or pay the Enchanter for one or two modifiers first (modifiers raise the price). The plan with the highest average profit." },
    { key: "sell", label: "Sells for", num: true, show: gold,
      tip: "Base price of the plain item (no modifier), before haggling and customer preferences." },
    { key: "ev_sell", label: "Average sale", num: true, show: gold,
      tip: "Average price when you sell it as made: crafting sometimes adds modifiers, which sell for more." },
    { key: "cost", label: "Cost to make", num: true, show: gold,
      tip: "Full cost of one item made the cheapest way: crafting gold plus every ingredient at its own cheapest cost, orbs for ascending, quest or map costs for drops." },
    { key: "p_any", label: "Modifier chance", num: true, render: (r) => {
      if (!isNum(r.p_any) || r.p_any === 0) return el("span", { class: "muted" }, "—");
      const s = el("span", { class: "pf-odds" }, percent(r.p_any));
      tip(s, () => `Prefix ${percent(r["p_prefix%"])}, suffix ${percent(r["p_suffix%"])}, both ${percent(r["p_both%"])}`);
      return s;
    }, tip: "Chance that crafting adds at least one modifier (prefix or suffix). Hover a value for prefix / suffix / both. Top gear rarely gets any: use the Enchanter." },
    { key: "craft_min", label: "Craft time", num: true, show: mins, tip: "Crafter time for one item (or the ascension time when it is ascended)." },
    { key: "how", label: "Cheapest way to get it", show: (v) => howText(String(v ?? "")),
      tip: "Where the cheapest copy comes from: crafted, ascended from the level below, or dropped by a quest or map." },
    ...(withOwned ? [{ key: "owned", label: "You have", num: true, tip: "Copies in your save: inventory, maps, shop and hero gear." }] : []),
  ];
}

/** Enchanting one modifier onto an owned piece of equipment. */
export function enchantColumns(): InfoColumn[] {
  const chance = (key: string) => (r: Row) => (isNum(r[key]) ? percent(r[key]) : el("span", { class: "muted", title: "Not possible on this item" }, "—"));
  const tries = (v: unknown) => (isNum(v) ? fmt1.format(v) : "—");
  return [
    { key: "name", label: "Item", render: (r) => itemCell({ ...r, type: "equipment" }), tip: "Hover a name for its stats, click it for its wiki page." },
    { key: "level", label: "Lvl", num: true, tip: "Item level." },
    { key: "asc", label: "Asc", num: true, render: ascCell, tip: "Ascension level of the item you enchant. Ascended items also use orbs per attempt." },
    { key: "item_grade", label: "Grade", num: true, render: (r) => gradeBadge(GRADE_LETTERS[Number(r.item_grade) - 1] ?? "?"),
      tip: "Grade the item comes out of the crafter with (from the crafter's level and the ingredients' grade). It sets the Enchanter's odds." },
    { key: "sell", label: "Sells for", num: true, show: gold, tip: "Base price of the plain item." },
    { key: "gain_1mod", label: "Price gain", num: true, render: (r) => money(r.gain_1mod), tip: "How much more the item sells for with one modifier." },
    { key: "suffix_chance%", label: "Suffix odds", num: true, render: chance("suffix_chance%"), tip: "Chance that one Enchanter attempt adds a +1 suffix. Rings and amulets can't take a suffix." },
    { key: "suffix_attempts", label: "Suffix tries", num: true, show: tries, tip: "Average number of attempts until the suffix sticks." },
    { key: "suffix_cost", label: "Suffix cost", num: true, show: gold, tip: "Average total cost of those attempts: gold, runes, and orbs on ascended items." },
    { key: "suffix_net", label: "Suffix gain", num: true, render: (r) => money(r.suffix_net), tip: "Price gain minus the suffix cost: what a +1 suffix earns you." },
    { key: "prefix_chance%", label: "Prefix odds", num: true, render: chance("prefix_chance%"), tip: "Chance that one Enchanter attempt adds a first prefix. Low on high-level gear." },
    { key: "prefix_attempts", label: "Prefix tries", num: true, show: tries, tip: "Average number of attempts until the prefix sticks." },
    { key: "prefix_cost", label: "Prefix cost", num: true, show: gold, tip: "Average total cost of those attempts: gold, runes and gems, and orbs on ascended items." },
    { key: "prefix_net", label: "Prefix gain", num: true, render: (r) => money(r.prefix_net), tip: "Price gain minus the prefix cost: what a first prefix earns you." },
  ];
}

/** Every map that drops an orb, with its cost per orb. */
export function essenceColumns(): InfoColumn[] {
  return [
    { key: "essence", label: "Orb", render: (r) => itemLink("material", Number(r.essence_id), String(r.essence)) },
    { key: "map", label: "Map", render: (r) => el("span", { class: "nowrap" }, itemLink("map", Number(r.map_id), String(r.map)),
      ...(Number(r.map_asc) > 0 ? [" ", el("span", { class: "pill plain" }, `asc ${r.map_asc}`)] : [])),
      tip: "The map run that drops the orb. Ascended (asc 1) maps drop the asc-2 orbs." },
    { key: "enchant", label: "Map enchant", show: (v) => (v === "as crafted" ? "As crafted" : String(v ?? "")),
      tip: "The map as it comes out of the crafter, or enchanted first (a higher suffix gives more orbs but costs gold and runes)." },
    { key: "essence_per_run", label: "Orbs per run", num: true, show: (v) => (isNum(v) ? fmt1.format(v) : "—"),
      tip: "Average orbs one run of this map drops at the chosen grade, map modifiers included when they are on." },
    { key: "map_cost", label: "Map cost", num: true, show: gold, tip: "Cost to make the map (and enchant it when it is)." },
    { key: "loot_credit", label: "Loot value", num: true, show: gold,
      tip: "Value of the other loot of the run, which pays for part of the map. Zero when every drop carries the full cost." },
    { key: "cost_per_essence", label: "Cost per orb", num: true, show: (v) => (isNum(v) ? `${fmt1.format(v)} g` : "—"),
      tip: "(Map cost − loot value) ÷ orbs per run. Lower is better." },
    { key: "chosen", label: "Used", show: (v) => (v === "yes" ? "✓ cheapest" : ""), tip: "The source the prices on this page use for this orb." },
  ];
}

export function sortRows(rows: ProfitRow[], s: SortState): ProfitRow[] {
  const v = (r: ProfitRow) => r[s.key];
  return [...rows].sort((a, b) => {
    const x = v(a), y = v(b);
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // blanks last
    if (y === null || y === undefined) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return s.desc ? -c : c;
  });
}

export interface RankedTableOptions {
  rows: ProfitRow[];
  cols: InfoColumn[];
  sort: SortState;
  /** Called when a header is clicked, with the new sort (the caller re-renders). */
  onSort: (s: SortState) => void;
  /** Rows shown before "Show all". */
  limit: number;
  onShowAll: () => void;
}

/**
 * dom.ts table over the sorted rows (first `limit`), with the explanation of each column on its header and
 * the sort kept by the caller, so that filtering does not lose it.
 */
export function rankedTable(o: RankedTableOptions): HTMLElement {
  const sorted = sortRows(o.rows, o.sort);
  const shown = sorted.slice(0, o.limit);
  const wrap = table(shown as Row[], o.cols);
  const ths = wrap.querySelectorAll("th");
  o.cols.forEach((c, i) => {
    const th = ths[i];
    const btn = th.querySelector("button")!;
    if (c.tip) {
      btn.dataset.tip = "";
      btn.setAttribute("aria-description", c.tip);
      tip(btn, () => el("div", { class: "tip-body" }, el("strong", {}, c.label), el("span", {}, c.tip!)));
    }
    if (c.key === o.sort.key) th.setAttribute("aria-sort", o.sort.desc ? "descending" : "ascending");
    // Our handler runs after dom.ts's own: re-sort the whole list, not only the rows shown.
    btn.addEventListener("click", () => o.onSort({ key: c.key, desc: c.key === o.sort.key ? !o.sort.desc : Boolean(c.num) }));
  });
  if (sorted.length <= shown.length) return wrap;
  const more = el("button", { type: "button", class: "secondary" }, `Show all ${fmt.format(sorted.length)} rows`);
  more.addEventListener("click", o.onShowAll);
  return el("div", {}, wrap, el("p", { class: "pf-more muted small" }, `First ${fmt.format(shown.length)} of ${fmt.format(sorted.length)}. `, more));
}
