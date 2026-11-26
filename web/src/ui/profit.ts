/**
 * Profit page (site/profit.html): what to make and sell, when enchanting pays, where orbs are cheapest.
 * The economy is solved by profitReport (web/src/tools/profit.ts) in a web worker (profit-worker.ts);
 * the page only filters and sorts the tables it sends back. A save opened from the top-bar Save dropdown marks the
 * items the player owns. With Scribe hidden there are no orbs or maps: no Orbs tab, orb sources, map-modifier chip,
 * ascension filter or "no orbs" tile. With the default settings the page shows the answer the build precomputed
 * (data/profit-default.json, stored by column: profit-compact.ts) and starts the worker only on a change.
 * Help is in tip() tooltips (hover, focus and tap), never in `title` (R3 F18).
 */
// Review F14: the menus (nav.ts) are bundled into this page, first, so nav and the page share one copy of the
// shared modules (dom, names, language, tooltip, Save menu); the page loads no separate js/nav.js.
import "./nav.ts";
import * as api from "../sim/api.ts";
import { loadSaveText, owned } from "../tools/save.ts";
import { $, chipToggle, el, findFocusKey, fmt1, focusKeyOf, gold, segField, segmented, tabKeys, tile } from "./dom.ts";
import { type CompactProfit, expandProfit } from "../tools/profit-compact.ts";
import { isDefaultRequest, type Orb, type ProfitRequest, type ProfitResponse, type Row } from "./profit-worker.ts";
import {
  enchantColumns, essenceColumns, goldCell, type InfoColumn, itemColumns, MORE_STEP, type ProfitTab, profitTabs, rankedTable, type SortState,
  STRATEGY, stickyPad, TAB_LABELS,
} from "./profit-tables.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText, REGIONS } from "./wiki-data.ts";
import { isHidden, isVisible, subscribe } from "./expansion-state.ts";
import { EXPANSION_IDS } from "../tools/expansions.ts";
import { tip } from "./tooltip.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { ITEM_TYPE_PLURALS, itemName, regionName } from "./names.ts";

/** Orbs and maps are Scribe content. */
export const orbsHidden = (): boolean => isHidden("Scribe");
/** No expansion shown: the tables are the base game only (R3 F11). */
export const baseGameOnly = (): boolean => EXPANSION_IDS.every((x) => isHidden(x));

/** Help on an element, shown on hover, focus and tap (R3 F18); inside a <label> a tap shows it instead of focusing the field. */
export function helpOn(e: HTMLElement, text: string): void {
  e.classList.add("pf-tip");
  e.tabIndex = 0;
  if (e.closest("label")) e.addEventListener("click", (ev) => ev.preventDefault());
  tip(e, () => text);
}

/** U28: an orb source on a map (or an orb) of an expansion the visitor hides is left out. */
const visibleOrbRow = (x: Row) => isVisible("map", Number(x.map_id), { ascension: Number(x.map_asc) || 0 }) && isVisible("material", Number(x.essence_id));

type Result = Extract<ProfitResponse, { ok: true }>;

const PAGE = 100; // rows shown before "Show more"
const MAX_LEVEL = 60;

interface Filters {
  q: string;
  /** Item types shown; empty = all. */
  types: Set<string>;
  min: number;
  max: number;
  asc: string;
  ownedOnly: boolean;
  gainsOnly: boolean;
  orb: string;
}

const state = {
  result: null as Result | null,
  owned: null as Map<string, number> | null,
  worker: null as Worker | null,
  busy: false,
  lastId: 0,
  pending: null as ProfitRequest | null,
  tab: "Items" as ProfitTab,
  settings: { grade: "3", alloc: "value" as "value" | "full", mapMods: true },
  filters: { q: "", types: new Set<string>(), min: 1, max: MAX_LEVEL, asc: "all", ownedOnly: false, gainsOnly: true, orb: "all" } as Filters,
  sort: { Items: { key: "best_profit", desc: true }, Enchanting: { key: "suffix_net", desc: true }, Orbs: { key: "cost_per_essence", desc: false } } as Record<string, SortState>,
  limit: { Items: PAGE, Enchanting: PAGE, Orbs: PAGE } as Record<string, number>,
  orbChoice: new Map<number, string>(), // essence id -> "mapId@asc"
  /** Cost breakdowns open under their row ("type|id|asc"). */
  whyOpen: new Set<string>(),
  /** The precomputed answer for the default settings, reused when the settings go back to them. */
  defaults: null as Result | null,
};

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

// ---------------------------------------------------------------- options -> worker
const num = (id: string, lo: number, hi: number, dflt: number) => {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
};

function request(): ProfitRequest {
  const essenceFrom: [number, number, number][] = [];
  for (const [eid, v] of state.orbChoice) {
    const [m, p] = v.split("@").map(Number);
    essenceFrom.push([eid, m, p]);
  }
  const s = state.settings;
  return {
    id: ++state.lastId, grade: Number(s.grade), luck: num("#luck", 0, 1000, 0), crafterLevel: num("#crafter", 1, 60, 60),
    enchanterLevel: num("#enchanter", 0, 60, 60), mapMods: s.mapMods, alloc: s.alloc, heroHourCost: num("#herohour", 0, 1_000_000, 0), essenceFrom,
  };
}

/** "Hard Tuvale Map" (ascension 1 named, as in the orb selects). */
const mapLabel = (key: string): string => {
  const [m, p] = key.split("@").map(Number);
  return `${itemName("map", m) ?? `#${m}`}${p ? " · ascension 1" : ""}`;
};

function worker(): Worker {
  if (state.worker) return state.worker;
  const w = new Worker(new URL("js/profit-worker.js", document.baseURI), { type: "module" });
  w.onmessage = (e: MessageEvent<ProfitResponse>) => {
    state.busy = false;
    const r = e.data;
    if (state.pending) { // settings changed while solving: solve the newest ones, drop this answer
      const next = state.pending;
      state.pending = null;
      post(next);
      return;
    }
    if (r.id !== state.lastId) return;
    setBusy(false);
    accept(r);
  };
  w.onerror = (e) => {
    state.busy = false;
    state.worker = null;
    w.terminate();
    setBusy(false);
    $("#status").replaceChildren(el("p", { class: "error", role: "alert" }, `The calculation failed: ${e.message || "worker error"}`));
  };
  state.worker = w;
  return w;
}

/** Shows an answer (the worker's or the precomputed one). */
function accept(r: ProfitResponse): void {
  if (!r.ok) {
    $("#status").replaceChildren(el("p", { class: "error", role: "alert" }, `The calculation failed: ${r.error}`));
    return;
  }
  state.result = r;
  // A forced map whose recipe uses at least as many of its orb as a run yields has no price.
  const stuck = r.orbs.filter((o) => state.orbChoice.has(o.id) && o.cost === null);
  $("#status").replaceChildren(...stuck.map((o) => el("p", { class: "error", role: "alert" },
    `${itemName("material", o.id) ?? o.name} can't come from ${mapLabel(state.orbChoice.get(o.id)!)} alone: a run yields fewer than its recipe uses.`)));
  buildOrbSelects(r);
  render();
}

/** First view: the build's answer for the default settings; the worker only if it is missing or the settings differ. */
function firstView(): void {
  const req = request();
  if (!isDefaultRequest(req)) return compute();
  setBusy(true);
  fetch("data/profit-default.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<CompactProfit>;
  }).then(expandProfit).then((r) => {
    state.defaults = r;
    if (state.lastId !== req.id || state.busy) return; // the settings changed meanwhile
    setBusy(false);
    accept({ ...r, id: req.id });
  }).catch(() => {
    if (state.lastId === req.id && !state.busy) compute();
  });
}

function post(req: ProfitRequest): void {
  state.busy = true;
  setBusy(true);
  worker().postMessage(req);
}

function compute(): void {
  const req = request();
  if (state.defaults && isDefaultRequest(req)) { // back to the defaults: no solve
    state.pending = null;
    state.busy = false;
    setBusy(false);
    accept({ ...state.defaults, id: req.id });
    return;
  }
  if (state.busy) state.pending = req;
  else post(req);
}

function setBusy(on: boolean): void {
  const res = $("#result");
  res.classList.toggle("pf-busy", on && Boolean(state.result));
  res.setAttribute("aria-busy", String(on));
  $("#options").setAttribute("aria-busy", String(on));
  if (on) {
    $("#status").replaceChildren(el("p", { class: "pf-working" }, el("span", { class: "pf-spinner", "aria-hidden": "true" }),
      state.result ? "Recalculating with your settings… (a few seconds)" : "Working out every price… (a few seconds)"));
  }
}

/** One select per orb: cheapest, or a forced map. */
function buildOrbSelects(r: Result): void {
  const box = $("#orb-selects");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  const selects = r.orbs.filter((o) => isVisible("material", o.id)).map((o) => {
    const seen = new Set<string>();
    const orbName = itemName("material", o.id) ?? o.name;
    const s = el("select", { "aria-label": `${orbName} source` });
    s.append(el("option", { value: "" }, "Cheapest"));
    for (const row of r.essence.filter((x) => x.essence_id === o.id && visibleOrbRow(x))) {
      const key = `${row.map_id}@${row.map_asc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Options can't be outlined; an ascended map needs a word to tell it from the plain one.
      s.append(el("option", { value: key }, mapLabel(key)));
    }
    const chosen = state.orbChoice.get(o.id);
    if (chosen && [...s.options].some((x) => x.value === chosen)) s.value = chosen; // kept across a rebuild (U28)
    s.addEventListener("change", () => {
      if (s.value) state.orbChoice.set(o.id, s.value);
      else state.orbChoice.delete(o.id);
      compute();
    });
    return el("label", { class: "pf-field" }, el("span", {}, orbName), s);
  });
  box.replaceChildren(...selects);
}

// ---------------------------------------------------------------- filters
const ownedKey = (r: Row) => `${r.type ?? "equipment"}|${r.id}|${r.asc}`;

function withOwned(rows: Row[], type?: string): Row[] {
  if (!state.owned) return rows;
  return rows.map((r) => ({ ...r, owned: state.owned!.get(type ? `${type}|${r.id}|${r.asc}` : ownedKey(r)) ?? 0 }));
}

/** U28: an item (at its ascension) of an expansion the visitor hides is left out of every table. */
const visibleRow = (r: Row) => isVisible("item", Number(r.id), { type: String(r.type ?? "equipment") as "equipment", ascension: Number(r.asc) || 0 });

function itemFilter(rows: Row[], withType: boolean): Row[] {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const asc = orbsHidden() ? "all" : f.asc;
  return rows.filter((r) => visibleRow(r) && (!withType || !f.types.size || f.types.has(String(r.type)))
    && (r.level === null || (Number(r.level) >= f.min && Number(r.level) <= f.max))
    && (asc === "all" || String(r.asc) === asc)
    && (!f.ownedOnly || Number(r.owned) > 0)
    && (!q || `${r.name} ${itemName(String(r.type ?? "equipment"), Number(r.id)) ?? ""}`.toLowerCase().includes(q))); // U29: either name
}

/** Enchanting: a +1 suffix or a first prefix earns more than it costs. */
const gains = (r: Row) => Number(r.suffix_net) > 0 || Number(r.prefix_net) > 0;

function filterBar(opts: { types?: boolean; owned?: boolean; gains?: boolean; orbs?: Orb[] }): HTMLElement {
  const f = state.filters;
  const search = el("input", { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name", value: f.q, "data-focus-key": "q" }) as HTMLInputElement;
  let t = 0;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      f.q = search.value;
      renderPanel(true);
    }, 180) as unknown as number;
  });
  const kids: Node[] = [search];
  const change = (e: HTMLInputElement | HTMLSelectElement, set: () => void) => e.addEventListener("change", () => {
    set();
    renderPanel(true);
  });
  const chip = (label: string, on: boolean, set: (v: boolean) => void) => {
    const b = chipToggle(label, on, (v) => {
      set(v);
      renderPanel(true);
    });
    b.setAttribute("data-focus-key", `chip:${label}`); // QA R2 F3: a chip has no aria-label to find it again by
    return b;
  };
  if (opts.types) {
    for (const type of ["equipment", "consumable", "map"]) {
      if (type === "map" && orbsHidden()) continue;
      kids.push(chip(ITEM_TYPE_PLURALS[type], f.types.has(type), (v) => (v ? f.types.add(type) : f.types.delete(type))));
    }
  }
  if (opts.orbs) {
    const orb = el("select", { "aria-label": "Orb", "data-focus-key": "orb" }, el("option", { value: "all" }, "All orbs"),
      ...opts.orbs.map((o) => el("option", String(o.id) === f.orb ? { value: String(o.id), selected: "" } : { value: String(o.id) }, itemName("material", o.id) ?? o.name))) as HTMLSelectElement;
    change(orb, () => (f.orb = orb.value));
    kids.push(orb);
  } else {
    if (!orbsHidden()) {
      kids.push(segField("Ascension", segmented("pf-asc", "Ascension", [["all", "Any"], ["0", "0"], ["1", "1"], ["2", "2"]]
        .map(([value, label]) => ({ value, label })), f.asc, (v) => {
        f.asc = v;
        renderPanel(true);
      })));
    }
    const lvl = (v: number, label: string, set: (x: number) => void) => {
      const i = el("input", { type: "number", min: "1", max: String(MAX_LEVEL), value: String(v), "aria-label": label, inputmode: "numeric",
        "data-focus-key": `lvl:${label}` }) as HTMLInputElement;
      change(i, () => set(Math.max(1, Math.min(MAX_LEVEL, Number(i.value) || 1))));
      return i;
    };
    kids.push(el("span", { class: "pf-range" }, "Level ", lvl(f.min, "Lowest item level", (x) => (f.min = x)), " to ",
      lvl(f.max, "Highest item level", (x) => (f.max = x))));
  }
  if (opts.gains) kids.push(chip("Only gains", f.gainsOnly, (v) => (f.gainsOnly = v)));
  if (opts.owned && state.owned) kids.push(chip("Only what I own", f.ownedOnly, (v) => (f.ownedOnly = v)));
  return el("div", { class: "toolbar pf-filters" }, ...kids);
}

// ---------------------------------------------------------------- panels
function tableFor(tab: string, rows: Row[], cols: InfoColumn[]): HTMLElement {
  return rankedTable({
    rows, cols, sort: state.sort[tab], limit: state.limit[tab], costs: state.result?.costs, open: state.whyOpen,
    onSort: (s) => {
      state.sort[tab] = s;
      renderPanel(true);
    },
    onMore: () => {
      const shown = state.limit[tab];
      state.limit[tab] += MORE_STEP;
      renderPanel(true, shown);
    },
  });
}

function itemsPanel(r: Result): HTMLElement[] {
  const rows = itemFilter(withOwned(r.items), true);
  return [filterBar({ types: true, owned: true }), tableFor("Items", rows, itemColumnsCached())];
}

/** No orbs: every row is ascension 0, so no Asc column (R3 F16). */
const withoutAsc = (cols: InfoColumn[]): InfoColumn[] => (orbsHidden() ? cols.filter((c) => c.key !== "asc") : cols);

let colsCache: { owned: boolean; noAsc: boolean; cols: InfoColumn[] } | null = null;
function itemColumnsCached(): InfoColumn[] {
  const o = Boolean(state.owned), noAsc = orbsHidden();
  if (!colsCache || colsCache.owned !== o || colsCache.noAsc !== noAsc) colsCache = { owned: o, noAsc, cols: withoutAsc(itemColumns(o)) };
  return colsCache.cols;
}

function enchantPanel(r: Result): HTMLElement[] {
  const rows = itemFilter(withOwned(r.enchant, "equipment"), false).filter((x) => !state.filters.gainsOnly || gains(x));
  const cols = withoutAsc(enchantColumns());
  if (state.owned) cols.push({ key: "owned", label: "You have", num: true, tip: "Copies in your save: inventory, shop and hero gear." });
  return [filterBar({ owned: true, gains: true }), tableFor("Enchanting", rows, cols)];
}

/** The region whose items an orb ascends (0-based band), in the visitor's language. */
const orbRegion = (band: number): string => {
  const reg = REGIONS[band];
  return reg ? regionName(reg.id, reg.full) : "?";
};

function orbsPanel(r: Result): HTMLElement[] {
  const best = (tier: number) => stickyPad(el("div", { class: "table-wrap pf-table" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Orb", "Region", "Cost per orb", "Cheapest map", "Orbs per run"]
      .map((h, i) => el("th", { scope: "col", class: i === 2 || i === 4 ? "num" : "" }, h)))),
    el("tbody", {}, ...r.orbs.filter((o) => o.tier === tier && isVisible("material", o.id)).map((o) => el("tr", {},
      el("td", {}, itemLink("material", o.id, o.name)),
      el("td", {}, orbRegion(o.region)),
      el("td", { class: "num" }, gold(o.cost, 1)),
      el("td", {}, o.mapId === null ? "—" : el("span", { class: "nowrap" }, itemLink("map", o.mapId, undefined, undefined, o.mapAsc),
        ...(o.label && o.label !== "as crafted" ? [el("span", { class: "muted small" }, ` · ${o.label}`)] : []))),
      el("td", { class: "num" }, o.perRun === null ? "—" : fmt1.format(o.perRun))))))));
  const f = state.filters;
  const rows = r.essence.filter(visibleOrbRow).filter((x) => f.orb === "all" || String(x.essence_id) === f.orb)
    .filter((x) => !f.q.trim() || `${x.map} ${x.essence} ${itemName("map", Number(x.map_id)) ?? ""} ${itemName("material", Number(x.essence_id)) ?? ""}`.toLowerCase().includes(f.q.trim().toLowerCase()));
  const tiers = [...new Set(r.orbs.map((o) => o.tier))].sort();
  return [
    ...tiers.flatMap((t) => [el("h3", { class: "pf-h3" }, `Orbs for ascension ${t}`), best(t)]),
    el("h3", { class: "pf-h3" }, "Every map that drops orbs"),
    filterBar({ orbs: r.orbs }), tableFor("Orbs", rows, essenceColumns()),
  ];
}

function summaryTiles(r: Result): HTMLElement {
  const items = r.items.filter(visibleRow);
  const top = items.reduce<Row | null>((a, b) => (a === null || Number(b.best_profit) > Number(a.best_profit) ? b : a), null);
  const topAsc0 = items.filter((x) => x.asc === 0).reduce<Row | null>((a, b) => (a === null || Number(b.best_profit) > Number(a.best_profit) ? b : a), null);
  // The item, outlined for its ascension (silver 1, gold 2).
  const mk = (x: Row | null): Node | string => (x ? itemLink(String(x.type ?? "equipment"), Number(x.id), String(x.name), x.rarity, x.asc) : "—");
  const tiles = el("div", { class: "tiles pf-tiles" },
    tile("Most profit", mk(top), top ? `${gold(Number(top.best_profit))} · ${STRATEGY[String(top.best_strategy)] ?? ""}` : undefined, { icon: "🏆", tone: "t-gold" }),
    ...(orbsHidden() ? [] : [tile("No orbs", mk(topAsc0), topAsc0 ? `${gold(Number(topAsc0.best_profit))}, no ascension` : undefined, { icon: "🔨", tone: "t-blue" })]));
  if (!baseGameOnly()) return tiles;
  return el("div", {}, tiles, el("p", { class: "muted small pf-base" }, "Base game only · add your expansions in 📜 Save ▾"));
}

/**
 * Rebuilds the open table's panel. `keepFocus`: the focused control is found again by a stable key (dom.ts focusKeyOf:
 * its data-focus-key, a radio's name and value), so a chip, the ascension radios (and their arrow keys), a sort header
 * and "Show more" keep the focus (QA R2 F3). `moreFrom`: "Show more" was used with that many rows shown; the focus goes
 * to the new "Show more" button, or to the first added row when none is left.
 */
function renderPanel(keepFocus = false, moreFrom?: number): void {
  const r = state.result;
  if (!r) return;
  const panel = $("#panel");
  if (!panel) return;
  // keep the caret in the search box across re-renders
  const active = document.activeElement as HTMLInputElement | null;
  const key = keepFocus && active && panel.contains(active) ? focusKeyOf(active) : null;
  const caret = key && active?.type === "search" ? active.selectionStart : null;
  const kids = state.tab === "Items" ? itemsPanel(r) : state.tab === "Enchanting" ? enchantPanel(r) : orbsPanel(r);
  panel.replaceChildren(...kids);
  if (moreFrom !== undefined) {
    const more = findFocusKey(panel, { key: "more" });
    const row = more ? null : addedRow(panel, moreFrom);
    if (row) row.tabIndex = -1; // a row is focusable only by script
    (more ?? row)?.focus();
    return;
  }
  if (key) {
    const again = findFocusKey(panel, key) as HTMLInputElement | null;
    again?.focus();
    if (again && caret !== null && again.type === "search") again.setSelectionRange(caret, caret);
  }
}

/** The ranked table's row number `n` (0-based), cost-breakdown rows left out. */
function addedRow(panel: HTMLElement, n: number): HTMLElement | null {
  const tbodies = panel.querySelectorAll<HTMLElement>(".pf-table tbody");
  const tbody = tbodies[tbodies.length - 1]; // Orbs: the ranked table is the last one, after the per-tier tables
  if (!tbody) return null;
  return [...tbody.children].filter((tr) => !tr.classList.contains("pf-why-row"))[n] as HTMLElement | undefined ?? null;
}

function render(): void {
  const r = state.result!;
  const tabs = profitTabs(orbsHidden());
  if (!tabs.includes(state.tab)) state.tab = "Items";
  const tabList = el("div", { role: "tablist", class: "tabs", "aria-label": "Result tables" });
  const panel = el("div", { role: "tabpanel", class: "panel", id: "panel", "aria-labelledby": `pf-tab-${state.tab}` });
  const select = (name: ProfitTab) => {
    state.tab = name;
    tabList.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", `pf-tab-${name}`);
    renderPanel();
  };
  for (const name of tabs) {
    const on = name === state.tab;
    const b = el("button", { role: "tab", type: "button", id: `pf-tab-${name}`, "aria-selected": String(on), "aria-controls": "panel",
      tabindex: on ? "0" : "-1", "data-tab": name }, TAB_LABELS[name]);
    b.addEventListener("click", () => select(name));
    tabList.append(b);
  }
  // The arrow keys, Home and End move between the tables (the tablist pattern, dom.ts tabKeys).
  tabKeys(tabList);
  $("#result").replaceChildren(summaryTiles(r), tabList, panel);
  renderPanel();
}

// ---------------------------------------------------------------- save (optional)
async function loadSave(text: string): Promise<void> {
  let sv;
  try {
    sv = loadSaveText(text);
  } catch {
    throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
  }
  if (!sv.raw || !Array.isArray(sv.raw.hero)) throw new Error("this file has no heroes. Is it a PlayerData / SlotNData save?");
  state.owned = owned(sv);
  renderPanel();
}

/** Run grade, who pays and map modifiers: segmented controls and a chip in the form. */
function buildSettings(changed: () => void): void {
  const s = state.settings;
  $("#grade-seg").replaceChildren(segmented("pf-grade", "Run grade", ["D", "C", "B", "A", "S"].map((l, i) => ({ value: String(i + 1), label: l })),
    s.grade, (v) => (s.grade = v)));
  const alloc = segmented("pf-alloc", "Who pays for a run", [
    { value: "value", label: "Shared" },
    { value: "full", label: "Full" },
  ], s.alloc, (v) => (s.alloc = v as "value" | "full"));
  const allocHelp = ["A run's cost is split between everything it drops, by sell value.",
    "Every drop carries the whole run cost: \"I farm this only for that\". Pessimistic."];
  alloc.querySelectorAll<HTMLElement>(".seg-opt").forEach((o, i) => tip(o, () => allocHelp[i]));
  $("#alloc-seg").replaceChildren(alloc);
  const mods = chipToggle("Count map modifiers", s.mapMods, (v) => {
    s.mapMods = v;
    changed();
  });
  tip(mods, () => "Crafted maps roll modifiers that raise their orb yield (about +26%). Off: plain maps only.");
  $("#mapmods-box").replaceChildren(mods);
  document.querySelectorAll<HTMLElement>("#options [data-tip]").forEach((e) => helpOn(e, e.dataset.tip!));
}

/** Scribe hidden: no orb sources, map-modifier chip or orb note. */
function showOrbControls(): void {
  const hide = orbsHidden();
  for (const id of ["#orb-sources", "#mapmods-box", "#orb-note"]) {
    const e = $(id);
    if (e) e.hidden = hide;
  }
}

function init(): void {
  const form = $<HTMLFormElement>("#options");
  let t = 0;
  const changed = () => {
    clearTimeout(t);
    t = setTimeout(compute, 250) as unknown as number;
  };
  form.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).closest("#orb-selects")) return; // handled by the orb selects
    changed();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  buildSettings(changed);
  showOrbControls();
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#save-status"), load: (text) => loadSave(text),
    heroOverlay: false, // U78: "You have" counts the save's real gear, not the gear of heroes edited on the site
    onForget: () => {
      state.owned = null;
      state.filters.ownedOnly = false;
      renderPanel();
    },
  });
  loadWikiText();
  // U28: the tables, tiles and orb choices follow the expansion switches; U29: and the language (state is kept).
  const redraw = () => {
    showOrbControls();
    if (!state.result) return;
    delete $("#orb-selects").dataset.built;
    buildOrbSelects(state.result);
    render();
  };
  subscribe(redraw);
  onLanguageChange(redraw);
  // item names and tooltips need the game data in the page too (the worker loads its own copy)
  Promise.all([loadData(), languageReady]).then(firstView).catch((e) => $("#status").replaceChildren(el("p", { class: "error", role: "alert" }, String(e))));
}

if (typeof document !== "undefined") init();
