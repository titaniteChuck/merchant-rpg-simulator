/**
 * Wiki page (site/wiki.html): bare stats of everything in the game, cross-linked. Hash routes:
 *   #/                          search + categories
 *   #/skills  #/skill/NAME      #/passives  #/passive/NAME
 *   #/items/TYPE  #/item/TYPE/ID   (equipment, consumable, material)
 *   #/maps    #/map/ID          #/classes   #/class/ID
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { sellValue } from "../tools/engine.ts";
import { $, ascLegend, ascText, type Column, el, fmt, gradeBadge, pill, type Row, table, withAsc } from "./dom.ts";
import { group, lineChart } from "./line-chart.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { tip } from "./tooltip.ts";
import {
  classesWith, classes, classLink, classText, dropSources, enemiesWith, enemyLink, enemyNamesWith, GRADES, href, item, itemLink,
  items, itemText, itemTypeLabel, loadWikiText, mapEnemies, passiveLink, passiveNames, passiveText, quest, recipe, SLOT_NAMES,
  skillAp, skillDesc, skillLink, skillNames, statText, usedInRecipes,
} from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ready = Promise.all([
  fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((j) => api.loadGameData(j)),
  loadWikiText(),
]);

const CATEGORIES: [string, string, string, () => number][] = [
  ["#/skills", "⚡", "Skills", () => skillNames().length],
  ["#/passives", "✨", "Passives", () => passiveNames().length],
  ["#/items/equipment", "⚔️", "Equipment", () => items("equipment").length],
  ["#/items/consumable", "🧪", "Consumables", () => items("consumable").length],
  ["#/items/material", "🪨", "Materials", () => items("material").length],
  ["#/maps", "🗺️", "Maps", () => items("map").length],
  ["#/classes", "🛡️", "Classes", () => classes().length],
];

// ---------------------------------------------------------------- building blocks
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const crumbs = (...parts: (string | [string, string])[]) => el("p", { class: "crumbs small" },
  ...[["Wiki", "#/"] as [string, string], ...parts].flatMap((p, i) => [
    ...(i ? [el("span", { "aria-hidden": "true" }, " › ")] : []),
    typeof p === "string" ? el("span", {}, p) : el("a", { href: p[1] }, p[0])]));

const facts = (pairs: [string, Node | string | number | undefined | null][]) =>
  el("dl", { class: "facts" }, ...pairs.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, typeof v === "number" ? fmt.format(v) : v as Node | string))));

const section = (title: string, ...kids: (Node | string)[]) => el("section", { class: "wiki-section" }, el("h2", {}, title), ...kids);
const none = (t: string) => el("p", { class: "muted" }, t);
const joinNodes = (nodes: Node[], sep = ", "): (Node | string)[] => nodes.flatMap((n, i) => (i ? [sep, n] : [n]));

function filterBox(placeholder: string, onInput: (q: string) => void): HTMLInputElement {
  const s = el("input", { type: "search", placeholder, "aria-label": placeholder }) as HTMLInputElement;
  s.addEventListener("input", () => onInput(s.value.trim().toLowerCase()));
  return s;
}

/** A filterable table page. */
function listPage(title: string, intro: string, rows: Row[], cols: Column[], search = (r: Row) => String(r.name)): HTMLElement {
  const holder = el("div");
  const count = el("span", { class: "muted small" });
  const show = (q: string) => {
    const shown = q ? rows.filter((r) => search(r).toLowerCase().includes(q)) : rows;
    count.textContent = `${shown.length} of ${rows.length}`;
    holder.replaceChildren(table(shown, cols));
  };
  show("");
  return el("div", {}, crumbs(title), el("h1", {}, title), el("p", { class: "lead" }, intro),
    el("div", { class: "toolbar" }, filterBox(`Filter ${title.toLowerCase()}`, show), count), holder);
}

// ---------------------------------------------------------------- home
function home(): HTMLElement {
  const results = el("div");
  const all: { label: string; kind: string; node: () => HTMLElement }[] = [
    ...skillNames().map((n) => ({ label: n, kind: "Skill", node: () => skillLink(n) })),
    ...passiveNames().map((n) => ({ label: n, kind: "Passive", node: () => passiveLink(n) })),
    ...(["equipment", "consumable", "material", "map"] as const).flatMap((t) =>
      items(t).map(([id, it]) => ({ label: it.name, kind: itemTypeLabel[t], node: () => itemLink(t, id) }))),
    ...classes().map(([id, c]) => ({ label: c.name, kind: "Class", node: () => classLink(id) })),
  ];
  const search = filterBox("Search skills, items, maps…", (q) => {
    if (!q) return results.replaceChildren();
    const hits = all.filter((x) => x.label.toLowerCase().includes(q)).slice(0, 60);
    results.replaceChildren(hits.length
      ? el("ul", { class: "hits" }, ...hits.map((h) => el("li", {}, h.node(), el("span", { class: "muted small" }, ` ${h.kind}`))))
      : none("Nothing matches."));
  });
  search.classList.add("big-search");
  return el("div", {}, el("h1", {}, "Wiki"),
    el("p", { class: "lead" }, "Bare stats of everything in the game, read from the game's data: skills, passives, items, maps and classes."),
    search, results,
    el("ul", { class: "cards wiki-cats" }, ...CATEGORIES.map(([h, icon, label, n]) =>
      el("li", {}, el("span", { class: "icon", "aria-hidden": "true" }, icon), el("h3", {}, el("a", { href: h }, label)),
        el("p", { class: "muted" }, `${fmt.format(n())} entries`)))));
}

// ---------------------------------------------------------------- skills & passives
const ENEMIES_SHOWN = 3;

/** The first few enemy names, then "+N more" with every name in its tooltip (a skill like Basic has 80+ users). */
function enemyCell(skill: string): HTMLElement {
  const list = enemyNamesWith(skill);
  if (!list.length) return el("span", { class: "muted" }, "–");
  const shown = list.slice(0, ENEMIES_SHOWN);
  const rest = list.length - shown.length;
  const more = rest > 0 ? el("span", { class: "more-names", tabindex: "0", "aria-label": `${rest} more: ${list.slice(ENEMIES_SHOWN).map((e) => e.name).join(", ")}` }, `+${rest} more`) : null;
  if (more) tip(more, () => el("span", { class: "tip-body" }, el("strong", {}, `${list.length} enemies use ${skill}`), el("span", {}, list.map((e) => e.name).join(", "))));
  return el("span", { class: "enemy-line" }, ...joinNodes(shown.map(enemyLink)), ...(more ? [" ", more] : []));
}

function skillsPage(): HTMLElement {
  const rows: Row[] = skillNames().map((n) => ({
    name: n, ap: skillAp(n) ?? null, classes: classesWith("skill", n).map(([, c]) => c.name).join(", "),
    // sorts by count; the cell shows the names
    enemies: enemyNamesWith(n).length, enemyNames: enemyNamesWith(n).map((e) => e.name).join(" "), effect: skillDesc(n),
  }));
  return listPage("Skills", "Every skill with its action-point cost and effect. Hero skills are learnt by class; the rest are enemy skills.", rows, [
    { key: "name", label: "Skill", render: (r) => skillLink(String(r.name)) }, { key: "ap", label: "AP", num: true },
    { key: "classes", label: "Classes", render: (r) => el("span", {}, ...joinNodes(classesWith("skill", String(r.name)).map(([id]) => classLink(id)))) },
    { key: "enemies", label: "Enemies", render: (r) => enemyCell(String(r.name)) }, { key: "effect", label: "Effect" },
  ], (r) => `${r.name} ${r.effect} ${r.classes} ${r.enemyNames}`);
}

function skillPage(name: string): HTMLElement {
  if (!G.abilityData?.[name]) return notFound(`skill “${name}”`);
  const users = classesWith("skill", name);
  const enemies = enemiesWith(name);
  return el("div", {}, crumbs(["Skills", "#/skills"], name), el("h1", {}, "⚡ ", name),
    el("p", { class: "lead" }, skillDesc(name) || "No description in the game data."),
    facts([["AP cost", skillAp(name)], ["Used by classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]),
    section(`Enemies with this skill (${enemies.length})`, enemies.length
      ? el("ul", { class: "plain-list" }, ...enemies.map((e) => el("li", {}, enemyLink(e), e.rare ? pill("rare", "t-pink") : "",
        el("span", { class: "muted small" }, ` level ${quest(e.id)?.levelReq ?? "?"}`))))
      : none("No quest enemy uses it.")));
}

function passivesPage(): HTMLElement {
  const rows: Row[] = passiveNames().map((n) => ({ name: n, bonus: passiveText(n), classes: classesWith("passive", n).map(([, c]) => c.name).join(", ") }));
  return listPage("Passives", "A hero picks one passive from its class list (from level 10).", rows, [
    { key: "name", label: "Passive", render: (r) => passiveLink(String(r.name)) }, { key: "bonus", label: "Bonus" },
    { key: "classes", label: "Classes", render: (r) => el("span", {}, ...joinNodes(classesWith("passive", String(r.name)).map(([id]) => classLink(id)))) },
  ]);
}

function passivePage(name: string): HTMLElement {
  const p = G.passiveData?.[name];
  if (!p) return notFound(`passive “${name}”`);
  const users = classesWith("passive", name);
  return el("div", {}, crumbs(["Passives", "#/passives"], name), el("h1", {}, "✨ ", name), el("p", { class: "lead" }, passiveText(name)),
    facts([["Bonuses", el("ul", { class: "plain-list" }, ...Object.entries<number>(p.stats ?? {}).map(([k, v]) => el("li", {}, statText(k, v))))],
      ["Classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]));
}

// ---------------------------------------------------------------- items
const crafterName = (id: number) => (G as Any).crafterData?.[id]?.name ?? (id ? `crafter ${id}` : "");

function itemsPage(type: string): HTMLElement {
  if (!["equipment", "consumable", "material"].includes(type)) return notFound(`item type “${type}”`);
  const rows: Row[] = items(type).map(([id, it]) => ({
    id, name: it.name, kind: type === "equipment" ? SLOT_NAMES[it.itemSlot] ?? "" : it.subType ?? "", sub: it.subType ?? "",
    level: it.itemLevel ?? null, rarity: it.rarity ?? null, value: safeSell(type, id, 0), summary: type === "equipment" ? it.subType ?? "" : itemText(type, id),
  }));
  const cols: Column[] = [
    { key: "name", label: "Item", render: (r) => itemLink(type, Number(r.id)) },
    { key: "kind", label: type === "equipment" ? "Slot" : "Type" },
    ...(type === "equipment" ? [{ key: "sub", label: "Kind" }] : []),
    { key: "level", label: "Level", num: true }, { key: "value", label: "Sell value", num: true },
    ...(type !== "equipment" ? [{ key: "summary", label: "Description" }] : []),
  ];
  const intro: Record<string, string> = {
    equipment: "Weapons, armour and trinkets. Sell value is the base customer price of a plain item (no modifiers, ascension 0).",
    consumable: "Potions, boosts, enchants and map scrolls.", material: "Crafting materials, essences and boss trophies, with where they drop.",
  };
  return listPage(itemTypeLabel[type] === "Equipment" ? "Equipment" : `${itemTypeLabel[type]}s`, intro[type], rows, cols, (r) => `${r.name} ${r.kind} ${r.sub} ${r.summary}`);
}

function safeSell(type: string, id: number, asc: number): number | null {
  try {
    return sellValue(type, id, asc) ?? null;
  } catch {
    return null;
  }
}

function recipeList(type: string, id: number): HTMLElement {
  const rec = recipe(type, id);
  const it = item(type, id);
  if (!rec.length) return none("Not craftable.");
  return el("div", {},
    el("ul", { class: "plain-list" }, ...rec.map(([t, mid, amt]) => el("li", {}, `${amt} × `, itemLink(t, mid)))),
    el("p", { class: "muted small" }, [crafterName(it.crafterID) ? `${crafterName(it.crafterID)}` : "", it.cost ? `${fmt.format(it.cost)} gold` : "",
      it.runTime ? `${fmt.format(it.runTime / 60)} min` : "", it.experience ? `${fmt.format(it.experience)} XP` : ""].filter(Boolean).join(" · ")));
}

function usedInList(type: string, id: number): HTMLElement {
  const used = usedInRecipes(type, id);
  return used.length
    ? el("ul", { class: "plain-list cols" }, ...used.map(([t, uid, amt]) => el("li", {}, itemLink(t, uid), el("span", { class: "muted small" }, ` × ${amt}`))))
    : none("Not used in any recipe.");
}

const EQUIP_STATS = ["atk", "matk", "acc", "crit", "def", "mdef"];

/** Base stats of a freshly crafted plain item at each grade (crafter level 60, ascension 0). */
function gradeTable(id: number): HTMLElement {
  const rows: Row[] = [];
  for (let g = 1; g <= 5; g++) {
    try {
      const made: Any = api.makeItem(id, g, 0, 60, 1);
      const r: Row = { grade: GRADES[g - 1] };
      for (const k of EQUIP_STATS) if (typeof made[k] === "number" && made[k]) r[k] = made[k];
      rows.push(r);
    } catch {
      return none("The game has no stat formula for this item type.");
    }
  }
  const keys = EQUIP_STATS.filter((k) => rows.some((r) => r[k] !== undefined));
  if (!keys.length) return none("No base combat stats (trinkets carry bonus stats only).");
  return el("div", {}, table(rows, [{ key: "grade", label: "Grade", render: (r) => gradeBadge(String(r.grade)) },
    ...keys.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), num: true }))]),
  el("p", { class: "muted small" }, "Freshly crafted by a level-60 crafter, ascension 0, no prefix or suffix."));
}

function itemPage(type: string, id: number): HTMLElement {
  const it = item(type, id);
  if (!it) return notFound(`${type} #${id}`);
  const desc = itemText(type, id);
  const listHref = `#/items/${type}`;
  const kids: (Node | string)[] = [
    crumbs([itemTypeLabel[type] === "Equipment" ? "Equipment" : `${itemTypeLabel[type]}s`, listHref], it.name),
    el("h1", {}, itemLink(type, id)),
    ...(desc ? [el("p", { class: "lead" }, desc)] : []),
    facts([
      ["Type", type === "equipment" ? `${SLOT_NAMES[it.itemSlot] ?? ""} · ${it.subType ?? ""}` : it.subType ?? itemTypeLabel[type]],
      ["Level", it.itemLevel], ["Rarity", it.rarity], ["Tier", it.tier],
      ["Sell value", [0, 1, 2].map((a) => safeSell(type, id, a)).every((v) => v === null) ? undefined
        : el("span", { class: "stack" }, ...[0, 1, 2].filter((a) => type !== "material" || a === 0).map((a) => {
          const v = safeSell(type, id, a);
          // ascension shown as the value's outline (silver 1, gold 2), not as text
          return withAsc(el("span", { class: "nowrap" }, `${fmt.format(v ?? 0)} g`), a);
        }))],
      ["Bonus stats", Object.keys(it.bonusStat ?? {}).length ? Object.entries<number>(it.bonusStat).map(([k, v]) => statText(k, v)).join(", ") : undefined],
      ["Effect", type === "consumable" && Object.keys(it.stat ?? {}).length ? Object.entries<number>(it.stat).map(([k, v]) => statText(k, v)).join(", ") : undefined],
    ]),
  ];
  if (type !== "material" && safeSell(type, id, 1) !== null) kids.push(ascLegend());
  if (type === "equipment") kids.push(section("Stats by grade", gradeTable(id)));
  if (type === "material") {
    const src = dropSources(id);
    kids.push(section(`Where it drops (${src.length})`, src.length
      ? el("ul", { class: "plain-list" }, ...src.map((s) => el("li", {}, s.kind === "map" ? itemLink("map", s.id) : el("span", {}, `👹 ${s.label}`),
        el("span", { class: "muted small" }, ` · ${s.detail}`))))
      : none("Not dropped by quests or maps (crafted, bought or event only).")));
  }
  kids.push(section("Recipe", recipeList(type, id)), section("Used in", usedInList(type, id)));
  return el("div", {}, ...kids);
}

// ---------------------------------------------------------------- maps
function essenceOf(m: Any): (Node | string)[] {
  const br = seq<number>(m.baseReward ?? {});
  const half = Math.floor(br.length / 2);
  return joinNodes(Array.from({ length: half }, (_, i) => el("span", { class: "nowrap" }, `${br[i + half]} × `, itemLink("material", br[i]))));
}

function mapsPage(): HTMLElement {
  const rows: Row[] = items("map").map(([id, m]) => ({
    id, name: m.name, level: m.itemLevel ?? null, rooms: m.baseEnemyAmount ?? null, minutes: m.baseMapTime ? m.baseMapTime / 60 : null,
    mod: m.enemyMod ?? null, boss: seq<number>(m.bossList ?? {}).map((b) => quest(b)?.name).filter(Boolean).join(", "),
  }));
  return listPage("Maps", "Dungeon maps: rooms of enemies, a boss and essence at the end. Enemy power is the quest's stats × the map modifier.", rows, [
    { key: "name", label: "Map", render: (r) => itemLink("map", Number(r.id)) }, { key: "level", label: "Level", num: true },
    { key: "rooms", label: "Rooms", num: true }, { key: "minutes", label: "Minutes", num: true }, { key: "mod", label: "Enemy ×", num: true },
    { key: "boss", label: "Boss" }, { key: "essence", label: "Essence per run", render: (r) => el("span", {}, ...essenceOf(item("map", Number(r.id)))) },
  ], (r) => `${r.name} ${r.boss}`);
}

const ENEMY_STATS: [string, string][] = [["enemyHp", "HP"], ["enemyAtk", "Atk"], ["enemyMatk", "Matk"], ["enemyDef", "Def"], ["enemyMdef", "Mdef"], ["enemyEva", "Eva"]];

function enemyTable(ids: number[], mod: number): HTMLElement {
  const rows: Row[] = [];
  for (const id of [...new Set(ids)]) {
    const q = quest(id);
    if (!q?.name) continue;
    for (const rare of [false, true]) {
      if (rare && !(q.nameB && q.enemyHpB !== undefined)) continue;
      const sfx = rare ? "B" : "";
      const r: Row = { id, rare, name: rare ? q.nameB : q.name, level: q.levelReq ?? null };
      for (const [k, label] of ENEMY_STATS) r[label] = q[k + sfx] !== undefined ? Math.round(q[k + sfx] * mod) : null;
      rows.push(r);
    }
  }
  return table(rows, [
    { key: "name", label: "Enemy", render: (r) => el("span", {}, String(r.name), ...(r.rare ? [" ", pill("rare", "t-pink")] : [])) },
    { key: "level", label: "Level", num: true }, ...ENEMY_STATS.map(([, l]) => ({ key: l, label: l, num: true })),
    { key: "skills", label: "Skills", render: (r) => {
      const q = quest(Number(r.id));
      const list = seq<string>((r.rare ? q.attackListB : q.attackList) ?? {});
      return el("span", { class: "skill-line" }, ...joinNodes([...new Set(list)].map((s) => skillLink(s))));
    } },
  ]);
}

function mapPage(id: number): HTMLElement {
  const m = item("map", id);
  if (!m) return notFound(`map #${id}`);
  const mod = m.enemyMod ?? 1;
  const bosses = seq<number>(m.bossList ?? {});
  return el("div", {}, crumbs(["Maps", "#/maps"], m.name), el("h1", {}, itemLink("map", id)),
    ...(itemText("map", id) ? [el("p", { class: "lead" }, itemText("map", id))] : []),
    facts([["Level", m.itemLevel], ["Rarity", m.rarity], ["Rooms", m.baseEnemyAmount], ["Base time", m.baseMapTime ? `${fmt.format(m.baseMapTime / 60)} min` : undefined],
      ["Enemy modifier", `×${mod}`], ["Rare boss", m.isRareBoss ? "yes" : undefined], ["Essence per run", el("span", {}, ...essenceOf(m))],
      ["Sell value", safeSell("map", id, 0) !== null ? `${fmt.format(safeSell("map", id, 0)!)} g` : undefined]]),
    section(`Boss${bosses.length > 1 ? "es" : ""}`, bosses.length ? enemyTable(bosses, mod) : none("No boss.")),
    section("Room enemies", enemyTable(mapEnemies(m), mod)),
    el("p", { class: "muted small" }, `Stats include the map's ×${mod} modifier (before ascension, grade and suffix).`),
    section("Recipe", recipeList("map", id)));
}

// ---------------------------------------------------------------- classes
/** [growth key, base key, label]: a class's stat at a level is base + growth[prestigeLevel] × level. */
const GROWTH: [string, string, string][] = [["hpPlv", "hp", "HP"], ["atkPlv", "atk", "Atk"], ["matkPlv", "matk", "Matk"], ["accPlv", "acc", "Acc"],
  ["defPlv", "def", "Def"], ["mdefPlv", "mdef", "Mdef"], ["critPlv", "crit", "Crit"]];
const MAX_LEVEL = 60;
const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

/** The class's own stat (no gear, passive or attribute points), as Hero.determineStats adds it. */
const statAt = (c: Any, [plv, base]: [string, string, string], prestige: number, level: number): number =>
  (c[base] ?? 0) + (c[plv]?.[prestige] ?? 0) * level;
/** Prestige levels (1 = ascension 0) the class's growth table has. */
const tiersOf = (c: Any): number[] => [1, 2, 3].filter((p) => GROWTH.some(([k]) => typeof c[k]?.[p] === "number"));

/** Radar of the class at level 60 for one ascension; each rim is the best class at the same level and ascension. */
function classRadar(id: number, prestige: number): HTMLElement {
  const c = G.heroList[id];
  const axes: RadarAxis[] = GROWTH.map((g) => {
    let max = 0, best = "";
    for (const [, o] of classes()) {
      const v = statAt(o, g, prestige, MAX_LEVEL);
      if (v > max) [max, best] = [v, o.name];
    }
    const value = statAt(c, g, prestige, MAX_LEVEL);
    return { label: g[2], value, max, best, display: dec.format(value) };
  });
  const fig = radar(axes, { title: `${c.name} at level ${MAX_LEVEL}, ${ascText(prestige - 1)}` });
  fig.append(el("figcaption", { class: "muted small" }, `Level ${MAX_LEVEL}, ${ascText(prestige - 1)}, no gear or passive. Rim = best class.`));
  return fig;
}

function statsBlock(id: number): HTMLElement {
  const c = G.heroList[id];
  const tiers = tiersOf(c);
  // Radar with an ascension switch.
  const holder = el("div", { class: "cls-radar-fig" });
  const radios = tiers.map((p) => {
    const input = el("input", { type: "radio", name: "cls-asc", value: String(p) }) as HTMLInputElement;
    input.checked = p === tiers[0];
    input.addEventListener("change", () => holder.replaceChildren(classRadar(id, p)));
    return el("label", { title: ascText(p - 1)[0].toUpperCase() + ascText(p - 1).slice(1) }, input, String(p - 1));
  });
  holder.replaceChildren(classRadar(id, tiers[0] ?? 1));
  const radarCol = el("div", { class: "cls-radar" },
    ...(tiers.length > 1 ? [el("fieldset", { class: "cls-asc" }, el("legend", { class: "muted small" }, "Ascension"), el("div", { class: "mode-switch" }, ...radios))] : []),
    holder);
  // One small chart per stat, one line per ascension, crosshairs in step.
  const charts = GROWTH.map((g) => lineChart(tiers.map((p) => ({
    label: tiers.length > 1 ? `asc ${p - 1}` : "", values: LEVELS.map((lv) => statAt(c, g, p, lv)), cls: `tier-${p - 1}`,
  })), {
    title: g[2], x: LEVELS, xName: "Level", xTicks: [1, 20, 40, MAX_LEVEL],
    note: `${dec.format(c[g[1]] ?? 0)} + ${tiers.map((p) => dec.format(c[g[0]]?.[p] ?? 0)).join(" / ")} per level`,
  }));
  group(charts);
  const legend = tiers.length > 1
    ? el("p", { class: "lc-legend muted small" }, "Ascension: ", ...tiers.flatMap((p) => [el("span", { class: "lc-key" },
      el("i", { class: `lc-swatch tier-${p - 1}`, "aria-hidden": "true" }), ` ${p - 1}`)]), el("span", {}, " · hover or use the arrow keys to read a level"))
    : el("p", { class: "lc-legend muted small" }, "Hover or use the arrow keys to read a level.");
  return el("div", { class: "cls-stats" }, radarCol,
    el("div", { class: "cls-growth" }, el("h3", {}, "Growth per level"), legend, el("div", { class: "lc-grid-wrap" }, ...charts.map((ch) => ch.el))));
}

/** Whole row opens the row's link; the name stays a real link (keyboard, middle-click, screen readers). */
function clickableRow(tr: HTMLTableRowElement, link: HTMLElement): void {
  if (!(link instanceof HTMLAnchorElement)) return; // "Basic" and unknown passives have no page
  tr.classList.add("row-link");
  tr.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a, button, input, select, summary")) return;
    if (window.getSelection()?.toString()) return; // the reader was selecting text
    if (e.ctrlKey || e.metaKey) window.open(link.href, "_blank");
    else link.click();
  });
}

const apBadge = (ap: number | undefined) => {
  const t = `${ap ?? "?"} action points`;
  return el("span", { class: "ap-badge", role: "img", title: t, "aria-label": t }, String(ap ?? "?"));
};

/** Skills and passives of a class in the same table: #, name, (AP), effect. */
function abilityTable(kind: "skill" | "passive", names: string[]): HTMLElement {
  const skill = kind === "skill";
  const head = el("tr", {}, el("th", { scope: "col", class: "n" }, "#"), el("th", { scope: "col" }, skill ? "Skill" : "Passive"),
    ...(skill ? [el("th", { scope: "col", class: "ap-col" }, el("abbr", { title: "Action points" }, "AP"))] : []),
    el("th", { scope: "col" }, skill ? "Effect" : "Bonus"));
  const rows = names.map((n, i) => {
    const link = skill ? skillLink(n) : passiveLink(n);
    const tr = el("tr", {}, el("td", { class: "n" }, String(i + 1)), el("td", { class: "name" }, link),
      ...(skill ? [el("td", { class: "ap-col" }, apBadge(skillAp(n)))] : []),
      el("td", { class: "eff" }, (skill ? skillDesc(n) : passiveText(n)) || "–"));
    clickableRow(tr, link);
    return tr;
  });
  return el("div", { class: "table-wrap" }, el("table", { class: `ability-rows ${kind}-rows` }, el("thead", {}, head), el("tbody", {}, ...rows)));
}

function classesPage(): HTMLElement {
  const rows: Row[] = classes().map(([id, c]) => ({ id, name: c.name, hp: c.hp, atk: c.atk, matk: c.matk, def: c.def, mdef: c.mdef, about: classText(id) }));
  return listPage("Classes", "The hero classes, their base stats, growth, skills and passives.", rows, [
    { key: "name", label: "Class", render: (r) => classLink(Number(r.id)) }, { key: "hp", label: "HP", num: true }, { key: "atk", label: "Atk", num: true },
    { key: "matk", label: "Matk", num: true }, { key: "def", label: "Def", num: true }, { key: "mdef", label: "Mdef", num: true }, { key: "about", label: "About" },
  ]);
}

function classPage(id: number): HTMLElement {
  const c = G.heroList?.[id];
  if (!c) return notFound(`class #${id}`);
  const skills = seq<string>(c.skillList ?? {});
  const passives = seq<string>(c.passiveList ?? {});
  return el("div", { class: `cls-${id}` }, crumbs(["Classes", "#/classes"], c.name), el("h1", {}, classLink(id)),
    ...(classText(id) ? [el("p", { class: "lead" }, classText(id))] : []),
    facts([["Base HP", c.hp], ["Atk", c.atk], ["Matk", c.matk], ["Acc", c.acc], ["Crit", c.crit], ["Def", c.def], ["Mdef", c.mdef]]),
    section("Stats", statsBlock(id)),
    section(`Passives (${passives.length}, pick one from level 10)`, passives.length ? abilityTable("passive", passives) : none("No passive.")),
    section(`Skills (${skills.length}, in unlock order)`, abilityTable("skill", skills)));
}

// ---------------------------------------------------------------- router
function notFound(what: string): HTMLElement {
  return el("div", {}, crumbs("Not found"), el("h1", {}, "Not found"), el("p", {}, `No ${what} in the game data. `, el("a", { href: "#/" }, "Back to the wiki")));
}

function route(): HTMLElement {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return home();
    case "skills": return skillsPage();
    case "skill": return skillPage(parts.slice(1).join("/"));
    case "passives": return passivesPage();
    case "passive": return passivePage(parts.slice(1).join("/"));
    case "items": return itemsPage(b);
    case "item": return itemPage(b, Number(c));
    case "maps": return mapsPage();
    case "map": return mapPage(Number(b));
    case "classes": return classesPage();
    case "class": return classPage(Number(b));
    default: return notFound(`page “${parts.join("/")}”`);
  }
}

async function render(): Promise<void> {
  const main = $("#wiki");
  try {
    await ready;
    main.replaceChildren(route());
    const h1 = main.querySelector("h1");
    document.title = `${h1?.textContent?.replace(/^[^\w]+/, "") || "Wiki"} · Merchant RPG Simulator`;
    document.querySelectorAll(".wiki-nav a").forEach((x) => {
      const cat = (x as HTMLAnchorElement).getAttribute("href")!;
      const on = location.hash === cat || location.hash.startsWith(cat.replace(/s$/, "")) && cat !== "#/";
      if (on) x.setAttribute("aria-current", "page");
      else x.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  } catch (e) {
    main.replaceChildren(el("p", { class: "error", role: "alert" }, `The wiki could not load the game data: ${e instanceof Error ? e.message : e}`));
  }
}

window.addEventListener("hashchange", render);
render();
export { href };
