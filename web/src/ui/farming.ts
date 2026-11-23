/**
 * Farming planner page (site/farming.html): where should the party spend its time? Every chosen source (quests,
 * owned maps, catalog maps at ascension 0/1, with up to 3 scrolls on map runs) is simulated with the party from the
 * save, and the economy comes from the profit model (farmingReport, web/src/tools/farming.ts, in farming-worker.ts).
 * Ranked by value per hour: gold from loot minus costs, plus essence at what it would cost to get otherwise.
 *
 * The party is the one picked on the battle page (same browser storage), editable here too.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import type { FarmRow, FarmSource } from "../tools/farming.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, bar, el, fmt, fmt1, gradeBadge, pct, rateTone, select, table, tile } from "./dom.ts";
import type { FarmRequest, FarmResponse } from "./farming-worker.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText } from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const GRADES = ["D", "C", "B", "A", "S"];
const SLOTS = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2]] as const;
const SCROLL_IDS = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69];

interface State {
  sv: Save | null;
  saveName: string;
  slots: Record<string, number | null>;
  skills: Record<number, { attackList: string[]; passive?: string }>;
  worker: Worker | null;
}
const state: State = { sv: null, saveName: "", slots: {}, skills: {}, worker: null };

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

// ---------------------------------------------------------------- party (shared with the battle page)
const partyKey = () => `battle-party:${state.saveName}`;
function persistParty(): void {
  try {
    localStorage.setItem(partyKey(), JSON.stringify({ slots: state.slots, skills: state.skills }));
  } catch { /* storage blocked */ }
}
function restoreParty(heroes: number): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    if (!p) return false;
    const ok = (i: unknown) => i === null || (typeof i === "number" && i >= 0 && i < heroes);
    state.slots = Object.fromEntries(Object.entries(p.slots ?? {}).filter(([, i]) => ok(i))) as State["slots"];
    state.skills = Object.fromEntries(Object.entries(p.skills ?? {}).filter(([i]) => ok(Number(i)))) as State["skills"];
    return Object.values(state.slots).some((v) => v !== null && v !== undefined);
  } catch {
    return false;
  }
}

function renderParty(): void {
  const sv = state.sv!;
  const options: [string, string][] = [["", "— empty —"], ...sv.raw.hero.map((h: Any, i: number): [string, string] =>
    [String(i), `${h.name} · ${G.heroList[h.class]?.name ?? h.class} lv ${h.level}`])];
  const rows = (["front", "back"] as const).map((row) => el("div", { class: "toolbar" },
    el("span", { class: "muted small", style: "min-width: 5.5em" }, row === "front" ? "🛡️ Front" : "🏹 Back"),
    ...[0, 1, 2].map((i) => {
      const key = `${row}${i}`;
      const s = select({ "aria-label": `${row} row slot ${i + 1}` }, options);
      s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
      s.addEventListener("change", () => {
        const v = s.value === "" ? null : Number(s.value);
        if (v !== null) for (const k of Object.keys(state.slots)) if (state.slots[k] === v && k !== key) state.slots[k] = null;
        state.slots[key] = v;
        persistParty();
        renderParty();
      });
      return s;
    })));
  $("#party").replaceChildren(...rows,
    el("p", { class: "muted small" }, "Same party as on the ", el("a", { href: "battle.html" }, "battle simulator"),
      " (rotations edited there are used here too). The searches there can find the best party for a source."));
}

// ---------------------------------------------------------------- sources
interface SourceChoice {
  source: FarmSource;
  /** How the result row shows it. */
  label: () => Node;
}

const questLabel = (id: number, rare: boolean) => {
  const q = G.questData[id];
  return el("span", {}, `👹 ${rare ? q.nameB : q.name}`, el("span", { class: "muted small" }, ` · level ${q.levelReq ?? "?"}${rare ? " · rare" : ""}`));
};

function checkbox(label: Node | string, checked: boolean, value: string): HTMLLabelElement {
  const c = el("input", { type: "checkbox", value }) as HTMLInputElement;
  c.checked = checked;
  return el("label", { class: "check" }, c, label);
}

/** Owned map label: prefix + name + suffix, outlined for its ascension. */
function ownedMapLabel(it: Any): HTMLElement {
  const pre = it.prefix ? G.prefixList[it.prefix]?.name : "", suf = it.suffix > 0 ? G.suffixList[it.suffix]?.name : "";
  const name = [pre, G.itemData.map?.[it.id]?.name ?? `map ${it.id}`, suf].filter(Boolean).join(" ");
  return el("span", { class: "nowrap" }, itemLink("map", it.id, name, undefined, it.prestigeLevel), " ", gradeBadge(GRADES[(it.grade ?? 3) - 1] ?? String(it.grade)));
}

function renderSources(): void {
  const sv = state.sv!;
  const maxLevel = Math.max(...sv.raw.hero.map((h: Any) => h.level ?? 1));
  // Quests: grouped by level band; by default the ones near the party's level.
  const quests = Object.entries<Any>(G.questData).filter(([, q]) => q.enemyHp && q.attackList && q.name)
    .map(([id, q]) => [Number(id), q] as [number, Any]).sort((a, b) => (a[1].levelReq ?? 0) - (b[1].levelReq ?? 0) || a[0] - b[0]);
  const near = (q: Any) => (q.levelReq ?? 0) <= maxLevel && (q.levelReq ?? 0) >= maxLevel - 12;
  const bands = new Map<number, [number, Any][]>();
  for (const x of quests) bands.set(Math.floor((x[1].levelReq ?? 0) / 10) * 10, [...(bands.get(Math.floor((x[1].levelReq ?? 0) / 10) * 10) ?? []), x]);
  const rare = checkbox("Also the rare variants (where the quest has one)", false, "rare");
  const questBox = el("details", { class: "help" }, el("summary", {}, `Quests (preselected: level ${Math.max(0, maxLevel - 12)}–${maxLevel}, around your heroes)`),
    ...[...bands].map(([b, list]) => el("fieldset", { class: "plain" }, el("legend", { class: "muted small" }, `Level ${b}–${b + 9}`),
      el("div", { class: "toolbar" }, ...list.map(([id, q]) => checkbox(`${q.name} (lv ${q.levelReq ?? "?"})`, near(q), `quest:${id}`))))),
    rare);
  // Maps you own, then catalog maps at ascension 0/1.
  const owned = sv.mapInventory;
  const ownedBox = el("div", { class: "toolbar" }, ...(owned.length
    ? owned.map((it: Any, i: number) => checkbox(ownedMapLabel(it), true, `own:${i}`))
    : [el("span", { class: "muted" }, "No maps in this save.")]));
  const catalog = Object.entries<Any>(G.itemData.map ?? {}).filter(([, m]) => m.name && (m.itemLevel ?? 0) <= 60)
    .map(([id, m]) => [Number(id), m] as [number, Any]).sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0]);
  const catBox = el("details", { class: "help" }, el("summary", {}, "Catalog maps (grade S, no prefix or suffix): pick ascension 0 and/or 1"),
    el("div", { class: "toolbar" }, ...catalog.flatMap(([id, m]) => [
      checkbox(el("span", {}, itemLink("map", id), el("span", { class: "muted small" }, ` lv ${m.itemLevel ?? "?"}`)), false, `cat:${id}:0`),
      checkbox(el("span", {}, itemLink("map", id, `${m.name}`, undefined, 1)), false, `cat:${id}:1`),
    ])));
  const scrollOpts: [string, string][] = [["", "— no scroll —"], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id])
    .map((id): [string, string] => [String(id), G.itemData.consumable[id].name])];
  const scrolls = [0, 1, 2].map((k) => select({ class: "farm-scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
  $("#sources").replaceChildren(
    el("h3", {}, "⚔️ Quests"), questBox,
    el("h3", {}, "🗺️ Your maps"), ownedBox,
    catBox,
    el("div", { class: "toolbar" }, el("span", { class: "muted small" }, "Scrolls on every map run (bought for each run)"), ...scrolls));
}

function chosenSources(): SourceChoice[] {
  const sv = state.sv!;
  const out: SourceChoice[] = [];
  const checked = [...document.querySelectorAll<HTMLInputElement>("#sources input[type=checkbox]:checked")].map((c) => c.value);
  const rare = checked.includes("rare");
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.farm-scroll")].map((s) => s.value).filter(Boolean)
    .map((id) => ({ id: Number(id), prestigeLevel: 0 }));
  const compacts = sv.raw.mapInventory.filter((c: unknown) => typeof c === "string");
  for (const v of checked) {
    const [kind, a, b] = v.split(":");
    if (kind === "quest") {
      const id = Number(a);
      out.push({ source: { kind: "quest", quest: id }, label: () => questLabel(id, false) });
      const q = G.questData[id];
      if (rare && q.nameB && q.enemyHpB !== undefined && q.attackListB !== undefined) {
        out.push({ source: { kind: "quest", quest: id, rare: true }, label: () => questLabel(id, true) });
      }
    } else if (kind === "own") {
      const it = sv.mapInventory[Number(a)];
      out.push({ source: { kind: "map", map: compacts[Number(a)], scrolls }, label: () => ownedMapLabel(it) });
    } else if (kind === "cat") {
      const id = Number(a), asc = Number(b);
      out.push({ source: { kind: "map", map: { id, prestigeLevel: asc, grade: 5 }, scrolls },
        label: () => el("span", { class: "nowrap" }, itemLink("map", id, undefined, undefined, asc), " ", gradeBadge("S")) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- run
function partyRequest(): Pick<FarmRequest, "front" | "back" | "skills"> {
  const sv = state.sv!;
  const front: (Any | null)[] = [null, null, null], back: (Any | null)[] = [null, null, null];
  type Choice = { attackList: string[]; passive?: string } | null;
  const skills = { front: [null, null, null] as Choice[], back: [null, null, null] as Choice[] };
  for (const [row, i] of SLOTS) {
    const idx = state.slots[`${row}${i}`];
    if (idx === null || idx === undefined) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
  }
  return { front, back, skills };
}

function run(): void {
  const out = $("#results");
  const party = partyRequest();
  if (![...party.front, ...party.back].some(Boolean)) {
    out.replaceChildren(el("p", { class: "error", role: "alert" }, "Put at least one hero in the party."));
    return;
  }
  const choices = chosenSources();
  if (!choices.length) {
    out.replaceChildren(el("p", { class: "error", role: "alert" }, "Pick at least one quest or map."));
    return;
  }
  const n = Math.max(1, Math.min(1000, Math.trunc(Number($<HTMLInputElement>("#n").value) || 1)));
  const mapRuns = Math.max(1, Math.min(200, Math.trunc(Number($<HTMLInputElement>("#map-runs").value) || 1)));
  state.worker?.terminate();
  const w = new Worker(new URL("js/farming-worker.js", document.baseURI), { type: "module" });
  state.worker = w;
  const btn = $<HTMLButtonElement>("#run");
  const stage = el("span", { class: "muted small" }, "Starting…");
  const prog = bar(0);
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const stop = () => {
    w.terminate();
    state.worker = null;
    btn.disabled = false;
  };
  cancel.addEventListener("click", () => {
    stop();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  btn.disabled = true;
  out.replaceChildren(el("div", { class: "toolbar" }, stage, cancel), prog);
  w.onmessage = (e: MessageEvent<FarmResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
      (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
      return;
    }
    stop();
    if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
    else out.replaceChildren(...results(m.rows, choices, m.ms));
  };
  w.onerror = (e) => {
    stop();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  const req: FarmRequest = { gameMode: state.sv!.raw.gameMode || "Standard", ...party, sources: choices.map((c) => c.source), n, mapRuns };
  w.postMessage(req);
}

// ---------------------------------------------------------------- results
const gph = (x: number) => `${fmt.format(x)} g/h`;

function results(rows: FarmRow[], choices: SourceChoice[], ms: number): HTMLElement[] {
  const ranked = rows.map((r, i) => ({ r, c: choices[i] })).sort((a, b) => b.r.value_per_hour - a.r.value_per_hour);
  const best = ranked[0];
  const losing = best.r.value_per_hour <= 0;
  const headline = el("div", { class: "enemy farm-best" },
    el("p", { class: "section-label" }, losing ? "⚠️ Every source here costs more than it earns: the least costly is" : "🏆 Best use of your heroes' time"),
    el("div", { class: "toolbar" }, el("strong", { style: "font-size: 1.15rem" }, best.c.label()),
      el("span", {}, el("strong", {}, `${fmt.format(best.r.value_per_hour)} g`), " of value per hour")),
    el("p", { class: "muted small", style: "margin: 0" },
      `${gph(best.r.gold_per_hour)} from loot after costs + ${fmt1.format(best.r.essence_per_hour)} essence per hour ` +
      `(${fmt.format(best.r.essence_value * best.r.runs_per_hour)} g at what it would cost to make otherwise). ` +
      `Win rate ${pct(best.r.win)}, ${fmt1.format(best.r.time_h * 60)} min per run, ${pct(best.r.death_rate)} hero deaths.`));
  const tiles = el("div", { class: "tiles" }, ...ranked.slice(0, 3).map(({ r, c }, k) =>
    tile(`#${k + 1} · ${c.source.kind === "quest" ? "quest" : "map"}`, `${fmt.format(r.value_per_hour)} g/h`,
      `${pct(r.win)} wins · ${fmt1.format(r.essence_per_hour)} essence/h`,
      { icon: ["🥇", "🥈", "🥉"][k], tone: r.value_per_hour > 0 ? "good" : "bad", ...(r.value_per_hour > 0 && best.r.value_per_hour > 0 ? { bar: r.value_per_hour / best.r.value_per_hour } : {}) })));
  const data = ranked.map(({ r }, i) => ({
    i, rank: i + 1, value: r.value_per_hour, gold: r.gold_per_hour, essence: r.essence_per_hour, win: r.win, grade: r.grade,
    minutes: r.time_h * 60, cost: r.cost.total, loot: r.loot_value, ess_run: r.essence_total, deaths: r.death_rate,
    ess_names: Object.entries(r.essence).map(([k, v]) => `${fmt1.format(v)} ${k}`).join(", "),
  }));
  return [headline, tiles,
    table(data, [
      { key: "rank", label: "#", num: true },
      { key: "source", label: "Source", render: (x) => ranked[Number(x.i)].c.label() },
      { key: "value", label: "Value / h", num: true, render: (x) => el("strong", {}, fmt.format(Number(x.value))) },
      { key: "gold", label: "Gold / h", num: true }, { key: "essence", label: "Essence / h", num: true, show: (v) => fmt1.format(Number(v)) },
      { key: "win", label: "Win", num: true, render: (x) => el("span", { class: `rate ${rateTone(Number(x.win))}`, style: "color: var(--c)" }, pct(Number(x.win))) },
      { key: "grade", label: "Grade", num: true, show: (v) => (Number(v) ? fmt1.format(Number(v)) : "–") },
      { key: "minutes", label: "Min / run", num: true, show: (v) => fmt1.format(Number(v)) },
      { key: "cost", label: "Cost / run", num: true }, { key: "loot", label: "Loot / run", num: true },
      { key: "ess_names", label: "Essence / run" },
      { key: "deaths", label: "Deaths", num: true, show: (v) => pct(Number(v)) },
    ]),
    el("p", { class: "muted small" }, "Value per hour = loot sell value minus the run's cost (quest gold, the map, the scrolls), plus essence valued at " +
      "its cheapest production cost (profit model, grade 3), per hour of the party's time. Win rate, grade and time come from the fights; " +
      `same seeds for every source. Negative: the source costs more than it earns at these prices. ${fmt1.format(ms / 1000)} s.`)];
}

// ---------------------------------------------------------------- page
async function loadSave(text: string, name: string): Promise<void> {
  await Promise.all([loadData(), loadWikiText()]);
  let sv: Save;
  try {
    sv = loadSaveText(text);
  } catch {
    throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
  }
  if (!Array.isArray(sv.raw?.hero) || !sv.raw.hero.length) throw new Error("this save has no heroes.");
  api.setMode(sv.raw.gameMode || "Standard");
  state.sv = sv;
  state.saveName = name;
  state.slots = {};
  state.skills = {};
  if (!restoreParty(sv.raw.hero.length)) {
    // No party picked yet: the six highest-level heroes, front then back.
    const top = sv.raw.hero.map((h: Any, i: number) => [i, h.level ?? 0] as [number, number]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    top.forEach(([i], k) => (state.slots[`${k < 3 ? "front" : "back"}${k % 3}`] = i));
  }
  $("#setup").hidden = false;
  $("#results").replaceChildren();
  renderParty();
  renderSources();
}

function init(): void {
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.sv = null;
      $("#setup").hidden = true;
    },
  });
  $("#run").addEventListener("click", run);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
}

init();
