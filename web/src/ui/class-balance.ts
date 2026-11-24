/**
 * Class balance page (site/class-balance.html): every class built the same way (classes.ts standardHero: same level,
 * ascension, gear rule and rotation rule) fights the same quests solo on the same seeds, so the differences come from
 * the class. Runs classMatrix in class-balance-worker.ts; shows a per-class summary and a class × quest matrix
 * (win %, turns, the enemy's lowest HP point), heat-coloured by win rate. No save needed.
 *
 * Expansions (U28): the classes, the ascension 2 tier (levels 51–60) and the quests of expansions the visitor hides
 * (expansion-state.ts) are left out; the options follow the expansion switches.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import type { ClassMatrixRow, GearPolicy } from "../tools/classes.ts";
import { classIds, summarizeByClass } from "../tools/classes.ts";
import { isVisible, subscribe, syncWithStoredSave } from "./expansion-state.ts";
import { mountExpansionChip } from "./expansion-menu.ts";
import { maxLevel } from "../tools/levelling.ts";
import { $, bar, el, fmt, fmt1, pct, select, table } from "./dom.ts";
import type { ClassesRequest, ClassesResponse } from "./class-balance-worker.ts";
import { tip } from "./tooltip.ts";
import { classLink, enemyLink, isEnemy, isGathering, loadWikiText, passiveLink, skillLink } from "./wiki-data.ts";
import { languageReady, onLanguageChange, rerenderKeeping } from "./language.ts";
import { className, enemyName } from "./names.ts";

let worker: Worker | null = null;

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

/** Party quests and bosses (questData.party): fights meant for several heroes; off = solo quests only. */
const withParty = () => document.querySelector<HTMLInputElement>("#party")?.checked ?? false;

/** Level bands of quests: 1-10, 11-20, ... (enemies only, normal variants; party bosses only when asked). */
function questsIn(lo: number, hi: number): number[] {
  return Object.keys(G.questData).map(Number)
    // Quest bushes (gathering quests) are left out: they never attack, every class wins them.
    .filter((id) => isEnemy(id) && !isGathering(id) && G.questData[id].enemyHp && G.questData[id].attackList && (withParty() || !G.questData[id].party) && isVisible("enemy", id))
    .filter((id) => (G.questData[id].levelReq ?? 0) >= lo && (G.questData[id].levelReq ?? 0) <= hi)
    .sort((a, b) => (G.questData[a].levelReq ?? 0) - (G.questData[b].levelReq ?? 0) || a - b);
}
const bandOf = (level: number) => Math.max(0, Math.ceil(level / 10) - 1);
const bandRange = (k: number): [number, number] => [10 * k + 1, 10 * k + 10];

// ---------------------------------------------------------------- options
function renderOptions(): void {
  const asc = $<HTMLSelectElement>("#asc"), level = $<HTMLInputElement>("#level"), band = $<HTMLSelectElement>("#band");
  const ref = $<HTMLSelectElement>("#ref"), skills = $<HTMLSelectElement>("#skills");
  let bands: number[] = [];
  const fillBands = () => {
    const k = band.value;
    bands = Array.from({ length: 6 }, (_, k) => k).filter((k) => questsIn(...bandRange(k)).length);
    band.replaceChildren(...bands.map((b) => el("option", { value: String(b) }, `Level ${bandRange(b)[0]}–${bandRange(b)[1]} (${questsIn(...bandRange(b)).length} quests)`)));
    if (bands.map(String).includes(k)) band.value = k;
  };
  /** Ascension 2 (prestige 3) needs the Frozen Tome: its option goes when the visitor hides it. */
  const syncAsc = () => {
    for (const o of [...asc.options]) o.hidden = o.disabled = !isVisible("prestige", Number(o.value) + 1);
    if (asc.selectedOptions[0]?.disabled) asc.value = [...asc.options].filter((o) => !o.disabled).at(-1)?.value ?? "0";
  };
  syncAsc();
  fillBands();
  const syncLevel = () => {
    const max = maxLevel(Number(asc.value) + 1);
    level.max = String(max);
    if (Number(level.value) > max) level.value = String(max);
  };
  const syncBand = () => {
    const k = bandOf(Number(level.value) || 1);
    if (bands.includes(k)) band.value = String(k);
    syncRef();
  };
  const syncRef = () => {
    const qs = questsIn(...bandRange(Number(band.value)));
    const was = ref.value;
    ref.replaceChildren(el("option", { value: "auto" }, "Auto: toughest quest a class can win"),
      el("option", { value: "each" }, "Each quest (one search per quest, slower)"),
      el("optgroup", { label: "This quest" }, ...qs.map((q) => el("option", { value: String(q) }, `Lv ${G.questData[q].levelReq} · ${enemyName(q)}`))));
    ref.value = [...ref.options].some((o) => o.value === was) ? was : "auto";
    ref.disabled = skills.value !== "search";
  };
  asc.addEventListener("change", () => (syncLevel(), syncBand()));
  level.addEventListener("change", () => (syncLevel(), syncBand()));
  band.addEventListener("change", syncRef);
  // The party toggle changes the quest counts of the bands and the reference quest list.
  $("#party").addEventListener("change", () => {
    fillBands();
    syncRef();
  });
  skills.addEventListener("change", syncRef);
  refreshRef = syncRef;
  syncLevel();
  syncBand();
  // The expansion switches changed: ascension options, quest bands and the reference quest follow.
  subscribe(() => {
    syncAsc();
    syncLevel();
    fillBands();
    syncBand();
  });
}

function request(): ClassesRequest {
  const prestige = Number($<HTMLSelectElement>("#asc").value) + 1;
  const level = Math.max(1, Math.min(maxLevel(prestige), Math.trunc(Number($<HTMLInputElement>("#level").value) || 60)));
  const heavy = $<HTMLInputElement>("#heavy").checked;
  const ref = $<HTMLSelectElement>("#ref").value;
  return {
    quests: questsIn(...bandRange(Number($<HTMLSelectElement>("#band").value))), level, prestige,
    classes: classIds().filter((c) => isVisible("class", c)),
    gearPolicy: $<HTMLSelectElement>("#gear").value as GearPolicy,
    skills: $<HTMLSelectElement>("#skills").value as "default" | "search",
    searchQuest: ref === "auto" || ref === "each" ? ref : Number(ref),
    n: heavy ? 100 : 30, searchN: heavy ? 20 : 10, searchNFinal: heavy ? 80 : 30,
  };
}

// ---------------------------------------------------------------- run
/** U29: the reference-quest picker's refill and the last result, both drawn again in another language. */
let refreshRef: (() => void) | null = null;
let drawLast: (() => void) | null = null;

function run(): void {
  const out = $("#out"), btn = $<HTMLButtonElement>("#run");
  drawLast = null;
  const req = request();
  if (!req.quests.length) {
    out.replaceChildren(el("p", { class: "error", role: "alert" }, "No quest in this level band."));
    return;
  }
  worker?.terminate();
  const w = new Worker(new URL("js/class-balance-worker.js", document.baseURI), { type: "module" });
  worker = w;
  const stage = el("span", { class: "muted small" }, "Starting…");
  const prog = bar(0);
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const stop = () => {
    w.terminate();
    if (worker === w) worker = null;
    btn.disabled = false;
  };
  cancel.addEventListener("click", () => {
    stop();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  btn.disabled = true;
  out.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, cancel), prog));
  w.onmessage = (e: MessageEvent<ClassesResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
      (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
      return;
    }
    stop();
    if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
    else {
      drawLast = () => out.replaceChildren(...results(m.rows, req, m.searchQuest), el("p", { class: "muted small" },
        `${fmt.format(m.rows.length)} class × quest cells, ${req.n} fights each on seeds 1–${req.n}, in ${fmt1.format(m.ms / 1000)} s. `
        + "Enemy HP removed: the share of its HP taken off at its lowest point, averaged over the quests."));
      drawLast();
    }
  };
  w.onerror = (e) => {
    stop();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  w.postMessage(req);
}

// ---------------------------------------------------------------- results
/** Win rate as a single-hue heat (sequential: light = low, strong = high), the number always printed. */
const heat = (win: number) => `background: color-mix(in srgb, var(--heat) ${Math.round(8 + win * 62)}%, var(--card-2))`;

function results(rows: ClassMatrixRow[], req: ClassesRequest, ref: number | "each" | null): Node[] {
  const sum = summarizeByClass(rows);
  const first = new Map<number, ClassMatrixRow>();
  for (const r of rows) if (!first.has(r.classId)) first.set(r.classId, r);
  const quests = req.quests.filter((q) => rows.some((r) => r.quest === q));
  const refText = req.skills !== "search" ? "the game's default rotation (all Basic)"
    : ref === "each" ? "a rotation searched for each quest" : `a rotation searched on ${enemyName(Number(ref)) ?? "?"}`;
  return [
    el("p", { class: "muted small" }, `Level ${req.level}, ${req.prestige > 1 ? `ascension ${req.prestige - 1}` : "no ascension"}, `
      + `${req.gearPolicy === "best" ? "the same best catalog gear for every class" : req.gearPolicy === "fit" ? "gear fitted to each class" : "no gear"}, ${refText}.`),
    el("h3", { class: "sub" }, "By class"),
    table(sum.map((s, k) => ({
      rank: k + 1, id: s.classId, win: s.win, soloable: s.soloable, quests: s.quests, peak: s.enemyHpRemovedPeak, dealt: s.dmgDealt, taken: s.dmgTaken,
    })), [
      { key: "rank", label: "#", num: true },
      { key: "id", label: "Class", render: (r) => classLink(Number(r.id)) },
      { key: "win", label: "Mean win", num: true, render: (r) => el("span", { class: "cb-pill", style: heat(Number(r.win)) }, pct(Number(r.win))) },
      { key: "soloable", label: "Won ≥ 90%", num: true, render: (r) => el("span", {}, `${r.soloable} of ${r.quests}`) },
      { key: "peak", label: "Enemy HP removed", num: true, show: (v) => pct(Number(v)) },
      { key: "dealt", label: "Damage dealt / fight", num: true, show: (v) => fmt.format(Number(v)) },
      { key: "taken", label: "Damage taken / fight", num: true, show: (v) => fmt.format(Number(v)) },
      { key: "rot", label: "Rotation · passive", render: (r) => {
        const f = first.get(Number(r.id))!;
        return el("span", { class: "skill-line cb-rot" }, ...f.rotation.flatMap((s, i) => [...(i ? [", "] : []), s === "Basic" ? "Basic" : skillLink(s)]),
          " · ", f.passive && f.passive !== "None" ? passiveLink(f.passive) : el("span", { class: "muted" }, "no passive"));
      } },
    ]),
    el("h3", { class: "sub" }, "Class × quest"),
    matrix(sum.map((s) => s.classId), quests, rows),
    el("p", { class: "muted small" }, "Each cell: win rate (colour, darker = more wins), turns per fight, and the bar = how much of the enemy's HP "
      + "was removed at its lowest point (it shows progress even in lost fights, and against enemies that heal back). "
      + "Hover a cell for the details; quests link to the enemy's page with its 5-turn timeline."),
  ];
}

function matrix(classes: number[], quests: number[], rows: ClassMatrixRow[]): HTMLElement {
  const cell = new Map(rows.map((r) => [`${r.classId}:${r.quest}`, r]));
  const head = el("tr", {}, el("th", {}, "Class"), ...quests.map((q) => el("th", { class: "cb-q" },
    enemyLink({ id: q }), el("span", { class: "muted small" }, ` lv ${G.questData[q].levelReq}`))));
  const body = classes.map((c) => el("tr", {}, el("th", { scope: "row" }, classLink(c)), ...quests.map((q) => {
    const r = cell.get(`${c}:${q}`);
    if (!r) return el("td", { class: "cb-cell muted" }, "–");
    const td = el("td", { class: "cb-cell", style: heat(r.win), tabindex: "0" },
      el("strong", {}, pct(r.win)), el("span", { class: "small" }, `${fmt1.format(r.turns)} t`),
      el("span", { class: "cb-bar", "aria-hidden": "true" }, el("span", { style: `width: ${Math.max(0, Math.min(100, r.enemyHpRemovedPeak * 100))}%` })));
    const who = className(r.classId) ?? r.className, what = enemyName(r.quest) ?? r.questName;
    td.setAttribute("aria-label", `${who} against ${what}: win ${pct(r.win)}, ${fmt1.format(r.turns)} turns, enemy HP removed at its lowest ${pct(r.enemyHpRemovedPeak)}`);
    tip(td, () => el("span", { class: "tip-body" }, el("strong", {}, `${className(r.classId) ?? r.className} vs ${enemyName(r.quest) ?? r.questName}`),
      el("span", { class: "tip-kind" }, `${r.n} fights, level ${r.level}`),
      el("span", {}, `Win ${pct(r.win)} · ${fmt1.format(r.turns)} turns${r.turnsWin !== null ? ` (${fmt1.format(r.turnsWin)} when won)` : ""}`),
      el("span", {}, `Enemy HP removed: ${pct(r.enemyHpRemovedPeak)} at its lowest, ${pct(r.enemyHpRemoved)} at the end`),
      el("span", {}, `Hero HP left ${pct(r.hpLeft)} · dies ${pct(r.deathRate)}`),
      el("span", { class: "muted" }, `Dealt ${fmt.format(r.dmgDealt)}, taken ${fmt.format(r.dmgTaken)}, healed ${fmt.format(r.healing)} per fight`)));
    return td;
  })));
  return el("div", { class: "table-wrap cb-matrix" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

// ---------------------------------------------------------------- page
async function init(): Promise<void> {
  try {
    await Promise.all([loadData(), loadWikiText(), languageReady]);
  } catch (e) {
    $("#out").replaceChildren(el("p", { class: "error", role: "alert" }, String(e)));
    return;
  }
  renderOptions();
  $("#run").addEventListener("click", run);
  $<HTMLButtonElement>("#run").disabled = false;
  void syncWithStoredSave();
  onLanguageChange(() => {
    refreshRef?.();
    if (drawLast && !worker) rerenderKeeping($("#out"), drawLast);
  });
}

mountExpansionChip();

init();
