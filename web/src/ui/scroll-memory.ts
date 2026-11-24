/**
 * U38: every page keeps its scroll position per URL (path + query + hash) in sessionStorage, so coming back to a page
 * puts it where it was left: Back / Forward, a menu link back to the page, a reload, and the in-page routes of the
 * wiki (#/…) and the save viewer (#heroes, #hero=<id> …). Mounted on every page by nav.ts.
 *
 * - history.scrollRestoration is "manual": the browser's own restore runs before the pages have drawn their content
 *   (they build it after loading data) and would land short, then fight this one.
 * - The position is written on every scroll event (at most once a frame) under the current URL; while a restore is
 *   pending nothing is written (the short, half-drawn page would overwrite the value being restored).
 * - Restore waits for the content: it retries every frame until the page is tall enough for the saved position, then
 *   scrolls there; it gives up after RESTORE_TIMEOUT ms, and as soon as the visitor scrolls or presses a key.
 * - A link inside the page's content (a wiki entry, a hero) opens its route at the top; only the menus and the
 *   breadcrumbs (going back up) restore. A new page load (any link from another page) always restores.
 * - Storage can be missing or throw (blocked site data): then nothing is remembered and nothing breaks.
 */

const PREFIX = "scroll:";
/** How long a restore waits for the page to grow tall enough. */
export const RESTORE_TIMEOUT = 15000;
/** In-page links that restore the target's position (going back to a visited list) instead of opening at the top. */
const RESTORING_LINKS = ".topbar, .subnav, .nav-drawer, dialog, .crumbs";

type Store = Pick<Storage, "getItem" | "setItem">;

/** The key a page's position is kept under: its path, query and hash (one entry per wiki route). */
export function scrollKey(loc: { pathname: string; search: string; hash: string }): string {
  return PREFIX + loc.pathname + loc.search + loc.hash;
}

/** The scroll positions by URL, in a Storage (sessionStorage in the pages) that may be missing or throw. */
export class ScrollStore {
  private storage: () => Store | undefined;
  constructor(storage: () => Store | undefined) {
    this.storage = storage;
  }

  save(key: string, y: number): void {
    try {
      this.storage()?.setItem(key, String(Math.max(0, Math.round(y))));
    } catch { /* not remembered */ }
  }

  /** The saved position, or undefined (never saved, unreadable, storage blocked). */
  load(key: string): number | undefined {
    try {
      const v = this.storage()?.getItem(key);
      if (v == null) return undefined;
      const y = Number(v);
      return Number.isFinite(y) && y >= 0 ? y : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Whether a page `scrollHeight` tall, seen through a `viewport` px window, can scroll to `y` (1 px slack). */
export const tallEnough = (y: number, scrollHeight: number, viewport: number): boolean => scrollHeight - viewport >= y - 1;

let mounted = false;

export function mountScrollMemory(): void {
  if (mounted || typeof window === "undefined") return;
  mounted = true;
  try {
    history.scrollRestoration = "manual";
  } catch { /* old browser: its own restore */ }
  const store = new ScrollStore(() => {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  });
  const key = () => scrollKey(location);

  // ---- restoring
  let pending: { y: number; frame: number; until: number } | null = null;
  const stop = () => {
    if (pending) cancelAnimationFrame(pending.frame);
    pending = null;
  };
  const step = () => {
    if (!pending) return;
    const el = document.scrollingElement ?? document.documentElement;
    if (tallEnough(pending.y, el.scrollHeight, window.innerHeight)) {
      window.scrollTo(0, pending.y);
      pending = null;
      return;
    }
    if (performance.now() > pending.until) {
      pending = null;
      return;
    }
    pending.frame = requestAnimationFrame(step);
  };
  /** Scroll to the position saved for the current URL once the page is drawn (nothing saved: leave the page alone). */
  const restore = () => {
    stop();
    const y = store.load(key());
    if (!y) return;
    // Two frames first: the page redraws its route in the same task (wiki, save viewer) and may scroll itself to the top.
    pending = { y, until: performance.now() + RESTORE_TIMEOUT, frame: requestAnimationFrame(() => {
      if (pending) pending.frame = requestAnimationFrame(step);
    }) };
  };
  // The visitor takes over: no jump under their hand.
  for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) addEventListener(ev, stop, { passive: true, capture: true });

  // ---- saving
  /** The URL the page is on, as last seen (a route set by pushState / replaceState shows up at the next scroll). */
  let current = key();
  const save = () => {
    if (pending) return;
    current = key();
    store.save(current, window.scrollY);
  };
  addEventListener("scroll", save, { passive: true });
  addEventListener("pagehide", save);

  // ---- in-page routes (hash changes: link, menu, Back / Forward)
  /** The route a content link was just clicked for (it opens at the top), with when. */
  let link: { key: string; at: number } | null = null;
  document.addEventListener("click", (e) => {
    link = null;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    if (!a || a.target || a.closest(RESTORING_LINKS)) return;
    const to = new URL(a.href, location.href);
    if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search && to.hash !== location.hash) {
      link = { key: scrollKey(to), at: performance.now() };
    }
  });
  const routed = () => {
    const now = key();
    if (now === current) return; // popstate and hashchange both fire for one change
    current = now;
    const fromLink = link !== null && link.key === now && performance.now() - link.at < 1000;
    link = null;
    if (fromLink) {
      stop();
      window.scrollTo(0, 0); // a new entry opens at the top
    } else restore();
  };
  addEventListener("hashchange", routed);
  addEventListener("popstate", routed);

  // Back to a page kept whole by the browser (bfcache): it is already where it was.
  addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) stop();
  });

  // ---- this page load
  restore();
}
