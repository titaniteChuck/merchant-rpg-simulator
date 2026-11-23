/**
 * Search panels of the battle page (one per mode of step 1): best rotation, best gear, best party, best scrolls and
 * optimise everything. Each runs one search of web/src/tools/combat.ts (optimiseFight of optimise.ts for the last)
 * in the battle worker, with progress and Cancel (the search is synchronous inside the worker, so Cancel terminates
 * it). The page passes a SearchContext so this module doesn't import it.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import type { ConsumableRank, ConsumableRanking } from "../tools/consumables.ts";
import type { FightEval, MapEval, ScrollLoadout } from "../tools/combat.ts";
import type { OptimiseResult } from "../tools/optimise.ts";
import { SCROLL_IDS } from "../tools/combat.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import type { Save } from "../tools/save.ts";
import type { SearchRequest, SearchResponse, SkillChoice } from "./battle-worker.ts";
import { bar, el, fmt, fmt1, pct, pill, rateTone, select, table } from "./dom.ts";
import { locationOf, notesFor, type PlanMember, scheduleFor } from "./timeline.ts";
import { itemLink, passiveLink, skillLink, statText } from "./wiki-data.ts";

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
  /** The opponent chosen in step 2. */
  target(): { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } };
  /** Give a hero (save index) a rotation and passive in the party editor. */
  applyRotation(idx: number, rotation: string[], passive: string): void;
  /** Put heroes (save hero ids) in the slots. */
  applyParty(front: (number | null)[], back: (number | null)[]): void;
  /** Edited rotations by save hero id (heroes outside the party too), for the searches over all heroes. */
  poolSkills(): Record<number, SkillChoice>;
  /** Set the map run's scrolls in step 2. */
  applyScrolls(ids: number[]): void;
}

export type SearchKey = "skills" | "gear" | "party" | "scrolls" | "optimise" | "consumables";

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
const evLine = (ev: FightEval | MapEval) => (isMapEval(ev) ? mapLine(ev) : fightLine(ev));

/** The search panels; show(key) puts one in `mount`, refresh() rebuilds it after the party or the opponent changed. */
export function initSearch(ctx: SearchContext, mount: HTMLElement): { show(key: SearchKey | null): void; refresh(): void } {
  let worker: Worker | null = null;
  let current: SearchKey | null = null;
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };
  const show = (key: SearchKey | null) => {
    if (key !== current) stopWorker();
    current = key;
    mount.hidden = key === null;
    mount.replaceChildren(...(key ? [panel(key)] : []));
  };

  /** Run a search in a fresh worker; progress and results go to `out`. */
  function runSearch(req: SearchRequest, out: HTMLElement, render: (m: Extract<SearchResponse, { type: "done" }>) => Node[],
    budgetMs?: number): void {
    stopWorker();
    const w = new Worker(new URL("js/battle-worker.js", document.baseURI), { type: "module" });
    worker = w;
    const stage = el("span", { class: "muted small" }, "Starting…");
    const prog = bar(0);
    const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
    cancel.addEventListener("click", () => {
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
    w.onmessage = (e: MessageEvent<SearchResponse>) => {
      const m = e.data;
      if (m.type === "progress") {
        stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
        if (!budgetMs) (prog.firstElementChild as HTMLElement).style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
        return;
      }
      if (timer) clearInterval(timer);
      stopWorker();
      if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
      else out.replaceChildren(...render(m), el("p", { class: "muted small" }, `Searched in ${fmt1.format(m.ms / 1000)} s with fixed seeds: every candidate is tested on the same rolls.`));
    };
    w.onerror = (e) => {
      if (timer) clearInterval(timer);
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
  function panel(key: SearchKey): HTMLElement {
    const t = ctx.target();
    const out = el("div", { class: "search-out", "aria-live": "polite" });
    const needQuest = (key === "skills" || key === "gear") && !t.quest;
    const needMap = key === "scrolls" && !t.map;
    if (needQuest) return el("p", { class: "muted" }, "This search optimises quest fights: choose ⚔️ Quest enemy in step 2.");
    if (needMap) return el("p", { class: "muted" }, "This search optimises map runs: choose 🗺️ Map run in step 2.");
    if (key !== "party" && key !== "optimise" && !ctx.party().members.length) return el("p", { class: "muted" }, "Put at least one hero in the party (step 2).");
    const go = el("button", { type: "button", class: "primary" }, "🔎 Search");
    let form: HTMLElement[] = [];
    let start: () => void = () => {};
    let intro = "";

    if (key === "skills") {
      intro = "Tries every rotation of unlocked skills within the hero's AP budget, then the best orderings with each passive.";
      const hero = heroPicker()!;
      const quick = num({ "aria-label": "Fights per candidate" }, 30), final = num({ "aria-label": "Fights for the finalists" }, 300), top = num({ "aria-label": "Finalists", max: "20" }, 8);
      form = [hero, field("fights per candidate", quick), field("finalists", top), field("fights per finalist", final)];
      start = () => {
        const [row, i] = hero.value.split(":");
        const m = ctx.party().members.find((x) => x.row === row && x.i === Number(i))!;
        runSearch({ ...base(), search: "skills", hero: { row: row as "front" | "back", i: Number(i) }, quest: ctx.target().quest!,
          nQuick: intOf(quick), nFinal: intOf(final), top: intOf(top, 1, 20) }, out, (r) => {
          if (r.search !== "skills") return [];
          const res = r.result;
          const card = (label: string, rot: string[], passive: string, ev: FightEval, apply: boolean) =>
            el("article", { class: "search-card" }, el("header", {}, el("strong", {}, label), evLine(ev)),
              el("ol", { class: "rotation compact" }, ...rot.map((s) => el("li", {}, skillLink(s)))),
              el("p", { class: "small" }, "Passive: ", passiveLink(passive)),
              ...[whyRotation(m.row, m.i, rot)].filter((x): x is HTMLElement => x !== null),
              ...(apply ? [(() => {
                const b = el("button", { type: "button", class: "secondary" }, "Use this rotation");
                b.addEventListener("click", () => {
                  ctx.applyRotation(m.idx, rot, passive);
                  b.textContent = "✓ Applied to the party";
                  b.setAttribute("disabled", "");
                });
                return b;
              })()] : []));
          return [el("p", { class: "muted small" }, `${res.counts.combos} skill sets, ${res.counts.orderings} orderings, ${res.counts.final} finalists · AP budget ${res.maxAP}.`),
            el("div", { class: "search-cards" }, card("Now", res.current.rotation, res.current.passive, res.current.ev, false),
              ...res.ranked.slice(0, 5).map((x, k) => card(`#${k + 1}`, x.rotation, x.passive, x.ev, true)))];
        });
      };
    }

    if (key === "gear") {
      intro = "Slot by slot, tries every candidate item and keeps it when the party does better (repeated for a few passes).";
      const hero = heroPicker()!;
      const pool = select({ "aria-label": "Candidate items" }, [["owned", "Items you own (inventory, counter, other heroes)"], ["catalog", "Craftable catalog items"]]);
      const grade = select({ "aria-label": "Catalog grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
      grade.value = "5";
      const asc = select({ "aria-label": "Catalog ascension" }, [["0", "No ascension"], ["1", "Ascension 1"], ["2", "Ascension 2"]]);
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
          pool: pool.value as "owned" | "catalog", save: pool.value === "owned" ? ctx.save() : undefined, itemGrade: Number(grade.value), asc: Number(asc.value) }, out, (r) => {
          if (r.search !== "gear") return [];
          const g = r.result;
          return [el("div", { class: "search-cards" },
            el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "Now"), evLine(g.base))),
            el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "With the best gear"), evLine(g.final)))),
          table(g.gear.map((x) => ({ slot: x.slotName, item: x.item ?? "", from: x.from ?? "" })), [
            { key: "slot", label: "Slot" }, { key: "item", label: "Item", render: (rr) => el("strong", {}, String(rr.item)) },
            { key: "from", label: "Source", render: (rr) => (rr.from ? pill(`change · ${rr.from}`, "t-green") : el("span", { class: "muted" }, "keep")) },
          ]),
          el("p", { class: "muted small" }, `${fmt.format(g.evaluated)} candidates evaluated. The hero keeps its own gear; equip the items in the game.`)];
        });
      };
    }

    if (key === "party") {
      intro = "Builds the party one hero at a time (the hero and slot that help most), then swaps and moves heroes while it improves.";
      const sv = ctx.save();
      const size = num({ "aria-label": "Party size", max: "6" }, 6);
      const isMap = Boolean(t.map);
      const quick = num({ "aria-label": "Fights per candidate" }, isMap ? 5 : 20), final = num({ "aria-label": "Fights for the result" }, isMap ? 30 : 200);
      form = [field("heroes", size), field(isMap ? "runs per candidate" : "fights per candidate", quick), field(isMap ? "runs for the result" : "fights for the result", final)];
      const excl = excludePicker(sv);
      form = [...form, excl.node];
      intro += " Every hero of the save is a candidate, except the ones you leave out; this can take a few minutes.";
      start = () => runSearch({ ...base(), search: "party", pool: excl.pool(), lock: excl.lock(), poolSkills: ctx.poolSkills(), ...ctx.target(), size: intOf(size, 1, 6),
        nQuick: intOf(quick), nFinal: intOf(final) }, out, (r) => {
        if (r.search !== "party") return [];
        const p = r.result;
        const name = (id: number | null) => (id === null ? "—" : sv.raw.hero.find((h: Any) => h.id === id)?.name ?? `#${id}`);
        const use = el("button", { type: "button", class: "secondary" }, "Use this party");
        use.addEventListener("click", () => {
          ctx.applyParty(p.party.front, p.party.back);
          use.textContent = "✓ Party set";
          use.setAttribute("disabled", "");
        });
        return [el("article", { class: "search-card" }, el("header", {}, el("strong", {}, "Best party found"), evLine(p.ev)),
          partyLayout(p.party, name), use),
        el("p", { class: "muted small" }, `${p.added.length} heroes added, ${p.improvements} improvement${p.improvements === 1 ? "" : "s"} by swapping or moving.`)];
      });
    }

    if (key === "scrolls") {
      intro = "Tries every loadout of up to 3 scrolls on this map with this party, then re-runs the best ones with more runs.";
      const asc = select({ "aria-label": "Scroll ascension" }, [["0", "No ascension"], ["1", "Ascension 1"], ["2", "Ascension 2"]]);
      const quick = num({ "aria-label": "Runs per loadout" }, 5), final = num({ "aria-label": "Runs for the finalists" }, 30), top = num({ "aria-label": "Finalists", max: "20" }, 6);
      const pool = SCROLL_IDS.filter((id) => G.itemData.consumable?.[id]);
      form = [asc, field("runs per loadout", quick), field("finalists", top), field("runs per finalist", final)];
      intro += ` ${pool.length} scrolls, every loadout of 0 to 3.`;
      start = () => runSearch({ ...base(), search: "scrolls", map: { spec: ctx.target().map!.spec }, pool, scrollAsc: Number(asc.value),
        nQuick: intOf(quick), nFinal: intOf(final), top: intOf(top, 1, 20) }, out, (r) => {
        if (r.search !== "scrolls") return [];
        const rows = r.result.ranked.map((x: ScrollLoadout, k: number) => ({
          rank: k + 1, loadout: x.loadout.join(","), cost: x.cost, win: x.ev.win, progress: x.ev.cleared, grade: x.ev.grade,
          essence: Object.values(x.ev.essence).reduce((a, b) => a + b, 0), loot: x.ev.loot_value, escaped: x.ev.escaped,
        }));
        return [table(rows, [
          { key: "rank", label: "#", num: true },
          { key: "loadout", label: "Scrolls", render: (rr) => {
            const ids = String(rr.loadout).split(",").filter(Boolean).map(Number);
            return ids.length ? el("span", { class: "skill-line" }, ...ids.flatMap((id, k) => [...(k ? [", "] : []), itemLink("consumable", id, undefined, undefined, Number(asc.value))]))
              : el("span", { class: "muted" }, "no scrolls");
          } },
          { key: "cost", label: "Crafted cost", num: true, show: (v) => (Number.isFinite(Number(v)) ? `${fmt.format(Number(v))} g` : "?") },
          { key: "win", label: "Win", num: true, show: (v) => pct(Number(v)) }, { key: "progress", label: "Progress", num: true, show: (v) => pct(Number(v)) },
          { key: "grade", label: "Grade", num: true, show: (v) => fmt1.format(Number(v)) }, { key: "essence", label: "Essence / run", num: true, show: (v) => fmt1.format(Number(v)) },
          { key: "loot", label: "Loot / run", num: true, show: (v) => `${fmt.format(Number(v))} g` }, { key: "escaped", label: "Escaped", num: true, show: (v) => pct(Number(v)) },
        ]), ...(r.result.priceError ? [el("p", { class: "muted small" }, `Scroll prices unavailable: ${r.result.priceError}`)] : [])];
      });
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
      const ascs = [asc(0, true), asc(1, false), asc(2, false)];
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
        el("div", { class: "toolbar search-form" }, ...form, go), out);
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
      // Party step off: the optimiser keeps the party of step 2 (it may still reorder it). On: that party is the one to beat.
      const sParty = step("party (off: keep the party of step 2)"), sSkills = step("rotations"), sGear = step("gear (items you own)"), sScrolls = step("scrolls");
      const excl = excludePicker(sv);
      form = [field("time", budget), field("heroes", size), el("span", { class: "muted small" }, "Tune:"), sParty.node, sSkills.node, sGear.node,
        ...(isMap ? [sScrolls.node] : []), excl.node];
      start = () => {
        const budgetMs = Number(budget.value) * 60000;
        const p = ctx.party();
        const startParty = { front: p.front.map((h) => h?.id ?? null), back: p.back.map((h) => h?.id ?? null) };
        const placed = [...startParty.front, ...startParty.back].filter((x): x is number => x !== null);
        if (!sParty.c.checked && !placed.length) {
          out.replaceChildren(el("p", { class: "error", role: "alert" }, "With the party step off, put the party in step 2 first (the optimiser keeps it)."));
          return;
        }
        runSearch({ ...base(), search: "optimise", pool: excl.pool(placed), lock: excl.lock(), poolSkills: ctx.poolSkills(), ...ctx.target(), save: sv,
          size: intOf(size, 1, 6), timeBudgetMs: budgetMs, ...(placed.length ? { startParty } : {}),
          steps: { party: sParty.c.checked, skills: sSkills.c.checked, gear: sGear.c.checked, scrolls: isMap && sScrolls.c.checked } }, out,
        (r) => (r.search === "optimise" ? optimiseResult(r.result, sv) : []), budgetMs);
      };
    }

    go.addEventListener("click", () => start());
    return el("div", { class: "search-panel" }, el("p", { class: "muted small" }, intro),
      el("div", { class: "toolbar search-form" }, ...form, go), out);
  }

  /** Ranked potions or enchants: the baseline, free enchant slots, and one row per option. */
  function consumableResult(res: ConsumableRanking, kind: "boost" | "enchant", isMap: boolean): Node[] {
    const signed = (x: number) => `${x >= 0 ? "+" : "−"}${fmt.format(Math.abs(x))}`;
    const pp = (x: number) => `${x >= 0 ? "+" : "−"}${fmt1.format(Math.abs(x) * 100)} pts`;
    const rows = res.ranked.map((x: ConsumableRank, k: number) => ({
      rank: k + 1, id: x.option.id, name: x.option.name, asc: x.option.asc,
      effect: Object.entries(x.option.stats).map(([s, v]) => statText(s, v)).join(", "),
      win: x.winDelta, peak: x.peakDelta, gain: x.gain, cost: x.cost ?? null, perK: x.gainPerKGold ?? null,
    }));
    const best = res.ranked[0];
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

  /** "Why this rotation": hero (row, i) playing `rot`, the others their current rotations, against the quest's timeline. */
  function whyRotation(row: "front" | "back", i: number, rot: string[]): HTMLElement | null {
    const q = ctx.target().quest;
    if (!q) return null;
    const p = ctx.party();
    const members: PlanMember[] = p.members.map((m) => ({
      row: m.row, i: m.i, raw: m.raw,
      rotation: m.row === row && m.i === i ? rot : (p.skills[m.row][m.i]?.attackList ?? api.newHero(m.raw).attackList.slice(1, 6)),
    }));
    const r = scheduleFor(q, members);
    return r ? notesFor(r.score, locationOf(row, i)) : null;
  }

  /**
   * Candidate chips: "Leave heroes out" (not candidates) and "Must be in the party" (lock). A locked hero, or one
   * of `keep` (the starting party), stays a candidate even when it is also left out.
   */
  function excludePicker(sv: Save): { node: HTMLElement; pool(keep?: number[]): Any[]; lock(): number[] } {
    const chips = (cls: string) => sv.raw.hero.map((h: Any) => {
      const c = el("input", { type: "checkbox", value: String(h.id) }) as HTMLInputElement;
      return { h, c, node: el("label", { class: `chip-check ${cls}` }, c, ` ${h.name}`) };
    });
    const out = chips("out"), locked = chips("lock");
    const lock = () => locked.filter((b: Any) => b.c.checked).map((b: Any) => Number(b.h.id));
    const node = el("div", { class: "pickers" },
      el("details", { class: "exclude" }, el("summary", { class: "small" }, "Leave heroes out"),
        el("div", { class: "chip-checks" }, ...out.map((b: Any) => b.node))),
      el("details", { class: "exclude" }, el("summary", { class: "small" }, "Must be in the party"),
        el("div", { class: "chip-checks" }, ...locked.map((b: Any) => b.node))));
    return {
      node, lock,
      pool: (keep = []) => {
        const must = new Set([...lock(), ...keep]);
        return out.filter((b: Any) => !b.c.checked || must.has(Number(b.h.id))).map((b: Any) => b.h);
      },
    };
  }

  /** The optimiser's result: before/after, the setup (party, rotations, gear, scrolls), Use this setup, the trace. */
  function optimiseResult(res: OptimiseResult, sv: Save): Node[] {
    const hero = (id: number) => sv.raw.hero.find((h: Any) => h.id === id);
    const name = (id: number | null) => (id === null ? "—" : hero(id)?.name ?? `#${id}`);
    // "Guerrier (#3)" (the optimiser's labels) → "Guerrier"; a bare "#3" → its name.
    const named = (s: string) => s.replace(/ \(#\d+\)/g, "").replace(/#(\d+)/g, (_, id) => name(Number(id)));
    const placed = [...res.config.party.front, ...res.config.party.back].filter((x): x is number => x !== null);
    const use = el("button", { type: "button", class: "primary" }, "Use this setup");
    use.addEventListener("click", () => {
      ctx.applyParty(res.config.party.front, res.config.party.back);
      const idx = (id: number) => sv.raw.hero.findIndex((h: Any) => h.id === id);
      for (const [id, s] of Object.entries(res.config.skills)) ctx.applyRotation(idx(Number(id)), s.rotation, s.passive);
      if (res.config.scrolls) ctx.applyScrolls(res.config.scrolls.map((x) => x.id));
      use.textContent = "✓ Party and rotations set in step 2";
      use.setAttribute("disabled", "");
    });
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
      el("h3", { class: "sub" }, "Rotations"),
      el("div", { class: "search-cards" }, ...placed.map((id) => {
        const s = res.config.skills[id];
        return el("article", { class: "search-card" }, el("header", {}, el("strong", {}, name(id))),
          el("ol", { class: "rotation compact" }, ...s.rotation.map((x) => el("li", {}, skillLink(x)))),
          el("p", { class: "small" }, "Passive: ", passiveLink(s.passive)),
          ...(sched ? [notesFor(sched.score, locationOf(where.get(id)!.row, where.get(id)!.i))].filter((x): x is HTMLElement => x !== null) : []));
      })),
      ...(gearRows.length ? [el("h3", { class: "sub" }, "Gear to equip"),
        table(gearRows, [{ key: "hero", label: "Hero" }, { key: "slot", label: "Slot" }, { key: "item", label: "Item", render: (r) => el("strong", {}, String(r.item)) },
          { key: "from", label: "Take it from" }]),
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
      if (current) show(current);
    },
  };
}

/** "skills Rogue" → "Rotation of Rogue", as the trace shows it. */
function stepName(step: string): string {
  const [k, ...rest] = step.split(" ");
  const who = rest.join(" ");
  return k === "party" ? "Party" : k === "skills" ? `Rotation of ${who}` : k === "gear" ? `Gear of ${who}` : k === "scrolls" ? "Scrolls" : step;
}

/** Back on the left, front on the right (the enemy is further right), as in step 2. */
function partyLayout(p: { front: (number | null)[]; back: (number | null)[] }, name: (id: number | null) => string): HTMLElement {
  return el("div", { class: "party-result" }, ...(["back", "front"] as const).map((row) => el("div", {},
    el("span", { class: "muted small" }, row === "front" ? "🛡️ Front" : "🏹 Back"),
    ...p[row].map((id) => pill(name(id), id === null ? "plain" : "")))));
}
