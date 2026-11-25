/**
 * U63: the parts the Flow layouts share (Flow 2, flow2.ts; Flow 3, flow3.ts; the planned rotation, flow-planned.ts),
 * moved out of timeline.ts when Flow 1 (its `partyPlan` / `flowChart`) was removed:
 * - the edit callbacks (PlanEdit) and their controls: a hero's or the opponent's name with its picker (nameEdit), a
 *   rotation slot's skill name (slotSkill, U64: the Party view's in-place picker);
 * - a skill's name as plain text with its effect on hover (skillText; U64: no wiki link in the Flows);
 * - an action line's pieces: the actor's skill (actorEl), a number's "▾ calculation" (calcToggle, calcPanel), the turn
 *   band (turnRow) and the rotation turns a short fight never reached (unreachedRows);
 * - fmtInt and FLOW_PAGE.
 * Every skill name shown goes through names.ts (the language picker).
 */
import { type HeroCell, locationLabel, type PlanColumn, type TimelineLine } from "./battle-plan.ts";
import { type CalcTerm, calcView } from "./battle-calc.ts";
import type { TraceCalc } from "../sim/api.ts";
import { el } from "./dom.ts";
import { calcColumn, turnBand } from "./battle-layout.ts";
import { tip } from "./tooltip.ts";
import { skillTip } from "./wiki-data.ts";
import { pickButton, type PickOption } from "./pick-list.ts";
import { skillName } from "./names.ts";

export const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Past this many turns the rest of a fight waits behind a button (a 200-turn stalemate is thousands of lines). */
export const FLOW_PAGE = 100;

/**
 * U39: the Flow edits the party in place. Both views of the battle page change one party state through these
 * (battle-page.ts, battle-edit.ts), then draw again and simulate again.
 */
export interface PlanEdit {
  /** The hero choices for a party location ([value, label]) and its current value. */
  heroes(loc: number): { options: [string, string][]; value: string };
  setHero(loc: number, value: string): void;
  /**
   * U64: the skills the hero at a location can play in its rotation (the Party view's picker choices: name, AP,
   * effect; `current` listed even when not unlocked), or null.
   */
  skills(loc: number, current: string): PickOption[] | null;
  /** Rotation slot k (0-4) of the hero at a location. */
  setSkill(loc: number, k: number, skill: string): void;
  /**
   * U40: the opponent choices (the Party tab's: a quest enemy, its rare variant; or a map for a map run), grouped, and
   * the current value; null when it can't be changed there.
   */
  enemies?(): { label: string; groups: OptionGroups; value: string } | null;
  setEnemy?(value: string): void;
}
/** Options, flat ([value, label]) or in groups ([group label, options]). */
export type OptionGroups = [string, [string, string][]][];

/** A <select> with these options, flat or grouped. */
function selectEl(label: string, options: [string, string][] | OptionGroups, value: string, onChange: (v: string) => void): HTMLSelectElement {
  const grouped = options.length > 0 && Array.isArray(options[0][1]);
  const opt = ([v, l]: [string, string]) => el("option", { value: v }, l);
  const s = el("select", { "aria-label": label, class: "fl-select" }, ...(grouped
    ? (options as OptionGroups).map(([g, list]) => el("optgroup", { label: g }, ...list.map(opt)))
    : (options as [string, string][]).map(opt))) as HTMLSelectElement;
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/**
 * A name with a ▾ (U40): the transparent <select> covers the name and the ▾, so clicking the name opens the choices
 * (Flow 2's turn-1 cards, the planned rotation's heads).
 */
export function nameEdit(name: Node | string, label: string, options: [string, string][] | OptionGroups, value: string, focus: string,
  onChange: (v: string) => void): HTMLElement {
  return el("span", { class: "fl-name", title: label, "data-flow-focus": focus }, el("strong", {}, name),
    el("span", { class: "fl-caret", "aria-hidden": "true" }, "▾"), selectEl(label, options, value, onChange));
}

/** A skill's name as plain text, its effect on hover (U64: the Flows don't link to the wiki). */
export function skillText(name: string): HTMLElement {
  const s = el("span", {}, skillName(name));
  return name === "Basic" ? s : skillTip(s, name);
}

/**
 * U64: a hero's rotation slot (turns 1-5) with `edit`: the skill's name is a button opening the Party view's picker
 * in place (pick-list.ts: each choice's name, AP and effect), the list appended to `host`; else plain text.
 */
export function slotSkill(skill: string, host: () => HTMLElement, edit: PlanEdit | undefined, loc: number, turn: number): HTMLElement {
  const opts = edit && turn <= 5 ? edit.skills(loc, skill) : null;
  if (!opts) return skillText(skill);
  const b = pickButton({ label: `${locationLabel(loc)}: turn ${turn} skill`, text: skillName(skill), value: skill, options: () => opts,
    onPick: (v) => edit!.setSkill(loc, turn - 1, v), focus: `skill-${loc}-${turn}`, host });
  return skill === "Basic" ? b : skillTip(b, skill);
}

/**
 * The actor's cell: the skill it played (the planned one struck out under a stun or a forced action). `planned`: the
 * planned skill's node (a hero's slotSkill), else plain text.
 */
export function actorEl(l: TimelineLine, planned: HTMLElement = skillText(l.planned)): HTMLElement[] {
  if (l.did === null) return [el("span", { class: "tc-skill tc-down", title: "Down: no action" }, "down")];
  const played = l.did === false ? null : l.did;
  const skill = played === l.planned
    ? el("span", { class: "tc-skill" }, planned)
    : el("span", { class: "tc-skill" }, el("s", { class: "tl-planned", title: `Planned: ${skillName(l.planned)}` }, planned), " ",
      played === null ? el("span", { class: "tl-forced", title: "Stunned: the action is lost" }, "stun")
        : el("span", { class: "tl-forced", title: "Forced: another action than the planned one" }, skillText(played)));
  return [skill, ...(l.misses ? [el("span", { class: "tc-miss", title: `${l.misses} attack${l.misses > 1 ? "s" : ""} missed` }, "miss")] : [])];
}

/**
 * One term of a formula: its operator, then its words; where it comes from in the shared tooltip (R3 QA: tip(), so it
 * shows on hover, keyboard focus and tap, and is announced through aria-describedby; a `title` only showed on hover).
 */
function termEl(t: CalcTerm): HTMLElement[] {
  const term = el("span", { class: `cf-term${t.kind ? ` cf-${t.kind}` : ""}`, tabindex: "0" }, t.text);
  tip(term, () => t.tip);
  return [...(t.op ? [el("span", { class: "cf-op", "aria-hidden": t.op === "=" ? "false" : "true" }, ` ${t.op} `)] : []), term];
}

/** The calculation of a fighter's damage or healing in one action (U40): one block per hit or heal, then their sum. */
export function calcPanel(calc: TraceCalc[], kind: "dmg" | "heal", nameOf: (w: number) => string, shown: number): HTMLElement {
  const views = calc.filter((c) => c.kind === kind && !(c.kind === "dmg" && c.missed)).map((c) => calcView(c, nameOf));
  const blocks = views.map((v) => el("div", { class: `cf-block${v.void ? " void" : ""}` }, el("div", { class: "cf-head" }, v.head),
    ...v.lines.map((l) => el("div", { class: "cf-line" }, ...(v.lines.length > 1 || l.label !== "Heal" ? [el("span", { class: "cf-label" }, `${l.label}: `)] : []),
      ...l.terms.flatMap(termEl))),
    ...v.notes.map((n) => el("div", { class: "cf-note" }, n))));
  const counted = views.filter((v) => !v.void);
  const sum = counted.length > 1
    ? [el("div", { class: "cf-sum" }, `${kind === "dmg" ? "Damage" : "Healing"} this action: ${counted.map((v) => fmtInt.format(v.shown)).join(" + ")} = ${fmtInt.format(shown)}`)]
    : [];
  // a cell of the action's calculation row (`tc-calcs`, role row; a11y review F01: a table row holds cells only)
  return el("div", { class: `tc-calc ${kind}`, role: "cell" }, ...blocks, ...sum);
}

/**
 * A number's "▾ calculation" toggle (U40): it opens the calculation under the action's line (in `box`, in column
 * order), and turns to "▸"; clicking again closes it. U51: `box` is a grid with the line's columns (style.css), and the
 * panel takes its column (battle-layout.ts calcColumn): exactly the column's width, its text wrapping inside; panels
 * of other columns sit side by side, a second one in the same column (damage and healing) under the first.
 */
export function calcToggle(open: () => HTMLElement, box: HTMLElement, order: number, what: string): HTMLElement {
  // U48: the word goes on a phone (CSS), the ▾ stays; the button's name stays "calculation".
  const btn = el("button", { type: "button", class: "tc-calc-btn", "aria-expanded": "false" }, el("span", { class: "tc-caret", "aria-hidden": "true" }, "▾"),
    el("span", { class: "tc-calc-word" }, " calculation"));
  tip(btn, () => `How ${what} was worked out`);
  let panel: HTMLElement | null = null;
  btn.addEventListener("click", () => {
    if (panel) {
      panel.remove();
      panel = null;
      btn.firstElementChild!.textContent = "▾";
      btn.setAttribute("aria-expanded", "false");
    } else {
      panel = open();
      panel.dataset.order = String(order);
      panel.style.gridColumn = String(calcColumn(order, Number(box.dataset.cols) || 1));
      const after = [...box.children].find((x) => Number((x as HTMLElement).dataset.order) > order);
      box.insertBefore(panel, after ?? null);
      btn.firstElementChild!.textContent = "▸";
      btn.setAttribute("aria-expanded", "true");
    }
    box.hidden = box.children.length === 0;
  });
  return btn;
}

/**
 * U51: the full-width band before a turn ("Turn 3"), in place of a "Turn" column: a row whose one header spans every
 * column (aria-colspan). A turn starting a new 5-turn round says the rotations start again (the old round divider).
 */
export function turnRow(turn: number, cols: number): HTMLElement {
  const b = turnBand(turn);
  return el("div", { class: "tc-turnrow", role: "row" }, el("div", { class: "tc-turnhead", role: "rowheader", "aria-colspan": String(cols) },
    b.label, ...(b.again ? [el("span", { class: "tc-again" }, " · ↻ rotations again")] : [])));
}

/**
 * R3 QA: the rotation turns (1-5) the fight never reached (it ended sooner), one compact muted row each, "planned, not
 * reached": each hero's planned skill, its picker with `edit` (the same PlanEdit, so the same party state and AP
 * limit refusal as the reached turns). Nothing when every rotation turn was played.
 */
export function unreachedRows(cols: PlanColumn[], reached: Set<number>, edit?: PlanEdit): HTMLElement[] {
  const turns = [1, 2, 3, 4, 5].filter((t) => !reached.has(t));
  if (!turns.length) return [];
  return [el("div", { class: "pg-cycle tc-unreached-head", role: "row" }, el("span", { role: "cell" }, "Planned, not reached")),
    ...turns.map((t) => el("div", { class: "tc-turn tc-unreached", role: "rowgroup", "aria-label": `Turn ${t}: planned, not reached` },
      turnRow(t, cols.length),
      el("div", { class: "tc-lines" }, el("div", { class: "tc-line", role: "row" }, ...cols.map((c) => {
        if (c.kind !== "hero") return el("div", { class: "tc-cell", role: "cell" });
        const cell = el("div", { class: "tc-cell tc-planned", role: "cell" });
        cell.append(el("span", { class: "tc-skill" }, slotSkill((c.cells[t - 1] as HeroCell).planned, () => cell, edit, c.loc!, t)));
        return cell;
      })))))];
}
