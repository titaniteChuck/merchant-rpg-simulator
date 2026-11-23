/**
 * Search tabs of the battle page: best rotation, best gear, best party, best scrolls. Each runs one search of the
 * web/src/tools/combat.ts search API in the battle worker, with progress and Cancel (the search is synchronous
 * inside the worker, so Cancel terminates it). The page passes a SearchContext so this module doesn't import it.
 */
import { G } from "../sim/data.ts";
import type { FightEval, MapEval, ScrollLoadout } from "../tools/combat.ts";
import { SCROLL_IDS } from "../tools/combat.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import type { Save } from "../tools/save.ts";
import type { SearchRequest, SearchResponse, SkillChoice } from "./battle-worker.ts";
import { bar, el, fmt, fmt1, pct, pill, rateTone, select, table } from "./dom.ts";
import { itemLink, passiveLink, skillLink } from "./wiki-data.ts";

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
}

const SEARCHES = [
  { key: "skills", label: "🧠 Best rotation" },
  { key: "gear", label: "🛡️ Best gear" },
  { key: "party", label: "👥 Best party" },
  { key: "scrolls", label: "📜 Best scrolls" },
] as const;
type SearchKey = (typeof SEARCHES)[number]["key"];

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

/** Build the tabs; returns refresh(), to rebuild an open search panel after the party or the opponent changed. */
export function initSearchTabs(ctx: SearchContext, mount: { tabs: HTMLElement; simulate: HTMLElement[]; panel: HTMLElement }): { refresh(): void } {
  let worker: Worker | null = null;
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };

  const tabs = el("div", { role: "tablist", class: "tabs", "aria-label": "Simulate or search" });
  const show = (key: "simulate" | SearchKey) => {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.key === key)));
    for (const e of mount.simulate) e.hidden = key !== "simulate";
    mount.panel.hidden = key === "simulate";
    if (key !== "simulate") mount.panel.replaceChildren(panel(key));
  };
  for (const [key, label] of [["simulate", "▶ Simulate"], ...SEARCHES.map((s) => [s.key, s.label])] as [string, string][]) {
    const b = el("button", { role: "tab", type: "button", "aria-selected": String(key === "simulate"), "data-key": key }, label);
    b.addEventListener("click", () => show(key as "simulate" | SearchKey));
    tabs.append(b);
  }
  mount.tabs.replaceChildren(tabs);
  mount.panel.hidden = true;

  /** Run a search in a fresh worker; progress and results go to `out`. */
  function runSearch(req: SearchRequest, out: HTMLElement, render: (m: Extract<SearchResponse, { type: "done" }>) => Node[]): void {
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
    out.replaceChildren(el("div", { class: "search-progress" }, el("div", { class: "toolbar" }, stage, cancel), prog));
    w.onmessage = (e: MessageEvent<SearchResponse>) => {
      const m = e.data;
      if (m.type === "progress") {
        stage.textContent = `${m.stage}: ${fmt.format(m.done)} / ${fmt.format(m.total)}`;
        const fill = prog.firstElementChild as HTMLElement;
        fill.style.width = `${m.total ? (100 * m.done) / m.total : 0}%`;
        return;
      }
      stopWorker();
      if (m.type === "error") out.replaceChildren(el("p", { class: "error", role: "alert" }, m.error));
      else out.replaceChildren(...render(m), el("p", { class: "muted small" }, `Searched in ${fmt1.format(m.ms / 1000)} s with fixed seeds: every candidate is tested on the same rolls.`));
    };
    w.onerror = (e) => {
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
    if (key !== "party" && !ctx.party().members.length) return el("p", { class: "muted" }, "Put at least one hero in the party (step 1).");
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
      intro += ` All ${sv.raw.hero.length} heroes of the save are candidates; this can take a few minutes.`;
      start = () => runSearch({ ...base(), search: "party", pool: sv.raw.hero, ...ctx.target(), size: intOf(size, 1, 6),
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
          el("div", { class: "party-result" }, ...(["front", "back"] as const).map((row) => el("div", {},
            el("span", { class: "muted small" }, row === "front" ? "🛡️ Front" : "🏹 Back"),
            ...p.party[row].map((id) => pill(name(id), id === null ? "plain" : ""))))),
          use),
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

    go.addEventListener("click", () => start());
    return el("div", { class: "search-panel" }, el("p", { class: "muted small" }, intro),
      el("div", { class: "toolbar search-form" }, ...form, go), out);
  }

  return {
    refresh() {
      const sel = tabs.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
      if (sel && sel.dataset.key !== "simulate") show(sel.dataset.key as SearchKey);
    },
  };
}
