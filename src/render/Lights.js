// Lights.js
// Theme definitions (Basic/day vs Zombie/night) and the light rig that
// drives the mood contrast called out in the GDD: warm/bright vs
// cold/low-contrast with heavier vignette.

import * as THREE from 'three';

export const THEMES = {
  basic: {
    // Clean daylight sky gradient (screen-space, see Effects.createSkyDome):
    // skyTop = top of the screen, skyHorizon = middle band, skyBottom = bottom.
    skyTop: 0x5fa8e0,
    skyBottom: 0xeef6f1,
    skyHorizon: 0xc4e3f2,
    grass: 0x74bb4c,
    road: 0xd9b47c,
    stone: 0xb8b8c2,
    playerAccent: 0xffb627,
    enemyAccent: 0xe4572e,
    sunColor: 0xfff0d8,
    sunIntensity: 2.6,
    hemiSky: 0xcfe6ff,
    hemiGround: 0x6b8f4a,
    ambientIntensity: 1.05,
    fillIntensity: 0.0,
    rimColor: 0xbfe0ff,
    rimIntensity: 0.35,
    sunPosition: [-24, 34, 8],
    fogType: 'linear',
    fogColor: 0xd9f2ff,
    fogNear: 300,
    fogFar: 600,
    vignette: 0.16,
    // Environment palette (World.js: lawn shader, island cliff, decor).
    env: {
      night: false,
      grassA: 0x5e9e3c,      // shaded lawn patches
      grassB: 0x78b94a,      // main lawn
      grassC: 0x9ccc5a,      // sunny yellow-green clumps
      gridLine: 0.07,        // faint buildable-cell hint (0 = none)
      dirt: 0xdcb880,
      dirtDark: 0xbf9361,
      cobble: 0xb4aca0,
      cobbleDark: 0x8f877d,
      grassLip: 0x5f9a3c,
      dirtLip: 0xb98d5c,
      earth: 0x91603d,
      earthDark: 0x6f4630,
      rock: 0x8c8780,
      rockLight: 0xaaa59c,
      rockDark: 0x67636a,
      moss: 0x86c257,
      pine: 0x2f7a4c,
      pineLight: 0x3e9257,
      foliage: 0x5aa83f,
      foliageLight: 0x7dc24f,
      trunk: 0x7a5034,
      bush: 0x4f9a3a,
      bushLight: 0x68b244,
      tuft: 0x86c451,
      flowerA: 0xfff4e0,
      flowerB: 0xffd23f,
      flowerC: 0xf28fb0,
      mushStem: 0xf0e6d2,
      mushCap: 0xd2452f,
      wood: 0xa8743f,
      woodDark: 0x6e4a2c,
      metal: 0x3b3d44,
      glow: 0xffe3a0,
      toxic: 0x9ef01a,
      toxicAmt: 0,
      fogColor: 0xffffff,
      fogOpacity: 0,
    },
  },
  zombie: {
    skyTop: 0x0e1430,
    skyBottom: 0x3b4f78,
    skyHorizon: 0x22315a,
    grass: 0x45705a,
    road: 0x7a7266,
    stone: 0x4a5a6a,
    infection: 0x9ef01a,
    rot: 0x4f772d,
    fire: 0xff7b00,
    // Cold blue moonlight, but bright enough that the board reads clearly:
    // readability over realistic darkness.
    sunColor: 0xa9c4ff,
    sunIntensity: 2.5,
    hemiSky: 0x7f97d6,
    hemiGround: 0x2c3d3a,
    ambientIntensity: 1.1,
    fillIntensity: 0.18,
    rimColor: 0x9ef0c8,
    rimIntensity: 0.35,
    sunPosition: [-18, 32, -14],
    fogType: 'exp2',
    fogColor: 0x1b2340,
    fogDensity: 0.004,
    vignette: 0.3,
    env: {
      night: true,
      grassA: 0x3b6852,
      grassB: 0x4d7d66,
      grassC: 0x62906c,
      gridLine: 0.09,
      dirt: 0x9c917f,
      dirtDark: 0x7a7063,
      cobble: 0x7d8290,
      cobbleDark: 0x5c606c,
      grassLip: 0x3a604e,
      dirtLip: 0x6c655c,
      earth: 0x5a4a44,
      earthDark: 0x43373a,
      rock: 0x5f6474,
      rockLight: 0x777d8e,
      rockDark: 0x444858,
      moss: 0x55805e,
      pine: 0x2e5a4c,
      pineLight: 0x3a6a56,
      foliage: 0x4a7560,
      foliageLight: 0x5b866a,
      trunk: 0x4d3c36,
      bush: 0x41695a,
      bushLight: 0x4f7a62,
      tuft: 0x5a8868,
      flowerA: 0xb8c6e6,
      flowerB: 0x9ef01a,
      flowerC: 0x8f7fc0,
      mushStem: 0xc9d6c0,
      mushCap: 0x9ef01a,
      wood: 0x6b5848,
      woodDark: 0x463a33,
      metal: 0x2b2e38,
      glow: 0xb8ff5a,
      toxic: 0x9ef01a,
      toxicAmt: 0.1,
      fogColor: 0x9fb4d8,
      fogOpacity: 0.55,
    },
  },
};

/**
 * Build the scene's light rig for the given theme: hemisphere sky/ground
 * ambient, one shadow-casting key light (sun / moon) with a shadow frustum
 * fitted tightly around the ~30x30 floating island, and a cheap rim light.
 */
function makeFog(theme) {
  if (theme.fogType === 'exp2') {
    return new THREE.FogExp2(theme.fogColor, theme.fogDensity);
  }
  return new THREE.Fog(theme.fogColor, theme.fogNear, theme.fogFar);
}

// Shadow frustum half-size: island radius is ~15 (corners ~19 on the
// diagonal); the light looks mostly down, so +-21 covers island + tree
// tops while keeping ~10 shadow-map texels per world unit at 2048.
const SHADOW_HALF = 21;

function placeKeyLight(sun, theme) {
  const p = theme.sunPosition || [-24, 34, 8];
  sun.position.set(p[0], p[1], p[2]);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
}

export function createLights(scene, renderer, themeKey = 'basic') {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const theme = THEMES[themeKey];

  const hemi = new THREE.HemisphereLight(theme.hemiSky ?? theme.skyTop, theme.hemiGround ?? theme.grass, theme.ambientIntensity);
  scene.add(hemi);

  // Neutral fill floor (mainly for the night theme's readability).
  const fill = new THREE.AmbientLight(0xffffff, theme.fillIntensity ?? 0);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 1.6;
  scene.add(sun);
  scene.add(sun.target);
  placeKeyLight(sun, theme);

  // Rim/kicker light from behind the board (no shadow, cheap): separates
  // silhouettes from the ground.
  const rim = new THREE.DirectionalLight(theme.rimColor ?? 0xffffff, theme.rimIntensity ?? 0);
  rim.position.set(18, 14, -22);
  scene.add(rim);

  scene.fog = makeFog(theme);

  return { hemi, sun, fill, rim, theme: themeKey };
}

/** Swap the whole rig to a different theme in place (no re-creation). */
export function applyTheme(lightRig, scene, themeKey) {
  const theme = THEMES[themeKey];

  lightRig.hemi.color.set(theme.hemiSky ?? theme.skyTop);
  lightRig.hemi.groundColor.set(theme.hemiGround ?? theme.grass);
  lightRig.hemi.intensity = theme.ambientIntensity;
  lightRig.fill.intensity = theme.fillIntensity ?? 0;

  lightRig.sun.color.set(theme.sunColor);
  lightRig.sun.intensity = theme.sunIntensity;
  placeKeyLight(lightRig.sun, theme);

  lightRig.rim.color.set(theme.rimColor ?? 0xffffff);
  lightRig.rim.intensity = theme.rimIntensity ?? 0;

  scene.fog = makeFog(theme);

  lightRig.theme = themeKey;
  return theme;
}
