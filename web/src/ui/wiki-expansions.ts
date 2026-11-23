/**
 * Wiki page "Expansions" (#/expansions, #/expansions/frozen | scribe | both | site, U28): what the Frozen Tome and
 * Scribe expansions add, the content behind each one (lists from contentExpansion, every link shown even when the
 * visitor hides it), how the site guesses ownership, and the visitor's own switches. Rules and sources:
 * docs/game-economy/expansions/expansions.md, web/src/tools/expansions.ts.
 */
import { G } from "../sim/data.ts";
import { EXPANSIONS } from "../tools/expansions.ts";
import { el, EXPANSION_LABEL, expansionBadge } from "./dom.ts";
import {
  type Expansion, inferredState, needsOf, overrideOf, owns, setOverride, setOwned, setShowAll, showAll,
} from "./expansion-state.ts";
import { classes, classLink, enemyIds, enemyLink, ITEM_TYPES, itemLink, items, itemTypeLabel, quest } from "./wiki-data.ts";

const XP: Expansion[] = ["Frozen", "Scribe"];
type Group = "frozen" | "scribe" | "both";
const GROUPS: [Group, Expansion[], string][] = [["frozen", ["Frozen"], "Frozen Tome"], ["scribe", ["Scribe"], "Scribe"], ["both", ["Frozen", "Scribe"], "Content behind both"]];
const groupOf = (needs: Expansion[]): Group | null =>
  needs.length === 2 ? "both" : needs[0] === "Frozen" ? "frozen" : needs[0] === "Scribe" ? "scribe" : null;

/** Hand-written details, beyond EXPANSIONS[x].adds (docs/game-economy/expansions/expansions.md). */
const DETAILS: Record<Group, string[]> = {
  frozen: [
    "Region 6, Frentir Chasm: the region arrow stops at region 5 without it; its board quests are 72, 73 and 77–90.",
    "The Bard (hero class 9), and hero ascension 2 (prestige 3): heroes of the first two tiers stop at level 50, the third reaches 60.",
    "Region-6 materials (Glacial ingots and lumber, Frentir drops and trophies, Obsidian, Oblivion runes and crystals, Odin's and Faust's drops), so every item above level 50, the Glacial Dagger and Wand, and potions 43–54 and 56.",
    "+2 hero slots and +16 inventory slots, shop theme 7 and merchant skin 12.",
  ],
  scribe: [
    "Crafter 8, the Scribe, who makes the maps (1–32) and the map scrolls (60–69).",
    "Maps & dungeons: rooms of enemies, a boss (the map bosses 91–94) and a Treasure Bush, and the essences that only maps give (tier 1, and tier 2 from ascended maps).",
    "Crafter and item ascension: ascending an item costs its region's essence; every ascended item needs Scribe.",
    "17 rarity-7 recipes (equipment 764–780) stay locked without it.",
    "+3 hero slots and +16 inventory slots; the map-run daily orders.",
  ],
  both: [
    "Maps 21–28: Scribe recipes made from region-6 materials or Glacial Essence (27 and 28, level 70, can't be crafted).",
    "Their bosses and treasure: Protector of the Forest, King of the Mountain, Archon, The Mighty Bush, the region-6 Treasure Bush.",
    "Glacial and Arctic Essence and the trophies of those bosses, the locked recipes made from them (772–780), and any ascended item above level 50.",
  ],
};

interface Gated { enemies: number[]; classes: number[]; items: Record<string, number[]> }
let cache: Record<Group, Gated> | null = null;
/** Every piece of content behind each expansion group, from contentExpansion. */
function gated(): Record<Group, Gated> {
  if (cache) return cache;
  const out = Object.fromEntries(GROUPS.map(([g]) => [g, { enemies: [], classes: [], items: Object.fromEntries(ITEM_TYPES.map((t) => [t, []])) }])) as unknown as Record<Group, Gated>;
  for (const id of enemyIds()) {
    const g = groupOf(needsOf("enemy", id));
    if (g) out[g].enemies.push(id);
  }
  for (const [id] of classes()) {
    const g = groupOf(needsOf("class", id));
    if (g) out[g].classes.push(id);
  }
  for (const t of ITEM_TYPES) {
    for (const [id] of items(t)) {
      const g = groupOf(needsOf(t, id));
      if (g) out[g].items[t].push(id);
    }
  }
  if (G.questData && Object.keys(G.questData).length) cache = out;
  return out;
}

const plural: Record<string, string> = { equipment: "Equipment", consumable: "Consumables", material: "Materials", map: "Maps" };

/** "Enemies (16)" with every name linked (always the real link: this page lists them on purpose). */
function listBlock(label: string, nodes: HTMLElement[]): HTMLElement | null {
  if (!nodes.length) return null;
  return el("details", { class: "xp-list" }, el("summary", {}, `${label} (${nodes.length})`),
    el("ul", { class: "plain-list cols" }, ...nodes.map((n) => el("li", {}, n))));
}

function groupSection(g: Group, needs: Expansion[], title: string): HTMLElement {
  const c = gated()[g];
  const info = needs.length === 1 ? EXPANSIONS[needs[0]] : null;
  const lists = [
    listBlock("Enemies", c.enemies.map((id) => enemyLink({ id }, { always: true }))),
    listBlock("Hero classes", c.classes.map((id) => classLink(id, { always: true }))),
    ...(["map", "equipment", "consumable", "material"] as const).map((t) => listBlock(plural[t] ?? itemTypeLabel[t], c.items[t].map((id) => itemLink(t, id, undefined, undefined, undefined, { always: true })))),
  ].filter((x): x is HTMLElement => x !== null);
  const own = needs.every((x) => owns(x));
  return el("section", { class: "wiki-section xp-section", id: `xp-${g}` },
    el("h2", { class: "wiki-banner" }, expansionBadge(needs), ` ${title}`),
    ...(info ? [el("p", { class: "lead" }, el("strong", {}, `${info.storeTitle}. `), info.description)] : []),
    el("p", { class: "muted small" }, own ? "✓ You own it: its content is shown." : showAll() ? "Not owned, shown because “Show expansion content” is on." : "Not owned: its content is hidden on the site."),
    ...(info ? [el("h3", { class: "sub" }, "What it adds"), el("ul", {}, ...info.adds.map((a) => el("li", {}, a)))] : []),
    el("h3", { class: "sub" }, info ? "In detail" : "What it is"), el("ul", {}, ...DETAILS[g].map((d) => el("li", {}, d))),
    el("h3", { class: "sub" }, "Content behind it"),
    lists.length ? el("div", { class: "xp-lists" }, ...lists) : el("p", { class: "muted" }, "Nothing listed."));
}

/** The visitor's switches, as plain checkboxes (the same state as the expansions menu in the top bar). */
function controls(): HTMLElement {
  const inf = inferredState();
  const box = (label: (Node | string)[], on: boolean, set: (v: boolean) => void, hint: string) => {
    const c = el("input", { type: "checkbox" }) as HTMLInputElement;
    c.checked = on;
    c.addEventListener("change", () => set(c.checked));
    return el("label", { class: "check xp-switch", title: hint }, c, ...label);
  };
  const reset = el("button", { type: "button", class: "link-btn" }, "Use the save's guess again");
  reset.addEventListener("click", () => XP.forEach((x) => setOverride(x, null)));
  const anyOverride = XP.some((x) => overrideOf(x) !== null);
  return el("div", { class: "xp-controls" },
    el("p", {}, inf.source === null ? "No save loaded: the site assumes you own no expansion until you say so."
      : `Guessed from ${inf.source}: ${inf.owned.length ? inf.owned.map((x) => EXPANSIONS[x].name).join(" and ") : "no expansion proven"}.`),
    ...(inf.evidence.length ? [el("ul", { class: "small muted" }, ...inf.evidence.map((e) => el("li", {},
      e.expansion === "either" ? "One of the two: " : `${EXPANSIONS[e.expansion].name}: `, e.reason)))] : []),
    el("div", { class: "toolbar" },
      ...XP.map((x) => box([expansionBadge([x]), ` I own ${EXPANSIONS[x].name}`], owns(x), (v) => setOwned(x, v),
        overrideOf(x) !== null ? "Set by hand" : inf.source ? "From the save's guess" : "No save loaded")),
      box([" Show expansion content"], showAll(), setShowAll, "Show the content of every expansion, owned or not")),
    ...(anyOverride ? [el("p", { class: "small" }, "Some switches are set by hand. ", reset)] : []));
}

export function expansionsPage(topic?: string): HTMLElement {
  if (topic && ["frozen", "scribe", "both", "site"].includes(topic)) {
    requestAnimationFrame(() => document.getElementById(`xp-${topic}`)?.scrollIntoView({ block: "start" }));
  }
  const bushes = [99, 100, 101, 102, 103, 104].filter((id) => quest(id)).length;
  return el("div", { class: "xp-page" },
    el("p", { class: "crumbs small" }, el("a", { href: "#/" }, "Wiki"), el("span", { "aria-hidden": "true" }, " › "), el("span", {}, "Expansions")),
    el("h1", {}, "🧩 Expansions"),
    el("p", { class: "lead" }, "Merchant has two paid expansions, the ", el("strong", {}, "Frozen Tome"), " and ", el("strong", {}, "Scribe"),
      " (the “everything” bundle has both; boost potions are a separate purchase, not an expansion). Everything that needs one carries its icon next to its name, everywhere on the site: ",
      expansionBadge(["Frozen"]), ` ${EXPANSION_LABEL.Frozen}, `, expansionBadge(["Scribe"]), ` ${EXPANSION_LABEL.Scribe}; content behind both shows both.`),
    el("section", { class: "wiki-section", id: "xp-site" }, el("h2", { class: "wiki-banner" }, "Your expansions"),
      controls(),
      el("ul", { class: "small" },
        el("li", {}, "Content of an expansion you don't own is hidden on every page: wiki lists, the battle pickers, the searches' candidates, "
          + "the farming and levelling choices, the class balance. Where a table refers to it (a drop table, a recipe), it shows as a greyed "
          + "“expansion content” entry, so the numbers still add up."),
        el("li", {}, "Ownership is a guess from your save. The game keeps your purchases in another file (UserInfo.usr), which the site never "
          + "reads, so the save can only prove you own an expansion (a Bard, a hero above level 50 or in Frentir, maps, ascended items, essences, "
          + "more than 13 heroes…), never that you don't. If it guesses wrong, set it by hand here or in the expansions menu of the top bar "
          + "(the save menu once a save is loaded)."),
        el("li", {}, `Where the content comes from: an item counts as expansion content when none of its sources (quest drops, loot, crafts, map `
          + `essences) can be reached without the expansion. The ${bushes} Treasure Bushes and the map bosses follow their maps.`))),
    ...GROUPS.map(([g, needs, title]) => groupSection(g, needs, title)));
}
