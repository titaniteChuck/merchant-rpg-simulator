/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
import * as api from "../sim/api.ts";
import { itemName as englishItemName } from "../tools/engine.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { languageReady, onLanguageChange, rerenderKeeping } from "./language.ts";
import { itemName as shownItemName } from "./names.ts";
import {
  $, apBadge, ascSwatch, bar, bySlot, clickableRow, type Column, duration, el, fmt, GEAR_SLOT_ICONS, GEAR_SLOT_NAMES, gearGrid, gold, gradeBadge,
  heroAsc, pill, type Row as Cells, segmented, table, withAsc,
} from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSaveSource } from "./save-source.ts";
import { badgeFor } from "./expansion-state.ts";
import { itemLink, loadWikiText, passiveLink, passiveText, skillAp, skillDesc, skillLink } from "./wiki-data.ts";
import {
  type ApBudget, crafterRows, gearRows, GRADES_BEST_FIRST, type HeroView, heroViews, inventoryRows, itemLabel, mapEssenceOf, mapRows, type Row, summary, toCsv,
} from "./save-tables.ts";

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

function downloadCsv(name: string, rows: Row[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
  const a = el("a", { href: url, download: `${name}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV downloads, one per table, offered in the top-bar save menu (save-source.ts menuExtras). */
function csvExports(): { label: string; hint: string; run: () => void }[] {
  if (!current) return [];
  const { sv, views } = current;
  const one = (label: string, file: string, rows: () => Row[]) => ({ label: `⬇ ${label}`, hint: `Download ${file}.csv`, run: () => downloadCsv(file, rows()) });
  return [
    one("Heroes", "heroes", () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) }))),
    one("Hero gear", "hero_gear", () => gearRows(views)),
    one("Inventory", "inventory", () => inventoryRows(sv)),
    one("Maps", "maps", () => mapRows(sv)),
    one("Crafters", "crafters", () => crafterRows(sv)),
  ];
}

function toolbar(...kids: Node[]): HTMLElement {
  return el("div", { class: "toolbar" }, ...kids);
}

/** Item name coloured by rarity, linked to its wiki page (summary on hover); `name` is "[Prefix] Item +N" (modItemName, U34). */
const itemCell = (r: Cells) => el("span", { class: "nowrap" }, itemLink(String(r.type), Number(r.id), String(r.name), r.rarity, r.asc, { always: true }));
/** A modded item sorts by its base name, not by its "[Prefix]" (U34). */
const baseName = (r: Cells) => shownItemName(String(r.type), Number(r.id)) ?? String(r.name);
/** The sortable "Asc" column: an outlined swatch, sorted by the number. */
const ascCol: Column = { key: "asc", label: "Asc", num: true, render: (r) => ascSwatch(r.asc) };
const gradeCell = (r: Cells) => (r.grade ? gradeBadge(String(r.grade)) : "");

// ---------------------------------------------------------------- sections
/** The save at a glance: small cards (label, value, optional hint), several per row (the "Overview" tab). */
function renderOverview(sv: Save): HTMLElement {
  const s = summary(sv);
  const rows: [string, string, string, string?][] = [
    ["🪙", "Gold", gold(s.gold)],
    ["💰", "Inventory value", gold(s.inventoryValue), `base sell value · ${fmt.format(s.inventoryStacks)} stacks`],
    ["📈", "Gold earned", gold(s.totalGoldEarned), "all time"],
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
/** A gold cell: "1,250 g" (R1 F28), empty when the value is unknown; the row keeps the number, for sorting and the CSV. */
const goldCell = (v: unknown) => (typeof v === "number" ? gold(v) : "");

const STAT_LABELS: Record<string, string> = {
  maxHP: "HP", atk: "Atk", matk: "Matk", acc: "Acc", crit: "Crit", critMod: "Crit damage", def: "Def", mdef: "Mdef",
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
const STATUS_TONE: Record<string, string> = { idle: "t-green", "on a map": "t-violet", "on a quest": "t-blue" };

/**
 * The rotation as the wiki class page's skill rows (table.ability-rows): turn, skill, AP badge, effect; the whole row
 * opens the skill's wiki page (Basic has none).
 */
export function rotationRows(skills: string[]): HTMLElement {
  const head = el("tr", {}, el("th", { scope: "col", class: "n" }, "#"), el("th", { scope: "col" }, "Skill"),
    el("th", { scope: "col", class: "ap-col" }, el("abbr", { title: "Action points" }, "AP")), el("th", { scope: "col" }, "Effect"));
  const rows = skills.map((sk, i) => {
    const link = skillLink(sk);
    const tr = el("tr", {}, el("td", { class: "n" }, String(i + 1)), el("td", { class: "name" }, link),
      el("td", { class: "ap-col" }, apBadge(sk === "Basic" ? 0 : skillAp(sk))),
      el("td", { class: "eff" }, sk === "Basic" ? "Basic attack" : skillDesc(sk) || "–"));
    clickableRow(tr, link);
    return tr;
  });
  return el("div", { class: "table-wrap" }, el("table", { class: "ability-rows skill-rows hero-rows", "aria-label": "Rotation" },
    el("thead", {}, head), el("tbody", {}, ...rows)));
}

/** The passive as one row of the same table style (name, bonus); the whole row opens its wiki page. */
export function passiveRows(passive: string): HTMLElement {
  const link = passiveLink(passive);
  const tr = el("tr", {}, el("td", { class: "name" }, link),
    el("td", { class: "eff" }, passive && passive !== "None" ? passiveText(passive) : "–"));
  clickableRow(tr, link);
  return el("div", { class: "table-wrap" }, el("table", { class: "ability-rows passive-rows hero-rows", "aria-label": "Passive" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Passive"), el("th", { scope: "col" }, "Bonus"))), el("tbody", {}, tr)));
}

/**
 * "18 / 20 AP used · 2 left" (over budget: a warning, the game then plays the default rotation). The hero page's
 * only AP figure (R1 F37: the stats list no longer repeats the hero's AP).
 */
export function apBudget(ap: ApBudget): HTMLElement {
  const left = ap.max - ap.used;
  const over = left < 0;
  const label = `${ap.used} of ${ap.max} action points used, ${over ? `${-left} over budget` : `${left} remaining`}`;
  return el("div", { class: `ap-budget${over ? " over" : ""}`, role: "group", "aria-label": label, title: label },
    el("span", { class: "ap-budget-used" }, el("strong", {}, String(ap.used)), ` / ${ap.max} AP used`),
    el("span", { class: "ap-budget-left" }, over ? `⚠ ${-left} over: the game plays the default rotation` : `· ${left} left`),
    bar(ap.max > 0 ? ap.used / ap.max : 0));
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
      // R1 F37: AP only in the rotation's budget line when there is one; crit damage reads "×2.00" (no × in its label).
      el("dl", { class: "stats extra" }, ...EXTRA_STATS.filter((k) => k in v.stats! && (k !== "speed" || v.stats![k]) && (k !== "eva" || v.stats![k])
        && (k !== "maxActionPoints" || !v.ap))
        .map((k) => {
          const x = v.stats![k];
          return el("div", {}, el("dt", {}, STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? `×${x.toFixed(2)}` : fmt.format(x)));
        })))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  // Two columns: weapon, head, chest | bracers, feet, talisman (gearGrid in dom.ts).
  const gear = gearGrid(bySlot(v.gear, (g) => g.slot), (g, s) =>
    el("div", { class: `gear-item rar-${typeof g.rarity === "number" ? g.rarity : 1}`, title: `${GEAR_SLOT_NAMES[s]}${g.item_level ? ` · item level ${g.item_level}` : ""}` },
      el("span", { class: "slot-ico", role: "img", "aria-label": GEAR_SLOT_NAMES[s] }, GEAR_SLOT_ICONS[s]),
      itemLink("equipment", Number(g.id), String(g.name), g.rarity, g.asc, { always: true }),
      el("span", { class: "meta" }, gradeBadge(String(g.grade)))), { label: `${name}'s equipment` });
  const k = views.indexOf(v);
  const nav = (w: HeroView | undefined, label: string) => (w ? el("a", { href: heroHref(heroId(w, sv)), class: "secondary-link" }, label) : el("span"));
  return el("div", { class: "hero-detail-page" },
    el("nav", { class: "hero-nav", "aria-label": "Heroes" }, el("a", { href: "#heroes", class: "secondary-link" }, "← All heroes"),
      el("span", { class: "hero-nav-step" }, nav(views[k - 1], `‹ ${views[k - 1]?.row.name ?? ""}`), nav(views[k + 1], `${views[k + 1]?.row.name ?? ""} ›`))),
    el("article", { class: `card hero hero-detail cls-${v.cls}` },
      el("header", { class: "hero-head" }, avatar(v, "big"),
        el("div", {}, el("h2", {}, name),
          el("div", { class: "sub" }, pill(String(r.class)), ...[badgeFor("class", v.cls)].filter((x): x is HTMLElement => x !== null), pill(`lv ${r.level}`, "plain"),
            pill(String(r.status), STATUS_TONE[String(r.status)] ?? "t-slate")))),
      el("div", { class: "hero-detail-grid" },
        el("section", {}, el("p", { class: "section-label" }, "Combat stats"), stats),
        el("section", { class: "hero-detail-side" },
          // Passive first, then the rotation with its AP budget, then the gear.
          el("div", {}, el("p", { class: "section-label" }, "Passive"), passiveRows(String(r.passive || ""))),
          el("div", {}, el("div", { class: "rot-head" }, el("p", { class: "section-label" }, "Rotation"), ...(v.ap ? [apBudget(v.ap)] : [])),
            rotationRows(v.rotation)),
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
    table(rows, [
      { key: "name", label: "Hero", render: (x) => el("a", { href: heroHref(x.id), class: `hero-link cls-${x.cls}` }, avatar(views[Number(x.k)], "small"), String(x.name)) },
      { key: "class", label: "Class", render: (x) => el("span", { class: `cls-${x.cls}` }, pill(String(x.class)), badgeFor("class", Number(x.cls)) ?? "") },
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
  { key: "name", label: "Item", render: itemCell, sortBy: baseName }, { key: "subtype", label: "Type" }, { key: "item_level", label: "Lvl", num: true },
  ascCol, ...GRADES_BEST_FIRST.map((g): Column => ({ key: g, label: g, num: true, render: countCell(g) })),
  { key: "total", label: "Total", num: true },
  { key: "unit_sell", label: "Unit value", num: true, show: goldCell }, { key: "total_sell", label: "Total value", num: true, show: goldCell },
];
/** The inventory table; each grade column's header is the grade's badge ("Grade S count" for screen readers). */
const inventoryTable = (rows: Row[]) => iconHeaders(table(rows, ITEM_COLS, (r) => (r.where === "counter" ? "counter" : "")), ITEM_COLS,
  Object.fromEntries(GRADES_BEST_FIRST.map((g) => [g, [[gradeBadge(g)], `Grade ${g} count`]])));

function renderInventory(sv: Save): HTMLElement {
  const all = inventoryRows(sv);
  const search = el("input", { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name" }) as HTMLInputElement;
  // The kind filter as the shared segmented control (R1 F27).
  const kind = { value: "all" };
  const kinds = segmented("inv-kind", "Item kind", [
    { value: "all", label: "All" }, { value: "equipment", label: "Equipment" }, { value: "consumable", label: "Consumables" },
    { value: "material", label: "Materials" }, { value: "map", label: "Maps" }, { value: "counter", label: "On the counter" },
  ], kind.value, (v) => {
    kind.value = v;
    update();
  });
  const holder = el("div");
  const filtered = () => {
    const q = search.value.trim().toLowerCase();
    return all.filter((r) => (kind.value === "all" || (kind.value === "counter" ? r.where === "counter" : r.type === kind.value && r.where !== "counter"))
      // U29: the shown name or the English one
      && (!q || `${r.name} ${englishItemName(String(r.type), Number(r.id))}`.toLowerCase().includes(q)));
  };
  const total = el("span", { class: "muted small" });
  const update = () => {
    const rows = filtered();
    total.textContent = `${fmt.format(rows.length)} stacks · ${gold(rows.reduce((s, r) => s + (Number(r.total_sell) || 0), 0))} base value`;
    holder.replaceChildren(inventoryTable(rows));
  };
  search.addEventListener("input", update);
  update();
  return el("div", {}, toolbar(search, kinds, total), holder,
    el("p", { class: "muted small" }, "Value = base customer price before haggling, preferences and counter bonuses."));
}

function renderMaps(sv: Save): HTMLElement {
  const rows = mapRows(sv);
  if (!rows.length) return el("p", { class: "muted" }, "No maps in this save.");
  return el("div", {}, table(rows, [
    { key: "name", label: "Map", render: itemCell, sortBy: baseName }, { key: "item_level", label: "Lvl", num: true }, ascCol,
    { key: "grade", label: "Grade", render: gradeCell }, { key: "enemies", label: "Enemies", num: true }, { key: "base_time_min", label: "Time", num: true, show: (v) => (typeof v === "number" ? duration(v * 60) : "") },
    { key: "essence", label: "Essence / run", render: (r) => {
      // Linked essence names; the row's text form goes to the CSV.
      const it = sv.mapInventory[Number(r.slot) - 1];
      const ess = it ? mapEssenceOf(it) : [];
      return ess.length ? el("span", { class: "nowrap" }, ...ess.flatMap(([id, amt], k) => [...(k ? [", "] : []), `${fmt.format(amt)} × `, itemLink("material", id, undefined, undefined, undefined, { always: true })]))
        : el("span", { class: "muted" }, "—");
    } },
    { key: "boss", label: "Boss" }, { key: "unit_sell", label: "Value", num: true, show: goldCell }, { key: "enchant_attempts", label: "Enchant attempts" },
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
        itemLink(String(job.itemType), Number(job.id), itemLabel(job), undefined, job.prestigeLevel, { always: true }));
    } },
  ];
  return el("div", {},
    iconHeaders(table(rows, cols), cols, { asc1_level: levelHeader(1), asc2_level: levelHeader(2) }),
    el("p", { class: "muted small" }, "Each crafter has its own level per ascension: crafting items of its current ascension uses that level " +
    "(it restarts at 1 when the crafter ascends), items of ascension 0 use the normal level. Above that level, it can only craft them one ascension lower."));
}

// ---------------------------------------------------------------- page
/**
 * Sections in order; the first is the default. Each has a hash (save.html#inventory …), linked from the site's menus
 * (nav.ts: the Save dropdown, the second row under the top bar, the phone drawer; U35), which replace the tabs.
 */
const TABS = ["Overview", "Heroes", "Inventory", "Maps", "Crafters"] as const;
type Tab = typeof TABS[number];
const tabHash = (t: Tab) => `#${t.toLowerCase()}`;
const tabOf = (hash: string): Tab => TABS.find((t) => tabHash(t) === hash.toLowerCase()) ?? TABS[0];

let current: { sv: Save; views: HeroView[] } | null = null;

/** U35: the menus' save sections (second row) only show once a save is loaded (style.css "menus + drawer"). */
const markLoaded = (on: boolean) => {
  if (on) document.documentElement.dataset.saveLoaded = "";
  else delete document.documentElement.dataset.saveLoaded;
};

function render(sv: Save, fileName: string): void {
  void fileName;
  current = { sv, views: heroViews(sv) };
  markLoaded(true);
  route();
}

/**
 * save.html#hero=<id> shows one hero; #overview, #heroes, #inventory, #maps, #crafters a section;
 * anything else (no hash) the Overview.
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
  const name = tabOf(location.hash);
  $("#result").replaceChildren(el("section", { class: "panel", "aria-label": name }, panels[name]()));
}
window.addEventListener("hashchange", route);

function showError(msg: string): void {
  $("#result").replaceChildren(el("p", { class: "error", role: "alert" }, msg));
}

/** Parse and show a save (from a file or from the browser's storage); throws when it isn't one. */
async function loadSave(text: string, name: string): Promise<void> {
  await Promise.all([loadData(), loadWikiText(), languageReady]); // skill effects in the rotation rows; game names (U29)
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
    onForget: () => {
      $("#result").replaceChildren();
      markLoaded(false);
    },
    menuExtras: () => ({ title: "Export (CSV)", items: csvExports() }),
  });
  loadWikiText();
  loadData().catch((e) => showError(String(e)));
  // U29: another language rebuilds the rows (names) and redraws the tab or hero in place, filters and sorting kept.
  onLanguageChange(() => {
    if (!current) return;
    current = { sv: current.sv, views: heroViews(current.sv) };
    rerenderKeeping($("#result"), route);
  });
}

init();
