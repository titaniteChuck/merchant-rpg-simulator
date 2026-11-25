/**
 * U61: the Party view's chart of the traced fight the Flow tabs show (battle-page.ts renderPlan traces it once and
 * hands the same object to the open Flow layout and to this chart), so the chart and the Flows always agree.
 * U65: above the hero and opponent cards, full width; three tabs on one x axis, HP · Damage dealt · Heals; a click,
 * a tap or the arrow keys pick the turn the cards below show (the state at that turn's end, turn 0 the start).
 *
 * - One line per hero in its class colour (`cls-N`, --c), one for the enemy, dashed, in white (dark theme) or the
 *   theme's near-black (light theme): --enemy-line (U65; was U62's purple --boss). HP is a share of max HP (heroes and
 *   enemy on one scale; the absolute HP is in the readout, the legend and the table); damage dealt and heals are
 *   cumulative (a hero's over the whole map run, the enemy's per room), the per-turn amount in the readout and table.
 * - x: the fight's start (turn 0), then the end of each turn. A map run puts its fought rooms one after the other:
 *   each room keeps its own turn 0 (the state it really starts from: the new enemy at full HP, the heroes' effects
 *   gone, a post-battle scroll's heal), a dashed boundary before each room after the first.
 * - A fighter that falls: its HP line drops to 0 and a cross marks the point (again if it stands up and falls again).
 * - Accessible: the plot is a slider ("Turn", the arrow keys, Home, End) described by a one-sentence summary; a
 *   "Table" fold lists the open tab's values per turn.
 *
 * Pure parts (hpData, pickStep, nearestStep, stepAfterKey) are separate from the drawing (hpChart, drawHpChart) so
 * tests check the series, the states and the selection without a browser.
 */
import { locationLabel, statusOf, type TimelineChip, type TracedFight, planTimeline } from "./battle-plan.ts";
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
  /** U65: damage dealt and HP healed during each step (0 at a turn 0; null: not in this fight). */
  dealt: (number | null)[];
  healed: (number | null)[];
  /** U65: the same, cumulative: a hero's over the whole run, the enemy's over its room. */
  dealtSum: (number | null)[];
  healedSum: (number | null)[];
  /** The steps where the fighter fell (HP above 0 at the step before, 0 here). */
  deaths: number[];
}

export interface HpChartData {
  steps: HpStep[];
  series: HpSeries[];
  /** Index of the first step of each run (a map run's room boundaries; [0] for a quest). */
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
      const cumulative = (xs: (number | null)[]) => {
        let acc = 0;
        return xs.map((v, i) => {
          // the enemy: a new one each room
          if (f.who === 0 && runStarts.includes(i)) acc = 0;
          if (v === null) return null;
          acc += v;
          return acc;
        });
      };
      const dealt = per("dealt"), healed = per("healed");
      const deaths: number[] = [];
      values.forEach((v, i) => {
        const was = values[i - 1];
        // A fall within a run (a map room's enemy starts again at full HP: no fall at its start).
        if (v && v.hp <= 0 && was && was.hp > 0 && steps[i].turn > 0) deaths.push(i);
      });
      return { ...f, values, dealt, healed, dealtSum: cumulative(dealt), healedSum: cumulative(healed), deaths };
    })
    .filter((s) => s.values.some(Boolean));
  return { steps, series, runStarts,
    runs: fought.map((r) => ({ enemy: r.enemy, room: r.room, ...(r.quest ? { quest: r.quest } : {}), won: r.trace.won, turns: r.trace.turns })) };
}

/** U65: the step to show: the one wanted (run and turn) when this fight still has it, else turn 0. */
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
 * without a layout), the height fixed: the text keeps its size from a 375 px phone to a wide screen.
 */
export const HP_W = 360, HP_H = 200;
const M = { l: 38, r: 10, t: 16, b: 24 };
const PH = HP_H - M.t - M.b;
/** U65: the viewBox width for a box `px` wide (its padding off), between a phone's and a wide screen's. */
export const chartWidth = (px: number): number => (px > 0 ? Math.max(300, Math.min(1600, Math.round(px - 26))) : HP_W);

/** U65: the step nearest to `vx` (viewBox units across a chart `w` wide) among `n` steps. */
export function nearestStep(vx: number, n: number, w = HP_W): number {
  return Math.max(0, Math.min(n - 1, Math.round(((vx - M.l) / (w - M.l - M.r)) * (n - 1))));
}

/** The one-sentence summary of the HP tab (U65: the plot's description; also per tab, chartSummary). */
export function hpSummary(d: HpChartData): string {
  return chartSummary(d, "hp");
}

/** U65: each tab's summary: HP with the falls; damage dealt or heals with every fighter's total. */
export function chartSummary(d: HpChartData, tab: ChartTab): string {
  const turns = d.runs.reduce((n, r) => n + r.turns, 0);
  const span = d.runs.length > 1 ? `over ${d.runs.length} rooms, ${turns} turns in all` : `over ${turns} turn${turns === 1 ? "" : "s"}`;
  if (tab === "hp") {
    const falls = d.series.flatMap((s) => s.deaths.map((i) => `${s.name} falls (${lc(d.steps[i].label)})`));
    const head = d.runs.length > 1 ? `HP as a share of max HP ${span}` : `HP as a share of max HP ${span}, ${d.runs[0].won ? "won" : "lost"}`;
    return `${head}. ${falls.length ? `${falls.join("; ")}.` : "Nobody falls."}`;
  }
  const what = tab === "dmg" ? "Damage dealt" : "HP healed";
  return `${what}, added up ${span}: ${d.series.map((s) => `${s.name} ${fmt.format(total(s, tab))}`).join(", ")}.`;
}

/** A fighter's damage dealt or healing over all the steps. */
const total = (s: HpSeries, tab: ChartTab) => (tab === "dmg" ? s.dealt : s.healed).reduce<number>((a, v) => a + (v ?? 0), 0);

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

const hpText = (v: HpValue | null) => (v ? `${fmt.format(v.hp)} / ${fmt.format(v.maxHP)}${v.hp <= 0 ? " ✝" : ""}` : "—");
/** A damage or heal cell: the total so far, and this turn's own part ("1,240 (+310)"). */
const sumText = (sum: number | null, per: number | null) => (sum === null ? "—" : `${fmt.format(sum)}${per ? ` (+${fmt.format(per)})` : ""}`);
const seriesClass = (s: HpSeries) => (s.enemy ? "hp-enemy" : `cls-${s.cls ?? 0}`);
/** The y value a tab draws: HP %, or the cumulative damage dealt or healing. */
const plotted = (s: HpSeries, tab: ChartTab): (number | null)[] =>
  (tab === "hp" ? s.values.map((v) => (v ? v.pct : null)) : tab === "dmg" ? s.dealtSum : s.healedSum);
const cellText = (s: HpSeries, tab: ChartTab, i: number) =>
  (tab === "hp" ? hpText(s.values[i]) : tab === "dmg" ? sumText(s.dealtSum[i], s.dealt[i]) : sumText(s.healedSum[i], s.healed[i]));

/** A round top for a damage or heal axis (1, 2, 2.5, 5 × 10^n); 10 when there is nothing. */
export function niceMax(m: number): number {
  if (!(m > 0)) return 10;
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= m) ?? 10 * p;
}

/** Up to `n` x ticks on round turn numbers (one fight), or the room starts (a map run). */
function ticks(d: HpChartData, n = 8): { i: number; text: string }[] {
  if (d.runs.length > 1) return d.runStarts.map((i, k) => ({ i, text: d.runs[k].room?.startsWith("Boss") ? "Boss" : String(k + 1) }));
  const last = d.steps.length - 1;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => last / s <= n - 1) ?? 200;
  const out: { i: number; text: string }[] = [];
  for (let i = 0; i <= last; i += step) out.push({ i, text: String(i) });
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

/** The chart: the tabs, the plot (a slider over the steps), the legend (the end values), a pointer readout and the table fold. */
export function hpChart(d: HpChartData, o: ChartOptions = {}): HTMLElement {
  const tab = o.tab ?? "hp";
  const W = o.width ?? HP_W, PW = W - M.l - M.r;
  const n = d.steps.length;
  let sel = Math.max(0, Math.min(n - 1, o.selected ?? 0));
  const x = (i: number) => M.l + (n > 1 ? (PW * i) / (n - 1) : PW / 2);
  const all = d.series.flatMap((s) => plotted(s, tab)).filter((v): v is number => v !== null);
  const top = tab === "hp" ? 100 : niceMax(Math.max(0, ...all));
  const y = (v: number) => M.t + PH * (1 - v / top);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const summary = chartSummary(d, tab);
  const plot = svg("svg", { viewBox: `0 0 ${W} ${HP_H}`, class: `hp-svg tab-${tab}`, role: "slider", tabindex: 0, "aria-label": "Turn",
    "aria-describedby": "hp-sum", "aria-valuemin": 0, "aria-valuemax": n - 1 });
  // Grid: five lines, 0 to the top (HP: 0-100 %; damage and heals: round amounts).
  for (const p of [0, 25, 50, 75, 100]) {
    const v = (top * p) / 100;
    plot.append(svg("line", { class: "hp-grid", x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }),
      svg("text", { class: "hp-axis", x: M.l - 4, y: y(v) + 3.5, "text-anchor": "end" }, tab === "hp" ? `${p}%` : fmtCompact.format(v)));
  }
  for (const t of ticks(d)) plot.append(svg("text", { class: "hp-axis", x: x(t.i), y: HP_H - 8, "text-anchor": "middle" }, t.text));
  plot.append(svg("text", { class: "hp-axis hp-axis-title", x: W - M.r, y: HP_H - 8, "text-anchor": "end" }, d.runs.length > 1 ? "room" : "turn"));
  // Room boundaries (a map run): a dashed line before each room after the first.
  for (const i of d.runStarts.slice(1)) plot.append(svg("line", { class: "hp-room", x1: x(i), x2: x(i), y1: M.t, y2: M.t + PH }));
  // The lines: the enemy first (under the heroes); a gap where a fighter is not in the fight, and the enemy line
  // restarts with each room.
  const ordered = [...d.series.filter((s) => s.enemy), ...d.series.filter((s) => !s.enemy)];
  for (const s of ordered) {
    let path = "", open = false;
    plotted(s, tab).forEach((v, i) => {
      const restart = s.enemy && d.runStarts.includes(i);
      if (v === null) {
        open = false;
        return;
      }
      path += `${open && !restart ? "L" : "M"}${r1(x(i))},${r1(y(v))}`;
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
  const paintSel = () => {
    const at = r1(x(sel));
    for (const k of ["x1", "x2"]) mark.setAttribute(k, String(at));
    markText.setAttribute("x", String(at));
    markText.setAttribute("text-anchor", at < M.l + 24 ? "start" : at > W - M.r - 24 ? "end" : "middle");
    markText.textContent = selText(d.steps[sel]);
    plot.setAttribute("aria-valuenow", String(sel));
    plot.setAttribute("aria-valuetext", d.steps[sel].label);
  };
  const choose = (i: number) => {
    if (i === sel) return;
    sel = i;
    paintSel();
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
    return box.width ? nearestStep(((clientX - box.left) / box.width) * W, n, W) : null;
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
  // Legend: each fighter's colour, name and value at the end (the enemy of a map run: the last room's HP).
  const legend = el("ul", { class: "hp-legend" }, ...d.series.map((s) => {
    const last = [...s.values].reverse().find(Boolean) ?? null;
    const fell = s.deaths.length ? d.steps[s.deaths[s.deaths.length - 1]] : null;
    const val = tab === "hp"
      ? el("span", { class: "hp-val" }, hpText(last), ...(fell ? [el("span", { class: "muted" }, ` · fell ${lc(fell.label)}`)] : []))
      : el("span", { class: "hp-val" }, fmt.format(total(s, tab)));
    return el("li", { class: seriesClass(s) }, el("span", { class: "hp-swatch", "aria-hidden": "true" }),
      el("span", { class: "hp-name" }, s.enemy && d.runs.length > 1 ? `Enemy (${d.runs[d.runs.length - 1].enemy})` : s.name), val);
  }));
  // The table fold (screen readers, keyboards, exact values): one row per step, one column per fighter.
  const what = tab === "hp" ? "HP" : tab === "dmg" ? "Damage dealt, added up" : "HP healed, added up";
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
  return el("figure", { class: "hp-chart" }, tabs,
    el("div", { id: "hp-panel", role: "tabpanel", "aria-label": CHART_TABS.find((t) => t.id === tab)!.label },
      el("p", { id: "hp-sum", class: "visually-hidden" }, summary),
      el("div", { class: "hp-plot" }, plot, readout), legend, fold));
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
 * the viewBox is as wide as the box.
 */
export function drawHpChart(box: HTMLElement, d: HpChartData | null, o: DrawOptions = {}): void {
  const fold = box.querySelector<HTMLDetailsElement>("details.hp-fold");
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
  box.replaceChildren(d ? hpChart(d, { tab: tabNow, selected: o.selected ?? 0, onSelect, onTab, tableOpen, width })
    : el("p", { class: "muted small hp-empty" }, HP_EMPTY));
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
