/**
 * U48: the battle pages' layout maths, pure (no DOM), so Node tests check it.
 * - calcColumn (U51, was U48's calcPanelLeft): the grid column of a flow calculation's panel.
 * - toTopVisible: when the "↑" back-to-top button shows.
 * - turnBand (U51): the Flow's turn row before each turn.
 * - roomBarWheel, rowStep, scrollToShow (U63): the map room bar's mouse wheel, ‹ › buttons and selected room in view.
 * - PARTY_COLUMNS (U69): the Party view's hero columns, in formation order.
 */

/**
 * U69: the Party view's two hero columns, left to right: the back row, then the front row (nearest the enemy). Every
 * width keeps them (a phone too: two cards per row, the back row's in the first column, the front row's in the second).
 */
export const PARTY_COLUMNS = ["back", "front"] as const;

/**
 * U51: the grid column (1-based, CSS `grid-column`) of a calculation panel under a flow line. `order` is column × 2,
 * +1 for a heal (timeline.ts takenEl); the panels' box shares the line's columns (`repeat(cols, minmax(0, 1fr))`, gap
 * 3px), so the panel is exactly its column's width. Clamped to the columns there are.
 */
export function calcColumn(order: number, cols: number): number {
  const n = Math.max(1, Math.trunc(cols) || 1);
  return Math.max(0, Math.min(n - 1, Math.floor(order / 2) || 0)) + 1;
}

/** The "↑" button shows once the page is scrolled down by more than one screen (at least 400 px). */
export const toTopVisible = (scrollY: number, viewport: number): boolean => scrollY > Math.max(400, viewport);

/**
 * U51: the Flow's turn band, a full-width row before each turn (no "Turn" column any more): "Turn 3"; a turn that
 * starts a new 5-turn round (6, 11, …) also says the rotations start again (it replaces the old round divider).
 */
export function turnBand(turn: number): { label: string; again: boolean } {
  return { label: `Turn ${turn}`, again: turn > 5 && (turn - 1) % 5 === 0 };
}

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

/** U63: the room bar's ‹ › buttons: most of the bar's width per click, left (−1) or right (+1). */
export const rowStep = (row: RowBox, dir: -1 | 1): number => dir * Math.max(60, Math.round(row.clientWidth * 0.75));

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
