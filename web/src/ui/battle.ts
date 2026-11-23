/**
 * Battle simulator page (site/battle.html). Step 1 picks a mode (MODES: simulate, or one of the searches), which
 * decides what step 2 asks for: the party (back row left, front row right) and/or the opponent card on the right
 * (a quest enemy or a map run). Step 3 runs it in a web worker with the game's rules (TypeScript engine).
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { maxQuestAmount, SCROLL_IDS } from "../tools/combat.ts";
import type { FightEval, HeroEval, MapEval } from "../tools/combat.ts";
import type { MapSpec, Scroll } from "../tools/engine.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import type { BattleRequest, BattleResponse, SkillChoice } from "./battle-worker.ts";
import { $, el, fmt, fmt1, gradeBadge, heroAsc, pct, pill, rateTone, type Row, select, table, tile, withAsc } from "./dom.ts";
import { radar, type RadarAxis } from "./radar.ts";
import { initSearch, type PartyMember, type SearchKey } from "./battle-search.ts";
import { enemyStrip, loadTimelineData, partyPlan, type PlanMember, timelineOf } from "./timeline.ts";
import { initSaveSource } from "./save-source.ts";
import { enemyLink, href, isEnemy, itemLink, loadWikiText, passiveLink, skillLink } from "./wiki-data.ts";
import { ENEMY_STATS } from "./wiki-enemies.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const GRADES = ["D", "C", "B", "A", "S"];

type Opp = "quest" | "map";
/**
 * The modes of step 1. `party`: step 2 asks for the party; `opp`: the opponents the mode works on (the first is the
 * default); `search`: the search panel of battle-search.ts (none = the plain simulation). A new mode is one row here
 * and, for a search, one panel in battle-search.ts.
 */
interface Mode { key: "simulate" | SearchKey; icon: string; label: string; hint: string; party: boolean; opp: Opp[] }
const MODES: Mode[] = [
  { key: "simulate", icon: "▶", label: "Simulate", hint: "Your party against an enemy or a map run, hundreds of times.", party: true, opp: ["quest", "map"] },
  { key: "skills", icon: "🧠", label: "Best rotation", hint: "The best skills, order and passive for one hero of your party.", party: true, opp: ["quest"] },
  { key: "gear", icon: "🛡️", label: "Best gear", hint: "The best item in each slot for one hero, from what you own or the catalog.", party: true, opp: ["quest"] },
  { key: "party", icon: "👥", label: "Best party", hint: "Which heroes, in which row, from all your heroes. Only the opponent is needed.", party: false, opp: ["quest", "map"] },
  { key: "scrolls", icon: "📜", label: "Best scrolls", hint: "The best 0 to 3 scrolls for your party on a map.", party: true, opp: ["map"] },
  { key: "consumables", icon: "🧪", label: "Best potion / enchant", hint: "Which potion to drink, or enchant to add, for one hero against this opponent.", party: true, opp: ["quest", "map"] },
  { key: "optimise", icon: "✨", label: "Optimise everything", hint: "Party, rotations, gear and scrolls tuned together within a time budget.", party: false, opp: ["quest", "map"] },
];
const modeOf = (key: string) => MODES.find((m) => m.key === key) ?? MODES[0];
const MODE_KEY = "battle-mode";
const SLOTS = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2]] as const;

interface State {
  mode: Mode;
  sv: Save | null;
  /** file name of the save, to remember the party per save */
  saveName: string;
  slots: Record<string, number | null>; // "front0" -> hero index in sv.raw.hero
  skills: Record<number, SkillChoice>; // hero index -> edited rotation
  /** Slots whose hero Best party / Optimise everything must keep (slot key -> true). */
  locked: Record<string, boolean>;
  worker: Worker | null;
}
const state: State = { mode: MODES[0], sv: null, saveName: "", slots: {}, skills: {}, locked: {}, worker: null };

// The party and edited rotations, remembered per save in this browser (convenience only).
const partyKey = () => `battle-party:${state.saveName}`;
function persistParty(): void {
  try {
    localStorage.setItem(partyKey(), JSON.stringify({ slots: state.slots, skills: state.skills, locked: state.locked }));
  } catch { /* storage blocked: the party just isn't remembered */ }
}
function restoreParty(heroes: number): void {
  try {
    const p = JSON.parse(localStorage.getItem(partyKey()) ?? "null");
    if (!p) return;
    const ok = (i: unknown) => i === null || (typeof i === "number" && i >= 0 && i < heroes);
    state.slots = Object.fromEntries(Object.entries(p.slots ?? {}).filter(([, i]) => ok(i))) as State["slots"];
    state.skills = Object.fromEntries(Object.entries(p.skills ?? {}).filter(([i]) => ok(Number(i)))) as State["skills"];
    state.locked = Object.fromEntries(Object.entries(p.locked ?? {}).filter(([, v]) => v === true)) as State["locked"];
  } catch { /* ignore */ }
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

const className = (cls: number) => G.heroList[cls]?.name ?? `class ${cls}`;
// No "asc N" in option text: the chosen hero's avatar carries the ascension outline.
const heroLabel = (h: Any) => `${h.name} · ${className(h.class)} lv ${h.level}`;
const slotKey = (row: string, i: number) => `${row}${i}`;
const slotLabel = (key: string) => `${key.startsWith("front") ? "Front" : "Back"} ${key.endsWith("1") ? 1 : key.endsWith("2") ? 2 : 3}`;

// ---------------------------------------------------------------- choices
function questOptions(): [string, [string, string][]][] {
  const byTier = new Map<string, [number, string, string][]>();
  for (const [id, q] of Object.entries<Any>(G.questData)) {
    // Gathering quests and placeholders are not fights (wiki-data NON_ENEMY_QUEST_IDS).
    if (!q.enemyHp || !q.attackList || !q.name || !isEnemy(Number(id))) continue;
    const lvl = q.levelReq ?? 0;
    const tier = `Level ${Math.floor(lvl / 10) * 10}–${Math.floor(lvl / 10) * 10 + 9}`;
    const rare = q.enemyHpB !== undefined && q.attackListB !== undefined && q.nameB ? ` / rare: ${q.nameB}` : "";
    const list = byTier.get(tier) ?? [];
    list.push([lvl, id, `Lv ${lvl} · ${q.name}${rare}`]);
    byTier.set(tier, list);
  }
  return [...byTier.entries()].sort((a, b) => a[1][0][0] - b[1][0][0])
    .map(([tier, list]) => [tier, list.sort((a, b) => a[0] - b[0] || Number(a[1]) - Number(b[1])).map(([, id, l]) => [id, l])]);
}

function mapOptions(sv: Save | null): [string, [string, string][]][] {
  const catalog = Object.entries<Any>(G.itemData.map ?? {}).filter(([, m]) => m.name)
    .sort((a, b) => (a[1].itemLevel ?? 0) - (b[1].itemLevel ?? 0) || Number(a[0]) - Number(b[0]))
    .map(([id, m]): [string, string] => [`cat:${id}`, `Lv ${m.itemLevel ?? "?"} · ${m.name}`]);
  const groups: [string, [string, string][]][] = [];
  const owned = sv?.mapInventory ?? [];
  if (owned.length) {
    groups.push(["Your maps", owned.map((m: Any, i: number): [string, string] => {
      const name = G.itemData.map?.[m.id]?.name ?? `map ${m.id}`;
      const mods = [G.prefixList[m.prefix || 0]?.name, m.suffix > 0 ? G.suffixList[m.suffix]?.name : ""].filter(Boolean).join(" ");
      // Options can't be outlined: the chosen map is shown outlined under the pickers (renderTarget).
      return [`own:${i}`, `${name}${mods ? ` (${mods})` : ""} · ${GRADES[(m.grade ?? 3) - 1] ?? m.grade}`];
    })]);
  }
  groups.push(["All maps (choose ascension and grade)", catalog]);
  return groups;
}

// ---------------------------------------------------------------- party
function heroRaw(i: number | null): Any | null {
  return i === null || i === undefined || !state.sv ? null : state.sv.raw.hero[i];
}

/** Rotation editor for one hero: 5 skill slots within the hero's AP budget, and the passive. */
function skillEditor(i: number): HTMLElement {
  const raw = heroRaw(i);
  const hero = api.newHero(raw);
  const info = api.skillInfo(hero);
  const unlocked = info.skills.slice(0, info.unlocked);
  const ap = Object.fromEntries(info.skills.map((s: Any) => [s.name, s.ap]));
  const current: SkillChoice = state.skills[i] ?? { attackList: hero.attackList.slice(1, 6), passive: hero.passiveSelect };
  const apText = el("span", { class: "small" });
  const update = () => {
    const spent = current.attackList.reduce((s, n) => s + (n === "Basic" ? 0 : ap[n] ?? 0), 0);
    apText.textContent = `AP ${spent} / ${info.maxAP}`;
    apText.className = `small ${spent > info.maxAP ? "error" : "muted"}`;
    if (spent > info.maxAP) apText.textContent += " — over budget: the game falls back to the default rotation";
    state.skills[i] = { attackList: [...current.attackList], passive: current.passive };
    persistParty();
    renderPlan();
    // The card's chips follow the editor.
    const chips = document.querySelector(`[data-chips="${i}"]`);
    if (chips && raw) chips.replaceWith(rotationChips(i, raw));
  };
  const slots = current.attackList.map((name, k) => {
    const s = select({ "aria-label": `Turn ${k + 1} skill` },
      [["Basic", "Basic"], ...unlocked.map((sk: Any): [string, string] => [sk.name, `${sk.name} (${sk.ap} AP)`])]);
    s.value = unlocked.some((sk: Any) => sk.name === name) ? name : "Basic";
    current.attackList[k] = s.value;
    s.addEventListener("change", () => {
      current.attackList[k] = s.value;
      update();
    });
    return el("label", { class: "turn" }, el("span", { class: "muted small" }, `Turn ${k + 1}`), s);
  });
  const passive = select({ "aria-label": "Passive" }, info.passives.map((p: string): [string, string] => [p, p]));
  if (current.passive && info.passives.includes(current.passive)) passive.value = current.passive;
  current.passive = passive.value;
  passive.addEventListener("change", () => {
    current.passive = passive.value;
    update();
  });
  update();
  return el("div", { class: "skills" }, el("div", { class: "turns" }, ...slots),
    el("div", { class: "toolbar" }, el("label", { class: "turn" }, el("span", { class: "muted small" }, "Passive"), passive), apText));
}

/** The hero's rotation (edited or its own) as 5 small chips with their AP, and its passive as one chip. */
function rotationChips(idx: number, raw: Any): HTMLElement {
  const hero = api.newHero(raw);
  const ap = Object.fromEntries(api.skillInfo(hero).skills.map((x: Any) => [x.name, x.ap]));
  const rot: string[] = state.skills[idx]?.attackList ?? hero.attackList.slice(1, 6);
  const passive = state.skills[idx]?.passive ?? hero.passiveSelect;
  return el("div", { class: "chips", "data-chips": String(idx) },
    el("ol", { class: "skill-chips", "aria-label": "Rotation, turns 1 to 5" }, ...rot.map((sk, k) => el("li", { class: `skill-chip${sk === "Basic" ? " basic" : ""}`, title: `Turn ${k + 1}` },
      sk === "Basic" ? el("span", {}, "Basic") : skillLink(sk), ...(ap[sk] ? [el("span", { class: "ap", "aria-label": `${ap[sk]} AP` }, String(ap[sk]))] : [])))),
    ...(passive && passive !== "None" ? [el("span", { class: "passive-chip" }, passiveLink(passive))] : []));
}

/** A hero's combat stats as a compact two-line table (labels, values). */
function statStrip(raw: Any): HTMLElement {
  const st = api.heroStats(api.newHero(raw));
  return el("table", { class: "stat-strip" }, el("thead", {}, el("tr", {}, ...CARD_STATS.map(([, l]) => el("th", { scope: "col" }, l)))),
    el("tbody", {}, el("tr", {}, ...CARD_STATS.map(([k]) => el("td", {}, fmt.format(st[k] ?? 0))))));
}

/** The six slots, back row (left) and front row (right). In the modes that choose the party (Best party, Optimise
 * everything), empty slots are "to be found" and a filled slot can be locked: the search keeps its hero. */
function renderParty(refreshSearch = true): void {
  const sv = state.sv!;
  const picks = !state.mode.party;
  const options: [string, string][] = [["", picks ? "— to be found —" : "— empty —"], ...sv.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
  const slot = (row: "front" | "back", i: number) => {
    const key = slotKey(row, i);
    const s = select({ "aria-label": `${row} row slot ${i + 1}` }, options);
    s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
    const idx = state.slots[key];
    const raw = heroRaw(idx ?? null);
    s.addEventListener("change", () => {
      const v = s.value === "" ? null : Number(s.value);
      // A hero can stand in one slot only: clear it elsewhere.
      if (v !== null) for (const k of Object.keys(state.slots)) if (state.slots[k] === v && k !== key) (state.slots[k] = null, delete state.locked[k]);
      state.slots[key] = v;
      // Picking a hero by hand in a search mode locks it (the search keeps it); clearing a slot unlocks it.
      if (v === null) delete state.locked[key];
      else if (picks) state.locked[key] = true;
      persistParty();
      renderParty();
    });
    const lock = picks && raw ? (() => {
      const on = Boolean(state.locked[key]);
      const b = el("button", { type: "button", class: `lock${on ? " on" : ""}`, "aria-pressed": String(on),
        title: on ? "Locked: the search keeps this hero (click to let it change)" : "Not locked: the search may replace this hero (click to keep it)" }, on ? "🔒" : "🔓");
      b.setAttribute("aria-label", `Keep ${raw.name} in the party`);
      b.addEventListener("click", () => {
        if (on) delete state.locked[key];
        else state.locked[key] = true;
        persistParty();
        renderParty();
      });
      return b;
    })() : null;
    const head = el("div", { class: "slot-head" }, el("span", { class: "slot-name" },
      ...(raw ? [withAsc(el("span", { class: "avatar" }, String(raw.name).slice(0, 1).toUpperCase()), heroAsc(raw.prestigeLevel), String(raw.name))] : []),
      `${row === "front" ? "Front" : "Back"} ${i + 1}`, ...(raw ? [pill(`${className(raw.class)} · ${raw.level}`)] : [])), ...(lock ? [lock] : []));
    const body: Node[] = [];
    if (idx !== null && idx !== undefined && raw) {
      body.push(statStrip(raw), rotationChips(idx, raw));
      const edit = el("details", { class: "slot-edit" }, el("summary", { class: "small" }, "Edit rotation and passive"));
      edit.addEventListener("toggle", () => {
        if (edit.open && edit.children.length === 1) edit.append(skillEditor(idx));
      });
      body.push(edit);
    } else if (picks) body.push(el("p", { class: "muted small slot-hint" }, "The search fills this slot."));
    return el("div", { class: raw ? `slot filled cls-${raw.class}${state.locked[key] && picks ? " locked" : ""}` : "slot empty" }, head, s, ...body);
  };
  const cols = (["back", "front"] as const).map((row) => el("div", { class: "party-row" },
    el("h3", {}, row === "front" ? "🛡️ Front row" : "🏹 Back row",
      el("span", { class: "muted small" }, row === "front" ? "enemies hit the front row while anyone stands in it" : "safe until the front row falls")),
    el("div", { class: "slots" }, ...[0, 1, 2].map((i) => slot(row, i)))));
  $("#party").replaceChildren(...(picks ? [el("p", { class: "muted small party-note" },
    "The search fills the six slots. 🔒 Locked heroes stay in the party; pick a hero in a slot to lock it.")] : []),
  el("div", { class: "party-cols" }, ...cols));
  syncAmount();
  renderPlan();
  // Not after a search filled the slots: rebuilding the search panel would wipe its results.
  if (refreshSearch) search?.refresh();
}

// ---------------------------------------------------------------- target
let search: { show(key: SearchKey | null): void; refresh(): void } | null = null;
const oppKind = (): Opp => ($<HTMLInputElement>("input[name=opp]:checked")?.value ?? "quest") as Opp;

/** Largest base stat among the enemies of the same kind (quest, boss, party boss …) and level band (0-9, 10-19 …),
 * rare variants included: the enemy radar's rims, so the shape compares an enemy with its peers. */
const enemyBest = new Map<string, Record<string, number>>();
function enemyRims(d: Any): Record<string, number> {
  const band = Math.floor((d.levelReq ?? 0) / 10), key = `${d.questType}:${band}`;
  if (enemyBest.has(key)) return enemyBest.get(key)!;
  const rims: Record<string, number> = {};
  for (const [id, q] of Object.entries<Any>(G.questData)) {
    if (!q.enemyHp || !q.attackList || !isEnemy(Number(id)) || q.questType !== d.questType || Math.floor((q.levelReq ?? 0) / 10) !== band) continue;
    for (const [k] of ENEMY_STATS) rims[k] = Math.max(rims[k] ?? 0, q[k] ?? 0, q[`${k}B`] ?? 0);
  }
  enemyBest.set(key, rims);
  return rims;
}

function renderTarget(): void {
  queueMicrotask(() => search?.refresh());
  const box = $("#target");
  if (oppKind() === "quest") {
    const q = select({ id: "quest", "aria-label": "Enemy" }, questOptions());
    const rare = el("input", { type: "checkbox", id: "rare" }) as HTMLInputElement;
    const amount = select({ id: "amount", "aria-label": "Quest size" }, [["1", "×1"]]);
    const sizeNote = el("p", { id: "amount-note", class: "muted small" });
    const card = el("article", { class: "opp-card" });
    const update = () => {
      const d = G.questData[q.value];
      const hasRare = d.enemyHpB !== undefined && d.attackListB !== undefined;
      rare.disabled = !hasRare;
      if (!hasRare) rare.checked = false;
      syncAmount();
      const r = rare.checked, sfx = r ? "B" : "";
      const rims = enemyRims(d);
      const axes: RadarAxis[] = ENEMY_STATS.map(([k, label]) => ({ label, value: d[`${k}${sfx}`] ?? 0, max: rims[k] ?? 0 }));
      card.className = `opp-card${r ? " rare" : ""}`;
      card.replaceChildren(
        el("header", {}, el("span", { class: "opp-ico", "aria-hidden": "true" }, "👹"),
          el("div", {}, el("h3", {}, enemyLink({ id: Number(q.value), rare: r })),
            el("div", { class: "pills" }, pill(`level ${d.levelReq ?? "?"}`, "plain"), ...(r ? [pill("rare", "t-pink")] : []),
              ...(d.questType === 6 ? [pill("attacks first", "t-orange")] : [])))),
        radar(axes, { title: `${r ? d.nameB : d.name}'s stats`, size: 240 }),
        el("p", { class: "muted small" }, `Rims: the strongest ${(d.title || "quest").toLowerCase()} enemy of level ${Math.floor((d.levelReq ?? 0) / 10) * 10}–${Math.floor((d.levelReq ?? 0) / 10) * 10 + 9}.`),
        // The 5-turn timeline with effect windows (U11); the plain rotation without timeline data.
        ...((tl) => tl ? [el("h4", {}, "Timeline"), enemyStrip(tl)]
          : [el("h4", {}, "Skills"), el("ol", { class: "rotation compact" }, ...seq<string>((r ? d.attackListB : d.attackList) ?? {}).map((sk) => el("li", {}, skillLink(sk))))])(
          timelineOf(Number(q.value), r)),
        el("p", { class: "small" }, el("a", { href: href.enemy(Number(q.value)) }, "Enemy page in the wiki →")));
    };
    q.addEventListener("change", () => (update(), renderPlan()));
    rare.addEventListener("change", () => (update(), renderPlan()));
    amount.addEventListener("change", () => (syncAmount(), renderPlan()));
    box.replaceChildren(el("div", { class: "opp-controls" }, q,
      el("div", { class: "toolbar" }, el("label", { class: "check" }, rare, " Rare variant"),
        el("label", { class: "check nowrap" }, el("span", { class: "muted small" }, "Quest size"), amount)), sizeNote), card);
    update();
    $<HTMLInputElement>("#runs").value = "200";
  } else {
    const m = select({ id: "map", "aria-label": "Map" }, mapOptions(state.sv));
    const asc = select({ id: "map-asc", "aria-label": "Map ascension" }, [["0", "No ascension"], ["1", "Ascension 1"]]);
    const grade = select({ id: "map-grade", "aria-label": "Map grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
    grade.value = "3";
    const scrollOpts: [string, string][] = [["", "— no scroll —"], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id])
      .map((id): [string, string] => [String(id), G.itemData.consumable[id].name])];
    const scrolls = [0, 1, 2].map((k) => select({ class: "scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
    const card = el("article", { class: "opp-card map" });
    const sync = () => {
      const own = m.value.startsWith("own:");
      asc.hidden = grade.hidden = own;
      const it: Any = own ? state.sv?.mapInventory[Number(m.value.slice(4))] : null;
      const id = own ? Number(it?.id) : Number(m.value.slice(4));
      const d: Any = G.itemData.map?.[id] ?? {};
      const a = own ? it?.prestigeLevel : Number(asc.value), g = own ? (it?.grade ?? 3) : Number(grade.value);
      const pre = own && it?.prefix ? G.prefixList[it.prefix]?.name : "", suf = own && it?.suffix > 0 ? G.suffixList[it.suffix]?.name : "";
      const name = [pre, d.name ?? `map ${id}`, suf].filter(Boolean).join(" ");
      const bosses = seq<number>(d.bossList ?? {});
      const fact = (k: string, v: Node | string) => [el("dt", {}, k), el("dd", {}, v)];
      card.replaceChildren(
        el("header", {}, el("span", { class: "opp-ico", "aria-hidden": "true" }, "🗺️"),
          el("div", {}, el("h3", {}, itemLink("map", id, name, undefined, a)),
            el("div", { class: "pills" }, pill(`level ${d.itemLevel ?? "?"}`, "plain"), gradeBadge(GRADES[g - 1] ?? String(g)),
              ...(own ? [pill("yours", "t-green")] : [])))),
        el("dl", { class: "facts" },
          ...fact("Rooms", String(d.baseEnemyAmount ?? "?")),
          ...fact("Time", d.baseMapTime ? `${fmt.format(d.baseMapTime / 60)} min` : "?"),
          ...fact("Enemy power", `×${d.enemyMod ?? 1}`),
          ...fact(bosses.length > 1 ? "Bosses" : "Boss", bosses.length
            ? el("span", {}, ...bosses.flatMap((b, k) => [...(k ? [", "] : []), enemyLink({ id: b })])) : "none"),
          ...(pre || suf ? fact("Modifiers", [pre && `prefix ${pre}`, suf && `suffix ${suf}`].filter(Boolean).join(" · ")) : [])),
        el("div", { class: "opp-scrolls" },
          el("h4", {}, "Scrolls"), ...scrolls),
        el("p", { class: "muted small" }, "Each run uses a new layout (rooms, enemies, rare spawns, boss); hero HP carries over between rooms. "
          + "Base rooms and time, before the map's modifiers."));
      if (state.mode.key === "scrolls") card.querySelector(".opp-scrolls")?.setAttribute("hidden", "");
      else card.querySelector(".opp-scrolls")?.removeAttribute("hidden");
    };
    m.addEventListener("change", sync);
    asc.addEventListener("change", sync);
    grade.addEventListener("change", sync);
    box.replaceChildren(el("div", { class: "opp-controls" }, m, el("div", { class: "toolbar" }, asc, grade)), card);
    sync();
    $<HTMLInputElement>("#runs").value = "50";
  }
  renderPlan();
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
  if (note) {
    note.textContent = rare ? "Quest size: a rare quest is always ×1."
      : !state.mode.party ? `Quest size ×${n}: one enemy with ${n > 1 ? `${n}× HP, ${n}× loot and ${n}× quest time` : "its normal HP"}. `
        + `Up to ×${max} with your strongest hero; parties that can't take this size are skipped.`
      : `Quest size ×${n}: one enemy with ${n > 1 ? `${n}× HP, ${n}× loot and ${n}× quest time` : "its normal HP"}. `
        + `Up to ×${max} for this party (highest hero ascension: prestige × 2 − 1).`;
  }
}

// ---------------------------------------------------------------- party plan (U11)
/** The party's 5-turn plan under the enemy's timeline, for the modes with a party, against a quest. */
function renderPlan(): void {
  const box = document.querySelector<HTMLElement>("#plan");
  if (!box || !state.sv) return;
  box.replaceChildren();
  if (oppKind() !== "quest" || !document.querySelector("#quest")) return;
  const t = targetOf().quest!;
  const members: PlanMember[] = partyOf().members.map((m) => ({
    row: m.row, i: m.i, raw: m.raw,
    rotation: state.skills[m.idx]?.attackList ?? api.newHero(m.raw).attackList.slice(1, 6),
  }));
  if (!members.length) return;
  const plan = partyPlan(t, members);
  if (plan) box.append(el("h3", { class: "col-title" }, "🗓️ 5-turn plan"), plan);
}

// ---------------------------------------------------------------- modes
function renderModes(): void {
  const box = $("#modes");
  box.replaceChildren(...MODES.map((m) => {
    const r = el("input", { type: "radio", name: "what", value: m.key }) as HTMLInputElement;
    r.checked = m.key === state.mode.key;
    r.addEventListener("change", () => setMode(m.key));
    return el("label", { class: "mode-card", title: m.hint }, r, el("span", { class: "mode-ico", "aria-hidden": "true" }, m.icon),
      el("span", { class: "mode-text" }, el("strong", {}, m.label), el("span", { class: "muted small" }, m.hint)));
  }));
}

/** Show the inputs the mode needs: party or not, the opponents it works on, and its run panel. */
function setMode(key: string): void {
  state.mode = modeOf(key);
  try {
    localStorage.setItem(MODE_KEY, state.mode.key);
  } catch { /* not remembered */ }
  const m = state.mode;
  $("#run-title").textContent = m.label;
  let kindChanged = false;
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => {
    const ok = m.opp.includes(r.value as Opp);
    (r.closest("label") as HTMLElement).hidden = !ok;
    if (!ok && r.checked) {
      r.checked = false;
      kindChanged = true;
    }
  });
  if (kindChanged) $<HTMLInputElement>(`input[name=opp][value=${m.opp[0]}]`).checked = true;
  $("#opp-switch").hidden = m.opp.length < 2;
  const sim = m.key === "simulate";
  document.querySelector<HTMLElement>(".simulate")!.hidden = !sim;
  $("#results").hidden = !sim;
  if (state.sv) {
    renderParty(false); // locks and "to be found" slots in the modes that choose the party
    renderTarget(); // the opponent card depends on the mode (quest size cap, scrolls)
    search?.show(sim ? null : m.key as SearchKey);
  }
}

// ---------------------------------------------------------------- run
/** The six slots as the worker takes them (raw save heroes, edited rotations), and who stands where. */
function partyOf() {
  const sv = state.sv!;
  const front: (Any | null)[] = [null, null, null], back: (Any | null)[] = [null, null, null];
  const skills = { front: [null, null, null] as (SkillChoice | null)[], back: [null, null, null] as (SkillChoice | null)[] };
  const members: PartyMember[] = [];
  for (const [row, i] of SLOTS) {
    const idx = state.slots[slotKey(row, i)];
    if (idx === null || idx === undefined) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
    members.push({ row, i, idx, raw: sv.raw.hero[idx] });
  }
  return { front, back, skills, members };
}

/** The opponent chosen in step 2. */
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

function run(): void {
  const out = $("#results");
  let req: BattleRequest;
  try {
    req = request();
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
  worker.onmessage = (e: MessageEvent<BattleResponse>) => {
    stop();
    const r = e.data;
    if (!r.ok) out.replaceChildren(el("p", { class: "error", role: "alert" }, r.error));
    else if (r.kind === "quest") out.replaceChildren(...questResults(r.result, r.ms));
    else out.replaceChildren(...mapResults(r.result, r.ms));
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

function heroTable(heroes: Record<string, HeroEval>, unit: string): HTMLElement {
  const order = ["front1", "front2", "front3", "back1", "back2", "back3"];
  const rows: Row[] = order.filter((k) => heroes[k]).map((k) => {
    const h = heroes[k];
    const top = Object.entries(h.skillDmg).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([sk, v]) => `${sk} ${fmt.format(v)} (${fmt1.format(h.skillUses[sk] ?? 0)}×)`).join(" · ");
    const raw = heroRaw(state.slots[`${k.replace(/\d$/, "")}${Number(k.slice(-1)) - 1}`] ?? null);
    return { slot: slotLabel(k), name: h.name, cls: raw?.class ?? h.class ?? 0, dmg: h.dmg, taken: h.taken, heal: h.heal, death_rate: h.death_rate, skills: top };
  });
  return table(rows, [
    { key: "slot", label: "Slot" },
    { key: "name", label: "Hero", render: (r) => el("span", { class: `nowrap cls-${r.cls}` }, pill(String(r.name))) },
    { key: "dmg", label: `Damage / ${unit}`, num: true }, { key: "taken", label: "Taken", num: true },
    { key: "heal", label: "Healing", num: true }, { key: "death_rate", label: "Dies", num: true, render: (r) => el("span", { class: `rate ${rateTone(Number(r.death_rate), true)}`, style: "color: var(--c)" }, pct(Number(r.death_rate))) },
    { key: "skills", label: "Damage by skill (uses)" },
  ]);
}

function questResults(ev: FightEval, ms: number): HTMLElement[] {
  return [
    el("div", { class: "tiles" },
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      tile("Turns", fmt1.format(ev.turns), ev.turns_win !== null ? `${fmt1.format(ev.turns_win)} when won` : "never won", { icon: "⏱️", tone: "t-blue" }),
      tile("Grade when won", ev.win ? gradeOf(ev.grade) : "–", ev.win ? `average ${fmt1.format(ev.grade)} (D = 1 … S = 5)` : undefined, { icon: "⭐", tone: "t-gold" }),
      tile("Enemy HP removed", pct(ev.enemy_dmg), ev.enemy_dmg_peak !== undefined && ev.enemy_dmg_peak > ev.enemy_dmg + 5e-4
        ? `lowest point ${pct(ev.enemy_dmg_peak)} (it heals back)` : undefined, { icon: "🗡️", tone: rateTone(ev.enemy_dmg), bar: ev.enemy_dmg }),
      tile("Party HP left", pct(ev.hp_left), undefined, { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
    ),
    heroTable(ev.heroes, "fight"),
    el("p", { class: "muted small" }, `${ev.n} fights in ${fmt.format(ms)} ms, seeds 1–${ev.n}: every setting is tested on the same rolls.`),
  ];
}

function mapResults(ev: MapEval, ms: number): HTMLElement[] {
  const ess = Object.entries(ev.essence).map(([k, v]) => `${fmt1.format(v)} ${k}`).join(", ") || "none";
  const fails = Object.entries(ev.fail_room).map(([k, v]) => `${k} (${pct(v / ev.n)})`).join(", ");
  const charges = ev.charges_used.map(([id, v]) => `${G.itemData.consumable?.[id]?.name ?? id}: ${fmt1.format(v)}`).join(", ");
  return [
    el("div", { class: "tiles" },
      tile("Win rate", pct(ev.win), undefined, { icon: "🏆", tone: rateTone(ev.win), bar: ev.win }),
      tile("Progress", pct(ev.cleared), `of ${fmt1.format(ev.rooms)} rooms`, { icon: "🧭", tone: rateTone(ev.cleared), bar: ev.cleared }),
      tile("Grade when won", ev.win ? gradeOf(ev.grade) : "–", ev.win ? `average ${fmt1.format(ev.grade)} (D = 1 … S = 5)` : undefined, { icon: "⭐", tone: "t-gold" }),
      tile("Time", `${fmt1.format(ev.time_h)} h`, "per run", { icon: "⏱️", tone: "t-blue" }),
      tile("Loot value", `${fmt.format(ev.loot_value)} g`, "base sell value per run", { icon: "💰", tone: "t-orange" }),
      tile("Party HP left", pct(ev.hp_left), undefined, { icon: "❤️", tone: rateTone(ev.hp_left * 1.6), bar: ev.hp_left }),
    ),
    el("p", { class: "result-note" }, el("strong", {}, "✨ Essence per run: "), ess),
    ...(fails ? [el("p", { class: "result-note" }, el("strong", {}, "💀 Lost at: "), fails)] : []),
    ...(charges ? [el("p", { class: "result-note" }, el("strong", {}, "📜 Scroll charges used per run: "), charges)] : []),
    ...(ev.escaped ? [el("p", { class: "muted" }, `Escaped in ${pct(ev.escaped)} of runs.`)] : []),
    ...(ev.errors ? [el("p", { class: "muted small" }, `${ev.errors} runs failed inside the game's own code (${ev.error}); the game would crash on them too.`)] : []),
    heroTable(ev.heroes, "run"),
    el("p", { class: "muted small" }, `${ev.n} map runs in ${fmt.format(ms)} ms, seeds 1–${ev.n + ev.errors}: every setting is tested on the same rolls.`),
  ];
}

// ---------------------------------------------------------------- page
/** Parse and use a save (from a file or from the browser's storage); throws when it isn't one. */
async function loadSave(text: string, name: string): Promise<void> {
  // Timelines are optional: without them the opponent card shows the plain rotation and there is no party plan.
  await Promise.all([loadData(), loadWikiText(), loadTimelineData().catch(() => {})]);
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
  restoreParty(sv.raw.hero.length);
  $("#setup").hidden = false;
  $("#results").replaceChildren();
  renderParty();
  setMode(state.mode.key);
}

function init(): void {
  try {
    state.mode = modeOf(localStorage.getItem(MODE_KEY) ?? "simulate");
  } catch { /* default mode */ }
  renderModes();
  initSaveSource({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), status: $("#loaded"), load: loadSave,
    onForget: () => {
      state.sv = null;
      $("#setup").hidden = true;
      $("#results").replaceChildren();
    },
  });
  loadWikiText();
  document.querySelectorAll<HTMLInputElement>("input[name=opp]").forEach((r) => r.addEventListener("change", renderTarget));
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
      front.forEach((id, i) => (state.slots[slotKey("front", i)] = index(id)));
      back.forEach((id, i) => (state.slots[slotKey("back", i)] = index(id)));
      for (const [k, v] of Object.entries(state.slots)) if (v !== null && lockedIdx.has(v)) state.locked[k] = true;
      persistParty();
      renderParty(false);
    },
    locks: () => Object.keys(state.locked).map((k) => heroRaw(state.slots[k] ?? null)?.id).filter((x): x is number => typeof x === "number"),
    poolSkills: () => Object.fromEntries(Object.entries(state.skills).map(([i, s]) => [state.sv!.raw.hero[Number(i)].id, s])),
    applyScrolls: (ids) => {
      document.querySelectorAll<HTMLSelectElement>("select.scroll").forEach((s, k) => (s.value = ids[k] === undefined ? "" : String(ids[k])));
    },
  }, $("#search-panel"));
  $("#run").addEventListener("click", run);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
}

init();
