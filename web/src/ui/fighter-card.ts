/**
 * U62: the Party view's one card, for a hero and for the enemy (battle-page.ts), one CSS family (`.fc`, style.css U62).
 * Top to bottom:
 * - the head: the picker (the hero's or the enemy's <select>; read-only, the plain name), then the card's tools at
 *   the right (a hero's include box, the enemy's quest size);
 * - optional lines under it ("attacks first", a map room's name);
 * - U67: the stats, two per row, each "<name> <value> (<modifier>)": HP first, across both columns ("HP 1,234 /
 *   2,000"), then a hero's Atk Matk / Def Mdef / Acc Crit, the enemy's Atk Matk / Def Mdef / Acc Eva (statGrid). At
 *   the chart's selected turn the values are the engine's live ones (its effects applied) and the modifier is that
 *   stat's % sum (and an effect's flat points) then, its parts and the calculation on hover, focus or tap;
 * - U65 / U67: the effects at that turn that are no stat modifier (a stun, a taunt, a damage over time), inline (fxList);
 * - a hero's passive (with the rotation's AP total at its right), then the rotation: one row per turn 1-5, the skill
 *   and its AP. No turn numbers (the list is ordered) and no titles. A row with a picker is a button opening the
 *   choices with their effects in place (pick-list.ts); otherwise plain text. Both carry the effect on hover. U65: the
 *   row of the skill played at the selected turn is highlighted (`active`, aria-current); U67: the row of that turn
 *   says what came of it: 💫 when an effect took the action, else the damage per target ("!" a crit), "Miss", "+N" a
 *   heal (outcomeText).
 *
 * U65: paintCard puts another turn's state on a card in place (the pickers, an open list and the focus stay).
 * The text builders (statCell, modText, modTipLines, outcomeText) are pure, for the tests.
 */
import type { TimelineChip } from "./battle-plan.ts";
import { apBadge, el, fmt, fmtCompact, pct } from "./dom.ts";
import { pickButton, type PickOption } from "./pick-list.ts";
import { tip } from "./tooltip.ts";
import { pctFloor } from "../sim/stats.ts";

/** The engine's eight card stats (the enemy's stats as battle-setup.ts enemyStats gives them). */
export const CARD_STATS: [key: string, label: string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"],
  ["mdef", "Mdef"], ["acc", "Acc"], ["eva", "Eva"], ["crit", "Crit"]];
const pick = (keys: string[]) => keys.map((k) => CARD_STATS.find(([x]) => x === k)!);
/** U67: a card's stats in order: HP (across both columns), then two per row. No Eva on a hero card, no Crit on the enemy's. */
export const HERO_STATS = pick(["maxHP", "atk", "matk", "def", "mdef", "acc", "crit"]);
export const ENEMY_STATS = pick(["maxHP", "atk", "matk", "def", "mdef", "acc", "eva"]);
export const cardStats = (kind: "hero" | "enemy") => (kind === "hero" ? HERO_STATS : ENEMY_STATS);

// ---------------------------------------------------------------- U67: stat modifiers (pure text)
/** U67: one part of a stat's modifier, its source already named ("Might (passive)", "Holy Blessing from Ana, 2 turns left"). */
export interface ModPart {
  kind: "pct" | "flat" | "set";
  /** A share for "pct" (0.15 = +15%), points for "flat", 0 for "set". */
  value: number;
  label: string;
}
/** U67: a card's modifier parts, by stat key. */
export type StatMods = Record<string, ModPart[]>;

const MINUS = "−";
/** "+15%", "−12.5%" (a whole percent without decimals). */
export function signedPct(v: number): string {
  const p = Math.abs(v) * 100;
  return `${v < 0 ? MINUS : "+"}${pct(Math.abs(v), Math.abs(p - Math.round(p)) < 0.05 ? 0 : 1)}`;
}
const signedNum = (v: number) => `${v < 0 ? MINUS : "+"}${fmt.format(Math.abs(v))}`;

/** U67: a stat's modifier sums: the % sum as the engine uses it (floored), the raw sum, the flat points, a set. */
export function modSums(key: string, parts: ModPart[]): { pct: number; raw: number; floor: number; flat: number; set: boolean } {
  const raw = parts.filter((p) => p.kind === "pct").reduce((a, p) => a + p.value, 0);
  const floor = pctFloor[key] ?? -1;
  return { raw, floor, pct: raw ? Math.max(floor, raw) : 0, flat: parts.filter((p) => p.kind === "flat").reduce((a, p) => a + p.value, 0),
    set: parts.some((p) => p.kind === "set") };
}

/** U67: the modifier column's text: "+15%", "+15% +50", "+50", "set"; "" without one. */
export function modText(key: string, parts: ModPart[] | undefined): string {
  if (!parts?.length) return "";
  const s = modSums(key, parts);
  const bits = [...(Math.abs(s.pct) > 1e-9 ? [signedPct(s.pct)] : []), ...(Math.abs(s.flat) > 1e-9 ? [signedNum(s.flat)] : [])];
  return bits.length ? bits.join(" ") : s.set ? "set" : "";
}

/**
 * U67: one stat cell's three parts: "HP" "1,234 / 2,000" "(+10%)"; `full` the whole value when `value` is shortened;
 * HP from five digits also has a `short` form ("12.3K / 20K", what a hero card on a phone shows).
 */
export function statCell(key: string, label: string, stats: Record<string, number> | null, o: { hp?: number; mods?: StatMods } = {}):
  { name: string; value: string; full?: string; short?: string; mod: string } {
  if (!stats) return { name: label, value: "–", mod: "" };
  const v = Number(stats[key] ?? 0);
  const m = modText(key, o.mods?.[key]);
  const mod = m ? `(${m})` : "";
  if (key === "maxHP" && o.hp !== undefined) {
    const hp = Math.max(0, o.hp);
    return { name: label, value: `${fmt.format(hp)} / ${fmt.format(v)}`, mod,
      ...(v >= 10_000 ? { short: `${fmtCompact.format(hp)} / ${fmtCompact.format(v)}` } : {}) };
  }
  return Math.abs(v) >= 10_000 ? { name: label, value: fmtCompact.format(v), full: fmt.format(v), mod } : { name: label, value: fmt.format(v), mod };
}

/**
 * U67: a modifier's tooltip, line by line: the stat, each part with its source, then the calculation in the game's
 * order (statsService): stat = (base + flat parts) × (1 + sum of % parts), the sum floored.
 */
export function modTipLines(key: string, label: string, value: number, parts: ModPart[]): string[] {
  const name = key === "maxHP" ? "Max HP" : label;
  const lines = [`${name} ${fmt.format(value)}`];
  for (const p of parts) lines.push(`${p.label}: ${p.kind === "pct" ? signedPct(p.value) : p.kind === "flat" ? signedNum(p.value) : `sets ${name}`}`);
  const s = modSums(key, parts);
  const flat = Math.abs(s.flat) > 1e-9;
  if (Math.abs(s.raw) > 1e-9) {
    const mult = 1 + s.pct;
    const factor = `× (1 ${s.pct < 0 ? MINUS : "+"} ${pct(Math.abs(s.pct), Math.abs(s.pct * 100 - Math.round(s.pct * 100)) < 0.05 ? 0 : 1)})`;
    if (mult > 1e-9) {
      const base = value / mult - s.flat;
      const start = flat ? `(Base ${fmt.format(base)} ${s.flat < 0 ? MINUS : "+"} ${fmt.format(Math.abs(s.flat))})` : `Base ${fmt.format(base)}`;
      lines.push(`${start} ${factor} = ${fmt.format(value)}`);
    } else lines.push(`Base ${factor} = ${fmt.format(value)}`);
    if (s.raw < s.floor) lines.push(`% sum ${signedPct(s.raw)}, floored at ${signedPct(s.floor)}`);
  } else if (flat) lines.push(`Base ${fmt.format(value - s.flat)} ${s.flat < 0 ? MINUS : "+"} ${fmt.format(Math.abs(s.flat))} = ${fmt.format(value)}`);
  return lines;
}

const tipBox = (lines: string[]) => el("div", { class: "fc-tip" }, ...lines.map((l) => el("div", {}, l)));

/**
 * The stats as a <dl>: per stat a row of three cells (name, value, modifier; CSS lines them up two per row, HP across
 * both). Dashes without stats (an empty slot). From five digits a value is shortened ("12.3K"), the whole one in its
 * title. U67: a modifier is focusable, its parts and calculation in the tooltip (hover, focus, tap).
 */
export function statGrid(stats: Record<string, number> | null, kind: "hero" | "enemy" = "hero", o: { hp?: number; mods?: StatMods } = {}): HTMLElement {
  return el("dl", { class: "fc-stats" }, ...cardStats(kind).map(([k, label]) => {
    const c = statCell(k, label, stats, o);
    const parts = o.mods?.[k];
    const mod = el("dd", { class: "fc-mod" });
    if (c.mod && parts?.length && stats) {
      const m = el("span", { class: `fc-mod-btn ${c.mod.startsWith(`(${MINUS}`) ? "down" : "up"}`, tabindex: "0" }, c.mod);
      tip(m, () => tipBox(modTipLines(k, label, Number(stats[k] ?? 0), parts)));
      mod.append(m);
    }
    return el("div", { class: `fc-stat${k === "maxHP" ? " fc-stat-hp" : ""}` }, el("dt", {}, c.name),
      el("dd", { class: "fc-val", ...(c.full ? { title: `${label} ${c.full}` } : {}) },
        ...(c.short ? [el("span", { class: "v-full" }, c.value), el("span", { class: "v-short" }, c.short)] : [c.value])), mod);
  }));
}

// ---------------------------------------------------------------- U67: what the played skill did (pure text)
/** U67: one fighter the played skill aimed at, named. */
export interface OutcomeTarget {
  name: string;
  dmg: number;
  heal: number;
  hits: number;
  heals: number;
  miss: number;
  crit: number;
}
/** U67: what came of a fighter's action at the selected turn, on its rotation row `row` (0-4). */
export interface CardOutcome {
  row: number;
  /** An effect took the action (a stun, a freeze): its name. */
  lost?: string;
  targets: OutcomeTarget[];
}

const short = (n: number) => (Math.abs(n) >= 10_000 ? fmtCompact.format(n) : fmt.format(n));

/**
 * U67: the outcome's text on the row ("💫"; "1,234!" a crit; "Miss"; "+560" a heal; several targets "980 · Miss ·
 * 1,020"), its words for a screen reader and the tooltip's lines (one per target), and its tone. Null: nothing to say
 * (a buff, a skill without a target).
 */
export function outcomeText(o: CardOutcome): { text: string; label: string; lines: string[]; tone: "lost" | "miss" | "crit" | "heal" | "hit" } | null {
  if (o.lost !== undefined) {
    const label = `Action lost: ${o.lost}`;
    return { text: "💫", label, lines: [label], tone: "lost" };
  }
  const ts = o.targets.filter((t) => t.hits || t.heals || t.miss);
  if (!ts.length) return null;
  const pieces = ts.map((t) => {
    if (!t.hits && !t.heals) return "Miss";
    const bits = [...(t.hits ? [`${short(t.dmg)}${t.crit ? "!" : ""}`] : []), ...(t.heals ? [`+${short(t.heal)}`] : [])];
    return `${bits.join(" ")}${t.miss ? ` (${t.miss} miss${t.miss === 1 ? "" : "es"})` : ""}`;
  });
  const lines = ts.map((t) => `${t.name}: ${[
    ...(t.hits ? [`${fmt.format(t.dmg)} damage${t.crit ? t.hits > 1 ? ` (${t.crit} critical)` : " (critical)" : ""}`] : []),
    ...(t.heals ? [`+${fmt.format(t.heal)} HP`] : []),
    ...(t.miss ? [t.hits || t.heals || t.miss > 1 ? `${t.miss} missed` : "missed"] : []),
  ].join(", ")}`);
  const tone = ts.every((t) => !t.hits && !t.heals) ? "miss" : ts.some((t) => t.crit) ? "crit" : ts.every((t) => !t.hits) ? "heal" : "hit";
  return { text: pieces.join(" · "), label: lines.join("; "), lines, tone };
}

/** U67: the outcome on its row: focusable, the per-target lines in its tooltip. */
function outcomeEl(o: CardOutcome): HTMLElement | null {
  const t = outcomeText(o);
  if (!t) return null;
  const e = t.tone === "lost"
    ? el("span", { class: "fc-out lost", role: "img", "aria-label": t.label, tabindex: "0" }, t.text)
    : el("span", { class: `fc-out ${t.tone}`, tabindex: "0" }, el("span", { "aria-hidden": "true" }, t.text), el("span", { class: "visually-hidden" }, t.label));
  tip(e, () => tipBox(t.lines));
  return e;
}

// ---------------------------------------------------------------- rows
/** A passive or rotation row. */
export interface CardRow {
  /** The text shown ("—" for an empty slot). */
  text: string;
  /** The skill's AP (a badge); null: a greyed "–" badge; undefined: no AP cell (the passive). */
  ap?: number | null;
  /** The hover card (wiki-data skillTip / passiveTip) on the name. */
  tip?: (e: HTMLElement) => void;
  /** Editable: the name is a button opening these choices. */
  pick?: { label: string; value: string; options: () => PickOption[]; onPick: (v: string) => void; focus: string };
  /** Something at the row's right end (the passive row: the rotation's AP total). */
  end?: Node;
}

function rowEl(r: CardRow, cls: string): HTMLElement {
  const li = el("li", { class: `fc-row ${cls}` });
  const name = r.pick
    ? pickButton({ ...r.pick, text: r.text, host: () => li })
    : el("span", { class: `fc-skill${r.text === "—" ? " muted" : ""}` }, r.text);
  if (r.tip) r.tip(name);
  li.append(name);
  if (r.ap !== undefined) li.append(r.ap === null ? el("span", { class: "ap-badge off", "aria-hidden": "true" }, "–") : apBadge(r.ap));
  if (r.end) li.append(r.end);
  return li;
}

/**
 * U65: a fighter's buffs and debuffs at one turn, inline (green, red), each with its turns left ("·2") and its source
 * on hover (Flow 2's text, battle-plan.ts TimelineChip); null when it has none. U67: the page passes only the effects
 * that are no stat modifier (those are in the stats' modifiers).
 */
export function fxList(fx: TimelineChip[]): HTMLElement | null {
  if (!fx.length) return null;
  return el("ul", { class: "fc-fx", "aria-label": "Effects" }, ...fx.map((c) => el("li", { class: c.debuff ? "debuff" : "buff", title: c.title },
    el("span", { class: "visually-hidden" }, c.debuff ? "Debuff: " : "Buff: "), c.label,
    ...(c.turns !== undefined && c.turns > 0 ? [el("span", { class: "fc-fx-t", "aria-label": `, ${c.turns} turn${c.turns === 1 ? "" : "s"} left` }, `·${c.turns}`)] : []))));
}

/** U65: a fighter at the chart's selected turn (none: no fight to show, the card's own stats). */
export interface CardTurn {
  stats: Record<string, number> | null;
  /** U67: HP now (the HP cell reads "HP now / max HP"). */
  hp?: number;
  /** U67: the stats' modifier parts then. */
  mods?: StatMods;
  fx?: TimelineChip[];
  /** The rotation row of the skill played this turn (0-4), or none. */
  active?: number | null;
  /** U67: what came of its action this turn. */
  outcome?: CardOutcome | null;
}

export interface FighterCardSpec {
  kind: "hero" | "enemy";
  /** More classes: the class colour (cls-N), the slot's state (filled, empty, required, excluded, off-limits), rare. */
  classes?: string;
  /** Attributes: the drag and drop's data-slot / data-drag, a title. */
  attrs?: Record<string, string>;
  /** The picker, or the plain name on a read-only page. */
  head: Node;
  tools?: Node[];
  /** Lines under the head. */
  lines?: Node[];
  stats: Record<string, number> | null;
  /** U65: the selected turn's state (paintCard does the same on a built card). */
  turn?: Omit<CardTurn, "stats">;
  /** A hero's passive row (the enemy has none). */
  passive?: CardRow;
  rotation: CardRow[];
}

/** One card, a hero's or the enemy's. */
export function fighterCard(s: FighterCardSpec): HTMLElement {
  const card = el("article", { class: `fc fc-${s.kind}${s.classes ? ` ${s.classes}` : ""}`, ...(s.attrs ?? {}) },
    el("div", { class: "fc-head" }, s.head, ...(s.tools?.length ? [el("span", { class: "fc-tools" }, ...s.tools)] : [])),
    ...(s.lines ?? []),
    statGrid(s.stats, s.kind),
    ...(s.passive ? [el("ul", { class: "fc-rows fc-passive", "aria-label": "Passive" }, rowEl(s.passive, "fc-pas"))] : []),
    el("ol", { class: "fc-rows fc-rot", "aria-label": "Rotation, turns 1 to 5" }, ...s.rotation.map((r) => rowEl(r, "fc-turn"))));
  if (s.turn) paintCard(card, { ...s.turn, stats: s.stats });
  return card;
}

/**
 * U65: put a turn's state on a built card, in place: the stats (U67: with their modifiers), the effects under them
 * (above the passive), the played row highlighted, its outcome on the turn's row. Without `fx`, `active` or `outcome`
 * the card has none of them.
 */
export function paintCard(card: HTMLElement, t: CardTurn): void {
  card.querySelector("ul.fc-fx")?.remove();
  card.querySelectorAll(".fc-out").forEach((x) => x.remove());
  const kind = card.classList.contains("fc-enemy") ? "enemy" : "hero";
  const grid = statGrid(t.stats, kind, { ...(t.hp !== undefined ? { hp: t.hp } : {}), ...(t.mods ? { mods: t.mods } : {}) });
  card.querySelector("dl.fc-stats")?.replaceWith(grid);
  const fx = fxList(t.fx ?? []);
  if (fx) grid.after(fx);
  const rows = card.querySelectorAll<HTMLElement>("li.fc-turn");
  rows.forEach((li, k) => {
    const on = t.active === k;
    li.classList.toggle("active", on);
    if (on) li.setAttribute("aria-current", "true");
    else li.removeAttribute("aria-current");
  });
  const out = t.outcome ? outcomeEl(t.outcome) : null;
  const row = t.outcome ? rows[t.outcome.row] : undefined;
  if (out && row) {
    // after the name, before the AP badge
    const name = row.querySelector(".pk-btn, .fc-skill");
    if (name) name.after(out);
    else row.append(out);
  }
}
