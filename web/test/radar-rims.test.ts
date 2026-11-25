// Radar fixed rims (U47; the user, 2026-11-25): "Crit max should always be 100, accuracy should always be 250
// (heroes, enemies, all views)". The rim is set inside radar(), so every caller gets it; built with the fake DOM.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIXED_RIMS, radar, withFixedRim } from "../src/ui/radar.ts";
import { CHARTED } from "../src/ui/wiki-classes.ts";
import { FakeElement } from "./helpers/fake-dom.ts";

const src = (f: string) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");

test("Crit's rim is 100 and Acc's 250, whatever the caller passes; the tooltip names the fixed scale", () => {
  assert.equal(FIXED_RIMS.Crit, 100);
  assert.equal(FIXED_RIMS.Acc, 250);
  const crit = withFixedRim({ label: "Crit", value: 30, max: 45, best: "Aria" });
  assert.equal(crit.max, 100);
  assert.equal(crit.best, undefined);
  assert.equal(crit.rim, "the scale (100)");
  const acc = withFixedRim({ label: "Acc", value: 120, max: 900, best: "Aria" });
  assert.equal(acc.max, 250);
  assert.equal(acc.rim, "the scale (250)");
});

test("other axes keep the caller's rim", () => {
  const atk = { label: "Atk", value: 120, max: 300, best: "Aria" };
  assert.equal(withFixedRim(atk), atk);
  const eva = { label: "Eva", value: 50, max: 200, rim: "the scale (200: 200 or more sits on the rim)" };
  assert.equal(withFixedRim(eva), eva);
});

test("the drawn points use the fixed rims, a value above the rim sits on it", () => {
  // size 280: centre 140, rim radius 86. Axis 0 points up, axis 1 down (two axes).
  const dots = (value: number, max: number, label: string) => {
    const fig = radar([{ label, value, max }, { label: "Atk", value: 100, max: 100 }], { title: "T" }) as unknown as FakeElement;
    return fig.querySelectorAll("circle.radar-dot").map((d) => Number(d.getAttribute("cy")));
  };
  assert.ok(Math.abs(dots(50, 500, "Crit")[0] - (140 - 86 * 0.5)) < 1e-9, "Crit 50 is half way on a rim of 100");
  assert.ok(Math.abs(dots(125, 125, "Acc")[0] - (140 - 86 * 0.5)) < 1e-9, "Acc 125 is half way on a rim of 250");
  assert.ok(Math.abs(dots(400, 400, "Acc")[0] - (140 - 86)) < 1e-9, "Acc 400 is clamped to the rim");
  assert.ok(Math.abs(dots(150, 10, "Crit")[0] - (140 - 86)) < 1e-9, "Crit 150 is clamped to the rim");
  assert.ok(Math.abs(dots(50, 100, "Atk")[0] - (140 - 86 * 0.5)) < 1e-9, "Atk keeps the caller's rim");
});

test("every radar names its Crit and Acc axes as FIXED_RIMS does (class pages, save hero details)", () => {
  assert.ok(CHARTED.some(([, , label]) => label === "Acc"), "class page radar: Acc axis");
  assert.match(src("save-viewer.ts"), /acc: "Acc", crit: "Crit"/);
  assert.match(src("save-viewer.ts"), /RADAR_STATS = \[[^\]]*"acc", "crit"\]/);
});
