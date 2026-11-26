/**
 * U78: what an edit changes in a hero's stats, pure (Node tests import it).
 * - statDiff: a stat's cell in edit mode, "<old> → <new>" with an arrow and a tone (higher green ▲, lower red ▼:
 *   style.css .sd-up / .sd-down use the theme's --good / --bad, AA on both themes; the arrow carries it without colour).
 * - radarDiff: the radar's axes with the old stats as the main shape and the new ones as a layer drawn under it
 *   (radar.ts draws layers first). An axis's rim is the save's best, raised to the new value when that is higher, so
 *   the old shape is drawn on the raised rim; the fixed rims (Crit 100, Acc 250, radar.ts FIXED_RIMS) stay.
 */
import { fmt } from "./dom.ts";
import type { RadarAxis } from "./radar.ts";

export type Tone = "up" | "down" | "same";
export interface StatDiff {
  /** "1,200" unchanged, "1,200 → 1,350" changed */
  text: string;
  tone: Tone;
  /** "▲" higher, "▼" lower, "" unchanged */
  arrow: string;
  /** the accessible text: "HP 1,200, was 1,100, higher" */
  label: string;
}

/** A stat's value as the stat grid writes it (crit damage "×2.00"). */
export const statText = (key: string, v: number): string => (key === "critMod" ? `×${v.toFixed(2)}` : fmt.format(v));

/** Every stat is better higher (HP, attack, defence, accuracy, crit, crit damage, evasion, speed, AP). */
export function statDiff(key: string, label: string, old: number, now: number): StatDiff {
  const a = statText(key, old), b = statText(key, now);
  if (a === b) return { text: b, tone: "same", arrow: "", label: `${label} ${b}` };
  const up = now > old;
  return { text: `${a} → ${b}`, tone: up ? "up" : "down", arrow: up ? "▲" : "▼", label: `${label} ${b}, was ${a}, ${up ? "higher" : "lower"}` };
}

export interface RadarDiff {
  axes: RadarAxis[];
  /** the new stats, one per axis, on the axes' rims */
  layer: number[];
  changed: boolean;
}

/**
 * The radar of an edit: `keys` and `labels` the axes, `best` each axis's rim before the edit (the save's best and who
 * holds it). The axis's end reads "→ <new>" when the value changes (the stat grid gives both).
 */
export function radarDiff(keys: string[], labels: Record<string, string>, old: Record<string, number>, now: Record<string, number>,
  best: Record<string, { max: number; who: string }>): RadarDiff {
  let changed = false;
  const axes = keys.map((k): RadarAxis => {
    const o = old[k] ?? 0, n = now[k] ?? 0, b = best[k] ?? { max: 0, who: "" };
    if (statText(k, o) !== statText(k, n)) changed = true;
    const raised = n > b.max;
    return { label: labels[k] ?? k, value: o, max: Math.max(b.max, n, o), best: raised ? "edited" : b.who,
      display: statText(k, o) === statText(k, n) ? undefined : `→ ${statText(k, n)}` };
  });
  return { axes, layer: keys.map((k) => now[k] ?? 0), changed };
}
