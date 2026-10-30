// Game.js - core game loop & state for Bastion Grid (Basic vs Zombie mode).
// Pure logic layer: no Three.js, no rendering. Fixed 60Hz timestep via an
// accumulator in step(), so update(dt) always receives dt = FIXED_DT and
// simulation stays deterministic regardless of real frame rate.

import { Tower, TOWER_TYPES } from '../entities/Tower.js';
import { ENEMY_TYPES } from '../entities/Enemy.js';
import { ProjectilePool } from '../entities/Projectile.js';
import { combatTick } from '../systems/Combat.js';
import { WaveRunner } from '../systems/Waves.js';
import { Economy, STARTING_GOLD } from '../systems/Economy.js';

export const FIXED_DT = 1 / 60;

export const GAME_STATES = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  WON: 'won',
  LOST: 'lost',
};

const DEFAULT_START_LIVES = 20;

export class Game {
  /**
   * @param {{path?: {start:{x,y}, end:{x,y}, length:number}, startLives?: number, startGold?: number}} opts
   */
  constructor(opts = {}) {
    this.path = opts.path || { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, length: 10 };
    this.state = GAME_STATES.MENU;

    this.towers = [];
    this.enemies = [];
    this.projectilePool = new ProjectilePool(200);

    this.economy = new Economy(opts.startGold ?? STARTING_GOLD);
    this.lives = opts.startLives ?? DEFAULT_START_LIVES;

    this.waveNumber = 0;
    this.waveRunner = null;
    this.waveQueue = []; // queued spawnLists for upcoming waves

    this._accumulator = 0;

    // simple event log/counters useful for tests & UI
    this.stats = { kills: 0, goldEarned: 0, livesLost: 0 };
  }

  get gold() {
    return this.economy.gold;
  }

  // ---- Game state control ----

  start() {
    this.state = GAME_STATES.PLAYING;
  }

  pause() {
    if (this.state === GAME_STATES.PLAYING) this.state = GAME_STATES.PAUSED;
  }

  resume() {
    if (this.state === GAME_STATES.PAUSED) this.state = GAME_STATES.PLAYING;
  }

  // ---- Tower management ----

  buildTower(type, x, y) {
    const cost = TOWER_TYPES[type].cost;
    if (!this.economy.spend(cost)) return null;
    const tower = new Tower(type, x, y);
    this.towers.push(tower);
    return tower;
  }

  upgradeTower(tower) {
    const cost = tower.getUpgradeCost();
    if (cost == null) return false;
    if (!this.economy.spend(cost)) return false;
    tower.upgrade();
    return true;
  }

  sellTower(tower) {
    const idx = this.towers.indexOf(tower);
    if (idx < 0) return false;
    const refund = tower.sell();
    this.economy.refund(refund);
    this.towers.splice(idx, 1);
    return true;
  }

  // ---- Wave management ----

  /** Queue a wave (spawn list) to run; starts immediately if none is active. */
  queueWave(spawnList) {
    this.waveQueue.push(spawnList);
    // A prior wave may have left us in WON: _checkWaveCleared() declares a
    // win as soon as the queue AND field are both empty, but the caller
    // (main.js) queues map waves one at a time as the player clicks
    // "Spustit vlnu", so an empty queue mid-campaign isn't really a win yet.
    // Queueing a new wave means the campaign continues, so un-stick the
    // state here rather than leaving step()/update() permanently no-op'd
    // (LOST stays terminal; only WON is revived).
    if (this.state === GAME_STATES.WON) this.state = GAME_STATES.PLAYING;
    if (!this.waveRunner) this._startNextWave();
  }

  _startNextWave() {
    const spawnList = this.waveQueue.shift();
    if (!spawnList) return;
    this.waveNumber += 1;
    this.waveRunner = new WaveRunner(spawnList, this.waveNumber, this.path);
  }

  isWaveActive() {
    return this.waveRunner !== null;
  }

  // ---- Simulation entry points ----

  /** Called with a REAL elapsed time (seconds); internally steps update() at FIXED_DT. */
  step(realDtSeconds) {
    if (this.state !== GAME_STATES.PLAYING) return;
    this._accumulator += realDtSeconds;
    while (this._accumulator >= FIXED_DT) {
      this.update(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }
  }

  /** One deterministic simulation tick at dt = FIXED_DT (or whatever fixed dt is passed in tests). */
  update(dt) {
    if (this.state !== GAME_STATES.PLAYING) return;

    this._updateWaveSpawning(dt);
    this._updateEnemies(dt);
    this._updateBosses(dt);
    combatTick(this, dt);
    this._cleanupEnemies();
    this._checkWaveCleared();
    this._checkGameOver();
  }

  _updateWaveSpawning(dt) {
    if (!this.waveRunner) return;
    const spawned = this.waveRunner.update(dt);
    if (spawned) this.enemies.push(spawned);
  }

  _updateEnemies(dt) {
    // Navijac aura is recomputed each tick (range-based, not a lingering buff):
    // reset, then re-apply to anyone currently in radius of a living buffer.
    for (const enemy of this.enemies) enemy._auraSpeedMult = 1;
    for (const buffer of this.enemies) {
      if (!buffer.alive || buffer.reachedGate || !buffer.isBuffAura) continue;
      for (const ally of this.enemies) {
        if (ally === buffer || !ally.alive || ally.reachedGate) continue;
        const dx = ally.x - buffer.x, dy = ally.y - buffer.y;
        if (Math.hypot(dx, dy) <= buffer.buffRadius) {
          ally._auraSpeedMult = Math.max(ally._auraSpeedMult, buffer.buffSpeedMult);
        }
      }
    }
    for (const enemy of this.enemies) {
      enemy.update(dt);
    }
  }

  _updateBosses(dt) {
    for (const boss of this.enemies) {
      if (!boss.alive || boss.reachedGate) continue;
      if (!ENEMY_TYPES[boss.type]?.isBoss) continue;

      // Periodic minion spawn.
      if (boss.spawnTimer <= 0) {
        const cfg = ENEMY_TYPES[boss.type];
        for (let i = 0; i < cfg.spawnCount; i++) {
          this.enemies.push(new (boss.constructor)(cfg.spawnType, this.waveNumber, this.path));
        }
        boss.spawnTimer = cfg.spawnInterval;
      }

      // HP-threshold stun pulse on nearby towers.
      const cfg = ENEMY_TYPES[boss.type];
      const hpPct = boss.hp / boss.maxHp;
      for (const threshold of cfg.stunThresholds) {
        if (hpPct <= threshold && !boss.triggeredStunThresholds.has(threshold)) {
          boss.triggeredStunThresholds.add(threshold);
          for (const tower of this.towers) {
            const dx = tower.x - boss.x, dy = tower.y - boss.y;
            if (Math.hypot(dx, dy) <= cfg.stunRadius) {
              tower.applyStun(cfg.stunDuration);
            }
          }
        }
      }
    }
  }

  /** Removes dead/arrived enemies, paying bounty or deducting lives as appropriate. */
  _cleanupEnemies() {
    const remaining = [];
    for (const enemy of this.enemies) {
      if (enemy.reachedGate) {
        this.lives -= enemy.livesCost;
        this.stats.livesLost += enemy.livesCost;
        continue; // removed from field
      }
      if (!enemy.alive) {
        this.onEnemyKilled(enemy, { alreadyHandled: true });
        continue; // removed from field
      }
      remaining.push(enemy);
    }
    this.enemies = remaining;
  }

  /** Called by Combat when a projectile kills an enemy, and by cleanup for any other death. */
  onEnemyKilled(enemy, { alreadyHandled = false } = {}) {
    if (enemy._killRewardPaid) return;
    enemy._killRewardPaid = true;
    this.economy.addBounty(enemy.bounty);
    this.stats.kills += 1;
    this.stats.goldEarned += enemy.bounty;
    void alreadyHandled;
  }

  _checkWaveCleared() {
    if (!this.waveRunner) return;
    const stillOnField = this.enemies.length; // all current enemies belong to the active wave in this simplified model
    if (this.waveRunner.isCleared(stillOnField)) {
      this.waveRunner = null;
      if (this.waveQueue.length > 0) {
        this._startNextWave();
      } else {
        // No more queued waves and field is empty: treat as a win for this session.
        this.state = GAME_STATES.WON;
      }
    }
  }

  _checkGameOver() {
    if (this.lives <= 0) {
      this.lives = 0;
      this.state = GAME_STATES.LOST;
    }
  }
}
