/**
 * U48: the battle pages' layout maths, pure (no DOM), so Node tests check it.
 * - toTopVisible: when the "↑" back-to-top button shows.
 * - roomBarWheel, scrollToShow (U63, the map room bar's; U66 on, the chart's): the mouse wheel and an item kept in view.
 * - PARTY_COLUMNS (U69): the Party view's hero columns, in formation order.
 * U70: calcColumn, turnBand and rowStep went with Flow 2, Flow 3 and the room bar.
 */

/**
 * U69: the Party view's two hero columns, left to right: the back row, then the front row (nearest the enemy). Every
 * width keeps them (a phone too: two cards per row, the back row's in the first column, the front row's in the second).
 */
export const PARTY_COLUMNS = ["back", "front"] as const;

/** The "↑" button shows once the page is scrolled down by more than one screen (at least 400 px). */
export const toTopVisible = (scrollY: number, viewport: number): boolean => scrollY > Math.max(400, viewport);

/** U63: the sizes a sideways row's wheel and buttons read (an element's own fields, so tests pass plain objects). */
export interface RowBox {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * U63: a mouse wheel over the map's room bar. A vertical wheel moves the bar sideways: the result is how far (px, the
 * caller adds it to scrollLeft and cancels the event). 0 leaves the event to the browser: a bar that fits, a sideways
 * wheel or a touchpad's sideways swipe (the browser scrolls it itself), and a bar already at the end the wheel pushes
 * to, so the page scrolls on past it. `deltaMode` 1 counts lines (`line` px each), 2 pages (the bar's width).
 */
export function roomBarWheel(e: { deltaX: number; deltaY: number; deltaMode?: number }, row: RowBox, line = 40): number {
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return 0;
  const d = e.deltaY * (e.deltaMode === 1 ? line : e.deltaMode === 2 ? row.clientWidth : 1);
  const to = Math.max(0, Math.min(max, row.scrollLeft + d));
  return Math.abs(to - row.scrollLeft) < 0.5 ? 0 : to - row.scrollLeft;
}

/**
 * U63: the scrollLeft that brings an item (its left edge and width inside the row's content) into view, `pad` px clear
 * of each edge (the edge fade and its ‹ › button); null when it is in view already. An item wider than the room left
 * is aligned on its left edge.
 */
export function scrollToShow(row: RowBox, left: number, width: number, pad = 0): number | null {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const from = row.scrollLeft + pad, to = row.scrollLeft + row.clientWidth - pad;
  if (left >= from && left + width <= to) return null;
  const want = left < from || width > row.clientWidth - 2 * pad ? left - pad : left + width + pad - row.clientWidth;
  const v = Math.max(0, Math.min(max, want));
  return Math.abs(v - row.scrollLeft) < 0.5 ? null : v;
}
