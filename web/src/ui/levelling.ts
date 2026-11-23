/**
 * Levelling page (site/levelling.html): pick a hero from the save, a target level and companions; the worker
 * (levelling-worker.ts) plans the best XP-per-hour quest at every level band (levellingPlan), and compares the hero's
 * tier with the next ascension (prestigePayoff: gains against gold, lost enchants and the hours to level back up).
 * Gathering quests count: they are the best early XP, so they are listed with a "gathering" label.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { availableQuests, type LevellingPlan, maxLevel, type PrestigePayoff } from "../tools/levelling.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import { $, ascText, bar, el, fmt, fmt1, heroAsc, pct, pill, rateTone, select, table, tile, withAsc } from "./dom.ts";
import type { LevelRequest, LevelResponse } from "./levelling-worker.ts";
import { initSaveSource } from "./save-source.ts";
import { enemyLink, isEnemy, loadWikiText } from "./wiki-data.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const COMPANION_SLOTS = ["Front 2", "Front 3", "Back 1", "Back 2", "Back 3"];
const STATS: [string, string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"], ["mdef", "Mdef"], ["acc", "Acc"], ["crit", "Crit"]];

const state: { sv: Save | null; worker: Worker | null; lastPlanQuest: number | null } = { sv: null, worker: null, lastPlanQuest: null };

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

const className = (cls: number) => G.heroList[cls]?.name ?? `class ${cls}`;
const heroRaw = () => state.sv!.raw.hero[Number($<HTMLSelectElement>("#hero").value)];
const isGathering = (id: number) => G.questData[id]?.questType === 1;

/** "12.3 h", or "3 d 4 h" from two days up. */
function hours(h: number): string {
  if (!Number.isFinite(h)) return "?";
  if (h < 48) return `${fmt1.format(h)} h`;
  return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
}

/** A quest's name: a link to the enemy's wiki page, or plain text with a "gathering" label. */
function questCell(id: number): HTMLElement {
  if (isGathering(id)) return el("span", { class: "nowrap" }, G.questData[id]?.name ?? `quest ${id}`, " ", pill("gathering", "t-green"));
  return isEnemy(id) ? enemyLink({ id }) : el("span", {}, G.questData[id]?.name ?? `quest ${id}`);
}

// ---------------------------------------------------------------- step 1: hero and companions
function renderHero(): void {
  const sv = state.sv!;
  const heroes = sv.raw.hero as Any[];
  const label = (h: Any) => `${h.name} · ${className(h.class)} lv ${h.level}`;
  const hero = select({ id: "hero", "aria-label": "Hero to level" }, heroes.map((h, i): [string, string] => [String(i), label(h)]));
  // Default: the lowest hero below its tier's max level (the one that needs levelling most), else the first.
  const below = heroes.map((h, i) => [h, i] as const).filter(([h]) => (h.level ?? 1) < maxLevel(h.prestigeLevel ?? 1));
  hero.value = String(below.sort((a, b) => (a[0].level ?? 1) - (b[0].level ?? 1))[0]?.[1] ?? 0);
  const info = el("div", { class: "lv-hero" });
  const comps = COMPANION_SLOTS.map((slot) => select({ class: "companion", "aria-label": `Companion ${slot}` },
    [["", "— none —"], ...heroes.map((h, i): [string, string] => [String(i), label(h)])]));
  const sync = () => {
    const h = heroRaw();
    const tier = h.prestigeLevel ?? 1, max = maxLevel(tier);
    const target = $<HTMLInputElement>("#target"), from = $<HTMLInputElement>("#from");
    target.max = String(max);
    target.value = String(max);
    from.max = String(max - 1);
    from.value = String(Math.min(h.level ?? 1, max - 1));
    info.replaceChildren(
      el("span", { class: `cls-${h.class}` }, withAsc(el("span", { class: "avatar big" }, String(h.name).slice(0, 1).toUpperCase()), heroAsc(tier), h.name)),
      el("div", {}, el("h3", {}, h.name),
        el("div", { class: "pills" }, el("span", { class: `cls-${h.class}` }, pill(className(h.class))),
          pill(`level ${h.level} of ${max}`, "plain"), pill(ascText(heroAsc(tier)), "plain"),
          ...(h.level >= max ? [pill("max level", "t-green")] : []))));
    // A hero can't be its own companion.
    for (const c of comps) {
      for (const o of c.options) o.disabled = o.value === hero.value;
      if (c.value === hero.value) c.value = "";
    }
    renderRefQuests();
  };
  hero.addEventListener("change", sync);
  $("#hero-box").replaceChildren(el("div", { class: "toolbar" }, hero), info,
    el("h3", { class: "sub" }, "Companions ", el("span", { class: "muted small" }, "(optional: they fight alongside and share the XP; the hero stands in Front 1)")),
    el("div", { class: "lv-companions" }, ...comps.map((c, k) => el("label", { class: "pf-field" }, el("span", {}, COMPANION_SLOTS[k]), c))));
  sync();
}

function options(): LevelRequest["options"] {
  const h = heroRaw();
  const companions = [...document.querySelectorAll<HTMLSelectElement>("select.companion")].map((s) => s.value).filter(Boolean)
    .map((v) => state.sv!.raw.hero[Number(v)]);
  const int = (id: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(Number($<HTMLInputElement>(id).value) || lo)));
  const max = maxLevel(h.prestigeLevel ?? 1);
  return {
    from: int("#from", 1, max - 1),
    to: int("#target", 2, max),
    band: int("#band", 1, 20),
    n: int("#fights", 5, 500),
    amounts: $<HTMLSelectElement>("#amounts").value as "one" | "max" | "all",
    minWin: Number($<HTMLSelectElement>("#minwin").value),
    expModBonus: Number($<HTMLSelectElement>("#xpboost").value) || undefined,
    companions,
  };
}

// ---------------------------------------------------------------- worker
function run(req: LevelRequest, out: HTMLElement, button: HTMLButtonElement, render: (m: Extract<LevelResponse, { type: "done" }>) => Node[]): void {
  state.worker?.terminate();
  const w = new Worker(new URL("js/levelling-worker.js", document.baseURI), { type: "module" });
  state.worker = w;
  const stage = el("span", { class: "muted small" }, "Starting…");
  const prog = bar(0);
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const stop = () => {
    w.terminate();
    if (state.worker === w) state.worker = null;
    button.disabled = false;
  };
  cancel.addEventListener("click", () => {
    stop();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  button.disabled = true;
  out.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, cancel), prog));
  w.onmessage = (e: MessageEvent<LevelResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)} level bands`;
      (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
      return;
    }
    stop();
    if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
    else out.replaceChildren(...render(m), el("p", { class: "muted small" }, `Simulated in ${fmt1.format(m.ms / 1000)} s with fixed seeds.`));
  };
  w.onerror = (e) => {
    stop();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  w.postMessage(req);
}

// ---------------------------------------------------------------- step 2: the plan
function planTable(plan: LevellingPlan): HTMLElement {
  const rows = plan.steps.map((s) => ({
    levels: `${s.fromLevel} → ${s.toLevel}`, quest: s.source.quest, amount: s.source.amount, win: s.source.win,
    xpRun: s.source.xpPerRun, runs: s.runs, hours: s.hours, xph: s.source.xpPerHour, revive: s.reviveGold,
  }));
  return table(rows, [
    { key: "levels", label: "Levels" },
    { key: "quest", label: "Best quest", render: (r) => questCell(Number(r.quest)) },
    { key: "amount", label: "Size", num: true, show: (v) => `×${v}` },
    { key: "win", label: "Win", num: true, render: (r) => el("span", { class: `rate ${rateTone(Number(r.win))}`, style: "color: var(--c)" }, pct(Number(r.win))) },
    { key: "xpRun", label: "XP / run", num: true, show: (v) => fmt.format(Number(v)) },
    { key: "runs", label: "Runs", num: true },
    { key: "hours", label: "Hours", num: true, show: (v) => hours(Number(v)) },
    { key: "xph", label: "XP / hour", num: true, show: (v) => fmt.format(Number(v)) },
    { key: "revive", label: "Revive gold", num: true, show: (v) => `${fmt.format(Number(v))} g` },
  ]);
}

function planSummary(plan: LevellingPlan): Node[] {
  return [
    el("div", { class: "tiles" },
      tile("Time", hours(plan.hours), `levels ${plan.from} → ${plan.steps.at(-1)?.toLevel ?? plan.from}`, { icon: "⏱️", tone: "t-blue" }),
      tile("Quest runs", fmt.format(plan.runs), undefined, { icon: "⚔️", tone: "t-violet" }),
      tile("Revive gold", `${fmt.format(plan.reviveGold)} g`, "expected, for lost fights and deaths", { icon: "🪦", tone: "t-orange" })),
    ...(plan.stuckAt !== undefined ? [el("p", { class: "error", role: "alert" },
      `Stuck at level ${plan.stuckAt}: no quest this hero may take is won often enough (minimum win rate). Add companions or lower the minimum.`)] : []),
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
    return [...planSummary(m.plan), planTable(m.plan),
      el("p", { class: "muted small" }, "Each band starts with the hero rebuilt at its first level (gear it can't wear yet is ignored, as in the game), "
        + "then takes the quest with the most XP per hour among those won at least as often as the minimum. XP is the hero's share "
        + "of the party's split; revive gold counts every hero of the party.")];
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
  // Quests the hero could take at its tier's max level, toughest first. Default: the plan's last quest, else the
  // toughest quest at or below that max level (tougher ones are usually lost by both tiers).
  const max = maxLevel(tier);
  const ids = availableQuests(max, tier).filter((id) => isEnemy(id))
    .sort((a, b) => (G.questData[b].levelReq ?? 0) - (G.questData[a].levelReq ?? 0));
  const ref = select({ id: "ref-quest", "aria-label": "Quest to compare on" },
    ids.map((id): [string, string] => [String(id), `Lv ${G.questData[id].levelReq} · ${G.questData[id].name}`]));
  const fit = ids.find((id) => (G.questData[id].levelReq ?? 0) <= max);
  if (state.lastPlanQuest !== null && ids.includes(state.lastPlanQuest)) ref.value = String(state.lastPlanQuest);
  else if (fit !== undefined) ref.value = String(fit);
  const go = el("button", { type: "button", class: "primary", id: "prestige-run" }, `Compare with ${ascText(tier)}`);
  go.addEventListener("click", runPrestige);
  box.replaceChildren(el("p", { class: "muted small" },
    `Ascending sends ${h.name} back to level 1 with the next tier's growth, a higher max level, 4 more enchant slots and a bigger quest size cap. `
    + "Both tiers are compared at their max level, solo, on the quest below (the new tier without enchants, as right after ascending)."),
  el("div", { class: "toolbar" }, el("label", { class: "pf-field lv-ref" }, el("span", {}, "Reference quest"), ref), go));
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
    ["Win (reference quest)", cur.ref.win, nxt.ref.win, pct], ["Enemy HP removed", cur.ref.enemyPeak, nxt.ref.enemyPeak, pct],
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
      el("div", {}, el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body))),
        el("p", { class: "muted small" }, "Stats and the reference fight at each tier's max level, solo, with the hero's gear.")),
      el("div", { class: "lv-cost" }, el("h3", {}, "What it costs"),
        el("dl", { class: "facts" },
          el("dt", {}, "Level required"), el("dd", {}, `${p.levelRequired} `, ok ? pill("reached", "t-green") : pill(`${raw.name} is ${raw.level}`, "t-orange")),
          el("dt", {}, "Gold"), el("dd", {}, `${fmt.format(p.gold)} g`),
          el("dt", {}, "Enchants lost"), el("dd", {}, String(p.enchantsLost)),
          el("dt", {}, "Back to max level"), el("dd", {}, r.stuckAt !== undefined ? `stuck at level ${r.stuckAt}` : `${hours(r.hours)}, ${fmt.format(r.runs)} runs`),
          el("dt", {}, "Revive gold on the way"), el("dd", {}, `${fmt.format(r.reviveGold)} g`)))),
    el("details", { class: "help" }, el("summary", {}, "Levelling back up after ascending"), ...planSummary(r), planTable(r)),
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
  state.lastPlanQuest = null;
  $("#setup").hidden = false;
  $("#plan-out").replaceChildren();
  $("#prestige-out").replaceChildren();
  renderHero();
}

function init(): void {
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.worker?.terminate();
      state.sv = null;
      $("#setup").hidden = true;
    },
  });
  loadWikiText();
  $("#plan-run").addEventListener("click", runPlan);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
}

init();
