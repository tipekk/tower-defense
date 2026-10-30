// Tower.js - plain-JS tower entity for Bastion Grid (logic layer, no rendering)

export const TOWER_TYPES = {
  balista: {
    name: 'Balista',
    cost: 50,
    dmg: 12,
    rate: 1.0,     // shots per second
    range: 3.5,
    splash: 0,
    canHitFlying: true,
  },
  cannon: {
    name: 'Kanón',
    cost: 80,
    dmg: 20,
    rate: 0.6,
    range: 3.0,
    splash: 1,       // splash radius
    canHitFlying: false, // GDD: nemôže na lietajúcich
  },
  catapult: {
    name: 'Katapult',
    cost: 110,
    dmg: 45,
    rate: 0.3,
    range: 5.5,
    splash: 1.5,
    canHitFlying: true,
    projectileFlightTime: 1.2, // seconds, arc projectile
  },
  frost: {
    name: 'Mráz',
    cost: 70,
    dmg: 4,
    rate: 2.0,
    range: 3.0,
    splash: 0,
    canHitFlying: true,
    slowMult: 0.6,     // -40% speed => multiply by 0.6
    slowDuration: 1.5,
  },
};

// Upgrade cost percentages are expressed relative to the tower's BASE cost
// and are cumulative to that base price (per GDD): level2 = +60% base,
// level3 = +120% base (on top of level2's cost, both counted from base cost).
const UPGRADE_PCT = { 2: 0.6, 3: 1.2 };

let _nextTowerId = 1;

export class Tower {
  constructor(type, x, y) {
    if (!TOWER_TYPES[type]) throw new Error(`Unknown tower type: ${type}`);
    this.id = _nextTowerId++;
    this.type = type;
    this.level = 1;
    this.x = x;
    this.y = y;
    this.cooldown = 0; // seconds until next shot is allowed
    this.strategy = 'first'; // targeting strategy: first/last/strongest/closest
    this.stunTimer = 0; // seconds remaining stunned (e.g. by boss ability)
  }

  /** Effective stats for current level.
   * Simplification (not fully spec'd in GDD): each level above 1 grants
   * +20% damage and +5% range, independent from the upgrade *cost* curve
   * (which IS specified). This can be retuned later without touching the
   * rest of the system.
   */
  getStats() {
    const base = TOWER_TYPES[this.type];
    const dmgMult = 1 + (this.level - 1) * 0.2;
    const rangeMult = 1 + (this.level - 1) * 0.05;
    return {
      ...base,
      dmg: base.dmg * dmgMult,
      range: base.range * rangeMult,
    };
  }

  isStunned() {
    return this.stunTimer > 0;
  }

  applyStun(duration) {
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  /** Gold cost to go from current level to the next, or null if maxed. */
  getUpgradeCost() {
    const nextLevel = this.level + 1;
    if (nextLevel > 3) return null;
    const base = TOWER_TYPES[this.type].cost;
    return Math.round(base * UPGRADE_PCT[nextLevel]);
  }

  /** Total gold sunk into this tower so far (base + any upgrades paid). */
  getTotalInvestment() {
    const base = TOWER_TYPES[this.type].cost;
    let total = base;
    if (this.level >= 2) total += base * UPGRADE_PCT[2];
    if (this.level >= 3) total += base * UPGRADE_PCT[3];
    return Math.round(total);
  }

  /** Attempts to upgrade. Returns the gold cost paid, or null if already max level. */
  upgrade() {
    if (this.level >= 3) return null;
    const cost = this.getUpgradeCost();
    this.level += 1;
    return cost;
  }

  /** 70% refund of total investment, rounded. */
  sell() {
    return Math.round(this.getTotalInvestment() * 0.7);
  }

  static create(type, x, y) {
    return new Tower(type, x, y);
  }
}
