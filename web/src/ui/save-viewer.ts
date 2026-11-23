/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
import * as api from "../sim/api.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, ascSwatch, type Column, el, fmt, gradeBadge, heroAsc, pill, type Row as Cells, table, tabKeys, withAsc } from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText, passiveLink, skillAp, skillDesc, skillLink } from "./wiki-data.ts";
import {
  crafterRows, gearRows, GRADES_BEST_FIRST, type HeroView, heroViews, inventoryRows, itemLabel, mapEssenceOf, mapRows, type Row, summary, toCsv,
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
/** The save at a glance: small cards (label, value, optional hint), several per row (the "Overview" tab). */
function renderOverview(sv: Save): HTMLElement {
  const s = summary(sv);
  const rows: [string, string, string, string?][] = [
    ["🪙", "Gold", fmt.format(s.gold)],
    ["💰", "Inventory value", `${fmt.format(s.inventoryValue)} g`, `base sell value · ${fmt.format(s.inventoryStacks)} stacks`],
    ["📈", "Gold earned", fmt.format(s.totalGoldEarned), "all time"],
    ["🔨", "Items crafted", fmt.format(s.totalCrafted)],
    ["🛒", "Sales", fmt.format(s.totalSales)],
    ["🛡️", "Heroes", String(s.heroes)],
    ["🗺️", "Maps", `${s.maps} / ${s.mapSlots}`, "owned / slots"],
    ["⚙️", "Mode", String(s.mode), `game v${s.version}`],
  ];
  return el("ul", { class: "save-cards", "aria-label": "Save overview" }, ...rows.map(([icon, label, value, hint]) => el("li", { class: "save-card" },
    el("span", { class: "sc-label" }, el("span", { class: "sc-icon", "aria-hidden": "true" }, icon), label),
    el("span", { class: "sc-value" }, value), ...(hint ? [el("span", { class: "sc-hint" }, hint)] : []))));
}

/**
 * Headers drawn as nodes instead of text (table() takes text labels): for each column key, the header
 * button's content and its accessible name (also its tooltip). The button keeps sorting.
 */
function iconHeaders(wrap: HTMLElement, cols: Column[], icons: Record<string, [(Node | string)[], string]>): HTMLElement {
  const buttons = wrap.querySelectorAll<HTMLButtonElement>("thead th button");
  cols.forEach((c, i) => {
    const icon = icons[c.key];
    if (!icon || !buttons[i]) return;
    buttons[i].replaceChildren(...icon[0]);
    buttons[i].setAttribute("aria-label", icon[1]);
    buttons[i].title = icon[1];
  });
  return wrap;
}

/** A count cell: the number, or a muted "–" for 0 (the row keeps 0, so the column sorts as numbers). */
const countCell = (key: string) => (r: Cells) => (Number(r[key]) ? fmt.format(Number(r[key])) : el("span", { class: "muted" }, "–"));

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

/** A hero's id in the save (for its details link). */
const heroId = (v: HeroView, sv: Save) => sv.raw.hero[Number(v.row.n) - 1]?.id ?? Number(v.row.n);
const heroHref = (id: unknown) => `#hero=${id}`;

function avatar(v: HeroView, size = ""): HTMLElement {
  const name = String(v.row.name);
  return withAsc(el("span", { class: `avatar ${size}`.trim() }, name.slice(0, 1).toUpperCase()), heroAsc(v.row.asc), name);
}

/** One hero in full (save.html#hero=<id>): radar and stats beside rotation, passive and gear. */
function heroDetail(v: HeroView, best: Best, views: HeroView[], sv: Save): HTMLElement {
  const r = v.row;
  const name = String(r.name);
  const stats = v.stats
    ? el("div", { class: "hero-stats" }, statRadar(v.stats, best, `${name}'s combat stats`, 340),
      el("dl", { class: "stats extra" }, ...EXTRA_STATS.filter((k) => k in v.stats! && (k !== "speed" || v.stats![k]) && (k !== "eva" || v.stats![k]))
        .map((k) => {
          const x = v.stats![k];
          return el("div", {}, el("dt", {}, STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? `${x.toFixed(2)}×` : fmt.format(x)));
        })))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  const gear = el("ul", { class: "gear" }, ...v.gear.map((g) =>
    el("li", { class: `rar-${typeof g.rarity === "number" ? g.rarity : 1}`, title: `${g.slot}${g.item_level ? ` · item level ${g.item_level}` : ""}` },
      el("span", { class: "slot-ico", "aria-label": String(g.slot) }, SLOT_ICONS[String(g.slot)] ?? "•"),
      itemLink("equipment", Number(g.id), String(g.name), g.rarity, g.asc),
      el("span", { class: "meta" }, gradeBadge(String(g.grade))))));
  const k = views.indexOf(v);
  const nav = (w: HeroView | undefined, label: string) => (w ? el("a", { href: heroHref(heroId(w, sv)), class: "secondary-link" }, label) : el("span"));
  return el("div", { class: "hero-detail-page" },
    el("nav", { class: "hero-nav", "aria-label": "Heroes" }, el("a", { href: "#heroes", class: "secondary-link" }, "← All heroes"),
      el("span", { class: "hero-nav-step" }, nav(views[k - 1], `‹ ${views[k - 1]?.row.name ?? ""}`), nav(views[k + 1], `${views[k + 1]?.row.name ?? ""} ›`))),
    el("article", { class: `card hero hero-detail cls-${v.cls}` },
      el("header", { class: "hero-head" }, avatar(v, "big"),
        el("div", {}, el("h2", {}, name),
          el("div", { class: "sub" }, pill(String(r.class)), pill(`lv ${r.level}`, "plain"),
            pill(String(r.status), STATUS_TONE[String(r.status)] ?? "t-slate")))),
      el("div", { class: "hero-detail-grid" },
        el("section", {}, el("p", { class: "section-label" }, "Combat stats"), stats),
        el("section", { class: "hero-detail-side" },
          el("div", {}, el("p", { class: "section-label" }, "Rotation"), rotationRows(v.rotation)),
          el("div", {}, el("p", { class: "section-label" }, "Passive"), el("div", { class: "chips" }, passiveLink(String(r.passive || ""), "pill t-gold"))),
          el("div", {}, el("p", { class: "section-label" }, "Gear"), gear))),
      el("div", { class: "hero-foot" }, el("span", {}, `⚔️ ${fmt.format(Number(r.quests))} quests`), el("span", {}, `💀 ${r.deaths} deaths`))));
}

/** The heroes as a sortable table; each name opens the hero's page. */
function renderHeroes(views: HeroView[], sv: Save): HTMLElement {
  const rows: Cells[] = views.map((v) => ({
    k: views.indexOf(v), id: heroId(v, sv), name: String(v.row.name), cls: v.cls, class: String(v.row.class), level: Number(v.row.level),
    asc: heroAsc(v.row.asc), status: String(v.row.status), passive: String(v.row.passive || ""), quests: Number(v.row.quests), deaths: Number(v.row.deaths),
    ...Object.fromEntries(["maxHP", "atk", "matk", "def", "mdef", "acc", "crit", "maxActionPoints"].map((s) => [s, v.stats?.[s] ?? null])),
  }));
  const num = (key: string, label: string) => ({ key, label, num: true });
  return el("div", {},
    toolbar(el("p", { class: "muted small" }, "Combat stats computed with the game's rules from gear, level, passive and enchants. Click a hero for its page (radar chart, rotation, gear)."),
      csvButton("heroes", () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) }))),
      csvButton("hero_gear", () => gearRows(views), "gear")),
    table(rows, [
      { key: "name", label: "Hero", render: (x) => el("a", { href: heroHref(x.id), class: `hero-link cls-${x.cls}` }, avatar(views[Number(x.k)], "small"), String(x.name)) },
      { key: "class", label: "Class", render: (x) => el("span", { class: `cls-${x.cls}` }, pill(String(x.class))) },
      num("level", "Lvl"), { key: "asc", label: "Asc", num: true, render: (x) => ascSwatch(x.asc) },
      num("maxHP", "HP"), num("atk", "Atk"), num("matk", "Matk"), num("def", "Def"), num("mdef", "Mdef"), num("acc", "Acc"), num("crit", "Crit"),
      num("maxActionPoints", "AP"),
      { key: "passive", label: "Passive", render: (x) => passiveLink(String(x.passive)) },
      { key: "status", label: "Status", render: (x) => pill(String(x.status), STATUS_TONE[String(x.status)] ?? "t-slate") },
      num("quests", "Quests"), num("deaths", "Deaths"),
    ]));
}

/** Inventory columns: one count per grade, best first (S … D), then the stack's total. */
const ITEM_COLS: Column[] = [
  { key: "name", label: "Item", render: itemCell }, { key: "subtype", label: "Type" }, { key: "item_level", label: "Lvl", num: true },
  ascCol, ...GRADES_BEST_FIRST.map((g): Column => ({ key: g, label: g, num: true, render: countCell(g) })),
  { key: "total", label: "Total", num: true },
  { key: "unit_sell", label: "Unit value", num: true }, { key: "total_sell", label: "Total value", num: true },
];
/** The inventory table; each grade column's header is the grade's badge ("Grade S count" for screen readers). */
const inventoryTable = (rows: Row[]) => iconHeaders(table(rows, ITEM_COLS, (r) => (r.where === "counter" ? "counter" : "")), ITEM_COLS,
  Object.fromEntries(GRADES_BEST_FIRST.map((g) => [g, [[gradeBadge(g)], `Grade ${g} count`]])));

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
    holder.replaceChildren(inventoryTable(rows));
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
    { key: "essence", label: "Essence / run", render: (r) => {
      // Linked essence names; the row's text form goes to the CSV.
      const it = sv.mapInventory[Number(r.slot) - 1];
      const ess = it ? mapEssenceOf(it) : [];
      return ess.length ? el("span", { class: "nowrap" }, ...ess.flatMap(([id, amt], k) => [...(k ? [", "] : []), `${fmt.format(amt)} × `, itemLink("material", id)]))
        : el("span", { class: "muted" }, "—");
    } },
    { key: "boss", label: "Boss" }, { key: "unit_sell", label: "Value", num: true }, { key: "enchant_attempts", label: "Enchant attempts" },
  ]));
}

function renderCrafters(sv: Save): HTMLElement {
  const rows = crafterRows(sv);
  // The item each crafter works on (same order as crafterRows), linked and outlined for its ascension.
  const jobs = [...sv.crafters.entries()].sort(([x], [y]) => x - y)
    .map(([, c]) => (c.isCrafting && typeof c.isCrafting === "object" ? c.isCrafting : null));
  const jobOf = new Map(rows.map((r, i) => [String(r.crafter), jobs[i]]));
  /** A crafter level for items of one ascension, outlined like those items; "—" before the crafter reaches it. */
  const levelCell = (key: string, asc: number) => (r: Cells) => {
    const v = r[key];
    if (v === null || v === undefined || v === "") return el("span", { class: "muted", title: "Not reached yet: the crafter can't make items of this ascension." }, "—");
    return withAsc(el("span", { class: "nowrap" }, fmt.format(Number(v))), asc);
  };
  /** "Level" and a small silver (ascension 1) or gold (ascension 2) bar, like the outlines of those items. */
  const levelHeader = (asc: number): [(Node | string)[], string] => [
    ["Level", el("span", { class: `lvl-asc asc-${asc}`, "aria-hidden": "true" })], `Level for ascension-${asc} items`];
  const cols: Column[] = [
    { key: "crafter", label: "Crafter", render: (r) => el("strong", {}, String(r.crafter)) },
    { key: "level", label: "Level", num: true },
    { key: "asc1_level", label: "Level (ascension 1)", num: true, render: levelCell("asc1_level", 1) },
    { key: "asc2_level", label: "Level (ascension 2)", num: true, render: levelCell("asc2_level", 2) },
    { key: "crafting", label: "Working on", render: (r) => {
      const job = jobOf.get(String(r.crafter));
      if (!job) return el("span", { class: "muted" }, "idle");
      return el("span", { class: "nowrap" }, `🔨 ${job.amount ?? 1} × `,
        itemLink(String(job.itemType), Number(job.id), itemLabel(job), undefined, job.prestigeLevel));
    } },
  ];
  return el("div", {}, toolbar(csvButton("crafters", () => rows)),
    iconHeaders(table(rows, cols), cols, { asc1_level: levelHeader(1), asc2_level: levelHeader(2) }),
    el("p", { class: "muted small" }, "Each crafter has its own level per ascension: crafting items of its current ascension uses that level " +
    "(it restarts at 1 when the crafter ascends), items of ascension 0 use the normal level. Above that level, it can only craft them one ascension lower."));
}

// ---------------------------------------------------------------- page
/** Tabs in order; the first is the default. Each has a hash (save.html#inventory …). */
const TABS = ["Overview", "Heroes", "Inventory", "Maps", "Crafters"] as const;
type Tab = typeof TABS[number];
const tabHash = (t: Tab) => `#${t.toLowerCase()}`;
const tabOf = (hash: string): Tab => TABS.find((t) => tabHash(t) === hash.toLowerCase()) ?? TABS[0];

let current: { sv: Save; views: HeroView[] } | null = null;

function render(sv: Save, fileName: string): void {
  void fileName;
  current = { sv, views: heroViews(sv) };
  route();
}

/**
 * save.html#hero=<id> shows one hero; #overview, #heroes, #inventory, #maps, #crafters a tab;
 * anything else (no hash) the Overview tab.
 */
function route(): void {
  if (!current) return;
  const { sv, views } = current;
  const m = /^#hero=(\d+)$/.exec(location.hash);
  const v = m ? views.find((x) => String(heroId(x, sv)) === m[1]) : undefined;
  if (v) {
    $("#result").replaceChildren(heroDetail(v, bestOf(views), views, sv));
    document.title = `${v.row.name} · Save viewer · Merchant RPG Simulator`;
    window.scrollTo(0, 0);
    return;
  }
  document.title = "Save Viewer · Merchant RPG Simulator";
  const panels: Record<Tab, () => HTMLElement> = {
    Overview: () => renderOverview(sv), Heroes: () => renderHeroes(views, sv), Inventory: () => renderInventory(sv),
    Maps: () => renderMaps(sv), Crafters: () => renderCrafters(sv),
  };
  const tabList = el("div", { role: "tablist", class: "tabs", "aria-label": "Save sections" });
  const panel = el("div", { role: "tabpanel", class: "panel" });
  const select = (name: Tab) => {
    tabList.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.textContent === name)));
    panel.replaceChildren(panels[name]());
  };
  for (const name of TABS) {
    const b = el("button", { role: "tab", type: "button", "aria-selected": "false" }, name);
    b.addEventListener("click", () => {
      // replaceState: keeps the tab in the URL without a hashchange (no re-render) or a history entry.
      history.replaceState(null, "", name === TABS[0] ? location.pathname + location.search : tabHash(name));
      select(name);
    });
    tabList.append(b);
  }
  tabKeys(tabList);
  $("#result").replaceChildren(tabList, panel);
  select(tabOf(location.hash));
}
window.addEventListener("hashchange", route);

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
