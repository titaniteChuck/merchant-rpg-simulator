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
 *   U69: HP's modifier is the HP change during that turn ("+120", "−340"), the damage taken and the heals received
 *   with their sources in its tooltip (hpDeltaText, hpDeltaTipLines);
 * - U69: no effects line any more (U65 / U67's fxList): a stat effect is in its stat's modifier, a lost action the 💫;
 * - a hero's passive (with the rotation's AP total at its right), then the rotation: one row per turn 1-5, the skill
 *   and its AP. No turn numbers (the list is ordered) and no titles. A row with a picker is a button opening the
 *   choices with their effects (pick-list.ts; U69: floating over the page, the choices over the AP budget greyed
 *   out); otherwise plain text. Both carry the effect on hover. U65: the row of the skill played at the selected turn
 *   is highlighted (`active`, aria-current); U67: the row of that turn says what came of it: 💫 when an effect took
 *   the action, else the damage per target ("!" a crit), "Miss", "+N" a heal (outcomeText); U69: the damage in red,
 *   the heals in green (outcomeParts).
 *
 * U65: paintCard puts another turn's state on a card in place (the pickers, an open list and the focus stay).
 * U73: or a step within the turn (the state right after one action); the acting fighter's card is marked `acting`.
 * The text builders (statCell, modText, modTip, hpDeltaText, hpDeltaTip, outcomeText, outcomeParts) are pure, for the
 * tests. U71: the tooltips have no header and no caster names; their values coloured (TipLine), the signs kept.
 */
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
/** U67: one part of a stat's modifier, its source already named ("Might (passive)", "Holy Blessing"). */
export interface ModPart {
  kind: "pct" | "flat" | "set";
  /** A share for "pct" (0.15 = +15%), points for "flat", 0 for "set". */
  value: number;
  label: string;
  /** U71: an effect's time left ("1 turn left"), shown after the value; none for a passive, an item… */
  left?: string;
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

// ---------------------------------------------------------------- U71: tooltip lines with coloured pieces
/** U71: a piece of a tooltip line: a bonus or a heal "good" (green), a malus or damage "bad" (red), else plain. */
export type TipPart = { text: string; tone?: "good" | "bad" };
/** U71: a tooltip line, in pieces; its text is the pieces joined (the sign stays: the colour is not the only cue). */
export type TipLine = TipPart[];
export const tipLineText = (l: TipLine): string => l.map((p) => p.text).join("");

// ---------------------------------------------------------------- U69: HP's change during the turn (pure text)
/** U69: one source of damage taken or healing received (U71: the skill or effect only, "Fireball"), and the HP it took or gave. */
export interface HpSource {
  label: string;
  value: number;
}
/** U69: a fighter's HP change during one turn (card-turn.ts hpDeltaAt): the net change, then its parts by source. */
export interface HpDelta {
  turn: number;
  net: number;
  taken: HpSource[];
  healed: HpSource[];
}
const total = (xs: HpSource[]) => xs.reduce((a, x) => a + x.value, 0);
const short = (n: number) => (Math.abs(n) >= 10_000 ? fmtCompact.format(n) : fmt.format(n));

/** U69: HP's modifier: the turn's net HP change, "+120", "−340" ("±0": hit and healed as much); "" when nothing happened. */
export function hpDeltaText(d: HpDelta | null | undefined): string {
  if (!d) return "";
  if (Math.round(d.net) === 0) return d.taken.length || d.healed.length ? "±0" : "";
  return `${d.net < 0 ? MINUS : "+"}${short(Math.abs(d.net))}`;
}

/**
 * U69: HP's modifier tooltip. U71: one line per source, no header, no caster: the damage taken ("Fireball: −300",
 * red) then the heals received ("Heal: +60", green), and what neither explains (a max HP change) as "Other" (plain).
 */
export function hpDeltaTip(d: HpDelta): TipLine[] {
  const dmg = total(d.taken), heal = total(d.healed), other = d.net - (heal - dmg);
  return [...d.taken.map((x): TipLine => [{ text: `${x.label}: ${MINUS}${fmt.format(x.value)}`, tone: "bad" }]),
    ...d.healed.map((x): TipLine => [{ text: `${x.label}: +${fmt.format(x.value)}`, tone: "good" }]),
    ...(Math.round(other) !== 0 ? [[{ text: `Other: ${signedNum(other)}` }]] : [])];
}
/** U69: hpDeltaTip's lines as text. */
export const hpDeltaTipLines = (d: HpDelta): string[] => hpDeltaTip(d).map(tipLineText);

/**
 * U67: one stat cell's three parts: "HP" "1,234 / 2,000" "(+10%)"; `full` the whole value when `value` is shortened;
 * HP from five digits also has a `short` form ("12.3K / 20K", what a hero card on a phone shows). U69: HP's modifier
 * is the turn's HP change (`hpDelta`, hpDeltaText), never a %; another stat from four digits has a `short` form too
 * ("1.2K": a hero card on a phone, two stats per row).
 */
export function statCell(key: string, label: string, stats: Record<string, number> | null,
  o: { hp?: number; mods?: StatMods; hpDelta?: HpDelta | null } = {}): { name: string; value: string; full?: string; short?: string; mod: string } {
  if (!stats) return { name: label, value: "–", mod: "" };
  const v = Number(stats[key] ?? 0);
  const m = key === "maxHP" ? hpDeltaText(o.hpDelta) : modText(key, o.mods?.[key]);
  const mod = m ? `(${m})` : "";
  if (key === "maxHP" && o.hp !== undefined) {
    const hp = Math.max(0, o.hp);
    return { name: label, value: `${fmt.format(hp)} / ${fmt.format(v)}`, mod,
      ...(v >= 10_000 ? { short: `${fmtCompact.format(hp)} / ${fmtCompact.format(v)}` } : {}) };
  }
  if (Math.abs(v) >= 10_000) return { name: label, value: fmtCompact.format(v), full: fmt.format(v), mod };
  return Math.abs(v) >= 1000 ? { name: label, value: fmt.format(v), short: fmtCompact.format(v), mod } : { name: label, value: fmt.format(v), mod };
}

/**
 * U67: a modifier's tooltip, line by line: each part with its source, then the calculation in the game's order
 * (statsService): stat = (base + flat parts) × (1 + sum of % parts), the sum floored. U71: no header; a part reads
 * "Holy Blessing: +40% (1 turn left)", the value green for a bonus, red for a malus; no caster; the calculation
 * without the word "Base" ("200 × (1 + 40%) = 280").
 */
export function modTip(key: string, label: string, value: number, parts: ModPart[]): TipLine[] {
  const name = key === "maxHP" ? "Max HP" : label;
  const lines: TipLine[] = parts.map((p): TipLine => {
    const left: TipLine = p.left ? [{ text: ` (${p.left})` }] : [];
    if (p.kind === "set") return [{ text: `${p.label}: sets ${name}` }, ...left];
    const v: TipPart = { text: p.kind === "pct" ? signedPct(p.value) : signedNum(p.value) };
    if (Math.abs(p.value) > 1e-9) v.tone = p.value < 0 ? "bad" : "good";
    return [{ text: `${p.label}: ` }, v, ...left];
  });
  for (const l of modCalcLines(key, name, value, parts)) lines.push([{ text: l }]);
  return lines;
}
/** U67: modTip's lines as text. */
export const modTipLines = (key: string, label: string, value: number, parts: ModPart[]): string[] =>
  modTip(key, label, value, parts).map(tipLineText);

/** U67: the calculation's lines (U71: no "Base"): "(70 + 30) × (1 − 20%) = 80", "12 + 25 = 37", the floor's note. */
function modCalcLines(key: string, name: string, value: number, parts: ModPart[]): string[] {
  const lines: string[] = [];
  const s = modSums(key, parts);
  const flat = Math.abs(s.flat) > 1e-9;
  if (Math.abs(s.raw) > 1e-9) {
    const mult = 1 + s.pct;
    const factor = `× (1 ${s.pct < 0 ? MINUS : "+"} ${pct(Math.abs(s.pct), Math.abs(s.pct * 100 - Math.round(s.pct * 100)) < 0.05 ? 0 : 1)})`;
    if (mult > 1e-9) {
      const base = value / mult - s.flat;
      const start = flat ? `(${fmt.format(base)} ${s.flat < 0 ? MINUS : "+"} ${fmt.format(Math.abs(s.flat))})` : fmt.format(base);
      lines.push(`${start} ${factor} = ${fmt.format(value)}`);
    } else lines.push(`${name} ${factor} = ${fmt.format(value)}`);
    if (s.raw < s.floor) lines.push(`% sum ${signedPct(s.raw)}, floored at ${signedPct(s.floor)}`);
  } else if (flat) lines.push(`${fmt.format(value - s.flat)} ${s.flat < 0 ? MINUS : "+"} ${fmt.format(Math.abs(s.flat))} = ${fmt.format(value)}`);
  return lines;
}

/** The tooltip's box: a line per <div>; U71: a toned piece in a `t-good` / `t-bad` span. A plain string: one piece. */
const tipBox = (lines: (string | TipLine)[]) => el("div", { class: "fc-tip" }, ...lines.map((l) =>
  el("div", {}, ...(typeof l === "string" ? [l] : l.map((p) => (p.tone ? el("span", { class: `t-${p.tone}` }, p.text) : p.text))))));

/**
 * The stats as a <dl>: per stat a row of three cells (name, value, modifier; CSS lines them up two per row, HP across
 * both). Dashes without stats (an empty slot). From five digits a value is shortened ("12.3K"), the whole one in its
 * title. U67: a modifier is focusable, its parts and calculation in the tooltip (hover, focus, tap).
 */
export function statGrid(stats: Record<string, number> | null, kind: "hero" | "enemy" = "hero",
  o: { hp?: number; mods?: StatMods; hpDelta?: HpDelta | null } = {}): HTMLElement {
  return el("dl", { class: "fc-stats" }, ...cardStats(kind).map(([k, label]) => {
    const c = statCell(k, label, stats, o);
    const parts = o.mods?.[k];
    const mod = el("dd", { class: "fc-mod" });
    // U69: HP's modifier is the turn's HP change, its sources in the tooltip; the brackets go on a phone (CSS)
    const lines = !c.mod || !stats ? null : k === "maxHP" ? (o.hpDelta ? hpDeltaTip(o.hpDelta) : null)
      : parts?.length ? modTip(k, label, Number(stats[k] ?? 0), parts) : null;
    if (lines) {
      const tone = c.mod.startsWith(`(${MINUS}`) ? "down" : c.mod.startsWith("(+") ? "up" : "even";
      const m = el("span", { class: `fc-mod-btn ${tone}`, tabindex: "0" },
        el("span", { class: "fc-paren" }, "("), c.mod.slice(1, -1), el("span", { class: "fc-paren" }, ")"));
      tip(m, () => tipBox(lines));
      mod.append(m);
    }
    return el("div", { class: `fc-stat${k === "maxHP" ? " fc-stat-hp" : ""}` }, el("dt", {}, c.name),
      el("dd", { class: "fc-val", ...(c.full || c.short ? { title: `${label} ${c.full ?? c.value}` } : {}) },
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

/** U69: an outcome text's pieces, each with its colour: damage (red), a heal (green), a miss (muted); none: the joins. */
export type OutcomePart = { text: string; kind?: "dmg" | "heal" | "miss" };

/**
 * U69: outcomeText's text in pieces (their texts joined are that text), so the row colours the damage red and the
 * heals green; the text itself stays (the colour is not the only cue). Null as outcomeText; [] for 💫.
 */
export function outcomeParts(o: CardOutcome): OutcomePart[] | null {
  if (o.lost !== undefined) return [];
  const ts = o.targets.filter((t) => t.hits || t.heals || t.miss);
  if (!ts.length) return null;
  return ts.flatMap((t, k): OutcomePart[] => [
    ...(k ? [{ text: " · " }] : []),
    ...(!t.hits && !t.heals ? [{ text: "Miss", kind: "miss" as const }] : [
      ...(t.hits ? [{ text: `${short(t.dmg)}${t.crit ? "!" : ""}`, kind: "dmg" as const }] : []),
      ...(t.hits && t.heals ? [{ text: " " }] : []),
      ...(t.heals ? [{ text: `+${short(t.heal)}`, kind: "heal" as const }] : []),
      ...(t.miss ? [{ text: ` (${t.miss} miss${t.miss === 1 ? "" : "es"})` }] : []),
    ]),
  ]);
}

/** U67: the outcome on its row: focusable, the per-target lines in its tooltip. U69: damage red, heals green. */
function outcomeEl(o: CardOutcome): HTMLElement | null {
  const t = outcomeText(o);
  if (!t) return null;
  const parts = (outcomeParts(o) ?? []).map((p) => (p.kind ? el("span", { class: `o-${p.kind}` }, p.text) : p.text));
  const e = t.tone === "lost"
    ? el("span", { class: "fc-out lost", role: "img", "aria-label": t.label, tabindex: "0" }, t.text)
    : el("span", { class: `fc-out ${t.tone}`, tabindex: "0" }, el("span", { "aria-hidden": "true" }, ...parts), el("span", { class: "visually-hidden" }, t.label));
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
    ? pickButton({ ...r.pick, text: r.text, host: () => li, float: true })
    : el("span", { class: `fc-skill${r.text === "—" ? " muted" : ""}` }, r.text);
  if (r.tip) r.tip(name);
  li.append(name);
  if (r.ap !== undefined) li.append(r.ap === null ? el("span", { class: "ap-badge off", "aria-hidden": "true" }, "–") : apBadge(r.ap));
  if (r.end) li.append(r.end);
  return li;
}

/** U65: a fighter at the chart's selected turn (none: no fight to show, the card's own stats). */
export interface CardTurn {
  stats: Record<string, number> | null;
  /** U67: HP now (the HP cell reads "HP now / max HP"). */
  hp?: number;
  /** U67: the stats' modifier parts then. */
  mods?: StatMods;
  /** U69: the HP change during this turn (HP's modifier). */
  hpDelta?: HpDelta | null;
  /** The rotation row of the skill played this turn (0-4), or none. */
  active?: number | null;
  /** U67: what came of its action this turn. */
  outcome?: CardOutcome | null;
  /** U73: the fighter acting at the chart's step (the turn's last action when a whole turn is picked). */
  acting?: boolean;
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
 * U65: put a turn's state on a built card, in place: the stats (U67: with their modifiers; U69: HP's the turn's HP
 * change), the played row highlighted, its outcome on the turn's row. Without `active` or `outcome` the card has
 * none of them. U69: no effects line.
 */
export function paintCard(card: HTMLElement, t: CardTurn): void {
  card.querySelectorAll(".fc-out").forEach((x) => x.remove());
  // U73: the step's actor: its card marked (style.css U73), its played row and outcome as every acted one's
  card.classList.toggle("acting", Boolean(t.acting));
  const kind = card.classList.contains("fc-enemy") ? "enemy" : "hero";
  const grid = statGrid(t.stats, kind, { ...(t.hp !== undefined ? { hp: t.hp } : {}), ...(t.mods ? { mods: t.mods } : {}),
    ...(t.hpDelta ? { hpDelta: t.hpDelta } : {}) });
  card.querySelector("dl.fc-stats")?.replaceWith(grid);
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
