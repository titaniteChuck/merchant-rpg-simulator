/**
 * The ONE top-bar Save dropdown (U44): the save's own actions and the save viewer's pages in one menu, on every page
 * (no "Save ▾" in the main menu any more). It comes in three forms, all a `.save-chip` in the top bar:
 *
 * - a save loaded (save-source.ts): "📜 <file name> ▾": the save file's actions (reload, choose another file, the
 *   example save, forget), the page's exports (the save viewer's CSV), the Save pages, the expansions;
 * - no save, on a page that reads one or shows expansion content (expansion-menu.ts mountExpansionChip): "📜 Save ▾":
 *   open a save, the Save pages, the expansions;
 * - any other page, or before the page's own (nav.ts, mountNavSaveChip): "📜 Save ▾": a link to open a save and the
 *   Save pages. The page's own dropdown replaces it (removeNavSaveChip).
 *
 * R2-A (review R2 F07, F09, F10): every form is ONE chip format, "📜 <file name or Save> ▾" (no expansion icons; the
 * name hidden on phones), always FIRST of the top bar's right-side controls (chipSlot: before the theme switch, the
 * language picker and GitHub). Its head is one line ("PlayerData.txt · 11:45 PM", the rest in its tooltip); the plain
 * forms (nav.ts on every page, expansion-menu.ts on the wiki) share the same head and "Open" label (plainHead,
 * openSaveLink), from the kept save's name (rememberSaveName, written by save-source.ts). The page's exports and the
 * expansions are folded submenus (foldGroup).
 *
 * Nothing here imports the pages' own modules: nav.js (in every page) bundles this file too.
 */
import { currentNav, itemsOf, NAV, type NavItem } from "./nav-data.ts";

/** The save viewer's pages (Overview, Heroes …): the "Save pages" group of the dropdown. */
export const savePages = (): NavItem[] => itemsOf(NAV.find((s) => s.id === "save")!);

/** Where a save is opened from another page: the save viewer (its drop zone and example save). */
export const SAVE_PAGE = "save.html";

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

export const menuTitle = (t: string) => mk("p", { class: "muted small save-menu-title" }, t);
export const menuSep = () => mk("div", { class: "save-menu-sep", role: "separator" });

// ---------------------------------------------------------------- the kept save's name (R2-A F10, F11)
/** localStorage key of the kept save's name and time (save-source.ts writes it; the plain chips and the drawer read it). */
export const SAVE_NAME_KEY = "merchant:save-name";
/** Event fired on window when the kept save's name changes (a save loaded or forgotten). */
export const SAVE_NAME_EVENT = "merchant:save-name";
export interface KeptSave { name: string; savedAt: number }

/** The stored name, parsed; null for none or garbage. */
export function parseKeptSave(raw: string | null | undefined): KeptSave | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<KeptSave> | null;
    return v && typeof v.name === "string" && v.name ? { name: v.name, savedAt: Number(v.savedAt) || 0 } : null;
  } catch {
    return null;
  }
}

/** The save kept in this browser (its name and when it was opened), or null; only while <html class="has-save">. */
export function keptSave(): KeptSave | null {
  if (typeof document === "undefined" || !document.documentElement.classList.contains("has-save")) return null;
  try {
    return parseKeptSave(localStorage.getItem(SAVE_NAME_KEY));
  } catch {
    return null; // storage blocked
  }
}

/** Remembers (or, with null, forgets) the kept save's name for the other pages' chips and the drawer. */
export function rememberSaveName(save: KeptSave | null): void {
  try {
    if (save) localStorage.setItem(SAVE_NAME_KEY, JSON.stringify(save));
    else localStorage.removeItem(SAVE_NAME_KEY);
  } catch { /* not remembered: the chips say "Save" */ }
  if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent(SAVE_NAME_EVENT));
}

/** "11:45 PM" when opened today, else the date and time: the short form of when a save was opened. */
export function openedAt(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return now.toDateString() === d.toDateString() ? time : `${d.toLocaleDateString()} ${time}`;
}

/** The one-line head of a Save dropdown, "<name> · <time>" ("No save loaded" without a name); the rest in its tooltip (F09). */
export function menuHead(name: string | null, savedAt: number | null, tooltip: string): HTMLElement {
  const kids: (Node | string)[] = name ? [mk("strong", {}, name), ...(savedAt ? [` · ${openedAt(savedAt)}`] : [])] : ["No save loaded"];
  return mk("p", { class: "muted small save-menu-head", title: tooltip }, ...kids);
}

/** The head of the plain dropdowns (nav.ts, the wiki's): the same on every page (F10). */
export function plainHead(): HTMLElement {
  const kept = keptSave();
  return kept
    ? menuHead(kept.name, kept.savedAt || null, `${kept.name}: kept in this browser only. Open the save viewer to reload, change or forget it.`)
    : menuHead(null, null, "No save loaded. Your file is read in this browser and never uploaded.");
}

/** The Save file link of the plain dropdowns: one label on every page (F10). */
export function openSaveLink(): HTMLAnchorElement {
  return mk("a", { role: "menuitem", class: "save-menu-link", href: SAVE_PAGE, title: "The save viewer: choose your save file, or try the example save" },
    keptSave() ? "📂 Open the save viewer" : "📂 Open a save");
}

let folds = 0;
/**
 * A folded submenu of a Save dropdown ("Export (CSV) ▸", "Expansions ▸", F09): a menu item that opens its entries
 * under it; `menu` is refitted to the window on every toggle.
 */
export function foldGroup(title: string, menu: HTMLElement, ...entries: Node[]): HTMLElement {
  const list = mk("div", { class: "save-menu-sub", id: `save-menu-fold-${++folds}`, hidden: "" }, ...entries);
  const fold = mk("button", { type: "button", role: "menuitem", class: "save-menu-fold", "aria-expanded": "false", "aria-controls": list.id },
    mk("span", {}, title), mk("span", { class: "fold-mark", "aria-hidden": "true" }, "▸"));
  fold.addEventListener("click", (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    fold.setAttribute("aria-expanded", String(!list.hidden));
    fitMenu(menu);
  });
  return mk("div", { class: "save-menu-group", role: "group", "aria-label": title }, fold, list);
}

/**
 * The "Save pages" group: one menu link per save viewer page, the current one marked (nav.ts mark() keeps it marked at
 * every hashchange: the links carry data-nav like the main menu's). `onPick` runs on a click (the menu closes).
 */
export function savePagesGroup(onPick?: () => void): HTMLElement {
  const { href } = currentNav(location.pathname, location.hash);
  const links = savePages().map((i) => {
    const a = mk("a", { role: "menuitem", class: "save-menu-link", href: i.href, "data-nav": i.href }, i.label);
    if (i.href === href) a.setAttribute("aria-current", "page");
    if (onPick) a.addEventListener("click", onPick);
    return a;
  });
  return mk("div", { class: "save-menu-group save-menu-pages", role: "group", "aria-label": "Save pages", "data-section": "save" },
    menuTitle("Save pages"), ...links);
}

/** The clear space kept between an open top-bar menu and the window's left and right edges (px). */
export const MENU_MARGIN = 8;

/**
 * How far (px, + to the right) to move a box spanning [left, right] so it sits inside [margin, width - margin]; 0 when
 * it already does. When it is wider than that, its left edge wins (its start, the menu's titles, stays readable).
 */
export function shiftIntoView(left: number, right: number, width: number, margin = MENU_MARGIN): number {
  let dx = Math.min(0, width - margin - right);
  if (left + dx < margin) dx = margin - left;
  return Math.round(dx) || 0;
}

/**
 * Keep an open top-bar dropdown inside the window's width: shift it sideways (CSS translate, whatever its anchor) so
 * it keeps MENU_MARGIN from both edges. Its width is capped in style.css (max-width: 100vw minus both margins).
 */
export function keepInView(menu: HTMLElement): void {
  menu.style.translate = "";
  const r = menu.getBoundingClientRect();
  const dx = shiftIntoView(r.left, r.right, document.documentElement.clientWidth);
  if (dx) menu.style.translate = `${dx}px 0`;
}

/**
 * Keep an open top-bar menu inside the window: within its width (keepInView), and at most the height left under it,
 * scrolling inside (R1 F45).
 */
export function fitMenu(menu: HTMLElement): void {
  keepInView(menu);
  menu.style.maxHeight = "";
  const top = menu.getBoundingClientRect().top;
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
}

/** Up / Down move between a menu's items (wrapping), Escape closes it and gives the focus back to its button. */
export function menuKeys(chip: HTMLElement, menu: HTMLElement, button: HTMLElement, close: () => void): void {
  chip.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      button.focus();
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.hidden) {
      const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((i) => !i.hidden && i.offsetParent !== null);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const j = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      e.preventDefault();
      items[j]?.focus();
    }
  });
}

/** True on the save viewer's pages, whose section is the Save dropdown (and, on phones, the drawer's Save group). */
export const onSavePage = (): boolean => currentNav(location.pathname, location.hash).section === "save";

/**
 * Marks every Save dropdown button as the current section on the save viewer's pages (aria-current="true", styled like
 * a current main-menu entry), unmarks it elsewhere. nav.ts mark() calls it on load and at every hashchange; a button
 * built later is marked by saveChipButton.
 */
export function markSaveChip(): void {
  const here = onSavePage();
  document.querySelectorAll<HTMLElement>(".save-chip-btn").forEach((b) => {
    if (here) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
}

/**
 * The Save dropdown's button, ONE format on every page (F07): "📜 <name> ▾", the kept save's file name or "Save" (the
 * name hidden on phones), no expansion icons. On the save viewer's pages it is marked as the current section
 * (markSaveChip).
 */
export function saveChipButton(name: string, title: string): HTMLButtonElement {
  const b = mk("button", { type: "button", class: "save-chip-btn", "aria-haspopup": "menu", "aria-expanded": "false", title },
    "📜 ", mk("span", { class: "save-chip-name" }, name), " ▾");
  if (onSavePage()) b.setAttribute("aria-current", "true");
  return b;
}

/**
 * Where the Save dropdown goes in the top bar (F07): first of the right-side controls, before the theme switch, the
 * language picker or GitHub, whichever comes first. theme.js adds its two before GitHub once nav.js has run, so they
 * land after nav.ts's chip; a page's own chip, put later, takes the same place: one order on every page.
 */
export function chipSlot(bar: Element): Element | null {
  return bar.querySelector(":scope > .theme-btn, :scope > .lang-pick, :scope > .gh");
}

/** Puts a Save dropdown (chip) in the top bar (chipSlot); false when the page has no top bar. */
export function placeChip(chip: HTMLElement): boolean {
  const bar = document.querySelector(".topbar");
  if (!bar) return false;
  removeNavSaveChip();
  bar.insertBefore(chip, chipSlot(bar));
  return true;
}

/** Removes the plain Save dropdown of nav.ts: the page puts its own. */
export function removeNavSaveChip(): void {
  document.querySelectorAll(".nav-save-chip").forEach((c) => c.remove());
}

/**
 * The plain Save dropdown (nav.ts, every page): the kept save's head, a link to open a save (the save viewer) and the
 * Save pages. Not put when the page already shows its own.
 */
export function mountNavSaveChip(): void {
  const bar = document.querySelector(".topbar");
  if (!bar || bar.querySelector(".save-chip")) return;
  const kept = keptSave();
  const menu = mk("div", { class: "save-menu", role: "menu", "aria-label": "Save", hidden: "" });
  const button = saveChipButton(kept?.name ?? "Save", kept ? `Save: ${kept.name}, kept in this browser` : "Save: none loaded");
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  menu.append(plainHead(),
    mk("div", { class: "save-menu-group", role: "group", "aria-label": "Save file" }, menuTitle("Save file"), openSaveLink()),
    menuSep(), savePagesGroup(close));
  button.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      fitMenu(menu);
      menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  });
  const chip = mk("div", { class: "save-chip nav-save-chip" }, button, menu);
  document.addEventListener("click", (e) => {
    if (!chip.contains(e.target as Node)) close();
  });
  menuKeys(chip, menu, button, close);
  bar.insertBefore(chip, chipSlot(bar));
}
