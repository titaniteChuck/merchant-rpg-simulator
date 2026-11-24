/**
 * The home page's live parts (R2-A, review R2 F03 and F05), mounted by nav.ts (the home page has no script of its own;
 * a page without these elements is left alone):
 *
 * - "Older tools (4)": a `<details>` (site/index.html), closed on phones and open on wider screens; the sentence that
 *   used to sit under its heading ("Older tools, kept as they are …") is its "?" (wiki-help.ts helpTip).
 * - With a save kept in this browser (`<html class="has-save">`, set by theme.js before the first paint), one line of
 *   quick links under the lead (Heroes · Inventory · Simulator · Solver, static in the HTML, shown by style.css),
 *   labelled here with the save's file name.
 */
import { keptSave } from "./save-menu.ts";
import { helpTip } from "./wiki-help.ts";

/** The older tools' explanation, in the "?" of their section. */
export const OLDER_TOOLS_NOTE = "Older tools, kept as they are: no longer updated with the rest of the site.";

/** Phones: the older tools start closed. */
const PHONE = "(max-width: 760px)";

export function mountHome(): void {
  const older = document.querySelector<HTMLDetailsElement>("details.tools-other");
  if (older && !older.dataset.ready) {
    older.dataset.ready = "1";
    older.open = !matchMedia(PHONE).matches;
    const tip = helpTip(OLDER_TOOLS_NOTE, "the older tools");
    tip.addEventListener("click", (e) => e.preventDefault()); // the "?" opens its text, not the section
    (older.querySelector("summary h2") ?? older.querySelector("summary"))?.append(" ", tip);
  }
  const kept = keptSave();
  if (kept) document.querySelectorAll(".home-save-name").forEach((e) => (e.textContent = kept.name));
}
