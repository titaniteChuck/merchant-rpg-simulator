/**
 * The battle page's Solve mode (U36; Best party until then): searchParties of parties.ts in the battle worker, with
 * progress and a soft Cancel (the search stops at its next check and keeps what it found). The page passes a
 * SearchContext so this module doesn't import it. Best gear, Best potion / enchant and Optimise everything left the
 * page in U36; their engine code (combat.ts, consumables.ts, optimise.ts) and the worker's handlers stay.
 *
 * U27: the solver is a spoiler (it gives the answer to a quest or map), so its panel starts hidden behind a
 * disclaimer; "Show me the solver anyway" is remembered in this browser (localStorage `battle-solver-shown`) and a
 * warning line with "Hide it again" stays.
 *
 * U36: the results table shows only the setups worth trying (battle-setup.ts solveShortlist): no 0 % result, within
 * 25 % of the best one found, at most 5.
 *
 * Expansions (U28): heroes of a hidden class start ticked in "Leave heroes out".
 */
import * as api from "../sim/api.ts";
import type { FightEval, MapEval } from "../tools/combat.ts";
import type { PartiesResult, PartyConfig } from "../tools/parties.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import type { Save } from "../tools/save.ts";
import type { SearchRequest, SearchResponse, SkillChoice } from "./battle-worker.ts";
import type { PartyRules } from "./battle-rules.ts";
import { solveShortlist } from "./battle-setup.ts";
import { bar, el, fmt, fmt1, pct, rateTone, select } from "./dom.ts";
import { itemLink } from "./wiki-data.ts";
import { isVisible } from "./expansion-state.ts";

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
  /** Switch to the Simulate mode (the spoiler guard's "Try Simulate first"). */
  goSimulate?(): void;
  /** The opponent's party setup rules (battle-rules.ts): the solver's size fields clamp to maxSize. */
  rules?(): PartyRules;
  /** Why a layout (save hero ids, null = empty) can't fight the opponent, or null: Load is offered only without one. */
  problem?(front: (number | null)[], back: (number | null)[]): string | null;
}

/** The search modes of the page (U36: only the solver). */
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
const num = (attrs: Record<string, string>, value: number) => {
  const i = el("input", { type: "number", min: "1", ...attrs }) as HTMLInputElement;
  i.value = String(value);
  return i;
};
const field = (label: string, input: HTMLElement) => el("label", { class: "check" }, el("span", { class: "muted small" }, label), input);
const intOf = (i: HTMLInputElement, lo = 1, hi = 100000) => Math.max(lo, Math.min(hi, Math.trunc(Number(i.value) || lo)));

const isMapEval = (ev: FightEval | MapEval): ev is MapEval => "cleared" in ev;

/**
 * The search panels; show(key) puts one in `mount` (step 1, under the mode cards) and its progress and results in
 * `results` (the page's Results, step 2, right under step 1); refresh() rebuilds the panel after the party or the opponent
 * changed, keeping the results (and a running search) where they are.
 */
export function initSearch(ctx: SearchContext, mount: HTMLElement, results: HTMLElement): { show(key: SearchKey | null): void; refresh(): void; relabel(): void } {
  let worker: Worker | null = null;
  /** The shown result, to draw again in another language (U29); `again`: no side effect (the setup is already applied). */
  let last: { out: HTMLElement; draw: (again: boolean) => Node[] } | null = null;
  let current: SearchKey | null = null;
  let out: HTMLElement = el("div", { class: "search-out" });
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };
  const show = (key: SearchKey | null, keep = false) => {
    if (key !== current) stopWorker();
    if (key !== current || !keep) {
      out = el("div", { class: "search-out" });
      results.replaceChildren(...(key ? [out] : []));
    }
    current = key;
    mount.hidden = key === null;
    mount.replaceChildren(...(key ? [solverPanel(out)] : []));
  };

  /**
   * Run a search in a fresh worker; progress and results go to `out`. `budgetMs`: the bar shows the time used.
   * `soft`: Cancel asks the search to stop (SearchRequest.stopUrl) and its result, with what was found so far, is
   * shown as usual; a worker that doesn't answer within 10 s is terminated.
   */
  function runSearch(req: SearchRequest, out: HTMLElement, render: (m: Extract<SearchResponse, { type: "done" }>, again: boolean) => Node[],
    budgetMs?: number, soft = false): void {
    stopWorker();
    last = null;
    const w = new Worker(new URL("js/battle-worker.js", document.baseURI), { type: "module" });
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
          out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
        }, 10000);
        return;
      }
      stopWorker();
      out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
    });
    // With a time budget (optimise everything) the bar shows the time used; otherwise the current stage's progress.
    const clock = el("span", { class: "muted small" });
    const t0 = Date.now();
    const timer = budgetMs ? setInterval(() => {
      if (worker !== w) return clearInterval(timer);
      const used = Date.now() - t0;
      clock.textContent = `${Math.floor(used / 60000)}:${String(Math.floor(used / 1000) % 60).padStart(2, "0")} of ${budgetMs / 60000} min`;
      (prog.firstElementChild as HTMLElement).style.width = `${Math.min(100, (100 * used) / budgetMs)}%`;
    }, 500) : 0;
    out.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, clock, cancel), prog));
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
      if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
      else {
        const draw = (again: boolean) => [...render(m, again), el("p", { class: "muted small" }, `Searched in ${fmt1.format(m.ms / 1000)} s with fixed seeds: every candidate is tested on the same rolls.`)];
        out.replaceChildren(...draw(false));
        last = { out, draw };
      }
    };
    w.onerror = (e) => {
      if (timer) clearInterval(timer);
      release();
      stopWorker();
      out.replaceChildren(el("p", { class: "error", role: "alert" }, `Search failed: ${e.message}`));
    };
    w.postMessage(req);
  }

  function base(): Pick<SearchRequest, "gameMode" | "front" | "back" | "skills"> {
    const p = ctx.party();
    return { gameMode: ctx.gameMode(), front: p.front, back: p.back, skills: p.skills };
  }

  // ---------------------------------------------------------------- Best party: the solver (U27)
  /** The spoiler guard, or the solver's form (searchParties) under a warning line. */
  function solverPanel(out: HTMLElement): HTMLElement {
    if (!solverShown()) {
      const yes = el("button", { type: "button", class: "secondary" }, "Show me the solver anyway");
      yes.addEventListener("click", () => {
        setSolverShown(true);
        show("party", true);
        mount.querySelector<HTMLElement>(".search-panel button.primary")?.focus();
      });
      const sim = el("button", { type: "button", class: "primary" }, "▶ Try Simulate first");
      sim.addEventListener("click", () => ctx.goSimulate?.());
      return el("div", { class: "spoiler-guard", role: "note", "aria-label": "Spoiler warning" },
        el("p", { class: "spoiler-title" }, el("span", { "aria-hidden": "true" }, "🙈 "), el("strong", {}, "Spoiler ahead")),
        el("p", {}, "This tool runs simulations and finds the best fit to defeat any quest or map. Idle games are fun while we iterate, "
          + "try things and solve the puzzles ourselves: this feature can kill that fun by just giving you the answer."),
        el("p", {}, "Try the Simulate tool first to test your builds, try different things, and if you come back here, do it at your own risk."),
        el("div", { class: "toolbar" }, ...(ctx.goSimulate ? [sim] : []), yes));
    }
    const hide = el("button", { type: "button", class: "link-btn" }, "Hide it again");
    hide.addEventListener("click", () => {
      setSolverShown(false);
      stopWorker();
      last = null;
      show(null);
      show("party");
    });
    const warn = el("p", { class: "spoiler-warn small" }, el("strong", {}, "⚠ Spoiler tool: it gives you the answer. "), hide);

    const t = ctx.target();
    const sv = ctx.save();
    const isMap = Boolean(t.map);
    // The opponent's size cap (a party quest takes at most questSize heroes, a solo quest one).
    const cap = Math.max(1, Math.min(6, ctx.rules?.().maxSize ?? 6));
    const minN = num({ "aria-label": "Smallest party", max: String(cap) }, 1), maxN = num({ "aria-label": "Largest party", max: String(cap) }, cap);
    if (cap === 1) minN.disabled = maxN.disabled = true;
    const capNote = cap < 6 ? [el("span", { class: "muted small" }, cap === 1 ? "solo quest: one hero" : `this quest takes at most ${cap} heroes`)] : [];
    const sc = el("input", { type: "checkbox" }) as HTMLInputElement;
    sc.checked = isMap;
    sc.disabled = !isMap;
    const scLabel = el("label", { class: `check${isMap ? "" : " off"}` }, sc, " Include scrolls",
      ...(isMap ? [] : [el("span", { class: "muted small" }, " (map runs only)")]));
    const budget = select({ "aria-label": "Time budget" }, [["60", "60 s"], ["120", "120 s"]]);
    const excl = excludePicker(sv);
    const go = el("button", { type: "button", class: "primary" }, "🔎 Search");
    const intro = "Finds the smallest parties that win, from all your heroes: who, in which row and order, every hero's rotation and passive"
      + `${isMap ? ", and the map's scrolls" : ""}. Parties grow one hero at a time, and the best ones of each size are tuned. `
      + "Locked slots (🔒) keep their hero. Up to 5 setups within 25 % of the best one found, winners (90 % or more) first, the fewest heroes first.";
    go.addEventListener("click", () => {
      let lo = intOf(minN, 1, cap), hi = intOf(maxN, 1, cap);
      minN.value = String(lo);
      maxN.value = String(hi);
      if (lo > hi) [lo, hi] = [hi, lo];
      const locks = ctx.locks();
      if (locks.length > hi) {
        out.replaceChildren(el("p", { class: "error", role: "alert" }, `${locks.length} heroes are locked: raise the largest party size to ${locks.length} or unlock some.`));
        return;
      }
      const scrolls = isMap && sc.checked;
      const budgetMs = Number(budget.value) * 1000;
      // Load state of this result (kept when it is drawn again in another language).
      const st: { loaded: number; undo: HTMLElement | null } = { loaded: -1, undo: null };
      runSearch({ ...base(), search: "parties", pool: excl.pool(locks), lock: locks, poolSkills: ctx.poolSkills(), ...ctx.target(),
        minSize: lo, maxSize: hi, scrolls, timeBudgetMs: budgetMs }, out,
      (r) => (r.search === "parties" ? partiesResult(r.result, sv, isMap, scrolls, st) : []), budgetMs, true);
    });
    return el("div", { class: "search-panel solver" }, warn, el("p", { class: "muted small" }, intro),
      el("div", { class: "toolbar search-form" }, field("smallest party", minN), field("largest party", maxN), ...capNote, scLabel, field("time", budget), excl.node, go));
  }

  /** The solver's table: one row per setup, Load fills step 3 (party, rotations, passives, scrolls) with an undo. */
  function partiesResult(res: PartiesResult, sv: Save, isMap: boolean, withScrolls: boolean, st: { loaded: number; undo: HTMLElement | null }): Node[] {
    const hero = (id: number) => sv.raw.hero.find((h: Any) => h.id === id);
    const idx = (id: number) => sv.raw.hero.findIndex((h: Any) => h.id === id);
    const box = el("div", { class: "solver-out" });
    // U36: only the setups worth trying (no 0 %, within 25 % of the best, at most 5).
    const shown = solveShortlist(res.results);
    const chip = (id: number) => {
      const h = hero(id);
      return el("span", { class: `pill hero-chip cls-${h?.class ?? 0}`, title: h ? `${h.name} · level ${h.level}` : `#${id}` }, h?.name ?? `#${id}`);
    };
    const partyCell = (c: PartyConfig) => el("div", { class: "solver-party" },
      ...(["back", "front"] as const).filter((row) => c.layout[row].some((id) => id !== null)).map((row) =>
        el("div", { class: "solver-row" }, el("span", { class: "row-ico", title: row === "front" ? "Front row" : "Back row", role: "img", "aria-label": row === "front" ? "Front row" : "Back row" },
          row === "front" ? "🛡️" : "🏹"), ...c.layout[row].filter((id): id is number => id !== null).map(chip))),
      ...(c.tuned ? [] : [el("span", { class: "pill t-orange rough", title: "Only screened: default rows and the heroes' own rotations, not tuned (its party size was far from winning)." }, "rough")]));
    const scrollCell = (c: PartyConfig) => (c.scrolls?.length
      ? el("span", { class: "solver-scrolls" }, ...c.scrolls.flatMap((id, k) => [...(k ? [", "] : []), itemLink("consumable", id)]))
      : el("span", { class: "muted" }, "—"));
    const load = (c: PartyConfig, k: number) => {
      st.undo = snapshot();
      ctx.applyParty(c.layout.front, c.layout.back);
      for (const [id, s] of Object.entries(c.skills)) {
        const i = idx(Number(id));
        if (i >= 0) ctx.applyRotation(i, s.rotation, s.passive);
      }
      if (withScrolls) ctx.applyScrolls(c.scrolls ?? []);
      st.loaded = k;
      st.undo.addEventListener("click", () => {
        st.loaded = -1;
        paint();
      });
      paint();
    };
    const paint = () => {
      const rows = shown.map((c, k) => {
        const ev = c.ev;
        const b = el("button", { type: "button", class: st.loaded === k ? "secondary loaded" : "secondary" }, st.loaded === k ? "✓ Loaded" : "Load");
        b.setAttribute("aria-label", `Load setup ${k + 1} into the party slots`);
        // A setup the opponent's party rules refuse (required slot, size) is not loaded.
        const problem = ctx.problem?.(c.layout.front, c.layout.back) ?? null;
        if (problem) {
          b.setAttribute("disabled", "");
          b.title = `Can't load: ${problem}`;
        } else b.addEventListener("click", () => load(c, k));
        const win = el("strong", { class: `rate ${rateTone(ev.win)}`, style: "color: var(--c)" }, pct(ev.win));
        const third = isMapEval(ev)
          ? el("span", { title: `average grade ${fmt1.format(ev.grade)} (D = 1 … S = 5)` }, GRADES[Math.min(4, Math.max(0, Math.round(ev.grade) - 1))])
          : el("span", {}, fmt1.format(ev.turns));
        const fourth = isMapEval(ev) ? pct(ev.cleared) : pct(Math.max(0, 1 - (ev.enemy_dmg_peak ?? ev.enemy_dmg)));
        return el("tr", { class: st.loaded === k ? "loaded" : "" },
          el("td", { class: "num" }, String(k + 1)), el("td", { class: "num" }, String(c.size)), el("td", {}, partyCell(c)),
          ...(isMap ? [el("td", {}, scrollCell(c))] : []), el("td", { class: "num" }, win), el("td", { class: "num" }, third),
          el("td", { class: "num" }, fourth), el("td", {}, b));
      });
      const head = ["#", "Heroes", "Party", ...(isMap ? ["Scrolls"] : []), "Win", isMap ? "Grade" : "Turns", isMap ? "Progress" : "Lowest enemy HP", ""];
      const nums = new Set(["#", "Heroes", "Win", "Grade", "Turns", "Progress", "Lowest enemy HP"]);
      box.replaceChildren(
        // After Load: what is in the slots, and the undo (once used, it stays as "✓ Previous party back").
        ...(st.undo ? [el("p", { class: "result-note solver-loaded" }, ...(st.loaded >= 0 ? [`✓ Setup #${st.loaded + 1} is in the party slots below. `] : []), st.undo)] : []),
        el("div", { class: "table-wrap" }, el("table", { class: "solver-table" },
          el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { scope: "col", ...(nums.has(h) ? { class: "num" } : {}) }, h)))),
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
    const wins = shown.filter((c) => c.ev.win >= 0.9).length;
    return [
      ...(res.stopped ? [el("p", { class: "muted small" }, "⏱️ Stopped early (time budget or Cancel): these are the setups found so far.")] : []),
      el("p", { class: "small" }, wins ? `${wins} setup${wins === 1 ? "" : "s"} win${wins === 1 ? "s" : ""} 90 % of the fights or more.`
        : "No setup wins 90 % of the time yet: the closest ones are listed."),
      box,
      el("p", { class: "muted small" }, `${fmt.format(res.tried)} evaluations; ${shown.length < res.results.length ? `${res.results.length - shown.length} weaker setup${res.results.length - shown.length === 1 ? "" : "s"} (more than 25 % behind the best, or 0 %) not shown. ` : ""}${isMap ? "Progress: rooms cleared per run." : "Lowest enemy HP: the lowest point the enemy's HP reached, on average (0 % = killed)."} `
        + "Rough: only screened (default rows, the heroes' own rotations); the sizes far from winning are not tuned."),
    ];
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

