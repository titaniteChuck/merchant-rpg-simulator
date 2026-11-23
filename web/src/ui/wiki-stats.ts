/**
 * Wiki page "Stats" (#/stats, #/stats/<topic>, U25): how every number in the game is calculated, one section per
 * topic (wiki-ref.ts STAT_TOPICS). Every formula was read in the decompiled game (the references in
 * test/wiki-ref.test.ts `SOURCES`, not shown on the page) and matches the port in web/src/sim. Worked examples that use game data read it from G.
 */
import { G } from "../sim/data.ts";
import {
  bl, example, formula, frac, note, refPage, type RefSection, sl, STAT_TOPICS, type StatTopic, tbl, unsure, v, vars,
} from "./wiki-ref.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

// ---------------------------------------------------------------- the game's formulas, for the worked examples
// (test/wiki-ref.test.ts checks them against the port in web/src/sim)
const luaRound = (x: number, places = 0) => Math.floor(x * 10 ** places + 0.5) / 10 ** places;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
export const reduction = (def: number, pen = 0): number => 100 / (100 + Math.max(0, pen > 0 ? def * 0.01 * (100 - pen) : def));
/** Hit chance in % (obj.Combatant.lua receiveAttack). */
export const hitChance = (acc: number, eva: number): number => Math.min(100, luaRound(200 * acc / (acc + eva)));
/** Max action points (data.Default.lua heroMaxActionPoints). */
export const maxAp = (level: number, apMod = 0): number => 5 + Math.floor(Math.max(Math.min(level, 40) - 10, 0) / 2) + apMod;
/** Battle grade 1..5 of a won fight (questService.determineBattleGrade). */
export function battleGrade(avgLevel: number, region: number, levelReq: number, questType: number, turns: number, rare = false): number {
  let g = clamp(luaRound(1.3 + (avgLevel + region * 5) / (levelReq + region * 5), 2), 1, 4.5) - (rare ? 0.5 : 0);
  const r = region, t = turns;
  const bonus: Record<number, number> = {
    1: clamp(4 - t, -1, 2), 2: (4 + 2 * r - t) / 4, 3: (8 + 3 * r - t) / 4, 4: (12 + 3 * r - t) / 4,
    5: (16 + 4 * r - t) / 4, 6: (20 + 5 * r - t) / 4, 8: (20 + 5 * r - t) / 4,
  };
  g += bonus[questType] ?? 0;
  return clamp(luaRound(g), 1, 5);
}
/** Essence to ascend (data.Default.lua prestigeItemMaterial). */
export function ascendEssence(itemLevel: number, rarity: number, type: "equipment" | "map" | "consumable", upgrade = false, mods = 0): number {
  const frac10 = (itemLevel - 1) / 10 - Math.floor((itemLevel - 1) / 10);
  let n = type === "consumable" ? 2 + frac10 * 5 : 20 + frac10 * 50;
  n = luaRound(RARITY[rarity - 1] * n);
  if (upgrade) n *= 4 + mods;
  return luaRound(n);
}
/** [min, max] of a weapon / armour base stat (data.Default.lua baseStatFunc, a dropped or crafted item). */
export function baseStatRange(base: number, perLevel: number, itemLevel: number, grade: number, asc = 0, crafterExcess = 0): [number, number] {
  const L = itemLevel + [0, 40, 80][asc];
  const f = base + L * perLevel;
  const hi = GRADE_MAX[grade - 1];
  let lo = GRADE_MIN[grade - 1];
  if (crafterExcess > 0) lo = Math.min(hi, lo + (hi - lo) * 0.04 * crafterExcess);
  return [Math.ceil(f * lo), Math.ceil(f * hi)];
}

const RARITY = [1, 1.2, 1.5, 1.75, 2, 3, 4, 5];
const GRADE_MIN = [0.75, 0.9, 1, 1.1, 1.25];
const GRADE_MAX = [0.9, 1, 1.1, 1.2, 1.5];
const GRADE_BONUS = [0.6, 0.75, 1, 1.25, 1.5];
const GRADE_PARCEL = [1.25, 1.1, 1, 0.9, 0.75];
const GRADE_TIME = [1.25, 1.1, 1, 0.9, 0.75];
const CRAFT_SPEED = [1.1, 1, 0.9, 0.8, 0.75];
const LETTERS = ["D", "C", "B", "A", "S"];
const gradeHead = ["", ...LETTERS.map((l, i) => `${i + 1} <span class="grade grade-${l}">${l}</span>`)];

// ---------------------------------------------------------------- sections
const heroExample = (): string => {
  const w: Any = G.heroList?.[1];
  if (!w) return "";
  const L = 50;
  const hp = w.hp + w.hpPlv[1] * L, def = w.def + w.defPlv[1] * L, atk = w.atk + w.atkPlv[1] * L;
  return example(`A tier-1 ${w.name} at level ${L}, no gear, no passive: max HP = ${w.hp} + ${w.hpPlv[1]} × ${L} = <b>${hp}</b>,
    def = ${w.def} + ${w.defPlv[1]} × ${L} = <b>${def}</b>, atk = ${w.atk} + ${w.atkPlv[1]} × ${L} = <b>${atk}</b>.
    With 20 Str from gear: atk + 20 × ${w.strMod[1]} = <b>${atk + 20 * w.strMod[1]}</b>; with Might (+10 % atk) on top: <b>${luaRound((atk + 20 * w.strMod[1]) * 1.1, 1)}</b>.`);
};

export const STATS_SECTIONS: RefSection<StatTopic>[] = [
  {
    id: "hero-stats",
    html: () => `<p>A hero's stats are rebuilt from zero every time something changes, in this order:</p>
<ol class="ref-steps">
<li>The class growth of the hero's <b>tier</b> is read (tier = prestige level 1–3, shown on this site as ascension 0–2).</li>
<li><b>Permanent enchants</b> are added. Luck, XP, AP, crit damage and the % stats are reset just after, so enchants on those have no effect.</li>
<li>The <b>potion</b> (boost) is added.</li>
<li><b>Gear</b>, only items whose item level ≤ the hero's level: the weapon gives atk, matk, acc and crit; head, chest, bracers and feet give def and mdef; the talisman only its bonus stats. Every item adds its bonus stats (atk bonus → atk, HP bonus → max HP…).</li>
<li>In a map: the Str / Int / Dex scrolls' bonus.</li>
<li><b>Str, Int, Dex</b>: atk += str × strMod, matk += int × intMod, acc += dex × dexMod (class multipliers per tier).</li>
<li>The <b>passive</b>'s stats.</li>
<li><b>Class base + growth</b>: stat += base + growth<sub>tier</sub> × level, for HP, atk, matk, acc, def, mdef and crit.</li>
<li>In battle only: active buffs and debuffs (${bl("effects", "effects")}).</li>
<li>Max HP at least 1, crit at least 0, then the <b>% stats</b> multiply.</li>
</ol>
${formula(`${v("stat")} = (${v("base")} + ${v("growth")}<sub>tier</sub> × ${v("L")} + ${v("gear")} + ${v("enchants")} + ${v("potion")} + ${v("passive")} + ${v("str")} × ${v("strMod")}<sub>tier</sub>) × (1 + ${v("pct")})`)}
${vars([
  [v("base"), "the class's base stat"],
  [`${v("growth")}<sub>tier</sub>`, "the class's growth per level for the tier (hpPlv, atkPlv…); per-level enchants add to it"],
  [v("L"), "hero level (max 50 / 50 / 60 at tier 1 / 2 / 3)"],
  [`${v("str")} × ${v("strMod")}`, "atk only (int × intMod for matk, dex × dexMod for acc)"],
  [v("pct"), "sum of the % bonuses (gear, passive, effects), at least −90 % for atk, matk and HP, −100 % for def, mdef, acc"],
])}
${heroExample()}
${note(`Flat bonuses are all added before the % stats, so a % passive also multiplies gear and potions. Heroes have 0 evasion and no stat adds to it.`)}
<h3>Potions and enchants</h3>
<ul>
<li><b>Potion</b> (boost): one at a time; the same potion again adds its duration (3 charges unless the item says otherwise), another potion replaces it. One charge is used by each quest and by <b>each map room</b> fought. Usable from hero level item level − 5 − 4 × (tier − 1).</li>
<li><b>Enchant</b> (consumable used on a hero): permanent, flat or per level (Plv: +0.1 growth = +6 atk at level 60). At most 8 + 4 × (tier − 1) per hero; ascending the hero removes them.</li>
<li><b>Ascended</b> potions and enchants multiply their stats: ×2 / ×3 (asc 1 / 2) for atk, matk, acc, def, mdef, HP, str, int, dex, Plv and atk/matk/acc %; ×1.25 / ×1.5 for speed and crit; ×1.5 / ×2 for XP; ×1.75 / ×2.5 for luck. Rounded to whole numbers (Plv to 0.1, % to 0.01).</li>
</ul>`,
  },
  {
    id: "max-hp",
    html: () => `${formula(`${v("maxHP")} = max(1, ${v("hp")}<sub>class</sub> + ${v("hpPlv")}<sub>tier</sub> × ${v("L")} + ${v("HP bonus")}) × (1 + ${v("HP%")})`)}
${vars([
  [`${v("HP bonus")}`, "flat HP from gear bonus stats, the HP Boost potion and effects"],
  [v("HP%"), "passive (Juggernaut +25 %), gear and effects; at least −90 %"],
])}
<ul>
<li>The hero's HP never exceeds max HP outside a fight; a level-up refills it.</li>
<li>In a fight the hero uses its battle HP (it starts at its current HP). Heals stop at max HP except shields: ${bl("heals")}. HP in a map carries from room to room: ${bl("map-runs")}.</li>
<li>After a quest the hero keeps round(min(battle HP, HP before the quest)). A dead hero is revived for level × 10 gold (× tier from tier 2).</li>
<li><b>Enemy</b> max HP = round(questData HP × map multiplier × game-mode multiplier) × ${sl("quest-size", "quest size N")}.</li>
</ul>
${example(`Tier-1 Warrior, level 50, Juggernaut, +300 HP of gear: (100 + 10 × 50 + 300) × 1.25 = <b>1,125</b>.`)}`,
  },
  {
    id: "damage",
    html: () => `<p>Each skill sends a physical part ${v("P")}, a magical part ${v("M")} and a true part ${v("D")} (Basic: ${v("P")} = atk, ${v("M")} = matk; Slash: ${v("P")} = 1.6 × atk). A skill that names only one part sets the others to 0. On a split or row hit each target takes its share ${v("r")} of every part.</p>
${formula(`${v("damage")} = round(${v("P")}·${v("r")}·${v("m")}·${v("R")}<sub>def</sub>) + round(${v("M")}·${v("r")}·${v("m")}·${v("R")}<sub>mdef</sub>) + round(${v("D")}·${v("r")}·${v("m")}<sub>lucky</sub>)`)}
${vars([
  [v("r"), `share of the hit: 1, or 1/n when the enemy's hit is split over n heroes (${bl("targeting")})`],
  [v("m"), `${sl("crit", "crit or lucky multiplier")}: crit damage (2 base) or 1.35, else 1`],
  [`${v("m")}<sub>lucky</sub>`, "1.35 on a lucky hit, else 1: crits don't multiply true damage"],
  [`${v("R")}<sub>def</sub>, ${v("R")}<sub>mdef</sub>`, `${sl("defence", "defence reduction")} of the target's def and mdef`],
])}
<p>Order: the target's "on damage" effects scale the parts (Evade, Block…), then the ${sl("hit-chance", "hit roll")}, the ${sl("crit", "crit roll")}, the reduction, and last the target's "damage received" effects (shields absorb, Mana Shield…), and the total is rounded again.</p>
${example(`A Slash from a hero with 500 atk: ${v("P")} = 800. Against def 60: ${v("R")} = 100 / 160 = 0.625 → <b>500</b> damage; a crit (×2) → <b>1,000</b>.`)}`,
  },
  {
    id: "defence",
    html: () => `${formula(`${v("R")} = ${frac("100", `100 + ${v("def")}`)}`)}
${vars([
  [v("R"), "share of the physical part that goes through (mdef works the same on the magical part; true damage ignores both)"],
  [v("def"), `target's def (or mdef), never below 0; with penetration ${v("pen")} %: ${v("def")} × (100 − ${v("pen")}) / 100`],
])}
${tbl(["def", "0", "50", "100", "200", "300", "900"], [["damage taken", ...[0, 50, 100, 200, 300, 900].map((d) => `${luaRound(reduction(d) * 100, 1)} %`)]])}
<p>Each 100 def is worth +100 % HP against physical hits: effective HP = HP × (1 + def / 100).</p>
${note(`Penetration set as a skill parameter (Pulverize "defPen 45" and the like) has no effect: the attack keeps the lower of the skill's value and the attacker's own penetration, which is always 0. Only Magic Missile II's after-effect (mdef penetration 60 on the caster's next attack) applies.`)}`,
  },
  {
    id: "hit-chance",
    html: () => `${formula(`${v("hit")} = round(${frac(`200 × ${v("acc")}`, `${v("acc")} + ${v("eva")}`)}) %, capped at 100`)}
${vars([[v("acc"), "attacker's accuracy"], [v("eva"), "target's evasion"]])}
<p>The attack hits when ${v("hit")} ≥ a roll of 1–100, so the chance is exactly ${v("hit")} %. It is 100 % whenever ${v("acc")} ≥ ${v("eva")}.</p>
${tbl(["eva / acc", "1", "1.5", "2", "3", "5"], [["hit chance", ...[1, 1.5, 2, 3, 5].map((r) => `${hitChance(100, 100 * r)} %`)]])}
<ul>
<li>Damage over time always hits, and some skills set their own hit chance (Soul Barrier's reflected hit: 100).</li>
<li>Enemies have 100 acc; heroes have 0 evasion, so enemy attacks always hit heroes. Dodges come from effects (Elusion 50 %, Evade): ${bl("buffs-debuffs")}.</li>
</ul>
${example(`A hero with 150 acc against an enemy with 300 eva: round(30,000 / 450) = <b>${hitChance(150, 300)} %</b>.`)}`,
  },
  {
    id: "crit",
    html: () => `<p>One roll ${v("d")} from 1 to 100 decides both:</p>
${formula(`crit if ${v("d")} ≤ ${v("crit")} → × max(${v("critMod")}, 1); &nbsp; else lucky if ${v("d")} − ${v("crit")} ≤ 1.6 × ${v("luck")} → × 1.35`)}
${vars([
  [v("crit"), "crit chance in points (= %): class base + growth × level, weapon crit, crit bonuses, passives (Critical Eye +12), potion"],
  [v("critMod"), "crit damage: 2 base, + bonuses (Critical Strike +0.35 → 2.35)"],
  [v("luck"), `the attacker's own ${sl("luck")}`],
])}
<ul>
<li>P(crit) = min(${v("crit")}, 100) %; P(lucky) ≈ min(1.6 × ${v("luck")}, 100 − ${v("crit")}) %.</li>
<li>A crit multiplies the physical and magical parts only; a lucky hit also multiplies true damage. A hit with only true damage can't crit (its lucky window starts at 1).</li>
<li>Enemies have crit 0 and no luck: they never crit nor land lucky hits (unless an effect gives them crit).</li>
</ul>
${example(`crit 25, luck 10: rolls 1–25 crit (<b>25 %</b>), 26–41 lucky (<b>16 %</b>), 42–100 normal (59 %).`)}`,
  },
  {
    id: "ap",
    html: () => `${formula(`${v("AP")} = 5 + ⌊${frac(`max(min(${v("L")}, 40) − 10, 0)`, "2")}⌋ + ${v("AP bonus")}`)}
${vars([[v("L"), "hero level"], [v("AP bonus"), "gear and passive AP (Wisdom +2); enchants on AP have no effect"]])}
${tbl(["level", "≤ 11", "12", "20", "25", "30", "≥ 40"], [["AP", ...[11, 12, 20, 25, 30, 40].map((l) => maxAp(l))]])}
<ul>
<li>The 5 rotation slots' AP costs must add up to at most ${v("AP")}; otherwise the game resets the rotation and passive to the class default.</li>
<li>Skills unlocked: none before level 10, then the first min(⌊(${v("L")} − 5) / 5⌋, n − 1) of the class list, all of them past level 50.</li>
</ul>
${example(`Level 25: 5 + ⌊15 / 2⌋ = <b>${maxAp(25)}</b> AP; with Wisdom, <b>${maxAp(25, 2)}</b>.`)}`,
  },
  {
    id: "luck",
    html: () => `<p>A hero's luck = class luck (Bard 10, others 0) + gear luck + Luck potion. Enchants on luck have no effect. <b>Party luck</b> = the sum over the heroes in the fight (dead ones included).</p>
${tbl(["Luck affects", "How"], [
  ["Lucky hits", `the attacker's own luck: 1.6 × luck % of hits deal × 1.35 (${sl("crit", "crit and lucky hits")})`],
  ["Fixed rewards", `quantity = clamp(round((${v("x")} + party luck) / 10), 0, 5): every 10 luck = +1 item (${sl("grade", "grade")})`],
  ["Parcels", "nothing weight = max(nilOdds × parcel grade bonus − party luck, 1): fewer empty rolls"],
  ["Rare enemy next time", `chance = round((abRand + 2 × (grade − 2)) × (1 + min(4 × luck, 200) / 100)) %`],
  ["Map essence", `× (1 + party luck / 100), the party of the last fight (${sl("map-essence")})`],
  ["Treasure rooms", "only the map's own luck (prefix): chance × (1 + 0.1 × luck)"],
  ["Gold, XP, crafting, selling", "nothing"],
])}
${example(`3 heroes with 10 luck each = 30 party luck: a fixed reward roll of 18 (1.8 items) becomes round(48 / 10) = <b>5</b>; a parcel whose nothing-weight is 100 at grade B drops to <b>70</b>.`)}`,
  },
  {
    id: "grade",
    html: () => `<p>A won fight gets a grade from 1 (D) to 5 (S); a lost one 0.</p>
${formula(`${v("g")} = clamp(round(1.3 + ${frac(`${v("avgL")} + 5${v("r")}`, `${v("levelReq")} + 5${v("r")}`)}, 2), 1, 4.5) − 0.5<sub>rare</sub> + ${v("turn bonus")}, &nbsp; grade = clamp(round(${v("g")}), 1, 5)`)}
${vars([
  [v("avgL"), "average level of the heroes in the fight"], [v("r"), "the quest's region (1–6)"], [v("levelReq"), "the quest's level"],
  [v("turn bonus"), `by the quest's type, with ${v("T")} = turns the fight took:`],
])}
${tbl(["quest type", "1", "2", "3", "4", "5", "6, 8"], [["turn bonus", "clamp(4 − T, −1, 2)", "(4 + 2r − T) / 4", "(8 + 3r − T) / 4", "(12 + 3r − T) / 4", "(16 + 4r − T) / 4", "(20 + 5r − T) / 4"]])}
<p>What the grade multiplies:</p>
${tbl(gradeHead, [
  ["Fixed rewards, map essence", ...GRADE_BONUS],
  ["Parcel nothing-weight", ...GRADE_PARCEL],
  ["Quest time, map fight time", ...GRADE_TIME],
])}
<ul>
<li>A lost room counts grade 0 (time × 2). A map's grade = max(⌊average of its rooms' grades⌋, 1).</li>
<li>Items and crafts have their own grade, with other tables: ${sl("item-stats")}, ${sl("craft")}.</li>
</ul>
${example(`Party of level 30 on a level-30 region-3 type-3 quest won in 10 turns: round(1.3 + 45 / 45, 2) = 2.3, + (8 + 9 − 10) / 4 = 1.75 → 4.05 → grade <b>${battleGrade(30, 3, 30, 3, 10)} (A)</b>.`)}`,
  },
  {
    id: "time",
    html: () => `${formula(`${v("quest time")} = (5 × ${v("actions")} + 5 × ${v("turns")} + ${v("time")} × ${v("N")} × gradeTime<sub>g</sub>) × (1 − min(${frac(v("speed"), "100")}, 0.75))`)}
${vars([
  [`${v("actions")}, ${v("turns")}`, "actions taken and turns of the fight (5 s each)"],
  [v("time"), "the quest's base time"], [v("N"), sl("quest-size", "quest size")], [`gradeTime<sub>g</sub>`, `by the fight's ${sl("grade")}: 1.25 … 0.75`],
  [v("speed"), "sum of the party's speed (gear, Speed potion); at most −75 %"],
])}
<p><b>Map runs</b>, per room: fight = round((5 × actions + 5 × turns) × gradeTime<sub>g</sub> × (1 − speed')), walk = round(baseTime / rooms × (1 − speed')), with speed' = party speed + the map's speed (Speed scroll +20), capped 75 %.</p>
<p>The Quick game mode multiplies quest time by 0.25.</p>
${example(`A 300 s quest, ×1, won at grade A in 4 turns with 20 actions, party speed 30: (100 + 20 + 300 × 0.9) × 0.7 = <b>273 s</b>.`)}`,
  },
  {
    id: "quest-size",
    html: () => `<p>A quest can be run ×${v("N")}: still <b>one</b> enemy, with ${v("N")} × its max HP (its other stats don't change). ${v("N")} ≤ 2 × tier − 1 (1, 3 or 5; Quick mode: 3 × tier + 1) and ≤ what the gold allows; a rare variant is always ×1.</p>
${tbl(["×N multiplies", "How"], [
  ["Enemy max HP", "× N (one fight, longer)"],
  ["Gold cost", "gold × N"],
  ["Quest time", `base time × N (not the fight part): ${sl("time")}`],
  ["XP", `round(exp / heroes) × N: ${sl("xp")}`],
  ["Fixed rewards", "quantity (after the 0–5 cap) × N"],
  ["Parcels", "each entry's weight × N (the nothing-weight stays), material amounts rolled N times or × N; an equipment drop stays 1. Still one roll per parcel."],
])}
${unsure(`Which hero's tier sets the cap in a party: the game computes the cap from one hero; the screen that picks it was not traced.`)}
${example(`×3 on a 2,000 HP enemy: one 6,000 HP fight, 3 × the gold, 3 × the fixed rewards, and each parcel entry 3 times as likely against the same nothing-weight.`)}`,
  },
  {
    id: "xp",
    html: () => `${formula(`${v("exp")} ← ⌊${v("exp")} + round(${frac(`${v("exp")}<sub>quest</sub>`, v("heroes"))}) × ${v("N")} × (1 + ${frac(v("XP%"), "100")}) × ${v("mode")}⌋`)}
${vars([
  [`${v("exp")}<sub>quest</sub>`, "the quest's XP (the rare variant's when rare)"], [v("heroes"), "heroes that started the fight"], [v("N"), sl("quest-size", "quest size")],
  [v("XP%"), "class (Bard 10), gear, passive (Wisdom 5) and XP Boost potion (+30 / +60 / +100); enchants don't count"], [v("mode"), "1 (Quick mode: 4)"],
])}
<ul>
<li>Only heroes alive at the end of a won quest get XP; a hero at its tier's max level (50 / 50 / 60) gets none.</li>
<li><b>Map rooms</b>: each won room gives round(exp × map modifier × 0.2 / heroes) to each hero alive.</li>
<li>Each level needs the XP of the tier's level table; leftover XP carries over; a level-up refills HP (also in a map).</li>
</ul>
${example(`A 900 XP quest ×3 with 6 heroes: round(900 / 6) × 3 = 450 each; a Bard gets ⌊450 × 1.1⌋ = <b>495</b>.`)}`,
  },
  {
    id: "item-stats",
    html: () => `<p><b>Base stats</b> (weapon atk / matk / acc, armour def / mdef) come from the item's sub-type (sword, staff, helmet…):</p>
${formula(`${v("f")} = ${v("base")} + ${v("L")}' × ${v("perLevel")}, &nbsp; ${v("L")}' = item level + 0 / 40 / 80 (ascension 0 / 1 / 2), &nbsp; stat ∈ [⌈${v("f")} × gMin⌉, ⌈${v("f")} × gMax⌉]`)}
${tbl(gradeHead, [["gMin", ...GRADE_MIN], ["gMax", ...GRADE_MAX]])}
<ul>
<li>The stat is a random whole number in that range. A crafter above the item's level (${v("d")} levels) raises the low end by (gMax − gMin) × 4 % per level, so from 25 levels up it always rolls the top.</li>
<li>Weapon crit is flat (Dagger 5, most weapons 1). Talismans have no base stats.</li>
</ul>
<p><b>Bonus stats</b>: each equipment has ranges [${v("a")}, ${v("b")}].</p>
<ul>
<li>Flat bonuses: [${v("a")} × gMin, ${v("b")} × gMax]. <b>% bonuses</b> (−1 &lt; ${v("a")} &lt; 1): [${v("a")}, ${v("b")}] whatever the grade.</li>
<li>× the ascension multiplier: Str, Int, Dex, atk, matk, HP ×1.75 / ×2.5; acc, def, mdef ×1.5 / ×2; crit ×1.1 / ×1.2; luck, XP, % stats, crit damage ×1.25 / ×1.5; AP and speed ×1.</li>
<li>A crafter above the item's level raises the low end by 4 % of the range per level, up to 92 % of the top. Both ends rounded up, then a random whole number (hundredths for %).</li>
</ul>
<p><b>Modifiers</b>: a prefix adds its stats; a suffix multiplies the stats it names by (1 + value), rounded up. Each modifier raises the rarity one step (up to 6, or up to 8 from 7) and its cost and craft time by (1 + its sell value). Odds: ${sl("craft")}, ${sl("enchant")}.</p>
${example(`A Sword (18 + 1 per level) of level 20 at grade B: ${v("f")} = 38 → atk <b>${baseStatRange(18, 1, 20, 3).join("–")}</b>; at grade S <b>${baseStatRange(18, 1, 20, 5).join("–")}</b>; ascended once (level 60 for stats), grade B: <b>${baseStatRange(18, 1, 20, 3, 1).join("–")}</b>.`)}`,
  },
  {
    id: "sell",
    html: () => `${formula(`equipment, map: round(${v("value")} × 2${v("asc")} × rarityMod<sub>rarity</sub>) &nbsp;·&nbsp; material, consumable: round(${frac(`${v("sell")}<sub>min</sub> + ${v("sell")}<sub>max</sub>`, "2")} × 2${v("asc")}) × ${v("amount")}`)}
${vars([
  [v("value"), "the item's value (its cost when it has none)"], [`2${v("asc")}`, "× 2 at ascension 1, × 4 at ascension 2 (× 1 when not ascended)"],
  [`rarityMod<sub>rarity</sub>`, "by the item's rarity after modifiers:"],
])}
${tbl(["rarity", "1", "2", "3", "4", "5", "6", "7", "8"], [["× value", ...RARITY]])}
<ul>
<li>Only the <b>number</b> of modifiers changes the price (one rarity step each, capped at 6, or 8 from 7), not which ones; the grade doesn't change it either.</li>
<li>A customer pays base × (1 + 2 × preference / 100) × (1 + (haggle position − 3) / 10), position 1–5.</li>
</ul>
${example(`Value 1,000, rarity 4, ascended once, with one modifier (rarity 5): 1,000 × 2 × 2 = <b>4,000</b>.`)}`,
  },
  {
    id: "craft",
    html: () => `${formula(`gold = ${v("cost")} × ${v("count")}, &nbsp; time = ⌈⌊${v("runTime")} × craftSpeed<sub>g</sub>⌋ × ${v("count")} × ${v("mode")}⌉ s`)}
${formula(`${v("g")} = clamp(round(${frac(`${v("start")} + ${v("ingredients")} + 0.25`, "2")}), 1, 5), &nbsp; ${v("start")} = clamp(round(1 + ${frac(`${v("C")} − ${v("L")}`, "4")}, 2), 1, 4.5)`)}
${vars([
  [v("C"), "crafter level (its ascension level for an item of the crafter's ascension)"], [v("L"), "item level"],
  [v("ingredients"), "average grade of the ingredients used (quest drops carry the fight's grade)"], [v("mode"), "1 (Quick mode: 0.25)"],
])}
${tbl(gradeHead, [["craftSpeed", ...CRAFT_SPEED]])}
<ul>
<li>Gold is not scaled by ascension. An ascended craft also uses ${sl("essence")} (× count) and ingredients of the same ascension.</li>
<li><b>Modifiers</b> on a fresh item (equipment only at grade ≥ 3, maps always, never consumables), with ${v("E")} = round(${v("C")} + 2${v("g")} − 4): prefix odds = min(2(${v("E")} − ${v("L")}), 25), suffix odds = min(2(${v("E")} − ${v("L")}), 40). Modded ingredients: +20 to both prefix values; +3 per suffix tier to both suffix values. A roll succeeds when the odds &gt; 1–100, so the chance is odds − 1 %.</li>
<li>Ascending an existing item takes item level × 60 s.</li>
</ul>
${example(`A level-60 crafter on a level-40 item with grade-3 ingredients: ${v("start")} = clamp(6, 1, 4.5) = 4.5 → ${v("g")} = round(7.75 / 2) = 4 (A): time × 0.8.`)}`,
  },
  {
    id: "essence",
    html: () => `${formula(`essence = round(rarityMod<sub>rarity</sub> × (20 + 50${v("φ")})) × (4 + ${v("mods")})<sub>upgrade</sub>, &nbsp; ${v("φ")} = ${frac(`${v("L")} − 1`, "10")} − ⌊${frac(`${v("L")} − 1`, "10")}⌋`)}
${vars([
  [v("φ"), "where the item level sits in its band of 10 (level 1 → 0, level 10 → 0.9)"], ["20 + 50φ", "equipment and maps; consumables: 2 + 5φ"],
  [`(4 + ${v("mods")})`, "only to upgrade an existing item: × 4, +1 with a prefix, +1 with a suffix"],
])}
<p>Which essence: region = min(⌊(${v("L")} − 1) / 10⌋ + 1, 6): Forest, Water, Earth, Necro, Fire, Glacial essence for ascension 1; Nature, Tidal, Mountain, Death, Inferno, Arctic for ascension 2. The essence count doesn't depend on the item's value. Ascended items also pay round(rarityMod × (2 + 10${v("φ")})) essence per ${sl("enchant", "Enchanter attempt")}.</p>
${example(`A level-25 rarity-3 equipment: ${v("φ")} = 0.4 → round(1.5 × 40) = <b>${ascendEssence(25, 3, "equipment")}</b> to craft it ascended; <b>${ascendEssence(25, 3, "equipment", true)}</b> to upgrade a plain one, <b>${ascendEssence(25, 3, "equipment", true, 1)}</b> with a prefix (its rarity is then 4: <b>${ascendEssence(25, 4, "equipment", true, 1)}</b>).`)}`,
  },
  {
    id: "enchant",
    html: () => `<p>The Enchanter (on an existing equipment or map, up to level 60) has three actions, each with its own attempt counter ${v("a")} (+1 per try, back to 0 after a break). ${v("E")} = Enchanter level (its ascension level for an item of its ascension), ${v("L")} = item level, ${v("g")} = item grade. Success when the odds &gt; a roll of 1–100 (chance odds − 1 %); a break roll only follows a failure.</p>
${tbl(["Action", "Gold", "Success odds", "Break"], [
  ["Prefix", `40${v("L")} (prefixed: − 10 × prefix level, ≥ 20${v("L")})`, `clamp(round(2(${v("E")} − ${v("L")}) + 2${v("g")} [+15 if prefixed]), 10, 80)`, `prefixed only: min(4${v("a")}, 40) %, prefix lost`],
  ["Suffix", `60${v("L")} (+ 20 × suffix level if suffixed)`, `clamp(2(${v("E")}' − next tier's level), 10, 95), ${v("E")}' = round(${v("E")} + 10 + 2${v("a")} + 4${v("g")})`, `min(4${v("a")}, 100) %, one tier down`],
  ["Reset", `20${v("L")} + 20${v("a")}`, `always: new grade clamp(round(start(${v("E")} + 5, ${v("L")}) + 0.4${v("a")}), max(${v("g")} − 1, 1), 5), stats re-rolled`, "–"],
])}
<ul>
<li>Plus runes of the item's level band (≤ 10, ≤ 20 … ≤ 60): 1 + fib(min(${v("a")}, 5)) = 1, 2, 2, 3, 4, 6 for ${v("a")} = 0…5+.</li>
<li>A suffix success climbs one tier (+1 … +16, then *1 … *8 on ascended items; an asc-2 item at +16 jumps to **1).</li>
<li>Time: prefix 10${v("L")} s, suffix 5${v("L")} s, reset 2.5${v("L")} s. Ascended items also pay essence: ${sl("essence")}.</li>
</ul>
${note(`An item that never had a suffix compares against level 0 for its first suffix try (the code sets its suffix to 0 then).`)}
${example(`Level-60 Enchanter, level-40 grade-3 item without prefix: prefix odds = 2 × 20 + 6 = 46 → <b>45 %</b> per try, 1,600 gold + 1 rune the first time.`)}`,
  },
  {
    id: "map-essence",
    html: () => `${formula(`essence = round(gradeBonus<sub>G</sub> × ${v("amount")} × ${v("essenceBase")} × (1 + ${frac(v("luck"), "100")})), &nbsp; ${v("essenceBase")} = (1 + prefix sell) × (1 + suffix atk)`)}
${vars([
  [v("G"), `map grade = max(⌊average room ${sl("grade")}⌋, 1); gradeBonus 0.6 / 0.75 / 1 / 1.25 / 1.5`], [v("amount"), "the map's base reward per essence type"],
  [v("essenceBase"), "×(1 + sell) for a prefix, ×(1 + its atk) for a suffix tier (+1 ×1.1 … +16 ×1.85, *8 ×2.6), × the prefix's essence modifier if any"],
  [v("luck"), `party ${sl("luck")} of the last fight`],
])}
<p>Paid only when every room is won (not after an Escape scroll). An asc-1 map gives the asc-2 essence of the same region.</p>
<p><b>Enemy strength</b>: ${v("M")} = round(enemyMod × 1 / 2 / 3 (map ascension 0 / 1 / 2), 2), + 0.1 at grade A, + 0.25 at grade S, × (1 + suffix atk), + a prefix's enemy modifier. Then with ${v("m")} = (${v("M")} − 1) / 2:</p>
${formula(`HP × 1.5${v("m")}, &nbsp; atk, matk × ${v("m")}, &nbsp; def, mdef, eva × (0.75 + 0.25${v("m")}), &nbsp; enemy stat = round((base + prefix flat bonus) × multiplier × prefix %)`)}
<ul>
<li>Rooms = base amount ± 1 (random), − 1 at grade ≤ 2, + 1 at grade ≥ 4; the last room is the boss. A treasure room appears with (0 / 0 / 1 / 8 / 10 % by grade) × rooms, × (1 + 0.1 × the map's luck).</li>
<li>Each room enemy is rare with chance about abRand % (a roll of 0–100 below abRand; the boss by the map's flag); prefix flat bonuses scale with the map tier ⌈level / 10⌉.</li>
</ul>
${note(`The table has −0.2 for grade 1, but the code tests "grade &lt; 3" first, so grades 1–3 all add 0.`)}
${example(`${v("M")} = 3: ${v("m")} = 1 → HP ×1.5, atk ×1, def ×1. ${v("M")} = 5: ${v("m")} = 2 → HP ×3, atk ×2, def ×1.25.`)}`,
  },
];

export function statsPage(topic?: string): HTMLElement {
  return refPage("stats", "Stats",
    STAT_TOPICS, STATS_SECTIONS, topic);
}
