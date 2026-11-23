/**
 * The wiki's "?" help (U24): a small round button next to a section title whose text shows in a popover on hover and
 * on keyboard focus (also on a tap, Escape closes it). The text stays in the page as the button's accessible
 * description (aria-describedby → a hidden element), so screen readers get it without opening anything.
 * The explanations that used to sit under the titles live here now; the page itself keeps the data.
 * CSS: `.help-q`, `.help-pop` in the `wiki v5` block of site/style.css.
 */
import { el } from "./dom.ts";

let seq = 0;
let open: { btn: HTMLElement; pop: HTMLElement } | null = null;

function close(): void {
  if (!open) return;
  open.pop.hidden = true;
  open.btn.setAttribute("aria-expanded", "false");
  open = null;
}

function show(btn: HTMLElement, pop: HTMLElement): void {
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
 * A "?" button explaining `text` (a paragraph, or several as an array). `about` names what it explains, for the
 * button's label ("About Stats").
 */
export function helpTip(text: string | string[], about = "this section"): HTMLElement {
  const id = `help-${++seq}`;
  const paras = Array.isArray(text) ? text : [text];
  const pop = el("span", { class: "help-pop", id, role: "tooltip" }, ...paras.map((p) => el("span", { class: "help-p" }, p)));
  pop.hidden = true;
  const btn = el("button", { type: "button", class: "help-q", "aria-label": `About ${about}`, "aria-describedby": id, "aria-expanded": "false" }, "?");
  btn.addEventListener("pointerenter", () => show(btn, pop));
  btn.addEventListener("pointerleave", (e) => {
    if ((e as PointerEvent).pointerType === "mouse" && document.activeElement !== btn) close();
  });
  btn.addEventListener("focus", () => show(btn, pop));
  btn.addEventListener("blur", close);
  btn.addEventListener("click", () => (open?.pop === pop && document.activeElement !== btn ? close() : show(btn, pop)));
  return el("span", { class: "help-tip" }, btn, pop);
}

/** Puts a "?" with `text` at the end of `heading` (a section banner) and returns the heading. */
export function withHelp<T extends HTMLElement>(heading: T, text: string | string[], about = heading.textContent ?? "this section"): T {
  heading.append(" ", helpTip(text, about.trim() || "this section"));
  return heading;
}

/** Same, on the first heading of a section element built by the wiki's section(). */
export function sectionHelp<T extends HTMLElement>(section: T, text: string | string[]): T {
  const h = section.querySelector<HTMLElement>("h2, h3, h4");
  if (h) withHelp(h, text);
  return section;
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  document.addEventListener("scroll", close, { passive: true });
  window.addEventListener("hashchange", close);
}
