// Combat.js - per-tick combat resolution: tower cooldowns -> targeting ->
// projectile spawn -> projectile impact -> damage/effects. (Bastion Grid)

import { selectTarget } from './Targeting.js';

function combatDist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Direct-fire projectile speed for non-arc towers (units/sec). Fast but not instant. */
const DIRECT_PROJECTILE_SPEED = 20;

function fireFromTower(game, tower, stats, target) {
  const towerLike = { x: tower.x, y: tower.y, range: stats.range, canHitFlying: stats.canHitFlying };
  if (stats.projectileFlightTime) {
    // Katapult: arc lob to a fixed impact point -- the target's current
    // position, or (level 3 special, GDD 5.3) where it WILL be on landing.
    const aim = stats.predictive ? predictPosition(target, stats.projectileFlightTime) : { x: target.x, y: target.y };
    game.projectilePool.spawn({
      type: 'arc',
      x: tower.x,
      y: tower.y,
      targetX: aim.x,
      targetY: aim.y,
      arcTime: stats.projectileFlightTime,
      arcElapsed: 0,
      dmg: stats.dmg,
      splash: stats.splash || 0,
      canHitFlying: stats.canHitFlying,
      sourceTowerId: tower.id,
    });
  } else {
    game.projectilePool.spawn({
      type: 'direct',
      x: tower.x,
      y: tower.y,
      targetEnemy: target,
      speed: DIRECT_PROJECTILE_SPEED,
      dmg: stats.dmg,
      splash: stats.splash || 0,
      canHitFlying: stats.canHitFlying,
      slowMult: stats.slowMult || null,
      slowDuration: stats.slowDuration || 0,
      pierce: stats.pierce || 0, // always set: pooled projectiles keep stale props
      sourceTowerId: tower.id,
    });
  }
  void towerLike; // kept for reference/future use (e.g. muzzle effects)
}

/** Where an enemy will be after `seconds` at its current effective speed
 * (Katapult level-3 predictive aim). Falls back to its current position. */
function predictPosition(enemy, seconds) {
  const path = enemy.path;
  if (!path || !path.length || typeof enemy.getEffectiveSpeed !== 'function') return { x: enemy.x, y: enemy.y };
  const t = Math.min(1, enemy.t + (enemy.getEffectiveSpeed() * seconds) / path.length);
  if (typeof path.getPositionAtT === 'function') {
    const p = path.getPositionAtT(t);
    return { x: p.x, y: p.z };
  }
  return { x: path.start.x + (path.end.x - path.start.x) * t, y: path.start.y + (path.end.y - path.start.y) * t };
}

/** Max distance from the primary target at which a Balista bolt (level 3)
 * pierces into one more enemy. */
const PIERCE_RADIUS = 1.5;

function resolveImpact(game, projectile, impactX, impactY, onKill) {
  const { dmg, splash, canHitFlying, slowMult, slowDuration } = projectile;

  const applyToEnemy = (enemy) => {
    if (!enemy.alive) return;
    if (enemy.flying && canHitFlying === false) return;
    enemy.takeDamage(dmg);
    if (slowMult != null) enemy.applySlow(slowMult, slowDuration);
    if (!enemy.alive) onKill(enemy);
  };

  if (splash > 0) {
    for (const enemy of game.enemies) {
      if (!enemy.alive || enemy.reachedGate) continue;
      if (combatDist(enemy.x, enemy.y, impactX, impactY) <= splash) {
        applyToEnemy(enemy);
      }
    }
  } else if (projectile.targetEnemy) {
    const primary = projectile.targetEnemy;
    applyToEnemy(primary);
    // Balista level 3: the bolt passes through into the nearest other enemy.
    let pierce = projectile.pierce || 0;
    const hit = new Set([primary]);
    while (pierce-- > 0) {
      let best = null, bestD = PIERCE_RADIUS;
      for (const enemy of game.enemies) {
        if (hit.has(enemy) || !enemy.alive || enemy.reachedGate) continue;
        if (enemy.flying && canHitFlying === false) continue;
        const d = combatDist(enemy.x, enemy.y, impactX, impactY);
        if (d <= bestD) { best = enemy; bestD = d; }
      }
      if (!best) break;
      hit.add(best);
      applyToEnemy(best);
    }
  }
}

/**
 * Runs one fixed-timestep combat tick.
 * @param {import('../core/Game.js').Game} game
 * @param {number} dt fixed delta time (seconds)
 */
export function combatTick(game, dt) {
  for (const tower of game.towers) {
    if (tower.stunTimer > 0) {
      tower.stunTimer -= dt;
      continue; // stunned towers don't cool down or fire
    }
    const stats = tower.getStats();
    // Target is re-evaluated every tick (not only when ready to fire) so the
    // renderer can keep the turret tracking it between shots (tower.aimTarget).
    const target = selectTarget(game.enemies, { x: tower.x, y: tower.y, range: stats.range, canHitFlying: stats.canHitFlying }, tower.strategy);
    tower.aimTarget = target || null;
    if (tower.cooldown > 0) {
      tower.cooldown -= dt;
      continue;
    }
    if (!target) continue;

    tower.cooldown = 1 / stats.rate;
    tower.shotCount = (tower.shotCount || 0) + 1; // renderer watches this for recoil/muzzle flash
    fireFromTower(game, tower, stats, target);
  }

  game.projectilePool.update(dt, (projectile, ix, iy) => {
    resolveImpact(game, projectile, ix, iy, (killedEnemy) => game.onEnemyKilled(killedEnemy));
  });
}
