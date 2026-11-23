/**
 * Wiki page (site/wiki.html): bare stats of everything in the game, cross-linked. Hash routes:
 *   #/                          search + categories
 *   #/skills  #/skill/NAME      #/passives  #/passive/NAME
 *   #/items/TYPE  #/item/TYPE/ID   (equipment, consumable, material)
 *   #/maps    #/map/ID          #/classes   #/class/ID[/LEVEL/ASC]
 *   #/enemies #/enemy/ID        (ID = quest id; the rare variant shares the page)
 */
import { loadTimelineData } from "./timeline.ts";
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { sellValue } from "../tools/engine.ts";
import { $, type Column, el, fmt, gradeBadge, pill, type Row, table, withAsc } from "./dom.ts";
import { recipeChain } from "./recipe-chain.ts";
import { tip } from "./tooltip.ts";
import { classStats } from "./wiki-classes.ts";
import { bonusLabel, bonusLines, bonusRange, rarityChip } from "./wiki-items.ts";
import { goodAgainst } from "./wiki-skills.ts";
import { enemyBody, enemyListColumns, enemyListRows, enemyTable } from "./wiki-enemies.ts";
import {
  classesWith, classes, classLink, classText, dropSources, enemiesWith, enemyIds, enemyLink, enemyNamesWith, GRADES, hasRare, href,
  isEnemy, item, itemLink, items, itemText, itemTypeLabel, loadWikiText, mapEnemies, passiveLink, passiveNames, passiveText, quest,
  recipe, SLOT_NAMES, skillAp, skillDesc, skillLink, skillNames, statText, usedInRecipes,
} from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ready = Promise.all([
  fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((j) => api.loadGameData(j)),
  loadWikiText(),
  // Enemy timelines (U11): optional, the enemy pages show the plain rotation without them.
  loadTimelineData().catch(() => {}),
]);

const CATEGORIES: [string, string, string, () => number][] = [
  ["#/skills", "⚡", "Skills", () => skillNames().length],
  ["#/passives", "✨", "Passives", () => passiveNames().length],
  ["#/items/equipment", "⚔️", "Equipment", () => items("equipment").length],
  ["#/items/consumable", "🧪", "Consumables", () => items("consumable").length],
  ["#/items/material", "🪨", "Materials", () => items("material").length],
  ["#/maps", "🗺️", "Maps", () => items("map").length],
  ["#/enemies", "👹", "Enemies", () => enemyIds().length],
  ["#/classes", "🛡️", "Classes", () => classes().length],
];

// ---------------------------------------------------------------- building blocks
const crumbs = (...parts: (string | [string, string])[]) => el("p", { class: "crumbs small" },
  ...[["Wiki", "#/"] as [string, string], ...parts].flatMap((p, i) => [
    ...(i ? [el("span", { "aria-hidden": "true" }, " › ")] : []),
    typeof p === "string" ? el("span", {}, p) : el("a", { href: p[1] }, p[0])]));

const facts = (pairs: [string, Node | string | number | undefined | null][]) =>
  el("dl", { class: "facts" }, ...pairs.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, typeof v === "number" ? fmt.format(v) : v as Node | string))));

const section = (title: string, ...kids: (Node | string)[]) => el("section", { class: "wiki-section" }, el("h2", { class: "wiki-banner" }, title), ...kids);
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
    ...enemyIds().flatMap((id) => [false, ...(hasRare(id) ? [true] : [])].map((rare) => {
      const name = rare ? quest(id).nameB : quest(id).name;
      return { label: name, kind: rare ? "Enemy (rare)" : "Enemy", node: () => enemyLink({ id, name, rare }) };
    })),
  ];
  const search = filterBox("Search skills, items, maps, enemies…", (q) => {
    if (!q) return results.replaceChildren();
    const hits = all.filter((x) => x.label.toLowerCase().includes(q)).slice(0, 60);
    results.replaceChildren(hits.length
      ? el("ul", { class: "hits" }, ...hits.map((h) => el("li", {}, h.node(), el("span", { class: "muted small" }, ` ${h.kind}`))))
      : none("Nothing matches."));
  });
  search.classList.add("big-search");
  return el("div", {}, el("h1", {}, "Wiki"),
    el("p", { class: "lead" }, "Bare stats of everything in the game, read from the game's data: skills, passives, items, maps, enemies and classes."),
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

const GOOD_SHOWN = 10;

/** Hero skills: the enemies whose timeline makes this skill worth taking (wiki-skills.ts), top 10 then "Show all". */
function goodAgainstSection(name: string): HTMLElement | null {
  const list = goodAgainst(name);
  const intro = el("p", { class: "muted small" }, "From each enemy's 5-turn timeline and this skill's effects (rules, not fight simulations): "
    + "debuffs it can cleanse, buffs it can dispel, heavy hits it can block or draw, hits on everyone it can heal, filters its damage gets through.");
  if (!list.length) return section("Good against", intro, none(G.abilityData?.[name] && classesWith("skill", name).length
    ? "No enemy-specific advantage found: a steady pick against any enemy." : "Not a hero skill."));
  const ul = el("ol", { class: "good-list" });
  const fill = (n: number) => ul.replaceChildren(...list.slice(0, n).map((m) => el("li", {},
    el("span", { class: "good-name" }, enemyLink({ id: m.quest, name: m.name, rare: m.rare }), m.rare ? pill("rare", "t-pink") : ""),
    el("span", { class: "good-why" }, m.reason))));
  fill(GOOD_SHOWN);
  const kids: (Node | string)[] = [intro, ul];
  if (list.length > GOOD_SHOWN) {
    const more = el("button", { type: "button", class: "show-all" }, `Show all ${list.length}`);
    more.addEventListener("click", () => {
      fill(list.length);
      more.remove();
    });
    kids.push(more);
  }
  return section(`Good against (${list.length})`, ...kids);
}

function skillPage(name: string): HTMLElement {
  if (!G.abilityData?.[name]) return notFound(`skill “${name}”`);
  const users = classesWith("skill", name);
  const enemies = enemiesWith(name);
  const good = users.length ? goodAgainstSection(name) : null;
  return el("div", {}, crumbs(["Skills", "#/skills"], name), el("h1", {}, "⚡ ", name),
    el("p", { class: "lead" }, skillDesc(name) || "No description in the game data."),
    facts([["AP cost", skillAp(name)], ["Used by classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]),
    ...(good ? [good] : []),
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
  const eq = type === "equipment";
  const rows: Row[] = items(type).map(([id, it]) => ({
    id, name: it.name, kind: eq ? SLOT_NAMES[it.itemSlot] ?? "" : it.subType ?? "", sub: it.subType ?? "",
    level: it.itemLevel ?? null, rarity: it.rarity ?? null, value: safeSell(type, id, 0),
    made: it.crafterID ? crafterName(it.crafterID) : "drop", bonus: eq ? bonusLines(it).join(", ") : "",
    summary: eq ? it.subType ?? "" : itemText(type, id),
  }));
  const cols: Column[] = [
    { key: "name", label: "Item", render: (r) => itemLink(type, Number(r.id)) },
    { key: "kind", label: eq ? "Slot" : "Type" },
    ...(eq ? [{ key: "sub", label: "Kind" }] : []),
    { key: "level", label: "Level", num: true },
    { key: "rarity", label: "Rarity", num: true, render: (r) => rarityChip(r.rarity) },
    ...(eq ? [{ key: "bonus", label: "Bonus stats", render: (r: Row) => el("span", { class: "bonus-cell" }, String(r.bonus || "–")) },
      { key: "made", label: "Made by" }] : []),
    { key: "value", label: "Sell value", num: true },
    ...(!eq ? [{ key: "summary", label: "Description" }] : []),
  ];
  const intro: Record<string, string> = {
    equipment: "Weapons, armour and trinkets. Any class can wear any item of its slot once the hero reaches the item's level. "
      + "Bonus stats are the item's own range (before grade and ascension). Sell value is the base customer price of a plain item (no modifiers, ascension 0).",
    consumable: "Potions, boosts, enchants and map scrolls.", material: "Crafting materials, essences and boss trophies, with where they drop.",
  };
  return listPage(eq ? "Equipment" : `${itemTypeLabel[type]}s`, intro[type], rows, cols, (r) => `${r.name} ${r.kind} ${r.sub} ${r.summary} ${r.bonus} ${r.made}`);
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
    el("p", { class: "muted small" }, [crafterName(it.crafterID) ? `${crafterName(it.crafterID)}` : "", it.cost ? `${fmt.format(it.cost)} g` : "",
      it.runTime ? `${fmt.format(it.runTime / 60)} min` : "", it.experience ? `${fmt.format(it.experience)} XP` : ""].filter(Boolean).join(" · ")));
}

function usedInList(type: string, id: number): HTMLElement {
  const used = usedInRecipes(type, id);
  return used.length
    ? el("ul", { class: "plain-list cols" }, ...used.map(([t, uid, amt]) => el("li", {}, itemLink(t, uid), el("span", { class: "muted small" }, ` × ${amt}`))))
    : none("Not used in any recipe.");
}

const EQUIP_STATS = ["atk", "matk", "acc", "crit", "def", "mdef"];

/** Base and bonus stats of a freshly crafted plain item at each grade (crafter level 60), for one ascension. */
function gradeRows(id: number, asc: number): HTMLElement {
  const it = item("equipment", id);
  const bonusKeys = Object.keys(it?.bonusStat ?? {});
  const diff = Math.max(0, 60 - (it?.itemLevel ?? 0));
  const rows: Row[] = [];
  for (let g = 1; g <= 5; g++) {
    const r: Row = { grade: GRADES[g - 1] };
    try {
      const made: Any = api.makeItem(id, g, asc, 60, 1);
      for (const k of EQUIP_STATS) if (typeof made[k] === "number" && made[k]) r[k] = made[k];
    } catch {
      // no stat formula for this subtype: bonus stats only
    }
    for (const k of bonusKeys) {
      const b = bonusRange(k, it.bonusStat[k], g, asc, diff);
      if (b) r[`b_${k}`] = b.lo === b.hi ? `${b.lo}${b.pct ? "%" : ""}` : `${b.lo}–${b.hi}${b.pct ? "%" : ""}`;
    }
    rows.push(r);
  }
  const keys = EQUIP_STATS.filter((k) => rows.some((r) => r[k] !== undefined));
  if (!keys.length && !bonusKeys.length) return none("No stats.");
  return table(rows, [{ key: "grade", label: "Grade", render: (r) => gradeBadge(String(r.grade)) },
    ...keys.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), num: true })),
    ...bonusKeys.map((k) => ({ key: `b_${k}`, label: `${bonusLabel(k).replace(/^./, (x) => x.toUpperCase())} (bonus)` }))]);
}

function gradeTable(id: number): HTMLElement {
  const holder = el("div");
  const radios = [0, 1, 2].map((a) => {
    const input = el("input", { type: "radio", name: "item-asc", value: String(a) }) as HTMLInputElement;
    input.checked = a === 0;
    input.addEventListener("change", () => holder.replaceChildren(gradeRows(id, a)));
    return el("label", { class: `asc-opt tier-${a}`, title: `Ascension ${a}` }, input, String(a));
  });
  holder.replaceChildren(gradeRows(id, 0));
  return el("div", { class: "cls-v3" },
    el("fieldset", { class: "cls-asc item-asc" }, el("legend", { class: "muted small" }, "Ascension"), el("div", { class: "mode-switch" }, ...radios)),
    holder,
    el("p", { class: "muted small" }, "Freshly crafted by a level-60 crafter, no prefix or suffix. Bonus stats roll in the range shown "
      + "(the item's range × the grade's spread, × the ascension multiplier; a crafter above the item's level raises the minimum). "
      + "Trinkets carry bonus stats only."));
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
      ["Level", it.itemLevel], ["Rarity", rarityChip(it.rarity)], ["Made by", it.crafterID ? `${crafterName(it.crafterID)} (level ${it.itemLevel ?? 0})` : undefined],
      ["Sell value", [0, 1, 2].map((a) => safeSell(type, id, a)).every((v) => v === null) ? undefined
        : el("span", { class: "stack" }, ...[0, 1, 2].filter((a) => type !== "material" || a === 0).map((a) => {
          const v = safeSell(type, id, a);
          // ascension shown as the value's outline (silver 1, gold 2), not as text
          return withAsc(el("span", { class: "nowrap" }, `${fmt.format(v ?? 0)} g`), a);
        }))],
      ["Bonus stats", type === "equipment" && bonusLines(it).length ? bonusLines(it).join(", ") : undefined],
      ["Effect", type === "consumable" && Object.keys(it.stat ?? {}).length ? Object.entries<number>(it.stat).map(([k, v]) => statText(k, v)).join(", ") : undefined],
    ]),
  ];
  if (type === "equipment") kids.push(section("Stats by grade", gradeTable(id)));
  const src = type === "material" || type === "equipment" ? dropSources(id, type) : [];
  if (type === "material" || src.length) {
    kids.push(section(`Where it drops (${src.length})`, src.length
      ? el("ul", { class: "plain-list" }, ...src.map((s) => el("li", {}, s.kind === "map" ? itemLink("map", s.id) : enemyLink({ id: s.id, name: s.label, rare: s.rare }),
        el("span", { class: "muted small" }, ` · ${s.detail}`))))
      : none("Not dropped by quests or maps (crafted, bought or event only).")));
  }
  const chain = recipeChain(type, id);
  if (chain) kids.push(section("Crafting chain", chain));
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
    { key: "boss", label: "Boss", render: (r) => el("span", {}, ...joinNodes(seq<number>(item("map", Number(r.id)).bossList ?? {}).map((b) => enemyLink({ id: b })))) },
    { key: "essence", label: "Essence per run", render: (r) => el("span", {}, ...essenceOf(item("map", Number(r.id)))) },
  ], (r) => `${r.name} ${r.boss}`);
}

function mapPage(id: number): HTMLElement {
  const m = item("map", id);
  if (!m) return notFound(`map #${id}`);
  const mod = m.enemyMod ?? 1;
  const bosses = seq<number>(m.bossList ?? {});
  return el("div", {}, crumbs(["Maps", "#/maps"], m.name), el("h1", {}, itemLink("map", id)),
    ...(itemText("map", id) ? [el("p", { class: "lead" }, itemText("map", id))] : []),
    facts([["Level", m.itemLevel], ["Rarity", rarityChip(m.rarity)], ["Rooms", m.baseEnemyAmount], ["Base time", m.baseMapTime ? `${fmt.format(m.baseMapTime / 60)} min` : undefined],
      ["Enemy modifier", `×${mod}`], ["Rare boss", m.isRareBoss ? "yes" : undefined], ["Essence per run", el("span", {}, ...essenceOf(m))],
      ["Sell value", safeSell("map", id, 0) !== null ? `${fmt.format(safeSell("map", id, 0)!)} g` : undefined]]),
    section(`Boss${bosses.length > 1 ? "es" : ""}`, bosses.length ? enemyTable(bosses, mod) : none("No boss.")),
    section("Room enemies", enemyTable(mapEnemies(m), mod)),
    el("p", { class: "muted small" }, `Stats include the map's ×${mod} modifier (before ascension, grade and suffix).`),
    section("Recipe", recipeList("map", id)));
}

// ---------------------------------------------------------------- enemies
function enemiesPage(): HTMLElement {
  return listPage("Enemies", "Every quest and map enemy with its base stats (before a map's multiplier). Gathering quests and unused "
    + "placeholder quests are not enemies and are left out.", enemyListRows(), enemyListColumns,
  (r) => `${r.name} ${r.rareName} ${r.kind} ${r.skills}`);
}

function enemyPage(id: number): HTMLElement {
  const q = quest(id);
  if (!isEnemy(id)) return notFound(`enemy #${id}`);
  return el("div", { class: "enemy-page" }, crumbs(["Enemies", "#/enemies"], q.name), el("h1", {}, "👹 ", q.name),
    el("p", { class: "lead" }, [q.title || "Quest enemy", `level ${q.levelReq}`, `region ${q.region}`].join(" · ")),
    ...enemyBody(id, facts, section));
}

// ---------------------------------------------------------------- classes
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

/** Class page; `#/class/ID/LEVEL/ASC` opens it on a level and ascension (the picker keeps the URL in step). */
function classPage(id: number, level?: string, asc?: string): HTMLElement {
  const c = G.heroList?.[id];
  if (!c) return notFound(`class #${id}`);
  const skills = seq<string>(c.skillList ?? {});
  const passives = seq<string>(c.passiveList ?? {});
  const start = { level: level ? Number(level) : undefined, asc: asc ? Number(asc) : undefined };
  const { cards, block } = classStats(id, start, (s) => history.replaceState(null, "", `#/class/${id}/${s.level}/${s.asc}`));
  return el("div", { class: `cls-${id}` }, crumbs(["Classes", "#/classes"], c.name), el("h1", {}, classLink(id)),
    ...(classText(id) ? [el("p", { class: "lead" }, classText(id))] : []),
    cards,
    section("Stats", block),
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
    case "enemies": return enemiesPage();
    case "enemy": return enemyPage(Number(b));
    case "classes": return classesPage();
    case "class": return classPage(Number(b), c, parts[3]);
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
      // a detail route is the list's singular: #/enemies → #/enemy/ID, #/maps → #/map/ID
      const on = location.hash === cat || location.hash.startsWith(cat.replace(/ies$/, "y").replace(/s$/, "")) && cat !== "#/";
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
