/**
 * U61: the Party view's chart of a traced fight (U70: one of the runs battle-page.ts renderPlan asks for, U74: the one the
 * run picker asks for, Worst / Random / Best, beside the tabs on the Simulator; until U70 the Flow tabs drew the same trace).
 * U65: above the hero and opponent cards, full width; three tabs on one x axis, HP · Damage dealt · Heals; a click,
 * a tap or the arrow keys pick the turn the cards below show (the state at that turn's end, turn 0 the start).
 * U66: one fight tab per fight over the plot, Turn −1 / Turn +1 buttons, per-turn damage and heals, a hero's line
 * stops where it falls, the legend only names.
 * U68: every turn at least as wide as before U66 (minTurnWidth); the enemy's line starts again at a room change (no
 * vertical segment); a tab switch keeps the sideways scroll; `‹ Turn X ›` centred under the plot (out of the scroll
 * box) instead of Turn −1 / Turn +1; a map run zooms on one room; the y axis tops at the view's largest value.
 *
 * - One line per hero in its class colour (`cls-N`, --c), one for the enemy, dashed, in white (dark theme) or the
 *   theme's near-black (light theme): --enemy-line (U65; was U62's purple --boss). HP is a share of max HP (heroes and
 *   enemy on one scale; the absolute HP is in the readout and the table); damage dealt and heals are per turn (U66;
 *   U65 had them cumulative).
 * - x: the fight's start (turn 0), then the end of each turn. A map run puts its fought rooms one after the other and
 *   every room keeps its turn 0 (U66, back from c5f59a5's "only the first room"), on the SAME x as the last turn of
 *   the room before: a hero's line just goes on through it (same HP, or a scroll's heal straight up), the enemy's
 *   ends at 0 (room N's enemy falls) and starts again at 100 % (room N+1's fresh enemy; U68: two paths, U66 drew the
 *   rise). Two steps share that
 *   x: room N's last turn, then room N+1's turn 0. A click or tap there picks room N+1's turn 0 (the later step);
 *   ‹ (U68; U66's Turn −1), ← or ↓ from there picks room N's last turn (the marker stays, the cards change), › or →
 *   goes on to room N+1's turn 1. Every step is reached by the keys and the buttons, one at a time.
 * - Fight tabs (U66): a row of tabs over the plot, one per fight (a quest: one), each exactly over its fight's turns
 *   (turn 0 to its last turn). U68: every turn gets at least the even share of the plot (the width all steps had
 *   before U66), a fight whose name is wider than its turns gets more px per turn so its tab fits (fightLayout).
 *   Wider than the box: the tabs and the plot scroll sideways together, the mouse wheel too (battle-layout.ts
 *   roomBarWheel, as the map's room bar); a turn picked by the keys or ‹ › is kept in view (scrollToShow).
 * - Zoom (U68, a map run): a fight tab, or a click in the plot in All, zooms on that room: it fills the plot's width
 *   (no scroll), the tab row shows "All" then the room's tab; "All" zooms back out. The steps slide (an eased lerp,
 *   requestAnimationFrame, CHART_ANIM_MS; at once under reduced motion). Zoomed, a click only picks the turn (in that
 *   room); the keys and ‹ › walking into another room take the zoom with them. A tab click keeps the selected turn
 *   when it is in that room, else picks the room's turn 0.
 * - Y axis (U68): tops at the largest value drawn in the view (the zoomed room, or the whole run in All, however it
 *   is scrolled; HP: 100 %), the change animated with the zoom.
 * - A fighter that falls: its HP line drops to 0, a cross marks the point, and the line stops there (every tab); it
 *   starts again only where the trace has it standing (a revive).
 * - Accessible: the plot is a slider ("Turn", the arrow keys, Home, End) described by a one-sentence summary; a
 *   "Table" fold lists the open tab's values per turn.
 *
 * U73: `‹ <actor> k/n ›` beside `‹ Turn X ›` (`.hp-nav`, both under the plot; drawHpChart moves them to the page's
 * sticky host when it gives one): the step arrows walk the selected turn's actions in game order, wrapping; picking a
 * turn lands on its last step (its end). Turn 0 has none (the step arrows disabled).
 *
 * U76: a run switch (Worst / Random / Best) keeps the turn (clampStep), the actor's step (keepStep), the zoom (zoomAfter
 * `follow`) and the scroll; two touch edge zones at the scroll box's visible edges (edgeZones) pan the chart natively.
 *
 * Pure parts (hpData, pickStep, fightLayout, chartLayout, nearestStep, stepAfterKey, plotted; U68 minTurnWidth,
 * zoomOf, windowOf, axisTop, fightTabs, scrollForSpan, lerp, ease, lerpView, linePath, turnText) are separate from the
 * drawing (hpChart, drawHpChart) so tests check the series, the states, the layout and the selection without a browser.
 */
import { locationLabel, statusOf, type TimelineChip, type TracedFight, planTimeline } from "./battle-plan.ts";
import { roomBarWheel, scrollToShow } from "./battle-layout.ts";
import { stepWrap, type TurnStep, turnSteps } from "./card-turn.ts";
import { el, fmt, fmtCompact, segmented } from "./dom.ts";
import { parsePick, RUN_PICKS, type RunPick } from "../tools/worst-run.ts";

const NS = "http://www.w3.org/2000/svg";

type Life = { hp: number; maxHP: number };

/**
 * Every fighter's HP when the fight begins (0 = the enemy). The trace records life after each action, so the first
 * action's own hits are undone: their first calculation's HP before it, else the HP after it plus the damage, minus
 * the healing. (A map room starts from the HP the last room left.) U70: moved here from Flow 2 (flow2.ts, removed).
 */
export function fightStart(trace: TracedFight): Record<number, Life> {
  const first = trace.actions[0];
  const out: Record<number, Life> = {};
  for (const l of first?.life ?? []) {
    const h = first.hits.find((x) => x.who === l.who);
    const before = h?.calc?.[0]?.hpBefore ?? (h ? l.hp + h.dmg - h.heal : l.hp);
    out[l.who] = { hp: Math.max(0, Math.min(l.maxHP, before)), maxHP: l.maxHP };
  }
  return out;
}

/** A fighter of the chart: `who` as in the trace (0 the enemy, 1-6 the party location). */
export interface HpFighter {
  who: number;
  name: string;
  cls?: number;
}

/** One fought fight: a quest's, or a map run's room (its enemy's name and the room's label). */
export interface HpRun {
  trace: TracedFight;
  enemy: string;
  /** A map room: "1 · Wolf Pack", "Boss · Murlok Monarch"; none for a quest. */
  room?: string;
  /** U65: the enemy fought (its card under the chart): quest id and rare variant. */
  quest?: { id: number; rare: boolean };
}

/** U65: a fighter at the end of one step, as the cards show it. */
export interface FighterState {
  hp: number;
  maxHP: number;
  /** The engine's live stats (Atk … Crit, its effects applied); none from an old trace. */
  stats?: Record<string, number>;
  /** Its live buffs and debuffs. */
  fx: TimelineChip[];
  /** The rotation row (0-4) of the skill it played this turn; null at turn 0, when down or when its action was taken. */
  active: number | null;
}

/** One x position: the fight's start (turn 0) or a turn's end, in one run. */
export interface HpStep {
  run: number;
  turn: number;
  /** "Start", "Turn 3"; a map run prefixes the room: "Boss · Odin, turn 3". */
  label: string;
  /** U65: every fighter in this fight at this step (0 the enemy). */
  states: Record<number, FighterState>;
}

/** HP at one step (null: the fighter is not in this fight). */
export interface HpValue {
  hp: number;
  maxHP: number;
  /** 0-100. */
  pct: number;
}

export interface HpSeries {
  who: number;
  name: string;
  cls?: number;
  enemy: boolean;
  /** One per step. */
  values: (HpValue | null)[];
  /** U65: damage dealt and HP healed during each step (0 at a turn 0; null: not in this fight). U66: what the
   * Damage dealt and Heals tabs draw (no cumulative sums any more). */
  dealt: (number | null)[];
  healed: (number | null)[];
  /** The steps where the fighter fell (HP above 0 at the step before, 0 here). */
  deaths: number[];
}

export interface HpChartData {
  steps: HpStep[];
  series: HpSeries[];
  /** Index of the first step of each run, its turn 0 (a map run's room boundaries; [0] for a quest). U66: a later
   * room's turn 0 shares its x with the step before it (the last room's last turn). */
  runStarts: number[];
  /** U67: each fought run's trace too, so the cards read the very run a step counts (no second filter). */
  runs: { enemy: string; room?: string; quest?: { id: number; rare: boolean }; won: boolean; turns: number; trace: TracedFight }[];
}

/** U65: the chart's tabs, one x axis. */
export type ChartTab = "hp" | "dmg" | "heal";
export const CHART_TABS: { id: ChartTab; label: string }[] = [{ id: "hp", label: "HP" }, { id: "dmg", label: "Damage dealt" }, { id: "heal", label: "Heals" }];

/** "Turn 3" / "Start" inside a sentence: "turn 3"; a map room label ("1 · Wolf Pack, turn 3") keeps its case. */
const lc = (s: string) => (/^(Turn|Start)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const pctOf = (hp: number, maxHP: number) => (maxHP > 0 ? Math.max(0, Math.min(100, (100 * hp) / maxHP)) : 0);
/** The two sides: damage counts only when it crosses them (the enemy on the party, the party on the enemy). */
const side = (w: number) => (w === 0 ? 0 : 1);

type Action = TracedFight["actions"][number];
type Credits = { dealt: Record<number, number>; healed: Record<number, number> };

/**
 * U65: who dealt the damage and the healing of one action, from its calculations (a damage over time is its
 * caster's): damage that landed on a standing fighter of the other side (overkill included, as "dealt"), healing as
 * the HP it really gave back. An old trace without calculations credits the actor.
 */
export function addCredits(c: Credits, a: Action): void {
  const add = (to: Record<number, number>, w: number, v: number) => {
    if (w >= 0 && v > 0) to[w] = (to[w] ?? 0) + v;
  };
  for (const h of a.hits) {
    if (h.calc?.length) {
      for (const x of h.calc) {
        if (x.kind === "dmg") {
          if (!x.missed && x.hpBefore > 0 && side(x.from) !== side(x.to)) add(c.dealt, x.from, x.total);
        } else add(c.healed, x.from, Math.max(0, x.hpAfter - Math.max(0, x.hpBefore)));
      }
    } else {
      if (side(h.who) !== side(a.who)) add(c.dealt, a.who, h.dmg);
      add(c.healed, a.who, h.heal);
    }
  }
}

/** U65: every fighter before the first action: the trace's own record, else (an old trace) the HP Flow 2 starts from. */
function startStates(trace: TracedFight, who: (w: number) => string): Record<number, FighterState> {
  const out: Record<number, FighterState> = {};
  if (trace.start) {
    const fx = statusOf(trace.start.fx, who);
    for (const l of trace.start.life) {
      out[l.who] = { hp: Math.max(0, l.hp), maxHP: l.maxHP, ...(l.stats ? { stats: { ...l.stats } } : {}), fx: fx[l.who] ?? [], active: null };
    }
  } else {
    for (const [w, l] of Object.entries(fightStart(trace))) out[Number(w)] = { hp: l.hp, maxHP: l.maxHP, fx: [], active: null };
  }
  return out;
}

/**
 * The chart's series and the cards' states from the traced fights, in order: each fighter at the fight's start (turn
 * 0) and after the last action of every turn (a turn without actions keeps what it had): HP, live stats, live effects
 * (Flow 2's text, planTimeline), the rotation row it played; and the damage and healing each one did per turn.
 * `fighters`: the heroes to draw (the enemy is always drawn); a hero absent from a run's trace has no value there.
 * Null without a fight to show.
 */
export function hpData(runs: HpRun[], fighters: HpFighter[]): HpChartData | null {
  const fought = runs.filter((r) => r.trace && r.trace.actions.length);
  if (!fought.length) return null;
  const many = fought.length > 1;
  const steps: HpStep[] = [];
  const runStarts: number[] = [];
  const credits: Credits[] = [];
  const names = new Map(fighters.map((f) => [f.who, f.name]));
  fought.forEach((r, k) => {
    runStarts.push(steps.length);
    const room = r.room ?? `Room ${k + 1}`;
    const who = (w: number) => (w ? names.get(w) ?? locationLabel(w) : r.enemy);
    const cur = startStates(r.trace, who);
    // U66: every room has its turn 0 (the state it really starts from: the new enemy at full HP, the heroes'
    // effects gone, a post-battle scroll's heal); chartLayout puts it on the last room's last turn's x.
    steps.push({ run: k, turn: 0, label: many ? `${room}: start` : "Start", states: structuredClone(cur) });
    credits.push({ dealt: {}, healed: {} });
    const timeline = planTimeline(r.trace, [], who);
    const byTurn = new Map<number, Action[]>();
    for (const a of r.trace.actions) {
      if (!byTurn.has(a.turn)) byTurn.set(a.turn, []);
      byTurn.get(a.turn)!.push(a);
    }
    for (let t = 1; t <= r.trace.turns; t++) {
      const c: Credits = { dealt: {}, healed: {} };
      const active: Record<number, number> = {};
      for (const a of byTurn.get(t) ?? []) {
        for (const l of a.life ?? []) {
          const was = cur[l.who];
          cur[l.who] = { hp: Math.max(0, l.hp), maxHP: l.maxHP, ...(l.stats ?? was?.stats ? { stats: { ...(l.stats ?? was!.stats) } } : {}), fx: [], active: null };
        }
        addCredits(c, a);
        // the rotation's row of this turn, when it really acted (a forced skill too; not when stunned or down)
        if (typeof a.did === "string") active[a.who] = (t - 1) % 5;
      }
      const status = timeline.turns[t - 1]?.status ?? {};
      const states: Record<number, FighterState> = {};
      for (const [w, s] of Object.entries(cur)) states[Number(w)] = { ...structuredClone(s), fx: status[Number(w)] ?? [], active: active[Number(w)] ?? null };
      steps.push({ run: k, turn: t, label: many ? `${room}, turn ${t}` : `Turn ${t}`, states });
      credits.push(c);
    }
  });
  const series: HpSeries[] = [{ who: 0, name: many ? "Enemy" : fought[0].enemy, enemy: true },
    ...fighters.filter((f) => f.who > 0).map((f) => ({ who: f.who, name: f.name, cls: f.cls, enemy: false }))]
    .map((f) => {
      const values = steps.map((st): HpValue | null => {
        const s = st.states[f.who];
        return s ? { hp: s.hp, maxHP: s.maxHP, pct: pctOf(s.hp, s.maxHP) } : null;
      });
      const per = (key: "dealt" | "healed") => steps.map((st, i) => (st.states[f.who] ? credits[i][key][f.who] ?? 0 : null));
      const dealt = per("dealt"), healed = per("healed");
      const deaths: number[] = [];
      values.forEach((v, i) => {
        // A fall within a run (a room's turn 1 is checked against its own turn 0: a new enemy, no fall at its start).
        const was = values[i - 1];
        if (v && v.hp <= 0 && was && was.hp > 0 && steps[i].turn > 0) deaths.push(i);
      });
      return { ...f, values, dealt, healed, deaths };
    })
    .filter((s) => s.values.some(Boolean));
  return { steps, series, runStarts,
    runs: fought.map((r) => ({ enemy: r.enemy, room: r.room, ...(r.quest ? { quest: r.quest } : {}), won: r.trace.won, turns: r.trace.turns, trace: r.trace })) };
}

/** U65: the step to show: the one wanted (run and turn) when this fight still has it, else turn 0 (the first room's). */
export function pickStep(d: HpChartData, want: { run: number; turn: number } | null): number {
  const i = want ? d.steps.findIndex((s) => s.run === want.run && s.turn === want.turn) : -1;
  return i < 0 ? 0 : i;
}

/**
 * U76: the step a run switch (Worst / Random / Best) lands on, the turn shown before (`want`) kept: the same fight
 * and turn when the new run has them; past the end of that fight in the new run: its last turn; a fight the new run
 * never reached (a map run that ends sooner): the last fight's last turn. No memory per run: the turn kept is the one
 * shown.
 */
export function clampStep(d: HpChartData, want: { run: number; turn: number }): number {
  const i = d.steps.findIndex((s) => s.run === want.run && s.turn === want.turn);
  if (i >= 0) return i;
  const run = Math.max(0, want.run);
  if (run >= d.runs.length) return d.steps.length - 1;
  const first = d.runStarts[run], last = run + 1 < d.runStarts.length ? d.runStarts[run + 1] - 1 : d.steps.length - 1;
  return want.turn < 0 ? first : last;
}

/**
 * U76: the in-turn step a run switch keeps: the same actor's step in the new run's turn (`who` the actor shown
 * before; its index may differ when someone fell), else null (the turn's end).
 */
export function keepStep(d: HpChartData, i: number, who: number | null): number | null {
  if (who === null) return null;
  const k = stepsOf(d, i).findIndex((s) => s.who === who);
  return k < 0 ? null : k;
}

/** U76: the edge zones' width (px): a horizontal swipe that starts there scrolls the chart (native pan). */
export const EDGE_PX = 28;
type Zone = { at: number; width: number };
/**
 * U76: where the two touch edge zones go over the plot (px from the track's left), at the scroll box's visible left
 * and right edges: `scroll` its scrollLeft, `view` its width, `gutter` the y axis's width in px (the left zone covers
 * what is seen of it, so a swipe on the axis scrolls too). Null when the chart doesn't scroll (or has no width): no
 * zones, a drag anywhere moves the turn cursor. A zone takes at most a quarter of the box.
 */
export function edgeZones(scroll: number, view: number, overflow: boolean, gutter = 0, edge = EDGE_PX): { left: Zone; right: Zone } | null {
  if (!overflow || !(view > 0)) return null;
  const at = Math.max(0, scroll), cap = view / 4, e = Math.min(edge, cap);
  return { left: { at, width: Math.min(cap, Math.max(e, gutter - at)) }, right: { at: at + view - e, width: e } };
}

/** U65: the step a key moves to (←/↓ one back, →/↑ one on, Page Up / Down five, Home, End); null for another key. */
export function stepAfterKey(key: string, at: number, n: number): number | null {
  const to = key === "ArrowLeft" || key === "ArrowDown" ? at - 1 : key === "ArrowRight" || key === "ArrowUp" ? at + 1
    : key === "PageDown" ? at - 5 : key === "PageUp" ? at + 5 : key === "Home" ? 0 : key === "End" ? n - 1 : null;
  return to === null ? null : Math.max(0, Math.min(n - 1, to));
}


/**
 * The chart's frame in viewBox units. U65: full width, so the width is the box's own in CSS pixels (drawHpChart; 360
 * without a layout), the height fixed: the text keeps its size from a 375 px phone to a wide screen. U66: wider than
 * that when the fight tabs need it (chartLayout), then 1 unit = 1 px and the chart scrolls sideways.
 */
export const HP_W = 360, HP_H = 200;
const M = { l: 38, r: 10, t: 16, b: 24 };
const PH = HP_H - M.t - M.b;
/** U65: the viewBox width for a box `px` wide (its padding off), between a phone's and a wide screen's. */
export const chartWidth = (px: number): number => (px > 0 ? Math.max(300, Math.min(1600, Math.round(px - 26))) : HP_W);

/** U66: a fight tab's name: the map room ("1 · Wolf Pack", "Boss · Odin"), or a quest's enemy. */
export const fightName = (d: HpChartData, k: number): string =>
  (d.runs.length > 1 ? d.runs[k].room ?? `Room ${k + 1}` : d.runs[k].enemy);
/** U66: the px a fight tab needs for its name (about 7 px a character at the tab's 0.78rem, and its padding). */
export const fightTabWidth = (name: string): number => Math.ceil([...name].length * 7) + 18;

/** U66: each fight's px per turn and its tab's place (left from the plot's left edge, width) in viewBox units. */
export interface FightLayout {
  /** px per turn, per fight. */
  perTurn: number[];
  spans: { left: number; width: number }[];
  /** The plot's width (the fights side by side). */
  plot: number;
  /** Wider than the room there is: the chart scrolls sideways. */
  overflow: boolean;
}

/**
 * U68: the least px a turn gets: what every step had before U66 (973f49a: the plot's width shared evenly by all the
 * run's turns, a map run's rooms one after the other).
 */
export const minTurnWidth = (turns: number, room: number): number => room / Math.max(1, turns);

/**
 * U66: the fights side by side over `room` px. U68: every turn gets at least minTurnWidth (the even share), so a
 * 13-turn fight is wider than a 5-turn one; a fight whose tab name (`tab` px) is wider than its turns widens its turns
 * until the name fits, and the plot is then wider than `room` (`overflow`: the chart scrolls). U66 squeezed the other
 * fights instead.
 */
export function fightLayout(fights: { turns: number; tab: number }[], room: number): FightLayout {
  const min = minTurnWidth(fights.reduce((n, f) => n + Math.max(1, f.turns), 0), room);
  const perTurn = fights.map((f) => Math.max(min, f.tab / Math.max(1, f.turns)));
  const spans: { left: number; width: number }[] = [];
  let at = 0;
  for (const [k, f] of fights.entries()) {
    const width = Math.max(1, f.turns) * perTurn[k];
    spans.push({ left: at, width });
    at += width;
  }
  return { perTurn, spans, plot: at, overflow: at > room + 0.5 };
}

/** U68: the zoom that applies: a fight of a map run (a quest is one fight, nothing to zoom on); else null, "All". */
export const zoomOf = (d: HpChartData, zoom: number | null | undefined): number | null =>
  (zoom != null && d.runs.length > 1 && zoom >= 0 && zoom < d.runs.length ? zoom : null);

/** U66: fightLayout for a chart `width` units wide, with each step's x (viewBox units) and the whole width `W`. */
export interface ChartLayout extends FightLayout {
  W: number;
  xs: number[];
  /** U68: the fight zoomed on (zoomOf), null: All. */
  zoom: number | null;
}
/**
 * U66: the steps' x. U68: zoomed on a fight (`zoom`), that fight fills the plot (turn 0 on its left edge, its last turn
 * on its right), never wider than the box; the other fights keep their places on the same scale, off the plot to the
 * left and the right (clipped), so a zoom slides them out of view.
 */
export function chartLayout(d: HpChartData, width = HP_W, zoom: number | null = null): ChartLayout {
  const room = Math.max(1, width - M.l - M.r);
  const turns = d.runs.map((r) => Math.max(1, r.turns));
  const z = zoomOf(d, zoom);
  let f: FightLayout;
  if (z === null) f = fightLayout(d.runs.map((_, k) => ({ turns: turns[k], tab: fightTabWidth(fightName(d, k)) })), room);
  else {
    const per = room / turns[z];
    let at = -turns.slice(0, z).reduce((n, t) => n + t, 0) * per;
    const spans = turns.map((t) => {
      const s = { left: at, width: t * per };
      at += t * per;
      return s;
    });
    f = { perTurn: turns.map(() => per), spans, plot: room, overflow: false };
  }
  // a room's turn 0 sits where the room before ends (its last turn): the same x
  const xs = d.steps.map((s) => M.l + f.spans[s.run].left + s.turn * f.perTurn[s.run]);
  return { ...f, W: f.overflow ? Math.ceil(M.l + f.plot + M.r) : width, xs, zoom: z };
}

/** U68: the steps a view shows, first and last: the zoomed fight's (its turn 0 to its last turn), or all (All). */
export function windowOf(d: HpChartData, zoom: number | null): [number, number] {
  const z = zoomOf(d, zoom);
  if (z === null) return [0, d.steps.length - 1];
  return [d.runStarts[z], z + 1 < d.runStarts.length ? d.runStarts[z + 1] - 1 : d.steps.length - 1];
}

/**
 * U68: the y axis's top: the largest value drawn in the view (windowOf: the zoomed fight, or the whole run in All, a
 * sideways scroll changing nothing), so the plot uses its full height. Nothing drawn: 100 (HP) or 10.
 */
export function axisTop(d: HpChartData, tab: ChartTab, zoom: number | null = null): number {
  const [lo, hi] = windowOf(d, zoom);
  let m = 0;
  for (const s of d.series) {
    const p = plotted(d, s, tab);
    for (let i = lo; i <= hi; i++) if (p[i] !== null && p[i]! > m) m = p[i]!;
  }
  return m > 0 ? m : tab === "hp" ? 100 : 10;
}

/**
 * U68: the fight tabs to show: one per fight (All, or a quest's one fight); zoomed on a map room, "All" (run null)
 * first, then that room's tab.
 */
export function fightTabs(d: HpChartData, zoom: number | null): { run: number | null; label: string }[] {
  const z = zoomOf(d, zoom);
  if (z === null) return d.runs.map((_, k) => ({ run: k, label: fightName(d, k) }));
  return [{ run: null, label: "All" }, { run: z, label: fightName(d, z) }];
}

/** U68: the scroll (units) that centres a span (`left`, `width`) in a view `view` wide over a chart `total` wide. */
export const scrollForSpan = (left: number, width: number, total: number, view: number): number =>
  Math.max(0, Math.min(Math.max(0, total - view), left + width / 2 - view / 2));

/** U68: one frame of the plot: its viewBox width, each step's x and the y axis's top. */
export interface ChartView {
  W: number;
  xs: number[];
  top: number;
}
/** U68: the animation's straight-line interpolation, `t` 0 (`a`) to 1 (`b`). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** U68: the animation's easing (out, cubic), 0 → 0 and 1 → 1. */
export const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);
/** U68: a frame between two views (every x, the top and the width lerped). */
export const lerpView = (a: ChartView, b: ChartView, t: number): ChartView =>
  ({ W: lerp(a.W, b.W, t), xs: a.xs.map((x, i) => lerp(x, b.xs[i] ?? x, t)), top: lerp(a.top, b.top, t) });
/** U68: the zoom's and the axis's animation, ms (none when the system asks for reduced motion). */
export const CHART_ANIM_MS = 250;

/**
 * U68: an SVG path through the points (`ys` in viewBox units, null: no point, a gap). At a step of `breaks` the line
 * starts again (a move, no segment from the point before): a map room's turn 0 for the enemy, a fresh enemy, so its
 * line ends at the fallen one's 0 and starts again at 100 % on the same x, with no vertical segment between.
 */
export function linePath(xs: number[], ys: (number | null)[], breaks: readonly number[] = []): string {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  let path = "", open = false;
  ys.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    path += `${open && !breaks.includes(i) ? "L" : "M"}${r1(xs[i])},${r1(v)}`;
    open = true;
  });
  return path;
}

/**
 * U65: the step nearest to `vx` (viewBox units) among the steps at `xs` (chartLayout). U66: two steps on one x (a
 * room's last turn and the next room's turn 0): the later one, the next room's turn 0. U68: only the steps `lo` to
 * `hi` (a zoomed fight's, windowOf: its turn 0 on its left edge, not the room before's last turn).
 */
export function nearestStep(vx: number, xs: number[], lo = 0, hi = xs.length - 1): number {
  let best = lo;
  for (let i = lo + 1; i <= hi; i++) if (Math.abs(xs[i] - vx) <= Math.abs(xs[best] - vx)) best = i;
  return best;
}

/** U68: the turn control's text: "Turn 3"; a map run names the room short: "Room 2 · Turn 3", "Boss · Turn 0". */
export function turnText(d: HpChartData, i: number): string {
  const st = d.steps[i];
  if (d.runs.length < 2) return `Turn ${st.turn}`;
  const head = (d.runs[st.run].room ?? `Room ${st.run + 1}`).split(" · ")[0];
  return `${/^\d+$/.test(head) ? `Room ${head}` : head} · Turn ${st.turn}`;
}

/** U73: the steps of chart step `i`'s turn (its run's trace; turn 0: none). */
export const stepsOf = (d: HpChartData, i: number): TurnStep[] =>
  d.steps[i] ? turnSteps(d.runs[d.steps[i].run]?.trace ?? { actions: [] }, d.steps[i].turn) : [];

/** U73: a fighter's name in run `run`: a hero's legend name, the run's own enemy (a map room's). */
export function actorName(d: HpChartData, run: number, who: number): string {
  if (!who) return d.runs[run]?.enemy ?? "Enemy";
  return d.series.find((s) => s.who === who)?.name ?? locationLabel(who);
}

/** U73: the step control's text at chart step `i`, step `k` (null: the last): the actor and "k/n"; null without steps. */
export function stepText(d: HpChartData, i: number, k: number | null): { name: string; count: string } | null {
  const steps = stepsOf(d, i);
  if (!steps.length) return null;
  const at = k === null || k < 0 || k >= steps.length ? steps.length - 1 : k;
  return { name: actorName(d, d.steps[i].run, steps[at].who), count: `${at + 1}/${steps.length}` };
}

/** The one-sentence summary of the HP tab (U65: the plot's description; also per tab, chartSummary). */
export function hpSummary(d: HpChartData): string {
  return chartSummary(d, "hp");
}

/** U65: each tab's summary: HP with the falls; damage dealt or heals per turn, with every fighter's total. */
export function chartSummary(d: HpChartData, tab: ChartTab): string {
  const turns = d.runs.reduce((n, r) => n + r.turns, 0);
  const span = d.runs.length > 1 ? `over ${d.runs.length} rooms, ${turns} turns in all` : `over ${turns} turn${turns === 1 ? "" : "s"}`;
  if (tab === "hp") {
    const falls = d.series.flatMap((s) => s.deaths.map((i) => `${s.name} falls (${lc(d.steps[i].label)})`));
    const head = d.runs.length > 1 ? `HP as a share of max HP ${span}` : `HP as a share of max HP ${span}, ${d.runs[0].won ? "won" : "lost"}`;
    return `${head}. ${falls.length ? `${falls.join("; ")}.` : "Nobody falls."}`;
  }
  const what = tab === "dmg" ? "Damage dealt" : "HP healed";
  return `${what} per turn ${span}; in all: ${d.series.map((s) => `${s.name} ${fmt.format(total(s, tab))}`).join(", ")}.`;
}

/** A fighter's damage dealt or healing over all the steps. */
const total = (s: HpSeries, tab: ChartTab) => (tab === "dmg" ? s.dealt : s.healed).reduce<number>((a, v) => a + (v ?? 0), 0);

/**
 * U66: the y values a tab draws for a fighter, one per step (null: no point). HP %, or that turn's damage dealt or
 * healing (not added up). No point while the fighter is down: its fall is its last point, until the trace has it
 * standing again; nor where it is not in the fight. A later room's turn 0, on the last room's last turn's x, repeats
 * that point on the damage and heals tabs (nobody acts at a turn 0), so the line goes straight on; on the HP tab it is
 * the room's start (the enemy's fresh 100 %; U68: its line starts again there, linePath).
 */
export function plotted(d: HpChartData, s: HpSeries, tab: ChartTab): (number | null)[] {
  const out: (number | null)[] = [];
  s.values.forEach((v, i) => {
    if (!v || (v.hp <= 0 && !s.deaths.includes(i))) {
      out.push(null);
      return;
    }
    const st = d.steps[i];
    const own = (tab === "dmg" ? s.dealt : s.healed)[i] ?? 0;
    out.push(tab === "hp" ? v.pct : st.turn === 0 && st.run > 0 && out[i - 1] != null ? out[i - 1] : own);
  });
  return out;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

const hpText = (v: HpValue | null) => (v ? `${fmt.format(v.hp)} / ${fmt.format(v.maxHP)}${v.hp <= 0 ? " ✝" : ""}` : "—");
const seriesClass = (s: HpSeries) => (s.enemy ? "hp-enemy" : `cls-${s.cls ?? 0}`);
/** A table or readout cell: the HP, or that turn's damage dealt or healing (U66: per turn). */
const cellText = (s: HpSeries, tab: ChartTab, i: number) => {
  if (tab === "hp") return hpText(s.values[i]);
  const v = (tab === "dmg" ? s.dealt : s.healed)[i];
  return v === null ? "—" : fmt.format(v);
};

/** A y axis label: HP in % (the top is 100 % but for an odd window), an amount compact (whole from 20 up). */
const axisText = (tab: ChartTab, v: number, top: number) =>
  (tab === "hp" ? `${Math.round(v)}%` : fmtCompact.format(top >= 20 ? Math.round(v) : v));

/**
 * x ticks: round turn numbers in each fight, at least 28 px apart (U66: each fight on its own scale, the fight tabs
 * name them; a later room's turn 0 has no tick, its x is the last room's last turn). U68: as step indexes (the
 * animation moves them with their steps); zoomed, the zoomed fight's only, its turn 0 included.
 */
function ticks(d: HpChartData, L: ChartLayout): { i: number; text: string }[] {
  const out: { i: number; text: string }[] = [];
  let last = -Infinity;
  d.runs.forEach((r, k) => {
    if (L.zoom !== null && k !== L.zoom) return;
    const every = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * L.perTurn[k] >= 28) ?? 200;
    for (let t = k && L.zoom === null ? every : 0; t <= r.turns; t += every) {
      const i = d.runStarts[k] + t, x = L.xs[i];
      if (x - last >= 20) {
        out.push({ i, text: String(t) });
        last = x;
      }
    }
  });
  return out;
}

/** U65: the marker's text: "Turn 3" (a map run: the room's turn). */
const selText = (st: HpStep) => `Turn ${st.turn}`;

export interface ChartOptions {
  tab?: ChartTab;
  /** The selected step (the cards' turn). */
  selected?: number;
  onSelect?: (i: number) => void;
  onTab?: (tab: ChartTab) => void;
  tableOpen?: boolean;
  /** The viewBox width (chartWidth). */
  width?: number;
  /** U68: the map room zoomed on (its run index), null or none: All. */
  zoom?: number | null;
  onZoom?: (zoom: number | null) => void;
  /** U73: the step within the selected turn (its index in stepsOf), null or none: the last (the turn's end). */
  step?: number | null;
  /** U73: a step arrow picked step `k` of the selected turn (a turn picked says onSelect: its last step). */
  onStep?: (k: number) => void;
  /** U74: the run picker (Worst / Random / Best) in the chart's head, the Simulator only; none: no picker. */
  pick?: RunPickOption | null;
}

/** U74: the run picker's value and what hears a new one. */
export interface RunPickOption { value: RunPick; onPick: (p: RunPick) => void }

/**
 * U74: which of the runs the chart shows (`.hp-pick`, a segmented control: radios, so the arrow keys move the choice
 * and Tab enters on the checked one), beside the HP · Damage dealt · Heals tabs.
 */
export function runPicker(p: RunPickOption): HTMLElement {
  const seg = segmented("hp-run-pick", "Run shown", RUN_PICKS.map((r) => ({ value: r.id, label: r.label })), p.value,
    (v) => p.onPick(parsePick(v)));
  seg.classList.add("hp-pick");
  return seg;
}

/** U66: each drawn chart's "bring this into view" (drawHpChart calls it once the chart is in the page; U76: it also places the edge zones). */
const revealers = new WeakMap<HTMLElement, (smooth: boolean, move: boolean) => void>();
const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = (): ScrollBehavior => (reducedMotion() ? "auto" : "smooth");
const setOff = (b: Element, off: boolean) => (off ? b.setAttribute("disabled", "") : b.removeAttribute("disabled"));
let clipSeq = 0;

/**
 * The chart: the HP · Damage dealt · Heals tabs, the fight tabs over the plot (a slider over the steps), U68 the
 * `‹ Turn X ›` control centred under it, the legend (U66: colour and name only), a pointer readout and the table fold.
 * U68: a map run zooms on one room (a fight tab, or a click in the plot in All) and back (All), animated.
 */
export function hpChart(d: HpChartData, o: ChartOptions = {}): HTMLElement {
  const tab = o.tab ?? "hp";
  const width = o.width ?? HP_W;
  const n = d.steps.length;
  let sel = Math.max(0, Math.min(n - 1, o.selected ?? 0));
  // U73: the step within the turn; null: the last one (the turn's end, where a turn picked lands)
  let sub: number | null = o.step ?? null;
  // U68: a zoom is on the selected turn's room (a stale one gives way to All)
  let zoom = zoomOf(d, o.zoom);
  if (zoom !== null && d.steps[sel].run !== zoom) zoom = null;
  let L = chartLayout(d, width, zoom);
  let tickList = ticks(d, L);
  let view: ChartView = { W: L.W, xs: L.xs, top: axisTop(d, tab, zoom) };
  const lines = new Map(d.series.map((s) => [s, plotted(d, s, tab)]));
  // U68: the enemy's line starts again at each later room's turn 0 (a fresh enemy): no segment from the last one's 0
  const breaks = d.runStarts.slice(1);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pc = (v: number) => `${r1((100 * v) / L.W)}%`;
  const summary = chartSummary(d, tab);
  const plot = svg("svg", { viewBox: `0 0 ${L.W} ${HP_H}`, class: `hp-svg tab-${tab}`, role: "slider", tabindex: 0, "aria-label": "Turn",
    "aria-describedby": "hp-sum", "aria-valuemin": 0, "aria-valuemax": n - 1 });
  // U68: the steps off the plot (a zoom, its animation) are clipped: the plot's width and its tick labels
  const clipId = `hp-clip-${++clipSeq}`;
  const clipRect = svg("rect", { x: M.l - 8, y: 0, width: 0, height: HP_H });
  const dyn = svg("g", { class: "hp-dyn" });
  const ordered = [...d.series.filter((s) => s.enemy), ...d.series.filter((s) => !s.enemy)];
  // Pointer readout: the nearest step's values for every fighter (a tap on a phone; the table has the same for keyboards).
  const guide = svg("line", { class: "hp-guide", x1: 0, x2: 0, y1: M.t, y2: M.t + PH, visibility: "hidden" });
  plot.append(svg("defs", {}, svg("clipPath", { id: clipId }, clipRect)), dyn, guide);
  // U66: the fight tabs, each over its fight's turns (fightLayout). U68: zoomed, "All" then the room's tab.
  const fights = el("div", { class: "hp-fights", role: "group", "aria-label": "Fights" });
  // U68: ‹ Turn X ›, disabled at the ends.
  const stepBtn = (dir: -1 | 1) => {
    const label = dir < 0 ? "Previous turn" : "Next turn";
    const b = el("button", { type: "button", class: "secondary hp-step", "data-dir": String(dir), "aria-label": label, title: label },
      svg("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false" },
        svg("path", { d: dir < 0 ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5", fill: "none", stroke: "currentColor", "stroke-width": 2,
          "stroke-linecap": "round", "stroke-linejoin": "round" })));
    b.addEventListener("click", () => {
      const to = sel + dir;
      if (to >= 0 && to < n) choose(to);
    });
    return b;
  };
  const prev = stepBtn(-1), next = stepBtn(1);
  const turnLabel = el("span", { class: "hp-turn-text", "aria-live": "polite" });
  const turnBox = el("div", { class: "hp-turn", role: "group", "aria-label": "Selected turn" }, prev, turnLabel, next);
  // U73: ‹ <actor> k/n ›, the selected turn's actions in game order, wrapping; disabled without any (turn 0).
  const actBtn = (dir: -1 | 1) => {
    const label = dir < 0 ? "Previous action" : "Next action";
    const b = el("button", { type: "button", class: "secondary hp-step hp-act-step", "data-act": String(dir), "aria-label": label, title: label },
      svg("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false" },
        svg("path", { d: dir < 0 ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5", fill: "none", stroke: "currentColor", "stroke-width": 2,
          "stroke-linecap": "round", "stroke-linejoin": "round" })));
    b.addEventListener("click", () => {
      const m = stepsOf(d, sel).length;
      if (!m) return;
      sub = stepWrap(sub ?? m - 1, dir, m);
      paint();
      o.onStep?.(sub);
    });
    return b;
  };
  const actPrev = actBtn(-1), actNext = actBtn(1);
  const actName = el("span", { class: "hp-act-name" }), actCount = el("span", { class: "hp-act-count" });
  const actLabel = el("span", { class: "hp-turn-text hp-act-text", "aria-live": "polite" }, actName, actCount);
  const actBox = el("div", { class: "hp-act", role: "group", "aria-label": "Selected action" }, actPrev, actLabel, actNext);
  const nav = el("div", { class: "hp-nav" }, turnBox, actBox);
  // U66: the scroll box: the fight tabs and the plot, one width (W px when wider than the box: 1 unit = 1 px).
  const track = el("div", { class: "hp-track" });
  const scroller = el("div", { class: "hp-scroll" }, track);
  // U76: two touch edge zones over the plot, at the box's visible edges (edgeZones): `touch-action: pan-x pan-y`
  // there, so a swipe that starts on them scrolls the chart natively; a tap or a mouse on them acts as on the plot.
  const edgeL = el("div", { class: "hp-edge", "aria-hidden": "true", hidden: "" });
  const edgeR = el("div", { class: "hp-edge", "aria-hidden": "true", hidden: "" });
  const placeEdges = () => {
    const z = edgeZones(scroller.scrollLeft || 0, scroller.clientWidth || 0, L.overflow && zoom === null, M.l);
    for (const [e, at] of [[edgeL, z?.left], [edgeR, z?.right]] as const) {
      e.hidden = !at;
      if (at) {
        e.style.left = `${r1(at.at)}px`;
        e.style.width = `${r1(at.width)}px`;
      }
    }
  };
  scroller.addEventListener("scroll", placeEdges, { passive: true });
  const setOverflow = () => {
    scroller.classList.toggle("overflow", L.overflow);
    if (L.overflow) track.style.width = `${L.W}px`;
    else if (track.style.width) track.style.width = "";
    placeEdges();
  };
  const revealSpan = (left: number, w: number, smooth: boolean) => {
    if (zoom !== null || !L.overflow || !(scroller.clientWidth > 0)) return;
    const k = (track.clientWidth || L.W) / L.W;
    const to = scrollToShow(scroller, left * k, w * k, 24);
    if (to !== null) scroller.scrollTo({ left: to, behavior: smooth ? motion() : "auto" });
  };
  const reveal = (smooth: boolean) => revealSpan(L.xs[sel] - 4, 8, smooth);
  // the mouse wheel moves a chart wider than its box sideways while it can (the map room bar's rule)
  scroller.addEventListener("wheel", (e: Event) => {
    const dx = roomBarWheel(e as WheelEvent, scroller);
    if (!dx) return;
    e.preventDefault();
    scroller.scrollLeft += dx;
  }, { passive: false });

  /** Draws the current frame (`view`): grid, ticks, room lines, the lines, falls, the marker; and the controls' state. */
  const paint = () => {
    const { W, xs, top } = view;
    const y = (v: number) => M.t + PH * (1 - v / top);
    plot.setAttribute("viewBox", `0 0 ${r1(W)} ${HP_H}`);
    clipRect.setAttribute("width", String(r1(W - M.r - M.l + 16)));
    const axis: SVGElement[] = [];
    // Grid: five lines, 0 to the top (U68: the top is the view's largest value).
    for (const p of [0, 25, 50, 75, 100]) {
      const v = (top * p) / 100;
      axis.push(svg("line", { class: "hp-grid", x1: M.l, x2: r1(W - M.r), y1: r1(y(v)), y2: r1(y(v)) }),
        svg("text", { class: "hp-axis", x: M.l - 4, y: r1(y(v) + 3.5), "text-anchor": "end" }, axisText(tab, v, top)));
    }
    const inner = svg("g", { "clip-path": `url(#${clipId})` });
    for (const t of tickList) inner.append(svg("text", { class: "hp-axis", x: r1(xs[t.i]), y: HP_H - 8, "text-anchor": "middle" }, t.text));
    // Room boundaries (a map run): a dashed line on the x a room's last turn and the next room's turn 0 share.
    for (const i of breaks) inner.append(svg("line", { class: "hp-room", x1: r1(xs[i]), x2: r1(xs[i]), y1: M.t, y2: M.t + PH }));
    // The lines: the enemy first (under the heroes); a gap where a fighter is down or not in the fight (plotted).
    for (const s of ordered) {
      const path = linePath(xs, lines.get(s)!.map((v) => (v === null ? null : y(v))), s.enemy ? breaks : []);
      if (path) inner.append(svg("path", { class: `hp-line ${seriesClass(s)}`, d: path }));
    }
    // Falls (the HP tab): a cross at 0, its title saying who and when.
    if (tab === "hp") {
      for (const s of ordered) {
        for (const i of s.deaths) {
          const cx = r1(xs[i]), cy = r1(y(0));
          inner.append(svg("path", { class: `hp-death ${seriesClass(s)}`, d: `M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx - 4},${cy + 4}L${cx + 4},${cy - 4}` },
            svg("title", {}, `${s.name} falls: ${lc(d.steps[i].label)}`)));
        }
      }
    }
    // U65: the selected turn: a marker line with the turn's number at its top.
    const at = r1(xs[sel]);
    inner.append(svg("line", { class: "hp-sel", x1: at, x2: at, y1: M.t, y2: M.t + PH }),
      svg("text", { class: "hp-sel-label", x: at, y: M.t - 4, "text-anchor": at < M.l + 24 ? "start" : at > W - M.r - 24 ? "end" : "middle" },
        selText(d.steps[sel])));
    dyn.replaceChildren(...axis, inner);
    plot.setAttribute("aria-valuenow", String(sel));
    plot.setAttribute("aria-valuetext", d.steps[sel].label);
    for (const b of fights.querySelectorAll("button[data-run]")) {
      if (Number(b.getAttribute("data-run")) === d.steps[sel].run) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
    turnLabel.textContent = turnText(d, sel);
    // U73: the step: its actor and k/n ("–" at turn 0), the arrows off without steps
    const st = stepText(d, sel, sub);
    actName.textContent = st ? st.name : "–";
    actCount.textContent = st ? ` ${st.count}` : "";
    actBox.setAttribute("title", st ? `${st.name}, action ${st.count}` : "No action");
    setOff(actPrev, !st);
    setOff(actNext, !st);
    // a button that reaches its end gives the focus to the other one
    const active = (globalThis.document as Document | undefined)?.activeElement;
    setOff(prev, sel <= 0);
    setOff(next, sel >= n - 1);
    if (active === prev && sel <= 0) next.focus();
    if (active === next && sel >= n - 1) prev.focus();
  };

  // U68: the animation (requestAnimationFrame, CHART_ANIM_MS, eased lerp; at once under reduced motion or without
  // frames). A new one first ends the one running, at its last frame.
  let anim: { id: number; end: () => void } | null = null;
  const finish = () => {
    if (!anim) return;
    const a = anim;
    anim = null;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(a.id);
    a.end();
  };
  const animate = (a: ChartView, b: ChartView, done?: () => void) => {
    finish();
    const end = () => {
      view = b;
      paint();
      done?.();
    };
    if (reducedMotion() || typeof requestAnimationFrame !== "function") return end();
    let t0 = -1;
    const frame = (now: number) => {
      if (!anim) return;
      if (t0 < 0) t0 = now;
      const t = (now - t0) / CHART_ANIM_MS;
      if (t >= 1) {
        anim = null;
        end();
        return;
      }
      view = lerpView(a, b, ease(t));
      paint();
      anim.id = requestAnimationFrame(frame);
    };
    view = a;
    paint();
    anim = { id: requestAnimationFrame(frame), end };
  };

  const buildTabs = () => {
    fights.classList.toggle("zoomed", L.zoom !== null);
    fights.replaceChildren(...fightTabs(d, L.zoom).map((t) => {
      if (t.run === null) {
        const b = el("button", { type: "button", class: "hp-fight hp-all", title: "All fights" }, t.label);
        b.style.left = "0%";
        b.style.width = pc(M.l - 2);
        b.addEventListener("click", () => setZoom(null));
        return b;
      }
      const k = t.run;
      const b = el("button", { type: "button", class: `hp-fight${d.runs[k].room?.startsWith("Boss") ? " boss" : ""}`, "data-run": String(k), title: t.label },
        t.label);
      b.style.left = pc(M.l + L.spans[k].left);
      b.style.width = pc(L.spans[k].width);
      b.addEventListener("click", () => {
        setZoom(k);
        if (d.steps[sel].run !== k) choose(d.runStarts[k]);
      });
      return b;
    }));
  };

  /**
   * U68: zoom on a map room (`to`) or back to All (null), animated. In: from the first frame the plot is the box's
   * width, the run starting from what was in view, sliding to the room over the whole plot. Out: sliding to the whole
   * run as it will be in view (the room centred when the run is wider than the box), then the scroll box takes the
   * run's width and that scroll.
   */
  const setZoom = (want: number | null) => {
    const to = zoomOf(d, want);
    finish();
    if (to === zoom) return;
    const was = L, from = view;
    const k = (track.clientWidth || was.W) / was.W;
    const scroll = was.overflow ? (scroller.scrollLeft || 0) / k : 0;
    zoom = to;
    o.onZoom?.(to);
    const nextL = chartLayout(d, width, to);
    const top = axisTop(d, tab, to);
    if (to !== null) {
      L = nextL;
      tickList = ticks(d, L);
      setOverflow();
      buildTabs();
      animate({ W: width, xs: from.xs.map((x) => x - scroll), top: from.top }, { W: width, xs: nextL.xs, top });
      return;
    }
    const z = was.zoom ?? 0;
    const off = nextL.overflow ? scrollForSpan(M.l + nextL.spans[z].left, nextL.spans[z].width, nextL.W, width) : 0;
    tickList = ticks(d, nextL);
    animate(from, { W: width, xs: nextL.xs.map((x) => x - off), top }, () => {
      L = nextL;
      setOverflow();
      buildTabs();
      view = { W: L.W, xs: L.xs, top };
      paint();
      if (off) scroller.scrollLeft = off * ((track.clientWidth || L.W) / L.W);
    });
  };

  const choose = (i: number) => {
    if (i === sel) return;
    sel = i;
    sub = null; // U73: a turn picked shows its end, its last step
    // U68: zoomed, the zoom follows the turn into another room (the keys, ‹ ›)
    if (zoom !== null && d.steps[i].run !== zoom) setZoom(d.steps[i].run);
    paint();
    reveal(true);
    o.onSelect?.(i);
  };
  setOverflow();
  buildTabs();
  paint();

  const readout = el("div", { class: "hp-readout", "aria-hidden": "true", hidden: "" });
  const show = (i: number) => {
    const x = view.xs[i];
    guide.setAttribute("x1", String(x));
    guide.setAttribute("x2", String(x));
    guide.setAttribute("visibility", "visible");
    readout.replaceChildren(el("strong", {}, d.steps[i].label),
      ...d.series.map((s) => el("div", { class: `hp-ro-row ${seriesClass(s)}` }, el("span", { class: "hp-swatch" }),
        `${s.enemy && d.runs.length > 1 ? d.runs[d.steps[i].run].enemy : s.name} ${cellText(s, tab, i)}`)));
    readout.hidden = false;
    readout.style.setProperty("--hp-at", `${(100 * x) / view.W}%`);
    readout.classList.toggle("flip", x > view.W / 2);
  };
  const hide = () => {
    guide.setAttribute("visibility", "hidden");
    readout.hidden = true;
  };
  const stepOf = (clientX: number): number | null => {
    const box = plot.getBoundingClientRect();
    if (!box.width) return null;
    const [lo, hi] = windowOf(d, zoom);
    return nearestStep(((clientX - box.left) / box.width) * view.W, view.xs, lo, hi);
  };
  const onMove = (e: Event) => {
    const i = stepOf((e as PointerEvent).clientX);
    if (i !== null) show(i);
  };
  // U65: a click or a tap picks the turn; the keys move it. U68: in All, a click also zooms on the turn's room.
  const onClick = (e: Event) => {
    const i = stepOf((e as MouseEvent).clientX);
    if (i === null) return;
    if (zoom === null) setZoom(d.steps[i].run);
    choose(i);
  };
  // U76: the edge zones hear the same (a swipe started there pans instead: no click, the browser cancels the pointer)
  for (const t of [plot, edgeL, edgeR]) {
    t.addEventListener("pointermove", onMove);
    t.addEventListener("pointerleave", hide);
    t.addEventListener("click", onClick);
  }
  // as a click on the plot focuses it (the keys then move the turn)
  for (const t of [edgeL, edgeR]) t.addEventListener("click", () => plot.focus({ preventScroll: true }));
  plot.addEventListener("keydown", (e: Event) => {
    const k = e as KeyboardEvent;
    const i = stepAfterKey(k.key, sel, n);
    if (i === null) return;
    k.preventDefault();
    choose(i);
  });
  track.append(fights, el("div", { class: "hp-plot" }, plot, edgeL, edgeR, readout));
  // U66: the legend: each fighter's colour and name, nothing else.
  const legend = el("ul", { class: "hp-legend" }, ...d.series.map((s) =>
    el("li", { class: seriesClass(s) }, el("span", { class: "hp-swatch", "aria-hidden": "true" }), el("span", { class: "hp-name" }, s.name))));
  // The table fold (screen readers, keyboards, exact values): one row per step, one column per fighter.
  const what = tab === "hp" ? "HP" : tab === "dmg" ? "Damage dealt per turn" : "HP healed per turn";
  const table = el("table", { class: "hp-table" },
    el("caption", { class: "visually-hidden" }, `${what}, every fighter, by turn`),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, d.runs.length > 1 ? "Room, turn" : "Turn"),
      ...d.series.map((s) => el("th", { scope: "col" }, s.name)))),
    el("tbody", {}, ...d.steps.map((st, i) => el("tr", {}, el("th", { scope: "row" }, st.label),
      ...d.series.map((s) => el("td", {}, cellText(s, tab, i)))))));
  const fold = el("details", { class: "hp-fold", ...(o.tableOpen ? { open: "" } : {}) }, el("summary", {}, "Table"), el("div", { class: "table-wrap" }, table));
  // U65: the tabs (the tablist keys: ← → Home End).
  const tabs = el("div", { class: "hp-tabs", role: "tablist", "aria-label": "Chart" }, ...CHART_TABS.map((t) => {
    const b = el("button", { type: "button", role: "tab", class: "hp-tab", "data-tab": t.id, "aria-selected": String(t.id === tab),
      "aria-controls": "hp-panel", tabindex: t.id === tab ? "0" : "-1" }, t.label);
    b.addEventListener("click", () => {
      if (t.id !== tab) o.onTab?.(t.id);
    });
    return b;
  }));
  tabs.addEventListener("keydown", (e: Event) => {
    const k = (e as KeyboardEvent).key;
    const at = CHART_TABS.findIndex((t) => t.id === tab), last = CHART_TABS.length - 1;
    const to = k === "ArrowRight" ? (at + 1) % CHART_TABS.length : k === "ArrowLeft" ? (at + last) % CHART_TABS.length : k === "Home" ? 0 : k === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    o.onTab?.(CHART_TABS[to].id);
  });
  const fig = el("figure", { class: "hp-chart" }, el("div", { class: "hp-head" }, tabs, ...(o.pick ? [runPicker(o.pick)] : [])),
    el("div", { id: "hp-panel", role: "tabpanel", "aria-label": CHART_TABS.find((t) => t.id === tab)!.label },
      el("p", { id: "hp-sum", class: "visually-hidden" }, summary), scroller, nav, legend, fold));
  revealers.set(fig, (smooth, move) => {
    if (move) reveal(smooth);
    placeEdges();
  });
  return fig;
}

/** Before a fight can be traced: one muted line. */
export const HP_EMPTY = "HP by turn: shown once the party can fight.";

/** U65: the open tab, kept for this page view (a redraw after an edit keeps it). */
let tabNow: ChartTab = "hp";
export const chartTab = (): ChartTab => tabNow;

/**
 * U70: a click or a tap in the chart (the plot, a tab, ‹ ›) draws no focus ring, a key does: the box carries
 * `data-pointer` from a pointer press until the next key press (style.css U70 hides the rings under it), as a browser
 * may show its own ring after a click on the plot (a focusable SVG) or on the focus put back after a redraw.
 */
export function focusMode(box: HTMLElement): void {
  if (box.dataset.focusMode) return;
  box.dataset.focusMode = "1";
  box.addEventListener("pointerdown", () => (box.dataset.pointer = ""), true);
  box.addEventListener("keydown", () => delete box.dataset.pointer, true);
}

/** U74: `active` is in `box`'s run picker (its focus goes back to the checked option after a redraw). */
export function inPicker(box: HTMLElement, active: Element | null | undefined): boolean {
  let picker = false;
  for (let x: Node | null | undefined = active; x; x = x.parentNode) {
    if (x === box) return picker;
    if ((x as Element).classList?.contains("hp-pick")) picker = true;
  }
  return false;
}

/** U73: the selector of the turn or step arrow `active` is, when it is one in `nav`; else null. */
function navButtonOf(nav: HTMLElement | null | undefined, active: Element | null | undefined): string | null {
  let x: Node | null | undefined = active;
  while (x && x !== nav) x = x.parentNode;
  if (!nav || !x || !active) return null;
  for (const k of ["data-dir", "data-act"]) {
    const v = active.getAttribute(k);
    if (v !== null) return `[${k}="${v}"]`;
  }
  return null;
}

type DrawOptions = { hide?: boolean; selected?: number; onSelect?: (i: number) => void; zoom?: number | null;
  /** U73: the step within the selected turn (null: its end) and the step arrows' callback. */
  step?: number | null; onStep?: (k: number) => void;
  /** U73: where the turn and step controls go (the page's sticky host); none: under the plot, in the box. */
  nav?: HTMLElement | null;
  /** U74: the run picker in the head (the Simulator); none: no picker. */
  pick?: RunPickOption | null;
  /** U76: a run switch: a zoom on goes on to the selected turn's fight (clampStep may land in another one). */
  follow?: boolean };

/**
 * U68 / U76: the zoom of a redraw without one given: the last one while the selected step is in that fight, else All;
 * `follow` (a run switch): any zoom on stays on, on the selected step's fight.
 */
export function zoomAfter(d: HpChartData, selected: number, last: number | null, follow = false): number | null {
  const run = d.steps[selected]?.run;
  if (last === null || run === undefined) return null;
  return zoomOf(d, follow || run === last ? run : null);
}
/** U65: what each box last drew, its width and selection, to draw it again on a tab change or a resize. */
const drawn = new WeakMap<HTMLElement, { d: HpChartData | null; o: DrawOptions; width: number }>();

/**
 * Draws the chart in its box, replacing only the box's content (the rest of the Party view stays). A focused "Table"
 * fold, plot or tab keeps the focus, and the fold its open state, across the redraw. `d` null: the empty line;
 * `hide`: nothing at all. U65: `selected` is the step shown in the cards, `onSelect` hears a new one; a tab click
 * draws the box again on that tab, the selection kept; so does a width change (a hidden tab shown, a resize), since
 * the viewBox is as wide as the box. U66: a chart wider than its box keeps its sideways scroll across the redraw, then
 * brings the selected turn into view. U68: a tab click keeps the scroll as it is (`reveal` false: no move to the
 * selected turn); the zoom is kept across redraws (none given: the last one, while the selected turn is in that room).
 */
export function drawHpChart(box: HTMLElement, d: HpChartData | null, o: DrawOptions = {}, reveal = true): void {
  const fold = box.querySelector<HTMLDetailsElement>("details.hp-fold");
  const scrolled = box.querySelector<HTMLElement>(".hp-scroll")?.scrollLeft ?? 0;
  const tableOpen = fold ? fold.hasAttribute("open") : false;
  const active = (globalThis.document as Document | undefined)?.activeElement;
  const focused = !active ? null : fold && fold.querySelector("summary") === active ? "fold"
    : box.querySelector("svg.hp-svg") === active ? "plot" : box.querySelector('[role="tab"][aria-selected="true"]') === active ? "tab"
    : inPicker(box, active) ? "pick" : null;
  const lastZoom = drawn.get(box)?.o.zoom ?? null;
  // U73: a focused turn or step arrow in the nav host gets the focus back after the redraw
  const navBtn = navButtonOf(o.nav, active);
  box.hidden = Boolean(o.hide);
  if (o.nav) o.nav.hidden = Boolean(o.hide) || !d;
  if (o.hide) {
    box.replaceChildren();
    o.nav?.replaceChildren();
    drawn.delete(box);
    return;
  }
  const width = chartWidth(box.clientWidth ?? 0);
  const selected = o.selected ?? 0;
  const zoom = o.zoom !== undefined ? o.zoom : d ? zoomAfter(d, selected, lastZoom, Boolean(o.follow)) : null;
  const memo = { d, o: { ...o, zoom }, width };
  drawn.set(box, memo);
  const onSelect = (i: number) => {
    memo.o.selected = i;
    memo.o.step = null;
    o.onSelect?.(i);
  };
  const onStep = (k: number) => {
    memo.o.step = k;
    o.onStep?.(k);
  };
  const onZoom = (z: number | null) => {
    memo.o.zoom = z;
  };
  const onTab = (t: ChartTab) => {
    tabNow = t;
    drawHpChart(box, d, memo.o, false);
    box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };
  const fig = d ? hpChart(d, { tab: tabNow, selected, onSelect, onTab, tableOpen, width, zoom, onZoom, step: o.step ?? null, onStep, pick: o.pick ?? null }) : null;
  box.replaceChildren(fig ?? el("p", { class: "muted small hp-empty" }, HP_EMPTY));
  // U73: the turn and step controls in the page's sticky host
  if (o.nav) {
    const nav = fig?.querySelector<HTMLElement>(".hp-nav");
    nav?.remove();
    o.nav.replaceChildren(...(nav ? [nav] : []));
    focusMode(o.nav);
    if (navBtn) o.nav.querySelector<HTMLElement>(navBtn)?.focus();
  }
  if (fig) {
    const sc = fig.querySelector<HTMLElement>(".hp-scroll");
    if (sc && scrolled) sc.scrollLeft = scrolled;
    revealers.get(fig)?.(false, reveal);
  }
  const back = focused === "fold" ? box.querySelector("details.hp-fold")?.querySelector<HTMLElement>("summary")
    : focused === "plot" ? box.querySelector<HTMLElement>("svg.hp-svg") : focused === "tab" ? box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    : focused === "pick" ? [...(box.querySelector(".hp-pick")?.querySelectorAll<HTMLInputElement>("input") ?? [])].find((i) => i.checked) : null;
  back?.focus();
  focusMode(box);
  if (typeof ResizeObserver !== "undefined" && !box.dataset.sized) {
    box.dataset.sized = "1";
    new ResizeObserver(() => {
      const m = drawn.get(box);
      if (m?.d && Math.abs(chartWidth(box.clientWidth) - m.width) > 24) drawHpChart(box, m.d, m.o);
    }).observe(box);
  }
}
