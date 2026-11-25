// Review F14/F21 (docs/tooling/roadmap/review-a11y-perf.md): the site build. No code splitting: every script is one
// self-contained file (no imports), each tool page loads one bundle that includes the menus (nav.ts) instead of a
// second js/nav.js copy, Home and Balance keep js/nav.js, and no source maps are published. Builds into a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/assemble-site.sh", import.meta.url));
const root = new URL("../../", import.meta.url);
/** Tool pages whose bundle imports nav.ts (Balance is left as it was: nav.js + its own bundle). */
const BUNDLED: Record<string, string> = {
  "battle.html": "battle", "solver.html": "solver", "wiki.html": "wiki", "profit.html": "profit", "farming.html": "farming",
  "levelling.html": "levelling", "save.html": "save-viewer",
};

test("F14: each tool page loads one bundle that imports nav.ts first; Home and Balance load js/nav.js", () => {
  for (const [page, entry] of Object.entries(BUNDLED)) {
    const html = readFileSync(new URL(`site/${page}`, root), "utf8");
    const scripts = [...html.matchAll(/<script type="module" src="js\/([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, [`${entry}.js`], page);
    const src = readFileSync(new URL(`web/src/ui/${entry}.ts`, root), "utf8");
    assert.match(src, /^import "\.\/nav\.ts";$/m, entry);
    assert.equal(src.indexOf("import "), src.indexOf('import "./nav.ts";'), `${entry}: nav is the first import (menus before the page draws)`);
  }
  for (const page of ["index.html", "class-balance.html"]) {
    assert.match(readFileSync(new URL(`site/${page}`, root), "utf8"), /<script type="module" src="js\/nav\.js"><\/script>/, page);
  }
});

test("F14/F21: the built scripts are single files, no chunks, no maps", () => {
  const sh = readFileSync(new URL("web/scripts/assemble-site.sh", root), "utf8");
  assert.doesNotMatch(sh.replace(/^#.*$/gm, ""), /--splitting/);
  const dir = mkdtempSync(join(tmpdir(), "merchant-site-"));
  try {
    const out = join(dir, "_site");
    execFileSync("bash", [script, out], { stdio: "pipe", env: { ...process.env, SOURCEMAP: "" } });
    const js = join(out, "js");
    const files = readdirSync(js);
    assert.deepEqual(files.filter((f) => !f.endsWith(".js")), [], "only scripts in js/ (no .map)");
    assert.deepEqual(files.filter((f) => f.startsWith("chunk-")), []);
    for (const f of files) assert.doesNotMatch(readFileSync(join(js, f), "utf8"), /(?:from|import)\s*"\.\//, `${f} is self-contained`);
    for (const page of readdirSync(out).filter((f) => f.endsWith(".html"))) {
      const html = readFileSync(join(out, page), "utf8");
      for (const m of html.matchAll(/<script type="module" src="js\/([^"]+)"/g)) assert.ok(files.includes(m[1]), `${page}: js/${m[1]}`);
    }
    // The menus are inside each tool page's bundle (one copy, no js/nav.js beside it).
    const navMark = "nav-drawer"; // the phone drawer, built only by nav.ts
    for (const entry of Object.values(BUNDLED)) assert.ok(readFileSync(join(js, `${entry}.js`), "utf8").includes(navMark), entry);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
