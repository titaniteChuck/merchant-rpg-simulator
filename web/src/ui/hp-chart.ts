/**
 * U61: the Party view's HP chart, under the opponent's card (its spider chart): every fighter's HP over the turns of
 * the traced fight the Flow tabs show (battle-page.ts renderPlan traces it once and hands the same object to the open
 * Flow layout and to this chart), so the chart and the Flows always agree.
 *
 * - One line per hero in its class colour (`cls-N`, --c), one for the enemy in purple (dashed; U62: --boss, was the
 *   gold trim). The y axis is HP as a share of max HP (heroes and enemy on one scale); the absolute HP is in the readout and the legend.
 * - x: the fight's start, then the end of each turn. A map run puts its fought rooms one after the other: a dashed
 *   boundary before each room after the first, the enemy line restarting with each room's enemy.
 * - A fighter that falls: its line drops to 0 and a cross marks the point (again if it stands up and falls again).
 * - Accessible: the SVG is a role=img with a one-sentence summary; a "Table" fold lists the HP per turn.
 *
 * Pure parts (hpData) are separate from the drawing (hpChart, drawHpChart) so tests check the series without a browser.
 */
import type { TracedFight } from "./battle-plan.ts";
import { el, fmt } from "./dom.ts";
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
}

/** One x position: the fight's start (turn 0) or a turn's end, in one run. */
export interface HpStep {
  run: number;
  turn: number;
  /** "Start", "Turn 3"; a map run prefixes the room: "Boss · Odin, turn 3". */
  label: string;
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
  /** The steps where the fighter fell (HP above 0 at the step before, 0 here). */
  deaths: number[];
}

export interface HpChartData {
  steps: HpStep[];
  series: HpSeries[];
  /** Index of the first step of each run (a map run's room boundaries; [0] for a quest). */
  runStarts: number[];
  runs: { enemy: string; room?: string; won: boolean; turns: number }[];
}

/** "Turn 3" / "Start" inside a sentence: "turn 3"; a map room label ("1 · Wolf Pack, turn 3") keeps its case. */
const lc = (s: string) => (/^(Turn|Start)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const pctOf = (hp: number, maxHP: number) => (maxHP > 0 ? Math.max(0, Math.min(100, (100 * hp) / maxHP)) : 0);

/**
 * The chart's series from the traced fights, in order: each fighter's HP at the fight's start (flow2.ts fightStart,
 * as Flow 2's first cards) and after the last action of every turn (a turn without actions keeps the HP it had).
 * `fighters`: the heroes to draw (the enemy is always drawn); a hero absent from a run's trace has no value there.
 * Null without a fight to show.
 */
export function hpData(runs: HpRun[], fighters: HpFighter[]): HpChartData | null {
  const fought = runs.filter((r) => r.trace && r.trace.actions.length);
  if (!fought.length) return null;
  const many = fought.length > 1;
  const steps: HpStep[] = [];
  const runStarts: number[] = [];
  const snaps: Record<number, { hp: number; maxHP: number }>[] = [];
  fought.forEach((r, k) => {
    runStarts.push(steps.length);
    const cur: Record<number, { hp: number; maxHP: number }> = { ...fightStart(r.trace) };
    const where = many ? `${r.room ?? `Room ${k + 1}`}, ` : "";
    steps.push({ run: k, turn: 0, label: many ? `${r.room ?? `Room ${k + 1}`}: start` : "Start" });
    snaps.push({ ...cur });
    const byTurn = new Map<number, TracedFight["actions"]>();
    for (const a of r.trace.actions) {
      if (!byTurn.has(a.turn)) byTurn.set(a.turn, []);
      byTurn.get(a.turn)!.push(a);
    }
    for (let t = 1; t <= r.trace.turns; t++) {
      for (const a of byTurn.get(t) ?? []) for (const l of a.life ?? []) cur[l.who] = { hp: l.hp, maxHP: l.maxHP };
      steps.push({ run: k, turn: t, label: many ? `${where}turn ${t}` : `Turn ${t}` });
      snaps.push({ ...cur });
    }
  });
  const series: HpSeries[] = [{ who: 0, name: fought.length > 1 ? "Enemy" : fought[0].enemy, enemy: true },
    ...fighters.filter((f) => f.who > 0).map((f) => ({ who: f.who, name: f.name, cls: f.cls, enemy: false }))]
    .map((f) => {
      const values = snaps.map((s): HpValue | null => (s[f.who] ? { hp: Math.max(0, s[f.who].hp), maxHP: s[f.who].maxHP, pct: pctOf(s[f.who].hp, s[f.who].maxHP) } : null));
      const deaths: number[] = [];
      values.forEach((v, i) => {
        const was = values[i - 1];
        // A fall within a run (a map room's enemy starts again at full HP: no fall at its start).
        if (v && v.hp <= 0 && was && was.hp > 0 && steps[i].turn > 0) deaths.push(i);
      });
      return { ...f, values, deaths };
    })
    .filter((s) => s.values.some(Boolean));
  return { steps, series, runStarts, runs: fought.map((r) => ({ enemy: r.enemy, room: r.room, won: r.trace.won, turns: r.trace.turns })) };
}

/** The one-sentence summary (the SVG's accessible name). */
export function hpSummary(d: HpChartData): string {
  const turns = d.runs.reduce((n, r) => n + r.turns, 0);
  const falls = d.series.flatMap((s) => s.deaths.map((i) => `${s.name} falls (${lc(d.steps[i].label)})`));
  const head = d.runs.length > 1
    ? `HP as a share of max HP over ${d.runs.length} rooms, ${turns} turns in all`
    : `HP as a share of max HP over ${turns} turn${turns === 1 ? "" : "s"}, ${d.runs[0].won ? "won" : "lost"}`;
  return `${head}. ${falls.length ? `${falls.join("; ")}.` : "Nobody falls."}`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

/** The chart's frame (viewBox units, about 1:1 on a 375 px phone). */
export const HP_W = 360, HP_H = 200;
const M = { l: 34, r: 10, t: 10, b: 24 };

const hpText = (v: HpValue | null) => (v ? `${fmt.format(v.hp)} / ${fmt.format(v.maxHP)}${v.hp <= 0 ? " ✝" : ""}` : "—");
const seriesClass = (s: HpSeries) => (s.enemy ? "hp-enemy" : `cls-${s.cls ?? 0}`);

/** Up to `n` x ticks on round turn numbers (one fight), or the room starts (a map run). */
function ticks(d: HpChartData, n = 6): { i: number; text: string }[] {
  if (d.runs.length > 1) return d.runStarts.map((i, k) => ({ i, text: d.runs[k].room?.startsWith("Boss") ? "Boss" : String(k + 1) }));
  const last = d.steps.length - 1;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => last / s <= n - 1) ?? 200;
  const out: { i: number; text: string }[] = [];
  for (let i = 0; i <= last; i += step) out.push({ i, text: String(i) });
  return out;
}

/** The chart: a heading, the SVG (role=img), the legend (final HP), a pointer readout and the table fold. */
export function hpChart(d: HpChartData, o: { tableOpen?: boolean } = {}): HTMLElement {
  const n = d.steps.length;
  const pw = HP_W - M.l - M.r, ph = HP_H - M.t - M.b;
  const x = (i: number) => M.l + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const y = (pct: number) => M.t + ph * (1 - pct / 100);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const plot = svg("svg", { viewBox: `0 0 ${HP_W} ${HP_H}`, class: "hp-svg", role: "img", "aria-label": hpSummary(d) });
  // Grid: 0, 25, 50, 75, 100 %.
  for (const p of [0, 25, 50, 75, 100]) {
    plot.append(svg("line", { class: "hp-grid", x1: M.l, x2: HP_W - M.r, y1: y(p), y2: y(p) }),
      svg("text", { class: "hp-axis", x: M.l - 4, y: y(p) + 3.5, "text-anchor": "end" }, `${p}%`));
  }
  for (const t of ticks(d)) plot.append(svg("text", { class: "hp-axis", x: x(t.i), y: HP_H - 8, "text-anchor": "middle" }, t.text));
  plot.append(svg("text", { class: "hp-axis hp-axis-title", x: HP_W - M.r, y: HP_H - 8, "text-anchor": "end" }, d.runs.length > 1 ? "room" : "turn"));
  // Room boundaries (a map run): a dashed line before each room after the first.
  for (const i of d.runStarts.slice(1)) plot.append(svg("line", { class: "hp-room", x1: x(i), x2: x(i), y1: M.t, y2: M.t + ph }));
  // The lines: the enemy first (under the heroes); a gap where a fighter is not in the fight, and the enemy line
  // restarts with each room.
  const ordered = [...d.series.filter((s) => s.enemy), ...d.series.filter((s) => !s.enemy)];
  for (const s of ordered) {
    let path = "", open = false;
    s.values.forEach((v, i) => {
      const restart = s.enemy && d.runStarts.includes(i);
      if (!v) {
        open = false;
        return;
      }
      path += `${open && !restart ? "L" : "M"}${r1(x(i))},${r1(y(v.pct))}`;
      open = true;
    });
    if (path) plot.append(svg("path", { class: `hp-line ${seriesClass(s)}`, d: path }));
  }
  // Falls: a cross at 0, its title saying who and when.
  for (const s of ordered) {
    for (const i of s.deaths) {
      const cx = r1(x(i)), cy = r1(y(0));
      plot.append(svg("path", { class: `hp-death ${seriesClass(s)}`, d: `M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx - 4},${cy + 4}L${cx + 4},${cy - 4}` },
        svg("title", {}, `${s.name} falls: ${lc(d.steps[i].label)}`)));
    }
  }
  // Pointer readout: the nearest step's HP for every fighter (tap on a phone; the table has the same for keyboards).
  const guide = svg("line", { class: "hp-guide", x1: 0, x2: 0, y1: M.t, y2: M.t + ph, visibility: "hidden" });
  plot.append(guide);
  const readout = el("div", { class: "hp-readout", "aria-hidden": "true", hidden: "" });
  const show = (i: number) => {
    guide.setAttribute("x1", String(x(i)));
    guide.setAttribute("x2", String(x(i)));
    guide.setAttribute("visibility", "visible");
    readout.replaceChildren(el("strong", {}, d.steps[i].label),
      ...d.series.map((s) => el("div", { class: `hp-ro-row ${seriesClass(s)}` }, el("span", { class: "hp-swatch" }),
        `${s.enemy && d.runs.length > 1 ? d.runs[d.steps[i].run].enemy : s.name} ${hpText(s.values[i])}`)));
    readout.hidden = false;
    readout.style.setProperty("--hp-at", `${(100 * x(i)) / HP_W}%`);
    readout.classList.toggle("flip", x(i) > HP_W / 2);
  };
  const hide = () => {
    guide.setAttribute("visibility", "hidden");
    readout.hidden = true;
  };
  plot.addEventListener("pointermove", (e: Event) => {
    const p = e as PointerEvent;
    const box = plot.getBoundingClientRect();
    if (!box.width) return;
    const vx = ((p.clientX - box.left) / box.width) * HP_W;
    show(Math.max(0, Math.min(n - 1, Math.round(((vx - M.l) / pw) * (n - 1)))));
  });
  plot.addEventListener("pointerleave", hide);
  // Legend: each fighter's colour, name and HP at the end (the enemy of a map run: the last room's).
  const legend = el("ul", { class: "hp-legend" }, ...d.series.map((s) => {
    const last = [...s.values].reverse().find(Boolean) ?? null;
    const fell = s.deaths.length ? d.steps[s.deaths[s.deaths.length - 1]] : null;
    return el("li", { class: seriesClass(s) }, el("span", { class: "hp-swatch", "aria-hidden": "true" }),
      el("span", { class: "hp-name" }, s.enemy && d.runs.length > 1 ? `Enemy (${d.runs[d.runs.length - 1].enemy})` : s.name),
      el("span", { class: "hp-val" }, hpText(last),
        ...(fell ? [el("span", { class: "muted" }, ` · fell ${lc(fell.label)}`)] : [])));
  }));
  // The table fold (screen readers, keyboards, exact values): one row per step, one column per fighter.
  const table = el("table", { class: "hp-table" },
    el("caption", { class: "visually-hidden" }, "HP of every fighter, by turn"),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, d.runs.length > 1 ? "Room, turn" : "Turn"),
      ...d.series.map((s) => el("th", { scope: "col" }, s.name)))),
    el("tbody", {}, ...d.steps.map((st, i) => el("tr", {}, el("th", { scope: "row" }, st.label),
      ...d.series.map((s) => el("td", {}, hpText(s.values[i])))))));
  const fold = el("details", { class: "hp-fold", ...(o.tableOpen ? { open: "" } : {}) }, el("summary", {}, "Table"), el("div", { class: "table-wrap" }, table));
  return el("figure", { class: "hp-chart" },
    el("figcaption", {}, el("h4", {}, "HP by turn"), el("span", { class: "muted small" }, "the Flow's fight")),
    el("div", { class: "hp-plot" }, plot, readout), legend, fold);
}

/** Before a fight can be traced: one muted line, as the Flow's own "put heroes in the party". */
export const HP_EMPTY = "HP by turn: shown once the party can fight.";

/**
 * Draws the chart in its box, replacing only the box's content (the rest of the Party view stays). A focused "Table"
 * fold keeps the focus and its open state across the redraw. `d` null: the empty line; `hide`: nothing at all.
 */
export function drawHpChart(box: HTMLElement, d: HpChartData | null, o: { hide?: boolean } = {}): void {
  const fold = box.querySelector<HTMLDetailsElement>("details.hp-fold");
  const tableOpen = fold ? fold.hasAttribute("open") : false;
  const active = (globalThis.document as Document | undefined)?.activeElement;
  const hadFocus = Boolean(fold && active && fold.querySelector("summary") === active);
  box.hidden = Boolean(o.hide);
  if (o.hide) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(d ? hpChart(d, { tableOpen }) : el("p", { class: "muted small hp-empty" }, HP_EMPTY));
  if (hadFocus) box.querySelector("details.hp-fold")?.querySelector<HTMLElement>("summary")?.focus();
}
