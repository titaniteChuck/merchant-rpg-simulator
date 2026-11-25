/**
 * Review R3 on the Levelling page (docs/tooling/roadmap/review-r3.md): F02, F04–F10, and F37 / F38 on this page. Pure
 * helpers run; the page code, HTML and CSS are read as text (no DOM).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultRefQuest, goldHint, goldParts, heroLevelText, potionShort } from "../src/ui/levelling-view.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const page = read("web/src/ui/levelling.ts");
const html = read("site/levelling.html");
const css = read("site/style.css");
const block = css.slice(css.indexOf("/* r3-levelling */"), css.indexOf("/* end r3-levelling */"));

test("one r3-levelling block in style.css", () => {
  assert.equal(css.split("/* r3-levelling */").length, 2);
  assert.equal(css.split("/* end r3-levelling */").length, 2);
});

test("F02: a finished run scrolls its result into view", () => {
  assert.match(page, /out\.replaceChildren\(el\("div", \{ class: "lv-result" \}, \.\.\.render\(m\)\)\);\s*reveal\(out\);/);
  assert.match(page, /out\.scrollIntoView\(\{ behavior: smooth \? "smooth" : "auto", block: "start" \}\)/);
  assert.match(page, /prefers-reduced-motion: reduce/);
});

test("F04: three tiles on one row, no levels hint, the gold split only with two parts or more", () => {
  const parts = goldParts({ launchGold: 28960, reviveGold: 0, potionGold: 0, mapGold: 0, potions: 0 });
  assert.deepEqual(parts, ["launch 28,960 g"]);
  assert.equal(goldHint(parts), undefined);
  const two = goldParts({ launchGold: 1200, reviveGold: 300, potionGold: 2400, mapGold: 0, potions: 12 }, "XP Boost +2");
  assert.deepEqual(two, ["launch 1,200 g", "revive 300 g", "12 XP Boost +2 2,400 g"]);
  assert.equal(goldHint(two), "launch 1,200 g · revive 300 g · 12 XP Boost +2 2,400 g");
  assert.doesNotMatch(page, /`levels \$\{plan\.from\}/);
  assert.match(page, /tile\("Time", hoursText\(plan\.hours\), undefined,/);
  assert.match(block, /\.tiles\.lv-tiles \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
});

test("F05: segmented options don't wrap and span two columns above 600 px; short potion labels", () => {
  assert.deepEqual([0, 1, 2].map(potionShort), ["Boost", "+1", "+2"]);
  assert.match(block, /\.lv-options \.seg \{ flex-wrap: nowrap; \}/);
  assert.match(block, /@media \(min-width: 601px\) \{ \.lv-options \.lv-seg, \.lv-options \.lv-seg-wide \{ grid-column: span 2; \} \}/);
  // The full potion name is a tooltip, not a title.
  assert.match(page, /label: potionShort\(i\)/);
  assert.match(page, /tip\(opt, name\);\s*tip\(input, name\);/);
});

test("F06: compare columns Stat / After / Change / Now; Now hidden on a phone and in the Change tooltip", () => {
  assert.match(page, /el\("th", \{\}, "Stat"\), el\("th", \{ class: "num" \}, `After/);
  assert.match(page, /el\("th", \{ class: "num lv-now" \}, now\)/);
  assert.match(page, /tipOn\(change\(a, b, Boolean\(f\)\), \(\) => `\$\{now\}: \$\{was\}`\)/);
  assert.match(block, /@media \(max-width: 600px\) \{ #prestige-out \.lv-now \{ display: none; \} \}/);
});

test("F07: the default reference quest is one the hero wins now", () => {
  const req: Record<number, number> = { 1: 58, 2: 50, 3: 44, 4: 30 };
  const ids = [1, 2, 3, 4]; // toughest first
  const lvl = (id: number) => req[id];
  assert.equal(defaultRefQuest(ids, lvl, 50, null), 3, "toughest at or below level − 5");
  assert.equal(defaultRefQuest(ids, lvl, 50, 2), 2, "the plan's last quest first");
  assert.equal(defaultRefQuest(ids, lvl, 50, 99), 3, "a plan quest not in the list is ignored");
  assert.equal(defaultRefQuest(ids, lvl, 20, null), 4, "none low enough: the easiest");
  assert.equal(defaultRefQuest([], lvl, 50, null), undefined);
});

test("F08: no step 3 at the last ascension", () => {
  assert.match(html, /<section id="prestige-step">\s*<h2><span class="step">3<\/span> Next ascension<\/h2>/);
  assert.match(page, /\$\("#prestige-step"\)\.hidden = last;/);
  assert.doesNotMatch(page, /nothing more to unlock/);
});

test("F09: the hero line is the picker, the avatar and Lv N / max", () => {
  assert.equal(heroLevelText(53, 60), "Lv 53 / 60");
  assert.doesNotMatch(page, /`level \$\{h\.level\} of \$\{max\}`/);
  assert.match(page, /pill\("planned from level 1", "t-green"\)/);
  assert.match(page, /el\("div", \{ class: "toolbar lv-hero-bar" \}, hero, info\)/);
});

test("F10: Compare is a secondary button", () => {
  assert.match(page, /el\("button", \{ type: "button", class: "secondary", id: "prestige-run" \}/);
  assert.equal(page.match(/class: "primary"/g)?.length ?? 0, 0);
  assert.match(html, /id="plan-run" type="button" class="primary"/);
});

test("F37: the page's tables fade at the edge that has more on a phone", () => {
  const rule = block.slice(block.indexOf("#plan-out .table-wrap, #prestige-out .table-wrap {"));
  assert.ok(rule.length > 0);
  assert.match(rule, /mask-image: linear-gradient\(to right, transparent, #000 var\(--fade-l\), #000 calc\(100% - var\(--fade-r\)\), transparent\);/);
  assert.match(rule, /animation: row-fade linear both; animation-timeline: scroll\(self inline\);/);
});

test("F38: help through tip(), focusable so a tap keeps it open; no title attributes", () => {
  assert.doesNotMatch(page, /title:/);
  assert.doesNotMatch(page, /setAttribute\("title"/);
  assert.match(page, /avatar\.removeAttribute\("title"\);/);
  assert.doesNotMatch(html.slice(html.indexOf("<main>")), /title=/);
  assert.match(page, /function tipOn<T extends HTMLElement>\(e: T, text: \(\) => string\): T \{\s*e\.classList\.add\("lv-tip"\);\s*e\.tabIndex = 0;/);
  assert.match(page, /return t \? tipOn\(c, \(\) => String\(t\)\) : c;/);
  assert.doesNotMatch(page, /[Hh]over (a|the|an) /);
});
