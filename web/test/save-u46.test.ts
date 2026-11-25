// U46: the "Open your save" wizard (save.html#open), the hero page's chips, full rotation and gear frames, and the
// Asc swatch's centred number. Built on the tiny fake DOM (helpers/fake-dom.ts) where it renders.
import "./helpers/fake-dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FakeElement } from "./helpers/fake-dom.ts";

const { OPEN_HREF, PICK_LABEL, partsText, platformHash, saveWizard, WIZARD, wizardRoute } = await import("../src/ui/save-wizard.ts");
const { ascSwatch } = await import("../src/ui/dom.ts");
const { currentNav } = await import("../src/ui/nav-data.ts");

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const viewer = read("web/src/ui/save-viewer.ts");
const source = read("web/src/ui/save-source.ts");
const menu = read("web/src/ui/save-menu.ts");
const wikiData = read("web/src/ui/wiki-data.ts");
const css = read("site/style.css");
const u46 = css.slice(css.indexOf("/* u46 */"), css.indexOf("/* end u46 */"));
const click = (e: FakeElement) => e.dispatch("click");

test("wizard state: #open is step 1, #open=pc / #open=mobile a platform, anything else not the wizard", () => {
  assert.equal(wizardRoute("#open"), null);
  assert.equal(wizardRoute("#open="), null);
  assert.equal(wizardRoute("#open=pc"), "pc");
  assert.equal(wizardRoute("#OPEN=Mobile"), "mobile");
  assert.equal(wizardRoute("#open=console"), null, "an unknown platform falls back to step 1");
  for (const h of ["", "#overview", "#heroes", "#hero=3", "#opened", "#open=pc/x"]) assert.equal(wizardRoute(h), undefined, h);
  assert.equal(platformHash(null), "#open");
  assert.equal(platformHash("pc"), "#open=pc");
  assert.equal(wizardRoute(platformHash("mobile")), "mobile", "round trip");
  assert.equal(OPEN_HREF, "save.html#open");
});

test("step 1: two big choices, PC and Mobile, linking to their steps; the example save as a button", () => {
  let examples = 0;
  const w = saveWizard(null, { pick: () => assert.fail("no pick on step 1"), example: () => examples++ }) as unknown as FakeElement;
  assert.equal(w.getAttribute("data-step"), "platform");
  const choices = w.querySelectorAll("a.wiz-choice");
  assert.deepEqual(choices.map((a) => a.getAttribute("href")), ["#open=pc", "#open=mobile"]);
  assert.deepEqual(choices.map((a) => a.querySelector(".wiz-label")!.textContent), ["PC", "Mobile"]);
  assert.equal(w.querySelectorAll("button.wiz-pick").length, 0);
  click(w.querySelector("button.wiz-example")!);
  assert.equal(examples, 1);
  // Without an example action, no example button.
  assert.equal((saveWizard(null, { pick: () => {} }) as unknown as FakeElement).querySelectorAll("button.wiz-example").length, 0);
});

test("PC: the three folders, the slot files, and Pick a file opens the file chooser", () => {
  let picks = 0;
  const w = saveWizard("pc", { pick: () => picks++ }) as unknown as FakeElement;
  assert.equal(w.getAttribute("data-step"), "pc");
  const text = w.textContent;
  assert.match(text, /%APPDATA%\\Retora\\Merchant\\Documents/);
  assert.match(text, /steamapps\/compatdata\/346750\/pfx\/drive_c\/users\/steamuser\/AppData\/Roaming\/Retora\/Merchant\/Documents/);
  assert.match(text, /~\/Library\/Application Support\/Merchant\/Documents/);
  assert.match(text, /PlayerData\.txt \(slot 1\) or Slot2Data\.txt … Slot5Data\.txt/);
  assert.equal(w.querySelectorAll("ol.wiz-steps")[0].children.length, 3, "three numbered steps");
  assert.deepEqual(w.querySelectorAll("ul.wiz-paths")[0].children.map((li) => li.querySelector("strong")!.textContent),
    ["Windows: ", "Steam Deck / Linux (Proton): ", "macOS: "]);
  // Back to step 1, to switch platforms.
  assert.equal(w.querySelector("a.secondary-link")!.getAttribute("href"), "#open");
  const pick = w.querySelector("button.wiz-pick")!;
  assert.equal(pick.textContent, PICK_LABEL);
  click(pick);
  assert.equal(picks, 1);
});

test("Mobile: the bug report mail route, short, with the one-slot note", () => {
  let picks = 0;
  const w = saveWizard("mobile", { pick: () => picks++ }) as unknown as FakeElement;
  const steps = WIZARD.mobile.steps.map((s) => partsText(s.text));
  assert.equal(steps.length, 3);
  assert.match(steps[0], /^In the game, open Options and tap the button of the "Bug Report" row\.$/);
  assert.match(steps[1], /mail app opens with the save attached\. Change the recipient to your own address and send it \(or save the attachment\)\./);
  assert.match(steps[2], /Open that email on this device.*PlayerData\.txt \(or SlotNData\.txt\)/);
  for (const s of steps) assert.ok(s.length <= 130, `short step: ${s}`);
  assert.deepEqual(w.querySelectorAll("p.wiz-note").map((p) => p.textContent),
    ["Only the slot you are playing is attached: switch slots in the game to send another.", "Not tested on every mail app."]);
  assert.equal(w.querySelectorAll("ul.wiz-paths").length, 0, "no folders on a phone");
  assert.equal(w.querySelector("a.secondary-link")!.getAttribute("href"), "#open");
  click(w.querySelector("button.wiz-pick")!);
  assert.equal(picks, 1);
});

test("the Save dropdown's open entries lead to the wizard, not straight to the file dialog", () => {
  assert.match(source, /"📂 Open your own save" : "📂 Choose another file", "[^"]+", openWizard\)/);
  assert.match(source, /label: "📂 Open your save", hint: "[^"]+", run: openWizard/);
  assert.match(source, /export function openWizard\(\): void \{\s*location\.assign\(OPEN_HREF\);/);
  // The example save is unchanged; Reload still rereads (or re-picks) the same file.
  assert.match(source, /item\("🧪 Try the example save", "[^"]+", useExample\)/);
  assert.match(source, /else chooseSave\(pickerOpts\);/);
  assert.match(source, /return \{ choose: \(\) => void chooseSave\(pickerOpts\), useExample \};/);
  // The save help links to the wizard and names the Mac folder and the phone route.
  assert.match(source, /el\("a", \{ href: OPEN_HREF \}, "Step by step"\)/);
  assert.match(source, /Options › Bug Report/);
  // The plain Save dropdown keeps linking to the save viewer.
  assert.match(menu, /href: SAVE_PAGE/);
});

test("the save viewer routes #open to the wizard, with or without a save, and leaves it once a file is loaded", () => {
  assert.match(viewer, /const wiz = wizardRoute\(location\.hash\);/);
  assert.match(viewer, /classList\.toggle\("save-wizard", wiz !== undefined\)/);
  assert.match(viewer, /saveWizard\(wiz, \{ pick: \(\) => source\?\.choose\(\), example: \(\) => void source\?\.useExample\(\) \}\)/);
  assert.ok(viewer.indexOf("wizardRoute(location.hash);") < viewer.indexOf("if (!current) return void"), "the wizard routes before the no-save check");
  assert.match(viewer, /afterPick: \(\) => \{\s*if \(wizardRoute\(location\.hash\) !== undefined\) location\.hash = "overview";/);
  assert.match(source, /await loaded\(file\.name, savedAt\);\s*o\.afterPick\?\.\(\);/, "only a picked file, not the stored save");
  // The wizard takes the picker's place; its choices sit side by side even on a phone.
  assert.match(u46, /html\.save-wizard #drop, [^{]*html\.save-wizard \.example-save, html\.save-wizard \.save-help \{ display: none !important; \}/);
  assert.match(u46, /\.wiz-choices \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // Not one of the Save pages: the chip row stays, no sub-page marked.
  assert.deepEqual(currentNav("/save.html", "#open"), { section: "save", href: undefined });
  assert.deepEqual(currentNav("/save.html", "#open=mobile"), { section: "save", href: undefined });
  assert.deepEqual(currentNav("/save.html", "#opened"), { section: "save", href: "save.html#overview" });
});

test("hero page: quests and deaths are chips beside level and status; the old footer is gone", () => {
  assert.match(viewer, /pill\(`Lvl \$\{r\.level\}`, "plain"\),\s*pill\(String\(r\.status\)[^\n]*\.\.\.heroCounts\(r\)/);
  assert.match(viewer, /pill\(`⚔️ \$\{plural\(n\("quests"\), "quest"\)\}`, "plain hero-count"\)/);
  assert.match(viewer, /pill\(`💀 \$\{plural\(n\("deaths"\), "death"\)\}`, "plain hero-count"\)/);
  assert.doesNotMatch(viewer, /hero-foot/);
  assert.doesNotMatch(css, /\.hero-foot/);
});

test("hero page: gear name keeps its rarity colour without outline, the card's frame is the ascension", () => {
  assert.match(viewer, /itemLink\("equipment", [^\n]*\{ always: true, noOutline: true[^}]*\}\)/);
  assert.match(viewer, /class: `gear-item rar-\$\{[^`]+\}\$\{gearAsc\(g\.asc\)\}`/);
  assert.match(viewer, /return n \? ` gear-asc asc-\$\{n\}` : "";/);
  assert.match(wikiData, /if \(opts\.noOutline\) a\.classList\.remove\("asc", "asc-1", "asc-2"\);/);
  // The U5 metallic gradient (.asc-1 / .asc-2 --asc-grad) draws the frame; asc 0 is a plain border, never the rarity.
  assert.match(css, /\.hero-detail \.gear-item \{ border-color: var\(--border\); border-left-width: 2px; \}/);
  assert.match(css, /\.hero-detail \.gear-item\.gear-asc \{ border-color: transparent;\s*background: linear-gradient\(var\(--card-2\), var\(--card-2\)\) padding-box, var\(--asc-grad\) border-box; \}/);
  assert.match(viewer, /GEAR_HELP = \["The item's name has its rarity colour\.",\s*"A silver frame around the card/);
});

test("Asc swatch: the number is its own centred box, everywhere the swatch is used", () => {
  const s = ascSwatch(2) as unknown as FakeElement;
  assert.equal(s.getAttribute("aria-label"), "ascension 2");
  const n = s.querySelector("span.asc-n")!;
  assert.equal(n.textContent, "2");
  assert.equal(s.textContent, "2");
  assert.match(css, /\.asc-swatch \{ display: inline-grid; place-items: center; width: 20px; height: 20px;/);
  assert.match(css, /\.asc-swatch \.asc-n \{ display: block; line-height: 1; text-align: center;[^}]*text-box: trim-both cap alphabetic; \}/);
});
