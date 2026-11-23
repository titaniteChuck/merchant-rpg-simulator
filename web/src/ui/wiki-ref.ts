/**
 * Wiki reference pages (U25): "Stats" (#/stats, how every number is calculated) and "Battle" (#/battle, how a fight
 * runs), one section per topic with a stable anchor (#/stats/<topic>, #/battle/<topic>), so the other pages can link a
 * word ("luck", "hit chance") to its formula instead of repeating it:
 *
 *   statLink("hit-chance", "hit chance")     → <a href="wiki.html#/stats/hit-chance">hit chance</a>
 *   battleLink("turn-order")                 → <a href="wiki.html#/battle/turn-order">Turn order</a>
 *
 * The topic ids below are the anchors: keep them stable (other pages and bookmarks use them). The sections themselves
 * are in wiki-stats.ts and wiki-battle.ts; this file has the catalogs, the link helpers and the blocks both pages use
 * (formula, variables, example, source note). Section bodies are trusted static HTML strings (no user input).
 */
import { el } from "./dom.ts";

// ---------------------------------------------------------------- topics
/** Stats page topics: anchor → [title, one-line summary for link tooltips]. */
export const STAT_TOPICS = {
  "hero-stats": ["Hero stats", "class base + growth × level, gear, potion, enchants, str/int/dex, passive, then % bonuses"],
  "max-hp": ["HP and max HP", "max HP = (class HP + growth × level + flat bonuses) × (1 + HP%)"],
  "damage": ["Attack and damage", "damage = atk × def reduction + matk × mdef reduction + true damage, × crit or lucky"],
  "defence": ["Defence reduction", "reduction = 100 / (100 + def)"],
  "hit-chance": ["Hit chance", "hit = round(200 × acc / (acc + eva)) %, capped at 100"],
  "crit": ["Critical and lucky hits", "crit if d100 ≤ crit (× crit damage, 2 base); else lucky if within 1.6 × luck (× 1.35)"],
  "ap": ["Action points", "AP = 5 + ⌊(min(level, 40) − 10) / 2⌋ + AP bonus"],
  "luck": ["Luck", "party luck adds to loot rolls, rare-enemy odds and map essence; own luck gives lucky hits"],
  "grade": ["Grade", "battle grade D–S from level vs. quest and turns; it scales loot, parcels and time"],
  "time": ["Quest and map time", "time = (battle time + quest time × N × grade time) × (1 − speed)"],
  "quest-size": ["Quest size ×N", "one enemy with N × HP; N × gold, time, XP and loot"],
  "xp": ["Experience", "XP = ⌊round(exp / heroes) × N × (1 + XP%)⌋"],
  "item-stats": ["Item stats", "base stat range by grade, + 40 / 80 levels per ascension, bonus ranges, modifiers"],
  "sell": ["Sell value", "value × rarity multiplier (× 2 × ascension); stacks: average sell × amount"],
  "craft": ["Craft time and cost", "gold × count; time = runTime × grade speed × count; grade from crafter level and ingredients"],
  "essence": ["Essence for ascension", "(20 + 50 × level fraction) × rarity, × 4–6 to upgrade an item"],
  "enchant": ["Enchanting", "Enchanter prefix / suffix / reset: odds, gold, runes, break chance"],
  "map-essence": ["Map essence and modifiers", "essence = grade bonus × amount × modifiers × (1 + luck %); enemy power from the map modifier"],
} as const satisfies Record<string, readonly [string, string]>;
export type StatTopic = keyof typeof STAT_TOPICS;

/** Battle page topics: anchor → [title, one-line summary]. */
export const BATTLE_TOPICS = {
  "setup": ["Setup and rows", "up to 6 heroes: back row = places 1, 3, 5; front row = 2, 4, 6; one enemy"],
  "turn-order": ["Turn order", "B1, F1, B2, F2, B3, F3, then the enemy (the enemy first on first-attack quests)"],
  "rotation": ["The 5-slot rotation", "everyone plays slot ((turn − 1) mod 5) + 1: hero slot k meets enemy slot k"],
  "targeting": ["Targeting", "enemy hits split over the front row; skills hit a row, everyone, a place or the lowest HP"],
  "attack": ["Hit, crit and damage", "hit roll, then crit / lucky roll, then defence reduction"],
  "effects": ["Effects and durations", "durations count the owner's own actions, not turns"],
  "buffs-debuffs": ["Buffs, debuffs and their removal", "cleanse removes debuffs, dispel removes buffs, never 'cannot dispel' ones"],
  "heals": ["Heals and max HP", "heals stop at max HP; shield skills (overload) go above it"],
  "revives": ["Revives", "Revive skill: 50 % of max HP, then 2 actions before another; revive scrolls: full HP"],
  "death": ["Death and cooldowns", "0 HP = dead: no action, no effects, no heals; no skill cooldowns"],
  "battle-end": ["Battle end and grade", "checked after each full turn: enemy at 0 HP = win; party dead or turn 200 = loss"],
  "map-runs": ["Map runs", "HP carries room to room; you leave with min(entry HP, end HP)"],
  "quest-size": ["Quest size ×N", "still one enemy, with N × its HP"],
} as const satisfies Record<string, readonly [string, string]>;
export type BattleTopic = keyof typeof BATTLE_TOPICS;

export const statHref = (topic: StatTopic): string => `wiki.html#/stats/${topic}`;
export const battleHref = (topic: BattleTopic): string => `wiki.html#/battle/${topic}`;

/** A link to a Stats section; the label defaults to its title, the tooltip is its one-line formula. */
export function statLink(topic: StatTopic, label?: string): HTMLAnchorElement {
  const [title, summary] = STAT_TOPICS[topic];
  return el("a", { class: "wl ref-link", href: statHref(topic), title: `Stats › ${title}: ${summary}` }, label ?? title);
}

/** A link to a Battle section; the label defaults to its title. */
export function battleLink(topic: BattleTopic, label?: string): HTMLAnchorElement {
  const [title, summary] = BATTLE_TOPICS[topic];
  return el("a", { class: "wl ref-link", href: battleHref(topic), title: `Battle › ${title}: ${summary}` }, label ?? title);
}

// The same links as HTML strings, for the section bodies below.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const sl = (topic: StatTopic, label?: string): string =>
  `<a class="wl ref-link" href="${statHref(topic)}" title="${esc(`Stats › ${STAT_TOPICS[topic][0]}: ${STAT_TOPICS[topic][1]}`)}">${label ?? STAT_TOPICS[topic][0]}</a>`;
export const bl = (topic: BattleTopic, label?: string): string =>
  `<a class="wl ref-link" href="${battleHref(topic)}" title="${esc(`Battle › ${BATTLE_TOPICS[topic][0]}: ${BATTLE_TOPICS[topic][1]}`)}">${label ?? BATTLE_TOPICS[topic][0]}</a>`;

// ---------------------------------------------------------------- blocks (HTML strings)
/** A fraction drawn as numerator over denominator (screen readers hear "over"). */
export const frac = (num: string, den: string): string =>
  `<span class="frac"><span class="frac-n">${num}</span><span class="sr-only"> over </span><span class="frac-d">${den}</span></span>`;
/** A displayed formula. */
export const formula = (html: string): string => `<div class="formula" role="math">${html}</div>`;
/** The variables of a formula: [name (HTML), meaning (HTML)]. */
export const vars = (rows: [string, string][]): string =>
  `<dl class="ref-vars">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
/** A short worked example. */
export const example = (html: string): string => `<div class="ref-example"><span class="ref-tag">Example</span> ${html}</div>`;
/** Something the code does that is easy to get wrong. */
export const note = (html: string): string => `<p class="ref-note"><span class="ref-tag">Note</span> ${html}</p>`;
/** Something not confirmed in the game code: said, not guessed. */
export const unsure = (html: string): string => `<p class="ref-note unsure"><span class="ref-tag">Unconfirmed</span> ${html}</p>`;
/** A small table: header cells, then rows (cells are HTML). The first column is a row header. */
export const tbl = (head: string[], rows: (string | number)[][]): string =>
  `<div class="table-wrap"><table class="ref-table"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
/** A variable name. */
export const v = (name: string): string => `<var>${name}</var>`;

// ---------------------------------------------------------------- sections and pages
/** Where a rule is in the game's decompiled Lua: [file, line, text expected on that line] (checked by the tests). */
export type Src = [file: string, line: number, needle: string];

export interface RefSection<T extends string = string> {
  id: T;
  /** Body: trusted static HTML (built at render time, after the game data is loaded). */
  html: () => string;
  src: Src[];
}

const sectionId = (page: string, topic: string) => `${page}-${topic}`;

/** The source note under a section: "Source: obj.Hero.lua:178 · …" (file:line in the decompiled game). */
function sourceNote(src: Src[]): HTMLElement {
  const p = el("p", { class: "ref-src small muted" }, "Source (decompiled game): ");
  src.forEach(([file, line], i) => p.append(...(i ? [" · "] : []), el("code", { title: `${file}, line ${line}` }, `${file}:${line}`)));
  return p;
}

/**
 * A reference page: crumbs, title, lead, table of contents, then one <section id="PAGE-TOPIC"> per topic. When `topic`
 * is given (#/stats/luck) the page scrolls to it once rendered (the wiki's router scrolls to the top first).
 */
export function refPage(page: "stats" | "battle", title: string, icon: string, lead: string,
  topics: Record<string, readonly [string, string]>, sections: RefSection[], topic?: string): HTMLElement {
  const toc = el("nav", { class: "ref-toc", "aria-label": `${title}: topics` },
    el("ol", {}, ...sections.map((s) => el("li", {}, el("a", { href: `#/${page}/${s.id}` }, topics[s.id][0])))));
  const body = sections.map((s) => {
    const sec = el("section", { class: "wiki-section ref-section", id: sectionId(page, s.id), "aria-labelledby": `${sectionId(page, s.id)}-h` });
    const h2 = el("h2", { class: "wiki-banner", id: `${sectionId(page, s.id)}-h` }, topics[s.id][0],
      el("a", { class: "ref-anchor", href: `#/${page}/${s.id}`, "aria-label": `Link to “${topics[s.id][0]}”`, title: "Link to this section" }, "#"));
    const content = el("div", { class: "ref-body" });
    content.innerHTML = s.html();
    sec.append(h2, content, sourceNote(s.src));
    return sec;
  });
  if (topic && topics[topic]) {
    requestAnimationFrame(() => document.getElementById(sectionId(page, topic))?.scrollIntoView({ block: "start" }));
  }
  return el("div", { class: `ref-page ref-${page}` },
    el("p", { class: "crumbs small" }, el("a", { href: "#/" }, "Wiki"), el("span", { "aria-hidden": "true" }, " › "), el("span", {}, title)),
    el("h1", {}, `${icon} ${title}`), el("p", { class: "lead" }, lead), toc, ...body);
}
