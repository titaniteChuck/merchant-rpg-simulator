/**
 * U48: the Simulator's hero cards move by drag and drop, with Pointer Events (mouse, pen and touch alike).
 *
 * - A filled card (`[data-drag]`, its slot in `data-slot`) is picked up from anywhere on it but its form controls
 *   (pickers, include tick), which keep their clicks. Empty slots have no `data-drag`: they are only targets.
 * - Mouse and pen: the drag starts once the pointer moved DRAG_MOVE px with the button down; a plain click stays a click.
 * - Touch: the page keeps scrolling (no `touch-action: none` on the cards). The drag starts only after the finger rested
 *   DRAG_HOLD ms within DRAG_SLOP px; moving sooner is a scroll (the browser then cancels the pointer). Once the drag
 *   is on, the container's non-passive touchmove listener stops the page scrolling under the finger, and the page
 *   scrolls itself when the finger nears the top or bottom edge (EDGE).
 * - The card follows the pointer; the slot under it is marked `.drop-over`. Releasing over another slot calls `onDrop`
 *   (the page swaps or moves, battle-edit.ts moveHero); elsewhere, or Escape, puts it back. The click a drag ends with
 *   is swallowed, so a link under the pointer doesn't open.
 * Keyboard and screen-reader users keep the card's hero picker (the same move by choice); the drag adds nothing they lack.
 */
export const DRAG_MOVE = 6;
export const DRAG_HOLD = 350;
export const DRAG_SLOP = 10;
const EDGE = 56;

interface Drag {
  id: number;
  card: HTMLElement;
  from: string;
  touch: boolean;
  x0: number;
  y0: number;
  sy0: number;
  x: number;
  y: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  over: HTMLElement | null;
  raf: number;
}

/** Wire drag and drop on the slots inside `box` (once: the cards are redrawn inside it, the listeners stay). */
export function enableSlotDrag(box: HTMLElement, onDrop: (from: string, to: string) => void): void {
  let d: Drag | null = null;

  const slotAt = (x: number, y: number): HTMLElement | null => {
    for (const e of document.elementsFromPoint(x, y)) {
      if (d && d.card.contains(e)) continue;
      const s = e.closest<HTMLElement>("[data-slot]");
      return s && box.contains(s) ? s : null;
    }
    return null;
  };
  const mark = (s: HTMLElement | null) => {
    if (!d || s === d.over) return;
    d.over?.classList.remove("drop-over");
    d.over = s && s !== d.card ? s : null;
    d.over?.classList.add("drop-over");
  };
  const place = () => {
    if (!d) return;
    d.card.style.setProperty("--dx", `${d.x - d.x0}px`);
    d.card.style.setProperty("--dy", `${d.y - d.y0 + (scrollY - d.sy0)}px`);
    mark(slotAt(d.x, d.y));
  };
  // Near the window's top or bottom edge, the page scrolls (faster the closer), and the card keeps under the pointer.
  const speed = (y: number) => (y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > innerHeight - EDGE ? Math.ceil((y - innerHeight + EDGE) / 4) : 0);
  const step = () => {
    if (!d) return;
    const v = speed(d.y);
    if (!v) {
      d.raf = 0;
      return;
    }
    scrollBy(0, v);
    place();
    d.raf = requestAnimationFrame(step);
  };
  const start = () => {
    if (!d) return;
    d.active = true;
    d.timer = null;
    // The rest of this pointer's events come here even when it leaves the window (a mouse let go outside it).
    try {
      d.card.setPointerCapture(d.id);
    } catch { /* the pointer is already gone: its pointerup or pointercancel ends the drag */ }
    d.card.classList.add("dragging");
    box.classList.add("drag-on");
    place();
  };
  const end = () => {
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (d.raf) cancelAnimationFrame(d.raf);
    d.over?.classList.remove("drop-over");
    d.card.classList.remove("dragging");
    d.card.style.removeProperty("--dx");
    d.card.style.removeProperty("--dy");
    box.classList.remove("drag-on");
    d = null;
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", end);
    removeEventListener("keydown", key, true);
  };
  const move = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      const dist = Math.hypot(d.x - d.x0, d.y - d.y0);
      if (d.touch) {
        if (dist > DRAG_SLOP) end(); // a scroll, not a drag
      } else if (dist >= DRAG_MOVE) start();
      return;
    }
    place();
    if (!d.raf && speed(d.y)) d.raf = requestAnimationFrame(step);
  };
  const up = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    if (!d.active) return end();
    const from = d.from, to = d.over?.dataset.slot;
    end();
    // The click this release makes (on a link or a button under the pointer) is not a click.
    const swallow = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
    if (to && to !== from) onDrop(from, to);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && d?.active) {
      e.preventDefault();
      end();
    }
  };

  box.addEventListener("pointerdown", (e) => {
    if (d || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const t = e.target as Element;
    const card = t.closest<HTMLElement>("[data-drag][data-slot]");
    if (!card || !box.contains(card) || t.closest("select, input, textarea, label.include")) return;
    const touch = e.pointerType === "touch";
    d = { id: e.pointerId, card, from: card.dataset.slot!, touch, x0: e.clientX, y0: e.clientY, sy0: scrollY, x: e.clientX, y: e.clientY,
      active: false, timer: null, over: null, raf: 0 };
    if (touch) d.timer = setTimeout(start, DRAG_HOLD);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", end);
    addEventListener("keydown", key, true);
  });
  // Once a touch drag is on, the finger moves the card, not the page (cancelable: the hold kept the browser from panning).
  box.addEventListener("touchmove", (e) => {
    if (d?.active && e.cancelable) e.preventDefault();
  }, { passive: false });
  // A long press opens no menu or link preview while it picks a card up; links and images start no native drag.
  box.addEventListener("contextmenu", (e) => {
    if (d) e.preventDefault();
  });
  box.addEventListener("dragstart", (e) => {
    if ((e.target as Element | null)?.closest?.("[data-drag]")) e.preventDefault();
  });
}
