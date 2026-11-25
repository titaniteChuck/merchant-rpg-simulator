/**
 * Tables of the profit page: column sets with plain-language headers and the explanation shown on hover, focus and tap,
 * and a sortable table (dom.ts `table`) that keeps its sort when the rows are filtered and shows only the
 * first rows, then more in steps of 300 (P2). "Cost to make" opens the cost breakdown under the row (P2, F22).
 */
import { ascSwatch, type Column, duration, el, fmt, fmt1, gold, goldNumber, GRADE_LETTERS, gradeBadge, LV, pct, type Row, table } from "./dom.ts";
import type { CostPart, Row as ProfitRow } from "./profit-worker.ts";
import { tip } from "./tooltip.ts";
import { itemLink } from "./wiki-data.ts";
import { compareNames, crafterName, enemyName, ITEM_TYPE_LABELS, itemName } from "./names.ts";

/** A name cell's text as shown (U29: worker rows name items, maps and orbs in English). */
function shownName(r: ProfitRow, key: string): unknown {
  if (key === "name") return itemName(String(r.type ?? "equipment"), Number(r.id)) ?? r.name;
  if (key === "map" && r.map_id !== undefined) return itemName("map", Number(r.map_id)) ?? r.map;
  if (key === "essence" && r.essence_id !== undefined) return itemName("material", Number(r.essence_id)) ?? r.essence;
  return r[key];
}

/** A column with the text that explains it (header tooltip). */
export interface InfoColumn extends Column {
  tip?: string;
}

export interface SortState {
  key: string;
  desc: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (isNum(v) ? v : null);
/** Cell values: gold (whole, or 1 decimal per orb), a share already in percent, minutes. */
export const goldCell = (v: unknown, decimals: 0 | 1 = 0): string => gold(num(v), decimals);
export const signedGold = (v: unknown): string => (isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${goldNumber(Math.abs(v))} g` : "—");
export const percent = (v: unknown): string => (isNum(v) ? pct(v / 100) : "—");
export const minutes = (v: unknown): string => (isNum(v) ? duration(v * 60) : "—");

/** Gold with a sign, green when it gains and red when it loses. */
function money(v: unknown): Node | string {
  if (!isNum(v)) return "—";
  return el("span", { class: `pf-money ${v > 0 ? "pf-gain" : v < 0 ? "pf-loss" : ""}`.trim() }, signedGold(v));
}

export type ProfitTab = "Items" | "Enchanting" | "Orbs";
export const TAB_LABELS: Record<ProfitTab, string> = { Items: "What to make", Enchanting: "Enchanting", Orbs: "Orbs" };
/** The result tabs: no Orbs tab when orbs are hidden (Scribe expansion hidden). */
export const profitTabs = (orbsHidden: boolean): ProfitTab[] => (orbsHidden ? ["Items", "Enchanting"] : ["Items", "Enchanting", "Orbs"]);

export const STRATEGY: Record<string, string> = {
  "sell as crafted": "Sell as made",
  "enchant to 1 mod": "Enchant to 1 modifier",
  "enchant to 2 mods": "Enchant to 2 modifiers",
};

/**
 * "craft (Woodworker) at asc 2" and friends, in words; `ref` (the worker's how_id: crafter, orb, quest or map id)
 * names the crafter, orb, enemy or map in the visitor's language.
 */
export function howText(how: string, ref: number | null = null): string {
  const named = (shown: string | undefined, english: string) => (ref !== null && shown) || english;
  let m = /^craft \((.+?)\)( at asc \d)?$/.exec(how);
  if (m) return `Craft (${named(ref !== null ? crafterName(ref) : undefined, m[1])})`;
  m = /^ascend asc(\d) item \(\+(\d+)x (.+)\)$/.exec(how);
  if (m) return `Ascend the ascension-${m[1]} item (${m[2]} × ${named(ref !== null ? itemName("material", ref) : undefined, m[3])})`;
  m = /^quest (.+?)( \[rare\])? \(([\d.]+)g, ([\d.]+)\/run\)$/.exec(how);
  if (m) {
    const rare = Boolean(m[2]);
    return `Quest: ${named(ref !== null ? enemyName(ref, rare) : undefined, m[1])}${rare ? " (rare)" : ""} (${gold(Number(m[3]))}, ${m[4]} per run)`;
  }
  m = /^map loot (.+) \(valued at sell price\)$/.exec(how);
  if (m) return `Loot of ${named(ref !== null ? itemName("map", ref) : undefined, m[1])}`;
  const mapAt = (name: string, asc: string | undefined) => named(ref !== null ? itemName("map", ref) : undefined, name) + (asc ? ` (ascension ${asc})` : "");
  m = /^map run (.+?)(?: asc(\d))? \(([\d.]+)\/run;/.exec(how);
  if (m) return `Map run: ${mapAt(m[1], m[2])}, ${fmt1.format(Number(m[3]))} per run`;
  m = /^map (.+?)(?: asc(\d))?(?: enchanted (.+?))? \(([\d.]+) essence\/run\)/.exec(how);
  if (m) return `Map: ${mapAt(m[1], m[2])}${m[3] ? `, enchanted ${m[3]}` : ""}, ${fmt.format(Number(m[4]))} per run`;
  return how.replace(/\basc(\d)\b/g, "ascension $1");
}

/** A span with help on hover, focus and tap (R3 F18: a tooltip, not a `title`). */
export function helpSpan(e: HTMLElement, text: string): HTMLElement {
  e.removeAttribute("title");
  e.tabIndex = 0;
  tip(e, () => text);
  return e;
}

/** The ascension swatch: the number shows, the column header explains it (no `title`). */
const swatch = (asc: unknown): HTMLElement => {
  const s = ascSwatch(asc);
  s.removeAttribute("title");
  return s;
};

/** The ascension next to the name, shown on a phone where the Asc column is out of view (P2). */
export function ascBadge(asc: unknown): HTMLElement | null {
  if (!(Number(asc) > 0)) return null;
  const b = swatch(asc);
  b.classList.add("pf-asc-badge");
  return b;
}

// Ascension is the name's outline (silver 1, gold 2), as on the other pages; on a phone also a badge.
const itemCell = (r: Row) => el("span", { class: "nowrap" }, itemLink(String(r.type ?? "equipment"), Number(r.id), String(r.name), r.rarity, r.asc),
  ...[ascBadge(r.asc)].filter((x) => x !== null),
  ...(Number(r.owned) > 0 ? [el("span", { class: "pf-owned" }, `✓ ${fmt.format(Number(r.owned))}`)] : []));

/** "type|id|asc", the key of a row's cost breakdown. */
export const costKey = (r: Row): string => `${r.type ?? "equipment"}|${r.id}|${r.asc ?? 0}`;

/** "Cost to make": a button that opens the breakdown under the row. */
const costCell = (r: Row) => (isNum(r.cost)
  ? el("button", { type: "button", class: "pf-why-btn", "data-why": costKey(r), "aria-expanded": "false" }, goldCell(r.cost))
  : "—");

const amount = (a: number) => (Number.isInteger(a) ? fmt.format(a) : fmt1.format(a));

/**
 * One unit's cost: where it comes from, then for a craft or an ascension the crafting gold and each part
 * (amount × unit cost), a part that is itself made from parts opening the same way.
 */
export function whyPanel(costs: Record<string, CostPart>, key: string): HTMLElement {
  const e = costs[key];
  if (!e) return el("p", { class: "muted small" }, "No breakdown.");
  const lines: HTMLElement[] = [];
  if (e.gold) lines.push(el("li", {}, el("span", {}, "Crafting gold"), el("span", { class: "num" }, gold(e.gold))));
  for (const [t, i, p, a] of e.parts ?? []) {
    const k = `${t}|${i}|${p}`, part = costs[k];
    const label = el("span", {}, `${amount(a)} × `, itemLink(t, i, undefined, undefined, p),
      ...(part ? [el("span", { class: "muted small" }, ` · ${gold(part.cost, part.cost < 10 ? 1 : 0)} each · ${howText(part.how, part.ref)}`)] : []));
    const total = el("span", { class: "num" }, part ? gold(a * part.cost) : "—");
    if (part?.parts?.length) {
      const d = el("details", {}, el("summary", {}, label, total)) as HTMLDetailsElement;
      d.addEventListener("toggle", () => {
        if (d.open && d.children.length === 1) d.append(whyPanel(costs, k));
      });
      lines.push(el("li", {}, d));
    } else lines.push(el("li", {}, label, total));
  }
  return el("div", { class: "pf-why" },
    el("p", {}, howText(e.how, e.ref)),
    ...(lines.length ? [el("ul", {}, ...lines, el("li", { class: "pf-why-total" }, el("span", {}, "Total"), el("span", { class: "num" }, gold(e.cost))))] : []));
}
const ascCell = (r: Row) => swatch(r.asc);

/** What to make and sell, ranked. */
export function itemColumns(withOwned: boolean): InfoColumn[] {
  return [
    { key: "name", label: "Item", render: itemCell, tip: "Tap a name for its wiki page." },
    { key: "type", label: "Type", show: (v) => ITEM_TYPE_LABELS[String(v)] ?? String(v ?? "") },
    { key: "level", label: LV, num: true, tip: "Item level." },
    { key: "asc", label: "Asc", num: true, render: ascCell, tip: "Ascension: 0 is the plain item; 1 and 2 are ascended with orbs (essence) and sell for 2× and 4×." },
    { key: "best_profit", label: "Profit", num: true, render: (r) => money(r.best_profit),
      tip: "Gold you keep per item with the best plan: average sale price minus everything it took to make it (gold, ingredients, orbs, enchanting)." },
    { key: "best_margin%", label: "Return", num: true, show: percent,
      tip: "Profit as a share of the cost. 100% means you get back twice what you spent." },
    { key: "best_strategy", label: "Best plan", show: (v) => STRATEGY[String(v)] ?? String(v ?? ""),
      tip: "What to do once it is made: sell it as it comes out, or pay the Enchanter for one or two modifiers first (modifiers raise the price). The plan with the highest average profit." },
    { key: "sell", label: "Sells for", num: true, show: (v) => goldCell(v),
      tip: "Base price of the plain item (no modifier), before haggling and customer preferences." },
    { key: "ev_sell", label: "Average sale", num: true, show: (v) => goldCell(v),
      tip: "Average price when you sell it as made: crafting sometimes adds modifiers, which sell for more." },
    { key: "cost", label: "Cost to make", num: true, show: (v) => goldCell(v), render: costCell,
      tip: "Full cost of one item made the cheapest way: crafting gold plus every ingredient at its own cheapest cost, orbs for ascending, quest or map costs for drops. Tap a value for its breakdown." },
    { key: "p_any", label: "Modifier chance", num: true, render: (r) => {
      if (!isNum(r.p_any) || r.p_any === 0) return el("span", { class: "muted" }, "—");
      return helpSpan(el("span", { class: "pf-odds" }, percent(r.p_any)),
        `Prefix ${percent(r["p_prefix%"])}, suffix ${percent(r["p_suffix%"])}, both ${percent(r["p_both%"])}`);
    }, tip: "Chance that crafting adds at least one modifier (prefix or suffix). Tap a value for prefix / suffix / both. Top gear rarely gets any: use the Enchanter." },
    { key: "craft_min", label: "Craft time", num: true, show: minutes, tip: "Crafter time for one item (or the ascension time when it is ascended)." },
    { key: "how", label: "Cheapest way to get it", show: (v, r) => howText(String(v ?? ""), isNum(r.how_id) ? r.how_id : null),
      tip: "Where the cheapest copy comes from: crafted, ascended from the level below, or dropped by a quest or map." },
    ...(withOwned ? [{ key: "owned", label: "You have", num: true, tip: "Copies in your save: inventory, maps, shop and hero gear." }] : []),
  ];
}

/** Enchanting one modifier onto an owned piece of equipment. */
export function enchantColumns(): InfoColumn[] {
  const chance = (key: string) => (r: Row) => (isNum(r[key]) ? percent(r[key]) : helpSpan(el("span", { class: "muted" }, "—"), "Not possible on this item"));
  const tries = (v: unknown) => (isNum(v) ? fmt1.format(v) : "—");
  return [
    { key: "name", label: "Item", render: (r) => itemCell({ ...r, type: "equipment" }), tip: "Tap a name for its wiki page." },
    { key: "level", label: LV, num: true, tip: "Item level." },
    { key: "asc", label: "Asc", num: true, render: ascCell, tip: "Ascension level of the item you enchant. Ascended items also use orbs per attempt." },
    { key: "item_grade", label: "Grade", num: true, render: (r) => gradeBadge(GRADE_LETTERS[Number(r.item_grade) - 1] ?? "?"),
      tip: "Grade the item comes out of the crafter with (from the crafter's level and the ingredients' grade). It sets the Enchanter's odds." },
    { key: "sell", label: "Sells for", num: true, show: (v) => goldCell(v), tip: "Base price of the plain item." },
    { key: "gain_1mod", label: "Price gain", num: true, render: (r) => money(r.gain_1mod), tip: "How much more the item sells for with one modifier." },
    { key: "suffix_chance%", label: "Suffix odds", num: true, render: chance("suffix_chance%"), tip: "Chance that one Enchanter attempt adds a +1 suffix. Rings and amulets can't take a suffix." },
    { key: "suffix_attempts", label: "Suffix tries", num: true, show: tries, tip: "Average number of attempts until the suffix sticks." },
    { key: "suffix_cost", label: "Suffix cost", num: true, show: (v) => goldCell(v), tip: "Average total cost of those attempts: gold, runes, and orbs on ascended items." },
    { key: "suffix_net", label: "Suffix gain", num: true, render: (r) => money(r.suffix_net), tip: "Price gain minus the suffix cost: what a +1 suffix earns you." },
    { key: "prefix_chance%", label: "Prefix odds", num: true, render: chance("prefix_chance%"), tip: "Chance that one Enchanter attempt adds a first prefix. Low on high-level gear." },
    { key: "prefix_attempts", label: "Prefix tries", num: true, show: tries, tip: "Average number of attempts until the prefix sticks." },
    { key: "prefix_cost", label: "Prefix cost", num: true, show: (v) => goldCell(v), tip: "Average total cost of those attempts: gold, runes and gems, and orbs on ascended items." },
    { key: "prefix_net", label: "Prefix gain", num: true, render: (r) => money(r.prefix_net), tip: "Price gain minus the prefix cost: what a first prefix earns you." },
  ];
}

/** Every map that drops an orb, with its cost per orb. */
export function essenceColumns(): InfoColumn[] {
  return [
    { key: "essence", label: "Orb", render: (r) => itemLink("material", Number(r.essence_id), String(r.essence)) },
    { key: "map", label: "Map", render: (r) => el("span", { class: "nowrap" }, itemLink("map", Number(r.map_id), String(r.map), undefined, r.map_asc)),
      tip: "The map run that drops the orb. Ascended maps (silver outline) drop the ascension-2 orbs." },
    { key: "enchant", label: "Map enchant", show: (v) => (v === "as crafted" ? "As crafted" : String(v ?? "")),
      tip: "The map as it comes out of the crafter, or enchanted first (a higher suffix gives more orbs but costs gold and runes)." },
    { key: "essence_per_run", label: "Orbs per run", num: true, show: (v) => (isNum(v) ? fmt1.format(v) : "—"),
      tip: "Average orbs one run of this map drops at the chosen grade, map modifiers included when they are on." },
    { key: "map_cost", label: "Map cost", num: true, show: (v) => goldCell(v), tip: "Cost to make the map (and enchant it when it is)." },
    { key: "loot_credit", label: "Loot value", num: true, show: (v) => goldCell(v),
      tip: "Value of the other loot of the run, which pays for part of the map. Zero when every drop carries the full cost." },
    { key: "cost_per_essence", label: "Cost per orb", num: true, show: (v) => goldCell(v, 1),
      tip: "(Map cost − loot value) ÷ orbs per run. Lower is better." },
    { key: "chosen", label: "Used", show: (v) => (v === "yes" ? "✓ cheapest" : ""), tip: "The source the prices on this page use for this orb." },
  ];
}

export function sortRows(rows: ProfitRow[], s: SortState): ProfitRow[] {
  const v = (r: ProfitRow) => shownName(r, s.key);
  return [...rows].sort((a, b) => {
    const x = v(a), y = v(b);
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // blanks last
    if (y === null || y === undefined) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : compareNames(String(x), String(y));
    return s.desc ? -c : c;
  });
}

export interface RankedTableOptions {
  rows: ProfitRow[];
  cols: InfoColumn[];
  sort: SortState;
  /** Called when a header is clicked, with the new sort (the caller re-renders). */
  onSort: (s: SortState) => void;
  /** Rows shown; "Show N more" adds MORE_STEP. */
  limit: number;
  onMore: () => void;
  /** Cost breakdowns ("Cost to make" buttons) and the keys whose breakdown is open (kept across re-renders). */
  costs?: Record<string, CostPart>;
  open?: Set<string>;
}

/** Rows added by one "Show more": a bounded render (F16), never the 2,000-row table at once. */
export const MORE_STEP = 300;

/** Opens or closes the breakdown row under the row of a "Cost to make" button. */
function toggleWhy(btn: HTMLElement, costs: Record<string, CostPart>, open: Set<string> | undefined, on: boolean): void {
  const tr = btn.closest("tr")!;
  const key = btn.dataset.why!;
  const next = tr.nextElementSibling;
  if (next?.classList.contains("pf-why-row")) next.remove();
  btn.setAttribute("aria-expanded", String(on));
  if (on) open?.add(key);
  else open?.delete(key);
  if (!on) return;
  tr.after(el("tr", { class: "pf-why-row" }, el("td", { colspan: String(tr.children.length) }, whyPanel(costs, key))));
}

/**
 * dom.ts table over the sorted rows (first `limit`), with the explanation of each column on its header and
 * the sort kept by the caller, so that filtering does not lose it.
 */
export function rankedTable(o: RankedTableOptions): HTMLElement {
  const sorted = sortRows(o.rows, o.sort);
  const shown = sorted.slice(0, o.limit);
  const wrap = table(shown as Row[], o.cols);
  wrap.classList.add("pf-table");
  const costs = o.costs;
  if (costs) {
    const tbody = wrap.querySelector("tbody")!;
    tbody.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-why]");
      if (btn) toggleWhy(btn, costs, o.open, btn.getAttribute("aria-expanded") !== "true");
    });
    for (const btn of tbody.querySelectorAll<HTMLElement>("[data-why]")) if (o.open?.has(btn.dataset.why!)) toggleWhy(btn, costs, o.open, true);
  } else wrap.querySelectorAll("[data-why]").forEach((b) => b.replaceWith(b.textContent ?? ""));
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
  const more = el("button", { type: "button", class: "secondary" }, `Show ${fmt.format(Math.min(MORE_STEP, sorted.length - shown.length))} more`);
  more.addEventListener("click", o.onMore);
  return el("div", {}, wrap, el("p", { class: "pf-more muted small" }, `First ${fmt.format(shown.length)} of ${fmt.format(sorted.length)}. `, more));
}
