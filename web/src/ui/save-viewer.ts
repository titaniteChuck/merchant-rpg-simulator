/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
import * as api from "../sim/api.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, type Column, el, fmt, gradeBadge, itemName, pill, type Row as Cells, table, tile } from "./dom.ts";
import { bindSaveInput } from "./save-file.ts";
import {
  crafterRows, gearRows, type HeroView, heroViews, inventoryRows, mapRows, type Row, summary, toCsv,
} from "./save-tables.ts";

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

function csvButton(name: string, rows: () => Row[], label = name): HTMLElement {
  const b = el("button", { type: "button", class: "secondary" }, `${label[0].toUpperCase()}${label.slice(1)} CSV`);
  b.title = `Download ${name}.csv`;
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

/** Item name coloured by rarity, then grade and ascension badges. */
const itemCell = (r: Cells) => el("span", { class: "nowrap" }, itemName(String(r.name), r.rarity));
const gradeCell = (r: Cells) => (r.grade ? gradeBadge(String(r.grade)) : "");

// ---------------------------------------------------------------- sections
function renderSummary(sv: Save): HTMLElement {
  const s = summary(sv);
  return el("div", { class: "tiles" },
    tile("Gold", fmt.format(s.gold), undefined, { icon: "🪙", tone: "t-gold" }),
    tile("Inventory value", `${fmt.format(s.inventoryValue)} g`, "base sell value", { icon: "💰", tone: "t-orange" }),
    tile("Gold earned", fmt.format(s.totalGoldEarned), undefined, { icon: "📈", tone: "t-green" }),
    tile("Items crafted", fmt.format(s.totalCrafted), undefined, { icon: "🔨", tone: "t-blue" }),
    tile("Sales", fmt.format(s.totalSales), undefined, { icon: "🛒", tone: "t-teal" }),
    tile("Heroes", String(s.heroes), undefined, { icon: "🛡️", tone: "t-violet" }),
    tile("Maps", `${s.maps} / ${s.mapSlots}`, "owned / slots", { icon: "🗺️", tone: "t-pink" }),
    tile("Mode", String(s.mode), `game v${s.version}`, { icon: "⚙️", tone: "t-slate" }),
  );
}

const STAT_LABELS: Record<string, string> = {
  maxHP: "HP", atk: "Atk", matk: "Matk", acc: "Acc", crit: "Crit", critMod: "Crit ×", def: "Def", mdef: "Mdef",
  eva: "Eva", speed: "Speed", maxActionPoints: "AP",
};
const STAT_ORDER = ["maxHP", "atk", "matk", "def", "mdef", "acc", "crit", "critMod", "maxActionPoints", "eva", "speed"];
const SLOT_ICONS: Record<string, string> = { weapon: "⚔️", head: "🪖", body: "🥋", hands: "🧤", feet: "👢", trinket: "💍" };
const STATUS_TONE: Record<string, string> = { idle: "t-green", "on a map": "t-violet", "on a quest": "t-blue" };

function heroCard(v: HeroView): HTMLElement {
  const r = v.row;
  const name = String(r.name);
  const stats = v.stats
    ? el("dl", { class: "stats" }, ...STAT_ORDER.filter((k) => k in v.stats! && (k !== "speed" || v.stats![k]) && (k !== "eva" || v.stats![k]))
      .map((k) => {
        const x = v.stats![k];
        return el("div", { class: k === "maxHP" ? "hp" : "" }, el("dt", {}, STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? `${x.toFixed(2)}×` : fmt.format(x)));
      }))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  const rotation = el("div", { class: "chips" }, ...v.rotation.map((sk) => pill(sk, sk === "Basic" ? "skill basic" : "skill")));
  const gear = el("ul", { class: "gear" }, ...v.gear.map((g) =>
    el("li", { class: `rar-${typeof g.rarity === "number" ? g.rarity : 1}`, title: `${g.slot}${g.item_level ? ` · item level ${g.item_level}` : ""}` },
      el("span", { class: "slot-ico", "aria-label": String(g.slot) }, SLOT_ICONS[String(g.slot)] ?? "•"),
      itemName(String(g.name), g.rarity),
      el("span", { class: "meta" }, gradeBadge(String(g.grade)), ...(g.asc ? [pill(`asc ${g.asc}`, "plain")] : [])))));
  return el("article", { class: `card hero cls-${v.cls}` },
    el("header", { class: "hero-head" },
      el("span", { class: "avatar", "aria-hidden": "true" }, name.slice(0, 1).toUpperCase()),
      el("div", {}, el("h3", {}, name),
        el("div", { class: "sub" }, pill(String(r.class)), pill(`lv ${r.level}`, "plain"), pill(`asc ${r.asc}`, "plain"),
          pill(String(r.status), STATUS_TONE[String(r.status)] ?? "t-slate")))),
    stats,
    el("div", {}, el("p", { class: "section-label" }, "Rotation"), rotation),
    el("div", {}, el("p", { class: "section-label" }, "Passive"), el("div", { class: "chips" }, pill(String(r.passive || "none"), "t-gold"))),
    gear,
    el("div", { class: "hero-foot" }, el("span", {}, `⚔️ ${fmt.format(Number(r.quests))} quests`), el("span", {}, `💀 ${r.deaths} deaths`)),
  );
}

function renderHeroes(views: HeroView[]): HTMLElement {
  return el("div", {},
    toolbar(el("p", { class: "muted small" }, "Combat stats are computed with the game's rules from your gear, level, passive and enchants."),
      csvButton("heroes", () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) }))),
      csvButton("hero_gear", () => gearRows(views), "gear")),
    el("div", { class: "cards" }, ...views.map(heroCard)));
}

const ITEM_COLS: Column[] = [
  { key: "name", label: "Item", render: itemCell }, { key: "subtype", label: "Type" }, { key: "item_level", label: "Lvl", num: true },
  { key: "asc", label: "Asc", num: true }, { key: "grade", label: "Grade", render: gradeCell }, { key: "amount", label: "Qty", num: true },
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
    { key: "name", label: "Map", render: itemCell }, { key: "item_level", label: "Lvl", num: true }, { key: "asc", label: "Asc", num: true },
    { key: "grade", label: "Grade", render: gradeCell }, { key: "enemies", label: "Enemies", num: true }, { key: "base_time_min", label: "Minutes", num: true },
    { key: "boss", label: "Boss" }, { key: "unit_sell", label: "Value", num: true }, { key: "enchant_attempts", label: "Enchant attempts" },
  ]));
}

function renderCrafters(sv: Save): HTMLElement {
  const rows = crafterRows(sv);
  return el("div", {}, toolbar(csvButton("crafters", () => rows)), table(rows, [
    { key: "crafter", label: "Crafter", render: (r) => el("strong", {}, String(r.crafter)) }, { key: "level", label: "Level", num: true }, { key: "asc", label: "Asc", num: true },
    { key: "prestige_level", label: "Prestige level", num: true },
    { key: "crafting", label: "Working on", render: (r) => (r.crafting ? pill(`🔨 ${r.crafting}`, "t-blue") : el("span", { class: "muted" }, "idle")) },
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
  bindSaveInput({ input: $<HTMLInputElement>("#file"), drop: $("#drop"), onFile: openFile, onError: showError });
  loadData().catch((e) => showError(String(e)));
}

init();
