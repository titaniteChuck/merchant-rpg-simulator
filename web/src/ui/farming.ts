/**
 * Farming planner page (site/farming.html): where should the party spend its time? Every chosen source (quests,
 * owned maps, catalog maps at ascension 0/1, with up to 3 scrolls on map runs) is simulated with the party from the
 * save, and the economy comes from the profit model (farmingReport, web/src/tools/farming.ts, in farming-worker.ts).
 * Ranked by value per hour: gold from loot minus costs (revives included), plus essence at what it would cost to get
 * otherwise.
 *
 * The party is the one picked on the battle page (same browser storage, read and written whole: the Simulator's locks
 * and ticked-out heroes are kept, F02), editable here too. Each source is fought by the heroes the Battle page would
 * send (F01, farming-party.ts fightingSlots); a source the game wouldn't start is a "can't start" row with the reason.
 * The worker, and the price Solver it holds, stays alive between runs (F06).
 *
 * Expansions (U28): quests, catalog maps and scrolls of expansions the visitor hides are not offered (the save's own
 * maps always are, unless Scribe is hidden: then no map at all, as on the Battle pages); the choices are rebuilt,
 * ticks kept, when the expansion switches change.
 *
 * Second batch (farming-view.ts): rare quests tagged "random offer" (F07); no headline card, win and grade before the
 * value (F09); the source cell wraps and the party selects fit a phone (F11); the Rank box sits above the source
 * lists, folds summed up as "Quests · 12 ticked" (F12); a note on the value when the save isn't in Standard mode
 * (F19); a map row's time split into craft and run (F20); event bosses in their own unticked group (F22); a result
 * dimmed with "rank again" once the party or the sources change (F23).
 *
 * Review R3 (review-r3.md, Farming): tiles named after the source (F26), "value/h" with its gold and essence parts
 * (F27), losses in red (F29), Levelling's hero labels (F30), party rows on a grid (F31), "None" scrolls (F32), help by
 * tip() instead of `title` (F33, F38), the source's level or map grade on a second line (F34, F35), "–" for no
 * essence (F36), the table's edge fade on a phone (F37).
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import type { FarmRow, FarmSource } from "../tools/farming.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, bar, duration, el, fmt, fmt1, GRADE_LETTERS, gradeBadge, goldNumber, pct, rateTone, select, table, tile } from "./dom.ts";
import type { FarmRequest, FarmResponse } from "./farming-worker.ts";
import { FARM_SLOTS, farmQuestIds, fightingSlots, questGroups, readStoredParty, storedPartyWith, tickedByDefault } from "./farming-party.ts";
import {
  costTip, ERRORS_TIP, essenceText, foldSummary, GOLD_HELP, gradeTip, LEFT_OUT_TIP, NO_SCROLL, PARTY_TIP, RANDOM_OFFER,
  RANDOM_OFFER_TIP, SCROLLS_TIP, setupSignature, sourceSub, timeTip, toneOf, valueHelp, valueParts, valueSplit, valueSplitParts, valueText,
} from "./farming-view.ts";
import { heroLabels } from "./levelling-view.ts";
import { tip } from "./tooltip.ts";
import { initSaveSource } from "./save-source.ts";
import { itemLink, loadWikiText } from "./wiki-data.ts";
import { helpTip } from "./wiki-help.ts";
import { badgeFor, isHidden, isVisible, subscribe } from "./expansion-state.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { className, enemyName, itemName, itemNameFromEnglish, modItemName } from "./names.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const SCROLL_IDS = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69];

interface State {
  sv: Save | null;
  saveName: string;
  slots: Record<string, number | null>;
  skills: Record<number, { attackList: string[]; passive?: string }>;
  /** Slots ticked out on the Simulator (kept, F02): their heroes don't fight. */
  excluded: Record<string, boolean>;
  worker: Worker | null;
  busy: boolean;
}
const state: State = { sv: null, saveName: "", slots: {}, skills: {}, excluded: {}, worker: null, busy: false };

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
    let prev: Record<string, unknown> | null = null;
    try {
      prev = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    } catch { /* broken JSON: written over */ }
    localStorage.setItem(partyKey(), JSON.stringify(storedPartyWith(prev, state.slots, state.skills)));
  } catch { /* storage blocked */ }
}
function restoreParty(heroes: number): boolean {
  try {
    const p = readStoredParty(localStorage.getItem(partyKey()), heroes);
    if (!p) return false;
    state.slots = p.slots;
    state.skills = p.skills;
    state.excluded = p.excluded;
    return Object.values(state.slots).some((v) => v !== null && v !== undefined);
  } catch {
    return false;
  }
}

/** `e` with a one-line tip shown on hover, focus and tap (F33, F38: no `title`, which touch never shows). */
function tipped<T extends HTMLElement>(e: T, text: string): T {
  e.classList.add("farm-tip");
  e.tabIndex = 0;
  tip(e, () => text);
  return e;
}

function renderParty(): void {
  const sv = state.sv!;
  // F30: Levelling's labels: ascension, and a number for heroes sharing a name
  const labels = heroLabels(sv.raw.hero, (c) => className(c) ?? String(c));
  const options: [string, string][] = [["", "— empty —"], ...labels.map((l, i): [string, string] => [String(i), l])];
  const rows = (["front", "back"] as const).map((row) => el("div", { class: "farm-party-row" },
    el("span", { class: "muted small farm-row-label" }, row === "front" ? "Front" : "Back"),
    ...[0, 1, 2].map((i) => {
      const key = `${row}${i}`;
      const s = select({ "aria-label": `${row === "front" ? "Front" : "Back"} ${i + 1}` }, options);
      s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
      s.addEventListener("change", () => {
        const v = s.value === "" ? null : Number(s.value);
        if (v !== null) for (const k of Object.keys(state.slots)) if (state.slots[k] === v && k !== key) state.slots[k] = null;
        state.slots[key] = v;
        persistParty();
        renderParty();
      });
      const out = state.excluded[key] && s.value !== "";
      return out ? el("span", { class: "farm-slot" }, s, tipped(el("span", { class: "pill plain" }, "left out"), LEFT_OUT_TIP)) : s;
    })));
  $("#party").replaceChildren(...rows);
}

// ---------------------------------------------------------------- sources
interface SourceChoice {
  source: FarmSource;
  /** Its name (with the map icon for a map): the podium tile's label (F26). */
  name: () => Node;
  /** How the result row shows it: the name, then a second line (F34, F35). */
  label: () => Node;
}

const randomTag = () => {
  const t = tipped(el("span", { class: "pill plain farm-random" }, RANDOM_OFFER), RANDOM_OFFER_TIP);
  t.addEventListener("click", (e) => e.preventDefault()); // a tap shows the tip, not a tick of the "Rare variants" box
  return t;
};

/** A result row's source: the name (and tag) on one line, the level or the map's grade muted under it (F34, F35). */
const sourceCell = (name: Node, sub: string, ...after: Node[]) =>
  el("span", { class: "farm-src" }, el("span", {}, name, ...after), el("span", { class: "muted small farm-src-sub" }, sub));

const questName = (id: number, rare: boolean) => {
  const q = G.questData[id];
  return el("span", {}, enemyName(id, rare) ?? (rare ? q.nameB : q.name));
};
const questLabel = (id: number, rare: boolean) =>
  sourceCell(questName(id, rare), sourceSub({ kind: "quest", level: G.questData[id].levelReq }), ...(rare ? [document.createTextNode(" "), randomTag()] : []));
const mapName = (link: HTMLElement) => el("span", {}, el("span", { "aria-hidden": "true" }, "🗺️ "), link);
const ownedMapLink = (it: Any) => itemLink("map", it.id, modItemName("map", it.id, it), undefined, it.prestigeLevel, { always: true });
const mapGrade = (it: Any) => GRADE_LETTERS[(it.grade ?? 3) - 1] ?? String(it.grade);

function checkbox(label: Node | string, checked: boolean, value: string): HTMLLabelElement {
  const c = el("input", { type: "checkbox", value }) as HTMLInputElement;
  c.checked = checked;
  return el("label", { class: "check" }, c, label);
}

/** Owned map label: its name with prefix and suffix (modItemName), outlined for its ascension, and its grade. */
function ownedMapLabel(it: Any): HTMLElement {
  return el("span", { class: "nowrap" }, ownedMapLink(it), " ", gradeBadge(mapGrade(it)));
}

function renderSources(): void {
  const sv = state.sv!;
  const maxLevel = Math.max(...sv.raw.hero.map((h: Any) => h.level ?? 1));
  // Quests (F04, F05): quest-board quests up to level 60, no placeholder; grouped by level band, the ones near the
  // party's level ticked; event bosses in their own group, unticked (F22).
  const quests = farmQuestIds((id) => isVisible("enemy", id));
  const rare = checkbox(el("span", {}, "Rare variants ", randomTag()), false, "rare");
  const questBox = el("details", { class: "help farm-fold", "data-label": "Quests" }, el("summary", {}, "Quests"),
    ...questGroups(quests).map((g) => el("fieldset", { class: "plain" }, el("legend", { class: "muted small" }, g.label),
      el("div", { class: "toolbar" }, ...g.ids.map((id) => {
        const q = G.questData[id];
        return checkbox(el("span", {}, enemyName(id) ?? q.name,
          el("span", { class: "muted small" }, ` Lv ${q.levelReq ?? "?"}`), badgeFor("enemy", id) ?? ""), tickedByDefault(id, maxLevel), `quest:${id}`);
      })))),
    rare);
  // Maps you own, then catalog maps at ascension 0/1; nothing of maps with Scribe hidden (F15, as the Battle pages).
  const mapsOn = !isHidden("Scribe");
  const owned = mapsOn ? sv.mapInventory : [];
  const catalog = !mapsOn ? [] : Object.entries<Any>(G.itemData.map ?? {}).filter(([id, m]) => m.name && (m.itemLevel ?? 0) <= 60 && isVisible("map", Number(id)))
    .map(([id, m]) => [Number(id), m] as [number, Any]).sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || a[0] - b[0]);
  const mapBlocks: HTMLElement[] = [];
  if (owned.length) {
    mapBlocks.push(el("h3", {}, "Your maps"),
      el("div", { class: "toolbar" }, ...owned.map((it: Any, i: number) => checkbox(ownedMapLabel(it), true, `own:${i}`))));
  }
  if (catalog.length) {
    mapBlocks.push(el("details", { class: "help farm-fold", "data-label": "Catalog maps" }, el("summary", {}, "Catalog maps"),
      el("div", { class: "toolbar" }, ...catalog.flatMap(([id, m]) => [
        checkbox(el("span", {}, itemLink("map", id), el("span", { class: "muted small" }, ` Lv ${m.itemLevel ?? "?"}`), " ", gradeBadge("S")), false, `cat:${id}:0`),
        ...(isVisible("map", id, { ascension: 1 }) ? [checkbox(el("span", {}, itemLink("map", id, undefined, undefined, 1), " ", gradeBadge("S")), false, `cat:${id}:1`)] : []),
      ]))));
  }
  if (mapBlocks.length) {
    const scrollOpts: [string, string][] = [["", NO_SCROLL], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id] && isVisible("consumable", id))
      .map((id): [string, string] => [String(id), itemName("consumable", id) ?? G.itemData.consumable[id].name])];
    const scrolls = [0, 1, 2].map((k) => select({ class: "farm-scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
    mapBlocks.push(el("div", { class: "farm-scrolls" }, tipped(el("span", { class: "muted small" }, "Scrolls"), SCROLLS_TIP), ...scrolls));
  }
  $("#sources").replaceChildren(questBox, ...mapBlocks);
  updateSummaries();
}

/** Each fold's summary with its count of ticked quests or maps (F12). */
function updateSummaries(): void {
  document.querySelectorAll<HTMLDetailsElement>("#sources details.farm-fold").forEach((d) => {
    const n = d.querySelectorAll("input[type=checkbox]:checked:not([value=rare])").length;
    const s = d.querySelector("summary");
    if (s) s.textContent = foldSummary(d.dataset.label ?? "", n);
  });
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
      out.push({ source: { kind: "quest", quest: id }, name: () => questName(id, false), label: () => questLabel(id, false) });
      const q = G.questData[id];
      if (rare && q.nameB && q.enemyHpB !== undefined && q.attackListB !== undefined) {
        out.push({ source: { kind: "quest", quest: id, rare: true }, name: () => questName(id, true), label: () => questLabel(id, true) });
      }
    } else if (kind === "own") {
      const it = sv.mapInventory[Number(a)];
      out.push({ source: { kind: "map", map: compacts[Number(a)], scrolls }, name: () => mapName(ownedMapLink(it)),
        label: () => sourceCell(ownedMapLink(it), sourceSub({ kind: "map", grade: mapGrade(it) })) });
    } else if (kind === "cat") {
      const id = Number(a), asc = Number(b);
      const link = () => itemLink("map", id, undefined, undefined, asc);
      out.push({ source: { kind: "map", map: { id, prestigeLevel: asc, grade: 5 }, scrolls }, name: () => mapName(link()),
        label: () => sourceCell(link(), sourceSub({ kind: "map", grade: "S" })) });
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
  for (const { key, row, i } of FARM_SLOTS) {
    const idx = state.slots[key];
    if (idx === null || idx === undefined) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
  }
  return { front, back, skills };
}

/** The last result, drawn again in another language (U29). */
let drawLast: (() => void) | null = null;

/** The page's worker, kept between runs (F06: its Solver is solved once). */
function farmWorker(): Worker {
  state.worker ??= new Worker(new URL("js/farming-worker.js", document.baseURI), { type: "module" });
  return state.worker;
}
function dropWorker(): void {
  state.worker?.terminate();
  state.worker = null;
}

function run(): void {
  const out = $("#farm-results");
  drawLast = null;
  shownSig = null;
  out.classList.remove("farm-stale");
  const party = partyRequest();
  if (!FARM_SLOTS.some(({ key }) => state.slots[key] !== null && state.slots[key] !== undefined && !state.excluded[key])) {
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
  const mode: string = state.sv!.raw.gameMode || "Standard";
  const sig = currentSignature();
  if (state.busy) dropWorker(); // a run still going: start over
  const w = farmWorker();
  const btn = $<HTMLButtonElement>("#run");
  const stage = el("span", { class: "muted small" }, "Starting…");
  const prog = bar(0);
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const finished = () => {
    state.busy = false;
    btn.disabled = false;
  };
  cancel.addEventListener("click", () => {
    dropWorker();
    finished();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  state.busy = true;
  btn.disabled = true;
  out.replaceChildren(el("div", { class: "toolbar" }, stage, cancel), prog);
  w.onmessage = (e: MessageEvent<FarmResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
      (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
      return;
    }
    finished();
    if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
    else {
      shownSig = sig;
      drawLast = () => {
        out.replaceChildren(...results(m.rows, choices, mode));
        refreshStale();
      };
      drawLast();
    }
  };
  w.onerror = (e) => {
    dropWorker();
    finished();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  // F01: per source, the heroes the Battle page would send, or why the game wouldn't start it
  const fight = choices.map((c) => {
    const f = fightingSlots(c.source, state.slots, state.excluded);
    return Array.isArray(f) ? f : f.problem;
  });
  const req: FarmRequest = { gameMode: mode, ...party, sources: choices.map((c) => c.source), fight, n, mapRuns };
  w.postMessage(req);
}

// ---------------------------------------------------------------- out-of-date result (F23)
/** The setup the shown result was ranked from. */
let shownSig: string | null = null;

function currentSignature(): string {
  return setupSignature({
    slots: state.slots, excluded: state.excluded,
    sources: [...document.querySelectorAll<HTMLInputElement>("#sources input[type=checkbox]:checked")].map((c) => c.value),
    scrolls: [...document.querySelectorAll<HTMLSelectElement>("select.farm-scroll")].map((s) => s.value),
    n: Number($<HTMLInputElement>("#n").value), mapRuns: Number($<HTMLInputElement>("#map-runs").value),
  });
}

/** Dim the shown result, with a note, once the party or the sources no longer match it. */
function refreshStale(): void {
  const out = $("#farm-results");
  const stale = Boolean(drawLast && shownSig !== null && !state.busy && currentSignature() !== shownSig);
  out.classList.toggle("farm-stale", stale);
  const note = out.querySelector(".farm-stale-note");
  if (stale && !note) out.prepend(el("p", { class: "farm-stale-note", role: "status" }, "Party or sources changed: rank again"));
  if (!stale) note?.remove();
}

// ---------------------------------------------------------------- results
function results(rows: FarmRow[], choices: SourceChoice[], mode: string): HTMLElement[] {
  const all = rows.map((r, i) => ({ r, c: choices[i] }));
  const live = all.filter((x) => !x.r.blocked).sort((a, b) => b.r.value_per_hour - a.r.value_per_hour);
  const ranked = [...live, ...all.filter((x) => x.r.blocked)];
  // F09: no headline card (the #1 tile says it); win and grade before the value
  // F26, F27: each tile is named after its source, "#1" as its icon; "value/h" over its gold and essence parts
  const top: HTMLElement[] = [];
  if (live.length) {
    const best = live[0];
    top.push(el("div", { class: "tiles span-last" }, ...live.slice(0, 3).map(({ r, c }, k) => {
      const t = tile("", valueText(r.value_per_hour), valueSplit(r.gold_per_hour, r.essence_per_hour),
        { icon: `#${k + 1}`, tone: r.value_per_hour > 0 ? "good" : "bad",
          ...(r.value_per_hour > 0 && best.r.value_per_hour > 0 ? { bar: r.value_per_hour / best.r.value_per_hour } : {}) });
      t.querySelector(".tile-label")?.replaceChildren(c.name());
      // R3 375 px fixes: the unit smaller beside the number, on the same line; a gold loss red as in the table.
      const [num, unit] = valueParts(r.value_per_hour);
      t.querySelector(".tile-value")?.replaceChildren(`${num} `, el("span", { class: "farm-unit" }, unit));
      const [g, rest] = valueSplitParts(r.gold_per_hour, r.essence_per_hour);
      t.querySelector(".tile-hint")?.replaceChildren(el("span", { class: toneOf(r.gold_per_hour) }, g), rest);
      return t;
    })));
  }
  const data = ranked.map(({ r, c }, i) => ({
    i, blocked: Boolean(r.blocked), rank: r.blocked ? -Infinity : i + 1, name: c.name().textContent ?? r.label,
    value: r.blocked ? -Infinity : r.value_per_hour, gold: r.gold_per_hour, essence: r.essence_per_hour, win: r.win, grade: r.grade,
    time: r.time_h * 3600, cost: r.cost.total, loot: r.loot_value, ess_run: r.essence_total, deaths: r.death_rate,
    ess_names: Object.entries(r.essence).map(([k, v]) => `${fmt1.format(v)} ${itemNameFromEnglish("material", k)}`).join(", "),
  }));
  const rowOf = (x: Record<string, unknown>) => ranked[Number(x.i)].r;
  const dash = (x: Record<string, unknown>, f: () => Node | string): Node | string => (x.blocked ? "–" : f());
  const source = (x: Record<string, unknown>) => {
    const r = rowOf(x);
    return el("span", {}, ranked[Number(x.i)].c.label(),
      ...(r.blocked ? [el("span", { class: "farm-blocked error small" }, `Can't start: ${r.blocked}`)] : []),
      ...(r.errors > 0 ? [tipped(el("span", { class: "muted small farm-runs" }, `${fmt.format(r.n)} of ${fmt.format(r.n + r.errors)} runs`), ERRORS_TIP)] : []));
  };
  const grid = table(data, [
    { key: "rank", label: "#", num: true, render: (x) => dash(x, () => String(x.rank)) },
    { key: "source", label: "Source", render: source, sortBy: (x) => x.name },
    { key: "win", label: "Win", num: true, render: (x) => dash(x, () => el("span", { class: `rate ${rateTone(Number(x.win))}` }, pct(Number(x.win)))) },
    { key: "grade", label: "Grade", num: true, render: (x) => dash(x, () => Number(x.grade)
      ? tipped(el("span", {}, gradeBadge(GRADE_LETTERS[Math.min(4, Math.max(0, Math.round(Number(x.grade)) - 1))])), gradeTip(Number(x.grade)))
      : "–") },
    { key: "value", label: "Value / h", num: true, render: (x) => dash(x, () =>
      tipped(el("strong", { class: toneOf(Number(x.value)) }, fmt.format(Number(x.value))), valueSplit(Number(x.gold), Number(x.essence)))) },
    { key: "gold", label: "Gold / h", num: true, render: (x) => dash(x, () => el("span", { class: toneOf(Number(x.gold)) }, fmt.format(Number(x.gold)))) },
    { key: "essence", label: "Essence / h", num: true, render: (x) => dash(x, () => essenceText(Number(x.essence))) },
    { key: "time", label: "Time / run", num: true, render: (x) => dash(x, () => {
      const t = timeTip(rowOf(x));
      return t ? tipped(el("span", {}, duration(Number(x.time))), t) : duration(Number(x.time));
    }) },
    { key: "cost", label: "Cost / run", num: true, render: (x) => dash(x, () => tipped(el("span", {}, goldNumber(rowOf(x).cost.total)), costTip(rowOf(x).cost))) },
    { key: "loot", label: "Loot / run", num: true, render: (x) => dash(x, () => fmt.format(Number(x.loot))) },
    { key: "ess_names", label: "Essence / run", sortBy: (x) => x.ess_run, render: (x) => dash(x, () => String(x.ess_names || "–")) },
    { key: "deaths", label: "Deaths", num: true, render: (x) => dash(x, () => pct(Number(x.deaths))) },
  ], (x) => (x.blocked ? "farm-row-blocked" : ""));
  grid.classList.add("farm-table");
  const head = (label: string) => [...grid.querySelectorAll("th")].find((th) => th.textContent?.startsWith(label));
  head("Value / h")?.append(helpTip(valueHelp(mode), "Value / h"));
  head("Gold / h")?.append(helpTip(GOLD_HELP, "Gold / h"));
  return [...top, grid];
}

// ---------------------------------------------------------------- page
async function loadSave(text: string, name: string): Promise<void> {
  await Promise.all([loadData(), loadWikiText(), languageReady]);
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
  state.excluded = {};
  if (!restoreParty(sv.raw.hero.length)) {
    // No party picked yet: the six highest-level heroes, front then back.
    const top = sv.raw.hero.map((h: Any, i: number) => [i, h.level ?? 0] as [number, number]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    top.forEach(([i], k) => (state.slots[`${k < 3 ? "front" : "back"}${k % 3}`] = i));
  }
  $("#setup").hidden = false;
  $("#farm-results").replaceChildren();
  $("#farm-results").classList.remove("farm-stale");
  drawLast = null;
  shownSig = null;
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
  tipped($("#party-label"), PARTY_TIP);
  // F12, F23: fold counts follow the ticks; a shown result goes out of date when the setup changes
  $("#setup").addEventListener("change", () => {
    updateSummaries();
    refreshStale();
  });
  $("#setup").addEventListener("input", refreshStale);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
  // The expansion switches changed: rebuild the sources, keeping what was ticked and the scrolls.
  subscribe(rebuildSources);
  // U29: another language: the party pickers, the sources and the last result again, choices kept.
  onLanguageChange(() => {
    if (!state.sv) return;
    renderParty();
    rebuildSources();
    if (!state.busy) drawLast?.();
  });
}

function rebuildSources(): void {
  if (!state.sv) return;
  const ticked = new Map([...document.querySelectorAll<HTMLInputElement>("#sources input[type=checkbox]")].map((c) => [c.value, c.checked]));
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.farm-scroll")].map((s) => s.value);
  renderSources();
  document.querySelectorAll<HTMLInputElement>("#sources input[type=checkbox]").forEach((c) => {
    if (ticked.has(c.value)) c.checked = ticked.get(c.value)!;
  });
  document.querySelectorAll<HTMLSelectElement>("select.farm-scroll").forEach((s, k) => {
    if ([...s.options].some((o) => o.value === scrolls[k])) s.value = scrolls[k];
  });
  updateSummaries();
  refreshStale();
}

init();
