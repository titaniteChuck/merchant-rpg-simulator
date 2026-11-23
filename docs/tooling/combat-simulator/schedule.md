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

- **Damage:** the skill's power on the hero's own stats, × the active buffs and enemy debuffs. Minus what the enemy's
  reflect, counter and shield windows on that turn take back. Odin's Grand Duel only takes physical damage.
- **Cleanse:** it removes the party's debuffs, or its own for `cleanse-self`. Later actions stop paying for them: a
  stun no longer costs the action, and an atk / matk cut no longer reduces damage. DoT, stat swaps and def cuts are
  credited directly. A cleanse with nothing to remove loses points.
- **Dispel:** the enemy buffs it removes.
- **Defence:** shields and def buffs active when the enemy hits, × the enemy's power on that turn.
- **Heals:** what the party lost since the last heal, up to 25 % HP per hero.
- **Stuns:** a stunned action scores 0.

With `ctx`, damage is in % of the enemy's HP and protection is in % of a hero's HP. Both use the real stats and
defences, so the two sides weigh the same. Without it, both are in Basic-attack units. `notes` explains every
non-trivial term, for example "into Soul Barrier", "cleanses Terrify II" or "nothing to cleanse".

Limits:

- No randomness, no HP tracking, no deaths.
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
| Archon | full (lost) | Mage | −0.18 | 0.54 |
| Archon | full (lost) | Paladin | 0.09 | 0.20 |
| Odin | full (lost) | Warrior | 0.37 | 0.53 |
| Odin | full (lost) | Paladin | 0.56 | 0.52 |
| Gnoll Khan ×5 | Warrior + Cleric | Cleric | 0.71 | 0.71 |
| Gnoll Khan ×5 | Warrior + Cleric | Warrior | 0.95 | 0.97 |
| Demon Mage ×5 | Warrior + Cleric | Cleric | 0.40 | −0.35 |
| Demon Mage ×5 | Warrior + Cleric | Warrior | 0.74 | 0.82 |

- **Fights the party wins:** the score ranks rotations well (0.40–0.95). It is the only one of the two that gets the
  healer right on Demon Mage.
- **Fights the party loses:** it is weak, and so is any score there. On Archon (≤ 0.6 % of its HP removed) and Odin
  (≈ 6 %), the simulated score mostly rewards dying sooner, through its −10-per-turn term. The real signal (lowest
  enemy HP) is within noise.
- **Use:** rank the candidates, then simulate the top ones (E14b's pre-filter). Don't use it as a verdict.
- The 1-turn fights (Gnoll Khan and Demon Mage ×1 with the full party) were dropped: every rotation scores the same.

## Code

- `web/src/tools/skill-probe.ts`, `web/src/tools/schedule.ts`, `web/src/tools/export-timelines.ts`.
- Tests: `web/test/schedule.test.ts`.
- Data: `inventory/timelines.json`.
