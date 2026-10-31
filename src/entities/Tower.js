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
// (per GDD 5.3): level 2 = +60 % base, level 3 = +120 % base.
const UPGRADE_PCT = { 2: 0.6, 3: 1.2 };

export const MAX_TOWER_LEVEL = 3;

// Per-level stat multipliers (task Y). Level 3 additionally unlocks the
// tower's GDD special (see LEVEL3_SPECIAL / getStats()).
export const LEVEL_MULT = {
  1: { dmg: 1.0, rate: 1.0, range: 1.0 },
  2: { dmg: 1.5, rate: 1.15, range: 1.1 },
  3: { dmg: 2.2, rate: 1.3, range: 1.2 },
};

/** Short Slovak description of each tower's level-3 special (UI). */
export const LEVEL3_SPECIAL = {
  balista: 'Prieraz +1 cieľ',
  cannon: '+25 % výbuch',
  catapult: 'Prediktívne mierenie',
  frost: 'Spomalenie −55 %',
};

// Every further tower of the SAME type costs +10 % of base (task Y: spam
// towers shouldn't be free). Upgrades are priced from the base cost.
export const TOWER_COST_STEP = 0.10;

/** Build price of a tower type given how many of that type already stand. */
export function towerBuildCost(type, existingSameType = 0) {
  const base = TOWER_TYPES[type].cost;
  return Math.round(base * (1 + TOWER_COST_STEP * existingSameType));
}

/** Fraction refunded on sell (GDD: 70 %, 100 % within the same wave). */
export const SELL_REFUND = 0.7;

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
    this.invested = TOWER_TYPES[type].cost; // gold actually paid (Game sets real build price)
    this.builtWave = null; // Game sets: wave number at build time (same-wave full refund)
  }

  /** Effective stats for current level (task Y: real per-level scaling +
   * level-3 special per GDD 5.3). */
  getStats() {
    const base = TOWER_TYPES[this.type];
    const m = LEVEL_MULT[this.level] || LEVEL_MULT[1];
    const stats = {
      ...base,
      level: this.level,
      dmg: base.dmg * m.dmg,
      rate: base.rate * m.rate,
      range: base.range * m.range,
    };
    if (this.level >= 3) {
      if (this.type === 'balista') stats.pierce = 1;           // hits 1 extra enemy
      if (this.type === 'cannon') stats.splash = base.splash * 1.25;
      if (this.type === 'catapult') stats.predictive = true;    // leads moving targets
      if (this.type === 'frost') stats.slowMult = 0.45;         // -55 % instead of -40 %
    }
    return stats;
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
    if (nextLevel > MAX_TOWER_LEVEL) return null;
    const base = TOWER_TYPES[this.type].cost;
    return Math.round(base * UPGRADE_PCT[nextLevel]);
  }

  /** Total gold sunk into this tower so far (build price + upgrades paid). */
  getTotalInvestment() {
    return Math.round(this.invested);
  }

  isMaxLevel() {
    return this.level >= MAX_TOWER_LEVEL;
  }

  /** Attempts to upgrade. Returns the gold cost paid, or null if already max level. */
  upgrade() {
    if (this.level >= MAX_TOWER_LEVEL) return null;
    const cost = this.getUpgradeCost();
    this.level += 1;
    this.invested += cost;
    return cost;
  }

  /** Refund on sell: 70 % of total investment (100 % if fullRefund). */
  sell(fullRefund = false) {
    return Math.round(this.getTotalInvestment() * (fullRefund ? 1 : SELL_REFUND));
  }

  static create(type, x, y) {
    return new Tower(type, x, y);
  }
}
