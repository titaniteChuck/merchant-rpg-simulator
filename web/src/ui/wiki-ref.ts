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
 * (formula, variables, example, note). Section bodies are trusted static HTML strings (no user input). The pages cite
 * no game code: the decompiled-source references behind each section live in test/wiki-ref.test.ts (`SOURCES`).
 */
import { el, expansionBadge, type ExpansionId } from "./dom.ts";

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
  "quests-and-maps": ["Two kinds of battle", "quests: one enemy, ×1 / ×3 / ×5; maps (Scribe): a run of rooms to clear, HP carried over"],
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
/**
 * R1 F25: the expansion badge (dom.ts expansionBadge, the quill / snowflake icon linked to Wiki › Expansions) in a
 * section body. Bodies are strings (also built in node tests, without a DOM), so this is a placeholder that refPage
 * swaps for the real badge once the section is on the page.
 */
export const xpBadge = (...needs: ExpansionId[]): string => `<span data-xp-badge="${needs.join(" ")}"></span>`;

// ---------------------------------------------------------------- sections and pages
/**
 * A section of a reference page. The game-code references behind each rule (decompiled file and line) are not part of
 * it: they are in test/wiki-ref.test.ts (`SOURCES`), checked against the decompiled game, and never shown on the site.
 */
export interface RefSection<T extends string = string> {
  id: T;
  /** Body: trusted static HTML (built at render time, after the game data is loaded). */
  html: () => string;
}

const sectionId = (page: string, topic: string) => `${page}-${topic}`;

/** The page on screen: its scroll spy and its Topics dropdown (a new page replaces them). */
let spy: IntersectionObserver | undefined;
let openDrop: HTMLDetailsElement | undefined;
let docListener = false;

/**
 * A reference page, laid out like the other wiki tabs: crumbs and a visually-hidden h1 (no visible title or intro).
 * Then a sticky side panel listing the topics, beside one <section id="PAGE-TOPIC"> per topic; the panel marks the
 * section being read (IntersectionObserver). Below 760 px the panel is hidden and a compact sticky "Topics" dropdown
 * sits at the top instead. CSS: the `wiki reference v2` block of site/style.css.
 *
 * A topic link scrolls in place and pushes #/PAGE/TOPIC with history.pushState (no re-render); a shared link or Back
 * goes through the wiki's router, and the page scrolls to `topic` once rendered.
 */
export function refPage(page: "stats" | "battle", title: string,
  topics: Record<string, readonly [string, string]>, sections: RefSection[], topic?: string): HTMLElement {
  const href = (id: string) => `#/${page}/${id}`;
  const list = (cls: string) => el("ol", { class: cls }, ...sections.map((s) =>
    el("li", {}, el("a", { href: href(s.id), "data-topic": s.id, title: topics[s.id][1] }, topics[s.id][0]))));

  const sideList = list("ref-side-list");
  const side = el("nav", { class: "ref-side", "aria-label": `${title}: topics` }, el("p", { class: "ref-side-h" }, "Topics"), sideList);
  const current = el("span", { class: "ref-topics-cur" });
  const summary = el("summary", {}, el("span", { class: "ref-topics-label" }, "Topics"), current);
  const drop = el("details", { class: "ref-topics" }, summary, el("nav", { "aria-label": `${title}: topics` }, list("ref-topics-list")));
  openDrop = drop;

  const body = sections.map((s) => {
    const sid = sectionId(page, s.id);
    const sec = el("section", { class: "wiki-section ref-section", id: sid, "aria-labelledby": `${sid}-h`, "data-topic": s.id });
    const h2 = el("h2", { class: "wiki-banner", id: `${sid}-h` }, topics[s.id][0],
      el("a", { class: "ref-anchor", href: href(s.id), "data-topic": s.id, "aria-label": `Link to “${topics[s.id][0]}”`, title: "Link to this section" }, "#"));
    const content = el("div", { class: "ref-body" });
    content.innerHTML = s.html();
    for (const p of content.querySelectorAll<HTMLElement>("[data-xp-badge]")) {
      p.replaceWith(expansionBadge((p.dataset.xpBadge ?? "").split(" ").filter(Boolean) as ExpansionId[], { link: true }));
    }
    sec.append(h2, content);
    return sec;
  });

  const links = [...side.querySelectorAll<HTMLAnchorElement>("a"), ...drop.querySelectorAll<HTMLAnchorElement>("nav a")];
  const setActive = (id: string) => {
    for (const a of links) {
      if (a.dataset.topic === id) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
    current.textContent = topics[id]?.[0] ?? "";
    // keep the marked topic visible when the panel itself scrolls (this never scrolls the page)
    const on = sideList.querySelector<HTMLElement>(`a[data-topic="${id}"]`);
    if (on && sideList.scrollHeight > sideList.clientHeight + 1) {
      const top = on.offsetTop, bottom = top + on.offsetHeight;
      if (top < sideList.scrollTop) sideList.scrollTop = top - 8;
      else if (bottom > sideList.scrollTop + sideList.clientHeight) sideList.scrollTop = bottom - sideList.clientHeight + 8;
    }
  };
  setActive(topic && topics[topic] ? topic : sections[0].id);

  const root = el("div", { class: `ref-page ref-${page}` },
    el("p", { class: "crumbs small" }, el("a", { href: "#/" }, "Wiki"), el("span", { "aria-hidden": "true" }, " › "), el("span", {}, title)),
    el("h1", { class: "sr-only" }, title),
    el("div", { class: "ref-layout" }, side, el("div", { class: "ref-main" }, drop, ...body)));

  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-topic]");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const id = a.dataset.topic!;
    if (location.hash !== href(id)) history.pushState(null, "", href(id));
    drop.open = false;
    document.getElementById(sectionId(page, id))?.scrollIntoView({ block: "start" });
    setActive(id);
  });
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drop.open) { drop.open = false; summary.focus(); }
  });
  if (!docListener) {
    // one listener for the whole session: a click outside the open dropdown closes it
    docListener = true;
    document.addEventListener("click", (e) => {
      if (openDrop?.open && !openDrop.contains(e.target as Node)) openDrop.open = false;
    });
  }

  // scroll spy: the first section crossing the band from 72 px (below the phone's sticky Topics bar and the sections'
  // scroll margin) to 40 % of the viewport is the one being read
  spy?.disconnect();
  spy = undefined;
  if (typeof IntersectionObserver !== "undefined") {
    const visible = new Set<string>();
    spy = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const id = (en.target as HTMLElement).dataset.topic!;
        if (en.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      const first = sections.find((s) => visible.has(s.id));
      if (first) setActive(first.id);
    }, { rootMargin: "-72px 0px -60% 0px" });
    for (const sec of body) spy.observe(sec);
  }

  if (topic && topics[topic]) {
    requestAnimationFrame(() => document.getElementById(sectionId(page, topic))?.scrollIntoView({ block: "start" }));
  }
  return root;
}
