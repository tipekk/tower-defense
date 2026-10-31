// EnemyModels.js
// Procedural (primitives-only) clockwork wind-up enemy models.
//
// API:
//   createEnemyModel(type) -> THREE.Group
//     origin = bottom centre (feet at y=0), faces local +Z.
//     group.userData.update(dt, t, speedFactor)
//     group.userData.hitFlash()
//     group.userData.setHpFrac(f)        // < 0.25 -> key stutters + sparks + wobble
//     group.userData.setZombie(on)       // patina tint, peeled lacquer, glowing mushrooms, jitter
//     group.userData.flying              // true for 'vazka'
//
// All animation happens on an inner "rig" group, so the game is free to set
// group.position / group.rotation itself.
// Geometries are cached and shared between instances; materials are created
// per instance (flash / zombie tint are per enemy).

import * as THREE from 'three';

const TAU = Math.PI * 2;
const ZOMBIE_TINT = new THREE.Color(0x6b8f71);
const FLASH_COLOR = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
// Geometry helpers (cached)
// ---------------------------------------------------------------------------

const GEO = new Map();
function G(key, fn) {
  let g = GEO.get(key);
  if (!g) {
    g = fn();
    GEO.set(key, g);
  }
  return g;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    _q.clone().setFromEuler(_e.set(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
}

/**
 * Merge several geometries (each with its own transform and optional vertex
 * colour) into one non-indexed BufferGeometry (position + normal [+ color]).
 * parts: [[geometry, matrix?, colorHex?], ...]
 */
function merge(parts) {
  const anyColor = parts.some((p) => p[2] !== undefined);
  const pos = [];
  const nor = [];
  const col = [];
  let count = 0;
  const c = new THREE.Color();
  for (const [g0, m, hex] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    pos.push(g.attributes.position.array);
    nor.push(g.attributes.normal.array);
    const n = g.attributes.position.count;
    if (anyColor) {
      c.set(hex !== undefined ? hex : 0xffffff);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        a[i * 3] = c.r;
        a[i * 3 + 1] = c.g;
        a[i * 3 + 2] = c.b;
      }
      col.push(a);
    }
    count += n;
    g.dispose();
  }
  const cat = (arrs) => {
    const out = new Float32Array(count * 3);
    let o = 0;
    for (const a of arrs) {
      out.set(a, o);
      o += a.length;
    }
    return out;
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
  if (anyColor) geo.setAttribute('color', new THREE.BufferAttribute(cat(col), 3));
  geo.computeBoundingSphere();
  return geo;
}

function lathe(pts, segs = 16) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 12, hs = 8, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);

/** Spur gear in the XY plane, thickness along Z, centred. */
function gearGeo(rOut, rIn, teeth, depth, hole = 0) {
  return G(`gear_${rOut}_${rIn}_${teeth}_${depth}_${hole}`, () => {
    const s = new THREE.Shape();
    const da = TAU / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * da;
      const pts = [
        [a, rIn],
        [a + da * 0.18, rOut],
        [a + da * 0.5, rOut],
        [a + da * 0.68, rIn],
      ];
      pts.forEach(([ang, r], k) => {
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r;
        if (i === 0 && k === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      });
    }
    s.closePath();
    if (hole > 0) {
      const h = new THREE.Path();
      h.absarc(0, 0, hole, 0, TAU, true);
      s.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.25,
      bevelSize: depth * 0.2,
      bevelSegments: 1,
      curveSegments: 10,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Butterfly winding-key bow, lobes along X, flat in XY plane, thickness Z. */
function keyBowGeo(R, depth) {
  return G(`bow_${R}_${depth}`, () => {
    const s = new THREE.Shape();
    const N = 56;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const c = Math.abs(Math.cos(th));
      const r = R * (0.36 + 0.64 * Math.pow(c, 0.7));
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r * 0.82;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    [-1, 1].forEach((sd) => {
      const h = new THREE.Path();
      h.absarc(sd * R * 0.6, 0, R * 0.2, 0, TAU, sd > 0);
      s.holes.push(h);
    });
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.35,
      bevelSize: depth * 0.3,
      bevelSegments: 2,
      curveSegments: 12,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Key shaft along +Y from 0..len with a collar and a square tip. */
function keyShaftGeo(len, r) {
  return G(`shaft_${len}_${r}`, () =>
    merge([
      [cyl(r, r, len, 10), M(0, len / 2, 0)],
      [cyl(r * 1.9, r * 1.9, r * 1.2, 14), M(0, len * 0.18, 0)],
      [sph(r * 1.5, 10, 6), M(0, len, 0)],
    ])
  );
}

/**
 * Canonical winding key: shaft along local +Y, butterfly bow at the top,
 * spins around +Y via `spin`. Orient `outer` to point the key where needed.
 */
function makeKey(mat, len, R, depth = 0.045) {
  const outer = new THREE.Group();
  const spin = new THREE.Group();
  outer.add(spin);
  const shaft = new THREE.Mesh(keyShaftGeo(len, R * 0.17), mat);
  shaft.castShadow = true;
  spin.add(shaft);
  const bow = new THREE.Mesh(keyBowGeo(R, depth), mat);
  bow.position.y = len + R * 0.55;
  bow.castShadow = true;
  spin.add(bow);
  return { outer, spin };
}

function mushroomGeo() {
  return G('mushroom', () => {
    const stem = lathe(
      [
        [0.0, 0],
        [0.022, 0],
        [0.017, 0.05],
        [0.015, 0.085],
        [0.0, 0.09],
      ],
      7
    );
    const cap = lathe(
      [
        [0.0, 0.075],
        [0.05, 0.08],
        [0.058, 0.095],
        [0.045, 0.12],
        [0.02, 0.132],
        [0.0, 0.135],
      ],
      9
    );
    const cap2 = lathe(
      [
        [0.0, 0.035],
        [0.028, 0.04],
        [0.03, 0.05],
        [0.02, 0.064],
        [0.0, 0.068],
      ],
      7
    );
    const stem2 = cyl(0.009, 0.013, 0.05, 5);
    return merge([
      [stem, null, 0xd8f0b0],
      [cap, null, 0x9ef01a],
      [stem2, M(0.05, 0.02, 0.01, 0, 0, -0.5), 0xd8f0b0],
      [cap2, M(0.06, 0.0, 0.01, 0, 0, -0.5), 0x9ef01a],
    ]);
  });
}

function patchGeo() {
  return G('patch', () => {
    const g = new THREE.IcosahedronGeometry(0.06, 0);
    g.scale(1.25, 0.85, 0.28);
    return g;
  });
}

// ---------------------------------------------------------------------------
// Per-instance material kit: flash, zombie tint, emissive pulse
// ---------------------------------------------------------------------------

class Kit {
  constructor() {
    this.mats = [];
    this.zombie = false;
  }

  /**
   * o: r (roughness), m (metalness), e (emissive hex), ei (emissive int),
   * zk (zombie tint amount), zc (explicit zombie colour), ze (zombie emissive hex),
   * vc (vertexColors), flat, transparent, opacity, side, depthWrite
   */
  mat(hex, o = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: o.r ?? 0.5,
      metalness: o.m ?? 0.1,
      emissive: o.e ?? 0x000000,
      emissiveIntensity: 1,
      vertexColors: !!o.vc,
      flatShading: !!o.flat,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: o.depthWrite ?? true,
    });
    const u = mat.userData;
    u.base = mat.color.clone();
    u.zom = o.zc !== undefined ? new THREE.Color(o.zc) : mat.color.clone().lerp(ZOMBIE_TINT, o.zk ?? 0.55);
    u.baseEm = new THREE.Color(o.e ?? 0).multiplyScalar(o.ei ?? 1);
    u.zEm = o.ze !== undefined ? new THREE.Color(o.ze).multiplyScalar(o.ei ?? 1) : u.baseEm.clone();
    u.r = mat.roughness;
    u.m = mat.metalness;
    u.zr = o.zr ?? Math.min(1, mat.roughness + 0.3);
    u.zm = o.zm ?? mat.metalness * 0.45;
    u.pulse = 1;
    this.mats.push(mat);
    return mat;
  }

  setZombie(on) {
    this.zombie = on;
    for (const m of this.mats) {
      const u = m.userData;
      m.color.copy(on ? u.zom : u.base);
      m.roughness = on ? u.zr : u.r;
      m.metalness = on ? u.zm : u.m;
    }
  }

  refresh(flash) {
    for (const m of this.mats) {
      const u = m.userData;
      m.emissive.copy(this.zombie ? u.zEm : u.baseEm).multiplyScalar(u.pulse);
      if (flash > 0) m.emissive.lerp(FLASH_COLOR, flash * 0.8);
    }
  }
}

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Shared enemy scaffolding
// ---------------------------------------------------------------------------

function scaffold(type) {
  const group = new THREE.Group();
  group.name = `enemy_${type}`;
  const rig = new THREE.Group();
  group.add(rig);
  const kit = new Kit();
  const st = {
    phase: Math.random() * TAU,
    seed: Math.random() * 100,
    hp: 1,
    zombie: false,
    flash: 0,
    keyAngle: Math.random() * TAU,
    jx: 0,
    jy: 0,
    jz: 0,
    jitT: 0,
    walkRate: 7,
    keyRate: 4,
  };
  const E = { type, group, rig, kit, st, mushrooms: [], patches: [], spark: null, sparkAnchor: null };
  E.mushMat = kit.mat(0xffffff, { vc: true, e: 0x9ef01a, ei: 0.55, r: 0.45, m: 0, zk: 0, ze: 0x9ef01a });
  E.bareMat = kit.mat(0x7d7466, { r: 0.95, m: 0.15, zc: 0x6e6455 });
  return E;
}

function addMushroom(E, parent, x, y, z, s = 1, rx = 0, rz = 0) {
  const m = add(parent, mushroomGeo(), E.mushMat, x, y, z, rx, Math.random() * TAU, rz, false);
  m.scale.setScalar(s);
  m.userData.s = s;
  m.visible = false;
  E.mushrooms.push(m);
  return m;
}

/** Flattened chip of bare metal sitting on a surface, oriented along `normal`. */
function addPatch(E, parent, x, y, z, nx, ny, nz, s = 1) {
  const m = add(parent, patchGeo(), E.bareMat, x, y, z, 0, 0, 0, false);
  m.lookAt(new THREE.Vector3(x + nx, y + ny, z + nz));
  m.rotateZ(Math.random() * TAU);
  m.scale.setScalar(s);
  m.visible = false;
  E.patches.push(m);
  return m;
}

function addSpark(E, parent, x, y, z) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  const spark = new THREE.Mesh(G('spark', () => new THREE.OctahedronGeometry(0.06, 0)), mat);
  spark.position.set(x, y, z);
  spark.visible = false;
  parent.add(spark);
  E.spark = spark;
  E.sparkBase = new THREE.Vector3(x, y, z);
}

function finalize(E, animate, extra = {}) {
  const { group, rig, kit, st } = E;
  let flashDirty = false;

  const ud = {
    type: E.type,
    flying: !!extra.flying,
    isZombie: false,
    rig,
    update(dt, t, speedFactor = 1) {
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      const sf = Math.max(0, Math.min(speedFactor ?? 1, 2.5));

      // Walk phase: zombies lurch (uneven speed through the cycle).
      let rate = st.walkRate * sf;
      if (st.zombie) rate *= 0.45 + 1.1 * Math.abs(Math.sin(st.phase * 0.5 + 0.4));
      st.phase += dt * rate;

      // Winding key: always unwinding while alive, faster when moving fast.
      let ks = st.keyRate * (0.35 + 0.65 * Math.min(sf, 2));
      if (st.hp < 0.25) {
        const n = Math.sin(t * 5.3 + st.seed) + 0.7 * Math.sin(t * 13.1 + st.seed * 2.1);
        ks *= n > 0.25 ? 0 : n < -1.1 ? -0.8 : 1.6;
      }
      st.keyAngle += ks * dt;

      animate(dt, t, sf, st);

      // Zombie: twitchy stop-motion jitter on top of the regular pose.
      if (st.zombie) {
        st.jitT -= dt;
        if (st.jitT <= 0) {
          st.jitT = 0.05 + Math.random() * 0.12;
          const big = Math.random() < 0.15 ? 2.2 : 1;
          st.jx = (Math.random() - 0.5) * 0.09 * big;
          st.jz = (Math.random() - 0.5) * 0.11 * big;
          st.jy = (Math.random() - 0.5) * 0.12 * big;
        }
        rig.rotation.x += st.jx;
        rig.rotation.z += st.jz + 0.07;
        rig.rotation.y += st.jy * 0.5;
        for (let i = 0; i < E.mushrooms.length; i++) {
          const m = E.mushrooms[i];
          m.scale.setScalar(m.userData.s * (1 + Math.sin(t * 3.1 + i * 1.7) * 0.09));
        }
        E.mushMat.userData.pulse = 0.85 + 0.35 * Math.sin(t * 2.3 + st.seed);
      }

      // Low HP: wobble + sparks from the key.
      if (st.hp < 0.25) {
        rig.rotation.z += Math.sin(t * 21 + st.seed) * 0.035;
        rig.rotation.x += Math.sin(t * 17.3 + st.seed) * 0.02;
        if (E.spark) {
          const on = ((t * 3.3 + st.seed) % 1) < 0.32;
          E.spark.visible = on;
          if (on) {
            E.spark.position.set(
              E.sparkBase.x + (Math.random() - 0.5) * 0.18,
              E.sparkBase.y + Math.random() * 0.14,
              E.sparkBase.z + (Math.random() - 0.5) * 0.14
            );
            E.spark.scale.setScalar(0.6 + Math.random() * 0.9);
            E.spark.rotation.set(Math.random() * 3, Math.random() * 3, 0);
          }
        }
      } else if (E.spark && E.spark.visible) {
        E.spark.visible = false;
      }

      // Hit flash (~0.1 s).
      if (st.flash > 0) {
        st.flash = Math.max(0, st.flash - dt / 0.11);
        flashDirty = true;
      }
      if (flashDirty || E.pulsing || st.zombie) {
        kit.refresh(st.flash);
        if (st.flash <= 0) flashDirty = E.pulsing || st.zombie;
      }
    },
    hitFlash() {
      st.flash = 1;
    },
    setHpFrac(f) {
      st.hp = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 1));
    },
    setZombie(on) {
      on = !!on;
      st.zombie = on;
      ud.isZombie = on;
      kit.setZombie(on);
      E.mushrooms.forEach((m) => (m.visible = on));
      E.patches.forEach((m) => (m.visible = on));
      if (E.onZombie) E.onZombie(on);
      kit.refresh(st.flash);
      flashDirty = true;
    },
  };
  group.userData = ud;
  kit.refresh(0);
  return group;
}

// ---------------------------------------------------------------------------
// CVAKAC -- wind-up toy soldier: red enamel drum body, tall shako, big key
// ---------------------------------------------------------------------------

function createCvakac() {
  const E = scaffold('cvakac');
  const { rig, kit, st } = E;
  st.walkRate = 8.5;
  st.keyRate = 5;

  const red = kit.mat(0xe4572e, { r: 0.32, m: 0.05, zc: 0xa0644a });
  const brass = kit.mat(0xd9ae35, { r: 0.32, m: 0.42, zc: 0x7f8f5a });
  const navy = kit.mat(0x263063, { r: 0.45, m: 0.05, zk: 0.4 });
  const black = kit.mat(0x17171d, { r: 0.28, m: 0.1, zk: 0.2 });
  const cream = kit.mat(0xf6e6cc, { r: 0.45, m: 0, zc: 0xa9bf9a });
  const white = kit.mat(0xf7f3ea, { r: 0.4, m: 0, zk: 0.5 });

  rig.scale.setScalar(0.93);
  const body = new THREE.Group();
  body.position.y = 0.26;
  rig.add(body);

  // Barrel / drum torso
  add(
    body,
    G('cv_body', () =>
      lathe(
        [
          [0, 0],
          [0.17, 0],
          [0.205, 0.035],
          [0.228, 0.17],
          [0.205, 0.31],
          [0.17, 0.345],
          [0, 0.345],
        ],
        20
      )
    ),
    red
  );
  // brass bands + belt buckle + shoulder fittings
  add(
    body,
    G('cv_brass', () =>
      merge([
        [new THREE.TorusGeometry(0.19, 0.026, 8, 22), M(0, 0.02, 0, Math.PI / 2)],
        [new THREE.TorusGeometry(0.188, 0.026, 8, 22), M(0, 0.325, 0, Math.PI / 2)],
        [box(0.07, 0.07, 0.03), M(0, 0.1, 0.222, -0.05)],
      ])
    ),
    brass
  );
  // white cross belts (X over chest)
  add(
    body,
    G('cv_belt', () =>
      merge([
        [new THREE.TorusGeometry(0.224, 0.02, 6, 24), M(0, 0.17, 0, Math.PI / 2, 0.62, 0, 1, 1, 1)],
        [new THREE.TorusGeometry(0.224, 0.02, 6, 24), M(0, 0.17, 0, Math.PI / 2, -0.62, 0, 1, 1, 1)],
      ])
    ),
    white
  );
  // Chest cog (spins)
  const cog = add(body, gearGeo(0.075, 0.058, 10, 0.03, 0.018), brass, 0, 0.19, 0.225, -0.08);

  // Head: porcelain ball, painted eyes, rosy cheeks, moustache
  const head = new THREE.Group();
  head.position.y = 0.43;
  body.add(head);
  add(head, G('cv_head', () => sph(0.125, 16, 12)), cream, 0, 0, 0);
  add(
    head,
    G('cv_face', () =>
      merge([
        [sph(0.022, 8, 6), M(-0.048, 0.01, 0.112, 0, 0, 0, 1, 1.25, 0.6)],
        [sph(0.022, 8, 6), M(0.048, 0.01, 0.112, 0, 0, 0, 1, 1.25, 0.6)],
        // moustache: two tilted capsules
        [sph(0.035, 8, 6), M(-0.035, -0.04, 0.115, 0, 0, 0.35, 1.5, 0.6, 0.6)],
        [sph(0.035, 8, 6), M(0.035, -0.04, 0.115, 0, 0, -0.35, 1.5, 0.6, 0.6)],
      ])
    ),
    black,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );

  // Shako hat with chin strap, brass badge, red pompom
  const hat = new THREE.Group();
  hat.position.y = 0.075;
  head.add(hat);
  add(
    hat,
    G('cv_hat', () =>
      merge([
        [cyl(0.118, 0.108, 0.2, 16), M(0, 0.1, 0)],
        [cyl(0.122, 0.122, 0.018, 16), M(0, 0.205, 0)],
        // visor
        [cyl(0.11, 0.11, 0.016, 16, 1), M(0, 0.008, 0.05, -0.18, 0, 0, 1, 1, 0.75)],
      ])
    ),
    navy
  );
  add(
    hat,
    G('cv_hatbrass', () =>
      merge([
        [new THREE.TorusGeometry(0.112, 0.016, 6, 18), M(0, 0.02, 0, Math.PI / 2)],
        [box(0.07, 0.07, 0.02), M(0, 0.1, 0.108, -0.05, 0, Math.PI / 4)],
      ])
    ),
    brass
  );
  const plume = add(hat, G('cv_plume', () => sph(0.05, 10, 8)), red, 0, 0.255, 0.01);

  // Arms with brass epaulettes
  const arms = [];
  [-1, 1].forEach((s) => {
    const sh = new THREE.Group();
    sh.position.set(0.215 * s, 0.29, 0);
    sh.rotation.z = 0.16 * s;
    body.add(sh);
    add(sh, G('cv_epaul', () => sph(0.065, 10, 6, 0, TAU, 0, Math.PI / 2)), brass, 0.01 * s, 0.0, 0, 0, 0, 0, true).scale.set(
      1,
      0.6,
      1
    );
    add(
      sh,
      G('cv_arm', () => merge([[cyl(0.044, 0.04, 0.2, 10), M(0, -0.1, 0)]])),
      red
    );
    add(sh, G('cv_hand', () => sph(0.045, 10, 8)), white, 0, -0.215, 0.0);
    arms.push(sh);
  });

  // Hinged legs: navy trousers, brass hinge, black boots
  const legs = [];
  [-1, 1].forEach((s) => {
    const hip = new THREE.Group();
    hip.position.set(0.095 * s, 0.29, 0);
    rig.add(hip);
    add(hip, G('cv_leg', () => cyl(0.062, 0.052, 0.2, 10)), navy, 0, -0.1, 0);
    add(hip, G('cv_hinge', () => cyl(0.042, 0.042, 0.135, 10)), brass, 0, -0.13, 0, 0, 0, Math.PI / 2);
    add(
      hip,
      G('cv_boot', () =>
        merge([
          [box(0.115, 0.085, 0.13), M(0, 0, 0)],
          [cyl(0.0575, 0.0575, 0.085, 10, 1), M(0, 0, 0.065)],
        ])
      ),
      black,
      0,
      -0.245,
      0.015
    );
    legs.push(hip);
  });

  // Big winding key on the back
  const key = makeKey(brass, 0.14, 0.17, 0.05);
  key.outer.position.set(0, 0.47, -0.2);
  key.outer.rotation.x = -Math.PI / 2 + 0.3;
  rig.add(key.outer);
  addSpark(E, rig, 0, 0.5, -0.38);

  // Zombie extras
  addMushroom(E, hat, 0.07, 0.2, 0.02, 1.1, 0, -0.4);
  addMushroom(E, body, -0.2, 0.3, -0.05, 1.0, 0, 0.7);
  addMushroom(E, legs[0], -0.04, -0.13, 0.04, 0.8, 0.3, 0.8);
  addPatch(E, body, 0.15, 0.2, 0.16, 0.7, 0, 0.7, 1.1);
  addPatch(E, body, -0.2, 0.08, 0.05, -1, 0, 0.2, 0.9);
  addPatch(E, hat, -0.08, 0.12, 0.08, -0.7, 0, 0.7, 0.7);

  finalize(E, (dt, t, sf, st) => {
    const p = st.phase;
    const amp = 0.55 * Math.min(1, sf * 1.2) + (st.zombie ? 0.1 : 0);
    const sw = Math.sin(p);
    const th = sw * amp;
    legs[0].rotation.x = th;
    legs[1].rotation.x = -th;
    arms[0].rotation.x = -th * 1.1;
    arms[1].rotation.x = th * 1.1;
    if (st.zombie) {
      arms[0].rotation.x = -1.25 + th * 0.3; // zombie arms forward
      arms[1].rotation.x = -1.1 - th * 0.3;
    }
    rig.position.y = -0.3 * (1 - Math.cos(th)) + 0.02 * Math.abs(Math.cos(p));
    rig.rotation.set(0.05 * Math.min(sf, 1.5), 0, Math.sin(p) * 0.07);
    head.rotation.z = -Math.sin(p) * 0.08 + (st.zombie ? 0.25 : 0);
    head.rotation.x = st.zombie ? 0.15 : 0;
    plume.position.z = 0.01 - Math.cos(p * 2) * 0.012;
    cog.rotation.z = -st.keyAngle * 1.6;
    key.spin.rotation.y = st.keyAngle;
  });
  return E.group;
}

// ---------------------------------------------------------------------------
// VRTIAK -- candy-striped spinning top balanced on a single wheel in a fork
// ---------------------------------------------------------------------------

function stripedTopGeo() {
  return G('vr_top', () => {
    // Smooth top profile, tip at y=0
    const prof = [];
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = u * 0.5;
      let r;
      if (y < 0.3) {
        const k = y / 0.3;
        r = 0.02 + 0.27 * Math.pow(k, 0.9);
      } else {
        const k = (y - 0.3) / 0.2;
        r = 0.29 * Math.sqrt(Math.max(0, 1 - k * k * 0.88));
      }
      prof.push([Math.max(r, 0.001), y]);
    }
    prof.unshift([0, 0]);
    prof.push([0, 0.5]);
    const g = lathe(prof, 40).toNonIndexed();
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const red = new THREE.Color(0xe0322a);
    const wht = new THREE.Color(0xfbf6ec);
    for (let f = 0; f < pos.count; f += 3) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += pos.getX(f + k);
        cy += pos.getY(f + k);
        cz += pos.getZ(f + k);
      }
      cx /= 3;
      cy /= 3;
      cz /= 3;
      const a = Math.atan2(cz, cx) / TAU + 0.5;
      const band = cy > 0.25 && cy < 0.33;
      const c = band ? red : Math.floor(a * 10) % 2 === 0 ? red : wht;
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
}

function createVrtiak() {
  const E = scaffold('vrtiak');
  const { rig, kit, st } = E;
  st.walkRate = 10;
  st.keyRate = 14;

  const striped = kit.mat(0xffffff, { vc: true, r: 0.25, m: 0.05, zc: 0xb5c9a8 });
  const brass = kit.mat(0xd9ae35, { r: 0.32, m: 0.42, zc: 0x7f8f5a });
  const rubber = kit.mat(0x23222a, { r: 0.7, m: 0.05, zk: 0.25 });
  const red = kit.mat(0xe4572e, { r: 0.3, m: 0.05 });

  // Wheel in a brass fork
  const wheel = new THREE.Group();
  wheel.position.y = 0.15;
  rig.add(wheel);
  add(wheel, G('vr_tire', () => new THREE.TorusGeometry(0.11, 0.04, 8, 20)), rubber, 0, 0, 0, 0, Math.PI / 2, 0);
  add(
    wheel,
    G('vr_hub', () =>
      merge([
        [cyl(0.06, 0.06, 0.05, 12), M(0, 0, 0, 0, 0, Math.PI / 2)],
        [box(0.03, 0.21, 0.02), M(0, 0, 0)],
        [box(0.03, 0.02, 0.21), M(0, 0, 0)],
      ])
    ),
    red
  );
  add(
    rig,
    G('vr_fork', () =>
      merge([
        [box(0.03, 0.24, 0.05), M(-0.085, 0.26, 0, 0, 0, -0.15)],
        [box(0.03, 0.24, 0.05), M(0.085, 0.26, 0, 0, 0, 0.15)],
        [cyl(0.02, 0.02, 0.2, 8), M(0, 0.15, 0, 0, 0, Math.PI / 2)],
        [new THREE.TorusGeometry(0.11, 0.026, 6, 16), M(0, 0.37, 0, Math.PI / 2)],
      ])
    ),
    brass
  );

  // The spinning top
  const tilt = new THREE.Group();
  tilt.position.y = 0.33;
  rig.add(tilt);
  const top = new THREE.Group();
  tilt.add(top);
  add(top, stripedTopGeo(), striped);
  add(
    top,
    G('vr_rim', () => {
      const parts = [[new THREE.TorusGeometry(0.295, 0.03, 8, 28), M(0, 0.3, 0, Math.PI / 2)]];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        parts.push([sph(0.028, 6, 4), M(Math.cos(a) * 0.32, 0.3, Math.sin(a) * 0.32)]);
      }
      parts.push([cyl(0.1, 0.12, 0.04, 16), M(0, 0.49, 0)]);
      parts.push([cyl(0.026, 0.026, 0.1, 8), M(0, 0.55, 0)]);
      return merge(parts);
    }),
    brass
  );
  add(top, G('vr_cap', () => sph(0.085, 14, 8, 0, TAU, 0, Math.PI / 2)), red, 0, 0.5, 0).scale.set(1, 0.6, 1);
  add(top, keyBowGeo(0.11, 0.04), brass, 0, 0.64, 0);

  addSpark(E, rig, 0, 0.82, 0);
  addMushroom(E, top, 0.24, 0.42, 0.1, 1.0, 0, -0.6);
  addMushroom(E, top, -0.2, 0.44, -0.15, 0.8, 0.3, 0.5);
  addMushroom(E, rig, 0.07, 0.3, 0.06, 0.6, 0, -0.6);
  addPatch(E, top, 0.21, 0.22, 0.1, 0.8, -0.3, 0.4, 1.2);
  addPatch(E, top, -0.15, 0.4, 0.2, -0.5, 0.5, 0.6, 1.0);

  let spinA = 0;
  let roll = 0;
  finalize(E, (dt, t, sf, st) => {
    const spinRate = 9 + 13 * Math.min(sf, 2) * (st.zombie ? 0.7 : 1);
    spinA += dt * spinRate;
    roll += dt * 10 * sf;
    top.rotation.y = spinA;
    wheel.rotation.x = roll;
    // precession wobble of the top inside its yoke
    const wob = st.zombie ? 0.16 : 0.06;
    tilt.rotation.x = Math.sin(t * 6.3 + st.seed) * wob;
    tilt.rotation.z = Math.cos(t * 6.3 + st.seed) * wob;
    rig.rotation.set(0.14 * Math.min(sf, 1.6), 0, Math.sin(t * 2.2 + st.seed) * 0.06);
    rig.position.y = Math.abs(Math.sin(t * 9 + st.seed)) * 0.012;
  });
  return E.group;
}

// ---------------------------------------------------------------------------
// KOTLAR -- squat armoured iron boiler on four stomping legs
// ---------------------------------------------------------------------------

function createKotlar() {
  const E = scaffold('kotlar');
  const { rig, kit, st } = E;
  st.walkRate = 4.6;
  st.keyRate = 2.2;

  const iron = kit.mat(0x4a4e69, { r: 0.42, m: 0.35, zk: 0.45 });
  const dark = kit.mat(0x26283a, { r: 0.5, m: 0.3, zk: 0.3 });
  const copper = kit.mat(0xc8743a, { r: 0.32, m: 0.55, zc: 0x5f9a7c });
  const fire = kit.mat(0xff7b1c, { e: 0xff5a00, ei: 1.6, r: 0.6, m: 0, zc: 0x9ef01a, ze: 0x7ad014 });
  const glass = kit.mat(0xfff0b0, { e: 0xffc84a, ei: 1.1, r: 0.15, m: 0, zc: 0xcfff80, ze: 0x9ef01a });
  const steam = kit.mat(0xf2f2f2, { r: 1, m: 0, transparent: true, opacity: 0.82, depthWrite: false, zc: 0xc9e3b8 });
  E.pulsing = true;

  const body = new THREE.Group();
  body.position.y = 0.5;
  rig.add(body);

  add(
    body,
    G('ko_boiler', () =>
      merge([
        [cyl(0.29, 0.29, 0.52, 22), M(0, 0, 0, Math.PI / 2)],
        [sph(0.29, 22, 12, 0, TAU, 0, Math.PI / 2), M(0, 0, 0.26, Math.PI / 2, 0, 0, 1, 0.42, 1)],
        [sph(0.29, 22, 12, 0, TAU, 0, Math.PI / 2), M(0, 0, -0.26, -Math.PI / 2, 0, 0, 1, 0.3, 1)],
      ])
    ),
    iron
  );
  add(
    body,
    G('ko_copper', () => {
      const parts = [];
      [-0.17, 0.08].forEach((z) => {
        parts.push([new THREE.TorusGeometry(0.295, 0.032, 8, 26), M(0, 0, z)]);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          parts.push([sph(0.022, 6, 4), M(Math.cos(a) * 0.325, Math.sin(a) * 0.325, z)]);
        }
      });
      // porthole rims
      [-1, 1].forEach((s) => {
        parts.push([new THREE.TorusGeometry(0.058, 0.02, 6, 14), M(0.11 * s, 0.09, 0.375, -0.35, 0.22 * s, 0)]);
      });
      // cow-catcher plow
      parts.push([box(0.46, 0.15, 0.04), M(0, -0.25, 0.33, 0.55, 0, 0)]);
      parts.push([box(0.04, 0.17, 0.05), M(0, -0.25, 0.345, 0.55, 0, 0)]);
      // chimney crown
      parts.push([cyl(0.09, 0.075, 0.05, 14), M(0, 0.5, 0.1)]);
      // safety whistle
      parts.push([cyl(0.022, 0.03, 0.09, 8), M(0.14, 0.3, -0.12)]);
      parts.push([sph(0.03, 8, 6), M(0.14, 0.36, -0.12)]);
      return merge(parts);
    }),
    copper
  );
  add(
    body,
    G('ko_dark', () =>
      merge([
        // chimney stack
        [cyl(0.06, 0.07, 0.26, 12), M(0, 0.37, 0.1)],
        // angry brows over the portholes
        [box(0.15, 0.035, 0.05), M(-0.1, 0.17, 0.37, -0.3, 0, -0.32)],
        [box(0.15, 0.035, 0.05), M(0.1, 0.17, 0.37, -0.3, 0, 0.32)],
        // furnace frame + grate bars
        [box(0.25, 0.03, 0.05), M(0, -0.03, 0.385)],
        [box(0.25, 0.03, 0.05), M(0, -0.15, 0.375)],
        [box(0.025, 0.12, 0.03), M(-0.06, -0.09, 0.39)],
        [box(0.025, 0.12, 0.03), M(0, -0.09, 0.392)],
        [box(0.025, 0.12, 0.03), M(0.06, -0.09, 0.39)],
        // side leg brackets
        [box(0.12, 0.08, 0.5), M(-0.25, -0.2, 0)],
        [box(0.12, 0.08, 0.5), M(0.25, -0.2, 0)],
      ])
    ),
    dark
  );
  const mouth = add(body, G('ko_mouth', () => box(0.22, 0.11, 0.04)), fire, 0, -0.09, 0.365, 0, 0, 0, false);
  add(
    body,
    G('ko_glass', () =>
      merge([
        [cyl(0.045, 0.045, 0.02, 12), M(-0.11, 0.09, 0.372, Math.PI / 2 - 0.35, 0, 0.22)],
        [cyl(0.045, 0.045, 0.02, 12), M(0.11, 0.09, 0.372, Math.PI / 2 - 0.35, 0, -0.22)],
      ])
    ),
    glass,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );

  // Steam puffs
  const puffs = [];
  for (let i = 0; i < 3; i++) {
    const p = add(body, G('ko_puff', () => new THREE.IcosahedronGeometry(0.075, 1)), steam, 0, 0.6, 0.1, 0, 0, 0, false);
    puffs.push(p);
  }

  // Four stubby piston legs
  const legs = [];
  [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ].forEach(([sx, sz]) => {
    const hip = new THREE.Group();
    hip.position.set(0.3 * sx, 0.3, 0.17 * sz);
    rig.add(hip);
    add(
      hip,
      G('ko_leg', () =>
        merge([
          [sph(0.07, 10, 8), M(0, 0, 0)],
          [cyl(0.055, 0.065, 0.2, 10), M(0, -0.12, 0)],
          [cyl(0.105, 0.115, 0.075, 12), M(0, -0.262, 0.02)],
          [box(0.2, 0.05, 0.08), M(0, -0.275, 0.1)],
        ])
      ),
      dark
    );
    add(hip, G('ko_piston', () => cyl(0.072, 0.072, 0.05, 10)), copper, 0, -0.13, 0);
    legs.push(hip);
  });

  // Heavy rear key
  const key = makeKey(copper, 0.12, 0.17, 0.05);
  key.outer.position.set(0, 0.52, -0.33);
  key.outer.rotation.x = -Math.PI / 2;
  rig.add(key.outer);
  addSpark(E, rig, 0, 0.6, -0.5);

  addMushroom(E, body, 0.15, 0.24, -0.05, 1.2, 0, -0.5);
  addMushroom(E, body, -0.2, 0.2, 0.12, 1.0, 0.2, 0.7);
  addMushroom(E, legs[2], -0.05, -0.05, 0, 0.9, 0, 0.6);
  addMushroom(E, body, -0.05, 0.28, -0.2, 0.8, -0.3, 0.2);
  addPatch(E, body, 0.22, 0.12, -0.05, 0.85, 0.5, 0, 1.4);
  addPatch(E, body, -0.25, -0.05, 0.15, -1, -0.1, 0.2, 1.2);
  addPatch(E, body, 0.05, 0.28, -0.2, 0.1, 1, -0.1, 1.2);

  finalize(E, (dt, t, sf, st) => {
    const p = st.phase;
    const amp = 0.38 * Math.min(1, sf * 1.2);
    const s = Math.sin(p);
    legs[0].rotation.x = s * amp;
    legs[3].rotation.x = s * amp;
    legs[1].rotation.x = -s * amp;
    legs[2].rotation.x = -s * amp;
    const stomp = Math.pow(Math.abs(Math.cos(p)), 3);
    rig.position.y = -0.3 * (1 - Math.cos(s * amp)) + 0.018 * stomp;
    rig.rotation.set(0.02 * Math.cos(p * 2), 0, Math.sin(p) * 0.06);
    body.rotation.z = Math.sin(p) * 0.03;
    // furnace flicker
    fire.userData.pulse = 0.75 + 0.25 * Math.sin(t * 17 + st.seed) * Math.sin(t * 7.1);
    glass.userData.pulse = 0.85 + 0.15 * Math.sin(t * 5 + st.seed);
    // steam puffs
    for (let i = 0; i < puffs.length; i++) {
      const u = (t * (0.55 + 0.35 * sf) + i / puffs.length + st.seed) % 1;
      const pf = puffs[i];
      pf.position.set(Math.sin(u * 6 + i) * 0.04, 0.55 + u * 0.42, 0.1 - u * 0.12);
      const sc = (0.5 + 1.6 * u) * (u > 0.75 ? (1 - u) / 0.25 : 1);
      pf.scale.setScalar(Math.max(0.01, sc));
    }
    key.spin.rotation.y = st.keyAngle;
  });
  return E.group;
}

// ---------------------------------------------------------------------------
// VAZKA -- brass clockwork dragonfly
// ---------------------------------------------------------------------------

function wingGeo(L, W) {
  return G(`wing_${L}_${W}`, () => {
    const s = new THREE.Shape();
    const N = 18;
    s.moveTo(0, 0);
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      s.lineTo(u * L, W * 0.55 * Math.pow(Math.sin(Math.PI * u), 0.6) * (1 - 0.3 * u));
    }
    for (let i = N - 1; i >= 1; i--) {
      const u = i / N;
      s.lineTo(u * L, -W * 0.45 * Math.pow(Math.sin(Math.PI * u), 0.8) * (0.7 + 0.3 * u));
    }
    s.lineTo(0, 0);
    const g = new THREE.ShapeGeometry(s, 8);
    g.rotateX(-Math.PI / 2); // lie flat, tip along +X, leading edge toward -Z... flipped below
    g.scale(1, 1, -1); // leading edge (+Y of shape) toward +Z (front)
    return g;
  });
}

function createVazka() {
  const E = scaffold('vazka');
  const { rig, kit, st } = E;
  st.walkRate = 3;
  st.keyRate = 6;

  const brass = kit.mat(0xe0b43a, { r: 0.28, m: 0.6, zc: 0x7f8f5a });
  const teal = kit.mat(0x1d7f8c, { r: 0.25, m: 0.2, zk: 0.4 });
  const ruby = kit.mat(0xd8232a, { e: 0xb0101a, ei: 0.55, r: 0.15, m: 0.1, zc: 0x9ef01a, ze: 0x5aa010 });
  const dark = kit.mat(0x2a2a30, { r: 0.5, m: 0.3, zk: 0.3 });
  const wingM = kit.mat(0xa8e2ff, {
    r: 0.15,
    m: 0.1,
    e: 0x3a8fd0,
    ei: 0.35,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    zc: 0xa8d8a0,
    ze: 0x2f6a2a,
  });

  rig.scale.setScalar(1.12);
  const body = new THREE.Group();
  body.position.set(0, 0.3, 0.05);
  rig.add(body);

  // thorax + head + eyes
  add(body, G('va_thorax', () => sph(0.1, 14, 10)), brass, 0, 0, 0.06).scale.set(1, 0.95, 1.35);
  add(body, G('va_neck', () => cyl(0.045, 0.06, 0.08, 10)), teal, 0, 0.0, 0.2, Math.PI / 2);
  const head = new THREE.Group();
  head.position.set(0, 0.01, 0.26);
  body.add(head);
  add(head, G('va_head', () => sph(0.065, 12, 8)), brass, 0, 0, 0);
  add(
    head,
    G('va_eyes', () =>
      merge([
        [sph(0.058, 12, 10), M(-0.055, 0.03, 0.03)],
        [sph(0.058, 12, 10), M(0.055, 0.03, 0.03)],
      ])
    ),
    ruby
  );
  add(
    head,
    G('va_mandible', () =>
      merge([
        [new THREE.ConeGeometry(0.018, 0.07, 6), M(-0.025, -0.05, 0.06, 2.4, 0, 0)],
        [new THREE.ConeGeometry(0.018, 0.07, 6), M(0.025, -0.05, 0.06, 2.4, 0, 0)],
      ])
    ),
    dark,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );

  // dangling legs
  add(
    body,
    G('va_legs', () => {
      const parts = [];
      [-1, 1].forEach((s) => {
        [0.12, 0.05, -0.02].forEach((z, i) => {
          parts.push([cyl(0.012, 0.012, 0.13, 5), M(0.07 * s, -0.08, z, 0.25 - i * 0.25, 0, 0.55 * s)]);
          parts.push([cyl(0.01, 0.008, 0.16, 5), M(0.11 * s, -0.2, z + 0.02 - i * 0.03, 0.3 - i * 0.3, 0, -0.2 * s)]);
        });
      });
      return merge(parts);
    }),
    dark,
    0,
    0,
    0,
    0,
    0,
    0,
    true
  );

  // segmented abdomen (chain so it curls)
  const segs = [];
  let parent = body;
  const segData = [
    [0.075, 0.13, brass],
    [0.064, 0.12, teal],
    [0.056, 0.115, brass],
    [0.048, 0.11, teal],
    [0.04, 0.105, brass],
    [0.032, 0.1, teal],
  ];
  let z0 = -0.06;
  segData.forEach(([r, len, mat], i) => {
    const g = new THREE.Group();
    g.position.set(0, 0, z0);
    parent.add(g);
    const mesh = add(g, G(`va_seg_${i}`, () => sph(r, 12, 8)), mat, 0, 0, -len / 2);
    mesh.scale.set(1, 0.92, (len / r) * 0.62);
    segs.push(g);
    parent = g;
    z0 = -len * 0.92;
  });
  // tail fins on last segment
  add(
    parent,
    G('va_tail', () =>
      merge([
        [box(0.11, 0.012, 0.05), M(0, 0, -0.11)],
        [new THREE.ConeGeometry(0.02, 0.06, 6), M(0, 0, -0.14, -Math.PI / 2)],
      ])
    ),
    brass
  );

  // Wings (4)
  const wings = [];
  const wingVein = G('va_vein', () => cyl(0.009, 0.006, 0.42, 5).rotateZ(Math.PI / 2).translate(0.21, 0, 0.01));
  [
    [1, 0.11, -0.22, 0.42, 0.18],
    [-1, 0.11, -0.22, 0.42, 0.18],
    [1, -0.02, 0.32, 0.38, 0.17],
    [-1, -0.02, 0.32, 0.38, 0.17],
  ].forEach(([s, z, yaw, L, W], i) => {
    const piv = new THREE.Group();
    piv.position.set(0.05 * s, 0.075, z);
    piv.rotation.y = s * yaw; // front wings sweep forward, rear wings back
    body.add(piv);
    const wing = add(piv, wingGeo(L, W), wingM, 0, 0, 0, 0, 0, 0, false);
    const vein = add(piv, wingVein, brass, 0, 0, 0, 0, 0, 0, false);
    if (s < 0) {
      wing.scale.x = -1;
      vein.scale.x = -1;
    }
    vein.scale.y = 1;
    piv.userData = { s, off: i < 2 ? 0 : Math.PI * 0.6 };
    wings.push(piv);
  });

  // little key on the thorax
  const key = makeKey(brass, 0.07, 0.085, 0.03);
  key.outer.position.set(0, 0.09, 0.02);
  body.add(key.outer);
  addSpark(E, body, 0, 0.25, 0.02);

  addMushroom(E, body, 0.05, 0.08, 0.1, 0.8, 0, -0.5);
  addMushroom(E, segs[1], 0.0, 0.05, -0.05, 0.7, 0, 0.3);
  addMushroom(E, segs[3], -0.02, 0.04, -0.05, 0.55, 0, 0.5);
  addPatch(E, body, 0.08, 0.04, 0.1, 1, 0.3, 0.3, 0.9);
  addPatch(E, segs[2], 0.05, 0.02, -0.05, 1, 0.3, 0, 0.7);

  finalize(
    E,
    (dt, t, sf, st) => {
      const fr = (st.zombie ? 38 : 55) * (0.8 + 0.2 * Math.min(sf, 2));
      for (const w of wings) {
        const a = Math.sin(t * fr + w.userData.off + st.seed) * 0.55 + 0.12;
        w.rotation.z = a * w.userData.s;
      }
      rig.position.y = 0.04 + Math.sin(t * 3.1 + st.seed) * 0.03;
      rig.rotation.set(0.08 * Math.min(sf, 1.5) + Math.sin(t * 2.2 + st.seed) * 0.04, 0, Math.sin(t * 1.7 + st.seed) * 0.08);
      for (let i = 0; i < segs.length; i++) {
        segs[i].rotation.x = 0.05 + Math.sin(t * 2.6 + st.seed - i * 0.7) * (st.zombie ? 0.13 : 0.07);
        segs[i].rotation.y = Math.sin(t * 1.9 + st.seed - i * 0.6) * 0.05;
      }
      head.rotation.y = Math.sin(t * 1.3 + st.seed) * 0.2;
      key.spin.rotation.y = st.keyAngle;
    },
    { flying: true }
  );
  return E.group;
}

// ---------------------------------------------------------------------------
// NAVIJAC -- tall purple lacquer support unit with spinning key arms
// ---------------------------------------------------------------------------

function createNavijac() {
  const E = scaffold('navijac');
  const { rig, kit, st } = E;
  st.walkRate = 6.5;
  st.keyRate = 7;
  E.pulsing = true;

  const purple = kit.mat(0x7b2cbf, { r: 0.22, m: 0.12, zc: 0x6a4f86 });
  const brass = kit.mat(0xd9ae35, { r: 0.32, m: 0.42, zc: 0x7f8f5a });
  const dark = kit.mat(0x2b1d3a, { r: 0.45, m: 0.2, zk: 0.3 });
  const orb = kit.mat(0xe7b6ff, { e: 0xc77dff, ei: 1.3, r: 0.1, m: 0, zc: 0xcfff9a, ze: 0x9ef01a });

  rig.scale.setScalar(0.9);
  const body = new THREE.Group();
  body.position.y = 0.36;
  rig.add(body);

  add(
    body,
    G('na_body', () =>
      lathe(
        [
          [0, 0],
          [0.12, 0],
          [0.15, 0.05],
          [0.165, 0.15],
          [0.15, 0.26],
          [0.11, 0.36],
          [0.085, 0.44],
          [0.1, 0.48],
          [0, 0.48],
        ],
        18
      )
    ),
    purple
  );
  add(
    body,
    G('na_brass', () =>
      merge([
        [cyl(0.15, 0.13, 0.05, 18), M(0, -0.005, 0)],
        [new THREE.TorusGeometry(0.16, 0.02, 6, 20), M(0, 0.1, 0, Math.PI / 2)],
        [new THREE.TorusGeometry(0.095, 0.02, 6, 16), M(0, 0.42, 0, Math.PI / 2)],
        [cyl(0.115, 0.1, 0.04, 16), M(0, 0.49, 0)],
        // lantern cage: 4 bars + cap + finial
        [cyl(0.012, 0.012, 0.16, 5), M(0.085, 0.58, 0)],
        [cyl(0.012, 0.012, 0.16, 5), M(-0.085, 0.58, 0)],
        [cyl(0.012, 0.012, 0.16, 5), M(0, 0.58, 0.085)],
        [cyl(0.012, 0.012, 0.16, 5), M(0, 0.58, -0.085)],
        [new THREE.ConeGeometry(0.115, 0.1, 12), M(0, 0.7, 0)],
        [sph(0.025, 8, 6), M(0, 0.77, 0)],
        // front emblem gear stub
        [box(0.05, 0.05, 0.02), M(0, 0.2, 0.158, -0.1, 0, Math.PI / 4)],
      ])
    ),
    brass
  );
  const orbMesh = add(body, G('na_orb', () => sph(0.075, 14, 10)), orb, 0, 0.58, 0, 0, 0, 0, false);

  // collar with 3 spinning key arms
  const collar = new THREE.Group();
  collar.position.y = 0.27;
  body.add(collar);
  add(collar, gearGeo(0.17, 0.145, 14, 0.04, 0.05), brass, 0, 0, 0, Math.PI / 2);
  const armKeys = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    const k = makeKey(brass, 0.17, 0.11, 0.035);
    // point +Y outward along angle a in XZ plane
    k.outer.rotation.set(0, a, -Math.PI / 2);
    k.outer.position.set(Math.sin(a) * 0.1, 0, Math.cos(a) * 0.1);
    collar.add(k.outer);
    armKeys.push(k);
  }

  // thin stilt legs
  const legs = [];
  [-1, 1].forEach((s) => {
    const hip = new THREE.Group();
    hip.position.set(0.075 * s, 0.37, 0);
    rig.add(hip);
    add(
      hip,
      G('na_leg', () =>
        merge([
          [sph(0.04, 8, 6), M(0, 0, 0)],
          [cyl(0.022, 0.018, 0.3, 6), M(0, -0.17, 0)],
          [sph(0.03, 8, 6), M(0, -0.18, 0)],
        ])
      ),
      brass
    );
    add(
      hip,
      G('na_foot', () => merge([[new THREE.ConeGeometry(0.06, 0.07, 8), M(0, -0.335, 0.015)]])),
      dark
    );
    legs.push(hip);
  });

  addSpark(E, collar, 0, 0.05, 0.2);
  addMushroom(E, body, 0.1, 0.36, 0.04, 0.8, 0, -0.7);
  addMushroom(E, body, -0.13, 0.13, 0.05, 0.9, 0, 0.8);
  addMushroom(E, legs[1], 0.0, -0.18, 0.02, 0.6, 0, -0.5);
  addPatch(E, body, 0.13, 0.2, 0.08, 0.9, 0, 0.5, 1.0);
  addPatch(E, body, -0.08, 0.33, 0.08, -0.6, 0.2, 0.7, 0.8);

  finalize(E, (dt, t, sf, st) => {
    const p = st.phase;
    const amp = 0.42 * Math.min(1, sf * 1.2);
    const th = Math.sin(p) * amp;
    legs[0].rotation.x = th;
    legs[1].rotation.x = -th;
    rig.position.y = -0.37 * (1 - Math.cos(th)) + 0.015 * Math.abs(Math.cos(p));
    rig.rotation.set(0.04, 0, Math.sin(p) * 0.08);
    body.rotation.z = -Math.sin(p) * 0.04;
    collar.rotation.y = st.keyAngle * 0.35;
    for (let i = 0; i < armKeys.length; i++) armKeys[i].spin.rotation.y = st.keyAngle * 2.2 + i;
    const pl = 0.8 + 0.4 * Math.sin(t * 3.4 + st.seed);
    orb.userData.pulse = pl;
    orbMesh.scale.setScalar(0.95 + 0.07 * pl);
  });
  return E.group;
}

// ---------------------------------------------------------------------------
// BOSS: KUKUCKOVY KOLOS -- walking cuckoo-clock cabinet (~2x size)
// ---------------------------------------------------------------------------

// major=true builds the level-2 boss (Kukučkový kolos Major, GDD 5.4 rozsirena
// mechanika): same cabinet-boss silhouette/rig/animation, but noticeably
// bigger, with hotter brass-gone-red trim (steampunk "overheated" look) and
// a extra warning ring around the clock face so it reads as a tougher,
// later-game threat at a glance -- not just a bigger number on the HP bar.
//
// Uloha X: variant moze byt aj cislo "tier" -- 2 = Magnus (level 3, medeny
// lak + zelena liecivá aura, parne trubky), 3 = Imperator (level 4, ebenova
// skrina + zlato/fialova, korunka z ozubenych kolies, naplecniky),
// 4 = Polovica Imperatora (uzsia "rozpolena" skrina s trhlinou),
// 5 = Tyran (level 5 finale, krvavo-cierna skrina + horuca medena/cervena,
// najvacsi), 6 = Tretina Tyrana (rozpoleny ulomok).
const KU_TIERS = [
  { type: 'boss_kukucka', scale: 0.86 },
  { type: 'boss_kukucka_major', scale: 1.18 },
  { type: 'boss_kukucka_magnus', scale: 1.32, walnut: 0x2f3d2c, brass: 0xb87333, zc: 0x5dbb63, red: 0x2ec27e, eye: 0x5dff9a, aura: 0x5dff9a },
  { type: 'boss_kukucka_imperator', scale: 1.45, walnut: 0x2a1f3a, brass: 0xd4af37, zc: 0xb05dff, red: 0x8e44ad, eye: 0xc04dff, aura: 0xc04dff },
  { type: 'boss_kukucka_polovica', scale: 1.0, walnut: 0x2a1f3a, brass: 0xd4af37, zc: 0xb05dff, red: 0x8e44ad, eye: 0xc04dff },
  { type: 'boss_kukucka_tyran', scale: 1.58, walnut: 0x1a1012, brass: 0xc0392b, zc: 0xff5a3c, red: 0xff5a3c, eye: 0xff3b1f, aura: 0xff3b1f },
  { type: 'boss_kukucka_tretina', scale: 1.05, walnut: 0x1a1012, brass: 0xc0392b, zc: 0xff5a3c, red: 0xff5a3c, eye: 0xff3b1f },
];
function createKukucka(variant = false) {
  const tier = variant === true ? 1 : (typeof variant === 'number' ? variant : 0);
  const major = tier >= 1;
  const TT = KU_TIERS[tier] || KU_TIERS[0];
  const E = scaffold(TT.type);
  const { rig, kit, st } = E;
  st.walkRate = 3.6;
  st.keyRate = 1.8;

  const walnut = kit.mat(TT.walnut ?? (major ? 0x5a2a1c : 0x6e4226), { r: 0.55, m: 0.05, zk: 0.45 });
  const darkWood = kit.mat(0x9a5f36, { r: 0.6, m: 0.05, zk: 0.35, flat: true });
  const lightWood = kit.mat(0xb07a45, { r: 0.5, m: 0.05, zk: 0.45 });
  const cream = kit.mat(0xf1e4c8, { r: 0.45, m: 0, zk: 0.4 });
  const brass = kit.mat(TT.brass ?? (major ? 0xc9a227 : 0xe0b43a), { r: 0.28, m: 0.6, zc: TT.zc ?? (major ? 0xe4572e : 0x7f8f5a) });
  const dial = kit.mat(0xffffff, { vc: true, r: 0.4, m: 0, zc: 0xb9c9a6 });
  const black = kit.mat(0x18161a, { r: 0.35, m: 0.2, zk: 0.15 });
  const red = kit.mat(TT.red ?? (major ? 0xe4572e : 0xd7262e), { r: 0.3, m: 0.05, zk: 0.55 });
  const bird = kit.mat(0xffffff, { vc: true, r: 0.4, m: 0, zc: 0xb9d9a0 });
  const eyes = kit.mat(0xffe9a0, TT.eye
    ? { e: TT.eye, ei: 2.6, r: 0.2, m: 0, zc: 0xcfff80, ze: TT.eye }
    : major
    ? { e: 0xff3a1a, ei: 2.4, r: 0.2, m: 0, zc: 0xcfff80, ze: 0xff3a1a }
    : { e: 0xffb000, ei: 1.4, r: 0.2, m: 0, zc: 0xcfff80, ze: 0x9ef01a });
  E.pulsing = true;

  rig.scale.setScalar(TT.scale);
  // Polovica/Tretina: uzsia (rozpolena) skrina.
  if (tier === 4 || tier === 6) rig.scale.set(TT.scale * 0.62, TT.scale, TT.scale);
  const body = new THREE.Group();
  body.position.y = 0.62;
  rig.add(body);

  // cabinet
  add(body, G('ku_cab', () => box(1.0, 1.15, 0.62).translate(0, 0.595, 0)), walnut);
  add(
    body,
    G('ku_trim', () =>
      merge([
        [box(1.08, 0.08, 0.7), M(0, 0.03, 0)], // plinth
        [box(1.06, 0.06, 0.68), M(0, 1.15, 0)], // cornice
        [box(0.07, 1.1, 0.05), M(-0.48, 0.6, 0.31)], // corner pilasters
        [box(0.07, 1.1, 0.05), M(0.48, 0.6, 0.31)],
        [box(0.86, 0.04, 0.04), M(0, 0.12, 0.315)],
      ])
    ),
    lightWood
  );
  // roof + fretwork
  add(
    body,
    G('ku_roof', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.72, 0);
      s.lineTo(0.72, 0);
      s.lineTo(0, 0.46);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.86, bevelEnabled: false });
      g.translate(0, 1.17, -0.43);
      // shingle ridges
      const parts = [[g]];
      const ang = Math.atan2(0.46, 0.72);
      [-1, 1].forEach((sd) => {
        for (let i = 0; i < 3; i++) {
          const u = 0.2 + i * 0.27;
          parts.push([
            box(0.05, 0.03, 0.88),
            M(sd * 0.72 * (1 - u), 1.17 + 0.46 * u + 0.012, 0, 0, 0, -ang * sd),
          ]);
        }
      });
      return merge(parts);
    }),
    darkWood
  );
  add(
    body,
    G('ku_fret', () => {
      const parts = [];
      const ang = Math.atan2(0.46, 0.72);
      const len = Math.hypot(0.72, 0.46);
      [-1, 1].forEach((s) => {
        parts.push([box(len + 0.08, 0.07, 0.04), M(0.36 * s, 1.4, 0.45, 0, 0, -ang * s)]);
        // carved leaf droplets under the eaves
        for (let i = 0; i < 4; i++) {
          const u = 0.15 + i * 0.22;
          parts.push([
            new THREE.ConeGeometry(0.035, 0.09, 6),
            M(s * 0.72 * (1 - u), 1.17 + 0.46 * u - 0.07, 0.45, Math.PI, 0, 0),
          ]);
        }
      });
      // little gable over the door
      parts.push([box(0.17, 0.035, 0.08), M(-0.075, 1.115, 0.35, 0, 0, 0.45)]);
      parts.push([box(0.17, 0.035, 0.08), M(0.075, 1.115, 0.35, 0, 0, -0.45)]);
      return merge(parts);
    }),
    cream
  );
  add(
    body,
    G('ku_finial', () =>
      merge([
        [cyl(0.03, 0.04, 0.1, 8), M(0, 1.66, 0.0)],
        [sph(0.06, 10, 8), M(0, 1.74, 0)],
        [new THREE.ConeGeometry(0.03, 0.1, 8), M(0, 1.83, 0)],
      ])
    ),
    brass
  );

  // Clock face (the "face" of the boss)
  const face = new THREE.Group();
  face.position.set(0, 0.5, 0.31);
  body.add(face);
  add(
    face,
    G('ku_bezel', () =>
      merge([
        [cyl(0.34, 0.34, 0.06, 32), M(0, 0, 0.02, Math.PI / 2)],
        [new THREE.TorusGeometry(0.34, 0.03, 8, 32), M(0, 0, 0.05)],
        [sph(0.04, 10, 8), M(0, 0, 0.1)],
      ])
    ),
    brass
  );
  let warnRing = null;
  if (major) {
    // Extra "overheated" warning ring: a visual tell unique to the Major
    // boss so players recognise the harder level-2 encounter on sight,
    // independent of the HP bar/scale difference.
    warnRing = add(
      face,
      G('ku_warnring', () => new THREE.TorusGeometry(0.4, 0.015, 8, 32)),
      red,
      0,
      0,
      0.09,
      0,
      0,
      0,
      false
    );
  }
  add(
    face,
    G('ku_dial', () => {
      const parts = [[cyl(0.285, 0.285, 0.02, 32), M(0, 0, 0.055, Math.PI / 2), 0xf6ecd2]];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const big = i % 3 === 0;
        parts.push([
          box(big ? 0.035 : 0.022, big ? 0.07 : 0.045, 0.01),
          M(Math.sin(a) * 0.235, Math.cos(a) * 0.235, 0.068, 0, 0, -a),
          0x2a1a10,
        ]);
      }
      return merge(parts);
    }),
    dial,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );
  // two glowing "eyes" in the dial (menacing face)
  add(
    face,
    G('ku_eyes', () =>
      merge([
        [cyl(0.045, 0.045, 0.02, 12), M(-0.11, 0.08, 0.07, Math.PI / 2)],
        [cyl(0.045, 0.045, 0.02, 12), M(0.11, 0.08, 0.07, Math.PI / 2)],
      ])
    ),
    eyes,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );
  const hourHand = new THREE.Group();
  hourHand.position.z = 0.085;
  face.add(hourHand);
  add(
    hourHand,
    G('ku_hh', () =>
      merge([
        [box(0.045, 0.16, 0.012), M(0, 0.07, 0)],
        [new THREE.ConeGeometry(0.04, 0.06, 4), M(0, 0.17, 0, 0, Math.PI / 4, 0, 1, 1, 0.25)],
      ])
    ),
    black,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );
  const minHand = new THREE.Group();
  minHand.position.z = 0.095;
  face.add(minHand);
  add(
    minHand,
    G('ku_mh', () =>
      merge([
        [box(0.028, 0.24, 0.012), M(0, 0.1, 0)],
        [new THREE.ConeGeometry(0.03, 0.06, 4), M(0, 0.24, 0, 0, Math.PI / 4, 0, 1, 1, 0.25)],
      ])
    ),
    black,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );

  // ---- Uloha X: doplnky vyssich tierov (iba primitiva) ----
  let aura = null;
  let auraMat = null;
  const crownGears = [];
  const puffs = [];
  if (TT.aura) {
    // Liecivá aura: ziariaci prstenec pri zemi (radius ~ healRadius v hre).
    auraMat = kit.mat(TT.aura, { e: TT.aura, ei: 1.8, r: 0.3, m: 0, ze: TT.aura });
    aura = add(rig, G('ku_aura', () => new THREE.TorusGeometry(1.0, 0.035, 8, 48)), auraMat, 0, 0.04, 0, Math.PI / 2, 0, 0, false);
  }
  if (tier === 2) {
    // Medene parne trubky na streche + obláčiky pary.
    const steam = kit.mat(0xe8f5e9, { r: 0.9, m: 0, e: 0x5dff9a, ei: 0.25, zc: 0xb9d9a0 });
    [-1, 1].forEach((sd) => {
      add(body, G('ku_pipe', () => merge([
        [cyl(0.05, 0.06, 0.5, 10), M(0, 0.25, 0)],
        [new THREE.TorusGeometry(0.065, 0.018, 6, 12), M(0, 0.12, 0, Math.PI / 2)],
        [new THREE.TorusGeometry(0.065, 0.018, 6, 12), M(0, 0.42, 0, Math.PI / 2)],
        [cyl(0.075, 0.05, 0.06, 10), M(0, 0.52, 0)],
      ])), brass, 0.32 * sd, 1.2, -0.22);
      const puff = add(body, G('ku_puff', () => sph(0.08, 8, 6)), steam, 0.32 * sd, 1.8, -0.22, 0, 0, 0, false);
      puffs.push(puff);
    });
  }
  if (tier >= 3 && tier !== 4) {
    // Korunka z ozubenych kolies (Imperator/Tyran aj ich polovicne ulomky).
    [[-0.36, 1.5, 0.16, 10], [0.36, 1.5, 0.16, 10], [0, 1.98, 0.22, 14]].forEach(([x, y, r, n], i) => {
      if (tier === 6 && i === 1) return;
      crownGears.push(add(body, gearGeo(r, r * 0.82, n, 0.04, 0.03), brass, x, y, -0.05));
    });
  }
  if (tier === 3 || tier === 5) {
    // Naplecniky s hrotmi.
    [-1, 1].forEach((sd) => {
      add(body, G('ku_pauldron', () => merge([
        [sph(0.2, 12, 8, 0, TAU, 0, Math.PI / 2), M(0, 0, 0, 0, 0, 0, 1, 0.7, 1)],
        [new THREE.ConeGeometry(0.04, 0.16, 6), M(0, 0.18, 0)],
        [new THREE.ConeGeometry(0.035, 0.13, 6), M(0.1, 0.12, 0, 0, 0, -0.6)],
        [new THREE.ConeGeometry(0.035, 0.13, 6), M(-0.1, 0.12, 0, 0, 0, 0.6)],
      ])), brass, 0.56 * sd, 1.05, 0);
    });
  }
  if (tier === 4 || tier === 6) {
    // Trhlina po rozdeleni: zubaty okraj na jednej strane.
    add(body, G('ku_crack', () => {
      const parts = [];
      for (let i = 0; i < 6; i++) parts.push([new THREE.ConeGeometry(0.06, 0.18, 4), M(0.53, 0.1 + i * 0.2, 0.0, 0, 0, -Math.PI / 2 + (i % 2 ? 0.4 : -0.4))]);
      return merge(parts);
    }), black, 0, 0, 0, 0, 0, 0, false);
  }

  // Cuckoo door + bird
  add(body, G('ku_hole', () => box(0.2, 0.2, 0.02)), black, 0, 0.98, 0.315, 0, 0, 0, false);
  const doorPiv = new THREE.Group();
  doorPiv.position.set(-0.1, 0.98, 0.33);
  body.add(doorPiv);
  add(
    doorPiv,
    G('ku_door', () =>
      merge([
        [box(0.2, 0.2, 0.025), M(0.1, 0, 0)],
        [sph(0.015, 6, 4), M(0.17, 0, 0.015)],
      ])
    ),
    red,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );
  const birdG = new THREE.Group();
  birdG.position.set(0, 0.96, 0.2);
  body.add(birdG);
  add(
    birdG,
    G('ku_bird', () =>
      merge([
        [sph(0.07, 10, 8), M(0, 0, 0, 0, 0, 0, 0.85, 0.8, 1.2), 0x8a5a33],
        [sph(0.05, 10, 8), M(0, 0.06, 0.07), 0x9a6a3c],
        [new THREE.ConeGeometry(0.022, 0.07, 6), M(0, 0.05, 0.135, Math.PI / 2), 0xffa21c],
        [sph(0.012, 6, 4), M(-0.03, 0.08, 0.1), 0x111111],
        [sph(0.012, 6, 4), M(0.03, 0.08, 0.1), 0x111111],
        [box(0.02, 0.06, 0.1), M(-0.055, 0.0, -0.02, 0, 0, 0.2), 0xd7262e],
        [box(0.02, 0.06, 0.1), M(0.055, 0.0, -0.02, 0, 0, -0.2), 0xd7262e],
        [box(0.06, 0.02, 0.1), M(0, 0.02, -0.1, 0.4, 0, 0), 0x5a3a20],
      ])
    ),
    bird,
    0,
    0,
    0,
    0,
    0,
    0,
    false
  );
  birdG.visible = false;

  // Pendulum
  const pend = new THREE.Group();
  pend.position.set(0, 0.0, 0.2);
  body.add(pend);
  add(
    pend,
    G('ku_pend', () =>
      merge([
        [cyl(0.012, 0.012, 0.34, 6), M(0, -0.17, 0)],
        [cyl(0.085, 0.085, 0.025, 18), M(0, -0.36, 0, Math.PI / 2)],
      ])
    ),
    brass
  );

  // Pine-cone weights on chains
  const weights = [];
  const coneGeo = G('ku_cone', () =>
    lathe(
      [
        [0, -0.2],
        [0.03, -0.19],
        [0.06, -0.15],
        [0.05, -0.13],
        [0.075, -0.1],
        [0.06, -0.08],
        [0.08, -0.05],
        [0.06, -0.03],
        [0.07, -0.01],
        [0.03, 0.01],
        [0, 0.01],
      ],
      8
    )
  );
  [-0.3, 0.3].forEach((x) => {
    const w = new THREE.Group();
    w.position.set(x, 0, 0.1);
    body.add(w);
    add(w, G('ku_chain', () => cyl(0.01, 0.01, 0.3, 4).translate(0, -0.15, 0)), black, 0, 0, 0, 0, 0, 0, false);
    add(w, coneGeo, brass, 0, -0.3, 0);
    weights.push(w);
  });

  // Side gears
  const gears = [];
  [-1, 1].forEach((s) => {
    const gm = add(body, gearGeo(0.17, 0.14, 12, 0.04, 0.04), brass, 0.52 * s, 0.65, 0.05, 0, Math.PI / 2, 0);
    gears.push(gm);
  });

  // Carved legs
  const legs = [];
  const legGeo = G('ku_leg', () =>
    lathe(
      [
        [0, 0.04],
        [0.09, 0.04],
        [0.1, 0.0],
        [0.075, -0.08],
        [0.09, -0.16],
        [0.06, -0.26],
        [0.045, -0.4],
        [0.06, -0.47],
        [0, -0.48],
      ],
      12
    )
  );
  [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ].forEach(([sx, sz]) => {
    const hip = new THREE.Group();
    hip.position.set(0.4 * sx, 0.62, 0.22 * sz);
    rig.add(hip);
    add(hip, legGeo, walnut);
    add(hip, G('ku_foot', () => sph(0.09, 12, 8).translate(0, -0.52, 0.02)), brass);
    legs.push(hip);
  });

  // Big rear key
  const key = makeKey(brass, 0.2, 0.3, 0.07);
  key.outer.position.set(0, 1.25, -0.31);
  key.outer.rotation.x = -Math.PI / 2;
  rig.add(key.outer);
  addSpark(E, rig, 0, 1.4, -0.65);

  addMushroom(E, body, 0.3, 1.36, 0.2, 1.8, 0, -0.5);
  addMushroom(E, body, -0.45, 1.17, 0.25, 1.6, 0, 0.6);
  addMushroom(E, body, 0.5, 0.25, 0.2, 1.5, 0, -1.0);
  addMushroom(E, legs[0], -0.06, -0.1, 0.05, 1.3, 0, 0.8);
  addMushroom(E, body, -0.2, 1.5, -0.1, 1.4, 0.3, 0.3);
  addPatch(E, body, 0.3, 0.3, 0.315, 0, 0, 1, 2.2);
  addPatch(E, body, -0.505, 0.7, -0.1, -1, 0, 0, 2.5);
  addPatch(E, body, -0.3, 0.9, 0.315, 0, 0, 1, 1.6);

  finalize(E, (dt, t, sf, st) => {
    const p = st.phase;
    const amp = 0.3 * Math.min(1, sf * 1.2);
    const s = Math.sin(p);
    legs[0].rotation.x = s * amp;
    legs[3].rotation.x = s * amp;
    legs[1].rotation.x = -s * amp;
    legs[2].rotation.x = -s * amp;
    rig.position.y = -0.6 * (1 - Math.cos(s * amp)) + 0.02 * Math.pow(Math.abs(Math.cos(p)), 3);
    rig.rotation.set(0.02 * Math.cos(p * 2), 0, Math.sin(p) * 0.045);
    // hands
    const hs = st.hp < 0.25 ? 3 : 1;
    minHand.rotation.z = -(st.keyAngle * 3.2 * hs);
    hourHand.rotation.z = -(st.keyAngle * 0.5 * hs) - 1.2;
    // pendulum + weights
    pend.rotation.z = Math.sin(t * 3.2 + st.seed) * 0.45;
    weights[0].position.y = Math.sin(t * 0.9) * 0.04;
    weights[1].position.y = -Math.sin(t * 0.9) * 0.04;
    weights[0].rotation.z = Math.sin(p) * 0.15;
    weights[1].rotation.z = Math.sin(p + 0.5) * 0.15;
    gears[0].rotation.z = st.keyAngle * 1.5;
    gears[1].rotation.z = -st.keyAngle * 1.5;
    // cuckoo pops out every ~4.5 s
    const cyc = (t / 4.5 + st.seed) % 1;
    let open = 0;
    if (cyc < 0.25) open = Math.min(1, Math.min(cyc, 0.25 - cyc) / 0.05);
    doorPiv.rotation.y = -open * 1.9;
    birdG.visible = open > 0.05;
    birdG.position.z = 0.2 + open * 0.24;
    birdG.rotation.x = open > 0.9 ? Math.sin(t * 22) * 0.25 - 0.1 : 0;
    eyes.userData.pulse = 0.8 + 0.3 * Math.sin(t * 2.5 + st.seed) + (open > 0.5 ? 0.6 : 0);
    key.spin.rotation.y = st.keyAngle;
    if (warnRing) warnRing.scale.setScalar(1 + 0.08 * Math.sin(t * 5 + st.seed));
    if (aura) {
      aura.rotation.z = t * 0.6;
      aura.scale.setScalar(1 + 0.1 * Math.sin(t * 2.2 + st.seed));
      auraMat.userData.pulse = 0.7 + 0.4 * Math.sin(t * 2.2 + st.seed);
    }
    for (let i = 0; i < crownGears.length; i++) crownGears[i].rotation.z = st.keyAngle * (i % 2 ? -2 : 2);
    for (let i = 0; i < puffs.length; i++) {
      const c = (t * 0.8 + i * 0.5 + st.seed) % 1;
      puffs[i].position.y = 1.8 + c * 0.45;
      puffs[i].scale.setScalar(0.6 + c * 1.6);
      puffs[i].visible = c < 0.85;
    }
  });
  return E.group;
}

// ---------------------------------------------------------------------------

const FACTORIES = {
  cvakac: createCvakac,
  vrtiak: createVrtiak,
  kotlar: createKotlar,
  vazka: createVazka,
  navijac: createNavijac,
  boss_kukucka: createKukucka,
  boss_kukucka_major: () => createKukucka(true),
  boss_kukucka_magnus: () => createKukucka(2),
  boss_kukucka_imperator: () => createKukucka(3),
  boss_kukucka_polovica: () => createKukucka(4),
  boss_kukucka_tyran: () => createKukucka(5),
  boss_kukucka_tretina: () => createKukucka(6),
};

export const ENEMY_MODEL_TYPES = Object.keys(FACTORIES);

export function createEnemyModel(type) {
  const fn = FACTORIES[type] || FACTORIES.cvakac;
  const g = fn();
  g.userData.update(0, 0, 1);
  return g;
}
