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
    bounty: 5,
    onHitSpeedBoostMult: 1.5, // +50% speed
    onHitSpeedBoostDuration: 0.5,
  },
  kotlar: {
    name: 'Kotlár',
    hp: 120,
    speed: 0.7,
    bounty: 11,
    armor: 5,                 // -5 dmg from each hit while armored
    armorBreakHpPct: 0.5,     // loses armor at 50% hp
    armorBreakSpeedMult: 1.3, // +30% speed once armor breaks
  },
  vazka: {
    name: 'Mosadzná vážka',
    hp: 50,
    speed: 1.2,
    bounty: 9,
    flying: true, // cannon cannot hit it
  },
  navijac: {
    name: 'Navíjač',
    hp: 70,
    speed: 0.8,
    bounty: 13,
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
  // Level 2 boss: velka/tazsia verzia Kukuckoveho kolosu (GDD 5.4, rozsirena
  // mechanika). Viac fazi "odbitia hodin" (3 miesto 2), vacsi a castejsi
  // vypust posilnenych jednotiek (kotlar namiesto cvakaca), vyssi odmena
  // a vyssia strata zivotov pri prechode branou.
  boss_kukucka_major: {
    name: 'Kukučkový kolos Major',
    hp: 4200,
    speed: 0.55,
    bounty: 260,
    isBoss: true,
    livesCost: 8,
    spawnInterval: 9,
    spawnCount: 4,
    spawnType: 'kotlar',
    stunThresholds: [0.75, 0.5, 0.25],
    stunRadius: 4,
    stunDuration: 2.0,
  },
  // Level 3 boss (uloha X): este vacsi kolos. 4 fazy omracenia, rychlejsi
  // vypust (striedavo kotlar/navijac) a liecivá aura -- kazdu sekundu
  // dolieci beznym spojencom v healRadius healPctPerSec ich max HP.
  boss_kukucka_magnus: {
    name: 'Kukučkový kolos Magnus',
    hp: 8000,
    speed: 0.55,
    bounty: 420,
    isBoss: true,
    livesCost: 10,
    spawnInterval: 7,
    spawnCount: 5,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'navijac', 'kotlar', 'kotlar', 'navijac'],
    stunThresholds: [0.8, 0.6, 0.4, 0.2],
    stunRadius: 4.5,
    stunDuration: 2.2,
    healRadius: 3,
    healPctPerSec: 0.02,
  },
  // Level 4 boss (uloha X): najtazsi kolos. 5 faz omracenia, najrychlejsi
  // vypust (kotlar/vazka/navijac), silnejsia liecivá aura a pri 33 % HP sa
  // (ako Pacient nula) rozdeli na 2 polovice (boss_kukucka_polovica).
  boss_kukucka_imperator: {
    name: 'Kukučkový kolos Imperátor',
    hp: 14000,
    speed: 0.6,
    bounty: 700,
    isBoss: true,
    livesCost: 12,
    spawnInterval: 6,
    spawnCount: 6,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'kotlar'],
    stunThresholds: [0.9, 0.75, 0.6, 0.45, 0.34],
    stunRadius: 5,
    stunDuration: 2.5,
    healRadius: 3.5,
    healPctPerSec: 0.025,
    splitAtPct: 0.33,
    splitType: 'boss_kukucka_polovica',
    splitCount: 2,
    splitHpPct: 0.22, // kazda polovica dostane 22 % maxHp rodica (spolu 44 % > zvysnych 33 %)
  },
  // Level 5 boss (finale): Tyran. 6 faz omracenia, najrychlejsi a
  // najpocetnejsi vypust, najsilnejsia liecivá aura, pri 30 % HP sa
  // rozpadne na 3 tretiny (tyransky "rozkol").
  boss_kukucka_tyran: {
    name: 'Kukučkový kolos Tyran',
    hp: 24000,
    speed: 0.62,
    bounty: 900,
    isBoss: true,
    livesCost: 14,
    spawnInterval: 5,
    spawnCount: 7,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'kotlar', 'navijac'],
    stunThresholds: [0.92, 0.78, 0.64, 0.5, 0.36, 0.3],
    stunRadius: 5.5,
    stunDuration: 2.7,
    healRadius: 4,
    healPctPerSec: 0.028,
    splitAtPct: 0.3,
    splitType: 'boss_kukucka_tretina',
    splitCount: 3,
    splitHpPct: 0.15, // 3x15 % = 45 % > zvysnych 30 %
  },
  // Tretina Tyrana: vznikne iba rozdelenim.
  boss_kukucka_tretina: {
    name: 'Tretina Tyrana',
    hp: 3600,
    speed: 0.85,
    bounty: 260,
    isBoss: true,
    livesCost: 7,
    spawnInterval: 9,
    spawnCount: 2,
    spawnType: 'vrtiak',
    stunThresholds: [0.5],
    stunRadius: 3,
    stunDuration: 1.5,
  },
  // Polovica Imperatora: vznikne iba rozdelenim (hp sa nastavi z rodica).
  boss_kukucka_polovica: {
    name: 'Polovica Imperátora',
    hp: 3000,
    speed: 0.8,
    bounty: 220,
    isBoss: true,
    livesCost: 6,
    spawnInterval: 8,
    spawnCount: 2,
    spawnType: 'vrtiak',
    stunThresholds: [0.5],
    stunRadius: 3,
    stunDuration: 1.5,
  },

  // --- Levely 6-10 (uloha: "nova bastova sada", 1.11.2026) ---------------
  // Rovnaka Kukuckova kolos-rodina ako levely 2-5, len dalej skalovana
  // (vyssie HP/odmena/zivoty, castejsi vypust, viac faz omracenia, silnejsia
  // liecivá aura). Level 6/8/10 sa (ako Imperator/Tyran) rozpadaju na
  // fragmenty; level 7/9 su "vytrvalostne" bossovia bez rozpadu (ako
  // Major/Magnus) pre rovnaku variabilitu, aku uz GDD zaviedol.
  boss_kukucka_despota: {
    name: 'Kukučkový kolos Despota',
    hp: 36000,
    speed: 0.64,
    bounty: 1300,
    isBoss: true,
    livesCost: 16,
    spawnInterval: 4.5,
    spawnCount: 8,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'kotlar', 'navijac', 'kotlar'],
    stunThresholds: [0.93, 0.8, 0.68, 0.55, 0.43, 0.31, 0.26],
    stunRadius: 6,
    stunDuration: 2.9,
    healRadius: 4.5,
    healPctPerSec: 0.03,
    splitAtPct: 0.28,
    splitType: 'boss_kukucka_tretina',
    splitCount: 3,
    splitHpPct: 0.15,
  },
  boss_kukucka_dominus: {
    name: 'Kukučkový kolos Dominus',
    hp: 54000,
    speed: 0.66,
    bounty: 1800,
    isBoss: true,
    livesCost: 18,
    spawnInterval: 4,
    spawnCount: 9,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'kotlar', 'navijac', 'vazka', 'kotlar'],
    stunThresholds: [0.94, 0.83, 0.72, 0.61, 0.5, 0.39, 0.28, 0.22],
    stunRadius: 6.5,
    stunDuration: 3.1,
    healRadius: 5,
    healPctPerSec: 0.032,
  },
  // Stvrtina Hegemona: vznikne iba rozdelenim.
  boss_kukucka_stvrtina: {
    name: 'Štvrtina Hegemona',
    hp: 8000,
    speed: 0.9,
    bounty: 460,
    isBoss: true,
    livesCost: 9,
    spawnInterval: 7,
    spawnCount: 3,
    spawnType: 'vrtiak',
    stunThresholds: [0.5],
    stunRadius: 3.5,
    stunDuration: 1.8,
  },
  boss_kukucka_hegemon: {
    name: 'Kukučkový kolos Hegemón',
    hp: 80000,
    speed: 0.68,
    bounty: 2500,
    isBoss: true,
    livesCost: 20,
    spawnInterval: 3.5,
    spawnCount: 10,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'kotlar', 'navijac'],
    stunThresholds: [0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.27, 0.21],
    stunRadius: 7,
    stunDuration: 3.3,
    healRadius: 5.5,
    healPctPerSec: 0.034,
    splitAtPct: 0.26,
    splitType: 'boss_kukucka_stvrtina',
    splitCount: 4,
    splitHpPct: 0.1,
  },
  boss_kukucka_archont: {
    name: 'Kukučkový kolos Archont',
    hp: 120000,
    speed: 0.7,
    bounty: 3400,
    isBoss: true,
    livesCost: 22,
    spawnInterval: 3,
    spawnCount: 11,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'navijac', 'kotlar'],
    stunThresholds: [0.96, 0.87, 0.78, 0.69, 0.6, 0.51, 0.42, 0.33, 0.24, 0.18],
    stunRadius: 7.5,
    stunDuration: 3.5,
    healRadius: 6,
    healPctPerSec: 0.036,
  },
  // Petina Posledneho Mechanizmu: vznikne iba rozdelenim.
  boss_kukucka_petina: {
    name: 'Pätina Posledného Mechanizmu',
    hp: 18000,
    speed: 0.95,
    bounty: 900,
    isBoss: true,
    livesCost: 11,
    spawnInterval: 6,
    spawnCount: 3,
    spawnType: 'navijac',
    stunThresholds: [0.5],
    stunRadius: 4,
    stunDuration: 2.0,
  },
  // Level 10 boss (nova finale): Posledny Mechanizmus. Najvyssie HP, najviac
  // faz omracenia, najsilnejsia liecivá aura, pri 24 % HP sa rozpadne na 5
  // pätin (najchaotickejsi rozkol v hre -- vrchol eskalacie z Imperator/
  // Tyran/Despota/Hegemon).
  boss_kukucka_posledny_mechanizmus: {
    name: 'Posledný Mechanizmus',
    hp: 180000,
    speed: 0.72,
    bounty: 4500,
    isBoss: true,
    livesCost: 25,
    spawnInterval: 2.5,
    spawnCount: 12,
    spawnType: 'kotlar',
    spawnTypes: ['kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'navijac', 'kotlar', 'vazka', 'navijac', 'kotlar', 'vazka'],
    stunThresholds: [0.97, 0.89, 0.81, 0.73, 0.65, 0.57, 0.49, 0.41, 0.33, 0.28, 0.24],
    stunRadius: 8,
    stunDuration: 3.8,
    healRadius: 6.5,
    healPctPerSec: 0.038,
    splitAtPct: 0.24,
    splitType: 'boss_kukucka_petina',
    splitCount: 5,
    splitHpPct: 0.08,
  },
};

/** HP scaling per wave for regular enemies (task Y: +12 % -> +17 % per wave). */
export const HP_SCALE_PER_WAVE = 0.17;
/** Bosses keep the original +12 %/wave curve (their own tuning lives with the boss stats). */
export const BOSS_HP_SCALE_PER_WAVE = 0.12;

/** HP scaling by wave number (wave 1 = base). */
export function hpForWave(baseHp, wave, isBoss = false) {
  const k = isBoss ? BOSS_HP_SCALE_PER_WAVE : HP_SCALE_PER_WAVE;
  return baseHp * (1 + k * (wave - 1));
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
    this.maxHp = hpForWave(cfg.hp, wave, !!cfg.isBoss);
    this.hp = this.maxHp;
    this.bounty = cfg.bounty;
    this.flying = !!cfg.flying;
    this.livesCost = cfg.isBoss ? cfg.livesCost : 1;
    // Level HP multiplikator (map JSON hpMultiplier, uloha X); nastavuje
    // WaveRunner cez applyHpMultiplier(). Bossovia ho drzia aj pre minionov.
    this.hpMult = 1;
    this.minionHpMult = 1;

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

  /** Vynasobi max/aktualne HP (level hpMultiplier z map JSON). */
  applyHpMultiplier(mult) {
    if (!(mult > 0) || mult === 1) return;
    this.hpMult *= mult;
    this.maxHp *= mult;
    this.hp = this.maxHp;
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

    // Boss so splitAtPct (Imperator): pod prahom neumrie hned -- Game ho v
    // dalsom ticku rozdeli na polovice (aj ked jeden zasah preleti cez prah).
    const splitPct = this.cfg.splitAtPct;
    if (splitPct && !this._splitDone && this.hp <= this.maxHp * splitPct) {
      this.hp = Math.max(this.hp, 1);
      this._splitPending = true;
    }

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
