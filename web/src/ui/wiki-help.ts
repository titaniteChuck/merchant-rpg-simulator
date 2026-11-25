/**
 * The wiki's "?" help (U24): a small round button next to a section title whose text shows in a popover on hover and
 * on keyboard focus (also on a tap; a second tap, Escape, or Enter on the focused "?" closes it). The text stays in the page as the button's accessible
 * description (aria-describedby → a hidden element), so screen readers get it without opening anything.
 * The explanations that used to sit under the titles live here now; the page itself keeps the data.
 * U30: a "?" can end with links to the Stats / Battle reference sections (`refs`: "How it's calculated →" for one
 * link, the topic names for several); the popover then stays open while the pointer is over it, so its links can be
 * clicked, and Tab from the button reaches them.
 * CSS: `.help-q`, `.help-pop` in the `wiki v5` block of site/style.css; `.help-more` in `wiki cross-links`.
 */
import { el } from "./dom.ts";

let seq = 0;
let open: { btn: HTMLElement; pop: HTMLElement } | null = null;
let closing: ReturnType<typeof setTimeout> | undefined;

function close(): void {
  clearTimeout(closing);
  if (!open) return;
  open.pop.hidden = true;
  open.btn.setAttribute("aria-expanded", "false");
  open = null;
}

function show(btn: HTMLElement, pop: HTMLElement): void {
  clearTimeout(closing);
  if (open?.pop === pop) return;
  if (open && open.pop !== pop) close();
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  open = { btn, pop };
  // Fixed, next to the button, kept inside the viewport (a fixed box never widens the page).
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const w = Math.min(320, vw - 16);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8))}px`;
  const h = pop.offsetHeight;
  pop.style.top = `${r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6}px`;
}

/**
 * The closing line of a "?" with links to the reference pages: one link reads "How it's calculated →" (Stats) or
 * "How it works →" (Battle); several keep their own labels ("Hit chance → · Defence reduction →").
 */
function moreLine(refs: HTMLAnchorElement[]): HTMLElement {
  if (refs.length === 1) refs[0].textContent = refs[0].getAttribute("href")?.includes("#/battle/") ? "How it works →" : "How it's calculated →";
  else for (const a of refs) a.append(" →");
  return el("span", { class: "help-p help-more" }, ...refs.flatMap((a, i) => (i ? [" · ", a] : [a])));
}

/** A "?" text: a paragraph, or several; R2-D: a paragraph can be a node (the ascension boxes of a price legend). */
export type HelpText = string | Node | (string | Node)[];

/**
 * A "?" button explaining `text` (a paragraph, or several as an array). `about` names what it explains, for the
 * button's label ("About Stats"). `refs`: links to Stats / Battle sections (statLink, battleLink) on a last line.
 */
export function helpTip(text: HelpText, about = "this section", refs: HTMLAnchorElement[] = []): HTMLElement {
  const id = `help-${++seq}`;
  const paras = Array.isArray(text) ? text : [text];
  const pop = el("span", { class: "help-pop", id, ...(refs.length ? {} : { role: "tooltip" }) },
    ...paras.map((p) => el("span", { class: "help-p" }, p)), ...(refs.length ? [moreLine(refs)] : []));
  pop.hidden = true;
  const btn = el("button", { type: "button", class: "help-q", "aria-label": `About ${about}`, "aria-describedby": id, "aria-expanded": "false" }, "?");
  const inside = (n: EventTarget | null) => n instanceof Node && (n === btn || pop.contains(n));
  // the mouse leaving the button or the popover: close a moment later, unless it went over the other one
  const later = (e: Event) => {
    if ((e as PointerEvent).pointerType !== "mouse" || inside(document.activeElement)) return;
    clearTimeout(closing);
    closing = setTimeout(() => open?.pop === pop && close(), 250);
  };
  // A touch's pointerenter comes before its pointerdown: showing there would make a second tap look like a first one.
  btn.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && show(btn, pop));
  btn.addEventListener("pointerleave", later);
  pop.addEventListener("pointerenter", () => clearTimeout(closing));
  pop.addEventListener("pointerleave", later);
  // a click on a link keeps the focus where it is (no blur closing the popover before the click lands)
  pop.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("focus", () => show(btn, pop));
  btn.addEventListener("blur", (e) => !inside(e.relatedTarget) && close());
  pop.addEventListener("focusout", (e) => !inside(e.relatedTarget) && close());
  // QA R2: a second tap (or Enter / Space) on the "?" closes its popover. Whether it was open is read on pointerdown,
  // before the focus a tap gives the button shows it; a mouse click keeps it open (hover already showed it).
  let tap: { open: boolean } | null = null;
  btn.addEventListener("pointerdown", (e) => {
    tap = e.pointerType === "mouse" ? null : { open: open?.pop === pop };
  });
  btn.addEventListener("click", (e) => {
    const t = tap;
    tap = null;
    if (t) return void (t.open ? close() : show(btn, pop));
    if (e.detail === 0) return void (open?.pop === pop ? close() : show(btn, pop)); // the keyboard
    if (open?.pop === pop && document.activeElement !== btn) close();
    else show(btn, pop);
  });
  return el("span", { class: "help-tip" }, btn, pop);
}

/** Puts a "?" with `text` at the end of `heading` (a section banner) and returns the heading. */
export function withHelp<T extends HTMLElement>(heading: T, text: HelpText, about = heading.textContent ?? "this section",
  refs: HTMLAnchorElement[] = []): T {
  heading.append(" ", helpTip(text, about.trim() || "this section", refs));
  return heading;
}

/** Same, on the first heading of a section element built by the wiki's section(). */
export function sectionHelp<T extends HTMLElement>(section: T, text: HelpText, refs: HTMLAnchorElement[] = []): T {
  const h = section.querySelector<HTMLElement>("h2, h3, h4");
  if (h) withHelp(h, text, undefined, refs);
  return section;
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  // A scroll closes a hover popover, but one whose "?" (or content) has keyboard focus is re-placed instead:
  // Tab to an off-screen "?" scrolls the page to it, and closing there would make it never show (QA, 2026-11-25).
  document.addEventListener("scroll", () => {
    const o = open;
    const a = document.activeElement;
    if (o && a instanceof Node && (a === o.btn || o.pop.contains(a))) { close(); show(o.btn, o.pop); }
    else close();
  }, { passive: true });
  window.addEventListener("hashchange", close);
}
