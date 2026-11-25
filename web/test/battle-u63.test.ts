// Battle Simulator and Solver U63: the map room bar's wheel and "item in view" maths (battle-layout.ts), which the
// Party view's chart still uses (U66 on). U70: Flow 2, Flow 3, their tabs, HP bar and the room bar are gone, and their
// tests with them; rowStep went with the room bar's ‹ › buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomBarWheel, scrollToShow } from "../src/ui/battle-layout.ts";

// ---------------------------------------------------------------- 4. the room bar on a PC
test("the room bar's wheel: vertical wheel moves it sideways while it can, then leaves the event to the page", () => {
  const row = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, row), 100);
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: -100 }, row), 0, "at the start, up scrolls the page");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { ...row, scrollLeft: 600 }), 0, "at the end, down scrolls the page");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { ...row, scrollLeft: 560 }), 40, "the last bit, clamped");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: -100 }, { ...row, scrollLeft: 300 }), -100);
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, row), 120, "lines");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, row), 400, "pages");
  assert.equal(roomBarWheel({ deltaX: 80, deltaY: 10 }, row), 0, "a sideways swipe: the browser's own");
  assert.equal(roomBarWheel({ deltaX: 0, deltaY: 100 }, { scrollLeft: 0, scrollWidth: 400, clientWidth: 400 }), 0, "a bar that fits");
});

test("an item brought into view (scrollToShow)", () => {
  const row = { scrollLeft: 200, scrollWidth: 1000, clientWidth: 400 };
  assert.equal(scrollToShow(row, 300, 60, 36), null, "in view");
  assert.equal(scrollToShow(row, 100, 60, 36), 64, "off the left: its left edge clear of the fade");
  assert.equal(scrollToShow(row, 700, 60, 36), 396, "off the right: its right edge clear of the fade");
  assert.equal(scrollToShow(row, 950, 50, 36), 600, "clamped to the end");
  assert.equal(scrollToShow(row, 10, 50, 36), 0, "clamped to the start");
});
