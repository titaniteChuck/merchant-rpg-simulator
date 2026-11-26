/**
 * U78: on the hero page, the radar floats at the bottom right as a small preview once its own place has scrolled out
 * of view above (style.css .hero-radar-slot.floating: fixed, min(28vw, 220px) wide; on a phone min(36vw, 136px), and
 * taps go through it, so it never blocks a control under it). Its slot keeps its height meanwhile (no jump). The stat
 * grid above it is sticky by CSS alone. Only while the radar is open (its <details>).
 */

/** Whether the radar floats: its slot entirely above the viewport (scrolled past), and the radar open. */
export const shouldFloat = (slotBottom: number, open: boolean): boolean => open && slotBottom <= 0;

let stop: (() => void) | null = null;

/** Watch the page's radar slot (one at a time: a redraw replaces the last watch). */
export function floatRadar(slot: HTMLElement, details: HTMLDetailsElement | null): void {
  stop?.();
  stop = null;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const update = () => {
    if (!slot.isConnected) return void stop?.();
    const floating = slot.classList.contains("floating");
    const box = slot.getBoundingClientRect();
    const on = shouldFloat(box.bottom, Boolean(details?.open ?? true));
    if (on === floating) return;
    if (on) slot.style.minHeight = `${Math.round(box.height)}px`;
    else slot.style.minHeight = "";
    slot.classList.toggle("floating", on);
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  details?.addEventListener("toggle", onScroll);
  stop = () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    details?.removeEventListener("toggle", onScroll);
  };
  update();
}
