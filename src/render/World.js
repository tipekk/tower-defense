// World.js
// Environment art for the diorama: the floating-island base, the continuous
// lawn + dirt road ground, edge decor (trees, bushes, rocks, flowers, fences,
// lanterns, mushrooms) and the night-only ground fog / glow accents.
//
// Scene.js re-exports the public functions from here under their original
// names (createTile/createTileGrid/retintTileGrid, createDioramaBase/
// retintDioramaBase, createGroundClutter/retintGroundClutter), so main.js
// does not change.
//
// Design notes
// - The lawn is ONE mesh with a world-space shader (soft multi-octave color
//   variation + very faint cell lines on buildable cells only), and the road
//   is painted into the same shader from a tiny bilinear-filtered mask
//   texture, which gives soft, slightly irregular dirt edges for free. No
//   per-tile color = no checkerboard, no grout gaps.
// - Tiles stay as THREE.Group children of the grid group (same userData as
//   before) but now only carry an invisible hit box for raycasting; all the
//   visible geometry lives in a few merged meshes (draw calls stay ~10 for
//   the whole environment, good for phones).
// - All decor is merged into a single vertex-colored, flat-shaded mesh whose
//   colors are re-painted from the theme palette on day/night switch.
// - Everything is deterministic (seeded PRNG), same island on every load.

import * as THREE from 'three';
import { THEMES } from './Lights.js';

export const TILE_SIZE = 2;
const SURFACE_Y = 0.5;          // lawn / road top surface (towers + enemies sit at 0.5)
const ELEVATED_Y = 0.68;        // top of the raised stone plinth on 'elevated' tiles
const MASK_PAD = 2;             // extra mask cells around the 12x12 grid (road exit etc.)

// ---------------------------------------------------------------------------
// Palette resolution: THEMES[*].env holds every environment color; anything
// missing falls back to the day palette so old theme objects never crash.
// ---------------------------------------------------------------------------
function envOf(themeColors) {
  const base = THEMES.basic.env;
  return Object.assign({}, base, (themeColors && themeColors.env) || {});
}

function resolveTheme(arg) {
  if (arg && typeof arg === 'object') return arg;
  for (const key of Object.keys(THEMES)) {
    if (THEMES[key].stone === arg) return THEMES[key];
  }
  return THEMES.basic;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------
function hash2(x, z, seed = 0) {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Island outline: a squircle (superellipse) slightly larger than the grid,
// with a few low-frequency wobbles so it reads as natural ground, not a
// machined plate. Returns the radius at polar angle `ang`.
const ISLAND_A = 15.0;
const ISLAND_N = 6;
function islandRadius(ang) {
  const c = Math.abs(Math.cos(ang));
  const s = Math.abs(Math.sin(ang));
  const r = ISLAND_A / Math.pow(Math.pow(c, ISLAND_N) + Math.pow(s, ISLAND_N), 1 / ISLAND_N);
  const wobble = Math.sin(ang * 3 + 0.7) * 0.32 + Math.sin(ang * 7 + 2.1) * 0.2 + Math.sin(ang * 13 + 4.2) * 0.1;
  return r + wobble;
}
function insideIsland(x, z, margin = 0) {
  return Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) - margin;
}

// ---------------------------------------------------------------------------
// Merged, vertex-colored geometry builder. Every part remembers its palette
// "role" so the whole merged mesh can be re-painted on theme switch.
// ---------------------------------------------------------------------------
class MergeBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.parts = [];
  }

  add(geo, matrix, role, shade = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    g.computeVertexNormals(); // non-indexed -> flat facets (low-poly look)
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const start = this.pos.length / 3;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nrm.push(n[i]); }
    this.parts.push({ role, start, count: p.length / 3, shade });
    g.dispose();
  }

  // Raw triangles (already in world space), e.g. the cliff.
  addTris(positions, role, shade = 1) {
    const start = this.pos.length / 3;
    for (let i = 0; i < positions.length; i++) this.pos.push(positions[i]);
    // flat normals per triangle
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      const ux = positions[i + 3] - ax, uy = positions[i + 4] - ay, uz = positions[i + 5] - az;
      const vx = positions[i + 6] - ax, vy = positions[i + 7] - ay, vz = positions[i + 8] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) this.nrm.push(nx, ny, nz);
    }
    this.parts.push({ role, start, count: positions.length / 3, shade });
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.pos.length), 3));
    geo.computeBoundingSphere();
    geo.userData.parts = this.parts;
    return geo;
  }
}

const _c = new THREE.Color();
const FLAT_ROLES = new Set(['moss', 'grassLip', 'dirtLip']);
// Paint per-part colors; every triangle gets a tiny deterministic brightness
// jitter so flat-shaded facets read as hand-painted low-poly, not plastic.
function paintMerged(geo, palette) {
  const col = geo.attributes.color;
  const arr = col.array;
  for (const part of geo.userData.parts) {
    const hex = palette[part.role];
    _c.set(hex === undefined ? 0xff00ff : hex);
    const r = _c.r * part.shade, g = _c.g * part.shade, b = _c.b * part.shade;
    for (let v = part.start; v < part.start + part.count; v += 3) {
      const j = FLAT_ROLES.has(part.role) ? 1 : 0.93 + hash2(v, part.start, 3) * 0.12;
      for (let k = 0; k < 3; k++) {
        const o = (v + k) * 3;
        arr[o] = r * j; arr[o + 1] = g * j; arr[o + 2] = b * j;
      }
    }
  }
  col.needsUpdate = true;
}

// Shared primitive geometries (unit sized; scaled by the matrices).
const PRIM = {
  cone7: new THREE.ConeGeometry(1, 1, 7),
  cone5: new THREE.ConeGeometry(1, 1, 5),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dode: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  oct: new THREE.OctahedronGeometry(1, 0),
  frustum4: new THREE.CylinderGeometry(Math.SQRT1_2 * 0.92, Math.SQRT1_2, 1, 4, 1),
  disc: new THREE.CircleGeometry(1, 10),
};

// Rock geometry: dodecahedron with positional jitter (same position -> same
// offset, so faces stay watertight). A few variants, picked per rock.
const ROCK_VARIANTS = [0, 1, 2, 3].map((seed) => {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.78 + hash2(Math.round(x * 100), Math.round(y * 100) + Math.round(z * 37), seed + 5) * 0.42;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
});

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function mtx(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_v, _q, _s);
}

// ---------------------------------------------------------------------------
// Decor pieces (all add into a MergeBuilder; y = ground height at that spot)
// ---------------------------------------------------------------------------
function addPine(b, x, z, s, rng, y = SURFACE_Y) {
  const ry = rng() * Math.PI;
  b.add(PRIM.cyl6, mtx(x, y + 0.3 * s, z, 0.13 * s, 0.6 * s, 0.13 * s, ry), 'trunk');
  const tiers = [
    { r: 0.78, h: 1.0, y: 0.95 },
    { r: 0.6, h: 0.85, y: 1.45 },
    { r: 0.4, h: 0.7, y: 1.9 },
  ];
  tiers.forEach((t, i) => {
    b.add(PRIM.cone7, mtx(x, y + t.y * s, z, t.r * s, t.h * s, t.r * s, ry + i * 0.4),
      i === 1 ? 'pineLight' : 'pine', 0.96 + rng() * 0.08);
  });
}

function addRoundTree(b, x, z, s, rng, y = SURFACE_Y) {
  const ry = rng() * Math.PI;
  b.add(PRIM.cyl6, mtx(x, y + 0.45 * s, z, 0.12 * s, 0.9 * s, 0.12 * s, ry, (rng() - 0.5) * 0.12), 'trunk');
  b.add(PRIM.ico1, mtx(x, y + 1.35 * s, z, 0.72 * s, 0.62 * s, 0.72 * s, ry), 'foliage');
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = ry + (i / n) * Math.PI * 2;
    const r = (0.36 + rng() * 0.14) * s;
    b.add(PRIM.ico1, mtx(x + Math.cos(a) * 0.42 * s, y + (1.15 + rng() * 0.35) * s, z + Math.sin(a) * 0.42 * s, r, r * 0.88, r, a),
      i % 2 ? 'foliage' : 'foliageLight');
  }
}

function addBush(b, x, z, s, rng, y = SURFACE_Y) {
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.22 * s;
    const r = (i === 0 ? 0.36 : 0.26 + rng() * 0.08) * s;
    b.add(PRIM.ico1, mtx(x + Math.cos(a) * d, y + r * 0.62, z + Math.sin(a) * d, r, r * 0.8, r, a),
      i === 1 ? 'bushLight' : 'bush', 0.95 + rng() * 0.1);
  }
}

function addRock(b, x, z, s, rng, y = SURFACE_Y, role = null) {
  const g = ROCK_VARIANTS[Math.floor(rng() * ROCK_VARIANTS.length)];
  const sy = 0.55 + rng() * 0.3;
  b.add(g, mtx(x, y + s * sy * 0.45, z, s, s * sy, s * (0.8 + rng() * 0.3), rng() * Math.PI, (rng() - 0.5) * 0.3),
    role || (rng() > 0.5 ? 'rock' : 'rockLight'));
}

function addTuft(b, x, z, s, rng, y = SURFACE_Y) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng();
    b.add(PRIM.cone4, mtx(x + Math.cos(a) * 0.05 * s, y + 0.11 * s, z + Math.sin(a) * 0.05 * s,
      0.035 * s, 0.26 * s * (0.8 + rng() * 0.4), 0.035 * s, a, Math.cos(a) * 0.35, Math.sin(a) * 0.35), 'tuft');
  }
}

const FLOWER_ROLES = ['flowerA', 'flowerB', 'flowerC'];
function addFlowers(b, x, z, s, rng, y = SURFACE_Y) {
  const role = FLOWER_ROLES[Math.floor(rng() * FLOWER_ROLES.length)];
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * 0.32 * s;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
    const h = (0.1 + rng() * 0.08) * s;
    b.add(PRIM.cyl6, mtx(fx, y + h / 2, fz, 0.012, h, 0.012), 'tuft');
    b.add(PRIM.oct, mtx(fx, y + h, fz, 0.085 * s, 0.055 * s, 0.085 * s, rng()), rng() > 0.85 ? 'flowerB' : role);
  }
}

function addMushrooms(b, x, z, s, rng, y = SURFACE_Y) {
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.14 + rng() * 0.12;
    const mx = x + Math.cos(a) * d, mz = z + Math.sin(a) * d;
    const h = (0.12 + rng() * 0.12) * s * (i === 0 ? 1.3 : 1);
    const r = (0.07 + rng() * 0.04) * s * (i === 0 ? 1.3 : 1);
    b.add(PRIM.cyl6, mtx(mx, y + h / 2, mz, r * 0.38, h, r * 0.38), 'mushStem');
    b.add(PRIM.ico1, mtx(mx, y + h, mz, r, r * 0.55, r), 'mushCap');
  }
}

function addFence(b, x0, z0, x1, z1, rng, y = SURFACE_Y) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 0.95) + 1);
  const ang = Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
    const h = 0.55 + rng() * 0.08;
    b.add(PRIM.box, mtx(px, y + h / 2, pz, 0.11, h, 0.11, -ang + (rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.08), 'woodDark');
    b.add(PRIM.cone4, mtx(px, y + h + 0.04, pz, 0.08, 0.08, 0.08, -ang + Math.PI / 4), 'woodDark');
  }
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  b.add(PRIM.box, mtx(mx, y + 0.38, mz, len, 0.07, 0.05, -ang, 0, 0.01), 'wood');
  b.add(PRIM.box, mtx(mx, y + 0.2, mz, len, 0.07, 0.05, -ang, 0, -0.01), 'wood');
}

// Lantern post; returns the glass position (for the glow mesh / halo).
function addLantern(b, glow, x, z, y = SURFACE_Y) {
  b.add(PRIM.box, mtx(x, y + 0.04, z, 0.3, 0.08, 0.3), 'rockLight');
  b.add(PRIM.box, mtx(x, y + 0.62, z, 0.1, 1.2, 0.1), 'woodDark');
  b.add(PRIM.box, mtx(x, y + 1.24, z, 0.3, 0.05, 0.3), 'metal');
  b.add(PRIM.box, mtx(x, y + 1.5, z, 0.3, 0.04, 0.3), 'metal');
  b.add(PRIM.cone4, mtx(x, y + 1.6, z, 0.25, 0.18, 0.25, Math.PI / 4), 'metal');
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.add(PRIM.box, mtx(x + dx * 0.12, y + 1.37, z + dz * 0.12, 0.03, 0.24, 0.03), 'metal');
  }
  glow.add(PRIM.box, mtx(x, y + 1.37, z, 0.18, 0.22, 0.18), 'glow');
  return new THREE.Vector3(x, y + 1.37, z);
}

// ---------------------------------------------------------------------------
// Ground material: one continuous lawn + road, painted in world space.
// ---------------------------------------------------------------------------
const GROUND_GLSL_COMMON = /* glsl */`
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uGrassC;
uniform vec3 uDirt;
uniform vec3 uDirtDark;
uniform sampler2D uMask;
uniform vec2 uMaskOrigin;
uniform float uMaskSize;
uniform float uGridHalf;
uniform float uGridLine;
uniform vec3 uToxic;
uniform float uToxicAmt;
varying vec3 vGroundW;
float tdHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tdNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tdHash(i), tdHash(i + vec2(1.0, 0.0)), u.x),
             mix(tdHash(i + vec2(0.0, 1.0)), tdHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const GROUND_GLSL_COLOR = /* glsl */`
{
  vec2 p = vGroundW.xz;
  float n1 = tdNoise(p * 0.11 + 3.1) * 0.65 + tdNoise(p * 0.23 + 9.7) * 0.35;
  float n2 = tdNoise(p * 0.42 + 17.3);
  float n3 = tdNoise(p * 2.6 + 41.0);
  float n4 = tdNoise(p * 7.0);
  // lawn: big soft patches + gentle mid-frequency clumps + fine grain
  vec3 g = mix(uGrassA, uGrassB, smoothstep(0.15, 0.85, n1));
  g = mix(g, uGrassC, smoothstep(0.45, 1.0, n2) * 0.45);
  g *= 0.96 + 0.05 * n3 + 0.03 * n4;
  // mask: r = road, g = buildable cell
  vec2 muv = (p - uMaskOrigin) / uMaskSize;
  vec4 m = texture2D(uMask, muv);
  float wob = (tdNoise(p * 1.4 + 7.0) - 0.5) * 0.28 + (n3 - 0.5) * 0.12;
  float rv = m.r + wob;
  float road = smoothstep(0.44, 0.56, rv);
  // very faint cell hint on buildable cells only (thin soft lines)
  vec2 cell = abs(fract(p / 2.0) - 0.5);
  float edge = max(cell.x, cell.y);
  float inGrid = 1.0 - step(uGridHalf, max(abs(p.x), abs(p.y)));
  float line = smoothstep(0.455, 0.5, edge) * inGrid * smoothstep(0.6, 0.95, m.g);
  g *= 1.0 - line * uGridLine;
  // grass gets a little darker right at the road verge (soft AO), dirt
  // gets a slightly darker rim + tracks down the middle
  float verge = smoothstep(0.18, 0.44, rv) * (1.0 - road);
  g *= 1.0 - verge * 0.16;
  vec3 d = mix(uDirtDark, uDirt, smoothstep(0.2, 0.8, tdNoise(p * 0.8 + 5.0)));
  d *= 0.93 + 0.08 * n3 + 0.05 * n4;
  float rim = 1.0 - smoothstep(0.56, 0.8, rv);
  d *= 1.0 - rim * 0.14;
  vec3 col = mix(g, d, road);
  // night: faint toxic glow pooling in low lawn patches (never on the road)
  col += uToxic * uToxicAmt * smoothstep(0.62, 0.9, n1) * (1.0 - road) * 0.25;
  diffuseColor.rgb = col;
}
`;

function createGroundMaterial(env, maskTex, gridHalf) {
  const uniforms = {
    uGrassA: { value: new THREE.Color(env.grassA) },
    uGrassB: { value: new THREE.Color(env.grassB) },
    uGrassC: { value: new THREE.Color(env.grassC) },
    uDirt: { value: new THREE.Color(env.dirt) },
    uDirtDark: { value: new THREE.Color(env.dirtDark) },
    uMask: { value: maskTex },
    uMaskOrigin: { value: new THREE.Vector2() },
    uMaskSize: { value: 1 },
    uGridHalf: { value: gridHalf },
    uGridLine: { value: env.gridLine },
    uToxic: { value: new THREE.Color(env.toxic) },
    uToxicAmt: { value: env.toxicAmt },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_GLSL_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_GLSL_COLOR);
  };
  mat.customProgramCacheKey = () => 'td-ground-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

function retintGroundMaterial(mat, env) {
  const u = mat.userData.uniforms;
  u.uGrassA.value.set(env.grassA);
  u.uGrassB.value.set(env.grassB);
  u.uGrassC.value.set(env.grassC);
  u.uDirt.value.set(env.dirt);
  u.uDirtDark.value.set(env.dirtDark);
  u.uGridLine.value = env.gridLine;
  u.uToxic.value.set(env.toxic);
  u.uToxicAmt.value = env.toxicAmt;
}

// Top surface polygon of the island (same outline the cliff uses).
const OUTLINE_SEGMENTS = 120;
function outlinePoints() {
  const pts = [];
  for (let i = 0; i < OUTLINE_SEGMENTS; i++) {
    const a = (i / OUTLINE_SEGMENTS) * Math.PI * 2;
    const r = islandRadius(a);
    pts.push({ a, x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return pts;
}

function createIslandTopGeometry() {
  const shape = new THREE.Shape();
  const pts = outlinePoints();
  pts.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, SURFACE_Y, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
const HIT_GEO = new THREE.BoxGeometry(TILE_SIZE, 0.24, TILE_SIZE);
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });

/**
 * One logical tile: an invisible (but raycastable) hit box plus the userData
 * InputController/main.js rely on. When called standalone (outside
 * createTileGrid) it also gets a small visible top so it still renders.
 */
export function createTile(themeColors, kind = 'grass', x = 0, z = 0, opts = {}) {
  const group = new THREE.Group();
  const topY = kind === 'elevated' ? ELEVATED_Y : SURFACE_Y;
  const hit = new THREE.Mesh(HIT_GEO, HIT_MAT);
  hit.position.y = topY - 0.12;
  group.add(hit);
  if (opts.standalone !== false && !opts.hitOnly) {
    const env = envOf(themeColors);
    const col = kind === 'road' ? env.dirt : kind === 'decor' ? env.rock : env.grassB;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(TILE_SIZE, 0.5, TILE_SIZE),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 })
    );
    top.position.y = topY - 0.25;
    top.receiveShadow = true;
    group.add(top);
    group.userData.refs = { hit, top };
  } else {
    group.userData.refs = { hit };
  }
  group.userData.kind = kind;
  group.userData.isRoad = kind === 'road';
  group.userData.isBuildable = kind === 'grass' || kind === 'elevated';
  group.userData.topSurfaceY = topY;
  return group;
}

function noRaycast() {}

/**
 * @param {number} gridSize square grid side length (tile count)
 * @param {object} themeColors current theme palette
 * @param {Array<[number,number]>} roadPath back-compat list of [x,z] road cells
 * @param {(x:number,z:number)=>string} [kindAt] 'grass'|'road'|'elevated'|'decor'
 */
export function createTileGrid(gridSize, themeColors, roadPath = [], kindAt = null) {
  const group = new THREE.Group();
  const env = envOf(themeColors);
  const offset = (gridSize - 1) / 2;
  const kindOf = (x, z) => {
    if (kindAt) return kindAt(x, z);
    return roadPath.some(([rx, rz]) => rx === x && rz === z) ? 'road' : 'grass';
  };

  // --- logical, raycastable tiles (invisible hit boxes) ---
  const kinds = [];
  for (let x = 0; x < gridSize; x++) {
    kinds[x] = [];
    for (let z = 0; z < gridSize; z++) {
      const kind = kindOf(x, z);
      kinds[x][z] = kind;
      const tile = createTile(themeColors, kind, x, z, { hitOnly: true });
      tile.position.set((x - offset) * TILE_SIZE, 0, (z - offset) * TILE_SIZE);
      tile.userData.gridX = x;
      tile.userData.gridZ = z;
      tile.userData.centeredX = x - offset;
      tile.userData.centeredZ = z - offset;
      group.add(tile);
    }
  }

  // --- road / buildable mask (bilinear-filtered -> soft road edges) ---
  const roadCells = computeRoadCells(gridSize, kinds);
  const M = gridSize + MASK_PAD * 2;
  const data = new Uint8Array(M * M * 4);
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const gx = i - MASK_PAD, gz = j - MASK_PAD;
      const o = (j * M + i) * 4;
      const inGrid = gx >= 0 && gz >= 0 && gx < gridSize && gz < gridSize;
      const kind = inGrid ? kinds[gx][gz] : null;
      data[o] = roadCells.has(`${gx},${gz}`) ? 255 : 0;
      data[o + 1] = kind === 'grass' ? 255 : 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const maskTex = new THREE.DataTexture(data, M, M, THREE.RGBAFormat);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskTex.needsUpdate = true;

  const gridHalf = (gridSize * TILE_SIZE) / 2;
  const groundMat = createGroundMaterial(env, maskTex, gridHalf);
  groundMat.userData.uniforms.uMaskOrigin.value.set(-(offset + MASK_PAD + 0.5) * TILE_SIZE, -(offset + MASK_PAD + 0.5) * TILE_SIZE);
  groundMat.userData.uniforms.uMaskSize.value = M * TILE_SIZE;

  const ground = new THREE.Mesh(createIslandTopGeometry(), groundMat);
  ground.receiveShadow = true;
  ground.raycast = noRaycast;
  ground.name = 'td-ground';
  group.add(ground);

  // --- tile-bound props: elevated plinths, decor-tile rocks, road cobbles ---
  const b = new MergeBuilder();
  const rng = mulberry32(1337);
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const wx = (x - offset) * TILE_SIZE, wz = (z - offset) * TILE_SIZE;
      const kind = kinds[x][z];
      if (kind === 'elevated') addElevatedPlinth(b, wx, wz, rng);
      if (kind === 'decor') addDecorTile(b, wx, wz, rng);
    }
  }
  addRoadStones(b, roadCells, offset, rng);
  const propGeo = b.build();
  paintMerged(propGeo, env);
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  const props = new THREE.Mesh(propGeo, propMat);
  props.castShadow = true;
  props.receiveShadow = true;
  props.raycast = noRaycast;
  props.name = 'td-tile-props';
  group.add(props);

  group.userData.world = { groundMat, propGeo };
  return group;
}

/** Recolor the lawn/road shader + tile props when the theme changes. */
export function retintTileGrid(gridGroup, themeColors) {
  const env = envOf(themeColors);
  const w = gridGroup.userData.world;
  if (!w) return;
  retintGroundMaterial(w.groundMat, env);
  paintMerged(w.propGeo, env);
}

// Road cells in grid coords, plus the short run-off from the gate tile to
// the island edge (so the road leaves the board instead of dead-ending).
function computeRoadCells(gridSize, kinds) {
  const cells = new Set();
  const list = [];
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      if (kinds[x][z] === 'road') { cells.add(`${x},${z}`); list.push([x, z]); }
    }
  }
  // Extend any road cell touching the grid boundary outward to the edge.
  for (const [x, z] of list) {
    const dirs = [];
    if (x === 0) dirs.push([-1, 0]);
    if (z === 0) dirs.push([0, -1]);
    if (x === gridSize - 1) dirs.push([1, 0]);
    if (z === gridSize - 1) dirs.push([0, 1]);
    for (const [dx, dz] of dirs) {
      // only for a road "end" (one road neighbor) so a road running along
      // the edge doesn't spill sideways
      let nb = 0;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cells.has(`${x + ax},${z + az}`)) nb++;
      if (nb > 1) continue;
      for (let k = 1; k <= MASK_PAD; k++) cells.add(`${x + dx * k},${z + dz * k}`);
    }
  }
  return cells;
}

function addElevatedPlinth(b, wx, wz, rng) {
  // Two-step carved stone platform with a mossy turf cap: reads clearly as
  // "high ground" (range bonus) without hiding the tower that sits on it.
  const y0 = SURFACE_Y - 0.1;
  const step1 = SURFACE_Y + 0.07;
  const capY = ELEVATED_Y - 0.03;
  b.add(PRIM.frustum4, mtx(wx, (y0 + step1) / 2, wz, 2.0, step1 - y0, 2.0, Math.PI / 4), 'rock');
  b.add(PRIM.frustum4, mtx(wx, (step1 + capY) / 2, wz, 1.8, capY - step1, 1.8, Math.PI / 4), 'rockLight');
  b.add(PRIM.frustum4, mtx(wx, capY + 0.015, wz, 1.62, 0.03, 1.62, Math.PI / 4), 'moss');
  // corner capstones
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.add(PRIM.box, mtx(wx + dx * 0.78, capY + 0.03, wz + dz * 0.78, 0.26, 0.1, 0.26, (rng() - 0.5) * 0.2), 'rockLight');
  }
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + 0.4 + rng() * 0.5;
    const r = 1.05 + rng() * 0.1;
    addRock(b, wx + Math.cos(a) * r, wz + Math.sin(a) * r, 0.1 + rng() * 0.07, rng, SURFACE_Y - 0.03);
  }
}

function addDecorTile(b, wx, wz, rng) {
  // Rocky outcrop with a small bush and a stump -- clearly "can't build here".
  addRock(b, wx - 0.3, wz + 0.1, 0.62, rng, SURFACE_Y - 0.05, 'rock');
  addRock(b, wx + 0.42, wz - 0.3, 0.42, rng, SURFACE_Y - 0.04, 'rockLight');
  addRock(b, wx + 0.35, wz + 0.5, 0.26, rng, SURFACE_Y - 0.03, 'rock');
  addRock(b, wx - 0.55, wz - 0.55, 0.2, rng, SURFACE_Y - 0.02, 'rockLight');
  addBush(b, wx - 0.6, wz + 0.62, 0.8, rng);
  addTuft(b, wx + 0.7, wz + 0.1, 1.2, rng);
  addTuft(b, wx - 0.1, wz - 0.75, 1.0, rng);
}

function addRoadStones(b, roadCells, offset, rng) {
  const has = (x, z) => roadCells.has(`${x},${z}`);
  for (const key of roadCells) {
    const [x, z] = key.split(',').map(Number);
    const wx = (x - offset) * TILE_SIZE, wz = (z - offset) * TILE_SIZE;
    if (!insideIsland(wx, wz, 0.6)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (has(x + dx, z + dz)) continue;
      // stones along this verge
      const n = 4;
      for (let i = 0; i < n; i++) {
        if (rng() < 0.3) continue;
        const t = (i + 0.5) / n - 0.5 + (rng() - 0.5) * 0.18;
        const inset = 0.86 + rng() * 0.12;
        const px = wx + (dx !== 0 ? dx * inset : t * TILE_SIZE);
        const pz = wz + (dz !== 0 ? dz * inset : t * TILE_SIZE);
        if (!insideIsland(px, pz, 0.4)) continue;
        const s = 0.1 + rng() * 0.09;
        const g = ROCK_VARIANTS[Math.floor(rng() * ROCK_VARIANTS.length)];
        b.add(g, mtx(px, SURFACE_Y + 0.0, pz, s * 1.3, s * 0.55, s, rng() * Math.PI), rng() > 0.4 ? 'cobble' : 'cobbleDark');
      }
    }
    // pebbles inside the road
    for (let i = 0; i < 2; i++) {
      if (rng() < 0.45) continue;
      const px = wx + (rng() - 0.5) * 1.4, pz = wz + (rng() - 0.5) * 1.4;
      const s = 0.04 + rng() * 0.04;
      b.add(ROCK_VARIANTS[i % 4], mtx(px, SURFACE_Y, pz, s, s * 0.6, s, rng() * 3), 'cobbleDark');
    }
  }
}

// ---------------------------------------------------------------------------
// Island base: floating earth/rock island under the lawn.
// ---------------------------------------------------------------------------
const CLIFF_RINGS = [
  { y: SURFACE_Y, inset: 0, jitter: 0 },
  { y: 0.22, inset: -0.1, jitter: 0.05 },
  { y: -0.25, inset: 0.05, jitter: 0.12 },
  { y: -1.1, inset: 0.2, jitter: 0.22 },
  { y: -2.0, inset: 0.55, jitter: 0.3 },
  { y: -2.9, inset: 1.4, jitter: 0.4 },
  { y: -4.0, inset: 3.2, jitter: 0.5 },
  { y: -5.2, inset: 6.0, jitter: 0.5 },
  { y: -6.3, inset: 9.5, jitter: 0.4 },
];
const CLIFF_BAND_ROLES = ['grassLip', 'earth', 'earth', 'earthDark', 'rock', 'rock', 'rockDark', 'rockDark'];
const CLIFF_TIP_Y = -7.4;

export function createDioramaBase(gridSize, stoneColorHex) {
  const theme = resolveTheme(stoneColorHex);
  const env = envOf(theme);
  const group = new THREE.Group();
  const b = new MergeBuilder();
  const N = 72;
  const ring = (j, i) => {
    const a = ((i % N) / N) * Math.PI * 2;
    const R = CLIFF_RINGS[j];
    const jit = R.jitter;
    const ii = i % N;
    const r = Math.max(0.4, islandRadius(a) - R.inset + (hash2(ii, j, 7) - 0.5) * jit * 2);
    const y = R.y + (j > 0 ? (hash2(ii, j, 9) - 0.5) * jit * 0.8 : 0);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  // Pre-compute ring verts.
  const V = CLIFF_RINGS.map((_, j) => Array.from({ length: N }, (_, i) => ring(j, i)));
  const byRole = {};
  const push = (role, tri) => { (byRole[role] = byRole[role] || []).push(...tri[0], ...tri[1], ...tri[2]); };
  for (let j = 0; j < CLIFF_RINGS.length - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a0 = V[j][i], a1 = V[j][(i + 1) % N], b0 = V[j + 1][i], b1 = V[j + 1][(i + 1) % N];
      let role = CLIFF_BAND_ROLES[j];
      // occasional rock outcrops in the earth band / earth streaks in rock
      const hsh = hash2(i, j, 21);
      if (role === 'earth' && hsh > 0.82) role = 'earthDark';
      else if (role === 'earthDark' && hsh > 0.7) role = 'rock';
      else if (role === 'rock' && hsh > 0.85) role = 'rockDark';
      // road run-off: dirt on the grass lip where the road leaves the island
      if (j === 0) {
        const mx = (a0[0] + a1[0]) / 2, mz = (a0[2] + a1[2]) / 2;
        if (roadExitAt(mx, mz)) role = 'dirtLip';
      }
      // winding order: outward-facing
      push(role, [a0, b0, a1]);
      push(role, [a1, b0, b1]);
    }
  }
  const last = V[V.length - 1];
  for (let i = 0; i < N; i++) {
    push('rockDark', [last[i], [0, CLIFF_TIP_Y, 0], last[(i + 1) % N]]);
  }
  for (const role of Object.keys(byRole)) b.addTris(byRole[role], role);

  // Hanging rocks/roots under the rim for a richer silhouette.
  const rng = mulberry32(99);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = islandRadius(a) - 1.2 - rng() * 1.5;
    addRock(b, Math.cos(a) * r, Math.sin(a) * r, 0.5 + rng() * 0.6, rng, -2.6 - rng() * 1.6, rng() > 0.5 ? 'rock' : 'rockDark');
  }

  const geo = b.build();
  paintMerged(geo, env);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const cliff = new THREE.Mesh(geo, mat);
  cliff.castShadow = true;
  cliff.receiveShadow = true;
  cliff.raycast = noRaycast;
  cliff.name = 'td-island-cliff';
  group.add(cliff);

  group.userData.refs = { cliff, geo, mat };
  return group;
}

// Road exit area (grid tile x=11 continuing past z=11) -- matches
// computeRoadCells for map_01; generic check against the stored road set
// would need the grid, so keep a cheap geometric test.
let ROAD_EXITS = [{ x: 11, z: 13.5, w: 1.15 }];
function roadExitAt(x, z) {
  return ROAD_EXITS.some((e) => Math.abs(x - e.x) < e.w && z > 12.3);
}

export function retintDioramaBase(base, stoneColorHex) {
  const env = envOf(resolveTheme(stoneColorHex));
  paintMerged(base.userData.refs.geo, env);
}

// ---------------------------------------------------------------------------
// Ground clutter + edge decor: lawn tufts/flowers on the board, and trees,
// bushes, rocks, flowers, fences, lanterns and mushrooms around the edge
// OUTSIDE the playable grid. Night-only: glow halos + drifting ground fog.
// ---------------------------------------------------------------------------
export function createGroundClutter(gridSize, themeColors, kindAt) {
  const env = envOf(themeColors);
  const group = new THREE.Group();
  const offset = (gridSize - 1) / 2;
  const half = (gridSize * TILE_SIZE) / 2;
  const rng = mulberry32(4242);
  const b = new MergeBuilder();
  const glowB = new MergeBuilder();
  const glowPoints = [];

  // Occupancy (keeps decor from overlapping)
  const taken = [];
  const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  const take = (x, z, r) => taken.push({ x, z, r });

  // Road run-off strip outside the grid must stay clear.
  const onRoadExit = (x, z, pad = 0.4) => roadExitAt(x, z) || (Math.abs(x - 11) < 1.0 + pad && z > half - 0.2);

  // --- 1. On-board lawn detail: sparse tufts + tiny flowers near tile
  // corners (never in a tile's center where a tower sits) ---
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const kind = kindAt(x, z);
      if (kind !== 'grass') continue;
      const wx = (x - offset) * TILE_SIZE, wz = (z - offset) * TILE_SIZE;
      const roll = hash2(x, z, 71);
      if (roll < 0.38) {
        const cx = hash2(x, z, 72) > 0.5 ? 1 : -1, cz = hash2(x, z, 73) > 0.5 ? 1 : -1;
        const px = wx + cx * (0.62 + hash2(x, z, 74) * 0.25), pz = wz + cz * (0.62 + hash2(x, z, 75) * 0.25);
        if (roll < 0.1) addFlowers(b, px, pz, 0.55, rng);
        else addTuft(b, px, pz, 0.9 + hash2(x, z, 76) * 0.4, rng);
      }
    }
  }

  // --- 2. Fixed set pieces: lanterns flanking the road exit + front corners,
  // fences along the two camera-facing edges ---
  const lanternSpots = [[9.45, 12.9], [12.55, 12.9], [-13.3, 13.0], [13.1, -13.2]];
  for (const [x, z] of lanternSpots) {
    if (!insideIsland(x, z, 0.5)) continue;
    glowPoints.push(addLantern(b, glowB, x, z));
    take(x, z, 0.5);
  }
  const fences = [
    [[-9.5, 13.0], [-3.0, 13.25]],
    [[1.0, 13.1], [7.4, 13.0]],
    [[13.15, -8.5], [13.25, -2.5]],
    [[13.1, 1.5], [13.2, 7.5]],
  ];
  for (const [[x0, z0], [x1, z1]] of fences) {
    addFence(b, x0, z0, x1, z1, rng);
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.8);
    for (let i = 0; i <= n; i++) take(x0 + (x1 - x0) * (i / n), z0 + (z1 - z0) * (i / n), 0.3);
  }

  // --- 3. Scattered edge decor (jittered grid over the margin ring) ---
  const drng = mulberry32(777);
  const mushroomSpots = [];
  const STEP = 0.95;
  for (let gx = -19; gx <= 19; gx += STEP) {
    for (let gz = -19; gz <= 19; gz += STEP) {
      const x = gx + (drng() - 0.5) * STEP * 0.9;
      const z = gz + (drng() - 0.5) * STEP * 0.9;
      if (Math.max(Math.abs(x), Math.abs(z)) < half + 0.45) continue;
      if (!insideIsland(x, z, 0.55)) continue;
      if (onRoadExit(x, z)) continue;
      // "back" = away from the default camera (+x,+z); tall trees only there
      // and on the far sides, so nothing tall hides the board.
      const front = x + z;
      const roll = drng();
      const back = front < 3;
      // per-zone probabilities: back edges = forest, front edges = low stuff
      const pTree = back ? 0.5 : 0;
      const pBush = pTree + (back ? 0.14 : 0.36);
      const pRock = pBush + (back ? 0.1 : 0.14);
      const pFlow = pRock + (back ? 0.1 : 0.14);
      const pMush = pFlow + 0.05;
      let placed = false;
      if (roll < pTree) {
        const s = 0.85 + drng() * 0.45;
        const r = 0.75 * s;
        if (free(x, z, r)) {
          if (drng() < 0.55) addPine(b, x, z, s * (front < -8 ? 1.15 : 0.95), drng);
          else addRoundTree(b, x, z, s, drng);
          take(x, z, r);
          placed = true;
        }
      } else if (roll < pBush) {
        const s = back ? 0.85 + drng() * 0.45 : 0.7 + drng() * 0.35;
        if (free(x, z, 0.4 * s)) { addBush(b, x, z, s, drng); take(x, z, 0.4 * s); placed = true; }
      } else if (roll < pRock) {
        const s = 0.22 + drng() * 0.35;
        if (free(x, z, s)) { addRock(b, x, z, s, drng); take(x, z, s); placed = true; }
      } else if (roll < pFlow) {
        if (free(x, z, 0.3)) { addFlowers(b, x, z, 0.9, drng); take(x, z, 0.3); placed = true; }
      } else if (roll < pMush) {
        if (free(x, z, 0.3)) { mushroomSpots.push([x, z]); addMushrooms(b, x, z, 1.1, drng); take(x, z, 0.3); placed = true; }
      }
      if (!placed && drng() < 0.6) addTuft(b, x + (drng() - 0.5) * 0.4, z + (drng() - 0.5) * 0.4, 1 + drng() * 0.5, drng);
    }
  }

  const geo = b.build();
  paintMerged(geo, env);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true });
  const decor = new THREE.Mesh(geo, mat);
  decor.castShadow = true;
  decor.receiveShadow = true;
  decor.raycast = noRaycast;
  decor.name = 'td-edge-decor';
  group.add(decor);

  // Lantern glass: unlit, colored per theme (warm by day, toxic green at night).
  const glowGeo = glowB.build();
  paintMerged(glowGeo, env);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.raycast = noRaycast;
  group.add(glow);

  // Night-only: soft additive halos on lanterns + toxic mushrooms, and fog.
  const night = new THREE.Group();
  night.name = 'td-night-fx';
  const haloTex = makeRadialTexture();
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex, color: env.toxic, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  for (const p of glowPoints) {
    const s = new THREE.Sprite(haloMat);
    s.position.copy(p);
    s.scale.setScalar(2.2);
    night.add(s);
  }
  const mushHaloMat = haloMat.clone();
  mushHaloMat.opacity = 0.35;
  for (const [x, z] of mushroomSpots) {
    const s = new THREE.Sprite(mushHaloMat);
    s.position.set(x, SURFACE_Y + 0.25, z);
    s.scale.setScalar(1.3);
    night.add(s);
  }
  // Toxic ground glow: soft green pools on the mushroom patches and a
  // stronger one at the enemy spawn (road dead-end inside the board).
  const poolMat = new THREE.MeshBasicMaterial({
    map: haloTex, color: env.toxic, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  });
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  const addPool = (x, z, size, op = 1) => {
    const m = new THREE.Mesh(poolGeo, op === 1 ? poolMat : Object.assign(poolMat.clone(), { opacity: poolMat.opacity * op }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, SURFACE_Y + 0.015, z);
    m.scale.setScalar(size);
    m.raycast = noRaycast;
    m.renderOrder = 2;
    night.add(m);
    return m;
  };
  for (const [x, z] of mushroomSpots) addPool(x, z, 1.6);
  const isRoad = (x, z) => x >= 0 && z >= 0 && x < gridSize && z < gridSize && kindAt(x, z) === 'road';
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      if (!isRoad(x, z)) continue;
      if (x === 0 || z === 0 || x === gridSize - 1 || z === gridSize - 1) continue;
      let nb = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoad(x + dx, z + dz)) nb++;
      if (nb === 1) addPool((x - offset) * TILE_SIZE, (z - offset) * TILE_SIZE, 3.4, 1.4);
    }
  }
  night.add(createGroundFog(env));
  group.add(night);

  group.userData.refs = { geo, glowGeo, night, haloMat, mushHaloMat, poolMat };
  applyClutterTheme(group, themeColors);
  return group;
}

function applyClutterTheme(group, themeColors) {
  const env = envOf(themeColors);
  const r = group.userData.refs;
  paintMerged(r.geo, env);
  paintMerged(r.glowGeo, env);
  r.night.visible = !!env.night;
  r.haloMat.color.set(env.toxic);
  r.mushHaloMat.color.set(env.toxic);
  r.night.traverse((o) => { if (o.isMesh && o.material && o.material.map && !o.userData.fogUniforms) o.material.color.set(env.toxic); });
  r.night.traverse((o) => {
    if (o.userData.fogUniforms) {
      o.userData.fogUniforms.uColor.value.set(env.fogColor);
      o.userData.fogUniforms.uOpacity.value = env.fogOpacity;
    }
  });
}

export function retintGroundClutter(clutterGroup, themeColors) {
  applyClutterTheme(clutterGroup, themeColors);
}

function makeRadialTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Drifting ground fog: two big horizontal sheets with an fbm alpha shader.
// Thin over the playable board (stays readable), thicker over the island
// rim, plus a lower "sea of mist" the island floats in. Time comes from
// onBeforeRender, so main.js needs no per-frame hook.
function createGroundFog(env) {
  const g = new THREE.Group();
  const layers = [
    { y: 0.75, size: 64, inner: 10.5, outer: 15.5, fade0: 22, fade1: 30, center: 0.12, speed: 1.0, scale: 0.11, soft: 0.25 },
    { y: -2.6, size: 110, inner: 9.0, outer: 18.0, fade0: 36, fade1: 54, center: 0.0, speed: 0.6, scale: 0.05, soft: 0.4 },
  ];
  const start = performance.now();
  layers.forEach((L, idx) => {
    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(env.fogColor) },
      uOpacity: { value: env.fogOpacity },
      uInner: { value: L.inner },
      uOuter: { value: L.outer },
      uFade0: { value: L.fade0 },
      uFade1: { value: L.fade1 },
      uCenter: { value: L.center },
      uSeed: { value: idx * 17.0 },
      uSpeed: { value: L.speed },
      uScale: { value: L.scale },
      uSoft: { value: L.soft },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec2 vP;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vP = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uOpacity, uInner, uOuter, uFade0, uFade1, uCenter, uSeed, uSpeed, uScale, uSoft;
        uniform vec3 uColor;
        varying vec2 vP;
        float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p) { return n(p) * 0.55 + n(p * 2.1 + 3.7) * 0.3 + n(p * 4.3 + 9.1) * 0.15; }
        void main() {
          float t = uTime * uSpeed;
          vec2 q = vP * uScale + vec2(t * 0.025, t * 0.017) + uSeed;
          float f = fbm(q + vec2(fbm(q * 0.7 - t * 0.01), 0.0) * 0.8);
          float r = length(vP);
          float ring = mix(uCenter, 1.0, smoothstep(uInner, uOuter, r)) * (1.0 - smoothstep(uFade0, uFade1, r));
          float a = uOpacity * ring * smoothstep(0.5 - uSoft, 0.5 + uSoft, f);
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L.size, L.size, 1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = L.y;
    mesh.renderOrder = 5;
    mesh.raycast = noRaycast;
    mesh.userData.fogUniforms = uniforms;
    mesh.onBeforeRender = () => { uniforms.uTime.value = (performance.now() - start) / 1000; };
    g.add(mesh);
  });
  return g;
}
