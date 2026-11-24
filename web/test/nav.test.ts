// The site's menus (U35, src/ui/nav.ts): one list of pages for every menu; the current section and sub-page from the
// path and hash routes; every page of site/ and every route linked is real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { currentNav, itemsOf, NAV, pageOf } from "../src/ui/nav.ts";

const site = new URL("../../site/", import.meta.url);
const src = (f: string) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");
const allHrefs = NAV.flatMap((s) => [...(s.href ? [s.href] : []), ...itemsOf(s).map((i) => i.href)]);

test("main menu: Home, Save, Battle, Wiki, then More with the frozen tools", () => {
  assert.deepEqual(NAV.map((s) => s.label), ["Home", "Save", "Battle", "Wiki", "More"]);
  assert.deepEqual(itemsOf(NAV.find((s) => s.id === "more")!).map((i) => i.label), ["Profit", "Farming", "Levelling", "Balance"]);
});

test("every page of site/ is in the menus, and every menu page exists", () => {
  const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
  const linked = new Set(allHrefs.map((h) => (h === "./" ? "index.html" : h.split("#")[0])));
  for (const p of pages) assert.ok(linked.has(p), `${p} is not in the menus`);
  for (const p of linked) assert.ok(pages.includes(p), `${p} is linked but not in site/`);
});

test("every page loads the menus and carries no static nav of its own", () => {
  for (const p of readdirSync(site).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(new URL(p, site), "utf8");
    assert.match(html, /<script type="module" src="js\/nav\.js"><\/script>/, p);
    assert.doesNotMatch(html, /class="(topnav|wiki-nav)"/, p);
  }
});

test("wiki links are routes of wiki.ts; save links are its sections", () => {
  const wiki = src("wiki.ts");
  for (const i of itemsOf(NAV.find((s) => s.id === "wiki")!)) {
    const [a] = i.href.replace("wiki.html#/", "").split("/");
    if (a) assert.ok(wiki.includes(`case "${a}":`), `wiki route ${a}`);
  }
  const tabs = /const TABS = \[([^\]]+)\]/.exec(src("save-viewer.ts"))![1].match(/"(\w+)"/g)!.map((x) => x.slice(1, -1));
  assert.deepEqual(itemsOf(NAV.find((s) => s.id === "save")!).map((i) => i.label), tabs);
});

test("current section and sub-page", () => {
  const c = (path: string, hash = "") => currentNav(path, hash);
  assert.equal(pageOf("/merchant-rpg-simulator/"), "index.html");
  assert.deepEqual(c("/merchant-rpg-simulator/"), { section: "home", href: "./" });
  assert.deepEqual(c("/index.html"), { section: "home", href: "./" });
  assert.deepEqual(c("/battle.html"), { section: "battle", href: "battle.html" });
  assert.deepEqual(c("/levelling.html"), { section: "more", href: "levelling.html" });
  assert.deepEqual(c("/class-balance.html"), { section: "more", href: "class-balance.html" });
  // save: no hash / unknown = Overview; a hero page belongs to Heroes
  assert.deepEqual(c("/save.html"), { section: "save", href: "save.html#overview" });
  assert.deepEqual(c("/save.html", "#Inventory"), { section: "save", href: "save.html#inventory" });
  assert.deepEqual(c("/save.html", "#hero=3"), { section: "save", href: "save.html#heroes" });
  assert.deepEqual(c("/save.html", "#nope"), { section: "save", href: "save.html#overview" });
  // wiki: lists, their detail pages (singular), reference topics
  assert.deepEqual(c("/wiki.html"), { section: "wiki", href: "wiki.html#/" });
  assert.deepEqual(c("/wiki.html", "#/"), { section: "wiki", href: "wiki.html#/" });
  assert.equal(c("/wiki.html", "#/enemy/97").href, "wiki.html#/enemies");
  assert.equal(c("/wiki.html", "#/map/3").href, "wiki.html#/maps");
  assert.equal(c("/wiki.html", "#/class/1/40/1").href, "wiki.html#/classes");
  assert.equal(c("/wiki.html", "#/skill/Absorb%20All").href, "wiki.html#/skills");
  assert.equal(c("/wiki.html", "#/passive/Thorns").href, "wiki.html#/passives");
  assert.equal(c("/wiki.html", "#/item/material/12").href, "wiki.html#/items/material");
  assert.equal(c("/wiki.html", "#/items/consumable").href, "wiki.html#/items/consumable");
  assert.equal(c("/wiki.html", "#/stats/hit-chance").href, "wiki.html#/stats");
  assert.equal(c("/wiki.html", "#/battle").href, "wiki.html#/battle");
  assert.equal(c("/wiki.html", "#/expansions/frozen").href, "wiki.html#/expansions");
  assert.deepEqual(c("/wiki.html", "#/bogus"), { section: "wiki", href: undefined });
  assert.deepEqual(c("/wiki.html", "#/%E0%A4%A"), { section: "wiki", href: undefined }); // malformed escape
  assert.deepEqual(c("/unknown.html"), {});
});
