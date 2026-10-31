/**
 * Path.js
 * Postaví kontinuálnu trasu z waypointov (grid súradnice) a poskytuje
 * API na pohyb nepriateľa po ceste pomocou lineárnej interpolácie.
 *
 * Bez závislosti na Three.js - body sú plain objekty { x, y, z }, čo si
 * vie zavolajúci kód (render vrstva) triviálne skonvertovať na THREE.Vector3.
 * (Three.js tu nie je nutné, pretože ide o 2D/izometrickú pohybovú logiku;
 * ak by bolo treba vracať skutočné THREE.Vector3 instancie, dá sa doplniť
 * `import { Vector3 } from "three"` - prejde cez `node --check` bez problémov,
 * len treba mať balík "three" nainštalovaný pri reálnom spustení s renderom.)
 */

export class Path {
  /**
   * @param {{x:number, z:number}[]} waypoints postupnosť bodov v grid súradniciach
   * @param {number} tileSize veľkosť jednej dlaždice vo world jednotkách (default 1)
   */
  constructor(waypoints, tileSize = 1) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new Error("Path: potrebuje aspoň 2 waypointy.");
    }
    this.tileSize = tileSize;

    // Normalizované world-space body (y=0, izometrický grid je rovina XZ).
    this.points = waypoints.map((wp) => ({
      x: wp.x * tileSize,
      y: 0,
      z: wp.z * tileSize,
    }));

    this.segments = this._buildSegments(this.points);
    this.totalLength = this.segments.reduce((sum, s) => sum + s.length, 0);
  }

  _buildSegments(points) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      segments.push({ a, b, length });
    }
    return segments;
  }

  /**
   * Vráti pozíciu na trase pre danú prejdenú vzdialenosť (world jednotky).
   * Hodnoty mimo <0, totalLength> sa clampujú na koncové body.
   * @param {number} distance
   * @returns {{x:number, y:number, z:number}}
   */
  getPositionAtDistance(distance) {
    if (distance <= 0) return { ...this.points[0] };
    if (distance >= this.totalLength) {
      return { ...this.points[this.points.length - 1] };
    }

    let remaining = distance;
    for (const segment of this.segments) {
      if (remaining <= segment.length) {
        const t = segment.length === 0 ? 0 : remaining / segment.length;
        return this._lerp(segment.a, segment.b, t);
      }
      remaining -= segment.length;
    }
    // Fallback (nemalo by nastať pri správnych vstupoch).
    return { ...this.points[this.points.length - 1] };
  }

  /**
   * Vráti pozíciu na trase pre normalizovaný parameter t v <0, 1>.
   * t=0 je spawn, t=1 je brána/koniec cesty.
   * @param {number} t
   */
  getPositionAtT(t) {
    const clamped = Math.max(0, Math.min(1, t));
    return this.getPositionAtDistance(clamped * this.totalLength);
  }

  /** Smerový (nenormalizovaný) vektor segmentu, v ktorom sa nachádza daná vzdialenosť. */
  getDirectionAtDistance(distance) {
    let remaining = Math.max(0, Math.min(distance, this.totalLength - 1e-6));
    for (const segment of this.segments) {
      if (remaining <= segment.length || segment === this.segments[this.segments.length - 1]) {
        return {
          x: segment.b.x - segment.a.x,
          y: 0,
          z: segment.b.z - segment.a.z,
        };
      }
      remaining -= segment.length;
    }
    return { x: 0, y: 0, z: 1 };
  }

  _lerp(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }
}

export default Path;
