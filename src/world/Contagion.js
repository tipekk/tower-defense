/**
 * Contagion.js
 * "Nákaza" mechanika pre Zombie mód: keď nepriateľ zomrie, dlaždica cesty pod ním
 * sa na CONTAGION_DURATION sekúnd "nakazí". Nezávislé na Grid/Tile - pracuje
 * s vlastnou internou mapou timerov podľa "x,z" kľúča, takže sa dá použiť
 * samostatne alebo v spojení s Grid.getTile(x,z).isInfected.
 */

import { CONTAGION_DURATION } from "./Tile.js";

function keyOf(x, z) {
  return `${x},${z}`;
}

export class Contagion {
  /**
   * @param {object} [options]
   * @param {number} [options.duration] dĺžka nákazy v sekundách (default 8)
   * @param {import('./Grid.js').Grid} [options.grid] voliteľný Grid - ak je
   *   zadaný, Contagion synchronizuje aj Tile.infectedTimer pre render vrstvu.
   */
  constructor(options = {}) {
    this.duration = options.duration ?? CONTAGION_DURATION;
    this.grid = options.grid ?? null;

    /** @type {Map<string, number>} kľúč "x,z" -> zostávajúci čas v sekundách */
    this.infectedTiles = new Map();
  }

  /**
   * Nakazí dlaždicu cesty na this.duration sekúnd (predĺži ak už je infikovaná).
   * @param {number} x
   * @param {number} z
   * @returns {boolean} true ak bola dlaždica novo nakazená (pre render notifikáciu)
   */
  infectTile(x, z) {
    const key = keyOf(x, z);
    const wasInfected = this.infectedTiles.has(key);
    this.infectedTiles.set(key, this.duration);
    this._syncTile(x, z, this.duration);
    return !wasInfected;
  }

  /** Je dlaždica na [x,z] práve infikovaná? */
  isInfected(x, z) {
    return this.infectedTiles.has(keyOf(x, z));
  }

  /** Zostávajúci čas nákazy na dlaždici (0 ak neinfikovaná). */
  getRemaining(x, z) {
    return this.infectedTiles.get(keyOf(x, z)) ?? 0;
  }

  /**
   * Posunie všetky timery o dt sekúnd a odstráni vypršané nákazy.
   * @param {number} dt delta čas v sekundách
   * @returns {{x:number, z:number, type:'infected'|'cured'}[]} zoznam zmien
   *   (type "cured" pre dlaždice, ktorým práve vypršala nákaza) - render vrstva
   *   si vie podľa toho prehrať efekt/notifikáciu.
   */
  update(dt) {
    const changes = [];
    for (const [key, remaining] of this.infectedTiles) {
      const next = remaining - dt;
      if (next <= 0) {
        this.infectedTiles.delete(key);
        const [x, z] = key.split(",").map(Number);
        this._syncTile(x, z, 0);
        changes.push({ x, z, type: "cured" });
      } else {
        this.infectedTiles.set(key, next);
        const [x, z] = key.split(",").map(Number);
        this._syncTile(x, z, next);
      }
    }
    return changes;
  }

  /** Vyčistí všetky nákazy (napr. pri reštarte vlny/mapy). */
  clear() {
    for (const key of this.infectedTiles.keys()) {
      const [x, z] = key.split(",").map(Number);
      this._syncTile(x, z, 0);
    }
    this.infectedTiles.clear();
  }

  _syncTile(x, z, value) {
    if (!this.grid) return;
    const tile = this.grid.getTile?.(x, z);
    if (tile) tile.infectedTimer = value;
  }
}

export default Contagion;
