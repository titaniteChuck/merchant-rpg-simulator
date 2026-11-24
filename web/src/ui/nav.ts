/**
 * The site's menus (U35), built once for every page from NAV (nav-data.ts; js/nav.js, a module in every page's head):
 *
 * - Desktop (wider than 760 px): the top bar's main menu (Home, Battle ▾, Wiki ▾, More ▾). A section's sub-pages
 *   open in a dropdown under its ▾ button (the wiki's grouped in columns); More holds the frozen tools (Profit,
 *   Farming, Levelling, Balance). Battle and More have no page of their own: their entry only opens the dropdown
 *   (U44). The save viewer's and the wiki's sub-pages also sit in a compact second row under the top bar (.subnav), so
 *   they stay one click away; Battle's two pages have none (U44).
 * - Phone (760 px and less): a burger at the left of the top bar opens a left drawer (a modal <dialog>: focus kept
 *   inside, Escape, a tap on the backdrop or on a link closes it) with every section and its sub-pages as nested lists;
 *   the current section is unfolded.
 * - Save (U44): no main-menu entry. The save viewer's pages are a group of the ONE top-bar Save dropdown
 *   (save-menu.ts), with the save's own actions; on phones too (the chip stays in the top bar). This module puts a
 *   plain Save dropdown (the viewer's pages and a link to open a save) in the top bar of every page; a page that
 *   handles the save (save-source.ts, expansion-menu.ts) replaces it with its full one. R2-A (F08, F11): the drawer
 *   has a Save group again, labelled with the kept save's file name, and the Save second row shows on phones too.
 * - R2-A: the footer as one line (mountFooter, F57) and the home page's parts (home.ts mountHome, F03, F05).
 *
 * The current page and sub-page (hash routes: wiki #/…, save #heroes, #hero=<id> …) are marked aria-current
 * everywhere, on load and at every hashchange. The rest of the right side of the top bar (theme, language, GitHub) is
 * not built here: theme.js inserts it.
 *
 * U38: this module also mounts the scroll memory of every page (scroll-memory.ts), as soon as it runs.
 */
import { mountScrollMemory } from "./scroll-memory.ts";

export { currentNav, itemsOf, NAV, pageOf, type NavGroup, type NavItem, type NavSection } from "./nav-data.ts";
import { currentNav, NAV, type NavItem, type NavSection } from "./nav-data.ts";
import { keepInView, keptSave, markSaveChip, mountNavSaveChip, SAVE_NAME_EVENT } from "./save-menu.ts";
import { mountHome } from "./home.ts";
import { helpTip } from "./wiki-help.ts";

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
    if (s.inSaveMenu) continue; // in the top-bar Save dropdown (U44)
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
      keepInView(pop); // on screen, 8 px from both edges (shared with the Save dropdown, save-menu.ts)
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

// ---------------------------------------------------------------- second row (desktop; the Save one on phones too)
/**
 * Scrolls a sideways row (.scroll-row) so its current link is in view, clear of the edge fades; only that row moves,
 * never the page. A row that fits is left alone.
 */
export function revealCurrent(row: HTMLElement): void {
  const cur = row.querySelector<HTMLElement>('[aria-current="page"]');
  if (!cur || row.scrollWidth <= row.clientWidth + 1) return;
  const r = row.getBoundingClientRect(), c = cur.getBoundingClientRect();
  if (c.left >= r.left + 24 && c.right <= r.right - 24) return;
  row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
}

/**
 * The second row. R2-A F08 / F58: a shared sideways row (.scroll-row, edge fades); the Save one also shows on phones,
 * one line under the top bar, its current section marked: the section's title there (the Overview has no heading).
 */
function buildSubnav(s: NavSection): HTMLElement {
  const nav = h("nav", { class: "subnav scroll-row", "aria-label": `${s.label} sections`, "data-section": s.id });
  const groups = s.groups ?? [];
  groups.forEach((g, k) => {
    if (k > 0) nav.append(h("span", { class: "subnav-sep", "aria-hidden": "true" }));
    for (const i of g.items) nav.append(link(i));
  });
  return nav;
}

// ---------------------------------------------------------------- drawer (phone)
/** The drawer's Save group label: "📜 PlayerData.txt" when a save is kept in this browser, else "📜 Save" (F11). */
export const saveLabel = (fallback: string, kept = keptSave()): string => `📜 ${kept?.name ?? fallback}`;

/** Keeps the drawer's Save label on the kept save (a save loaded or forgotten on this page). */
function syncSaveLabel(): void {
  const top = document.querySelector<HTMLAnchorElement>('.drawer-sec[data-section="save"] .drawer-top');
  const s = NAV.find((x) => x.inSaveMenu);
  if (top && s) top.textContent = saveLabel(s.label);
}

function buildDrawer(brand: HTMLAnchorElement | null): { dialog: HTMLDialogElement; closeBtn: HTMLButtonElement } {
  const closeBtn = h("button", { type: "button", class: "drawer-close", "aria-label": "Close the menu", title: "Close the menu" }, closeIcon());
  const head = h("div", { class: "drawer-head" },
    h("a", { class: "brand drawer-brand", href: brand?.getAttribute("href") ?? "./" }, brand?.textContent ?? "Merchant RPG Simulator"), closeBtn);
  const list = h("ul", { class: "drawer-list" });
  for (const s of NAV) {
    // R2-A F08 / F11: the Save pages are a drawer group too (the top-bar Save dropdown keeps them as well), labelled
    // with the kept save's file name (saveLabel, kept in step by syncSaveLabel).
    const li = h("li", { class: `drawer-sec${s.inSaveMenu ? " drawer-save" : ""}`, "data-section": s.id });
    const row = h("div", { class: "drawer-row" });
    if (s.href) row.append(link({ label: s.inSaveMenu ? saveLabel(s.label) : s.label, href: s.href, title: s.title }, "drawer-top"));
    if (s.groups) {
      const sub = h("div", { class: "drawer-sub", id: `drawer-${s.id}`, hidden: "" }, ...groupsList(s, "drawer"));
      const btn = h("button", { type: "button", class: s.href ? "drawer-caret" : "drawer-top drawer-caret drawer-only", "aria-expanded": "false", "aria-controls": sub.id });
      if (!s.href && s.title) btn.title = s.title;
      if (s.href) btn.setAttribute("aria-label", `${s.label} pages`);
      else btn.append(h("span", {}, s.label)); // the short menu name (the title is only the tooltip)
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
    // A section with sub-pages marks the sub-page as the page, its own entry as the section (Battle's top link and its
    // Simulator are the same page, U41).
    const subs = Boolean(NAV.find((s) => s.id === sec)?.groups);
    if (top && sec === section && subs) a.setAttribute("aria-current", "true");
    else if (a.dataset.nav === href) a.setAttribute("aria-current", "page");
    else if (top && sec === section) a.setAttribute("aria-current", "true"); // the section of the current sub-page
    else a.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLElement>(".menu-item, .drawer-sec").forEach((x) => x.classList.toggle("is-current", x.dataset.section === section));
  document.querySelectorAll<HTMLElement>(".subnav").forEach(revealCurrent);
  markSaveChip(); // the Save pages' section is the top-bar Save button (no menu entry since U44)
}

// ---------------------------------------------------------------- footer (R2-A F57)
/** The footer's one line (it fits a 375 px phone); the rest goes in its "?". */
export const FOOTER_LINE = "Fan project · not affiliated";
const NOT_AFFILIATED = "Not affiliated with the developers of Merchant.";

/**
 * The footer's "?": who the site is not affiliated with, then the page's own small print (its text less the former
 * "Fan project, not affiliated …" sentence).
 */
export function footerNote(text: string): string {
  const own = text.replace(/\s+/g, " ").replace(/Fan project[,·]? not affiliated with the developers of Merchant\.?/i, "").replace(/\s+/g, " ").trim();
  return own ? `${NOT_AFFILIATED} ${own}` : NOT_AFFILIATED;
}

/**
 * Every page's footer as ONE line: "Fan project · not affiliated · Source ?", the page's own small print (how fights
 * are computed, no game files hosted …) in the "?" (the footer's `data-note`, else its text).
 */
export function mountFooter(): void {
  const footer = document.querySelector<HTMLElement>("body > footer");
  if (!footer || footer.querySelector(".footer-line")) return;
  const note = footerNote(footer.dataset.note ?? footer.textContent ?? "");
  const gh = document.querySelector<HTMLAnchorElement>(".topbar .gh")?.getAttribute("href");
  footer.replaceChildren(h("p", { class: "footer-line" }, FOOTER_LINE,
    ...(gh ? [" · ", h("a", { href: gh }, "Source")] : []), " ", helpTip(note, "this site")));
}

/** The id the skip link jumps to: the page's <main> (given this id when it has none). */
export const MAIN_ID = "main";

/**
 * R1 F34: "Skip to content", the page's first focusable element (shown only when focused), jumping over the top bar
 * and its menus to <main>. Main gets tabindex -1 so the focus really moves there (the next Tab is in the content).
 */
export function mountSkipLink(): void {
  if (document.querySelector(".skip-link")) return;
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.id) main.id = MAIN_ID;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  const a = h("a", { class: "skip-link", href: `#${main.id}` }, "Skip to content");
  // A plain #main link would change the hash, which the save viewer and the wiki read as a route: move the focus instead.
  a.addEventListener("click", (e) => {
    e.preventDefault();
    main.focus({ preventScroll: true });
    main.scrollIntoView();
  });
  document.body.prepend(a);
}

/** Builds the menus into the page's top bar (once). */
export function mountNav(): void {
  mountSkipLink();
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

  // The second row: a section with a page of its own and sub-pages (Save, Wiki); not Battle (no page of its own, U44).
  const cur = NAV.find((s) => s.id === currentNav(location.pathname, location.hash).section);
  if (cur?.href && cur.groups) bar.after(buildSubnav(cur));

  mountNavSaveChip(); // the plain Save dropdown, until (or unless) the page puts its own (U44)
  addEventListener(SAVE_NAME_EVENT, syncSaveLabel); // a save loaded or forgotten here: the drawer's Save label follows
  mountFooter();
  mountHome();

  mark();
  addEventListener("hashchange", mark);
  addEventListener("popstate", mark);
}

if (typeof document !== "undefined") {
  mountScrollMemory(); // before the page's own script draws anything (U38)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountNav);
  else mountNav();
}
