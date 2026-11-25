/**
 * U48: the battle pages' layout maths, pure (no DOM), so Node tests check it.
 * - calcColumn (U51, was U48's calcPanelLeft): the grid column of a flow calculation's panel.
 * - toTopVisible: when the "↑" back-to-top button shows.
 * - turnBand (U51): the Flow's turn row before each turn.
 */

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
