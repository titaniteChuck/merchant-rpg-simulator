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

export function tile(label: string, value: string, hint?: string, opts: TileOptions = {}): HTMLElement {
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

/** A grade badge: "S", "B" … or a split stack ("B93 A100"). */
export function gradeBadge(label: string): HTMLElement {
  return el("span", { class: `grade ${/^[DCBAS]$/.test(label) ? `grade-${label}` : "grade-mix"}` }, label);
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
