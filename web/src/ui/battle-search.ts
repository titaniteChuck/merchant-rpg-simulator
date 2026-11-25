/**
 * The Solver page (site/solver.html, U41; the battle page's Solve mode until then, Best party before U36):
 * searchParties of parties.ts in the battle worker, with progress and a soft Cancel (the search stops at its next
 * check and keeps what it found). The page passes a SearchContext so this module doesn't import it. Best gear, Best
 * potion / enchant and Optimise everything left the page in U36; their engine code (combat.ts, consumables.ts,
 * optimise.ts) and the worker's handlers stay.
 *
 * U27: the solver is a spoiler (it gives the answer to a quest or map), so its panel starts hidden behind a
 * disclaimer; "Show me the solver anyway" is remembered in this browser (localStorage `battle-solver-shown`) and a
 * warning line with "Hide it again" stays. U39: while the guard is up, the page hides all the rest of the Solver
 * (SearchContext.guarded): the opponent and options, the Results, the party and flow.
 *
 * U42: the options sit in the page's one Solve panel (with the opponent's pickers): party sizes, Include scrolls, the
 * time budget in seconds (30 by default) and Solve; a running solve's progress is in that panel, and the results
 * section stays hidden until a solve is done.
 *
 * U41: each result has a "Show" button (was "Load"): it puts the setup in the party (slots, rotations, passives,
 * scrolls), then SearchContext.onShow lets the page bring its Party and Flow tabs.
 *
 * U36: the results table shows only the setups worth trying (battle-setup.ts solveShortlist): no 0 % result, within
 * 25 % of the best one found, at most 5. E25: winners (90 % or more) first; within the winners, and within the others,
 * the fewest scrolls first (a run needing no scrolls first). A map run's Scrolls cell says "No scrolls" (a pill) or the
 * count and the scrolls.
 *
 * R2 (mobile review): the sizes on one row, "Party 1 – 5", the opponent's limit in their "?" (F31); Include scrolls only
 * for a map run (F31); Show is the first column and a tap on the row shows too, no hero-count column, a quest's lowest
 * enemy HP under the win rate (F32); one status line, "3 setups ≥ 90 % · 5.0 s", the rest in its "?" (battle-setup.ts
 * solveStatus: a spent time budget is an ordinary end, only Cancel reads as stopped, F34); the row icon inline with its
 * first chip and a "?" on "rough" (F35).
 *
 * Expansions (U28): heroes of a hidden class start ticked in "Leave heroes out".
 */
import * as api from "../sim/api.ts";
import type { FightEval, MapEval } from "../tools/combat.ts";
import type { PartiesResult, PartyConfig } from "../tools/parties.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import type { Save } from "../tools/save.ts";
import type { SearchRequest, SearchResponse, SkillChoice } from "./battle-worker.ts";
import { dataWorker } from "./data-files.ts";
import type { PartyRules } from "./battle-rules.ts";
import { ROUGH_HELP, scrollCount, sizeHelp, solveShortlist, solveStatus } from "./battle-setup.ts";
import { bar, el, fmt, fmt1, pct, rateTone } from "./dom.ts";
import { itemLink } from "./wiki-data.ts";
import { isVisible } from "./expansion-state.ts";
import { helpTip } from "./wiki-help.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface PartyMember {
  row: "front" | "back";
  i: number;
  /** index in save.raw.hero */
  idx: number;
  raw: Any;
}

export interface SearchContext {
  save(): Save;
  gameMode(): string;
  /** Heroes in the six slots and their edited rotations, as the worker takes them. */
  party(): { front: (Any | null)[]; back: (Any | null)[]; skills: { front: (SkillChoice | null)[]; back: (SkillChoice | null)[] }; members: PartyMember[] };
  /** The opponent chosen in step 3 (party and opponent). */
  target(): { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } };
  /** Give a hero (save index) a rotation and passive in the party editor. */
  applyRotation(idx: number, rotation: string[], passive: string): void;
  /** Put heroes (save hero ids) in the slots. */
  applyParty(front: (number | null)[], back: (number | null)[]): void;
  /** Edited rotations by save hero id (heroes outside the party too), for the searches over all heroes. */
  poolSkills(): Record<number, SkillChoice>;
  /** Set the map run's scrolls in step 3. */
  applyScrolls(ids: number[]): void;
  /** Save hero ids of the locked slots (Best party / Optimise everything keep them). */
  locks(): number[];
  /** A search started (its progress is in the results): the page may bring the results into view. */
  onStart?(): void;
  /** A result's Show put its setup in the party: the page shows its Party and Flow tabs (U41). */
  onShow?(): void;
  /** Open the Simulator (the spoiler guard's "Try the Simulator first"). */
  goSimulate?(): void;
  /** U39: the spoiler guard is up (true) or gone (false): the page hides or shows the rest of the Solver. */
  guarded?(on: boolean): void;
  /** The opponent's party setup rules (battle-rules.ts): the solver's size fields clamp to maxSize. */
  rules?(): PartyRules;
  /** Why a layout (save hero ids, null = empty) can't fight the opponent, or null: Show is offered only without one. */
  problem?(front: (number | null)[], back: (number | null)[]): string | null;
}

/** The search panels (U36: only the solver). */
export type SearchKey = "party";

/** U27: the solver's spoiler guard, remembered in this browser (convenience only: storage may be blocked). */
const SOLVER_KEY = "battle-solver-shown";
/** This page view's choice (storage blocked: it holds until the page is left). */
let solverChoice: boolean | null = null;
function solverShown(): boolean {
  if (solverChoice !== null) return solverChoice;
  try {
    return localStorage.getItem(SOLVER_KEY) === "1";
  } catch {
    return false;
  }
}
function setSolverShown(on: boolean): void {
  solverChoice = on;
  try {
    if (on) localStorage.setItem(SOLVER_KEY, "1");
    else localStorage.removeItem(SOLVER_KEY);
  } catch { /* not remembered: the guard comes back on the next visit */ }
}

const GRADES = ["D", "C", "B", "A", "S"];

/** U42: the solve time budget's range, in seconds. */
const TIME_MIN = 5, TIME_MAX = 600;
/** U42: the Solve panel's options as last set, for this page view (the form is rebuilt when the opponent changes). */
const prefs: { min: number; max: number | null; scrolls: boolean; time: number } = { min: 1, max: null, scrolls: true, time: 30 };
const num = (attrs: Record<string, string>, value: number) => {
  const i = el("input", { type: "number", min: "1", ...attrs }) as HTMLInputElement;
  i.value = String(value);
  return i;
};
const field = (label: string, input: HTMLElement) => el("label", { class: "check" }, el("span", { class: "muted small" }, label), input);
const intOf = (i: HTMLInputElement, lo = 1, hi = 100000) => Math.max(lo, Math.min(hi, Math.trunc(Number(i.value) || lo)));

/** "m:ss" of a duration in ms. */
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

const isMapEval = (ev: FightEval | MapEval): ev is MapEval => "cleared" in ev;

/** The solver table's column tooltips (R1 F20: no notes under the table). */
const HEAD_TIPS: Record<string, string> = {
  "Party": "The heroes by row (🏹 back, 🛡️ front). Tap a row, or its Show, to put the setup in the Party and Flow tabs.",
  "Progress": "Rooms cleared per run.",
  "Win": "Only setups within 25 % of the best one found are listed (never a 0 % one). On a quest a setup that can lose also shows the "
    + "lowest point the enemy's HP reached, on average (0 % = killed).",
  "Scrolls": "The scrolls the run uses. Winners (90 % or more) come first; among the winners, and among the others, the runs with fewer scrolls come first (none first).",
};

/**
 * The search panels; show(key) puts the spoiler guard, or the warning line, in `mount` (the top of the page), the
 * options, the Solve button and a running solve's progress in `form` (in the Solve panel, under the opponent's
 * pickers; empty while the guard is up), and the results in `results` (hidden until a solve is done, U42); refresh()
 * rebuilds the panel after the party or the opponent changed, keeping the results (and a running search) where they are.
 */
export function initSearch(ctx: SearchContext, mount: HTMLElement, form: HTMLElement, results: HTMLElement): { show(key: SearchKey | null): void; refresh(): void; relabel(): void } {
  let worker: Worker | null = null;
  /** The shown result, to draw again in another language (U29); `again`: no side effect (the setup is already applied). */
  let last: { out: HTMLElement; draw: (again: boolean) => Node[] } | null = null;
  let current: SearchKey | null = null;
  let out: HTMLElement = el("div", { class: "search-out" });
  // U42: a solve's progress (and a Cancel, an error) is in the Solve panel, under the options: this line survives the
  // form's rebuilds (refresh) while a search runs. The results (`results`) stay hidden until a solve is done.
  const status = el("div", { class: "solve-status", "aria-live": "polite" });
  const showResults = (on: boolean) => {
    results.hidden = !on;
  };
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };
  const show = (key: SearchKey | null, keep = false) => {
    if (key !== current) stopWorker();
    if (key !== current || !keep) {
      out = el("div", { class: "search-out" });
      results.replaceChildren(...(key ? [out] : []));
      showResults(false);
      status.replaceChildren();
    }
    current = key;
    mount.hidden = key === null;
    const panel = key ? solverPanel(out) : null;
    mount.replaceChildren(...(panel ? [panel.head] : []));
    form.replaceChildren(...(panel?.form ? [panel.form, status] : []));
    // U39: until the spoiler guard is accepted, the page hides everything else of Solve (results, party, opponent, plan).
    ctx.guarded?.(key !== null && !solverShown());
  };

  /**
   * Run a search in a fresh worker. U42: its progress, a Cancel or an error go to the Solve panel's status line; the
   * results go to `out`, and the results section shows only once they are there (a new solve hides the last ones).
   * `budgetMs`: the bar shows the time used. `soft`: Cancel asks the search to stop (SearchRequest.stopUrl) and its
   * result, with what was found so far, is shown as usual; a worker that doesn't answer within 10 s is terminated.
   */
  function runSearch(req: SearchRequest, out: HTMLElement, render: (m: Extract<SearchResponse, { type: "done" }>, again: boolean, cancelled: boolean) => Node[],
    budgetMs?: number, soft = false): void {
    stopWorker();
    last = null;
    showResults(false);
    out.replaceChildren();
    // Review F13/F16: the game data, timelines and warm start come from the page (fetched once, on the first search).
    const w = dataWorker("battle-worker.js", ["gamedata.json", "timelines.json", "warmstart.json"]);
    worker = w;
    const stage = el("span", { class: "muted small" }, "Starting…");
    const prog = bar(0);
    const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
    let stopUrl = soft ? URL.createObjectURL(new Blob(["run"], { type: "text/plain" })) : "";
    let stopping = false;
    const release = () => {
      if (stopUrl) URL.revokeObjectURL(stopUrl);
      stopUrl = "";
    };
    if (stopUrl) req = { ...req, stopUrl };
    cancel.addEventListener("click", () => {
      if (stopUrl) {
        release();
        stopping = true;
        cancel.setAttribute("disabled", "");
        stage.textContent = "Stopping: keeping what was found so far…";
        setTimeout(() => {
          if (worker !== w) return;
          stopWorker();
          status.replaceChildren(el("p", { class: "muted small" }, "Cancelled."));
        }, 10000);
        return;
      }
      stopWorker();
      status.replaceChildren(el("p", { class: "muted small" }, "Cancelled."));
    });
    // With a time budget the bar shows the time used ("0:12 of 0:30"); otherwise the current stage's progress.
    const clock = el("span", { class: "muted small" });
    const t0 = Date.now();
    const timer = budgetMs ? setInterval(() => {
      if (worker !== w) return clearInterval(timer);
      const used = Date.now() - t0;
      clock.textContent = `${mmss(used)} of ${mmss(budgetMs)}`;
      (prog.firstElementChild as HTMLElement).style.width = `${Math.min(100, (100 * used) / budgetMs)}%`;
    }, 500) : 0;
    status.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, clock, cancel), prog));
    ctx.onStart?.();
    w.onmessage = (e: MessageEvent<SearchResponse>) => {
      const m = e.data;
      if (m.type === "progress") {
        if (stopping) return;
        stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
        if (!budgetMs) (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
        return;
      }
      if (timer) clearInterval(timer);
      release();
      stopWorker();
      if (m.type === "error") status.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
      else {
        // R2 F34: the search time is part of the result's one status line (render); `stopping`: Cancel was used.
        const cancelled = stopping;
        const draw = (again: boolean) => render(m, again, cancelled);
        status.replaceChildren();
        out.replaceChildren(...draw(false));
        showResults(true);
        last = { out, draw };
      }
    };
    w.onerror = (e) => {
      if (timer) clearInterval(timer);
      release();
      stopWorker();
      status.replaceChildren(el("p", { class: "error", role: "alert" }, `Search failed: ${e.message}`));
    };
    w.postMessage(req);
  }

  function base(): Pick<SearchRequest, "gameMode" | "front" | "back" | "skills"> {
    const p = ctx.party();
    return { gameMode: ctx.gameMode(), front: p.front, back: p.back, skills: p.skills };
  }

  // ---------------------------------------------------------------- Best party: the solver (U27)
  /** The spoiler guard (no form), or a warning line (head) and the solver's form (searchParties). */
  function solverPanel(out: HTMLElement): { head: HTMLElement; form: HTMLElement | null } {
    if (!solverShown()) {
      const yes = el("button", { type: "button", class: "secondary" }, "Show me the solver anyway");
      yes.addEventListener("click", () => {
        setSolverShown(true);
        show("party", true);
        form.querySelector<HTMLElement>(".search-panel button.primary")?.focus();
      });
      const sim = el("button", { type: "button", class: "primary" }, "▶ Try the Simulator first");
      sim.addEventListener("click", () => ctx.goSimulate?.());
      return { head: el("div", { class: "spoiler-guard", role: "note", "aria-label": "Spoiler warning" },
        el("p", { class: "spoiler-title" }, el("span", { "aria-hidden": "true" }, "🙈 "), el("strong", {}, "Spoiler ahead")),
        el("p", {}, "This tool runs simulations and finds the best fit to defeat any quest or map. Idle games are fun while we iterate, "
          + "try things and solve the puzzles ourselves: this feature can kill that fun by just giving you the answer."),
        el("p", {}, "Try the Simulator first to test your builds, try different things, and if you come back here, do it at your own risk."),
        el("div", { class: "toolbar" }, ...(ctx.goSimulate ? [sim] : []), yes)), form: null };
    }
    const hide = el("button", { type: "button", class: "link-btn" }, "Hide it again");
    hide.addEventListener("click", () => {
      setSolverShown(false);
      stopWorker();
      last = null;
      status.replaceChildren();
      show(null);
      show("party");
    });
    const warn = el("p", { class: "spoiler-warn small" }, el("strong", {}, "⚠ Spoiler tool: it gives you the answer. "), hide);

    const t = ctx.target();
    const sv = ctx.save();
    const isMap = Boolean(t.map);
    // The opponent's size cap (a party quest takes at most questSize heroes, a solo quest one).
    const cap = Math.max(1, Math.min(6, ctx.rules?.().maxSize ?? 6));
    // U42: the options as last set (a new opponent rebuilds the form), within this opponent's cap.
    const minN = num({ "aria-label": "Smallest party", max: String(cap) }, Math.min(prefs.min, cap)),
      maxN = num({ "aria-label": "Largest party", max: String(cap) }, Math.min(prefs.max ?? cap, cap));
    if (cap === 1) minN.disabled = maxN.disabled = true;
    // R2 F31: the two sizes on one row, "Party 1 – 5", the opponent's limit in its "?".
    const sizes = el("span", { class: "check solve-sizes", role: "group", "aria-label": "Party size" },
      el("span", { class: "muted small" }, "Party"), minN, el("span", { class: "muted", "aria-hidden": "true" }, "–"), maxN,
      helpTip(sizeHelp(cap), "the party size"));
    const sc = el("input", { type: "checkbox" }) as HTMLInputElement;
    sc.checked = isMap && prefs.scrolls;
    const scLabel = el("label", { class: "check" }, sc, " Include scrolls");
    // R2 F31: scrolls only on a map run (a quest, or Scribe hidden: no row at all).
    const scrollOpt = isMap ? [scLabel] : [];
    // U42: the time budget, in seconds (30 by default): the search stops then and shows what it found.
    const budget = el("input", { type: "number", class: "solve-time", min: String(TIME_MIN), max: String(TIME_MAX), step: "5",
      "aria-label": "Time budget in seconds", title: `How long the search may run, ${TIME_MIN} to ${TIME_MAX} seconds: it then stops and shows the setups found so far.` }) as HTMLInputElement;
    budget.value = String(prefs.time);
    minN.addEventListener("change", () => (prefs.min = intOf(minN, 1, cap)));
    maxN.addEventListener("change", () => (prefs.max = intOf(maxN, 1, cap)));
    sc.addEventListener("change", () => (prefs.scrolls = sc.checked));
    budget.addEventListener("change", () => (prefs.time = intOf(budget, TIME_MIN, TIME_MAX)));
    const excl = excludePicker(sv);
    const go = el("button", { type: "button", class: "primary" }, "🔎 Solve");
    const intro = "Finds the smallest parties that win, from all your heroes: who, in which row and order, every hero's rotation and passive"
      + `${isMap ? ", and the map's scrolls" : ""}. Parties grow one hero at a time, and the best ones of each size are tuned. `
      + "After a Show, the heroes you lock (🔒) stay in. Up to 5 setups within 25 % of the best one found, winners (90 % or more) first, "
      + `${isMap ? "then the fewest scrolls (none first), " : ""}the fewest heroes first.`;
    go.addEventListener("click", () => {
      let lo = intOf(minN, 1, cap), hi = intOf(maxN, 1, cap);
      minN.value = String(lo);
      maxN.value = String(hi);
      if (lo > hi) [lo, hi] = [hi, lo];
      const locks = ctx.locks();
      if (locks.length > hi) {
        status.replaceChildren(el("p", { class: "error", role: "alert" }, `${locks.length} heroes are locked: raise the largest party size to ${locks.length} or unlock some.`));
        return;
      }
      const scrolls = isMap && sc.checked;
      prefs.time = intOf(budget, TIME_MIN, TIME_MAX);
      budget.value = String(prefs.time);
      const budgetMs = prefs.time * 1000;
      // U42: without "Include scrolls" a map run uses none (the scroll pickers are on the card, out of sight until a Show).
      const target = ctx.target();
      if (target.map && !scrolls) target.map = { ...target.map, scrolls: [] };
      // Show state of this result (kept when it is drawn again in another language).
      const st: { loaded: number; undo: HTMLElement | null } = { loaded: -1, undo: null };
      runSearch({ ...base(), search: "parties", pool: excl.pool(locks), lock: locks, poolSkills: ctx.poolSkills(), ...target,
        minSize: lo, maxSize: hi, scrolls, timeBudgetMs: budgetMs }, out,
      (r, _again, cancelled) => (r.search === "parties" ? partiesResult(r.result, sv, isMap, scrolls, st, { ms: r.ms, cancelled, budgetMs }) : []),
      budgetMs, true);
    });
    // R1 F20: how the solver works is in a "?" on the warning line, not a paragraph.
    warn.append(" ", helpTip(intro, "the solver"));
    return { head: warn, form: el("div", { class: "search-panel solver" },
      el("div", { class: "toolbar search-form" }, sizes, ...scrollOpt, field("Time budget (s)", budget), go), excl.node) };
  }

  /**
   * The solver's table: one row per setup; Show fills step 3 (party, rotations, passives, scrolls) and brings its Party
   * and Flow tabs (U41), with an undo when a party was already shown.
   */
  function partiesResult(res: PartiesResult, sv: Save, isMap: boolean, withScrolls: boolean, st: { loaded: number; undo: HTMLElement | null },
    run: { ms: number; cancelled: boolean; budgetMs: number }): Node[] {
    const hero = (id: number) => sv.raw.hero.find((h: Any) => h.id === id);
    const idx = (id: number) => sv.raw.hero.findIndex((h: Any) => h.id === id);
    const box = el("div", { class: "solver-out" });
    // U36: only the setups worth trying (no 0 %, within 25 % of the best, at most 5); E25: the fewest scrolls first in each tier.
    const shown = solveShortlist(res.results);
    const chip = (id: number) => {
      const h = hero(id);
      return el("span", { class: `pill hero-chip cls-${h?.class ?? 0}`, title: h ? `${h.name} · level ${h.level}` : `#${id}` }, h?.name ?? `#${id}`);
    };
    // R2 F35: the row icon (with its tooltip) stays on the line of its first chip; "rough" has a "?" saying what it means.
    const partyCell = (c: PartyConfig) => el("div", { class: "solver-party" },
      ...(["back", "front"] as const).filter((row) => c.layout[row].some((id) => id !== null)).map((row) => {
        const [first, ...rest] = c.layout[row].filter((id): id is number => id !== null).map(chip);
        const what = row === "front" ? "Front row" : "Back row";
        return el("div", { class: "solver-row" }, el("span", { class: "solver-lead" },
          el("span", { class: "row-ico", title: what, role: "img", "aria-label": what }, row === "front" ? "🛡️" : "🏹"), first), ...rest);
      }),
      ...(c.tuned ? [] : [el("span", { class: "rough-wrap" }, el("span", { class: "pill t-orange rough" }, "rough"), helpTip(ROUGH_HELP, "rough setups"))]));
    // E25: scroll use at a glance: "No scrolls" (a pill) or the count, then the scrolls.
    const scrollCell = (c: PartyConfig) => {
      const n = scrollCount(c);
      return n
        ? el("span", { class: "solver-scrolls" }, el("strong", {}, `${n} scroll${n === 1 ? "" : "s"}: `),
          ...c.scrolls!.flatMap((id, k) => [...(k ? [", "] : []), itemLink("consumable", id)]))
        : el("span", { class: "pill t-green no-scrolls", title: "This run needs no scrolls." }, "No scrolls");
    };
    const showSetup = (c: PartyConfig, k: number) => {
      // The first Show has nothing to put back (no party yet).
      st.undo = ctx.party().members.length ? snapshot() : null;
      ctx.applyParty(c.layout.front, c.layout.back);
      for (const [id, s] of Object.entries(c.skills)) {
        const i = idx(Number(id));
        if (i >= 0) ctx.applyRotation(i, s.rotation, s.passive);
      }
      if (withScrolls) ctx.applyScrolls(c.scrolls ?? []);
      st.loaded = k;
      st.undo?.addEventListener("click", () => {
        st.loaded = -1;
        paint();
      });
      paint();
      ctx.onShow?.();
    };
    const paint = () => {
      const rows = shown.map((c, k) => {
        const ev = c.ev;
        const b = el("button", { type: "button", class: st.loaded === k ? "secondary loaded" : "secondary" }, st.loaded === k ? "✓ Shown" : "Show");
        b.setAttribute("aria-label", `Show setup ${k + 1} in the Party and Flow tabs`);
        // A setup the opponent's party rules refuse (required slot, size) is not shown.
        const problem = ctx.problem?.(c.layout.front, c.layout.back) ?? null;
        if (problem) {
          b.setAttribute("disabled", "");
          b.title = `Can't show: ${problem}`;
        } else b.addEventListener("click", () => showSetup(c, k));
        // R2 F32: a quest's lowest enemy HP is no column: a subline under the win rate when the setup can lose, and
        // always in the cell's tooltip.
        const low = isMapEval(ev) ? null : Math.max(0, 1 - (ev.enemy_dmg_peak ?? ev.enemy_dmg));
        const win = el("span", { class: "solver-win", ...(low !== null ? { title: `Lowest enemy HP: ${pct(low)} on average (0 % = killed)` } : {}) },
          el("strong", { class: `rate ${rateTone(ev.win)}`, style: "color: var(--c)" }, pct(ev.win)),
          ...(low !== null && ev.win < 1 ? [el("span", { class: "solver-sub" }, `enemy HP ${pct(low)}`)] : []));
        const third = isMapEval(ev)
          ? el("span", { title: `average grade ${fmt1.format(ev.grade)} (D = 1 … S = 5)` }, GRADES[Math.min(4, Math.max(0, Math.round(ev.grade) - 1))])
          : el("span", {}, fmt1.format(ev.turns));
        const tr = el("tr", { class: `${st.loaded === k ? "loaded" : ""}${problem ? "" : " row-link"}`.trim() },
          el("td", { class: "solver-show" }, b), el("td", {}, partyCell(c)),
          ...(isMap ? [el("td", {}, scrollCell(c))] : []), el("td", { class: "num" }, win), el("td", { class: "num" }, third),
          ...(isMapEval(ev) ? [el("td", { class: "num" }, pct(ev.cleared))] : []));
        // R2 F32: a tap on the row is Show too (not on its links or buttons).
        if (!problem) tr.addEventListener("click", (e) => {
          if (!(e.target as Element).closest("a, button, summary")) b.click();
        });
        return tr;
      });
      // R2 F32: Show first (on a phone it is on screen), no hero count (the chips count them), no lowest-enemy-HP column.
      const head = ["", "Party", ...(isMap ? ["Scrolls"] : []), "Win", isMap ? "Grade" : "Turns", ...(isMap ? ["Progress"] : [])];
      const nums = new Set(["Win", "Grade", "Turns", "Progress"]);
      box.replaceChildren(
        // R2 F34: the setup shown is the highlighted row ("✓ Shown"); this line only holds the undo, once there is one.
        ...(st.undo ? [el("p", { class: "result-note solver-loaded" }, st.undo)] : []),
        el("div", { class: "table-wrap" }, el("table", { class: "solver-table" },
          el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { scope: "col", ...(nums.has(h) ? { class: "num" } : {}), ...(HEAD_TIPS[h] ? { title: HEAD_TIPS[h] } : {}) },
            h || el("span", { class: "visually-hidden" }, "Show"))))),
          el("tbody", {}, ...rows))));
    };
    if (!res.results.length) {
      return [el("p", { class: "muted" }, res.stopped ? "Stopped before any party was evaluated: try again with more time." : "No party found with these heroes and sizes.")];
    }
    if (!shown.length) {
      return [el("p", { class: "muted" }, `No setup won a single fight${res.stopped ? " before the search stopped" : ""}: try bigger parties, other heroes, `
        + "a smaller quest size or more time.")];
    }
    paint();
    // R2 F34: one status line ("3 setups ≥ 90 % · 5.0 s"); the rest (how the search ended, what was evaluated) in its
    // "?". A search that used its whole time budget ended normally: only Cancel reads as stopped.
    const s = solveStatus({ wins: shown.filter((c) => c.ev.win >= 0.9).length, listed: shown.length, found: res.results.length, tried: res.tried,
      ms: run.ms, budgetMs: run.budgetMs, stopped: res.stopped, cancelled: run.cancelled, map: isMap });
    return [el("p", { class: "small solve-summary", role: "status" }, s.line, " ", helpTip(s.help, "these results")), box];
  }

  /** "Leave heroes out" chips: ticked heroes are not candidates, unless kept (`keep`: locked or starting heroes). */
  function excludePicker(sv: Save): { node: HTMLElement; pool(keep?: number[]): Any[] } {
    const out = sv.raw.hero.map((h: Any) => {
      const c = el("input", { type: "checkbox", value: String(h.id) }) as HTMLInputElement;
      c.checked = !isVisible("class", Number(h.class)); // a class the visitor hides (the Bard without the Frozen Tome)
      return { h, c, node: el("label", { class: "chip-check out" }, c, ` ${h.name}`) };
    });
    const node = el("details", { class: "exclude" }, el("summary", { class: "small" }, "Leave heroes out"),
      el("div", { class: "chip-checks" }, ...out.map((b: Any) => b.node)));
    return {
      node,
      pool: (keep = []) => {
        const must = new Set(keep);
        return out.filter((b: Any) => !b.c.checked || must.has(Number(b.h.id))).map((b: Any) => b.h);
      },
    };
  }

  /** A "Put back the previous party" button for the slots and rotations as they are now (before a search fills them). */
  function snapshot(): HTMLElement {
    const p = ctx.party();
    const front = p.front.map((h) => h?.id ?? null), back = p.back.map((h) => h?.id ?? null);
    const rot = p.members.map((m) => {
      const own = api.newHero(m.raw);
      const sk = p.skills[m.row][m.i];
      return { idx: m.idx, rotation: sk?.attackList ?? own.attackList.slice(1, 6), passive: sk?.passive ?? own.passiveSelect };
    });
    // A map run's scrolls too (Best party and Optimise everything may set them).
    const scrolls = ctx.target().map?.scrolls.map((x) => x.id);
    const b = el("button", { type: "button", class: "secondary" }, "↩ Put back the previous party");
    b.addEventListener("click", () => {
      ctx.applyParty(front, back);
      for (const r of rot) ctx.applyRotation(r.idx, r.rotation, r.passive);
      if (scrolls) ctx.applyScrolls(scrolls);
      b.textContent = "✓ Previous party back";
      b.setAttribute("disabled", "");
    });
    return b;
  }

  return {
    show,
    refresh() {
      if (current) show(current, true);
    },
    relabel() {
      if (last?.out.isConnected && !worker) last.out.replaceChildren(...last.draw(true));
    },
  };
}

