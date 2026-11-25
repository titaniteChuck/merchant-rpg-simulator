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
// Review F14: the menus (nav.ts) are bundled into this page, first, so nav and the page share one copy of the
// shared modules (dom, names, language, tooltip, Save menu); the page loads no separate js/nav.js.
import "./nav.ts";
import { loadTimelineData } from "./timeline.ts";
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { sellValue } from "../tools/engine.ts";
import { loadListState, saveListState } from "./list-state.ts";
import { $, ascValues, type Column, duration, el, expansionBadge, fmt, gold, segField, segmented, select, slotName, gradeBadge, LV, pill, type Row, table } from "./dom.ts";
import { ascLevels } from "../tools/profit.ts";
import { craftLine, recipeChain } from "./recipe-chain.ts";
import { tip } from "./tooltip.ts";
import { classStats, RADAR_HELP, tiersOf } from "./wiki-classes.ts";
import { bonusLabel, bonusLines, bonusRange, craftCost, itemAscLevels, mergeGradeRows, rarityChip, sellAt, sellBoxes, totalCost } from "./wiki-items.ts";
import { goodAgainst, isHeroOnlySkill, isUnusedSkill, listedSkillNames, removesEffects, skillUnlockLevels, turnMarks, unlockCell } from "./wiki-skills.ts";
import { battleLink, statLink } from "./wiki-ref.ts"; // U30: cross-links to the Stats / Battle sections
import {
  baseTag, enemyBody, enemyFightTarget, enemyLead, enemyListColumns, enemyListRows, enemyTable, fightButton, mapFightTarget, regionRowClass, TREASURE_HELP,
} from "./wiki-enemies.ts";
import {
  ascCraftEssence, configRarity, configRoute, configSell, CONFIG_TYPES, consumableStatsAt, equipmentAt, type ItemConfig, isPlain, mapView,
  modCount, NO_CONFIG, parseConfig, parseHash, prefixEffect, prefixStats, suffixEffect, validAscs, validPrefixes, validSuffixes,
} from "./wiki-config.ts";
import { helpTip, sectionHelp } from "./wiki-help.ts";
import { battlePage, BATTLE_SECTIONS } from "./wiki-battle.ts"; // U25 reference pages
import { statsPage, STATS_SECTIONS } from "./wiki-stats.ts";
import { expansionsPage } from "./wiki-expansions.ts";
import { type ContentKind, type Expansion, isVisible, needsOf, partitionVisible, setShowAll, subscribe, syncWithStoredSave } from "./expansion-state.ts";
import { hiddenBody, hiddenNote, mountExpansionChip } from "./expansion-menu.ts";
import { languageReady, onLanguageChange, rerenderKeeping } from "./language.ts";
import {
  className, crafterName as crafterOf, enemyName, ITEM_TYPE_LABELS, ITEM_TYPE_PLURALS, itemName, itemTypeText, modItemName, passiveName, prefixTag, searchText,
  skillName, subtypeLabel, suffixName,
} from "./names.ts";
import {
  classesWith, classes, classLink, classText, dropSources, enemiesWith, enemyIds, enemyLink, enemyNamesWith, GRADES, hasRare, href,
  isEnemy, item, itemLink, items, itemText, loadWikiText, mapEnemies, passiveLink, passiveNames, passiveText, quest,
  recipe, regionChip, regionOf, regionSortKey, regionText, skillAp, skillDesc, skillLink, skillNames, statText,
  treasureBushOf, usedInRecipes, enemyLevelText, enemyLines, type EnemyLine, isGathering, mapFlavour,
} from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ready = Promise.all([
  fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((j) => api.loadGameData(j)),
  loadWikiText(),
  languageReady, // U29: game names in the visitor's language from the first paint
]);

/**
 * The wiki sections (CATEGORIES below). U21: the list pages start with their filter and table (no visible title or
 * intro); R2-D: the home shows compact tiles and each list's description is the "?" beside its filter.
 */
const visibleItems = (t: string) => items(t).filter(([id]) => isVisible(t as ContentKind, id));
const visibleClasses = () => classes().filter(([id]) => isVisible("class", id));
const visibleEnemyIds = () => enemyIds().filter((id) => isVisible("enemy", id));
/** Classes with a skill / passive, the hidden ones (the Bard without the Frozen Tome) left out. */
const visibleClassesWith = (kind: "skill" | "passive", name: string) => classesWith(kind, name).filter(([id]) => isVisible("class", id));

/**
 * A wiki section (R2-D F37): its home tile (icon, name, count; `about` as the tile's tooltip) and, for a list page,
 * the "?" in its toolbar: `about`, then `more` (the definitions that used to fill the home card) and links to the
 * reference pages (U30). `count` is what the list shows (F38: the home and the list agree).
 */
interface Category { href: string; icon: string; label: string; count: () => number; about: string; more?: string[]; refs?: () => HTMLAnchorElement[] }
const CATEGORIES: Category[] = [
  { href: "#/skills", icon: "⚡", label: "Skills", count: () => listedSkillNames().length,
    about: "Every skill with its action-point cost and effect. Hero skills are learnt by class; the rest are enemy skills.",
    refs: () => [statLink("ap", "Action points")] },
  { href: "#/passives", icon: "✨", label: "Passives", count: () => passiveNames().length, about: "A hero picks one passive from its class list (from level 10)." },
  { href: "#/items/equipment", icon: "⚔️", label: "Equipment", count: () => visibleItems("equipment").length,
    about: "Weapons, armour and trinkets. Any class can wear any item of its slot once the hero reaches the item's level.",
    more: ["Bonus stats: the item's own range, before grade and ascension. Sell value: the base price of a plain item."],
    refs: () => [statLink("item-stats", "Bonus stats"), statLink("sell", "Sell value")] },
  { href: "#/items/consumable", icon: "🧪", label: "Consumables", count: () => visibleItems("consumable").length, about: "Potions, boosts, enchants and map scrolls." },
  { href: "#/items/material", icon: "🪨", label: "Materials", count: () => visibleItems("material").length, about: "Crafting materials, essences and boss trophies, with where they drop." },
  { href: "#/maps", icon: "🗺️", label: "Maps", count: () => visibleItems("map").length,
    about: "Dungeon maps: rooms of enemies, a boss and essence at the end. Enemy power is the quest's stats scaled by the map modifier; a map page can show any ascension, prefix and suffix.",
    refs: () => [statLink("map-essence", "Map modifier")] },
  // R1 F08: the quest bushes (gathering quests) are listed since the U28 follow-up; only the placeholders are not.
  { href: "#/enemies", icon: "👹", label: "Enemies", count: () => visibleEnemyIds().length,
    about: "Every quest and map enemy with its base stats (before a map's multiplier), the quest bushes included." },
  { href: "#/classes", icon: "🛡️", label: "Classes", count: () => visibleClasses().length, about: "The hero classes, their base stats, growth, skills and passives.",
    refs: () => [statLink("hero-stats", "Growth")] },
  { href: "#/stats", icon: "🧮", label: "Stats", count: () => STATS_SECTIONS.length,
    about: "How every number is calculated: hero stats, damage, hit and crit, luck, grade, XP, item stats, selling, crafting, essence." },
  { href: "#/battle", icon: "🗡️", label: "Battle", count: () => BATTLE_SECTIONS.length,
    about: "How a fight runs: turn order, the 5-slot rotation, targeting, effects and their durations, heals, revives, map runs." },
  { href: "#/expansions", icon: "🧩", label: "Expansions", count: () => 2,
    about: "The Frozen Tome and Scribe expansions: what each adds, the content behind them, and which ones the site thinks you own." },
];
/** A list page's "?" (beside its filter): the section's description and definitions, with its reference links. */
function listHelp(href: string, title: string): HTMLElement | null {
  const c = CATEGORIES.find((x) => x.href === href);
  return c ? helpTip([c.about, ...(c.more ?? [])], title.toLowerCase(), c.refs?.() ?? []) : null;
}

// ---------------------------------------------------------------- building blocks
const crumbs = (...parts: (string | [string, string])[]) => el("p", { class: "crumbs small" },
  ...[["Wiki", "#/"] as [string, string], ...parts].flatMap((p, i) => [
    ...(i ? [el("span", { "aria-hidden": "true" }, " › ")] : []),
    typeof p === "string" ? el("span", {}, p) : el("a", { href: p[1] }, p[0])]));

type FactPair = [string | Node, Node | string | number | undefined | null];
/**
 * Facts list: [term, value]; a term can be a node (U30: a link to its Stats section). R2-D F43: `compact` packs the
 * cards three to a row on a phone, label and value tight (map and enemy pages).
 */
const facts = (pairs: FactPair[], compact = false) =>
  el("dl", { class: compact ? "facts compact" : "facts" }, ...pairs.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, typeof v === "number" ? fmt.format(v) : v as Node | string))));
const compactFacts = (pairs: FactPair[]) => facts(pairs, true);

/**
 * R2-D F42: an item's facts as one line, "Weapon · Dagger · lvl 0 · Tuvale · Rarity 1 · Sell 10 / 20 / 40 g", empty
 * parts left out.
 */
const factStrip = (parts: (Node | string | null | undefined | false)[]) =>
  el("p", { class: "fact-strip" }, sepRow(parts.filter((p): p is Node | string => !!p).map((p) => [p])));
/**
 * Parts joined by "·" that never dangle: each part carries its separator in front, and the row is shifted left by one
 * separator inside a clipping box, so the separator of a part that starts a line (the first one, or one that wrapped)
 * is cut off. No leading or trailing "·" at any width (style.css, #wiki .sep-row).
 */
const sepRow = (parts: (Node | string)[][]) => el("span", { class: "sep-row" },
  ...parts.map((kids) => el("span", { class: "sep-part" }, el("span", { class: "sep", "aria-hidden": "true" }, "·"), ...kids)));

/** R2-D F55: a section title is plain text over a thin rule (style.css r2-d), no longer a dark banner. */
const section = (title: string, ...kids: (Node | string)[]) => el("section", { class: "wiki-section" }, el("h2", { class: "wiki-banner" }, title), ...kids);
const none = (t: string) => el("p", { class: "muted" }, t);
/** R2-D F54: an empty section as one muted line ("Recipe · Not craftable."), not a title over a sentence. */
const emptyLine = (...parts: [string, string][]) => el("p", { class: "wiki-empty-line muted small" },
  sepRow(parts.map(([title, text]) => [el("strong", {}, title), ` ${text}`])));
function joinNodes(nodes: (Node | string)[], sep = ", "): (Node | string)[] {
  return nodes.flatMap((n, i) => (i ? [sep, n] : [n]));
}

function filterBox(placeholder: string, onInput: (q: string, raw: string) => void, value = ""): HTMLInputElement {
  const s = el("input", { type: "search", placeholder, "aria-label": placeholder, value }) as HTMLInputElement;
  s.value = value;
  s.addEventListener("input", () => onInput(s.value.trim().toLowerCase(), s.value));
  return s;
}

/**
 * A filterable table page: crumbs, filter, table. The title is for screen readers only; the description is on the home.
 * `rowClass`: a class per row (U24: `reg-N`, so region-sorted lists rule a line where the region changes).
 */
function listPage(title: string, rows: Row[], cols: Column[], search = (r: Row) => String(r.name), rowClass?: (r: Row) => string, hidden = 0,
  o: { href?: string; heads?: Record<string, () => HTMLElement> } = {}): HTMLElement {
  // R1 F15: everything hidden (the Maps list without Scribe): one empty state, no filter, count or empty table.
  if (!rows.length && hidden) return el("div", {}, crumbs(title), el("h1", { class: "sr-only" }, title), emptyList(title, hidden));
  const holder = el("div");
  const count = el("span", { class: "muted small" });
  // QA R2 F4: the sort lives here, not in the table rebuilt on each keystroke; filter and sort persist per route.
  const route = typeof location !== "undefined" ? location.hash || `#/${title}` : title;
  const st = loadListState(route);
  const show = (q: string) => {
    const shown = q ? rows.filter((r) => search(r).toLowerCase().includes(q)) : rows;
    count.textContent = `${shown.length} of ${rows.length}`;
    const t = table(shown, cols, rowClass, { sort: st.sort, onSort: (s) => {
      st.sort = s;
      saveListState(route, st);
    } });
    if (o.heads) headHelp(t, o.heads);
    holder.replaceChildren(t);
  };
  const filter = (q: string, raw: string) => {
    st.q = raw;
    saveListState(route, st);
    show(q);
  };
  show(st.q.trim().toLowerCase());
  const note = hiddenNote(hidden, title.toLowerCase());
  // R2-D F37: the section's description and definitions (once on the wiki home card) in a "?" beside the filter
  const help = o.href ? listHelp(o.href, title) : null;
  return el("div", {}, crumbs(title), el("h1", { class: "sr-only" }, title),
    el("div", { class: "toolbar" }, filterBox(`Filter ${title.toLowerCase()}`, filter, st.q), count, ...(help ? [help] : [])), ...(note ? [note] : []), holder);
}

/** R2-D F41: a "?" after the sort button of the named column headers ({ "Cost": () => helpTip(…) }). */
function headHelp(t: HTMLElement, heads: Record<string, () => HTMLElement>): void {
  for (const b of t.querySelectorAll<HTMLButtonElement>("thead th > button")) {
    const make = heads[b.textContent ?? ""];
    if (make) b.after(make());
  }
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
      visibleItems(t).map(([id, it]) => ({ label: searchText(itemName(t, id), it.name), kind: ITEM_TYPE_LABELS[t], node: () => itemLink(t, id) }))),
    ...visibleClasses().map(([id, c]) => ({ label: searchText(className(id), c.name), kind: "Class", node: () => classLink(id) })),
    ...visibleEnemyIds().flatMap((id) => [false, ...(hasRare(id) ? [true] : [])].map((rare) => {
      const en = rare ? quest(id).nameB : quest(id).name;
      // R1 F11: the rare variant's own name and the small "rare" pill, as everywhere in the wiki.
      return { label: searchText(enemyName(id, rare), en), kind: "Enemy", node: () => rare ? el("span", { class: "nowrap" }, enemyLink({ id, rare }), " ", pill("rare", "t-pink")) : enemyLink({ id, rare }) };
    })),
  ];
  // R2-D F37: compact tiles (icon, name, count), two to a row on a phone; the description is the tile's tooltip.
  const tiles = el("ul", { class: "wiki-tiles" }, ...CATEGORIES.map((c) =>
    el("li", {}, el("a", { href: c.href, title: c.about },
      el("span", { class: "wt-icon", "aria-hidden": "true" }, c.icon), el("span", { class: "wt-name" }, c.label),
      el("span", { class: "wt-count muted small", "aria-label": `${fmt.format(c.count())} entries` }, fmt.format(c.count()))))));
  const search = filterBox("Search skills, items, maps, enemies…", (q) => {
    // R2-D F39: the tiles step aside while a query is typed; each hit's kind is a small chip
    tiles.hidden = !!q;
    if (!q) return results.replaceChildren();
    const hits = all.filter((x) => x.label.toLowerCase().includes(q)).slice(0, 60);
    results.replaceChildren(hits.length
      ? el("ul", { class: "hits" }, ...hits.map((h) => el("li", {}, h.node(), " ", el("span", { class: "kind-chip" }, h.kind))))
      : none("Nothing matches."));
  });
  search.classList.add("big-search");
  return el("div", {}, el("h1", { class: "sr-only" }, "Wiki: everything in the game, read from the game's data"),
    search, results, tiles);
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
  const unused = skillNames().filter(isUnusedSkill);
  const page = listPage("Skills", listedSkillNames().map(toRow), cols,
    (r) => `${searchText(String(r.name), String(r.key))} ${r.effect} ${r.classes} ${r.enemyNames}`, undefined, 0, { href: "#/skills" });
  if (unused.length) {
    // R2-D F52: the sentence moved into the summary's "?"
    const help = helpTip("In the game's data, but no hero class learns them and no enemy plays them.", "unused skills");
    help.querySelector("button")?.addEventListener("click", (e) => e.preventDefault()); // the "?" doesn't open the list
    page.append(el("details", { class: "skills-unused" }, el("summary", {}, `Unused (${unused.length}) `, help),
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
  const all = goodAgainst(name).filter((m) => isVisible("enemy", m.quest) && !isGathering(m.quest));
  // U37: a rare variant with the same marks as its base enemy shares the base's row ("Wild Boar · Hogger" + rare pill)
  const same = (a: typeof all[number], b: typeof all[number]) => JSON.stringify(turnMarks(a)) === JSON.stringify(turnMarks(b));
  const rareOf = new Map<typeof all[number], typeof all[number]>();
  const list = all.filter((m) => {
    if (!m.rare) return true;
    const base = all.find((b) => !b.rare && b.quest === m.quest && same(b, m));
    if (base) rareOf.set(base, m);
    return !base;
  });
  // R2-D F54: nothing found is one muted line
  if (!list.length) return emptyLine(["Good against", G.abilityData?.[name] && classesWith("skill", name).length
    ? "No enemy-specific advantage found: a steady pick against any enemy." : "Not a hero skill."]);
  // U21: a table, one row per enemy (ranked), a ✓ on the enemy turns the skill answers; the reasons are the cell's
  // tooltip. "All" holds the reasons tied to no single turn (only when some enemy has one).
  const marks = list.map(turnMarks);
  const withAll = marks.some((m) => m.all.length);
  const mark = (why: string[], turn: string) => why.length
    ? el("td", { class: "good-mark", title: why.join("\n"), "aria-label": `${turn}: ${why.join("; ")}`, tabindex: "0" }, "✓")
    : el("td", { class: "good-mark empty" });
  const tbody = el("tbody", {}, ...list.map((m, i) => el("tr", {},
    el("td", { class: "num muted" }, String(i + 1)),
    el("td", {}, el("span", { class: "good-name" }, ...(m.rare ? variantNames({ id: m.quest, rare: m.name })
      : variantNames({ id: m.quest, base: m.name, rare: rareOf.get(m)?.name })))),
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
  const lines = enemyLines(enemies);
  const good = classesWith("skill", name).length ? goodAgainstSection(name) : null;
  // R1 F18 / F26: no emoji before the title, the effect in a card (no lead line); F33: a hero skill no enemy plays
  // has no empty "Enemies" section.
  return el("div", {}, crumbs(["Skills", "#/skills"], skillName(name)), el("h1", {}, skillName(name)),
    facts([["Effect", skillDesc(name) || "No description in the game data."], [statLink("ap", "AP cost"), skillAp(name)],
      ["Used by classes", users.length ? el("span", {}, ...joinNodes(users.map(([id]) => classLink(id)))) : "none"]]),
    ...(good ? [good] : []),
    ...(isHeroOnlySkill(name) ? [] : lines.length ? [section(`Enemies with this skill (${lines.length})`,
      el("ul", { class: "plain-list" }, ...lines.map((e) => el("li", {}, ...variantNames(e),
        el("span", { class: "muted small" }, ` level ${enemyLevelText(e.id)} · `), regionChip(regionOf("enemy", e.id), false, { tag: false })))),
      ...[hiddenNote(hidden, "enemies")].filter((x): x is HTMLElement => x !== null))]
      : [emptyLine(["Enemies with this skill", hidden ? "No enemy you can meet uses it." : "No quest enemy uses it."]),
        ...[hiddenNote(hidden, "enemies")].filter((x): x is HTMLElement => x !== null)]));
}

/** "Wild Boar · Hogger [rare]": the base name, then the rare variant's own name with the rare pill (as everywhere). */
function variantNames(e: EnemyLine): (Node | string)[] {
  const rare = e.rare !== undefined ? [el("span", { class: "nowrap" }, enemyLink({ id: e.id, name: e.rare, rare: true }), " ", pill("rare", "t-pink"))] : [];
  return e.base !== undefined ? [enemyLink({ id: e.id, name: e.base }), ...(rare.length ? [" · ", ...rare] : [])] : rare;
}

function passivesPage(): HTMLElement {
  const rows: Row[] = passiveNames().map((n) => ({ name: passiveName(n), key: n, bonus: passiveText(n), classes: visibleClassesWith("passive", n).map(([id]) => className(id)).join(", ") }));
  return listPage("Passives", rows, [
    { key: "name", label: "Passive", render: (r) => passiveLink(String(r.key)) }, { key: "bonus", label: "Bonus" },
    { key: "classes", label: "Classes", render: (r) => el("span", {}, ...joinNodes(visibleClassesWith("passive", String(r.key)).map(([id]) => classLink(id)))) },
  ], (r) => `${searchText(String(r.name), String(r.key))} ${r.bonus} ${r.classes}`, undefined, 0, { href: "#/passives" });
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
      id, name: itemName(type, id) ?? it.name, en: it.name, kind: eq ? slotName(it.itemSlot) ?? "" : itemTypeText(type, it.subType), sub: subtypeLabel(it.subType),
      level: it.itemLevel ?? null, rarity: it.rarity ?? null, ...priceSorts(type, id),
      made: it.crafterID ? crafterName(it.crafterID) : "drop", bonus: eq ? bonusLines(it).join(", ") : "",
      summary: eq ? it.subType ?? "" : itemText(type, id),
      region: regionSortKey(reg, it.itemLevel), regionId: reg?.id ?? 0, regionName: regionText(reg),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id)); // region, then level
  // U37: no Description column (an item's hover card has it, and the filter still matches it)
  const cols: Column[] = [
    { key: "name", label: "Item", render: (r) => itemLink(type, Number(r.id)) },
    { key: "region", label: "Region", render: (r) => regionChip(regionOf(type as "equipment", Number(r.id))) },
    { key: "kind", label: eq ? "Slot" : "Type" },
    ...(eq ? [{ key: "sub", label: "Kind" }] : []),
    { key: "level", label: "Level", num: true },
    { key: "rarity", label: "Rarity", num: true, render: (r) => rarityChip(r.rarity) },
    ...(eq ? [{ key: "bonus", label: "Bonus stats", render: (r: Row) => el("span", { class: "bonus-cell" }, String(r.bonus || "–")) },
      { key: "made", label: "Origin" }] : []),
    ...priceColumns(type, shown.map(([id]) => id)),
  ];
  return listPage(ITEM_TYPE_PLURALS[type], rows, cols,
    (r) => `${searchText(String(r.name), String(r.en))} ${r.kind} ${r.sub} ${r.summary} ${r.bonus} ${r.made} ${r.regionName}`, regionRowClass, all.length - shown.length,
    { href: `#/items/${type}`, heads: priceHeads(priceLevels(type, shown.map(([id]) => id))) });
}

// ---------------------------------------------------------------- prices by ascension (U37)
/** Whether the visitor sees an item's ascension variant (asc 1–2 are Scribe content, U28). */
const ascShown = (type: string, id: number, a: number) => !a || isVisible(type as ContentKind, id, { ascension: a });

/** The ascension variants a list shows: the type's (maps 0–1, materials 0 only), those some listed item has and the visitor sees. */
function priceLevels(type: string, ids: number[]): number[] {
  return ascLevels(type).filter((a) => !a || ids.some((id) => itemAscLevels(type, id).includes(a) && ascShown(type, id, a)));
}

/** Sort values of the price columns: the plain (asc 0) item's. */
const priceSorts = (type: string, id: number): Row => ({ cost: craftCost(type, id, 0), total: totalCost(type, id, 0), value: sellAt(type, id, 0) });

/** One price cell: a box per ascension shown, or a single dash when the item has none of them (not crafted). */
function priceCell(type: string, id: number, levels: number[], fn: (a: number) => number | null, what: string): HTMLElement | string {
  const vals = levels.map((a): [number, number | null] => [a, ascShown(type, id, a) ? fn(a) : null]);
  return vals.every(([, v]) => v === null) ? "–" : ascValues(vals, what);
}

/** Cost, Total cost and Sell value, each with a value per ascension variant (asc 0 / 1 / 2; maps 0 / 1). */
function priceColumns(type: string, ids: number[]): Column[] {
  const levels = priceLevels(type, ids);
  return [
    { key: "cost", label: "Cost", num: true, render: (r) => priceCell(type, Number(r.id), levels, (a) => craftCost(type, Number(r.id), a), "Crafting cost") },
    { key: "total", label: "Total cost", num: true, render: (r) => priceCell(type, Number(r.id), levels, (a) => totalCost(type, Number(r.id), a), "Total cost, every ingredient included") },
    { key: "value", label: "Sell value", num: true, render: (r) => priceCell(type, Number(r.id), levels, (a) => sellAt(type, Number(r.id), a), "Sell value") },
  ];
}

/** The key of a priced list's boxes: which outline is which ascension (R2-D F41: inside the headers' "?"). */
const ascLegend = (levels: number[]): HTMLElement => el("span", { class: "asc-legend" },
  ...levels.map((a) => el("span", { class: `av tier-${a}` }, `asc ${a}`)), " Gold per ascension variant.");

/** R2-D F41: the "?" on the Cost and Sell value headers: the ascension key, then what the gold columns hold. */
function priceHeads(levels: number[]): Record<string, () => HTMLElement> {
  return {
    "Cost": () => helpTip([ascLegend(levels), "Cost: one craft (an ascended craft also uses orbs).",
      "Total cost: the whole recipe, materials at their sell value."], "the cost columns", [statLink("craft")]),
    "Sell value": () => helpTip([ascLegend(levels), "Sell value: the game's price."], "the sell value", [statLink("sell")]),
  };
}

function safeSell(type: string, id: number, asc: number): number | null {
  try {
    return sellValue(type, id, asc) ?? null;
  } catch {
    return null;
  }
}

/** The recipe, or null when the item isn't crafted (R2-D F54: the page says so in its one muted line). */
function recipeList(type: string, id: number): HTMLElement | null {
  const rec = recipe(type, id);
  if (!rec.length) return null;
  return el("div", {},
    el("ul", { class: "plain-list" }, ...rec.map(([t, mid, amt]) => el("li", {}, `${amt} × `, itemLink(t, mid)))),
    // U30: cost and time link to Stats › Craft (× count, grade speed); R1 F07: "15 s", not "0 min" (recipe-chain.ts)
    el("p", { class: "muted small" }, ...craftLine(type, id)));
}

/**
 * Recipes that use the item; the ones the visitor hides (expansion content) are counted in a note, not listed.
 * `list` is null when none is shown, `empty` then says why (R2-D F54: one muted line).
 */
function usedInList(type: string, id: number): { list: HTMLElement | null; note: HTMLElement | null; empty: string } {
  const { shown: used, hidden } = partitionVisible(usedInRecipes(type, id), ([t, uid]) => isVisible(t as ContentKind, uid));
  const note = hiddenNote(hidden, hidden === 1 ? "recipe" : "recipes");
  const list = used.length
    ? el("ul", { class: "plain-list cols" }, ...used.map(([t, uid, amt]) => el("li", {}, itemLink(t, uid), el("span", { class: "muted small" }, ` × ${amt}`))))
    : null;
  return { list, note, empty: hidden ? "Not used in any recipe you can make." : "Not used in any recipe." };
}

const EQUIP_STATS = ["atk", "matk", "acc", "crit", "def", "mdef"];

/**
 * Base and bonus stats of a freshly crafted item at each grade (crafter level 60), for one configuration (U49: its
 * ascension, then its prefix and suffix applied as the game applies them: wiki-config equipmentAt). A prefix's stats
 * add to the bonus range of the same stat, or get a column of their own.
 */
function gradeRows(id: number, cfg: ItemConfig): HTMLElement {
  const it = item("equipment", id);
  const asc = cfg.asc;
  const added = cfg.prefix ? prefixStats(cfg.prefix) : {};
  const bonusKeys = [...new Set([...Object.keys(it?.bonusStat ?? {}), ...Object.keys(added)])];
  const diff = Math.max(0, 60 - (it?.itemLevel ?? 0));
  const rows: Row[] = [];
  for (let g = 1; g <= 5; g++) {
    const r: Row = { grade: GRADES[g - 1] };
    const made: Any = equipmentAt(id, g, cfg); // null: no stat formula for this subtype, bonus stats only
    if (made) for (const k of EQUIP_STATS) if (typeof made[k] === "number" && made[k]) r[k] = made[k];
    for (const k of bonusKeys) {
      const own = it.bonusStat?.[k] !== undefined ? bonusRange(k, it.bonusStat[k], g, asc, diff) : null;
      const plus = added[k] ?? 0;
      const pct = own ? own.pct : plus > -1 && plus < 1;
      // a fraction (atkPct 0.1) is shown in %, as bonusRange shows the item's own
      const add = pct ? Math.round(plus * 1000) / 10 : plus;
      const r1 = (x: number) => Math.round(x * 10) / 10;
      const b = own ? { lo: r1(own.lo + add), hi: r1(own.hi + add), pct } : plus ? { lo: add, hi: add, pct } : null;
      if (b) r[`b_${k}`] = b.lo === b.hi ? `${b.lo}${b.pct ? "%" : ""}` : `${b.lo}–${b.hi}${b.pct ? "%" : ""}`;
    }
    rows.push(r);
  }
  const keys = EQUIP_STATS.filter((k) => rows.some((r) => r[k] !== undefined));
  if (!keys.length && !bonusKeys.length) return none("No stats.");
  // R2-D F42: grades with the same numbers share one row ("D–S" when all five are the same)
  const gradeCell = (g: string) => {
    const [a, b] = g.split("–");
    return b ? el("span", { class: "grade-run", title: `Grades ${a} to ${b}` }, gradeBadge(a), "–", gradeBadge(b)) : gradeBadge(a);
  };
  return table(mergeGradeRows(rows), [{ key: "grade", label: "Grade", render: (r) => gradeCell(String(r.grade)) },
    ...keys.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), num: true })),
    ...bonusKeys.map((k) => ({ key: `b_${k}`, label: `${bonusLabel(k).replace(/^./, (x) => x.toUpperCase())} (bonus)` }))]);
}

/** U49: the grade table follows the page's configuration (its Ascension, Prefix and Suffix pickers at the top). */
const gradeHelp = (cfg: ItemConfig) => [
  `Freshly crafted by a level-60 crafter at ascension ${cfg.asc}, ${modCount(cfg)
    ? "then the prefix and suffix picked above added as the game adds them (a prefix adds its stats, a suffix raises the base stats)"
    : "no prefix or suffix"}.`,
  "Bonus stats roll in the range shown. Trinkets carry bonus stats only."];

// ---------------------------------------------------------------- configuration (U49)
/**
 * U49: the configuration pickers of an item or map page: Ascension (the ascensions the visitor sees, and the one the
 * URL asks for), Prefix and Suffix (what the item can carry, "None" first; the suffixes follow the ascension). A
 * change goes to the URL (replaceState: the link is the configured page, Back still leaves the page) and to `onChange`,
 * which redraws the page under the bar; the bar itself stays (focus kept). Null when there is nothing to pick.
 */
function configBar(type: string, id: number, start: ItemConfig, onChange: (c: ItemConfig) => void): HTMLElement | null {
  const ascs = validAscs(type, id).filter((a) => !a || a === start.asc || ascShown(type, id, a));
  const prefixes = validPrefixes(type, id);
  const topSuffixes = validSuffixes(type, id, Math.max(0, ...validAscs(type, id)));
  if (ascs.length < 2 && !prefixes.length && !topSuffixes.length) return null;
  const cur = { ...start };
  const emit = () => {
    history.replaceState(history.state, "", configRoute(type, id, cur));
    onChange({ ...cur });
  };
  const fields: HTMLElement[] = [];
  let suffixSelect: HTMLSelectElement | null = null;
  /** The suffix options of the current ascension; a suffix it can't carry goes back to None. */
  const fillSuffixes = () => {
    if (!suffixSelect) return;
    const list = validSuffixes(type, id, cur.asc);
    if (!list.includes(cur.suffix)) cur.suffix = 0;
    suffixSelect.replaceChildren(...[[0, "None"] as [number, string], ...list.map((s): [number, string] => [s, `${suffixName(s)} · ${suffixEffect(type, s)}`])]
      .map(([v, label]) => el("option", { value: String(v) }, label)));
    suffixSelect.value = String(cur.suffix);
  };
  if (ascs.length > 1) {
    const seg = segmented(`cfg-asc-${type}`, "Ascension", ascs.map((a) => ({ value: String(a), label: String(a), cls: `asc-opt tier-${a}`, title: `Ascension ${a}` })),
      String(cur.asc), (v) => {
        cur.asc = Number(v);
        fillSuffixes();
        emit();
      });
    fields.push(segField(statLink("essence", "Ascension"), seg, "cls-asc cfg-asc"));
  }
  const pick = (label: string, s: HTMLSelectElement) => el("label", { class: "cfg-pick" }, el("span", { class: "seg-label" }, label), s);
  if (prefixes.length) {
    // "[Titan] · enemy HP +240, essence ×1.3": the game's prefix in brackets (U34 names), then what it does here
    const pre = select({ class: "cfg-select" }, [["0", "None"], ...prefixes.map((p): [string, string] => [String(p), `[${prefixTag(p)}] · ${prefixEffect(type, id, p)}`])]);
    pre.value = String(cur.prefix);
    pre.addEventListener("change", () => {
      cur.prefix = Number(pre.value);
      emit();
    });
    fields.push(pick("Prefix", pre));
  }
  if (topSuffixes.length) {
    suffixSelect = select({ class: "cfg-select" }, []);
    fillSuffixes();
    const s = suffixSelect;
    s.addEventListener("change", () => {
      cur.suffix = Number(s.value);
      emit();
    });
    fields.push(pick("Suffix", s));
  }
  return el("div", { class: "wiki-config cls-v3", role: "group", "aria-label": "Show this item with" }, ...fields);
}

/** The page's title link: "[Prefix] Name +N" in the configuration's rarity, outlined by its ascension (U49). */
function configTitle(type: string, id: number, cfg: ItemConfig): HTMLElement {
  const label = modCount(cfg) ? modItemName(type, id, cfg) : undefined;
  return itemLink(type, id, label, modCount(cfg) ? configRarity(type, id, cfg) ?? undefined : undefined, cfg.asc, { config: cfg });
}

/** What the configuration's prefix and suffix do on this item, as facts ([] when it has none). */
function modifierFacts(type: string, id: number, cfg: ItemConfig): FactPair[] {
  return [
    ["Prefix", cfg.prefix ? `[${prefixTag(cfg.prefix)}] · ${prefixEffect(type, id, cfg.prefix)}` : undefined],
    ["Suffix", cfg.suffix ? `${suffixName(cfg.suffix)} · ${suffixEffect(type, cfg.suffix)}` : undefined],
  ];
}

/**
 * A configurable page: crumbs, the title, the pickers, then `body` drawn for the configuration (again on each change;
 * the document title follows the h1).
 */
function configuredPage(type: string, id: number, query: URLSearchParams, crumbsEl: HTMLElement, body: (cfg: ItemConfig) => (Node | string)[], cls = ""): HTMLElement {
  let cfg = CONFIG_TYPES.has(type) ? parseConfig(type, id, query) : { ...NO_CONFIG };
  const h1 = el("h1");
  const holder = el("div", { class: "cfg-body" });
  const draw = () => {
    h1.replaceChildren(configTitle(type, id, cfg));
    holder.replaceChildren(...body(cfg));
  };
  const bar = CONFIG_TYPES.has(type) ? configBar(type, id, cfg, (c) => {
    cfg = c;
    draw();
    document.title = `${h1.textContent?.replace(/^[^\w[]+/, "") || "Wiki"} · Merchant RPG Simulator`;
  }) : null;
  draw();
  return el("div", cls ? { class: cls } : {}, crumbsEl, h1, ...(bar ? [bar] : []), holder);
}

/** The crafting chain with its explanation moved from under the diagram into the section's "?". */
function chainSection(chain: HTMLElement): HTMLElement {
  const note = chain.querySelector(":scope > p.muted");
  const text = note?.textContent ?? "";
  note?.remove();
  const s = section("Crafting chain", chain);
  return text ? sectionHelp(s, text, [statLink("craft")]) : s;
}

function itemPage(type: string, id: number, query = new URLSearchParams()): HTMLElement {
  const it = item(type, id);
  if (!it) return notFound(`${type} #${id}`);
  const listHref = `#/items/${type}`;
  if (!isVisible(type as ContentKind, id)) {
    return hiddenPage([ITEM_TYPE_PLURALS[type], listHref], itemName(type, id) ?? it.name, "", needsOf(type as ContentKind, id));
  }
  // U49: equipment and consumables open on the ascension, prefix and suffix of the URL (#/item/equipment/5?asc=1&suffix=3)
  return configuredPage(type, id, query, crumbs([ITEM_TYPE_PLURALS[type], listHref], itemName(type, id) ?? it.name), (cfg) => itemBody(type, id, cfg));
}

/** An item page under its title and pickers, for one configuration (U49). */
function itemBody(type: string, id: number, cfg: ItemConfig): (Node | string)[] {
  const it = item(type, id);
  // R1 F18: no lead line when the Effect card says the same ("Restores 40 health" beside "+40 HP")
  const effect = type === "consumable" && Object.keys(it.stat ?? {}).length > 0;
  const desc = effect ? "" : itemText(type, id);
  // R1 F43: the stackables' data pair is in each box's tooltip; ascension 1–2 only where the visitor sees them.
  // U49: with the configuration's prefix and suffix (a modifier raises the rarity, so the price).
  const sells = [0, 1, 2].filter((a) => (type !== "material" || a === 0) && (!a || a === cfg.asc || isVisible(type as ContentKind, id, { ascension: a })))
    .map((a): [number, number | null] => [a, itemAscLevels(type, id).includes(a) || !a ? configSell(type, id, a, cfg) : null])
    .filter((x): x is [number, number] => x[1] !== null);
  const bonus = type === "equipment" ? bonusLines(it) : [];
  // U49: a consumable's effect at the picked ascension (default.consumableStat: ascended potions and scrolls scale)
  const stats = effect ? consumableStatsAt(id, cfg.asc) : {};
  const mods = modifierFacts(type, id, cfg);
  const kids: (Node | string)[] = [
    ...(desc ? [el("p", { class: "lead" }, desc)] : []),
    // R2-D F42: one strip of facts instead of five cards; the region's reason is its chip's tooltip
    factStrip([
      itemTypeText(type, it.subType, type === "equipment" ? slotName(it.itemSlot) : undefined),
      `lvl ${it.itemLevel ?? 0}`, ((r) => (r ? regionChip(r) : null))(regionOf(type as "equipment", id)), rarityChip(configRarity(type, id, cfg) ?? it.rarity),
      it.crafterID ? crafterName(it.crafterID) : null,
      sells.length ? el("span", { class: "nowrap-group" }, statLink("sell", "Sell"), " ", sellBoxes(type, id, sells)) : null,
    ]),
    ...(bonus.length || effect || modCount(cfg) ? [facts([
      [statLink("item-stats", "Bonus stats"), bonus.length ? bonus.join(", ") : undefined],
      ["Effect", effect ? Object.entries<number>(stats).map(([k, v]) => statText(k, v)).join(", ") : undefined],
      ...mods,
    ])] : []),
  ];
  if (type === "equipment") kids.push(sectionHelp(section("Stats by grade", gradeRows(id, cfg)), gradeHelp(cfg), [statLink("item-stats")]));
  // R2-D F54: the empty sections end the page as one muted line ("Recipe · Not craftable. · Used in · Not used…")
  const empty: [string, string][] = [];
  // Sources in content the visitor hides (a Frentir enemy, a map without Scribe) are counted, not listed.
  const allSrc = type === "material" || type === "equipment" ? dropSources(id, type) : [];
  const { shown: src, hidden: hiddenSrc } = partitionVisible(allSrc, (s) => isVisible(s.kind === "map" ? "map" : "enemy", s.id));
  const srcNote = hiddenNote(hiddenSrc, hiddenSrc === 1 ? "source" : "sources");
  if (src.length) {
    kids.push(section(`Where it drops (${src.length})`,
      // R1 F11: a rare variant is its own name + the small rare pill, as in the lists
      el("ul", { class: "plain-list" }, ...src.map((s) => el("li", {}, s.kind === "map" ? itemLink("map", s.id) : enemyLink({ id: s.id, name: s.label, rare: s.rare }),
        s.rare ? pill("rare", "t-pink") : "",
        el("span", { class: "muted small" }, ` · ${s.detail}`)))), ...(srcNote ? [srcNote] : [])));
  } else if (type === "material" || allSrc.length) {
    empty.push(["Drops", hiddenSrc ? "Not dropped by anything you can reach." : "Not dropped by quests or maps (crafted, bought or event only)."]);
  }
  const chain = recipeChain(type, id);
  if (chain) kids.push(chainSection(chain), ...(isPlain(cfg) ? [] : [configNote(cfg, "chain")]));
  const rec = recipeList(type, id);
  if (rec) kids.push(section("Recipe", rec, ...recipeNotes(type, id, cfg)));
  else empty.push(["Recipe", "Not craftable."]);
  const used = usedInList(type, id);
  if (used.list) kids.push(section("Used in", used.list, ...(used.note ? [used.note] : [])));
  else empty.push(["Used in", used.empty]);
  if (empty.length) kids.push(emptyLine(...empty));
  if (!src.length && srcNote) kids.push(srcNote);
  if (!used.list && used.note) kids.push(used.note);
  return kids;
}

/**
 * U49: a configured page's recipe: an ascended craft is the same recipe with its ingredients at that ascension plus the
 * essence (gamedata essenceForAscension); a prefix or suffix is never part of a recipe (rolled at the craft, or added
 * by the Enchanter), so the gold and time shown stay those of the plain craft, marked.
 */
function recipeNotes(type: string, id: number, cfg: ItemConfig): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (cfg.asc) {
    const ess = ascCraftEssence(type, id, cfg.asc);
    out.push(el("p", { class: "small cfg-note" }, `Ascension ${cfg.asc}: the ingredients above at ascension ${cfg.asc}`,
      ...(ess ? [", plus ", el("span", { class: "nowrap" }, `${fmt.format(ess[1])} × `, itemLink("material", ess[0]))] : []), "."));
  }
  if (!isPlain(cfg)) out.push(configNote(cfg, "recipe"));
  return out;
}

/** The "base" mark of a part a configuration doesn't change in the data the page has (U49). */
function configNote(cfg: ItemConfig, what: "chain" | "recipe"): HTMLElement {
  const text = what === "chain" ? `The crafting chain and its totals are those of the plain item at ascension 0.`
    : modCount(cfg) ? "Gold and time shown: the plain craft's. A prefix or suffix is rolled at the craft or added by the Enchanter, not crafted." : "Gold and time shown: the plain craft's.";
  return el("p", { class: "small muted cfg-note" }, el("span", { class: "cfg-base", "aria-hidden": "true" }, "base"), " ", text);
}

// ---------------------------------------------------------------- maps
/**
 * U53: the Base time fact. The base time is the run's walk time, which a speed prefix (Quick +4, Swift +8) cuts: the
 * time with it (wiki-config mapBaseTime, the engine's formula), the plain time in its title. "base" only when the
 * engine couldn't build the map.
 */
function baseTimeFact(plain: number, speed: number | undefined, withSpeed: number | null): HTMLElement {
  if (!speed) return el("span", {}, duration(plain));
  if (withSpeed === null) return el("span", {}, duration(plain), " ", baseTag(`Before the prefix's speed +${speed}: the engine could not build this map`));
  return el("span", { title: `${duration(plain)} before the prefix's speed +${speed}` }, duration(withSpeed), el("span", { class: "muted small" }, ` −${Math.min(speed, 75)}%`));
}

/** "50 × Forest Essence" per essence of a map run. */
function essenceParts(m: Any): HTMLElement[] {
  const br = seq<number>(m.baseReward ?? {});
  const half = Math.floor(br.length / 2);
  return Array.from({ length: half }, (_, i) => el("span", { class: "nowrap" }, `${br[i + half]} × `, itemLink("material", br[i])));
}
const essenceOf = (m: Any): (Node | string)[] => joinNodes(essenceParts(m));

function mapsPage(): HTMLElement {
  const all = items("map");
  const rows: Row[] = all.filter(([id]) => isVisible("map", id)).map(([id, m]): Row => {
    const reg = regionOf("map", id);
    return {
      id, name: itemName("map", id) ?? m.name, en: m.name, level: m.itemLevel ?? null, rooms: m.baseEnemyAmount ?? null, minutes: m.baseMapTime ? m.baseMapTime / 60 : null,
      mod: m.enemyMod ?? null, boss: seq<number>(m.bossList ?? {}).map((b) => searchText(enemyName(b), quest(b)?.name)).filter(Boolean).join(", "),
      region: regionSortKey(reg, m.itemLevel), regionId: reg?.id ?? 0, regionName: regionText(reg), ...priceSorts("map", id),
    };
  }).sort((a, b) => Number(a.region) - Number(b.region) || Number(a.id) - Number(b.id));
  const ids = rows.map((r) => Number(r.id));
  return listPage("Maps", rows, [
    { key: "name", label: "Map", render: (r) => itemLink("map", Number(r.id)) },
    { key: "region", label: "Region", render: (r) => regionChip(regionOf("map", Number(r.id))) }, { key: "level", label: "Level", num: true },
    { key: "rooms", label: "Rooms", num: true }, { key: "minutes", label: "Base time", num: true, show: (v) => (typeof v === "number" ? duration(v * 60) : "") }, { key: "mod", label: "Enemy ×", num: true },
    { key: "boss", label: "Boss", render: (r) => el("span", {}, ...joinNodes(seq<number>(item("map", Number(r.id)).bossList ?? {}).map((b) => enemyLink({ id: b })))) },
    { key: "essence", label: "Essence per run", render: (r) => el("span", {}, ...essenceOf(item("map", Number(r.id)))) },
    ...priceColumns("map", ids), // U37: maps go up to asc 1, so two values per cell
  ], (r) => `${searchText(String(r.name), String(r.en))} ${r.boss} ${r.regionName}`, regionRowClass, all.length - rows.length,
  { href: "#/maps", heads: priceHeads(priceLevels("map", ids)) });
}

function mapPage(id: number, query = new URLSearchParams()): HTMLElement {
  const m = item("map", id);
  if (!m) return notFound(`map #${id}`);
  if (!isVisible("map", id)) return hiddenPage(["Maps", "#/maps"], itemName("map", id) ?? m.name, "", needsOf("map", id));
  // U49: the map opens on the ascension, prefix and suffix of the URL (#/map/22?asc=1&prefix=20&suffix=5)
  return configuredPage("map", id, query, crumbs(["Maps", "#/maps"], itemName("map", id) ?? m.name), (cfg) => mapBody(id, cfg));
}

/**
 * A map page under its title and pickers, for one configuration (U49). The figures come from the map the engine builds
 * with it at grade C (wiki-config mapView): rarity, Enemy ×, sell value, essence per run, and every enemy's stats
 * inside the map. Rooms, level and boss don't depend on a modifier; a speed prefix cuts the base time (U53: baseTimeFact). "Fight in simulator" opens the map run.
 */
function mapBody(id: number, cfg: ItemConfig): (Node | string)[] {
  const m = item("map", id);
  const view = mapView(id, cfg);
  const mod = view?.enemyMod ?? m.enemyMod ?? 1;
  const bosses = seq<number>(m.bossList ?? {});
  const bush = treasureBushOf(m.itemLevel ?? 0);
  const prefixBonus = Object.keys(view?.prefixStats ?? {}).some((k) => /Bns$|Pct$/.test(k));
  const modHelp = `Each enemy's stats inside this map at grade C, as the game sets them from Enemy × (×${fmt.format(mod)}`
    + `${isPlain(cfg) ? "" : ", ascension and modifiers included"}): with m = (Enemy × − 1) / 2, HP × 1.5m, Atk and Matk × m, Def, Mdef and Eva × (0.75 + 0.25m)`
    + `${prefixBonus ? ", the prefix's bonus added first and its % applied after" : ""}. Grade A adds 0.1 to Enemy ×, grade S 0.25.`;
  const speed = view?.prefixStats.speed;
  const essence = view?.essence.length
    ? view.essence.map(([eid, amt]) => el("span", { class: "nowrap" }, `${fmt.format(amt)} × `, itemLink("material", eid)))
    : [...essenceParts(m), ...(isPlain(cfg) ? [] : [baseTag("The engine could not build this map with these modifiers: the plain map's essence")])];
  const sell = view ? view.sell : safeSell("map", id, 0);
  const enemies = (ids: number[]) => enemyTable(ids, view?.stats ?? null);
  return [
    // R1 F17: the flavour sentence only; the game's "Boss: … Mod: Nx" tail named bosses loosely (the Boss table has them).
    ...(mapFlavour(id) ? [el("p", { class: "lead" }, mapFlavour(id))] : []),
    ...fightButton(mapFightTarget(id, cfg), modCount(cfg) ? "The plain map at this ascension, grade C: the simulator's maps take no prefix or suffix." : undefined),
    // R2-D F43: compact facts, three to a row on a phone; the essence spans the row
    compactFacts([["Level", m.itemLevel], ["Region", regionChip(regionOf("map", id))], ["Rarity", rarityChip(view?.rarity ?? m.rarity)], ["Rooms", m.baseEnemyAmount],
      ["Base time", m.baseMapTime ? baseTimeFact(m.baseMapTime, speed, view?.baseTime ?? null) : undefined],
      [statLink("map-essence", "Enemy ×"), `×${fmt.format(mod)}`], ["Rare boss", m.isRareBoss ? "yes" : undefined],
      [statLink("sell", "Sell value"), sell !== null ? gold(sell) : undefined],
      ...modifierFacts("map", id, cfg),
      // R1 F16: the essence names wrap inside the card ("500 × Essence de la forêt" in French).
      [statLink("map-essence", "Essence per run"), el("span", { class: "ess-fact" }, ...essence)]]),
    bosses.length ? sectionHelp(section(`Boss${bosses.length > 1 ? "es" : ""}`, enemies(bosses)), modHelp, [statLink("map-essence")]) : emptyLine(["Boss", "None."]),
    sectionHelp(section("Room enemies", enemies(mapEnemies(m))), modHelp, [statLink("map-essence")]),
    // U24: the Treasure Bush of the map's level band (added to a room at run time, so not in the map's own lists)
    ...(bush && isEnemy(bush) ? [sectionHelp(section("Treasure", enemies([bush])), [TREASURE_HELP, modHelp], [statLink("map-essence")])] : []),
    ((rec) => (rec ? section("Recipe", rec, ...recipeNotes("map", id, cfg)) : emptyLine(["Recipe", "Not craftable."])))(recipeList("map", id)),
  ];
}

// ---------------------------------------------------------------- enemies
function enemiesPage(): HTMLElement {
  const all = enemyListRows();
  const rows = all.filter((r) => isVisible("enemy", Number(r.id)));
  return listPage("Enemies", rows, enemyListColumns,
    (r) => `${r.name} ${r.rareName} ${r.en} ${r.kind} ${r.skills} ${r.regionName}`, regionRowClass, all.length - rows.length, { href: "#/enemies" });
}

function enemyPage(id: number): HTMLElement {
  const q = quest(id);
  if (!isEnemy(id)) return notFound(`enemy #${id}`);
  const needs = needsOf("enemy", id);
  const name = enemyName(id) ?? q.name;
  if (!isVisible("enemy", id)) return hiddenPage(["Enemies", "#/enemies"], name, "👹", needs);
  return el("div", { class: "enemy-page" }, crumbs(["Enemies", "#/enemies"], name), el("h1", {}, "👹 ", name, ...(needs.length ? [expansionBadge(needs, { link: true })] : [])),
    el("p", { class: "lead" }, enemyLead(id)), ...fightButton(enemyFightTarget(id)),
    ...enemyBody(id, compactFacts, section, emptyLine));
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

/** Skills and passives of a class in the same table: # (U54: the unlock lvl when `levels` is given), name, (AP), effect. */
function abilityTable(kind: "skill" | "passive", names: string[], levels?: (number | null)[]): HTMLElement {
  const skill = kind === "skill";
  const head = el("tr", {}, el("th", { scope: "col", class: "n" }, levels ? LV : "#"), el("th", { scope: "col" }, skill ? "Skill" : "Passive"),
    ...(skill ? [el("th", { scope: "col", class: "ap-col" }, statLink("ap", "AP"))] : []),
    el("th", { scope: "col" }, skill ? "Effect" : "Bonus"));
  const rows = names.map((n, i) => {
    const link = skill ? skillLink(n) : passiveLink(n);
    const tr = el("tr", {}, levels ? unlockCell(levels[i] ?? null) : el("td", { class: "n" }, String(i + 1)), el("td", { class: "name" }, link),
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
  ], (r) => `${searchText(String(r.name), String(r.en))} ${r.about}`, undefined, classes().length - shown.length, { href: "#/classes" });
}

/** Class page; `#/class/ID/LEVEL/ASC` opens it on a level and ascension (the picker keeps the URL in step). */
function classPage(id: number, level?: string, asc?: string): HTMLElement {
  const c = G.heroList?.[id];
  if (!c) return notFound(`class #${id}`);
  if (!isVisible("class", id)) return hiddenPage(["Classes", "#/classes"], className(id) ?? c.name, "", needsOf("class", id));
  // U54: each skill's unlock level; a skill past lvl 50 needs the Frozen Tome and is hidden with it
  const unlocks = skillUnlockLevels(id);
  const allSkills = seq<string>(c.skillList ?? {}).map((n, i) => [n, unlocks[i] ?? null] as const);
  const { shown: shownSkills, hidden: hiddenSkills } = partitionVisible(allSkills, ([, l]) => l === null || isVisible("level", l));
  const skills = shownSkills.map(([n]) => n);
  const passives = seq<string>(c.passiveList ?? {});
  const start = { level: level ? Number(level) : undefined, asc: asc ? Number(asc) : undefined };
  // R2-D F47: no stat cards (the radar shows the values); the radar's caption is the Stats section's "?"
  const { block } = classStats(id, start, (s) => history.replaceState(null, "", `#/class/${id}/${s.level}/${s.asc}`));
  return el("div", { class: `cls-${id}` }, crumbs(["Classes", "#/classes"], className(id) ?? c.name), el("h1", {}, classLink(id, { always: true })),
    ...(classText(id) ? [el("p", { class: "lead" }, classText(id))] : []),
    sectionHelp(section("Stats", block, ...[hiddenNote(tiersOf(c).filter((p) => !isVisible("prestige", p)).length, "ascension tier (levels 51–60)")].filter((x): x is HTMLElement => x !== null)),
      RADAR_HELP, [statLink("hero-stats")]),
    passives.length ? section(`Passives (${passives.length}, pick one from level 10)`, abilityTable("passive", passives)) : emptyLine(["Passives", "None."]),
    section(`Skills (${skills.length})`, abilityTable("skill", skills, shownSkills.map(([, l]) => l)),
      ...[hiddenNote(hiddenSkills, "skills")].filter((x): x is HTMLElement => x !== null)));
}

// ---------------------------------------------------------------- router
function notFound(what: string): HTMLElement {
  return el("div", {}, crumbs("Not found"), el("h1", {}, "Not found"), el("p", {}, `No ${what} in the game data. `, el("a", { href: "#/" }, "Back to the wiki")));
}

function route(): HTMLElement {
  // U49: a details page's configuration is the route's query (#/map/22?asc=1&prefix=20&suffix=5)
  const { parts, query } = parseHash(location.hash);
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return home();
    case "skills": return skillsPage();
    case "skill": return skillPage(parts.slice(1).join("/"));
    case "passives": return passivesPage();
    case "passive": return passivePage(parts.slice(1).join("/"));
    case "items": return itemsPage(b);
    case "item": return itemPage(b, Number(c), query);
    case "maps": return mapsPage();
    case "map": return mapPage(Number(b), query);
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

/** The enemy pages (strip, first mover) and skill pages ("Good against") read the timelines; no other route does. */
function needsTimelines(hash = location.hash): boolean {
  const first = parseHash(hash).parts[0];
  return first === "enemy" || first === "skill";
}

/** Draw the route. `top`: scroll to the top (a new page); a change of the expansion switches keeps the place. */
async function render(top = true): Promise<void> {
  const main = $("#wiki");
  try {
    await ready;
    // Enemy timelines (U11): optional (the enemy pages show the plain rotation without them), and fetched only for
    // the routes that use them (review F15).
    if (needsTimelines()) await loadTimelineData().catch(() => {});
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
    document.title = `${h1?.textContent?.replace(/^[^\w[]+/, "") || "Wiki"} · Merchant RPG Simulator`; // "[Prefix] Map" keeps its "["
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
