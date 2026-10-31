// Targeting.js - target selection strategies for towers (Bastion Grid)

export const STRATEGIES = ['first', 'last', 'strongest', 'closest'];

function targetingDist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Selects a target enemy for a tower.
 * @param {Array} enemies list of Enemy instances
 * @param {{x:number,y:number,range:number,canHitFlying:boolean}} towerLike
 * @param {string} strategy 'first'|'last'|'strongest'|'closest' (default 'first')
 * @returns {Enemy|null}
 */
export function selectTarget(enemies, towerLike, strategy = 'first') {
  const inRange = enemies.filter((e) => {
    if (!e.alive || e.reachedGate) return false;
    if (e.flying && towerLike.canHitFlying === false) return false;
    return targetingDist(towerLike.x, towerLike.y, e.x, e.y) <= towerLike.range;
  });

  if (inRange.length === 0) return null;

  switch (strategy) {
    case 'last':
      // enemy that has progressed least along the path (closest to spawn)
      return inRange.reduce((best, e) => (e.t < best.t ? e : best));
    case 'strongest':
      return inRange.reduce((best, e) => (e.hp > best.hp ? e : best));
    case 'closest':
      return inRange.reduce((best, e) =>
        targetingDist(towerLike.x, towerLike.y, e.x, e.y) < targetingDist(towerLike.x, towerLike.y, best.x, best.y) ? e : best
      );
    case 'first':
    default:
      // enemy that has progressed furthest along the path (closest to gate)
      return inRange.reduce((best, e) => (e.t > best.t ? e : best));
  }
}
