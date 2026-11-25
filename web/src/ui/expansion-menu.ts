/**
 * The expansions controls (U28): "I own Frozen Tome", "I own Scribe" (the save's guess, overridden by hand) and
 * "Show expansion content", as menu items. They sit in the top-bar Save dropdown (save-menu.ts): the one of a loaded
 * save (save-source.ts) or, on a page without one (no save yet, the wiki, the class balance), the "📜 Save ▾" dropdown
 * built here (mountExpansionChip, U44: it also holds a way to open a save and the Save pages). R2-A F09: in both they
 * are a folded "Expansions ▸" submenu (expansionsFold).
 * Also the "N hidden" notes the pages put under a filtered list. State: expansion-state.ts.
 */
import { EXPANSIONS } from "../tools/expansions.ts";
import { notOwnedWhy } from "./expansion-why.ts";
import { el, EXPANSION_LABEL, expansionBadge, EXPANSIONS_HREF } from "./dom.ts";
import {
  fitMenu, foldGroup, keptSave, menuHead, menuKeys, menuSep, menuTitle, openSaveLink, placeChip, plainHead, refocusSaveChip, saveChipButton,
  savePagesGroup,
} from "./save-menu.ts";

export { fitMenu, menuKeys } from "./save-menu.ts";
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
export function expansionMenuSection(opts: { title?: boolean } = {}): HTMLElement {
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
    ...(opts.title === false ? [] : [el("p", { class: "muted small save-menu-title" }, "Expansions")]), ...own.map((o) => o.b), show, reset, about);
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

/** R2-A F09: the expansions as a folded submenu of a Save dropdown ("Expansions ▸"), so the dropdown stays short. */
export function expansionsFold(menu: HTMLElement): HTMLElement {
  return foldGroup("Expansions", menu, expansionMenuSection({ title: false }));
}

let chip: HTMLElement | null = null;

/** A save action of the no-save dropdown (save-source.ts: open your save, try the example save). */
export interface SaveAction { label: string; hint: string; run: () => unknown }

/**
 * The top-bar Save dropdown with no save loaded (U44; the expansions button before): "📜 Save ▾" with the expansion
 * icons, holding the save file group (`actions` on a page that reads a save; else a link to the save viewer), the Save
 * pages and the expansions. save-source.ts removes it while its own dropdown (a save loaded) is there.
 */
export function mountExpansionChip(actions?: SaveAction[]): void {
  if (chip?.isConnected) return;
  if (!document.querySelector(".topbar")) return;
  const menu = el("div", { class: "save-menu", role: "menu", hidden: "", "aria-label": "Save" });
  // R2-A F07 / F10: the one chip format (no expansion icons) and, on a page that doesn't read the save (the wiki), the
  // same head and "Open" label as every other page's plain dropdown, with the kept save's name.
  const kept = actions?.length ? null : keptSave();
  const button = saveChipButton(kept?.name ?? "Save", "");
  const head = kept ? plainHead() : menuHead(null, null, "");
  const sync = () => {
    const owned = XP.filter(owns);
    const inf = inferredState();
    const state = `${owned.length ? `You own ${owned.map((x) => EXPANSIONS[x].name).join(" and ")}` : "No expansion owned"}${showAll() ? "; all expansion content shown" : ""}`;
    button.title = `${kept ? `Save: ${kept.name}, kept in this browser` : "Save: none loaded"}. Expansions: ${state}`;
    if (!kept) {
      head.title = inf.source === null
        ? "No save loaded: expansion content is hidden unless you own it (set it under Expansions) or show it."
        : `Expansion ownership guessed from ${inf.source}; set it by hand under Expansions.`;
    }
  };
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const action = (x: SaveAction) => {
    const b = el("button", { type: "button", role: "menuitem", title: x.hint }, x.label);
    b.addEventListener("click", () => {
      close();
      refocusSaveChip(x.run()); // QA R2 F6: the focus back on the Save button
    });
    return b;
  };
  const file = actions?.length ? actions.map(action) : [openSaveLink()];
  menu.append(head,
    el("div", { class: "save-menu-group", role: "group", "aria-label": "Save file" }, menuTitle("Save file"), ...file),
    menuSep(), savePagesGroup(close), menuSep(), expansionsFold(menu));
  button.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      fitMenu(menu);
      menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    }
  });
  chip = el("div", { class: "save-chip xp-chip" }, button, menu);
  const mine = chip;
  document.addEventListener("click", (e) => {
    if (!mine.contains(e.target as Node)) close();
  });
  menuKeys(chip, menu, button, close);
  subscribe(sync);
  sync();
  placeChip(chip);
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
      `, which you don't own ${notOwnedWhy(needs)}, so the site hides it. `, // R1 F31: worded per source
      el("a", { href: EXPANSIONS_HREF }, "What the expansions add"), "."),
    el("div", { class: "toolbar" }, show, ...ownBtns));
}
