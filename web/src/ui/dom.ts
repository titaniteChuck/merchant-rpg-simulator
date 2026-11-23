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

export function tile(label: string, value: string, hint?: string): HTMLElement {
  return el("div", { class: "tile" }, el("span", { class: "tile-label" }, label), el("span", { class: "tile-value" }, value),
    ...(hint ? [el("span", { class: "tile-hint" }, hint)] : []));
}

export interface Column {
  key: string;
  label: string;
  num?: boolean;
  /** Display text; default: formatted value. */
  show?: (v: Cell, r: Row) => string;
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
        const text = c.show ? c.show(v, r) : v === null || v === undefined ? "" : c.num && typeof v === "number" ? fmt.format(v) : String(v);
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
