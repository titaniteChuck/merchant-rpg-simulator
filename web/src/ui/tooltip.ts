/**
 * One floating tooltip for the whole page. `tip(el, content)` shows `content` next to `el` on hover and on
 * keyboard focus. Tooltips only repeat or summarise what the page or the linked page shows; they never
 * hold the only copy of a value.
 */
let box: HTMLElement | null = null;
let owner: Element | null = null;

function ensureBox(): HTMLElement {
  if (!box) {
    box = document.createElement("div");
    box.className = "tip";
    box.setAttribute("role", "tooltip");
    box.id = "tip";
    box.hidden = true;
    document.body.append(box);
  }
  return box;
}

function place(target: Element): void {
  const b = ensureBox();
  const r = target.getBoundingClientRect();
  const w = b.offsetWidth, h = b.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(x, document.documentElement.clientWidth - w - 8));
  let y = r.top - h - 8;
  if (y < 8) y = r.bottom + 8;
  b.style.left = `${x + window.scrollX}px`;
  b.style.top = `${y + window.scrollY}px`;
}

export function hideTip(): void {
  if (box) box.hidden = true;
  owner?.removeAttribute("aria-describedby");
  owner = null;
}

/** Show `content()` (built lazily) when `el` is hovered or focused. */
export function tip(el: Element, content: () => Node | string): void {
  const show = () => {
    const b = ensureBox();
    const c = content();
    if (c === "" || c === null) return;
    b.replaceChildren(c);
    b.hidden = false;
    owner = el;
    el.setAttribute("aria-describedby", "tip");
    place(el);
  };
  el.addEventListener("pointerenter", show);
  el.addEventListener("focus", show);
  // Only the element that owns the tooltip hides it: a layout shift (e.g. a scroller bringing a focused term into
  // view) can fire pointerleave on another element under a resting pointer (QA, 2026-11-25).
  const hideOwn = () => { if (owner === el) hideTip(); };
  el.addEventListener("pointerleave", hideOwn);
  el.addEventListener("blur", hideOwn);
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
  // A scroll hides a hover tooltip, but keeps one whose element has keyboard focus: Tab to an off-screen
  // element scrolls the page to it, and hiding there would make the tooltip never show (QA, 2026-11-25).
  document.addEventListener("scroll", () => {
    if (owner && owner === document.activeElement) place(owner);
    else hideTip();
  }, { passive: true, capture: true }); // capture: inner scrollers (the Flow's sideways frame) count too
  // An owner removed from the page (a route change re-renders it) never fires pointerleave or blur, so the
  // owner-only rule above would leave its tooltip on screen: hide it once the owner is disconnected (QA, 2026-11-25).
  const hideOrphan = () => { if (owner && !owner.isConnected) hideTip(); };
  document.addEventListener("pointerover", hideOrphan, { passive: true, capture: true });
  document.addEventListener("pointermove", hideOrphan, { passive: true, capture: true });
  document.addEventListener("focusin", hideOrphan, true);
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("hashchange", hideTip);
  window.addEventListener("popstate", hideTip);
}
