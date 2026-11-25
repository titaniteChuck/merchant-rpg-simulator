/**
 * U48: the battle pages' layout maths, pure (no DOM), so Node tests check it.
 * - calcPanelLeft: a flow calculation's panel sits level with its column, clamped inside the chart.
 * - toTopVisible: when the "↑" back-to-top button shows.
 */

/**
 * The left offset (px) of a calculation panel under a flow line: the left edge of column `col` (0-based) of `cols`
 * equal columns `gap` px apart over `width` px (the CSS grid `repeat(n, minmax(0, 1fr))` with that gap), that is
 * col × (width + gap) / cols; clamped so a panel `panelWidth` px wide stays inside the width, and never below 0.
 */
export function calcPanelLeft(col: number, cols: number, width: number, panelWidth: number, gap = 3): number {
  if (!(cols > 0) || !(width > 0)) return 0;
  const k = Math.max(0, Math.min(cols - 1, Math.trunc(col) || 0));
  const left = (k * (width + gap)) / cols;
  return Math.floor(Math.max(0, Math.min(left, width - panelWidth)));
}

/** The "↑" button shows once the page is scrolled down by more than one screen (at least 400 px). */
export const toTopVisible = (scrollY: number, viewport: number): boolean => scrollY > Math.max(400, viewport);
