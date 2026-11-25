/**
 * U63: the Flows' HP bar, one code for Flow 2 (flow2.ts, a card's HP at its turn's start) and Flow 3 (flow3.ts, the
 * HP right after an action); it was Flow 3's own (U59 follow-up). One compact bar with "remaining / total" written
 * inside it. The text comes twice, whole ("1,097 / 2,000") and compact ("9.7K / 10K", only when the total reaches
 * 10,000); the bar is its own container (style.css `U63` block), so a narrow bar shows the compact one. Down:
 * "0 / total" in an empty bar, in the bad colour. Screen readers read the label only (role=img).
 */
import { el, fmtCompact } from "./dom.ts";

const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The bar's tone: ok over 50 %, mid over 25 %, low, or down. */
export function hpTone(hp: number, maxHP: number): "ok" | "mid" | "low" | "down" {
  if (hp <= 0) return "down";
  const f = maxHP > 0 ? hp / maxHP : 0;
  return f > 0.5 ? "ok" : f > 0.25 ? "mid" : "low";
}

/** The bar's two texts: whole, and compact when the total reaches 10,000 (else the whole one again). */
export function hpTexts(hp: number, maxHP: number): { full: string; short: string } {
  const now = Math.max(0, hp);
  const full = `${fmtInt.format(now)} / ${fmtInt.format(maxHP)}`;
  return { full, short: maxHP >= 10_000 ? `${fmtCompact.format(now)} / ${fmtCompact.format(maxHP)}` : full };
}

/** The bar; `label` is what a screen reader reads and the hover shows ("Warrior: 1,097 / 2,000 HP"). */
export function hpBar(v: { hp: number; maxHP: number }, label: string): HTMLElement {
  const tone = hpTone(v.hp, v.maxHP);
  const f = tone !== "down" && v.maxHP > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHP)) : 0;
  const { full, short } = hpTexts(v.hp, v.maxHP);
  return el("div", { class: `fl-hp ${tone}`, role: "img", "aria-label": label, title: label },
    el("span", { class: "fl-hpbar", "aria-hidden": "true" }, el("span", { class: "fl-hpfill", style: `width: ${(f * 100).toFixed(1)}%` }),
      el("span", { class: "fl-hptxt" }, el("span", { class: "fl-hpfull" }, full), el("span", { class: "fl-hpshort" }, short))));
}
