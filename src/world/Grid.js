/**
 * Grid.js
 * Načíta data-driven JSON mapu (znakový grid + metadáta) a vybuduje 2D pole Tile.
 * Bez závislosti na Three.js ani na renderi.
 */

import { Tile, TileType } from "./Tile.js";

// Mapovanie znaku v JSON gride na typ dlaždice.
const CHAR_TO_TYPE = {
  ".": TileType.GRASS,
  "#": TileType.PATH,
  "^": TileType.ELEVATED,
  x: TileType.DECOR,
};

export class Grid {
  /**
   * @param {object} mapData parsovaný JSON mapy (napr. map_01.json)
   */
  constructor(mapData) {
    if (!mapData || !Array.isArray(mapData.grid)) {
      throw new Error("Grid: neplatné mapové dáta - chýba 'grid'.");
    }

    this.id = mapData.id ?? "unknown_map";
    this.name = mapData.name ?? this.id;
    this.width = mapData.width ?? mapData.grid[0].length;
    this.height = mapData.height ?? mapData.grid.length;
    this.spawn = mapData.spawn ?? null;
    this.gate = mapData.gate ?? null;
    this.waypoints = mapData.waypoints ?? [];
    this.waves = mapData.waves ?? [];
    this.tileLegend = mapData.tileLegend ?? CHAR_TO_TYPE;

    /** @type {Tile[][]} indexované ako tiles[z][x] */
    this.tiles = this._buildTiles(mapData.grid);
  }

  /** Vytvorí statickú mapu z JSON reťazca (pohodlná factory metóda). */
  static fromJSON(jsonStringOrObject) {
    const data =
      typeof jsonStringOrObject === "string"
        ? JSON.parse(jsonStringOrObject)
        : jsonStringOrObject;
    return new Grid(data);
  }

  _buildTiles(rows) {
    if (rows.length !== this.height) {
      throw new Error(
        `Grid: počet riadkov (${rows.length}) nesedí s height (${this.height}).`
      );
    }

    const tiles = [];
    for (let z = 0; z < rows.length; z++) {
      const row = rows[z];
      if (row.length !== this.width) {
        throw new Error(
          `Grid: riadok ${z} má dĺžku ${row.length}, očakávané width (${this.width}).`
        );
      }
      const tileRow = [];
      for (let x = 0; x < row.length; x++) {
        const char = row[x];
        const type = CHAR_TO_TYPE[char];
        if (!type) {
          throw new Error(
            `Grid: neznámy znak '${char}' na [${x}, ${z}] v mape ${this.id}.`
          );
        }
        tileRow.push(new Tile(x, z, type));
      }
      tiles.push(tileRow);
    }
    return tiles;
  }

  /** Vráti Tile na súradniciach, alebo null ak je mimo gridu. */
  getTile(x, z) {
    if (!this.isInBounds(x, z)) return null;
    return this.tiles[z][x];
  }

  isInBounds(x, z) {
    return x >= 0 && x < this.width && z >= 0 && z < this.height;
  }

  /** Dá sa na danej dlaždici postaviť veža? (mimo gridu = false) */
  isBuildable(x, z) {
    const tile = this.getTile(x, z);
    return tile ? tile.buildable : false;
  }

  /**
   * Bonus k dostrelu veže na danej dlaždici (0 bežne, 0.15 na vyvýšenej).
   */
  getHeightBonus(x, z) {
    const tile = this.getTile(x, z);
    return tile ? tile.getHeightBonus() : 0;
  }

  /** Vráti zoznam všetkých dlaždíc typu "path". */
  getAllPathCells() {
    const result = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.isPath) result.push(tile);
      }
    }
    return result;
  }

  /** Vráti zoznam všetkých vyvýšených dlaždíc. */
  getAllElevatedCells() {
    const result = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.isElevated) result.push(tile);
      }
    }
    return result;
  }

  /** Iteruje cez všetky dlaždice, volá callback(tile). */
  forEachTile(callback) {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        callback(this.tiles[z][x]);
      }
    }
  }
}

export default Grid;
