// Projectile.js - object pool for tower projectiles (Bastion Grid)
// No allocation in the hot loop: a fixed pool of projectile objects is
// reused via spawn()/recycle(). Supports two travel modes:
//  - 'direct': flies toward (and tracks) its target at a fixed speed.
//  - 'arc'   : Katapult-style lob with a fixed flight time, hits a fixed
//              point (the target's position at launch) regardless of
//              target movement in the meantime - matches a physical lob.

function makeBlankProjectile() {
  return {
    active: false,
    type: 'direct',       // 'direct' | 'arc'
    x: 0, y: 0,
    targetEnemy: null,     // for 'direct': the enemy being tracked
    targetX: 0, targetY: 0, // for 'arc': fixed impact point
    speed: 0,              // units/sec, 'direct' only
    arcTime: 0,            // total flight seconds, 'arc' only
    arcElapsed: 0,
    dmg: 0,
    splash: 0,             // splash radius, 0 = single target
    canHitFlying: true,
    slowMult: null,        // frost effect, if any
    slowDuration: 0,
    sourceTowerId: null,
  };
}

export class ProjectilePool {
  constructor(initialSize = 200) {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < initialSize; i++) this.pool.push(makeBlankProjectile());
  }

  /** Acquire a projectile from the pool (or allocate one if exhausted) and configure it. */
  spawn(opts) {
    const p = this.pool.pop() || makeBlankProjectile();
    // reset to defaults, then apply opts
    Object.assign(p, makeBlankProjectileDefaults(), opts, { active: true });
    this.active.push(p);
    return p;
  }

  recycle(p) {
    p.active = false;
    const idx = this.active.indexOf(p);
    if (idx >= 0) this.active.splice(idx, 1);
    this.pool.push(p);
  }

  /**
   * Advance all active projectiles by dt. Calls onHit(projectile, impactX, impactY)
   * exactly once per projectile when it lands, then recycles it.
   */
  update(dt, onHit) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.type === 'arc') {
        p.arcElapsed += dt;
        if (p.arcElapsed >= p.arcTime) {
          onHit(p, p.targetX, p.targetY);
          this.recycle(p);
        }
      } else {
        // direct hit: either the target died in flight (fizzle, no damage)
        // or it reaches the target this tick.
        if (!p.targetEnemy || !p.targetEnemy.alive) {
          this.recycle(p);
          continue;
        }
        const dx = p.targetEnemy.x - p.x;
        const dy = p.targetEnemy.y - p.y;
        const dist = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (dist <= step || dist < 1e-4) {
          onHit(p, p.targetEnemy.x, p.targetEnemy.y);
          this.recycle(p);
        } else {
          p.x += (dx / dist) * step;
          p.y += (dy / dist) * step;
        }
      }
    }
  }
}

function makeBlankProjectileDefaults() {
  return {
    targetEnemy: null,
    targetX: 0, targetY: 0,
    speed: 0,
    arcTime: 0,
    arcElapsed: 0,
    dmg: 0,
    splash: 0,
    canHitFlying: true,
    slowMult: null,
    slowDuration: 0,
    sourceTowerId: null,
  };
}
