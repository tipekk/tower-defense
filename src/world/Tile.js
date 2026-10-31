/**
 * Tile.js
 * Jedna dlaždica herného gridu. Čistý dátový objekt bez závislostí na Three.js.
 *
 * Typy dlaždíc:
 *  - "grass"    : stavebná dlaždica (dá sa postaviť veža)
 *  - "path"     : cesta, po ktorej idú nepriatelia; nedá sa na nej stavať
 *  - "elevated" : vyvýšená stavebná dlaždica (+1 úroveň, veža tu dostane +15% dostrel)
 *  - "decor"    : dekorácia; blokuje stavbu, dá sa za zlato vyčistiť (mimo scope tejto úlohy)
 */

export const TileType = Object.freeze({
  GRASS: "grass",
  PATH: "path",
  ELEVATED: "elevated",
  DECOR: "decor",
});

// Bonus k dostrelu veže postavenej na vyvýšenej dlaždici.
export const ELEVATED_RANGE_BONUS = 0.15;

// Dĺžka nákazy dlaždice cesty po smrti nepriateľa na nej (sekundy).
export const CONTAGION_DURATION = 8;

export class Tile {
  /**
   * @param {number} x súradnica gridu (kolóna)
   * @param {number} z súradnica gridu (riadok)
   * @param {string} type jeden z TileType
   */
  constructor(x, z, type = TileType.GRASS) {
    this.x = x;
    this.z = z;
    this.type = type;

    // Výškový level dlaždice (0 = úroveň terénu, 1 = vyvýšená plošina).
    this.height = type === TileType.ELEVATED ? 1 : 0;

    // Dá sa na dlaždicu postaviť veža?
    this.buildable = type === TileType.GRASS || type === TileType.ELEVATED;

    // Dekor blokuje stavbu, kým sa nevyčistí (flag pre budúcu "clear for gold" mechaniku).
    this.clearable = type === TileType.DECOR;
    this.cleared = false;

    // Stav nákazy (len Zombie mód) - zostávajúci čas v sekundách, 0 = neinfikovaná.
    this.infectedTimer = 0;
  }

  get isPath() {
    return this.type === TileType.PATH;
  }

  get isElevated() {
    return this.type === TileType.ELEVATED;
  }

  get isInfected() {
    return this.infectedTimer > 0;
  }

  /** Bonus k dostrelu veže postavenej na tejto dlaždici. */
  getHeightBonus() {
    return this.isElevated ? ELEVATED_RANGE_BONUS : 0;
  }

  /** Vyčistí dekor dlaždicu za zlato - robí ju stavebnou trávou. */
  clearDecor() {
    if (this.type !== TileType.DECOR) return false;
    this.type = TileType.GRASS;
    this.buildable = true;
    this.clearable = false;
    this.cleared = true;
    return true;
  }

  toJSON() {
    return {
      x: this.x,
      z: this.z,
      type: this.type,
      height: this.height,
      buildable: this.buildable,
      infectedTimer: this.infectedTimer,
    };
  }
}

export default Tile;
