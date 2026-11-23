/**
 * Recipe chain diagram (U19): boxes and arrows, ingredients on the left, the item on the right. Only craftable
 * ingredients get a box (raw materials stay in the recipe list). HTML + CSS only (style.css "wiki v3"): each node is a
 * row "[its ingredients' column] → [box]", the connectors are borders, so the frame scrolls sideways on a phone.
 */
import { el, fmt } from "./dom.ts";
import { itemLink } from "./wiki-data.ts";
import { durationText, type RecipeNode, recipeTree } from "./wiki-items.ts";
import { G } from "../sim/data.ts";

const crafterName = (id: number): string => (G as unknown as { crafterData?: Record<number, { name?: string }> }).crafterData?.[id]?.name ?? "";

function box(n: RecipeNode, root: boolean): HTMLElement {
  const own = durationText(n.time);
  const total = durationText(n.totalTime);
  const crafter = crafterName(n.crafterID);
  return el("div", { class: `rc-box rar-${n.rarity}${root ? " rc-root" : ""}` },
    el("div", { class: "rc-name" }, itemLink(n.type, n.id)),
    el("dl", { class: "rc-facts" },
      el("div", {}, el("dt", {}, "Cost"), el("dd", {}, `${fmt.format(n.cost)} g`)),
      el("div", {}, el("dt", {}, "Craft"), el("dd", {}, own)),
      ...(n.kids.length ? [el("div", { class: "rc-total" }, el("dt", {}, "Total"), el("dd", { title: `${durationText(n.totalTime)} and ${fmt.format(n.totalCost)} g for one, every craftable ingredient made first` }, total))] : [])),
    ...(crafter ? [el("p", { class: "rc-who" }, `${crafter} · level ${n.level}`)] : []));
}

function node(n: RecipeNode, root = false): HTMLElement {
  if (!n.kids.length) return el("div", { class: "rc-node" }, box(n, root));
  const kids = n.kids.map((k) => el("div", { class: "rc-kid" }, node(k),
    el("span", { class: "rc-amt", title: `${k.amount} needed per ${n.name}` }, `×${k.amount}`)));
  return el("div", { class: "rc-node" }, el("div", { class: `rc-kids${kids.length === 1 ? " rc-one" : ""}` }, ...kids), box(n, root));
}

/** The diagram for an item, or null when it is not crafted. */
export function recipeChain(type: string, id: number): HTMLElement | null {
  const t = recipeTree(type, id);
  if (!t || !t.time && !t.kids.length && !t.raw.length) return null;
  const label = `Crafting chain of ${t.name}: ${t.depth} step${t.depth > 1 ? "s" : ""}, ${durationText(t.totalTime)} and ${fmt.format(t.totalCost)} gold in all`;
  return el("div", {},
    el("div", { class: "rc-frame", role: "group", "aria-label": label, tabindex: "0" }, el("div", { class: "rc-tree" }, node(t, true))),
    el("p", { class: "muted small" }, t.kids.length
      ? `Total = its own craft plus every craftable ingredient (× the amount needed) made first, one after the other: `
        + `${durationText(t.totalTime)} and ${fmt.format(t.totalCost)} g for one. `
        + "Base times (grade C); a craft takes ×1.1 at grade D down to ×0.75 at grade S, × the number made. Raw materials are in the recipe below."
      : "No craftable ingredient: only raw materials (below). Base time (grade C); ×1.1 at grade D down to ×0.75 at grade S."));
}
