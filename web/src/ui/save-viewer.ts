/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
import * as api from "../sim/api.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import {
  crafterRows, gearRows, HERO_STATS, type HeroView, heroViews, inventoryRows, mapRows, type Row, summary, toCsv,
} from "./save-tables.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

// ---------------------------------------------------------------- tables
interface Column {
  key: string;
  label: string;
  num?: boolean;
}

/** A sortable table; click a header to sort. */
function table(rows: Row[], cols: Column[], rowClass?: (r: Row) => string): HTMLElement {
  let sortKey = "";
  let asc = true;
  const tbody = el("tbody");
  const render = () => {
    const sorted = sortKey ? [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      return asc ? c : -c;
    }) : rows;
    tbody.replaceChildren(...sorted.map((r) => {
      const tr = el("tr", rowClass ? { class: rowClass(r) } : {});
      for (const c of cols) {
        const v = r[c.key];
        tr.append(el("td", c.num ? { class: "num" } : {}, v === null || v === undefined ? "" : c.num && typeof v === "number" ? fmt.format(v) : String(v)));
      }
      return tr;
    }));
  };
  const head = el("tr", {}, ...cols.map((c) => {
    const th = el("th", { scope: "col", class: c.num ? "num" : "" }, el("button", { type: "button" }, c.label));
    th.querySelector("button")!.addEventListener("click", () => {
      asc = sortKey === c.key ? !asc : !c.num;
      sortKey = c.key;
      head.querySelectorAll("th").forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      render();
    });
    return th;
  }));
  render();
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), tbody));
}

function csvButton(name: string, rows: () => Row[]): HTMLElement {
  const b = el("button", { type: "button", class: "secondary" }, "Download CSV");
  b.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows())], { type: "text/csv" }));
    const a = el("a", { href: url, download: `${name}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return b;
}

function toolbar(...kids: Node[]): HTMLElement {
  return el("div", { class: "toolbar" }, ...kids);
}

// ---------------------------------------------------------------- sections
function renderSummary(sv: Save): HTMLElement {
  const s = summary(sv);
  const tile = (label: string, value: string) => el("div", { class: "tile" }, el("span", { class: "tile-label" }, label), el("span", { class: "tile-value" }, value));
  return el("div", { class: "tiles" },
    tile("Gold", fmt.format(s.gold)),
    tile("Inventory value", `${fmt.format(s.inventoryValue)} g`),
    tile("Gold earned", fmt.format(s.totalGoldEarned)),
    tile("Items crafted", fmt.format(s.totalCrafted)),
    tile("Sales", fmt.format(s.totalSales)),
    tile("Heroes", String(s.heroes)),
    tile("Maps", `${s.maps} / ${s.mapSlots}`),
    tile("Mode", `${s.mode} · v${s.version}`),
  );
}

const STAT_LABELS: Record<string, string> = {
  maxHP: "HP", atk: "Atk", matk: "Matk", acc: "Acc", crit: "Crit", critMod: "Crit ×", def: "Def", mdef: "Mdef",
  eva: "Eva", speed: "Speed", maxActionPoints: "AP",
};

function heroCard(v: HeroView): HTMLElement {
  const r = v.row;
  const stats = v.stats
    ? el("dl", { class: "stats" }, ...HERO_STATS.filter((k) => k !== "speed" || v.stats![k]).flatMap((k) => {
      const x = v.stats![k];
      return [el("dt", {}, STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? x.toFixed(2) : fmt.format(x))];
    }))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  const gear = el("ul", { class: "gear" }, ...v.gear.map((g) =>
    el("li", {}, el("span", { class: "muted" }, String(g.slot)), " ", String(g.name),
      el("span", { class: "muted" }, ` · ${g.grade}${g.asc ? ` · asc ${g.asc}` : ""}`))));
  return el("article", { class: "card hero" },
    el("header", {}, el("h3", {}, String(r.name)),
      el("p", { class: "muted" }, `${r.class} · level ${r.level} · asc ${r.asc} · ${r.status}`)),
    stats,
    el("p", { class: "rotation" }, el("strong", {}, "Rotation "), String(r.rotation)),
    el("p", { class: "rotation" }, el("strong", {}, "Passive "), String(r.passive || "none")),
    gear,
    el("p", { class: "muted small" }, `${fmt.format(Number(r.quests))} quests · ${r.deaths} deaths`),
  );
}

function renderHeroes(views: HeroView[]): HTMLElement {
  return el("div", {},
    toolbar(el("p", { class: "muted small" }, "Combat stats are computed with the game's rules from your gear, level, passive and enchants."),
      csvButton("heroes", () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) }))),
      csvButton("hero_gear", () => gearRows(views))),
    el("div", { class: "cards" }, ...views.map(heroCard)));
}

const ITEM_COLS: Column[] = [
  { key: "name", label: "Item" }, { key: "subtype", label: "Type" }, { key: "item_level", label: "Lvl", num: true },
  { key: "asc", label: "Asc", num: true }, { key: "grade", label: "Grade" }, { key: "amount", label: "Qty", num: true },
  { key: "unit_sell", label: "Unit value", num: true }, { key: "total_sell", label: "Total value", num: true },
];

function renderInventory(sv: Save): HTMLElement {
  const all = inventoryRows(sv);
  const search = el("input", { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name" }) as HTMLInputElement;
  const kind = el("select", { "aria-label": "Item kind" },
    ...["all", "equipment", "consumable", "material", "map", "counter"].map((k) => el("option", { value: k }, k === "counter" ? "on the counter" : k))) as HTMLSelectElement;
  const holder = el("div");
  const filtered = () => {
    const q = search.value.trim().toLowerCase();
    return all.filter((r) => (kind.value === "all" || (kind.value === "counter" ? r.where === "counter" : r.type === kind.value && r.where !== "counter"))
      && (!q || String(r.name).toLowerCase().includes(q)));
  };
  const total = el("span", { class: "muted small" });
  const update = () => {
    const rows = filtered();
    total.textContent = `${rows.length} stacks · ${fmt.format(rows.reduce((s, r) => s + (Number(r.total_sell) || 0), 0))} g base value`;
    holder.replaceChildren(table(rows, ITEM_COLS, (r) => (r.where === "counter" ? "counter" : "")));
  };
  search.addEventListener("input", update);
  kind.addEventListener("change", update);
  update();
  return el("div", {}, toolbar(search, kind, total, csvButton("inventory", filtered)), holder,
    el("p", { class: "muted small" }, "Value = base customer price before haggling, preferences and counter bonuses."));
}

function renderMaps(sv: Save): HTMLElement {
  const rows = mapRows(sv);
  if (!rows.length) return el("p", { class: "muted" }, "No maps in this save.");
  return el("div", {}, toolbar(csvButton("maps", () => rows)), table(rows, [
    { key: "name", label: "Map" }, { key: "item_level", label: "Lvl", num: true }, { key: "asc", label: "Asc", num: true },
    { key: "grade", label: "Grade" }, { key: "enemies", label: "Enemies", num: true }, { key: "base_time_min", label: "Minutes", num: true },
    { key: "boss", label: "Boss" }, { key: "unit_sell", label: "Value", num: true }, { key: "enchant_attempts", label: "Enchant attempts" },
  ]));
}

function renderCrafters(sv: Save): HTMLElement {
  const rows = crafterRows(sv);
  return el("div", {}, toolbar(csvButton("crafters", () => rows)), table(rows, [
    { key: "crafter", label: "Crafter" }, { key: "level", label: "Level", num: true }, { key: "asc", label: "Asc", num: true },
    { key: "prestige_level", label: "Prestige level", num: true }, { key: "crafting", label: "Working on" },
  ]));
}

// ---------------------------------------------------------------- page
const TABS = ["Heroes", "Inventory", "Maps", "Crafters"] as const;

function render(sv: Save, fileName: string): void {
  const views = heroViews(sv);
  const panels: Record<string, () => HTMLElement> = {
    Heroes: () => renderHeroes(views), Inventory: () => renderInventory(sv), Maps: () => renderMaps(sv), Crafters: () => renderCrafters(sv),
  };
  const tabList = el("div", { role: "tablist", class: "tabs", "aria-label": "Save sections" });
  const panel = el("div", { role: "tabpanel", class: "panel" });
  const select = (name: string) => {
    tabList.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.textContent === name)));
    panel.replaceChildren(panels[name]());
  };
  for (const name of TABS) {
    const b = el("button", { role: "tab", type: "button", "aria-selected": "false" }, name);
    b.addEventListener("click", () => select(name));
    tabList.append(b);
  }
  $("#result").replaceChildren(
    el("p", { class: "muted small" }, `Loaded ${fileName}`),
    renderSummary(sv), tabList, panel);
  select("Heroes");
}

function showError(msg: string): void {
  $("#result").replaceChildren(el("p", { class: "error", role: "alert" }, msg));
}

async function openFile(file: File): Promise<void> {
  $("#result").replaceChildren(el("p", { class: "muted" }, "Reading…"));
  try {
    await loadData();
    let sv: Save;
    try {
      sv = loadSaveText(await file.text());
    } catch {
      throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
    }
    if (!sv.raw || !Array.isArray(sv.raw.hero)) throw new Error("this file has no heroes. Is it a PlayerData / SlotNData save?");
    render(sv, file.name);
  } catch (e) {
    showError(`Could not read ${file.name}: ${e instanceof Error ? e.message : e}`);
  }
}

function init(): void {
  const input = $<HTMLInputElement>("#file");
  input.addEventListener("change", () => input.files?.[0] && openFile(input.files[0]));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });
  loadData().catch((e) => showError(String(e)));
}

init();
