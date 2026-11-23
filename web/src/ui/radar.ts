/**
 * Radar ("spider") chart of one hero's combat stats, as inline SVG.
 *
 * Each axis has its own scale: 0 at the centre, the strongest value among the heroes being compared at
 * the rim, so the shape shows where a hero stands relative to the others. The real value is printed at
 * the end of every axis (it is what the reader wants; the shape is the summary), and hovering or focusing
 * a vertex adds the comparison. One series per chart, in the hero's class colour (--c), so no legend.
 */
import { fmt } from "./dom.ts";
import { tip } from "./tooltip.ts";

const NS = "http://www.w3.org/2000/svg";

export interface RadarAxis {
  label: string;
  value: number;
  /** rim value (largest among the compared heroes) */
  max: number;
  /** text for the value; default: integer with separators */
  display?: string;
  /** who holds the rim value, for the tooltip */
  best?: string;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function radar(axes: RadarAxis[], opts: { title: string; size?: number } ): HTMLElement {
  const size = opts.size ?? 280;
  const pad = 54; // room for the labels outside the rim
  const R = size / 2 - pad;
  const c = size / 2;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, f: number) => [c + Math.cos(angle(i)) * R * f, c + Math.sin(angle(i)) * R * f];
  const frac = (a: RadarAxis) => (a.max > 0 ? Math.max(0, Math.min(1, a.value / a.max)) : 0);

  const root = svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "radar", role: "img" });
  const desc = `${opts.title}: ${axes.map((a) => `${a.label} ${a.display ?? fmt.format(a.value)}`).join(", ")}`;
  root.setAttribute("aria-label", desc);

  // Recessive frame: four rings and the spokes, solid hairlines.
  for (const f of [0.25, 0.5, 0.75, 1]) {
    root.append(svg("polygon", { class: "radar-ring", points: axes.map((_, i) => pt(i, f).join(",")).join(" ") }));
  }
  axes.forEach((_, i) => {
    const [x, y] = pt(i, 1);
    root.append(svg("line", { class: "radar-spoke", x1: c, y1: c, x2: x, y2: y }));
  });

  // The hero's shape.
  root.append(svg("polygon", { class: "radar-shape", points: axes.map((a, i) => pt(i, frac(a)).join(",")).join(" ") }));

  axes.forEach((a, i) => {
    const [x, y] = pt(i, frac(a));
    root.append(svg("circle", { class: "radar-dot", cx: x, cy: y, r: 4 }));
    // Axis label + value outside the rim.
    const [lx, ly] = pt(i, 1);
    const cos = Math.cos(angle(i)), sin = Math.sin(angle(i));
    const tx = lx + cos * 10, ty = ly + sin * 12;
    const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
    const base = sin < -0.3 ? -14 : sin > 0.3 ? 4 : -5;
    const label = svg("text", { class: "radar-label", x: tx, y: ty + base, "text-anchor": anchor });
    label.textContent = a.label;
    const value = svg("text", { class: "radar-value", x: tx, y: ty + base + 14, "text-anchor": anchor });
    value.textContent = a.display ?? fmt.format(a.value);
    root.append(label, value);
    // Hit target larger than the dot (24px), focusable, with the comparison in the tooltip.
    const hit = svg("circle", { class: "radar-hit", cx: x, cy: y, r: 12, tabindex: 0 });
    hit.setAttribute("aria-label", `${a.label} ${a.display ?? fmt.format(a.value)}`);
    tip(hit, () => {
      const box = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = `${a.display ?? fmt.format(a.value)} ${a.label}`;
      const rest = document.createElement("span");
      rest.className = "muted";
      rest.textContent = a.max > 0 ? ` · ${Math.round(frac(a) * 100)}% of the best (${fmt.format(a.max)}${a.best ? `, ${a.best}` : ""})` : "";
      box.append(strong, rest);
      return box;
    });
    root.append(hit);
  });

  const fig = document.createElement("figure");
  fig.className = "radar-fig";
  fig.append(root);
  return fig;
}
