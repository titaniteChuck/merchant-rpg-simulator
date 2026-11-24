/**
 * Wiki page (site/wiki.html): bare stats of everything in the game, cross-linked. Hash routes:
 *   #/                          search + categories
 *   #/skills  #/skill/NAME      #/passives  #/passive/NAME
 *   #/items/TYPE  #/item/TYPE/ID   (equipment, consumable, material)
 *   #/maps    #/map/ID          #/classes   #/class/ID[/LEVEL/ASC]
 *   #/enemies #/enemy/ID        (ID = quest id; the rare variant shares the page)
 *   #/stats[/TOPIC]  #/battle[/TOPIC]   reference pages (wiki-ref.ts)
 *   #/expansions[/frozen|scribe|both|site]   the two paid expansions (wiki-expansions.ts)
 *
 * Expansions (U28): content of an expansion the visitor doesn't own (expansion-state.ts) is left out of every list and
 * the search, with a "N hidden" note and a Show button; its own page says why it's hidden; a reference to it in a
 * table (a drop, a recipe) is the greyed placeholder of itemLink / enemyLink. Every change re-renders the page.
 */
import { loadTimelineData } from "./timeline.ts";
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { sellValue } from "../tools/engine.ts";
import { $, type Column, el, expansionBadge, fmt, gradeBadge, pill, type Row, table, withAsc } from "./dom.ts";
import { craftLine, recipeChain } from "./recipe-chain.ts";
import { tip } from "./tooltip.ts";
import { classStats, tiersOf } from "./wiki-classes.ts";
import { bonusLabel, bonusLines, bonusRange, rarityChip, sellNode } from "./wiki-items.ts";
import { goodAgainst, isHeroOnlySkill, isUnusedSkill, removesEffects, turnMarks } from "./wiki-skills.ts";
import { battleLink, statLink } from "./wiki-ref.ts"; // U30: cross-links to the Stats / Battle sections
import { enemyBody, enemyLead, enemyListColumns, enemyListRows, enemyTable, regionRowClass, TREASURE_HELP } from "./wiki-enemies.ts";
import { sectionHelp } from "./wiki-help.ts";
import { battlePage, BATTLE_SECTIONS } from "./wiki-battle.ts"; // U25 reference pages
import { statsPage, STATS_SECTIONS } from "./wiki-stats.ts";
import { expansionsPage } from "./wiki-expansions.ts";
import { type ContentKind, type Expansion, isVisible, needsOf, partitionVisible, setShowAll, subscribe, syncWithStoredSave } from "./expansion-state.ts";
import { hiddenBody, hiddenNote, mountExpansionChip } from "./expansion-menu.ts";
import { languageReady, onLanguageChange, rerenderKeeping } from "./language.ts";
import { className, crafterName as crafterOf, enemyName, itemName, passiveName, searchText, skillName } from "./names.ts";
import {
  classesWith, classes, classLink, classText, dropSources, enemiesWith, enemyIds, enemyLink, enemyNamesWith, GRADES, hasRare, href,
  isEnemy, item, itemLink, items, itemText, itemTypeLabel, loadWikiText, mapEnemies, passiveLink, passiveNames, passiveText, quest,
  recipe, regionChip, regionOf, regionSortKey, regionText, SLOT_NAMES, skillAp, skillDesc, skillLink, skillNames, statText,
  treasureBushOf, usedInRecipes, enemyLevelText, isGathering, mapFlavour,
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
  languageReady, // U29: game names in the visitor's language from the first paint
]);

/**
 * The wiki sections: [route, icon, label, count, description]. U21: the descriptions live on the wiki home (one line
 * per section card); the list pages themselves start with their filter and table (no visible title or intro).
 */
const visibleItems = (t: string) => items(t).filter(([id]) => isVisible(t as ContentKind, id));
const visibleClasses = () => classes().filter(([id]) => isVisible("class", id));
const visibleEnemyIds = () => enemyIds().filter((id) => isVisible("enemy", id));
/** Classes with a skill / passive, the hidden ones (the Bard without the Frozen Tome) left out. */
const visibleClassesWith = (kind: "skill" | "passive", name: string) => classesWith(kind, name).filter(([id]) => isVisible("class", id));

/** A home card's line: text, or (U30) text with links to the reference pages, built at render time. */
type About = string | (() => (Node | string)[]);
const CATEGORIES: [string, string, string, () => number, About][] = [
  ["#/skills", "⚡", "Skills", () => skillNames().length,
    () => ["Every skill with its ", statLink("ap", "action-point cost"), " and effect. Hero skills are learnt by class; the rest are enemy skills."]],
  ["#/passives", "✨", "Passives", () => passiveNames().length, "A hero picks one passive from its class list (from level 10)."],
  ["#/items/equipment", "⚔️", "Equipment", () => visibleItems("equipment").length,
    () => ["Weapons, armour and trinkets. Any class can wear any item of its slot once the hero reaches the item's level. ",
      statLink("item-stats", "Bonus stats"), " are the item's own range (before grade and ascension); ", statLink("sell", "sell value"),
      " is the base price of a plain item."]],
  ["#/items/consumable", "🧪", "Consumables", () => visibleItems("consumable").length, "Potions, boosts, enchants and map scrolls."],
  ["#/items/material", "🪨", "Materials", () => visibleItems("material").length, "Crafting materials, essences and boss trophies, with where they drop."],
  ["#/maps", "🗺️", "Maps", () => visibleItems("map").length,
    () => ["Dungeon maps: rooms of enemies, a boss and essence at the end. Enemy power is the quest's stats × the ",
      statLink("map-essence", "map modifier"), "."]],
  ["#/enemies", "👹", "Enemies", () => visibleEnemyIds().length,
    // R1 F08: the quest bushes (gathering quests) are listed since the U28 follow-up; only the placeholders are not.
    "Every quest and map enemy with its base stats (before a map's multiplier), the quest bushes included."],
  ["#/classes", "🛡️", "Classes", () => visibleClasses().length,
    () => ["The hero classes, their base stats, ", statLink("hero-stats", "growth"), ", skills and passives."]],
  ["#/stats", "🧮", "Stats", () => STATS_SECTIONS.length, "How every number is calculated: hero stats, damage, hit and crit, luck, grade, XP, item stats, selling, crafting, essence."],
  ["#/battle", "🗡️", "Battle", () => BATTLE_SECTIONS.length, "How a fight runs: turn order, the 5-slot rotation, targeting, effects and their durations, heals, revives, map runs."],
  ["#/expansions", "🧩", "Expansions", () => 2, "The Frozen Tome and Scribe expansions: what each adds, the content behind them, and which ones the site thinks you own."],
];

// ---------------------------------------------------------------- building blocks
const crumbs = (...parts: (string | [string, string])[]) => el("p", { class: "crumbs small" },
  ...[["Wiki", "#/"] as [string, string], ...parts].flatMap((p, i) => [
    ...(i ? [el("span", { "aria-hidden": "true" }, " › ")] : []),
    typeof p === "string" ? el("span", {}, p) : el("a", { href: p[1] }, p[0])]));

/** Facts list: [term, value]; a term can be a node (U30: a link to its Stats section). */
const facts = (pairs: [string | Node, Node | string | number | undefined | null][]) =>
  el("dl", { class: "facts" }, ...pairs.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, typeof v === "number" ? fmt.format(v) : v as Node | string))));

const section = (title: string, ...kids: (Node | string)[]) => el("section", { class: "wiki-section" }, el("h2", { class: "wiki-banner" }, title), ...kids);
const none = (t: string) => el("p", { class: "muted" }, t);
const joinNodes = (nodes: (Node | string)[], sep = ", "): (Node | string)[] => nodes.flatMap((n, i) => (i ? [sep, n] : [n]));

function filterBox(placeholder: string, onInput: (q: string) => void): HTMLInputElement {
  const s = el("input", { type: "search", placeholder, "aria-label": placeholder }) as HTMLInputElement;
  s.addEventListener("input", () => onInput(s.value.trim().toLowerCase()));
  return s;
}

/**
 * A filterable table page: crumbs, filter, table. The title is for screen readers only; the description is on the home.
 * `rowClass`: a class per row (U24: `reg-N`, so region-sorted lists rule a line where the region changes).
 */
function listPage(title: string, rows: Row[], cols: Column[], search = (r: Row) => String(r.name), rowClass?: (r: Row) => string, hidden = 0): HTMLElement {
  // R1 F15: everything hidden (the Maps list without Scribe): one empty state, no filter, count or empty table.
  if (!rows.length && hidden) return el("div", {}, crumbs(title), el("h1", { class: "sr-only" }, title), emptyList(title, hidden));
  const holder = el("div");
  const count = el("span", { class: "muted small" });
  const show = (q: string) => {
    const shown = q ? rows.filter((r) => search(r).toLowerCase().includes(q)) : rows;
    count.textContent = `${shown.length} of ${rows.length}`;
    holder.replaceChildren(table(shown, cols, rowClass));
  };
  show("");
  const note = hiddenNote(hidden, title.toLowerCase());
  return el("div", {}, crumbs(title), el("h1", { class: "sr-only" }, title),
    el("div", { class: "toolbar" }, filterBox(`Filter ${title.toLowerCase()}`, show), count), ...(note ? [note] : []), holder);
}

/** A list whose every row is expansion content the visitor hides: what hides it and the one action that shows it. */
function emptyList(title: string, hidden: number): HTMLElement {
  const show = el("button", { type: "button", class: "secondary" }, "Show expansion content");
  show.addEventListener("click", () => setShowAll(true));
  const what = title.toLowerCase();
  return el("div", { class: "wiki-empty" },
    el("p", {}, `All ${fmt.format(hidden)} ${what} are expansion content you don't own, so the site hides them. `,
      el("a", { href: "#/expansions" }, "What the expansions add"), "."),
    show);
}

/** A detail page of content the visitor hides (U28): its name and badge, why it's hidden and how to see it. */
function hiddenPage(crumb: [string, string], name: string, icon: string, needs: Expansion[]): HTMLElement {
  return el("div", {}, crumbs(crumb, name), el("h1", {}, icon ? `${icon} ` : "", name, expansionBadge(needs, { link: true })), hiddenBody(needs));
}

// ---------------------------------------------------------------- home
function home(): HTMLElement {
  const results = el("div");
  // `label`: the name shown and, in another language, the English one (U29: both match).
  const all: { label: string; kind: string; node: () => HTMLElement }[] = [
    ...skillNames().map((n) => ({ label: searchText(skillName(n), n), kind: "Skill", node: () => skillLink(n) })),
    ...passiveNames().map((n) => ({ label: searchText(passiveName(n), n), kind: "Passive", node: () => passiveLink(n) })),
    ...(["equipment", "consumable", "material", "map"] as const).flatMap((t) =>
      visibleItems(t).map(([id, it]) => ({ label: searchText(itemName(t, id), it.name), kind: itemTypeLabel[t], node: () => itemLink(t, id) }))),
    ...visibleClasses().map(([id, c]) => ({ label: searchText(className(id), c.name), kind: "Class", node: () => classLink(id) })),
    ...visibleEnemyIds().flatMap((id) => [false, ...(hasRare(id) ? [true] : [])].map((rare) => {
      const en = rare ? quest(id).nameB : quest(id).name;
      // R1 F11: the rare variant's own name and the small "rare" pill, as everywhere in the wiki.
      return { label: searchText(enemyName(id, rare), en), kind: "Enemy", node: () => rare ? el("span", { class: "nowrap" }, enemyLink({ id, rare }), " ", pill("rare", "t-pink")) : enemyLink({ id, rare }) };
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
  return el("div", {}, el("h1", { class: "sr-only" }, "Wiki: everything in the game, read from the game's data"),
    search, results,
    el("ul", { class: "cards wiki-cats" }, ...CATEGORIES.map(([h, icon, label, n, about]) =>
      el("li", {}, el("span", { class: "icon", "aria-hidden": "true" }, icon), el("h3", {}, el("a", { href: h }, label)),
        el("p", { class: "wiki-cat-about" }, ...(typeof about === "string" ? [about] : about())), el("p", { class: "muted small wiki-cat-count" }, `${fmt.format(n())} entries`)))));
}

// ---------------------------------------------------------------- skills & passives
const ENEMIES_SHOWN = 3;

/** The first few enemy names, then "+N more" with every name in its tooltip (a skill like Basic has 80+ users). */
function enemyCell(skill: string): HTMLElement {
  const list = enemyNamesWith(skill).filter((e) => isVisible("enemy", e.id));
  if (!list.length) return el("span", { class: "muted" }, "–");
  const shown = list.slice(0, ENEMIES_SHOWN);
  const rest = list.length - shown.length;
  const more = rest > 0 ? el("span", { class: "more-names", tabindex: "0", "aria-label": `${rest} more: ${list.slice(ENEMIES_SHOWN).map((e) => e.name).join(", ")}` }, `+${rest} more`) : null;
  if (more) tip(more, () => el("span", { class: "tip-body" }, el("strong", {}, `${list.length} enemies use ${skillName(skill)}`), el("span", {}, list.map((e) => e.name).join(", "))));
  return el("span", { class: "enemy-line" }, ...joinNodes(shown.map((e) => enemyLink(e))), ...(more ? [" ", more] : []));
}

function skillsPage(): HTMLElement {
  // R1 F33: skills no class and no enemy uses (Absorb All…) go to a collapsed "Unused" table under the list.
  const toRow = (n: string): Row => ({
    name: skillName(n), key: n, ap: skillAp(n) ?? null, classes: visibleClassesWith("skill", n).map(([id]) => className(id)).join(", "),
    // sorts by count; the cell shows the names (the enemies the visitor hides left out)
    ...((list) => ({ enemies: list.length, enemyNames: list.map((e) => e.name).join(" ") }))(enemyNamesWith(n).filter((e) => isVisible("enemy", e.id))),
    effect: skillDesc(n),
  });
  const cols: Column[] = [
    { key: "name", label: "Skill", render: (r) => skillLink(String(r.key)) }, { key: "ap", label: "AP", num: true },
    { key: "classes", label: "Classes", render: (r) => el("span", {}, ...joinNodes(visibleClassesWith("skill", String(r.key)).map(([id]) => classLink(id)))) },
    { key: "enemies", label: "Enemies", render: (r) => enemyCell(String(r.key)) }, { key: "effect", label: "Effect" },
  ];
  const names = skillNames();
  const unused = names.filter(isUnusedSkill);
  const page = listPage("Skills", names.filter((n) => !isUnusedSkill(n)).map(toRow), cols,
    (r) => `${searchText(String(r.name), String(r.key))} ${r.effect} ${r.classes} ${r.enemyNames}`);
  if (unused.length) {
    page.append(el("details", { class: "skills-unused" }, el("summary", {}, `Unused (${unused.length})`),
      el("p", { class: "muted small" }, "In the game's data, but no hero class learns them and no enemy plays them."),
      table(unused.map(toRow), [cols[0], cols[1], cols[4]])));
  }
  return page;
}

const GOOD_HELP = "From each enemy's 5-turn timeline and this skill's effects (rules, not fight simulations): debuffs it can "
  + "cleanse, buffs it can dispel, heavy hits it can block or draw, hits on everyone it can heal, filters its damage gets through. "
  + "✓ marks the enemy turns where it helps; hover or focus a ✓ for why. Best match first.";

/** Hero skills: every enemy whose timeline makes this skill worth taking (wiki-skills.ts), best first (U24: no limit). */
/** The Good against "?" links: the rotation and effect durations; cleanse / dispel skills also what they remove. */
const goodRefs = (name: string) => [battleLink("rotation", "Rotation"), battleLink("effects", "Effects"),
  ...(removesEffects(name) ? [battleLink("buffs-debuffs", "Cleanse and dispel")] : [])];

function goodAgainstSection(name: string): HTMLElement | null {
  // Quest bushes never hit back (no attack): nothing for a skill to answer, so they are left out.
  const list = goodAgainst(name).filter((m) => isVisible("enemy", m.quest) && !isGathering(m.quest));
  if (!list.length) return sectionHelp(section("Good against", none(G.abilityData?.[name] && classesWith("skill", name).length
    ? "No enemy-specific advantage found: a steady pick against any enemy." : "Not a hero skill.")), GOOD_HELP, goodRefs(name));
  // U21: a table, one row per enemy (ranked), a ✓ on the enemy turns the skill answers; the reasons are the cell's
  // tooltip. "All" holds the reasons tied to no single turn (only when some enemy has one).
  const marks = list.map(turnMarks);
  const withAll = marks.some((m) => m.all.length);
  const mark = (why: string[], turn: string) => why.length
    ? el("td", { class: "good-mark", title: why.join("\n"), "aria-label": `${turn}: ${why.join("; ")}`, tabindex: "0" }, "✓")
    : el("td", { class: "good-mark empty" });
  const tbody = el("tbody", {}, ...list.map((m, i) => el("tr", {},
    el("td", { class: "num muted" }, String(i + 1)),
    el("td", {}, el("span", { class: "good-name" }, enemyLink({ id: m.quest, name: m.name, rare: m.rare }), m.rare ? pill("rare", "t-pink") : "")),
    ...marks[i].turns.map((why, t) => mark(why, `Turn ${t + 1}`)),
    ...(withAll ? [mark(marks[i].all, "Whole fight")] : []))));
  const th = (t: string, title = "") => el("th", { scope: "col", class: "good-mark", ...(title ? { title } : {}) }, t);
  const grid = el("div", { class: "table-wrap good-wrap" }, el("table", { class: "good-table" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col", class: "num" }, "#"), el("th", { scope: "col" }, "Enemy"),
      ...[1, 2, 3, 4, 5].map((t) => th(`T${t}`, `Enemy turn ${t} (turn 6 is turn 1 again)`)),
      ...(withAll ? [th("All", "Not tied to one turn: the whole fight")] : []))), tbody));
  return sectionHelp(section(`Good against (${list.length})`, grid), GOOD_HELP, goodRefs(name));
}

function skillPage(name: string): HTMLElement {
  if (!G.abilityData?.[name]) return notFound(`skill “${name}”`);
  const users = visibleClassesWith("skill", name);
  const { shown: enemies, hidden } = partitionVisible(enemiesWith(name), (e) => isVisible("enemy", e.id));
  const good = classesWith("skill", name).length ? goodAgainstSection(name) : null;
  // R1 F18 / F26: no emoji before the title, the effect in a card (no lead line); F33: a hero skill no enemy plays
  // has no empty "Enemies" section.
  return el("div", {}, crumbs(["Skills", "#/skills"], skillName(name)), el("h1", {}, skillName(name)),
    facts([["Effect", skillDesc(name) || "No description in the game data."], [statLink("ap", "AP cost"), skillAp(name)],
      ["Used by classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]),
    ...(good ? [good] : []),
    ...(isHeroOnlySkill(name) ? [] : [section(`Enemies with this skill (${enemies.length})`, enemies.length
      ? el("ul", { class: "plain-list" }, ...enemies.map((e) => el("li", {}, enemyLink(e), e.rare ? pill("rare", "t-pink") : "",
        el("span", { class: "muted small" }, ` level ${enemyLevelText(e.id)}`))))
      : none(hidden ? "No enemy you can meet uses it." : "No quest enemy uses it."), ...[hiddenNote(hidden, "enemies")].filter((x): x is HTMLElement => x !== null))]));
}

function passivesPage(): HTMLElement {
  const rows: Row[] = passiveNames().map((n) => ({ name: passiveName(n), key: n, bonus: passiveText(n), classes: visibleClassesWith("passive", n).map(([id]) => className(id)).join(", ") }));
  return listPage("Passives", rows, [
    { key: "name", label: "Passive", render: (r) => passiveLink(String(r.key)) }, { key: "bonus", label: "Bonus" },
    { key: "classes", label: "Classes", render: (r) => el("span", {}, ...joinNodes(visibleClassesWith("passive", String(r.key)).map(([id]) => classLink(id)))) },
  ], (r) => `${searchText(String(r.name), String(r.key))} ${r.bonus} ${r.classes}`);
}

function passivePage(name: string): HTMLElement {
  const p = G.passiveData?.[name];
  if (!p) return notFound(`passive “${name}”`);
  const users = visibleClassesWith("passive", name);
  // R1 F18 / F26: no emoji before the title, no lead line (the Bonuses card says it)
  return el("div", {}, crumbs(["Passives", "#/passives"], passiveName(name)), el("h1", {}, passiveName(name)),
    facts([["Bonuses", el("ul", { class: "plain-list" }, ...Object.entries<number>(p.stats ?? {}).map(([k, v]) => el("li", {}, statText(k, v))))],
      ["Classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]));
}

// ---------------------------------------------------------------- items
const crafterName = (id: number) => crafterOf(id) ?? (id ? `crafter ${id}` : "");

function itemsPage(type: string): HTMLElement {
  if (!["equipment", "consumable", "material"].includes(type)) return notFound(`item type “${type}”`);
  const eq = type === "equipment";
  const all = items(type);
  const shown = all.filter(([id]) => isVisible(type as ContentKind, id));
  const rows: Row[] = shown.map(([id, it]): Row => {
    const reg = regionOf(type as "equipment", id);
    return {
      id, name: itemName(type, id) ?? it.name, en: it.name, kind: eq ? SLOT_NAMES[it.itemSlot] ?? "" : it.subType ?? "", sub: it.subType ?? "",
      level: it.itemLevel ?? null, rarity: it.rarity ?? null, value: safeSell(type, id, 0),
      made: it.crafterID ? crafterName(it.crafterID) : "drop", bonus: eq ? bonusLines(it).join(", ") : "",
      summary: eq ? it.subType ?? "" : itemText(type, id),
      region: regionSortKey(reg, it.itemLevel), regionId: reg?.id ?? 0, regionName: regionText(reg),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id)); // region, then level
  const cols: Column[] = [
    { key: "name", label: "Item", render: (r) => itemLink(type, Number(r.id)) },
    { key: "region", label: "Region", render: (r) => regionChip(regionOf(type as "equipment", Number(r.id))) },
    { key: "kind", label: eq ? "Slot" : "Type" },
    ...(eq ? [{ key: "sub", label: "Kind" }] : []),
    { key: "level", label: "Level", num: true },
    { key: "rarity", label: "Rarity", num: true, render: (r) => rarityChip(r.rarity) },
    ...(eq ? [{ key: "bonus", label: "Bonus stats", render: (r: Row) => el("span", { class: "bonus-cell" }, String(r.bonus || "–")) },
      { key: "made", label: "Made by" }] : []),
    { key: "value", label: "Sell value", num: true, render: (r) => (r.value === null ? "–" : sellNode(type, Number(r.id), Number(r.value))) },
    ...(!eq ? [{ key: "summary", label: "Description" }] : []),
  ];
  return listPage(eq ? "Equipment" : `${itemTypeLabel[type]}s`, rows, cols,
    (r) => `${searchText(String(r.name), String(r.en))} ${r.kind} ${r.sub} ${r.summary} ${r.bonus} ${r.made} ${r.regionName}`, regionRowClass, all.length - shown.length);
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
  if (!rec.length) return none("Not craftable.");
  return el("div", {},
    el("ul", { class: "plain-list" }, ...rec.map(([t, mid, amt]) => el("li", {}, `${amt} × `, itemLink(t, mid)))),
    // U30: cost and time link to Stats › Craft (× count, grade speed); R1 F07: "15 s", not "0 min" (recipe-chain.ts)
    el("p", { class: "muted small" }, ...craftLine(type, id)));
}

/** Recipes that use the item; the ones the visitor hides (expansion content) are counted in a note, not listed. */
function usedInList(type: string, id: number): HTMLElement {
  const { shown: used, hidden } = partitionVisible(usedInRecipes(type, id), ([t, uid]) => isVisible(t as ContentKind, uid));
  const note = hiddenNote(hidden, hidden === 1 ? "recipe" : "recipes");
  const list = used.length
    ? el("ul", { class: "plain-list cols" }, ...used.map(([t, uid, amt]) => el("li", {}, itemLink(t, uid), el("span", { class: "muted small" }, ` × ${amt}`))))
    : none(hidden ? "Not used in any recipe you can make." : "Not used in any recipe.");
  return note ? el("div", {}, list, note) : list;
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
  // U28: ascension 1-2 is Scribe content (and level 51+ items need the Frozen essences): only the visible ones.
  const radios = [0, 1, 2].filter((a) => !a || isVisible("equipment", id, { ascension: a })).map((a) => {
    const input = el("input", { type: "radio", name: "item-asc", value: String(a) }) as HTMLInputElement;
    input.checked = a === 0;
    input.addEventListener("change", () => holder.replaceChildren(gradeRows(id, a)));
    return el("label", { class: `asc-opt tier-${a}`, title: `Ascension ${a}` }, input, String(a));
  });
  holder.replaceChildren(gradeRows(id, 0));
  return el("div", { class: "cls-v3" },
    ...(radios.length > 1 ? [el("fieldset", { class: "cls-asc item-asc" }, el("legend", { class: "muted small" }, statLink("essence", "Ascension")), el("div", { class: "mode-switch" }, ...radios))] : []),
    holder);
}
const GRADE_HELP = "Freshly crafted by a level-60 crafter, no prefix or suffix. Bonus stats roll in the range shown. Trinkets carry bonus stats only.";

/** The crafting chain with its explanation moved from under the diagram into the section's "?". */
function chainSection(chain: HTMLElement): HTMLElement {
  const note = chain.querySelector(":scope > p.muted");
  const text = note?.textContent ?? "";
  note?.remove();
  const s = section("Crafting chain", chain);
  return text ? sectionHelp(s, text, [statLink("craft")]) : s;
}

function itemPage(type: string, id: number): HTMLElement {
  const it = item(type, id);
  if (!it) return notFound(`${type} #${id}`);
  const listHref = `#/items/${type}`;
  if (!isVisible(type as ContentKind, id)) {
    return hiddenPage([itemTypeLabel[type] === "Equipment" ? "Equipment" : `${itemTypeLabel[type]}s`, listHref], itemName(type, id) ?? it.name, "", needsOf(type as ContentKind, id));
  }
  // R1 F18: no lead line when the Effect card says the same ("Restores 40 health" beside "+40 HP")
  const effect = type === "consumable" && Object.keys(it.stat ?? {}).length > 0;
  const desc = effect ? "" : itemText(type, id);
  const kids: (Node | string)[] = [
    crumbs([itemTypeLabel[type] === "Equipment" ? "Equipment" : `${itemTypeLabel[type]}s`, listHref], itemName(type, id) ?? it.name),
    el("h1", {}, itemLink(type, id)),
    ...(desc ? [el("p", { class: "lead" }, desc)] : []),
    facts([
      ["Type", type === "equipment" ? `${SLOT_NAMES[it.itemSlot] ?? ""} · ${it.subType ?? ""}` : it.subType ?? itemTypeLabel[type]],
      ["Level", it.itemLevel], ["Region", regionChip(regionOf(type as "equipment", id), true)], ["Rarity", rarityChip(it.rarity)], ["Made by", it.crafterID ? `${crafterName(it.crafterID)} (level ${it.itemLevel ?? 0})` : undefined],
      [statLink("sell", "Sell value"), [0, 1, 2].map((a) => safeSell(type, id, a)).every((v) => v === null) ? undefined
        : el("span", { class: "stack" }, ...[0, 1, 2].filter((a) => (type !== "material" || a === 0) && (!a || isVisible(type as ContentKind, id, { ascension: a }))).map((a) => {
          const v = safeSell(type, id, a);
          // ascension shown as the value's outline (silver 1, gold 2), not as text; R1 F43: the data's pair beside it
          return withAsc(sellNode(type, id, v ?? 0, a), a);
        }))],
      [statLink("item-stats", "Bonus stats"), type === "equipment" && bonusLines(it).length ? bonusLines(it).join(", ") : undefined],
      ["Effect", effect ? Object.entries<number>(it.stat).map(([k, v]) => statText(k, v)).join(", ") : undefined],
    ]),
  ];
  if (type === "equipment") kids.push(sectionHelp(section("Stats by grade", gradeTable(id)), GRADE_HELP, [statLink("item-stats")]));
  // Sources in content the visitor hides (a Frentir enemy, a map without Scribe) are counted, not listed.
  const allSrc = type === "material" || type === "equipment" ? dropSources(id, type) : [];
  const { shown: src, hidden: hiddenSrc } = partitionVisible(allSrc, (s) => isVisible(s.kind === "map" ? "map" : "enemy", s.id));
  if (type === "material" || allSrc.length) {
    const note = hiddenNote(hiddenSrc, hiddenSrc === 1 ? "source" : "sources");
    kids.push(section(`Where it drops (${src.length})`, src.length
      // R1 F11: a rare variant is its own name + the small rare pill, as in the lists
      ? el("ul", { class: "plain-list" }, ...src.map((s) => el("li", {}, s.kind === "map" ? itemLink("map", s.id) : enemyLink({ id: s.id, name: s.label, rare: s.rare }),
        s.rare ? pill("rare", "t-pink") : "",
        el("span", { class: "muted small" }, ` · ${s.detail}`))))
      : none(hiddenSrc ? "Not dropped by anything you can reach." : "Not dropped by quests or maps (crafted, bought or event only)."), ...(note ? [note] : [])));
  }
  const chain = recipeChain(type, id);
  if (chain) kids.push(chainSection(chain));
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
  const all = items("map");
  const rows: Row[] = all.filter(([id]) => isVisible("map", id)).map(([id, m]): Row => {
    const reg = regionOf("map", id);
    return {
      id, name: itemName("map", id) ?? m.name, en: m.name, level: m.itemLevel ?? null, rooms: m.baseEnemyAmount ?? null, minutes: m.baseMapTime ? m.baseMapTime / 60 : null,
      mod: m.enemyMod ?? null, boss: seq<number>(m.bossList ?? {}).map((b) => searchText(enemyName(b), quest(b)?.name)).filter(Boolean).join(", "),
      region: regionSortKey(reg, m.itemLevel), regionId: reg?.id ?? 0, regionName: regionText(reg),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id));
  return listPage("Maps", rows, [
    { key: "name", label: "Map", render: (r) => itemLink("map", Number(r.id)) },
    { key: "region", label: "Region", render: (r) => regionChip(regionOf("map", Number(r.id))) }, { key: "level", label: "Level", num: true },
    { key: "rooms", label: "Rooms", num: true }, { key: "minutes", label: "Minutes", num: true }, { key: "mod", label: "Enemy ×", num: true },
    { key: "boss", label: "Boss", render: (r) => el("span", {}, ...joinNodes(seq<number>(item("map", Number(r.id)).bossList ?? {}).map((b) => enemyLink({ id: b })))) },
    { key: "essence", label: "Essence per run", render: (r) => el("span", {}, ...essenceOf(item("map", Number(r.id)))) },
  ], (r) => `${searchText(String(r.name), String(r.en))} ${r.boss} ${r.regionName}`, regionRowClass, all.length - rows.length);
}

function mapPage(id: number): HTMLElement {
  const m = item("map", id);
  if (!m) return notFound(`map #${id}`);
  if (!isVisible("map", id)) return hiddenPage(["Maps", "#/maps"], itemName("map", id) ?? m.name, "", needsOf("map", id));
  const mod = m.enemyMod ?? 1;
  const bosses = seq<number>(m.bossList ?? {});
  const bush = treasureBushOf(m.itemLevel ?? 0);
  const modHelp = `Stats include the map's ×${mod} modifier (before ascension, grade and suffix).`;
  return el("div", {}, crumbs(["Maps", "#/maps"], itemName("map", id) ?? m.name), el("h1", {}, itemLink("map", id)),
    // R1 F17: the flavour sentence only; the game's "Boss: … Mod: Nx" tail named bosses loosely (the Boss table has them).
    ...(mapFlavour(id) ? [el("p", { class: "lead" }, mapFlavour(id))] : []),
    facts([["Level", m.itemLevel], ["Region", regionChip(regionOf("map", id))], ["Rarity", rarityChip(m.rarity)], ["Rooms", m.baseEnemyAmount],
      ["Base time", m.baseMapTime ? `${fmt.format(m.baseMapTime / 60)} min` : undefined],
      [statLink("map-essence", "Enemy modifier"), `×${mod}`], ["Rare boss", m.isRareBoss ? "yes" : undefined],
      // R1 F16: the essence names wrap inside the card ("500 × Essence de la forêt" in French).
      [statLink("map-essence", "Essence per run"), el("span", { class: "ess-fact" }, ...essenceOf(m))],
      [statLink("sell", "Sell value"), safeSell("map", id, 0) !== null ? `${fmt.format(safeSell("map", id, 0)!)} g` : undefined]]),
    sectionHelp(section(`Boss${bosses.length > 1 ? "es" : ""}`, bosses.length ? enemyTable(bosses, mod) : none("No boss.")), modHelp, [statLink("map-essence")]),
    sectionHelp(section("Room enemies", enemyTable(mapEnemies(m), mod)), modHelp, [statLink("map-essence")]),
    // U24: the Treasure Bush of the map's level band (added to a room at run time, so not in the map's own lists)
    ...(bush && isEnemy(bush) ? [sectionHelp(section("Treasure", enemyTable([bush], mod)), [TREASURE_HELP, modHelp], [statLink("map-essence")])] : []),
    section("Recipe", recipeList("map", id)));
}

// ---------------------------------------------------------------- enemies
function enemiesPage(): HTMLElement {
  const all = enemyListRows();
  const rows = all.filter((r) => isVisible("enemy", Number(r.id)));
  return listPage("Enemies", rows, enemyListColumns,
    (r) => `${r.name} ${r.rareName} ${r.en} ${r.kind} ${r.skills} ${r.regionName}`, regionRowClass, all.length - rows.length);
}

function enemyPage(id: number): HTMLElement {
  const q = quest(id);
  if (!isEnemy(id)) return notFound(`enemy #${id}`);
  const needs = needsOf("enemy", id);
  const name = enemyName(id) ?? q.name;
  if (!isVisible("enemy", id)) return hiddenPage(["Enemies", "#/enemies"], name, "👹", needs);
  return el("div", { class: "enemy-page" }, crumbs(["Enemies", "#/enemies"], name), el("h1", {}, "👹 ", name, ...(needs.length ? [expansionBadge(needs, { link: true })] : [])),
    el("p", { class: "lead" }, enemyLead(id)),
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
    ...(skill ? [el("th", { scope: "col", class: "ap-col" }, statLink("ap", "AP"))] : []),
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
  const shown = visibleClasses();
  const rows: Row[] = shown.map(([id, c]) => ({ id, name: className(id) ?? c.name, en: c.name, hp: c.hp, atk: c.atk, matk: c.matk, def: c.def, mdef: c.mdef, about: classText(id) }));
  return listPage("Classes", rows, [
    { key: "name", label: "Class", render: (r) => classLink(Number(r.id)) }, { key: "hp", label: "HP", num: true }, { key: "atk", label: "Atk", num: true },
    { key: "matk", label: "Matk", num: true }, { key: "def", label: "Def", num: true }, { key: "mdef", label: "Mdef", num: true }, { key: "about", label: "About" },
  ], (r) => `${searchText(String(r.name), String(r.en))} ${r.about}`, undefined, classes().length - shown.length);
}

/** Class page; `#/class/ID/LEVEL/ASC` opens it on a level and ascension (the picker keeps the URL in step). */
function classPage(id: number, level?: string, asc?: string): HTMLElement {
  const c = G.heroList?.[id];
  if (!c) return notFound(`class #${id}`);
  if (!isVisible("class", id)) return hiddenPage(["Classes", "#/classes"], className(id) ?? c.name, "", needsOf("class", id));
  const skills = seq<string>(c.skillList ?? {});
  const passives = seq<string>(c.passiveList ?? {});
  const start = { level: level ? Number(level) : undefined, asc: asc ? Number(asc) : undefined };
  const { cards, block } = classStats(id, start, (s) => history.replaceState(null, "", `#/class/${id}/${s.level}/${s.asc}`));
  return el("div", { class: `cls-${id}` }, crumbs(["Classes", "#/classes"], className(id) ?? c.name), el("h1", {}, classLink(id, { always: true })),
    ...(classText(id) ? [el("p", { class: "lead" }, classText(id))] : []),
    cards,
    section("Stats", block, ...[hiddenNote(tiersOf(c).filter((p) => !isVisible("prestige", p)).length, "ascension tier (levels 51–60)")].filter((x): x is HTMLElement => x !== null)),
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
    case "stats": return statsPage(b);
    case "battle": return battlePage(b);
    case "expansions": return expansionsPage(b);
    default: return notFound(`page “${parts.join("/")}”`);
  }
}

/** Draw the route. `top`: scroll to the top (a new page); a change of the expansion switches keeps the place. */
async function render(top = true): Promise<void> {
  const main = $("#wiki");
  try {
    await ready;
    paint(top);
  } catch (e) {
    main.replaceChildren(el("p", { class: "error", role: "alert" }, `The wiki could not load the game data: ${e instanceof Error ? e.message : e}`));
  }
}

/** Draw the route now (the data is in). */
function paint(top: boolean): void {
  const main = $("#wiki");
  {
    const y = window.scrollY;
    main.replaceChildren(route());
    const h1 = main.querySelector("h1");
    document.title = `${h1?.textContent?.replace(/^[^\w]+/, "") || "Wiki"} · Merchant RPG Simulator`;
    // The menus (nav.ts, U35) mark the current section from the hash themselves.
    window.scrollTo(0, top ? 0 : y);
  }
}

window.addEventListener("hashchange", () => render());
render();
// U28: the expansions button in the top bar; the save kept in this browser says which expansions are owned.
mountExpansionChip();
subscribe(() => render(false));
// U29: another language re-draws the page in place, keeping its filter, sorted column, pickers and scroll.
onLanguageChange(() => void ready.then(() => rerenderKeeping($("#wiki"), () => paint(false))).catch(() => {}));
ready.then(() => syncWithStoredSave()).catch(() => {});
export { href };
