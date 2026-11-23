/**
 * Wiki enemy parts (#/enemies, #/enemy/ID, map enemy tables): one page per quest enemy, normal and rare variant
 * together, with stats, rotation, drops and the maps it appears in. Placeholders are not enemies
 * (PLACEHOLDER_QUEST_IDS in wiki-data.ts); the quest bushes (gathering quests) are enemies, kind "Quest bush".
 */
import { enemyStrip, stripNote, timelineOf } from "./timeline.ts";
import { seq } from "../sim/lua.ts";
import { el, fmt, gradeBadge, GRADE_LETTERS, pill, type Row, table, withAsc } from "./dom.ts";
import {
  enemyDrops, enemyIds, enemyKind, enemyLevelSort, enemyLevelText, isGathering, isTreasureBush, enemyLink, enemyMapRoles, hasRare, item, itemLink, quest, regionChip, regionOf, regionSortKey, regionText,
  skillDesc, skillLink,
} from "./wiki-data.ts";
import { sectionHelp, withHelp } from "./wiki-help.ts";
import { isVisible } from "./expansion-state.ts";
import { hiddenNote } from "./expansion-menu.ts";
import { rarityChip } from "./wiki-items.ts";
import { amountOddsText, amountRange, BASE_GRADE, fixedAmounts, LOOT_GRADES, lootTable, pctText } from "./wiki-loot.ts";

/** [quest key (the rare variant adds "B"), label]. */
export const ENEMY_STATS: [string, string][] = [["enemyHp", "HP"], ["enemyAtk", "Atk"], ["enemyMatk", "Matk"], ["enemyDef", "Def"], ["enemyMdef", "Mdef"], ["enemyEva", "Eva"]];
/** Map enemy multiplier factor at map ascension 1 (defaults.mapEnemyModPreview). Maps ascend to 1 at most. */
const MAP_ASC_MOD = 2;

/** An enemy variant's stats × a map's multiplier. */
function enemyRow(id: number, rare: boolean, mod = 1): Row {
  const q = quest(id);
  const sfx = rare ? "B" : "";
  // A Treasure Bush shows the level range of the maps it spawns in and sorts by the lowest (enemyLevelText).
  const r: Row = { id, rare, name: rare ? q.nameB : q.name, level: isTreasureBush(id) ? enemyLevelSort(id) : q.levelReq ?? null, levelText: enemyLevelText(id) };
  for (const [k, label] of ENEMY_STATS) r[label] = q[k + sfx] !== undefined ? Math.round(q[k + sfx] * mod) : null;
  return r;
}

/** The Level cell: a bush's map level range ("1–10"), else the quest level. */
const levelCell = (r: Row) => String(r.levelText ?? r.level ?? "");
const rarePill = (r: Row) => (r.rare ? [" ", pill("rare", "t-pink")] : []);
const nameCell = (r: Row) => el("span", { class: "nowrap" }, enemyLink({ id: Number(r.id), name: String(r.name), rare: !!r.rare }), ...rarePill(r));
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
  return real.length ? real.map((s) => (s.count > 1 ? `${s.skill} ×${s.count}` : s.skill)).join(", ") : "Basic only";
}

/**
 * The Skills cell: the real skills linked (×N when a skill fills several turns), then "Basic ×N" muted; "Basic attack
 * only" when the enemy has no skill. The tooltip gives the turn-by-turn rotation.
 */
function skillLine(id: number, rare: boolean): HTMLElement {
  const list = rotation(id, rare);
  const sum = rotationSummary(list);
  const title = `Turns 1–${list.length}: ${list.join(" → ")}`;
  if (sum.every((s) => s.skill === "Basic")) return el("span", { class: "skill-line muted", title }, "Basic attack only");
  const parts = sum.map((s) => s.skill === "Basic"
    ? el("span", { class: "muted small" }, `Basic ×${s.count}`)
    : el("span", { class: "nowrap" }, skillLink(s.skill), ...(s.count > 1 ? [el("span", { class: "muted small" }, ` ×${s.count}`)] : [])));
  return el("span", { class: "skill-line", title }, ...parts.flatMap((p, i) => (i ? [", ", p] : [p])));
}

/** Enemy stats for a map: one row per variant, stats × `mod`, names linked to the enemy pages. */
export function enemyTable(ids: number[], mod: number): HTMLElement {
  const rows: Row[] = [];
  for (const id of new Set(ids)) {
    if (!quest(id)?.name) continue;
    rows.push({ ...enemyRow(id, false, mod), skills: skillSummaryText(id, false) });
    if (hasRare(id)) rows.push({ ...enemyRow(id, true, mod), skills: skillSummaryText(id, true) });
  }
  return table(rows, [
    { key: "name", label: "Enemy", render: nameCell },
    { key: "level", label: "Level", num: true, render: levelCell }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "skills", label: "Skills", render: (r) => skillLine(Number(r.id), !!r.rare) },
  ]);
}

// ---------------------------------------------------------------- list
/**
 * Rows of the Enemies list: base stats of the normal variant, the rare variant's name, region, map count. In region
 * order (region, then event bosses, then map bosses: regionOf), then level, then quest id: `region` sorts the same way.
 */
export function enemyListRows(): Row[] {
  return enemyIds().map((id): Row => {
    const reg = regionOf("enemy", id);
    return {
      ...enemyRow(id, false), kind: enemyKind(id), rareName: hasRare(id) ? quest(id).nameB : "", maps: enemyMapRoles(id).length,
      region: regionSortKey(reg, enemyLevelSort(id)), regionId: reg?.id ?? 0, regionName: regionText(reg),
      skills: [...new Set([...rotation(id, false), ...(hasRare(id) ? rotation(id, true) : [])])].join(" "),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id));
}

/** Row class of a region-sorted list: `reg-N` (the CSS rules a line where the region changes, in any sort order). */
export const regionRowClass = (r: Row): string => `reg-${r.regionId ?? 0}`;

export const enemyListColumns = [
  { key: "name", label: "Enemy", render: (r: Row) => enemyLink({ id: Number(r.id), name: String(r.name) }) },
  { key: "rareName", label: "Rare variant", render: (r: Row) => (r.rareName ? enemyLink({ id: Number(r.id), name: String(r.rareName), rare: true }) : el("span", { class: "muted" }, "–")) },
  { key: "region", label: "Region", render: (r: Row) => regionChip(regionOf("enemy", Number(r.id))) },
  { key: "kind", label: "Kind" }, { key: "level", label: "Level", num: true, render: levelCell },
  ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
  { key: "maps", label: "Maps", num: true },
];

// ---------------------------------------------------------------- page
function statsTable(id: number): HTMLElement {
  const q = quest(id);
  const rows = [false, ...(hasRare(id) ? [true] : [])].map((rare) => {
    const sfx = rare ? "B" : "";
    return { ...enemyRow(id, rare), level: q.levelReq ?? null, xp: q[`exp${sfx}`] ?? null, gold: q[`gold${sfx}`] ?? null };
  });
  return table(rows, [
    { key: "name", label: "Variant", render: (r) => el("span", { class: "nowrap" }, String(r.name), ...rarePill(r)) },
    { key: "level", label: isTreasureBush(id) ? "Quest level" : "Level", num: true }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "xp", label: "XP", num: true }, { key: "gold", label: "Gold", num: true },
  ]);
}

/**
 * Without timeline data (data/timelines.json missing): the plain 5-turn rotation, numbered (ol.rotation), each skill
 * with its effect. U24: with the data, the timeline strip replaces it (each turn card carries the effect).
 */
function rotationList(id: number, rare: boolean): HTMLElement {
  return el("ol", { class: "rotation" }, ...rotation(id, rare).map((s) => el("li", {}, skillLink(s),
    ...(s !== "Basic" && skillDesc(s) ? [el("span", { class: "eff muted small" }, skillDesc(s))] : []))));
}

const banner = (text: string, ...kids: (Node | string)[]) => el("h4", { class: "wiki-banner sub" }, text, ...kids);
const dash = (num = false) => el("td", { class: num ? "num muted" : "muted" }, "–");
const itemCell = (type: string, id: number) => el("td", {}, el("span", { class: "loot-item" }, itemLink(type, id)));
const rarityCell = (type: string, id: number) => el("td", { class: "loot-rar" }, rarityChip(item(type, id)?.rarity));

/** A static drop table: two header rows (the grade columns grouped under `group`), then the rows. */
function lootGrid(firstCols: [string, boolean][], group: string, rows: HTMLTableRowElement[]): HTMLElement {
  const head1 = el("tr", {}, ...firstCols.map(([c, num]) => el("th", { scope: "col", rowspan: "2", class: num ? "num" : "" }, c)),
    el("th", { scope: "colgroup", colspan: String(LOOT_GRADES.length), class: "grp" }, group));
  const head2 = el("tr", {}, ...LOOT_GRADES.map((g) => el("th", { scope: "col", class: "num", title: `Grade ${GRADE_LETTERS[g - 1]}` },
    gradeBadge(GRADE_LETTERS[g - 1]))));
  return el("div", { class: "table-wrap loot-wrap" }, el("table", { class: "loot-table" }, el("thead", {}, head1, head2), el("tbody", {}, ...rows)));
}

/** "Every win": each fixed material, its chance at grade B and its amount range per grade (hover: the odds). */
function everyWinTable(fixed: [number, number, number][]): HTMLElement {
  return lootGrid([["Item", false], ["Rarity", false], ["Chance", true]], "Amount by battle grade", fixed.map(([mid, lo, hi]) => {
    const byGrade = LOOT_GRADES.map((g) => fixedAmounts([mid, lo, hi], g));
    const got = 100 * (1 - (byGrade[BASE_GRADE - 1].get(0) ?? 0));
    return el("tr", {}, itemCell("material", mid), rarityCell("material", mid), el("td", { class: "num", title: "At grade B" }, pctText(got)),
      ...byGrade.map((a) => {
        const none = a.get(0) ?? 0;
        const pos = new Map([...a].filter(([k]) => k > 0));
        return el("td", { class: "num", title: amountOddsText(a) }, pos.size ? amountRange(pos) : "0",
          ...(none > 0 ? [el("span", { class: "muted small" }, ` · none ${pctText(100 * none)}`)] : []));
      }));
  }));
}

/**
 * One loot roll: "Nothing" first, then every item, each with its chance per grade (each grade column adds up to
 * 100 %). Nothing is a row like the others (same columns; no rarity or amount).
 */
function rollTable(name: string): HTMLElement {
  const t = lootTable(name)!;
  const pcts = (cs: number[]) => cs.map((c) => el("td", { class: "num" }, pctText(c)));
  const nothing = el("tr", { class: "loot-none" }, el("td", {}, el("span", { class: "loot-item" }, "Nothing")), dash(), dash(true), ...pcts(t.nothing));
  const rows = t.rows.map((r) => el("tr", {}, itemCell(r.type, r.id), rarityCell(r.type, r.id),
    el("td", { class: "num", title: amountOddsText(r.amounts) }, amountRange(r.amounts)), ...pcts(r.chance)));
  return lootGrid([["Item", false], ["Rarity", false], ["Amount", true]], "Chance by battle grade", [nothing, ...rows]);
}

function dropsBlock(id: number, rare: boolean): HTMLElement {
  const { fixed, rolls } = enemyDrops(id, rare);
  const kids: Node[] = [];
  if (fixed.length) kids.push(el("p", { class: "loot-title" }, "Every win"), everyWinTable(fixed));
  rolls.forEach((p, n) => kids.push(el("p", { class: "loot-title" }, rolls.length > 1 ? `Loot roll ${n + 1}` : "Loot roll"), rollTable(p)));
  if (!kids.length) return el("p", { class: "muted" }, "No drops.");
  return el("div", { class: "drops" }, ...kids);
}

const TIMELINE_HELP = "One skill per turn, turns 1–5, then the rotation starts over. Each card is the skill of that turn and "
  + "what it does; click a card for the skill's page.";
const DROPS_HELP = [
  "Per win against one enemy (a map room), party luck 0.",
  "Every win: the amount range × the grade bonus (D–S ×0.6, ×0.75, ×1, ×1.25, ×1.5), rounded, at most 5. Chance is at grade B; "
  + "hover an amount for its odds.",
  "Each loot roll gives one row, or nothing: the grade scales the “nothing” odds (D–S ×1.25, ×1.1, ×1, ×0.9, ×0.75), so the "
  + "item chances move with it. Each grade column adds up to 100 %.",
  "Party luck adds to every-win amounts (+1 per 10 luck) and takes from the “nothing” odds one for one.",
];

/** One card per variant: the 5-turn timeline (each turn with its skill's effect), then drops. */
function variantCard(id: number, rare: boolean): HTMLElement {
  const q = quest(id);
  const tl = timelineOf(id, rare);
  return el("div", { class: `enemy-variant${rare ? " rare" : ""}` },
    el("h3", {}, rare ? q.nameB : q.name, ...(rare ? [" ", pill("rare", "t-pink")] : [])),
    withHelp(banner("Timeline"), tl ? [TIMELINE_HELP, stripNote(tl)] : TIMELINE_HELP, "the timeline"),
    tl ? enemyStrip(tl, { note: false }) : rotationList(id, rare),
    withHelp(banner("Drops"), DROPS_HELP, "the drops"), dropsBlock(id, rare));
}

/** The maps the enemy appears in; maps the visitor hides (no Scribe expansion) are counted in a note (U28). */
function mapsTable(id: number): HTMLElement {
  const all = enemyMapRoles(id);
  if (!all.length) return el("p", { class: "muted" }, "In no map: met only as a quest.");
  const roles = all.filter((r) => isVisible("map", r.map));
  const note = hiddenNote(all.length - roles.length, all.length - roles.length === 1 ? "map" : "maps");
  if (!roles.length) return note!;
  const hp = quest(id).enemyHp ?? 0;
  const rows: Row[] = roles.map(({ map, room, boss, treasure }) => {
    const m = item("map", map);
    const mod = m.enemyMod ?? 1;
    return { map, name: m.name, level: m.itemLevel ?? null, role: [room ? "room" : "", boss ? "boss" : "", treasure ? "treasure" : ""].filter(Boolean).join(" "),
      mod, hp: Math.round(hp * mod) };
  });
  const tone: Record<string, string> = { boss: "t-orange", room: "t-slate", treasure: "t-gold" };
  const t = table(rows, [
    { key: "name", label: "Map", render: (r) => itemLink("map", Number(r.map)) }, { key: "level", label: "Level", num: true },
    { key: "role", label: "As", render: (r) => el("span", { class: "nowrap" }, ...String(r.role).split(" ").flatMap((x, i) => [...(i ? [" "] : []), pill(x, tone[x])])) },
    { key: "mod", label: "Enemy ×", num: true, render: (r) => el("span", { class: "mod-pair" }, `×${fmt.format(Number(r.mod))}`,
      withAsc(el("span", { class: "mod-asc" }, `×${fmt.format(Number(r.mod) * MAP_ASC_MOD)}`), 1)) },
    { key: "hp", label: "HP there", num: true },
  ]);
  return note ? el("div", {}, t, note) : t;
}

/** The "?" text of an enemy page's Maps section. */
export const TREASURE_HELP = "A Treasure Bush hides in a random room of every map of its level band (maps of level 1–10, 11–20 … 51–60; none in "
  + "level-70 maps) at grade B or better (1% / 8% / 10% per room at B / A / S). Its stats take the map's enemy multiplier like any room enemy.";
function mapsHelp(id: number): string[] {
  return [`Enemy × multiplies every stat of the enemy; the silver outline is the same map at ascension 1 (×${MAP_ASC_MOD}).`,
    "HP there = base HP × the map's multiplier, before grade, suffix and ascension.",
    ...(enemyMapRoles(id).some((r) => r.treasure) ? [TREASURE_HELP] : [])];
}

/**
 * Where a bush is fought: a quest bush (gathering quest) is the first battle of its region's quest board, fought on its
 * own like any quest; a map Treasure Bush hides in a random room of the maps of its level band (Scribe content).
 */
function bushWhere(id: number): string | undefined {
  const region = regionOf("enemy", id)?.full ?? "its region";
  if (isGathering(id)) return `On the quest board of ${region}: its first battle, fought on its own like any quest (quest size up to ×5 with an ascended hero).`;
  if (isTreasureBush(id)) return `Only in maps (Scribe expansion): it hides in a random room of the maps of level ${enemyLevelText(id)}, at map grade B or better. Never on the quest board.`;
  return undefined;
}

/** What a bush mainly drops: its every-win materials, then what they are for. */
function bushDrops(id: number): HTMLElement | undefined {
  if (!isGathering(id) && !isTreasureBush(id)) return undefined;
  const fixed = enemyDrops(id, false).fixed.map(([mid]) => itemLink("material", mid));
  const what = isGathering(id) ? "mosses and roots, potion ingredients" : "crystals, stones and other special materials, plus a loot roll";
  return el("span", {}, ...fixed.flatMap((n, i) => [...(i ? [", "] : []), n]), el("span", { class: "muted small" }, ` · ${what}`));
}

type Facts = (pairs: [string, Node | string | number | undefined | null][]) => HTMLElement;
type Section = (title: string, ...kids: (Node | string)[]) => HTMLElement;

/** An enemy page's body, below its title. */
export function enemyBody(id: number, facts: Facts, section: Section): HTMLElement[] {
  const q = quest(id);
  const rare = hasRare(id);
  const roles = enemyMapRoles(id);
  const bossOf = roles.filter((r) => r.boss).length;
  const first = timelineOf(id, false)?.enemyFirst;
  return [
    facts([["Kind", enemyKind(id)],
      // A bush: the maps it spawns in (their levels), its quest level only as a detail (U28 follow-up).
      ["Level", isTreasureBush(id) ? `maps level ${enemyLevelText(id)} (quest level ${q.levelReq})` : q.levelReq], ["Region", regionChip(regionOf("enemy", id), true)],
      ["Fought", bushWhere(id)], ["Mainly drops", bushDrops(id)],
      ["Party", q.party ? `${q.questSize ?? "?"} heroes` : "solo"], ["Acts", first ? "before the heroes, every turn" : undefined],
      ["Rare variant", rare ? el("span", {}, enemyLink({ id, rare: true }), q.abRand ? el("span", { class: "muted small" }, ` · about ${q.abRand}% of its map rooms`) : "") : undefined],
      ["Maps", roles.length ? `${roles.length}${bossOf ? ` (boss in ${bossOf})` : ""}` : "none"]]),
    sectionHelp(section("Stats", statsTable(id)), "Quest stats, before any map multiplier, grade or game mode."),
    section("Timeline and drops",
      el("div", { class: "enemy-variants" }, variantCard(id, false), ...(rare ? [variantCard(id, true)] : []))),
    roles.length ? sectionHelp(section(`Maps (${roles.length})`, mapsTable(id)), mapsHelp(id)) : section("Maps", mapsTable(id)),
  ];
}
