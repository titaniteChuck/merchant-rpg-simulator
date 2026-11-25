// Accessibility review (docs/tooling/roadmap/review-a11y-perf.md), the quick fixes F01–F10 (F09 placed on the first
// line inside the section): text contrast at WCAG AA (4.5:1) computed from the stylesheet's tokens, and the markup's
// structure built for real with the tiny fake DOM (helpers/fake-dom.ts). Game data and the example save only.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { Sim } from "../src/tools/engine.ts";
import { traceFight } from "../src/tools/fight-trace.ts";
import { loadSaveText } from "../src/tools/save.ts";
import { ascSwatch, ascValues } from "../src/ui/dom.ts";
import { mountHome } from "../src/ui/home.ts";
import { radar } from "../src/ui/radar.ts";
import { loadTimelineData } from "../src/ui/timeline.ts";
import { renderFlow2 } from "../src/ui/flow2.ts";
import type { PlanMember } from "../src/ui/battle-plan.ts";
import { labelTableRegions } from "../src/ui/wiki-ref.ts";
import { STATS_SECTIONS } from "../src/ui/wiki-stats.ts";
import { FakeElement } from "./helpers/fake-dom.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const css = read("site/style.css");
const a11y = css.slice(css.indexOf("/* a11y */"), css.indexOf("/* end a11y */"));

// ---------------------------------------------------------------- contrast
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], p: number) => a.map((x, i) => x * p + b[i] * (1 - p));
const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** A theme's token block (dark is the default `:root`), its `--name: #hex` / `--name: N%` values. */
const themeBlock = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
const THEMES = { dark: themeBlock(':root, :root[data-theme="dark"] {'), light: themeBlock(':root[data-theme="light"] {') };
const token = (theme: keyof typeof THEMES, name: string) => THEMES[theme].match(new RegExp(`--${name}: ([^;]+);`))![1].trim();
const pctOf = (s: string) => parseFloat(s) / 100;
const colour = (sel: string) => css.match(new RegExp(`^${sel.replace(/[.]/g, "\\.")} \\{ --c: (#[0-9a-f]{6}); \\}`, "m"))![1];

test("one marked a11y block of CSS", () => {
  assert.equal(css.split("/* a11y */").length, 2);
  assert.equal(css.split("/* end a11y */").length, 2);
  assert.ok(a11y.length > 200);
});

test("F04, F06: every pill colour reaches AA (4.5:1) in both themes, text on its tint over the fixed pill base", () => {
  const classes = [...css.matchAll(/^\.cls-(\d) \{ --c: (#[0-9a-f]{6}); \}/gm)].map(([, n, c]) => [`class ${n}`, c]);
  assert.equal(classes.length, 9);
  const tones = ["gold", "green", "blue", "violet", "pink", "teal", "orange", "slate"].map((t) => [t, css.match(new RegExp(`\\.t-${t} \\{ --c: (#[0-9a-f]{6}); \\}`))![1]]);
  assert.match(a11y, /\.pill \{\s*color: color-mix\(in srgb, var\(--c, var\(--accent\)\) var\(--pill-ink\), var\(--fg\)\);\s*background: color-mix\(in srgb, var\(--c, var\(--accent\)\) var\(--tint\), var\(--pill-base\)\);/);
  for (const theme of ["dark", "light"] as const) {
    const m = a11y.match(theme === "dark" ? /:root, :root\[data-theme="dark"\] \{ --pill-ink: (\d+)%; --pill-base: var\(--(\w+)\); \}/
      : /:root\[data-theme="light"\] \{ --pill-ink: (\d+)%; --pill-base: var\(--(\w+)\); \}/)!;
    const ink = Number(m[1]) / 100, base = hex(token(theme, m[2])), tint = pctOf(token(theme, "tint")), fg = hex(token(theme, "fg"));
    // classes, the t-* tones (on a map / quest, required …), .good/.bad/.mid, .pill.plain (muted) and the default (accent)
    const all = [...classes, ...tones, ...["good", "bad", "mid", "muted", "accent"].map((t) => [t, token(theme, t)])];
    for (const [name, c] of all) {
      const r = ratio(mix(hex(c), fg, ink), mix(hex(c), base, tint));
      assert.ok(r >= 4.5, `${theme} pill ${name} ${c}: ${r.toFixed(2)}`);
    }
  }
});

test("F06: the \"Unconfirmed\" tag reaches AA on the note's card-2 in both themes", () => {
  const fill = pctOf(a11y.match(/\.ref-note\.unsure \.ref-tag \{ background: color-mix\(in srgb, var\(--bad\) (\d+)%, transparent\); \}/)![1]);
  for (const theme of ["dark", "light"] as const) {
    const r = ratio(hex(token(theme, "fg")), mix(hex(token(theme, "bad")), hex(token(theme, "card-2")), fill));
    assert.ok(r >= 4.5, `${theme}: ${r.toFixed(2)}`);
  }
});

test("F05: the Flow's effect, damage, heal and muted texts reach AA on every actor's cell and a plain cell (U63: no status band)", () => {
  const actorTint = pctOf(a11y.match(/\.tc-cell\.actor \{ background: color-mix\(in srgb, var\(--c, #ec4899\) (\d+)%, var\(--card\)\); \}/)![1]);
  const keep = (sel: string, tok: string) => pctOf(a11y.match(new RegExp(`${sel} \\{ color: color-mix\\(in srgb, var\\(--${tok}\\) (\\d+)%, var\\(--fg\\)\\); \\}`))![1]);
  const texts = [["buff, heal", "good", keep("\\.tc-fx\\.buff, \\.tc-heal", "good")], ["debuff, damage", "bad", keep("\\.tc-fx\\.debuff, \\.tc-dmg", "bad")],
    ["miss, calc toggle", "muted", keep("\\.tc-miss, \\.tc-down, \\.tc-void, \\.tc-calc-btn, \\.tc-fx \\.tc-left", "muted")]] as const;
  const actors = [...css.matchAll(/^\.cls-(\d) \{ --c: (#[0-9a-f]{6}); \}/gm)].map(([, n, c]) => [`class ${n}`, c]);
  actors.push(["enemy", "#ec4899"]);
  for (const theme of ["dark", "light"] as const) {
    const fg = hex(token(theme, "fg")), card = hex(token(theme, "card"));
    const grounds: [string, number[]][] = [...actors.map(([n, c]): [string, number[]] => [n, mix(hex(c), card, actorTint)]),
      ["card", card], ["card-2", hex(token(theme, "card-2"))]];
    for (const [what, tok, p] of texts) {
      const ink = mix(hex(token(theme, tok)), fg, p);
      for (const [where, bg] of grounds) {
        const r = ratio(ink, bg);
        assert.ok(r >= 4.5, `${theme} ${what} on ${where}: ${r.toFixed(2)}`);
      }
    }
  }
});

// ---------------------------------------------------------------- structure
/** The ARIA roles an element owns: its children's roles, through elements without a role; aria-hidden or hidden skipped. */
function owned(e: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  for (const c of e.children) {
    if (c.hidden || c.getAttribute("aria-hidden") === "true") continue;
    if (c.hasAttribute("role")) out.push(c);
    else out.push(...owned(c));
  }
  return out;
}
/** Text read inside `e` outside any child with a role (a table's or a row's own text, which no cell holds). */
function strayText(e: FakeElement): string {
  return e.childNodes.map((n) => n instanceof FakeElement
    ? (n.hidden || n.getAttribute("aria-hidden") === "true" || n.hasAttribute("role") ? "" : strayText(n)) : n.textContent).join("").trim();
}
const CHILDREN: Record<string, string[]> = { table: ["row", "rowgroup"], rowgroup: ["row"], row: ["cell", "columnheader", "rowheader"] };

test("F01: the Flow table holds rows and named turn rowgroups only, the result and the calculations in cells", async () => {
  api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
  const timelines = JSON.parse(read("inventory/timelines.json"));
  // The page fetches data files as bytes (data-files.ts, review F13).
  (globalThis as Record<string, unknown>).fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(timelines)).buffer });
  await loadTimelineData();
  const sv = loadSaveText(read("site/data/example-save.txt"));
  const sim = new Sim(sv.raw.gameMode || "Standard");
  const IDX = [[8, 0, 4], [5, 1, 2]] as const;
  const members: PlanMember[] = IDX.flatMap((row, r) => row.map((idx, i): PlanMember => {
    const raw = sv.raw.hero[idx];
    return { row: r ? "back" : "front", i, name: String(raw.name), cls: Number(raw.class), rotation: api.newHero(raw).attackList.slice(1, 6) };
  }));
  for (const quest of [72, 92]) { // Odin: a long fight; Murlok Monarch: over on turn 1, then "planned, not reached"
    const [front, back] = IDX.map((row) => row.map((i) => sim.hero(sv.raw.hero[i])));
    const trace = traceFight(sim, quest, [...front], [...back]);
    const plan = renderFlow2({ id: quest, rare: false }, members, trace) as unknown as FakeElement;
    for (const b of plan.querySelectorAll("button.tc-calc-btn").slice(0, 3)) b.dispatch("click"); // open some calculations
    const tables = plan.querySelectorAll("[role=table]");
    assert.equal(tables.length, 1);
    const check = (e: FakeElement) => {
      const role = e.getAttribute("role")!;
      const kids = owned(e);
      if (CHILDREN[role]) {
        for (const k of kids) assert.ok(CHILDREN[role].includes(k.getAttribute("role")!), `quest ${quest}: ${k.getAttribute("role")} (${k.className}) in ${role} (${e.className})`);
        assert.equal(strayText(e), "", `quest ${quest}: text outside a cell in ${role} (${e.className})`);
      }
      if (role !== "cell" && role !== "columnheader") kids.forEach(check);
    };
    check(tables[0]);
    const line = owned(plan.querySelector("div.tc-line")!);
    // U51: the turn bands' headers, each the one header of its own row, spanning every column
    const bands = plan.querySelectorAll("[role=rowheader]");
    assert.ok(bands.length > 0);
    for (const h of bands) {
      assert.equal(h.parentNode!.getAttribute("role"), "row", "no row header outside a row");
      assert.equal(h.getAttribute("aria-colspan"), String(line.length));
    }
    const groups = plan.querySelectorAll("[role=rowgroup]");
    assert.ok(groups.length > 0);
    for (const g of groups) assert.match(g.getAttribute("aria-label")!, /^(Turn \d+|End of the fight$)/); // U63: Flow 2 ends with an "End" group
    // the result: a live status line, inside a cell of its own row
    const result = plan.querySelector("p.tc-result")!;
    assert.equal(result.getAttribute("role"), "status");
    assert.equal(result.parentNode!.getAttribute("role"), "cell");
    assert.equal(result.parentNode!.parentNode!.getAttribute("role"), "row");
    // U63 (Flow 2): one card per column of cells in each cards row (U51: no "Turn" column)
    const heads = owned(plan.querySelector("div.f2-cards")!);
    assert.equal(heads.length, line.length);
    if (quest === 72) assert.ok(plan.querySelectorAll("div.tc-calc[role=cell]").length > 0, "an opened calculation is a cell");
  }
});

test("F02: the radar's focusable points are images, so their name is read", () => {
  const fig = radar([{ label: "HP", value: 2203, max: 3000 }, { label: "Atk", value: 120, max: 200 }, { label: "Def", value: 80, max: 100 }], { title: "Test" }) as unknown as FakeElement;
  const hits = fig.querySelectorAll("circle.radar-hit");
  assert.equal(hits.length, 3);
  for (const h of hits) {
    assert.equal(h.getAttribute("tabindex"), "0");
    assert.equal(h.getAttribute("role"), "img");
    assert.match(h.getAttribute("aria-label")!, /^(HP|Atk|Def) /);
  }
});

test("F03: an ascension value cell reads a visually-hidden line, not an aria-label on a plain span", () => {
  const cell = ascValues([[0, 10], [1, null], [2, 1234]], "Sell value") as unknown as FakeElement;
  assert.equal(cell.hasAttribute("aria-label"), false);
  assert.equal(cell.hasAttribute("role"), false);
  const hidden = cell.querySelectorAll("span.visually-hidden");
  assert.equal(hidden.length, 1);
  assert.match(hidden[0].textContent, /^Sell value, .+: .*10.*, .+: none, .+: .*1.?234/);
  const boxes = cell.querySelectorAll("span.av");
  assert.equal(boxes.length, 3);
  for (const b of boxes) assert.equal(b.getAttribute("aria-hidden"), "true");
  // the Asc column's "–" for ascension 0, the same way
  const zero = ascSwatch(0) as unknown as FakeElement;
  assert.equal(zero.hasAttribute("aria-label"), false);
  assert.equal(zero.querySelector("span.visually-hidden")!.textContent.length > 0, true);
  assert.equal(zero.querySelector("span[aria-hidden]")!.textContent, "–");
  // no other aria-label on a plain span in the helper
  const src = read("web/src/ui/dom.ts");
  const fn = src.slice(src.indexOf("export function ascValues"), src.indexOf("export function itemName"));
  assert.doesNotMatch(fn, /"aria-label"/);
});

test("F07: a wiki reference table's scroll box is a focusable, named region", () => {
  const body = new FakeElement("div");
  for (let i = 0; i < 2; i++) {
    const wrap = new FakeElement("div");
    wrap.className = "table-wrap";
    body.append(new FakeElement("p"), wrap);
  }
  labelTableRegions(body as unknown as ParentNode, "Defence");
  const wraps = body.querySelectorAll("div.table-wrap");
  assert.deepEqual(wraps.map((w) => [w.getAttribute("tabindex"), w.getAttribute("role"), w.getAttribute("aria-label")]),
    [["0", "region", "Defence, table 1"], ["0", "region", "Defence, table 2"]]);
  const one = new FakeElement("div");
  const w = new FakeElement("div");
  w.className = "table-wrap";
  one.append(w);
  labelTableRegions(one as unknown as ParentNode, "Hit chance");
  assert.equal(w.getAttribute("aria-label"), "Hit chance");
  const ref = read("web/src/ui/wiki-ref.ts");
  assert.match(ref, /labelTableRegions\(content, topics\[s\.id\]\[0\]\);/);
  assert.match(a11y, /\.ref-body \.table-wrap\[role="region"\]:focus-visible \{ outline:/);
});

test("F08: no empty column header in the Stats reference tables", () => {
  api.loadGameData(JSON.parse(read("inventory/gamedata.json")));
  let heads = 0;
  for (const s of STATS_SECTIONS) {
    const html = s.html();
    assert.doesNotMatch(html, /<th scope="col">\s*<\/th>/, `section ${s.id}`);
    heads += (html.match(/<th scope="col"><span class="visually-hidden">Multiplier<\/span><\/th>/g) ?? []).length;
  }
  assert.equal(heads, 3, "the three grade tables name their corner");
});

test("F09: the older tools' \"?\" is out of the <summary> (no button inside a button)", () => {
  const g = globalThis as Record<string, unknown>;
  g.matchMedia = () => ({ matches: false });
  const doc = g.document as { documentElement: Record<string, unknown>; body: FakeElement };
  doc.documentElement.classList ??= { contains: () => false };
  const details = new FakeElement("details");
  details.className = "tools-other";
  const summary = new FakeElement("summary");
  const h2 = new FakeElement("h2");
  h2.append("Older tools (4)");
  summary.append(h2);
  details.append(summary, new FakeElement("ul"));
  doc.body.replaceChildren(details);
  mountHome();
  assert.equal(summary.querySelectorAll("button").length, 0, "no button in the summary");
  const help = details.children[1];
  assert.ok(help.classList.contains("tools-other-help"), "the ? is the first line after the summary");
  assert.equal(help.querySelectorAll("button.help-q").length, 1);
  mountHome(); // once
  assert.equal(details.querySelectorAll("button.help-q").length, 1);
});

test("F10: the top bar is the banner landmark and the page's h1 is inside <main>", () => {
  for (const page of ["index", "save", "battle", "solver", "wiki", "levelling", "profit", "farming", "class-balance"]) {
    const html = read(`site/${page}.html`);
    assert.match(html, /<header class="topbar">/, page);
    assert.doesNotMatch(html, /<div class="topbar">/, page);
    assert.equal(html.split("<header").length, 2, `${page}: one banner`);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    const h1s = html.match(/<h1[\s>]/g) ?? [];
    if (page === "wiki") assert.equal(h1s.length, 0, "the wiki draws its h1 inside main");
    else {
      assert.equal(h1s.length, 1, page);
      assert.match(main, /<h1[\s>]/, `${page}: the h1 is inside main`);
    }
  }
  const home = read("site/index.html");
  assert.match(home, /<main>\s*<div class="home-head">\s*<h1>Merchant RPG Simulator<\/h1>/);
});

test("screen-reader text in table cells is pinned left, so it never widens the page", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../site/style.css", import.meta.url), "utf8");
  assert.match(css, /td \.visually-hidden, th \.visually-hidden \{ left: 0; top: 0; \}/);
});
