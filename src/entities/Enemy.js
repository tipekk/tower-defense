// Enemy.js - plain-JS enemy entity for Bastion Grid (logic layer, no rendering)
// Position along the path is tracked as t in [0,1]; x/y are derived from a
// simple path object ({start:{x,y}, end:{x,y}, length}) for distance-based
// targeting. A full multi-waypoint path can replace this later without
// changing the public Enemy API (t, x, y, update()).

export const ENEMY_TYPES = {
  cvakac: {
    name: 'Cvakáč',
    hp: 40,
    speed: 1.0,
    bounty: 5,
  },
  vrtiak: {
    name: 'Vrtiak',
    hp: 25,
    speed: 1.8,
    bounty: 6,
    onHitSpeedBoostMult: 1.5, // +50% speed
    onHitSpeedBoostDuration: 0.5,
  },
  kotlar: {
    name: 'Kotlár',
    hp: 120,
    speed: 0.7,
    bounty: 12,
    armor: 5,                 // -5 dmg from each hit while armored
    armorBreakHpPct: 0.5,     // loses armor at 50% hp
    armorBreakSpeedMult: 1.3, // +30% speed once armor breaks
  },
  vazka: {
    name: 'Mosadzná vážka',
    hp: 50,
    speed: 1.2,
    bounty: 10,
    flying: true, // cannon cannot hit it
  },
  navijac: {
    name: 'Navíjač',
    hp: 70,
    speed: 0.8,
    bounty: 15,
    buffRadius: 1.5,
    buffSpeedMult: 1.25, // +25% speed to allies in radius
  },
  boss_kukucka: {
    name: 'Kukučkový kolos',
    hp: 1500,
    speed: 0.5,
    bounty: 100,
    isBoss: true,
    livesCost: 5,
    spawnInterval: 12,
    spawnCount: 3,
    spawnType: 'cvakac',
    stunThresholds: [0.66, 0.33],
    stunRadius: 3,
    stunDuration: 1.5,
  },
};

/** HP scaling by wave number (wave 1 = base). */
export function hpForWave(baseHp, wave) {
  return baseHp * (1 + 0.12 * (wave - 1));
}

let _nextEnemyId = 1;

export class Enemy {
  /**
   * @param {string} type key into ENEMY_TYPES
   * @param {number} wave current wave number (1-based), used for HP scaling
   * @param {{start:{x:number,y:number}, end:{x:number,y:number}, length:number}} path
   */
  constructor(type, wave, path) {
    const cfg = ENEMY_TYPES[type];
    if (!cfg) throw new Error(`Unknown enemy type: ${type}`);
    this.id = _nextEnemyId++;
    this.type = type;
    this.wave = wave;
    this.path = path;

    this.baseSpeed = cfg.speed;
    this.maxHp = hpForWave(cfg.hp, wave);
    this.hp = this.maxHp;
    this.bounty = cfg.bounty;
    this.flying = !!cfg.flying;
    this.livesCost = cfg.isBoss ? cfg.livesCost : 1;

    this.t = 0; // 0 = spawn, 1 = reached gate
    this.alive = true;
    this.reachedGate = false;

    // Kotlar armor state
    this.armor = cfg.armor || 0;
    this.armorBroken = false;

    // Vrtiak on-hit speed boost
    this.hitSpeedBoostTimer = 0;

    // Kotlar permanent speed multiplier (after armor break)
    this.permanentSpeedMult = 1;

    // Frost-tower style slow effect (generic, any enemy can be slowed)
    this.slowTimer = 0;
    this.slowMult = 1;

    // Navijac buff aura marker (consumed by Combat/Waves system externally)
    this.isBuffAura = type === 'navijac';
    this.buffRadius = cfg.buffRadius || 0;
    this.buffSpeedMult = cfg.buffSpeedMult || 1;
    this._auraSpeedMult = 1; // set by Game per-tick when inside a Navijac's buff radius

    // Boss-only state
    if (cfg.isBoss) {
      this.spawnTimer = cfg.spawnInterval;
      this.stunTimer = 0;
      this.triggeredStunThresholds = new Set();
    }

    this._updatePosition();
  }

  get cfg() {
    return ENEMY_TYPES[this.type];
  }

  /** Apply damage, accounting for Kotlar's armor and Vrtiak's on-hit speed boost. */
  takeDamage(amount) {
    if (!this.alive) return 0;
    let dealt = amount;
    if (this.armor > 0 && !this.armorBroken) {
      dealt = Math.max(0, amount - this.armor);
    }
    this.hp -= dealt;

    if (this.type === 'kotlar' && !this.armorBroken && this.hp <= this.maxHp * this.cfg.armorBreakHpPct) {
      this.armorBroken = true;
      this.armor = 0;
      this.permanentSpeedMult *= this.cfg.armorBreakSpeedMult;
    }

    if (this.type === 'vrtiak') {
      this.hitSpeedBoostTimer = this.cfg.onHitSpeedBoostDuration;
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return dealt;
  }

  /** Apply a slow effect (e.g. from a Frost tower). Strongest slow wins, duration refreshes to the max. */
  applySlow(speedMult, duration) {
    if (speedMult < this.slowMult) this.slowMult = speedMult;
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  applyStun(duration) {
    if (this.cfg.isBoss) {
      this.stunTimer = Math.max(this.stunTimer, duration);
    }
  }

  getEffectiveSpeed() {
    let speed = this.baseSpeed * this.permanentSpeedMult;
    if (this.type === 'vrtiak' && this.hitSpeedBoostTimer > 0) {
      speed *= this.cfg.onHitSpeedBoostMult;
    }
    if (this.slowTimer > 0) {
      speed *= this.slowMult;
    }
    speed *= this._auraSpeedMult || 1;
    return speed;
  }

  update(dt) {
    if (!this.alive || this.reachedGate) return;

    if (this.hitSpeedBoostTimer > 0) this.hitSpeedBoostTimer -= dt;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowTimer = 0;
        this.slowMult = 1;
      }
    }
    if (this.cfg.isBoss && this.stunTimer > 0) {
      this.stunTimer -= dt;
      return; // stunned: boss itself doesn't move (towers' stun is handled by Combat)
    }
    if (this.cfg.isBoss) {
      this.spawnTimer -= dt;
    }

    const speed = this.getEffectiveSpeed();
    this.t += (speed * dt) / this.path.length;
    if (this.t >= 1) {
      this.t = 1;
      this.reachedGate = true;
    }
    this._updatePosition();
  }

  _updatePosition() {
    // Full multi-waypoint path (world/Path.js instance or an equivalent
    // {length, getPositionAtT(t)} adapter, e.g. built by render/main.js
    // from the real map data) takes priority over the simple start/end
    // straight-line fallback used by unit tests and any caller that
    // only supplies {start, end, length}.
    if (this.path && typeof this.path.getPositionAtT === 'function') {
      const p = this.path.getPositionAtT(this.t);
      this.x = p.x;
      this.y = p.z;
      return;
    }
    const { start, end } = this.path;
    this.x = start.x + (end.x - start.x) * this.t;
    this.y = start.y + (end.y - start.y) * this.t;
  }

  static create(type, wave, path) {
    return new Enemy(type, wave, path);
  }
}
