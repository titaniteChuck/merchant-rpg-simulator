/**
 * Wiki page "Battle" (#/battle, #/battle/<topic>, U25): how a fight runs, one section per topic (wiki-ref.ts
 * BATTLE_TOPICS), with links to the Stats page wherever a formula is involved. Read from the decompiled game (the
 * `src` lines, checked by test/wiki-ref.test.ts); the port in web/src/sim does the same (400/400 Lua-parity map runs).
 */
import { BATTLE_TOPICS, type BattleTopic, bl, example, formula, note, refPage, type RefSection, sl, tbl, unsure, v } from "./wiki-ref.ts";

/** The six party places as the game numbers them, beside the enemy. */
const placesFigure = `<figure class="ref-places" aria-label="Party places: back row 1, 3, 5; front row 2, 4, 6; the enemy faces the front row">
<div class="ref-grid">
<span class="ref-colhead">Back row</span><span class="ref-colhead">Front row</span><span class="ref-colhead">Enemy</span>
<span class="ref-place">B1 <small>place 1</small></span><span class="ref-place ref-front">F1 <small>place 2</small></span><span class="ref-place ref-foe">👹 one enemy</span>
<span class="ref-place">B2 <small>place 3</small></span><span class="ref-place ref-front">F2 <small>place 4</small></span>
<span class="ref-place">B3 <small>place 5</small></span><span class="ref-place ref-front">F3 <small>place 6</small></span>
</div>
<figcaption class="small muted">Row 1 = places 1 and 2, row 2 = 3 and 4, row 3 = 5 and 6.</figcaption>
</figure>`;

const chips = (names: string[]) => `<ol class="ref-order">${names.map((n) => `<li${n.startsWith("Enemy") ? ' class="ref-foe"' : ""}>${n}</li>`).join("")}</ol>`;

export const BATTLE_SECTIONS: RefSection<BattleTopic>[] = [
  {
    id: "setup",
    html: () => `<p>A quest is one fight between a party of up to 6 heroes and <b>one</b> enemy. A map is a series of such fights (${bl("map-runs", "map runs")}).</p>
${placesFigure}
<ul>
<li>A hero joins only with more than 0 HP: its current HP (in a map, the HP it carries). HP is not refilled for the fight.</li>
<li>At setup each hero's effects are cleared and its stats rebuilt (${sl("hero-stats")}).</li>
<li>The enemy: the quest's HP, atk, matk, def, mdef and eva (the rare variant's when rare), × the map's multipliers in a map (${sl("map-essence")}), max HP × ${sl("quest-size", "N")}; acc 100, crit 0, crit damage 2. It starts at full HP.</li>
</ul>`,
    src: [["obj.combat.Battle.lua", 46, "self:setupHero(self.backRow[n], n * 2 - 1)"], ["obj.combat.Battle.lua", 62, "if 0 < currentHp then"], ["obj.combat.Battle.lua", 63, "hero:resetStats()"],
      ["obj.Enemy.lua", 75, "math.round(statValue * default.enemyMods[k])"], ["obj.Enemy.lua", 78, "self.acc = 100"]],
  },
  {
    id: "turn-order",
    html: () => `<p>The order is fixed once, at the start of the fight, from the heroes alive then:</p>
${chips(["B1", "F1", "B2", "F2", "B3", "F3", "Enemy"])}
<p>On <b>first-attack</b> quests (quest type 6) the enemy goes first:</p>
${chips(["Enemy (first attack)", "B1", "F1", "B2", "F2", "B3", "F3"])}
<ul>
<li>A turn is everyone acting once in that order. A combatant at 0 HP is skipped (its slot in the order stays).</li>
<li>The fight's end is only checked after the whole turn, so heroes after the killing blow still act (${bl("battle-end")}).</li>
<li>An action counts even when a stun skips it; the number of actions sets part of the ${sl("time", "quest time")}.</li>
</ul>`,
    src: [["obj.combat.Battle.lua", 129, "function Battle:determineTurnOrder"], ["obj.combat.enemiesService.lua", 11, "return enemyType == 6"],
      ["obj.combat.Battle.lua", 109, "self.turnOrder[actionNum].questHP > 0"], ["obj.combat.Battle.lua", 112, "self.actions = self.actions + 1"]],
  },
  {
    id: "rotation",
    html: () => `<p>Each hero has a rotation of 5 skills, the enemy too. All share <b>one</b> turn counter:</p>
${formula(`slot = ((${v("turn")} − 1) mod 5) + 1`)}
${tbl(["turn", "1", "2", "3", "4", "5", "6", "7", "…"], [["slot played", 1, 2, 3, 4, 5, 1, 2, "…"]])}
<ul>
<li>Hero slot <i>k</i> always meets enemy slot <i>k</i>: a fight is a 5-turn timetable, which is why a skill's place in the rotation matters (the skill pages' "Good against" tables use it).</li>
<li>A dead or stunned combatant doesn't shift anyone's slots. Every fight (each map room too) starts again at slot 1.</li>
<li>A hero's 5 skills must fit its ${sl("ap", "action points")}. The enemy plays its <code>attackList</code> (<code>attackListB</code> when rare).</li>
</ul>`,
    src: [["obj.combat.Battle.lua", 110, "determineAction((self.turns - 1) % 5 + 1)"], ["obj.Combatant.lua", 24, "local actionName = self.attackList[turnNumber]"],
      ["obj.Enemy.lua", 25, "default.enemyAttackList(self.questID, isRare)"]],
  },
  {
    id: "targeting",
    html: () => `<p>Hero skills always hit the single enemy. Enemy attacks hit the party by a pattern:</p>
${tbl(["Pattern", "Who is hit"], [
  ["Default (Basic and most skills)", "split evenly over the <b>living front row</b>: each takes 1/n of the hit; the back row only once the whole front row is dead"],
  ["front", "every living front-row hero, full damage (the back row if the front row is empty)"],
  ["back", "every living back-row hero, full damage (the front row if the back row is empty)"],
  ["mid", "place 4 (F2) only, full damage; nobody if F2 is dead or empty"],
  ["midline", "places 3 and 4 (B2 and F2), full damage (Fatal Gaze, Shadow Strike)"],
  ["aoe", "everyone alive, full damage"],
  ["lowest HP", "Execute: the living hero with the lowest HP (first in B1, F1, B2… order on a tie)"],
])}
<ul>
<li><b>Taunt</b> puts a debuff on the enemy that redirects its <b>next attack</b>, whatever its pattern, to the taunter alone at full damage, then ends. An enemy skill that doesn't attack leaves it waiting.</li>
<li>Not random, not by threat: the split and the patterns only look at who is alive.</li>
<li>Heals: Lesser Heal heals the front hero of the caster's row (a front-row caster, or one whose front hero is dead, heals itself); Greater Heal and party effects reach every living hero. A party effect with an unknown pattern reaches everyone.</li>
</ul>`,
    src: [["obj.Enemy.lua", 99, "function Enemy:getDamageRatio"], ["obj.Party.lua", 208, "function Party:getFirstRowRatio"], ["obj.Combatant.lua", 147, "damRatio == \"mid\""],
      ["obj.Combatant.lua", 156, "damRatio == \"midline\""], ["obj.Party.lua", 11, "function Party:getHeroByStat"], ["data.AbilityFunc.lua", 2032, "getHeroByStat(\"questHP\", false)"],
      ["data.AbilityFunc.lua", 487, "function abilityFunc:Taunt"], ["data.AbilityFunc.lua", 847, "local frontID = (self.partyLocation + 1) / 2"], ["obj.Party.lua", 71, "unknown string for damage ratio"]],
  },
  {
    id: "attack",
    html: () => `<p>Each target of an attack resolves it on its own, in this order:</p>
<ol class="ref-steps">
<li>The share of the hit: 1, or 1/n on a split hit (${bl("targeting")}).</li>
<li>The target's "on damage" effects change the attack (Block, Shield and Evade cut it to 22 %; Elusion sets a 50 % hit chance). One-use ones are spent even if the attack then misses.</li>
<li>The ${sl("hit-chance", "hit roll")}: round(200 × acc / (acc + eva)) %. Damage over time always hits.</li>
<li>One roll for a ${sl("crit", "crit or a lucky hit")}: crit if ≤ crit (× crit damage), else lucky within 1.6 × luck (× 1.35).</li>
<li>${sl("defence", "Defence reduction")} 100 / (100 + def) on the physical part, the same with mdef on the magical part; true damage ignores both (${sl("damage", "damage formula")}).</li>
<li>The target's "damage received" effects (Mana Shield absorbs magic damage, Song of Defense…), then HP goes down; at 0 or less the target dies (${bl("death")}).</li>
</ol>`,
    src: [["obj.Combatant.lua", 376, "function Combatant:receiveAttack"], ["obj.Combatant.lua", 397, "\"OnDamage\""], ["obj.Combatant.lua", 421, "math.round(200 * attack.acc"],
      ["obj.Combatant.lua", 457, "calculateReduction(self.def, attack.defPen)"], ["obj.Combatant.lua", 466, "\"DamageReceived\""], ["obj.Combatant.lua", 489, "if 0 >= self.questHP then"]],
  },
  {
    id: "effects",
    html: () => `<p>Buffs and debuffs are effects with a name, stats, a duration (<code>turns</code>) and a trigger:</p>
${tbl(["Trigger", "What it does", "Ends"], [
  ["(none) / OnTurn", "stat change while it lasts", "after its turns"],
  ["Permanent", "stat change (stacking buffs)", "end of the fight"],
  ["OnAttack", "changes the owner's next attack(s)", "first use, or its turns"],
  ["OnDamage", "changes the next hit(s) taken, before the hit roll", "first use, or its turns"],
  ["DamageReceived", "changes damage taken, after reduction (shields)", "first use, or its turns"],
  ["DamageOnTurn / HealingOnTurn", "hits / heals the owner at the end of each of its actions", "after its turns"],
  ["OnDetermineAction", "replaces the owner's action (stun: none; Drown: Basic)", "first use, or its turns"],
])}
<p>Effect stats on atk, matk, def, mdef, acc, eva and max HP are <b>percentages</b> (+0.5 = +50 %); crit and crit damage are flat. Floors: ${sl("hero-stats", "−90 % / −100 %")}. A same-name effect is replaced, or stacks (adds up, turns refreshed) or toggles off, as the skill says.</p>
<h3>Durations count the owner's own actions</h3>
<ol class="ref-steps">
<li>At the start of its action the owner drops the effects whose turns reached 0, and those used up.</li>
<li>Its stats are recomputed with the effects left, then it acts.</li>
<li>At the end of its action every effect with turns goes down by 1; damage and healing over time fire now.</li>
</ol>
<ul>
<li>So an effect with turns = <i>t</i> put on <b>another</b> combatant lasts its next <i>t</i> actions (and everything in between); put on <b>yourself</b> during your action it lasts your next <i>t</i> − 1 actions.</li>
<li>Holy Shield (party-wide with adjusted turns) lasts exactly until the enemy's next action for every hero.</li>
<li>Effects without turns end at their first use; a dead combatant loses all its effects.</li>
</ul>
${example(`Soul Barrier (turns 2, on the enemy, enemy acting last, cast on turn <i>k</i>) reflects every hero action of turns <i>k</i> + 1 and <i>k</i> + 2. A hero's 1-turn debuff on the enemy weakens the enemy's action of the same turn and still counts for the heroes acting before it on turn <i>k</i> + 1.`)}`,
    src: [["obj.Combatant.lua", 27, "0 >= self.effectList[n].turns"], ["obj.Combatant.lua", 35, "self:determineStats(true)"], ["obj.Combatant.lua", 61, "currentEffect.trigger == \"OnTurn\""],
      ["obj.Combatant.lua", 212, "atk = \"atkPct\""], ["obj.Combatant.lua", 262, "elseif params.reversible then"], ["obj.Combatant.lua", 265, "elseif params.stacks then"],
      ["obj.Combatant.lua", 282, "self.effectList[effectID].trigger = \"OnTurn\""], ["obj.Party.lua", 83, "moreOptions.adjustTurns"], ["obj.Combatant.lua", 492, "self.effectList[n].remove = true"]],
  },
  {
    id: "buffs-debuffs",
    html: () => `${tbl(["Removal", "Removes", "Never removes"], [
  ["Cleanse (party), Unbreakable (self)", "debuffs (effects flagged <i>debuff</i>)", "“cannot dispel” effects; harmful effects not flagged as debuffs"],
  ["Silence (on the enemy)", "the enemy's buffs (effects not flagged debuff)", "“cannot dispel” effects (Soul Barrier)"],
  ["Song of Negation (on the enemy)", "all the enemy's effects", "“cannot dispel” effects"],
  ["Death", "everything", "–"],
])}
<ul>
<li><b>Stun</b> (Pulverize, Stunning Blow, on heroes): the hero's next action is skipped (its effects still tick), then the stun ends. <b>Drown</b>: 2 actions forced to Basic. No hero skill stuns the enemy: the enemy always plays its rotation.</li>
<li><b>Taunt</b>: ${bl("targeting")}.</li>
<li><b>Reflect</b>: Soul Barrier (Archon) sends all damage back and takes none; Grand Duel (Odin) physical damage only; Song of Defense (hero) sends 40 % back and takes 40 % less. <b>Counters</b> (Reflect on Pumpking, Retaliation) hit back but the enemy still takes full damage.</li>
<li><b>Shields</b>: shield skills heal above max HP (overload, ${bl("heals")}); Mana Shield absorbs magic damage up to 60 % of the caster's matk; Block / Shield take a physical / magical hit at 22 %; Elusion makes hits 50 % to land.</li>
</ul>
${note(`What each skill does turn by turn (buff, debuff, shield, reflect windows) is measured for every skill by the engine's skill probe and shown on the skill and enemy pages.`)}`,
    src: [["obj.Combatant.lua", 308, "function Combatant:removeAllEffects"], ["obj.Combatant.lua", 319, "effect.cannotDispell"], ["data.AbilityFunc.lua", 836, "self.party:removeAllEffects(true, true)"],
      ["data.AbilityFunc.lua", 840, "target:removeAllEffects(false, true)"], ["data.AbilityFunc.lua", 844, "target:removeAllEffects(nil, true)"], ["data.AbilityFunc.lua", 1616, "function abilityFunc:Pulverize"],
      ["data.AbilityFunc.lua", 2254, "return \"Basic\""], ["data.AbilityFunc.lua", 2451, "cannotDispell = true"], ["data.AbilityFunc.lua", 538, "stats = {atk = 0.22}"], ["data.AbilityFunc.lua", 1446, "attack.hitChance = 50"]],
  },
  {
    id: "heals",
    html: () => `${formula(`HP ← min(HP + round(${v("heal")}), max HP) &nbsp;·&nbsp; nothing if HP is already above max HP or the hero is dead`)}
<ul>
<li>The cap is the hero's <b>max HP</b>, not the HP it started the fight with: in game version 3.18 a hero healed in a map can go back above its room-start HP.</li>
<li><b>Overload</b>: the shield skills (Earth / Aqua / Fire Shield, Bulwark, Ice Barrier, Oblivion Shield, Nature's Veil) add HP with no cap, so above max HP.</li>
<li>Lesser Heal: 0.3 × (matk + acc) + 2 × level to one hero (${bl("targeting")}). Greater Heal: 0.11 × (matk + acc) + level to every living hero. Healing over time ticks at the end of the owner's action.</li>
<li>Out of battle, potions heal up to max HP. Overheal is trimmed after each map room (${bl("map-runs")}).</li>
</ul>
${example(`A hero at 984 / 1,100 HP healed for 150: <b>1,100</b>. A later heal while it is at 1,250 from a shield: <b>nothing</b>.`)}`,
    src: [["obj.Combatant.lua", 337, "function Combatant:receiveHeal"], ["obj.Combatant.lua", 338, "if self.isDead and not revive then"], ["obj.Combatant.lua", 359, "if self.questHP > self.maxHP then"],
      ["obj.Combatant.lua", 364, "math.min(self.questHP, self.maxHP)"], ["obj.Combatant.lua", 369, "self.questHP = self.questHP + totalHeal"], ["data.AbilityFunc.lua", 1150, "self.def * 1, false, true"],
      ["data.AbilityFunc.lua", 848, "0.3 * (self.matk + self.acc) + 2 * self.level"], ["data.AbilityFunc.lua", 856, "0.11 * (self.matk + self.acc) + self.level"]],
  },
  {
    id: "revives",
    html: () => `<ul>
<li><b>Revive skill</b>: the first dead hero in F1, B1, F2, B2, F3, B3 order whose revive cooldown is 0 comes back with round(50 % of max HP). It then has a cooldown of 2, which goes down at the start of each of <b>its own</b> actions: a hero killed again before it acted twice can't be revived by the skill again in that fight (a dead hero doesn't act).</li>
<li><b>Revive scrolls</b> (maps only, after a won room): the first dead hero (same order) comes back with <b>full</b> max HP. Revive: 1 charge; Revive +1: 3 charges.</li>
<li>After a quest or map, a dead hero stays dead until revived for level × 10 gold (× tier from tier 2): ${sl("max-hp")}.</li>
</ul>`,
    src: [["data.AbilityFunc.lua", 819, "hero.isDead and hero.reviveCooldown == 0"], ["data.AbilityFunc.lua", 820, "hero:receiveHeal(0.5, true, false, true)"], ["obj.Combatant.lua", 356, "self.reviveCooldown = 2"],
      ["obj.Combatant.lua", 21, "math.max(0, self.reviveCooldown - 1)"], ["data.ScrollsData.lua", 41, "target.questHP = target.maxHP"], ["data.ScrollsData.lua", 84, "charges = 3"]],
  },
  {
    id: "death",
    html: () => `<ul>
<li>At 0 HP or less a combatant is dead: all its effects end, it no longer acts, heals skip it (only a revive brings it back), and the targeting patterns ignore it (a split hit is shared among the living).</li>
<li>Dead heroes still count in the party's ${sl("luck")} and in the XP split (${sl("xp")}), but get no XP.</li>
<li>A lost quest kills the whole party; so does a lost map room (unless an Escape scroll ended the run first).</li>
<li><b>Cooldowns</b>: skills have none. The 5-slot ${bl("rotation")} is the only timing; the one cooldown in the game is the revive one (${bl("revives")}).</li>
</ul>`,
    src: [["obj.Combatant.lua", 489, "if 0 >= self.questHP then"], ["obj.Party.lua", 161, "0 < hero.questHP"], ["obj.Quest.lua", 226, "not isWin then"], ["obj.combat.Campaign.lua", 71, "not (self.isWin or self.isEscape)"]],
  },
  {
    id: "battle-end",
    html: () => `<p>After each full turn: if every hero is at 0 HP the fight is lost; then, if the enemy is at 0 HP, it is won (so if both fall in the same turn, the win counts, but no hero is alive for XP). At turn 200 the fight is lost (fatigue).</p>
<ul>
<li>A won fight gets a ${sl("grade")} from its turns and the party's level; a lost one grade 0 (no loot).</li>
<li>Quest end: each hero keeps round(min(battle HP, HP before)), XP for the living, one potion charge used.</li>
<li>The loot (${sl("luck", "luck")}, ${sl("quest-size", "×N")}) and the quest time (${sl("time")}) follow from the grade.</li>
</ul>`,
    src: [["obj.combat.Battle.lua", 86, "if self:areHeroesFainted() then"], ["obj.combat.Battle.lua", 91, "if 0 >= self.enemy.questHP then"], ["obj.combat.Battle.lua", 95, "if self.turns >= 200 then"],
      ["obj.combat.questService.lua", 157, "if battle.hasWon == false then"]],
  },
  {
    id: "map-runs",
    html: () => `<ol class="ref-steps">
<li><b>Map start</b>: each hero's battle HP = its current HP (maybe below max). Scrolls are used up now.</li>
<li><b>Each room</b> is a fight from the carried HP; heroes at 0 HP sit out. Effects are cleared and the rotation restarts at slot 1.</li>
<li><b>After a won room</b>: HP is trimmed to max HP (overheal lost), XP per room (a level-up refills HP), one potion charge used, and the room's loot is kept.</li>
<li><b>Escape scroll</b>: after a won room (not the last), if at least half the party is dead, the run ends: no essence, but the living heroes survive.</li>
<li>Otherwise the <b>post-battle scrolls</b>: Healing +500 HP to the first hero at ≤ 25 % HP (Healing +1: heroes at ≤ 50 %, 6 charges), Revive (full HP to a dead hero), Swap (other skill set before the boss).</li>
<li><b>Map end</b>: each hero keeps round(min(battle HP, HP on entering)). HP healed back inside a map helps the fights, but you never leave with more than you came in with.</li>
</ol>
${formula(`HP<sub>after map</sub> = round(min(HP<sub>end of run</sub>, HP<sub>entry</sub>))`)}
<ul>
<li>A lost room ends the run and kills the party; the loot of the rooms already won is still handed over. Essence only when every room is won (${sl("map-essence")}).</li>
<li>Str / Int / Dex scrolls: +8 % atk / matk / acc for the whole run; Speed scroll: shorter run (${sl("time")}).</li>
</ul>
${unsure(`Fleeing: the code we have has no way to leave a run other than the Escape scroll.`)}
${example(`A hero enters at 900 / 1,200 HP, drops to 400, is healed to 1,150 and ends the run at 1,000: it leaves with <b>900</b>.`)}`,
    src: [["obj.combat.GameCampaigns.lua", 39, "campaign.backRow[i].questHP = campaign.backRow[i].hp"], ["obj.combat.Campaign.lua", 156, "useQuestHp = true"],
      ["obj.combat.Battle.lua", 27, "currentHp = hero.questHP"], ["obj.combat.Campaign.lua", 119, "math.ceil(math.min(hero.questHP, hero.maxHP))"], ["obj.combat.Campaign.lua", 200, "checkEscape(self)"],
      ["data.ScrollsData.lua", 13, "dead / total >= scrollData.deadPart"], ["data.ScrollsData.lua", 37, "math.min(oldHp + stats.hp, target.maxHP)"], ["obj.combat.Campaign.lua", 70, "math.min(hero.questHP, hero.hp)"],
      ["obj.combat.GameCampaigns.lua", 59, "putIntoPlayerInventory"], ["obj.Hero.lua", 238, "campaign.battleBuff"]],
  },
  {
    id: "quest-size",
    html: () => `<p>A quest run ×${v("N")} is still <b>one</b> fight against <b>one</b> enemy with ${v("N")} × its max HP; its attacks, defences and rotation are unchanged. It takes more turns, which lowers the ${sl("grade")}; gold, time, XP and loot are multiplied: ${sl("quest-size")}.</p>`,
    src: [["obj.Enemy.lua", 77, "self.maxHP = self.maxHP * self.amount"], ["obj.combat.questService.lua", 183, "(8 + questInfo.region * 3 - turns) / 4"]],
  },
];

export function battlePage(topic?: string): HTMLElement {
  return refPage("battle", "Battle", "🗡️", "How a fight runs, step by step, read from the game's code. The formulas themselves are on the Stats page.",
    BATTLE_TOPICS, BATTLE_SECTIONS, topic);
}
