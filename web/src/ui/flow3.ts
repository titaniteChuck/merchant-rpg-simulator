/**
 * Flow 3 (U59): the traced fight as one card per action, placed in its fighter's column at its place in the
 * chronology. No turn bands and no end-of-turn summary: each card carries the state of its fighter at that moment.
 *
 * - One column per fighter in action order (the heroes by party location, then the enemy; the enemy first on
 *   questType 6), as Flow 1 (timeline.ts planGrid columns), with a compact head row (name, place).
 * - One card per action, each on its own grid row, so a card always sits lower than the one before it, whatever the
 *   column. A card: the fighter's name (the first card of a turn adds a tiny "T3"), the skill as its headline, what it
 *   did to each fighter it touched (damage, healing, crit, miss, KO, the effects that landed, each number with its
 *   "▾ calculation", which opens inside the card), then the fighter's HP (a compact bar with "1,097 / 2,000" inside
 *   it) and its effects, one per line, as they are right after the action.
 * - A turn boundary is a hairline across the columns, nothing more. A fighter that is down shows a dimmed "†" once
 *   (on its first action lost to it), then nothing until it stands again.
 * - On a narrow box (a phone; container query, style.css `Flow 3` block) no columns at all: the items read as one
 *   vertical list, full width, in the DOM's order (the chronology); no head row; each card names its fighter, a
 *   class-colour edge on its left, and a "†" names the fallen fighter.
 * - Reading order: the DOM order is the visual order (one ordered list); each card starts with a visually hidden
 *   sentence, "Turn 3, Warrior: Slash on Boss, 1,240 damage".
 * The data comes from the same trace as Flow 1 (tools/fight-trace.ts via battle-plan.ts planTimeline), read only.
 */
import { calcView } from "./battle-calc.ts";
import {
  locationLabel, type PlanColumn, planGrid, type PlanMember, planTimeline, type TimelineCell, type TimelineChip, type TimelineLine,
  TURN_CAP, type TracedFight,
} from "./battle-plan.ts";
import type { TraceCalc } from "../sim/api.ts";
import { el, fmtCompact } from "./dom.ts";
import { enemyName, skillName } from "./names.ts";
import { FLOW_PAGE, partyPlan, type PlanEdit, timelineOf } from "./timeline.ts";
import { tip } from "./tooltip.ts";
import { skillLink } from "./wiki-data.ts";

const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// ---------------------------------------------------------------- data (pure)
/** One card: a fighter's action, with its state right after it. */
export interface Flow3Card {
  kind: "card";
  turn: number;
  /** The first action of its turn (it carries the "T3" tag). */
  first: boolean;
  /** The fighter (0 = the enemy, 1-6 = party location) and its column (0-based, action order). */
  who: number;
  col: number;
  line: TimelineLine;
  /** The fighter's HP and effects right after the action. */
  hp: { hp: number; maxHP: number } | undefined;
  fx: TimelineChip[];
  /** The heroes standing right after the action (a buff on all of them reads "Party"). */
  standing: number[];
}
/** A fighter that is down: one "†" on the first action it loses to it. */
export interface Flow3Dead {
  kind: "dead";
  turn: number;
  first: boolean;
  who: number;
  col: number;
}
/** A hairline between two turns. */
export interface Flow3Break {
  kind: "break";
  turn: number;
}
export type Flow3Item = Flow3Card | Flow3Dead | Flow3Break;

/**
 * The items of a traced fight in reading order. Each action is run through planTimeline as a turn of its own, so its
 * "end of turn" state is the state right after that action (HP of everyone, live effects), with the same chips,
 * damage, healing and calculations as Flow 1.
 */
export function flow3Items(trace: TracedFight, whoCols: number[], nameOf: (w: number) => string): Flow3Item[] {
  const steps = planTimeline({ won: trace.won, turns: trace.actions.length, actions: trace.actions.map((a, k) => ({ ...a, turn: k + 1 })) },
    whoCols.filter((w) => w > 0), nameOf).turns;
  const items: Flow3Item[] = [];
  // Down: one "†" at the place of the first action it misses, then nothing until it stands again. The trace has no
  // action for a fighter that is down (an older one had them, did = null), so the "†" goes where its column's turn is.
  const shownDown = new Set<number>();
  const hpNow = new Map<number, number>();
  let pending: number[] = [];
  const dead = (w: number, turn: number) => {
    if (shownDown.has(w)) return;
    shownDown.add(w);
    items.push({ kind: "dead", turn, first: false, who: w, col: whoCols.indexOf(w) });
  };
  /** The fighters down at the start of a turn whose place in it comes before column `col`. */
  const flush = (turn: number, col: number) => {
    const now = pending.filter((w) => whoCols.indexOf(w) < col);
    pending = pending.filter((w) => !now.includes(w));
    for (const w of now) dead(w, turn);
  };
  let turn = 0;
  trace.actions.forEach((a, k) => {
    const step = steps[k];
    const line = step?.lines[0];
    const col = whoCols.indexOf(a.who);
    if (!line || col < 0) return;
    if (a.turn !== turn) {
      flush(turn, Infinity);
      if (turn) items.push({ kind: "break", turn: a.turn });
      pending = whoCols.filter((w) => (hpNow.get(w) ?? 1) <= 0 && !shownDown.has(w));
    }
    turn = a.turn;
    flush(turn, col);
    pending = pending.filter((w) => w !== a.who);
    for (const l of a.life ?? []) hpNow.set(l.who, l.hp);
    if (a.did === null) return dead(a.who, a.turn);
    shownDown.delete(a.who);
    items.push({ kind: "card", turn: a.turn, first: false, who: a.who, col, line, hp: step.hp[a.who], fx: step.status[a.who] ?? [],
      standing: whoCols.filter((w) => w > 0 && (step.hp[w]?.hp ?? 1) > 0) });
  });
  flush(turn, Infinity);
  // No hairline before a turn that shows nothing, nor two in a row; the "T3" tag on each turn's first item shown.
  const kept = items.filter((it, k) => it.kind !== "break" || (k > 0 && items[k + 1] !== undefined && items[k + 1].kind !== "break"));
  let last = 0;
  for (const it of kept) {
    if (it.kind === "break") continue;
    it.first = it.turn !== last;
    last = it.turn;
  }
  return kept;
}

/** A fighter's part of an action, for the screen-reader sentence and the result rows. */
interface Touch {
  w: number;
  cell: TimelineCell;
  crit: boolean;
  missed: number;
  /** Several heroes given the same effects and nothing else (a party buff): one row; `party` when they are every hero standing. */
  group?: number[];
  party?: boolean;
}

/**
 * The fighters an action touched, in column order (the actor's own row too: a self-heal, a buff, damage over time).
 * Heroes that only got the same effects share one row ("Party +40% MDef"), so a party buff is one line, not six.
 */
function touches(c: Flow3Card, whoCols: number[]): Touch[] {
  const list = whoCols.flatMap((w): Touch[] => {
    const cell = c.line.cells[w];
    if (!cell) return [];
    const hits = cell.calc.filter((x) => x.kind === "dmg" && x.to === w);
    const crit = hits.some((x) => x.kind === "dmg" && !x.missed && (x.crit || x.luck));
    const missed = hits.filter((x) => x.kind === "dmg" && x.missed).length;
    if (!cell.dmg && !cell.heal && !cell.ko && !cell.deadHits && !cell.added.length && !missed) return [];
    return [{ w, cell, crit, missed }];
  });
  const onlyFx = (t: Touch) => t.w > 0 && !t.cell.dmg && !t.cell.heal && !t.cell.ko && !t.cell.deadHits && !t.missed && t.cell.added.length > 0;
  const key = (t: Touch) => t.cell.added.map((f) => f.label).join("|");
  const out: Touch[] = [];
  for (const t of list) {
    const same = onlyFx(t) ? list.filter((u) => onlyFx(u) && key(u) === key(t)) : [t];
    if (same.length < 2) out.push(t);
    else if (same[0] === t) {
      const group = same.map((u) => u.w);
      out.push({ ...t, group, party: c.standing.length === group.length && c.standing.every((w) => group.includes(w)) });
    }
  }
  return out;
}

/** A row's fighter(s): the name, "Party", or the names of the heroes sharing the row. */
function touchName(t: Touch, nameOf: (w: number) => string): string {
  if (!t.group) return nameOf(t.w);
  if (t.party) return "Party";
  const names = t.group.map(nameOf);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The skill as words: the one played, or what happened to the planned one. */
function skillWords(line: TimelineLine): string {
  if (line.did === false) return `stunned, ${skillName(line.planned)} lost`;
  const played = skillName(line.did || line.planned);
  return line.did !== line.planned ? `${played} (forced, planned ${skillName(line.planned)})` : played;
}

/** "Turn 3, Warrior: Slash on Boss, 1,240 damage" (several fighters: "…; on Mage, 300 healed"). */
export function flow3Sentence(c: Flow3Card, whoCols: number[], nameOf: (w: number) => string): string {
  const parts = touches(c, whoCols).map((t) => {
    const bits = [
      ...(t.cell.dmg ? [`${fmtInt.format(t.cell.dmg)} damage${t.crit ? ", critical" : ""}`] : []),
      ...(t.missed && !t.cell.dmg ? [`missed`] : t.missed ? [`${t.missed} missed`] : []),
      ...(t.cell.heal ? [`${fmtInt.format(t.cell.heal)} healed`] : []),
      ...(t.cell.ko ? ["falls"] : []),
      ...(t.cell.deadHits && !t.cell.dmg ? ["already down"] : []),
      ...t.cell.added.map((f) => f.label),
    ];
    return `${t.party ? "the party" : touchName(t, nameOf)}${bits.length ? `, ${bits.join(", ")}` : ""}`;
  });
  const miss = c.line.misses && !parts.length ? ", missed" : "";
  return `Turn ${c.turn}, ${nameOf(c.who)}: ${skillWords(c.line)}${parts.length ? ` on ${parts.join("; on ")}` : ""}${miss}`;
}

// ---------------------------------------------------------------- DOM
/** One effect, a line of its own: what it does ("+15% Def"), its turns left; "<skill> from <fighter>" on hover. */
function fxLine(c: TimelineChip): HTMLElement {
  return el("li", { class: `f3-fx-item tc-fx ${c.debuff ? "debuff" : "buff"}`, title: c.title }, c.label,
    ...(c.turns !== undefined && c.turns > 0 ? [el("span", { class: "tc-left" }, ` · ${c.turns}`)] : []));
}

/** A calculation panel (the same calcView as Flow 1): one block per hit or heal, then their sum when several. */
function calcPanel(calc: TraceCalc[], kind: "dmg" | "heal", nameOf: (w: number) => string, shown: number): HTMLElement {
  const views = calc.filter((c) => c.kind === kind && !(c.kind === "dmg" && c.missed)).map((c) => calcView(c, nameOf));
  const blocks = views.map((v) => el("div", { class: `cf-block${v.void ? " void" : ""}` }, el("div", { class: "cf-head" }, v.head),
    ...v.lines.map((l) => el("div", { class: "cf-line" }, ...(v.lines.length > 1 || l.label !== "Heal" ? [el("span", { class: "cf-label" }, `${l.label}: `)] : []),
      ...l.terms.flatMap((t) => {
        const term = el("span", { class: `cf-term${t.kind ? ` cf-${t.kind}` : ""}`, tabindex: "0" }, t.text);
        tip(term, () => t.tip);
        return [...(t.op ? [el("span", { class: "cf-op", "aria-hidden": t.op === "=" ? "false" : "true" }, ` ${t.op} `)] : []), term];
      }))),
    ...v.notes.map((n) => el("div", { class: "cf-note" }, n))));
  const counted = views.filter((v) => !v.void);
  const sum = counted.length > 1
    ? [el("div", { class: "cf-sum" }, `${counted.map((v) => fmtInt.format(v.shown)).join(" + ")} = ${fmtInt.format(shown)}`)]
    : [];
  return el("div", { class: `f3-calc ${kind}` }, ...blocks, ...sum);
}

/** "▾": opens the calculation at the bottom of the card (one column wide, as the card), "▸" while open. */
function calcToggle(card: HTMLElement, open: () => HTMLElement, what: string): HTMLElement {
  const btn = el("button", { type: "button", class: "f3-calc-btn", "aria-expanded": "false", "aria-label": `Calculation: ${what}` },
    el("span", { "aria-hidden": "true" }, "▾"));
  tip(btn, () => `How ${what} was worked out`);
  let panel: HTMLElement | null = null;
  btn.addEventListener("click", () => {
    if (panel) {
      panel.remove();
      panel = null;
    } else {
      panel = open();
      card.append(panel);
    }
    btn.firstElementChild!.textContent = panel ? "▸" : "▾";
    btn.setAttribute("aria-expanded", panel ? "true" : "false");
  });
  return btn;
}

/** The skill line: the skill played (linked), the planned one struck out under a stun or a forced action. */
function skillEl(line: TimelineLine, misses: boolean): HTMLElement {
  const link = (s: string) => (s === "Basic" ? el("span", {}, "Basic") : skillLink(s));
  const planned = () => el("s", { class: "f3-planned", title: `Planned: ${skillName(line.planned)}` }, skillName(line.planned));
  const kids: (Node | string)[] = line.did === false
    ? [planned(), " ", el("span", { class: "f3-tag f3-stun", title: "Stunned: the action is lost" }, "stun")]
    : line.did !== line.planned
    ? [planned(), " ", el("span", { title: "Forced: another action than the planned one" }, link(line.did!))]
    : [link(line.did!)];
  return el("div", { class: "f3-skill" }, ...kids,
    ...(misses ? [" ", el("span", { class: "f3-tag f3-miss", title: `${line.misses} attack${line.misses > 1 ? "s" : ""} missed` }, "miss")] : []));
}

/** One fighter the action touched: name, damage / healing with their ▾, crit, miss, KO, the effects that landed. */
function touchEl(t: Touch, card: HTMLElement, nameOf: (w: number) => string, self: boolean): HTMLElement {
  const name = nameOf(t.w), c = t.cell, who = touchName(t, nameOf);
  return el("li", { class: `f3-hit${t.group ? " f3-group" : ""}` },
    el("span", { class: "f3-to", "aria-hidden": "true", ...(t.group ? { title: t.group.map(nameOf).join(", ") } : {}) },
      self && !t.group ? "self" : who),
    ...(c.dmg ? [el("span", { class: "f3-num tc-dmg", "aria-hidden": "true" }, `−${fmtInt.format(c.dmg)}`),
      calcToggle(card, () => calcPanel(c.calc, "dmg", nameOf, c.dmg), `the damage to ${name}`)] : []),
    ...(t.crit ? [el("span", { class: "f3-tag f3-crit", "aria-hidden": "true", title: "Critical or lucky hit" }, "crit")] : []),
    ...(t.missed ? [el("span", { class: "f3-tag f3-miss", "aria-hidden": "true" }, t.missed > 1 ? `${t.missed} miss` : "miss")] : []),
    ...(c.deadHits && !c.dmg ? [el("span", { class: "f3-tag f3-void", "aria-hidden": "true", title: `${name} was already down: these hits change nothing` }, "no target")] : []),
    ...(c.heal ? [el("span", { class: "f3-num tc-heal", "aria-hidden": "true" }, `+${fmtInt.format(c.heal)}`),
      calcToggle(card, () => calcPanel(c.calc, "heal", nameOf, c.heal), `the healing on ${name}`)] : []),
    ...(c.ko ? [el("span", { class: "tc-ko", "aria-hidden": "true", title: "Falls" }, "✝ KO")] : []),
    ...(c.added.length ? [el("span", { class: "f3-landed", "aria-hidden": "true" }, ...c.added.map((f) =>
      el("span", { class: `tc-fx ${f.debuff ? "debuff" : "buff"}`, title: f.title }, f.label)))] : []));
}

/**
 * The fighter's HP right after the action: a compact bar with "remaining / total" written inside it. The text comes
 * twice, whole ("1,097 / 2,000") and compact ("9.7K / 10K", only when the total reaches 10,000), and the bar's own
 * container query (style.css `Flow 3` block) shows the compact one when the bar is narrow, as Flow 2 does on phones.
 * Down: "0 / total" in an empty bar. The screen reader reads the label only.
 */
function hpEl(v: { hp: number; maxHP: number } | undefined, name: string): HTMLElement[] {
  if (!v) return [];
  const down = v.hp <= 0;
  const now = Math.max(0, v.hp);
  const f = !down && v.maxHP > 0 ? Math.max(0, Math.min(1, now / v.maxHP)) : 0;
  const tone = down ? "down" : f > 0.5 ? "ok" : f > 0.25 ? "mid" : "low";
  const text = down ? `${name} is down` : `${name}: ${fmtInt.format(v.hp)} / ${fmtInt.format(v.maxHP)} HP`;
  const full = `${fmtInt.format(now)} / ${fmtInt.format(v.maxHP)}`;
  const short = v.maxHP >= 10_000 ? `${fmtCompact.format(now)} / ${fmtCompact.format(v.maxHP)}` : full;
  return [el("div", { class: `f3-hp ${tone}`, role: "img", "aria-label": text, title: text },
    el("span", { class: "f3-hpbar", "aria-hidden": "true" }, el("span", { class: "f3-hpfill", style: `width: ${(f * 100).toFixed(1)}%` }),
      el("span", { class: "f3-hptxt" }, el("span", { class: "f3-hpfull" }, full), el("span", { class: "f3-hpshort" }, short))))];
}

/** Where an item sits on a wide box: its own grid row and its fighter's column (a narrow box ignores both: one list). */
function place(row: number, col: number): string {
  return `grid-row: ${row}; --f3-col: ${col + 1}`;
}

/** The fighter's colour class: its hero class, or the enemy's trim. */
function colourOf(col: PlanColumn): string {
  return col.kind === "enemy" ? "enemy" : `cls-${col.member!.cls}`;
}

function turnTag(turn: number): HTMLElement {
  return el("span", { class: "f3-t", "aria-hidden": "true", title: `Turn ${turn}` }, `T${turn}`);
}

function cardEl(c: Flow3Card, cols: PlanColumn[], whoCols: number[], nameOf: (w: number) => string, row: number): HTMLElement {
  const card = el("li", { class: `f3-card ${colourOf(cols[c.col])}${c.first ? " f3-first" : ""}`, style: place(row, c.col), "data-turn": String(c.turn) });
  const list = touches(c, whoCols);
  card.append(
    el("span", { class: "sr-only" }, `${flow3Sentence(c, whoCols, nameOf)}.`),
    el("div", { class: "f3-top", "aria-hidden": "true" }, ...(c.first ? [turnTag(c.turn)] : []), el("span", { class: "f3-who" }, nameOf(c.who))),
    skillEl(c.line, c.line.misses > 0 && !list.some((t) => t.missed)),
    ...(list.length ? [el("ul", { class: "f3-out" }, ...list.map((t) => touchEl(t, card, nameOf, t.w === c.who)))] : []),
    el("div", { class: "f3-state" }, ...hpEl(c.hp, nameOf(c.who)),
      ...(c.fx.length ? [el("ul", { class: "f3-fx", "aria-label": `${nameOf(c.who)}: effects` }, ...c.fx.map(fxLine))] : [])),
  );
  return card;
}

/** A "†": alone in its column on a wide box; on a narrow one (no columns) the fighter's name follows it. */
function deadEl(d: Flow3Dead, cols: PlanColumn[], nameOf: (w: number) => string, row: number): HTMLElement {
  return el("li", { class: `f3-dead ${colourOf(cols[d.col])}`, style: place(row, d.col), "data-turn": String(d.turn) },
    el("span", { class: "sr-only" }, `Turn ${d.turn}, ${nameOf(d.who)} is down.`),
    ...(d.first ? [turnTag(d.turn)] : []), el("span", { "aria-hidden": "true", title: `${nameOf(d.who)} is down` }, "†"),
    el("span", { class: "f3-dead-who", "aria-hidden": "true" }, nameOf(d.who)));
}

/** The column heads: name and place, in action order (orientation only: every card names its fighter; hidden on a narrow box). */
function headsEl(cols: PlanColumn[], nameOf: (w: number) => string, rare: boolean): HTMLElement {
  return el("div", { class: "f3-heads", "aria-hidden": "true" }, ...cols.map((c) => c.kind === "enemy"
    ? el("div", { class: "f3-head enemy", title: nameOf(0) }, el("strong", {}, nameOf(0)), el("span", {}, rare ? "enemy · rare" : "enemy"))
    : el("div", { class: `f3-head cls-${c.member!.cls}`, title: `${c.member!.name}, ${locationLabel(c.loc!)}` },
      el("strong", {}, c.member!.name), el("span", {}, locationLabel(c.loc!)))));
}

/**
 * Flow 3: the same inputs and result as Flow 1's partyPlan (timeline.ts), so the layout registry calls either. With a
 * traced fight, its cards; without one (no party, or a party that can't fight), Flow 1's rotation as planned. `edit`
 * is only used there: the cards are read-only. Null without a timeline for this enemy.
 */
export function renderFlow3(quest: { id: number; rare: boolean }, members: PlanMember[], trace: TracedFight | null = null, edit?: PlanEdit): HTMLElement | null {
  const tl = timelineOf(quest.id, quest.rare);
  if (!tl) return null;
  if (!trace || !members.length) return partyPlan(quest, members, trace, edit);
  const cols = planGrid(tl, members, 5).columns;
  const whoCols = cols.map((c) => (c.kind === "enemy" ? 0 : c.loc!));
  const foe = enemyName(tl.quest, tl.rare) ?? tl.name;
  const nameOf = (w: number) => (w ? cols.find((c) => c.loc === w)?.member?.name ?? locationLabel(w) : foe);
  const items = flow3Items(trace, whoCols, nameOf);
  let row = 1;
  const draw = (it: Flow3Item): HTMLElement => {
    const r = row++;
    if (it.kind === "break") return el("li", { class: "f3-break", "aria-hidden": "true", style: `grid-row: ${r}` });
    return it.kind === "dead" ? deadEl(it, cols, nameOf, r) : cardEl(it, cols, whoCols, nameOf, r);
  };
  const lastTurn = trace.turns;
  const firstPage = items.findIndex((it) => it.turn > FLOW_PAGE);
  const shown = firstPage < 0 ? items : items.slice(0, firstPage);
  const list = el("ol", { class: "f3-grid", "aria-label": "Every action, in order" }, ...shown.map(draw));
  if (shown.length < items.length) {
    const rest = items.slice(shown.length);
    const more = el("button", { type: "button", class: "secondary tc-more" }, `Show turns ${FLOW_PAGE + 1}–${lastTurn}`);
    // the rest takes the button's row onwards
    const moreRow = el("li", { class: "f3-more", style: `grid-row: ${row}` }, more);
    more.addEventListener("click", () => {
      moreRow.replaceWith(...rest.map(draw));
    });
    list.append(moreRow);
  }
  const capped = !trace.won && trace.turns >= TURN_CAP;
  const result = el("p", { class: `tc-result ${trace.won ? "won" : "lost"}`, role: "status" },
    trace.won ? `🏆 Won on turn ${lastTurn}` : capped ? `⏱ Stopped at the game's turn cap (${lastTurn} turns): lost` : `💀 Lost on turn ${lastTurn}`);
  return el("div", { class: "tl f3", role: "group", "aria-label": "The fight, action by action", style: `--pg-cols: ${cols.length}` },
    headsEl(cols, nameOf, tl.rare), list, result);
}
