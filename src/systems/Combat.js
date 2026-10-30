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
    // Katapult: arc lob to the target's current position (fixed impact point).
    game.projectilePool.spawn({
      type: 'arc',
      x: tower.x,
      y: tower.y,
      targetX: target.x,
      targetY: target.y,
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
      sourceTowerId: tower.id,
    });
  }
  void towerLike; // kept for reference/future use (e.g. muzzle effects)
}

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
    applyToEnemy(projectile.targetEnemy);
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
