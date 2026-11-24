/**
 * Wiki enemy parts (#/enemies, #/enemy/ID, map enemy tables): one page per quest enemy, normal and rare variant
 * together, with stats, rotation, drops and the maps it appears in. Placeholders are not enemies
 * (PLACEHOLDER_QUEST_IDS in wiki-data.ts); the quest bushes (gathering quests) are enemies, kind "Quest bush".
 */
import { enemyStrip, stripNote, timelineOf } from "./timeline.ts";
import { seq } from "../sim/lua.ts";
import { duration, el, fmt, gradeBadge, GRADE_LETTERS, pill, type Row, segField, segmented, table, withAsc } from "./dom.ts";
import {
  enemyDrops, enemyIds, enemyKind, enemyLevelSort, enemyLevelText, isGathering, isTreasureBush, enemyLink, enemyMapRoles, hasRare, item, itemLink, quest, regionChip, regionOf, regionSortKey, regionText,
  skillDesc, skillLink,
} from "./wiki-data.ts";
import { sectionHelp } from "./wiki-help.ts";
import { battleLink, statLink } from "./wiki-ref.ts";
import { isVisible } from "./expansion-state.ts";
import { hiddenNote } from "./expansion-menu.ts";
import { rarityChip } from "./wiki-items.ts";
import { enemyName, itemName, skillName } from "./names.ts";
import { amountOddsText, amountRange, BASE_GRADE, fixedAmounts, LOOT_GRADES, lootTable, pctText } from "./wiki-loot.ts";
import { isBoardQuest, isCraftableMap, isMapOnlyQuest } from "../tools/quest-stats.ts";
import { mapXpRows, partySizes, questXpRows, XP_DEFAULT_GRADE, xpText } from "./quest-xp.ts";

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

const dash = (num = false) => el("td", { class: num ? "num muted" : "muted" }, "–");
const itemCell = (type: string, id: number) => el("td", {}, el("span", { class: "loot-item" }, itemLink(type, id)));
const rarityCell = (type: string, id: number) => el("td", { class: "loot-rar" }, rarityChip(item(type, id)?.rarity));

/**
 * A static drop table: two header rows (the grade columns grouped under "`group` by battle grade", the words "battle
 * grade" linked to Stats › Grade), then the rows.
 */
function lootGrid(firstCols: [string, boolean][], group: string, rows: HTMLTableRowElement[]): HTMLElement {
  const head1 = el("tr", {}, ...firstCols.map(([c, num]) => el("th", { scope: "col", rowspan: "2", class: num ? "num" : "" }, c)),
    el("th", { scope: "colgroup", colspan: String(LOOT_GRADES.length), class: "grp" }, `${group} by `, statLink("grade", "battle grade")));
  const head2 = el("tr", {}, ...LOOT_GRADES.map((g) => el("th", { scope: "col", class: "num", title: `Grade ${GRADE_LETTERS[g - 1]}` },
    gradeBadge(GRADE_LETTERS[g - 1]))));
  return el("div", { class: "table-wrap loot-wrap" }, el("table", { class: "loot-table" }, el("thead", {}, head1, head2), el("tbody", {}, ...rows)));
}

/** "Every win": each fixed material, its chance at grade B and its amount range per grade (hover: the odds). */
function everyWinTable(fixed: [number, number, number][]): HTMLElement {
  return lootGrid([["Item", false], ["Rarity", false], ["Chance", true]], "Amount", fixed.map(([mid, lo, hi]) => {
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
  return lootGrid([["Item", false], ["Rarity", false], ["Amount", true]], "Chance", [nothing, ...rows]);
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
/** U30: the grade and luck formulas live on Stats › Grade and Stats › Luck (the "?" links there). */
const DROPS_HELP = [
  "Per win against one enemy (a map room, or a quest at ×1), party luck 0.",
  "Every win: an amount range per grade, at most 5. Chance is at grade B; hover an amount for its odds.",
  "Each loot roll gives one row, or nothing; each grade column adds up to 100 %. Party luck raises both.",
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
    return { map, name: itemName("map", map) ?? m.name, level: m.itemLevel ?? null, role: [room ? "room" : "", boss ? "boss" : "", treasure ? "treasure" : ""].filter(Boolean).join(" "),
      mod, hp: Math.round(hp * mod) };
  });
  const tone: Record<string, string> = { boss: "t-orange", room: "t-slate", treasure: "t-gold" };
  // R1 F42: maps no crafter can make (the level-70 maps) stay listed, marked, as the XP section leaves them out.
  const t = table(rows, [
    { key: "name", label: "Map", render: (r) => el("span", {}, itemLink("map", Number(r.map)),
      ...(isCraftableMap(Number(r.map)) ? [] : [" ", el("span", { class: "muted small nowrap", title: UNCRAFTABLE_TITLE }, "not craftable")])) },
    { key: "level", label: "Level", num: true },
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
 * Where a bush is fought, as a short fact (R1 F19: was a long bold paragraph): a quest bush (gathering quest) is the
 * first battle of its region's quest board (the region is the Region card), fought on its own like any quest; a map
 * Treasure Bush hides in a random room of the maps of its level band (the Level card) at map grade B or better.
 * The details are in the XP and Maps sections' "?" and on Battle › Two kinds of battle.
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

/** What a bush mainly drops: its every-win materials, then their game type ("herbs", "crystals and gems"). */
function bushDrops(id: number): HTMLElement | undefined {
  if (!isGathering(id) && !isTreasureBush(id)) return undefined;
  const fixed = enemyDrops(id, false).fixed.map(([mid]) => itemLink("material", mid));
  const kinds = bushDropText(id);
  return el("span", { class: "fact-compact" }, ...fixed.flatMap((n, i) => [...(i ? [", "] : []), n]),
    ...(kinds ? [el("span", { class: "muted small" }, ` · ${kinds}`)] : []));
}

// ---------------------------------------------------------------- XP and time (U33)
/**
 * A named segmented control (dom.ts segmented, R1-D): grade D–S, party size, map ascension. The radios are named after
 * the group (one XP block per page); `onPick` gets the picked value.
 */
function toggleGroup(label: string, options: [number, Node | string][], value: number, onPick: (v: number) => void): HTMLElement {
  return segField(label, segmented(`qxp-${label.toLowerCase()}`, label,
    options.map(([v, text]) => ({ value: String(v), label: text })), String(value), (v) => onPick(Number(v))));
}

/** Redraw a block after a pick, keeping the keyboard focus on the control that was used. */
function redraw(box: HTMLElement, draw: () => void): void {
  const name = (document.activeElement as HTMLInputElement | null)?.closest(".seg") ? (document.activeElement as HTMLInputElement).name : "";
  draw();
  if (name) box.querySelector<HTMLElement>(`input[name="${name}"]:checked`)?.focus();
}

const gradeToggle = (grade: number, onPick: (v: number) => void) =>
  toggleGroup("Grade", GRADE_LETTERS.map((l, i): [number, Node] => [i + 1, gradeBadge(l)]), grade, onPick);
const partyToggle = (sizes: number[], heroes: number, onPick: (v: number) => void) =>
  toggleGroup("Party", sizes.map((n): [number, string] => [n, `${n} ${n === 1 ? "hero" : "heroes"}`]), heroes, onPick);

/** A small table with linked headers ([label, numeric]). */
function xpTable(head: [Node | string, boolean][], rows: HTMLTableRowElement[]): HTMLElement {
  return el("div", { class: "table-wrap qxp-wrap" }, el("table", { class: "qxp-table" },
    el("thead", {}, el("tr", {}, ...head.map(([h, num]) => el("th", { scope: "col", class: num ? "num" : "" }, h)))),
    el("tbody", {}, ...rows)));
}
const numCell = (text: string, title?: string) => el("td", { class: "num", ...(title ? { title } : {}) }, text);

const QUEST_XP_HELP = [
  "Fought on its own from the region's quest board. XP is split between the heroes of the party; each living hero of a won quest gets this share.",
  "Time is the quest's own time at the chosen grade; the fight itself adds to it (the Battle page simulates it). Without XP or speed bonuses.",
  "×3 and ×5 need a tier-2 and a tier-3 hero; the rare variant is always ×1.",
];
const MAP_XP_HELP = [
  "Never on the quest board: you meet it by crafting one of these maps and running it room by room, so each fight costs a whole map.",
  "Craft: the crafter's time for the map (and the lower maps its recipe uses). Run: the walk through the map; the fights add to it. "
    + "XP per hero: the whole run with every room won. XP / min counts craft and run.",
  "The map's grade is its craft grade: it sets the rooms, the craft speed and the Treasure Bush odds.",
];

/**
 * The XP block's picks per enemy page (grade, party, map ascension), kept for the session in this module (R1 F03): a
 * re-render (another language, an expansion switch) or coming back to the page keeps them. Not in the URL: the hash
 * is the route.
 */
export interface XpPicks { grade: number; heroes: number; asc: number }
const xpPicks = new Map<number, XpPicks>();
export function xpPicksOf(id: number, heroes: number): XpPicks {
  if (!xpPicks.has(id)) xpPicks.set(id, { grade: XP_DEFAULT_GRADE, heroes, asc: 0 });
  return xpPicks.get(id)!;
}

/** Quest-board quest: XP per hero, time and XP / min per quest size, at a grade and party size picked on the page. */
function questXpBlock(id: number): HTMLElement {
  const sizes = partySizes(id);
  const p = xpPicksOf(id, sizes[0]);
  if (!sizes.includes(p.heroes)) p.heroes = sizes[0];
  let { grade, heroes } = p;
  const box = el("div", { class: "qxp" });
  const draw = () => {
    p.grade = grade, p.heroes = heroes;
    const rows = questXpRows(id, { grade, heroes }).map((r) => el("tr", r.rare ? { class: "rare" } : {},
      el("td", {}, el("span", { class: "nowrap" }, `×${r.amount}`, ...(r.rare ? [" ", pill("rare", "t-pink")]
        : r.tier > 1 ? [el("span", { class: "muted small" }, ` · tier ${r.tier}`)] : []))),
      numCell(xpText(r.xpPerHero)), numCell(duration(r.seconds), `${fmt.format(r.seconds)} s`), numCell(xpText(r.xpPerMin))));
    box.replaceChildren(
      el("div", { class: "qxp-controls" }, gradeToggle(grade, (v) => (grade = v, redraw(box, draw))),
        ...(sizes.length > 1 ? [partyToggle(sizes, heroes, (v) => (heroes = v, redraw(box, draw)))] : [el("span", { class: "muted small" }, "Solo quest: 1 hero")])),
      xpTable([[statLink("quest-size", "Size"), false], [statLink("xp", "XP per hero"), true], [statLink("time", "Time"), true], ["XP / min", true]], rows));
  };
  draw();
  return box;
}

const pctOfRuns = (p: number) => `${p >= 0.1 ? fmt.format(p * 100) : (p * 100).toFixed(1)}% of runs`;

/** Map-only enemy: the maps it is fought in, each with craft time, run time and XP per hero for the run. */
function mapXpBlock(id: number): HTMLElement {
  const p = xpPicksOf(id, 1);
  let { grade, heroes, asc } = p;
  const box = el("div", { class: "qxp" });
  const tone: Record<string, string> = { boss: "t-orange", room: "t-slate", treasure: "t-gold" };
  const roleCell = (role: string, perRun: number) => el("span", { class: "nowrap" }, pill(role, tone[role]),
    ...(perRun < 0.999 ? [el("span", { class: "muted small" }, ` · ${pctOfRuns(perRun)}`)] : []));
  const draw = () => {
    Object.assign(p, { grade, heroes, asc });
    const { rows, hidden, uncraftable } = mapXpRows(id, { grade, heroes, asc });
    const maps = [...new Set(rows.map((r) => r.map))];
    const where = maps.length
      ? el("p", { class: "qxp-where" }, el("strong", {}, "Fought in: "),
        ...maps.flatMap((m, i) => [...(i ? [", "] : []), itemLink("map", m, undefined, undefined, asc)]))
      : el("p", { class: "qxp-where muted" }, hidden && !uncraftable.length ? ""
        : isTreasureBush(id) && grade < 3 ? "Not at map grade D or C: a Treasure Bush needs grade B or better."
        : "In no map a crafter can make (level 60 at most).");
    const note = hiddenNote(hidden, hidden === 1 ? "map" : "maps");
    // R1 F42: the maps the Maps section lists but no crafter can make, named here so the two sections agree.
    // R2-D F44: closed by default, one summary line
    const left = uncraftable.length
      ? el("details", { class: "qxp-left muted small" }, el("summary", { title: UNCRAFTABLE_TITLE },
        `Left out: ${uncraftable.length} level-70 map${uncraftable.length === 1 ? "" : "s"}, not craftable`),
      el("p", {}, ...uncraftable.flatMap((m, i) => [...(i ? [", "] : []), itemLink("map", m)])))
      : null;
    box.replaceChildren(
      el("div", { class: "qxp-controls" }, gradeToggle(grade, (v) => (grade = v, redraw(box, draw))),
        partyToggle([1, 6], heroes, (v) => (heroes = v, redraw(box, draw))),
        toggleGroup("Ascension", [[0, "0"], [1, "1"]], asc, (v) => (asc = v, redraw(box, draw)))),
      ...(maps.length || !hidden || uncraftable.length ? [where] : []),
      ...(rows.length ? [xpTable([["Map", false], ["As", false], [statLink("craft", "Craft"), true], [statLink("time", "Run"), true],
        [statLink("xp", "XP per hero / run"), true], ["XP / min", true]], rows.map((r) => el("tr", {},
        el("td", {}, itemLink("map", r.map, undefined, undefined, asc)), el("td", {}, roleCell(r.role, r.perRun)),
        numCell(duration(r.craftSeconds)), numCell(duration(r.runSeconds)), numCell(xpText(r.xpPerHero)), numCell(xpText(r.xpPerMin)))))] : []),
      ...(left ? [left] : []), ...(note ? [note] : []));
  };
  draw();
  return box;
}

/** The enemy page's "XP and time" section: a quest-board quest or a map run; none for anything else. */
function xpSection(id: number, section: Section): HTMLElement | null {
  if (isBoardQuest(id)) return sectionHelp(section("XP and time", questXpBlock(id)), QUEST_XP_HELP, [statLink("xp"), statLink("time"), statLink("quest-size")]);
  if (isMapOnlyQuest(id)) return sectionHelp(section("XP and time", mapXpBlock(id)), MAP_XP_HELP, [statLink("xp"), statLink("time"), statLink("craft")]);
  return null;
}

type Facts = (pairs: [string | Node, Node | string | number | undefined | null][]) => HTMLElement;
type Section = (title: string, ...kids: (Node | string)[]) => HTMLElement;

/**
 * The Maps card: how many maps hold the enemy; "boss in N" only when it is not the boss of all of them (a map boss
 * is, and its Kind says so: R1 F41); "N craftable" when some can't be made (R1 F42: the level-70 maps).
 */
export function mapsFact(total: number, bossOf: number, craftable: number): string {
  return [String(total), ...(bossOf && bossOf < total ? [`boss in ${bossOf}`] : []), ...(craftable < total ? [`${craftable} craftable`] : [])].join(" · ");
}

/** The line under an enemy page's title: kind, level, region (R1 F40: "Lv N", no English glue around names). */
export function enemyLead(id: number): string {
  return [enemyKind(id), isTreasureBush(id) ? `Maps Lv ${enemyLevelText(id)}` : `Lv ${quest(id)?.levelReq ?? "?"}`, regionOf("enemy", id)?.full ?? ""].filter(Boolean).join(" · ");
}

/** An enemy page's body, below its title. `empty`: an empty section as one muted line (R2-D F54). */
export function enemyBody(id: number, facts: Facts, section: Section, empty: (...parts: [string, string][]) => HTMLElement): HTMLElement[] {
  const q = quest(id);
  const rare = hasRare(id);
  const roles = enemyMapRoles(id);
  const bossOf = roles.filter((r) => r.boss).length;
  const craftable = roles.filter((r) => isCraftableMap(r.map)).length;
  const first = timelineOf(id, false)?.enemyFirst;
  const region = regionOf("enemy", id);
  return [
    facts([["Kind", enemyKind(id)],
      // A bush: the maps it spawns in (their levels), its quest level only as a detail (U28 follow-up).
      ["Level", isTreasureBush(id) ? el("span", { class: "fact-compact" }, `Maps Lv ${enemyLevelText(id)}`, el("span", { class: "muted small" }, ` · quest Lv ${q.levelReq}`)) : q.levelReq],
      // R1 F41: no "map boss" / "event boss" tag (the Kind card says it); the reason only for a map boss (its first map).
      ["Region", regionChip(region, region?.group === "map", { tag: false })],
      ["Fought", bushWhere(id)], ["Mainly drops", bushDrops(id)],
      // A map-only enemy (map boss, Treasure Bush) is a map room: the party is the map run's, not the quest's.
      ["Party", isMapOnlyQuest(id) ? undefined : q.party ? `${q.questSize ?? "?"} heroes` : "solo"], ["Acts", first ? battleLink("turn-order", "before the heroes, every turn") : undefined],
      ["Rare variant", rare ? el("span", {}, enemyLink({ id, rare: true }), " ", pill("rare", "t-pink"), q.abRand ? el("span", { class: "muted small" }, ` · about ${q.abRand}% of its map rooms`) : "") : undefined],
      ["Maps", roles.length ? mapsFact(roles.length, bossOf, craftable) : "none"]]),
    ...((x) => (x ? [x] : []))(xpSection(id, section)),
    sectionHelp(section("Stats", statsTable(id)), "Quest stats, before any map multiplier, grade or game mode.",
      [statLink("hit-chance", "Eva: hit chance"), statLink("defence", "Def, Mdef: defence"), statLink("quest-size", "HP: quest size ×N")]),
    ((tl) => sectionHelp(section("Timeline", variantCols(id, (r) => timelinePart(id, r))), tl ? [TIMELINE_HELP, stripNote(tl)] : TIMELINE_HELP,
      [battleLink("rotation")]))(timelineOf(id, false)),
    sectionHelp(section("Drops", variantCols(id, (r) => dropsBlock(id, r))), DROPS_HELP, dropsRefs()),
    roles.length ? sectionHelp(section(`Maps (${roles.length})`, mapsTable(id)), mapsHelp(id), [statLink("map-essence")]) : empty(["Maps", "None: met only as a quest."]),
  ];
}
