/**
 * Small line charts as inline SVG (no chart library): y against a shared x axis, a few series per chart.
 *
 * Built for small multiples: each chart has its own y scale (0 to a rounded maximum), the same x ticks, and a
 * readout above the plot with every series' value at the current x. Hovering (or arrow keys while the chart has
 * focus) moves a crosshair; `group()` keeps the crosshair of several charts on the same x. Series are told apart by
 * line style (`cls`), styled in style.css, so one hue (the page's --c) carries them all.
 */
import { el } from "./dom.ts";

const NS = "http://www.w3.org/2000/svg";

export interface LineSeries {
  label: string;
  /** y for each x of the chart; a shorter array ends the line early (e.g. a level cap) */
  values: number[];
  /** CSS class for the line (dash / weight) and its swatch */
  cls: string;
}

export interface LineChartOptions {
  title: string;
  /** x values, ascending (e.g. levels 1..60) */
  x: number[];
  xName: string;
  /** a few x values to label on the axis */
  xTicks: number[];
  /** text for a y value; default: up to 1 decimal */
  format?: (v: number) => string;
  /** short note next to the title (e.g. "+10 · +15 · +20 per level") */
  note?: string;
  /** x index shown before any hover; default: the last */
  start?: number;
  /** points to ring on a line, with a label (e.g. "ascension 1 unlocks") */
  marks?: { series: number; i: number; label: string }[];
  /** text under the plot (e.g. the formula) */
  caption?: string;
  /** a click (or Enter) picks the x index; with pin(), the crosshair goes back there when the pointer leaves */
  onPick?: (i: number) => void;
}

export interface LineChart {
  el: HTMLElement;
  /** move the crosshair to x index `i` */
  show(i: number): void;
  /** called with the x index when the reader moves the crosshair here */
  onMove?: (i: number) => void;
  /** pin x index `i`: a solid line, the crosshair's resting place */
  pin(i: number): void;
}

const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 1, 2, 2.5, 5 × 10^n at or above v. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v - 1e-9) ?? 10) * p;
}

export function lineChart(series: LineSeries[], opts: LineChartOptions): LineChart {
  const W = 300, H = 118;
  const L = 38, R = 10, T = 8, B = 20; // plot margins: y labels left, x labels below
  const pw = W - L - R, ph = H - T - B;
  const show = opts.format ?? ((v: number) => dec.format(v));
  const xs = opts.x;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const yMax = niceCeil(Math.max(...series.flatMap((s) => s.values)));
  const px = (x: number) => L + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * pw);
  const py = (y: number) => T + ph - (y / yMax) * ph;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "line-chart", role: "img", tabindex: 0 });
  const summary = series.map((s) => `${s.label} ${show(s.values[0])} at ${opts.xName.toLowerCase()} ${x0} to ${show(s.values[s.values.length - 1])} at ${xs[s.values.length - 1] ?? x1}`);
  root.setAttribute("aria-label", `${opts.title}: ${summary.join("; ")}. Arrow keys move along the ${opts.xName.toLowerCase()}s.`);

  // Recessive frame: gridlines at 0, half and the top; x ticks.
  for (const f of [0, 0.5, 1]) {
    const y = py(yMax * f);
    root.append(svg("line", { class: f ? "lc-grid" : "lc-axis", x1: L, x2: W - R, y1: y, y2: y }));
    const t = svg("text", { class: "lc-tick", x: L - 5, y: y + 3.5, "text-anchor": "end" });
    t.textContent = show(yMax * f);
    root.append(t);
  }
  for (const xv of opts.xTicks) {
    const t = svg("text", { class: "lc-tick", x: px(xv), y: H - 6, "text-anchor": xv === x0 ? "start" : xv === x1 ? "end" : "middle" });
    t.textContent = String(xv);
    root.append(t);
  }

  for (const s of series) {
    root.append(svg("polyline", { class: `lc-line ${s.cls}`, points: s.values.map((v, i) => `${px(xs[i])},${py(v)}`).join(" ") }));
  }

  for (const m of opts.marks ?? []) {
    const v = series[m.series]?.values[m.i];
    if (v === undefined) continue;
    const ring = svg("circle", { class: `lc-mark ${series[m.series].cls}`, r: 5, cx: px(xs[m.i]), cy: py(v) });
    const t = svg("title", {});
    t.textContent = m.label;
    ring.append(t);
    root.append(ring);
  }

  // Pinned x, crosshair and one dot per series, moved by show().
  const pinLine = svg("line", { class: "lc-pin", y1: T, y2: T + ph, x1: 0, x2: 0, visibility: "hidden" });
  root.append(pinLine);
  const cross = svg("line", { class: "lc-cross", y1: T, y2: T + ph, x1: 0, x2: 0 });
  const dots = series.map((s) => svg("circle", { class: `lc-dot ${s.cls}`, r: 3.5, cx: 0, cy: 0 }));
  root.append(cross, ...dots);

  // Readout: the value of every series at the crosshair, always visible (the real numbers, not only on hover).
  const at = el("span", { class: "lc-at" });
  const vals = series.map((s) => el("span", { class: "lc-val" }, el("i", { class: `lc-swatch ${s.cls}`, "aria-hidden": "true" }), el("b", {}),
    ...(s.label ? [el("span", { class: "lc-sr" }, ` ${s.label}`)] : []))); // the swatch names the series on screen
  const readout = el("p", { class: "lc-readout" }, at, ...vals);

  let cur = -1;
  const chart: LineChart = {
    el: el("figure", { class: "lc-fig" },
      el("figcaption", {}, el("strong", {}, opts.title), ...(opts.note ? [el("span", { class: "muted" }, ` ${opts.note}`)] : [])), readout),
    show(i: number) {
      i = Math.max(0, Math.min(xs.length - 1, i));
      if (i === cur) return;
      cur = i;
      const x = px(xs[i]);
      cross.setAttribute("x1", String(x));
      cross.setAttribute("x2", String(x));
      series.forEach((s, k) => {
        const v = s.values[i];
        dots[k].setAttribute("visibility", v === undefined ? "hidden" : "visible");
        dots[k].setAttribute("cx", String(x));
        if (v !== undefined) dots[k].setAttribute("cy", String(py(v)));
        vals[k].querySelector("b")!.textContent = v === undefined ? "–" : show(v);
      });
      at.textContent = `${opts.xName} ${xs[i]}`;
    },
    pin(i: number) {
      pinned = Math.max(0, Math.min(xs.length - 1, i));
      pinLine.setAttribute("x1", String(px(xs[pinned])));
      pinLine.setAttribute("x2", String(px(xs[pinned])));
      pinLine.setAttribute("visibility", "visible");
      chart.show(pinned);
    },
  };
  let pinned = -1;
  chart.el.append(root);
  if (opts.caption) chart.el.append(el("p", { class: "lc-caption muted" }, opts.caption));

  const pick = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W; // to viewBox units
    const xv = x0 + ((sx - L) / pw) * (x1 - x0);
    let best = 0;
    xs.forEach((v, i) => { if (Math.abs(v - xv) < Math.abs(xs[best] - xv)) best = i; });
    return best;
  };
  const move = (i: number) => {
    chart.show(i);
    chart.onMove?.(cur);
  };
  root.addEventListener("pointermove", (e) => move(pick(e)));
  root.addEventListener("pointerdown", (e) => move(pick(e)));
  if (opts.onPick) root.addEventListener("click", (e) => opts.onPick!(pick(e)));
  // back to the pinned x when the pointer leaves (the other charts follow through onMove)
  root.addEventListener("pointerleave", () => {
    if (pinned >= 0) move(pinned);
  });
  // Keyboard readers hear the readout of the chart they are moving in, not of the charts following it.
  root.addEventListener("focus", () => readout.setAttribute("aria-live", "polite"));
  root.addEventListener("blur", () => readout.removeAttribute("aria-live"));
  root.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (opts.onPick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      opts.onPick(cur);
      return;
    }
    const to = e.key === "ArrowLeft" ? cur - step : e.key === "ArrowRight" ? cur + step : e.key === "Home" ? 0 : e.key === "End" ? xs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    move(to);
  });
  chart.show(opts.start ?? xs.length - 1);
  return chart;
}

/** Keep the crosshairs of several charts on the same x. */
export function group(charts: LineChart[]): void {
  for (const c of charts) c.onMove = (i) => charts.forEach((o) => o !== c && o.show(i));
}

