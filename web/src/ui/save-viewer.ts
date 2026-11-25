/**
 * Save viewer page (site/save.html). The save file is read in the browser and
 * never leaves it; game data comes from data/gamedata.json next to the page.
 */
// Review F14: the menus (nav.ts) are bundled into this page, first, so nav and the page share one copy of the
// shared modules (dom, names, language, tooltip, Save menu); the page loads no separate js/nav.js.
import "./nav.ts";
import * as api from "../sim/api.ts";
import { itemName as englishItemName } from "../tools/engine.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { languageReady, onLanguageChange, rerenderKeeping } from "./language.ts";
import { ITEM_TYPE_PLURALS, itemName as shownItemName } from "./names.ts";
import {
  $, apBadge, ascLevel, ascSwatch, bar, bySlot, clickableRow, type Column, duration, el, fmt, GEAR_SLOT_ICONS, GEAR_SLOT_NAMES, gearGrid, gold, gradeBadge,
  heroAsc, lv, pill, type Row as Cells, segmented, table, withAsc,
} from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSaveSource, type SaveSource } from "./save-source.ts";
import { saveWizard, wizardRoute } from "./save-wizard.ts";
import { badgeFor } from "./expansion-state.ts";
import { helpTip } from "./wiki-help.ts";
import { itemLink, loadWikiText, passiveLink, passiveText, skillAp, skillDesc, skillLink } from "./wiki-data.ts";
import {
  ALL_TABLES_FILE, type ApBudget, crafterRows, type CsvTable, gearRows, GRADES_BEST_FIRST, type HeroView, heroViews, inventoryRows, itemLabel, mapEssenceOf, mapRows, type Row, ascOutlineText, gridStats, summary, toCsv, withAllTables,
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

/**
 * CSV downloads offered in the top-bar save menu (save-source.ts menuExtras): "All" first (every table in one file,
 * a "table" column saying which, U44), then one per table.
 */
function csvExports(): { label: string; hint: string; run: () => void }[] {
  if (!current) return [];
  const { sv, views } = current;
  const tables: CsvTable[] = [
    { label: "Heroes", file: "heroes", rows: () => views.map((v) => ({ ...v.row, ...(v.stats ?? {}) })) },
    { label: "Hero gear", file: "hero_gear", rows: () => gearRows(views) },
    { label: "Inventory", file: "inventory", rows: () => inventoryRows(sv) },
    { label: "Maps", file: "maps", rows: () => mapRows(sv) },
    { label: "Crafters", file: "crafters", rows: () => crafterRows(sv) },
  ];
  return withAllTables(tables).map((t) => ({
    label: `⬇ ${t.label}`,
    hint: t.file === ALL_TABLES_FILE ? `Download every table in one file, ${t.file}.csv (its first column names the table)` : `Download ${t.file}.csv`,
    run: () => downloadCsv(t.file, t.rows()),
  }));
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
/** Radar axes (combat stats on a comparable scale). */
const RADAR_STATS = ["maxHP", "atk", "matk", "def", "mdef", "acc", "crit"];
const GRID_LABELS: Record<string, string> = { critMod: "Crit dmg" };

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

/** R2 F15: the combat stats as a compact number grid (4 per row); each radar stat's tooltip names the save's best. */
function statGrid(stats: Record<string, number>, best: Best, hasApBudget: boolean): HTMLElement {
  return el("dl", { class: "stats hero-stat-grid" }, ...gridStats(stats, hasApBudget).map((k) => {
    const x = stats[k];
    const b = best[k];
    const attrs: Record<string, string> = b?.who ? { title: `${STAT_LABELS[k] ?? k}: best in this save ${fmt.format(b.max)} (${b.who})` } : {};
    return el("div", attrs, el("dt", {}, GRID_LABELS[k] ?? STAT_LABELS[k] ?? k), el("dd", {}, k === "critMod" ? `×${x.toFixed(2)}` : fmt.format(x)));
  }));
}

/** The hero page's gear "?" (R2 F16, U46): the name's colour is the rarity, the card's frame the ascension. */
const GEAR_HELP = ["The item's name has its rarity colour.",
  "A silver frame around the card marks an ascension-1 item, a gold one ascension 2."];

/**
 * The rotation as the wiki class page's skill rows (table.ability-rows): turn, skill, AP badge, effect; the whole row
 * opens the skill's wiki page (Basic has none). U46: one row per turn, Basic turns included (no "3–5" row any more).
 */
export function rotationRows(skills: string[]): HTMLElement {
  const head = el("tr", {}, el("th", { scope: "col", class: "n" }, "#"), el("th", { scope: "col" }, "Skill"),
    el("th", { scope: "col", class: "ap-col" }, el("abbr", { title: "Action points" }, "AP")), el("th", { scope: "col" }, "Effect"));
  const rows = skills.map((sk, i) => {
    const link = skillLink(sk);
    const tr = el("tr", {}, el("td", { class: "n" }, String(i + 1)),
      el("td", { class: "name" }, link),
      el("td", { class: "ap-col" }, apBadge(sk === "Basic" ? 0 : skillAp(sk))),
      el("td", { class: "eff" }, sk === "Basic" ? "Basic attack" : skillDesc(sk) || "–"));
    clickableRow(tr, link);
    return tr;
  });
  return el("div", { class: "table-wrap" }, el("table", { class: "ability-rows skill-rows hero-rows", "aria-label": "Rotation" },
    el("thead", {}, head), el("tbody", {}, ...rows)));
}

/** R2 F15: the passive on one line, "PASSIVE Juggernaut · +25% HP" (the name opens its wiki page); "none" muted. */
export function passiveLine(passive: string): HTMLElement {
  const has = Boolean(passive) && passive !== "None";
  return el("p", { class: "hero-passive" }, el("span", { class: "section-label" }, "Passive"),
    ...(has ? [passiveLink(passive), el("span", { class: "muted" }, ` · ${passiveText(passive) || "–"}`)] : [el("span", { class: "muted" }, "none")]));
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
  // R2 F15: the numbers first (a compact grid), the radar folded under them (open on wide screens, 200 px at most on
  // a phone). R1 F37: AP only in the rotation's budget line when there is one; crit damage reads "×2.00".
  const radarBox = (st: Record<string, number>) => {
    const d = el("details", { class: "hero-radar" }, el("summary", {}, "Radar against the save's best"),
      statRadar(st, best, `${name}'s combat stats`, 340));
    d.open = typeof matchMedia === "function" && matchMedia("(min-width: 761px)").matches;
    return d;
  };
  const stats = v.stats
    ? el("div", { class: "hero-stats" }, statGrid(v.stats, best, Boolean(v.ap)), radarBox(v.stats))
    : el("p", { class: "muted" }, `Stats unavailable: ${v.statsError}`);
  // Two columns: weapon, head, body | hands, feet, trinket (gearGrid in dom.ts).
  // R2 F54: no gear at all is one muted line, not six empty slots.
  const gear = !v.gear.length ? el("p", { class: "muted small" }, "No gear equipped.") : gearGrid(bySlot(v.gear, (g) => g.slot), (g, s) =>
    // U46: the card's frame is the ascension (silver, gold; plain for 0), the name keeps its rarity colour, no outline.
    el("div", { class: `gear-item rar-${typeof g.rarity === "number" ? g.rarity : 1}${gearAsc(g.asc)}`,
      title: `${GEAR_SLOT_NAMES[s]}${g.item_level ? ` · item level ${g.item_level}` : ""}${ascOutlineText(g.asc)}` },
      el("span", { class: "slot-ico", role: "img", "aria-label": GEAR_SLOT_NAMES[s] }, GEAR_SLOT_ICONS[s]),
      itemLink("equipment", Number(g.id), String(g.name), g.rarity, g.asc, { always: true, noOutline: true }),
      el("span", { class: "meta" }, gradeBadge(String(g.grade)))), { label: `${name}'s equipment` });
  const k = views.indexOf(v);
  const nav = (w: HeroView | undefined, label: string) => (w ? el("a", { href: heroHref(heroId(w, sv)), class: "secondary-link" }, label) : el("span"));
  return el("div", { class: "hero-detail-page" },
    el("nav", { class: "hero-nav", "aria-label": "Heroes" }, el("a", { href: "#heroes", class: "secondary-link" }, "← All heroes"),
      el("span", { class: "hero-nav-step" }, nav(views[k - 1], `‹ ${views[k - 1]?.row.name ?? ""}`), nav(views[k + 1], `${views[k + 1]?.row.name ?? ""} ›`))),
    el("article", { class: `card hero hero-detail cls-${v.cls}` },
      el("header", { class: "hero-head" }, avatar(v, "big"),
        el("div", {}, el("h2", {}, name),
          // U46: quests and deaths are chips next to the level and status.
          el("div", { class: "sub" }, pill(String(r.class)), ...[badgeFor("class", v.cls)].filter((x): x is HTMLElement => x !== null), pill(`Lvl ${r.level}`, "plain"),
            pill(String(r.status), STATUS_TONE[String(r.status)] ?? "t-slate"), ...heroCounts(r)))),
      el("div", { class: "hero-detail-grid" },
        el("section", {}, el("p", { class: "section-label" }, "Combat stats"), stats),
        el("section", { class: "hero-detail-side" },
          // Passive first, then the rotation with its AP budget, then the gear.
          passiveLine(String(r.passive || "")),
          el("div", {}, el("div", { class: "rot-head" }, el("p", { class: "section-label" }, "Rotation"), ...(v.ap ? [apBudget(v.ap)] : [])),
            rotationRows(v.rotation)),
          el("div", {}, el("p", { class: "section-label" }, "Gear ", helpTip(GEAR_HELP, "the gear frames")), gear)))));
}

/** The gear card's ascension frame class (U46): " gear-asc asc-1" / " gear-asc asc-2" (style.css), "" for 0. */
export const gearAsc = (asc: unknown): string => {
  const n = ascLevel(asc);
  return n ? ` gear-asc asc-${n}` : "";
};

/** U46: the hero's quests and deaths as chips ("⚔️ 1,204 quests", "💀 3 deaths"). */
export function heroCounts(r: Cells): HTMLElement[] {
  const n = (k: string) => Number(r[k]) || 0;
  const plural = (x: number, one: string) => `${fmt.format(x)} ${one}${x === 1 ? "" : "s"}`;
  return [pill(`⚔️ ${plural(n("quests"), "quest")}`, "plain hero-count"), pill(`💀 ${plural(n("deaths"), "death")}`, "plain hero-count")];
}

/** The heroes as a sortable table; each name opens the hero's page. */
function renderHeroes(views: HeroView[], sv: Save): HTMLElement {
  if (!views.length) return el("p", { class: "muted" }, "No heroes in this save.");
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
    { value: "all", label: "All" },
    ...["equipment", "consumable", "material", "map"].map((t) => ({ value: t, label: ITEM_TYPE_PLURALS[t] })),
    { value: "counter", label: "On the counter" },
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
  // R2 F14: the count sits on the filter's line ("167 stacks · 2,004,759 g", the base value), its "?" holds what the
  // value is (R2 F52) and what the outline around a name marks (R2 F17).
  const total = el("span", { class: "muted small inv-count", title: "Stacks shown and their base value" });
  const update = () => {
    const rows = filtered();
    total.textContent = `${fmt.format(rows.length)} stacks · ${gold(rows.reduce((s, r) => s + (Number(r.total_sell) || 0), 0))}`;
    // R2 F54: nothing to show is one muted line, not an empty table.
    holder.replaceChildren(rows.length ? inventoryTable(rows) : el("p", { class: "muted" }, "No item matches this filter."));
  };
  search.addEventListener("input", update);
  update();
  return el("div", {}, el("div", { class: "toolbar inv-filter" },
    el("div", { class: "inv-search" }, search, total, helpTip(INVENTORY_HELP, "the inventory")),
    // One chip row that scrolls sideways on a phone instead of wrapping (R2 F14).
    el("div", { class: "inv-kinds" }, kinds)), holder);
}

/** The inventory's "?" (R2 F52 / F17): the value's meaning and the ascension outline. */
const INVENTORY_HELP = ["Value: the base customer price, before haggling, preferences and counter bonuses.",
  "A silver outline around an item's name marks ascension 1, a gold one ascension 2 (the Asc column gives the number).",
  "\"On the counter\": the stack is on sale in the shop."];

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
  if (!rows.length) return el("p", { class: "muted" }, "No crafters in this save.");
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
  /** R2 F18: "Asc 1" / "Asc 2" and a small silver or gold bar, like the outlines of those items. */
  const levelHeader = (asc: number): [(Node | string)[], string] => [
    [`Asc ${asc}`, el("span", { class: `lvl-asc asc-${asc}`, "aria-hidden": "true" })], `Level for ascension-${asc} items`];
  const cols: Column[] = [
    { key: "crafter", label: "Crafter", render: (r) => el("strong", {}, String(r.crafter)) },
    { key: "level", label: "Lvl", num: true },
    { key: "asc1_level", label: "Asc 1", num: true, render: levelCell("asc1_level", 1) },
    { key: "asc2_level", label: "Asc 2", num: true, render: levelCell("asc2_level", 2) },
    { key: "crafting", label: "Working on", render: (r) => {
      const job = jobOf.get(String(r.crafter));
      if (!job) return el("span", { class: "muted" }, "idle");
      return el("span", { class: "nowrap" }, `🔨 ${job.amount ?? 1} × `,
        itemLink(String(job.itemType), Number(job.id), itemLabel(job), undefined, job.prestigeLevel, { always: true }));
    } },
  ];
  const wrap = iconHeaders(table(rows, cols), cols, { level: [["Lvl"], "Level (ascension-0 items)"], asc1_level: levelHeader(1), asc2_level: levelHeader(2) });
  // R2 F18 / F52: the explanation is a "?" on the header row, not a paragraph under the table.
  wrap.querySelectorAll("th")[1]?.append(" ", helpTip(CRAFTER_HELP, "the crafter levels"));
  return wrap;
}

/** The crafters' "?" (R2 F18): one level per ascension. */
export const CRAFTER_HELP = [
  "Lvl: the crafter's level, used for items of ascension 0.",
  "Asc 1, Asc 2: each crafter has its own level per ascension. Crafting items of its current ascension uses that level (it restarts at 1 when the crafter ascends).",
  "Above that level, it can only craft them one ascension lower. \"—\": the crafter hasn't reached that ascension.",
];

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
/** The page's save source (initSaveSource): the wizard's "Pick a file" and "Example save". */
let source: SaveSource | null = null;

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
 * save.html#open (#open=pc, #open=mobile) shows the "Open your save" wizard, with or without a save (U46);
 * #hero=<id> one hero; #overview, #heroes, #inventory, #maps, #crafters a section; anything else (no hash) the Overview.
 */
function route(): void {
  const wiz = wizardRoute(location.hash);
  // The wizard takes the no-save picker's place (style.css html.save-wizard).
  document.documentElement.classList.toggle("save-wizard", wiz !== undefined);
  if (wiz !== undefined) {
    $("#save-status").replaceChildren();
    $("#result").replaceChildren(saveWizard(wiz, { pick: () => source?.choose(), example: () => void source?.useExample() }));
    document.title = "Open your save · Save viewer · Merchant RPG Simulator";
    return;
  }
  if (!current) return void $("#result").replaceChildren();
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
  source = initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#save-status"), load: loadSave,
    onForget: () => {
      current = null;
      markLoaded(false);
      route(); // the wizard stays when it is open
    },
    // A file picked in the wizard: the save's Overview.
    afterPick: () => {
      if (wizardRoute(location.hash) !== undefined) location.hash = "overview";
    },
    menuExtras: () => ({ title: "Export (CSV)", items: csvExports() }),
  });
  route(); // the wizard (save.html#open) shows before any save is loaded
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
