/** obj.combat.CombatStatistics */
// deno-lint-ignore no-explicit-any
type Any = any;

const compactFields = ["magicDmgDealt", "physicalDmgDealt", "magicDmgTaken", "physicalDmgTaken", "hits",
  "misses", "crits", "luckyHits", "healingDone", "healingTaken"] as const;

export class CombatStatistics {
  magicDmgDealt = 0;
  physicalDmgDealt = 0;
  magicDmgTaken = 0;
  physicalDmgTaken = 0;
  hits = 0;
  misses = 0;
  crits = 0;
  luckyHits = 0;
  healingDone = 0;
  healingTaken = 0;

  constructor(params: Any = {}) {
    if (typeof params.combatStats === "string") this.fromCompactSave(params.combatStats);
    else for (const f of compactFields) this[f] = params[f] ?? 0;
  }

  fromCompactSave(s: string): void {
    const words = s.match(/\d+/g) ?? [];
    compactFields.forEach((f, i) => {
      this[f] = i < words.length ? Number(words[i]) || 0 : 0;
    });
  }

  reset(): void {
    for (const f of compactFields) this[f] = 0;
  }

  recordDamageTaken(attack: Any): void {
    this.magicDmgTaken = Math.floor(this.magicDmgTaken + attack.magicDamage + attack.trueDamage / 2);
    this.physicalDmgTaken = Math.floor(this.physicalDmgTaken + attack.physicalDamage + attack.trueDamage / 2);
  }

  recordHealingDone(amount?: number): void {
    this.healingDone = this.healingDone + (amount ?? 0);
  }

  recordHealingTaken(amount?: number): void {
    this.healingTaken = this.healingTaken + (amount ?? 0);
  }

  recordAttackHit(attack: Any, isCrit: boolean, isLuck: boolean): void {
    this.magicDmgDealt = Math.floor(this.magicDmgDealt + attack.magicDamage + attack.trueDamage / 2);
    this.physicalDmgDealt = Math.floor(this.physicalDmgDealt + attack.physicalDamage + attack.trueDamage / 2);
    if (!attack.isDot) {
      this.hits++;
      if (isCrit) this.crits++;
      if (isLuck) this.luckyHits++;
    }
  }

  recordMiss(): void {
    this.misses++;
  }
}
