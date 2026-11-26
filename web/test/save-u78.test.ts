// U78: hero creation and editing in the save viewer. The data model (the overlay kept beside the save and merged into
// every page's heroes), the edit rules (levels, classes, rotation, gear pickers), the stat diff and the radar overlay.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../src/sim/api.ts";
import { G } from "../src/sim/data.ts";
import { readEquipmentCompact } from "../src/sim/equipment.ts";
import { decodeSaveText, encodeSaveText, loadSaveText, setSaveRawHook } from "../src/tools/save.ts";
import {
  applyOverlay, CREATED_ID_BASE, deleteHero, emptyOverlay, heroMark, nextHeroId, OVERLAY_PREFIX, overlayHook, patchOf, readOverlay,
  resetHero, saveHero, setActiveSave, writeOverlay,
} from "../src/ui/hero-overlay.ts";
import {
  budgetOf, fitRotation, levelOptions, newHeroRaw, passiveChoices, skillsOf, unlockedSkills, withClass, withGearSlot, withLevel, withPrestige,
  withSkills,
} from "../src/ui/hero-edit.ts";
import {
  ascOptions, compactOf, configOf, gearCompact, gradeOptions, isWorn, itemChoices, luaNum, pickItem, prefixOptions, startingGear, suffixOptions,
  withGear,
} from "../src/ui/hero-gear.ts";
import { radarDiff, statDiff, statText } from "../src/ui/hero-diff.ts";
import { rawView, radarWithDiff, statGridDiff, heroActions, markPill } from "../src/ui/save-hero-page.ts";
import { shouldFloat } from "../src/ui/save-hero-float.ts";
import { FakeElement } from "./helpers/fake-dom.ts";

api.loadGameData(JSON.parse(readFileSync(new URL("../../inventory/gamedata.json", import.meta.url), "utf8")));
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const example = () => decodeSaveText(read("site/data/example-save.txt"));

/** A Storage stand-in (Map); `fail` makes every call throw, like blocked site data. */
function memStorage(fail = false) {
  const m = new Map<string, string>();
  const guard = () => {
    if (fail) throw new Error("blocked");
  };
  return {
    m,
    getItem: (k: string) => (guard(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void m.set(k, v)),
    removeItem: (k: string) => (guard(), void m.delete(k)),
  };
}

// ---------------------------------------------------------------- data model
test("overlay merge: edits over the save's heroes, created heroes appended, the save itself untouched", () => {
  const raw = example();
  const before = JSON.stringify(raw);
  const h = raw.hero[0];
  const created = newHeroRaw(2, nextHeroId(raw, emptyOverlay()));
  let o = saveHero(emptyOverlay(), h, { ...h, name: "Renamed", level: 42 });
  o = saveHero(o, undefined, created);
  const merged = applyOverlay(raw, o);
  assert.equal(JSON.stringify(raw), before, "the decoded save is not changed");
  assert.equal(merged.hero.length, raw.hero.length + 1);
  assert.equal(merged.hero[0].name, "Renamed");
  assert.equal(merged.hero[0].level, 42);
  assert.equal(merged.hero[0].totalQuests, h.totalQuests, "fields not edited come from the save");
  assert.deepEqual(merged.hero[1], raw.hero[1]);
  assert.equal(merged.hero.at(-1).id, created.id);
  assert.equal(heroMark(o, h.id), "modified");
  assert.equal(heroMark(o, created.id), "created");
  assert.equal(heroMark(o, raw.hero[1].id), null);
  // a created hero whose id the save took since stays out
  assert.equal(applyOverlay(raw, { edits: {}, created: [{ ...created, id: raw.hero[2].id }] }).hero.length, raw.hero.length);
});

test("an edit keeps only the fields that differ; editing back drops the entry; Reset and Delete", () => {
  const raw = example();
  const h = raw.hero[0];
  assert.deepEqual(patchOf(h, { ...h, level: 30 }), { level: 30 });
  let o = saveHero(emptyOverlay(), h, { ...h, level: 30 });
  assert.deepEqual(o.edits[String(h.id)], { level: 30 });
  assert.deepEqual(saveHero(o, h, structuredClone(h)).edits, {}, "back to the save's values: not modified");
  assert.deepEqual(resetHero(o, h.id).edits, {});
  const c = newHeroRaw(1, CREATED_ID_BASE);
  o = saveHero(o, undefined, c);
  o = saveHero(o, undefined, { ...c, name: "Kept" });
  assert.equal(o.created.length, 1, "saving a created hero again replaces it");
  assert.equal(o.created[0].name, "Kept");
  o = deleteHero(o, c.id);
  assert.equal(o.created.length, 0);
  assert.ok(o.edits[String(h.id)], "Delete leaves the edits alone");
});

test("created hero ids start at 1000 and never reuse a save or created id", () => {
  const raw = example();
  assert.equal(nextHeroId(raw, emptyOverlay()), CREATED_ID_BASE);
  const o = { edits: {}, created: [newHeroRaw(1, 1000), newHeroRaw(1, 1004)] };
  assert.equal(nextHeroId(raw, o), 1005);
  assert.equal(nextHeroId({ hero: [{ id: 2000 }] }, emptyOverlay()), 2001);
});

test("storage: per save name, an empty overlay removes the entry, damaged or blocked storage reads empty", () => {
  const s = memStorage();
  const o = saveHero(emptyOverlay(), undefined, newHeroRaw(1, 1000));
  assert.equal(writeOverlay("PlayerData.txt", o, s), true);
  assert.ok(s.m.has(`${OVERLAY_PREFIX}PlayerData.txt`));
  assert.equal(readOverlay("PlayerData.txt", s).created[0].id, 1000);
  assert.deepEqual(readOverlay("Slot2Data.txt", s), emptyOverlay(), "another save has its own overlay");
  writeOverlay("PlayerData.txt", deleteHero(o, 1000), s);
  assert.ok(!s.m.has(`${OVERLAY_PREFIX}PlayerData.txt`));
  s.m.set(`${OVERLAY_PREFIX}X`, "{not json");
  assert.deepEqual(readOverlay("X", s), emptyOverlay());
  const blocked = memStorage(true);
  assert.deepEqual(readOverlay("PlayerData.txt", blocked), emptyOverlay());
  assert.equal(writeOverlay("PlayerData.txt", o, blocked), false);
});

test("every page's loadSaveText merges the active save's overlay (save-source installs the hook and names the save)", () => {
  const raw = example();
  const text = encodeSaveText(raw);
  const s = memStorage();
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = s;
  try {
    writeOverlay("PlayerData.txt", saveHero(emptyOverlay(), raw.hero[0], { ...raw.hero[0], level: 12 }), s);
    assert.equal(loadSaveText(text).raw.hero[0].level, raw.hero[0].level, "no hook: the file as is (Node tools)");
    setSaveRawHook(overlayHook);
    setActiveSave("PlayerData.txt");
    const sv = loadSaveText(text);
    assert.equal(sv.raw.hero[0].level, 12);
    assert.equal(sv.heroes[0].level, 12, "the parsed heroes follow");
    setActiveSave("Slot2Data.txt");
    assert.equal(loadSaveText(text).raw.hero[0].level, raw.hero[0].level, "another save: its own (empty) overlay");
  } finally {
    setSaveRawHook(null);
    setActiveSave(null);
    g.localStorage = had;
  }
  const src = read("web/src/ui/save-source.ts");
  assert.match(src, /setSaveRawHook\(o\.heroOverlay === false \? null : overlayHook\)/);
  assert.match(read("web/src/ui/profit.ts"), /heroOverlay: false/, "Profit's \"You have\" counts the file's real gear");
  assert.match(src, /setActiveSave\(file\.name\);\s*await o\.load\(text, file\.name\)/);
  assert.match(src, /setActiveSave\(s\.name\);\s*await o\.load\(s\.text, s\.name\)/);
});

// ---------------------------------------------------------------- created hero defaults and edit rules
test("a created hero: level 1, ascension 0, the class's Worn starting gear, Basic rotation, no passive, idle", () => {
  const h = newHeroRaw(1, 1000);
  assert.equal(h.level, 1);
  assert.equal(h.prestigeLevel, 1);
  assert.equal(h.campaignID, -1);
  assert.equal(h.questListID, -1);
  assert.equal(h.heroInventory.length, 6);
  assert.ok(h.heroInventory.every((c: string) => isWorn(configOf(c).id)));
  assert.deepEqual(h.heroInventory.map((c: string) => readEquipmentCompact(c).itemSlot), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(skillsOf(h), { rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"], passive: "None" });
  const v = rawView(h);
  assert.ok(v.stats, v.statsError);
  assert.equal(v.row.status, "idle");
  assert.equal(v.stats!.maxHP, G.heroList[1].hp + G.heroList[1].hpPlv[1]);
});

test("levels follow the tier (50, 50, 60); another ascension clamps the level; a level change restarts its XP", () => {
  assert.equal(levelOptions(1).length, 50);
  assert.equal(levelOptions(2).length, 50);
  assert.deepEqual(levelOptions(3).slice(-1), [60]);
  const h = example().hero[0]; // level 60, prestige 3
  assert.equal(withPrestige(h, 2).level, 50);
  assert.equal(withLevel(withPrestige(h, 1), 60).level, 50, "lvl 51-60 need ascension 2");
  assert.equal(withLevel(h, 25).exp, 0);
  assert.equal(withLevel(newHeroRaw(1, 1000), 0).level, 1);
});

test("passive and rotation stay playable: None below lvl 10, locked skills and AP overruns become Basic", () => {
  const h = newHeroRaw(1, 1000);
  assert.deepEqual(passiveChoices(h), ["None"]);
  const h40 = withLevel(h, 40);
  assert.equal(skillsOf(h40).passive, "Might", "the first passive once skills unlock");
  const all = unlockedSkills(h40).filter((s) => s !== "Basic");
  const b = budgetOf(h40);
  const greedy = fitRotation([all[4], all[4], all[4], all[4], all[4]], unlockedSkills(h40), b);
  const used = greedy.reduce((s, x) => s + (x === "Basic" ? 0 : b.cost(x)), 0);
  assert.ok(used <= b.max, `${used} / ${b.max}`);
  assert.deepEqual(fitRotation(["Taunt", "Basic", "Basic", "Basic", "Basic"], ["Basic"], b), ["Basic", "Basic", "Basic", "Basic", "Basic"]);
  // lowering the level drops skills it no longer has
  const played = withSkills(h40, [all[0], "Basic", "Basic", "Basic", "Basic"], "Might");
  assert.equal(skillsOf(played).rotation[0], all[0]);
  assert.deepEqual(skillsOf(withLevel(played, 5)), { rotation: ["Basic", "Basic", "Basic", "Basic", "Basic"], passive: "None" });
});

test("skills are written as the save writes them: class-skill indices, in the current skill set too", () => {
  const h = example().hero[0]; // two skill sets, the second current
  const skills = Object.values(G.heroList[h.class].skillList) as string[];
  const out = withSkills(h, [skills[1], "Basic", "Basic", "Basic", "Basic"], h.skillSet[1].passive);
  assert.deepEqual(out.attackList, [2, 0, 0, 0, 0]);
  assert.deepEqual(out.skillSet[1].attackList, [2, 0, 0, 0, 0]);
  assert.deepEqual(out.skillSet[0], h.skillSet[0], "the other set is kept");
  assert.equal(skillsOf(out).rotation[0], skills[1]);
  const rogue = withClass(h, 2);
  assert.equal(rogue.class, 2);
  assert.deepEqual(rogue.heroInventory, h.heroInventory, "a class change keeps the gear");
  assert.equal(skillsOf(rogue).passive, Object.values(G.heroList[2].passiveList)[0]);
});

test("stats come from the engine (the simulator's): an edit through rawView equals api.heroStats of the same hero", () => {
  const h = withLevel(example().hero[3], 37);
  const v = rawView(h);
  const s = api.heroStats(api.newHero(h));
  for (const k of ["maxHP", "atk", "matk", "def", "mdef", "acc", "crit"]) assert.equal(v.stats![k], s[k], k);
});

// ---------------------------------------------------------------- gear
test("compact strings: the save's items round-trip; Lua number text", () => {
  for (const h of example().hero) {
    for (const c of h.heroInventory) {
      const d = readEquipmentCompact(c);
      assert.equal(compactOf({ ...d, enchantAttempt: d.enchantAttempt.slice(1) }), c);
    }
  }
  assert.equal(luaNum(0.1 + 0.2), "0.3");
  assert.equal(luaNum(12), "12");
  assert.deepEqual(startingGear(1).map((c) => configOf(c).grade), [1, 1, 1, 1, 1, 1]);
});

test("item table: the slot's items up to the hero's level, highest first, regions left out, expansions filtered", () => {
  const regionOf = (id: number) => (G.itemData.equipment[id].itemLevel > 20 ? 3 : 1);
  const all = itemChoices(2, 30, { regionOf });
  assert.ok(all.length > 5);
  assert.ok(all.every((c) => G.itemData.equipment[c.id].itemSlot === 2 && c.level <= 30));
  assert.ok(all.every((c, i) => i === 0 || all[i - 1].level > c.level || (all[i - 1].level === c.level && all[i - 1].id < c.id)), "level desc, then id");
  assert.ok(all.every((c) => G.itemData.equipment[c.id].subType && G.itemData.equipment[c.id].subType !== "None"), "no placeholder rows");
  const noR3 = itemChoices(2, 30, { regionOf, excluded: new Set([3]) });
  assert.ok(noR3.length < all.length && noR3.every((c) => c.level <= 20));
  assert.deepEqual(itemChoices(2, 30, { regionOf, visible: () => false }), []);
  const lowest = itemChoices(1, 1, { regionOf });
  assert.ok(lowest.every((c) => c.level <= 1));
  assert.ok(all.every((c) => Array.isArray(c.bonus)), "bonus stats only (base numbers)");
});

test("picker rules: a new item resets rank, asc, prefix and suffix; asc drops a suffix it can't take; Worn is D only", () => {
  const id = itemChoices(1, 50, { regionOf: () => 1 })[0].id;
  assert.deepEqual(pickItem(id), { id, grade: 3, asc: 0, prefix: 0, suffix: 0 });
  const worn = startingGear(1).map((c) => configOf(c).id)[0];
  assert.deepEqual(gradeOptions(worn), [1]);
  assert.deepEqual(prefixOptions(worn), []);
  assert.equal(pickItem(worn).grade, 1);
  assert.equal(withGear({ id: worn, grade: 1, asc: 0, prefix: 0, suffix: 0 }, { grade: 5 }).grade, 1);
  assert.ok(ascOptions(id).includes(1));
  const top1 = Math.max(...suffixOptions(id, 1));
  assert.ok(!suffixOptions(id, 0).includes(top1), "asc 1 has suffixes asc 0 hasn't (*1 … *8)");
  const c = withGear(pickItem(id), { asc: 1, suffix: top1, prefix: prefixOptions(id)[0], grade: 5 });
  assert.equal(c.suffix, top1);
  const back = withGear(c, { asc: 0 });
  assert.equal(back.suffix, 0, "the suffix the ascension can't take is dropped");
  assert.equal(back.prefix, c.prefix, "the prefix stays");
  assert.equal(back.grade, 5);
  const trinket = itemChoices(6, 50, { regionOf: () => 1 }).find((x) => !isWorn(x.id))!;
  assert.deepEqual(suffixOptions(trinket.id, 0), [], "a trinket takes no suffix");
  // a configuration is built and read back as the same configuration
  const made = gearCompact(c)!;
  assert.deepEqual(configOf(made), c);
  const edited = withGearSlot(newHeroRaw(1, 1000), 1, made);
  assert.equal(edited.heroInventory[0], made);
  assert.ok(rawView(withLevel(edited, 50)).stats!.atk > rawView(withLevel(newHeroRaw(1, 1000), 50)).stats!.atk);
});

// ---------------------------------------------------------------- stat diff and radar
test("stat diff: '<old> → <new>', green ▲ higher, red ▼ lower (CSS tokens), unchanged plain", () => {
  assert.deepEqual(statDiff("atk", "Atk", 1200, 1350), { text: "1,200 → 1,350", tone: "up", arrow: "▲", label: "Atk 1,350, was 1,200, higher" });
  assert.deepEqual(statDiff("def", "Def", 90, 80), { text: "90 → 80", tone: "down", arrow: "▼", label: "Def 80, was 90, lower" });
  assert.equal(statDiff("maxHP", "HP", 100.2, 100.4).tone, "same", "same shown value: no change");
  assert.equal(statText("critMod", 2), "×2.00");
  const css = read("site/style.css");
  const block = css.slice(css.indexOf("/* U78 */"), css.indexOf("/* end U78 */"));
  assert.match(block, /\.sd-up \.sd-new, \.sd-up \.sd-arrow \{ color: var\(--good\); \}/);
  assert.match(block, /\.sd-down \.sd-new, \.sd-down \.sd-arrow \{ color: var\(--bad\); \}/);
  // in the grid: old, arrow, new, the accessible text
  const grid = statGridDiff({ atk: 120, def: 50 }, {}, false, { atk: "Atk", def: "Def" }, { atk: 100, def: 50 }) as unknown as FakeElement;
  const dd = grid.querySelectorAll("dd");
  assert.equal(dd[0].getAttribute("class"), "sd sd-up");
  assert.equal(dd[0].getAttribute("aria-label"), "Atk 120, was 100, higher");
  assert.equal(dd[0].textContent, "100 → 120 ▲");
  assert.equal(dd[1].textContent, "50");
});

test("radar overlay: old shape on top, the new one as a layer under it; a higher new value becomes the rim", () => {
  const keys = ["atk", "def"];
  const labels = { atk: "Atk", def: "Def" };
  const best = { atk: { max: 200, who: "Ana" }, def: { max: 100, who: "Bo" } };
  const d = radarDiff(keys, labels, { atk: 100, def: 50 }, { atk: 400, def: 40 }, best);
  assert.equal(d.axes[0].value, 100, "the main shape is the old stats");
  assert.equal(d.axes[0].max, 400, "the rim raised to the new value");
  assert.equal(d.axes[1].max, 100, "a lower new value keeps the rim");
  assert.deepEqual(d.layer, [400, 40]);
  assert.equal(d.changed, true);
  assert.equal(radarDiff(keys, labels, { atk: 1, def: 1 }, { atk: 1, def: 1 }, best).changed, false);
  // drawn: size 280 → rim radius 86, axis 0 up from the centre (140)
  const fig = radarWithDiff(keys, labels, { atk: 100, def: 50 }, { atk: 400, def: 40 }, best, "T", 280) as unknown as FakeElement;
  const svg = fig.childNodes[0] as FakeElement;
  const polys = svg.querySelectorAll("polygon").map((p) => p.getAttribute("class"));
  assert.ok(polys.indexOf("radar-layer radar-new") < polys.indexOf("radar-shape"), "the new shape is drawn first (under)");
  const cy = Number(svg.querySelectorAll("circle.radar-dot")[0].getAttribute("cy"));
  assert.ok(Math.abs(cy - (140 - 86 * 0.25)) < 1e-9, "the old Atk (100) rescaled to the raised rim (400)");
  const same = radarWithDiff(keys, labels, { atk: 1, def: 1 }, { atk: 1, def: 1 }, best, "T", 280) as unknown as FakeElement;
  assert.equal(same.querySelectorAll("polygon.radar-new").length, 0, "nothing changed: no layer");
});

// ---------------------------------------------------------------- page parts
test("actions: Edit + Reset (edited) / Delete (created) / Edit alone; Save + Cancel while editing", () => {
  const labels = (a: Parameters<typeof heroActions>[0]) => (heroActions(a) as unknown as FakeElement).querySelectorAll("button").map((b) => b.textContent);
  const base = { name: "Ana", edit() {}, save() {}, cancel() {}, drop() {} };
  assert.deepEqual(labels({ ...base, editing: false, mark: null }), ["Edit"]);
  assert.deepEqual(labels({ ...base, editing: false, mark: "modified" }), ["Edit", "Reset"]);
  assert.deepEqual(labels({ ...base, editing: false, mark: "created" }), ["Edit", "Delete"]);
  assert.deepEqual(labels({ ...base, editing: true, mark: "created" }), ["Save", "Cancel"]);
  assert.equal(markPill(null).length, 0);
  assert.equal((markPill("created")[0] as unknown as FakeElement).textContent, "new");
  assert.equal((markPill("modified")[0] as unknown as FakeElement).textContent, "edited");
});

test("the radar floats only once its place is scrolled past, and only open", () => {
  assert.equal(shouldFloat(-1, true), true);
  assert.equal(shouldFloat(0, true), true);
  assert.equal(shouldFloat(30, true), false);
  assert.equal(shouldFloat(-1, false), false);
  const css = read("site/style.css");
  assert.match(css, /\.hero-radar-slot\.floating > \.radar-fig \{ position: fixed;[^}]*width: min\(28vw, 220px\)/);
  assert.match(css, /\.hero-stat-bar \{ position: sticky; top: 0;/);
});

test("the page: Create on the Heroes list, #hero=new and #hero=<id>&edit routes, the overlay merged for every view", () => {
  const viewer = read("web/src/ui/save-viewer.ts");
  assert.match(viewer, /"＋ Create"/);
  assert.match(viewer, /const NEW_HERO_HASH = "#hero=new";/);
  assert.match(viewer, /\/\^#hero=\(\\d\+\)&edit\$\//);
  assert.match(viewer, /parseSave\(applyOverlay\(base\.raw, overlay \?\? emptyOverlay\(\)\)\)/);
  assert.doesNotMatch(viewer, /loadSaveText/, "the viewer keeps the file's state (Reset) and merges itself");
});
