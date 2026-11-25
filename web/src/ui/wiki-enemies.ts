/**
 * Wiki enemy parts (#/enemies, #/enemy/ID, map enemy tables): one page per quest enemy, normal and rare variant
 * together, with stats, rotation, drops and the maps it appears in. Placeholders are not enemies
 * (PLACEHOLDER_QUEST_IDS in wiki-data.ts); the quest bushes (gathering quests) are enemies, kind "Quest bush".
 */
import { enemyStrip, stripNote, timelineOf } from "./timeline.ts";
import { seq } from "../sim/lua.ts";
import { duration, el, fmt, gold, gradeBadge, GRADE_LETTERS, LV, lv, pill, type Row, segField, segmented, table, withAsc } from "./dom.ts";
import {
  enemyDrops, enemyIds, enemyKind, enemyLevelSort, enemyLevelText, isEnemy, isGathering, isTreasureBush, enemyLink, enemyMapRoles, hasRare, item, itemLink, quest, regionChip, regionOf, regionSortKey, regionText,
  skillDesc, skillLink, factCards, regionCard, WIDE,
} from "./wiki-data.ts";
import { sectionHelp } from "./wiki-help.ts";
import { battleLink, statLink } from "./wiki-ref.ts";
import { isHidden, isVisible } from "./expansion-state.ts";
import { simulatorHref, type SimulatorTarget } from "./battle-links.ts";
import { hiddenNote } from "./expansion-menu.ts";
import { rarityChip } from "./wiki-items.ts";
import { enemyName, itemName, skillName } from "./names.ts";
import { amountOddsText, amountRange, fixedAmounts, LOOT_GRADES, lootTable, pctText } from "./wiki-loot.ts";
import { isCraftableMap, isMapOnlyQuest } from "../tools/quest-stats.ts";
import { partySizes, xpText } from "./quest-xp.ts";
import {
  ENEMY_DEFAULT, type EnemyConfig, enemyConfigQuery, enemyGrades, type EnemyRun, enemyRunMap, enemySizes, mapEnemyStats, mapRun, mapView, NO_CONFIG,
  questEnemyStats, questRun,
} from "./wiki-config.ts";

/** Why a map is marked "not craftable" (R1 F42; docs/game-economy/maps/maps.md, Level-70 maps). */
const UNCRAFTABLE_TITLE = "Level 70: above the crafters' level cap (60), so no one can make it. Dormant game data.";

/** [quest key (the rare variant adds "B"), label]. */
export const ENEMY_STATS: [string, string][] = [["enemyHp", "HP"], ["enemyAtk", "Atk"], ["enemyMatk", "Matk"], ["enemyDef", "Def"], ["enemyMdef", "Mdef"], ["enemyEva", "Eva"]];
/** Map enemy multiplier factor at map ascension 1 (defaults.mapEnemyModPreview). Maps ascend to 1 at most. */
const MAP_ASC_MOD = 2;

/** An enemy variant's stats × a map's multiplier. */
function enemyRow(id: number, rare: boolean, mod = 1): Row {
  const q = quest(id);
  const sfx = rare ? "B" : "";
  // A Treasure Bush shows the level range of the maps it spawns in and sorts by the lowest (enemyLevelText).
  const r: Row = { id, rare, name: enemyName(id, rare) ?? (rare ? q.nameB : q.name), level: isTreasureBush(id) ? enemyLevelSort(id) : q.levelReq ?? null, levelText: enemyLevelText(id) };
  for (const [k, label] of ENEMY_STATS) r[label] = q[k + sfx] !== undefined ? Math.round(q[k + sfx] * mod) : null;
  return r;
}

/** The Level cell: a bush's map level range ("1–10"), else the quest level. */
const levelCell = (r: Row) => String(r.levelText ?? r.level ?? "");
const rarePill = (r: Row) => (r.rare ? [" ", pill("rare", "t-pink")] : []);
/** An enemy name linked, with the "rare" pill after a rare variant (R1 F11: the one convention of the wiki). */
export const nameCell = (r: Row) => el("span", { class: "nowrap" }, enemyLink({ id: Number(r.id), name: String(r.name), rare: !!r.rare }), ...rarePill(r));
const rotation = (id: number, rare: boolean): string[] => seq<string>((rare ? quest(id)?.attackListB : quest(id)?.attackList) ?? {});

/**
 * A rotation counted: its distinct skills in first-use order with how many of the 5 turns use each, "Basic" (the plain
 * attack) last. Many room enemies really are "Basic" on all 5 turns (data.QuestData: every region 1 enemy, the titans,
 * treants and golems…), so their whole summary is Basic ×5.
 */
export function rotationSummary(list: string[]): { skill: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([skill, count]) => ({ skill, count })).sort((a, b) => Number(a.skill === "Basic") - Number(b.skill === "Basic"));
}

/**
 * Sort key and search text of a map table's Skills column, from the variant's own rotation (attackList, or attackListB
 * for the rare one: default.enemyAttackList): the real skills, or "Basic only" when it has none.
 */
export function skillSummaryText(id: number, rare: boolean): string {
  const real = rotationSummary(rotation(id, rare)).filter((s) => s.skill !== "Basic");
  return real.length ? real.map((s) => (s.count > 1 ? `${skillName(s.skill)} ×${s.count}` : skillName(s.skill))).join(", ") : "Basic only";
}

/**
 * The Skills cell: the real skills linked (×N when a skill fills several turns), then "Basic ×N" muted; "Basic attack
 * only" when the enemy has no skill. The tooltip gives the turn-by-turn rotation.
 */
function skillLine(id: number, rare: boolean): HTMLElement {
  const list = rotation(id, rare);
  const sum = rotationSummary(list);
  const title = `Turns 1–${list.length}: ${list.map(skillName).join(" → ")}`;
  if (sum.every((s) => s.skill === "Basic")) return el("span", { class: "skill-line muted", title }, "Basic attack only");
  const parts = sum.map((s) => s.skill === "Basic"
    ? el("span", { class: "muted small" }, `Basic ×${s.count}`)
    : el("span", { class: "nowrap" }, skillLink(s.skill), ...(s.count > 1 ? [el("span", { class: "muted small" }, ` ×${s.count}`)] : [])));
  return el("span", { class: "skill-line", title }, ...parts.flatMap((p, i) => (i ? [", ", p] : [p])));
}

/**
 * An enemy variant inside a map: its stats as the engine gives them in the run (U49: sim/enemy with the map's run
 * stats, default.finalMapMod, so ascension, suffix and prefix count); `base` when the engine can't build it (the
 * row then keeps the quest's own stats, marked).
 */
function mapEnemyRow(id: number, rare: boolean, mapStats: unknown): Row {
  const r = enemyRow(id, rare);
  const inMap = mapEnemyStats(id, rare, mapStats);
  if (inMap) Object.assign(r, inMap);
  else r.base = true;
  return r;
}

/** A small "base" tag: the figure beside it is the unmodified one (U49). */
export const baseTag = (why: string): HTMLElement => el("span", { class: "cfg-base", title: why }, "base", el("span", { class: "visually-hidden" }, `: ${why}`));

/** What an enemy is in a map (the pills of the enemy page's Maps table and of the map page's enemy table). */
export type MapRole = "treasure" | "room" | "boss";
const ROLE_TONE: Record<string, string> = { boss: "t-orange", room: "t-slate", treasure: "t-gold" };
const rolePills = (roles: MapRole[]) => roles.flatMap((x) => [" ", pill(x, ROLE_TONE[x])]);

/**
 * Enemy stats for a map: one row per variant, the stats each has inside the map (`mapStats`: wiki-config mapView's
 * run stats), names linked to the enemy pages. U55: each id with its roles, tagged after the name (a room enemy
 * alone has no tag) and as the row's class (`me-boss`, `me-treasure`).
 */
function roleTable(list: [number, MapRole[]][], mapStats: unknown): HTMLElement {
  const rows: Row[] = [];
  for (const [id, roles] of list) {
    if (!quest(id)?.name) continue;
    const tags = roles.length === 1 && roles[0] === "room" ? [] : roles;
    rows.push({ ...mapEnemyRow(id, false, mapStats), skills: skillSummaryText(id, false), roles: tags.join(" ") });
    if (hasRare(id)) rows.push({ ...mapEnemyRow(id, true, mapStats), skills: skillSummaryText(id, true), roles: tags.join(" ") });
  }
  const mark = (r: Row) => (r.base ? [" ", baseTag("The quest's own stats: the engine could not build this enemy in the map")] : []);
  const roles = (r: Row) => (r.roles ? String(r.roles).split(" ") as MapRole[] : []);
  const t = table(rows, [
    { key: "name", label: "Enemy", render: (r) => el("span", { class: "me-name" }, nameCell(r), ...rolePills(roles(r)), ...mark(r)) },
    { key: "level", label: "Level", num: true, render: levelCell }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "skills", label: "Skills", render: (r) => skillLine(Number(r.id), !!r.rare) },
  ], (r) => roles(r).filter((x) => x !== "room").map((x) => `me-${x}`).join(" "));
  t.classList.add("map-enemies");
  return t;
}

/** Enemy stats for a map, the ids without roles (no tags). */
export const enemyTable = (ids: number[], mapStats: unknown): HTMLElement => roleTable([...new Set(ids)].map((id) => [id, []]), mapStats);

/**
 * U55: a map's one enemy table: its Treasure Bush first, then the room enemies, the boss(es) last. A boss the rooms
 * also draw (Vanquishers Map) is one row, tagged boss and room.
 */
export function mapEnemyTable(bush: number | null | undefined, rooms: number[], bosses: number[], mapStats: unknown): HTMLElement {
  const isBoss = new Set(bosses), inRooms = new Set(rooms);
  return roleTable([
    ...(bush && isEnemy(bush) ? [[bush, ["treasure"]] as [number, MapRole[]]] : []),
    ...[...inRooms].filter((id) => !isBoss.has(id)).map((id): [number, MapRole[]] => [id, ["room"]]),
    ...[...isBoss].map((id): [number, MapRole[]] => [id, inRooms.has(id) ? ["boss", "room"] : ["boss"]]),
  ], mapStats);
}

/** R1 F42: the mark of a map no crafter can make (the level-70 maps); U55: also on the Maps list and the map page. */
export const uncraftableTag = (): HTMLElement => el("span", { class: "muted small nowrap", title: UNCRAFTABLE_TITLE }, "not craftable");

// ---------------------------------------------------------------- list
/**
 * Rows of the Enemies list: base stats of the normal variant, the rare variant's name, region, map count. In region
 * order (region, then event bosses, then map bosses: regionOf), then level, then quest id: `region` sorts the same way.
 */
export function enemyListRows(): Row[] {
  return enemyIds().map((id): Row => {
    const reg = regionOf("enemy", id);
    return {
      ...enemyRow(id, false), kind: enemyKind(id), rareName: hasRare(id) ? enemyName(id, true) ?? quest(id).nameB : "",
      // U29: the filter also matches the English names
      en: [quest(id).name, hasRare(id) ? quest(id).nameB : ""].filter(Boolean).join(" "),
      region: regionSortKey(reg, enemyLevelSort(id)), regionId: reg?.id ?? 0, regionName: regionText(reg),
      skills: [...new Set([...rotation(id, false), ...(hasRare(id) ? rotation(id, true) : [])])].flatMap((s) => [...new Set([s, skillName(s)])]).join(" "),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id));
}

/** Row class of a region-sorted list: `reg-N` (the CSS rules a line where the region changes, in any sort order). */
export const regionRowClass = (r: Row): string => `reg-${r.regionId ?? 0}`;

export const enemyListColumns = [
  { key: "name", label: "Enemy", render: (r: Row) => enemyLink({ id: Number(r.id), name: String(r.name) }) },
  // R1 F11: a rare variant reads the same everywhere in the wiki: its own name, then a small "rare" pill.
  { key: "rareName", label: "Rare variant", render: (r: Row) => (r.rareName ? nameCell({ id: r.id, name: r.rareName, rare: true }) : el("span", { class: "muted" }, "–")) },
  // U37: the region alone (the Kind column says event / map boss); no Maps count column
  { key: "region", label: "Region", render: (r: Row) => regionChip(regionOf("enemy", Number(r.id)), false, { tag: false }) },
  { key: "kind", label: "Kind" }, { key: "level", label: "Level", num: true, render: levelCell },
  ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
];

// ---------------------------------------------------------------- page
/**
 * What the enemy page's figures are taken at (U60): the page's grade and quest size, and for a map-only enemy the one
 * map whose run it costs (wiki-config enemyRunMap: its own map as the boss first, then the cheapest), built by the
 * engine at that grade.
 */
export interface EnemyContext {
  id: number;
  cfg: EnemyConfig;
  mapOnly: boolean;
  /** A map-only enemy's map, null when no map the visitor sees fights it (or not a map-only enemy). */
  run: { map: number; role: string; of: number } | null;
  /** The run map's stats at the grade (wiki-config mapView), null without one. */
  mapStats: unknown;
}

export function enemyContext(id: number, cfg: EnemyConfig = ENEMY_DEFAULT): EnemyContext {
  const mapOnly = isMapOnlyQuest(id);
  const run = mapOnly ? enemyRunMap(id, cfg.grade, (m) => isVisible("map", m)) : null;
  return { id, cfg, mapOnly, run, mapStats: run ? mapView(run.map, NO_CONFIG, cfg.grade)?.stats ?? null : null };
}

/** The quest size a variant is fought at: the page's size; the rare variant and a map room ×1. */
const sizeOf = (c: EnemyContext, rare: boolean) => (rare || c.mapOnly ? 1 : c.cfg.size);

/** One variant's row of the stats table: its stats at the page's size (or inside its map) and its run figures. */
export interface StatsRow { rare: boolean; name: string; level: number | null; stats: Record<string, number>; base: boolean; run: EnemyRun | null }

export function statsRows(c: EnemyContext): StatsRow[] {
  const q = quest(c.id);
  return [false, ...(hasRare(c.id) ? [true] : [])].map((rare) => {
    const own = questEnemyStats(c.id, rare, sizeOf(c, rare));
    const inMap = c.mapOnly ? mapEnemyStats(c.id, rare, c.mapStats) : null;
    const plain = Object.fromEntries(ENEMY_STATS.map(([k, l]) => [l, q[k + (rare ? "B" : "")] ?? 0]));
    const stats = (c.mapOnly ? inMap : own) ?? own ?? plain;
    const run = c.mapOnly ? (c.run ? mapRun(c.run.map, c.cfg.grade) : null) : questRun(c.id, rare, c.cfg);
    return { rare, name: enemyName(c.id, rare) ?? (rare ? q.nameB : q.name), level: q.levelReq ?? null, stats, base: c.mapOnly && !inMap, run };
  });
}

/**
 * U60: one table for the stats and the run (the "XP and time" table merged in): a row per variant, the stats then Cost,
 * Time, XP and XP / min. A map-only enemy's run columns are its map's, one cell over both variants.
 */
function statsTable(c: EnemyContext): HTMLElement {
  const rows = statsRows(c);
  const shared = c.mapOnly && rows.length > 1;
  const th = (h: Node | string, num = true) => el("th", { scope: "col", class: num ? "num" : "" }, h);
  const td = (text: string, title?: string, span = 1) => el("td", { class: "num", ...(title ? { title } : {}), ...(span > 1 ? { rowspan: String(span) } : {}) }, text);
  const none = (span: number) => [0, 1, 2, 3].map(() => el("td", { class: "num muted", ...(span > 1 ? { rowspan: String(span) } : {}) }, "–"));
  const runCells = (r: EnemyRun | null, span: number) => (r
    ? [td(r.cost === null ? "–" : gold(r.cost), undefined, span), td(duration(r.seconds), `${fmt.format(r.seconds)} s`, span), td(xpText(r.xp), undefined, span), td(xpText(r.xpPerMin), undefined, span)]
    : none(span));
  const tag = (r: StatsRow) => (c.mapOnly || c.cfg.size === 1 ? [] : [el("span", { class: "muted small" }, ` ×${sizeOf(c, r.rare)}`)]);
  const trs = rows.map((r, i) => el("tr", r.rare ? { class: "rare" } : {},
    el("td", {}, el("span", { class: "nowrap" }, r.name, ...rarePill({ rare: r.rare }), ...tag(r)),
      ...(r.base ? [" ", baseTag("The quest's own stats: the engine could not build this enemy in the map")] : [])),
    el("td", { class: "num" }, r.level === null ? "–" : String(r.level)),
    ...ENEMY_STATS.map(([, l]) => el("td", { class: "num" }, fmt.format(r.stats[l] ?? 0))),
    ...(shared && i > 0 ? [] : runCells(r.run, shared ? rows.length : 1))));
  return el("div", { class: "table-wrap stats-run-wrap" }, el("table", { class: "stats-run" },
    el("thead", {}, el("tr", {}, th("Variant", false), th(LV), ...ENEMY_STATS.map(([, l]) => th(l)),
      th("Cost"), th(statLink("time", "Time")), th(statLink("xp", "XP")), th("XP / min"))),
    el("tbody", {}, ...trs)));
}

const STATS_HELP_QUEST = [
  "At the page's grade and quest size: HP, cost, time and XP × size; the rare variant is always ×1.",
  "Time: the quest's own time at the grade, without the fight. XP: the quest's whole XP, split between the heroes.",
];
const STATS_HELP_MAP = [
  "Stats inside the map, at the page's grade (the map's grade).",
  "Cost, Time and XP: one run of that map: its total cost, craft and walk time (the fights add to it), every room won; the XP is split between the heroes.",
];

/**
 * Without timeline data (data/timelines.json missing): the plain 5-turn rotation, numbered (ol.rotation), each skill
 * with its effect. U24: with the data, the timeline strip replaces it (each turn card carries the effect).
 */
function rotationList(id: number, rare: boolean): HTMLElement {
  return el("ol", { class: "rotation" }, ...rotation(id, rare).map((s) => el("li", {}, skillLink(s),
    ...(s !== "Basic" && skillDesc(s) ? [el("span", { class: "eff muted small" }, skillDesc(s))] : []))));
}

const dash = (num = false) => el("td", { class: num ? "num muted" : "muted" }, "–");
const itemCell = (type: string, id: number) => el("td", {}, el("span", { class: "loot-item" }, itemLink(type, id)));
const rarityCell = (type: string, id: number) => el("td", { class: "loot-rar" }, rarityChip(item(type, id)?.rarity));

/** U60: the columns every drop table shares (one colgroup, fixed layout), so Every win and the loot rolls line up. */
export const LOOT_COLS = ["lt-item", "lt-rar", "lt-3", ...LOOT_GRADES.map(() => "lt-g")];
const lootColgroup = () => el("colgroup", {}, ...LOOT_COLS.map((c) => el("col", { class: c })));
/** The class of a grade's cells: the page's grade outlined (`pick`). */
const gradeCls = (g: number, pick: number) => (g === pick ? "num pick" : "num");

/**
 * A static drop table: two header rows (the grade columns grouped under "`group` by battle grade", the words "battle
 * grade" linked to Stats › Grade), then the rows. U60: the shared colgroup; the page's grade outlined.
 */
function lootGrid(firstCols: [string, boolean][], group: string, rows: HTMLTableRowElement[], pick: number): HTMLElement {
  const head1 = el("tr", {}, ...firstCols.map(([c, num]) => el("th", { scope: "col", rowspan: "2", class: num ? "num" : "" }, c)),
    el("th", { scope: "colgroup", colspan: String(LOOT_GRADES.length), class: "grp" }, `${group} by `, statLink("grade", "battle grade")));
  const head2 = el("tr", {}, ...LOOT_GRADES.map((g) => el("th", { scope: "col", class: gradeCls(g, pick), title: `Grade ${GRADE_LETTERS[g - 1]}` },
    gradeBadge(GRADE_LETTERS[g - 1]))));
  return el("div", { class: "table-wrap loot-wrap" }, el("table", { class: "loot-table loot-cols" }, lootColgroup(), el("thead", {}, head1, head2), el("tbody", {}, ...rows)));
}

/** "Every win": each fixed material, its chance at the page's grade and its amount range per grade at its size. */
function everyWinTable(fixed: [number, number, number][], grade: number, size: number): HTMLElement {
  return lootGrid([["Item", false], ["Rarity", false], ["Chance", true]], "Amount", fixed.map(([mid, lo, hi]) => {
    const byGrade = LOOT_GRADES.map((g) => fixedAmounts([mid, lo, hi], g, 0, size));
    const got = 100 * (1 - (byGrade[grade - 1].get(0) ?? 0));
    return el("tr", {}, itemCell("material", mid), rarityCell("material", mid), el("td", { class: "num", title: `At grade ${GRADE_LETTERS[grade - 1]}` }, pctText(got)),
      ...byGrade.map((a, i) => {
        const none = a.get(0) ?? 0;
        const pos = new Map([...a].filter(([k]) => k > 0));
        return el("td", { class: gradeCls(i + 1, grade), title: amountOddsText(a) }, pos.size ? amountRange(pos) : "0",
          ...(none > 0 ? [el("span", { class: "muted small" }, ` · none ${pctText(100 * none)}`)] : []));
      }));
  }), grade);
}

/** A loot roll's rows ("Nothing" included, id -1) from the most likely at `grade` to the least; ties keep the data order. */
export function rollOrder(t: { nothing: number[]; rows: { chance: number[] }[] }, grade: number): number[] {
  const at = (i: number) => (i < 0 ? t.nothing : t.rows[i].chance)[grade - 1] ?? 0;
  return [-1, ...t.rows.map((_, i) => i)].map((i, n) => [i, n]).sort((a, b) => at(b[0]) - at(a[0]) || a[1] - b[1]).map(([i]) => i);
}

/**
 * One loot roll: every item and "Nothing", each with its chance per grade (each grade column adds up to 100 %), from
 * the most likely at the page's grade (U60). Nothing is a row like the others (same columns; no rarity or amount).
 */
function rollTable(name: string, grade: number, size: number): HTMLElement {
  const t = lootTable(name, 0, size)!;
  const pcts = (cs: number[]) => cs.map((c, i) => el("td", { class: gradeCls(i + 1, grade) }, pctText(c)));
  const row = (i: number) => {
    if (i < 0) return el("tr", { class: "loot-none" }, el("td", {}, el("span", { class: "loot-item" }, "Nothing")), dash(), dash(true), ...pcts(t.nothing));
    const r = t.rows[i];
    return el("tr", {}, itemCell(r.type, r.id), rarityCell(r.type, r.id),
      el("td", { class: "num", title: amountOddsText(r.amounts) }, amountRange(r.amounts)), ...pcts(r.chance));
  };
  return lootGrid([["Item", false], ["Rarity", false], ["Amount", true]], "Chance", rollOrder(t, grade).map(row), grade);
}

function dropsBlock(c: EnemyContext, rare: boolean): HTMLElement {
  const { fixed, rolls } = enemyDrops(c.id, rare);
  const size = sizeOf(c, rare);
  const kids: Node[] = [];
  if (fixed.length) kids.push(el("p", { class: "loot-title" }, "Every win"), everyWinTable(fixed, c.cfg.grade, size));
  rolls.forEach((p, n) => kids.push(el("p", { class: "loot-title" }, rolls.length > 1 ? `Loot roll ${n + 1}` : "Loot roll"), rollTable(p, c.cfg.grade, size)));
  if (!kids.length) return el("p", { class: "muted" }, "No drops.");
  return el("div", { class: "drops" }, ...kids);
}

const TIMELINE_HELP = "One skill per turn, turns 1–5, then the rotation starts over. Each card is the skill of that turn and "
  + "what it does; click a card for the skill's page.";
/** U30: the grade and luck formulas live on Stats › Grade and Stats › Luck (the "?" links there). */
const DROPS_HELP = [
  "Per win, at the page's quest size (the rare variant and a map room ×1), party luck 0; the page's grade is highlighted.",
  "Every win: an amount range per grade, at most 5 per enemy. Chance is at the page's grade; hover an amount for its odds.",
  "Each loot roll gives one row, or nothing, most likely first; each grade column adds up to 100 %. Party luck raises both.",
];
const dropsRefs = () => [statLink("grade", "Grade"), statLink("luck", "Luck"), statLink("quest-size", "Quest size ×N")];

/**
 * R2-D F45: the timeline and the drops are two sections of the page (no longer tables nested in a card per variant);
 * with a rare variant, each section has one column per variant under a small-caps name.
 */
function variantCols(id: number, part: (rare: boolean) => HTMLElement): HTMLElement {
  if (!hasRare(id)) return part(false);
  const q = quest(id);
  return el("div", { class: "variant-cols" }, ...[false, true].map((rare) => el("div", { class: `variant-col${rare ? " rare" : ""}` },
    el("h3", { class: "wiki-banner sub" }, enemyName(id, rare) ?? (rare ? q.nameB : q.name), ...(rare ? [" ", pill("rare", "t-pink")] : [])),
    part(rare))));
}
const timelinePart = (id: number, rare: boolean) => ((tl) => (tl ? enemyStrip(tl, { note: false }) : rotationList(id, rare)))(timelineOf(id, rare));

/** The maps the enemy appears in; maps the visitor hides (no Scribe expansion) are counted in a note (U28). */
function mapsTable(id: number, grade: number): HTMLElement {
  const all = enemyMapRoles(id);
  if (!all.length) return el("p", { class: "muted" }, "In no map: met only as a quest.");
  const roles = all.filter((r) => isVisible("map", r.map));
  const note = hiddenNote(all.length - roles.length, all.length - roles.length === 1 ? "map" : "maps");
  if (!roles.length) return note!;
  const hp = quest(id).enemyHp ?? 0;
  const rows: Row[] = roles.map(({ map, room, boss, treasure }) => {
    const m = item("map", map);
    const mod = m.enemyMod ?? 1;
    // U49: the HP the engine gives the enemy inside the plain map (sim/enemy with the run's map stats); U60: at the page's grade
    const view = mapView(map, NO_CONFIG, grade);
    const inMap = view ? mapEnemyStats(id, false, view.stats) : null;
    return { map, name: itemName("map", map) ?? m.name, level: m.itemLevel ?? null, role: [room ? "room" : "", boss ? "boss" : "", treasure ? "treasure" : ""].filter(Boolean).join(" "),
      mod, hp: inMap ? inMap.HP : hp, base: !inMap };
  });
  // R1 F42: maps no crafter can make (the level-70 maps) stay listed, marked.
  const t = table(rows, [
    { key: "name", label: "Map", render: (r) => el("span", {}, itemLink("map", Number(r.map)),
      ...(isCraftableMap(Number(r.map)) ? [] : [" ", uncraftableTag()])) },
    { key: "level", label: LV, num: true },
    { key: "role", label: "As", render: (r) => el("span", { class: "nowrap" }, ...String(r.role).split(" ").flatMap((x, i) => [...(i ? [" "] : []), pill(x, ROLE_TONE[x])])) },
    { key: "mod", label: "Enemy ×", num: true, render: (r) => el("span", { class: "mod-pair" }, `×${fmt.format(Number(r.mod))}`,
      withAsc(el("span", { class: "mod-asc" }, `×${fmt.format(Number(r.mod) * MAP_ASC_MOD)}`), 1)) },
    { key: "hp", label: "HP there", num: true, render: (r) => el("span", {}, fmt.format(Number(r.hp)),
      ...(r.base ? [" ", baseTag("The quest's own HP: the engine could not build this enemy in the map")] : [])) },
  ]);
  return note ? el("div", {}, t, note) : t;
}

/** The "?" text of an enemy page's Maps section. */
export const TREASURE_HELP = "A Treasure Bush hides in a random room of every map of its level band (maps of level 1–10, 11–20 … 51–60; none in "
  + "level-70 maps) at grade B or better (1% / 8% / 10% per room at B / A / S). Its stats take the map's enemy multiplier like any room enemy.";
function mapsHelp(id: number): string[] {
  return [`Enemy × is the map's multiplier of enemy stats; the silver outline is the same map at ascension 1 (×${MAP_ASC_MOD}).`,
    "HP there = the enemy's HP inside the plain map at the page's grade, from the map's multiplier as the game applies it (HP × 1.5 × (Enemy × − 1) / 2; Stats › Map essence).",
    ...(enemyMapRoles(id).some((r) => r.treasure) ? [TREASURE_HELP] : [])];
}

/**
 * Where a bush is fought, as a short fact (R1 F19: was a long bold paragraph): a quest bush (gathering quest) is the
 * first battle of its region's quest board (the region is the Region card), fought on its own like any quest; a map
 * Treasure Bush hides in a random room of the maps of its level band (the Level card) at map grade B or better.
 * The details are in the Maps section's "?" and on Battle › Two kinds of battle.
 */
function bushWhere(id: number): HTMLElement | undefined {
  if (isGathering(id)) return el("span", { class: "fact-compact" }, battleLink("quests-and-maps", "Quest board"), el("span", { class: "muted small" }, " · 1st battle"));
  if (isTreasureBush(id)) return el("span", { class: "fact-compact" }, battleLink("map-runs", "Map rooms"), el("span", { class: "muted small" }, " · grade B+"));
  return undefined;
}

/**
 * The game's material types of a bush's every-win drops, plural, in first-drop order (R1 F44): the quest bushes give
 * "herbs" (a moss and a root, potion ingredients), the Treasure Bushes "crystals", "gems" (a region's crystal and its
 * gem, e.g. Forest Crystal and Emerald). From the data (subType), so the wording can't drift from the game.
 */
export function bushDropKinds(id: number): string[] {
  const kinds = enemyDrops(id, false).fixed.map(([mid]) => String(item("material", mid)?.subType ?? "")).filter(Boolean);
  return [...new Set(kinds)].map((k) => (k.endsWith("s") ? k : `${k}s`));
}

/** The same as words: "herbs", "crystals and gems", "ores, metals and bars". */
export function bushDropText(id: number): string {
  const k = bushDropKinds(id);
  return k.length > 1 ? `${k.slice(0, -1).join(", ")} and ${k[k.length - 1]}` : k[0] ?? "";
}

/**
 * U60: the Party card of a quest (was the XP block's "Solo quest: 1 hero" line and its Party picker): a solo quest
 * "Solo · 1 hero", a party quest "1–N heroes" (tools/combat partyRules). None for a map room (R1 F41: the party is the
 * map run's).
 */
export function partyFact(id: number): string {
  const sizes = partySizes(id);
  const top = sizes[sizes.length - 1];
  return top > 1 ? `1–${top} heroes` : "Solo · 1 hero";
}

/**
 * U60: a map-only enemy's Map card: the map its cost, time and XP come from, with a small tag when other maps fight it
 * too (the rule in the tooltip).
 */
function runMapFact(c: EnemyContext): HTMLElement | undefined {
  if (!c.mapOnly) return undefined;
  if (!c.run) return el("span", { class: "muted" }, "none craftable");
  const tag = c.run.of > 1 ? [el("span", { class: "muted small", title: RUN_MAP_RULE }, ` · cheapest of ${c.run.of}`)] : [];
  return el("span", { class: "fact-compact" }, itemLink("map", c.run.map), ...tag);
}
const RUN_MAP_RULE = "Cost, time and XP are this map's: a map where it is the boss first, then the cheapest of the maps that fight it.";

type Section = (title: string, ...kids: (Node | string)[]) => HTMLElement;

/**
 * The Maps card: how many maps hold the enemy; "boss in N" only when it is not the boss of all of them (a map boss
 * is, and its Kind says so: R1 F41); "N craftable" when some can't be made (R1 F42: the level-70 maps).
 */
export function mapsFact(total: number, bossOf: number, craftable: number): string {
  return [String(total), ...(bossOf && bossOf < total ? [`boss in ${bossOf}`] : []), ...(craftable < total ? [`${craftable} craftable`] : [])].join(" · ");
}

/**
 * An enemy page's body, below its title and modifier bar, at the page's grade and quest size (U60). `empty`: an empty
 * section as one muted line (R2-D F54).
 */
export function enemyBody(id: number, section: Section, empty: (...parts: [string, string][]) => HTMLElement, cfg: EnemyConfig = ENEMY_DEFAULT): HTMLElement[] {
  const q = quest(id);
  const c = enemyContext(id, cfg);
  const rare = hasRare(id);
  const roles = enemyMapRoles(id);
  const bossOf = roles.filter((r) => r.boss).length;
  const craftable = roles.filter((r) => isCraftableMap(r.map)).length;
  const first = timelineOf(id, false)?.enemyFirst;
  const region = regionOf("enemy", id);
  return [
    // U56: the facts as cards (wiki-data factCards, as on the item pages); Region and Rare variant coloured on the card
    factCards([["Kind", enemyKind(id)],
      // A bush: the maps it spawns in (their levels), its quest level only as a detail (U28 follow-up).
      isTreasureBush(id) ? [LV, el("span", { class: "fact-compact" }, `Maps ${lv(enemyLevelText(id))}`, el("span", { class: "muted small" }, ` · quest ${lv(q.levelReq)}`)), WIDE] : [LV, q.levelReq],
      // R1 F41: no "map boss" / "event boss" tag (the Kind card says it); the reason only for a map boss (its first map).
      ["Region", ...regionCard(region, { why: region?.group === "map", tag: false })],
      ["Fought", bushWhere(id)], ["Party", isMapOnlyQuest(id) ? undefined : partyFact(id)], ["Map", runMapFact(c), c.run && c.run.of > 1 ? { title: RUN_MAP_RULE } : undefined],
      ["Acts", first ? battleLink("turn-order", "before the heroes, every turn") : undefined],
      ["Rare variant", rare ? el("span", {}, enemyLink({ id, rare: true }), q.abRand ? el("span", { class: "muted small" }, ` · about ${q.abRand}% of its map rooms`) : "") : undefined,
        { class: "fc-rare", title: "The enemy's rare variant" }],
      ["Maps", roles.length ? mapsFact(roles.length, bossOf, craftable) : "none"]]),
    sectionHelp(section("Stats", statsTable(c)), c.mapOnly ? STATS_HELP_MAP : STATS_HELP_QUEST,
      [statLink("hit-chance", "Eva: hit chance"), statLink("defence", "Def, Mdef: defence"), statLink("quest-size", "HP: quest size ×N"), statLink("xp"), statLink("time")]),
    ((tl) => sectionHelp(section("Timeline", variantCols(id, (r) => timelinePart(id, r))), tl ? [TIMELINE_HELP, stripNote(tl)] : TIMELINE_HELP,
      [battleLink("rotation")]))(timelineOf(id, false)),
    sectionHelp(section("Drops", variantCols(id, (r) => dropsBlock(c, r))), DROPS_HELP, dropsRefs()),
    roles.length ? sectionHelp(section(`Maps (${roles.length})`, mapsTable(id, cfg.grade)), mapsHelp(id), [statLink("map-essence")]) : empty(["Maps", "None: met only as a quest."]),
  ];
}

// ---------------------------------------------------------------- U60: the enemy page's modifier bar
/**
 * U60: Grade and Size pickers under an enemy page's title, in the maps' modifier bar (wiki-config CSS): grade D..S (a
 * Treasure Bush B..S), quest size ×1 up to ×5 for a quest-board quest (×4 and ×5 need a tier-3 hero: hidden with the
 * Frozen Tome unless the URL asks for them). A pick goes to the URL (replaceState, `?grade=4&size=3`) and to
 * `onChange`, which redraws the page under the bar. Null when there is nothing to pick.
 */
export function enemyConfigBar(id: number, start: EnemyConfig, onChange: (c: EnemyConfig) => void): HTMLElement | null {
  const grades = enemyGrades(id);
  const sizes = enemySizes(id, isVisible("prestige", 3) ? 3 : 2).concat(start.size > 3 && !isVisible("prestige", 3) ? enemySizes(id).filter((s) => s > 3 && s <= start.size) : []);
  if (grades.length < 2 && sizes.length < 2) return null;
  const cur = { ...start };
  const emit = () => {
    history.replaceState(history.state, "", `#/enemy/${id}${enemyConfigQuery(cur)}`);
    onChange({ ...cur });
  };
  const fields: HTMLElement[] = [];
  if (grades.length > 1) {
    fields.push(segField(statLink("grade", "Grade"), segmented(`cfg-grade-${id}`, "Grade", grades.map((g) => ({ value: String(g), label: gradeBadge(GRADE_LETTERS[g - 1]), title: `Grade ${GRADE_LETTERS[g - 1]}` })),
      String(cur.grade), (v) => {
        cur.grade = Number(v);
        emit();
      }), "cfg-grade"));
  }
  if (sizes.length > 1) {
    fields.push(segField(statLink("quest-size", "Size"), segmented(`cfg-size-${id}`, "Quest size", sizes.map((s) => ({ value: String(s), label: `×${s}`, title: `Quest size ×${s}` })),
      String(cur.size), (v) => {
        cur.size = Number(v);
        emit();
      }), "cfg-size"));
  }
  return el("div", { class: "wiki-config enemy-config", role: "group", "aria-label": "Show this enemy at" }, ...fields);
}

// ---------------------------------------------------------------- U53: "Fight in simulator"
/**
 * The Simulator's target for an enemy page, or null when its enemy picker doesn't offer it (battle-page questOptions):
 * a fight (HP and a rotation, battle-setup isFightable), shown by the visitor's expansions, in a region, and for a map
 * boss or a Treasure Bush (its "– Map" group) Scribe not hidden.
 */
export function enemyFightTarget(id: number): SimulatorTarget | null {
  const q = quest(id);
  if (!(q?.enemyHp && q.attackList && q.name && isEnemy(id)) || !isVisible("enemy", id)) return null;
  const r = regionOf("enemy", id);
  if (!r || ((r.group === "map" || isTreasureBush(id)) && isHidden("Scribe"))) return null;
  return { quest: id };
}

/** The Simulator's target for a map page (a catalog map run at the page's ascension), or null: no Scribe, map hidden. */
export function mapFightTarget(id: number, cfg: { asc: number }): SimulatorTarget | null {
  if (!item("map", id) || isHidden("Scribe") || !isVisible("map", id, { ascension: cfg.asc })) return null;
  return { map: id, ...(cfg.asc ? { asc: cfg.asc } : {}) };
}

/** The "Fight in simulator" button (a link to battle.html), nothing without a target; `title`: what it leaves out. */
export function fightButton(t: SimulatorTarget | null, title?: string): HTMLElement[] {
  if (!t) return [];
  return [el("div", { class: "fight-sim" }, el("a", { class: "fight-btn", href: simulatorHref(t), ...(title ? { title } : {}) }, "⚔️ Fight in simulator"))];
}

/**
 * U60: a details page's title line: the h1, then its "Fight in simulator" button on the same line, right-aligned; on a
 * narrow phone the button wraps under the title (site/style.css U60, `.title-line`).
 */
export function titleLine(h1: HTMLElement, actions: HTMLElement[] = []): HTMLElement {
  return el("div", { class: "title-line" }, h1, el("div", { class: "title-actions" }, ...actions));
}
