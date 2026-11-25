/**
 * U62: the battle cards' skill and passive picker. A row's name is a button; a click (or Enter / Space) opens a list of
 * the choices with each one's effect under its name (a native <select> can't show two lines per option, least of all
 * on a phone). The listbox pattern: the focus moves to the list, ↑ ↓ Home End move, Enter or Space picks, Escape closes
 * and gives the focus back to the button, Tab or a tap elsewhere closes. One list is open at a time.
 * - In place (U64, the Flows' cells): the list is appended to the host, full width under the name.
 * - U69 `float` (the Party view's cards): the list floats over the page like a native select's popup, in <body>, fixed
 *   under the clicked row (above it when there is more room there), kept inside the viewport (placePopup), following
 *   the row on scroll and resize; the card doesn't grow or clip it.
 * U69: a choice can be `disabled` (a skill over the AP budget): greyed, aria-disabled, reachable with the arrows but
 * never picked.
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
  /** U69: shown but not selectable (a skill the AP budget can't take); `why` is its title ("22 / 20 AP"). */
  disabled?: boolean;
  why?: string;
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
  /** The row: in place, the list is appended there (full width under the name); floating, the list is anchored to it. */
  host: () => HTMLElement;
  /** U69: float over the page (in <body>, anchored to the host) instead of opening inside it. */
  float?: boolean;
}

/** U69: a box on screen (getBoundingClientRect's fields this module reads). */
export interface Box {
  left: number;
  top: number;
  bottom: number;
  width: number;
}
/** U69: where a floating list goes: fixed position (px, viewport), below the anchor (`top`) or above it (`bottom`). */
export interface PopupPlace {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/** U69: the floating list's tallest and narrowest, its margin from the viewport's edges and its gap from the row. */
export const POPUP = { maxHeight: 320, minWidth: 260, margin: 8, gap: 2 };

/**
 * U69: a floating list's place for an anchor (the row) in a viewport: as wide as the row (at least POPUP.minWidth, at
 * most the viewport less its margins), its left edge on the row's and moved in to stay on screen; under the row, or
 * above it when the room under is short of a full list and there is more above; its height capped by the room there.
 * Pure, for the tests.
 */
export function placePopup(anchor: Box, view: { width: number; height: number }): PopupPlace {
  const { margin, gap } = POPUP;
  const width = Math.max(0, Math.min(Math.max(anchor.width, POPUP.minWidth), view.width - 2 * margin));
  const left = Math.max(margin, Math.min(anchor.left, view.width - margin - width));
  const cap = Math.min(POPUP.maxHeight, Math.round(view.height * 0.6));
  const below = view.height - anchor.bottom - gap - margin, above = anchor.top - gap - margin;
  if (below >= cap || below >= above) return { left, width, maxHeight: Math.max(0, Math.min(cap, below)), top: anchor.bottom + gap };
  return { left, width, maxHeight: Math.max(0, Math.min(cap, above)), bottom: view.height - anchor.top + gap };
}

const viewport = () => ({
  width: (globalThis as { innerWidth?: number }).innerWidth || document.documentElement.clientWidth || 0,
  height: (globalThis as { innerHeight?: number }).innerHeight || document.documentElement.clientHeight || 0,
});

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
  const items = opts.map((o, k) => el("li", { role: "option", id: `${id}-${k}`, class: `pk-opt${o.disabled ? " off" : ""}`,
    "aria-selected": String(o.value === p.value), "data-value": o.value,
    ...(o.disabled ? { "aria-disabled": "true", ...(o.why ? { title: o.why } : {}) } : {}) },
  el("span", { class: "pk-name" }, o.label), ...(o.ap !== undefined ? [apBadge(o.ap)] : []),
  ...(o.note ? [el("span", { class: "pk-note" }, o.note)] : [])));
  const list = el("ul", { role: "listbox", id, class: `pk-list${p.float ? " pk-float" : ""}`, tabindex: "-1", "aria-label": p.label }, ...items);
  let at = Math.max(0, opts.findIndex((o) => o.value === p.value));
  const mark = () => {
    items.forEach((it, k) => it.classList.toggle("active", k === at));
    list.setAttribute("aria-activedescendant", items[at]?.id ?? "");
    (items[at] as HTMLElement & { scrollIntoView?: (o: object) => void })?.scrollIntoView?.({ block: "nearest" });
  };
  // U69: floating, the list follows its row on scroll and resize (follow); a row gone (the cards drawn again) closes it.
  const place = () => {
    const q = placePopup(host.getBoundingClientRect(), viewport());
    list.style.left = `${q.left}px`;
    list.style.width = `${q.width}px`;
    list.style.maxHeight = `${q.maxHeight}px`;
    list.style.top = q.top !== undefined ? `${q.top}px` : "auto";
    list.style.bottom = q.bottom !== undefined ? `${q.bottom}px` : "auto";
  };
  const follow = () => (b.isConnected ? place() : handle.close(false));
  const inside = (t: Node) => (p.float ? list.contains(t) || b.contains(t) : host.contains(t));
  const outside = (e: Event) => {
    if (!inside(e.target as Node)) handle.close(false);
  };
  const handle = {
    close(refocus: boolean) {
      list.remove();
      b.setAttribute("aria-expanded", "false");
      b.removeAttribute("aria-controls");
      document.removeEventListener?.("pointerdown", outside, true);
      if (p.float) {
        window.removeEventListener?.("scroll", follow, true);
        window.removeEventListener?.("resize", follow);
      }
      if (openOne === handle) openOne = null;
      if (refocus) b.focus();
    },
  };
  const choose = (k: number) => {
    if (opts[k]?.disabled) return;
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
    // Tab: the focus goes back to the button first, so it moves on from the row (the floating list is out of the page's order)
    else if (e.key === "Tab") return handle.close(p.float === true);
    else return;
    e.preventDefault();
    e.stopPropagation?.();
  });
  if (p.float) {
    document.body.append(list);
    place();
    window.addEventListener?.("scroll", follow, true);
    window.addEventListener?.("resize", follow);
  } else host.append(list);
  b.setAttribute("aria-expanded", "true");
  b.setAttribute("aria-controls", id);
  openOne = handle;
  document.addEventListener("pointerdown", outside, true);
  mark();
  list.focus();
  return list;
}
