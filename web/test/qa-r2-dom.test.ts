// Browser QA round 2 fixes, built for real on the tiny fake DOM (helpers/fake-dom.ts): the tooltip of a removed
// owner (F1), the focus keys Profit restores (F3), table()'s kept sort (F4), the Save button refocus (F6), the save
// menu's Home / End and the wiki "?" second tap.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FakeElement } from "./helpers/fake-dom.ts";

type Handler = (e: Record<string, unknown>) => void;
const doc = globalThis.document as unknown as {
  body: FakeElement; activeElement?: unknown;
  addEventListener: (t: string, f: Handler, o?: unknown) => void;
  querySelectorAll: (s: string) => FakeElement[];
};
const win = globalThis.window as unknown as { addEventListener: (t: string, f: Handler) => void };
// Record the document's and window's listeners (the fake ones drop them) before the modules add theirs.
const docOn = new Map<string, Handler[]>(), winOn = new Map<string, Handler[]>();
doc.addEventListener = (t, f) => docOn.set(t, [...(docOn.get(t) ?? []), f]);
win.addEventListener = (t, f) => winOn.set(t, [...(winOn.get(t) ?? []), f]);
const fire = (m: Map<string, Handler[]>, t: string, e: Record<string, unknown> = {}) => (m.get(t) ?? []).forEach((f) => f(e));
const on = (e: FakeElement, t: string, ev: Record<string, unknown> = {}) =>
  (e.listeners.get(t) ?? []).forEach((f) => (f as unknown as Handler)({ type: t, target: e, preventDefault() {}, ...ev }));

const { tip, hideTip } = await import("../src/ui/tooltip.ts");
const { el, findFocusKey, focusKeyOf, segmented, table, chipToggle } = await import("../src/ui/dom.ts");
const { menuKeys, refocusSaveChip } = await import("../src/ui/save-menu.ts");
const { helpTip } = await import("../src/ui/wiki-help.ts");

const box = () => doc.body.querySelector(".tip")!;

test("F1: a tooltip whose owner left the page hides on the next pointer move or focus", () => {
  const owner = el("span", {}, "Term") as unknown as FakeElement;
  doc.body.append(owner);
  tip(owner as unknown as Element, () => "help");
  on(owner, "pointerenter");
  assert.equal(box().hidden, false);
  fire(docOn, "pointerover"); // still in the page: kept
  assert.equal(box().hidden, false);
  owner.remove(); // a route change re-renders the page
  fire(docOn, "pointermove");
  assert.equal(box().hidden, true);
  assert.equal(owner.getAttribute("aria-describedby"), null);

  const other = el("span", {}, "Other") as unknown as FakeElement;
  doc.body.append(other);
  tip(other as unknown as Element, () => "more");
  on(other, "focus");
  other.remove();
  fire(docOn, "focusin");
  assert.equal(box().hidden, true);
});

test("F1: hashchange and popstate hide the tooltip; another element's pointerleave still doesn't", () => {
  const a = el("span", {}, "A") as unknown as FakeElement, b = el("span", {}, "B") as unknown as FakeElement;
  doc.body.append(a, b);
  tip(a as unknown as Element, () => "a");
  tip(b as unknown as Element, () => "b");
  on(a, "pointerenter");
  on(b, "pointerleave");
  assert.equal(box().hidden, false);
  fire(winOn, "hashchange");
  assert.equal(box().hidden, true);
  on(a, "pointerenter");
  fire(winOn, "popstate");
  assert.equal(box().hidden, true);
  hideTip();
});

test("F3: focus keys find a chip, a radio and a sort button again in a rebuilt panel", () => {
  const build = () => {
    const chip = chipToggle("Only gains", true, () => {});
    chip.setAttribute("data-focus-key", "chip:Only gains");
    const seg = segmented("pf-asc", "Ascension", [{ value: "all", label: "Any" }, { value: "1", label: "1" }], "all", () => {});
    const search = el("input", { type: "search", "aria-label": "Filter by name" });
    return el("div", {}, search, chip, seg) as unknown as FakeElement;
  };
  const before = build(), after = build();
  const chipKey = focusKeyOf(before.querySelector("button") as unknown as Element);
  assert.deepEqual(chipKey, { key: "chip:Only gains" });
  assert.equal(findFocusKey(after as unknown as ParentNode, chipKey!), after.querySelector("button") as unknown);
  const radio = before.querySelectorAll("input[name]")[1];
  const radioKey = focusKeyOf(radio as unknown as Element);
  assert.deepEqual(radioKey, { radio: "pf-asc", value: "1" });
  assert.equal(findFocusKey(after as unknown as ParentNode, radioKey!), after.querySelectorAll("input[name]")[1] as unknown);
  const labelKey = focusKeyOf(before.querySelector("input") as unknown as Element);
  assert.deepEqual(labelKey, { label: "Filter by name" });
  assert.equal(findFocusKey(after as unknown as ParentNode, labelKey!), after.querySelector("input") as unknown);
});

test("F4: table() starts from a given sort and reports header clicks", () => {
  const rows = [{ name: "b", n: 2 }, { name: "a", n: 1 }, { name: "c", n: 3 }];
  const seen: unknown[] = [];
  const t = table(rows, [{ key: "name", label: "Name" }, { key: "n", label: "N", num: true }], undefined,
    { sort: { key: "n", asc: false }, onSort: (s) => seen.push(s) }) as unknown as FakeElement;
  const names = () => t.querySelectorAll("tr").slice(1).map((tr) => tr.children[0].textContent);
  assert.deepEqual(names(), ["c", "b", "a"]);
  assert.equal(t.querySelectorAll("th")[1].getAttribute("aria-sort"), "descending");
  on(t.querySelectorAll("th")[0].querySelector("button")!, "click");
  assert.deepEqual(names(), ["a", "b", "c"]);
  assert.deepEqual(seen, [{ key: "name", asc: true }]);
  // An unknown column (the list's columns changed) falls back to the rows' own order.
  const u = table(rows, [{ key: "name", label: "Name" }], undefined, { sort: { key: "gone", asc: true } }) as unknown as FakeElement;
  assert.deepEqual(u.querySelectorAll("tr").slice(1).map((tr) => tr.textContent), ["b", "a", "c"]);
});

test("F6: the Save button gets the focus back, again once an async action settles", async () => {
  const old = el("button", { class: "save-chip-btn" }) as unknown as FakeElement;
  doc.body.append(old);
  refocusSaveChip();
  assert.equal(doc.activeElement, old);
  let done!: () => void;
  const action = new Promise<void>((r) => (done = r));
  refocusSaveChip(action);
  old.remove(); // the action replaces the chip
  const fresh = el("button", { class: "save-chip-btn" }) as unknown as FakeElement;
  doc.body.append(fresh);
  done();
  await action;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.activeElement, fresh);
  fresh.remove();
});

test("save menu: Home and End go to the first and last item", () => {
  const items = [0, 1, 2].map((i) => el("button", { role: "menuitem" }, String(i)) as unknown as FakeElement);
  const menu = el("div", { role: "menu" }) as unknown as FakeElement;
  menu.append(...items);
  const button = el("button") as unknown as FakeElement;
  const chip = el("div") as unknown as FakeElement;
  chip.append(button, menu);
  menuKeys(chip as unknown as HTMLElement, menu as unknown as HTMLElement, button as unknown as HTMLElement, () => {});
  items[1].focus();
  on(chip, "keydown", { key: "End" });
  assert.equal(doc.activeElement, items[2]);
  on(chip, "keydown", { key: "Home" });
  assert.equal(doc.activeElement, items[0]);
  on(chip, "keydown", { key: "ArrowUp" });
  assert.equal(doc.activeElement, items[2]);
});

test("wiki ?: a second tap closes the popover, the first one opens it", () => {
  const wrap = helpTip("Some help") as unknown as FakeElement;
  doc.body.append(wrap);
  const btn = wrap.querySelector("button")!, pop = wrap.querySelector(".help-pop")!;
  const tap = () => {
    on(btn, "pointerenter", { pointerType: "touch" });
    on(btn, "pointerdown", { pointerType: "touch" });
    btn.focus();
    on(btn, "focus");
    on(btn, "click", { detail: 1 });
  };
  tap();
  assert.equal(pop.hidden, false);
  tap();
  assert.equal(pop.hidden, true);
  tap();
  assert.equal(pop.hidden, false);
  // Enter on the focused "?" toggles it too.
  on(btn, "click", { detail: 0 });
  assert.equal(pop.hidden, true);
  wrap.remove();
});
