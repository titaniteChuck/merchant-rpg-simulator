/**
 * Wiki enemy parts (#/enemies, #/enemy/ID, map enemy tables): one page per quest enemy, normal and rare variant
 * together, with stats, rotation, drops and the maps it appears in. Gathering quests and placeholders are not enemies
 * (NON_ENEMY_QUEST_IDS in wiki-data.ts).
 */
import { enemyStrip, timelineOf } from "./timeline.ts";
import { seq } from "../sim/lua.ts";
import { el, fmt, pill, type Row, table, withAsc } from "./dom.ts";
import { enemyDrops, enemyIds, enemyKind, enemyLink, enemyMapRoles, hasRare, item, itemLink, parcelRoll, quest, skillDesc, skillLink } from "./wiki-data.ts";

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

/** The distinct skills of a variant's rotation, linked. */
function skillLine(id: number, rare: boolean): HTMLElement {
  return el("span", { class: "skill-line" }, ...[...new Set(rotation(id, rare))].flatMap((s, i) => (i ? [", ", skillLink(s)] : [skillLink(s)])));
}

/** Enemy stats for a map: one row per variant, stats × `mod`, names linked to the enemy pages. */
export function enemyTable(ids: number[], mod: number): HTMLElement {
  const rows: Row[] = [];
  for (const id of new Set(ids)) {
    if (!quest(id)?.name) continue;
    rows.push(enemyRow(id, false, mod));
    if (hasRare(id)) rows.push(enemyRow(id, true, mod));
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

const amountText = (a: number[]) => {
  const lo = Math.min(...a), hi = Math.max(...a);
  return lo === hi ? `× ${lo}` : `× ${lo}–${hi}`;
};

function dropsBlock(id: number, rare: boolean): HTMLElement {
  const { fixed, rolls } = enemyDrops(id, rare);
  const kids: Node[] = [];
  if (fixed.length) {
    kids.push(el("h4", {}, "Every win"), el("ul", { class: "plain-list loot" }, ...fixed.map(([mid, lo, hi]) =>
      el("li", {}, itemLink("material", mid), el("span", { class: "muted small" }, ` × ${lo}–${hi}`)))));
  }
  rolls.forEach((p, n) => {
    const roll = parcelRoll(p)!;
    kids.push(el("h4", {}, rolls.length > 1 ? `Loot roll ${n + 1}` : "Loot roll", el("span", { class: "muted small" }, ` · nothing ${fmt.format(roll.nilPct)}%`)),
      el("ul", { class: "plain-list loot" }, ...roll.entries.map((e) => el("li", {},
        el("span", { class: "loot-pct" }, `${fmt.format(e.pct)}%`), itemLink(e.type, e.id), el("span", { class: "muted small" }, ` ${amountText(e.amounts)}`)))));
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
      return tl ? [el("h4", {}, "Timeline"), enemyStrip(tl)] : [];
    })(),
    el("h4", {}, "Rotation"), rotationList(id, rare),
    el("h4", {}, "Drops"), dropsBlock(id, rare));
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
      el("p", { class: "muted small" }, "One skill per turn, turns 1–5, then the rotation starts over. Drops are per win at base odds: "
        + "a higher battle grade and party luck shrink the “nothing” share; amounts before the grade bonus.")),
    section(`Maps (${roles.length})`, mapsTable(id)),
  ];
}
