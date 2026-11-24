/**
 * The site's menus (U35), built once for every page from NAV (js/nav.js, a module in every page's head):
 *
 * - Desktop (wider than 760 px): the top bar's main menu (Home, Save ▾, Battle, Wiki ▾, More ▾). A section's sub-pages
 *   open in a dropdown under its ▾ button (the wiki's grouped in columns); More holds the frozen tools (Profit,
 *   Farming, Levelling, Balance). The current section's sub-pages also sit in a compact second row under the top bar
 *   (.subnav: the save viewer's sections, the wiki's), so they stay one click away.
 * - Phone (760 px and less): a burger at the left of the top bar opens a left drawer (a modal <dialog>: focus kept
 *   inside, Escape, a tap on the backdrop or on a link closes it) with every section and its sub-pages as nested lists;
 *   the current section is unfolded.
 *
 * The current page and sub-page (hash routes: wiki #/…, save #heroes, #hero=<id> …) are marked aria-current
 * everywhere, on load and at every hashchange. The right side of the top bar (theme, language, save / expansions
 * chips, GitHub) is not built here: theme.js, save-source.ts and expansion-menu.ts insert it before the GitHub link.
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
}

/** The one list of the site's pages and sub-pages: the menus, the drawer and the second row all come from it. */
export const NAV: NavSection[] = [
  { id: "home", label: "Home", href: "./", title: "Home: every tool" },
  {
    id: "save", label: "Save", href: "save.html", title: "Save viewer",
    groups: [{ items: [
      { label: "Overview", href: "save.html#overview" },
      { label: "Heroes", href: "save.html#heroes" },
      { label: "Inventory", href: "save.html#inventory" },
      { label: "Maps", href: "save.html#maps" },
      { label: "Crafters", href: "save.html#crafters" },
    ] }],
  },
  { id: "battle", label: "Battle", href: "battle.html", title: "Battle simulator" },
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

/** The sub-page `hash` belongs to, in a section whose page is open; undefined when none does. */
function currentItem(s: NavSection, hash: string): string | undefined {
  const items = itemsOf(s).map((i) => i.href);
  if (s.id === "save") {
    const h = hash.toLowerCase();
    if (/^#hero=/.test(h)) return "save.html#heroes";
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
  return undefined;
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
    if (s.href && samePage(s.href, page)) return { section: s.id, href: s.groups ? currentItem(s, hash) : s.href };
    if (!s.href) {
      const it = itemsOf(s).find((i) => samePage(i.href, page));
      if (it) return { section: s.id, href: it.href };
    }
  }
  return {};
}

// ---------------------------------------------------------------- DOM
const PHONE = "(max-width: 760px)";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const SVG = "http://www.w3.org/2000/svg";
function icon(d: string, size = 12): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}
const chevron = () => icon("M4 6l4 4 4-4");
const burgerIcon = () => icon("M2 4h12M2 8h12M2 12h12", 20);
const closeIcon = () => icon("M3 3l10 10M13 3L3 13", 18);

/** A link of the menus: tagged with its NAV href so mark() can find it. */
function link(i: NavItem, cls = ""): HTMLAnchorElement {
  const a = h("a", { href: i.href, "data-nav": i.href, ...(cls ? { class: cls } : {}) }, i.label);
  if (i.title) a.title = i.title;
  return a;
}

function groupsList(s: NavSection, idPrefix: string): HTMLElement[] {
  return (s.groups ?? []).map((g, k) => {
    const head = g.label ? h("p", { class: "menu-group-h", id: `${idPrefix}-${s.id}-g${k}` }, g.label) : null;
    const ul = h("ul", head ? { "aria-labelledby": head.id } : {}, ...g.items.map((i) => h("li", {}, link(i))));
    return h("div", { class: "menu-group" }, ...(head ? [head] : []), ul);
  });
}

// ---------------------------------------------------------------- desktop menu
function buildMenuBar(): HTMLElement {
  const bar = h("ul", { class: "menu-bar" });
  for (const s of NAV) {
    const li = h("li", { class: "menu-item", "data-section": s.id });
    if (s.href) li.append(link({ label: s.label, href: s.href, title: s.title }, "menu-top"));
    if (s.groups) {
      const pop = h("div", { class: `menu-pop${s.id === "wiki" ? " menu-pop-wide" : ""}`, id: `menu-${s.id}`, hidden: "" }, ...groupsList(s, "menu"));
      const btn = h("button", {
        type: "button", class: s.href ? "menu-caret" : "menu-top menu-caret menu-only", "aria-expanded": "false", "aria-controls": pop.id,
      });
      if (s.href) btn.setAttribute("aria-label", `${s.label} pages`);
      else {
        btn.append(s.label);
        if (s.title) btn.title = s.title;
      }
      btn.append(chevron());
      li.append(btn, pop);
    }
    bar.append(li);
  }
  return bar;
}

function wireMenuBar(nav: HTMLElement): void {
  const items = [...nav.querySelectorAll<HTMLLIElement>(".menu-item")];
  const tops = () => items.flatMap((li) => [...li.querySelectorAll<HTMLElement>(":scope > a, :scope > button")]);
  const popOf = (li: Element) => li.querySelector<HTMLElement>(".menu-pop");
  const btnOf = (li: Element) => li.querySelector<HTMLButtonElement>(".menu-caret");
  const linksOf = (li: Element) => [...(popOf(li)?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
  const close = (li: Element, focus = false) => {
    const pop = popOf(li), btn = btnOf(li);
    if (!pop || !btn || pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    li.classList.remove("open");
    if (focus) btn.focus();
  };
  const closeAll = (except?: Element) => items.forEach((li) => li !== except && close(li));
  const open = (li: Element, focus?: "first" | "last" | "current") => {
    const pop = popOf(li), btn = btnOf(li);
    if (!pop || !btn) return;
    closeAll(li);
    if (pop.hidden) {
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      li.classList.add("open");
      // Keep the dropdown on screen: shift it left when it would pass the right edge.
      pop.style.left = "";
      const over = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
      if (over > 0) pop.style.left = `${-over}px`;
    }
    const ls = linksOf(li);
    const cur = ls.find((a) => a.getAttribute("aria-current") === "page");
    (focus === "first" ? ls[0] : focus === "last" ? ls.at(-1) : focus === "current" ? cur ?? ls[0] : undefined)?.focus();
  };

  for (const li of items) {
    const btn = btnOf(li);
    if (!btn) continue;
    // A mouse opens the dropdown on hover too (not touch: a tap on ▾ toggles it); a click right after keeps it open.
    let timer = 0, viaHover = false;
    btn.addEventListener("click", () => {
      if (popOf(li)!.hidden) open(li);
      else if (!viaHover) close(li);
      viaHover = false;
    });
    li.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer);
      if (popOf(li)!.hidden) viaHover = true;
      open(li);
    });
    li.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      timer = window.setTimeout(() => {
        viaHover = false;
        if (!li.contains(document.activeElement)) close(li);
      }, 200);
    });
    // Tab out of an item closes its dropdown.
    li.addEventListener("focusout", (e) => {
      if (!li.contains(e.relatedTarget as Node | null)) close(li);
    });
  }
  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target as Node)) closeAll();
  });

  nav.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    const li = t.closest(".menu-item");
    if (!li) return;
    const inPop = !!t.closest(".menu-pop");
    if (e.key === "Escape") {
      if (popOf(li) && !popOf(li)!.hidden) {
        e.preventDefault();
        close(li, true);
      }
      return;
    }
    if (inPop) {
      // Up / Down (wrapping), Home / End between the dropdown's links; Left / Right go to the next top item.
      const ls = linksOf(li), i = ls.indexOf(t as HTMLAnchorElement);
      const j = e.key === "ArrowDown" ? (i + 1) % ls.length : e.key === "ArrowUp" ? (i - 1 + ls.length) % ls.length
        : e.key === "Home" ? 0 : e.key === "End" ? ls.length - 1 : -1;
      if (j >= 0) {
        e.preventDefault();
        ls[j].focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        close(li);
        const k = items.indexOf(li as HTMLLIElement), n = items[(k + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
        n.querySelector<HTMLElement>(":scope > a, :scope > button")?.focus();
      }
      return;
    }
    // On the bar: Left / Right move between the top items; Down / Up on a ▾ button open its dropdown.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const ts = tops(), i = ts.indexOf(t);
      if (i < 0) return;
      e.preventDefault();
      ts[(i + (e.key === "ArrowRight" ? 1 : -1) + ts.length) % ts.length].focus();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && t.classList.contains("menu-caret")) {
      e.preventDefault();
      open(li, e.key === "ArrowDown" ? "current" : "last");
    }
  });
}

// ---------------------------------------------------------------- second row (desktop)
function buildSubnav(s: NavSection): HTMLElement {
  const nav = h("nav", { class: "subnav", "aria-label": `${s.label} sections`, "data-section": s.id });
  const groups = s.groups ?? [];
  groups.forEach((g, k) => {
    if (k > 0) nav.append(h("span", { class: "subnav-sep", "aria-hidden": "true" }));
    for (const i of g.items) nav.append(link(i));
  });
  return nav;
}

// ---------------------------------------------------------------- drawer (phone)
function buildDrawer(brand: HTMLAnchorElement | null): { dialog: HTMLDialogElement; closeBtn: HTMLButtonElement } {
  const closeBtn = h("button", { type: "button", class: "drawer-close", "aria-label": "Close the menu", title: "Close the menu" }, closeIcon());
  const head = h("div", { class: "drawer-head" },
    h("a", { class: "brand drawer-brand", href: brand?.getAttribute("href") ?? "./" }, brand?.textContent ?? "Merchant RPG Simulator"), closeBtn);
  const list = h("ul", { class: "drawer-list" });
  for (const s of NAV) {
    const li = h("li", { class: "drawer-sec", "data-section": s.id });
    const row = h("div", { class: "drawer-row" });
    if (s.href) row.append(link({ label: s.label, href: s.href, title: s.title }, "drawer-top"));
    if (s.groups) {
      const sub = h("div", { class: "drawer-sub", id: `drawer-${s.id}`, hidden: "" }, ...groupsList(s, "drawer"));
      const btn = h("button", { type: "button", class: s.href ? "drawer-caret" : "drawer-top drawer-caret drawer-only", "aria-expanded": "false", "aria-controls": sub.id });
      if (s.href) btn.setAttribute("aria-label", `${s.label} pages`);
      else btn.append(h("span", {}, s.title ?? s.label));
      btn.append(chevron());
      btn.addEventListener("click", () => {
        sub.hidden = !sub.hidden;
        btn.setAttribute("aria-expanded", String(!sub.hidden));
      });
      row.append(btn);
      li.append(row, sub);
    } else li.append(row);
    list.append(li);
  }
  const dialog = h("dialog", { class: "nav-drawer", id: "nav-drawer", "aria-label": "Site menu" },
    head, h("nav", { class: "drawer-nav", "aria-label": "Site" }, list));
  return { dialog, closeBtn };
}

function wireDrawer(dialog: HTMLDialogElement, burger: HTMLButtonElement, closeBtn: HTMLButtonElement): void {
  const root = document.documentElement;
  const closed = () => {
    burger.setAttribute("aria-expanded", "false");
    root.classList.remove("drawer-open");
  };
  const close = () => {
    if (!dialog.open) return;
    dialog.close();
    closed();
    if (burger.offsetParent) burger.focus();
  };
  dialog.addEventListener("close", closed); // closed some other way (a form, the browser)
  const open = () => {
    // The current section unfolded, the others folded.
    const cur = root.dataset.navSection;
    dialog.querySelectorAll<HTMLElement>(".drawer-sec").forEach((li) => {
      const sub = li.querySelector<HTMLElement>(".drawer-sub"), btn = li.querySelector(".drawer-caret");
      if (!sub || !btn) return;
      sub.hidden = li.dataset.section !== cur;
      btn.setAttribute("aria-expanded", String(!sub.hidden));
    });
    dialog.showModal();
    burger.setAttribute("aria-expanded", "true");
    root.classList.add("drawer-open");
    (dialog.querySelector<HTMLElement>('a[aria-current="page"]') ?? closeBtn).focus();
  };
  burger.addEventListener("click", () => (dialog.open ? close() : open()));
  closeBtn.addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // Keep the focus inside the drawer (the modal dialog makes the page inert; this also skips the browser's own UI).
      const fs = [...dialog.querySelectorAll<HTMLElement>("a[href], button")].filter((x) => x.offsetParent);
      const first = fs[0], last = fs.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  // A tap on the backdrop (outside the panel), or on a link, closes it.
  dialog.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a[href]")) return close();
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  // Wider than a phone: no drawer.
  matchMedia(PHONE).addEventListener("change", (m) => {
    if (!m.matches) close();
  });
}

// ---------------------------------------------------------------- current page
/** Marks the current section and sub-page in every menu (aria-current; .is-current on the section's own entry). */
export function mark(): void {
  const { section, href } = currentNav(location.pathname, location.hash);
  const root = document.documentElement;
  if (section) root.dataset.navSection = section;
  else delete root.dataset.navSection;
  document.querySelectorAll<HTMLAnchorElement>("a[data-nav]").forEach((a) => {
    const top = a.classList.contains("menu-top") || a.classList.contains("drawer-top");
    const sec = a.closest<HTMLElement>("[data-section]")?.dataset.section;
    if (a.dataset.nav === href) a.setAttribute("aria-current", "page");
    else if (top && sec === section) a.setAttribute("aria-current", "true"); // the section of the current sub-page
    else a.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLElement>(".menu-item, .drawer-sec").forEach((x) => x.classList.toggle("is-current", x.dataset.section === section));
}

/** Builds the menus into the page's top bar (once). */
export function mountNav(): void {
  const bar = document.querySelector<HTMLElement>(".topbar");
  if (!bar || bar.querySelector(".mainnav")) return;
  bar.querySelector(".topnav")?.remove(); // a page still carrying the old static links
  const brand = bar.querySelector<HTMLAnchorElement>(".brand");

  const main = h("nav", { class: "mainnav", "aria-label": "Site" }, buildMenuBar());
  if (brand) brand.after(main);
  else bar.prepend(main);
  wireMenuBar(main);

  const burger = h("button", { type: "button", class: "nav-burger", "aria-expanded": "false", "aria-controls": "nav-drawer",
    "aria-label": "Menu", title: "Menu" }, burgerIcon());
  bar.prepend(burger);
  const { dialog, closeBtn } = buildDrawer(brand);
  document.body.append(dialog);
  wireDrawer(dialog, burger, closeBtn);

  const cur = NAV.find((s) => s.id === currentNav(location.pathname, location.hash).section);
  if (cur?.href && cur.groups) bar.after(buildSubnav(cur));

  mark();
  addEventListener("hashchange", mark);
  addEventListener("popstate", mark);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountNav);
  else mountNav();
}
