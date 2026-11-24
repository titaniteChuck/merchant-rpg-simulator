/**
 * Recipe chain diagram (U19): boxes and arrows, ingredients on the left, the item on the right. Only equipment gets a
 * box ("let's stick to equippable items"): raw materials and crafted materials such as ingots stay in the recipe list,
 * but the time and gold to craft those materials still count in each box's Total. An equipment item whose crafted
 * ingredients are all materials shows as a single box (its Total still tells the whole crafting time).
 * HTML + CSS only (style.css "wiki v3"): each node is a row "[its ingredients' column] → [box]", the connectors are
 * borders, so the frame scrolls sideways on a phone.
 */
import { G } from "../sim/data.ts";
import { el, fmt } from "./dom.ts";
import { itemLink } from "./wiki-data.ts";
import { durationText, type RecipeNode, recipeTree } from "./wiki-items.ts";
import { crafterName as crafterOf, itemName } from "./names.ts";
import { statLink } from "./wiki-ref.ts";

const crafterName = (id: number): string => crafterOf(id) ?? "";

/** "4 × Adaman Ingot · 1 min each" (R1 F40: no English glue around a translated name). */
const hiddenText = (n: RecipeNode) =>
  n.hidden.map((h) => `${h.amount} × ${itemName(h.type, h.id) ?? `${h.type} #${h.id}`} · ${durationText(h.time)} each`).join(", ");

/**
 * The line under a recipe: "Alchemist · 10 g · 15 s · 8 XP", cost and time a link to Stats › Craft. R1 F07: the time
 * goes through durationText (15 s, not "0 min"). Empty when the item has no crafter, cost, time or XP.
 */
export function craftLine(type: string, id: number): (Node | string)[] {
  const it = G.itemData?.[type]?.[id];
  if (!it) return [];
  const costTime = [it.cost ? `${fmt.format(it.cost)} g` : "", it.runTime ? durationText(it.runTime) : ""].filter(Boolean).join(" · ");
  const parts: (Node | string)[] = [crafterName(it.crafterID ?? 0), costTime ? statLink("craft", costTime) : "",
    it.experience ? `${fmt.format(it.experience)} XP` : ""].filter((x) => x !== "");
  return parts.flatMap((p, i) => (i ? [" · ", p] : [p]));
}

function totalTip(n: RecipeNode): string {
  const what = [n.kids.length ? "the equipment ingredients on its left" : "", n.hidden.length ? `the crafted materials, not drawn: ${hiddenText(n)}` : ""]
    .filter(Boolean).join(", and ");
  return `${durationText(n.totalTime)} and ${fmt.format(n.totalCost)} g for one: its own craft plus ${what}, made first, one after the other.`;
}

function box(n: RecipeNode, root: boolean): HTMLElement {
  const crafter = crafterName(n.crafterID);
  const hasTotal = n.totalTime > n.time;
  return el("div", { class: `rc-box rar-${n.rarity}${root ? " rc-root" : ""}`, ...(hasTotal ? { title: totalTip(n) } : {}) },
    el("div", { class: "rc-name" }, itemLink(n.type, n.id)),
    el("dl", { class: "rc-facts" },
      el("div", {}, el("dt", {}, "Cost"), el("dd", {}, `${fmt.format(n.cost)} g`)),
      el("div", {}, el("dt", {}, "Craft"), el("dd", {}, durationText(n.time))),
      ...(hasTotal ? [el("div", { class: "rc-total" }, el("dt", {}, "Total"), el("dd", {}, durationText(n.totalTime)))] : [])),
    ...(crafter ? [el("p", { class: "rc-who" }, `${crafter} · level ${n.level}`)] : []));
}

function node(n: RecipeNode, root = false): HTMLElement {
  if (!n.kids.length) return el("div", { class: "rc-node" }, box(n, root));
  const kids = n.kids.map((k) => el("div", { class: "rc-kid" }, node(k),
    el("span", { class: "rc-amt", title: `×${k.amount} → ${itemName(n.type, n.id) ?? n.name}` }, `×${k.amount}`)));
  return el("div", { class: "rc-node" }, el("div", { class: `rc-kids${kids.length === 1 ? " rc-one" : ""}` }, ...kids), box(n, root));
}

/** The diagram for a crafted equipment item, or null (other item types, or not crafted). */
export function recipeChain(type: string, id: number): HTMLElement | null {
  if (type !== "equipment") return null;
  const t = recipeTree(type, id);
  if (!t || !t.time) return null;
  const label = `Crafting chain · ${itemName(t.type, t.id) ?? t.name} · ${t.depth} equipment step${t.depth > 1 ? "s" : ""}, ${durationText(t.totalTime)} and ${fmt.format(t.totalCost)} gold in all`;
  return el("div", {},
    el("div", { class: "rc-frame", role: "group", "aria-label": label, tabindex: "0" }, el("div", { class: "rc-tree" }, node(t, true))),
    el("p", { class: "muted small" },
      "Only equipment is drawn. Total = its own craft plus every crafted ingredient (× the amount needed) made first, one after the other, "
      + `crafted materials such as ingots included (hover a box for the breakdown): ${durationText(t.totalTime)} and ${fmt.format(t.totalCost)} g for one. `
      + "Base times (grade C); a craft takes ×1.1 at grade D down to ×0.75 at grade S, × the number made. Materials are in the recipe below."));
}
