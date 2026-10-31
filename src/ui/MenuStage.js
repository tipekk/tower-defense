// MenuStage.js
// 3D "hero" diorama for the main menu: a small floating slab of the game
// board with a short marching column of the real wind-up enemy models and
// two real towers. Renders into its own transparent WebGL canvas (the menu
// skin paints the background in CSS).
//
// API:
//   const stage = mountMenuStage(containerEl, 'basic' | 'zombie');
//   stage.setMode(mode)   // ~0.6 s cross-fade of lights/colours + zombie swap
//   stage.pause() / stage.resume()
//   stage.destroy()       // frees everything it created + forceContextLoss
//
// Resource note: EnemyModels/TowerModels cache geometries and some materials
// at module level (shared with the game). To keep destroy() clean without
// disturbing the game's renderer, every cached geometry / shared material /
// texture used here is cloned into a stage-owned copy, so destroy() can
// dispose all of it without touching the game's instances.

import * as THREE from 'three';
import { createEnemyModel } from '../render/EnemyModels.js';
import { createTowerModel } from '../render/TowerModels.js';

const TAU = Math.PI * 2;
const ISO_PITCH = Math.atan(1 / Math.sqrt(2));
const BASE_YAW = Math.PI / 4;
const TILE = 2;
const N = 4; // 4 x 4 tile slab
const HALF = (N * TILE) / 2;
const FADE_DUR = 0.6;

// Palette per mode (lerped by w = 0..1, basic -> zombie)
const P = {
  basic: {
    grass: 0x78b94a, grassAlt: 0x6aaa40, road: 0xdcb880, roadAlt: 0xcfa86f,
    earth: 0x91603d, earthDark: 0x6f4630, lip: 0x5f9a3c, rock: 0x9a948a,
    stone: 0xb8b8c2,
    hemiSky: 0xcfe6ff, hemiGround: 0x6b8f4a, hemiI: 1.05,
    sun: 0xfff0d8, sunI: 2.6,
    rim: 0xbfe0ff, rimI: 0.35,
    glow: 0x9ef01a, glowI: 0,
    fog: 0xd9f2ff, fogNear: 400, fogFar: 800,
    exposure: 1.15,
  },
  zombie: {
    grass: 0x4d7d66, grassAlt: 0x436f5b, road: 0x9c917f, roadAlt: 0x8b8171,
    earth: 0x5f5160, earthDark: 0x463c4c, lip: 0x3f6a55, rock: 0x6a7084,
    stone: 0x4a5a6a,
    hemiSky: 0x8aa2e0, hemiGround: 0x34484a, hemiI: 1.35,
    sun: 0xb3caff, sunI: 2.3,
    rim: 0x9ef01a, rimI: 1.6,
    glow: 0x9ef01a, glowI: 1,
    fog: 0x232c50, fogNear: 56, fogFar: 96,
    exposure: 1.1,
  },
};

// Road layout (tile coords col,row; world centre = -HALF + TILE*(i+0.5))
const ROAD = [[0, 1], [1, 1], [2, 1], [2, 2], [2, 3]];
const tc = (i) => -HALF + TILE * (i + 0.5);
// Marching path: enters at the back-left edge, turns towards the camera.
const PATH = [
  new THREE.Vector3(-HALF - 0.2, 0, tc(1)),
  new THREE.Vector3(tc(2), 0, tc(1)),
  new THREE.Vector3(tc(2), 0, HALF + 0.2),
];

const lerpC = (out, a, b, w) => out.setHex(a).lerp(_tmpC.setHex(b), w);
const _tmpC = new THREE.Color();
const smooth = (x) => x * x * (3 - 2 * x);
const _v4y = new THREE.Vector3(0, 1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function mountMenuStage(containerEl, mode = 'basic') {
  const owned = { geos: new Set(), mats: new Set(), texs: new Set() };
  const ownGeo = (g) => (owned.geos.add(g), g);
  const ownMat = (m) => (owned.mats.add(m), m);

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = P.basic.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
  canvas.setAttribute('aria-hidden', 'true');
  containerEl.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(P.basic.fog, P.basic.fogNear, P.basic.fogFar);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const CAM_DIST = 60;

  // ------------------------------------------------------------------ lights
  const hemi = new THREE.HemisphereLight(P.basic.hemiSky, P.basic.hemiGround, P.basic.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.basic.sun, P.basic.sunI);
  sun.position.set(-9, 16, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  // Back rim: cool sky kiss by day, toxic green at night.
  const rim = new THREE.DirectionalLight(P.basic.rim, P.basic.rimI);
  rim.position.set(-6, 5, -12);
  scene.add(rim, rim.target);
  // Low toxic glow pooled on the road (only lit in zombie).
  const glow = new THREE.PointLight(P.zombie.glow, 0, 9, 1.6);
  glow.position.set(tc(2), 0.9, tc(1.5));
  scene.add(glow);

  // ------------------------------------------------------------------ slab
  const world = new THREE.Group();
  scene.add(world);

  const M = {}; // mode-lerped materials: key -> { mat, key }
  const mkMat = (key, o = {}) => {
    const mat = ownMat(new THREE.MeshStandardMaterial({ color: P.basic[key], roughness: 0.9, metalness: 0, ...o }));
    M[key + (o.flatShading ? '_f' : '')] = { mat, key };
    return mat;
  };
  const grassMat = mkMat('grass');
  const grassAltMat = mkMat('grassAlt');
  const roadMat = mkMat('road', { roughness: 0.95 });
  const roadAltMat = mkMat('roadAlt', { roughness: 0.95 });
  const earthMat = mkMat('earth', { flatShading: true });
  const earthDarkMat = mkMat('earthDark', { flatShading: true });
  const lipMat = mkMat('lip');
  const rockMat = mkMat('rock', { flatShading: true });

  const isRoad = (i, j) => ROAD.some(([a, b]) => a === i && b === j);
  const tileGeo = ownGeo(roundedTileGeo(TILE - 0.08, 0.34, TILE - 0.08, 0.1));
  const roadGeo = ownGeo(roundedTileGeo(TILE - 0.02, 0.26, TILE - 0.02, 0.06));
  // Instanced per material: 4 draw calls for the 16 tiles.
  const _m4 = new THREE.Matrix4();
  const _q4 = new THREE.Quaternion();
  const _s4 = new THREE.Vector3(1, 1, 1);
  const _p4 = new THREE.Vector3();
  const buckets = new Map();
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const road = isRoad(i, j);
      const alt = (i + j) % 2 === 1;
      const geo = road ? roadGeo : tileGeo;
      const mat = road ? (alt ? roadAltMat : roadMat) : alt ? grassAltMat : grassMat;
      if (!buckets.has(mat)) buckets.set(mat, { geo, list: [] });
      buckets.get(mat).list.push([tc(i), road ? -0.19 : -0.17, tc(j)]);
    }
  }
  for (const [mat, { geo, list }] of buckets) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z], k) => im.setMatrixAt(k, _m4.compose(_p4.set(x, y, z), _q4.identity(), _s4.set(1, 1, 1))));
    im.receiveShadow = true;
    world.add(im);
  }
  // Road cobbles: a few flat stones breaking up the strip.
  const cobGeo = ownGeo(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 6));
  const rnd = mulberry(11);
  const cobMat = ownMat(new THREE.MeshStandardMaterial({ color: P.basic.roadAlt, roughness: 0.85 }));
  M.roadAlt_c = { mat: cobMat, key: 'roadAlt' };
  const cobs = new THREE.InstancedMesh(cobGeo, cobMat, ROAD.length * 3);
  let ci = 0;
  for (const [i, j] of ROAD) {
    for (let k = 0; k < 3; k++) {
      const sc = 0.6 + rnd() * 0.7;
      _p4.set(tc(i) + (rnd() - 0.5) * 1.3, -0.045, tc(j) + (rnd() - 0.5) * 1.3);
      _q4.setFromAxisAngle(_v4y, rnd() * TAU);
      cobs.setMatrixAt(ci++, _m4.compose(_p4, _q4, _s4.set(sc, 1, sc)));
    }
  }
  cobs.receiveShadow = true;
  world.add(cobs);
  // Slab body: grass lip + layered earth, slightly tapering downwards.
  const lip = new THREE.Mesh(ownGeo(roundedTileGeo(N * TILE + 0.06, 0.16, N * TILE + 0.06, 0.22)), lipMat);
  lip.position.y = -0.42;
  world.add(lip);
  const body = new THREE.Mesh(ownGeo(slabGeo(N * TILE, 1.25, 0.16)), earthMat);
  body.position.y = -0.5;
  world.add(body);
  const base = new THREE.Mesh(ownGeo(slabGeo(N * TILE - 0.4, 0.6, 0.6)), earthDarkMat);
  base.position.y = -1.75;
  world.add(base);

  // Decor: a few rocks and glowing mushrooms that sprout in zombie mode.
  const rockGeo = ownGeo(new THREE.DodecahedronGeometry(0.32, 0));
  [[tc(0) - 0.3, tc(0) + 0.2, 1.1], [tc(0) + 0.5, tc(0) - 0.5, 0.6], [tc(3) + 0.4, tc(3) + 0.3, 0.8], [tc(0) - 0.2, tc(2) + 0.5, 0.7]].forEach(([x, z, s], k) => {
    const r = new THREE.Mesh(rockGeo, rockMat);
    r.position.set(x, 0.05 * s, z);
    r.scale.set(s, s * 0.7, s);
    r.rotation.set(k, k * 1.7, 0);
    r.castShadow = true;
    r.receiveShadow = true;
    world.add(r);
  });
  const mushStemMat = ownMat(new THREE.MeshStandardMaterial({ color: 0xd8f0b0, roughness: 0.6 }));
  const mushCapMat = ownMat(new THREE.MeshStandardMaterial({ color: 0x9ef01a, emissive: 0x9ef01a, emissiveIntensity: 0.8, roughness: 0.4 }));
  const stemGeo = ownGeo(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 6));
  stemGeo.translate(0, 0.11, 0);
  const capGeo = ownGeo(new THREE.SphereGeometry(0.13, 10, 6, 0, TAU, 0, Math.PI / 2));
  capGeo.scale(1, 0.7, 1);
  capGeo.translate(0, 0.2, 0);
  const mushrooms = [];
  [[tc(0) + 0.4, tc(0) + 0.6, 1.2], [tc(0) + 0.75, tc(0) + 0.35, 0.8], [tc(3) - 0.2, tc(2) + 0.1, 1.0], [tc(3) + 0.15, tc(2) + 0.45, 0.7],
   [tc(0) + 0.3, tc(2) - 0.2, 0.9], [tc(1) - 0.4, tc(0) - 0.3, 0.75], [tc(3) - 0.5, tc(3) + 0.6, 1.1]].forEach(([x, z, s], k) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(stemGeo, mushStemMat), new THREE.Mesh(capGeo, mushCapMat));
    g.position.set(x, 0, z);
    g.rotation.set((rnd() - 0.5) * 0.4, rnd() * TAU, (rnd() - 0.5) * 0.4);
    g.userData.s = s * 2.1;
    g.userData.k = k;
    g.scale.setScalar(0.001);
    g.visible = false;
    world.add(g);
    mushrooms.push(g);
  });

  // ----------------------------------------------------------------- towers
  const towers = [];
  const addTower = (type, i, j, yaw) => {
    const t = createTowerModel(type, 'basic', 2);
    ownTower(t, owned);
    t.position.set(tc(i), 0, tc(j));
    t.scale.setScalar(1.2);
    if (t.userData.turret) t.userData.turret.rotation.y = yaw;
    shadowize(t);
    world.add(t);
    towers.push(t);
    return t;
  };
  const balista = addTower('balista', 3, 0, -2.4);
  const frost = addTower('frost', 1, 3, 0.6);
  let frostFireT = 2.2;

  // ---------------------------------------------------------------- marchers
  const legs = [];
  let pathLen = 0;
  for (let k = 0; k < PATH.length - 1; k++) {
    const d = PATH[k].distanceTo(PATH[k + 1]);
    legs.push(d);
    pathLen += d;
  }
  const sampleOut = new THREE.Vector3();
  const dirOut = new THREE.Vector3();
  const samplePath = (s) => {
    let k = 0;
    while (k < legs.length - 1 && s > legs[k]) { s -= legs[k]; k++; }
    const a = PATH[k], b = PATH[k + 1];
    const f = clamp01(s / legs[k]);
    sampleOut.lerpVectors(a, b, f);
    dirOut.subVectors(b, a).normalize();
    return k;
  };
  const SPEED = 0.95;
  const marchers = [];
  const addMarcher = (type, offset, opts = {}) => {
    const m = createEnemyModel(type);
    ownEnemy(m, owned);
    shadowize(m);
    const sc = (opts.scale ?? 1.3) * 1.2;
    m.scale.setScalar(sc);
    world.add(m);
    marchers.push({ m, offset, sc, y: opts.y ?? 0, lateral: opts.lateral ?? 0, yaw: 0, flying: !!m.userData.flying, speedF: opts.speedF ?? 1 });
  };
  addMarcher('cvakac', 0);
  addMarcher('vrtiak', 3.7, { lateral: 0.1 });
  addMarcher('kotlar', 7.4, { scale: 1.25 });
  addMarcher('vazka', 5.4, { y: 1.75, lateral: -0.15, scale: 1.25 });

  // ------------------------------------------------------------------ spores
  const SPORES = 70;
  const sporePos = new Float32Array(SPORES * 3);
  const sporeVel = new Float32Array(SPORES);
  const sporeLife = new Float32Array(SPORES);
  const resetSpore = (i, init) => {
    sporePos[i * 3] = (rnd() - 0.5) * N * TILE * 0.95;
    sporePos[i * 3 + 1] = init ? rnd() * 3.5 : 0;
    sporePos[i * 3 + 2] = (rnd() - 0.5) * N * TILE * 0.95;
    sporeVel[i] = 0.25 + rnd() * 0.45;
    sporeLife[i] = rnd() * TAU;
  };
  for (let i = 0; i < SPORES; i++) resetSpore(i, true);
  const sporeGeo = ownGeo(new THREE.BufferGeometry());
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  const sporeTex = makeDotTexture();
  owned.texs.add(sporeTex);
  const sporeMat = ownMat(new THREE.PointsMaterial({
    color: 0xb8ff4a, map: sporeTex, size: 0.34, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  const spores = new THREE.Points(sporeGeo, sporeMat);
  spores.frustumCulled = false;
  spores.visible = false;
  world.add(spores);

  // ------------------------------------------------------------------ framing
  let width = 1, height = 1;
  const fitPts = [];
  for (const x of [-HALF, HALF]) for (const z of [-HALF, HALF]) for (const y of [-2.05, 2.9]) fitPts.push(new THREE.Vector3(x, y, z));
  const _v = new THREE.Vector3();
  const placeCamera = (yaw, pitch) => {
    const h = CAM_DIST * Math.cos(pitch);
    camera.position.set(h * Math.sin(yaw), CAM_DIST * Math.sin(pitch), h * Math.cos(yaw));
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld();
  };
  let fit = { cx: 0, cy: 0, half: 10 };
  // Safe area inside the canvas the slab must fit into (CSS custom props on
  // the container, registered as <length> in menu.css so they resolve to px).
  // The canvas may extend under UI chrome; the slab is framed in the free part.
  const pads = { t: 0, r: 0, b: 0, l: 0 };
  const readPads = () => {
    const cs = getComputedStyle(containerEl);
    const px = (n) => { const v = parseFloat(cs.getPropertyValue(n)); return Number.isFinite(v) ? Math.max(0, v) : 0; };
    pads.t = px('--stage-pad-t'); pads.r = px('--stage-pad-r'); pads.b = px('--stage-pad-b'); pads.l = px('--stage-pad-l');
    // --stage-avoid-panel: 1 -> keep the slab left of the open menu panel
    if (cs.getPropertyValue('--stage-avoid-panel').trim() === '1') {
      const panel = containerEl.parentElement && containerEl.parentElement.querySelector('.menu-panel[aria-hidden="false"]');
      const host = panel && panel.offsetParent;
      if (panel && host) {
        const cr = containerEl.getBoundingClientRect();
        // static (untransformed) left edge of the panel: host right - panel right offset - width
        const hr = host.getBoundingClientRect();
        const left = hr.left + panel.offsetLeft;
        pads.r = Math.max(pads.r, cr.right - left + 24);
      }
    }
    // never let the free area collapse
    const minW = Math.min(width, 120), minH = Math.min(height, 120);
    if (width - pads.l - pads.r < minW) { const k = (width - minW) / Math.max(1, pads.l + pads.r); pads.l *= k; pads.r *= k; }
    if (height - pads.t - pads.b < minH) { const k = (height - minH) / Math.max(1, pads.t + pads.b); pads.t *= k; pads.b *= k; }
  };
  const frus = { l: -10, r: 10, t: 10, b: -10 };
  const frusFrom = { ...frus }, frusTo = { ...frus };
  let frusStart = 0, frusDur = 0;
  const computeFit = () => {
    placeCamera(BASE_YAW, ISO_PITCH);
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of fitPts) {
      _v.copy(p).applyMatrix4(inv);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
      minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    }
    readPads();
    const aw = Math.max(1, width - pads.l - pads.r);
    const ah = Math.max(1, height - pads.t - pads.b);
    const aspect = aw / ah;
    // extra room for the camera drift / parallax yaw (+-0.14 rad) and the
    // flying figure, so nothing is ever clipped at the free-area edge
    const pad = 1.1;
    const hw = ((maxX - minX) / 2) * pad;
    const hh = ((maxY - minY) / 2) * pad;
    const half = Math.max(hh, hw / aspect);     // world half-height of the free area
    const s = (2 * half) / ah;                  // world units per CSS px
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    // slab centre sits in the centre of the free area; frustum spans the whole canvas
    const l = cx - (pads.l + aw / 2) * s;
    const t = cy + (pads.t + ah / 2) * s;
    fit = { cx, cy, half };
    return { l, r: l + width * s, t, b: t - height * s };
  };
  const applyFrustum = () => {
    camera.left = frus.l; camera.right = frus.r; camera.top = frus.t; camera.bottom = frus.b;
    camera.updateProjectionMatrix();
  };
  // animate=true: glide to the new framing (panel opened/closed), time based
  const layout = (animate) => {
    const target = computeFit();
    Object.assign(frusTo, target);
    if (animate && running) {
      Object.assign(frusFrom, frus);
      frusStart = performance.now();
      frusDur = 450;
    } else {
      Object.assign(frus, target);
      frusDur = 0;
      applyFrustum();
    }
  };
  const stepFrustum = (now) => {
    if (!frusDur) return;
    const k = smooth(clamp01((now - frusStart) / frusDur));
    for (const key of ['l', 'r', 't', 'b']) frus[key] = frusFrom[key] + (frusTo[key] - frusFrom[key]) * k;
    if (k >= 1) frusDur = 0;
    applyFrustum();
  };
  const resize = () => {
    const r = containerEl.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    layout(false);
    if (!running) renderOnce();
  };

  // ---------------------------------------------------------- input parallax
  const look = { tx: 0, ty: 0, x: 0, y: 0 };
  const onPointer = (e) => {
    if (e.pointerType === 'touch') return;
    look.tx = (e.clientX / window.innerWidth) * 2 - 1;
    look.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  let tiltBase = null;
  const onTilt = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = { g: e.gamma, b: e.beta };
    // slowly re-centre so the "neutral" pose follows how the phone is held
    tiltBase.g += (e.gamma - tiltBase.g) * 0.01;
    tiltBase.b += (e.beta - tiltBase.b) * 0.01;
    look.tx = Math.max(-1, Math.min(1, (e.gamma - tiltBase.g) / 20));
    look.ty = Math.max(-1, Math.min(1, (e.beta - tiltBase.b) / 20));
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  // No permission request (iOS simply won't fire it; Android/desktop will).
  window.addEventListener('deviceorientation', onTilt, { passive: true });
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // --------------------------------------------------------------- mode fade
  let w = mode === 'zombie' ? 1 : 0; // current blend
  let wFrom = w, wTo = w, fadeStart = -Infinity;
  let zombieOn = null;
  const applyZombie = (on) => {
    if (zombieOn === on) return;
    zombieOn = on;
    for (const mr of marchers) if (mr.m.userData.setZombie) mr.m.userData.setZombie(on);
  };
  const towerStone = []; // { mat, slot }
  for (const t of towers) {
    t.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m.userData && m.userData.themed && !towerStone.some((s) => s.mat === m)) towerStone.push({ mat: m, slot: m.userData.slot });
    });
  }
  const stoneColors = { basic: stoneSet(P.basic.stone), zombie: stoneSet(P.zombie.stone) };
  const _ca = new THREE.Color(), _cb = new THREE.Color();

  const applyBlend = (b) => {
    const A = P.basic, Z = P.zombie;
    for (const k in M) {
      const { mat, key } = M[k];
      lerpC(mat.color, A[key], Z[key], b);
      if (k === 'roadAlt_c') mat.color.multiplyScalar(0.92);
    }
    lerpC(hemi.color, A.hemiSky, Z.hemiSky, b);
    lerpC(hemi.groundColor, A.hemiGround, Z.hemiGround, b);
    hemi.intensity = A.hemiI + (Z.hemiI - A.hemiI) * b;
    lerpC(sun.color, A.sun, Z.sun, b);
    sun.intensity = A.sunI + (Z.sunI - A.sunI) * b;
    lerpC(rim.color, A.rim, Z.rim, b);
    rim.intensity = A.rimI + (Z.rimI - A.rimI) * b;
    // moon comes from the other side at night
    sun.position.set(-9 + 4 * b, 16, 5 - 12 * b);
    // day: soft back rim; night: toxic side light grazing the camera-facing +x faces
    rim.position.set(-6 + 18 * b, 5 - 1.5 * b, -12 + 4 * b);
    lerpC(scene.fog.color, A.fog, Z.fog, b);
    scene.fog.near = A.fogNear + (Z.fogNear - A.fogNear) * smooth(b);
    scene.fog.far = A.fogFar + (Z.fogFar - A.fogFar) * smooth(b);
    renderer.toneMappingExposure = A.exposure + (Z.exposure - A.exposure) * b;
    for (const s of towerStone) {
      const ca = stoneColors.basic[s.slot], cz = stoneColors.zombie[s.slot];
      if (!ca) continue;
      s.mat.color.copy(_ca.copy(ca.c).lerp(_cb.copy(cz.c), b));
      s.mat.emissive.copy(_ca.copy(ca.e).lerp(_cb.copy(cz.e), b));
    }
    sporeMat.opacity = 0.85 * smooth(b);
    spores.visible = b > 0.01;
    for (const g of mushrooms) g.visible = b > 0.01;
  };
  applyBlend(w);
  applyZombie(w > 0.5);

  const setMode = (m) => {
    const target = m === 'zombie' ? 1 : 0;
    if (target === wTo) return;
    wFrom = w; wTo = target; fadeStart = performance.now();
    if (!running) { w = wTo; fadeStart = -Infinity; applyBlend(w); applyZombie(w > 0.5); renderOnce(); }
  };

  // --------------------------------------------------------------- animation
  let clock = 0;
  const _aimV = new THREE.Vector3();
  const tick = (dt) => {
    clock += dt;
    const t = clock;
    // Wall-clock based (not per-frame dt, which is capped): the fade always
    // completes in FADE_DUR even at a few FPS.
    if (w !== wTo) {
      const f = clamp01((performance.now() - fadeStart) / (FADE_DUR * 1000));
      w = f >= 1 ? wTo : wFrom + (wTo - wFrom) * smooth(f);
      applyBlend(w);
      if (f >= 0.5) applyZombie(wTo > 0.5);
    }

    // marchers
    const zSlow = 1 - 0.35 * w;
    let nearest = null, nearestD = Infinity;
    for (const mr of marchers) {
      const s = ((t * SPEED * zSlow + mr.offset) % (pathLen + 1.2)) - 0.6;
      const ss = Math.max(0, Math.min(pathLen, s));
      const seg = samplePath(ss);
      const ud = mr.m.userData;
      const edge = Math.min(ss, pathLen - ss);
      const vis = smooth(clamp01((edge - 0.1) / 1.1));
      mr.m.visible = vis > 0.01;
      mr.m.scale.setScalar(mr.sc * Math.max(0.001, vis));
      const sideX = -dirOut.z, sideZ = dirOut.x;
      let y = mr.y;
      if (mr.flying) y += Math.sin(t * 1.7 + mr.offset) * 0.18;
      mr.m.position.set(sampleOut.x + sideX * mr.lateral, y, sampleOut.z + sideZ * mr.lateral);
      const yaw = Math.atan2(dirOut.x, dirOut.z);
      mr.yaw = angleLerp(mr.yaw === 0 && seg === 0 ? yaw : mr.yaw, yaw, 1 - Math.exp(-6 * dt));
      mr.m.rotation.y = mr.yaw;
      if (ud.update) ud.update(dt, t, zSlow);
      if (mr.m.visible && vis > 0.6 && !mr.flying) {
        const d = mr.m.position.distanceToSquared(balista.position);
        if (d < nearestD) { nearestD = d; nearest = mr.m; }
      }
    }
    // balista tracks the closest walker; idle scan otherwise
    const tur = balista.userData.turret;
    if (tur) {
      if (nearest) {
        _aimV.subVectors(nearest.position, balista.position);
        tur.rotation.y = angleLerp(tur.rotation.y, Math.atan2(_aimV.x, _aimV.z), 1 - Math.exp(-5 * dt));
      } else tur.rotation.y += Math.sin(t * 0.5) * 0.2 * dt;
    }
    frostFireT -= dt;
    if (frostFireT <= 0) { frostFireT = 3.6; frost.userData.fire && frost.userData.fire(); }
    for (const tw of towers) tw.userData.update && tw.userData.update(dt, t);

    // zombie decor
    if (w > 0.01) {
      for (const g of mushrooms) {
        const grow = smooth(clamp01(w * 1.6 - g.userData.k * 0.08));
        g.scale.setScalar(Math.max(0.001, g.userData.s * grow * (1 + Math.sin(t * 2.2 + g.userData.k) * 0.06)));
      }
      mushCapMat.emissiveIntensity = 0.7 + 0.25 * Math.sin(t * 2.3);
      for (let i = 0; i < SPORES; i++) {
        sporeLife[i] += dt;
        sporePos[i * 3 + 1] += sporeVel[i] * dt;
        sporePos[i * 3] += Math.sin(sporeLife[i] * 1.3) * 0.12 * dt;
        sporePos[i * 3 + 2] += Math.cos(sporeLife[i] * 1.1) * 0.12 * dt;
        if (sporePos[i * 3 + 1] > 4.2) resetSpore(i, false);
      }
      sporeGeo.attributes.position.needsUpdate = true;
      glow.intensity = w * (5 + Math.sin(t * 2.3) * 0.8);
    } else glow.intensity = 0;

    // camera: slow drift + pointer / tilt parallax
    const still = reduceMotion && reduceMotion.matches;
    const kL = 1 - Math.exp(-2.5 * dt);
    look.x += (look.tx - look.x) * kL;
    look.y += (look.ty - look.y) * kL;
    const drift = still ? 0 : Math.sin(t * 0.11) * 0.07;
    const yaw = BASE_YAW + drift + (still ? 0 : look.x * 0.07);
    const pitch = ISO_PITCH + (still ? 0 : look.y * 0.035);
    placeCamera(yaw, pitch);
  };

  const renderOnce = () => {
    if (disposed) return;
    renderer.render(scene, camera);
  };

  let running = false, paused = false, disposed = false, raf = 0, last = 0;
  const frame = (now) => {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    stepFrustum(performance.now());
    tick(dt);
    renderOnce();
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (disposed || running || paused || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(containerEl);
  else window.addEventListener('resize', resize);

  resize();
  tick(0.016);
  renderOnce();
  start();

  return {
    setMode,
    relayout() { if (!disposed) layout(true); },
    pause() { paused = true; stop(); },
    resume() { paused = false; start(); },
    destroy() {
      if (disposed) return;
      stop();
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      // collect per-instance enemy materials etc. that we didn't clone
      scene.traverse((o) => {
        if (o.geometry) owned.geos.add(o.geometry);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => owned.mats.add(m));
      });
      for (const m of owned.mats) {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) owned.texs.add(v); }
        m.dispose();
      }
      owned.geos.forEach((g) => g.dispose());
      owned.texs.forEach((t) => t.dispose());
      sun.shadow.map && sun.shadow.map.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      owned.geos.clear(); owned.mats.clear(); owned.texs.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function shadowize(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      // tiny bits (rivets, sparks) don't need to cast; keep cost low
      const r = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
      o.castShadow = o.castShadow !== false && r && r.radius > 0.07;
      o.receiveShadow = false;
    }
  });
}

/** Replace cached/shared geometry with stage-owned clones (enemy mats are per instance). */
function ownEnemy(root, owned) {
  const map = new Map();
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    let g = map.get(o.geometry);
    if (!g) { g = o.geometry.clone(); map.set(o.geometry, g); owned.geos.add(g); }
    o.geometry = g;
  });
}

/** Towers share module-level materials/textures with the game: clone them. */
function ownTower(root, owned) {
  const ud = root.userData;
  const keep = new Set([ud.materials && ud.materials.ice, ud.materials && ud.materials.glow].filter(Boolean));
  const gMap = new Map(), mMap = new Map(), tMap = new Map();
  const cloneTex = (t) => {
    if (!t) return t;
    let c = tMap.get(t);
    if (!c) { c = t.clone(); tMap.set(t, c); owned.texs.add(c); }
    return c;
  };
  const cloneMat = (m) => {
    if (keep.has(m)) return m;
    let c = mMap.get(m);
    if (!c) {
      c = m.clone();
      for (const k of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap']) if (c[k]) c[k] = cloneTex(c[k]);
      mMap.set(m, c);
      owned.mats.add(c);
    }
    return c;
  };
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    let g = gMap.get(o.geometry);
    if (!g) { g = o.geometry.clone(); gMap.set(o.geometry, g); owned.geos.add(g); }
    o.geometry = g;
    o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
  });
  if (ud.materials) for (const k in ud.materials) if (mMap.has(ud.materials[k])) ud.materials[k] = mMap.get(ud.materials[k]);
}

/** Mirror of TowerModels.themedMats colour derivation, per slot. */
function stoneSet(hex) {
  const base = new THREE.Color(hex);
  const hsl = {};
  base.getHSL(hsl);
  const night = hsl.l < 0.4;
  if (night) base.lerp(new THREE.Color(0x93a3b8), 0.38);
  const mk = (c) => ({ c, e: night ? c.clone().multiplyScalar(0.16) : new THREE.Color(0) });
  return {
    stone: mk(base.clone()),
    stoneDark: mk(base.clone().multiplyScalar(0.66)),
    stoneTrim: mk(base.clone().lerp(new THREE.Color(0xfff2dc), 0.16)),
    stoneIce: mk(base.clone().lerp(new THREE.Color(0x8fc3f0), 0.5)),
  };
}

function angleLerp(a, b, k) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box with rounded vertical edges (top face flat), centred, height along Y. */
function roundedTileGeo(w, h, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Earth slab: top at y=0, tapering by `taper` toward the bottom, low-poly. */
function slabGeo(size, h, taper) {
  const g = new THREE.CylinderGeometry(size / Math.SQRT2, (size - taper * 2) / Math.SQRT2, h, 4, 2);
  g.rotateY(Math.PI / 4);
  g.translate(0, -h / 2, 0);
  // jitter mid ring a little for a hand-cut feel
  const p = g.attributes.position;
  const R = mulberry(5);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.01 && y > -h + 0.01) {
      p.setX(i, p.getX(i) * (0.97 + R() * 0.03));
      p.setZ(i, p.getZ(i) * (0.97 + R() * 0.03));
    }
  }
  g.computeVertexNormals();
  return g;
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
