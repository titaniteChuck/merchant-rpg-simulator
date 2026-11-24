/**
 * The ONE top-bar Save dropdown (U44): the save's own actions and the save viewer's pages in one menu, on every page
 * (no "Save ▾" in the main menu any more, nor in the phone drawer). It comes in three forms, all a `.save-chip` in the
 * top bar, before the GitHub link:
 *
 * - a save loaded (save-source.ts): "📜 <file name> ▾": the save file's actions (reload, choose another file, the
 *   example save, forget), the page's exports (the save viewer's CSV), the Save pages, the expansions;
 * - no save, on a page that reads one or shows expansion content (expansion-menu.ts mountExpansionChip): "📜 Save ▾":
 *   open a save, the Save pages, the expansions;
 * - any other page, or before the page's own (nav.ts, mountNavSaveChip): "📜 Save ▾": a link to open a save and the
 *   Save pages. The page's own dropdown replaces it (removeNavSaveChip).
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

/** Keep an open top-bar menu inside the window: at most the height left under it, scrolling inside (R1 F45). */
export function fitMenu(menu: HTMLElement): void {
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

/** The Save dropdown's button: "📜 <name> ▾" (the name hidden on phones). */
export function saveChipButton(name: string, title: string, ...extra: Node[]): HTMLButtonElement {
  return mk("button", { type: "button", class: "save-chip-btn", "aria-haspopup": "menu", "aria-expanded": "false", title },
    "📜 ", mk("span", { class: "save-chip-name" }, name), ...extra, " ▾");
}

/** Puts a Save dropdown (chip) in the top bar, before the GitHub link; false when the page has no top bar. */
export function placeChip(chip: HTMLElement): boolean {
  const bar = document.querySelector(".topbar");
  if (!bar) return false;
  removeNavSaveChip();
  bar.insertBefore(chip, bar.querySelector(".gh"));
  return true;
}

/** Removes the plain Save dropdown of nav.ts: the page puts its own. */
export function removeNavSaveChip(): void {
  document.querySelectorAll(".nav-save-chip").forEach((c) => c.remove());
}

/**
 * The plain Save dropdown (nav.ts, every page): a link to open a save (the save viewer) and the Save pages. Not put when
 * the page already shows its own.
 */
export function mountNavSaveChip(): void {
  const bar = document.querySelector(".topbar");
  if (!bar || bar.querySelector(".save-chip")) return;
  const kept = document.documentElement.classList.contains("has-save");
  const menu = mk("div", { class: "save-menu", role: "menu", "aria-label": "Save", hidden: "" });
  const button = saveChipButton("Save", kept ? "Save: kept in this browser" : "Save: none loaded");
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = mk("a", { role: "menuitem", class: "save-menu-link", href: SAVE_PAGE,
    title: "The save viewer: choose your save file, or try the example save" }, kept ? "📂 Open the save viewer" : "📂 Open a save");
  menu.append(
    mk("p", { class: "muted small save-menu-head" }, kept ? "Your save is kept in this browser." : "No save loaded."),
    mk("div", { class: "save-menu-group", role: "group", "aria-label": "Save file" }, menuTitle("Save file"), open),
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
  bar.insertBefore(chip, bar.querySelector(".gh"));
}
