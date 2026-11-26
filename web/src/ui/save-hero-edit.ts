/**
 * U78: the save viewer's hero edit mode, the controls (the page, save-viewer.ts, holds the session and draws the
 * stats and radar from the draft). Every change goes through hero-edit.ts / hero-gear.ts and calls `change` with the
 * new raw hero and the key of the control to focus after the page is drawn again (`data-focus-key`).
 * - Head: name, class, ascension, level (selects; the level's options follow the ascension's tier).
 * - Passive and rotation: the Simulator's pickers (pick-list.ts, in place), each skill over the AP budget greyed out
 *   (battle-edit budgetOptions), a passive that would put the rotation over it too.
 * - Gear: one line per slot with its pickers in a row, Prefix, Item, Suffix, Rank, Asc; "Item" opens the slot's item
 *   table under the gear list (full width): the slot's items up to the hero's level, highest level first, region
 *   chips to leave regions out, columns item, level and bonus stats. A row picks the item (rank, ascension, prefix and
 *   suffix reset).
 */
import { G } from "../sim/data.ts";
import { apBadge, el, GEAR_SLOT_ICONS, GEAR_SLOT_NAMES, GEAR_SLOTS, GRADE_LETTERS, itemName as rarityItemName, lvStart, select, shortPick } from "./dom.ts";
import { budgetOptions, apUsed } from "./battle-edit.ts";
import { isVisible } from "./expansion-state.ts";
import {
  budgetOf, classIds, levelOptions, passiveChoices, skillsOf, unlockedSkills, withClass, withGearSlot, withLevel, withPrestige, withSkills,
} from "./hero-edit.ts";
import {
  ascOptions, configOf, gearCompact, type GearConfig, gradeOptions, itemChoices, pickItem, prefixOptions, suffixOptions, withGear,
} from "./hero-gear.ts";
import { className, itemName as shownItemName, passiveName, prefixName, regionName, skillName, suffixName } from "./names.ts";
import { pickButton, type PickOption } from "./pick-list.ts";
import { REGIONS, regionOf, passiveText, skillDesc } from "./wiki-data.ts";
import { prefixEffect, suffixEffect } from "./wiki-config.ts";
import { rarity } from "../tools/engine.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

/** One hero being edited: its state before the edit, the draft, the open item table, the regions left out. */
export interface EditSession {
  id: number;
  isNew: boolean;
  before: Any;
  draft: Any;
  openSlot: number | null;
  excluded: Set<number>;
}
export interface EditHooks {
  /** a new draft; the page draws itself again and focuses `focus` */
  change: (draft: Any, focus?: string) => void;
  /** the page drawn again (the item table opened or closed, a filter changed) */
  redraw: (focus?: string) => void;
}

const labelled = (text: string, control: HTMLElement) => el("label", { class: "he-field" }, el("span", { class: "he-label" }, text), control);
const focusKey = (e: HTMLElement, key: string) => {
  e.setAttribute("data-focus-key", key);
  return e;
};
function selectOf(key: string, aria: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = select({ "aria-label": aria, "data-focus-key": key }, options);
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/** Name, class, ascension and level. */
export function headEditor(s: EditSession, h: EditHooks): HTMLElement {
  const d = s.draft;
  const name = focusKey(el("input", { type: "text", value: String(d.name ?? ""), maxlength: "24", "aria-label": "Name", autocomplete: "off" }), "he-name") as HTMLInputElement;
  name.value = String(d.name ?? "");
  // the name changes no stat: kept in the draft without drawing the page again (the caret stays)
  name.addEventListener("input", () => {
    s.draft = { ...s.draft, name: name.value.trim() || s.before.name };
  });
  const classes = classIds().filter((c) => c === Number(d.class) || isVisible("class", c));
  const cls = selectOf("he-class", "Class", classes.map((c) => [String(c), className(c) ?? `#${c}`]), String(d.class),
    (v) => h.change(withClass(s.draft, Number(v)), "he-class"));
  const prestiges = [1, 2, 3].filter((p) => p === Number(d.prestigeLevel) || isVisible("prestige", p));
  const asc = selectOf("he-asc", "Ascension", prestiges.map((p) => [String(p), `Asc ${p - 1}`]), String(d.prestigeLevel ?? 1),
    (v) => h.change(withPrestige(s.draft, Number(v)), "he-asc"));
  const level = selectOf("he-level", "Level", levelOptions(Number(d.prestigeLevel) || 1).map((n) => [String(n), lvStart(n)]), String(d.level),
    (v) => h.change(withLevel(s.draft, Number(v)), "he-level"));
  return el("div", { class: "he-head" }, labelled("Name", name), labelled("Class", cls), labelled("Asc", asc), labelled("Level", level));
}

/** The passive's picker, then one picker per turn of the rotation with its AP. */
export function skillsEditor(s: EditSession, h: EditHooks): { passive: HTMLElement; rotation: HTMLElement } {
  const d = s.draft;
  const { rotation, passive } = skillsOf(d);
  const b = budgetOf(d);
  const passiveRow = el("div", { class: "he-pick he-passive" });
  passiveRow.append(el("span", { class: "section-label" }, "Passive"), pickButton({
    label: "Passive", text: passive === "None" ? "No passive" : passiveName(passive), value: passive, focus: "he-p",
    options: () => passiveChoices(d).map((x): PickOption => {
      const nb = budgetOf(withSkills(d, rotation, x)), used = apUsed(rotation, nb);
      const off = x !== passive && used > nb.max && nb.max < b.max;
      return { value: x, label: x === "None" ? "No passive" : passiveName(x), note: x === "None" ? "" : passiveText(x),
        ...(off ? { disabled: true, why: `${used} / ${nb.max} AP` } : {}) };
    }),
    onPick: (v) => h.change(withSkills(s.draft, rotation, v), "he-p"),
    host: () => passiveRow,
  }));
  focusKey(passiveRow.querySelector("button")!, "he-p");
  const unlocked = unlockedSkills(d);
  const rows = rotation.map((sk, k) => {
    const row = el("li", { class: "he-pick he-turn" }, el("span", { class: "n" }, String(k + 1)));
    const btn = pickButton({
      label: `Turn ${k + 1} skill`, text: skillName(sk), value: sk, focus: `he-r${k}`,
      options: () => budgetOptions(unlocked.map((x) => ({ value: x, label: skillName(x), ap: x === "Basic" ? 0 : b.cost(x),
        note: x === "Basic" ? "Basic attack" : skillDesc(x) })), rotation, k, b),
      onPick: (v) => {
        const next = [...rotation];
        next[k] = v;
        h.change(withSkills(s.draft, next, passive), `he-r${k}`);
      },
      host: () => row,
    });
    focusKey(btn, `he-r${k}`);
    row.append(btn, apBadge(sk === "Basic" ? 0 : b.cost(sk)));
    return row;
  });
  return { passive: passiveRow, rotation: el("ol", { class: "he-rotation", "aria-label": "Rotation" }, ...rows) };
}

const slotNo = (i: number) => i + 1;
const gradeLetter = (g: number) => GRADE_LETTERS[g - 1] ?? "?";

/** One gear line: the slot, then Prefix, Item, Suffix, Rank, Asc. */
function gearLine(s: EditSession, h: EditHooks, slot: number): HTMLElement {
  const name = GEAR_SLOT_NAMES[GEAR_SLOTS[slot - 1]];
  const compact = s.draft.heroInventory?.[slot - 1];
  const c: GearConfig | null = typeof compact === "string" ? configOf(compact) : null;
  const set = (next: GearConfig, focus: string) => {
    const out = gearCompact(next);
    if (out) h.change(withGearSlot(s.draft, slot, out), focus);
  };
  const k = (what: string) => `he-g${slot}-${what}`;
  const short = (sel: HTMLSelectElement) => shortPick(sel);
  const opt = (value: number, label: string, shortText: string): [string, string, string] => [String(value), label, shortText];
  const pickSel = (what: string, aria: string, options: [string, string, string][], value: number, onChange: (v: number) => void) => {
    const sel = selectOf(k(what), `${name} ${aria}`, options.map(([v, l]) => [v, l]), String(value), (v) => onChange(Number(v)));
    [...sel.querySelectorAll("option")].forEach((o, i) => o.setAttribute("data-short", options[i][2]));
    sel.disabled = options.length < 2;
    return el("span", { class: `he-g-${what}` }, short(sel));
  };
  const it = c ? G.itemData.equipment?.[c.id] : null;
  const open = s.openSlot === slot;
  const itemBtn = focusKey(el("button", { type: "button", class: "he-item-btn", "aria-expanded": String(open), "aria-controls": "he-items",
    "aria-label": `${name} item: ${c ? shownItemName("equipment", c.id) ?? it?.name : "none"}. Change` },
  c ? rarityItemName(shownItemName("equipment", c.id) ?? String(it?.name ?? c.id), rarity("equipment", c.id, Number(c.prefix > 0) + Number(c.suffix > 0))) : "—",
  el("span", { class: "he-caret", "aria-hidden": "true" }, open ? "▴" : "▾")), k("item"));
  itemBtn.addEventListener("click", () => {
    s.openSlot = open ? null : slot;
    h.redraw(k("item"));
  });
  const parts: HTMLElement[] = c ? [
    pickSel("prefix", "prefix", [opt(0, "No prefix", "–"), ...prefixOptions(c.id).map((p) => opt(p, `${prefixName(p)} · ${prefixEffect("equipment", c.id, p)}`, prefixName(p)))],
      c.prefix, (v) => set(withGear(c, { prefix: v }), k("prefix"))),
    itemBtn,
    pickSel("suffix", "suffix", [opt(0, "No suffix", "–"), ...suffixOptions(c.id, c.asc).map((x) => opt(x, `${suffixName(x)} · ${suffixEffect("equipment", x)}`, suffixName(x)))],
      c.suffix, (v) => set(withGear(c, { suffix: v }), k("suffix"))),
    pickSel("rank", "rank", gradeOptions(c.id).map((g) => opt(g, `Rank ${gradeLetter(g)}`, gradeLetter(g))), c.grade, (v) => set(withGear(c, { grade: v }), k("rank"))),
    pickSel("asc", "ascension", ascOptions(c.id).filter((a) => a === c.asc || isVisible("itemAscension", a)).map((a) => opt(a, `Asc ${a}`, `Asc ${a}`)),
      c.asc, (v) => set(withGear(c, { asc: v }), k("asc"))),
  ] : [itemBtn];
  return el("li", { class: `he-gear-line${open ? " open" : ""}` },
    el("span", { class: "slot-ico", role: "img", "aria-label": name, title: name }, GEAR_SLOT_ICONS[GEAR_SLOTS[slot - 1]]), ...parts);
}

/** The open slot's item table: region chips, then item / level / bonus stats rows (a row picks the item). */
function itemTable(s: EditSession, h: EditHooks, slot: number): HTMLElement {
  const name = GEAR_SLOT_NAMES[GEAR_SLOTS[slot - 1]];
  const choices = itemChoices(slot, Number(s.draft.level) || 1, {
    excluded: s.excluded, regionOf: (id) => regionOf("equipment", id)?.id ?? 1, visible: (id) => isVisible("equipment", id),
  });
  const current = configOf(String(s.draft.heroInventory?.[slot - 1] ?? "")).id;
  const chips = REGIONS.map((r) => {
    const on = !s.excluded.has(r.id);
    const b = el("label", { class: `chip-check reg-${r.id}` }, el("input", { type: "checkbox", ...(on ? { checked: "" } : {}), "data-focus-key": `he-reg${r.id}` }),
      regionName(r.id, r.full));
    const box = b.querySelector("input") as HTMLInputElement;
    box.checked = on;
    box.addEventListener("change", () => {
      if (box.checked) s.excluded.delete(r.id);
      else s.excluded.add(r.id);
      h.redraw(`he-reg${r.id}`);
    });
    return b;
  });
  const rows = choices.map((c) => {
    const label = shownItemName("equipment", c.id) ?? String(G.itemData.equipment[c.id]?.name);
    const pick = focusKey(el("button", { type: "button", class: "he-pick-item" }, rarityItemName(label, rarity("equipment", c.id, 0))), `he-it${c.id}`);
    const choose = () => {
      const out = gearCompact(pickItem(c.id));
      s.openSlot = null;
      if (out) h.change(withGearSlot(s.draft, slot, out), `he-g${slot}-item`);
    };
    pick.addEventListener("click", (e) => {
      e.stopPropagation();
      choose();
    });
    const tr = el("tr", { class: c.id === current ? "current" : "" }, el("td", {}, pick), el("td", { class: "num" }, String(c.level)),
      el("td", { class: "he-bonus" }, c.bonus.join(", ") || "–"));
    tr.addEventListener("click", choose);
    return tr;
  });
  return el("section", { id: "he-items", class: "he-items", "aria-label": `${name} items` },
    el("div", { class: "he-regions", role: "group", "aria-label": "Regions" }, ...chips),
    rows.length ? el("div", { class: "table-wrap he-items-wrap" }, el("table", { class: "he-items-table" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Item"), el("th", { scope: "col", class: "num" }, "Lvl"), el("th", { scope: "col" }, "Bonus stats"))),
      el("tbody", {}, ...rows)))
      : el("p", { class: "muted small" }, "No item matches."));
}

/** The six gear lines and, under them, the open slot's item table. */
export function gearEditor(s: EditSession, h: EditHooks): HTMLElement {
  return el("div", { class: "he-gear" },
    el("ul", { class: "he-gear-lines", "aria-label": "Gear" }, ...GEAR_SLOTS.map((_, i) => gearLine(s, h, slotNo(i)))),
    ...(s.openSlot ? [itemTable(s, h, s.openSlot)] : []));
}
