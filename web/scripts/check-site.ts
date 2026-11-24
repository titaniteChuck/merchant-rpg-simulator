/**
 * Local regression sweep of the built site (not in CI: it needs a browser). Opens every page at 1280 and 375 px,
 * light and dark, with and without a save loaded, and fails on console errors, uncaught errors, failed requests
 * (404s, favicon included), a page wider than the viewport, (600 px and less, U20) a row that wraps: the top bar and
 * the tab rows must each be ONE line, or (U35) broken menus: above 760 px the main menu shows, marks the current page
 * and each dropdown opens on screen and closes with Escape; at 760 px and less only the burger shows, and it opens the
 * left drawer (on screen, current page marked, focus inside) that Escape closes.
 *
 *   cd web && npm run site && node scripts/check-site.ts            # all pages, all variants
 *   node scripts/check-site.ts --only battle,wiki --jobs 2 --save ../saves/snapshot/PlayerData.txt --widths 414
 *   node scripts/check-site.ts --lang fr                                # game names in French (U29; default English)
 *
 * How: a small HTTP server serves _site/ and injects a probe script into every page (console.error / warn, error
 * and unhandledrejection events, horizontal overflow). Each run loads a wrapper page that first puts the save into
 * IndexedDB (as save-store.ts keeps it) or removes it, then opens the page in an iframe of the target width (headless
 * Chrome windows can't go below ~500 px), waits `--settle` ms (default 8000) and sends the probe's report with
 * a POST to the server, in real time (the browser is then closed). Requests that 404 are recorded by the server, per run.
 *
 * Browser: $CHROME, else Chrome / Chromium on PATH, else Windows Chrome from WSL. Save: --save, else
 * ../saves/snapshot/PlayerData.txt when it exists, else the site's example save (site/data/example-save.txt).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SITE = join(ROOT, "_site");

const PAGES: Record<string, string> = {
  index: "index.html",
  save: "save.html",
  hero: "save.html#hero=1",
  battle: "battle.html",
  solver: "solver.html",
  profit: "profit.html",
  farming: "farming.html",
  levelling: "levelling.html",
  wiki: "wiki.html",
  enemy: "wiki.html#/enemy/97",
  "class-page": "wiki.html#/class/1",
  "wiki-stats": "wiki.html#/stats/hit-chance",
  "wiki-battle": "wiki.html#/battle",
  "wiki-enemies": "wiki.html#/enemies",
  expansions: "wiki.html#/expansions",
  balance: "class-balance.html",
};
/** U20 one-line rows, at 600 px and less. Since U35 the site menus are a burger and a drawer there (checked apart). */
const ONE_LINE_ROWS = ".topbar, .tabs";
const THEMES = ["light", "dark"] as const;

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("only")?.split(",");
const WIDTHS = (opt("widths") ?? "1280,375").split(",").map(Number);
// More than ~4 Windows Chromes at once start failing (exit 255) or time out.
const jobs = Math.max(1, Number(opt("jobs") ?? 3));
const settleMs = Number(opt("settle") ?? 8000);
/** U29: the language of game names (site/theme.js "lang"), English by default. */
const lang = opt("lang") ?? "en";
const savePath = opt("save") ?? [join(ROOT, "saves/snapshot/PlayerData.txt"), join(ROOT, "site/data/example-save.txt")].find(existsSync) ?? "";
const saveText = existsSync(savePath) ? readFileSync(savePath, "utf8") : null;

function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME;
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe", "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("no Chrome found: set CHROME to the browser's path");
}
const CHROME = findChrome();
const WINDOWS = CHROME.endsWith(".exe");

// ---------------------------------------------------------------- server
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".map": "application/json", ".txt": "text/plain",
};

/** Runs inside every page (first script of <head>): collects what the page reports and measures overflow. */
const PROBE = `(() => {
  const errors = [], warnings = [];
  const fmt = (a) => a.map((x) => x instanceof Error ? (x.stack || x.message) : typeof x === "object" ? (() => { try { return JSON.stringify(x); } catch { return String(x); } })() : String(x)).join(" ");
  const oe = console.error, ow = console.warn;
  console.error = (...a) => { errors.push(fmt(a)); oe.apply(console, a); };
  console.warn = (...a) => { warnings.push(fmt(a)); ow.apply(console, a); };
  addEventListener("error", (e) => {
    const t = e.target;
    if (t && t !== window && t.tagName) errors.push("failed to load " + t.tagName.toLowerCase() + " " + (t.src || t.href || ""));
    else errors.push("uncaught: " + e.message + " at " + e.filename + ":" + e.lineno);
  }, true);
  addEventListener("unhandledrejection", (e) => errors.push("unhandled rejection: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
  window.__check = () => {
    const d = document.documentElement, cw = d.clientWidth;
    const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true; } return false; };
    const wide = d.scrollWidth > cw + 1 ? [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > cw + 1 && !scrolls(el))
      .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "") + " → " + Math.round(el.getBoundingClientRect().right) + "px") : [];
    // Phone (U20): every nav row is one line: no visible child starts below another one's bottom.
    const wrapped = cw > 600 ? [] : [...document.querySelectorAll(${JSON.stringify(ONE_LINE_ROWS)})].filter((row) => row.offsetParent).flatMap((row) => {
      const boxes = [...row.children].filter((k) => k.offsetParent && getComputedStyle(k).position !== "absolute").map((k) => k.getBoundingClientRect());
      const lines = boxes.some((a) => boxes.some((b) => b.top >= a.bottom - 1)) ? 2 : 1;
      return lines > 1 ? [row.className.trim().split(/\\s+/).join(".") + " (" + Math.round(row.getBoundingClientRect().height) + "px high)"] : [];
    });
    // Menus (U35): desktop menu + dropdowns above 760 px; burger + drawer at 760 px and less. Leaves them closed.
    const nav = [];
    const shown = (el) => !!el && !!el.offsetParent;
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    const onScreen = (el, what) => { const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > cw + 1) nav.push(what + " off screen (" + Math.round(r.left) + "–" + Math.round(r.right) + "px)"); };
    const burger = document.querySelector(".nav-burger"), main = document.querySelector(".mainnav"), drawer = document.querySelector("#nav-drawer");
    if (!burger || !main || !drawer) nav.push("menus not built (js/nav.js)");
    else if (cw > 760) {
      if (!shown(main)) nav.push("main menu hidden");
      if (shown(burger)) nav.push("burger shown");
      if (!main.querySelector('[aria-current="page"], .is-current')) nav.push("no current section in the main menu");
      for (const b of main.querySelectorAll(".menu-caret")) {
        b.click();
        const pop = document.getElementById(b.getAttribute("aria-controls"));
        if (b.getAttribute("aria-expanded") !== "true" || !shown(pop)) nav.push("dropdown " + b.getAttribute("aria-controls") + " does not open");
        else onScreen(pop, "dropdown " + pop.id);
        key(b, "Escape");
        if (b.getAttribute("aria-expanded") !== "false" || shown(pop)) nav.push("dropdown " + b.getAttribute("aria-controls") + " does not close on Escape");
      }
    } else {
      if (shown(main)) nav.push("main menu shown on a phone");
      if (!shown(burger)) nav.push("burger hidden on a phone");
      else {
        burger.click();
        drawer.getAnimations({ subtree: true }).forEach((a) => a.finish());
        if (!drawer.open || burger.getAttribute("aria-expanded") !== "true") nav.push("the burger does not open the drawer");
        else {
          onScreen(drawer, "drawer");
          if (!drawer.querySelector('[aria-current="page"], .is-current')) nav.push("no current page in the drawer");
          if (!drawer.contains(document.activeElement)) nav.push("focus not in the open drawer");
          key(drawer, "Escape");
          if (drawer.open || burger.getAttribute("aria-expanded") !== "false") nav.push("the drawer does not close on Escape");
        }
      }
    }
    return { errors, warnings, width: cw, scrollWidth: d.scrollWidth, wide, wrapped, nav };
  };
})();`;

/** The run wrapper: put or remove the save, open the page in an iframe of the target width, report. */
const FRAME = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body style="margin:0">
<script>
const P = new URLSearchParams(location.search);
const width = Number(P.get("w")), withSave = P.get("save") === "1", settle = Number(P.get("settle"));
// The site's theme is a stored choice (site/theme.js: dark unless "light"), not the OS setting.
localStorage.setItem("theme", P.get("theme") === "light" ? "light" : "dark");
// U29: game names in this language (site/theme.js reads "lang"; English when unset).
localStorage.setItem("lang", P.get("lang") || "en");
function idb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("merchant-rpg-simulator", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function prepare() {
  const db = await idb();
  const save = withSave ? { name: "PlayerData.txt", text: await (await fetch("/__save.txt")).text(), savedAt: Date.now() } : null;
  await new Promise((ok, ko) => {
    const t = db.transaction("kv", "readwrite"), s = t.objectStore("kv");
    if (save) s.put(save, "save"); else s.delete("save");
    s.delete("handle");
    t.oncomplete = ok;
    t.onerror = () => ko(t.error);
  });
  db.close();
}
const run = P.get("__run");
prepare().then(() => {
  const f = document.createElement("iframe");
  f.style.cssText = "border:0;height:900px;width:" + width + "px";
  f.src = P.get("src");
  document.body.append(f);
  setTimeout(() => {
    let r;
    try { r = f.contentWindow.__check ? f.contentWindow.__check() : { errors: ["the probe did not run"] }; } catch (e) { r = { errors: ["report failed: " + e] }; }
    fetch("/__report?id=" + run, { method: "POST", body: JSON.stringify(r) });
  }, settle);
}, (e) => fetch("/__report?id=" + run, { method: "POST", body: JSON.stringify({ errors: ["save setup failed: " + e] }) }));
</script></body></html>`;

const notFound = new Map<string, string[]>(); // run id -> paths that 404'd
const reports = new Map<string, (body: string) => void>(); // run id -> receives the wrapper's report

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const run = (() => {
    const ref = req.headers.referer ?? "";
    return new URL(ref || "http://x/").searchParams.get("__run") ?? url.searchParams.get("__run") ?? "";
  })();
  if (url.pathname === "/__frame.html") return void res.writeHead(200, { "content-type": MIME[".html"] }).end(FRAME);
  if (url.pathname === "/__probe.js") return void res.writeHead(200, { "content-type": MIME[".js"] }).end(PROBE);
  if (url.pathname === "/__report" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      reports.get(url.searchParams.get("id") ?? "")?.(body);
      res.writeHead(200).end("ok");
    });
    return;
  }
  if (url.pathname === "/__save.txt") return void res.writeHead(saveText ? 200 : 404, { "content-type": MIME[".txt"] }).end(saveText ?? "");
  const file = normalize(join(SITE, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(SITE) || !existsSync(file)) {
    if (run) notFound.set(run, [...(notFound.get(run) ?? []), url.pathname]);
    return void res.writeHead(404).end("not found");
  }
  let body: Buffer | string = readFileSync(file);
  if (extname(file) === ".html") body = body.toString("utf8").replace("<head>", '<head><script src="/__probe.js"></script>');
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
});

// ---------------------------------------------------------------- runs
interface Run { page: string; width: number; theme: (typeof THEMES)[number]; save: boolean; id: string }
interface Result extends Run { errors: string[]; warnings: string[]; wide: string[]; overflow: boolean; wrapped: string[]; nav: string[]; notFound: string[]; failed: boolean }

/** A fresh browser profile per run (a closing browser may still hold the previous one); all removed at the end. */
const profiles: string[] = [];
function profileDir(id: string): string {
  const name = `mrs-check-${process.pid}-${id}`;
  const local = WINDOWS ? `/mnt/c/Temp/${name}` : join(tmpdir(), name);
  // /mnt/c (WSL) now and then fails with EIO: retry a few times.
  for (let k = 0; ; k++) {
    try {
      mkdirSync(local, { recursive: true });
      break;
    } catch (e) {
      if (k >= 4) throw e;
      const until = Date.now() + 500;
      while (Date.now() < until) { /* short wait */ }
    }
  }
  profiles.push(local);
  return WINDOWS ? `C:\\Temp\\${name}` : local;
}
/**
 * Stops the browsers whose profile name contains `marker`. Killing the WSL side of a Windows Chrome leaves Chrome
 * running, so on Windows they are found by command line and stopped with PowerShell.
 */
function stopBrowsers(marker: string, wait = false): void {
  if (!WINDOWS) return;
  const ps = ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | `
    + "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"];
  try {
    if (wait) execFileSync("powershell.exe", ps, { stdio: "ignore", timeout: 60000 });
    else spawn("powershell.exe", ps, { stdio: "ignore" });
  } catch { /* best effort */ }
}

function removeProfiles(): void {
  for (const d of profiles) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* a browser still closing: left behind */ }
  }
}

/** One run, retried once when the browser fails to start (exit before any report). */
async function runOne(base: string, r: Run): Promise<Result> {
  let res: Result;
  try {
    res = await runOnce(base, r);
  } catch (e) {
    // A run that can't even start (profile folder) fails alone instead of stopping the sweep.
    return { ...r, errors: [`run not started: ${e instanceof Error ? e.message : e}`], warnings: [], wide: [], overflow: false, wrapped: [], nav: [], notFound: [], failed: true };
  }
  if (res.errors.some((e) => e.startsWith("no report (browser exited"))) {
    notFound.delete(r.id);
    return runOnce(base, { ...r, id: `${r.id}b` });
  }
  return res;
}

function runOnce(base: string, r: Run): Promise<Result> {
  const page = PAGES[r.page];
  const [path, hash = ""] = page.split("#");
  const src = `/${path}?__run=${r.id}${hash ? `#${hash}` : ""}`;
  const url = `${base}/__frame.html?__run=${r.id}&w=${r.width}&save=${r.save ? 1 : 0}&theme=${r.theme}&lang=${lang}&settle=${settleMs}&src=${encodeURIComponent(src)}`;
  const argv = [`--headless=new`, `--user-data-dir=${profileDir(r.id)}`, "--no-first-run", "--no-default-browser-check",
    `--window-size=${Math.max(r.width, 600) + 40},1000`, `--blink-settings=preferredColorScheme=${r.theme === "dark" ? 0 : 1}`, url];
  return new Promise((done) => {
    // Real time: the wrapper posts its report after `settle` ms; the browser is closed then (or after a timeout).
    const chrome = spawn(CHROME, argv, { stdio: "ignore" });
    let finished = false;
    const finish = (body: string | null, why = "") => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reports.delete(r.id);
      chrome.kill();
      stopBrowsers(`mrs-check-${process.pid}-${r.id}`);
      let rep: { errors?: string[]; warnings?: string[]; wide?: string[]; wrapped?: string[]; nav?: string[]; width?: number; scrollWidth?: number };
      try {
        rep = body ? JSON.parse(body) : { errors: [`no report (${why})`] };
      } catch {
        rep = { errors: ["unreadable report"] };
      }
      const nf = notFound.get(r.id) ?? [];
      const overflow = (rep.scrollWidth ?? 0) > (rep.width ?? 0) + 1;
      const errors = rep.errors ?? [];
      const wrapped = rep.wrapped ?? [];
      const nav = rep.nav ?? [];
      done({ ...r, errors, warnings: rep.warnings ?? [], wide: rep.wide ?? [], overflow, wrapped, nav, notFound: nf,
        failed: errors.length > 0 || overflow || wrapped.length > 0 || nav.length > 0 || nf.length > 0 });
    };
    reports.set(r.id, (body) => finish(body));
    const timer = setTimeout(() => finish(null, "timed out"), settleMs + 60000);
    chrome.on("exit", (code) => setTimeout(() => finish(null, `browser exited with ${code}`), 500));
  });
}

async function main(): Promise<void> {
  if (!existsSync(join(SITE, "index.html"))) throw new Error(`no built site in ${SITE}: run npm run site first`);
  // Profiles left by earlier runs (a browser still closing kept its files).
  const tmp = WINDOWS ? "/mnt/c/Temp" : tmpdir();
  for (const d of existsSync(tmp) ? readdirSync(tmp).filter((n) => n.startsWith("mrs-check-")) : []) {
    try {
      rmSync(join(tmp, d), { recursive: true, force: true });
    } catch { /* still in use */ }
  }
  await new Promise<void>((ok) => server.listen(0, "0.0.0.0", ok));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;
  const runs: Run[] = [];
  let k = 0;
  for (const page of Object.keys(PAGES).filter((p) => !only || only.includes(p))) {
    for (const width of WIDTHS) for (const theme of THEMES) for (const save of saveText ? [false, true] : [false]) {
      runs.push({ page, width, theme, save, id: `r${++k}` });
    }
  }
  console.log(`check-site: ${runs.length} runs, ${jobs} at a time, game names in ${lang}, browser ${CHROME}${saveText ? "" : " (no save: runs with a save skipped)"}`);
  const results: Result[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < runs.length) {
      const r = runs[next++];
      const res = await runOne(base, r);
      results.push(res);
      const tag = `${res.page.padEnd(11)} ${String(res.width).padStart(4)} ${res.theme.padEnd(5)} ${res.save ? "save   " : "no save"}`;
      console.log(`${res.failed ? "FAIL" : " ok "} ${tag}${res.warnings.length ? `  (${res.warnings.length} warning${res.warnings.length > 1 ? "s" : ""})` : ""}`);
      for (const e of res.errors) console.log(`       error: ${e.split("\n")[0].slice(0, 220)}`);
      for (const p of res.notFound) console.log(`       404: ${p}`);
      if (res.overflow) console.log(`       page wider than ${res.width}px: ${res.wide.join(", ") || "(no single element found)"}`);
      for (const w of res.wrapped) console.log(`       more than one line: ${w}`);
      for (const n of res.nav) console.log(`       menus: ${n}`);
    }
  }));
  server.close();
  stopBrowsers(`mrs-check-${process.pid}-`, true);
  removeProfiles();
  const failed = results.filter((r) => r.failed);
  console.log(`\n${results.length - failed.length} of ${results.length} runs passed.`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  server.close();
  process.exitCode = 2;
});
