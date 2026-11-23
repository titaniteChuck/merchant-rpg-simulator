/** obj.Party: the heroes as the enemy's target (area attacks, party-wide effects and heals). */
import { CombatStatistics } from "./combatStatistics.ts";
import { attackList as defaultAttackList } from "./defaults.ts";
import { noopLogger } from "./logger.ts";
import { copyTable, rowLen } from "./lua.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ALL = () => [0, 1, 1, 1, 1, 1, 1];

export class Party {
  [k: string]: Any;

  /** params: the Battle (Party:new(battle)); rows are shared with it. */
  constructor(params: Any) {
    // Combatant.initialize(self, params) with the battle as params.
    this.attackList = params.attackList ?? defaultAttackList();
    this.effectList = params.effectList ?? [];
    this.combatStatistics = new CombatStatistics({});
    this.questHP = params.questHP ?? 0;
    this.logger = noopLogger;
    this.questID = params.questID;
    this.frontRow = params.frontRow;
    this.backRow = params.backRow;
    this.name = "Party";
  }

  getHeroByStat(stat: string, ascend?: boolean): number {
    let heroLoc = 0;
    let currValue = ascend ? 0 : 9999999;
    for (let n = 1; n <= 3; n++) {
      const b = this.backRow[n];
      if (b && 0 < b.questHP) {
        const v = b[stat];
        if ((ascend && currValue < v) || (!ascend && currValue > v)) {
          currValue = v;
          heroLoc = n * 2 - 1;
        }
      }
      const f = this.frontRow[n];
      if (f && 0 < f.questHP) {
        const v = f[stat];
        if ((ascend && currValue < v) || (!ascend && currValue > v)) {
          currValue = v;
          heroLoc = n * 2;
        }
      }
    }
    return heroLoc;
  }

  private location(location: Any): number[] {
    if (location === undefined || location === null) return ALL();
    if (typeof location === "string") {
      if (location === "front") return this.getFirstRowRatio();
      if (location === "mid") return [0, 0, 0, 0, 1, 0, 0];
      if (location === "aoe") return ALL();
      if (location === "back") return this.getBackRowRatio();
      return ALL(); // unknown string (e.g. "midline"): every hero, as the game does
    }
    return location;
  }

  addEffect(params: Any, location?: Any, moreOptions?: Any): void {
    const loc = this.location(location);
    let caster: Any;
    if (moreOptions && moreOptions.adjustTurns) {
      caster = moreOptions.caster;
      params.turns = params.turns - 1;
    }
    for (let n = 1; n <= 3; n++) {
      let hero = this.backRow[n];
      if (hero && caster === hero && moreOptions.adjustTurns) params.turns = params.turns + 1;
      if (hero && loc[n * 2 - 1] === 1) hero.addEffect(params);
      hero = this.frontRow[n];
      if (hero && caster === hero && moreOptions.adjustTurns) params.turns = params.turns + 1;
      if (hero && loc[n * 2] === 1) hero.addEffect(params);
    }
  }

  removeEffect(id: Any, location?: Any): void {
    const loc = location ?? ALL();
    // Lua iterates 1..#row: the leading filled slots only.
    for (let n = 1; n <= rowLen(this.frontRow); n++) if (loc[n * 2] === 1) this.frontRow[n].removeEffect(id);
    for (let n = 1; n <= rowLen(this.backRow); n++) if (loc[n * 2 - 1] === 1) this.backRow[n].removeEffect(id);
  }

  removeAllEffects(debuffOnly?: boolean, isSpell?: boolean, location?: Any): void {
    const loc = location ?? ALL();
    for (let n = 1; n <= 3; n++) {
      const f = this.frontRow[n];
      if (f && loc[n * 2] === 1) f.removeAllEffects(debuffOnly, isSpell);
      const b = this.backRow[n];
      if (b && loc[n * 2 - 1] === 1) b.removeAllEffects(debuffOnly, isSpell);
    }
  }

  receiveHeal(amount: number, location?: Any): number {
    let totalHeal = 0;
    const loc = location ?? ALL();
    for (let n = 1; n <= 3; n++) {
      const f = this.frontRow[n];
      if (f && 0 < f.questHP && 0 < loc[n * 2]) totalHeal = totalHeal + f.receiveHeal(amount * loc[n * 2]);
      const b = this.backRow[n];
      if (b && 0 < b.questHP && 0 < loc[n * 2 - 1]) totalHeal = totalHeal + b.receiveHeal(amount * loc[n * 2 - 1]);
    }
    return totalHeal;
  }

  /** Every living hero receives a copy of the attack; front row first (pairs order is ascending). */
  receiveAttack(attack: Any): Any[] {
    const result: Any[] = [];
    for (const row of [this.frontRow, this.backRow]) {
      for (let n = 1; n <= 3; n++) {
        const d = row[n];
        if (d && d.questHP > 0) {
          const r = d.receiveAttack(copyTable(attack));
          r.partyLocation = d.partyLocation;
          result.push(r);
        }
      }
    }
    return result;
  }

  getTotalStat(statName: string): number {
    let total = 0;
    for (let n = 1; n <= 3; n++) {
      const f = this.frontRow[n];
      if (f && 0 < f.questHP) total = total + f[statName];
    }
    for (let n = 1; n <= rowLen(this.backRow); n++) {
      const b = this.backRow[n];
      if (b && 0 < b.questHP) total = total + b[statName];
    }
    return total;
  }

  getFirstRowRatio(): number[] {
    let alive = false;
    const r = [0, 0, 0, 0, 0, 0, 0];
    for (let n = 1; n <= 3; n++) {
      if (this.frontRow[n] && 0 < this.frontRow[n].questHP) {
        alive = true;
        r[n * 2] = 1;
      }
    }
    if (!alive) for (let n = 1; n <= 3; n++) if (this.backRow[n] && 0 < this.backRow[n].questHP) r[n * 2 - 1] = 1;
    return r;
  }

  getBackRowRatio(): number[] {
    let alive = false;
    const r = [0, 0, 0, 0, 0, 0, 0];
    for (let n = 1; n <= 3; n++) {
      if (this.backRow[n] && 0 < this.backRow[n].questHP) {
        alive = true;
        r[n * 2 - 1] = 1;
      }
    }
    if (!alive) for (let n = 1; n <= 3; n++) if (this.frontRow[n] && 0 < this.frontRow[n].questHP) r[n * 2] = 1;
    return r;
  }
}
