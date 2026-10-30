// TowerModels.js
// Procedural, chunky "stylized diorama" tower models (balista / cannon /
// catapult / frost, levels 1..3) built purely from primitives + small
// procedurally painted canvas textures (stone bricks, wood grain, planks).
//
// Public API:
//   createTowerModel(type, theme, level = 1) -> THREE.Group
//     group.userData = { type, level, turret, muzzle, fire(), update(dt, t),
//                        setLevel(n), materials }
//   retintTowerModel(group, theme)  -- swap themed stone materials (day/night)
//
// Origin = bottom centre, sits on y = 0. Footprint < 1.7 x 1.7.
// turret local +Z = firing direction (game sets turret.rotation.y only).
//
// Perf: static geometry of every node is merged per material slot and the
// merged geometries are cached per (type, level), so one tower is ~10-25
// meshes and all instances share geometry + (themed) materials.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Small deterministic RNG (textures + scatter must look identical each run)
// ---------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Canvas textures (grayscale; material.color tints them)
// ---------------------------------------------------------------------------
const TEX = {};

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stone: 512px = 2 world units, 8 rows of 0.25u tall x 0.5u long blocks.
function stoneTextures() {
  if (TEX.stone) return TEX;
  const R = rng(7);
  const rows = 8, rowH = 64, bw = 128, perRow = 4;
  const shades = [];
  for (let r = 0; r < rows; r++) {
    shades.push([]);
    for (let i = 0; i < perRow; i++) shades[r].push(0.80 + R() * 0.2);
  }
  const blocks = (ctx, color) => {
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 64;
      for (let i = -1; i <= perRow; i++) {
        const idx = ((i % perRow) + perRow) % perRow;
        color(ctx, i * bw + off, r * rowH, shades[r][idx], r, idx);
      }
    }
  };
  TEX.stone = canvasTex(512, 512, (ctx) => {
    ctx.fillStyle = '#5a5654';
    ctx.fillRect(0, 0, 512, 512);
    blocks(ctx, (c, x, y, s) => {
      const v = Math.round(255 * s);
      c.fillStyle = `rgb(${v},${v},${v - 4})`;
      c.fillRect(x + 4, y + 4, bw - 8, rowH - 8);
      // painted bevel: light top/left, dark bottom/right
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillRect(x + 4, y + 4, bw - 8, 7);
      c.fillRect(x + 4, y + 4, 6, rowH - 8);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(x + 4, y + rowH - 12, bw - 8, 8);
      c.fillRect(x + bw - 10, y + 4, 6, rowH - 8);
    });
    // speckles / chips
    for (let i = 0; i < 900; i++) {
      const a = 0.05 + R() * 0.1;
      ctx.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      const s = 2 + R() * 4;
      ctx.fillRect(R() * 512, R() * 512, s, s);
    }
  });
  TEX.stoneBump = canvasTex(512, 512, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    blocks(ctx, (c, x, y) => {
      c.fillStyle = '#9a9a9a';
      c.fillRect(x + 3, y + 3, bw - 6, rowH - 6);
      c.fillStyle = '#ffffff';
      c.fillRect(x + 8, y + 8, bw - 16, rowH - 16);
    });
  }, false);
  // Wood grain: 256px = 0.5u, streaks along U.
  TEX.wood = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const y = R() * 256, a = 0.05 + R() * 0.16;
      ctx.fillStyle = R() < 0.7 ? `rgba(40,25,10,${a})` : `rgba(255,255,255,${a})`;
      const h = 1 + R() * 4;
      ctx.fillRect(0, y, 256, h);
    }
    for (let i = 0; i < 6; i++) { // knots
      ctx.fillStyle = 'rgba(40,20,5,0.25)';
      ctx.beginPath();
      ctx.ellipse(R() * 256, R() * 256, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // Planks: 256px = 1u, 4 planks of 0.25u with dark seams + nails.
  TEX.plank = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, 256, 256);
    for (let p = 0; p < 4; p++) {
      const v = 190 + Math.round(R() * 55);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, p * 64 + 3, 256, 58);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = `rgba(40,25,10,${0.05 + R() * 0.12})`;
        ctx.fillRect(0, p * 64 + 4 + R() * 56, 256, 1 + R() * 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, p * 64, 256, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, p * 64 + 4, 256, 3);
      ctx.fillStyle = 'rgba(30,30,30,0.6)';
      for (const nx of [20, 236]) {
        ctx.fillRect(nx, p * 64 + 14, 5, 5);
        ctx.fillRect(nx, p * 64 + 44, 5, 5);
      }
    }
  });
  return TEX;
}

// ---------------------------------------------------------------------------
// Materials: shared (wood/iron/brass...) + themed stone set + per-instance glow
// ---------------------------------------------------------------------------
let SHARED = null;
const THEMED = new Map(); // stone hex -> { stone, stoneDark, stoneTrim, stoneIce }

function std(slot, o) {
  const m = new THREE.MeshStandardMaterial(o);
  m.userData.slot = slot;
  return m;
}

function texClone(t, repeat) {
  const c = t.clone();
  c.repeat.set(repeat, repeat);
  c.needsUpdate = true;
  return c;
}

function sharedMats() {
  if (SHARED) return SHARED;
  const T = stoneTextures();
  const woodMap = texClone(T.wood, 2);
  const plankMap = texClone(T.plank, 1);
  SHARED = {
    wood: std('wood', { color: 0xa86d3c, map: woodMap, roughness: 0.82 }),
    woodLight: std('woodLight', { color: 0xd39a5a, map: woodMap, roughness: 0.78 }),
    woodDark: std('woodDark', { color: 0x74462a, map: woodMap, roughness: 0.85 }),
    plank: std('plank', { color: 0xc99257, map: plankMap, roughness: 0.8 }),
    iron: std('iron', { color: 0x5b626e, metalness: 0.45, roughness: 0.42 }),
    ironDark: std('ironDark', { color: 0x30343b, metalness: 0.35, roughness: 0.55 }),
    brass: std('brass', { color: 0xc98a3e, metalness: 0.5, roughness: 0.38 }),
    gold: std('gold', { color: 0xffb627, metalness: 0.4, roughness: 0.28, emissive: 0x3a2200, emissiveIntensity: 0.6 }),
    cloth: std('cloth', { color: 0x2f5cc4, roughness: 0.9, side: THREE.DoubleSide }),
    pennant: std('pennant', { color: 0xffb627, roughness: 0.75, side: THREE.DoubleSide, emissive: 0x2a1600, emissiveIntensity: 0.5 }),
    rope: std('rope', { color: 0xa47e4c, roughness: 1 }),
    rock: std('rock', { color: 0x9a948a, roughness: 0.95, flatShading: true }),
    snow: std('snow', { color: 0xf4f9ff, roughness: 0.6, emissive: 0x182430, emissiveIntensity: 0.4 }),
    bore: std('bore', { color: 0x0b0b0d, roughness: 1 }),
    string: std('string', { color: 0xf2e6c8, roughness: 0.9 }),
  };
  return SHARED;
}

function resolveStoneHex(theme) {
  if (theme == null) return 0xb8b8c2;
  if (typeof theme === 'string') return theme === 'zombie' ? 0x4a5a6a : 0xb8b8c2;
  if (typeof theme === 'number') return theme;
  if (theme.stone !== undefined) return new THREE.Color(theme.stone).getHex();
  return 0xb8b8c2;
}

function themedMats(theme) {
  const hex = resolveStoneHex(theme);
  if (THEMED.has(hex)) return THEMED.get(hex);
  const T = stoneTextures();
  const base = new THREE.Color(hex);
  // Night stone is very dark/blue: lift it a little so towers stay legible.
  const hsl = {}; base.getHSL(hsl);
  if (hsl.l < 0.4) base.lerp(new THREE.Color(0x93a3b8), 0.38);
  const stoneMap = texClone(T.stone, 0.5);
  const bump = texClone(T.stoneBump, 0.5);
  const set = {
    stone: std('stone', { color: base.clone(), map: stoneMap, bumpMap: bump, bumpScale: 2.2, roughness: 0.92 }),
    stoneDark: std('stoneDark', { color: base.clone().multiplyScalar(0.66), map: stoneMap, bumpMap: bump, bumpScale: 2.2, roughness: 0.95 }),
    stoneTrim: std('stoneTrim', { color: base.clone().lerp(new THREE.Color(0xfff2dc), 0.16), roughness: 0.85 }),
    stoneIce: std('stoneIce', { color: base.clone().lerp(new THREE.Color(0x8fc3f0), 0.5), map: stoneMap, bumpMap: bump, bumpScale: 2.2, roughness: 0.8 }),
  };
  for (const m of Object.values(set)) {
    m.userData.themed = true;
    // night palette: faint self-light so stone silhouettes never sink into the dark
    if (hsl.l < 0.4) { m.emissive = m.color.clone().multiplyScalar(0.16); }
  }
  THEMED.set(hex, set);
  return set;
}

function frostMats() {
  return {
    ice: std('ice', {
      color: 0x86dcff, emissive: 0x1294e8, emissiveIntensity: 0.75,
      roughness: 0.12, metalness: 0.05, flatShading: true,
    }),
    glow: std('glow', { color: 0x40c8ff, emissive: 0x139ef0, emissiveIntensity: 1.0, roughness: 0.4 }),
  };
}

// ---------------------------------------------------------------------------
// Geometry primitives (all non-indexed, position/normal/uv in world units)
// ---------------------------------------------------------------------------
const GEO = new Map();
function cached(key, fn) {
  let g = GEO.get(key);
  if (!g) { g = fn(); GEO.set(key, g); }
  return g;
}

// Chamfered ("bevelled") box: chunky faceted edges that catch the light.
function bevelBox(w, h, d, b = 0.025) {
  b = Math.max(0.002, Math.min(b, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  return cached(`bb${w},${h},${d},${b}`, () => {
    const hw = w / 2 - b, hd = d / 2 - b;
    const s = new THREE.Shape();
    s.moveTo(-hw, -hd); s.lineTo(hw, -hd); s.lineTo(hw, hd); s.lineTo(-hw, hd); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
      bevelOffset: 0, bevelSegments: 1, curveSegments: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -(h - 2 * b) / 2, 0);
    g.clearGroups();
    return g;
  });
}

function cylGeo(rt, rb, h, seg = 12, open = false, thetaStart = 0, thetaLen = Math.PI * 2) {
  return cached(`cy${rt},${rb},${h},${seg},${open},${thetaStart},${thetaLen}`, () => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, thetaLen);
    const uv = g.attributes.uv;
    const torso = (seg + 1) * 2;
    let circ = 2 * Math.PI * Math.max(rt, rb) * (thetaLen / (Math.PI * 2));
    if (thetaLen >= Math.PI * 2 - 1e-6) circ = Math.max(0.5, Math.round(circ * 2) / 2);
    for (let i = 0; i < uv.count; i++) {
      if (i < torso) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
      else { const r = Math.max(rt, rb) * 2; uv.setXY(i, uv.getX(i) * r, uv.getY(i) * r); }
    }
    const n = g.toNonIndexed();
    n.clearGroups();
    return n;
  });
}

function sphereGeo(r, ws = 10, hs = 8) {
  return cached(`sp${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs).toNonIndexed());
}
function torusGeo(r, t, rs = 6, ts = 16, arc = Math.PI * 2) {
  return cached(`to${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc).toNonIndexed());
}
function coneGeo(r, h, seg = 8) {
  return cached(`co${r},${h},${seg}`, () => cylGeo(0.0001, r, h, seg));
}
function rockGeo(r, seed = 1) {
  return cached(`rk${r},${seed}`, () => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const R = rng(seed * 31 + 5);
    const p = g.attributes.position;
    // icosahedron (non-indexed) shares positions across faces: jitter by key
    const map = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(k)) map.set(k, 0.82 + R() * 0.3);
      const s = map.get(k);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.92, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    return g;
  });
}
// Hexagonal "gem" crystal: pointed both ends, longer on top.
function crystalGeo(r, top, bot, seg = 6) {
  return cached(`cr${r},${top},${bot},${seg}`, () => {
    const pts = [
      new THREE.Vector2(0, -bot),
      new THREE.Vector2(r * 0.95, -bot * 0.3),
      new THREE.Vector2(r, top * 0.35),
      new THREE.Vector2(0, top),
    ];
    const g = new THREE.LatheGeometry(pts, seg).toNonIndexed();
    g.computeVertexNormals();
    return g;
  });
}
// Flat cloth with swallowtail notch, hangs down from y=0, centred on x.
function bannerGeo(w, h, notch = 0.1, t = 0.02) {
  return cached(`bn${w},${h},${notch},${t}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, -h);
    s.lineTo(0, -h + notch); s.lineTo(-w / 2, -h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    g.clearGroups();
    return g;
  });
}
// Pennant flag extending along +X from the pole (x=0), top at y=0.
function flagGeo(w, h, t = 0.016) {
  return cached(`fl${w},${h},${t}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(w, -h * 0.12); s.lineTo(w * 0.78, -h * 0.5);
    s.lineTo(w, -h * 0.88); s.lineTo(0, -h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    g.clearGroups();
    return g;
  });
}

function mergeGeos(list) {
  let n = 0;
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of gs) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// Spec nodes: static parts collected per material slot, merged on bake
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

class Node {
  constructor(name = '', p = [0, 0, 0], r = [0, 0, 0], sc = 1) {
    this.name = name; this.p = p; this.r = r; this.sc = sc;
    this.parts = new Map(); this.kids = []; this.baked = null; this.empty = [];
  }
  child(name, p = [0, 0, 0], r = [0, 0, 0], sc = 1) {
    const n = new Node(name, p, r, sc); this.kids.push(n); return n;
  }
  add(slot, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
    _e.set(r[0], r[1], r[2], 'YXZ');
    _q.setFromEuler(_e);
    _p.set(p[0], p[1], p[2]);
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q, _s);
    const g = geo.clone();
    g.applyMatrix4(_m);
    if (!this.parts.has(slot)) this.parts.set(slot, []);
    this.parts.get(slot).push(g);
    return this;
  }
  box(slot, w, h, d, p, r, b = 0.025) { return this.add(slot, bevelBox(w, h, d, b), p, r); }
  cyl(slot, rt, rb, h, seg, p, r, s) { return this.add(slot, cylGeo(rt, rb, h, seg), p, r, s); }
  sph(slot, rad, p, s, ws = 10, hs = 8) { return this.add(slot, sphereGeo(rad, ws, hs), p, [0, 0, 0], s); }
  // beam between two points (box cross-section w x d)
  beam(slot, a, b, w, d = w, bev = 0.015) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = bevelBox(w, len, d, bev).clone();
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    _m.compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    if (!this.parts.has(slot)) this.parts.set(slot, []);
    this.parts.get(slot).push(g);
    return this;
  }
  rod(slot, a, b, r, seg = 6) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = cylGeo(r, r, len, seg).clone();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    _m.compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    if (!this.parts.has(slot)) this.parts.set(slot, []);
    this.parts.get(slot).push(g);
    return this;
  }
  bake() {
    this.baked = [];
    for (const [slot, list] of this.parts) {
      this.baked.push([slot, mergeGeos(list)]);
      for (const g of list) g.dispose();
    }
    this.parts = null;
    for (const k of this.kids) k.bake();
    return this;
  }
}

function instantiate(node, mats, refs) {
  const o = new THREE.Group();
  o.name = node.name;
  o.position.fromArray(node.p);
  o.rotation.set(node.r[0], node.r[1], node.r[2]);
  o.scale.setScalar(node.sc);
  for (const [slot, geo] of node.baked) {
    const m = new THREE.Mesh(geo, mats[slot] || mats.stone);
    m.castShadow = true;
    m.receiveShadow = true;
    o.add(m);
  }
  for (const k of node.kids) o.add(instantiate(k, mats, refs));
  if (node.name) refs[node.name] = o;
  return o;
}

// ---------------------------------------------------------------------------
// Reusable decoration helpers
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const FRONT = Math.PI / 4; // camera looks from +x+z: decorate that face

function ringOf(n, count, r, y, fn, offset = 0) {
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * TAU;
    fn(n, Math.sin(a) * r, y, Math.cos(a) * r, a, i);
  }
}

function merlons(n, count, r, y, w, h, d, slot = 'stone', cap = null, offset = 0) {
  ringOf(n, count, r, y, (nn, x, yy, z, a) => {
    nn.box(slot, w, h, d, [x, yy + h / 2, z], [0, a, 0], 0.035);
    if (cap) nn.box(cap, w + 0.04, 0.05, d + 0.04, [x, yy + h + 0.02, z], [0, a, 0], 0.015);
  }, offset);
}

function rivets(n, count, r, y, slot = 'iron', size = 0.025, offset = 0) {
  ringOf(n, count, r, y, (nn, x, yy, z) => nn.sph(slot, size, [x, yy, z], 1, 6, 4), offset);
}

// Arched wooden door on a round wall facing angle a.
function door(n, a, r, y0, w = 0.3, h = 0.42, studs = true) {
  const s = Math.sin(a), c = Math.cos(a);
  const at = (dr, dy, dx = 0) => [s * (r + dr) + c * dx, y0 + dy, c * (r + dr) - s * dx];
  n.box('stoneTrim', w + 0.12, h + 0.06, 0.08, at(-0.01, (h + 0.06) / 2), [0, a, 0], 0.02);
  n.add('stoneTrim', cylGeo((w + 0.12) / 2, (w + 0.12) / 2, 0.08, 10, false, -Math.PI / 2, Math.PI), at(-0.01, h + 0.06), [-Math.PI / 2, a, 0]);
  n.box('woodDark', w, h, 0.06, at(0.02, h / 2), [0, a, 0], 0.012);
  n.add('woodDark', cylGeo(w / 2, w / 2, 0.06, 10, false, -Math.PI / 2, Math.PI), at(0.02, h), [-Math.PI / 2, a, 0]);
  n.box('ironDark', w + 0.02, 0.035, 0.03, at(0.055, h * 0.28), [0, a, 0], 0.008);
  n.box('ironDark', w + 0.02, 0.035, 0.03, at(0.055, h * 0.75), [0, a, 0], 0.008);
  if (studs) n.sph('brass', 0.022, at(0.06, h * 0.52, w * 0.28), 1, 6, 4);
}

// Dark arrow-slit window.
function slit(n, a, r, y, h = 0.22) {
  const s = Math.sin(a), c = Math.cos(a);
  n.box('stoneTrim', 0.13, h + 0.08, 0.06, [s * r, y, c * r], [0, a, 0], 0.015);
  n.box('bore', 0.05, h, 0.06, [s * (r + 0.015), y, c * (r + 0.015)], [0, a, 0], 0.01);
}

// Hanging cloth banner on a wall at angle a (gold rod, emblem, trim).
function banner(n, a, r, yTop, w = 0.24, h = 0.5) {
  const s = Math.sin(a), c = Math.cos(a);
  const at = (dr, dy) => [s * (r + dr), yTop + dy, c * (r + dr)];
  n.add('cloth', bannerGeo(w, h, 0.1, 0.025), at(0.02, -0.02), [0, a, 0]);
  n.add('gold', bannerGeo(w * 0.36, h * 0.06, 0, 0.03), at(0.03, -0.08), [0, a, 0]);
  n.box('gold', w * 0.22, w * 0.22, 0.03, at(0.037, -h * 0.45), [0, a, Math.PI / 4], 0.006);
  n.rod('gold', at(0.03, 0).map((v, i) => v + (i === 0 ? -c * (w / 2 + 0.05) : i === 2 ? s * (w / 2 + 0.05) : 0)),
    at(0.03, 0).map((v, i) => v + (i === 0 ? c * (w / 2 + 0.05) : i === 2 ? -s * (w / 2 + 0.05) : 0)), 0.018, 6);
}

// Flag pole (static) + animated 2-segment pennant. Returns flag node name.
function flagPole(n, name, x, z, y0, hgt, size = 1) {
  n.cyl('woodDark', 0.026, 0.032, hgt, 6, [x, y0 + hgt / 2, z]);
  n.sph('gold', 0.045, [x, y0 + hgt + 0.03, z]);
  const f1 = n.child(name, [x, y0 + hgt - 0.04, z]);
  const w = 0.2 * size, h = 0.22 * size;
  // first segment: rectangle (x 0..w), second: swallowtail tip
  f1.box('pennant', w, h, 0.018, [w / 2 + 0.025, -h / 2, 0], [0, 0, 0], 0.004);
  f1.box('cloth', w * 0.9, h * 0.22, 0.022, [w / 2 + 0.03, -h / 2, 0], [0, 0, 0], 0.004);
  const f2 = f1.child(name + '2', [w + 0.025, 0, 0]);
  f2.add('pennant', flagGeo(w * 0.9, h), [0, 0, 0]);
  f2.box('cloth', w * 0.45, h * 0.22, 0.022, [w * 0.22, -h / 2, 0], [0, 0, 0], 0.004);
  return name;
}

// ---------------------------------------------------------------------------
// BALISTA
// ---------------------------------------------------------------------------
function balistaBody(root, L) {
  const b = root.child('body');
  let topY;
  if (L === 1) {
    // Wooden watch scaffold on a stone footing.
    b.box('stoneDark', 1.42, 0.18, 1.42, [0, 0.09, 0], [0, 0, 0], 0.05);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      b.box('stoneTrim', 0.3, 0.12, 0.3, [sx * 0.5, 0.24, sz * 0.5], [0, 0, 0], 0.03);
      b.box('wood', 0.17, 1.32, 0.17, [sx * 0.5, 0.3 + 0.66, sz * 0.5], [0, 0, 0], 0.035);
      b.sph('brass', 0.06, [sx * 0.5, 1.66, sz * 0.5], [1, 0.7, 1]);
    }
    // X bracing on all faces + ring beams
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2;
      const s = Math.sin(a), c = Math.cos(a);
      const P = (u, y) => [s * 0.52 + c * u, y, c * 0.52 - s * u];
      b.beam('woodDark', P(-0.42, 0.42), P(0.42, 1.18), 0.07, 0.06);
      b.beam('woodDark', P(0.42, 0.42), P(-0.42, 1.18), 0.07, 0.06);
      b.box('wood', 1.0, 0.1, 0.09, P(0, 0.4), [0, a, 0], 0.02);
      // rope lashing at brace crossings
      b.add('rope', torusGeo(0.05, 0.018, 4, 10), P(0, 0.8), [0, a, 0]);
    }
    // ladder on the camera side
    for (const dz of [-0.13, 0.13]) b.rod('woodDark', [0.74, 0.18, dz], [0.62, 1.42, dz], 0.028, 6);
    for (let i = 0; i < 6; i++) {
      const y = 0.36 + i * 0.19;
      const x = 0.74 - (y - 0.18) * (0.12 / 1.24);
      b.rod('wood', [x, y, -0.14], [x, y, 0.14], 0.018, 5);
    }
    b.box('plank', 1.44, 0.12, 1.44, [0, 1.36, 0], [0, 0, 0], 0.03);
    b.box('woodDark', 1.5, 0.06, 1.5, [0, 1.29, 0], [0, 0, 0], 0.02);
    topY = 1.42;
    flagPole(b, 'flagA', -0.5, -0.5, 1.6, 0.55, 0.9);
  } else {
    const big = L === 3;
    const r = big ? 0.6 : 0.56, rb = big ? 0.68 : 0.64;
    const h = big ? 1.36 : 1.1;
    // footing
    b.cyl('stoneDark', 0.8, 0.83, 0.18, 8, [0, 0.09, 0], [0, Math.PI / 8, 0]);
    if (big) b.cyl('stoneDark', 0.74, 0.76, 0.12, 8, [0, 0.24, 0], [0, Math.PI / 8, 0]);
    const y0 = big ? 0.3 : 0.18;
    b.cyl('stone', r, rb, h, 18, [0, y0 + h / 2, 0]);
    // mid band + plinth band
    b.cyl('stoneTrim', rb + 0.03, rb + 0.05, 0.1, 18, [0, y0 + 0.05, 0]);
    b.cyl('stoneTrim', r + 0.055, r + 0.07, 0.07, 18, [0, y0 + h * 0.56, 0]);
    // corbel + deck
    const cy = y0 + h;
    b.cyl('stoneTrim', r + 0.16, r - 0.02, 0.16, 18, [0, cy + 0.08, 0]);
    // corbel teeth
    ringOf(b, 12, r + 0.05, cy - 0.04, (nn, x, y, z, a) => nn.box('stoneTrim', 0.1, 0.16, 0.1, [x, y - 0.03, z], [0, a, 0], 0.012));
    b.cyl('plank', r + 0.1, r + 0.1, 0.06, 18, [0, cy + 0.17, 0]);
    merlons(b, 8, r + 0.11, cy + 0.16, 0.25, big ? 0.24 : 0.2, 0.15, 'stone', big ? 'gold' : 'stoneTrim', Math.PI / 8);
    door(b, FRONT, rb + 0.03, y0, 0.3, 0.4);
    slit(b, FRONT + 0.95, r + 0.02, y0 + h * 0.75);
    slit(b, FRONT - 0.95, r + 0.02, y0 + h * 0.75);
    if (big) {
      b.cyl('gold', r + 0.075, r + 0.075, 0.035, 18, [0, y0 + h * 0.56, 0]);
      banner(b, FRONT + 0.62, r + 0.035, cy - 0.12, 0.22, 0.52);
      banner(b, FRONT - 0.62, r + 0.035, cy - 0.12, 0.22, 0.52);
      flagPole(b, 'flagA', -0.5, -0.32, cy + 0.2, 0.6, 1.0);
      flagPole(b, 'flagB', 0.32, -0.5, cy + 0.2, 0.45, 0.85);
    } else {
      flagPole(b, 'flagA', -0.45, -0.38, cy + 0.2, 0.5, 0.9);
    }
    topY = cy + 0.2;
  }
  return topY;
}

function balistaTurret(root, L, topY) {
  const t = root.child('turret', [0, topY, 0], [0, 0, 0], L === 1 ? 1.2 : L === 2 ? 1.22 : 1.2);
  const s = L === 1 ? 0.92 : L === 2 ? 1.0 : 1.08;
  const fit = L === 1 ? 'iron' : L === 2 ? 'brass' : 'gold';
  // turntable
  t.cyl('woodDark', 0.36 * s, 0.4 * s, 0.1, 14, [0, 0.05, 0]);
  t.cyl(L === 1 ? 'ironDark' : 'iron', 0.41 * s, 0.41 * s, 0.04, 14, [0, 0.03, 0]);
  rivets(t, 8, 0.4 * s, 0.07, fit, 0.022);
  // A-frame yoke holding the stock
  const sy = 0.34 * s; // stock height
  for (const sx of [-1, 1]) {
    t.beam('wood', [sx * 0.2 * s, 0.08, -0.16 * s], [sx * 0.09, sy - 0.02, 0], 0.07, 0.07);
    t.beam('wood', [sx * 0.2 * s, 0.08, 0.16 * s], [sx * 0.09, sy - 0.02, 0], 0.07, 0.07);
  }
  t.cyl(fit, 0.04, 0.04, 0.24, 8, [0, sy - 0.02, 0], [0, 0, Math.PI / 2]);
  // stock (long rail) with groove
  const len = 1.12 * s;
  t.box('wood', 0.17 * s, 0.13, len, [0, sy, 0.05], [0, 0, 0], 0.03);
  t.box('woodDark', 0.06, 0.02, len - 0.06, [0, sy + 0.066, 0.05], [0, 0, 0], 0.005);
  // iron straps along stock
  for (const z of [-0.36, 0.0, 0.36]) {
    t.box(L === 1 ? 'ironDark' : fit, 0.19 * s, 0.15, 0.04, [0, sy, z * s], [0, 0, 0], 0.008);
  }
  // winch at the back
  t.cyl('woodDark', 0.07, 0.07, 0.3 * s, 10, [0, sy + 0.02, -0.46 * s], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) {
    t.add(fit, cylGeo(0.1, 0.1, 0.03, 10), [sx * 0.16 * s, sy + 0.02, -0.46 * s], [0, 0, Math.PI / 2]);
    t.beam('woodDark', [sx * 0.18 * s, sy + 0.02, -0.46 * s], [sx * 0.18 * s, sy + 0.16, -0.52 * s], 0.035, 0.035);
  }
  // bow head block
  const bz = 0.44 * s;
  t.box(fit, 0.3 * s, 0.17, 0.14, [0, sy + 0.02, bz], [0, 0, 0], 0.03);
  t.box('wood', 0.22 * s, 0.1, 0.16, [0, sy + 0.12, bz], [0, 0, 0], 0.02);
  if (L === 3) {
    // gun shield with gold trim
    t.box('iron', 0.72, 0.24, 0.05, [0, sy - 0.12, bz + 0.12], [-0.15, 0, 0], 0.02);
    t.box('gold', 0.76, 0.04, 0.06, [0, sy + 0.0, bz + 0.1], [-0.15, 0, 0], 0.01);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) t.sph('gold', 0.022, [x, sy - 0.14, bz + 0.15], 1, 6, 4);
  }
  // bow arms (animated): pivots at bow head sides, extend outward
  const armLen = (L === 1 ? 0.48 : L === 2 ? 0.55 : 0.6);
  const armSlot = 'woodLight';
  for (const sx of [-1, 1]) {
    const arm = t.child(sx < 0 ? 'armL' : 'armR', [sx * 0.15 * s, sy + 0.02, bz]);
    arm.box(armSlot, armLen, 0.1, 0.09, [sx * armLen / 2, 0, 0], [0, 0, 0], 0.02);
    arm.box(fit, 0.06, 0.1, 0.09, [sx * armLen * 0.35, 0, 0], [0, 0, 0], 0.01);
    arm.box(fit, 0.08, 0.1, 0.09, [sx * (armLen - 0.03), 0, 0], [0, 0, 0], 0.015);
    arm.sph(fit, 0.04, [sx * (armLen + 0.02), 0, 0]);
    if (L >= 2) arm.box(armSlot, armLen * 0.85, 0.05, 0.05, [sx * armLen * 0.45, 0.0, -0.05], [0, 0, 0], 0.012);
  }
  // torsion skeins (rope bundles) beside the head
  for (const sx of [-1, 1]) t.cyl('rope', 0.065, 0.065, 0.22, 8, [sx * 0.15 * s, sy + 0.02, bz]);
  // bolt (animated)
  const bolt = t.child('bolt', [0, sy + 0.1, 0]);
  const bl = 0.86 * s;
  bolt.add('wood', cylGeo(0.026, 0.026, bl, 6), [0, 0, bl / 2], [Math.PI / 2, 0, 0]);
  bolt.add(L === 3 ? 'gold' : 'iron', coneGeo(0.06, 0.16, 6), [0, 0, bl + 0.07], [Math.PI / 2, 0, 0]);
  bolt.box('pennant', 0.01, 0.1, 0.14, [0, 0.05, 0.1], [0, 0, 0], 0.003);
  bolt.box('pennant', 0.1, 0.01, 0.14, [0.05, 0, 0.1], [0, 0, 0], 0.003);
  bolt.box('pennant', 0.1, 0.01, 0.14, [-0.05, 0, 0.1], [0, 0, 0], 0.003);
  t.child('muzzle', [0, sy + 0.1, bz + 0.3 * s]);
  return { sy, bz, armLen, s };
}

// ---------------------------------------------------------------------------
// CANNON
// ---------------------------------------------------------------------------
function cannonBody(root, L) {
  const b = root.child('body');
  let topY;
  if (L === 1) {
    b.cyl('stoneDark', 0.76, 0.8, 0.18, 8, [0, 0.09, 0], [0, Math.PI / 8, 0]);
    b.cyl('stone', 0.62, 0.68, 0.46, 16, [0, 0.18 + 0.23, 0]);
    b.cyl('stoneTrim', 0.66, 0.66, 0.08, 16, [0, 0.66, 0]);
    // wooden palisade of sharpened logs
    ringOf(b, 18, 0.66, 0.7, (nn, x, y, z, a, i) => {
      const hh = 0.22 + ((i * 7) % 3) * 0.04;
      nn.cyl('wood', 0.065, 0.07, hh, 7, [x, y + hh / 2, z], [0, a, 0]);
      nn.add('wood', coneGeo(0.065, 0.12, 7), [x, y + hh + 0.06, z], [0, a, 0]);
    }, 0.17);
    b.add('rope', torusGeo(0.71, 0.022, 4, 36), [0, 0.86, 0], [Math.PI / 2, 0, 0]);
    b.cyl('plank', 0.6, 0.6, 0.06, 16, [0, 0.72, 0]);
    door(b, FRONT, 0.66, 0.18, 0.26, 0.34);
    topY = 0.75;
    flagPole(b, 'flagA', -0.47, -0.47, 0.7, 0.95, 0.9);
  } else {
    const big = L === 3;
    const r = big ? 0.66 : 0.62, rb = big ? 0.74 : 0.7, h = big ? 0.82 : 0.72;
    b.cyl('stoneDark', 0.8, 0.84, 0.2, 8, [0, 0.1, 0], [0, Math.PI / 8, 0]);
    const y0 = 0.2;
    b.cyl('stone', r, rb, h, 18, [0, y0 + h / 2, 0]);
    b.cyl('stoneTrim', rb + 0.03, rb + 0.05, 0.1, 18, [0, y0 + 0.05, 0]);
    // riveted iron band
    b.cyl('ironDark', r + 0.045, r + 0.05, 0.08, 18, [0, y0 + h * 0.55, 0]);
    rivets(b, 16, r + 0.06, y0 + h * 0.55, big ? 'gold' : 'brass', 0.022);
    const cy = y0 + h;
    b.cyl('stoneTrim', r + 0.14, r - 0.02, 0.14, 18, [0, cy + 0.07, 0]);
    ringOf(b, 12, r + 0.04, cy - 0.03, (nn, x, y, z, a) => nn.box('stoneTrim', 0.1, 0.15, 0.1, [x, y - 0.03, z], [0, a, 0], 0.012));
    b.cyl('plank', r + 0.08, r + 0.08, 0.06, 18, [0, cy + 0.15, 0]);
    // low wide merlons
    merlons(b, 6, r + 0.1, cy + 0.14, 0.34, big ? 0.2 : 0.17, 0.16, 'stone', big ? 'gold' : 'stoneTrim', Math.PI / 6);
    door(b, FRONT, rb + 0.03, y0, 0.28, 0.34);
    // cannonball stack on footing (camera side)
    const bx = Math.sin(FRONT + 0.85) * 0.72, bzz = Math.cos(FRONT + 0.85) * 0.72;
    for (const [dx, dz, dy] of [[-0.06, 0, 0], [0.06, 0, 0], [0, 0.07, 0], [0, 0.03, 0.09]]) {
      b.sph('ironDark', 0.065, [bx + dx, 0.26 + dy, bzz + dz]);
    }
    if (big) {
      b.cyl('gold', r + 0.06, r + 0.065, 0.03, 18, [0, y0 + h * 0.55 + 0.055, 0]);
      b.cyl('gold', r + 0.06, r + 0.065, 0.03, 18, [0, y0 + h * 0.55 - 0.055, 0]);
      banner(b, FRONT + 0.75, r + 0.04, cy - 0.06, 0.22, 0.42);
      banner(b, FRONT - 0.75, r + 0.04, cy - 0.06, 0.22, 0.42);
      flagPole(b, 'flagA', -0.52, -0.3, cy + 0.15, 0.85, 1.0);
      flagPole(b, 'flagB', 0.3, -0.52, cy + 0.15, 0.6, 0.85);
    } else {
      flagPole(b, 'flagA', -0.48, -0.36, cy + 0.15, 0.8, 0.9);
    }
    topY = cy + 0.18;
  }
  return topY;
}

function cannonTurret(root, L, topY) {
  const t = root.child('turret', [0, topY, 0]);
  const fit = L === 1 ? 'ironDark' : L === 2 ? 'brass' : 'gold';
  const s = L === 1 ? 0.9 : L === 2 ? 1.0 : 1.1;
  t.cyl('woodDark', 0.42 * s, 0.44 * s, 0.07, 14, [0, 0.035, 0]);
  t.cyl('iron', 0.45 * s, 0.45 * s, 0.035, 14, [0, 0.02, 0]);
  // carriage cheeks (stepped)
  for (const sx of [-1, 1]) {
    const x = sx * 0.19 * s;
    t.box('wood', 0.09, 0.2 * s, 0.66 * s, [x, 0.17 * s, -0.02], [0, 0, 0], 0.025);
    t.box('wood', 0.09, 0.14 * s, 0.36 * s, [x, 0.33 * s, 0.05 * s], [0, 0, 0], 0.025);
    t.box('ironDark', 0.1, 0.035, 0.68 * s, [x, 0.08 * s, -0.02], [0, 0, 0], 0.008);
    t.box(fit, 0.1, 0.06, 0.08, [x, 0.4 * s, 0.05 * s], [0, 0, 0], 0.01);
    // trucks (small wheels)
    for (const z of [-0.2 * s, 0.2 * s]) {
      t.add('woodDark', cylGeo(0.11 * s, 0.11 * s, 0.06, 12), [sx * 0.27 * s, 0.11 * s, z], [0, 0, Math.PI / 2]);
      t.add('iron', cylGeo(0.035, 0.035, 0.08, 8), [sx * 0.28 * s, 0.11 * s, z], [0, 0, Math.PI / 2]);
    }
  }
  t.box('woodDark', 0.3 * s, 0.07, 0.1, [0, 0.12 * s, -0.3 * s], [0, 0, 0], 0.02); // transom
  // barrel pivot (trunnions) -> recoil -> barrel
  const py = 0.42 * s;
  const piv = t.child('pitch', [0, py, 0.02], [-0.16, 0, 0]);
  const rec = piv.child('recoil');
  const R = (L === 1 ? 0.13 : L === 2 ? 0.15 : 0.17);
  const zb = -0.28 * s, zf = 0.5 * s;
  rec.add('iron', cylGeo(R * 0.82, R, zf - zb, 16), [0, 0, (zb + zf) / 2], [Math.PI / 2, 0, 0]);
  rec.sph('iron', R * 1.02, [0, 0, zb], 1, 14, 10);
  rec.sph('ironDark', R * 0.36, [0, 0, zb - R * 1.05]);
  rec.add('iron', cylGeo(0.045, 0.045, 0.3 * s + 0.12, 8), [0, 0, 0], [0, 0, Math.PI / 2]);
  // reinforcing rings
  const rings = L === 1 ? [-0.1, 0.24] : [-0.12, 0.08, 0.3];
  for (const z of rings) rec.add(L === 1 ? 'ironDark' : fit, cylGeo(R * 1.08, R * 1.08, 0.05, 16), [0, 0, z * s], [Math.PI / 2, 0, 0]);
  // flared muzzle
  const mz = zf + 0.06;
  rec.add('iron', cylGeo(R * 1.18, R * 0.85, 0.14, 16), [0, 0, mz], [Math.PI / 2, 0, 0]);
  rec.add(L === 1 ? 'ironDark' : fit, cylGeo(R * 1.24, R * 1.24, 0.04, 16), [0, 0, mz + 0.07], [Math.PI / 2, 0, 0]);
  rec.add('bore', cylGeo(R * 0.62, R * 0.62, 0.02, 12), [0, 0, mz + 0.085], [Math.PI / 2, 0, 0]);
  if (L === 3) {
    // decorative spikes around the muzzle + dolphins (handles)
    ringOf(rec, 8, R * 1.2, 0, (nn, x, y, z, a) => {
      nn.add('gold', coneGeo(0.025, 0.08, 5), [x * 1, z * 1, mz + 0.03], [Math.PI / 2 - 0.0, 0, 0]);
    });
    for (const sx of [-1, 1]) rec.add('gold', torusGeo(0.05, 0.015, 4, 10, Math.PI), [sx * 0.05, R * 0.95, 0.02], [0, Math.PI / 2, 0]);
  }
  rec.child('muzzle', [0, 0, mz + 0.12]);
  return { s };
}

// ---------------------------------------------------------------------------
// CATAPULT
// ---------------------------------------------------------------------------
function catapultBody(root, L) {
  const b = root.child('body');
  let topY;
  if (L === 1) {
    b.box('stoneDark', 1.46, 0.2, 1.46, [0, 0.1, 0], [0, 0, 0], 0.05);
    // log stilts + plank deck
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      b.cyl('wood', 0.09, 0.1, 0.2, 8, [sx * 0.55, 0.3, sz * 0.55]);
    }
    b.box('woodDark', 1.4, 0.08, 1.4, [0, 0.42, 0], [0, 0, 0], 0.02);
    b.box('plank', 1.36, 0.08, 1.36, [0, 0.48, 0], [0, 0, 0], 0.02);
    // ammo heap on the camera-side corner
    const R = rng(3);
    for (let i = 0; i < 4; i++) {
      b.add('rock', rockGeo(0.09, i + 1), [0.58 + (R() - 0.5) * 0.14, 0.28 + (i === 3 ? 0.08 : 0), -0.2 + i * 0.1], [R(), R(), R()]);
    }
    topY = 0.52;
    flagPole(b, 'flagA', -0.6, -0.6, 0.52, 0.85, 0.9);
  } else {
    const big = L === 3;
    const h = big ? 0.62 : 0.5;
    b.box('stoneDark', 1.56, 0.16, 1.56, [0, 0.08, 0], [0, 0, 0], 0.05);
    b.box('stone', 1.4, h, 1.4, [0, 0.16 + h / 2, 0], [0, 0, 0], 0.05);
    b.box('stoneTrim', 1.5, 0.1, 1.5, [0, 0.16 + h + 0.05, 0], [0, 0, 0], 0.035);
    b.box('plank', 1.34, 0.04, 1.34, [0, 0.16 + h + 0.1, 0], [0, 0, 0], 0.01);
    const cy = 0.16 + h + 0.1;
    // corner pillars
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ph = big ? 0.32 : 0.22;
      b.box('stone', 0.24, ph, 0.24, [sx * 0.63, cy + ph / 2, sz * 0.63], [0, 0, 0], 0.035);
      b.box(big ? 'gold' : 'stoneTrim', 0.28, 0.06, 0.28, [sx * 0.63, cy + ph + 0.03, sz * 0.63], [0, 0, 0], 0.015);
      if (big) b.add('gold', coneGeo(0.08, 0.16, 4), [sx * 0.63, cy + ph + 0.14, sz * 0.63], [0, Math.PI / 4, 0]);
    }
    // stone face details: arch niche on camera faces
    for (const a of [0, Math.PI / 2]) {
      const s = Math.sin(a), c = Math.cos(a);
      b.box('stoneTrim', 0.5, 0.06, 0.06, [s * 0.71, 0.16 + h * 0.62, c * 0.71], [0, a, 0], 0.015);
    }
    door(b, 0, 0.7, 0.16, 0.28, big ? 0.4 : 0.32);
    if (big) banner(b, Math.PI / 2, 0.7, 0.16 + h - 0.02, 0.26, 0.46);
    else slit(b, Math.PI / 2, 0.71, 0.16 + h * 0.5, 0.2);
    // ammo heap on the footing
    const R = rng(9);
    for (let i = 0; i < (big ? 5 : 3); i++) {
      b.add('rock', rockGeo(0.085, i + 3), [-0.75 + 0.02 * i, 0.24, 0.1 + i * 0.12], [R(), R(), R()]);
    }
    topY = cy + 0.02;
    if (big) {
      flagPole(b, 'flagA', -0.63, -0.63, cy + 0.38, 0.65, 1.0);
      flagPole(b, 'flagB', 0.63, -0.63, cy + 0.38, 0.5, 0.85);
    } else {
      flagPole(b, 'flagA', -0.63, -0.63, cy + 0.28, 0.65, 0.9);
    }
  }
  return topY;
}

function catapultTurret(root, L, topY) {
  const t = root.child('turret', [0, topY, 0], [0, 0, 0], 1.12);
  const s = L === 1 ? 0.9 : L === 2 ? 0.97 : 1.04;
  const fit = L === 1 ? 'ironDark' : L === 2 ? 'iron' : 'gold';
  const X = 0.27 * s;
  // base rails + cross beams
  for (const sx of [-1, 1]) t.box('wood', 0.12, 0.12, 1.02 * s, [sx * X, 0.13, 0], [0, 0, 0], 0.025);
  for (const z of [-0.44 * s, 0.44 * s]) t.box('woodDark', 2 * X + 0.14, 0.1, 0.11, [0, 0.14, z], [0, 0, 0], 0.025);
  // wheels
  for (const sx of [-1, 1]) for (const z of [-0.33 * s, 0.33 * s]) {
    t.add('woodDark', cylGeo(0.13, 0.13, 0.07, 12), [sx * (X + 0.1), 0.13, z], [0, 0, Math.PI / 2]);
    t.add(fit === 'gold' ? 'iron' : fit, cylGeo(0.135, 0.135, 0.03, 12), [sx * (X + 0.115), 0.13, z], [0, 0, Math.PI / 2]);
    t.add(fit, cylGeo(0.04, 0.04, 0.1, 8), [sx * (X + 0.12), 0.13, z], [0, 0, Math.PI / 2]);
  }
  // A-frame uprights + stop bar
  const topYb = 0.92 * s, topZ = 0.24 * s;
  for (const sx of [-1, 1]) {
    t.beam('wood', [sx * X, 0.16, -0.22 * s], [sx * X, topYb, topZ], 0.1, 0.1, 0.02);
    t.beam('wood', [sx * X, 0.16, 0.46 * s], [sx * X, topYb, topZ], 0.1, 0.1, 0.02);
    t.box(fit, 0.13, 0.08, 0.13, [sx * X, topYb, topZ], [0, 0, 0], 0.02);
  }
  t.box('woodDark', 2 * X + 0.12, 0.11, 0.11, [0, topYb + 0.02, topZ], [0, 0, 0], 0.025);
  t.cyl('rope', 0.075, 0.075, 0.26, 10, [0, topYb - 0.06, topZ - 0.02], [0, 0, Math.PI / 2]); // padding
  // axle + torsion skein
  const ay = 0.3 * s, az = 0.1 * s;
  t.add('iron', cylGeo(0.04, 0.04, 2 * X + 0.12, 8), [0, ay, az], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) t.add('rope', cylGeo(0.09, 0.09, X - 0.06, 10), [sx * (X / 2 + 0.03), ay, az], [0, 0, Math.PI / 2]);
  // winch at the back
  t.add('woodDark', cylGeo(0.06, 0.06, 2 * X, 8), [0, 0.26, -0.38 * s], [0, 0, Math.PI / 2]);
  t.rod('rope', [0, 0.27, -0.36 * s], [0, 0.42, -0.2 * s], 0.014, 4);
  if (L >= 2) for (const sx of [-1, 1]) t.box(fit, 0.04, 0.16, 0.04, [sx * (X + 0.08), 0.26, -0.38 * s], [0, 0, 0], 0.01);
  // throwing arm
  const arm = t.child('arm', [0, ay, az]);
  const AL = 0.84 * s;
  arm.box('wood', 0.09, AL, 0.09, [0, AL / 2, 0], [0, 0, 0], 0.02);
  arm.box(fit, 0.11, 0.05, 0.11, [0, AL * 0.3, 0], [0, 0, 0], 0.01);
  arm.box(fit, 0.11, 0.05, 0.11, [0, AL * 0.65, 0], [0, 0, 0], 0.01);
  arm.cyl('rope', 0.06, 0.06, 0.12, 8, [0, 0.0, 0], [0, 0, Math.PI / 2]);
  // bucket (opens toward local +Z)
  const bk = L === 3 ? 0.17 : 0.14;
  arm.add('woodDark', cylGeo(bk, bk * 0.85, 0.09, 12), [0, AL, 0.06], [Math.PI / 2, 0, 0]);
  arm.add(L === 1 ? 'ironDark' : 'iron', cylGeo(bk + 0.012, bk + 0.012, 0.03, 12), [0, AL, 0.1], [Math.PI / 2, 0, 0]);
  const rock = arm.child('rock', [0, AL, 0.14]);
  rock.add('rock', rockGeo(bk * 0.8, 11), [0, 0, 0]);
  if (L === 3) {
    // flaming? no -- keep it readable: iron-spiked rock
    rock.add('ironDark', coneGeo(0.03, 0.08, 4), [0, bk * 0.75, 0], [0, 0, 0]);
  }
  // muzzle: where the rock leaves the bucket (arm at full swing)
  const fireAng = 0.32;
  const mx = new THREE.Vector3(0, AL, 0.14).applyEuler(new THREE.Euler(fireAng, 0, 0));
  t.child('muzzle', [0, ay + mx.y, az + mx.z]);
  return { AL, fireAng };
}

// ---------------------------------------------------------------------------
// FROST
// ---------------------------------------------------------------------------
function frostBody(root, L) {
  const b = root.child('body');
  const big = L === 3;
  b.cyl('stoneDark', 0.72, 0.76, 0.18, 8, [0, 0.09, 0], [0, Math.PI / 8, 0]);
  let y0 = 0.18;
  if (big) { b.cyl('stoneDark', 0.64, 0.67, 0.12, 8, [0, 0.24, 0], [0, Math.PI / 8, 0]); y0 = 0.3; }
  const h = L === 1 ? 0.62 : L === 2 ? 0.86 : 0.96;
  const r = L === 1 ? 0.48 : 0.5, rb = L === 1 ? 0.58 : 0.62;
  b.cyl('stoneIce', r, rb, h, 8, [0, y0 + h / 2, 0], [0, Math.PI / 8, 0]);
  b.cyl('stoneTrim', rb + 0.03, rb + 0.04, 0.08, 8, [0, y0 + 0.04, 0], [0, Math.PI / 8, 0]);
  const cy = y0 + h;
  // flared cap (bowl) + snow
  b.cyl('stoneTrim', r + 0.14, r - 0.02, 0.14, 8, [0, cy + 0.07, 0], [0, Math.PI / 8, 0]);
  b.cyl('stoneIce', r + 0.06, r + 0.1, 0.06, 8, [0, cy + 0.17, 0], [0, Math.PI / 8, 0]);
  b.cyl(L === 1 ? 'stoneTrim' : L === 2 ? 'brass' : 'gold', r + 0.15, r + 0.15, 0.035, 8, [0, cy + 0.13, 0], [0, Math.PI / 8, 0]);
  b.cyl('glow', r - 0.12, r - 0.1, 0.03, 16, [0, cy + 0.2, 0]);
  b.cyl('stoneTrim', r - 0.06, r - 0.06, 0.04, 16, [0, cy + 0.19, 0]);
  // icicles hanging from the cap rim
  ringOf(b, 8, r + 0.1, cy - 0.02, (nn, x, y, z, a, i) => {
    nn.add('ice', coneGeo(0.03, 0.12 + (i % 3) * 0.05, 5), [x, y - 0.04 - (i % 3) * 0.025, z], [Math.PI, 0, 0]);
  }, Math.PI / 8 + 0.2);
  const R = rng(L * 17);
  ringOf(b, 3, r + 0.04, cy + 0.2, (nn, x, y, z) => nn.sph('snow', 0.07 + R() * 0.03, [x, y, z], [1.5, 0.5, 1.5]), 0.6);
  // snow drifts on footing
  ringOf(b, 4, rb + 0.1, y0 - 0.0, (nn, x, y, z) => nn.sph('snow', 0.06 + R() * 0.03, [x, y, z], [1.5, 0.45, 1.5]), 1.1);
  // glowing runes on the wall faces facing camera
  if (L >= 2) {
    for (const a of [FRONT, FRONT + Math.PI / 2, FRONT - Math.PI / 2]) {
      const s = Math.sin(a), c = Math.cos(a), rr = r + (rb - r) * 0.45 + 0.01;
      const yy = y0 + h * 0.5;
      // snowflake rune
      for (const k of [0, 1, 2]) b.box('glow', 0.035, 0.24, 0.03, [s * rr, yy, c * rr], [0, a, k * Math.PI / 3], 0.008);
      b.box('glow', 0.07, 0.07, 0.035, [s * rr, yy, c * rr], [0, a, Math.PI / 4], 0.01);
    }
  } else {
    door(b, FRONT, rb - 0.0, y0, 0.24, 0.3, false);
  }
  // ice crystal clusters breaking out of the ground
  const clusters = L === 1 ? [FRONT + 1.3, FRONT - 1.6, FRONT + 3.2] : [FRONT + 1.2, FRONT - 1.3, FRONT + 2.9, FRONT - 2.6];
  for (const a of clusters) {
    const x = Math.sin(a) * (rb + 0.06), z = Math.cos(a) * (rb + 0.06);
    b.add('ice', crystalGeo(0.07, 0.3, 0.05), [x, y0 - 0.02, z], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]);
    b.add('ice', crystalGeo(0.05, 0.2, 0.04), [x + Math.cos(a) * 0.08, y0 - 0.03, z - Math.sin(a) * 0.08], [Math.cos(a) * 0.6 + 0.3, 0, -Math.sin(a) * 0.6]);
    b.add('ice', crystalGeo(0.04, 0.14, 0.03), [x - Math.cos(a) * 0.07, y0 - 0.03, z + Math.sin(a) * 0.07], [Math.cos(a) * 0.5 - 0.3, 0, -Math.sin(a) * 0.7]);
  }
  // prongs that cradle the floating crystal
  const nP = L === 1 ? 3 : L === 2 ? 4 : 6;
  const pSlot = L === 1 ? 'stoneTrim' : L === 2 ? 'brass' : 'gold';
  ringOf(b, nP, r - 0.06, cy + 0.15, (nn, x, y, z, a) => {
    const ox = Math.sin(a) * 0.12, oz = Math.cos(a) * 0.12;
    nn.beam(pSlot, [x, y, z], [x + ox, y + 0.34, z + oz], 0.07, 0.07, 0.015);
    nn.add(pSlot, coneGeo(0.05, 0.12, 4), [x + ox * 1.15, y + 0.42, z + oz * 1.15], [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]);
  }, FRONT);
  if (L >= 2) b.add(pSlot, torusGeo(r - 0.02, 0.03, 6, 24), [0, cy + 0.32, 0], [Math.PI / 2, 0, 0]);
  if (big) {
    // four ice obelisks at the corners
    ringOf(b, 4, 0.6, 0.18, (nn, x, y, z, a) => {
      nn.box('stoneIce', 0.16, 0.6, 0.16, [x, y + 0.3, z], [0, a, 0], 0.03);
      nn.box('gold', 0.2, 0.05, 0.2, [x, y + 0.62, z], [0, a, 0], 0.012);
      nn.add('ice', crystalGeo(0.08, 0.32, 0.06), [x, y + 0.68, z], [0, a, 0]);
    }, FRONT + Math.PI / 4);
    b.cyl('gold', rb - 0.02, rb - 0.01, 0.035, 8, [0, y0 + 0.11, 0], [0, Math.PI / 8, 0]);
  }
  return cy + 0.17;
}

function frostTurret(root, L, topY) {
  const lift = L === 1 ? 0.55 : L === 2 ? 0.62 : 0.7;
  const t = root.child('turret', [0, topY + lift, 0]);
  const bob = t.child('bob');
  const spin = bob.child('spin');
  const cs = L === 1 ? 1.0 : L === 2 ? 1.15 : 1.3;
  spin.add('ice', crystalGeo(0.19 * cs, 0.5 * cs, 0.36 * cs), [0, 0, 0]);
  spin.add('ice', crystalGeo(0.09 * cs, 0.3 * cs, 0.12 * cs), [0.15 * cs, -0.1, 0.04], [0.1, 0, -0.55]);
  spin.add('ice', crystalGeo(0.08 * cs, 0.26 * cs, 0.1 * cs), [-0.13 * cs, -0.12, -0.06], [-0.2, 0, 0.6]);
  if (L >= 2) spin.add('ice', crystalGeo(0.07 * cs, 0.22 * cs, 0.1 * cs), [0.02, -0.14, -0.15 * cs], [-0.6, 0, 0]);
  // orbiting shards
  const orbit = bob.child('orbit');
  const nS = L === 1 ? 0 : L === 2 ? 3 : 5;
  ringOf(orbit, nS, 0.42 * cs, 0, (nn, x, y, z, a) => {
    nn.add('ice', crystalGeo(0.05, 0.14, 0.1), [x, y, z], [0.3, a, 0.2]);
  });
  if (L === 3) {
    const halo = bob.child('halo', [0, -0.05, 0], [0.25, 0, 0]);
    halo.add('gold', torusGeo(0.34 * cs, 0.022, 5, 28), [0, 0, 0], [Math.PI / 2, 0, 0]);
    ringOf(halo, 4, 0.34 * cs, 0, (nn, x, y, z) => nn.sph('glow', 0.035, [x, y, z]));
  }
  bob.child('muzzle', [0, 0.5 * cs, 0]);
  return { cs };
}

// ---------------------------------------------------------------------------
// Spec cache
// ---------------------------------------------------------------------------
const SPECS = new Map();
function getSpec(type, level) {
  const key = `${type}:${level}`;
  if (SPECS.has(key)) return SPECS.get(key);
  const root = new Node('towerRoot');
  let info;
  if (type === 'balista') info = balistaTurret(root, level, balistaBody(root, level));
  else if (type === 'cannon') info = cannonTurret(root, level, cannonBody(root, level));
  else if (type === 'catapult') info = catapultTurret(root, level, catapultBody(root, level));
  else info = frostTurret(root, level, frostBody(root, level));
  root.bake();
  const spec = { root, info };
  SPECS.set(key, spec);
  return spec;
}

// ---------------------------------------------------------------------------
// Animation controllers
// ---------------------------------------------------------------------------
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const STRING_GEO = () => cached('string', () => {
  const g = new THREE.CylinderGeometry(0.013, 0.013, 1, 5, 1, true);
  g.translate(0, 0.5, 0);
  return g;
});
const _Y = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

function setupAnim(type, refs, info, mats) {
  const flags = Object.keys(refs).filter((k) => /^flag[A-Z]$/.test(k)).map((k) => ({ a: refs[k], b: refs[k + '2'], ph: k.charCodeAt(4) * 1.7 }));
  const waveFlags = (t) => {
    for (const f of flags) {
      f.a.rotation.y = 0.5 + Math.sin(t * 2.6 + f.ph) * 0.22;
      if (f.b) f.b.rotation.y = Math.sin(t * 2.6 + f.ph - 1.2) * 0.45;
    }
  };
  let fireT = -1; // seconds since last fire, -1 = idle

  if (type === 'balista') {
    const { sy, bz, armLen } = info;
    const turret = refs.turret;
    const strings = [0, 1].map(() => {
      const m = new THREE.Mesh(STRING_GEO(), mats.string);
      m.castShadow = true;
      turret.add(m);
      return m;
    });
    const DRAWN = 0.55, SLACK = 0.18; // arm sweep-back angles
    const nockDrawn = -0.3 * info.s;
    const pivX = refs.armR.position.x, pivZ = refs.armR.position.z, pivY = refs.armR.position.y;
    const pose = (ang, nockZ, boltVis) => {
      refs.armL.rotation.y = -ang;
      refs.armR.rotation.y = ang;
      // the old bolt has flown; a fresh one drops in once the string is drawn
      refs.bolt.position.z = nockDrawn;
      refs.bolt.visible = boltVis > 0;
      refs.bolt.scale.setScalar(Math.max(0.001, boltVis));
      refs.bolt.position.y = sy + 0.1 + (1 - boltVis) * 0.25;
      const tipX = pivX + (armLen + 0.02) * Math.cos(ang);
      const tipZ = pivZ - (armLen + 0.02) * Math.sin(ang);
      for (let i = 0; i < 2; i++) {
        const sx = i ? 1 : -1;
        const m = strings[i];
        m.position.set(sx * tipX, pivY, tipZ);
        _d.set(-sx * tipX, sy + 0.1 - pivY, nockZ - tipZ);
        const len = _d.length();
        m.quaternion.setFromUnitVectors(_Y, _d.normalize());
        m.scale.set(1, len, 1);
      }
    };
    pose(DRAWN, nockDrawn, 1);
    const releasedZ = pivZ - (armLen + 0.02) * Math.sin(SLACK);
    return {
      fire() { fireT = 0; },
      update(dt, t) {
        waveFlags(t);
        if (fireT < 0) return;
        fireT += dt;
        const T = fireT;
        if (T < 0.07) {
          const k = easeOut(T / 0.07);
          pose(DRAWN + (SLACK - 0.1 - DRAWN) * k, nockDrawn + (releasedZ - nockDrawn) * k, 0);
        } else if (T < 0.25) {
          const k = (T - 0.07) / 0.18; // vibrate & settle
          const wob = Math.sin(k * 18) * (1 - k) * 0.08;
          pose(SLACK + wob, releasedZ, 0);
        } else if (T < 0.95) {
          const k = easeInOut((T - 0.25) / 0.7);
          pose(SLACK + (DRAWN - SLACK) * k, releasedZ + (nockDrawn - releasedZ) * k, clamp01((T - 0.8) / 0.15));
        } else {
          pose(DRAWN, nockDrawn, 1);
          fireT = -1;
        }
      },
    };
  }

  if (type === 'cannon') {
    const rec = refs.recoil, piv = refs.pitch;
    const baseRx = piv.rotation.x;
    return {
      fire() { fireT = 0; },
      update(dt, t) {
        waveFlags(t);
        if (fireT < 0) return;
        fireT += dt;
        const T = fireT;
        let z, kick;
        if (T < 0.06) { const k = easeOut(T / 0.06); z = -0.17 * k; kick = 0.12 * k; }
        else if (T < 0.6) { const k = easeInOut((T - 0.06) / 0.54); z = -0.17 * (1 - k); kick = 0.12 * (1 - k); }
        else { z = 0; kick = 0; fireT = -1; }
        rec.position.z = z;
        piv.rotation.x = baseRx - kick;
        const sq = T < 0.12 ? 1 + 0.12 * Math.sin((T / 0.12) * Math.PI) : 1;
        rec.scale.set(sq, sq, 1 / sq);
      },
    };
  }

  if (type === 'catapult') {
    const arm = refs.arm, rock = refs.rock;
    const REST = -1.32, FIRE = info.fireAng;
    arm.rotation.x = REST;
    return {
      fire() { fireT = 0; },
      update(dt, t) {
        waveFlags(t);
        if (fireT < 0) return;
        fireT += dt;
        const T = fireT;
        if (T < 0.1) {
          const k = (T / 0.1) ** 2;
          arm.rotation.x = REST + (FIRE + 0.08 - REST) * k;
          rock.visible = T < 0.08;
        } else if (T < 0.32) {
          const k = (T - 0.1) / 0.22;
          arm.rotation.x = FIRE + Math.cos(k * Math.PI * 2.5) * 0.08 * (1 - k);
          rock.visible = false;
        } else if (T < 1.15) {
          const k = easeInOut((T - 0.32) / 0.83);
          arm.rotation.x = FIRE + (REST - FIRE) * k;
          rock.visible = T > 0.95;
          rock.scale.setScalar(T > 0.95 ? clamp01((T - 0.95) / 0.15) : 1);
        } else {
          arm.rotation.x = REST;
          rock.visible = true;
          rock.scale.setScalar(1);
          fireT = -1;
        }
      },
    };
  }

  // frost
  const { bob, spin, orbit, halo } = refs;
  const base = mats.ice.emissiveIntensity;
  let spinV = 0.7;
  return {
    fire() { fireT = 0; },
    update(dt, t) {
      waveFlags(t);
      let flash = 0;
      if (fireT >= 0) {
        fireT += dt;
        flash = Math.max(0, 1 - fireT / 0.55);
        if (fireT > 0.6) fireT = -1;
      }
      bob.position.y = Math.sin(t * 1.8) * 0.05;
      spinV += ((0.7 + flash * 6) - spinV) * Math.min(1, dt * 6);
      spin.rotation.y += dt * spinV;
      orbit.rotation.y -= dt * (1.1 + flash * 4);
      orbit.position.y = Math.sin(t * 1.3) * 0.04;
      if (halo) halo.rotation.y += dt * 0.8;
      const sc = 1 + flash * flash * 0.22;
      spin.scale.setScalar(sc);
      mats.ice.emissiveIntensity = base + Math.sin(t * 2.4) * 0.12 + flash * 1.8;
      mats.glow.emissiveIntensity = 0.95 + Math.sin(t * 2.4 + 1) * 0.25 + flash * 1.6;
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const TYPES = ['balista', 'cannon', 'catapult', 'frost'];

export function createTowerModel(type, theme, level = 1) {
  if (!TYPES.includes(type)) type = 'balista';
  const group = new THREE.Group();
  group.name = `tower_${type}`;
  const ud = group.userData;
  ud.type = type;
  const perInstance = type === 'frost' ? frostMats() : { ice: null, glow: null };
  let themeRef = theme;
  let anim = null;
  let inner = null;

  const buildMats = () => {
    const m = { ...sharedMats(), ...themedMats(themeRef) };
    if (perInstance.ice) { m.ice = perInstance.ice; m.glow = perInstance.glow; }
    else { const f = frostMats(); m.ice = f.ice; m.glow = f.glow; }
    return m;
  };

  const build = (lvl) => {
    lvl = Math.max(1, Math.min(3, Math.round(lvl || 1)));
    const prevYaw = ud.turret ? ud.turret.rotation.y : 0;
    if (inner) group.remove(inner);
    const spec = getSpec(type, lvl);
    const mats = buildMats();
    const refs = {};
    inner = instantiate(spec.root, mats, refs);
    group.add(inner);
    refs.turret.rotation.y = prevYaw;
    ud.level = lvl;
    ud.turret = refs.turret;
    ud.muzzle = refs.muzzle;
    ud.materials = mats;
    ud.parts = refs;
    anim = setupAnim(type, refs, spec.info, mats);
  };

  ud.fire = () => { if (anim) anim.fire(); };
  ud.update = (dt = 0.016, t = performance.now() / 1000) => { if (anim) anim.update(Math.min(dt, 0.1), t); };
  ud.setLevel = (n) => { if (n !== ud.level) build(n); };
  ud._setTheme = (th) => { themeRef = th; };

  build(level);
  return group;
}

export function retintTowerModel(group, theme) {
  if (!group) return;
  const set = themedMats(theme);
  if (group.userData && group.userData._setTheme) group.userData._setTheme(theme);
  group.traverse((o) => {
    if (o.isMesh && o.material && o.material.userData && o.material.userData.themed) {
      const nm = set[o.material.userData.slot];
      if (nm) o.material = nm;
    }
  });
  if (group.userData && group.userData.materials) Object.assign(group.userData.materials, set);
}

export const TOWER_TYPES = TYPES;
