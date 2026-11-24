/**
 * The language of game names in the browser (U29). site/theme.js reads the visitor's choice before the page paints
 * (localStorage "lang", else the browser's language when the game has it, else English), puts it on
 * <html data-lang>, draws the picker in the top bar and fires LANG_EVENT when the visitor picks another language.
 *
 * Here: load that language's file (data/i18n/<code>.json, only for a language other than English, once), make it
 * current for names.ts, and on a change tell the page (onLanguageChange) after updating every marked name in place
 * (relabel). A page awaits `languageReady` before its first render so it paints in the right language at once.
 */
import { currentLanguage, loadedLanguages, loadLanguage, setLanguage } from "../tools/i18n.ts";
import { nameFor } from "./names.ts";

/** Fired on window by site/theme.js; detail = the language code. */
export const LANG_EVENT = "merchant:language";

const browser = typeof document !== "undefined" && typeof window !== "undefined";
const wanted = (): string => (browser ? document.documentElement.dataset.lang || "en" : "en");

/** Load (once) and select a language; English, or any failure, leaves English. */
async function use(code: string): Promise<void> {
  const c = (code || "en").toLowerCase();
  if (c !== "en" && !loadedLanguages().includes(c)) {
    try {
      const r = await fetch(`data/i18n/${encodeURIComponent(c)}.json`);
      if (r.ok) loadLanguage(await r.json());
    } catch { /* offline or no file: English */ }
  }
  if (!setLanguage(c)) setLanguage("en");
}

/** Resolves once the chosen language is loaded and current (at once for English). */
export const languageReady: Promise<void> = browser ? use(wanted()) : Promise.resolve();

const listeners: (() => void)[] = [];
/** Call `f` after each change of language (marked names are already updated): re-render what the page shows. */
export function onLanguageChange(f: () => void): void {
  listeners.push(f);
}

/** Put the current language's text in every element marked by names.ts markName(). */
export function relabel(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-name]").forEach((e) => {
    const [kind, id] = (e.getAttribute("data-name") ?? "").split("|");
    const next = nameFor(kind, id);
    const t = e.firstChild;
    if (!next || !t || t.nodeType !== Node.TEXT_NODE) return;
    const old = t.nodeValue ?? "";
    if (old === next) return;
    t.nodeValue = next;
    const label = e.getAttribute("aria-label");
    if (label && old) e.setAttribute("aria-label", label.split(old).join(next));
  });
}

if (browser) {
  let chain: Promise<void> = languageReady;
  window.addEventListener(LANG_EVENT, (ev) => {
    const code = String((ev as CustomEvent).detail ?? wanted());
    chain = chain.then(() => use(code)).then(() => {
      relabel();
      for (const f of listeners) {
        try {
          f();
        } catch (e) {
          console.error(e);
        }
      }
    });
  });
}

/** The current language code (re-exported for pages that only need this module). */
export { currentLanguage };

/**
 * Re-render `root` in place and keep what the visitor set in it: text and search fields, selects, checkboxes and
 * radios (matched by position, put back only when the new form has the same shape), the sorted table columns, and
 * the scroll position. Changes are replayed with their input / change events, so filters and pickers apply again.
 */
export function rerenderKeeping(root: HTMLElement, draw: () => void): void {
  const y = window.scrollY;
  const fields = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")];
  const kept = fields.map((f) => ({ tag: f.tagName, type: (f as HTMLInputElement).type ?? "", value: f.value, checked: (f as HTMLInputElement).checked }));
  const sorts = [...root.querySelectorAll("table")].map((t) => {
    const th = t.querySelector("thead th[aria-sort]");
    return th ? { col: [...th.parentElement!.children].indexOf(th), dir: th.getAttribute("aria-sort") } : null;
  });
  draw();
  const now = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")];
  if (now.length === kept.length && now.every((f, i) => f.tagName === kept[i].tag && ((f as HTMLInputElement).type ?? "") === kept[i].type)) {
    now.forEach((f, i) => {
      const k = kept[i];
      if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) {
        if (f.checked !== k.checked) {
          f.checked = k.checked;
          if (k.checked || f.type === "checkbox") f.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (f instanceof HTMLInputElement && f.type === "file") {
        // never set from script
      } else if (f.value !== k.value && (!(f instanceof HTMLSelectElement) || [...f.options].some((o) => o.value === k.value))) {
        f.value = k.value;
        f.dispatchEvent(new Event(f instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      }
    });
  }
  const tables = [...root.querySelectorAll("table")];
  sorts.forEach((s, i) => {
    const btn = s && tables[i]?.querySelector(`thead tr > :nth-child(${s.col + 1}) button`) as HTMLButtonElement | null;
    if (!s || !btn) return;
    btn.click();
    if (btn.closest("th")?.getAttribute("aria-sort") !== s.dir) btn.click();
  });
  window.scrollTo(0, y);
}
