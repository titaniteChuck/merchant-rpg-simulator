/**
 * U62: the battle cards' skill and passive picker. A row's name is a button; a click (or Enter / Space) opens, in place
 * under the row, a list of the choices with each one's effect under its name (a native <select> can't show two lines
 * per option, least of all on a phone). The listbox pattern: the focus moves to the list, ↑ ↓ Home End move, Enter or
 * Space picks, Escape closes and gives the focus back to the button, Tab or a tap elsewhere closes. One list is open at
 * a time.
 */
import { apBadge, el } from "./dom.ts";
import { hideTip } from "./tooltip.ts";

export interface PickOption {
  value: string;
  label: string;
  /** Its action points (a skill); undefined: no AP badge (a passive). */
  ap?: number;
  /** Its effect, the short text under the name. */
  note?: string;
}

export interface PickSpec {
  /** What the list chooses ("Ana: turn 2 skill"): the list's name and the start of the button's. */
  label: string;
  /** The current choice as shown (the button's text). */
  text: string;
  value: string;
  options: () => PickOption[];
  onPick: (value: string) => void;
  /** The key the page puts the focus back by after its redraw (`[data-focus="…"]`). */
  focus: string;
  /** Where the list opens: the row (it is appended there, full width under the name). */
  host: () => HTMLElement;
}

let openOne: { close(refocus: boolean): void } | null = null;
let lists = 0;

/** The row's name as a button that opens its picker. */
export function pickButton(p: PickSpec): HTMLButtonElement {
  const b = el("button", { type: "button", class: "pk-btn", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-label": `${p.label}: ${p.text}. Change`, "data-focus": p.focus }, p.text);
  b.addEventListener("click", () => (b.getAttribute("aria-expanded") === "true" ? openOne?.close(true) : openPick(b, p)));
  return b;
}

/** Open `b`'s list (closing any other one); returns the list. */
export function openPick(b: HTMLElement, p: PickSpec): HTMLElement {
  openOne?.close(false);
  hideTip();
  const host = p.host();
  const opts = p.options();
  const id = `pk-${++lists}`;
  const items = opts.map((o, k) => el("li", { role: "option", id: `${id}-${k}`, class: "pk-opt", "aria-selected": String(o.value === p.value), "data-value": o.value },
    el("span", { class: "pk-name" }, o.label), ...(o.ap !== undefined ? [apBadge(o.ap)] : []),
    ...(o.note ? [el("span", { class: "pk-note" }, o.note)] : [])));
  const list = el("ul", { role: "listbox", id, class: "pk-list", tabindex: "-1", "aria-label": p.label }, ...items);
  let at = Math.max(0, opts.findIndex((o) => o.value === p.value));
  const mark = () => {
    items.forEach((it, k) => it.classList.toggle("active", k === at));
    list.setAttribute("aria-activedescendant", items[at]?.id ?? "");
    (items[at] as HTMLElement & { scrollIntoView?: (o: object) => void })?.scrollIntoView?.({ block: "nearest" });
  };
  const outside = (e: Event) => {
    if (!host.contains(e.target as Node)) handle.close(false);
  };
  const handle = {
    close(refocus: boolean) {
      list.remove();
      b.setAttribute("aria-expanded", "false");
      b.removeAttribute("aria-controls");
      document.removeEventListener?.("pointerdown", outside, true);
      if (openOne === handle) openOne = null;
      if (refocus) b.focus();
    },
  };
  const choose = (k: number) => {
    const v = opts[k]?.value;
    handle.close(true);
    if (v !== undefined && v !== p.value) p.onPick(v);
  };
  items.forEach((it, k) => it.addEventListener("click", () => choose(k)));
  list.addEventListener("keydown", (e: KeyboardEvent) => {
    const move = { ArrowDown: Math.min(opts.length - 1, at + 1), ArrowUp: Math.max(0, at - 1), Home: 0, End: opts.length - 1 }[e.key];
    if (move !== undefined) {
      at = move;
      mark();
    } else if (e.key === "Enter" || e.key === " ") choose(at);
    else if (e.key === "Escape") handle.close(true);
    else if (e.key === "Tab") return handle.close(false);
    else return;
    e.preventDefault();
    e.stopPropagation?.();
  });
  host.append(list);
  b.setAttribute("aria-expanded", "true");
  b.setAttribute("aria-controls", id);
  openOne = handle;
  document.addEventListener("pointerdown", outside, true);
  mark();
  list.focus();
  return list;
}
