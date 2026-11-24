/**
 * Levelling page (site/levelling.html): pick a hero from the save, a target level and companions; the worker
 * (levelling-worker.ts, kept alive between runs) plans the best XP-per-hour quest at every level band (levellingPlan),
 * and compares the hero's tier with the next ascension (prestigePayoff: gains against gold, lost enchants and the
 * hours to level back up to the new max level).
 * Quest bushes (gathering quests) count: they are the best early XP, so they are listed with a "quest bush" label.
 * The plan follows the expansion switches: only visible quests, and no map runs while Scribe is hidden.
 * Any change of an input dims the results shown until the next run.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import {
  type LevellingPlan, type LevelStep, maxLevel, openableQuests, planSources, type PrestigePayoff, xpBoosts,
} from "../tools/levelling.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import {
  $, ascText, bar, duration, el, EXPANSION_LABEL, expansionBadge, fmt, fmt1, gold, heroAsc, pct, pill, rateTone, type Row, segmented, select, table,
  tile, withAsc,
} from "./dom.ts";
import { isHidden, isVisible, needsOf, subscribe } from "./expansion-state.ts";
import type { LevelRequest, LevelResponse } from "./levelling-worker.ts";
import { xpText } from "./quest-xp.ts";
import { initSaveSource } from "./save-source.ts";
import { tip } from "./tooltip.ts";
import { enemyLink, isEnemy, itemLink, loadWikiText, REGIONS } from "./wiki-data.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { className as classNameOf, enemyName, itemName, markName, regionName } from "./names.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const COMPANIONS = 5;
const STATS: [string, string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"], ["mdef", "Mdef"], ["acc", "Acc"], ["crit", "Crit"]];

const state: {
  sv: Save | null; worker: Worker | null; busy: HTMLElement | null; lastPlanQuest: number | null;
  amounts: "one" | "max" | "all"; minWin: string; xpBoost: string;
} = { sv: null, worker: null, busy: null, lastPlanQuest: null, amounts: "all", minWin: "0.5", xpBoost: "0" };

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

const className = (cls: number) => classNameOf(cls) ?? `class ${cls}`;
/** A hero in the pickers: "Aria · Warrior lv 42" (class in the visitor's language, U29). */
const heroLabel = (h: Any) => `${h.name} · ${className(h.class)} lv ${h.level}`;
const heroRaw = () => state.sv!.raw.hero[Number($<HTMLSelectElement>("#hero").value)];
const isGathering = (id: number) => G.questData[id]?.questType === 1;
const hoursText = (h: number) => duration(h * 3600);
const companionSelects = () => [...document.querySelectorAll<HTMLSelectElement>("select.companion")];

/** A field label with a one-line tooltip (shown on hover, focus and tap). */
function labelTip(id: string, text: string): void {
  const l = document.getElementById(id);
  if (!l) return;
  l.classList.add("lv-tip");
  l.tabIndex = 0;
  tip(l, () => text);
}

/** A quest's name: a link to the enemy's wiki page, or plain text with a "quest bush" label. */
function questCell(id: number): HTMLElement {
  if (isGathering(id)) return markName(el("span", { class: "nowrap" }, enemyName(id) ?? `quest ${id}`, " ", pill("quest bush", "t-green")), "enemy", id);
  return isEnemy(id) ? enemyLink({ id }) : markName(el("span", {}, enemyName(id) ?? `quest ${id}`), "enemy", id);
}

/**
 * U33: a step's source. A map step names the map (source.label; source.quest is only its boss): the map's link in the
 * visitor's language with its ascension, or the label itself; a quest step stays the quest's cell.
 */
function sourceCell(r: Row): HTMLElement {
  if (r.kind !== "map") return questCell(Number(r.quest));
  const map = r.map === null || r.map === undefined ? undefined : Number(r.map);
  const name = map !== undefined && G.itemData.map?.[map] ? itemLink("map", map, undefined, undefined, r.asc) : el("span", {}, String(r.label ?? `quest ${r.quest}`));
  return el("span", { class: "nowrap" }, name, " ", pill("map run", "t-gold"));
}

const potionName = (id: number) => itemName("consumable", id) ?? G.itemData.consumable?.[id]?.name ?? `potion ${id}`;

/** "launch 1,200 g · revive 300 g · 12 XP Boost +2: 2,400 g · maps 0 g", the parts that aren't 0. */
function goldSplit(g: { launchGold: number; reviveGold: number; potionGold: number; mapGold: number; potions: number }, potion?: number): string {
  const parts: string[] = [];
  if (g.launchGold) parts.push(`launch ${gold(g.launchGold)}`);
  if (g.reviveGold) parts.push(`revive ${gold(g.reviveGold)}`);
  if (g.potions) parts.push(`${fmt.format(g.potions)} ${potion ? potionName(potion) : "potions"} ${gold(g.potionGold)}`);
  if (g.mapGold) parts.push(`maps ${gold(g.mapGold)}`);
  return parts.join(" · ");
}
const stepGold = (s: LevelStep) => s.launchGold + s.reviveGold + s.potionGold + s.mapGold;

// ---------------------------------------------------------------- stale results
/** An input changed: dim the results on screen (they no longer match) until the next run. */
function markStale(): void {
  for (const id of ["#plan-out", "#prestige-out"]) {
    const out = document.querySelector<HTMLElement>(id);
    if (!out || !out.querySelector(".lv-result") || out.classList.contains("lv-stale")) continue;
    out.classList.add("lv-stale");
    out.prepend(el("p", { class: "lv-stale-note muted small" }, "Settings changed: run it again for new figures."));
  }
}
function clearStale(out: HTMLElement): void {
  out.classList.remove("lv-stale");
}

// ---------------------------------------------------------------- step 1: hero and companions
/** Each hero once: the levelled hero and the heroes picked in the other companion selects are disabled. */
function syncCompanions(): void {
  const hero = $<HTMLSelectElement>("#hero").value;
  const comps = companionSelects();
  for (const c of comps) if (c.value === hero) c.value = "";
  for (const c of comps) {
    const taken = new Set([hero, ...comps.filter((o) => o !== c).map((o) => o.value).filter(Boolean)]);
    for (const o of c.options) o.disabled = o.value !== "" && taken.has(o.value);
  }
}

function renderHero(): void {
  const sv = state.sv!;
  const heroes = sv.raw.hero as Any[];
  const hero = select({ id: "hero", "aria-label": "Hero to level" }, heroes.map((h, i): [string, string] => [String(i), heroLabel(h)]));
  // Default: the lowest hero below its tier's max level (the one that needs levelling most), else the first.
  const below = heroes.map((h, i) => [h, i] as const).filter(([h]) => (h.level ?? 1) < maxLevel(h.prestigeLevel ?? 1));
  hero.value = String(below.sort((a, b) => (a[0].level ?? 1) - (b[0].level ?? 1))[0]?.[1] ?? 0);
  const info = el("div", { class: "lv-hero" });
  const comps = Array.from({ length: COMPANIONS }, (_, k) => select({ class: "companion", "aria-label": `Companion ${k + 1}` },
    [["", "— none —"], ...heroes.map((h, i): [string, string] => [String(i), heroLabel(h)])]));
  const sync = () => {
    const h = heroRaw();
    const tier = h.prestigeLevel ?? 1, max = maxLevel(tier), atMax = (h.level ?? 1) >= max;
    const target = $<HTMLInputElement>("#target"), from = $<HTMLInputElement>("#from");
    target.max = String(max);
    target.value = String(max);
    from.max = String(max - 1);
    // A hero at max level: plan a fresh hero of its class and ascension.
    from.value = String(atMax ? 1 : Math.min(h.level ?? 1, max - 1));
    info.replaceChildren(
      el("span", { class: `cls-${h.class}` }, withAsc(el("span", { class: "avatar big" }, String(h.name).slice(0, 1).toUpperCase()), heroAsc(tier), h.name)),
      el("div", {}, el("h3", {}, h.name),
        el("div", { class: "pills" }, el("span", { class: `cls-${h.class}` }, markName(pill(className(h.class)), "class", h.class)),
          pill(`level ${h.level} of ${max}`, "plain"), pill(ascText(heroAsc(tier)), "plain"),
          ...(atMax ? [pill("max level: planned from level 1", "t-green")] : []))));
    syncCompanions();
    state.lastPlanQuest = null;
    renderRefQuests();
    markStale();
  };
  hero.addEventListener("change", sync);
  for (const c of comps) c.addEventListener("change", () => (syncCompanions(), markStale()));
  const head = el("h3", { class: "sub" }, el("span", { id: "companions-label" }, "Companions"));
  $("#hero-box").replaceChildren(el("div", { class: "toolbar" }, hero), info, head,
    el("div", { class: "lv-companions" }, ...comps));
  labelTip("companions-label", "Up to 5. They join party quests they may join and map runs, never solo quests, and share the XP.");
  sync();
}

/** Quest-board quests and maps the visitor sees (expansion switches). */
const visibleSources = () => planSources((kind, id) => isVisible(kind, id), isHidden("Scribe"));

function options(): LevelRequest["options"] {
  const h = heroRaw();
  const companions = companionSelects().map((s) => s.value).filter(Boolean).map((v) => state.sv!.raw.hero[Number(v)]);
  const int = (id: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(Number($<HTMLInputElement>(id).value) || lo)));
  const max = maxLevel(h.prestigeLevel ?? 1);
  return {
    from: int("#from", 1, max - 1),
    to: int("#target", 2, max),
    band: int("#band", 1, 20),
    n: int("#fights", 5, 100),
    amounts: state.amounts,
    minWin: Number(state.minWin),
    xpBoost: Number(state.xpBoost) || undefined,
    companions,
    ...visibleSources(),
  };
}

/** Quest size, minimum win rate and XP potion as segmented controls. */
function renderSegments(): void {
  const put = (field: string, seg: HTMLElement) => {
    const f = $(field);
    f.querySelector(".seg")?.remove();
    f.append(seg);
  };
  const changed = (k: "amounts" | "minWin" | "xpBoost") => (v: string) => {
    (state as Any)[k] = v;
    markStale();
  };
  put("#amounts-field", segmented("lv-amounts", "Quest size", [
    { value: "all", label: "×1 and max" }, { value: "one", label: "×1" }, { value: "max", label: "Max" },
  ], state.amounts, changed("amounts")));
  put("#minwin-field", segmented("lv-minwin", "Minimum win rate", ["0.5", "0.75", "0.9", "0.99"].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` })),
    state.minWin, changed("minWin")));
  put("#xpboost-field", segmented("lv-xpboost", "XP potion", [
    { value: "0", label: "None" },
    ...xpBoosts().map((b) => ({ value: String(b.id), label: markName(el("span", {}, potionName(b.id)), "consumable", b.id) })),
  ], state.xpBoost, changed("xpBoost")));
}

// ---------------------------------------------------------------- worker
function worker(): Worker {
  state.worker ??= new Worker(new URL("js/levelling-worker.js", document.baseURI), { type: "module" });
  return state.worker;
}
/** Stop the worker (and the run it is doing: its output says so). */
function killWorker(): void {
  state.worker?.terminate();
  state.worker = null;
  state.busy?.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  state.busy = null;
  document.querySelectorAll<HTMLButtonElement>("#plan-run, #prestige-run").forEach((b) => (b.disabled = false));
}

function run(req: LevelRequest, out: HTMLElement, button: HTMLButtonElement, render: (m: Extract<LevelResponse, { type: "done" }>) => Node[]): void {
  // A run still going is cancelled (its worker is dropped); a finished worker is reused.
  if (state.busy) killWorker();
  const w = worker();
  state.busy = out;
  const stage = el("span", { class: "muted small" }, "Starting…");
  const prog = bar(0);
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const finish = () => {
    state.busy = null;
    button.disabled = false;
    w.onmessage = null;
    w.onerror = null;
  };
  cancel.addEventListener("click", killWorker);
  button.disabled = true;
  clearStale(out);
  out.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, cancel), prog));
  w.onmessage = (e: MessageEvent<LevelResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      stage.textContent = m.stage === "done" ? "Finishing…" : `${m.stage[0].toUpperCase()}${m.stage.slice(1)} · ${m.total ? Math.floor((100 * m.done) / m.total) : 0}%`;
      (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
      return;
    }
    finish();
    if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
    else out.replaceChildren(el("div", { class: "lv-result" }, ...render(m)));
  };
  w.onerror = (e) => {
    state.busy = null;
    killWorker();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  w.postMessage(req);
}

// ---------------------------------------------------------------- step 2: the plan
/** A column header with a one-line tooltip. */
function headTip(t: HTMLElement, col: number, text: string): void {
  const th = t.querySelectorAll("thead th")[col];
  if (!th) return;
  th.classList.add("lv-tip");
  th.setAttribute("tabindex", "0");
  tip(th, () => text);
}

function planTable(plan: LevellingPlan): HTMLElement {
  const potions = plan.potions > 0;
  const rows = plan.steps.map((s) => ({
    levels: `${s.fromLevel} → ${s.toLevel}`, kind: s.source.kind, quest: s.source.quest, map: s.source.map ?? null, asc: s.source.asc ?? 0,
    label: s.source.label ?? null, amount: s.source.amount, win: s.win, xpRun: s.xpPerRun, runs: s.runs, hours: s.hours,
    xpm: s.xpPerHour / 60, gold: stepGold(s), split: goldSplit(s, s.source.boost), potions: s.potions, boost: s.source.boost ?? null,
  }));
  const t = table(rows, [
    { key: "levels", label: "Levels" },
    { key: "quest", label: "Best quest", render: sourceCell },
    { key: "amount", label: "Quest size", num: true, show: (v) => `×${v}` },
    { key: "win", label: "Win", num: true, render: (r) => el("span", { class: `rate ${rateTone(Number(r.win))}`, style: "color: var(--c)" }, pct(Number(r.win))) },
    { key: "xpRun", label: "XP / run", num: true, show: (v) => xpText(Number(v)) },
    { key: "runs", label: "Runs", num: true },
    { key: "hours", label: "Time", num: true, show: (v) => hoursText(Number(v)) },
    { key: "xpm", label: "XP / min", num: true, show: (v) => xpText(Number(v)) },
    ...(potions ? [{ key: "potions", label: "XP potions", num: true, render: (r: Row) =>
      el("span", {}, r.boost ? `${fmt.format(Number(r.potions))} × ${potionName(Number(r.boost))}` : "—") }] : []),
    { key: "gold", label: "Gold", num: true, render: (r) => {
      const c = el("span", {}, gold(Number(r.gold)));
      if (r.split) tip(c, () => String(r.split));
      return c;
    } },
  ]);
  headTip(t, 3, "Fights won (map runs: whole runs won).");
  headTip(t, 7, "The hero's XP per minute of quest time (map runs: craft + run).");
  headTip(t, potions ? 9 : 8, "Quest launches, revives, XP potions and maps.");
  return t;
}

function planSummary(plan: LevellingPlan): Node[] {
  const split = goldSplit(plan, plan.steps.find((s) => s.source.boost)?.source.boost);
  return [
    el("div", { class: "tiles" },
      tile("Time", hoursText(plan.hours), `levels ${plan.from} → ${plan.steps.at(-1)?.toLevel ?? plan.from}`, { icon: "⏱️", tone: "t-blue" }),
      tile("Runs", fmt.format(plan.runs), undefined, { icon: "⚔️", tone: "t-violet" }),
      tile("Gold", gold(plan.gold), split || undefined, { icon: "💰", tone: "t-orange" })),
    ...(plan.stuckAt !== undefined ? [el("p", { class: "error", role: "alert" },
      `Stuck at level ${plan.stuckAt}: no quest this hero may take is won often enough. Add companions or lower the minimum win rate.`)] : []),
  ];
}

function runPlan(): void {
  const h = heroRaw();
  const out = $("#plan-out");
  const o = options();
  if ((o.from ?? 1) >= (o.to ?? 2)) {
    out.replaceChildren(el("p", { class: "muted" }, "The start level must be below the target level."));
    return;
  }
  run({ kind: "plan", gameMode: state.sv!.raw.gameMode || "Standard", hero: h, options: o }, out, $<HTMLButtonElement>("#plan-run"), (m) => {
    if (m.kind !== "plan") return [];
    const last = m.plan.steps.at(-1);
    if (last) {
      state.lastPlanQuest = last.source.quest;
      renderRefQuests();
    }
    return [...planSummary(m.plan), planTable(m.plan)];
  });
}

// ---------------------------------------------------------------- step 3: next ascension
function renderRefQuests(): void {
  const box = $("#ref-box");
  if (!state.sv) return;
  const h = heroRaw();
  const tier = h.prestigeLevel ?? 1;
  const last = tier >= (G.heroMaxPrestigeLevel ?? 3);
  if (last) {
    box.replaceChildren(el("p", { class: "muted" }, `${h.name} is at the last ascension: nothing more to unlock.`));
    return;
  }
  // U28: the next tier may be expansion content (ascension 2 = prestige 3 needs the Frozen Tome).
  if (!isVisible("prestige", tier + 1)) {
    box.replaceChildren(el("p", { class: "muted" }, `${ascText(tier)[0].toUpperCase()}${ascText(tier).slice(1)} (levels 51–60) needs the `,
      expansionBadge(needsOf("prestige", tier + 1), { link: true }), ` ${needsOf("prestige", tier + 1).map((x) => EXPANSION_LABEL[x]).join(" and the ")}, which you don't own. `
      + "Set it in the expansions menu of the top bar to compare."));
    return;
  }
  // Quests the hero could open at its tier's max level, by region (toughest region first), toughest first. Default:
  // the plan's last quest, else the toughest one at or below that max level.
  const max = maxLevel(tier);
  const ids = openableQuests(max, tier).filter((id) => isEnemy(id) && !isGathering(id) && isVisible("enemy", id))
    .sort((a, b) => (G.questData[b].levelReq ?? 0) - (G.questData[a].levelReq ?? 0));
  const groups = REGIONS.slice().reverse().map((r): [string, [string, string][]] => [regionName(r.id, r.full),
    ids.filter((id) => G.questData[id].region === r.id).map((id): [string, string] => [String(id), `Lv ${G.questData[id].levelReq} · ${enemyName(id)}`])])
    .filter(([, list]) => list.length);
  const ref = select({ id: "ref-quest", "aria-label": "Quest to compare on" }, groups);
  const fit = ids.find((id) => (G.questData[id].levelReq ?? 0) <= max);
  if (state.lastPlanQuest !== null && ids.includes(state.lastPlanQuest)) ref.value = String(state.lastPlanQuest);
  else if (fit !== undefined) ref.value = String(fit);
  ref.addEventListener("change", markStale);
  const go = el("button", { type: "button", class: "primary", id: "prestige-run" }, `Compare with ${ascText(tier)}`);
  go.addEventListener("click", runPrestige);
  box.replaceChildren(el("div", { class: "toolbar" }, el("label", { class: "pf-field lv-ref" }, el("span", { id: "ref-label" }, "Reference quest"), ref), go));
  labelTip("ref-label", "Both tiers at their max level, solo; the new tier without enchants, as right after ascending.");
}

function payoffView(p: PrestigePayoff, raw: Any): Node[] {
  const cur = p.current, nxt = p.next;
  const delta = (a: number, b: number) => {
    const d = b - a;
    return el("span", { class: d > 0 ? "up" : d < 0 ? "down" : "muted" }, d === 0 ? "=" : `${d > 0 ? "+" : "−"}${fmt.format(Math.abs(d))}`);
  };
  const rows: [string, number, number, ((v: number) => string)?][] = [
    ["Max level", cur.maxLevel, nxt.maxLevel], ["Enchant slots", cur.enchantSlots, nxt.enchantSlots], ["Quest size cap", cur.questAmountCap, nxt.questAmountCap],
    ...STATS.map(([k, l]): [string, number, number] => [l, cur.stats[k] ?? 0, nxt.stats[k] ?? 0]),
    ["Win", cur.ref.win, nxt.ref.win, pct], ["HP removed (best)", cur.ref.enemyPeak, nxt.ref.enemyPeak, pct],
  ];
  const head = el("tr", {}, el("th", {}, ""), el("th", { class: "num" }, `Now (${ascText(cur.tier - 1)})`),
    el("th", { class: "num" }, `After (${ascText(nxt.tier - 1)})`), el("th", { class: "num" }, "Change"));
  /** Rates (f = pct) change in percentage points, counts and stats by their difference. */
  const change = (a: number, b: number, rate: boolean) => {
    if (!rate) return delta(a, b);
    const d = (b - a) * 100;
    return el("span", { class: d > 0.05 ? "up" : d < -0.05 ? "down" : "muted" }, Math.abs(d) < 0.05 ? "=" : `${d > 0 ? "+" : "−"}${fmt1.format(Math.abs(d))} pts`);
  };
  const body = rows.map(([label, a, b, f]) => el("tr", {}, el("td", {}, label), el("td", { class: "num" }, f ? f(a) : fmt.format(a)),
    el("td", { class: "num" }, f ? f(b) : fmt.format(b)), el("td", { class: "num" }, change(a, b, Boolean(f)))));
  const ok = (raw.level ?? 1) >= p.levelRequired;
  const r = p.relevel;
  return [
    el("div", { class: "lv-payoff" },
      el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body))),
      el("div", { class: "lv-cost" }, el("h3", {}, "What it costs"),
        el("dl", { class: "facts" },
          el("dt", {}, "Level required"), el("dd", {}, `${p.levelRequired} `, ok ? pill("reached", "t-green") : pill(`${raw.name} is ${raw.level}`, "t-orange")),
          el("dt", {}, "Gold"), el("dd", {}, gold(p.gold)),
          el("dt", {}, "Enchants lost"), el("dd", {}, String(p.enchantsLost)),
          el("dt", {}, `Back to ${r.to}`), el("dd", {}, r.stuckAt !== undefined ? `stuck at level ${r.stuckAt}` : `${hoursText(r.hours)}, ${fmt.format(r.runs)} runs`),
          el("dt", {}, "Gold on the way"), el("dd", {}, gold(r.gold))))),
    el("details", { class: "help" }, el("summary", {}, `Levelling back to ${r.to} after ascending`), ...planSummary(r), planTable(r)),
  ];
}

function runPrestige(): void {
  const h = heroRaw();
  const ref = Number($<HTMLSelectElement>("#ref-quest").value);
  run({ kind: "prestige", gameMode: state.sv!.raw.gameMode || "Standard", hero: h, options: options(), refQuest: ref }, $("#prestige-out"),
    $<HTMLButtonElement>("#prestige-run"), (m) => (m.kind === "prestige" ? payoffView(m.payoff, h) : []));
}

// ---------------------------------------------------------------- page
async function loadSave(text: string, _name: string): Promise<void> {
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
  state.lastPlanQuest = null;
  $("#setup").hidden = false;
  for (const id of ["#plan-out", "#prestige-out"]) {
    clearStale($(id));
    $(id).replaceChildren();
  }
  renderSegments();
  renderHero();
}

function init(): void {
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      killWorker();
      state.sv = null;
      $("#setup").hidden = true;
    },
  });
  loadWikiText();
  $("#plan-run").addEventListener("click", runPlan);
  for (const id of ["#from", "#target", "#band", "#fights"]) $(id).addEventListener("input", markStale);
  labelTip("from-label", "The hero's level by default; lower it to plan a fresh hero of the same class, gear and ascension.");
  labelTip("band-label", "The best quest is chosen again at the start of each step.");
  labelTip("fights-label", "More fights: steadier figures, slower (100 at most).");
  labelTip("amounts-label", "×N: one enemy with N× HP, XP, gold and time. The max comes from the highest ascension in the fight.");
  labelTip("minwin-label", "Only quests won at least this often: a lost quest gives no XP and costs revives.");
  labelTip("xpboost-label", "The strongest potion the hero may drink at each step, up to this one; one lasts 3 quests or 3 map rooms.");
  // U28: the plan's quests and maps, the next-ascension block and its quest list follow the expansion switches.
  subscribe(() => {
    renderRefQuests();
    markStale();
  });
  // U29: names update in place (marked links and labels); the pickers get their labels again, choices kept.
  onLanguageChange(() => {
    if (!state.sv) return;
    const heroes = state.sv.raw.hero as Any[];
    document.querySelectorAll<HTMLSelectElement>("#hero, select.companion").forEach((s) => {
      for (const o of s.options) if (o.value !== "" && heroes[Number(o.value)]) o.textContent = heroLabel(heroes[Number(o.value)]);
    });
    const ref = document.querySelector<HTMLSelectElement>("#ref-quest")?.value;
    renderRefQuests();
    const now = document.querySelector<HTMLSelectElement>("#ref-quest");
    if (now && ref && [...now.options].some((o) => o.value === ref)) now.value = ref;
  });
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
}

init();
