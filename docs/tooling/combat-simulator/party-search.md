---
type: Tool
title: Party search
description: The merged best-party search: the smallest parties that win, with rows, order, rotations and scrolls.
timestamp: 2026-11-24
---

# Party search

[Root](../../index.md) > [Tooling](../index.md) > [Combat Simulator](./index.md) > Party search

`searchParties` (`web/src/tools/parties.ts`) serves the merged "best party" mode: "best party", "best rotation" and
"best scrolls" in one search. It returns the smallest parties that win, each fully set up. It is built on
`searchSkills` and `searchScrolls`; `searchParty` (one party, greedy) stays available.

## Table of contents

- [API](#api)
- [How it searches](#how-it-searches)
- [Ranking](#ranking)
- [Measured](#measured)
- [Code](#code)

## API

```ts
searchParties(sim, pool: Map<id, Hero>, target: QuestTarget | MapTarget, o?, ctl?: SearchControl)
  → { results: PartyConfig[], tried: number, stopped: boolean }

o = { minSize = 1, maxSize = 6, topK = 10, enough = topK, winThreshold = 0.9,
      rotations = true, scrolls = false /* map runs only */, lock, exclude,
      nQuick /* 10 fights, 3 runs */, nFinal /* 100 fights, 20 runs */,
      beam = 6, refine = 3, timeBudgetMs = 120000 }

PartyConfig = { size, layout: { front, back } /* hero ids, null = empty */,
                skills: { [heroId]: { rotation, passive } }, scrolls: number[] | null,
                ev: FightEval | MapEval, score, scrollCost?, tuned }
```

- **Progress:** the stages are "solo" (one evaluation per hero), then "size N" (the sets screened and tuned at that size).
- **Cancel:** `shouldStop()` or the time budget ends the search; the configurations found so far are returned with `stopped: true`.
  - The budget is checked before every fight and map run, inside the rotation, scroll-loadout and final evaluations, so the search ends within a fight or a run of it (E22: a 120 s map search with scrolls had taken 148 s).
  - A set whose tuning is cut short stays in the results as screened (`tuned: false`).
  - Scroll prices (the profit solver, about 0.5 s) are computed once per search, at its start.
- **Heroes:** they are left with their own rotations and passives. Apply a configuration's `skills` to use it.

## How it searches

1. **Solo:** every hero alone, at nQuick. This is its strength, used to pick the heroes to try. A quest amount the hero can't take alone uses its own maximum.
2. **Beam:** from `minSize` up, each of the `beam` best hero sets of the previous size gets one more hero, among the strongest not in it.
   - Locked heroes are in every set; excluded heroes are never used.
   - Sets that can't take the quest amount (`maxQuestAmount`) are skipped.
3. **Screen:** every set fights once at nQuick, with a default layout (sturdiest heroes in front: max HP × defences) and the heroes' own rotations.
4. **Tune** the best `refine` sets of a size, once that size comes near winning (best screened win rate ≥ winThreshold / 2) or is the last size:
   - every front / back split, then every order within the rows;
   - each hero's rotation and passive in turn (`searchSkills`, cheap settings, with the schedule pre-filter and the warm start). A map run is tuned on its boss fight, a quest where both apply and a fight costs one room instead of a whole run. The fight is marked `mapRoom`, so the boss quest's own party rules don't apply;
   - for map runs with `scrolls`, the best loadout of up to 3 scrolls (`searchScrolls`);
   - a final evaluation at nFinal.

   Sizes far from winning keep their screened sets (`tuned: false`), and the search moves on to bigger parties.
5. **Game rules:** sizes stop at the quest's `questSize`, layouts that leave a party quest's front 2 empty are never tried (the default layout moves a hero there), and a solo quest gets one hero in front 1 ([party setup rules](../../combat/combat.md#party-setup-rules)).
6. **Stop** growing once `enough` configurations win at `winThreshold`, at `maxSize`, or when the time runs out.

## Ranking

- **Winners first:** configurations with win ≥ `winThreshold`, the fewest heroes first, then by score. A 3-hero party that wins comes before a 6-hero one.
- **Others by score:** a bigger party may simply get further.
- **One per hero set:** the same heroes in another order count as one configuration. The top `topK` are returned.

## Measured

The real save (17 heroes), default options except a 300 s time budget. Desolation Wolf re-measured on 2026-11-24 with the party setup rules (3 heroes at most, front 2 filled); the map rows are from 2026-11-23 (maps have no required slot):

| Target | Time | Evaluations | Best |
| --- | --- | --- | --- |
| Desolation Wolf (quest 81) | 108 s | 1,521 | 3 heroes (front #1, #15, back #8): win 100 %, 6.6 turns |
| Gnoll Vendetta asc 1 (map 11), no scrolls | 145 s | 1,071 | 6 heroes: win 85 %; best 5-hero set clears 96 % of rooms |
| Gnoll Vendetta asc 1, scrolls | 311 s (budget) | 919 | 6 heroes, scrolls 63, 64, 69 (2,077 g): win 100 % |

- Desolation Wolf: no 2-hero party wins any more (best: #8 in front 1, #1 in front 2, 81 %). Before the rules, #1 in front 1 and #8 in back 2 won 100 % by leaving front 2 empty, which the game doesn't allow. The search ends at 3 heroes, the quest's size, well within the budget.
- On the map, sizes 1 to 5 stayed far from winning, so only size 6 was tuned (`tuned: false` below it). The scroll loadout search makes each tuning about twice as slow.
- Use a shorter budget in the UI: the results at hand are returned with `stopped: true`.
- Budget check (E22, saves/snapshot, Gnoll Vendetta asc 1 with scrolls): budgets of 10, 20, 30, 40 and 60 s end at the budget + 4 to 14 ms. Before, a 20 s budget took 24 s: the stop was only checked between whole evaluations, and the schedule pre-filter (up to 3 s per hero) and the scroll prices (0.5 s per tuned set) couldn't be interrupted.

## Code

- `web/src/tools/parties.ts`; tests: `web/test/parties.test.ts` (made-up heroes, runs in CI).
