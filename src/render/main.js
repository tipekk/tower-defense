// main.js
// Wires up the diorama: renderer, iso camera, theme-aware lights, sky dome,
// a DATA-DRIVEN tile grid built from src/data/maps/map_01.json (task B/C),
// the real Game/Tower/Enemy/Combat/Waves/Economy logic (task C) driving
// what's actually on screen, plus mobile-first input: the camera always
// fits the whole grid at any viewport aspect, and touch (tap/pinch/drag/
// two-finger-rotate) works alongside the existing desktop controls
// (click/wheel/drag/WASD/Q,E/T,R).
//
// Render <-> logic boundary: Game/Tower/Enemy/Combat/Waves/Economy (src/core,
// src/entities, src/systems) know nothing about Three.js. This file is the
// only place that reads their plain-object state each frame and creates/
// moves/removes meshes to match it.

import * as THREE from 'three';
import { createIsoCamera, rotateIso90, setFitExtent, setPanTarget } from './IsoCamera.js';
import { createLights, applyTheme, THEMES } from './Lights.js';
import { createSkyDome, updateSkyDome, createVignetteOverlay } from './Effects.js';
import {
  createTileGrid, retintTileGrid,
  createDioramaBase, retintDioramaBase,
  createGroundClutter, retintGroundClutter,
  TILE_SIZE,
} from './Scene.js';
import { createTowerModel, retintTowerModel } from './TowerModels.js';
import { createEnemyModel } from './EnemyModels.js';
import { createFX } from './FX.js';
import { createInputController } from './InputController.js';
import { openRadialMenu, closeRadialMenu } from '../ui/RadialMenu.js';

import { Grid } from '../world/Grid.js';
import { Path } from '../world/Path.js';
import { Game, GAME_STATES } from '../core/Game.js';
import { TOWER_TYPES } from '../entities/Tower.js';
import { ENEMY_TYPES } from '../entities/Enemy.js';
import { buildUniformWave } from '../systems/Waves.js';

// The canvas mounts into #sceneArea, not the old full-viewport #app --
// #sceneArea is the flex box that's left over once the HUD bar (mobile) /
// side panel (desktop) have claimed their own real layout space (see
// index.html/preview.html). Falls back to #app for any stale markup.
const container = document.getElementById('sceneArea') || document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Task Q (visual direction pass): filmic tone mapping is the single
// highest-leverage change for making the brass/iron/wood/stone materials
// below actually look like metal/wood/stone instead of flat matte paint --
// NoToneMapping (the three.js default) clips highlights hard and leaves
// MeshStandardMaterial looking chalky regardless of how roughness/metalness
// are tuned. ACES + a touch of extra exposure gives real highlight rolloff
// and makes the whole diorama read as lit, not flat-shaded.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

let themeKey = 'basic';
let theme = THEMES[themeKey];

const CAM_DIST = 30;

function sceneAreaSize() {
  const rect = container.getBoundingClientRect();
  return {
    w: rect.width || window.innerWidth,
    h: rect.height || window.innerHeight,
  };
}

const initialSize = sceneAreaSize();
const camera = createIsoCamera(initialSize.w / Math.max(initialSize.h, 1));

const lightRig = createLights(scene, renderer, themeKey);

const sky = createSkyDome(theme.skyTop, theme.skyBottom, 220, theme.skyHorizon);
scene.add(sky);



// ---------------------------------------------------------------------------
// Map data (task B/C): src/data/maps/map_01.json drives the tile grid, the
// buildable/road/elevated/decor layout and the enemy path waypoints. Loaded
// relative to THIS module's own URL so it resolves the same way whether the
// page is index.html (real ES modules) or preview.html (bundled, but served
// from the same folder so the relative path on disk still matches).
// ---------------------------------------------------------------------------
// Fetched relative to the HTML PAGE, not this module's own URL: index.html
// loads this file as a real ES module (import.meta.url would resolve
// correctly there), but preview.html inlines the same code directly inside
// the page's own <script type="module"> (task G/H/J/K's bundling approach,
// see claude/pracovny-styl.md), where import.meta.url is the page's own
// URL instead of src/render/main.js's. Both HTML files live at the project
// root and already reference assets the same page-relative way (e.g.
// "assets/ui/..."), so plain page-relative paths keep index.html and
// preview.html behaving identically.
const MAP_URL = 'src/data/maps/map_01.json';
const mapData = await fetch(MAP_URL).then((r) => r.json());
// Level 2 (po 15 vlnach level 1 ide dalsi, tazsi level so stejnym terenom):
// map_02.json reuses map_01's exact grid/path/mode, only its `waves` array
// is used below -- the tile grid/enemy path stay built from map_01 (mapData)
// for both levels, so no second Scene/Grid/Path has to be constructed.
const MAP2_URL = 'src/data/maps/map_02.json';
const map2Data = await fetch(MAP2_URL).then((r) => r.json());
const LEVELS = [mapData, map2Data];
let currentLevelIdx = 0;
function currentWaves() { return LEVELS[currentLevelIdx].waves; }
const grid = new Grid(mapData);
const GRID_SIZE = grid.width; // map_01 is square (12x12); createTileGrid assumes square
const gridOffset = (GRID_SIZE - 1) / 2;

// Fit to the playable grid only (island rim/decor may crop slightly) so the
// board is as big as possible on phones.
setFitExtent((GRID_SIZE * TILE_SIZE) / 2 * 0.9, 1.0);

// Enemy path, in the SAME centered grid-unit coordinate space Combat/
// Targeting/Tower placement use (NOT multiplied by TILE_SIZE -- that
// scaling only applies to where meshes are drawn in world space, see
// gridToWorld() below). This keeps all the GDD-tuned range/speed numbers
// in Tower.js/Enemy.js meaningful without retuning them for TILE_SIZE.
const centeredWaypoints = mapData.waypoints.map((wp) => ({
  x: wp.x - gridOffset,
  z: wp.z - gridOffset,
}));
const enemyPath = new Path(centeredWaypoints, 1);
const gamePath = {
  length: enemyPath.totalLength,
  getPositionAtT: (t) => enemyPath.getPositionAtT(t),
};

function gridToWorld(centeredX, centeredZ) {
  return { x: centeredX * TILE_SIZE, z: centeredZ * TILE_SIZE };
}

// ---------------------------------------------------------------------------
// Game logic instance (task C): no Three.js inside Game/Tower/Enemy/Combat/
// Waves/Economy -- this file is the sole bridge to the renderer.
// ---------------------------------------------------------------------------
const START_LIVES = 20;
const game = new Game({ path: gamePath, startLives: START_LIVES, startGold: 150 });
game.start();

// map_01.json's own `waves` array was authored by an earlier task with its
// own placeholder enemy names ("basic_grunt"/"runner"/"armored_grunt"/
// "boss_zombie_king") that never matched ENEMY_TYPES in entities/Enemy.js
// ("cvakac"/"vrtiak"/"kotlar"/"vazka"/"navijac"/"boss_kukucka"). Rather than
// invent a second, disconnected wave table, each map wave is replayed here
// through the REAL enemy roster via this alias so "Spustit vlnu" still uses
// the map's pacing/counts/mix, with enemies that actually exist in Combat.
const MAP_ENEMY_ALIAS = {
  basic_grunt: 'cvakac',
  runner: 'vrtiak',
  armored_grunt: 'kotlar',
  boss_zombie_king: 'boss_kukucka',
};

function buildSpawnListForMapWave(mapWave) {
  const list = [];
  for (const group of mapWave.enemies) {
    // map_02.json (level 2) authors its waves with the REAL roster keys
    // directly (cvakac/vrtiak/kotlar/vazka/navijac/boss_kukucka_major), so
    // only fall back to the legacy alias/placeholder-default when the type
    // isn't already a real ENEMY_TYPES key.
    const type = ENEMY_TYPES[group.type] ? group.type : (MAP_ENEMY_ALIAS[group.type] || 'cvakac');
    list.push(...buildUniformWave(type, group.count, group.delay));
  }
  return list;
}

let nextMapWaveIdx = 0;

const dioramaBase = createDioramaBase(GRID_SIZE, theme.stone);
scene.add(dioramaBase);

function tileKindAt(x, z) {
  // Tile.type uses the map's own vocabulary ("path", not "road"); Scene.js's
  // createTile()/tileTopColorHex() use "road" for the walkable/non-buildable
  // look, so map that one value across. Everything else (grass/elevated/
  // decor) already matches 1:1.
  const type = grid.getTile(x, z)?.type ?? 'grass';
  return type === 'path' ? 'road' : type;
}
const tileGrid = createTileGrid(GRID_SIZE, theme, [], tileKindAt);
scene.add(tileGrid);

// Task P (terrain pass): instanced grass tufts/pebbles scattered across the
// buildable tiles -- see Scene.js createGroundClutter for why this needed
// its own pass (flat single-color tiles previously had zero decor/variety).
const groundClutter = createGroundClutter(GRID_SIZE, theme, tileKindAt);
scene.add(groundClutter);

// ---------------------------------------------------------------------------// ---------------------------------------------------------------------------
// Towers / enemies use the dedicated procedural model modules
// (TowerModels.js / EnemyModels.js). PNG icons stay DOM-only (radial menu).
// ---------------------------------------------------------------------------
const TOWER_ICON = {
  balista: 'assets/ui/tower-balista.png',
  cannon: 'assets/ui/tower-kanon.png',
  catapult: 'assets/ui/tower-katapult.png',
  frost: 'assets/ui/tower-mraz.png',
};
const TOWER_KEYS = ['balista', 'cannon', 'catapult', 'frost'];

const fx = createFX(scene, camera, container);

const towerMeshes = [];
const towerVisualById = new Map(); // logic Tower.id -> mesh

function spawnTowerMesh(towerInstance, centeredX, centeredZ, surfaceY = 0.5) {
  const mesh = createTowerModel(towerInstance.type, theme, towerInstance.level);
  const world = gridToWorld(centeredX, centeredZ);
  mesh.position.set(world.x, surfaceY, world.z);
  mesh.userData.isTower = true; // InputController expects this on the raycast hit
  mesh.userData.towerType = towerInstance.type;
  mesh.userData.logicTower = towerInstance;
  mesh.userData.spawnAt = simTime;
  mesh.userData.shownLevel = towerInstance.level;
  mesh.userData.lastShot = towerInstance.shotCount || 0;
  // Idle facing: look down-map toward the camera-ish side so fresh towers
  // don't all stare in the same arbitrary direction.
  if (mesh.userData.turret) mesh.userData.turret.rotation.y = Math.atan2(-world.x, -world.z) + Math.PI;
  scene.add(mesh);
  towerMeshes.push(mesh);
  towerVisualById.set(towerInstance.id, mesh);
  fx.impact(new THREE.Vector3(world.x, surfaceY + 0.1, world.z), 'cannon', 0.6);
  return mesh;
}

function removeTowerMesh(towerInstance) {
  const mesh = towerVisualById.get(towerInstance.id);
  if (!mesh) return;
  scene.remove(mesh);
  const idx = towerMeshes.indexOf(mesh);
  if (idx >= 0) towerMeshes.splice(idx, 1);
  towerVisualById.delete(towerInstance.id);
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
const enemyVisualById = new Map(); // logic Enemy.id -> { mesh, logicEnemy, bar, lastHp, prevX, prevZ }

function enemyBaseY(e) { return e.flying ? 1.6 : 0.5; }

function spawnEnemyMesh(enemyInstance) {
  const mesh = createEnemyModel(enemyInstance.type);
  if (mesh.userData.setZombie) mesh.userData.setZombie(themeKey === 'zombie');
  const world = gridToWorld(enemyInstance.x, enemyInstance.y);
  mesh.position.set(world.x, enemyBaseY(enemyInstance), world.z);
  // Models are authored ~0.8u tall; scale up so they read at diorama zoom.
  const sc = enemyInstance.cfg?.isBoss ? 1.15 : 1.3;
  mesh.scale.setScalar(sc);
  const bar = fx.createHpBar();
  bar.position.y = (enemyInstance.cfg?.isBoss ? 2.4 : 1.05);
  bar.scale.setScalar(1 / sc);
  mesh.add(bar);
  scene.add(mesh);
  const entry = { mesh, logicEnemy: enemyInstance, bar, lastHp: enemyInstance.hp, prevX: world.x, prevZ: world.z };
  enemyVisualById.set(enemyInstance.id, entry);
  return entry;
}

function removeEnemyMesh(enemyId) {
  const entry = enemyVisualById.get(enemyId);
  if (!entry) return;
  scene.remove(entry.mesh);
  enemyVisualById.delete(enemyId);
}

// ---------------------------------------------------------------------------
// Projectiles: per-tower-type visuals mirroring game.projectilePool.active.
// Height is interpolated from the firing tower's muzzle down to the target
// so shots visibly leave the barrel instead of sliding along the ground.
// ---------------------------------------------------------------------------
const PROJ_POOL = 64;
const projGeo = {
  balista: (() => { const g = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6); g.rotateX(Math.PI / 2); return g; })(),
  cannon: new THREE.SphereGeometry(0.16, 12, 8),
  catapult: new THREE.DodecahedronGeometry(0.24, 0),
  frost: new THREE.OctahedronGeometry(0.16, 0),
};
const projMat = {
  balista: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.5, metalness: 0.2, emissive: 0x3a2008 }),
  cannon: new THREE.MeshStandardMaterial({ color: 0x2b2d3a, roughness: 0.35, metalness: 0.8 }),
  catapult: new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.9, flatShading: true }),
  frost: new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x4fd8ff, emissiveIntensity: 1.6, roughness: 0.2 }),
};
const projVisuals = [];
for (let i = 0; i < PROJ_POOL; i++) {
  const m = new THREE.Mesh(projGeo.cannon, projMat.cannon);
  m.visible = false;
  m.castShadow = true;
  scene.add(m);
  projVisuals.push(m);
}
const projMeta = new WeakMap(); // projectile obj -> { type, startDist, muzzleY, lastPos }
const towerById = (id) => game.towers.find((t) => t.id === id);
const _v = new THREE.Vector3();

function syncProjectileVisuals() {
  const active = game.projectilePool.active;
  const seen = new Set();
  for (let i = 0; i < projVisuals.length; i++) {
    const mesh = projVisuals[i];
    const p = active[i];
    if (!p) { mesh.visible = false; continue; }
    seen.add(p);
    let meta = projMeta.get(p);
    if (!meta) {
      const src = towerById(p.sourceTowerId);
      const tmesh = src && towerVisualById.get(src.id);
      let muzzleY = 1.8;
      if (tmesh && tmesh.userData.muzzle) {
        tmesh.userData.muzzle.getWorldPosition(_v);
        muzzleY = _v.y;
      }
      const tx = p.targetEnemy ? p.targetEnemy.x : p.targetX;
      const ty = p.targetEnemy ? p.targetEnemy.y : p.targetY;
      meta = {
        type: src ? src.type : 'cannon',
        startDist: Math.hypot(tx - p.x, ty - p.y) || 1,
        muzzleY,
        targetY: p.targetEnemy ? enemyBaseY(p.targetEnemy) + 0.45 : 0.6,
        splash: p.splash || 0,
        last: new THREE.Vector3(),
      };
      projMeta.set(p, meta);
      inflight.add(p);
    }
    mesh.geometry = projGeo[meta.type] || projGeo.cannon;
    mesh.material = projMat[meta.type] || projMat.cannon;
    mesh.visible = true;
    if (p.type === 'arc') {
      const frac = p.arcTime > 0 ? Math.min(1, p.arcElapsed / p.arcTime) : 1;
      const world = gridToWorld(p.x + (p.targetX - p.x) * frac, p.y + (p.targetY - p.y) * frac);
      const y = meta.muzzleY + (0.6 - meta.muzzleY) * frac + Math.sin(Math.PI * frac) * 3.2;
      mesh.position.set(world.x, y, world.z);
      mesh.rotation.x += 0.15; mesh.rotation.z += 0.1;
    } else {
      const world = gridToWorld(p.x, p.y);
      const tx = p.targetEnemy ? p.targetEnemy.x : p.x;
      const ty = p.targetEnemy ? p.targetEnemy.y : p.y;
      const remain = Math.min(1, Math.hypot(tx - p.x, ty - p.y) / meta.startDist);
      const y = meta.targetY + (meta.muzzleY - meta.targetY) * remain;
      _v.set(world.x, y, world.z);
      if (meta.type === 'balista' && meta.last.lengthSq() > 0) {
        mesh.lookAt(_v.clone().multiplyScalar(2).sub(meta.last));
      }
      if (meta.type === 'frost') { mesh.rotation.y += 0.3; }
      mesh.position.copy(_v);
    }
    meta.last.copy(mesh.position);
  }
  // projectiles that vanished this frame = impacts
  for (const p of inflight) {
    if (seen.has(p) && p.active) continue;
    const meta = projMeta.get(p);
    inflight.delete(p);
    if (!meta) continue;
    fx.impact(meta.last, meta.type, meta.splash);
  }
}
const inflight = new Set();

// ---------------------------------------------------------------------------
// Selection highlight + range ring
// ---------------------------------------------------------------------------
const selectionRing = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 1.02, 40),
  new THREE.MeshBasicMaterial({ color: 0xffb627, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
);
selectionRing.rotation.x = -Math.PI / 2;
selectionRing.visible = false;
scene.add(selectionRing);

const rangeDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false })
);
rangeDisc.rotation.x = -Math.PI / 2;
rangeDisc.visible = false;
scene.add(rangeDisc);
const rangeEdge = new THREE.Mesh(
  new THREE.RingGeometry(0.975, 1, 96),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
);
rangeEdge.rotation.x = -Math.PI / 2;
rangeEdge.visible = false;
scene.add(rangeEdge);

function showRange(x, y, z, rangeGridUnits, color = 0xffffff) {
  const r = rangeGridUnits * TILE_SIZE;
  rangeDisc.position.set(x, y + 0.03, z);
  rangeEdge.position.set(x, y + 0.035, z);
  rangeDisc.scale.setScalar(r);
  rangeEdge.scale.setScalar(r);
  rangeDisc.material.color.set(color);
  rangeEdge.material.color.set(color);
  rangeDisc.visible = rangeEdge.visible = true;
}
function hideRange() { rangeDisc.visible = rangeEdge.visible = false; }

const buildGhostRing = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 0.95, 32),
  new THREE.MeshBasicMaterial({ color: 0x9ef01a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
);
buildGhostRing.rotation.x = -Math.PI / 2;
buildGhostRing.visible = false;
scene.add(buildGhostRing);

let selectedTowerMesh = null;

function clearSelection() {
  selectedTowerMesh = null;
  selectionRing.visible = false;
  buildGhostRing.visible = false;
  hideRange();
  closeRadialMenu(container);
}

function iconImg(id) {
  return `<img src="${TOWER_ICON[id]}" alt="" style="width:40px;height:40px;object-fit:contain;" />`;
}

function towerChoices() {
  return TOWER_KEYS.map((id) => {
    const cost = TOWER_TYPES[id].cost;
    const afford = game.economy.canAfford(cost);
    return {
      id,
      label: `${TOWER_TYPES[id].name} – ${cost} zlata`,
      name: TOWER_TYPES[id].name,
      price: cost,
      priceBad: !afford,
      disabled: !afford,
      blockedMsg: `Nedostatok zlata (${cost})`,
      onBlocked: showHudToast,
      icon: iconImg(id),
    };
  });
}

function towerActions(t) {
  const up = t.getUpgradeCost();
  const sell = t.sell();
  return [
    up == null
      ? { id: 'upgrade', label: 'Max. úroveň', name: 'MAX', icon: '★', disabled: true, blockedMsg: 'Veža je na max. úrovni', onBlocked: showHudToast }
      : { id: 'upgrade', label: `Vylepšiť – ${up} zlata`, name: `Úr. ${t.level + 1}`, icon: '⬆', price: up, priceBad: !game.economy.canAfford(up), disabled: !game.economy.canAfford(up), blockedMsg: `Nedostatok zlata (${up})`, onBlocked: showHudToast },
    { id: 'target', label: 'Cieľenie', name: t.strategy === 'first' ? 'Prvý' : 'Najsilnejší', icon: '◎' },
    { id: 'sell', label: `Predať za ${sell}`, name: 'Predať', icon: '✕', price: `+${sell}` },
  ];
}

function showHudToast(msg) {
  const hudToast = document.getElementById('hudToast');
  if (!hudToast) return;
  hudToast.textContent = msg;
  hudToast.classList.add('show');
  clearTimeout(hudToast._timer);
  hudToast._timer = setTimeout(() => hudToast.classList.remove('show'), 1800);
}

function tileOccupied(tileObj) {
  return [...towerVisualById.values()].some((m) =>
    Math.abs(m.position.x - tileObj.position.x) < 0.01 && Math.abs(m.position.z - tileObj.position.z) < 0.01);
}

function onSelectTile(tileObj, screenX, screenY) {
  clearSelection();
  if (!tileObj.userData.isBuildable) return;
  if (tileOccupied(tileObj)) return;
  const surfaceY = tileObj.userData.topSurfaceY || 0.5;
  buildGhostRing.position.set(tileObj.position.x, surfaceY + 0.02, tileObj.position.z);
  buildGhostRing.visible = true;
  showRange(tileObj.position.x, surfaceY, tileObj.position.z, TOWER_TYPES.balista.range, 0x9ef01a);
  const rect = container.getBoundingClientRect();
  openRadialMenu(
    container,
    { x: screenX - rect.left, y: screenY - rect.top },
    towerChoices(),
    (id) => {
      const tower = game.buildTower(id, tileObj.userData.centeredX, tileObj.userData.centeredZ);
      if (tower) {
        spawnTowerMesh(tower, tileObj.userData.centeredX, tileObj.userData.centeredZ, surfaceY);
        showHudToast(`${TOWER_TYPES[id].name} postavená (−${TOWER_TYPES[id].cost})`);
      } else {
        showHudToast('Nedostatok zlata');
      }
      clearSelection();
    },
    clearSelection
  );
  // hovering a choice previews that tower's range
  container.querySelectorAll('.radial-menu-item').forEach((btn, i) => {
    btn.addEventListener('pointerenter', () =>
      showRange(tileObj.position.x, surfaceY, tileObj.position.z, TOWER_TYPES[TOWER_KEYS[i]].range, 0x9ef01a));
  });
}

function onSelectTower(towerObj) {
  clearSelection();
  selectedTowerMesh = towerObj;
  selectionRing.position.set(towerObj.position.x, towerObj.position.y + 0.03, towerObj.position.z);
  selectionRing.visible = true;
  const logicTower = towerObj.userData.logicTower;
  showRange(towerObj.position.x, towerObj.position.y, towerObj.position.z, logicTower.getStats().range, 0xffb627);
  const rect = container.getBoundingClientRect();
  const screenPos = new THREE.Vector3().copy(towerObj.position).project(camera);
  const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
  const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;
  openRadialMenu(
    container,
    { x: sx, y: sy },
    towerActions(logicTower),
    (id) => {
      if (id === 'upgrade') {
        const cost = logicTower.getUpgradeCost();
        if (cost == null) { showHudToast('Veža je na max. úrovni'); }
        else if (!game.economy.canAfford(cost)) { showHudToast('Nedostatok zlata'); }
        else { game.upgradeTower(logicTower); showHudToast(`Vylepšené na úroveň ${logicTower.level} (−${cost})`); }
      } else if (id === 'target') {
        logicTower.strategy = logicTower.strategy === 'first' ? 'strongest' : 'first';
        showHudToast(`Cieľenie: ${logicTower.strategy === 'first' ? 'Prvý' : 'Najsilnejší'}`);
      } else if (id === 'sell') {
        const refund = logicTower.sell();
        game.sellTower(logicTower);
        removeTowerMesh(logicTower);
        fx.goldLabel(towerObj.position, refund);
        showHudToast(`Predané za ${refund}`);
      }
      clearSelection();
    },
    clearSelection
  );
}

const vignette = createVignetteOverlay(container);

const inputController = createInputController({
  domElement: renderer.domElement,
  camera,
  dist: CAM_DIST,
  tileGrid,
  towers: towerMeshes,
  onSelectTile,
  onSelectTower,
  onDeselect: clearSelection,
});

function resize() {
  const { w, h } = sceneAreaSize();
  renderer.setSize(w, h);
  inputController.applyCamera();
  vignette.resize(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
resize();

function setTheme(key) {
  themeKey = key;
  theme = applyTheme(lightRig, scene, key);
  updateSkyDome(sky, theme.skyTop, theme.skyBottom, theme.skyHorizon);
  retintTileGrid(tileGrid, theme);
  retintGroundClutter(groundClutter, theme);
  retintDioramaBase(dioramaBase, theme.stone);
  towerMeshes.forEach((tower) => retintTowerModel(tower, theme));
  for (const { mesh } of enemyVisualById.values()) {
    if (mesh.userData.setZombie) mesh.userData.setZombie(key === 'zombie');
  }

  const topHex = '#' + theme.skyTop.toString(16).padStart(6, '0');
  const bottomHex = '#' + theme.skyBottom.toString(16).padStart(6, '0');
  document.body.style.background = `linear-gradient(to bottom, ${topHex}, ${bottomHex})`;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); document.getElementById('startWaveBtn')?.click(); }
  if (e.code === 'KeyF') document.getElementById('speedBtn')?.click();
  if (e.code === 'KeyP') document.getElementById('pauseBtn')?.click();
});

// ---------------------------------------------------------------------------
// HUD <-> Game state sync
// ---------------------------------------------------------------------------
let prevLives = game.lives;
let prevState = game.state;

function updateHud() {
  const livesEl = document.getElementById('livesValue');
  if (livesEl) livesEl.textContent = `${game.lives}/${START_LIVES}`;
  const goldEl = document.getElementById('goldValue');
  if (goldEl) goldEl.textContent = `${game.gold}`;
  const waveEl = document.getElementById('waveValue');
  // Wave numerator/denominator are LEVEL-LOCAL (nextMapWaveIdx resets to 0
  // each level; game.waveNumber itself keeps climbing across both levels
  // for HP-scaling purposes, see hpForWave() in entities/Enemy.js, so it
  // isn't what the HUD should show once there's more than one level).
  if (waveEl) waveEl.textContent = `L${currentLevelIdx + 1} · ${nextMapWaveIdx}/${currentWaves().length}`;

  if (game.lives < prevLives) {
    const flash = document.getElementById('hudLivesFlash');
    if (flash) {
      flash.classList.add('show');
      clearTimeout(flash._timer);
      flash._timer = setTimeout(() => flash.classList.remove('show'), 450);
    }
  }
  prevLives = game.lives;

  if (game.state !== prevState) {
    if (game.state === GAME_STATES.LOST) showHudToast('Základňa padla — hra skončila');
    if (game.state === GAME_STATES.WON) {
      const levelDone = nextMapWaveIdx >= currentWaves().length;
      if (levelDone) {
        // All of this level's waves are sent AND the field is clear: either
        // there's a next level to unlock, or (last level) this is the real
        // campaign win. index.html/preview.html listen for this event to
        // show the "Ďalší level"/final-win modal (GDD progression, task).
        const isFinalLevel = currentLevelIdx >= LEVELS.length - 1;
        window.dispatchEvent(new CustomEvent('bastiongrid:levelcomplete', {
          detail: { final: isFinalLevel, level: currentLevelIdx + 1, totalLevels: LEVELS.length },
        }));
      } else {
        showHudToast(`Vlna ${nextMapWaveIdx} prežitá!`);
      }
    }
    prevState = game.state;
  }
}

// Side panel "Náhľad vlny": real contents of the next map wave (GDD 5.5).
const ENEMY_ICON = {
  cvakac: 'enemy-cvakac', vrtiak: 'enemy-vrtiak', kotlar: 'enemy-kotlar',
  vazka: 'enemy-mosadzna-vazka', navijac: 'enemy-navijac', boss_kukucka: 'enemy-kukuckovy-kolos',
  // Level 2 boss reuses the base boss's icon art -- no separate asset,
  // the model itself is what reads as the bigger/tougher variant in-scene.
  boss_kukucka_major: 'enemy-kukuckovy-kolos',
};
let shownPreviewIdx = -1;
let shownPreviewLevel = -1;
function updateWavePreview() {
  if (shownPreviewIdx === nextMapWaveIdx && shownPreviewLevel === currentLevelIdx) return;
  shownPreviewIdx = nextMapWaveIdx;
  shownPreviewLevel = currentLevelIdx;
  const list = document.querySelector('#sidePanel .wave-list');
  const note = document.querySelector('#sidePanel .side-note');
  if (!list) return;
  const waves = currentWaves();
  const mw = waves[nextMapWaveIdx];
  if (!mw) { list.innerHTML = ''; if (note) note.textContent = 'Žiadne ďalšie vlny.'; return; }
  if (note) note.textContent = `Level ${currentLevelIdx + 1} · Vlna ${mw.index} z ${waves.length}`;
  const counts = {};
  for (const g of mw.enemies) {
    const ty = ENEMY_TYPES[g.type] ? g.type : (MAP_ENEMY_ALIAS[g.type] || 'cvakac');
    counts[ty] = (counts[ty] || 0) + g.count;
  }
  list.innerHTML = Object.entries(counts).map(([ty, n]) =>
    `<div class="wave-item"><img src="assets/ui/${ENEMY_ICON[ty]}.png" alt=""><span>${ENEMY_TYPES[ty]?.name || ty}</span><span class="wave-count">×${n}</span></div>`).join('');
}

let speedMultiplier = 1;
let paused = false;
let simTime = 0;

const clock = new THREE.Clock();
const _aim = new THREE.Vector3();

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const simDt = paused ? 0 : dt * speedMultiplier;
  simTime += simDt;
  const t = simTime;

  inputController.update(dt);

  if (simDt > 0) game.step(simDt);
  updateHud();
  updateWavePreview();

  // --- towers: pop-in, level swaps, aiming, recoil ---
  for (const mesh of towerMeshes) {
    const ud = mesh.userData;
    const lt = ud.logicTower;
    const age = simTime - (ud.spawnAt ?? 0);
    const POP = 0.35;
    let scale = 1;
    if (age < POP) {
      const p = age / POP;
      scale = p < 0.7 ? (p / 0.7) * 1.15 : 1.15 - ((p - 0.7) / 0.3) * 0.15;
    }
    mesh.scale.setScalar(Math.max(0.001, scale * 1.2));

    if (lt.level !== ud.shownLevel) {
      const keepYaw = ud.turret ? ud.turret.rotation.y : 0;
      if (ud.setLevel) ud.setLevel(lt.level);
      if (ud.turret) ud.turret.rotation.y = keepYaw;
      ud.shownLevel = lt.level;
      ud.spawnAt = simTime; // re-pop on upgrade
      fx.impact(_aim.set(mesh.position.x, mesh.position.y + 1.2, mesh.position.z), 'frost', 0);
    }

    const turret = ud.turret;
    if (turret) {
      const tgt = lt.aimTarget && lt.aimTarget.alive ? lt.aimTarget : null;
      if (tgt) {
        const w = gridToWorld(tgt.x, tgt.y);
        const desired = Math.atan2(w.x - mesh.position.x, w.z - mesh.position.z);
        turret.rotation.y = angleLerp(turret.rotation.y, desired, 1 - Math.exp(-14 * dt));
      } else {
        turret.rotation.y += Math.sin(t * 0.5 + lt.id) * 0.15 * dt; // slow idle scan
      }
    }
    if ((lt.shotCount || 0) !== ud.lastShot) {
      ud.lastShot = lt.shotCount || 0;
      if (ud.fire) ud.fire();
      if (ud.muzzle) { ud.muzzle.getWorldPosition(_aim); fx.muzzleFlash(_aim, lt.type); }
    }
    if (ud.update) ud.update(simDt, t);
  }

  // --- enemies: create/move/face/flash/hp, remove ---
  const liveIds = new Set();
  for (const enemy of game.enemies) {
    liveIds.add(enemy.id);
    let entry = enemyVisualById.get(enemy.id);
    if (!entry) entry = spawnEnemyMesh(enemy);
    const m = entry.mesh;
    const world = gridToWorld(enemy.x, enemy.y);
    const dx = world.x - entry.prevX, dz = world.z - entry.prevZ;
    if (dx * dx + dz * dz > 1e-6) {
      m.rotation.y = angleLerp(m.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-12 * dt));
    }
    entry.prevX = world.x; entry.prevZ = world.z;
    m.position.x = world.x;
    m.position.z = world.z;
    m.position.y = enemyBaseY(enemy) + (enemy.flying ? Math.sin(t * 3 + enemy.id) * 0.12 : 0);
    if (enemy.hp < entry.lastHp && m.userData.hitFlash) m.userData.hitFlash();
    entry.lastHp = enemy.hp;
    const frac = enemy.hp / enemy.maxHp;
    if (m.userData.setHpFrac) m.userData.setHpFrac(frac);
    entry.bar.userData.set(frac);
    const speedFactor = simDt > 0 ? (enemy.getEffectiveSpeed() / (enemy.baseSpeed || 1)) : 0;
    if (m.userData.update) m.userData.update(simDt, t, speedFactor);
  }
  for (const [id, entry] of [...enemyVisualById.entries()]) {
    if (liveIds.has(id)) continue;
    if (entry.logicEnemy.alive === false) {
      const p = entry.mesh.position.clone();
      p.y = enemyBaseY(entry.logicEnemy) === 0.5 ? 0.5 : p.y;
      fx.death(p, themeKey === 'zombie', !!entry.logicEnemy.cfg?.isBoss);
      fx.goldLabel(entry.mesh.position, entry.logicEnemy.bounty);
    }
    removeEnemyMesh(id);
  }

  syncProjectileVisuals();
  fx.update(simDt || dt * 0.0001);

  if (selectionRing.visible) selectionRing.scale.setScalar(1 + Math.sin(t * 4) * 0.04);
  if (buildGhostRing.visible) buildGhostRing.scale.setScalar(1 + Math.sin(performance.now() / 200) * 0.05);

  vignette.render(theme.vignette, themeKey === 'zombie' ? '#05070f' : '#1a2a33');

  if (!document.documentElement.classList.contains('menu-open')) renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// Exposed for index.html/preview.html's dev UI buttons (+ debug hooks used by
// the automated screenshot harness).
window.__bastionGrid = {
  setTheme,
  rotateCamera: () => { rotateIso90(camera, CAM_DIST); inputController.applyCamera(); },
  setSpeed: (mult) => { speedMultiplier = mult; },
  togglePause: () => {
    paused = !paused;
    return paused;
  },
  startNextWave: () => {
    const waves = currentWaves();
    if (nextMapWaveIdx >= waves.length) {
      showHudToast('Všetky vlny z mapy už boli odoslané');
      return null;
    }
    const mapWave = waves[nextMapWaveIdx];
    nextMapWaveIdx += 1;
    game.queueWave(buildSpawnListForMapWave(mapWave));
    showHudToast(`Vlna ${mapWave.index} spustená`);
    return mapWave.index;
  },
  // Level progression (task: level 2 + boss). Called by index.html/
  // preview.html's "Ďalší level" button once bastiongrid:levelcomplete
  // fires with final:false. Same Game instance/lives/gold/path carry over
  // -- only the wave table (and HP-scaling continues climbing via
  // game.waveNumber, unaffected) switches to the next, harder map.
  nextLevel: () => {
    if (currentLevelIdx >= LEVELS.length - 1) return false;
    currentLevelIdx += 1;
    nextMapWaveIdx = 0;
    return true;
  },
  getLevelInfo: () => ({
    levelIdx: currentLevelIdx,
    levelCount: LEVELS.length,
    waveIdx: nextMapWaveIdx,
    waveCount: currentWaves().length,
    isFinalLevel: currentLevelIdx >= LEVELS.length - 1,
  }),
  game,
  debugBuild(type, gx, gz, level = 1) {
    const tile = tileGrid.children.find((c) => c.userData.gridX === gx && c.userData.gridZ === gz);
    if (!tile || !tile.userData.isBuildable || tileOccupied(tile)) return false;
    game.economy.gold = Math.max(game.economy.gold, 9999);
    const tw = game.buildTower(type, tile.userData.centeredX, tile.userData.centeredZ);
    if (!tw) return false;
    while (tw.level < level) game.upgradeTower(tw);
    spawnTowerMesh(tw, tile.userData.centeredX, tile.userData.centeredZ, tile.userData.topSurfaceY || 0.5);
    return true;
  },
  debugView(zoom, x = 0, z = 0) { setPanTarget(x, z); inputController.setZoomScale(zoom); },
  debugWave(types, delay = 0.6) {
    const list = [];
    types.forEach((ty, i) => list.push({ type: ty, delay: i === 0 ? 0.3 : delay }));
    game.queueWave(list);
  },
  // Test/verification helper only (used by the automated screenshot
  // harness): skips straight to "this level's waves are all sent and the
  // field is clear" so the WON/levelcomplete flow fires on the next frame,
  // without having to simulate every wave for real.
  debugSkipLevel() {
    nextMapWaveIdx = currentWaves().length;
    game.enemies = [];
    game.waveQueue = [];
    game.waveRunner = null;
    game.state = GAME_STATES.WON;
  },
};
