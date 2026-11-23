/**
 * What the wiki knows about skills, passives, items, maps and classes: summaries (tooltips, list pages),
 * cross-references (who uses a skill, recipes, drops) and links to wiki.html. Game numbers come from
 * data/gamedata.json (loaded into G), texts from data/wikidata.json.
 */
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { ascLevel, ascText, el, fmt, withAsc } from "./dom.ts";
import { tip } from "./tooltip.ts";
import { bonusPair, bonusText, isPlaceholder } from "./wiki-items.ts";
import { BASE_GRADE, lootTable } from "./wiki-loot.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface WikiText {
  skills: Record<string, string>;
  items: Record<string, Record<string, string[]>>;
  classes: Record<string, string[]>;
}
let text: WikiText = { skills: {}, items: {}, classes: {} };
let textReady: Promise<void> | null = null;

/** Load data/wikidata.json once (tooltips work without it, with numbers only). */
export function loadWikiText(): Promise<void> {
  textReady ??= fetch("data/wikidata.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j) text = j;
  }).catch(() => undefined);
  return textReady;
}

export const ITEM_TYPES = ["equipment", "consumable", "material", "map"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const SLOT_NAMES: Record<number, string> = { 1: "Weapon", 2: "Head", 3: "Body", 4: "Hands", 5: "Feet", 6: "Trinket" };
export const GRADES = ["D", "C", "B", "A", "S"];

// ---------------------------------------------------------------- stats
const STAT_NAMES: Record<string, string> = {
  hp: "HP", maxHP: "max HP", atk: "Atk", matk: "Matk", acc: "Acc", def: "Def", mdef: "Mdef", eva: "Eva", crit: "Crit",
  critMod: "crit damage", speed: "speed", expMod: "XP", lckMod: "luck", str: "Str", int: "Int", dex: "Dex",
  apMod: "AP", charges: "charges", hpBns: "HP", atkBns: "Atk", matkBns: "Matk", accBns: "Acc", critBns: "Crit",
  defBns: "Def", mdefBns: "Mdef",
};

/**
 * "+25% HP", "+12 Crit", "+1 Acc per level", "+35% crit damage". An equipment bonus stat is a range { 1: min, 2: max }
 * (data.EquipmentData bonusStat), not a number: it reads "+20–25 Str" (U19: it used to print "+NaN Str").
 */
export function statText(key: string, v: number | unknown): string {
  if (typeof v !== "number") return bonusPair(v) ? bonusText(key, v) : "";
  const sign = v < 0 ? "−" : "+";
  const a = Math.abs(v);
  if (key.endsWith("Pct")) return `${sign}${fmt.format(a * 100)}% ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)}`;
  if (key === "critMod") return `${sign}${fmt.format(a * 100)}% crit damage`;
  if (key.endsWith("Plv")) return `${sign}${a} ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)} per level`;
  if (key === "expMod" || key === "lckMod") return `${sign}${fmt.format(a)}${key === "expMod" ? "%" : ""} ${STAT_NAMES[key]}`;
  return `${sign}${fmt.format(a)} ${STAT_NAMES[key] ?? key}`;
}
const statsText = (stats: Any) => Object.entries<number>(stats ?? {}).map(([k, v]) => statText(k, v)).filter(Boolean).join(", ");

// ---------------------------------------------------------------- lookups
export const item = (type: string, id: number | string): Any => G.itemData?.[type]?.[id];
export const itemTypeLabel: Record<string, string> = { equipment: "Equipment", consumable: "Consumable", material: "Material", map: "Map" };

/** [id, entry] of an item table, in id order; the game's unused placeholder rows left out (isPlaceholder). */
export function items(type: string): [number, Any][] {
  return Object.entries<Any>(G.itemData?.[type] ?? {}).filter(([, v]) => v?.name && !isPlaceholder(type, v)).map(([k, v]) => [Number(k), v] as [number, Any])
    .sort((a, b) => a[0] - b[0]);
}

export const skillNames = (): string[] => Object.keys(G.abilityData ?? {}).sort((a, b) => a.localeCompare(b));
export const passiveNames = (): string[] => Object.keys(G.passiveData ?? {}).filter((p) => p !== "None").sort((a, b) => a.localeCompare(b));
export const classes = (): [number, Any][] =>
  Object.entries<Any>(G.heroList ?? {}).filter(([, v]) => v?.name).map(([k, v]) => [Number(k), v] as [number, Any]).sort((a, b) => a[0] - b[0]);
export const quest = (id: number | string): Any => G.questData?.[id];

/** Classes that can learn a skill / take a passive. */
export function classesWith(kind: "skill" | "passive", name: string): [number, Any][] {
  return classes().filter(([, c]) => seq<string>(kind === "skill" ? c.skillList : c.passiveList).includes(name));
}

/**
 * Quest ids that are not fighters, so the wiki never lists them as enemies (Enemies list, "enemies with this skill",
 * enemy links, map roles). Static on purpose: the data has no single "is an enemy" flag. Built once by reading every
 * entry of questData (inventory/gamedata.json, 104 quests) next to decompiled/data.QuestData.lua:
 * - Gathering quests = questType 1 (nickname "Gathering", enemyAtk/Matk 0, rewards are herbs). The game treats them as
 *   non-fights too: scene.maps.MapEnemyDescriptionOverlay draws the enemy stats only when `questType ~= 1`.
 *   1 Forest, 11 Yarsol, 21 Aldur, 30 Vulkrum, 42 Grimhal, 77 Hoarfrost Gathering.
 * - Placeholders: nickname "MissNo", title "Placeholder", dummy stats (9999 HP, 999 Atk, level 99 or 50). Unused slots the
 *   game skips itself (data.OrderData: `nickname ~= "MissNo"`). 39–41 "Region 4 Other", 58–60 "Region 5",
 *   75 "Weekly 15", 76 "Region 6".
 * No map's room list or boss list holds any of them. Every other quest (questType 2–8: quests, bosses, Epic Bosses 61–74,
 * Map Bosses 91–98, Treasure Bushes 99–104) is a real fight and stays an enemy. Recheck when the game data changes
 * (test/wiki-data.test.ts fails if a new questType-1 or "MissNo" quest appears).
 */
export const NON_ENEMY_QUEST_IDS = new Set<number>([
  1, 11, 21, 30, 42, 77, // gathering quests (questType 1)
  39, 40, 41, 58, 59, 60, 75, 76, // "MissNo" placeholders
]);

/** A quest that is a real fight: named, not gathering, not a placeholder. */
export const isEnemy = (id: number): boolean => !NON_ENEMY_QUEST_IDS.has(id) && !!quest(id)?.name;
/** Quest ids of every enemy, in id order. */
export const enemyIds = (): number[] => Object.keys(G.questData ?? {}).map(Number).filter(isEnemy).sort((a, b) => a - b);
/** The quest has a rare variant with its own stats (nameB, enemyHpB…). */
export const hasRare = (id: number): boolean => !!quest(id)?.nameB && quest(id)?.enemyHpB !== undefined;
/** "Party Boss", "Map Boss", "Epic Boss"…, or "Quest" when the game gives no title. */
export const enemyKind = (id: number): string => quest(id)?.title || "Quest";

/** Enemies (and their rare variant) that use a skill; gathering quests and placeholders left out. */
export function enemiesWith(skill: string): { id: number; name: string; rare: boolean }[] {
  const out: { id: number; name: string; rare: boolean }[] = [];
  for (const id of enemyIds()) {
    const q = quest(id);
    if (seq<string>(q.attackList ?? {}).includes(skill)) out.push({ id, name: q.name, rare: false });
    if (q.nameB && seq<string>(q.attackListB ?? {}).includes(skill)) out.push({ id, name: q.nameB, rare: true });
  }
  return out;
}

/** One entry per distinct enemy name (a quest reused under the same name counts once), in quest order. */
export function enemyNamesWith(skill: string): { id: number; name: string; rare: boolean }[] {
  const seen = new Set<string>();
  return enemiesWith(skill).filter((e) => {
    const k = `${e.name}|${e.rare}`;
    if (!e.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Treasure Bush quest per map level band (obj.Map: treasureId[ceil(levelReq / 10)]); it hides in a room at grade B or
 * better (treasurePerRoomPerGradeChance: 1% / 8% / 10% per room at B / A / S).
 */
const TREASURE_IDS = [99, 100, 101, 102, 103, 104];
export const treasureBushOf = (mapLevel: number): number | undefined => TREASURE_IDS[Math.ceil(mapLevel / 10) - 1];

export interface MapRole { map: number; room: boolean; boss: boolean; treasure: boolean }
let rolesOf: Map<number, MapRole[]> | null = null;
/** Maps whose rooms, boss slot or treasure room hold this enemy, lowest map level first (non-enemies have none). */
export function enemyMapRoles(questId: number): MapRole[] {
  if (!rolesOf) {
    rolesOf = new Map();
    const sorted = items("map").sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0]);
    for (const [mid, m] of sorted) {
      const rooms = new Set(mapEnemies(m)), bosses = new Set(seq<number>(m.bossList ?? {}));
      const bush = treasureBushOf(m.itemLevel ?? 0);
      for (const q of new Set([...rooms, ...bosses, ...(bush ? [bush] : [])])) {
        if (isEnemy(q)) rolesOf.set(q, [...(rolesOf.get(q) ?? []), { map: mid, room: rooms.has(q), boss: bosses.has(q), treasure: q === bush }]);
      }
    }
  }
  return rolesOf.get(questId) ?? [];
}

/** Map ids that hold this enemy (rooms or boss), lowest map level first. */
export const enemyMaps = (questId: number): number[] => enemyMapRoles(questId).map((r) => r.map);

/** One entry of a loot table: an item, its share of the roll (percent) and the amounts it can come in. */
export interface LootEntry { type: string; id: number; pct: number; amounts: number[] }
/**
 * A parcel (loot table) at base odds (grade B, party luck 0): the "nothing" share and each item's share of one roll,
 * exact for the game's weightedRandom (wiki-loot.ts, which also gives the other grades). Amounts are the possible
 * stack sizes.
 */
export function parcelRoll(name: string): { nilPct: number; entries: LootEntry[] } | null {
  const t = lootTable(name);
  if (!t) return null;
  const g = BASE_GRADE - 1;
  return {
    nilPct: t.nothing[g],
    entries: t.rows.map((r) => ({ type: r.type, id: r.id, pct: r.chance[g], amounts: [...r.amounts.keys()] })),
  };
}

/** What one win against an enemy gives: fixed materials (min–max per win, before grade) and its loot-table rolls. */
export function enemyDrops(id: number, rare: boolean): { fixed: [number, number, number][]; rolls: string[] } {
  const q = quest(id) ?? {};
  const s = rare ? "B" : "A";
  const fixed = [1, 2].map((n) => seq<number>(q[`reward${s}${n}`] ?? {})).filter((r) => r[0]).map((r) => [r[0], r[1], r[2]] as [number, number, number]);
  const rolls = [3, 4].map((n) => q[`reward${s}${n}`]).filter((p) => typeof p === "string" && G.parcelData?.[p]);
  return { fixed, rolls };
}

/** [type, id, amount] ingredients of a craftable item. */
export function recipe(type: string, id: number): [string, number, number][] {
  const it = item(type, id);
  const mids = seq<number>(it?.materialID ?? {});
  if (!mids.length || !it.crafterID) return [];
  const types = seq<string>(it.materialType ?? {}), amounts = seq<number>(it.materialAmount ?? {});
  return mids.map((m, i) => [types[i] || "material", m, amounts[i] ?? 1]);
}

let usedIn: Map<string, [string, number, number][]> | null = null;
/** Items whose recipe needs this one: [type, id, amount]. */
export function usedInRecipes(type: string, id: number): [string, number, number][] {
  if (!usedIn) {
    usedIn = new Map();
    for (const t of ITEM_TYPES) {
      for (const [iid] of items(t)) {
        for (const [mt, mid, amt] of recipe(t, iid)) {
          const k = `${mt}:${mid}`;
          usedIn.set(k, [...(usedIn.get(k) ?? []), [t, iid, amt]]);
        }
      }
    }
  }
  return usedIn.get(`${type}:${id}`) ?? [];
}

/** Where an item drops: quests (fixed rewards and loot tables) and, for materials, map essence rewards. */
export function dropSources(id: number, type = "material"): { kind: "quest" | "map"; id: number; rare: boolean; label: string; detail: string }[] {
  const out: { kind: "quest" | "map"; id: number; rare: boolean; label: string; detail: string }[] = [];
  for (const [qid, q] of Object.entries<Any>(G.questData ?? {})) {
    for (const rare of [false, true]) {
      if (rare && !q.nameB) continue;
      const label = rare ? q.nameB : q.name, note = rare ? " (rare)" : "";
      const drops = enemyDrops(Number(qid), rare);
      if (type === "material") {
        for (const r of drops.fixed) if (r[0] === id) out.push({ kind: "quest", id: Number(qid), rare, label, detail: `${r[1]}–${r[2]} per win${note}` });
      }
      for (const p of drops.rolls) {
        for (const e of parcelRoll(p)?.entries ?? []) {
          if (e.type === type && e.id === id) out.push({ kind: "quest", id: Number(qid), rare, label, detail: `${fmt.format(e.pct)}% loot roll${note}` });
        }
      }
    }
  }
  if (type !== "material") return out;
  for (const [mid, m] of items("map")) {
    const br = seq<number>(m.baseReward ?? {});
    const half = Math.floor(br.length / 2);
    for (let i = 0; i < half; i++) if (br[i] === id) out.push({ kind: "map", id: mid, rare: false, label: m.name, detail: `${br[i + half]} essence per run` });
  }
  return out;
}

/** Map enemy pool as quest ids (ranges expanded). */
export function mapEnemies(m: Any): number[] {
  const out: number[] = [];
  for (const e of seq<Any>(m.enemyList ?? {})) {
    const r = seq<number>(e ?? {});
    if (typeof e === "number") out.push(e);
    else if (r.length === 2) for (let q = r[0]; q <= r[1]; q++) out.push(q);
    else out.push(...r);
  }
  return out;
}

// ---------------------------------------------------------------- texts
export const skillDesc = (name: string): string => text.skills[name] ?? "";
export const skillAp = (name: string): number | undefined => G.abilityData?.[name]?.apCost;
export const passiveText = (name: string): string => statsText(G.passiveData?.[name]?.stats) || "no bonus";
export const classText = (id: number): string => (text.classes[id] ?? []).join(" ");

/** Item description with its {stat} placeholders filled (consumables), or the flavour lines. */
export function itemText(type: string, id: number): string {
  const lines = text.items[type]?.[id] ?? [];
  const it = item(type, id);
  return lines.join(" ").replace(/\{(\w+)\}/g, (_, k) => (it?.stat?.[k] !== undefined ? fmt.format(it.stat[k]) : `{${k}}`)).trim();
}

/** One-line summary for tooltips and lists. */
export function itemSummary(type: string, id: number): string {
  const it = item(type, id);
  if (!it) return "";
  const head = [itemTypeLabel[type], type === "equipment" ? SLOT_NAMES[it.itemSlot] ?? it.subType : it.subType,
    it.itemLevel ? `level ${it.itemLevel}` : ""].filter(Boolean).join(" · ");
  const body = type === "consumable" ? itemText(type, id) || statsText(it.stat)
    : type === "map" ? mapLine(it) : type === "material" ? itemText(type, id) : statsText(it.bonusStat);
  return [head, body].filter(Boolean).join(" — ");
}

function mapLine(m: Any): string {
  const boss = seq<number>(m.bossList ?? {}).map((b) => quest(b)?.name).filter(Boolean).join(", ");
  const br = seq<number>(m.baseReward ?? {});
  const half = Math.floor(br.length / 2);
  const ess = Array.from({ length: half }, (_, i) => `${br[i + half]} ${item("material", br[i])?.name ?? `#${br[i]}`}`).join(", ");
  return [boss ? `boss ${boss}` : "", ess ? `${ess} per run` : "", m.baseEnemyAmount ? `${m.baseEnemyAmount} rooms` : ""].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- links
export const href = {
  skill: (n: string) => `wiki.html#/skill/${encodeURIComponent(n)}`,
  passive: (n: string) => `wiki.html#/passive/${encodeURIComponent(n)}`,
  item: (t: string, id: number) => `wiki.html#/${t === "map" ? "map" : `item/${t}`}/${id}`,
  cls: (id: number) => `wiki.html#/class/${id}`,
  enemy: (id: number) => `wiki.html#/enemy/${id}`,
};

function tipBox(title: string, kind: string, body: string, extra = ""): HTMLElement {
  return el("span", { class: "tip-body" }, el("strong", {}, title), el("span", { class: "tip-kind" }, kind),
    ...(body ? [el("span", {}, body)] : []), ...(extra ? [el("span", { class: "muted" }, extra)] : []));
}

/** A link to a skill's wiki page, with its effect on hover. */
export function skillLink(name: string, cls = ""): HTMLElement {
  if (name === "Basic") return el("span", { class: `wl skill basic ${cls}`.trim() }, name);
  const a = el("a", { class: `wl skill ${cls}`.trim(), href: href.skill(name) }, name);
  tip(a, () => tipBox(name, `Skill · ${skillAp(name) ?? "?"} AP`, skillDesc(name)));
  return a;
}

export function passiveLink(name: string, cls = ""): HTMLElement {
  if (!name || name === "None" || !G.passiveData?.[name]) return el("span", { class: `wl ${cls}`.trim() }, name || "none");
  const a = el("a", { class: `wl passive ${cls}`.trim(), href: href.passive(name) }, name);
  tip(a, () => tipBox(name, "Passive", passiveText(name)));
  return a;
}

/**
 * A link to an item or map, coloured by rarity, with a summary on hover. `label` shows modifiers (e.g. "Strong Iron Sword +3");
 * `asc` (0–2) outlines it silver or gold.
 */
export function itemLink(type: string, id: number, label?: string, rarity?: unknown, asc?: unknown): HTMLElement {
  const it = item(type, id);
  const r = typeof rarity === "number" ? rarity : it?.rarity ?? 1;
  const name = label ?? it?.name ?? `${type} #${id}`;
  if (!it) return withAsc(el("span", { class: `item rar-${r}` }, name), asc);
  const a = el("a", { class: `wl item rar-${r}`, href: href.item(type, id) }, name);
  const ascNote = ascLevel(asc) ? ` · ${ascText(asc)}` : "";
  tip(a, () => tipBox(it.name, itemSummary(type, id).split(" — ")[0] + ascNote, itemSummary(type, id).split(" — ")[1] ?? "",
    type === "equipment" ? itemText(type, id) : "")); // materials and consumables already show their text as the body
  withAsc(a, asc);
  return a;
}

export function classLink(id: number): HTMLElement {
  const c = G.heroList?.[id];
  const a = el("a", { class: `wl cls-${id}`, href: href.cls(id) }, c?.name ?? `class ${id}`);
  tip(a, () => tipBox(c?.name ?? "", "Hero class", classText(id)));
  return a;
}

/**
 * A link to an enemy's wiki page (normal and rare variant share the quest's page); the tooltip gives its kind, level
 * and the maps it appears in. Gathering quests and placeholders (NON_ENEMY_QUEST_IDS) stay plain text.
 */
export function enemyLink(e: { id: number; name?: string; rare?: boolean }): HTMLElement {
  const q = quest(e.id);
  const name = e.name ?? (e.rare ? q?.nameB : q?.name) ?? `quest #${e.id}`;
  if (!isEnemy(e.id)) return el("span", { class: "wl" }, name);
  const maps = enemyMaps(e.id);
  const kind = `${enemyKind(e.id)}${e.rare ? " · rare" : ""}${q?.levelReq !== undefined ? ` · level ${q.levelReq}` : ""}`;
  const where = maps.length ? `Appears in ${maps.map((m) => item("map", m)?.name).join(", ")}.` : "Quest only, in no map.";
  const a = el("a", { class: `wl enemy-link${e.rare ? " rare" : ""}`, href: href.enemy(e.id) }, name);
  tip(a, () => tipBox(name, kind, where));
  return a;
}
