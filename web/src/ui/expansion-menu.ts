/**
 * The expansions controls (U28): "I own Frozen Tome", "I own Scribe" (the save's guess, overridden by hand) and
 * "Show expansion content", as menu items. They sit in the save menu (save-source.ts) when a save is loaded; on a page
 * without one (no save yet, the wiki, the class balance) a small expansions button in the top bar holds the same menu.
 * Also the "N hidden" notes the pages put under a filtered list. State: expansion-state.ts.
 */
import { EXPANSIONS } from "../tools/expansions.ts";
import { el, EXPANSION_LABEL, expansionBadge, EXPANSIONS_HREF } from "./dom.ts";
import {
  type Expansion, inferredState, overrideOf, owns, setOverride, setOwned, setShowAll, showAll, subscribe,
} from "./expansion-state.ts";

const XP: Expansion[] = ["Frozen", "Scribe"];

/** Hover text of an "I own X" item: the save's guess and its evidence, and whether the toggle overrides it. */
function ownTitle(x: Expansion): string {
  const inf = inferredState();
  const guessed = inf.owned.includes(x);
  const ev = inf.evidence.filter((e) => e.expansion === x || e.expansion === "either").map((e) => `• ${e.reason}${e.expansion === "either" ? " (one of the two)" : ""}`);
  const lines = [
    inf.source === null ? "No save loaded: no expansion is assumed."
      : guessed ? `Guessed from ${inf.source}: owned.` : `Not proven by ${inf.source} (a save can show that you own it, never that you don't).`,
    ...(guessed ? ev : ev.filter((l) => l.includes("one of the two"))),
    overrideOf(x) !== null ? `Set by hand to ${overrideOf(x) ? "owned" : "not owned"}; “Use the save's guess” undoes it.` : "Click to set it by hand.",
  ];
  return lines.join("\n");
}

const sourceText = (x: Expansion): string => {
  const o = overrideOf(x);
  if (o !== null) return "set by hand";
  const inf = inferredState();
  return inf.source === null ? "no save" : inf.owned.includes(x) ? "from the save" : "not in the save";
};

/**
 * The expansions group of a menu: one checkbox item per expansion, "Show expansion content", "Use the save's guess"
 * (when a toggle overrides it) and a link to the wiki's Expansions page. Updates itself in place on every change
 * (the menu stays open and the focus where it was).
 */
export function expansionMenuSection(): HTMLElement {
  const check = (on: boolean) => el("span", { class: "xp-check", "aria-hidden": "true" }, on ? "✓" : "");
  const own = XP.map((x) => {
    const src = el("span", { class: "xp-src muted small" });
    const b = el("button", { type: "button", role: "menuitemcheckbox", class: "xp-toggle", "data-xp": x },
      check(false), expansionBadge([x]), el("span", { class: "xp-label" }, `I own ${EXPANSIONS[x].name}`), src);
    b.addEventListener("click", () => setOwned(x, !owns(x)));
    return { x, b, src };
  });
  const show = el("button", { type: "button", role: "menuitemcheckbox", class: "xp-toggle xp-show",
    title: "Show the content of every expansion, owned or not (each piece keeps its expansion icon)" },
  check(false), el("span", { class: "xp-label" }, "Show expansion content"));
  show.addEventListener("click", () => setShowAll(!showAll()));
  const reset = el("button", { type: "button", role: "menuitem", class: "xp-reset", title: "Forget the toggles set by hand and follow the save's guess again" },
    "↺ Use the save's guess");
  reset.addEventListener("click", () => {
    for (const x of XP) setOverride(x, null);
    reset.closest<HTMLElement>("[role=menu]")?.querySelector<HTMLElement>(".xp-toggle")?.focus();
  });
  const about = el("a", { role: "menuitem", class: "xp-about", href: EXPANSIONS_HREF }, "What the expansions add →");
  const box = el("div", { class: "xp-menu", role: "group", "aria-label": "Expansions" },
    el("p", { class: "muted small save-menu-title" }, "Expansions"), ...own.map((o) => o.b), show, reset, about);
  const update = () => {
    for (const o of own) {
      o.b.setAttribute("aria-checked", String(owns(o.x)));
      o.b.querySelector(".xp-check")!.textContent = owns(o.x) ? "✓" : "";
      o.src.textContent = sourceText(o.x);
      o.b.title = ownTitle(o.x);
    }
    show.setAttribute("aria-checked", String(showAll()));
    show.querySelector(".xp-check")!.textContent = showAll() ? "✓" : "";
    reset.hidden = XP.every((x) => overrideOf(x) === null);
  };
  update();
  const off = subscribe(() => {
    if (!box.isConnected && box.dataset.mounted) return off();
    update();
  });
  queueMicrotask(() => (box.dataset.mounted = "1"));
  return box;
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

let chip: HTMLElement | null = null;

/**
 * The top-bar expansions button and its menu, for a page with no save menu (no save loaded, or a page that never
 * asks for one). save-source.ts removes it while its save chip (which holds the same items) is there.
 */
export function mountExpansionChip(): void {
  if (chip?.isConnected) return;
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const menu = el("div", { class: "save-menu", role: "menu", hidden: "", "aria-label": "Expansions" });
  const icons = el("span", { class: "xp-chip-icons" });
  const button = el("button", { type: "button", class: "save-chip-btn xp-chip-btn", "aria-haspopup": "menu", "aria-expanded": "false" },
    icons, el("span", { class: "save-chip-name" }, "Expansions"), " ▾");
  const note = el("p", { class: "muted small" });
  const sync = () => {
    const owned = XP.filter(owns);
    icons.replaceChildren(expansionBadge(XP));
    icons.classList.toggle("xp-none", !owned.length && !showAll());
    const inf = inferredState();
    const state = `${owned.length ? `You own ${owned.map((x) => EXPANSIONS[x].name).join(" and ")}` : "No expansion owned"}${showAll() ? "; all expansion content shown" : ""}`;
    button.title = `Expansions: ${state}`;
    note.textContent = inf.source === null
      ? "No save loaded: expansion content is hidden unless you own it (set it below) or show it."
      : `Ownership guessed from ${inf.source}; set it by hand below.`;
  };
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  menu.append(note, expansionMenuSection());
  button.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) menu.querySelector<HTMLElement>(".xp-toggle")?.focus();
  });
  chip = el("div", { class: "save-chip xp-chip" }, button, menu);
  const mine = chip;
  document.addEventListener("click", (e) => {
    if (!mine.contains(e.target as Node)) close();
  });
  menuKeys(chip, menu, button, close);
  subscribe(sync);
  sync();
  const gh = bar.querySelector(".gh");
  bar.insertBefore(chip, gh);
}

export function unmountExpansionChip(): void {
  chip?.remove();
  chip = null;
}

/**
 * "12 enemies of expansions you don't own are hidden. [Show expansion content]" under a filtered list; null when
 * nothing is hidden.
 */
export function hiddenNote(n: number, what: string): HTMLElement | null {
  if (!n) return null;
  const b = el("button", { type: "button", class: "link-btn" }, "Show expansion content");
  b.addEventListener("click", () => setShowAll(true));
  return el("p", { class: "xp-note muted small" }, expansionBadge(XP.filter((x) => !owns(x))),
    ` ${n} ${n === 1 ? singular(what) : what} from expansions you don't own ${n === 1 ? "is" : "are"} hidden. `, b);
}

/** "enemies" → "enemy", "classes" → "class", "maps" → "map"; "equipment" and phrases already singular stay. */
function singular(what: string): string {
  const [w, ...rest] = what.split(" ");
  const one = w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("sses") ? w.slice(0, -2) : w.endsWith("s") ? w.slice(0, -1) : w;
  return [one, ...rest].join(" ");
}

/** The body of a page about hidden content: what hides it, and the two ways to see it. */
export function hiddenBody(needs: Expansion[]): HTMLElement {
  const show = el("button", { type: "button", class: "secondary" }, "Show expansion content");
  show.addEventListener("click", () => setShowAll(true));
  const missingOnes = needs.filter((x) => !owns(x));
  const ownBtns = missingOnes.map((x) => {
    const b = el("button", { type: "button", class: "secondary" }, expansionBadge([x]), ` I own ${EXPANSIONS[x].name}`);
    b.addEventListener("click", () => setOwned(x, true));
    return b;
  });
  return el("div", { class: "xp-hidden-page" },
    el("p", {}, "This is content of the ", ...needs.flatMap((x, i) => [...(i ? [" and the "] : []), el("strong", {}, EXPANSION_LABEL[x])]),
      `, which you don't own${inferredState().source ? " (as far as your save shows)" : " (no save loaded)"}, so the site hides it. `,
      el("a", { href: EXPANSIONS_HREF }, "What the expansions add"), "."),
    el("div", { class: "toolbar" }, show, ...ownBtns));
}
