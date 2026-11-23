/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
import * as api from "../sim/api.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, ascLegend, ascSwatch, type Column, el, fmt, gradeBadge, heroAsc, pill, type Row as Cells, table, tile, withAsc } from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText, passiveLink, skillAp, skillDesc, skillLink } from "./wiki-data.ts";
import {
  crafterRows, gearRows, type HeroView, heroViews, inventoryRows, itemLabel, mapRows, type Row, summary, toCsv,
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

/** Item name coloured by rarity, linked to its wiki page (summary on hover). */
const itemCell = (r: Cells) => el("span", { class: "nowrap" }, itemLink(String(r.type), Number(r.id), String(r.name), r.rarity, r.asc));
/** The sortable "Asc" column: an outlined swatch, sorted by the number. */
const ascCol: Column = { key: "asc", label: "Asc", num: true, render: (r) => ascSwatch(r.asc) };
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
/** Radar axes (combat stats on a comparable scale); the rest is listed under the chart. */
const RADAR_STATS = ["maxHP", "atk", "matk", "def", "mdef", "acc", "crit"];
const EXTRA_STATS = ["critMod", "maxActionPoints", "eva", "speed"];

/** Strongest value of each radar stat among the save's heroes, and who holds it. */
type Best = Record<string, { max: number; who: string }>;
function bestOf(views: HeroView[]): Best {
  const best: Best = {};
  for (const k of RADAR_STATS) {
    best[k] = { max: 0, who: "" };
    for (const v of views) if (v.stats && v.stats[k] > best[k].max) best[k] = { max: v.stats[k], who: String(v.row.name) };
  }
  return best;
}

export function statRadar(stats: Record<string, number>, best: Best, title: string, size?: number): HTMLElement {
  const axes: RadarAxis[] = RADAR_STATS.map((k) => ({ label: STAT_LABELS[k] ?? k, value: stats[k] ?? 0, max: best[k]?.max ?? 0, best: best[k]?.who }));
  return radar(axes, { title, size });
}
const SLOT_ICONS: Record<string, string> = { weapon: "⚔️", head: "🪖", body: "🥋", hands: "🧤", feet: "👢", trinket: "💍" };
const STATUS_TONE: Record<string, string> = { idle: "t-green", "on a map": "t-violet", "on a quest": "t-blue" };

/** The rotation as numbered rows: skill (wiki link, effect on hover), AP cost, effect. */
export function rotationRows(skills: string[]): HTMLElement {
  return el("ol", { class: "rotation" }, ...skills.map((sk) => el("li", {}, skillLink(sk),
    el("span", { class: "ap" }, sk === "Basic" ? "0 AP" : `${skillAp(sk) ?? "?"} AP`),
    ...(sk === "Basic" ? [] : [el("span", { class: "muted small eff" }, skillDesc(sk))]))));
}

function heroCard(v: HeroView, best: Best): HTMLElement {
  const r = v.row;
  const name = String(r.name);
  const stats = v.stats
    ? el("div", { class: "hero-stats" }, statRadar(v.stats, best, `${name}'s combat stats`),
      el("dl", { class: "stats extra" }, ...EXTRA_STATS.filter((k) => k in v.stats! && (k !== "speed" || v.stats![k]) && (k !== "eva" || v.stats![k]))
        .map((k) => {
          const x = v.stats![k];
          return el("div", {}, el("dt", {}, STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? `${x.toFixed(2)}×` : fmt.format(x)));
        })))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  const rotation = rotationRows(v.rotation);
  const gear = el("ul", { class: "gear" }, ...v.gear.map((g) =>
    el("li", { class: `rar-${typeof g.rarity === "number" ? g.rarity : 1}`, title: `${g.slot}${g.item_level ? ` · item level ${g.item_level}` : ""}` },
      el("span", { class: "slot-ico", "aria-label": String(g.slot) }, SLOT_ICONS[String(g.slot)] ?? "•"),
      itemLink("equipment", Number(g.id), String(g.name), g.rarity, g.asc),
      el("span", { class: "meta" }, gradeBadge(String(g.grade))))));
  return el("article", { class: `card hero cls-${v.cls}` },
    el("header", { class: "hero-head" },
      withAsc(el("span", { class: "avatar" }, name.slice(0, 1).toUpperCase()), heroAsc(r.asc), name),
      el("div", {}, el("h3", {}, name),
        el("div", { class: "sub" }, pill(String(r.class)), pill(`lv ${r.level}`, "plain"),
          pill(String(r.status), STATUS_TONE[String(r.status)] ?? "t-slate")))),
    stats,
    el("div", {}, el("p", { class: "section-label" }, "Rotation"), rotation),
    el("div", {}, el("p", { class: "section-label" }, "Passive"), el("div", { class: "chips" }, passiveLink(String(r.passive || ""), "pill t-gold"))),
    gear,
    el("div", { class: "hero-foot" }, el("span", {}, `⚔️ ${fmt.format(Number(r.quests))} quests`), el("span", {}, `💀 ${r.deaths} deaths`)),
  );
}

function renderHeroes(views: HeroView[]): HTMLElement {
  return el("div", {},
    toolbar(el("p", { class: "muted small" }, "Combat stats are computed with the game's rules from your gear, level, passive and enchants. Each radar axis runs from 0 to your strongest hero for that stat."),
      csvButton("heroes", () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) }))),
      csvButton("hero_gear", () => gearRows(views), "gear")),
    el("div", { class: "cards" }, ...views.map((v) => heroCard(v, bestOf(views)))));
}

const ITEM_COLS: Column[] = [
  { key: "name", label: "Item", render: itemCell }, { key: "subtype", label: "Type" }, { key: "item_level", label: "Lvl", num: true },
  ascCol, { key: "grade", label: "Grade", render: gradeCell }, { key: "amount", label: "Qty", num: true },
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
    { key: "name", label: "Map", render: itemCell }, { key: "item_level", label: "Lvl", num: true }, ascCol,
    { key: "grade", label: "Grade", render: gradeCell }, { key: "enemies", label: "Enemies", num: true }, { key: "base_time_min", label: "Minutes", num: true },
    { key: "boss", label: "Boss" }, { key: "unit_sell", label: "Value", num: true }, { key: "enchant_attempts", label: "Enchant attempts" },
  ]));
}

function renderCrafters(sv: Save): HTMLElement {
  const rows = crafterRows(sv);
  // The item each crafter works on (same order as crafterRows), linked and outlined for its ascension.
  const jobs = [...sv.crafters.entries()].sort(([x], [y]) => x - y)
    .map(([, c]) => (c.isCrafting && typeof c.isCrafting === "object" ? c.isCrafting : null));
  const jobOf = new Map(rows.map((r, i) => [String(r.crafter), jobs[i]]));
  return el("div", {}, toolbar(csvButton("crafters", () => rows)), table(rows, [
    { key: "crafter", label: "Crafter", render: (r) => withAsc(el("strong", {}, String(r.crafter)), r.asc) },
    { key: "level", label: "Level", num: true }, { key: "asc", label: "Asc", num: true, render: (r) => ascSwatch(r.asc) },
    { key: "prestige_level", label: "Prestige level", num: true },
    { key: "crafting", label: "Working on", render: (r) => {
      const job = jobOf.get(String(r.crafter));
      if (!job) return el("span", { class: "muted" }, "idle");
      return el("span", { class: "nowrap" }, `🔨 ${job.amount ?? 1} × `,
        itemLink(String(job.itemType), Number(job.id), itemLabel(job), undefined, job.prestigeLevel));
    } },
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
  $("#result").replaceChildren(renderSummary(sv), ascLegend(), tabList, panel);
  void fileName;
  select("Heroes");
}

function showError(msg: string): void {
  $("#result").replaceChildren(el("p", { class: "error", role: "alert" }, msg));
}

/** Parse and show a save (from a file or from the browser's storage); throws when it isn't one. */
async function loadSave(text: string, name: string): Promise<void> {
  await Promise.all([loadData(), loadWikiText()]); // skill effects in the rotation rows
  let sv: Save;
  try {
    sv = loadSaveText(text);
  } catch {
    throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
  }
  if (!sv.raw || !Array.isArray(sv.raw.hero)) throw new Error("this file has no heroes. Is it a PlayerData / SlotNData save?");
  render(sv, name);
}

function init(): void {
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#save-status"), load: loadSave,
    onForget: () => $("#result").replaceChildren(),
  });
  loadWikiText();
  loadData().catch((e) => showError(String(e)));
}

init();
