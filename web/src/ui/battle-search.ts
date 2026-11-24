/**
 * Search panels of the battle page (one per mode of step 1): best party (the solver), best gear, best potion /
 * enchant and optimise everything. Each runs one search of web/src/tools (searchParties of parties.ts, searchGear of
 * combat.ts, rankConsumables, optimiseFight) in the battle worker, with progress and Cancel (the search is synchronous
 * inside the worker, so Cancel terminates it; Best party stops it softly and keeps what was found). The page passes a
 * SearchContext so this module doesn't import it.
 *
 * U27: Best party merges the former Best party, Best rotation and Best scrolls modes. It is a spoiler (it gives the
 * answer to a quest or map), so its panel starts hidden behind a disclaimer; "Show me the solver anyway" is
 * remembered in this browser (localStorage `battle-solver-shown`) and a warning line with "Hide it again" stays.
 *
 * Expansions (U28): candidates from expansions the visitor hides are left out: catalog gear (the worker filters it with
 * `expansions`), ascension options (Scribe), scrolls, and heroes of a hidden class start ticked in "Leave heroes out".
 * Potion and enchant results of hidden consumables are dropped from the ranking.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import type { ConsumableRank, ConsumableRanking } from "../tools/consumables.ts";
import type { FightEval, MapEval } from "../tools/combat.ts";
import type { OptimiseResult } from "../tools/optimise.ts";
import type { PartiesResult, PartyConfig } from "../tools/parties.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import type { Save } from "../tools/save.ts";
import type { SearchRequest, SearchResponse, SkillChoice } from "./battle-worker.ts";
import type { PartyRules } from "./battle-rules.ts";
import { bar, bySlot, el, fmt, fmt1, GEAR_SLOT_ICONS, GEAR_SLOT_NAMES, gearGrid, type GearSlot, pct, pill, rateTone, select, table } from "./dom.ts";
import { locationOf, notesFor, scheduleFor } from "./timeline.ts";
import { itemLink, passiveLink, skillLink, statText } from "./wiki-data.ts";
import { isVisible, ownedExpansions, showAll } from "./expansion-state.ts";
import { itemIdByName, itemName, itemNameFromEnglish } from "./names.ts";

/** Ascension options (0, 1, 2) the visitor can use: 1 and 2 need Scribe (item ascension). */
const ascOptions = (max: number): [string, string][] => [["0", "No ascension"], ["1", "Ascension 1"], ["2", "Ascension 2"]]
  .filter(([v]) => Number(v) <= max && isVisible("itemAscension", Number(v))) as [string, string][];
/** What the worker may offer: "all", or the owned expansions (catalog candidates of the others are dropped). */
const allowedExpansions = () => (showAll() ? "all" as const : [...ownedExpansions()]);

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

export type SearchKey = "gear" | "party" | "optimise" | "consumables";

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

/** "win 92% · 14.1 turns · enemy HP removed 100% (lowest 100%)" for a fight evaluation. */
function fightLine(ev: FightEval): HTMLElement {
  const peak = ev.enemy_dmg_peak !== undefined && ev.enemy_dmg_peak > ev.enemy_dmg + 5e-4 ? ` (lowest ${pct(ev.enemy_dmg_peak)})` : "";
  return el("span", { class: "ev-line" }, el("strong", { class: rateTone(ev.win) }, `win ${pct(ev.win)}`),
    ` · ${fmt1.format(ev.turns)} turns · enemy HP removed ${pct(ev.enemy_dmg)}${peak} · party HP left ${pct(ev.hp_left)}`);
}
function mapLine(ev: MapEval): HTMLElement {
  const ess = Object.values(ev.essence).reduce((a, b) => a + b, 0);
  return el("span", { class: "ev-line" }, el("strong", { class: rateTone(ev.win) }, `win ${pct(ev.win)}`),
    ` · progress ${pct(ev.cleared)} · grade ${fmt1.format(ev.grade)} · ${fmt1.format(ess)} essence · ${fmt.format(ev.loot_value)} g loot per run`);
}
const isMapEval = (ev: FightEval | MapEval): ev is MapEval => "cleared" in ev;

/** An equipment item by name (search results name items): its wiki link in its rarity colour, or plain text. */
function equipLink(name: string): HTMLElement {
  const id = itemIdByName("equipment", name);
  return id === undefined ? el("span", { class: "item" }, name) : itemLink("equipment", id);
}
/** One gear cell of a search result (gearGrid): slot icon, item, and "change · from …" or "keep". */
function gearCell(item: string | undefined, from: string | null, slot: GearSlot): HTMLElement {
  const it = item ? Object.values<Any>(G.itemData?.equipment ?? {}).find((x) => x?.name === item) : undefined;
  return el("div", { class: `gear-item rar-${typeof it?.rarity === "number" ? it.rarity : 1}${from ? " changed" : ""}`, title: GEAR_SLOT_NAMES[slot] },
    el("span", { class: "slot-ico", role: "img", "aria-label": GEAR_SLOT_NAMES[slot] }, GEAR_SLOT_ICONS[slot]),
    item ? equipLink(item) : el("span", { class: "muted" }, "nothing"),
    el("span", { class: "meta" }, from ? pill("change", "t-green") : el("span", { class: "muted small" }, "keep")));
}
const evLine = (ev: FightEval | MapEval) => (isMapEval(ev) ? mapLine(ev) : fightLine(ev));

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
    mount.replaceChildren(...(key ? [panel(key, out)] : []));
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

  function heroPicker(): HTMLSelectElement | null {
    const members = ctx.party().members;
    if (!members.length) return null;
    return select({ "aria-label": "Hero" }, members.map((m): [string, string] =>
      [`${m.row}:${m.i}`, `${m.raw.name} (${m.row === "front" ? "front" : "back"} ${m.i + 1})`]));
  }

  // ---------------------------------------------------------------- panels
  function panel(key: SearchKey, out: HTMLElement): HTMLElement {
    const t = ctx.target();
    if (key === "gear" && !t.quest) return el("p", { class: "muted" }, "This search optimises quest fights: choose ⚔️ Quest enemy in the opponent card (step 3).");
    if (key === "party") return solverPanel(out);
    if (key !== "optimise" && !ctx.party().members.length) return el("p", { class: "muted" }, "Put at least one hero in the party (step 3).");
    const go = el("button", { type: "button", class: "primary" }, "🔎 Search");
    let form: HTMLElement[] = [];
    let start: () => void = () => {};
    let intro = "";

    if (key === "gear") {
      intro = "Slot by slot, tries every candidate item and keeps it when the party does better (repeated for a few passes).";
      const hero = heroPicker()!;
      const pool = select({ "aria-label": "Candidate items" }, [["owned", "Items you own (inventory, counter, other heroes)"], ["catalog", "Craftable catalog items"]]);
      const grade = select({ "aria-label": "Catalog grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
      grade.value = "5";
      const asc = select({ "aria-label": "Catalog ascension" }, ascOptions(2));
      const n = num({ "aria-label": "Fights per candidate" }, 60), passes = num({ "aria-label": "Passes", max: "5" }, 2);
      const sync = () => {
        grade.hidden = asc.hidden = pool.value !== "catalog";
      };
      pool.addEventListener("change", sync);
      sync();
      form = [hero, pool, grade, asc, field("fights per candidate", n), field("passes", passes)];
      start = () => {
        const [row, i] = hero.value.split(":");
        runSearch({ ...base(), search: "gear", hero: { row: row as "front" | "back", i: Number(i) }, quest: ctx.target().quest!, n: intOf(n), passes: intOf(passes, 1, 5),
          pool: pool.value as "owned" | "catalog", save: pool.value === "owned" ? ctx.save() : undefined, itemGrade: Number(grade.value), asc: Number(asc.value),
          expansions: allowedExpansions() }, out, (r) => {
          if (r.search !== "gear") return [];
          const g = r.result;
          return [el("div", { class: "search-cards" },
            el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "Now"), evLine(g.base))),
            el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "With the best gear"), evLine(g.final)))),
          // Two columns: weapon, head, chest | bracers, feet, talisman (gearGrid); the source of each change below.
          gearGrid(bySlot(g.gear, (x) => x.slot), (x, slot) => gearCell(x.item, x.from, slot), { label: "Best gear" }),
          ...(g.gear.some((x) => x.from) ? [el("ul", { class: "gear-from small muted" }, ...g.gear.filter((x) => x.from).map((x) =>
            el("li", {}, `${GEAR_SLOT_NAMES[x.slotName as GearSlot] ?? x.slotName}: ${itemNameFromEnglish("equipment", x.item ?? "")} (from ${x.from})`)))] : []),
          el("p", { class: "muted small" }, `${fmt.format(g.evaluated)} candidates evaluated. The hero keeps its own gear; equip the items in the game.`)];
        });
      };
    }

    if (key === "consumables") {
      const isMap = Boolean(t.map);
      intro = "Tries every potion (or one more permanent enchant) the hero can use, on the same rolls as the hero without it, "
        + "and ranks them by how much better the fights go. Potions last 3 quests (a map run counts as one); enchants are permanent.";
      const hero = heroPicker()!;
      const kind = select({ "aria-label": "Potions or enchants" }, [["boost", "🧪 Potions"], ["enchant", "🔮 Enchants"]]);
      const asc = (v: number, on: boolean) => {
        const c = el("input", { type: "checkbox", value: String(v) }) as HTMLInputElement;
        c.checked = on;
        return { c, node: el("label", { class: "check" }, c, ` asc ${v}`) };
      };
      const ascs = [asc(0, true), asc(1, false), asc(2, false)].filter((_, v) => isVisible("itemAscension", v));
      const n = num({ "aria-label": isMap ? "Runs per option" : "Fights per option" }, isMap ? 6 : 40);
      const prices = el("input", { type: "checkbox" }) as HTMLInputElement;
      prices.checked = true;
      const slots = el("div", { class: "enchant-slots", "aria-live": "polite" });
      // Free enchant slots of the chosen hero, before any search: maxEnchants = 8 + 4 x (prestige - 1).
      const showSlots = () => {
        const [row, i] = hero.value.split(":");
        const m = ctx.party().members.find((x) => x.row === row && x.i === Number(i));
        slots.replaceChildren();
        if (!m) return;
        const h = api.newHero(m.raw);
        const used = h.enchantList.length, max = h.maxEnchants;
        slots.append(el("span", { class: "slots-big" }, `${max - used}`), el("span", {},
          el("strong", {}, ` of ${max} enchant slots free`), el("br"),
          el("span", { class: "muted small" }, `${m.raw.name} uses ${used}. Enchants are permanent stats; each one here is tested on top of the hero's own.`)));
        slots.classList.toggle("none-free", used >= max);
      };
      hero.addEventListener("change", showSlots);
      showSlots();
      form = [hero, kind, ...ascs.map((a) => a.node), field(isMap ? "runs per option" : "fights per option", n),
        el("label", { class: "check" }, prices, " crafted cost (prices take a few seconds once)")];
      start = () => {
        const [row, i] = hero.value.split(":");
        const picked = ascs.filter((a) => a.c.checked).map((a) => Number(a.c.value));
        runSearch({ ...base(), search: "consumables", hero: { row: row as "front" | "back", i: Number(i) }, ...ctx.target(),
          kind: kind.value as "boost" | "enchant", n: intOf(n), ascs: picked.length ? picked : [0], prices: prices.checked }, out,
        (r) => (r.search === "consumables" ? consumableResult(r.result, kind.value as "boost" | "enchant", isMap) : []));
      };
      go.addEventListener("click", () => start());
      return el("div", { class: "search-panel" }, el("p", { class: "muted small" }, intro), slots,
        el("div", { class: "toolbar search-form" }, ...form, go));
    }

    if (key === "optimise") {
      const sv = ctx.save();
      const isMap = Boolean(t.map);
      intro = "Tunes the party, its order and rows, every member's rotation, passive and timing, their gear from the items you own"
        + `${isMap ? " and the scrolls" : ""} together: each step is kept only when the fights go better on the same rolls, `
        + "and the cycle repeats while it improves. The best setup so far is shown when the time runs out.";
      const budget = select({ "aria-label": "Time budget" }, [["2", "2 minutes"], ["5", "5 minutes"], ["10", "10 minutes"]]);
      const size = num({ "aria-label": "Party size", max: "6" }, 6);
      const step = (label: string, on = true) => {
        const c = el("input", { type: "checkbox" }) as HTMLInputElement;
        c.checked = on;
        return { c, node: el("label", { class: "check" }, c, ` ${label}`) };
      };
      // Party step off: the optimiser keeps the party of step 3 (it may still reorder it). On: that party is the one to beat.
      const sParty = step("party (off: keep the party of step 3)"), sSkills = step("rotations"), sGear = step("gear (items you own)"), sScrolls = step("scrolls");
      const excl = excludePicker(sv);
      form = [field("time", budget), field("heroes", size), el("span", { class: "muted small" }, "Tune:"), sParty.node, sSkills.node, sGear.node,
        ...(isMap ? [sScrolls.node] : []), excl.node];
      start = () => {
        const budgetMs = Number(budget.value) * 60000;
        const p = ctx.party();
        const startParty = { front: p.front.map((h) => h?.id ?? null), back: p.back.map((h) => h?.id ?? null) };
        const placed = [...startParty.front, ...startParty.back].filter((x): x is number => x !== null);
        if (!sParty.c.checked && !placed.length) {
          out.replaceChildren(el("p", { class: "error", role: "alert" }, "With the party step off, put the party in step 3 first (the optimiser keeps it)."));
          return;
        }
        const undo = snapshot();
        runSearch({ ...base(), search: "optimise", pool: excl.pool(placed), lock: ctx.locks(), poolSkills: ctx.poolSkills(), ...ctx.target(), save: sv,
          size: intOf(size, 1, 6), timeBudgetMs: budgetMs, ...(placed.length ? { startParty } : {}),
          steps: { party: sParty.c.checked, skills: sSkills.c.checked, gear: sGear.c.checked, scrolls: isMap && sScrolls.c.checked } }, out,
        (r, again) => (r.search === "optimise" ? optimiseResult(r.result, sv, undo, again) : []), budgetMs);
      };
    }

    go.addEventListener("click", () => start());
    return el("div", { class: "search-panel" }, el("p", { class: "muted small" }, intro),
      el("div", { class: "toolbar search-form" }, ...form, go));
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
      + "Locked slots (🔒) keep their hero. Up to 10 setups, winners (90 % or more) first, the fewest heroes first.";
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
      const rows = res.results.map((c, k) => {
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
    paint();
    const wins = res.results.filter((c) => c.ev.win >= 0.9).length;
    return [
      ...(res.stopped ? [el("p", { class: "muted small" }, "⏱️ Stopped early (time budget or Cancel): these are the setups found so far.")] : []),
      el("p", { class: "small" }, wins ? `${wins} setup${wins === 1 ? "" : "s"} win${wins === 1 ? "s" : ""} 90 % of the fights or more.`
        : "No setup wins 90 % of the time yet: the closest ones are listed."),
      box,
      el("p", { class: "muted small" }, `${fmt.format(res.tried)} evaluations. ${isMap ? "Progress: rooms cleared per run." : "Lowest enemy HP: the lowest point the enemy's HP reached, on average (0 % = killed)."} `
        + "Rough: only screened (default rows, the heroes' own rotations); the sizes far from winning are not tuned."),
    ];
  }

  /** Ranked potions or enchants: the baseline, free enchant slots, and one row per option. */
  function consumableResult(res: ConsumableRanking, kind: "boost" | "enchant", isMap: boolean): Node[] {
    const signed = (x: number) => `${x >= 0 ? "+" : "−"}${fmt.format(Math.abs(x))}`;
    const pp = (x: number) => `${x >= 0 ? "+" : "−"}${fmt1.format(Math.abs(x) * 100)} pts`;
    // Potions and enchants of an expansion the visitor hides are dropped (the ranking keeps its order).
    const ranked = res.ranked.filter((x) => isVisible("consumable", x.option.id, { ascension: x.option.asc }));
    const rows = ranked.map((x: ConsumableRank, k: number) => ({
      rank: k + 1, id: x.option.id, name: itemName("consumable", x.option.id) ?? x.option.name, asc: x.option.asc,
      effect: Object.entries(x.option.stats).map(([s, v]) => statText(s, v)).join(", "),
      win: x.winDelta, peak: x.peakDelta, gain: x.gain, cost: x.cost ?? null, perK: x.gainPerKGold ?? null,
    }));
    const best = ranked[0] === res.ranked[0] ? ranked[0] : undefined; // fillGain is about the overall best
    return [
      el("article", { class: "search-card" }, el("header", {}, el("strong", {}, kind === "boost" ? "Without a potion" : "With the hero's own enchants"), evLine(res.base))),
      ...(kind === "enchant" && res.freeSlots !== undefined ? [el("p", { class: "result-note" }, el("strong", {}, `🔮 ${res.freeSlots} free enchant slot${res.freeSlots === 1 ? "" : "s"}. `),
        best && res.fillGain !== undefined ? el("span", {}, `Filling ${res.freeSlots === 1 ? "it" : "all of them"} with `, itemLink("consumable", best.option.id, undefined, undefined, best.option.asc),
          ` changes the score by ${signed(res.fillGain)} (one: ${signed(best.gain)}).`) : el("span", { class: "muted" }, "No slot left: an enchant can't be added."))] : []),
      rows.length ? table(rows, [
        { key: "rank", label: "#", num: true },
        { key: "name", label: kind === "boost" ? "Potion" : "Enchant", render: (r) => itemLink("consumable", Number(r.id), undefined, undefined, Number(r.asc)) },
        { key: "effect", label: "Effect" },
        { key: "win", label: "Win", num: true, show: (v) => pp(Number(v)) },
        { key: "peak", label: isMap ? "Progress" : "Lowest enemy HP", num: true, show: (v) => pp(Number(v)) },
        { key: "gain", label: "Score gain", num: true, show: (v) => signed(Number(v)) },
        { key: "cost", label: "Crafted cost", num: true, show: (v) => (v === null ? "?" : `${fmt.format(Number(v))} g`) },
        { key: "perK", label: "Gain per 1,000 g", num: true, show: (v) => (v === null ? "–" : fmt.format(Number(v))) },
      ]) : el("p", { class: "muted" }, kind === "boost" ? "No potion this hero can drink yet (level requirement)." : "No enchant slot left on this hero."),
      el("p", { class: "muted small" }, `Win and ${isMap ? "progress" : "lowest enemy HP"}: change in percentage points against the line above. `
        + "Score: wins first, then enemy HP removed, then fewer turns and more party HP left."),
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

  /** The optimiser's result: before/after, the setup (party, rotations, gear, scrolls), Use this setup, the trace. */
  function optimiseResult(res: OptimiseResult, sv: Save, undo: HTMLElement, again = false): Node[] {
    const hero = (id: number) => sv.raw.hero.find((h: Any) => h.id === id);
    const name = (id: number | null) => (id === null ? "—" : hero(id)?.name ?? `#${id}`);
    // "Guerrier (#3)" (the optimiser's labels) → "Guerrier"; a bare "#3" → its name.
    const named = (s: string) => s.replace(/ \(#\d+\)/g, "").replace(/#(\d+)/g, (_, id) => name(Number(id)));
    const placed = [...res.config.party.front, ...res.config.party.back].filter((x): x is number => x !== null);
    // The setup fills the slots right away (party, rotations, scrolls); `undo` puts the previous one back.
    if (!again) {
      ctx.applyParty(res.config.party.front, res.config.party.back);
      const idx = (id: number) => sv.raw.hero.findIndex((h: Any) => h.id === id);
      for (const [id, s] of Object.entries(res.config.skills)) ctx.applyRotation(idx(Number(id)), s.rotation, s.passive);
      if (res.config.scrolls) ctx.applyScrolls(res.config.scrolls.map((x) => x.id));
    }
    const use = el("p", { class: "small" }, "✓ Party and rotations are in the slots below. ", undo);
    // "Why this rotation": the schedule notes of the optimised party against the quest's enemy timeline.
    const q = ctx.target().quest;
    const where = new Map<number, { row: "front" | "back"; i: number }>();
    (["front", "back"] as const).forEach((row) => res.config.party[row].forEach((id, i) => id !== null && where.set(id, { row, i })));
    const sched = q ? scheduleFor(q, placed.map((id) => ({ ...where.get(id)!, raw: hero(id), rotation: res.config.skills[id].rotation }))) : null;
    const gearRows = placed.flatMap((id) => (res.config.gear[id] ?? []).map((g) => ({ hero: name(id), slot: g.slot, item: g.item, from: named(g.from) })));
    return [
      ...(res.stopped ? [el("p", { class: "muted small" }, "⏱️ The time budget ran out: this is the best setup found so far.")] : []),
      el("div", { class: "search-cards" },
        ...(res.firstPartyEv ? [el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "Best party alone"), evLine(res.firstPartyEv)),
          el("p", { class: "muted small" }, "The party search only, with every hero's current rotation and gear."))] : []),
        el("article", { class: "search-card best" }, el("header", {}, el("strong", {}, "✨ Optimised"), evLine(res.ev)),
          partyLayout(res.config.party, name), use)),
      el("h3", { class: "sub" }, "Passives and rotations"),
      el("div", { class: "search-cards" }, ...placed.map((id) => {
        const s = res.config.skills[id];
        return el("article", { class: "search-card" }, el("header", {}, el("strong", {}, name(id))),
          el("p", { class: "small" }, "Passive: ", passiveLink(s.passive)),
          el("ol", { class: "rotation compact" }, ...s.rotation.map((x) => el("li", {}, skillLink(x)))),
          ...(sched ? [notesFor(sched.score, locationOf(where.get(id)!.row, where.get(id)!.i))].filter((x): x is HTMLElement => x !== null) : []));
      })),
      ...(gearRows.length ? [el("h3", { class: "sub" }, "Gear to equip"),
        // Per hero, the six slots in two columns (gearGrid); slots without a change read "keep".
        el("div", { class: "search-cards" }, ...placed.filter((id) => res.config.gear[id]?.length).map((id) => {
          const changes = res.config.gear[id];
          return el("article", { class: "search-card" }, el("header", {}, el("strong", {}, name(id))),
            gearGrid(bySlot(changes, (g) => g.slot), (g, slot) => gearCell(g.item, named(g.from), slot),
              { label: `${name(id)}: gear to equip`, empty: (slot) => el("span", { class: "gear-empty" }, el("span", { class: "slot-ico", "aria-hidden": "true" }, GEAR_SLOT_ICONS[slot]), `${GEAR_SLOT_NAMES[slot]}: keep`) }),
            el("ul", { class: "gear-from small muted" }, ...changes.map((g) => el("li", {}, `${GEAR_SLOT_NAMES[g.slot as GearSlot] ?? g.slot}: ${itemNameFromEnglish("equipment", g.item ?? "")}, take it from ${named(g.from)}`))));
        })),
        el("p", { class: "muted small" }, "The page can't change your save: equip these in the game. The simulation above already uses them.")] : []),
      ...(res.config.scrolls ? [el("p", { class: "result-note" }, el("strong", {}, "📜 Scrolls: "), ...(res.config.scrolls.length
        ? res.config.scrolls.flatMap((x, k) => [...(k ? [", "] : []), itemLink("consumable", x.id)]) : ["none"]))] : []),
      el("details", { class: "help" }, el("summary", {}, `How it got there (${res.trace.length} steps, ${res.rounds} round${res.rounds === 1 ? "" : "s"})`),
        table(res.trace.map((x) => ({ round: x.round, step: stepName(named(x.step)), change: named(x.change),
          // The first party step starts from no party (score −∞): it has no gain to show.
          gain: Number.isFinite(x.before) ? x.after - x.before : null, changed: x.after > x.before, s: x.ms / 1000 })), [
          { key: "round", label: "Round", num: true }, { key: "step", label: "Step" },
          { key: "change", label: "Change", render: (r) => (r.changed ? el("span", {}, String(r.change)) : el("span", { class: "muted" }, "kept")) },
          { key: "gain", label: "Score gain", num: true, show: (v) => (v === null ? "first party" : Number(v) > 0 ? `+${fmt.format(Number(v))}` : "–") },
          { key: "s", label: "Time", num: true, show: (v) => `${fmt1.format(Number(v))} s` },
        ]),
        el("p", { class: "muted small" }, "Score: wins first, then enemy HP removed, then fewer turns and more party HP left. "
          + "A step is kept only when it raises the score on the same rolls.")),
    ];
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

/** "skills Rogue" → "Rotation of Rogue", as the trace shows it. */
function stepName(step: string): string {
  const [k, ...rest] = step.split(" ");
  const who = rest.join(" ");
  return k === "party" ? "Party" : k === "skills" ? `Rotation of ${who}` : k === "gear" ? `Gear of ${who}` : k === "scrolls" ? "Scrolls" : step;
}

/** Back on the left, front on the right (the enemy is further right), as in step 3. */
function partyLayout(p: { front: (number | null)[]; back: (number | null)[] }, name: (id: number | null) => string): HTMLElement {
  return el("div", { class: "party-result" }, ...(["back", "front"] as const).map((row) => el("div", {},
    el("span", { class: "muted small" }, row === "front" ? "🛡️ Front" : "🏹 Back"),
    ...p[row].map((id) => pill(name(id), id === null ? "plain" : "")))));
}
