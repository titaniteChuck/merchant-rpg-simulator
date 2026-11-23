/**
 * Wiki enemy parts (#/enemies, #/enemy/ID, map enemy tables): one page per quest enemy, normal and rare variant
 * together, with stats, rotation, drops and the maps it appears in. Gathering quests and placeholders are not enemies
 * (NON_ENEMY_QUEST_IDS in wiki-data.ts).
 */
import { enemyStrip, timelineOf } from "./timeline.ts";
import { seq } from "../sim/lua.ts";
import { el, fmt, gradeBadge, GRADE_LETTERS, pill, type Row, table, withAsc } from "./dom.ts";
import { enemyDrops, enemyIds, enemyKind, enemyLink, enemyMapRoles, hasRare, item, itemLink, quest, skillDesc, skillLink } from "./wiki-data.ts";
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
  const r: Row = { id, rare, name: rare ? q.nameB : q.name, level: q.levelReq ?? null };
  for (const [k, label] of ENEMY_STATS) r[label] = q[k + sfx] !== undefined ? Math.round(q[k + sfx] * mod) : null;
  return r;
}

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
    { key: "level", label: "Level", num: true }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "skills", label: "Skills", render: (r) => skillLine(Number(r.id), !!r.rare) },
  ]);
}

// ---------------------------------------------------------------- list
/** Rows of the Enemies list: base stats of the normal variant, the rare variant's name, map count. */
export function enemyListRows(): Row[] {
  return enemyIds().map((id) => ({
    ...enemyRow(id, false), kind: enemyKind(id), rareName: hasRare(id) ? quest(id).nameB : "", maps: enemyMapRoles(id).length,
    skills: [...new Set([...rotation(id, false), ...(hasRare(id) ? rotation(id, true) : [])])].join(" "),
  }));
}

export const enemyListColumns = [
  { key: "name", label: "Enemy", render: (r: Row) => enemyLink({ id: Number(r.id), name: String(r.name) }) },
  { key: "rareName", label: "Rare variant", render: (r: Row) => (r.rareName ? enemyLink({ id: Number(r.id), name: String(r.rareName), rare: true }) : el("span", { class: "muted" }, "–")) },
  { key: "kind", label: "Kind" }, { key: "level", label: "Level", num: true },
  ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
  { key: "maps", label: "Maps", num: true },
];

// ---------------------------------------------------------------- page
function statsTable(id: number): HTMLElement {
  const q = quest(id);
  const rows = [false, ...(hasRare(id) ? [true] : [])].map((rare) => {
    const sfx = rare ? "B" : "";
    return { ...enemyRow(id, rare), xp: q[`exp${sfx}`] ?? null, gold: q[`gold${sfx}`] ?? null };
  });
  return table(rows, [
    { key: "name", label: "Variant", render: (r) => el("span", { class: "nowrap" }, String(r.name), ...rarePill(r)) },
    { key: "level", label: "Level", num: true }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "xp", label: "XP", num: true }, { key: "gold", label: "Gold", num: true },
  ]);
}

/** The 5-turn rotation, numbered like the save viewer's (ol.rotation): skill and effect (enemies spend no AP). */
function rotationList(id: number, rare: boolean): HTMLElement {
  return el("ol", { class: "rotation" }, ...rotation(id, rare).map((s) => el("li", {}, skillLink(s),
    ...(s !== "Basic" && skillDesc(s) ? [el("span", { class: "eff muted small" }, skillDesc(s))] : []))));
}

const banner = (text: string, ...kids: (Node | string)[]) => el("h4", { class: "wiki-banner sub" }, text, ...kids);
const baseCls = (grade: number) => (grade === BASE_GRADE ? "num base" : "num");
const itemCell = (type: string, id: number) =>
  el("td", {}, el("span", { class: "loot-item" }, itemLink(type, id), rarityChip(item(type, id)?.rarity)));

/** A static drop table: two header rows (the grade columns grouped under `group`, B marked as the base), then the rows. */
function lootGrid(firstCols: string[], group: string, rows: HTMLTableRowElement[]): HTMLElement {
  const head1 = el("tr", {}, ...firstCols.map((c, i) => el("th", { scope: "col", rowspan: "2", class: i ? "num" : "" }, c)),
    el("th", { scope: "colgroup", colspan: String(LOOT_GRADES.length), class: "grp" }, group));
  const head2 = el("tr", {}, ...LOOT_GRADES.map((g) => el("th", { scope: "col", class: baseCls(g), title: `Grade ${GRADE_LETTERS[g - 1]}${g === BASE_GRADE ? " (base odds)" : ""}` },
    gradeBadge(GRADE_LETTERS[g - 1]))));
  return el("div", { class: "table-wrap loot-wrap" }, el("table", { class: "loot-table" }, el("thead", {}, head1, head2), el("tbody", {}, ...rows)));
}

/** "Every win": each fixed material, its chance at grade B and its amount range per grade (hover: the odds). */
function everyWinTable(fixed: [number, number, number][]): HTMLElement {
  return lootGrid(["Item", "Chance"], "Amount by battle grade", fixed.map(([mid, lo, hi]) => {
    const byGrade = LOOT_GRADES.map((g) => fixedAmounts([mid, lo, hi], g));
    const got = 100 * (1 - (byGrade[BASE_GRADE - 1].get(0) ?? 0));
    return el("tr", {}, itemCell("material", mid), el("td", { class: "num" }, pctText(got)),
      ...byGrade.map((a, i) => {
        const none = a.get(0) ?? 0;
        const pos = new Map([...a].filter(([k]) => k > 0));
        return el("td", { class: baseCls(i + 1), title: amountOddsText(a) }, pos.size ? amountRange(pos) : "0",
          ...(none > 0 ? [el("span", { class: "muted small" }, ` · none ${pctText(100 * none)}`)] : []));
      }));
  }));
}

/** One loot roll: every item and "Nothing", each with its chance per grade (each grade column adds up to 100 %). */
function rollTable(name: string): HTMLElement {
  const t = lootTable(name)!;
  const rows = t.rows.map((r) => el("tr", {}, itemCell(r.type, r.id),
    el("td", { class: "num", title: amountOddsText(r.amounts) }, amountRange(r.amounts)),
    ...r.chance.map((c, i) => el("td", { class: baseCls(i + 1) }, pctText(c)))));
  rows.push(el("tr", { class: "loot-nothing" }, el("td", {}, "Nothing"), el("td", { class: "num muted" }, "–"),
    ...t.nothing.map((c, i) => el("td", { class: baseCls(i + 1) }, pctText(c)))));
  return lootGrid(["Item", "Amount"], "Chance by battle grade", rows);
}

function dropsBlock(id: number, rare: boolean): HTMLElement {
  const { fixed, rolls } = enemyDrops(id, rare);
  const kids: Node[] = [];
  if (fixed.length) kids.push(el("p", { class: "loot-title" }, "Every win"), everyWinTable(fixed));
  rolls.forEach((p, n) => {
    kids.push(el("p", { class: "loot-title" }, rolls.length > 1 ? `Loot roll ${n + 1}` : "Loot roll", el("span", { class: "muted small" }, ` · table “${p}”`)),
      rollTable(p));
  });
  if (!kids.length) return el("p", { class: "muted" }, "No drops.");
  return el("div", { class: "drops" }, ...kids);
}

/** One card per variant: rotation, then drops. */
function variantCard(id: number, rare: boolean): HTMLElement {
  const q = quest(id);
  return el("div", { class: `enemy-variant${rare ? " rare" : ""}` },
    el("h3", {}, rare ? q.nameB : q.name, ...(rare ? [" ", pill("rare", "t-pink")] : [])),
    ...(() => {
      const tl = timelineOf(id, rare);
      return tl ? [banner("Timeline"), enemyStrip(tl)] : [];
    })(),
    banner("Rotation"), rotationList(id, rare),
    banner("Drops"), dropsBlock(id, rare));
}

function mapsTable(id: number): HTMLElement {
  const roles = enemyMapRoles(id);
  if (!roles.length) return el("p", { class: "muted" }, "In no map: met only as a quest.");
  const hp = quest(id).enemyHp ?? 0;
  const rows: Row[] = roles.map(({ map, room, boss, treasure }) => {
    const m = item("map", map);
    const mod = m.enemyMod ?? 1;
    return { map, name: m.name, level: m.itemLevel ?? null, role: [room ? "room" : "", boss ? "boss" : "", treasure ? "treasure" : ""].filter(Boolean).join(" "),
      mod, hp: Math.round(hp * mod) };
  });
  const tone: Record<string, string> = { boss: "t-orange", room: "t-slate", treasure: "t-gold" };
  return el("div", {}, table(rows, [
    { key: "name", label: "Map", render: (r) => itemLink("map", Number(r.map)) }, { key: "level", label: "Level", num: true },
    { key: "role", label: "As", render: (r) => el("span", { class: "nowrap" }, ...String(r.role).split(" ").flatMap((x, i) => [...(i ? [" "] : []), pill(x, tone[x])])) },
    { key: "mod", label: "Enemy ×", num: true, render: (r) => el("span", { class: "mod-pair" }, `×${fmt.format(Number(r.mod))}`,
      withAsc(el("span", { class: "mod-asc" }, `×${fmt.format(Number(r.mod) * MAP_ASC_MOD)}`), 1)) },
    { key: "hp", label: "HP there", num: true },
  ]), el("p", { class: "muted small" }, `Enemy × multiplies every stat of the enemy; the silver outline is the same map at ascension 1 (×${MAP_ASC_MOD}). `
    + "HP there = base HP × the map's multiplier, before grade, suffix and ascension."
    + (roles.some((r) => r.treasure) ? " Treasure: hides in a room of maps of its level band at grade B or better (1% / 8% / 10% per room at B / A / S)." : "")));
}

type Facts = (pairs: [string, Node | string | number | undefined | null][]) => HTMLElement;
type Section = (title: string, ...kids: (Node | string)[]) => HTMLElement;

/** An enemy page's body, below its title. */
export function enemyBody(id: number, facts: Facts, section: Section): HTMLElement[] {
  const q = quest(id);
  const rare = hasRare(id);
  const roles = enemyMapRoles(id);
  const bossOf = roles.filter((r) => r.boss).length;
  return [
    facts([["Kind", enemyKind(id)], ["Level", q.levelReq], ["Region", q.region], ["Party", q.party ? `${q.questSize ?? "?"} heroes` : "solo"],
      ["Rare variant", rare ? el("span", {}, enemyLink({ id, rare: true }), q.abRand ? el("span", { class: "muted small" }, ` · about ${q.abRand}% of its map rooms`) : "") : undefined],
      ["Maps", roles.length ? `${roles.length}${bossOf ? ` (boss in ${bossOf})` : ""}` : "none"]]),
    section("Stats", statsTable(id), el("p", { class: "muted small" }, "Quest stats, before any map multiplier, grade or game mode.")),
    section("Rotation and drops", el("div", { class: "enemy-variants" }, variantCard(id, false), ...(rare ? [variantCard(id, true)] : [])),
      el("p", { class: "muted small" }, "One skill per turn, turns 1–5, then the rotation starts over. Drops (obj.combat.lootService) are per win "
        + "against one enemy (a map room), party luck 0. Every win: the amount range × the grade bonus (D–S ×0.6, ×0.75, ×1, "
        + "×1.25, ×1.5), rounded, at most 5. Each loot roll gives one row: the grade scales the “nothing” odds (D–S ×1.25, ×1.1, "
        + "×1, ×0.9, ×0.75), so the item chances move with it. Party luck adds to every-win amounts (+1 per 10 luck) and takes "
        + "from the “nothing” odds one for one. B (shaded) is the base grade; hover an amount for its odds.")),
    section(`Maps (${roles.length})`, mapsTable(id)),
  ];
}
