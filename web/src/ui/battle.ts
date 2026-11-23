/**
 * Battle simulator page (site/battle.html): put heroes from a save into the six
 * party slots, pick a quest enemy or a map, and simulate many fights or map runs
 * in a web worker with the game's rules (TypeScript engine).
 */
import * as api from "../sim/api.ts";
import { G } from "../sim/data.ts";
import { seq } from "../sim/lua.ts";
import { SCROLL_IDS } from "../tools/combat.ts";
import type { FightEval, HeroEval, MapEval } from "../tools/combat.ts";
import type { MapSpec } from "../tools/engine.ts";
import { loadSaveText, type Save } from "../tools/save.ts";
import type { BattleRequest, BattleResponse, SkillChoice } from "./battle-worker.ts";
import { $, el, fmt, fmt1, pct, pill, rateTone, type Row, select, table, tile } from "./dom.ts";
import { bindSaveInput } from "./save-file.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const GRADES = ["D", "C", "B", "A", "S"];
const SLOTS = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2]] as const;

interface State {
  sv: Save | null;
  slots: Record<string, number | null>; // "front0" -> hero index in sv.raw.hero
  skills: Record<number, SkillChoice>; // hero index -> edited rotation
  worker: Worker | null;
}
const state: State = { sv: null, slots: {}, skills: {}, worker: null };

let dataReady: Promise<void> | null = null;
function loadData(): Promise<void> {
  dataReady ??= fetch("data/gamedata.json").then((r) => {
    if (!r.ok) throw new Error(`game data: HTTP ${r.status}`);
    return r.json();
  }).then((json) => api.loadGameData(json));
  return dataReady;
}

const className = (cls: number) => G.heroList[cls]?.name ?? `class ${cls}`;
const heroLabel = (h: Any) => `${h.name} · ${className(h.class)} lv ${h.level} · asc ${h.prestigeLevel ?? 1}`;
const slotKey = (row: string, i: number) => `${row}${i}`;
const slotLabel = (key: string) => `${key.startsWith("front") ? "Front" : "Back"} ${key.endsWith("1") ? 1 : key.endsWith("2") ? 2 : 3}`;

// ---------------------------------------------------------------- choices
function questOptions(): [string, [string, string][]][] {
  const byTier = new Map<string, [number, string, string][]>();
  for (const [id, q] of Object.entries<Any>(G.questData)) {
    if (!q.enemyHp || !q.attackList || !q.name) continue;
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
      return [`own:${i}`, `${name}${mods ? ` (${mods})` : ""} · ${GRADES[(m.grade ?? 3) - 1] ?? m.grade}${m.prestigeLevel ? ` · asc ${m.prestigeLevel}` : ""}`];
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

function renderParty(): void {
  const sv = state.sv!;
  const options: [string, string][] = [["", "— empty —"], ...sv.raw.hero.map((h: Any, i: number): [string, string] => [String(i), heroLabel(h)])];
  const rows = (["front", "back"] as const).map((row) => {
    const cells = [0, 1, 2].map((i) => {
      const key = slotKey(row, i);
      const s = select({ "aria-label": `${row} row slot ${i + 1}` }, options);
      s.value = state.slots[key] === null || state.slots[key] === undefined ? "" : String(state.slots[key]);
      const details = el("div", { class: "slot-details" });
      const fill = () => {
        const idx = state.slots[key];
        details.replaceChildren();
        if (idx === null || idx === undefined) return;
        const stats = api.heroStats(api.newHero(heroRaw(idx)));
        const stat = (label: string, v: number) => el("span", { class: "nowrap" }, `${label} ${fmt.format(v)}`);
        const parts = [stat("HP", stats.maxHP), stat("Atk", stats.atk), stat("Matk", stats.matk), stat("Def", stats.def), stat("Mdef", stats.mdef)];
        details.append(el("p", { class: "muted small" }, ...parts.flatMap((p, k) => (k ? [" · ", p] : [p]))));
        const edit = el("details", {}, el("summary", { class: "small" }, "Rotation and passive"));
        edit.addEventListener("toggle", () => {
          if (edit.open && edit.children.length === 1) edit.append(skillEditor(idx));
        }, { once: false });
        details.append(edit);
      };
      s.addEventListener("change", () => {
        const v = s.value === "" ? null : Number(s.value);
        // A hero can stand in one slot only: clear it elsewhere.
        if (v !== null) for (const k of Object.keys(state.slots)) if (state.slots[k] === v && k !== key) state.slots[k] = null;
        state.slots[key] = v;
        renderParty();
      });
      fill();
      const idx = state.slots[key];
      const raw = heroRaw(idx ?? null);
      const label = el("span", { class: "slot-name" },
        ...(raw ? [el("span", { class: "avatar", "aria-hidden": "true" }, String(raw.name).slice(0, 1).toUpperCase())] : []),
        `${row === "front" ? "Front" : "Back"} ${i + 1}`, ...(raw ? [pill(className(raw.class))] : []));
      return el("div", { class: raw ? `slot filled cls-${raw.class}` : "slot empty" }, label, s, details);
    });
    return el("div", { class: "party-row" },
      el("h3", {}, row === "front" ? "🛡️ Front row" : "🏹 Back row",
        el("span", { class: "muted small" }, row === "front" ? "enemies hit the front row while anyone stands in it" : "safe until the front row falls")),
      el("div", { class: "slots" }, ...cells));
  });
  $("#party").replaceChildren(...rows);
}

// ---------------------------------------------------------------- target
function renderTarget(): void {
  const mode = ($<HTMLInputElement>("input[name=mode]:checked")?.value ?? "quest") as "quest" | "map";
  const box = $("#target");
  if (mode === "quest") {
    const q = select({ id: "quest", "aria-label": "Enemy" }, questOptions());
    const rare = el("input", { type: "checkbox", id: "rare" }) as HTMLInputElement;
    const amount = select({ id: "amount", "aria-label": "Number of enemies" }, [["1", "1 enemy"], ["2", "2 enemies"], ["3", "3 enemies"], ["4", "4 enemies"]]);
    const info = el("div", { class: "enemy" });
    const update = () => {
      const d = G.questData[q.value];
      const hasRare = d.enemyHpB !== undefined && d.attackListB !== undefined;
      rare.disabled = !hasRare;
      if (!hasRare) rare.checked = false;
      const r = rare.checked;
      const v = (k: string) => fmt.format(d[r ? `${k}B` : k] ?? 0);
      const stat = (label: string, k: string) => el("span", { class: "nowrap" }, el("span", { class: "muted" }, `${label} `), v(k));
      info.replaceChildren(
        el("div", { class: "toolbar" }, el("strong", {}, `👹 ${r ? d.nameB : d.name}`), ...(r ? [pill("rare", "t-pink")] : []),
          ...(d.questType === 6 ? [pill("attacks first", "t-orange")] : []), pill(`level ${d.levelReq ?? "?"}`, "plain")),
        el("p", { class: "small", style: "margin: 0 0 8px" }, ...[stat("HP", "enemyHp"), stat("Atk", "enemyAtk"), stat("Matk", "enemyMatk"),
          stat("Def", "enemyDef"), stat("Mdef", "enemyMdef"), stat("Eva", "enemyEva")].flatMap((p, k) => (k ? [" · ", p] : [p]))),
        el("div", { class: "chips" }, ...seq<string>((r ? d.attackListB : d.attackList) ?? {}).map((sk) => pill(sk, sk === "Basic" ? "skill basic" : "skill t-pink"))));
    };
    q.addEventListener("change", update);
    rare.addEventListener("change", update);
    box.replaceChildren(el("div", { class: "toolbar" }, q, el("label", { class: "check" }, rare, " Rare variant"), amount), info);
    update();
    $<HTMLInputElement>("#runs").value = "200";
  } else {
    const m = select({ id: "map", "aria-label": "Map" }, mapOptions(state.sv));
    const asc = select({ id: "map-asc", "aria-label": "Map ascension" }, [["0", "Asc 0"], ["1", "Asc 1"]]);
    const grade = select({ id: "map-grade", "aria-label": "Map grade" }, GRADES.map((g, i): [string, string] => [String(i + 1), `Grade ${g}`]));
    grade.value = "3";
    const scrollOpts: [string, string][] = [["", "— no scroll —"], ...SCROLL_IDS.filter((id) => G.itemData.consumable?.[id])
      .map((id): [string, string] => [String(id), G.itemData.consumable[id].name])];
    const scrolls = [0, 1, 2].map((k) => select({ class: "scroll", "aria-label": `Scroll ${k + 1}` }, scrollOpts));
    const sync = () => {
      const own = m.value.startsWith("own:");
      asc.disabled = own;
      grade.disabled = own;
    };
    m.addEventListener("change", sync);
    sync();
    box.replaceChildren(el("div", { class: "toolbar" }, m, asc, grade),
      el("div", { class: "toolbar" }, el("span", { class: "muted small" }, "Scrolls"), ...scrolls),
      el("p", { class: "muted small" }, "Each run uses a new map layout (rooms, enemies, rare spawns, boss). Hero HP carries over between rooms."));
    $<HTMLInputElement>("#runs").value = "50";
  }
}

// ---------------------------------------------------------------- run
function request(): BattleRequest {
  const sv = state.sv!;
  const front: (Any | null)[] = [null, null, null], back: (Any | null)[] = [null, null, null];
  const skills = { front: [null, null, null] as (SkillChoice | null)[], back: [null, null, null] as (SkillChoice | null)[] };
  let count = 0;
  for (const [row, i] of SLOTS) {
    const idx = state.slots[slotKey(row, i)];
    if (idx === null || idx === undefined) continue;
    (row === "front" ? front : back)[i] = sv.raw.hero[idx];
    (row === "front" ? skills.front : skills.back)[i] = state.skills[idx] ?? null;
    count++;
  }
  if (!count) throw new Error("Put at least one hero in the party.");
  const n = Math.max(1, Math.min(5000, Math.trunc(Number($<HTMLInputElement>("#runs").value) || 0)));
  const req: BattleRequest = { gameMode: sv.raw.gameMode || "Standard", front, back, skills, n };
  if ($<HTMLInputElement>("input[name=mode]:checked").value === "quest") {
    req.quest = { id: Number($<HTMLSelectElement>("#quest").value), rare: $<HTMLInputElement>("#rare").checked, amount: Number($<HTMLSelectElement>("#amount").value) };
  } else {
    const v = $<HTMLSelectElement>("#map").value;
    const spec: MapSpec = v.startsWith("own:") ? sv.raw.mapInventory.filter((c: unknown) => typeof c === "string")[Number(v.slice(4))]
      : { id: Number(v.slice(4)), prestigeLevel: Number($<HTMLSelectElement>("#map-asc").value), grade: Number($<HTMLSelectElement>("#map-grade").value) };
    const scrolls = [...document.querySelectorAll<HTMLSelectElement>("select.scroll")].map((s) => s.value).filter(Boolean)
      .map((id) => ({ id: Number(id), prestigeLevel: 0 }));
    req.map = { spec, scrolls };
  }
  return req;
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
      tile("Enemy HP removed", pct(ev.enemy_dmg), undefined, { icon: "🗡️", tone: rateTone(ev.enemy_dmg), bar: ev.enemy_dmg }),
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
async function openFile(file: File): Promise<void> {
  const status = $("#loaded");
  status.replaceChildren(el("span", { class: "muted" }, "Reading…"));
  try {
    await loadData();
    let sv: Save;
    try {
      sv = loadSaveText(await file.text());
    } catch {
      throw new Error("this is not a Merchant save. Pick PlayerData.txt, Slot2Data.txt … Slot5Data.txt or one of their backups.");
    }
    if (!Array.isArray(sv.raw?.hero) || !sv.raw.hero.length) throw new Error("this save has no heroes.");
    api.setMode(sv.raw.gameMode || "Standard");
    state.sv = sv;
    state.slots = {};
    state.skills = {};
    status.replaceChildren(el("span", { class: "muted small" }, `Loaded ${file.name}: ${sv.raw.hero.length} heroes, mode ${sv.raw.gameMode || "Standard"}.`));
    $("#setup").hidden = false;
    $("#results").replaceChildren();
    renderParty();
    renderTarget();
  } catch (e) {
    status.replaceChildren(el("span", { class: "error", role: "alert" }, `Could not read ${file.name}: ${e instanceof Error ? e.message : e}`));
  }
}

function init(): void {
  bindSaveInput({
    input: $<HTMLInputElement>("#file"), drop: $("#drop"), onFile: openFile,
    onError: (m) => $("#loaded").replaceChildren(el("span", { class: "error", role: "alert" }, m)),
  });
  document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) => r.addEventListener("change", renderTarget));
  $("#run").addEventListener("click", run);
  loadData().catch((e) => $("#loaded").replaceChildren(el("span", { class: "error" }, String(e))));
}

init();
