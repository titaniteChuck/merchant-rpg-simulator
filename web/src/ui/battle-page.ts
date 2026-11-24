/**
 * The Battle section's two pages (U41), one code: initBattlePage("simulate") for the Simulator (site/battle.html,
 * entry battle.ts) and initBattlePage("solve") for the Solver (site/solver.html, entry solver.ts).
 *
 * Simulator: step 1 is the Simulate box (runs, ▶ Simulate); step 2 the Results (progress, then the outcome), right under
 * it; step 3 holds the party (six slots, back row | front row) on the left and the opponent card (a quest enemy or a
 * map run) on the right; U39: two tabs, Party (those) and Flow (the whole fight, turn by turn, editable).
 *
 * Solver: step 1 is the spoiler guard (battle-search.ts), then what to solve: the opponent (the Simulator's pickers)
 * and the solve options with "Solve"; step 2 the solver's results; step 3, the Party and Flow tabs, stays hidden
 * until a result's "Show" fills it (revealParty). Its party is its own, in memory only: the Simulator's remembered
 * party changes only by "Open in Simulator" (battle-links.ts simulatorPartyFrom), which copies the shown party and
 * the opponent over and opens the Simulator. The Solver's opponent is remembered apart (`solver-opponent`).
 * Runs go to a web worker with the game's rules (TypeScript engine).
 *
 * Expansions (U28): the enemy and map pickers and the scrolls leave out content of expansions the visitor hides
 * (expansion-state.ts); the save's own maps always stay. Options of expansion content end with ❄ / ✒. The opponent
 * card is rebuilt (keeping the choice when it is still there) whenever the expansion switches change.
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { maxQuestAmount, SCROLL_IDS } from "../tools/combat.ts";
import type { FightEval, HeroEval, MapEval } from "../tools/combat.ts";
import { type MapSpec, type Scroll, Sim } from "../tools/engine.ts";
import { type FightTrace, type MapRoomTrace, traceFight, traceMapRun } from "../tools/fight-trace.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import type { BattleRequest, BattleResponse, SkillChoice } from "./battle-worker.ts";
import { $, apBadge, clickableRow, duration, el, expansionMark, fmt, fmt1, fmtCompact, gold, gradeBadge, heroAsc, pct, pill, rateTone, type Row, select, table, tile, toast, withAsc } from "./dom.ts";
import { isVisible, needsOf, subscribe } from "./expansion-state.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSearch, type PartyMember } from "./battle-search.ts";
import { SIMULATOR_PAGE, simulatorPartyFrom, type StoredParty } from "./battle-links.ts";
import { type PageTarget, problemOf, rulesOf, rulesText } from "./battle-rules.ts";
import { loadTimelineData, partyPlan, type PlanEdit, planNote, type PlanMember, timelineOf } from "./timeline.ts";
import { mapRoomTabs } from "./battle-plan.ts";
import { defaultQuest, defaultSlots, effectiveDamage, enemyGroups, enemyMaxHp, enemyRadar, EVA_RIM, includedSlots, isFightable, type SlotRef } from "./battle-setup.ts";
import { helpTip } from "./wiki-help.ts";
import { mapRooms, mapTreasure } from "../tools/quest-stats.ts";
import { initSaveSource } from "./save-source.ts";
import { type ApBudget, apRefusal, apUsed, assignHeroChecked, editRotationSkill, slotKeyOfLoc } from "./battle-edit.ts";
import { enemyLevelText, enemyLink, itemLink, loadWikiText, passiveLink, passiveText, skillAp, skillLink } from "./wiki-data.ts";
import { type MapRunContext, mapResultXp, type QuestRunContext, questResultXp, xpText } from "./quest-xp.ts";
import { statLink } from "./wiki-ref.ts";
import { languageReady, onLanguageChange } from "./language.ts";
import { className as classNameOf, enemyName, itemName, itemNameFromEnglish, modItemName, passiveName, prefixName, skillName, suffixName } from "./names.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const GRADES = ["D", "C", "B", "A", "S"];

type Opp = "quest" | "map";
/**
 * The two pages (U41; until then two modes of one page). `party`: the user sets the party (Simulator); the Solver
 * finds it. `opp`: the opponents the page works on (the first is the default).
 */
export type PageKind = "simulate" | "solve";
interface Mode { key: PageKind; party: boolean; opp: Opp[] }
const MODES: Record<PageKind, Mode> = {
  simulate: { key: "simulate", party: true, opp: ["quest", "map"] },
  // U27: the solver (was Best party, Best rotation and Best scrolls; "Solve" since U36), behind a spoiler guard (battle-search.ts).
  solve: { key: "solve", party: false, opp: ["quest", "map"] },
};
/** The page is the Solver. */
const solving = () => state.mode.key === "solve";
const SLOTS = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2]] as const;

interface State {
  mode: Mode;
  sv: Save | null;
  /** file name of the save, to remember the party per save */
  saveName: string;
  slots: Record<string, number | null>; // "front0" -> hero index in sv.raw.hero
  skills: Record<number, SkillChoice>; // hero index -> edited rotation
  /** Slots whose hero the solver must keep (slot key -> true). */
  locked: Record<string, boolean>;
  /** U36: slots whose hero is ticked out on its card: it stays in the slot but doesn't fight (slot key -> true). */
  excluded: Record<string, boolean>;
  worker: Worker | null;
}
const state: State = { mode: MODES.simulate, sv: null, saveName: "", slots: {}, skills: {}, locked: {}, excluded: {}, worker: null };

// The Simulator's party and edited rotations, remembered per save in this browser (convenience only). The Solver's
// party lives in memory only (U41): a result's Show sets it; "Open in Simulator" hands it over.
const partyKey = () => `battle-party:${state.saveName}`;
function persistParty(): void {
  if (solving()) return;
  try {
    localStorage.setItem(partyKey(), JSON.stringify({ slots: state.slots, skills: state.skills, locked: state.locked, excluded: state.excluded }));
  } catch { /* storage blocked: the party just isn't remembered */ }
}
/** Put back this save's remembered party; false when none was remembered (a fresh save, R1 F02). */
function restoreParty(heroes: number): boolean {
  if (solving()) return false;
  try {
    const p = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    if (!p) return false;
    const ok = (i: unknown) => i === null || (typeof i === "number" && i >= 0 && i < heroes);
    state.slots = Object.fromEntries(Object.entries(p.slots ?? {}).filter(([, i]) => ok(i))) as State["slots"];
    state.skills = Object.fromEntries(Object.entries(p.skills ?? {}).filter(([i]) => ok(Number(i)))) as State["skills"];
    state.locked = Object.fromEntries(Object.entries(p.locked ?? {}).filter(([, v]) => v === true)) as State["locked"];
    state.excluded = Object.fromEntries(Object.entries(p.excluded ?? {}).filter(([, v]) => v === true)) as State["excluded"];
    return true;
  } catch {
    // Storage blocked: like a fresh save. Broken JSON: start over too.
    return false;
  }
}

/** The combat stats on a hero card, in the game's order. */
const CARD_STATS: [string, string][] = [["maxHP", "HP"], ["atk", "Atk"], ["matk", "Matk"], ["def", "Def"], ["mdef", "Mdef"], ["acc", "Acc"], ["crit", "Crit"]];

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

const className = (cls: number) => classNameOf(cls) ?? `class ${cls}`;
// No "asc N" in option text: the chosen hero's avatar carries the ascension outline.
const heroLabel = (h: Any) => `${h.name} · ${className(h.class)} lv ${h.level}`;
const slotKey = (row: string, i: number) => `${row}${i}`;
const slotLabel = (key: string) => `${key.startsWith("front") ? "Front" : "Back"} ${key.endsWith("1") ? 1 : key.endsWith("2") ? 2 : 3}`;

// ---------------------------------------------------------------- choices
/**
 * The enemy picker (U36): by region and kind, region by region: "<Region>", "<Region> – Event", "<Region> – Map" (map
 * bosses and map Treasure Bushes only), each by level (battle-setup.ts enemyGroups on wiki-data.ts regionOf).
 */
function questOptions(): [string, [string, string][]][] {
  const ids = Object.keys(G.questData).map(Number)
    // Placeholders are not fights (wiki-data PLACEHOLDER_QUEST_IDS); the quest bushes (gathering quests) are. Nor is
    // an expansion the visitor hides (Frentir, map bosses).
    .filter((id) => isFightable(id) && isVisible("enemy", id));
  return enemyGroups(ids).map((g) => [g.label, g.ids.map((id): [string, string] => {
    const q = G.questData[id];
    const rare = q.enemyHpB !== undefined && q.attackListB !== undefined && q.nameB ? ` / rare: ${enemyName(id, true)}` : "";
    return [String(id), `Lv ${enemyLevelText(id)} · ${enemyName(id)}${rare}${expansionMark(needsOf("enemy", id))}`];
  })]);
}

function mapOptions(sv: Save | null): [string, [string, string][]][] {
  const catalog = Object.entries<Any>(G.itemData.map ?? {}).filter(([id, m]) => m.name && isVisible("map", Number(id)))
    .sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || Number(a[0]) - Number(b[0]))
    .map(([id, m]): [string, string] => [`cat:${id}`, `Lv ${m.itemLevel ?? "?"} · ${itemName("map", id) ?? m.name}${expansionMark(needsOf("map", Number(id)))}`]);
  const groups: [string, [string, string][]][] = [];
  const owned = sv?.mapInventory ?? [];
  if (owned.length) {
    groups.push(["Your maps", owned.map((m: Any, i: number): [string, string] => {
      // U34 / U36: "[Prefix] Map +N", each part translated (names.ts modItemName). Options can't be outlined: the
      // chosen map is shown outlined under the pickers (renderTarget).
      return [`own:${i}`, `${modItemName("map", m.id, m)} · ${GRADES[(m.grade ?? 3) - 1] ?? m.grade}`];
    })]);
  }
  if (catalog.length) groups.push(["All maps (choose ascension and grade)", catalog]);
  return groups;
}

/** A map run can be set up: the save has maps, or some catalog map is visible (maps are Scribe content). */
const mapsAvailable = (): boolean => mapOptions(state.sv).some(([, list]) => list.length > 0);

/** Hide "Map run" when no map can be picked (no Scribe, no maps in the save); fall back to the quest enemy. */
function syncOppKinds(): boolean {
  let changed = false;
  const maps = mapsAvailable();
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => {
    const ok = state.mode.opp.includes(r.value as Opp) && (r.value !== "map" || maps);
    (r.closest("label") as HTMLElement).hidden = !ok;
    if (!ok && r.checked) {
      r.checked = false;
      changed = true;
    }
  });
  const left = state.mode.opp.filter((o) => o !== "map" || maps);
  if (changed && left.length) $<HTMLInputElement>(`input[name=opp][value=${left[0]}]`).checked = true;
  $("#opp-switch").hidden = left.length < 2;
  return changed;
}

// ---------------------------------------------------------------- party
function heroRaw(i: number | null): Any | null {
  return i === null || i === undefined || !state.sv ? null : state.sv.raw.hero[i];
}

/** A compact "⇄" control over a transparent <select>: swaps a skill or the passive in place (the slot keeps its size). */
function swapControl(label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  const s = select({ "aria-label": label, class: "swap-select" }, options);
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return el("span", { class: "swap", title: label }, el("span", { "aria-hidden": "true" }, "⇄"), s);
}
/** The same control, greyed, for an empty slot. */
const swapPlaceholder = () => el("span", { class: "swap off", "aria-hidden": "true" }, "⇄");

/** Rebuild the party after an in-place edit, then put the focus back on the control that made it. */
function afterEdit(focusKey: string): void {
  persistParty();
  renderParty(false);
  document.querySelector<HTMLElement>(`[data-focus="${focusKey}"] select`)?.focus();
}

/**
 * The skills a hero can put in a rotation slot, [skill, label with AP]: Basic and its unlocked skills. `current`: a
 * skill it plays but hasn't unlocked (old save) stays listed, so the control shows the truth. Both tabs use it (U39).
 */
function rotationOptions(raw: Any | null, current?: string): [string, string][] {
  if (!raw) return [];
  const info = api.skillInfo(api.newHero(raw));
  const unlocked: Any[] = info.skills.slice(0, info.unlocked);
  const opts: [string, string][] = [["Basic", "Basic (0 AP)"], ...unlocked.map((u): [string, string] => [u.name, `${skillName(u.name)} (${u.ap} AP)`])];
  if (current && current !== "Basic" && !unlocked.some((u) => u.name === current)) {
    const ap = info.skills.find((x: Any) => x.name === current)?.ap ?? skillAp(current) ?? "?";
    opts.push([current, `${skillName(current)} (${ap} AP)`]);
  }
  return opts;
}

/** The rotation and passive a hero (save index) plays: its edited one, else its save's. */
function rotationOf(idx: number): SkillChoice {
  const raw = state.sv!.raw.hero[idx];
  const h = api.newHero(raw);
  return { attackList: state.skills[idx]?.attackList ?? h.attackList.slice(1, 6), passive: state.skills[idx]?.passive ?? h.passiveSelect };
}

/**
 * U40: a hero's AP budget (what each skill costs it, its limit) with its passive (`passive`, else the one it plays
 * now): a passive can give AP (Wisdom).
 */
function apBudgetOf(idx: number, passive = rotationOf(idx).passive): ApBudget {
  const h = api.newHero(state.sv!.raw.hero[idx]);
  if (passive && passive !== h.passiveSelect) {
    h.passiveSelect = passive;
    h.determineStats();
  }
  const info = api.skillInfo(h);
  const apOf: Record<string, number> = Object.fromEntries(info.skills.map((x: Any) => [x.name, x.ap]));
  return { cost: (s) => apOf[s] ?? skillAp(s) ?? 0, max: info.maxAP ?? 0 };
}
/** U40: a hero's AP use and limit when its rotation is over the limit, else null. */
function apOver(idx: number): { used: number; max: number } | null {
  const b = apBudgetOf(idx), used = apUsed(rotationOf(idx).attackList, b);
  return used > b.max ? { used, max: b.max } : null;
}
/**
 * U40: the party's heroes over their AP limit (an old saved party): the game would play their default rotation, so the
 * flow shows this instead of a fight, as the Party tab warns on the card.
 */
function apProblem(): string | null {
  const over = partyOf().members.map((m) => ({ name: String(m.raw.name), o: apOver(m.idx) })).filter((x) => x.o);
  return over.length ? `${over.map((x) => `${x.name}: ${x.o!.used} / ${x.o!.max} AP`).join(", ")}: over the AP limit, so the game would `
    + "play the default rotation instead. Lower it in the Party tab." : null;
}
/** U40: an edit refused for AP: the toast, then the views drawn again from the unchanged state. */
function refuseAp(idx: number, r: { used?: number; max?: number }, focus?: () => void): void {
  toast(apRefusal(String(state.sv!.raw.hero[idx].name), r.used ?? 0, r.max ?? 0));
  renderParty(false);
  focus?.();
}

/**
 * Passive, then rotation, as the wiki / save viewer's ability rows (U22): the whole row opens the wiki page, the AP
 * as apBadge, the "x / y AP" budget beside the label; each row edits in place with its ⇄ control. An empty slot
 * (`raw` null) shows the same skeleton, greyed, so every slot has the same size.
 */
function abilityBlock(idx: number | null, raw: Any | null, key: string): HTMLElement[] {
  const hero = raw ? api.newHero(raw) : null;
  const info = hero ? api.skillInfo(hero) : null;
  const apOf: Record<string, number> = Object.fromEntries((info?.skills ?? []).map((x: Any) => [x.name, x.ap]));
  const rot: string[] = idx !== null && hero ? state.skills[idx]?.attackList ?? hero.attackList.slice(1, 6) : ["", "", "", "", ""];
  const passive: string = idx !== null && hero ? state.skills[idx]?.passive ?? hero.passiveSelect : "";
  const edit = (attackList: string[], p: string) => {
    state.skills[idx!] = { attackList, passive: p };
  };

  // Passive row: name, bonus, ⇄.
  const pLink = raw ? passiveLink(passive || "None") : el("span", { class: "muted" }, "—");
  const pRow = el("tr", {}, el("td", { class: "name" }, pLink),
    el("td", { class: "eff" }, raw ? (passive && passive !== "None" ? passiveText(passive) : "no passive") : ""),
    el("td", { class: "swap-col", "data-focus": `${key}-p` }, raw && info
      ? swapControl(`${raw.name}: passive`, info.passives.map((x: string): [string, string] => [x, passiveName(x)]), passive, (v) => {
        // U40: a passive that gives AP (Wisdom) can't be dropped when the rotation then goes over the limit.
        const b = apBudgetOf(idx!, v), used = apUsed(rot, b);
        if (used > b.max && b.max < apBudgetOf(idx!, passive).max) return refuseAp(idx!, { used, max: b.max });
        edit([...rot], v);
        afterEdit(`${key}-p`);
      }) : swapPlaceholder()));
  if (raw) clickableRow(pRow, pLink);

  // Rotation rows: turn, skill, AP, ⇄.
  const rows = rot.map((sk, k) => {
    const link = raw ? (sk === "Basic" ? el("span", {}, "Basic") : skillLink(sk)) : el("span", { class: "muted" }, "—");
    const opts = rotationOptions(raw, sk);
    const tr = el("tr", {}, el("td", { class: "n" }, String(k + 1)), el("td", { class: "name" }, link),
      el("td", { class: "ap-col" }, raw ? apBadge(sk === "Basic" ? 0 : apOf[sk] ?? skillAp(sk)) : el("span", { class: "ap-badge off", "aria-hidden": "true" }, "–")),
      el("td", { class: "swap-col", "data-focus": `${key}-${k}` }, raw ? swapControl(`${raw.name}: turn ${k + 1} skill`, opts, sk, (v) => {
        // U39: the same edit as the Flow tab's skill ▾ (battle-edit.ts); U40: refused over the AP limit.
        const r = editRotationSkill(state, idx!, k, v, { attackList: rot, passive }, apBudgetOf(idx!));
        if (!r.ok) return refuseAp(idx!, r, () => document.querySelector<HTMLElement>(`[data-focus="${key}-${k}"] select`)?.focus());
        afterEdit(`${key}-${k}`);
      }) : swapPlaceholder()));
    if (raw) clickableRow(tr, link);
    return tr;
  });

  // "14 / 20 AP"; over budget the game plays the default rotation (Hero.calculateAPRemainder).
  const used = rot.reduce((a, n) => a + (n && n !== "Basic" ? apOf[n] ?? skillAp(n) ?? 0 : 0), 0);
  // U40: the limit with the passive it plays (Wisdom gives AP).
  const max = idx !== null && info ? apBudgetOf(idx, passive).max : info?.maxAP ?? 0;
  const over = info !== null && used > max;
  const apTitle = info ? `${used} of ${max} action points used${over ? `: ${used - max} over budget, the game plays the default rotation instead` : `, ${max - used} remaining`}` : "";
  const ap = info
    ? el("span", { class: `ap-mini${over ? " over" : ""}`, title: apTitle, role: "img", "aria-label": apTitle }, over ? "⚠ " : "", el("strong", {}, String(used)), ` / ${max} AP`)
    : el("span", { class: "ap-mini off", "aria-hidden": "true" }, "– / – AP");
  return [
    el("div", { class: "ab-block" }, el("p", { class: "section-label" }, "Passive"),
      el("table", { class: "ability-rows slot-rows passive-rows", "aria-label": "Passive" }, el("tbody", {}, pRow))),
    el("div", { class: "ab-block" }, el("div", { class: "rot-head" }, el("p", { class: "section-label" }, "Rotation"), ap),
      el("table", { class: "ability-rows slot-rows skill-rows", "aria-label": "Rotation, turns 1 to 5" }, el("tbody", {}, ...rows))),
  ];
}

/**
 * A hero's combat stats as a compact two-line table (labels, values); dashes for an empty slot. The columns size to
 * their values (style.css), so four-digit values ("1,183") stay whole and apart; from five digits a value is
 * shortened ("12.3K") with the full one in its tooltip.
 */
function statStrip(raw: Any | null): HTMLElement {
  const st: Any = raw ? api.heroStats(api.newHero(raw)) : {};
  const cell = (k: string, label: string) => {
    if (!raw) return el("td", {}, "–");
    const v = Number(st[k] ?? 0);
    return Math.abs(v) >= 10_000 ? el("td", { title: `${label} ${fmt.format(v)}` }, fmtCompact.format(v)) : el("td", {}, fmt.format(v));
  };
  return el("table", { class: "stat-strip" }, el("thead", {}, el("tr", {}, ...CARD_STATS.map(([, l]) => el("th", { scope: "col" }, l)))),
    el("tbody", {}, el("tr", {}, ...CARD_STATS.map(([k, l]) => cell(k, l)))));
}

/**
 * U36: which filled slots fight. A hero ticked out on its card stays in its slot; over the opponent's size cap the
 * first ones in the game's slot order are kept (the required slot first) and the rest are left out automatically.
 */
function fighting(): { included: Set<string>; capped: SlotRef[] } {
  const filled: SlotRef[] = SLOTS.filter(([r, i]) => state.slots[slotKey(r, i)] !== null && state.slots[slotKey(r, i)] !== undefined)
    .map(([row, i]) => ({ key: slotKey(row, i), row, i }));
  const excluded = new Set(Object.keys(state.excluded).filter((k) => state.excluded[k]));
  const r = includedSlots(filled, excluded, rulesOf(pageTarget()));
  return { included: new Set(r.included.map((s) => s.key)), capped: r.capped };
}

/** The six slots, back row (left) and front row (right), every slot the same size, filled or not. On the Solver,
 * which chooses the party, empty slots are "to be found" and a filled slot can be locked: the next solve keeps its hero. */
function renderParty(refreshSearch = true): void {
  const sv = state.sv!;
  const picks = !state.mode.party;
  // Party setup rules of the opponent (battle-rules.ts): required slot, solo quests, party size cap.
  const rules = rulesOf(pageTarget());
  // U36: heroes ticked out on their card stay in the slot without fighting; the size cap counts the others.
  const fight = fighting();
  const filled = SLOTS.filter(([r, i]) => {
    const k = slotKey(r, i);
    return state.slots[k] !== null && state.slots[k] !== undefined && !state.excluded[k];
  }).length;
  const options: [string, string][] = [["", picks ? "— to be found —" : "— empty —"], ...sv.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
  const slot = (row: "front" | "back", i: number) => {
    const key = slotKey(row, i);
    const s = select({ "aria-label": `${row} row slot ${i + 1}` }, options);
    s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
    const idx = state.slots[key] ?? null;
    const raw = heroRaw(idx);
    s.addEventListener("change", () => {
      // U39: the same edit as the Flow tab's (battle-edit.ts): one slot per hero, the new hero fights, and in a search
      // mode a hero picked by hand is locked. U40: not a hero whose rotation is over its AP limit.
      const pick = s.value === "" ? null : Number(s.value);
      const r = assignHeroChecked(state, key, pick, picks, pick === null ? null : apOver(pick));
      if (!r.ok) return refuseAp(pick!, r);
      clearUndo = null;
      persistParty();
      renderParty();
    });
    const lock = picks && raw ? (() => {
      const on = Boolean(state.locked[key]);
      const b = el("button", { type: "button", class: `lock${on ? " on" : ""}`, "aria-pressed": String(on),
        title: on ? "Locked: the next solve keeps this hero (click to let it change)" : "Not locked: the next solve may replace this hero (click to keep it)" }, on ? "🔒" : "🔓");
      b.setAttribute("aria-label", `Keep ${raw.name} in the party`);
      b.addEventListener("click", () => {
        if (on) delete state.locked[key];
        else state.locked[key] = true;
        persistParty();
        renderParty();
      });
      return b;
    })() : null;
    // U36: the include box, top right: unticked, the hero stays in the slot but doesn't fight. Over the size cap the
    // last ones (game slot order) are left out automatically: their box is unticked and disabled.
    const capped = raw ? fight.capped.some((c) => c.key === key) : false;
    const out = raw ? Boolean(state.excluded[key]) || capped : false;
    const include = raw ? (() => {
      const c = el("input", { type: "checkbox", class: "include-box" }) as HTMLInputElement;
      c.checked = !out;
      c.disabled = capped;
      const what = capped ? `${raw.name} is left out: this quest takes at most ${rules.maxSize} hero${rules.maxSize === 1 ? "" : "es"} (untick another hero to bring this one in)`
        : out ? `${raw.name} stays in the slot but doesn't fight (tick to include)` : `${raw.name} fights (untick to leave out without emptying the slot)`;
      c.setAttribute("aria-label", `Include ${raw.name} in the battle`);
      c.addEventListener("change", () => {
        if (c.checked) delete state.excluded[key];
        else state.excluded[key] = true;
        persistParty();
        renderParty();
        document.querySelector<HTMLInputElement>(`[data-include="${key}"] input`)?.focus();
      });
      return el("label", { class: `include${capped ? " capped" : ""}`, title: what, "data-include": key }, c, el("span", { class: "visually-hidden" }, "Include"));
    })() : null;
    // Rules: the required slot is flagged; an empty slot the opponent doesn't allow (solo quest, party full) is disabled.
    const required = rules.required.some((x) => x.row === row && x.i === i);
    const soloOff = rules.kind === "solo" && !required;
    const off = !raw && (soloOff || (rules.kind !== "solo" && filled >= rules.maxSize));
    if (off) s.disabled = true;
    const offText = soloOff ? "solo: Front 1 only" : `at most ${rules.maxSize} heroes`;
    const head = el("div", { class: "slot-head" }, el("span", { class: "slot-name" },
      raw ? withAsc(el("span", { class: "avatar" }, String(raw.name).slice(0, 1).toUpperCase()), heroAsc(raw.prestigeLevel), String(raw.name))
        : el("span", { class: "avatar off", "aria-hidden": "true" }, "?"),
      `${row === "front" ? "Front" : "Back"} ${i + 1}`,
      raw ? pill(`${className(raw.class)} · ${raw.level}`) : pill(off ? offText : picks ? "to be found" : "empty", "plain"),
      ...(out ? [el("span", { class: "pill plain out-badge" }, capped ? "over the limit" : "left out")] : []),
      ...(required ? [el("span", { class: "pill t-orange req-badge", title: rules.kind === "solo" ? "A solo quest takes one hero, here" : "A party quest always fills this slot (it can be swapped, never emptied)" }, "required")] : [])),
    el("span", { class: "slot-tools" }, ...(lock ? [lock] : []), ...(include ? [include] : [])));
    return el("div", { class: `${raw ? `slot b3-slot filled cls-${raw.class}${state.locked[key] && picks ? " locked" : ""}` : "slot b3-slot empty"}${required ? " required" : ""}${off ? " off-limits" : ""}${out ? " excluded" : ""}` },
      head, s, statStrip(raw), ...abilityBlock(raw ? idx : null, raw, key));
  };
  // R1 F20: what the rows mean is in the heading's tooltip, not a line under it.
  const cols = (["back", "front"] as const).map((row) => el("div", { class: "party-row" },
    el("h3", { title: row === "front" ? "Enemies hit the front row while anyone stands in it." : "Safe until the front row falls." },
      row === "front" ? "🛡️ Front row" : "🏹 Back row"),
    el("div", { class: "slots" }, ...[0, 1, 2].map((i) => slot(row, i)))));
  // U32: "Clear all" empties the six slots, with the same undo as a search's Load.
  const clear = el("button", { type: "button", class: "secondary clear-all" }, "🧹 Clear all");
  clear.title = "Empty every hero slot (the edited rotations are kept)";
  if (!Object.values(state.slots).some((v) => v !== null && v !== undefined)) clear.setAttribute("disabled", "");
  clear.addEventListener("click", clearAll);
  $("#party").replaceChildren(...(picks ? [el("p", { class: "muted small party-note" },
    "The setup you showed. Edit it freely; 🔒 keeps a hero in the next solve.")] : []),
  el("div", { class: "toolbar party-tools" }, clear, ...(clearUndo ? [clearUndo] : [])),
  ...(rulesText(rules) ? [el("p", { class: "muted small party-rules" }, rulesText(rules))] : []),
  // U36: the heroes left out over the size cap.
  ...(fight.capped.length ? [el("p", { class: "small party-capped", role: "status", title: "The last ones in slot order are left out. Untick another hero to bring one in." },
    `ℹ️ At most ${rules.maxSize}: ${fight.capped.map((c) => heroRaw(state.slots[c.key] ?? null)?.name ?? c.key).join(", ")} left out.`)] : []),
  // What keeps this party from fighting (shown before Simulate, not as a worker error). The modes that pick the
  // party fill the slots themselves.
  ...((p) => (p && !picks ? [el("p", { class: "error small party-problem", role: "status" }, `⚠ ${p}`)] : []))(partyProblem()),
  el("div", { class: "party-cols" }, ...cols));
  syncAmount();
  renderPlan();
  // Not after a search filled the slots: rebuilding the search panel would reset its form.
  if (refreshSearch) search?.refresh();
}

/** The opponent for the party rules, or null while the opponent card isn't built yet. */
function pageTarget(): PageTarget | null {
  if (oppKind() !== "quest") return document.querySelector("#map") ? { map: targetOf().map!.spec } : null;
  const q = document.querySelector<HTMLSelectElement>("#quest");
  return q ? { quest: { id: Number(q.value), rare: document.querySelector<HTMLInputElement>("#rare")?.checked ?? false } } : null;
}
/** Why the six slots can't fight the opponent (battle-rules.ts), or null. */
function partyProblem(front?: (unknown | null)[], back?: (unknown | null)[]): string | null {
  // U33 fix: the slots hold hero indices and the engine's check reads an empty slot as falsy, so hero 0 (the save's
  // first hero) looked missing; each filled slot is passed as an object.
  const inc = fighting().included;
  const key = (row: "front" | "back") => [0, 1, 2].map((i) => {
    const v = state.slots[slotKey(row, i)];
    return v === null || v === undefined || !inc.has(slotKey(row, i)) ? null : { hero: v };
  });
  return problemOf(pageTarget(), front ?? key("front"), back ?? key("back"));
}

/** The "Put back the previous party" button after Clear all (until it is used or the slots change by hand). */
let clearUndo: HTMLElement | null = null;
function clearAll(): void {
  const prev = { slots: { ...state.slots }, locked: { ...state.locked }, excluded: { ...state.excluded } };
  state.slots = {};
  state.locked = {};
  state.excluded = {};
  const b = el("button", { type: "button", class: "secondary" }, "↩ Put back the previous party");
  b.addEventListener("click", () => {
    state.slots = prev.slots;
    state.locked = prev.locked;
    state.excluded = prev.excluded;
    clearUndo = null;
    persistParty();
    renderParty();
    document.querySelector<HTMLElement>("#party .clear-all")?.focus();
  });
  clearUndo = b;
  persistParty();
  renderParty();
  clearUndo.focus();
}

// ---------------------------------------------------------------- target
let search: ReturnType<typeof initSearch> | null = null;
const oppKind = (): Opp => ($<HTMLInputElement>("input[name=opp]:checked")?.value ?? "quest") as Opp;

/**
 * U36: the chosen opponent (quest or map, size, rare, map grade, ascension, scrolls), remembered in this browser across
 * pages (localStorage `battle-opponent`, convenience only) and put back when the page is built again. U41: the Solver
 * remembers its own (`solver-opponent`), starting from the Simulator's.
 */
const OPP_KEY = "battle-opponent";
const SOLVER_OPP_KEY = "solver-opponent";
const oppKey = () => (solving() ? SOLVER_OPP_KEY : OPP_KEY);
interface OppChoice { kind?: Opp; quest?: string; rare?: boolean; amount?: string; map?: string; asc?: string; grade?: string; scrolls?: string[] }
/** False while onExpansions puts a choice back (the intermediate states are not remembered). */
let saving = true;
function saveOpponent(): void {
  if (!saving) return;
  try {
    localStorage.setItem(oppKey(), JSON.stringify(currentOpponent()));
  } catch { /* storage blocked: not remembered */ }
}
/** The opponent as the controls show it, or what was remembered when they aren't built yet. */
function currentOpponent(): OppChoice {
  const v = (sel: string) => document.querySelector<HTMLSelectElement>(sel)?.value;
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.scroll")].map((s) => s.value);
  const kind = oppKind();
  // The other kind's choice stays as it was remembered.
  const was = storedOpponent();
  return kind === "quest"
    ? { ...was, kind, quest: v("#quest"), rare: document.querySelector<HTMLInputElement>("#rare")?.checked ?? false, amount: v("#amount") }
    : { ...was, kind, map: v("#map"), asc: v("#map-asc"), grade: v("#map-grade"), scrolls };
}
function storedOpponent(key = oppKey()): OppChoice {
  try {
    const o = JSON.parse(localStorage.getItem(key) ?? "null");
    if (o && typeof o === "object") return o;
    // The Solver's first visit: the Simulator's opponent.
    return key === SOLVER_OPP_KEY ? storedOpponent(OPP_KEY) : {};
  } catch {
    return {};
  }
}

/** Set while the page redraws for another language: the search panel keeps its form (U29). */
let keepSearchForm = false;

function renderTarget(): void {
  queueMicrotask(() => {
    if (!keepSearchForm) search?.refresh();
  });
  const box = $("#target");
  if (oppKind() === "quest") {
    const q = select({ id: "quest", "aria-label": "Enemy" }, questOptions());
    const rare = el("input", { type: "checkbox", id: "rare" }) as HTMLInputElement;
    const amount = select({ id: "amount", "aria-label": "Quest size" }, [["1", "×1"]]);
    // R1 F20: the quest size's explanation is in a "?" (syncAmount fills it), not a paragraph.
    const sizeNote = el("span", { id: "amount-note" });
    const card = el("article", { class: "opp-card" });
    const update = () => {
      const d = G.questData[q.value];
      const hasRare = d.enemyHpB !== undefined && d.attackListB !== undefined;
      rare.disabled = !hasRare;
      if (!hasRare) rare.checked = false;
      syncAmount();
      const r = rare.checked;
      // U39: HP as text (it follows the quest size: one enemy with N× HP); the radar's other axes share one rim, this
      // enemy's highest stat, and Eva has its own, 200.
      const n = Number(amount.value) || 1;
      const rd = enemyRadar(d, r, n);
      const common = rd.axes.find((a) => a.key !== "enemyEva")?.max ?? 0;
      const axes: RadarAxis[] = rd.axes.map((a) => ({ label: a.label, value: a.value, max: a.max,
        rim: a.key === "enemyEva" ? `the scale (${fmt.format(EVA_RIM)}: 200 or more sits on the rim)` : `the scale (${fmt.format(common)}: its highest stat)` }));
      const hpText = el("p", { class: "opp-hp" }, el("span", { class: "muted small" }, "HP "), el("strong", {}, fmt.format(rd.hp)),
        ...(n > 1 ? [el("span", { class: "muted small" }, ` (${fmt.format(rd.baseHp)} ×${n}, quest size)`)] : []));
      card.className = `opp-card${r ? " rare" : ""}`;
      card.replaceChildren(
        el("header", {}, el("span", { class: "opp-ico", "aria-hidden": "true" }, "👹"),
          el("div", {}, el("h3", {}, enemyLink({ id: Number(q.value), rare: r })),
            el("div", { class: "pills" }, pill(`level ${enemyLevelText(Number(q.value))}`, "plain"), ...(r ? [pill("rare", "t-pink")] : []),
              ...(d.questType === 6 ? [pill("attacks first", "t-orange")] : []),
              // R1 F20: the radar's scale in a "?", not a caption.
              helpTip(`The radar's scale: Atk, Matk, Def and Mdef share one rim, this enemy's highest of the four (${fmt.format(common)}), `
                + `so the shape shows what it is strong at. Eva's rim is ${EVA_RIM}: ${EVA_RIM} or more sits on the rim.`, "the stats radar")))),
        hpText,
        radar(axes, { title: `${enemyName(q.value, r)}'s stats`, size: 240 }),
        // U36: the turns are in the plan (U39: the Flow tab); the plain rotation only without timeline data.
        ...(timelineOf(Number(q.value), r) ? [] : [el("h4", {}, "Skills"),
          el("ol", { class: "rotation compact" }, ...seq<string>((r ? d.attackListB : d.attackList) ?? {}).map((sk) => el("li", {}, skillLink(sk))))]));
      saveOpponent();
    };
    // Another enemy may have other party rules (required slot, size cap): the slots are drawn again.
    q.addEventListener("change", () => (update(), renderParty()));
    rare.addEventListener("change", () => (update(), renderParty(false)));
    // The radar's HP follows the quest size.
    amount.addEventListener("change", () => (update(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, q,
      el("div", { class: "toolbar" }, el("label", { class: "check" }, rare, " Rare variant"),
        el("label", { class: "check nowrap" }, el("span", { class: "muted small" }, "Quest size"), amount), sizeNote)), card);
    update();
    setRuns("200");
  } else {
    const m = select({ id: "map", "aria-label": "Map" }, mapOptions(state.sv));
    const asc = select({ id: "map-asc", "aria-label": "Map ascension" }, [["0", "No ascension"], ["1", "Ascension 1"]]);
    const grade = select({ id: "map-grade", "aria-label": "Map grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
    grade.value = "3";
    const scrollOpts: [string, string][] = [["", "— no scroll —"], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id] && isVisible("consumable", id))
      .map((id): [string, string] => [String(id), `${itemName("consumable", id)}${expansionMark(needsOf("consumable", id))}`])];
    const scrolls = [0, 1, 2].map((k) => select({ class: "scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
    const card = el("article", { class: "opp-card map" });
    const sync = () => {
      const own = m.value.startsWith("own:");
      asc.hidden = grade.hidden = own;
      const it: Any = own ? state.sv?.mapInventory[Number(m.value.slice(4))] : null;
      const id = own ? Number(it?.id) : Number(m.value.slice(4));
      const d: Any = G.itemData.map?.[id] ?? {};
      const a = own ? it?.prestigeLevel : Number(asc.value), g = own ? (it?.grade ?? 3) : Number(grade.value);
      const pre = own && it?.prefix ? prefixName(it.prefix) : "", suf = own && it?.suffix > 0 ? suffixName(it.suffix) : "";
      // Plain catalog map: no label, so the link shows (and keeps in step) the map's name in the visitor's language. A
      // modded map (U34 / U36): "[Prefix] Map +N" from its translated parts (modItemName).
      const name = pre || suf ? modItemName("map", id, it) : undefined;
      const bosses = seq<number>(d.bossList ?? {});
      const fact = (k: string, v: Node | string) => [el("dt", {}, k), el("dd", {}, v)];
      card.replaceChildren(
        el("header", {}, el("span", { class: "opp-ico", "aria-hidden": "true" }, "🗺️"),
          el("div", {}, el("h3", {}, itemLink("map", id, name, undefined, a, { always: own })),
            el("div", { class: "pills" }, pill(`level ${d.itemLevel ?? "?"}`, "plain"), gradeBadge(GRADES[g - 1] ?? String(g)),
              ...(own ? [pill("yours", "t-green")] : []),
              // R1 F20: what a run is, in a "?" instead of a paragraph under the card.
              helpTip("Each run uses a new layout (rooms, enemies, rare spawns, boss); hero HP carries over between rooms. "
                + "Rooms and time are the map's own, before its prefix and suffix.", "map runs")))),
        el("dl", { class: "facts" },
          ...fact("Rooms", roomsFact(id, g)),
          ...fact("Time", d.baseMapTime ? duration(d.baseMapTime) : "?"),
          ...fact("Enemy power", `×${d.enemyMod ?? 1}`),
          ...fact(bosses.length > 1 ? "Bosses" : "Boss", bosses.length
            ? el("span", {}, ...bosses.flatMap((b, k) => [...(k ? [", "] : []), enemyLink({ id: b })])) : "none"),
          ...(pre || suf ? fact("Modifiers", [pre && `prefix ${pre}`, suf && `suffix ${suf}`].filter(Boolean).join(" · ")) : [])),
        el("div", { class: "opp-scrolls" },
          el("h4", {}, "Scrolls"), ...scrolls));
      saveOpponent();
    };
    // U39: the Flow tab follows the map, its ascension, grade and scrolls (one traced run).
    m.addEventListener("change", () => (sync(), renderPlan()));
    asc.addEventListener("change", () => (sync(), renderPlan()));
    grade.addEventListener("change", () => (sync(), renderPlan()));
    for (const x of scrolls) x.addEventListener("change", () => (saveOpponent(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, m, el("div", { class: "toolbar" }, asc, grade)), card);
    sync();
    setRuns("50");
  }
  // The party rules follow the opponent (renderParty also draws the plan); the search panel is refreshed above.
  renderParty(false);
}

/**
 * R1 F29: the map card's rooms, counted as the results count them: the rooms at this grade (boss included, ±1 by
 * grade) plus the treasure rooms expected per run ("9 + 0.9 treasure"), the tooltip saying what is counted.
 */
function roomsFact(id: number, grade: number): HTMLElement {
  let rooms: number, treasure = 0;
  try {
    rooms = mapRooms(id, grade);
    treasure = mapTreasure(id, grade)?.perRun ?? 0;
  } catch {
    return el("span", {}, "?");
  }
  const t = treasure >= 0.05 ? ` + ${fmt1.format(treasure)} treasure` : "";
  return el("span", { title: `${rooms} rooms at grade ${GRADES[grade - 1] ?? grade}, the boss included${t ? `, and ${fmt1.format(treasure)} treasure room${treasure === 1 ? "" : "s"} per run on average` : ""}. `
    + "The results count every room a run meets (treasure rooms and boss included), so their average can differ a little." }, `${rooms}${t}`);
}

/**
 * The quest sizes the game offers (questService.getCurrentAndMaxAmount): ×1 up to maxQuestAmount, from the highest
 * hero prestige of the party; a rare quest is always ×1. The modes that pick the party allow up to the strongest hero
 * of the save (searchParty / optimiseFight skip parties that can't take the size). Keeps the current choice when allowed.
 */
function syncAmount(): void {
  const amount = document.querySelector<HTMLSelectElement>("#amount");
  const note = document.querySelector<HTMLElement>("#amount-note");
  if (!amount || !state.sv) return;
  const rare = document.querySelector<HTMLInputElement>("#rare")?.checked ?? false;
  // Modes that choose the party: up to the strongest hero of the save (the search skips parties that can't take it).
  const max = maxQuestAmount(state.mode.party ? partyOf().members.map((m) => m.raw) : state.sv.raw.hero, rare, state.sv.raw.gameMode || "Standard");
  const was = Number(amount.value) || 1;
  amount.replaceChildren(...Array.from({ length: max }, (_, k) => el("option", { value: String(k + 1) }, `×${k + 1}`)));
  amount.value = String(Math.min(was, max));
  amount.disabled = max === 1;
  const n = Number(amount.value);
  // R1 F20 / F36: the explanation in a "?"; the cap only once the party has heroes (before, it depends on them).
  if (note) {
    const what = `Quest size ×${n}: one enemy with ${n > 1 ? `${n}× HP, ${n}× loot and ${n}× quest time` : "its normal HP"}.`;
    const heroes = state.mode.party ? partyOf().members.length : state.sv.raw.hero.length;
    const cap = rare ? "A rare quest is always ×1."
      : !heroes ? "The largest size depends on your heroes' ascension tier."
      : !state.mode.party ? `Up to ×${max} with your strongest hero; parties that can't take this size are skipped.`
      : `Up to ×${max} for this party: its highest hero ascension sets the cap.`;
    note.replaceChildren(helpTip([what, cap], "the quest size"));
  }
}

// ---------------------------------------------------------------- the two views: Party and Flow (U39, U40)
/**
 * Step 3 has two tabs over one party state: Party (the hero cards and the opponent; first, U40) and Flow (the fight,
 * turn by turn). Edits in either change the same state (battle-edit.ts), then both redraw and the flow is simulated
 * again. The active tab is remembered for this browser tab (sessionStorage `battle-tab`; convenience only); without
 * one, the first tab, Party.
 */
type Tab = "flow" | "party";
const TAB_KEY = "battle-tab";
let tabChoice: Tab | null = null;
function storedTab(): Tab {
  if (tabChoice) return tabChoice;
  try {
    return sessionStorage.getItem(TAB_KEY) === "flow" ? "flow" : "party";
  } catch {
    return "party";
  }
}
function showTab(tab: Tab, remember = true): void {
  if (remember) {
    tabChoice = tab;
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch { /* not remembered: it holds until the page is left */ }
  }
  document.querySelectorAll<HTMLButtonElement>(".b3-tabs [role=tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $("#flow-panel").hidden = tab !== "flow";
  $("#setup-grid").hidden = tab !== "party";
}
function initTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".b3-tabs [role=tab]")];
  for (const b of tabs) {
    b.addEventListener("click", () => showTab(b.dataset.tab as Tab));
    // The arrow keys move between the tabs (the tablist pattern).
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const next = tabs[(tabs.indexOf(b) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      showTab(next.dataset.tab as Tab);
      next.focus();
      e.preventDefault();
    });
  }
  showTab(storedTab(), false);
}

/** The party's heroes as the engine takes them (edited rotations applied), for a traced fight or map run. */
function engineParty(sim: Sim): [Any[], Any[]] {
  const { front, back, skills } = partyOf();
  const build = (raws: (Any | null)[], sk: (SkillChoice | null)[]) => raws.map((raw, i) => {
    if (!raw) return null;
    const h = sim.hero(raw);
    if (sk[i]) sim.setSkills(h, sk[i]!.attackList, sk[i]!.passive);
    return h;
  });
  return [build(front, skills.front), build(back, skills.back)];
}

/**
 * U39: Simulate's first fight of this party against the quest (same seed, so the same rolls: hits, crits, misses),
 * traced action by action (tools/fight-trace.ts); null when the party can't fight it (a rule, or an engine error).
 */
function planTrace(t: { id: number; rare: boolean; amount: number }): FightTrace | null {
  if (partyProblem() || apProblem()) return null;
  try {
    const sim = new Sim(state.sv!.raw.gameMode || "Standard");
    const [front, back] = engineParty(sim);
    return traceFight(sim, t.id, front, back, { rare: t.rare, amount: t.amount });
  } catch {
    return null;
  }
}

/** The Map run mode's first run of this party (same seed: same layout and rolls), every room traced; null when it can't run. */
function mapTrace(m: { spec: MapSpec; scrolls: Scroll[] }): MapRoomTrace[] | string {
  try {
    const sim = new Sim(state.sv!.raw.gameMode || "Standard");
    const [front, back] = engineParty(sim);
    return traceMapRun(sim, m.spec, front, back, { scrolls: m.scrolls.length ? m.scrolls : null });
  } catch (e) {
    return String((e as Error)?.message ?? e).split("\n")[0];
  }
}

/** The room shown in the flow of a map run, remembered while the same map stays chosen (sessionStorage). */
const ROOM_KEY = "battle-flow-room";
const mapKey = () => [document.querySelector<HTMLSelectElement>("#map")?.value, document.querySelector<HTMLSelectElement>("#map-asc")?.value,
  document.querySelector<HTMLSelectElement>("#map-grade")?.value].join("|");
let roomChoice: { map: string; room: number } | null = null;
function storedRoom(): number {
  let r = roomChoice;
  if (!r) {
    try {
      r = JSON.parse(sessionStorage.getItem(ROOM_KEY) ?? "null");
    } catch { /* none */ }
  }
  return r && r.map === mapKey() && Number.isInteger(r.room) ? r.room : 0;
}
function setRoom(room: number): void {
  roomChoice = { map: mapKey(), room };
  try {
    sessionStorage.setItem(ROOM_KEY, JSON.stringify(roomChoice));
  } catch { /* not remembered */ }
}

/** The flow's edits (the ▾ in its heads and in turns 1-5): the same edits as the Party tab's, then both redraw. */
function planEdit(): PlanEdit {
  const rules = rulesOf(pageTarget());
  const refocus = (key: string) => document.querySelector<HTMLElement>(`[data-flow-focus="${key}"] select`)?.focus();
  const idxAt = (loc: number) => state.slots[slotKeyOfLoc(loc)] ?? null;
  return {
    heroes: (loc) => {
      const key = slotKeyOfLoc(loc);
      // The party rules: the required slot (Front 2 on a party quest) is never emptied; swapping heroes keeps the size.
      const required = rules.required.some((x) => slotKey(x.row, x.i) === key);
      const options: [string, string][] = [...(required ? [] : [["", "— take out of the party —"] as [string, string]]),
        ...state.sv!.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
      return { options, value: String(idxAt(loc) ?? "") };
    },
    setHero: (loc, v) => {
      const pick = v === "" ? null : Number(v);
      const r = assignHeroChecked(state, slotKeyOfLoc(loc), pick, !state.mode.party, pick === null ? null : apOver(pick));
      if (!r.ok) return refuseAp(pick!, r, () => refocus(`hero-${loc}`));
      clearUndo = null;
      persistParty();
      renderParty();
      refocus(`hero-${loc}`);
    },
    skills: (loc) => {
      const idx = idxAt(loc);
      return idx === null ? null : rotationOptions(state.sv!.raw.hero[idx]);
    },
    setSkill: (loc, k, skill) => {
      const idx = idxAt(loc);
      if (idx === null) return;
      // U40: refused over the AP limit, as in the Party tab.
      const r = editRotationSkill(state, idx, k, skill, rotationOf(idx), apBudgetOf(idx));
      if (!r.ok) return refuseAp(idx, r, () => refocus(`skill-${loc}-${k + 1}`));
      persistParty();
      renderParty(false);
      refocus(`skill-${loc}-${k + 1}`);
    },
    // U40: the enemy column's head changes the opponent through the Party tab's own controls (one state).
    enemies: () => {
      if (oppKind() === "quest") {
        const q = document.querySelector<HTMLSelectElement>("#quest");
        if (!q) return null;
        const rare = document.querySelector<HTMLInputElement>("#rare")?.checked ?? false;
        return { label: "Enemy", groups: flowEnemyOptions(), value: `${q.value}${rare ? ":rare" : ""}` };
      }
      const m = document.querySelector<HTMLSelectElement>("#map");
      return m ? { label: "Map", groups: mapOptions(state.sv), value: m.value } : null;
    },
    setEnemy: (v) => {
      if (oppKind() === "quest") {
        const [id, variant] = v.split(":");
        const q = $<HTMLSelectElement>("#quest"), rare = $<HTMLInputElement>("#rare");
        if (q.value !== id) {
          q.value = id;
          q.dispatchEvent(new Event("change"));
        }
        if (!rare.disabled && rare.checked !== (variant === "rare")) {
          rare.checked = variant === "rare";
          rare.dispatchEvent(new Event("change"));
        }
      } else {
        const m = $<HTMLSelectElement>("#map");
        m.value = v;
        m.dispatchEvent(new Event("change"));
      }
      refocus("enemy");
    },
  };
}

/**
 * The flow's enemy choices (U40): the Party tab's enemy list (questOptions), each enemy with a rare variant listed a
 * second time as that variant ("<id>:rare"), since the flow has no "Rare variant" box.
 */
function flowEnemyOptions(): [string, [string, string][]][] {
  return questOptions().map(([g, list]) => [g, list.flatMap(([id, label]): [string, string][] => {
    const d = G.questData[id];
    const hasRare = d.enemyHpB !== undefined && d.attackListB !== undefined && d.nameB;
    const lv = `Lv ${enemyLevelText(Number(id))} · `, mark = expansionMark(needsOf("enemy", Number(id)));
    return hasRare ? [[id, `${lv}${enemyName(id)}${mark}`], [`${id}:rare`, `${lv}${enemyName(id, true)} (rare)${mark}`]] : [[id, label]];
  })]);
}

/** What the flow shows, and how (U39): one concrete run, Simulate's first. */
const FLOW_NOTE = "One concrete fight: the first of the Simulator's runs (same seed), so its hits, misses and critical hits are that run's rolls.";
const MAP_FLOW_NOTE = "One concrete run: the first of the Map run's runs (same seed), so its layout, rolls and the HP carried from room to room are that run's.";

/** The Flow tab: the opponent in one line, then the fight (a quest) or the room bar and a room's fight (a map run). */
function renderPlan(): void {
  const box = document.querySelector<HTMLElement>("#plan");
  if (!box || !state.sv) return;
  const opp = $("#flow-opp"), help = document.querySelector<HTMLElement>("#plan-help");
  box.replaceChildren();
  opp.replaceChildren();
  help?.replaceChildren();
  const members: PlanMember[] = partyOf().members.map((m) => ({
    row: m.row, i: m.i, name: String(m.raw.name), cls: Number(m.raw.class), rotation: rotationOf(m.idx).attackList,
  }));
  const toParty = el("button", { type: "button", class: "link-btn" }, "change");
  toParty.addEventListener("click", () => {
    showTab("party");
    document.querySelector<HTMLElement>("#tab-party")?.focus();
  });
  const problem = partyProblem();
  // U40: a hero over its AP limit (an old saved party): the warning, not a fight with the default rotation.
  const ap = problem ? null : apProblem();
  const edit = planEdit();
  if (oppKind() === "quest" && document.querySelector("#quest")) {
    const t = targetOf().quest!;
    opp.append(el("span", { class: "muted small" }, "vs "), enemyLink({ id: t.id, rare: t.rare }), t.amount > 1 ? ` ×${t.amount}` : "", " ", toParty);
    const trace = members.length ? planTrace(t) : null;
    const plan = partyPlan(t, members, trace, edit);
    if (plan) {
      box.append(...(trace ? [el("p", { class: "muted small flow-note" }, FLOW_NOTE)] : []),
        ...(problem && members.length ? [el("p", { class: "error small" }, `⚠ ${problem} The rotation as planned until then.`)] : []),
        ...(ap && members.length ? [el("p", { class: "error small flow-ap", role: "status" }, `⚠ ${ap} Below, the rotation as planned.`)] : []), plan);
      help?.append(helpTip(planNote(t), "the flow"));
    } else box.append(el("p", { class: "muted" }, "No timeline for this enemy yet."));
    return;
  }
  if (oppKind() !== "map" || !document.querySelector("#map")) return;
  const m = targetOf().map!;
  opp.append(el("span", { class: "muted small" }, "map run: "), el("strong", {}, $<HTMLSelectElement>("#map").selectedOptions[0]?.textContent ?? ""), " ", toParty);
  if (!members.length || problem || ap) {
    box.append(el("p", { class: problem || ap ? "error" : "muted" }, problem || ap ? `⚠ ${problem ?? ap}` : "Put heroes in the party (Party tab) to see the run."));
    return;
  }
  const rooms = mapTrace(m);
  if (typeof rooms === "string" || !rooms.length) {
    box.append(el("p", { class: "error" }, `This map run could not be simulated${typeof rooms === "string" ? `: ${rooms}` : ""}.`));
    return;
  }
  const tabs = mapRoomTabs(rooms, (id, rare) => enemyName(String(id), rare));
  let at = Math.min(storedRoom(), rooms.length - 1);
  const view = el("div", { class: "flow-room" });
  const bar = el("div", { class: "room-bar", role: "tablist", "aria-label": "The map's battles, in order" });
  const draw = () => {
    bar.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((b, k) => {
      b.setAttribute("aria-selected", String(k === at));
      b.tabIndex = k === at ? 0 : -1;
    });
    const r = rooms[at];
    // U40: after the room where the party died there is no battle: one centred line, no timeline.
    if (tabs[at].skipped) {
      view.replaceChildren(el("p", { class: "flow-skipped", role: "status" }, "💀 Party died, battle skipped"));
      help?.replaceChildren();
      return;
    }
    const plan = partyPlan({ id: r.questId, rare: r.isRare }, members, r.trace, edit);
    view.replaceChildren(...(r.trace ? [] : [el("p", { class: "muted small" }, "Not reached in this run: the rotation as planned.")]),
      plan ?? el("p", { class: "muted" }, "No timeline for this enemy yet."));
    help?.replaceChildren(helpTip(planNote({ id: r.questId, rare: r.isRare }), "the flow"));
  };
  tabs.forEach((x, k) => {
    const b = el("button", { type: "button", role: "tab", class: `room-tab st-${x.status}${x.boss ? " boss" : ""}`, "aria-selected": "false",
      title: `${x.label}: ${x.skipped ? "skipped, the party died before" : ["not reached in this run", "won", "lost"][x.status] ?? ""}` }, x.label,
      ...(x.status === 2 ? [el("span", { "aria-hidden": "true" }, " 💀")] : []));
    b.addEventListener("click", () => {
      at = k;
      setRoom(k);
      draw();
    });
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      at = (k + (e.key === "ArrowRight" ? 1 : rooms.length - 1)) % rooms.length;
      setRoom(at);
      draw();
      bar.querySelectorAll<HTMLButtonElement>("[role=tab]")[at]?.focus();
      e.preventDefault();
    });
    bar.append(b);
  });
  box.append(el("p", { class: "muted small flow-note" }, MAP_FLOW_NOTE), bar, view);
  draw();
}

// ---------------------------------------------------------------- the page's own parts (U41)
/** The Simulator's number of runs (a quest takes more than a map run); the Solver has none. */
function setRuns(v: string): void {
  const runs = document.querySelector<HTMLInputElement>("#runs");
  if (runs) runs.value = v;
}

/** Build the opponent and, on the Solver, its panel, once a save is in. */
function buildPage(): void {
  syncOppKinds();
  if (!state.sv) return;
  renderParty(false); // locks and "to be found" slots on the Solver
  // The opponent card: the remembered one, else a useful one (onExpansions).
  onExpansions();
  if (solving()) search?.show("party");
}

/**
 * U41, the Solver's step 3: the Party and Flow tabs show only once a result's Show has filled the party; before, no
 * party panel at all. It stays shown for later solves (its locks feed them) until the save is forgotten.
 */
function revealParty(): void {
  const box = document.querySelector<HTMLElement>("#party-box");
  if (!box) return;
  const was = box.hidden;
  box.hidden = false;
  showTab(storedTab(), false);
  renderParty(false);
  if (!was) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}
function hideParty(): void {
  const box = document.querySelector<HTMLElement>("#party-box");
  if (box) box.hidden = true;
}

/**
 * U41: the Solver's "Open in Simulator": the shown party (slots, rotations, heroes left out) and the opponent become
 * the Simulator's for this save (its edited rotations of other heroes stay), then the Simulator opens. The Solver's
 * edits change nothing else of the Simulator.
 */
function openInSimulator(): void {
  if (!state.sv) return;
  try {
    let was: Partial<StoredParty> | null = null;
    try {
      was = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    } catch { /* broken: replaced */ }
    const party = simulatorPartyFrom({ slots: state.slots, skills: state.skills, locked: state.locked, excluded: state.excluded }, was);
    localStorage.setItem(partyKey(), JSON.stringify(party));
    localStorage.setItem(OPP_KEY, JSON.stringify(currentOpponent()));
  } catch {
    toast("This browser blocks site storage, so the party can't be handed to the Simulator.");
    return;
  }
  location.href = SIMULATOR_PAGE;
}

// ---------------------------------------------------------------- run
/**
 * A run (Simulate or a search) started: bring the Results (step 2, right under the Run button) into view. On a wide
 * screen they usually already are, and nothing moves; on a phone, or when the heading is off screen, one smooth scroll
 * puts it at the top. Only here, at the start: progress updates and the result never scroll, so a user who scrolls
 * away stays where they went.
 */
function revealResults(): void {
  const box = document.querySelector<HTMLElement>("#results-box");
  if (!box) return;
  const top = box.getBoundingClientRect().top;
  const narrow = matchMedia("(max-width: 760px)").matches;
  // Wide: in view when the heading and the progress bar under it are on screen. Narrow: near the top, so the
  // results that replace the progress have the screen.
  const inView = top >= 0 && top <= (narrow ? innerHeight * 0.3 : innerHeight - 160);
  if (inView) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

/** The six slots as the worker takes them (raw save heroes, edited rotations), and who stands where. */
function partyOf() {
  const sv = state.sv!;
  const front: (Any | null)[] = [null, null, null], back: (Any | null)[] = [null, null, null];
  const skills = { front: [null, null, null] as (SkillChoice | null)[], back: [null, null, null] as (SkillChoice | null)[] };
  const members: PartyMember[] = [];
  // U36: only the heroes that fight (ticked in, within the size cap); the others stay in their slot.
  const inc = fighting().included;
  for (const [row, i] of SLOTS) {
    const idx = state.slots[slotKey(row, i)];
    if (idx === null || idx === undefined || !inc.has(slotKey(row, i))) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
    members.push({ row, i, idx, raw: sv.raw.hero[idx] });
  }
  return { front, back, skills, members };
}

/** The opponent chosen in step 3. */
function targetOf(): { quest?: { id: number; rare: boolean; amount: number }; map?: { spec: MapSpec; scrolls: Scroll[] } } {
  const sv = state.sv!;
  if (oppKind() === "quest") {
    return { quest: { id: Number($<HTMLSelectElement>("#quest").value), rare: $<HTMLInputElement>("#rare").checked, amount: Number($<HTMLSelectElement>("#amount").value) } };
  }
  const v = $<HTMLSelectElement>("#map").value;
  const spec: MapSpec = v.startsWith("own:") ? sv.raw.mapInventory.filter((c: unknown) => typeof c === "string")[Number(v.slice(4))]
    : { id: Number(v.slice(4)), prestigeLevel: Number($<HTMLSelectElement>("#map-asc").value), grade: Number($<HTMLSelectElement>("#map-grade").value) };
  const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.scroll")].map((s) => s.value).filter(Boolean)
    .map((id) => ({ id: Number(id), prestigeLevel: 0 }));
  return { map: { spec, scrolls } };
}

function request(): BattleRequest {
  const sv = state.sv!;
  const { front, back, skills, members } = partyOf();
  if (!members.length) throw new Error("Put at least one hero in the party.");
  const n = Math.max(1, Math.min(5000, Math.trunc(Number($<HTMLInputElement>("#runs").value) || 0)));
  return { gameMode: sv.raw.gameMode || "Standard", front, back, skills, n, ...targetOf() };
}

/**
 * What XP and time a result is about (U33), taken when the run starts (the page may change before it ends): the quest
 * (size, rare, party size and speed) or the map (id, grade, ascension, party size).
 */
type RunContext = { quest: QuestRunContext } | { map: MapRunContext };
function runContext(req: BattleRequest): RunContext {
  const members = partyOf().members;
  const mode = req.gameMode || "Standard";
  if (req.quest) {
    const speed = members.reduce((s, m) => s + (Number(api.heroStats(api.newHero(m.raw)).speed) || 0), 0);
    return { quest: { quest: req.quest.id, rare: req.quest.rare, amount: req.quest.amount, heroes: members.length, speed, mode } };
  }
  const v = $<HTMLSelectElement>("#map").value;
  const own: Any = v.startsWith("own:") ? state.sv?.mapInventory[Number(v.slice(4))] : null;
  return { map: own ? { map: Number(own.id), grade: own.grade ?? 3, asc: own.prestigeLevel ?? 0, heroes: members.length, mode }
    : { map: Number(v.slice(4)), grade: Number($<HTMLSelectElement>("#map-grade").value), asc: Number($<HTMLSelectElement>("#map-asc").value), heroes: members.length, mode } };
}

/** The last simulation shown (drawn again in another language, U29), with its run context. */
let lastResult: (Extract<BattleResponse, { ok: true }> & { ctx: RunContext | null }) | null = null;
function drawResult(): void {
  const r = lastResult;
  if (!r) return;
  $("#results").replaceChildren(...(r.kind === "quest"
    ? questResults(r.result, r.ms, r.ctx && "quest" in r.ctx ? r.ctx.quest : null)
    : mapResults(r.result, r.ms, r.ctx && "map" in r.ctx ? r.ctx.map : null)));
}

function run(): void {
  const out = $("#results");
  lastResult = null;
  let req: BattleRequest;
  let ctx: RunContext | null = null;
  try {
    req = request();
    const problem = partyProblem();
    if (problem) throw new Error(problem);
    try {
      ctx = runContext(req);
    } catch {
      ctx = null; // the XP tiles are left out, the result still shows
    }
  } catch (e) {
    out.replaceChildren(el("p", { class: "error", role: "alert" }, (e as Error).message));
    return;
  }
  state.worker?.terminate();
  const worker = new Worker(new URL("js/battle-worker.js", document.baseURI), { type: "module" });
  state.worker = worker;
  const btn = $<HTMLButtonElement>("#run");
  const cancel = el("button", { type: "button", class: "secondary" }, "Cancel");
  const stop = () => {
    worker.terminate();
    state.worker = null;
    btn.disabled = false;
  };
  cancel.addEventListener("click", () => {
    stop();
    out.replaceChildren(el("p", { class: "muted" }, "Cancelled."));
  });
  btn.disabled = true;
  out.replaceChildren(el("div", { class: "toolbar" }, el("p", { class: "muted" }, `Simulating ${req.n} ${req.quest ? "fights" : "map runs"}…`), cancel));
  revealResults();
  worker.onmessage = (e: MessageEvent<BattleResponse>) => {
    stop();
    const r = e.data;
    if (!r.ok) out.replaceChildren(el("p", { class: "error", role: "alert" }, r.error));
    else {
      lastResult = { ...r, ctx };
      drawResult();
    }
  };
  worker.onerror = (e) => {
    stop();
    out.replaceChildren(el("p", { class: "error", role: "alert" }, `Simulation failed: ${e.message}`));
  };
  worker.postMessage(req);
}

// ---------------------------------------------------------------- results
/** Average grade (1..5) as the nearest letter. */
const gradeOf = (g: number) => GRADES[Math.min(4, Math.max(0, Math.round(g) - 1))];

/**
 * Per hero: damage, taken, healing, death rate, damage by skill. R1 F22: against a quest (`quest`: the result) the
 * damage is what really came off the enemy, the party's total capped at the enemy's max HP (effectiveDamage); the
 * damage dealt, overkill included, is in the cell's tooltip. A map run keeps the damage dealt (its rooms differ).
 */
function heroTable(heroes: Record<string, HeroEval>, unit: string, quest?: FightEval): HTMLElement {
  const order = ["front1", "front2", "front3", "back1", "back2", "back3"];
  const eff = quest ? effectiveDamage(quest) : null;
  const maxHp = quest ? enemyMaxHp(quest) : null;
  const rows: Row[] = order.filter((k) => heroes[k]).map((k) => {
    const h = heroes[k];
    const top = Object.entries(h.skillDmg).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([sk, v]) => `${skillName(sk)} ${fmt.format(v)} (${fmt1.format(h.skillUses[sk] ?? 0)}×)`).join(" · ");
    const raw = heroRaw(state.slots[`${k.replace(/\d$/, "")}${Number(k.slice(-1)) - 1}`] ?? null);
    return { slot: slotLabel(k), name: h.name, cls: raw?.class ?? h.class ?? 0, dmg: eff?.[k]?.[0] ?? h.dmg, dealt: h.dmg, taken: h.taken, heal: h.heal, death_rate: h.death_rate, skills: top };
  });
  const dmgTip = eff && maxHp ? `Damage that came off the enemy: the party's total is capped at its ${fmt.format(maxHp)} HP (no overkill), each hero keeping its share. `
    + "Hover a number for the damage dealt, overkill included." : "Damage dealt, overkill included.";
  const t = table(rows, [
    { key: "slot", label: "Slot" },
    { key: "name", label: "Hero", render: (r) => el("span", { class: `nowrap cls-${r.cls}` }, pill(String(r.name))) },
    { key: "dmg", label: `Damage / ${unit}`, num: true, render: (r) => (eff && Number(r.dealt) > Number(r.dmg) + 0.5
      ? el("span", { title: `${fmt.format(Number(r.dealt))} dealt, overkill included` }, fmt.format(Number(r.dmg)))
      : fmt.format(Number(r.dmg))) },
    { key: "taken", label: "Taken", num: true },
    { key: "heal", label: "Healing", num: true }, { key: "death_rate", label: "Dies", num: true, render: (r) => el("span", { class: `rate ${rateTone(Number(r.death_rate), true)}`, style: "color: var(--c)" }, pct(Number(r.death_rate))) },
    { key: "skills", label: "Damage by skill (uses)" },
  ]);
  const head = [...t.querySelectorAll<HTMLElement>("th")].find((th) => th.textContent === `Damage / ${unit}`);
  if (head) head.title = dmgTip;
  return t;
}

/**
 * U33: the XP and time tiles, a second row under the outcome tiles (same tile size), then a line linking to the Stats
 * sections (Experience, Quest and map time, Craft).
 */
const xpRow = (items: HTMLElement[], lead: string, craft = false): HTMLElement[] => (items.length ? [
  tiles({ class: "qxp-tiles", role: "group", "aria-label": "XP and time" }, ...items),
  el("p", { class: "muted small qxp-refs" }, lead, " ", statLink("xp", "XP"), " · ", statLink("time", "time"),
    ...(craft ? [" · ", statLink("craft", "craft")] : [])),
] : []);

/** U33: XP per hero, quest time (simulated fight + the quest's own time) and XP / min of a quest result. */
function questXpTiles(ev: FightEval, c: QuestRunContext | null): HTMLElement[] {
  if (!c) return [];
  const x = questResultXp(ev, c);
  const at = `at grade ${GRADES[x.grade - 1]}${ev.win ? "" : " (never won)"}`;
  // R1 F06: XP comes only with a win; a quest never won shows none.
  const won = ev.win > 0;
  return [
    tile("XP per hero", won ? xpText(x.xpPerHero) : "—", won ? `each hero alive after a win, ${c.heroes} in the party` : "no fight won", { icon: "🎓", tone: "t-violet" }),
    tile("Quest time", duration(x.seconds), `fight ${duration(x.battleSeconds)} + quest ${duration(x.questSeconds)}, ${at}`, { icon: "⌛", tone: "t-blue" }),
    tile("XP / min", won ? xpText(x.xpPerMin) : "—", won ? "per hero, over the quest time" : "no fight won", { icon: "📈", tone: "t-green" }),
  ];
}

/** U33: craft time, run time, XP per hero per run and XP / min (craft + run) of a map result. */
function mapXpTiles(ev: MapEval, c: MapRunContext | null): HTMLElement[] {
  if (!c) return [];
  // R1 F06: only the rooms won give XP (the share of rooms cleared on average); "—" when none is ever won.
  const x = mapResultXp(ev, c);
  const all = x.cleared >= 0.9995;
  const xpHint = x.xpPerHero === null ? "no room won"
    : all ? `per run, every room won, ${c.heroes} in the party` : `per run, the rooms won (${pct(x.cleared)}), ${c.heroes} in the party`;
  return [
    tile("Craft time", duration(x.craftSeconds), "the map, and the lower maps its recipe uses", { icon: "🔨", tone: "t-slate" }),
    tile("Run time", duration(x.runSeconds), "per run, simulated", { icon: "⏱️", tone: "t-blue" }),
    tile("XP per hero", x.xpPerHero === null ? "—" : xpText(x.xpPerHero), xpHint, { icon: "🎓", tone: "t-violet" }),
    tile("XP / min", x.xpPerMin === null ? "—" : xpText(x.xpPerMin), x.xpPerMin === null ? "no room won" : "per hero, over craft + run", { icon: "📈", tone: "t-green" }),
  ];
}

function questResults(ev: FightEval, ms: number, ctx: QuestRunContext | null = null): HTMLElement[] {
  return [
    tiles({},
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      tile("Turns", fmt1.format(ev.turns), ev.turns_win !== null ? `${fmt1.format(ev.turns_win)} when won` : "never won", { icon: "⏱️", tone: "t-blue" }),
      tile("Grade when won", ev.win ? gradeOf(ev.grade) : "–", ev.win ? `average ${fmt1.format(ev.grade)} (D = 1 … S = 5)` : undefined, { icon: "⭐", tone: "t-gold" }),
      tile("Enemy HP removed", pct(ev.enemy_dmg), ev.enemy_dmg_peak !== undefined && ev.enemy_dmg_peak > ev.enemy_dmg + 5e-4
        ? `lowest point ${pct(ev.enemy_dmg_peak)} (it heals back)` : undefined, { icon: "🗡️", tone: rateTone(ev.enemy_dmg), bar: ev.enemy_dmg }),
      tile("Party HP left", pct(ev.hp_left), undefined, { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
    ),
    ...xpRow(questXpTiles(ev, ctx), "Before XP bonuses:"),
    heroTable(ev.heroes, "fight", ev),
    runLine(`${fmt.format(ev.n)} fights · ${fmt.format(ms)} ms`, ev.n),
  ];
}

/** R1 F20: the run's size and time in one short line; the seeds in its tooltip. */
const runLine = (text: string, seeds: number) => el("p", { class: "muted small run-line", title: `Seeds 1–${seeds}: every setting is tested on the same rolls.` }, text);

/** R1 F35: a tile grid knows its tile count (CSS balances the rows: no lone tile on the last one). */
function tiles(attrs: Record<string, string>, ...items: HTMLElement[]): HTMLElement {
  const g = el("div", { ...attrs, class: `tiles${attrs.class ? ` ${attrs.class}` : ""}` }, ...items);
  g.style.setProperty("--n", String(items.length));
  g.dataset.n = String(items.length);
  return g;
}

const withTitle = (e: HTMLElement, title: string): HTMLElement => {
  e.title = title;
  return e;
};

function mapResults(ev: MapEval, ms: number, ctx: MapRunContext | null = null): HTMLElement[] {
  const ess = Object.entries(ev.essence).map(([k, v]) => `${fmt1.format(v)} ${itemNameFromEnglish("material", k)}`).join(", ") || "none";
  const fails = Object.entries(ev.fail_room).map(([k, v]) => `${k} (${pct(v / ev.n)})`).join(", ");
  const charges = ev.charges_used.map(([id, v]) => `${itemName("consumable", id) ?? id}: ${fmt1.format(v)}`).join(", ");
  return [
    tiles({},
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      // R1 F29: the rooms as the map card counts them (treasure rooms and boss included), said in the tooltip.
      withTitle(tile("Progress", pct(ev.cleared), `of ${fmt1.format(ev.rooms)} rooms (avg)`, { icon: "🧭", tone: rateTone(ev.cleared), bar: ev.cleared }),
        "Rooms cleared per run, of the rooms a run met on average: treasure rooms and the boss included, as on the map card."),
      tile("Grade when won", ev.win ? gradeOf(ev.grade) : "–", ev.win ? `average ${fmt1.format(ev.grade)} (D = 1 … S = 5)` : undefined, { icon: "⭐", tone: "t-gold" }),
      ...(ctx ? [] : [tile("Time", `${fmt1.format(ev.time_h)} h`, "per run", { icon: "⏱️", tone: "t-blue" })]),
      tile("Loot value", gold(ev.loot_value), "base sell value per run", { icon: "💰", tone: "t-orange" }),
      tile("Party HP left", pct(ev.hp_left), undefined, { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
    ),
    ...xpRow(mapXpTiles(ev, ctx), "Before XP bonuses:", true),
    el("p", { class: "result-note" }, el("strong", {}, "✨ Essence per run: "), ess),
    ...(fails ? [el("p", { class: "result-note" }, el("strong", {}, "💀 Lost at: "), fails)] : []),
    ...(charges ? [el("p", { class: "result-note" }, el("strong", {}, "📜 Scroll charges used per run: "), charges)] : []),
    ...(ev.escaped ? [el("p", { class: "muted" }, `Escaped in ${pct(ev.escaped)} of runs.`)] : []),
    ...(ev.errors ? [el("p", { class: "muted small" }, `${ev.errors} runs failed inside the game's own code (${ev.error}); the game would crash on them too.`)] : []),
    heroTable(ev.heroes, "run"),
    runLine(`${fmt.format(ev.n)} map runs · ${fmt.format(ms)} ms`, ev.n + ev.errors),
  ];
}

// ---------------------------------------------------------------- page
/** Parse and use a save (from a file or from the browser's storage); throws when it isn't one. */
async function loadSave(text: string, name: string): Promise<void> {
  // Timelines are optional: without them the opponent card shows the plain rotation and there is no party plan.
  await Promise.all([loadData(), loadWikiText(), loadTimelineData().catch(() => {}), languageReady]);
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
  state.locked = {};
  state.excluded = {};
  const remembered = restoreParty(sv.raw.hero.length);
  $("#setup").hidden = false;
  lastResult = null;
  document.querySelector("#results")?.replaceChildren();
  // The Solver: no party until a result's Show (U41).
  if (solving()) hideParty();
  renderParty();
  buildPage(); // builds the opponent: the remembered one, else a useful one (onExpansions)
  if (!remembered && !solving()) fillParty();
}

/**
 * R1 F02: a save opened here for the first time starts with a party, not six empty slots: its strongest heroes, as
 * many as the opponent takes, the toughest in front, the required slot first (battle-setup.ts defaultSlots).
 */
function fillParty(): void {
  const sv = state.sv;
  if (!sv) return;
  const heroes = sv.raw.hero.map((h: Any, idx: number) => {
    let maxHP = 0;
    try {
      maxHP = Number(api.heroStats(api.newHero(h)).maxHP) || 0;
    } catch { /* unknown class: last in line */ }
    return { idx, level: Number(h.level) || 0, prestige: Number(h.prestigeLevel) || 0, maxHP };
  });
  state.slots = defaultSlots(heroes, rulesOf(pageTarget()));
  state.locked = {};
  state.excluded = {};
  persistParty();
  renderParty();
}

/** R1 F02: the quest a save starts on when no opponent is remembered (defaultQuest: its strongest heroes' region). */
function startQuest(): string | undefined {
  const top = Math.max(0, ...(state.sv?.raw.hero ?? []).map((h: Any) => Number(h.level) || 0));
  // The base game's quests first (an expansion's enemy only when nothing else fits).
  const id = defaultQuest(top, (q) => isVisible("enemy", q) && !needsOf("enemy", q).length) ?? defaultQuest(top, (q) => isVisible("enemy", q));
  return id === null ? undefined : String(id);
}

/** Starts the Simulator (`simulate`, battle.ts) or the Solver (`solve`, solver.ts) on its page's HTML. */
export function initBattlePage(kind: PageKind): void {
  state.mode = MODES[kind];
  // Until U41 the one page remembered its mode; the Simulator and the Solver are two pages now.
  try {
    localStorage.removeItem("battle-mode");
  } catch { /* storage blocked */ }
  initTabs();
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.sv = null;
      $("#setup").hidden = true;
      document.querySelector("#results")?.replaceChildren();
      hideParty();
    },
  });
  loadWikiText();
  // Quest enemy ⇄ map run: the other kind comes back as it was last chosen (U36).
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => r.addEventListener("change", () => {
    saving = false;
    try {
      const o = storedOpponent();
      o.quest ??= startQuest(); // R1 F02: never back to the first bush of the list
      restoreOpponent(o);
    } finally {
      saving = true;
    }
    saveOpponent();
  }));
  if (solving()) initSolver();
  else $("#run").addEventListener("click", run);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
  subscribe(onExpansions);
  onLanguageChange(onLanguage);
}

/** The Solver's panel (battle-search.ts): its guard and options in step 1, its results in step 2, Show into step 3. */
function initSolver(): void {
  $("#open-sim").addEventListener("click", openInSimulator);
  search = initSearch({
    save: () => state.sv!,
    gameMode: () => state.sv?.raw.gameMode || "Standard",
    party: partyOf,
    target: targetOf,
    applyRotation: (idx, rotation, passive) => {
      state.skills[idx] = { attackList: rotation, passive };
      persistParty();
      renderParty(false);
    },
    applyParty: (front, back) => {
      const index = (id: number | null) => (id === null ? null : state.sv!.raw.hero.findIndex((h: Any) => h.id === id));
      // Locks follow their hero to wherever the search put it.
      const lockedIdx = new Set(Object.keys(state.locked).map((k) => state.slots[k]).filter((x): x is number => x !== null && x !== undefined));
      state.slots = {};
      state.locked = {};
      state.excluded = {};
      front.forEach((id, i) => (state.slots[slotKey("front", i)] = index(id)));
      back.forEach((id, i) => (state.slots[slotKey("back", i)] = index(id)));
      for (const [k, v] of Object.entries(state.slots)) if (v !== null && lockedIdx.has(v)) state.locked[k] = true;
      clearUndo = null;
      persistParty();
      renderParty(false);
    },
    locks: () => Object.keys(state.locked).filter((k) => !state.excluded[k]).map((k) => heroRaw(state.slots[k] ?? null)?.id).filter((x): x is number => typeof x === "number"),
    poolSkills: () => Object.fromEntries(Object.entries(state.skills).map(([i, s]) => [state.sv!.raw.hero[Number(i)].id, s])),
    applyScrolls: (ids) => {
      document.querySelectorAll<HTMLSelectElement>("select.scroll").forEach((s, k) => (s.value = ids[k] === undefined ? "" : String(ids[k])));
    },
    onStart: revealResults,
    // U41: a result's Show (after its party is applied) brings the Party and Flow tabs.
    onShow: revealParty,
    rules: () => rulesOf(pageTarget()),
    problem: (front, back) => problemOf(pageTarget(), front, back),
    goSimulate: () => {
      location.href = SIMULATOR_PAGE;
    },
    // U39: the spoiler guard hides the whole rest of the page (the opponent and options, Results, party, flow) until accepted.
    guarded: (on) => $("#setup").classList.toggle("solve-guarded", on),
  }, $("#search-panel"), $("#search-form"), $("#search-results"));
}

/**
 * U29: another language. Redraw the party (skill and passive pickers), the opponent card (pickers, names, timeline)
 * keeping every choice, the plan, the last simulation and the last search result; the search form is left as it is
 * (it holds no game name). Marked names elsewhere are already updated (language.ts relabel).
 */
function onLanguage(): void {
  if (!state.sv) return;
  const y = window.scrollY;
  const runs = document.querySelector<HTMLInputElement>("#runs")?.value;
  keepSearchForm = true; // no search panel rebuild (it would reset its form); the refresh renderTarget queues is skipped
  renderParty(false);
  onExpansions();
  queueMicrotask(() => (keepSearchForm = false));
  if (runs !== undefined) setRuns(runs);
  drawResult();
  search?.relabel();
  window.scrollTo(0, y);
}

/**
 * The expansion switches changed: rebuild the opponent card (the pickers' lists change), keeping the chosen enemy or
 * map when it is still offered, and the search panel (its candidate options).
 */
function onExpansions(): void {
  if (!state.sv) return;
  // The choice on screen, else (first build, U36) the one remembered from an earlier visit.
  const built = Boolean(document.querySelector("#quest, #map"));
  const was = built ? currentOpponent() : storedOpponent();
  // R1 F02: nothing remembered: a quest that fits the save's heroes, not the first bush of the list.
  if (!built && !was.quest) was.quest = startQuest();
  if (!built && was.kind) {
    const r = document.querySelector<HTMLInputElement>(`input[name=opp][value=${was.kind}]`);
    if (r) r.checked = true;
  }
  syncOppKinds();
  saving = false;
  try {
    restoreOpponent(was);
  } finally {
    saving = true;
  }
  saveOpponent();
}

function restoreOpponent(was: OppChoice): void {
  renderTarget();
  const put = (sel: string, v: string | undefined) => {
    const s = document.querySelector<HTMLSelectElement>(sel);
    if (s && v !== undefined && [...s.options].some((o) => o.value === v)) {
      s.value = v;
      s.dispatchEvent(new Event("change"));
    }
  };
  put("#quest", was.quest);
  const rare = document.querySelector<HTMLInputElement>("#rare");
  if (rare && was.rare && !rare.disabled) {
    rare.checked = true;
    rare.dispatchEvent(new Event("change"));
  }
  // The quest size (U36: kept too; the sizes offered follow the party, so a size it can't take falls back to ×1).
  put("#amount", was.amount);
  put("#map", was.map);
  put("#map-asc", was.asc);
  put("#map-grade", was.grade);
  const scrolls = was.scrolls ?? [];
  document.querySelectorAll<HTMLSelectElement>("select.scroll").forEach((s, k) => {
    if ([...s.options].some((o) => o.value === scrolls[k])) s.value = scrolls[k];
  });
}

