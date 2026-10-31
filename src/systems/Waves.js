// Waves.js - wave spawning and clear-tracking for Bastion Grid.
// A wave definition is a list of { type, delay } entries: 'delay' is the
// number of seconds after the PREVIOUS entry's spawn (first entry's delay
// counts from wave start) before that enemy spawns.

import { Enemy } from '../entities/Enemy.js';

export class WaveRunner {
  /**
   * @param {Array<{type:string, delay:number}>} spawnList
   * @param {number} waveNumber
   * @param {{start:{x,y}, end:{x,y}, length:number}} path
   */
  constructor(spawnList, waveNumber, path) {
    this.spawnList = spawnList;
    this.waveNumber = waveNumber;
    this.path = path;
    this.nextIndex = 0;
    this.timer = spawnList.length > 0 ? spawnList[0].delay : 0;
    this.started = true;
    this.allSpawned = spawnList.length === 0;
  }

  /** Advances the spawn timer; returns a newly spawned Enemy or null. */
  update(dt) {
    if (this.allSpawned) return null;
    this.timer -= dt;
    if (this.timer > 0) return null;

    const entry = this.spawnList[this.nextIndex];
    const enemy = new Enemy(entry.type, this.waveNumber, this.path);
    // Level obtiaznost z map JSON (uloha X): hpMult = nasobok HP tejto
    // jednotky, minionHpMult = nasobok pre jednotky, ktore vypusti boss.
    if (entry.hpMult) enemy.applyHpMultiplier(entry.hpMult);
    if (entry.minionHpMult) enemy.minionHpMult = entry.minionHpMult;
    this.nextIndex += 1;

    if (this.nextIndex >= this.spawnList.length) {
      this.allSpawned = true;
    } else {
      this.timer = this.spawnList[this.nextIndex].delay;
    }
    return enemy;
  }

  /** A wave is "cleared" once every enemy has been spawned AND none remain alive on the field. */
  isCleared(enemiesFromThisWaveStillOnField) {
    return this.allSpawned && enemiesFromThisWaveStillOnField === 0;
  }
}

/** Convenience builder: N copies of the same enemy type at a fixed interval. */
export function buildUniformWave(type, count, interval, initialDelay = 1) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({ type, delay: i === 0 ? initialDelay : interval });
  }
  return list;
}
