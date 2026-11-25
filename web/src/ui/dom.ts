/** Small DOM helpers shared by the site's pages. */
import { compareNames, langTag } from "./names.ts";

export type Cell = string | number | boolean | null | undefined;
export type Row = Record<string, Cell>;

// ---------------------------------------------------------------- numbers, gold, time (R1 F28)
/**
 * Number formats in the visitor's language (the one picked in the top bar, names.ts langTag): "171,946" in English,
 * "171 946" in French. `fmt` (whole numbers) and `fmt1` (one decimal) keep the Intl.NumberFormat call shape
 * (`fmt.format(n)`), the formatter is rebuilt when the language changes.
 */
function localFormat(opts: Intl.NumberFormatOptions): { format: (n: number) => string } {
  let tag = "", f: Intl.NumberFormat | null = null;
  return {
    format(n: number): string {
      const t = langTag();
      if (!f || t !== tag) {
        tag = t;
        try {
          f = new Intl.NumberFormat(t, opts);
        } catch {
          f = new Intl.NumberFormat("en-US", opts); // a tag the runtime doesn't know
        }
      }
      return f.format(n);
    },
  };
}
export const fmt = localFormat({ maximumFractionDigits: 0 });
export const fmt1 = localFormat({ maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** Short form for a tight spot: "12k", "1.2M" (give the full `fmt` value in a tooltip beside it). */
export const fmtCompact = localFormat({ notation: "compact", maximumFractionDigits: 1 });
const fmt2 = localFormat({ maximumFractionDigits: 2, minimumFractionDigits: 2 });
/**
 * THE percentage (R2 F56: one formatter site-wide), from a 0..1 share: "42.5%" (one decimal by default), `digits` 0
 * for a whole "90%", 2 for "12.34%". No space before "%", digits in the visitor's language. "—" when not a number.
 */
export function pct(x: number, digits: 0 | 1 | 2 = 1): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${(digits === 0 ? fmt : digits === 2 ? fmt2 : fmt1).format(x * 100)}%`;
}

/**
 * THE level abbreviation (R2 F56; wording changed by the user on 2026-11-25: "lvl", not "lv"): column headers and
 * any label that starts a cell or line read "Lvl" (LV, lvStart(49) = "Lvl 49"); inline text reads lowercase
 * "lvl 49" (lv(49)). Not "Lv", "LV" or "level 49". `n` undefined or null: "lvl ?". The game's own translated names
 * are not affected.
 */
export const LV = "Lvl";
export const lv = (n: number | string | null | undefined): string => `lvl ${n ?? "?"}`;
export const lvStart = (n: number | string | null | undefined): string => `${LV} ${n ?? "?"}`;

/** Sentence case for a label (R2 F56): "time budget (s)" → "Time budget (s)"; the rest of the label is kept as written. */
export const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** THE gold amount: "171,946 g" (whole gold; `decimals` 1 for a per-unit cost: "12.5 g"). "—" when not a number. */
export function gold(n: number | null | undefined, decimals: 0 | 1 = 0): string {
  const num = goldNumber(n, decimals);
  return num === "—" ? num : `${num} g`;
}

/** gold() without the " g" (U37: a tight table cell whose header says it is gold): "171,946", "—". */
export function goldNumber(n: number | null | undefined, decimals: 0 | 1 = 0): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return (decimals ? fmt1 : fmt).format(n);
}

/**
 * THE duration, from seconds: "15 s" under a minute, "1 min 30 s" under 10 minutes (the seconds stay, R1 F07), then
 * whole minutes "12 min", "2 h 6 min" from an hour, "1 d 3 h" from a day. "?" when not a number. (Under a minute never
 * reads "0 min".)
 */
export function duration(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "?";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 600 && s % 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

export interface TileOptions {
  icon?: string;
  /** colour class: t-gold, t-green, t-blue, t-violet, t-pink, t-teal, t-orange, t-slate, good, mid, bad */
  tone?: string;
  /** 0..1: draw a progress bar under the value */
  bar?: number;
}

export function tile(label: string, value: string | Node, hint?: string, opts: TileOptions = {}): HTMLElement {
  return el("div", { class: `tile ${opts.tone ?? ""}`.trim() },
    ...(opts.icon ? [el("span", { class: "tile-icon", "aria-hidden": "true" }, opts.icon)] : []),
    el("span", { class: "tile-label" }, label), el("span", { class: "tile-value" }, value),
    ...(hint ? [el("span", { class: "tile-hint" }, hint)] : []),
    ...(opts.bar !== undefined ? [bar(opts.bar)] : []));
}

/** A 0..1 progress bar. */
export function bar(x: number): HTMLElement {
  const fill = el("span");
  fill.style.width = `${Math.max(0, Math.min(1, x)) * 100}%`;
  return el("div", { class: "bar", role: "img", "aria-label": `${Math.round(x * 100)}%` }, fill);
}

/** good / mid / bad colour class for a 0..1 rate (higher is better unless `lowerIsBetter`). */
export function rateTone(x: number, lowerIsBetter = false): string {
  const v = lowerIsBetter ? 1 - x : x;
  return v >= 0.9 ? "good" : v >= 0.5 ? "mid" : "bad";
}

export const GRADE_LETTERS = ["D", "C", "B", "A", "S"];

/**
 * A grade badge: "S", "B" … A stack split by grade ("C14 B21 A164" = 14 items of grade C, 21 of B …)
 * becomes one "count letter" chip per grade ("14 C"), the letter as its coloured badge.
 */
export function gradeBadge(label: string): HTMLElement {
  if (/^[DCBAS]$/.test(label)) return el("span", { class: `grade grade-${label}` }, label);
  const parts = [...label.matchAll(/([DCBAS])(\d+)/g)];
  if (!parts.length) return el("span", { class: "grade grade-mix" }, label);
  const title = parts.map(([, g, n]) => `${n} of grade ${g}`).join(", ");
  return el("span", { class: "grade-stack", title, "aria-label": title },
    ...parts.map(([, g, n]) => el("span", { class: "gq" },
      el("span", { class: "gq-n" }, fmt.format(Number(n))), el("span", { class: `grade grade-${g}` }, g))));
}

// ---------------------------------------------------------------- ascension
/**
 * Ascension is shown as an outline instead of text: silver for ascension 1, gold for ascension 2
 * (classes .asc-1 / .asc-2 in style.css). Items, maps and crafters (ascLevel) count 0–2 directly;
 * heroes store prestigeLevel 1–3 (1 = not ascended), see heroAsc().
 */
export const ascLevel = (v: unknown): number => Math.max(0, Math.min(2, Math.trunc(Number(v) || 0)));
export const ascText = (v: unknown): string => `ascension ${ascLevel(v)}`;
/** Hero prestigeLevel (1–3) as an ascension count (0–2). */
export const heroAsc = (prestigeLevel: unknown): number => ascLevel((Number(prestigeLevel) || 1) - 1);

/**
 * Outline `e` for its ascension and say it to screen readers (links keep their own tooltip).
 * `name` replaces the element's text in that label (an avatar shows only an initial).
 */
export function withAsc<T extends Element>(e: T, v: unknown, name = e.textContent ?? ""): T {
  const n = ascLevel(v);
  if (!n) return e;
  e.classList.add("asc", `asc-${n}`);
  e.setAttribute("aria-label", `${name}, ${ascText(n)}`);
  if (e.tagName !== "A") e.setAttribute("title", `${name} · ${ascText(n)[0].toUpperCase()}${ascText(n).slice(1)}`);
  return e;
}

/** The sortable "Asc" table cell: an outlined swatch (none for 0), the number for screen readers. */
export function ascSwatch(v: unknown): HTMLElement {
  const n = ascLevel(v);
  return n
    ? el("span", { class: `asc-swatch asc asc-${n}`, role: "img", "aria-label": ascText(n), title: ascText(n)[0].toUpperCase() + ascText(n).slice(1) }, String(n))
    : el("span", { class: "muted" }, el("span", { "aria-hidden": "true" }, "–"), el("span", { class: "visually-hidden" }, ascText(0)));
}

/**
 * U37: one table cell holding a value per ascension variant (asc 0/1/2; maps 0/1), each a small box outlined in its
 * ascension's tier colour (the class page's asc 0 / silver / gold), as plain numbers (goldNumber, no "g"). A slot
 * with no value is a dash, so the boxes line up down a column.
 * A11y review F03: the boxes are aria-hidden and the cell reads a visually-hidden line ("Gold, ascension 0: 10 g, …"),
 * not an aria-label on the plain span (a name a generic span may not have: readers skipped it, the cell was silent).
 */
export function ascValues(values: [asc: number, value: number | null][], what = "Gold"): HTMLElement {
  const label = values.map(([a, v]) => `${ascText(a)}: ${v === null ? "none" : gold(v)}`).join(", ");
  return el("span", { class: "asc-vals", title: `${what} by ascension · ${label}` },
    el("span", { class: "visually-hidden" }, `${what}, ${label}`),
    ...values.map(([a, v]) => v === null
      ? el("span", { class: `av av-none tier-${ascLevel(a)}`, "aria-hidden": "true" }, "–")
      : el("span", { class: `av tier-${ascLevel(a)}`, "aria-hidden": "true" }, goldNumber(v))));
}

/** An item name coloured by rarity (the game's rarity colours). */
export function itemName(name: string, rarity: unknown): HTMLElement {
  return el("span", { class: `item rar-${typeof rarity === "number" ? rarity : 1}` }, name);
}

export function pill(text: string, cls = ""): HTMLElement {
  return el("span", { class: `pill ${cls}`.trim() }, text);
}

export interface Column {
  key: string;
  label: string;
  /** A column of numbers: its cells and header get class "num" (centred, tabular digits; style.css), and it sorts high to low first. */
  num?: boolean;
  /** Display text; default: formatted value. */
  show?: (v: Cell, r: Row) => string;
  /** Cell content as nodes (wins over show). */
  render?: (r: Row) => Node | string;
  /** The value the column sorts by, when not the cell's own (a modded item sorts by its base name, U34). */
  sortBy?: (r: Row) => Cell;
}

/** A table's sort: the column key ("" = the rows' own order) and its direction. */
export interface TableSort { key: string; asc: boolean }

export interface TableOptions {
  /** The sort to start with (a caller that rebuilds the table keeps it this way, QA R2 F4). */
  sort?: TableSort;
  /** Told of each header click's new sort. */
  onSort?: (s: TableSort) => void;
}

/** A sortable table; click a header to sort. */
export function table(rows: Row[], cols: Column[], rowClass?: (r: Row) => string, opts: TableOptions = {}): HTMLElement {
  let sortKey = opts.sort && cols.some((c) => c.key === opts.sort!.key) ? opts.sort.key : "";
  let asc = sortKey ? opts.sort!.asc : true;
  const tbody = el("tbody");
  const render = () => {
    const by = cols.find((c) => c.key === sortKey)?.sortBy;
    const sorted = sortKey ? [...rows].sort((a, b) => {
      const x = by ? by(a) : a[sortKey], y = by ? by(b) : b[sortKey];
      const c = typeof x === "number" && typeof y === "number" ? x - y : compareNames(String(x ?? ""), String(y ?? "")); // names in the visitor's language (U29)
      return asc ? c : -c;
    }) : rows;
    tbody.replaceChildren(...sorted.map((r) => {
      const tr = el("tr", rowClass ? { class: rowClass(r) } : {});
      for (const c of cols) {
        const v = r[c.key];
        const text = c.render ? c.render(r) : c.show ? c.show(v, r) : v === null || v === undefined ? "" : c.num && typeof v === "number" ? fmt.format(v) : String(v);
        tr.append(el("td", c.num ? { class: "num" } : {}, text));
      }
      return tr;
    }));
  };
  const head = el("tr", {}, ...cols.map((c) => {
    const th = el("th", { scope: "col", ...(c.num ? { class: "num" } : {}) }, el("button", { type: "button" }, c.label));
    if (c.key === sortKey) th.setAttribute("aria-sort", asc ? "ascending" : "descending");
    th.querySelector("button")!.addEventListener("click", () => {
      asc = sortKey === c.key ? !asc : !c.num;
      sortKey = c.key;
      head.querySelectorAll("th").forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      render();
      opts.onSort?.({ key: sortKey, asc });
    });
    return th;
  }));
  render();
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), tbody));
}

// ---------------------------------------------------------------- focus across a re-render (QA R2 F3)
/**
 * Where the focus was, in a form that finds the same control in a rebuilt panel: its `data-focus-key`, a radio's
 * name and value, or (last resort) its aria-label. A chip, a sort header and "Show more" have no aria-label, so the
 * old aria-label-only lookup lost the focus on every filter change.
 */
export type FocusKey = { key: string } | { radio: string; value: string } | { label: string };

export function focusKeyOf(e: Element | null): FocusKey | null {
  if (!e) return null;
  const key = e.getAttribute("data-focus-key");
  if (key) return { key };
  const name = e.getAttribute("name");
  if (e.tagName.toLowerCase() === "input" && e.getAttribute("type") === "radio" && name) {
    return { radio: name, value: e.getAttribute("value") ?? (e as HTMLInputElement).value };
  }
  const label = e.getAttribute("aria-label");
  return label ? { label } : null;
}

/** The control a FocusKey names inside `root` (compared as strings: no selector escaping). */
export function findFocusKey(root: ParentNode, k: FocusKey): HTMLElement | null {
  const all = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  if ("key" in k) return all("[data-focus-key]").find((e) => e.getAttribute("data-focus-key") === k.key) ?? null;
  if ("radio" in k) {
    return all("input[name]").find((e) => e.getAttribute("type") === "radio" && e.getAttribute("name") === k.radio
      && (e.getAttribute("value") ?? (e as HTMLInputElement).value) === k.value) ?? null;
  }
  return all("[aria-label]").find((e) => e.getAttribute("aria-label") === k.label) ?? null;
}

/**
 * Keyboard for a tablist (WAI-ARIA tabs pattern): Left / Right (wrapping), Home and End move to a tab and select it;
 * only the selected tab is in the Tab order. Call once the tab buttons are in the list.
 */
export function tabKeys(list: HTMLElement): void {
  const tabs = () => [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const sync = () => tabs().forEach((t) => (t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1));
  new MutationObserver(sync).observe(list, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  list.addEventListener("keydown", (e) => {
    const ts = tabs();
    const i = ts.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const j = e.key === "ArrowRight" ? (i + 1) % ts.length : e.key === "ArrowLeft" ? (i - 1 + ts.length) % ts.length
      : e.key === "Home" ? 0 : e.key === "End" ? ts.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    ts[j].focus();
    ts[j].click();
  });
  queueMicrotask(sync);
}

// ---------------------------------------------------------------- toggles (R1 F27)
/**
 * The site's two toggle styles (CSS block "r1 global" at the end of style.css):
 * - `.seg`: a segmented control, ONE choice out of a few (radio inputs in `label.seg-opt`, a radiogroup), with
 *   `segField` when it has a visible name beside it. (Profit uses it too since P1; the old `.mode-switch` is gone.)
 * - `.chip-toggle`: an on / off chip (a button with aria-pressed), for filters that combine.
 */
export interface SegOption { value: string; label: Node | string; title?: string; /** extra class of the option */ cls?: string }

/** A segmented control: `name` groups the radios, `label` names the group; `onChange` gets the picked value. */
export function segmented(name: string, label: string, options: SegOption[], value: string, onChange: (v: string) => void): HTMLElement {
  return el("div", { class: "seg", role: "radiogroup", "aria-label": label }, ...options.map((o) => {
    const input = el("input", { type: "radio", name, value: o.value }) as HTMLInputElement;
    input.checked = o.value === value;
    input.addEventListener("change", () => input.checked && onChange(o.value));
    return el("label", { class: `seg-opt${o.cls ? ` ${o.cls}` : ""}`, ...(o.title ? { title: o.title } : {}) }, input, el("span", {}, o.label));
  }));
}

/**
 * A segmented control with its name shown before it ("GRADE  D C B A S"). A text name is hidden from screen readers
 * (the radiogroup already carries it); a node (a link to the Stats page) stays reachable.
 */
export function segField(label: Node | string, seg: HTMLElement, cls = ""): HTMLElement {
  return el("div", { class: `seg-field${cls ? ` ${cls}` : ""}` },
    el("span", { class: "seg-label", ...(typeof label === "string" ? { "aria-hidden": "true" } : {}) }, label), seg);
}

/** An on / off chip (aria-pressed); `onToggle` gets the new state. */
export function chipToggle(label: Node | string, on: boolean, onToggle: (on: boolean) => void, title = ""): HTMLButtonElement {
  const b = el("button", { type: "button", class: "chip-toggle", "aria-pressed": String(on), ...(title ? { title } : {}) }, label);
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(next));
    onToggle(next);
  });
  return b;
}

/** <select> from [value, label] pairs, optionally grouped. */
export function select(attrs: Record<string, string>, options: ([string, string] | [string, [string, string][]])[]): HTMLSelectElement {
  const s = el("select", attrs);
  for (const [v, label] of options) {
    if (Array.isArray(label)) s.append(el("optgroup", { label: v }, ...label.map(([ov, ol]) => el("option", { value: ov }, ol))));
    else s.append(el("option", { value: v }, label));
  }
  return s;
}

// ---------------------------------------------------------------- ability rows and gear (U22)
/** An action-point cost as the compact badge of the wiki's skill rows ("?" when unknown). */
export function apBadge(ap: number | undefined): HTMLElement {
  const t = `${ap ?? "?"} action points`;
  return el("span", { class: "ap-badge", role: "img", title: t, "aria-label": t }, String(ap ?? "?"));
}

/**
 * The whole table row opens `link` (hover style: `tr.row-link`); the name stays a real link (keyboard, middle-click,
 * screen readers). Clicks on other controls or a text selection are left alone; Ctrl / Cmd opens a new tab.
 * A `link` that is not an <a> ("Basic", an unknown passive) leaves the row as it is.
 */
export function clickableRow(tr: HTMLTableRowElement, link: Element): void {
  if (!(link instanceof HTMLAnchorElement)) return;
  tr.classList.add("row-link");
  tr.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a, button, input, select, summary")) return;
    if (window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey) window.open(link.href, "_blank");
    else link.click();
  });
}

/** The six equipment slots in the game's itemSlot order (1..6). */
export const GEAR_SLOTS = ["weapon", "head", "body", "hands", "feet", "trinket"] as const;
export type GearSlot = typeof GEAR_SLOTS[number];
/**
 * THE slot names, everywhere on the site (R1-D). The game shows no slot names; its code and art call them weapon, head,
 * body, hands (the "handSet"), feet and trinket (the "Trinkets"). "Bracers" and "Trinket" are also equipment kinds.
 */
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = { weapon: "Weapon", head: "Head", body: "Body", hands: "Hands", feet: "Feet", trinket: "Trinket" };
export const GEAR_SLOT_ICONS: Record<GearSlot, string> = { weapon: "⚔️", head: "🪖", body: "🥋", hands: "🧤", feet: "👢", trinket: "💍" };

/** A slot from its name ("weapon" … "trinket") or the game's itemSlot number (1..6); undefined otherwise. */
export function gearSlot(v: unknown): GearSlot | undefined {
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return GEAR_SLOTS[Number(v) - 1];
  return GEAR_SLOTS.find((s) => s === v);
}

/** A slot's name from its name or the game's itemSlot number ("Body" for 3); undefined for none. */
export function slotName(v: unknown): string | undefined {
  const s = gearSlot(v);
  return s && GEAR_SLOT_NAMES[s];
}

/** Items keyed by their slot (`slotOf` gives a slot name or itemSlot number); the first item of a slot wins. */
export function bySlot<T>(items: T[], slotOf: (item: T) => unknown): Partial<Record<GearSlot, T>> {
  const out: Partial<Record<GearSlot, T>> = {};
  for (const it of items) {
    const s = gearSlot(slotOf(it));
    if (s && !(s in out)) out[s] = it;
  }
  return out;
}

export interface GearGridOptions {
  /** One column (a compact strip, e.g. a small card) instead of two. */
  compact?: boolean;
  /** Content of a slot with no item; default: the slot's icon and name, "empty". */
  empty?: (slot: GearSlot) => Node | string;
  /** Accessible name of the list (default "Equipment"). */
  label?: string;
}

/**
 * The six equipment slots as a list laid out in two columns: weapon, head, body on the left; hands, feet,
 * trinket on the right (`compact`: one column, same order). The DOM order is the reading order (column by column).
 * Each slot is an <li class="gear-cell" data-slot="…"> holding `render(item, slot)`. CSS: `.gear-grid` in style.css.
 */
export function gearGrid<T>(slots: Partial<Record<GearSlot, T>>, render: (item: T, slot: GearSlot) => Node | string, opts: GearGridOptions = {}): HTMLElement {
  const empty = opts.empty ?? ((s: GearSlot) => el("span", { class: "gear-empty" },
    el("span", { class: "slot-ico", "aria-hidden": "true" }, GEAR_SLOT_ICONS[s]), `${GEAR_SLOT_NAMES[s]}: empty`));
  return el("ul", { class: `gear-grid${opts.compact ? " compact" : ""}`, "aria-label": opts.label ?? "Equipment" },
    ...GEAR_SLOTS.map((s) => {
      const it = slots[s];
      return el("li", { class: `gear-cell${it === undefined ? " is-empty" : ""}`, "data-slot": s }, it === undefined ? empty(s) : render(it, s));
    }));
}

// ---------------------------------------------------------------- expansions (U28)
/**
 * The two paid expansions as a small icon after a name: a snowflake for the Frozen Tome, a quill for Scribe. Content
 * that needs both shows both. Inline SVG (no text, so a link's text and the page title stay the name); each icon is a
 * role="img" with its name ("Frozen Tome expansion") as label and tooltip. The rules: web/src/tools/expansions.ts;
 * who owns what: expansion-state.ts.
 */
export type ExpansionId = "Frozen" | "Scribe";
/** The Wiki's Expansions page (what each expansion adds, how ownership is guessed). */
export const EXPANSIONS_HREF = "wiki.html#/expansions";
export const EXPANSION_LABEL: Record<ExpansionId, string> = { Frozen: "Frozen Tome expansion", Scribe: "Scribe expansion" };
const EXPANSION_SVG: Record<ExpansionId, string> = {
  // three crossing strokes with a small V near each end
  Frozen: '<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
    + [0, 60, 120].map((r) => `<path transform="rotate(${r} 8 8)" d="M8 1.2v13.6M6.1 2.6 8 4.4l1.9-1.8M6.1 13.4 8 11.6l1.9 1.8"/>`).join("")
    + "</svg>",
  // a feather (filled vane) on a slanted shaft
  Scribe: '<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">'
    + '<path fill="currentColor" d="M14.6 1.4c-4.6.3-8.3 3.2-9.3 8.2l-.3 1.5 1.5-.4c4.7-1.2 7.6-4.8 8.1-9.3z"/>'
    + '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M11.2 4.8 2 14.6"/></svg>',
};

/** One icon per expansion of `needs`, in the game's order (Frozen, Scribe). */
function expansionIcons(needs: readonly ExpansionId[], suffix = ""): HTMLElement[] {
  return (["Frozen", "Scribe"] as const).filter((x) => needs.includes(x)).map((x) => {
    const s = el("span", { class: `xp-ico xp-${x.toLowerCase()}`, role: "img", "aria-label": EXPANSION_LABEL[x], title: `${EXPANSION_LABEL[x]}${suffix}` });
    s.innerHTML = EXPANSION_SVG[x];
    return s;
  });
}

/**
 * The expansion badge of a piece of content: one icon per expansion it needs (none: an empty span). `link`: the badge
 * is a link to the wiki's Expansions page (never inside another link: a name link carries the badge as plain icons and
 * says it in its tooltip).
 */
export function expansionBadge(needs: readonly ExpansionId[] | null | undefined, opts: { link?: boolean } = {}): HTMLElement {
  const list = needs ?? [];
  if (opts.link && list.length) {
    return el("a", { class: "xp-badge", href: EXPANSIONS_HREF, title: `${list.map((x) => EXPANSION_LABEL[x]).join(" + ")}: what it adds (Wiki › Expansions)` },
      ...expansionIcons(list));
  }
  return el("span", { class: "xp-badge" }, ...expansionIcons(list, " (see Wiki › Expansions)"));
}

/**
 * The badge as text, for places that can't hold markup (an <option>): " ❄" for the Frozen Tome, " ✒" for Scribe
 * (both: " ❄✒"), or "".
 */
export const expansionMark = (needs: readonly ExpansionId[] | null | undefined): string =>
  needs?.length ? ` ${needs.includes("Frozen") ? "❄" : ""}${needs.includes("Scribe") ? "✒" : ""}` : "";

/** "Needs the Frozen Tome expansion (see Wiki › Expansions)." for tooltips, or "". */
export const expansionNote = (needs: readonly ExpansionId[] | null | undefined): string =>
  needs?.length ? `Needs the ${needs.map((x) => EXPANSION_LABEL[x]).join(" and the ")} (see Wiki › Expansions).` : "";

/**
 * The greyed stand-in for content the visitor hides (an expansion they don't own): its badge and "expansion content",
 * a link to the Expansions page. Tables keep the row, so their numbers (a drop table's chances) still add up.
 */
export function expansionPlaceholder(needs: readonly ExpansionId[]): HTMLElement {
  const names = needs.map((x) => EXPANSION_LABEL[x]).join(" + ") || "an expansion";
  return el("a", { class: "xp-hidden", href: EXPANSIONS_HREF,
    title: `Hidden: content of the ${names}, which you don't own. Turn on “Show expansion content” in the expansions menu (top bar) to see it.` },
  ...expansionIcons(needs), el("span", {}, "expansion content"));
}

/**
 * U40: a short message in a corner toast, read out by screen readers (one aria-live region per page, made on first
 * use). It goes away after a few seconds, or on a click.
 */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, kind: "error" | "info" = "error"): void {
  let box = document.querySelector<HTMLElement>("#toast");
  if (!box) {
    box = el("div", { id: "toast", class: "toast", role: kind === "error" ? "alert" : "status", "aria-live": kind === "error" ? "assertive" : "polite" });
    box.addEventListener("click", () => (box!.hidden = true));
    document.body.append(box);
  }
  box.className = `toast ${kind}`;
  box.textContent = `${kind === "error" ? "⚠ " : ""}${message}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box!.hidden = true), 5000);
}
