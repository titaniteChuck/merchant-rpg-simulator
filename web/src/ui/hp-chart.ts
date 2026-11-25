/**
 * U61: the Party view's chart of the traced fight the Flow tabs show (battle-page.ts renderPlan traces it once and
 * hands the same object to the open Flow layout and to this chart), so the chart and the Flows always agree.
 * U65: above the hero and opponent cards, full width; three tabs on one x axis, HP · Damage dealt · Heals; a click,
 * a tap or the arrow keys pick the turn the cards below show (the state at that turn's end, turn 0 the start).
 * U66: one fight tab per fight over the plot, Turn −1 / Turn +1 buttons, per-turn damage and heals, a hero's line
 * stops where it falls, the legend only names.
 *
 * - One line per hero in its class colour (`cls-N`, --c), one for the enemy, dashed, in white (dark theme) or the
 *   theme's near-black (light theme): --enemy-line (U65; was U62's purple --boss). HP is a share of max HP (heroes and
 *   enemy on one scale; the absolute HP is in the readout and the table); damage dealt and heals are per turn (U66;
 *   U65 had them cumulative).
 * - x: the fight's start (turn 0), then the end of each turn. A map run puts its fought rooms one after the other and
 *   every room keeps its turn 0 (U66, back from c5f59a5's "only the first room"), on the SAME x as the last turn of
 *   the room before: a hero's line just goes on through it (same HP, or a scroll's heal straight up), the enemy's
 *   drops to 0 (room N's enemy falls) and rises straight up to 100 % (room N+1's fresh enemy). Two steps share that
 *   x: room N's last turn, then room N+1's turn 0. A click or tap there picks room N+1's turn 0 (the later step);
 *   Turn −1, ← or ↓ from there picks room N's last turn (the marker stays, the cards change), Turn +1 or → goes on to
 *   room N+1's turn 1. Every step is reached by the keys and the buttons, one at a time.
 * - Fight tabs (U66): a row of tabs over the plot, one per fight (a quest: one), each exactly over its fight's turns
 *   (turn 0 to its last turn). A fight whose name is wider than its turns gets more px per turn so its tab fits; the
 *   others share the rest (fightLayout). Wider than the box: the tabs and the plot scroll sideways together, the
 *   mouse wheel too (battle-layout.ts roomBarWheel, as the map's room bar); the selected turn is kept in view
 *   (scrollToShow). A tab click picks its fight's turn 0.
 * - A fighter that falls: its HP line drops to 0, a cross marks the point, and the line stops there (every tab); it
 *   starts again only where the trace has it standing (a revive).
 * - Accessible: the plot is a slider ("Turn", the arrow keys, Home, End) described by a one-sentence summary; a
 *   "Table" fold lists the open tab's values per turn.
 *
 * Pure parts (hpData, pickStep, fightLayout, chartLayout, nearestStep, stepAfterKey, plotted) are separate from the
 * drawing (hpChart, drawHpChart) so tests check the series, the states and the selection without a browser.
 */
import { locationLabel, statusOf, type TimelineChip, type TracedFight, planTimeline } from "./battle-plan.ts";
import { roomBarWheel, scrollToShow } from "./battle-layout.ts";
import { el, fmt, fmtCompact } from "./dom.ts";
import { fightStart } from "./flow2.ts";

const NS = "http://www.w3.org/2000/svg";

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
  runs: { enemy: string; room?: string; quest?: { id: number; rare: boolean }; won: boolean; turns: number }[];
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
    runs: fought.map((r) => ({ enemy: r.enemy, room: r.room, ...(r.quest ? { quest: r.quest } : {}), won: r.trace.won, turns: r.trace.turns })) };
}

/** U65: the step to show: the one wanted (run and turn) when this fight still has it, else turn 0 (the first room's). */
export function pickStep(d: HpChartData, want: { run: number; turn: number } | null): number {
  const i = want ? d.steps.findIndex((s) => s.run === want.run && s.turn === want.turn) : -1;
  return i < 0 ? 0 : i;
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
 * U66: the fights side by side over `room` px. Every fight gets the same px per turn, except one whose tab name
 * (`tab` px) is wider than its turns: its turns widen until its tab fits, and the others share what is left (filled
 * in rounds, a fight that turns out too narrow joining the widened ones). The fights fill the room exactly unless the
 * widened ones leave it no room at all: then the plot is wider than `room` (`overflow`) and the chart scrolls.
 */
export function fightLayout(fights: { turns: number; tab: number }[], room: number): FightLayout {
  const wide = new Set<number>();
  let base = 0;
  for (let round = 0; round <= fights.length; round++) {
    const free = fights.map((_, k) => k).filter((k) => !wide.has(k));
    const turns = free.reduce((n, k) => n + fights[k].turns, 0);
    const left = room - [...wide].reduce((n, k) => n + fights[k].tab, 0);
    base = turns ? Math.max(0, left / turns) : 0;
    const more = free.filter((k) => fights[k].tab > fights[k].turns * base);
    if (!more.length) break;
    for (const k of more) wide.add(k);
  }
  const perTurn = fights.map((f, k) => (wide.has(k) ? f.tab / Math.max(1, f.turns) : base));
  const spans: { left: number; width: number }[] = [];
  let at = 0;
  for (const [k, f] of fights.entries()) {
    const width = f.turns * perTurn[k];
    spans.push({ left: at, width });
    at += width;
  }
  return { perTurn, spans, plot: at, overflow: at > room + 0.5 };
}

/** U66: fightLayout for a chart `width` units wide, with each step's x (viewBox units) and the whole width `W`. */
export interface ChartLayout extends FightLayout {
  W: number;
  xs: number[];
}
export function chartLayout(d: HpChartData, width = HP_W): ChartLayout {
  const room = Math.max(1, width - M.l - M.r);
  const f = fightLayout(d.runs.map((r, k) => ({ turns: Math.max(1, r.turns), tab: fightTabWidth(fightName(d, k)) })), room);
  // a room's turn 0 sits where the room before ends (its last turn): the same x
  const xs = d.steps.map((s) => M.l + f.spans[s.run].left + s.turn * f.perTurn[s.run]);
  return { ...f, W: f.overflow ? Math.ceil(M.l + f.plot + M.r) : width, xs };
}

/**
 * U65: the step nearest to `vx` (viewBox units) among the steps at `xs` (chartLayout). U66: two steps on one x (a
 * room's last turn and the next room's turn 0): the later one, the next room's turn 0.
 */
export function nearestStep(vx: number, xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - vx) <= Math.abs(xs[best] - vx)) best = i;
  return best;
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
 * the room's start (the enemy's fresh 100 %: a vertical segment from its 0).
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

/** A round top for a damage or heal axis (1, 2, 2.5, 5 × 10^n); 10 when there is nothing. */
export function niceMax(m: number): number {
  if (!(m > 0)) return 10;
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= m) ?? 10 * p;
}

/**
 * x ticks: round turn numbers in each fight, at least 28 px apart (U66: each fight on its own scale, the fight tabs
 * name them; a later room's turn 0 has no tick, its x is the last room's last turn).
 */
function ticks(d: HpChartData, L: ChartLayout): { x: number; text: string }[] {
  const out: { x: number; text: string }[] = [];
  d.runs.forEach((r, k) => {
    const every = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * L.perTurn[k] >= 28) ?? 200;
    for (let t = k ? every : 0; t <= r.turns; t += every) {
      const x = M.l + L.spans[k].left + t * L.perTurn[k];
      if (!out.length || x - out[out.length - 1].x >= 20) out.push({ x, text: String(t) });
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
}

/** U66: each drawn chart's "bring this into view" (drawHpChart calls it once the chart is in the page). */
const revealers = new WeakMap<HTMLElement, (smooth: boolean) => void>();
const motion = (): ScrollBehavior =>
  (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
const setOff = (b: Element, off: boolean) => (off ? b.setAttribute("disabled", "") : b.removeAttribute("disabled"));

/**
 * The chart: the tabs and the Turn −1 / +1 buttons, the fight tabs over the plot (a slider over the steps), the
 * legend (U66: colour and name only), a pointer readout and the table fold.
 */
export function hpChart(d: HpChartData, o: ChartOptions = {}): HTMLElement {
  const tab = o.tab ?? "hp";
  const L = chartLayout(d, o.width ?? HP_W);
  const W = L.W;
  const n = d.steps.length;
  let sel = Math.max(0, Math.min(n - 1, o.selected ?? 0));
  const x = (i: number) => L.xs[i];
  const lines = new Map(d.series.map((s) => [s, plotted(d, s, tab)]));
  const all = [...lines.values()].flat().filter((v): v is number => v !== null);
  const top = tab === "hp" ? 100 : niceMax(Math.max(0, ...all));
  const y = (v: number) => M.t + PH * (1 - v / top);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pc = (v: number) => `${r1((100 * v) / W)}%`;
  const summary = chartSummary(d, tab);
  const plot = svg("svg", { viewBox: `0 0 ${W} ${HP_H}`, class: `hp-svg tab-${tab}`, role: "slider", tabindex: 0, "aria-label": "Turn",
    "aria-describedby": "hp-sum", "aria-valuemin": 0, "aria-valuemax": n - 1 });
  // Grid: five lines, 0 to the top (HP: 0-100 %; damage and heals: round amounts).
  for (const p of [0, 25, 50, 75, 100]) {
    const v = (top * p) / 100;
    plot.append(svg("line", { class: "hp-grid", x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }),
      svg("text", { class: "hp-axis", x: M.l - 4, y: y(v) + 3.5, "text-anchor": "end" }, tab === "hp" ? `${p}%` : fmtCompact.format(v)));
  }
  for (const t of ticks(d, L)) plot.append(svg("text", { class: "hp-axis", x: r1(t.x), y: HP_H - 8, "text-anchor": "middle" }, t.text));
  // Room boundaries (a map run): a dashed line on the x a room's last turn and the next room's turn 0 share.
  for (const i of d.runStarts.slice(1)) plot.append(svg("line", { class: "hp-room", x1: r1(x(i)), x2: r1(x(i)), y1: M.t, y2: M.t + PH }));
  // The lines: the enemy first (under the heroes); a gap where a fighter is down or not in the fight (plotted).
  const ordered = [...d.series.filter((s) => s.enemy), ...d.series.filter((s) => !s.enemy)];
  for (const s of ordered) {
    let path = "", open = false;
    lines.get(s)!.forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      path += `${open ? "L" : "M"}${r1(x(i))},${r1(y(v))}`;
      open = true;
    });
    if (path) plot.append(svg("path", { class: `hp-line ${seriesClass(s)}`, d: path }));
  }
  // Falls (the HP tab): a cross at 0, its title saying who and when.
  if (tab === "hp") {
    for (const s of ordered) {
      for (const i of s.deaths) {
        const cx = r1(x(i)), cy = r1(y(0));
        plot.append(svg("path", { class: `hp-death ${seriesClass(s)}`, d: `M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx - 4},${cy + 4}L${cx + 4},${cy - 4}` },
          svg("title", {}, `${s.name} falls: ${lc(d.steps[i].label)}`)));
      }
    }
  }
  // U65: the selected turn: a marker line with the turn's number at its top.
  const mark = svg("line", { class: "hp-sel", x1: 0, x2: 0, y1: M.t, y2: M.t + PH });
  const markText = svg("text", { class: "hp-sel-label", x: 0, y: M.t - 4 });
  plot.append(mark, markText);
  // U66: the fight tabs, each over its fight's turns (fightLayout); a click picks the fight's turn 0.
  const fights = el("div", { class: "hp-fights", role: "group", "aria-label": "Fights" }, ...d.runs.map((r, k) => {
    const b = el("button", { type: "button", class: `hp-fight${r.room?.startsWith("Boss") ? " boss" : ""}`, "data-run": String(k), title: fightName(d, k) },
      fightName(d, k));
    b.style.left = pc(M.l + L.spans[k].left);
    b.style.width = pc(L.spans[k].width);
    b.addEventListener("click", () => {
      choose(d.runStarts[k]);
      revealSpan(M.l + L.spans[k].left, L.spans[k].width, true);
    });
    return b;
  }));
  // U66: Turn −1 / Turn +1, disabled at the ends.
  const stepBtn = (dir: -1 | 1) => {
    const b = el("button", { type: "button", class: "secondary hp-step", "data-dir": String(dir) }, dir < 0 ? "Turn −1" : "Turn +1");
    b.addEventListener("click", () => {
      const to = sel + dir;
      if (to >= 0 && to < n) choose(to);
    });
    return b;
  };
  const prev = stepBtn(-1), next = stepBtn(1);
  // U66: the scroll box: the fight tabs and the plot, one width (W px when wider than the box: 1 unit = 1 px).
  const track = el("div", { class: "hp-track" });
  if (L.overflow) track.style.width = `${W}px`;
  const scroller = el("div", { class: `hp-scroll${L.overflow ? " overflow" : ""}` }, track);
  const revealSpan = (left: number, width: number, smooth: boolean) => {
    if (!L.overflow || !(scroller.clientWidth > 0)) return;
    const k = (track.clientWidth || W) / W;
    const to = scrollToShow(scroller, left * k, width * k, 24);
    if (to !== null) scroller.scrollTo({ left: to, behavior: smooth ? motion() : "auto" });
  };
  const reveal = (smooth: boolean) => revealSpan(x(sel) - 4, 8, smooth);
  // the mouse wheel moves a chart wider than its box sideways while it can (the map room bar's rule)
  scroller.addEventListener("wheel", (e: Event) => {
    const dx = roomBarWheel(e as WheelEvent, scroller);
    if (!dx) return;
    e.preventDefault();
    scroller.scrollLeft += dx;
  }, { passive: false });
  const paintSel = () => {
    const at = r1(x(sel));
    for (const k of ["x1", "x2"]) mark.setAttribute(k, String(at));
    markText.setAttribute("x", String(at));
    markText.setAttribute("text-anchor", at < M.l + 24 ? "start" : at > W - M.r - 24 ? "end" : "middle");
    markText.textContent = selText(d.steps[sel]);
    plot.setAttribute("aria-valuenow", String(sel));
    plot.setAttribute("aria-valuetext", d.steps[sel].label);
    for (const b of fights.querySelectorAll("button")) {
      if (Number(b.getAttribute("data-run")) === d.steps[sel].run) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
    // a button that reaches its end gives the focus to the other one
    const active = (globalThis.document as Document | undefined)?.activeElement;
    setOff(prev, sel <= 0);
    setOff(next, sel >= n - 1);
    if (active === prev && sel <= 0) next.focus();
    if (active === next && sel >= n - 1) prev.focus();
  };
  const choose = (i: number) => {
    if (i === sel) return;
    sel = i;
    paintSel();
    reveal(true);
    o.onSelect?.(i);
  };
  paintSel();
  // Pointer readout: the nearest step's values for every fighter (a tap on a phone; the table has the same for keyboards).
  const guide = svg("line", { class: "hp-guide", x1: 0, x2: 0, y1: M.t, y2: M.t + PH, visibility: "hidden" });
  plot.append(guide);
  const readout = el("div", { class: "hp-readout", "aria-hidden": "true", hidden: "" });
  const show = (i: number) => {
    guide.setAttribute("x1", String(x(i)));
    guide.setAttribute("x2", String(x(i)));
    guide.setAttribute("visibility", "visible");
    readout.replaceChildren(el("strong", {}, d.steps[i].label),
      ...d.series.map((s) => el("div", { class: `hp-ro-row ${seriesClass(s)}` }, el("span", { class: "hp-swatch" }),
        `${s.enemy && d.runs.length > 1 ? d.runs[d.steps[i].run].enemy : s.name} ${cellText(s, tab, i)}`)));
    readout.hidden = false;
    readout.style.setProperty("--hp-at", `${(100 * x(i)) / W}%`);
    readout.classList.toggle("flip", x(i) > W / 2);
  };
  const hide = () => {
    guide.setAttribute("visibility", "hidden");
    readout.hidden = true;
  };
  const stepOf = (clientX: number): number | null => {
    const box = plot.getBoundingClientRect();
    return box.width ? nearestStep(((clientX - box.left) / box.width) * W, L.xs) : null;
  };
  plot.addEventListener("pointermove", (e: Event) => {
    const i = stepOf((e as PointerEvent).clientX);
    if (i !== null) show(i);
  });
  plot.addEventListener("pointerleave", hide);
  // U65: a click or a tap picks the turn; the keys move it.
  plot.addEventListener("click", (e: Event) => {
    const i = stepOf((e as MouseEvent).clientX);
    if (i !== null) choose(i);
  });
  plot.addEventListener("keydown", (e: Event) => {
    const k = e as KeyboardEvent;
    const i = stepAfterKey(k.key, sel, n);
    if (i === null) return;
    k.preventDefault();
    choose(i);
  });
  track.append(fights, el("div", { class: "hp-plot" }, plot, readout));
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
  const fig = el("figure", { class: "hp-chart" }, el("div", { class: "hp-head" }, tabs, el("div", { class: "hp-steps" }, prev, next)),
    el("div", { id: "hp-panel", role: "tabpanel", "aria-label": CHART_TABS.find((t) => t.id === tab)!.label },
      el("p", { id: "hp-sum", class: "visually-hidden" }, summary), scroller, legend, fold));
  revealers.set(fig, reveal);
  return fig;
}

/** Before a fight can be traced: one muted line, as the Flow's own "put heroes in the party". */
export const HP_EMPTY = "HP by turn: shown once the party can fight.";

/** U65: the open tab, kept for this page view (a redraw after an edit keeps it). */
let tabNow: ChartTab = "hp";
export const chartTab = (): ChartTab => tabNow;

type DrawOptions = { hide?: boolean; selected?: number; onSelect?: (i: number) => void };
/** U65: what each box last drew, its width and selection, to draw it again on a tab change or a resize. */
const drawn = new WeakMap<HTMLElement, { d: HpChartData | null; o: DrawOptions; width: number }>();

/**
 * Draws the chart in its box, replacing only the box's content (the rest of the Party view stays). A focused "Table"
 * fold, plot or tab keeps the focus, and the fold its open state, across the redraw. `d` null: the empty line;
 * `hide`: nothing at all. U65: `selected` is the step shown in the cards, `onSelect` hears a new one; a tab click
 * draws the box again on that tab, the selection kept; so does a width change (a hidden tab shown, a resize), since
 * the viewBox is as wide as the box. U66: a chart wider than its box keeps its sideways scroll across the redraw, then
 * brings the selected turn into view.
 */
export function drawHpChart(box: HTMLElement, d: HpChartData | null, o: DrawOptions = {}): void {
  const fold = box.querySelector<HTMLDetailsElement>("details.hp-fold");
  const scrolled = box.querySelector<HTMLElement>(".hp-scroll")?.scrollLeft ?? 0;
  const tableOpen = fold ? fold.hasAttribute("open") : false;
  const active = (globalThis.document as Document | undefined)?.activeElement;
  const focused = !active ? null : fold && fold.querySelector("summary") === active ? "fold"
    : box.querySelector("svg.hp-svg") === active ? "plot" : box.querySelector('[role="tab"][aria-selected="true"]') === active ? "tab" : null;
  box.hidden = Boolean(o.hide);
  if (o.hide) {
    box.replaceChildren();
    drawn.delete(box);
    return;
  }
  const width = chartWidth(box.clientWidth ?? 0);
  const memo = { d, o: { ...o }, width };
  drawn.set(box, memo);
  const onSelect = (i: number) => {
    memo.o.selected = i;
    o.onSelect?.(i);
  };
  const onTab = (t: ChartTab) => {
    tabNow = t;
    drawHpChart(box, d, memo.o);
    box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };
  const fig = d ? hpChart(d, { tab: tabNow, selected: o.selected ?? 0, onSelect, onTab, tableOpen, width }) : null;
  box.replaceChildren(fig ?? el("p", { class: "muted small hp-empty" }, HP_EMPTY));
  if (fig) {
    const sc = fig.querySelector<HTMLElement>(".hp-scroll");
    if (sc && scrolled) sc.scrollLeft = scrolled;
    revealers.get(fig)?.(false);
  }
  const back = focused === "fold" ? box.querySelector("details.hp-fold")?.querySelector<HTMLElement>("summary")
    : focused === "plot" ? box.querySelector<HTMLElement>("svg.hp-svg") : focused === "tab" ? box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') : null;
  back?.focus();
  if (typeof ResizeObserver !== "undefined" && !box.dataset.sized) {
    box.dataset.sized = "1";
    new ResizeObserver(() => {
      const m = drawn.get(box);
      if (m?.d && Math.abs(chartWidth(box.clientWidth) - m.width) > 24) drawHpChart(box, m.d, m.o);
    }).observe(box);
  }
}
