// U38: no flash of the save picker while a page loads (theme.js sets <html class="has-save"> from a localStorage
// hint before the first paint), and the scroll position kept per URL (scroll-memory.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { HAS_SAVE_CLASS, readSaveFlag, SAVE_FLAG, setSaveFlag } from "../src/ui/save-store.ts";
import { ScrollStore, scrollKey, tallEnough } from "../src/ui/scroll-memory.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** A Storage in memory; `blocked` makes every call throw, as some browsers do with site data disabled. */
function memStorage(blocked = false) {
  const m = new Map<string, string>();
  const guard = () => {
    if (blocked) throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    map: m,
    getItem: (k: string) => (guard(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void m.set(k, String(v))),
    removeItem: (k: string) => (guard(), void m.delete(k)),
  };
}

/** Runs site/theme.js the way the head does, with `storage` as localStorage; returns <html>'s classes. */
function runTheme(storage: ReturnType<typeof memStorage>): Set<string> {
  const classes = new Set<string>();
  const documentElement = { dataset: {} as Record<string, string>, classList: { add: (c: string) => classes.add(c) } };
  vm.runInNewContext(read("site/theme.js"), {
    document: { documentElement },
    localStorage: storage,
    navigator: { languages: ["en-GB"], language: "en-GB" },
    addEventListener: () => {},
  });
  return classes;
}

test("save flag: putSave/forgetSave's hint round-trips, and blocked storage reads as no save", () => {
  const s = memStorage();
  assert.equal(readSaveFlag(s), false);
  setSaveFlag(true, s);
  assert.equal(s.map.get(SAVE_FLAG), "1");
  assert.equal(readSaveFlag(s), true);
  setSaveFlag(false, s);
  assert.equal(readSaveFlag(s), false);
  const blocked = memStorage(true);
  assert.doesNotThrow(() => setSaveFlag(true, blocked));
  assert.equal(readSaveFlag(blocked), false);
  assert.equal(readSaveFlag(undefined), false);
});

test("theme.js sets <html class=has-save> before the paint only when the hint says a save is kept", () => {
  const s = memStorage();
  assert.equal(runTheme(s).has(HAS_SAVE_CLASS), false);
  setSaveFlag(true, s);
  assert.equal(runTheme(s).has(HAS_SAVE_CLASS), true);
  // storage blocked: no throw, no class (the picker shows)
  assert.equal(runTheme(memStorage(true)).has(HAS_SAVE_CLASS), false);
  // theme.js reads the same key save-store.ts writes
  assert.match(read("site/theme.js"), new RegExp(`"${SAVE_FLAG}"`));
});

test("every page with a save picker loads theme.js in its head, as a classic (blocking) script", () => {
  const pages = readdirSync(new URL("site/", root)).filter((f) => f.endsWith(".html"));
  const withPicker = pages.filter((f) => read(`site/${f}`).includes('id="drop"'));
  assert.ok(withPicker.length >= 5, withPicker.join());
  for (const f of withPicker) {
    const html = read(`site/${f}`);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /<script src="theme\.js"><\/script>/, `${f}: theme.js in the head, not deferred`);
  }
});

test("style.css hides the picker, its example row and help (and the profit page's <details>) under has-save", () => {
  const css = read("site/style.css");
  const rule = css.split("\n").find((l) => l.startsWith(`html.${HAS_SAVE_CLASS} #drop`));
  assert.ok(rule, "the has-save rule");
  for (const sel of ["#drop", "details:has(> #drop)", ".example-save", ".save-help"]) assert.ok(rule.includes(`html.${HAS_SAVE_CLASS} ${sel}`), sel);
  assert.match(rule, /display: none/);
});

test("scroll store: one position per URL (path + query + hash), blocked or missing storage forgets quietly", () => {
  const s = memStorage();
  const store = new ScrollStore(() => s);
  const wiki = scrollKey({ pathname: "/wiki.html", search: "", hash: "#/items/equipment" });
  const item = scrollKey({ pathname: "/wiki.html", search: "", hash: "#/item/weapon/12" });
  const battle = scrollKey({ pathname: "/battle.html", search: "?x=1", hash: "" });
  assert.notEqual(wiki, item);
  assert.equal(store.load(wiki), undefined);
  store.save(wiki, 1234.6);
  store.save(battle, 300);
  assert.equal(store.load(wiki), 1235);
  assert.equal(store.load(item), undefined);
  assert.equal(store.load(battle), 300);
  store.save(wiki, -5);
  assert.equal(store.load(wiki), 0);
  s.map.set(item, "garbage");
  assert.equal(store.load(item), undefined);

  const blocked = new ScrollStore(() => memStorage(true));
  assert.doesNotThrow(() => blocked.save(wiki, 10));
  assert.equal(blocked.load(wiki), undefined);
  const none = new ScrollStore(() => undefined);
  none.save(wiki, 10);
  assert.equal(none.load(wiki), undefined);
});

test("restore waits until the page is tall enough for the saved position", () => {
  assert.equal(tallEnough(1000, 900, 800), false); // still loading
  assert.equal(tallEnough(1000, 1799, 800), true); // 1 px slack
  assert.equal(tallEnough(1000, 3000, 800), true);
});

test("nav.ts (every page) mounts the scroll memory; scrollRestoration is manual", () => {
  const nav = read("web/src/ui/nav.ts");
  assert.match(nav, /import \{ mountScrollMemory \} from "\.\/scroll-memory\.ts"/);
  assert.match(nav, /mountScrollMemory\(\);/);
  assert.match(read("web/src/ui/scroll-memory.ts"), /history\.scrollRestoration = "manual"/);
});
