/**
 * What the wiki knows about skills, passives, items, maps and classes: summaries (tooltips, list pages),
 * cross-references (who uses a skill, recipes, drops) and links to wiki.html. Game numbers come from
 * data/gamedata.json (loaded into G), texts from data/wikidata.json.
 */
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { ascLevel, ascText, el, fmt, withAsc } from "./dom.ts";
import { tip } from "./tooltip.ts";

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

/** "+25% HP", "+12 Crit", "+1 Acc per level", "+35% crit damage". */
export function statText(key: string, v: number): string {
  const sign = v < 0 ? "−" : "+";
  const a = Math.abs(v);
  if (key.endsWith("Pct")) return `${sign}${fmt.format(a * 100)}% ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)}`;
  if (key === "critMod") return `${sign}${fmt.format(a * 100)}% crit damage`;
  if (key.endsWith("Plv")) return `${sign}${a} ${STAT_NAMES[key.slice(0, -3)] ?? key.slice(0, -3)} per level`;
  if (key === "expMod" || key === "lckMod") return `${sign}${fmt.format(a)}${key === "expMod" ? "%" : ""} ${STAT_NAMES[key]}`;
  return `${sign}${fmt.format(a)} ${STAT_NAMES[key] ?? key}`;
}
const statsText = (stats: Any) => Object.entries<number>(stats ?? {}).map(([k, v]) => statText(k, v)).join(", ");

// ---------------------------------------------------------------- lookups
export const item = (type: string, id: number | string): Any => G.itemData?.[type]?.[id];
export const itemTypeLabel: Record<string, string> = { equipment: "Equipment", consumable: "Consumable", material: "Material", map: "Map" };

/** [id, entry] of an item table, in id order. */
export function items(type: string): [number, Any][] {
  return Object.entries<Any>(G.itemData?.[type] ?? {}).filter(([, v]) => v?.name).map(([k, v]) => [Number(k), v] as [number, Any])
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

/** Quest enemies (and their rare variant) that use a skill. */
export function enemiesWith(skill: string): { id: number; name: string; rare: boolean }[] {
  const out: { id: number; name: string; rare: boolean }[] = [];
  for (const [id, q] of Object.entries<Any>(G.questData ?? {})) {
    if (seq<string>(q.attackList ?? {}).includes(skill)) out.push({ id: Number(id), name: q.name, rare: false });
    if (q.nameB && seq<string>(q.attackListB ?? {}).includes(skill)) out.push({ id: Number(id), name: q.nameB, rare: true });
  }
  return out;
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

/** Where a material drops: quests (fixed rewards and loot tables) and map essence rewards. */
export function dropSources(id: number): { kind: "quest" | "map"; id: number; label: string; detail: string }[] {
  const out: { kind: "quest" | "map"; id: number; label: string; detail: string }[] = [];
  for (const [qid, q] of Object.entries<Any>(G.questData ?? {})) {
    for (const [key, rare] of [["rewardA1", false], ["rewardA2", false], ["rewardB1", true], ["rewardB2", true]] as const) {
      const r = seq<number>(q[key] ?? {});
      if (r[0] === id) out.push({ kind: "quest", id: Number(qid), label: rare ? q.nameB ?? q.name : q.name, detail: `${r[1]}–${r[2]} per win${rare ? " (rare)" : ""}` });
    }
    for (const [key, rare] of [["rewardA3", false], ["rewardA4", false], ["rewardB3", true], ["rewardB4", true]] as const) {
      const p = q[key] ? G.parcelData?.[q[key]] : null;
      if (!p) continue;
      const list = seq<Any>(p.itemList ?? {});
      const total = (p.nilOdds ?? 0) + list.reduce((s, e) => s + (e.odds ?? 0), 0);
      for (const e of list) {
        const ids = seq<Any>(e.id ?? {});
        if (ids.length === 1 && ids[0] === id) {
          out.push({ kind: "quest", id: Number(qid), label: rare ? q.nameB ?? q.name : q.name,
            detail: `${fmt.format((100 * e.odds) / total)}% loot roll${rare ? " (rare)" : ""}` });
        }
      }
    }
  }
  for (const [mid, m] of items("map")) {
    const br = seq<number>(m.baseReward ?? {});
    const half = Math.floor(br.length / 2);
    for (let i = 0; i < half; i++) if (br[i] === id) out.push({ kind: "map", id: mid, label: m.name, detail: `${br[i + half]} essence per run` });
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
