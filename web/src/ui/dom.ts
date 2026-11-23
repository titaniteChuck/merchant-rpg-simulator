/** Small DOM helpers shared by the site's pages. */

export type Cell = string | number | boolean | null | undefined;
export type Row = Record<string, Cell>;

export const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const pct = (x: number) => `${fmt1.format(x * 100)}%`;

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
 * becomes one "count × letter" chip per grade.
 */
export function gradeBadge(label: string): HTMLElement {
  if (/^[DCBAS]$/.test(label)) return el("span", { class: `grade grade-${label}` }, label);
  const parts = [...label.matchAll(/([DCBAS])(\d+)/g)];
  if (!parts.length) return el("span", { class: "grade grade-mix" }, label);
  const title = parts.map(([, g, n]) => `${n} of grade ${g}`).join(", ");
  return el("span", { class: "grade-stack", title, "aria-label": title },
    ...parts.map(([, g, n]) => el("span", { class: "gq" },
      el("span", { class: "gq-n" }, fmt.format(Number(n))), el("span", { class: "gq-x", "aria-hidden": "true" }, "×"),
      el("span", { class: `grade grade-${g}` }, g))));
}

// ---------------------------------------------------------------- ascension
/**
 * Ascension is shown as an outline instead of text: silver for ascension 1, gold for ascension 2
 * (classes .asc-1 / .asc-2 in style.css). Items, maps and crafters (ascLevel) count 0–2 directly;
 * heroes store prestigeLevel 1–3 (1 = not ascended), see heroAsc().
 */
export const ascLevel = (v: unknown): number => Math.max(0, Math.min(2, Math.trunc(Number(v) || 0)));
export const ascClass = (v: unknown): string => (ascLevel(v) ? `asc asc-${ascLevel(v)}` : "");
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

/** Key for the outlines: "[silver] ascension 1 [gold] ascension 2". */
export function ascLegend(): HTMLElement {
  return el("p", { class: "asc-legend muted small" }, "Outline: ",
    el("span", { class: "asc asc-1" }, "ascension 1"), " ", el("span", { class: "asc asc-2" }, "ascension 2"));
}

/** The sortable "Asc" table cell: an outlined swatch (none for 0), the number for screen readers. */
export function ascSwatch(v: unknown): HTMLElement {
  const n = ascLevel(v);
  return n
    ? el("span", { class: `asc-swatch asc asc-${n}`, role: "img", "aria-label": ascText(n), title: ascText(n)[0].toUpperCase() + ascText(n).slice(1) })
    : el("span", { class: "muted", "aria-label": ascText(0) }, "–");
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
  num?: boolean;
  /** Display text; default: formatted value. */
  show?: (v: Cell, r: Row) => string;
  /** Cell content as nodes (wins over show). */
  render?: (r: Row) => Node | string;
}

/** A sortable table; click a header to sort. */
export function table(rows: Row[], cols: Column[], rowClass?: (r: Row) => string): HTMLElement {
  let sortKey = "";
  let asc = true;
  const tbody = el("tbody");
  const render = () => {
    const sorted = sortKey ? [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
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
    const th = el("th", { scope: "col", class: c.num ? "num" : "" }, el("button", { type: "button" }, c.label));
    th.querySelector("button")!.addEventListener("click", () => {
      asc = sortKey === c.key ? !asc : !c.num;
      sortKey = c.key;
      head.querySelectorAll("th").forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      render();
    });
    return th;
  }));
  render();
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), tbody));
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
