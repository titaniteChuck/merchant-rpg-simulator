/**
 * The site's pages and sub-pages (NAV) and which of them a path + hash shows: pure data and functions, no DOM, so the
 * pages' own bundles (the top-bar Save dropdown, save-menu.ts) can use them without running the menus (nav.ts).
 */
export interface NavItem { label: string; href: string; title?: string }
/** A run of sub-pages, with an optional heading ("Items"). */
export interface NavGroup { label?: string; items: NavItem[] }
export interface NavSection {
  id: string;
  label: string;
  /** The section's own page; none for a menu that only groups pages (More). */
  href?: string;
  title?: string;
  groups?: NavGroup[];
  /**
   * U44: its pages are also a group of the top-bar Save dropdown (save-menu.ts), next to the save's own actions; the
   * drawer labels it with the kept save's file name (R2-A). U77: it has its own main-menu entry again (U44 had none).
   */
  inSaveMenu?: boolean;
}

/** The one list of the site's pages and sub-pages: the menus, the drawer and the second row all come from it. */
export const NAV: NavSection[] = [
  { id: "home", label: "Home", href: "./", title: "Home: every tool" },
  {
    id: "save", label: "Save", href: "save.html", title: "Save viewer", inSaveMenu: true,
    groups: [{ items: [
      { label: "Overview", href: "save.html#overview" },
      { label: "Heroes", href: "save.html#heroes" },
      { label: "Inventory", href: "save.html#inventory" },
      { label: "Maps", href: "save.html#maps" },
      { label: "Crafters", href: "save.html#crafters" },
    ] }],
  },
  {
    // U41: two pages. U44: no page of its own; the main-menu entry only opens its dropdown (like More), and the Battle
    // pages have no second row.
    id: "battle", label: "Battle", title: "Battle: simulator and solver",
    groups: [{ items: [
      { label: "Simulator", href: "battle.html", title: "Battle simulator: your party, hundreds of fights" },
      { label: "Solver", href: "solver.html", title: "Battle solver: the parties that win (a spoiler)" },
    ] }],
  },
  {
    id: "wiki", label: "Wiki", href: "wiki.html", title: "Wiki: everything in the game",
    groups: [
      { items: [{ label: "Search", href: "wiki.html#/", title: "Search the wiki" }] },
      { label: "Items", items: [
        { label: "Equipment", href: "wiki.html#/items/equipment" },
        { label: "Consumables", href: "wiki.html#/items/consumable" },
        { label: "Materials", href: "wiki.html#/items/material" },
      ] },
      { label: "World", items: [
        { label: "Maps", href: "wiki.html#/maps" },
        { label: "Enemies", href: "wiki.html#/enemies" },
      ] },
      { label: "Heroes", items: [
        { label: "Classes", href: "wiki.html#/classes" },
        { label: "Skills", href: "wiki.html#/skills" },
        { label: "Passives", href: "wiki.html#/passives" },
      ] },
      { label: "Reference", items: [
        { label: "Stats", href: "wiki.html#/stats", title: "How every number is calculated" },
        { label: "Battle", href: "wiki.html#/battle", title: "How a fight runs" },
        { label: "Expansions", href: "wiki.html#/expansions", title: "The two paid expansions" },
      ] },
    ],
  },
  {
    id: "more", label: "More", title: "Other tools",
    groups: [{ label: "Other tools", items: [
      { label: "Profit", href: "profit.html", title: "Profit calculator" },
      { label: "Farming", href: "farming.html", title: "Farming planner" },
      { label: "Levelling", href: "levelling.html", title: "Levelling planner" },
      { label: "Balance", href: "class-balance.html", title: "Class balance: every class on equal gear" },
    ] }],
  },
];

export const itemsOf = (s: NavSection): NavItem[] => (s.groups ?? []).flatMap((g) => g.items);

/** A wiki detail route names its list in the singular: #/enemy/97 belongs to #/enemies. */
const WIKI_LIST: Record<string, string> = { skill: "skills", passive: "passives", map: "maps", enemy: "enemies", class: "classes", item: "items" };

/** The sub-page `page` + `hash` belong to, in a section whose page is open; undefined when none does. */
function currentItem(s: NavSection, page: string, hash: string): string | undefined {
  const items = itemsOf(s).map((i) => i.href);
  if (s.id === "save") {
    const h = hash.toLowerCase();
    if (/^#hero=/.test(h)) return "save.html#heroes";
    if (/^#open(=|$)/.test(h)) return undefined; // the "Open your save" wizard (U46) is none of the Save pages
    return items.includes(`save.html${h}`) ? `save.html${h}` : "save.html#overview"; // no hash or an unknown one: Overview
  }
  if (s.id === "wiki") {
    let route = hash.replace(/^#\/?/, "");
    try {
      route = decodeURIComponent(route);
    } catch { /* a malformed escape: as typed */ }
    const [a = "", b = ""] = route.split("/");
    const list = WIKI_LIST[a] ?? a;
    const href = `wiki.html#/${list === "items" ? `items/${b}` : list}`;
    return items.includes(href) ? href : undefined;
  }
  // Sub-pages that are pages of their own (Battle: Simulator, Solver).
  return items.find((i) => samePage(i, page));
}

/** The file name of a page path ("/merchant/wiki.html" → "wiki.html"; the site root → "index.html"). */
export function pageOf(path: string): string {
  return path.split("/").pop() || "index.html";
}

const samePage = (href: string, page: string) => (href === "./" ? "index.html" : href.split("#")[0]) === page;

/** The section and the link (a NAV href) that `path` + `hash` show. */
export function currentNav(path: string, hash: string): { section?: string; href?: string } {
  const page = pageOf(path);
  for (const s of NAV) {
    // A section's page, or one of its sub-pages that is a page of its own (the Solver, U41).
    if (s.href && (samePage(s.href, page) || itemsOf(s).some((i) => samePage(i.href, page)))) {
      return { section: s.id, href: s.groups ? currentItem(s, page, hash) : s.href };
    }
    if (!s.href) {
      const it = itemsOf(s).find((i) => samePage(i.href, page));
      if (it) return { section: s.id, href: it.href };
    }
  }
  return {};
}
