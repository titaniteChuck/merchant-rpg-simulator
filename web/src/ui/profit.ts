/**
 * Profit page (site/profit.html): what to make and sell, when enchanting pays, where orbs are cheapest.
 * The economy is solved by profitReport (web/src/tools/profit.ts) in a web worker (profit-worker.ts);
 * the page only filters and sorts the tables it sends back. An opened save marks the items the player owns.
 */
import * as api from "../sim/api.ts";
import { loadSaveText, owned } from "../tools/save.ts";
import { $, el, fmt, fmt1, tile } from "./dom.ts";
import type { Orb, ProfitRequest, ProfitResponse, Row } from "./profit-worker.ts";
import { enchantColumns, essenceColumns, type InfoColumn, itemColumns, rankedTable, type SortState, STRATEGY } from "./profit-tables.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText } from "./wiki-data.ts";
import { isVisible, subscribe } from "./expansion-state.ts";

/** U28: an orb source on a map (or an orb) of an expansion the visitor hides is left out. */
const visibleOrbRow = (x: Row) => isVisible("map", Number(x.map_id), { ascension: Number(x.map_asc) || 0 }) && isVisible("material", Number(x.essence_id));

type Result = Extract<ProfitResponse, { ok: true }>;

const PAGE = 100; // rows shown before "Show all"

interface Filters {
  q: string;
  type: string;
  min: number;
  max: number;
  asc: string;
  ownedOnly: boolean;
  orb: string;
}

const state = {
  result: null as Result | null,
  owned: null as Map<string, number> | null,
  worker: null as Worker | null,
  busy: false,
  lastId: 0,
  pending: null as ProfitRequest | null,
  tab: "Items" as (typeof TABS)[number],
  filters: { q: "", type: "all", min: 1, max: 70, asc: "all", ownedOnly: false, orb: "all" } as Filters,
  sort: { Items: { key: "best_profit", desc: true }, Enchanting: { key: "suffix_net", desc: true }, Orbs: { key: "cost_per_essence", desc: false } } as Record<string, SortState>,
  limit: { Items: PAGE, Enchanting: PAGE, Orbs: PAGE } as Record<string, number>,
  orbChoice: new Map<number, string>(), // essence id -> "mapId@asc"
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
  const alloc = (document.querySelector<HTMLInputElement>('input[name="alloc"]:checked')?.value ?? "value") as "value" | "full";
  const essenceFrom: [number, number, number][] = [];
  for (const [eid, v] of state.orbChoice) {
    const [m, p] = v.split("@").map(Number);
    essenceFrom.push([eid, m, p]);
  }
  return {
    id: ++state.lastId, grade: num("#grade", 1, 5, 3), luck: num("#luck", 0, 1000, 0), crafterLevel: num("#crafter", 1, 60, 60),
    enchanterLevel: num("#enchanter", 0, 60, 60), mapMods: $<HTMLInputElement>("#mapmods").checked, alloc, essenceFrom,
  };
}

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
    if (!r.ok) {
      $("#status").replaceChildren(el("p", { class: "error", role: "alert" }, `The calculation failed: ${r.error}`));
      return;
    }
    state.result = r;
    const unpriced = /(\d+) items without/.exec(r.summary)?.[1];
    const status: Node[] = [el("p", { class: "muted small" }, `${fmt.format(r.items.length)} prices (each item at each ascension level)`
      + (unpriced ? `; ${unpriced} items have no known source (events, weekly shop) and are left out` : "")
      + `. Worked out in ${fmt1.format(r.ms / 1000)} s.`)];
    // A forced map that needs its own orb to be made can't price it (the solver starts from "unknown").
    const stuck = r.orbs.filter((o) => state.orbChoice.has(o.id) && o.cost === null);
    if (stuck.length) {
      status.push(el("p", { class: "error", role: "alert" }, `${stuck.map((o) => o.name).join(", ")}: the map you picked needs that orb to be made, `
        + "so it can't be its only source. Items that need it are left out. Pick another map or go back to Cheapest."));
    }
    $("#status").replaceChildren(...status);
    buildOrbSelects(r);
    render();
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

function post(req: ProfitRequest): void {
  state.busy = true;
  setBusy(true);
  worker().postMessage(req);
}

function compute(): void {
  const req = request();
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
    const s = el("select", { "aria-label": `${o.name} source` });
    s.append(el("option", { value: "" }, "Cheapest"));
    for (const row of r.essence.filter((x) => x.essence_id === o.id && visibleOrbRow(x))) {
      const key = `${row.map_id}@${row.map_asc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Options can't be outlined; an ascended map needs a word to tell it from the plain one.
      s.append(el("option", { value: key }, `${row.map}${Number(row.map_asc) ? " · ascension 1" : ""}`));
    }
    const chosen = state.orbChoice.get(o.id);
    if (chosen && [...s.options].some((x) => x.value === chosen)) s.value = chosen; // kept across a rebuild (U28)
    s.addEventListener("change", () => {
      if (s.value) state.orbChoice.set(o.id, s.value);
      else state.orbChoice.delete(o.id);
      compute();
    });
    return el("label", { class: "pf-field" }, el("span", {}, o.name), s);
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
  return rows.filter((r) => visibleRow(r) && (!withType || f.type === "all" || r.type === f.type)
    && (r.level === null || (Number(r.level) >= f.min && Number(r.level) <= f.max))
    && (f.asc === "all" || String(r.asc) === f.asc)
    && (!f.ownedOnly || Number(r.owned) > 0)
    && (!q || String(r.name).toLowerCase().includes(q)));
}

function filterBar(opts: { types?: boolean; owned?: boolean; orbs?: Orb[] }): HTMLElement {
  const f = state.filters;
  const search = el("input", { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name", value: f.q }) as HTMLInputElement;
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
  if (opts.types) {
    const type = el("select", { "aria-label": "Item type" }, ...[["all", "All types"], ["equipment", "Equipment"], ["consumable", "Consumables"], ["map", "Maps"]]
      .map(([v, l]) => el("option", v === f.type ? { value: v, selected: "" } : { value: v }, l))) as HTMLSelectElement;
    change(type, () => (f.type = type.value));
    kids.push(type);
  }
  if (opts.orbs) {
    const orb = el("select", { "aria-label": "Orb" }, el("option", { value: "all" }, "All orbs"),
      ...opts.orbs.map((o) => el("option", String(o.id) === f.orb ? { value: String(o.id), selected: "" } : { value: String(o.id) }, o.name))) as HTMLSelectElement;
    change(orb, () => (f.orb = orb.value));
    kids.push(orb);
  } else {
    const asc = el("select", { "aria-label": "Ascension" }, ...[["all", "Any ascension"], ["0", "No ascension"], ["1", "Ascension 1"], ["2", "Ascension 2"]]
      .map(([v, l]) => el("option", v === f.asc ? { value: v, selected: "" } : { value: v }, l))) as HTMLSelectElement;
    change(asc, () => (f.asc = asc.value));
    const lvl = (v: number, label: string, set: (x: number) => void) => {
      const i = el("input", { type: "number", min: "1", max: "70", value: String(v), "aria-label": label, inputmode: "numeric" }) as HTMLInputElement;
      change(i, () => set(Math.max(1, Math.min(70, Number(i.value) || 1))));
      return i;
    };
    kids.push(asc, el("span", { class: "pf-range" }, "Level ", lvl(f.min, "Lowest item level", (x) => (f.min = x)), " to ",
      lvl(f.max, "Highest item level", (x) => (f.max = x))));
  }
  if (opts.owned && state.owned) {
    const own = el("input", { type: "checkbox", ...(f.ownedOnly ? { checked: "" } : {}) }) as HTMLInputElement;
    change(own, () => (f.ownedOnly = own.checked));
    kids.push(el("label", { class: "check" }, own, " Only what I own"));
  }
  return el("div", { class: "toolbar pf-filters" }, ...kids);
}

// ---------------------------------------------------------------- panels
function tableFor(tab: string, rows: Row[], cols: InfoColumn[]): HTMLElement {
  return rankedTable({
    rows, cols, sort: state.sort[tab], limit: state.limit[tab],
    onSort: (s) => {
      state.sort[tab] = s;
      renderPanel(true);
    },
    onShowAll: () => {
      state.limit[tab] = Infinity;
      renderPanel(true);
    },
  });
}

function countLine(n: number, what: string): HTMLElement {
  return el("p", { class: "muted small pf-count" }, `${fmt.format(n)} ${what}`);
}

function itemsPanel(r: Result): HTMLElement[] {
  const rows = itemFilter(withOwned(r.items), true);
  return [filterBar({ types: true, owned: true }), countLine(rows.length, "items and ascension levels"),
    tableFor("Items", rows, itemColumnsCached()),
    el("p", { class: "muted small" }, "Profit is per item, for the best plan. Items without a known source (event and weekly-shop items) are not listed.")];
}

let colsCache: { owned: boolean; cols: InfoColumn[] } | null = null;
function itemColumnsCached(): InfoColumn[] {
  const o = Boolean(state.owned);
  if (!colsCache || colsCache.owned !== o) colsCache = { owned: o, cols: itemColumns(o) };
  return colsCache.cols;
}

function enchantPanel(r: Result): HTMLElement[] {
  const rows = itemFilter(withOwned(r.enchant, "equipment"), false);
  const cols = enchantColumns();
  if (state.owned) cols.push({ key: "owned", label: "You have", num: true, tip: "Copies in your save: inventory, shop and hero gear." });
  return [
    el("p", { class: "muted small" }, "Adding one modifier to a piece of equipment you already have. A +1 suffix is the cheap one; a first prefix gets hard on high-level gear."),
    filterBar({ owned: true }), countLine(rows.length, "pieces of equipment and ascension levels"), tableFor("Enchanting", rows, cols),
  ];
}

const REGION = ["1–10", "11–20", "21–30", "31–40", "41–50", "51–60"];

function orbsPanel(r: Result): HTMLElement[] {
  const best = (tier: number) => el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Orb", "Ascends items of level", "Cost per orb", "Cheapest map", "Orbs per run"]
      .map((h, i) => el("th", { scope: "col", class: i === 2 || i === 4 ? "num" : "" }, h)))),
    el("tbody", {}, ...r.orbs.filter((o) => o.tier === tier && isVisible("material", o.id)).map((o) => el("tr", {},
      el("td", {}, itemLink("material", o.id, o.name)),
      el("td", {}, REGION[o.region] ?? "?"),
      el("td", { class: "num" }, o.cost === null ? "—" : `${fmt1.format(o.cost)} g`),
      el("td", {}, o.mapId === null ? "—" : el("span", { class: "nowrap" }, itemLink("map", o.mapId, undefined, undefined, o.mapAsc),
        ...(o.label && o.label !== "as crafted" ? [el("span", { class: "muted small" }, ` · ${o.label}`)] : []))),
      el("td", { class: "num" }, o.perRun === null ? "—" : fmt1.format(o.perRun)))))));
  const f = state.filters;
  const rows = r.essence.filter(visibleOrbRow).filter((x) => f.orb === "all" || String(x.essence_id) === f.orb)
    .filter((x) => !f.q.trim() || `${x.map} ${x.essence}`.toLowerCase().includes(f.q.trim().toLowerCase()));
  const tiers = [...new Set(r.orbs.map((o) => o.tier))].sort();
  return [
    el("p", { class: "muted small" }, "Ascending an item uses orbs (essence) matching its level. Map runs drop them: plain maps drop the ascension-1 orbs, ascended maps (silver outline) the ascension-2 orbs. An orb is worth what it costs to farm, not its few gold of sell price."),
    ...tiers.flatMap((t) => [el("h3", { class: "pf-h3" }, `Orbs for ascension ${t}`), best(t)]),
    el("h3", { class: "pf-h3" }, "Every map that drops orbs"),
    filterBar({ orbs: r.orbs }), countLine(rows.length, "map and orb pairs"), tableFor("Orbs", rows, essenceColumns()),
  ];
}

const TABS = ["Items", "Enchanting", "Orbs"] as const;
const TAB_LABELS: Record<string, string> = { Items: "💰 What to make", Enchanting: "✨ Enchanting", Orbs: "🔮 Orb sources" };

function summaryTiles(r: Result): HTMLElement {
  const items = r.items.filter(visibleRow);
  const top = items.reduce<Row | null>((a, b) => (a === null || Number(b.best_profit) > Number(a.best_profit) ? b : a), null);
  const topAsc0 = items.filter((x) => x.asc === 0).reduce<Row | null>((a, b) => (a === null || Number(b.best_profit) > Number(a.best_profit) ? b : a), null);
  // The item, outlined for its ascension (silver 1, gold 2).
  const mk = (x: Row | null): Node | string => (x ? itemLink(String(x.type ?? "equipment"), Number(x.id), String(x.name), x.rarity, x.asc) : "—");
  return el("div", { class: "tiles" },
    tile("Most profit", mk(top), top ? `${fmt.format(Number(top.best_profit))} g · ${STRATEGY[String(top.best_strategy)] ?? ""}` : undefined, { icon: "🏆", tone: "t-gold" }),
    tile("Most profit, no orbs", mk(topAsc0), topAsc0 ? `${fmt.format(Number(topAsc0.best_profit))} g, no ascension` : undefined, { icon: "🔨", tone: "t-blue" }),
    tile("Items priced", fmt.format(items.length), "item × ascension level", { icon: "📦", tone: "t-teal" }),
    tile("Cheapest orb", r.orbs.length ? `${fmt1.format(Math.min(...r.orbs.map((o) => o.cost ?? Infinity)))} g` : "—",
      r.orbs.length ? r.orbs.reduce((a, b) => ((b.cost ?? Infinity) < (a.cost ?? Infinity) ? b : a)).name : undefined, { icon: "🔮", tone: "t-violet" }));
}

function renderPanel(keepFocus = false): void {
  const r = state.result;
  if (!r) return;
  const panel = $("#panel");
  if (!panel) return;
  // keep the caret in the search box across re-renders
  const active = document.activeElement as HTMLInputElement | null;
  const focusLabel = keepFocus && active && panel.contains(active) ? active.getAttribute("aria-label") : null;
  const caret = focusLabel && active?.type === "search" ? active.selectionStart : null;
  const kids = state.tab === "Items" ? itemsPanel(r) : state.tab === "Enchanting" ? enchantPanel(r) : orbsPanel(r);
  panel.replaceChildren(...kids);
  if (focusLabel) {
    const again = panel.querySelector<HTMLInputElement>(`[aria-label="${focusLabel}"]`);
    again?.focus();
    if (again && caret !== null && again.type === "search") again.setSelectionRange(caret, caret);
  }
}

function render(): void {
  const r = state.result!;
  const tabList = el("div", { role: "tablist", class: "tabs", "aria-label": "Result tables" });
  const select = (name: (typeof TABS)[number]) => {
    state.tab = name;
    tabList.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    renderPanel();
  };
  for (const name of TABS) {
    const b = el("button", { role: "tab", type: "button", "aria-selected": String(name === state.tab), "data-tab": name }, TAB_LABELS[name]);
    b.addEventListener("click", () => select(name));
    tabList.append(b);
  }
  $("#result").replaceChildren(summaryTiles(r), tabList, el("div", { role: "tabpanel", class: "panel", id: "panel" }));
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
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#save-status"), load: (text) => loadSave(text),
    onForget: () => {
      state.owned = null;
      state.filters.ownedOnly = false;
      renderPanel();
    },
  });
  loadWikiText();
  // U28: the tables, tiles and orb choices follow the expansion switches.
  subscribe(() => {
    if (!state.result) return;
    delete $("#orb-selects").dataset.built;
    buildOrbSelects(state.result);
    render();
  });
  // item names and tooltips need the game data in the page too (the worker loads its own copy)
  loadData().then(compute).catch((e) => $("#status").replaceChildren(el("p", { class: "error", role: "alert" }, String(e))));
}

init();
