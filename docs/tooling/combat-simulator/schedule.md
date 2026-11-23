---
type: Tool
title: Schedule
description: Skill probe, enemy timelines and the counter-schedule score that ranks rotations against an enemy's 5-turn timetable.
timestamp: 2026-11-23
---

# Schedule

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Schedule

A fight is a 5-turn timetable: hero slot k always meets enemy slot k ([combat](../../combat/combat.md#schedule)).
These tools describe what every skill does and when, and score a party's rotations against an enemy's timeline
without simulating, to pick the rotations worth simulating.

## Table of contents

- [Skill probe and timelines](#skill-probe-and-timelines)
- [Counter-schedule score](#counter-schedule-score)
- [Validation](#validation)
- [Pre-filter](#pre-filter)
- [Code](#code)

## Skill probe and timelines

`skill-probe.ts` casts one skill in a controlled battle and records what it does:

- **Set-up:** 6 level-60 heroes with 10⁶ HP, so nobody dies. The other actions are no-ops (`false` slots), which tick effects but do nothing else.
- **Who casts:** the quest's own enemy casts enemy skills. Hero skills are cast by back 1 against quest 1.
- **Markers:** a test buff and a test debuff on each side reveal cleanses and dispels. A dead hero reveals revives.

`npm run export:timelines` writes `inventory/timelines.json`, about 3 s:

- 60 hero skills, 136 enemy skills, 141 enemy timelines (normal and rare);
- `test/schedule.test.ts` fails when the file is out of date.

```ts
probeHeroSkill(sim, name): SkillProfile
probeEnemySkill(sim, quest, rare, slot, name?): SkillProfile
probeTimeline(sim, quest, rare = false): EnemyTimeline        // 5 slots, enemyFirst (questType 6)
buildTimelines(sim): TimelinesData                            // = timelines.json
// schedule.ts (lookups on the loaded file)
loadTimelines(json); enemyTimeline(quest, rare); skillProfile(name, side); skillTags(name, side)
```

- **`SkillProfile`**: tags; power; scaling; mix; hits; effects.
  - Power is raw damage per target over the caster's Basic attack.
  - Hero skills also have a `scaling`: raw damage per point of atk / matk / acc / def / mdef. For example Slash & Bash is 1.8 atk + 1.8 def, and Basic is 1 atk + 1 matk.
  - Mix is the physical / magical / true share of the damage.
  - Hits lists the party locations an enemy skill reached.
- **`EffectInfo`**: kind, owner, locations, stats, `turns`, end condition (`turns`, next hit, next attack, permanent, toggle) and removability. It also has two windows, both in turns from the cast:
  - `ownerTurns`: the owner acts with the effect on;
  - `facingTurns`: the other side acts while the effect is on the owner.

  Shields, reflects and counters also carry the result of a test hit (damage taken vs none, damage sent back).
- Windows of effects that end at their first use are upper bounds, because the probe never attacks.

## Counter-schedule score

```ts
scoreSchedule(party: { location, rotation }[], timeline, weights?, ctx?): { total, perTurn[5], notes }
scheduleContext(quest, front, back, { rare, amount }): ScheduleContext   // units from real stats
```

The score covers one steady-state 5-turn cycle, after a warm-up cycle. It follows the real action order and the
probe's windows. For each hero action it counts:

- **Damage:** the skill's power on the hero's own stats, × the expected crit multiplier (hero crit and critMod plus crit buffs), × the active buffs and enemy debuffs. Berserk Smash's 3 % of enemy HP on a crit is counted too (`critHpPct`). Minus what the enemy's
  reflect, counter and shield windows on that turn take back. Odin's Grand Duel only takes physical damage.
- **Cleanse:** it removes the party's debuffs, or its own for `cleanse-self`. Later actions stop paying for them: a
  stun no longer costs the action, and an atk / matk cut no longer reduces damage. DoT, stat swaps and def cuts are
  credited directly. A cleanse with nothing to remove loses points.
- **Dispel:** the enemy buffs it removes.
- **Defence:** shields and def buffs active when the enemy hits, × the enemy's power on that turn.
- **Heals:** what the party lost since the last heal. A heal gives back at most its real size, from the probe's `healScaling` on the caster (Greater Heal = 0.11 × (matk + acc) + level per hero); without stats, at most 25 % HP per hero.
- **Stuns:** a stunned action scores 0.

With `ctx`, damage is in % of the enemy's HP and protection is in % of a hero's HP. Both use the real stats and
defences, so the two sides weigh the same. Without it, both are in Basic-attack units. `notes` explains every
non-trivial term, for example "into Soul Barrier", "cleanses Terrify II" or "nothing to cleanse".

With `ctx`, enemy hits are priced for each hero:

- each skill's own physical / magical / true mix against that hero's def / mdef;
- the enemy's def / mdef cuts on the hero at that moment (Terrify II: mdef −50 %);
- split attacks (Basic) shared by the heroes actually in the row. The probe's full party took a third each; a lone front hero takes it all;
- a row attack on an empty row falls on the other row.

**HP race** (`race`, with `ctx`): over the scored cycle, the enemy HP dealt (cycles to kill it) and, per hero, the HP
taken and healed (cycles until it falls). The score adds 20 × min(first death / kill, 2). Healing that can't keep
up, or too little damage, loses the race however well it is timed.

On Demon Mage ×5 (Warrior + Cleric), the estimate is 47 % of the Warrior's HP per cycle, against 50 % measured.

Limits:

- No randomness and no deaths: a revive is only valued as a heal. That is why the full search's Demon Mage ×5 Cleric (Basic, Revive, Basic, Greater Heal, Basic) ranks 403rd of 2,667.
- Party buffs use the probe's caster windows (back 1).
- Effects that end at first use are consumed at the first matching action.
- Taunt and amplify are rough.

## Validation

Real save, one hero's rotation varied at a time:

- **Sample:** 40–55 rotations per case. These are random rotations within the AP budget plus the 5 `searchSkills` finalists.
- **Simulated score:** `evaluate` over 40 fights.
- **Measure:** Spearman rank correlation with the schedule score (with `ctx`), compared with a damage-only score (same code, other weights 0).

| Fight | Party | Hero varied | Schedule | Damage only |
|---|---|---|---|---|
| Archon | full (lost) | Mage | 0.21 | 0.12 |
| Archon | full (lost) | Paladin | 0.23 | 0.35 |
| Odin | full (lost) | Warrior | 0.58 | 0.60 |
| Odin | full (lost) | Paladin | 0.14 | 0.32 |
| Gnoll Khan ×5 | Warrior + Cleric | Cleric | 0.67 | 0.70 |
| Gnoll Khan ×5 | Warrior + Cleric | Warrior | 0.96 | 0.98 |
| Demon Mage ×5 | Warrior + Cleric | Cleric | 0.79 | −0.45 |
| Demon Mage ×5 | Warrior + Cleric | Warrior | 0.77 | 0.86 |

Measured with E14b's simulated score (lost fights ranked by lowest enemy HP, total damage and survival; mixed fight
seeds) and E15's schedule score (crits, real heal sizes, enemy hits priced per hero, HP race). The healer on Demon
Mage went from 0.46 to 0.79 with the HP race:

- **Fights the party wins:** the score ranks rotations well (0.67–0.96). It is the only one of the two that gets
  the healer right on Demon Mage.
- **Fights the party loses (Archon, Odin):** it is weaker (0.16–0.57). The differences there are small (tenths of a
  percent of enemy HP), so noise dominates.
- **Use:** rank the candidates, then simulate the top ones (pre-filter below). Don't use it as a verdict.
- The 1-turn fights (Gnoll Khan and Demon Mage ×1 with the full party) were dropped: every rotation scores the same.

## Pre-filter

`searchSkills` (and the skill and phase steps of `optimiseFight`) use the score as a pre-filter, through the
`prefilter` option: default 15, `false` = off. Every ordering of every AP-legal skill multiset is ranked by the
schedule score and by damage only. From each ranking, two lists are simulated at `nQuick`, plus the current rotation and
the warm-start rotation ([warm start](./warm-start.md)); then the usual finalists × passives at `nFinal`:

- the top 15 orderings;
- the best ordering of each of the top 15 skill sets. Many orderings of one set tie, so without this the top 15 can cover a single set.

Real save, `searchSkills` with nQuick 30, nFinal 150, top 8. The best rotation of each search is re-scored on 300
other fights, so luck in the search's own fights doesn't count. On fights the current rotation wins under 50 %,
k is ×4 (60 + 60), because the score ranks lost fights least well:

| Fight | Hero | Full: simulated | Pre-filter: simulated (ranked) | Re-scored, full vs pre-filter |
|---|---|---|---|---|
| Odin (lost) | Paladin | 286 | 116 (4,308) | 688 vs 685 (peak 6.2 vs 6.2 %) |
| Odin (lost) | Warrior | 290 | 97 (4,513) | 782 vs 782 (same rotation) |
| Archon (lost) | Mage | 350 | 121 (4,607) | 81 vs 74 (peak 0.6 vs 0.5 %) |
| Archon (lost) | Paladin | 285 | 120 (4,308) | 60 vs 60 (same rotation) |
| Gnoll Khan ×5 | Cleric | 205 | 16 (2,667) | 13.5 vs 13.8 turns |
| Gnoll Khan ×5 | Warrior | 310 | 16 (4,513) | 10.3 vs 10.6 turns |
| Demon Mage ×5 | Cleric | 300 | 31 (2,667) | 40.6 vs 43.5 turns |
| Demon Mage ×5 | Warrior | 310 | 21 (4,513) | 16.3 vs 16.5 turns |

- **Cost:** 10–19× fewer rotations simulated on won fights, about 2.5× fewer on lost ones. Wall-clock: 5–8 s vs 24–84 s on won fights, on a shared machine.
- **Quality:** same win rates. Within 0.3 turns or 0.1 % of enemy HP, except Demon Mage's Cleric, which is 2.9 turns slower: the score underrates healer timing.

`optimiseFight` (party fixed, steps order / swap / phase / skills, nQuick 10, nFinal 200; final evaluation):

| Fight | Full | Pre-filter |
|---|---|---|
| Odin (lost) | 13.0 % lowest enemy HP (score 1439) | 14.1 % (1563) |
| Archon (lost) | 4.0 % (477) | 4.4 % (524) |
| Gnoll Khan ×5 | 7.2 turns, 70 % HP left | 6.5 turns, 75 % HP left |
| Demon Mage ×5 | 16.3 turns, 33 % HP left | 16.8 turns, 31 % HP left |

- The coordinate descent takes a different path with the pre-filter, so results can be better or worse. Both found the Berserker's crit rotation: Blind Fury + Berserk Smash (3 % of enemy HP per crit), the biggest single step on Odin and Archon.
- A first version of the score ignored crits and filtered that rotation out (Odin 9.6 %, Archon 1.9 %). The score now counts expected crit damage, and `critHpPct` from the probe.
- Wall-clock on Gnoll Khan and Demon Mage: 2.5–3× faster. On Odin and Archon the time was dominated by machine load from other sessions, so it isn't comparable.
- When the best result matters more than the time, use a larger `prefilter` or `false`.

## Code

- `web/src/tools/skill-probe.ts`, `web/src/tools/schedule.ts`, `web/src/tools/export-timelines.ts`.
- Tests: `web/test/schedule.test.ts`.
- Data: `inventory/timelines.json`.
