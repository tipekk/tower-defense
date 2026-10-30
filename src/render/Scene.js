// Scene.js
// Procedural geometry for the diorama: beveled tile grid, stone pedestal,
// the "Balista" tower, and the "Cvakac" enemy whose same mesh doubles as
// the "Klicok" zombie variant (patina tint via onBeforeCompile + extra
// mushroom-growth geometry, toggled at runtime, no second model).

import * as THREE from 'three';
import { createShadowBlob } from './Effects.js';

// ---------------------------------------------------------------------------
// World / environment (tiles, lawn + road ground, floating-island base, edge
// decor, night fog) lives in World.js; re-exported here under the original
// names so main.js and everything else keep importing from Scene.js.
// ---------------------------------------------------------------------------
export {
  TILE_SIZE,
  createTile, createTileGrid, retintTileGrid,
  createDioramaBase, retintDioramaBase,
  createGroundClutter, retintGroundClutter,
} from './World.js';

// ---------------------------------------------------------------------------
// Tintable material helper: lets Basic <-> Zombie recoloring happen on the
// SAME material/mesh at runtime via a shader patch (onBeforeCompile),
// instead of swapping to a second set of materials/meshes.
// ---------------------------------------------------------------------------

function makeTintableMaterial(baseColorHex, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: baseColorHex,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.1,
  });
  mat.userData.pendingTint = { color: new THREE.Color(0x6b8f71), amount: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tintColor = { value: mat.userData.pendingTint.color };
    shader.uniforms.tintAmount = { value: mat.userData.pendingTint.amount };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 tintColor;\nuniform float tintAmount;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, tintColor, tintAmount);');
    mat.userData.shader = shader;
  };
  // Force a distinct compiled program per material instance.
  mat.customProgramCacheKey = () => `tintable-${mat.uuid}`;
  return mat;
}

function setTint(mat, colorHex, amount) {
  mat.userData.pendingTint.color.set(colorHex);
  mat.userData.pendingTint.amount = amount;
  if (mat.userData.shader) {
    mat.userData.shader.uniforms.tintColor.value.set(colorHex);
    mat.userData.shader.uniforms.tintAmount.value = amount;
  }
}

// ---------------------------------------------------------------------------
// "Balista" tower: stone plinth + carved drum + wood/brass superstructure +
// a turret barrel with ring/rivet details. Several primitives layered to
// build a real silhouette instead of one cone-on-a-cylinder.
// ---------------------------------------------------------------------------

export function createBalistaTower(theme) {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.9 });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.stone).multiplyScalar(0.55),
    roughness: 0.95,
  });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xcf9f2e, roughness: 0.22, metalness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.62, metalness: 0.05 });

  // Octagonal plinth.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.5, 8), stoneMat);
  plinth.position.y = 0.25;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // Dark foot ring = cheap AO at the base.
  const footRing = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.06, 8), darkStoneMat);
  footRing.position.y = 0.03;
  group.add(footRing);

  // Carved stone drum with two groove rings.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.9, 10), stoneMat);
  drum.position.y = 0.95;
  drum.castShadow = true;
  group.add(drum);
  for (let i = 0; i < 2; i++) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 6, 16), darkStoneMat);
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 0.65 + i * 0.45;
    group.add(groove);
  }

  // Wooden deck + brass pivot housing.
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.2, 10), woodMat);
  deck.position.y = 1.5;
  deck.castShadow = true;
  group.add(deck);

  const pivotHousing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.7), brassMat);
  pivotHousing.position.y = 1.75;
  pivotHousing.castShadow = true;
  group.add(pivotHousing);

  // Turret: rotatable barrel assembly with rings/rivets for metal detail.
  const turret = new THREE.Group();
  turret.position.y = 1.75;

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.3, 10), brassMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.6;
  barrel.castShadow = true;
  turret.add(barrel);

  for (let i = 0; i < 3; i++) {
    const rivetRing = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 12), woodMat);
    rivetRing.rotation.x = Math.PI / 2;
    rivetRing.position.z = 0.1 + i * 0.4;
    turret.add(rivetRing);
  }
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), brassMat);
    rivet.position.set(Math.cos(ang) * 0.12, 0, 0.3);
    rivet.rotation.x = Math.PI / 2;
    turret.add(rivet);
  }
  group.add(turret);

  // Cheap AO drop-shadow blob under the whole tower.
  const blob = createShadowBlob(0.95, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    turret,
    isTower: true,
    towerType: 'balista',
    materials: { stoneMat, darkStoneMat, brassMat, woodMat },
  };
  return group;
}

export function retintBalistaTower(tower, theme) {
  const { stoneMat, darkStoneMat } = tower.userData.materials;
  stoneMat.color.set(theme.stone);
  darkStoneMat.color.set(new THREE.Color(theme.stone).multiplyScalar(0.55));
}

// ---------------------------------------------------------------------------
// Mushroom growth (used only by the zombie variant): a tiny stem + glowing
// cap, added as real extra geometry at joint positions (not a shader-only
// effect), hidden/shown rather than rebuilt.
// ---------------------------------------------------------------------------

function createMushroomGrowth(stemHeight = 0.12) {
  const g = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4f772d, roughness: 0.85 });
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x9ef01a,
    emissive: 0x9ef01a,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, stemHeight, 6), stemMat);
  stem.position.y = stemHeight / 2;
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), capMat);
  cap.position.y = stemHeight;
  g.add(cap);
  return g;
}

// ---------------------------------------------------------------------------
// "Cvakac" enemy / "Klicok" zombie variant: one mesh, two looks.
//
// Task Q rebuild: the previous version (plain round sphere "belly" + a
// bright-orange dome-sliced "chest plate" sitting on its front like a beak,
// pale round head, thin dark legs ending in flat paddle feet) is EXACTLY a
// duck silhouette -- which is what the user meant by "prijebane kacky"
// ("fucked-up ducks"). Rebuilt around a faceted octagonal canister torso
// (reads as a riveted machine body, not a soft round belly), shoulder
// pauldrons to break the torso/leg seam, a flat brass diamond chest badge
// instead of the beak-shaped dome, a boxy visored head instead of a bare
// round one, and clawed/wedge feet instead of flat paddles. Same rig
// (hinge-jointed legs, back-mounted winding key, setZombie/update API) so
// main.js's wiring and the walk-cycle math below don't need to change.
// ---------------------------------------------------------------------------

export function createClicker() {
  const group = new THREE.Group();

  const brass = makeTintableMaterial(0xcf9f2e, { metalness: 0.88, roughness: 0.24 });
  const enamel = makeTintableMaterial(0x8a3b1f, { roughness: 0.45, metalness: 0.15 });
  const shell = makeTintableMaterial(0xb7b0a0, { roughness: 0.55, metalness: 0.12 });
  const dark = makeTintableMaterial(0x24241f, { roughness: 0.6, metalness: 0.25 });

  // Octagonal canister torso (faceted, not round) -- the core fix for the
  // "duck belly" read. Slightly waisted: wider at the shoulders, narrower
  // at the hip, like a riveted boiler-suit torso.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.27, 0.56, 8), shell);
  torso.position.y = 0.55;
  torso.castShadow = true;
  group.add(torso);

  // Dark waist band + shoulder pauldrons break the torso/leg and
  // torso/head seams instead of letting it read as one smooth blob.
  const waistBand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8), dark);
  waistBand.position.y = 0.3;
  group.add(waistBand);
  [-1, 1].forEach((side) => {
    const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.22), brass);
    pauldron.position.set(side * 0.3, 0.78, 0.02);
    pauldron.rotation.z = side * 0.12;
    pauldron.castShadow = true;
    group.add(pauldron);
  });

  // Flat brass diamond chest badge -- replaces the old orange dome-slice
  // "beak" shape with a mounted plate read, plus a small dark gauge dot.
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.03), brass);
  badge.position.set(0, 0.56, 0.3);
  badge.rotation.z = Math.PI / 4;
  badge.castShadow = true;
  group.add(badge);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10), dark);
  gauge.rotation.x = Math.PI / 2;
  gauge.position.set(0, 0.56, 0.33);
  group.add(gauge);
  const gaugeNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.012), enamel);
  gaugeNeedle.position.set(0, 0.56, 0.35);
  gaugeNeedle.rotation.z = 0.5;
  group.add(gaugeNeedle);

  // Boxy visored head (not a bare round ball): octagonal block + a brass
  // rivet dome on top + a single dark visor slit with two small lens dots
  // instead of two bare eye dots floating on pale skin.
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.24, 8), shell);
  head.position.set(0, 0.99, 0.1);
  head.castShadow = true;
  group.add(head);
  const headCap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), brass);
  headCap.position.set(0, 1.1, 0.1);
  headCap.castShadow = true;
  group.add(headCap);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.04), dark);
  visor.position.set(0, 1.0, 0.22);
  group.add(visor);
  const lensGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8);
  const lensL = new THREE.Mesh(lensGeo, enamel);
  lensL.rotation.x = Math.PI / 2;
  lensL.position.set(-0.08, 1.0, 0.24);
  const lensR = lensL.clone();
  lensR.position.x = 0.08;
  group.add(lensL, lensR);

  // Big back-mounted winding key (shaft + torus winder + handle bar).
  const keyGroup = new THREE.Group();
  keyGroup.position.set(0, 0.68, -0.35);
  keyGroup.rotation.x = -0.5;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), brass);
  shaft.castShadow = true;
  keyGroup.add(shaft);
  const winder = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 16), brass);
  winder.position.y = 0.3;
  winder.rotation.x = Math.PI / 2;
  keyGroup.add(winder);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), brass);
  handle.position.set(0.15, 0.3, 0);
  keyGroup.add(handle);
  group.add(keyGroup);

  // Hinge-jointed legs: hip joint - thigh - angular knee joint - shin -
  // clawed wedge foot (replaces the flat "duck foot" paddle box).
  const legs = [];
  const growths = [];
  [-1, 1].forEach((side) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(0.2 * side, 0.2, 0);

    const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 6), dark);
    legGroup.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.22, 6), dark);
    thigh.position.y = -0.11;
    legGroup.add(thigh);
    const knee = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.1), brass);
    knee.position.y = -0.22;
    knee.rotation.y = Math.PI / 4;
    legGroup.add(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 6), dark);
    shin.position.y = -0.32;
    legGroup.add(shin);
    const foot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), dark);
    foot.position.set(0, -0.44, 0.06);
    foot.rotation.x = Math.PI * 0.42;
    foot.rotation.y = Math.PI / 4;
    legGroup.add(foot);

    group.add(legGroup);
    legs.push(legGroup);

    const growth = createMushroomGrowth();
    growth.position.copy(knee.position);
    growth.visible = false;
    legGroup.add(growth);
    growths.push(growth);
  });

  const shoulderGrowth = createMushroomGrowth(0.09);
  shoulderGrowth.position.set(0.28, 0.75, -0.1);
  shoulderGrowth.visible = false;
  group.add(shoulderGrowth);
  growths.push(shoulderGrowth);

  // Cheap AO drop-shadow blob under the enemy.
  const blob = createShadowBlob(0.45, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    legs,
    growths,
    materials: { brass, enamel, shell, dark },
    isZombie: false,
    walkPhase: Math.random() * Math.PI * 2,
  };

  // Toggle Basic "Cvakac" <-> Zombie "Klicok" on this SAME mesh.
  group.userData.setZombie = (on) => {
    group.userData.isZombie = on;
    const amount = on ? 1 : 0;
    setTint(brass, 0x5a6b4a, amount * 0.6);
    setTint(enamel, 0x3f5c33, amount);
    setTint(shell, 0x6b8f71, amount);
    setTint(dark, 0x2f3a2a, amount * 0.7);
    growths.forEach((g) => (g.visible = on));
  };

  // Basic: smooth sinusoidal side-to-side tilt (not just vertical bobbing).
  // Zombie: jerky, quantized "stop-motion" stepping.
  group.userData.update = (t) => {
    const ud = group.userData;
    let phase;
    if (ud.isZombie) {
      const stepRate = 6; // discrete steps per second-ish
      phase = (Math.floor(t * stepRate) / stepRate) * 3.0 + ud.walkPhase;
    } else {
      phase = t * 3.0 + ud.walkPhase;
    }
    const tiltAmount = ud.isZombie ? 0.2 : 0.14;
    group.rotation.z = Math.sin(phase) * tiltAmount;
    group.position.y = ud.isZombie ? 0 : Math.abs(Math.sin(phase * 2)) * 0.03;
    legs.forEach((leg, i) => {
      const legPhase = phase + i * Math.PI;
      leg.rotation.x = Math.sin(legPhase) * (ud.isZombie ? 0.5 : 0.35);
    });
    growths.forEach((g, i) => {
      if (g.visible) g.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.06);
    });
  };

  return group;
}

// ---------------------------------------------------------------------------
// Task O (art direction pass): distinct real 3D low-poly models for the
// other 3 MVP towers and 2 more MVP enemies, replacing the earlier approach
// of "one shared mesh (Balista / Clicker) + a flat billboard icon on top".
// Each model below is built only from primitives (Box/Cylinder/Sphere/Cone/
// Torus/Icosahedron) + GDD 9 palette colors, aiming for a silhouette that
// reads at a glance per GDD 5.4's "silueta pred detailom" rule -- see
// claude/ulohy-responsive.md entry O for the full rationale.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// "Kanón": a squat iron bombard on a two-wheel wooden carriage, fixed at a
// steep high-angle elevation with a flared brass-ringed muzzle. Short + wide
// + heavy silhouette, the opposite of Balista's tall vertical turret -- reads
// instantly as "slow, splash, close range" even in grey-box silhouette.
// ---------------------------------------------------------------------------
export function createCannonTower(theme) {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x363a46, roughness: 0.38, metalness: 0.82 });
  const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 0.5, metalness: 0.7 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xcf9f2e, roughness: 0.22, metalness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.65, metalness: 0.05 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.3, 8), stoneMat);
  plinth.position.y = 0.15;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.3), woodMat);
  deck.position.y = 0.42;
  deck.castShadow = true;
  group.add(deck);

  [-1, 1].forEach((side) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 12), darkIronMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.62, 0.42, 0);
    wheel.castShadow = true;
    group.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 8), brassMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(side * 0.62, 0.42, 0);
    group.add(hub);
  });

  // Turret: fixed steep elevation (short, lobbed range), swayed gently by
  // main.js's generic idle-rock hook -- not an aimable/rotating barrel.
  const turret = new THREE.Group();
  turret.position.y = 0.58;
  turret.rotation.x = -0.45;

  const barrelBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.0, 12), ironMat);
  barrelBody.rotation.x = Math.PI / 2;
  barrelBody.position.z = 0.4;
  barrelBody.castShadow = true;
  turret.add(barrelBody);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.22, 12), darkIronMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 0.9;
  turret.add(muzzle);

  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 14), brassMat);
  muzzleRing.rotation.x = Math.PI / 2;
  muzzleRing.position.z = 1.0;
  turret.add(muzzleRing);

  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 6, 12), brassMat);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.1 + i * 0.3;
    turret.add(band);
  }
  group.add(turret);

  const blob = createShadowBlob(1.0, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    turret,
    isTower: true,
    towerType: 'cannon',
    materials: { stoneMat, ironMat, darkIronMat, brassMat, woodMat },
  };
  return group;
}

export function retintCannonTower(tower, theme) {
  tower.userData.materials.stoneMat.color.set(theme.stone);
}

// ---------------------------------------------------------------------------
// "Katapult": a tall wooden A-frame trebuchet with a diagonal throwing arm,
// bucket and counterweight, already cocked back at rest. Tall + diagonal
// silhouette (vs. Kanón's low+wide and Balista's vertical post) matches its
// GDD role: longest range, slow arcing lob that can miss.
// ---------------------------------------------------------------------------
export function createCatapultTower(theme) {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.62, metalness: 0.05 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.7, metalness: 0.05 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x3a2e1f, roughness: 0.95 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xcf9f2e, roughness: 0.22, metalness: 0.9 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.35, 8), stoneMat);
  plinth.position.y = 0.17;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // A-frame legs (angled front pair + straight back brace) holding the
  // pivot axle high above the plinth.
  [-1, 1].forEach((side) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), darkWoodMat);
    leg.position.set(side * 0.45, 0.9, 0.25);
    leg.rotation.z = side * 0.22;
    leg.castShadow = true;
    group.add(leg);
    const legBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), darkWoodMat);
    legBack.position.set(side * 0.45, 0.9, -0.25);
    legBack.rotation.x = -0.18;
    legBack.castShadow = true;
    group.add(legBack);
  });

  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 10), brassMat);
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 1.55;
  group.add(axle);

  // Throwing arm: pivots around the axle, resting already cocked back
  // (diagonal) so it reads as a loaded weapon even standing still.
  const arm = new THREE.Group();
  arm.position.y = 1.55;
  arm.rotation.x = -1.0;

  const armBeam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), woodMat);
  armBeam.position.y = 0.3;
  armBeam.castShadow = true;
  arm.add(armBeam);

  const bucket = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    darkWoodMat
  );
  bucket.position.y = 1.5;
  bucket.rotation.x = Math.PI;
  bucket.castShadow = true;
  arm.add(bucket);

  const counterweight = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), darkWoodMat);
  counterweight.position.y = -1.15;
  counterweight.castShadow = true;
  arm.add(counterweight);

  for (let i = 0; i < 4; i++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 10), ropeMat);
    wrap.position.y = -0.9 + i * 0.12;
    wrap.rotation.x = Math.PI / 2;
    arm.add(wrap);
  }
  group.add(arm);

  const blob = createShadowBlob(0.95, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    turret: arm, // reuses main.js's generic idle-rock hook
    isTower: true,
    towerType: 'catapult',
    materials: { stoneMat, woodMat, darkWoodMat, ropeMat, brassMat },
  };
  return group;
}

export function retintCatapultTower(tower, theme) {
  tower.userData.materials.stoneMat.color.set(theme.stone);
}

// ---------------------------------------------------------------------------
// "Mráz": no barrel at all -- a glowing icy core with a cluster of crystal
// shards radiating outward at varied angles. Purely radial/spiky silhouette,
// the opposite of every barrel-on-a-stand tower, so "the cold support one"
// reads instantly even in a cluttered scene.
// ---------------------------------------------------------------------------
export function createFrostTower(theme) {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.9 });
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0xbfe8f5, roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.82,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x6fc7e8, emissive: 0x3fb6e8, emissiveIntensity: 2.0, roughness: 0.2,
  });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.3, 8), stoneMat);
  plinth.position.y = 0.15;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const rime = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.08, 8, 16), iceMat);
  rime.rotation.x = Math.PI / 2;
  rime.position.y = 0.3;
  group.add(rime);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), coreMat);
  core.position.y = 0.75;
  group.add(core);

  // Crystal cluster -- this whole group is what main.js slowly rotates.
  const cluster = new THREE.Group();
  cluster.position.y = 0.75;
  const shardCount = 7;
  for (let i = 0; i < shardCount; i++) {
    const h = 0.35 + (i % 3) * 0.12;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.07 + (i % 2) * 0.03, h, 5), iceMat);
    const ang = (i / shardCount) * Math.PI * 2;
    const tilt = 0.5 + (i % 3) * 0.15;
    shard.position.set(Math.cos(ang) * 0.12, h * 0.4, Math.sin(ang) * 0.12);
    shard.rotation.set(Math.cos(ang) * tilt, 0, Math.sin(ang) * -tilt);
    shard.castShadow = true;
    cluster.add(shard);
  }
  group.add(cluster);

  const blob = createShadowBlob(0.75, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    turret: cluster,
    isTower: true,
    towerType: 'frost',
    materials: { stoneMat, iceMat, coreMat },
  };
  return group;
}

export function retintFrostTower(tower, theme) {
  tower.userData.materials.stoneMat.color.set(theme.stone);
}

// ---------------------------------------------------------------------------
// "Vrtiak": a red-and-white banded spinning top on a single point/wheel, tip
// down (GDD 5.4: "Kuzel na jednom kolese, ako vlcek"). The stripes are real
// stacked frustum bands (not a texture) so the silhouette alone -- a thin
// cone, nothing like Cvakac's round legged body or Kotlar's wide drum --
// already reads as the fast/fragile one. Spins continuously on its own axis.
// ---------------------------------------------------------------------------
export function createDrillEnemy() {
  const group = new THREE.Group();

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.32, metalness: 0.08 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xc23b1d, roughness: 0.28, metalness: 0.08 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c18, roughness: 0.55, metalness: 0.2 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xcf9f2e, roughness: 0.22, metalness: 0.85 });

  const spinGroup = new THREE.Group();
  spinGroup.position.y = 0.1;

  const bands = [
    { rTop: 0.34, rBot: 0.26, h: 0.26, y: 0.56, mat: whiteMat },
    { rTop: 0.26, rBot: 0.17, h: 0.24, y: 0.34, mat: redMat },
    { rTop: 0.17, rBot: 0.09, h: 0.22, y: 0.14, mat: whiteMat },
    { rTop: 0.09, rBot: 0.02, h: 0.18, y: -0.02, mat: redMat },
  ];
  bands.forEach(({ rTop, rBot, h, y, mat }) => {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 10), mat);
    seg.position.y = y;
    seg.castShadow = true;
    spinGroup.add(seg);
  });

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    whiteMat
  );
  cap.position.y = 0.69;
  cap.castShadow = true;
  spinGroup.add(cap);

  const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), darkMat);
  wheel.position.y = -0.1;
  spinGroup.add(wheel);

  // Brass bolt dots at a glance-readable distance around the widest band.
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), brassMat);
    bolt.position.set(Math.cos(ang) * 0.27, 0.45, Math.sin(ang) * 0.27);
    spinGroup.add(bolt);
  }

  group.add(spinGroup);

  const blob = createShadowBlob(0.34, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    spinGroup,
    materials: { whiteMat, redMat, darkMat, brassMat },
    walkPhase: Math.random() * Math.PI * 2,
    spinSpeed: 7,
  };

  // Fast continuous spin on its own axis, plus a tilt-tumble walk cycle
  // (distinct from Cvakac's smooth side-to-side sway or Kotlar's heavy
  // waddle -- this one looks like it's barely keeping its balance).
  group.userData.update = (t) => {
    const ud = group.userData;
    spinGroup.rotation.y = t * ud.spinSpeed;
    const phase = t * 4 + ud.walkPhase;
    group.rotation.z = Math.sin(phase) * 0.18;
    group.rotation.x = Math.cos(phase * 0.7) * 0.1;
    group.position.y = 0.1 + Math.abs(Math.sin(phase * 2)) * 0.05;
  };

  return group;
}

// ---------------------------------------------------------------------------
// "Kotlar": a squat cast-iron boiler drum on four stubby legs, with a
// riveted seam, a tilted chimney and a slow puff of steam (GDD 5.4: "Siroky
// nizky kotol s kominom a nytmi"). Wide + low + heavy silhouette -- nothing
// like Vrtiak's thin spinning cone or Cvakac's round toy body -- reads as
// "armored, slow" at a glance per GDD's silhouette-first rule.
// ---------------------------------------------------------------------------
export function createBoilerEnemy() {
  const group = new THREE.Group();

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x454a66, roughness: 0.4, metalness: 0.78 });
  const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x191b28, roughness: 0.55, metalness: 0.6 });
  const copperMat = new THREE.MeshStandardMaterial({ color: 0xc17a3d, roughness: 0.28, metalness: 0.82 });
  const steamMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8ec, transparent: true, opacity: 0.55, roughness: 1,
  });

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.56, 12), ironMat);
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.46;
  drum.castShadow = true;
  group.add(drum);

  // Domed caps on both ends so it reads as a pressure vessel, not a can.
  [-0.3, 0.3].forEach((zOff) => {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      ironMat
    );
    cap.rotation.x = zOff < 0 ? Math.PI / 2 : -Math.PI / 2;
    cap.position.set(0, 0.46, zOff);
    cap.castShadow = true;
    group.add(cap);
  });

  // Rivet ring around the drum's circular (y-z plane) cross-section.
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), copperMat);
    rivet.position.set(0, 0.46 + Math.sin(ang) * 0.46, Math.cos(ang) * 0.46);
    group.add(rivet);
  }

  const porthole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12), darkIronMat);
  porthole.rotation.x = Math.PI / 2;
  porthole.position.set(0, 0.5, 0.33);
  group.add(porthole);
  const portholeRim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 14), copperMat);
  portholeRim.position.set(0, 0.5, 0.35);
  group.add(portholeRim);

  const chimneyGroup = new THREE.Group();
  chimneyGroup.position.set(0, 0.72, -0.1);
  chimneyGroup.rotation.x = 0.25;
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), darkIronMat);
  chimney.position.y = 0.2;
  chimney.castShadow = true;
  chimneyGroup.add(chimney);
  const chimneyRim = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 10), copperMat);
  chimneyRim.rotation.x = Math.PI / 2;
  chimneyRim.position.y = 0.4;
  chimneyGroup.add(chimneyRim);
  group.add(chimneyGroup);

  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), steamMat);
  puff.position.set(0, 0.95, -0.14);
  puff.visible = false;
  group.add(puff);

  // Four stubby legs (heavy, slow -- not hinge-jointed like Cvakac's).
  const legs = [];
  const legPositions = [[0.22, -0.2], [-0.22, -0.2], [0.22, 0.2], [-0.22, 0.2]];
  legPositions.forEach(([x, z]) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(x, 0.2, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.24, 8), darkIronMat);
    leg.position.y = -0.12;
    leg.castShadow = true;
    legGroup.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), ironMat);
    foot.position.y = -0.26;
    legGroup.add(foot);
    group.add(legGroup);
    legs.push(legGroup);
  });

  const blob = createShadowBlob(0.5, 0.4);
  blob.position.y = 0.011;
  group.add(blob);

  group.userData = {
    legs,
    materials: { ironMat, darkIronMat, copperMat, steamMat },
    puff,
    walkPhase: Math.random() * Math.PI * 2,
  };

  group.userData.update = (t) => {
    const ud = group.userData;
    const phase = t * 1.5 + ud.walkPhase; // slow, heavy cadence
    group.rotation.z = Math.sin(phase) * 0.04;
    group.position.y = Math.abs(Math.sin(phase * 2)) * 0.02;
    legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(phase + (i * Math.PI) / 2) * 0.12;
    });
    // Puff cycle: scale up and fade out, repeating roughly every 1.8s.
    const cycle = (t * 0.56 + ud.walkPhase) % 1;
    if (cycle < 0.6) {
      ud.puff.visible = true;
      const p = cycle / 0.6;
      ud.puff.scale.setScalar(0.3 + p * 1.2);
      ud.puff.position.y = 0.95 + p * 0.3;
      ud.puff.material.opacity = 0.55 * (1 - p);
    } else {
      ud.puff.visible = false;
    }
  };

  return group;
}


// ---------------------------------------------------------------------------
// "Mosadzna vazka" (brass dragonfly): the MVP flying enemy. Long segmented
// brass body + 4 thin translucent-blue wings on 2 independently-fluttering
// pivot pairs (GDD 5.4: "Dlhe telo, 4 tenke kridla" / "Mosadz, kridla
// priesvitne modre" / "Kridla bzucia"). Nothing else in the roster has
// wings or flies, so the silhouette alone reads as "the flying one"
// immediately (GDD 5.4's "silueta pred detailom" rule). No ground-shadow
// blob (it flies at y=1.6 in main.js; a blob there would float, not read
// as a real ground shadow).
// ---------------------------------------------------------------------------
export function createDragonflyEnemy() {
  const group = new THREE.Group();

  const brassMat = new THREE.MeshStandardMaterial({ color: 0xcf9f2e, roughness: 0.2, metalness: 0.88 });
  const darkBrassMat = new THREE.MeshStandardMaterial({ color: 0x6b5414, roughness: 0.3, metalness: 0.8 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.3, metalness: 0.2 });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x7fd1ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.45,
    side: THREE.DoubleSide,
  });

  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), brassMat);
  thorax.scale.set(1, 0.85, 1.2);
  thorax.castShadow = true;
  group.add(thorax);

  // Tapering segmented abdomen (alternating brass/dark bands).
  const abdomen = new THREE.Group();
  abdomen.position.z = -0.2;
  const segCount = 5;
  for (let i = 0; i < segCount; i++) {
    const r = 0.1 - i * 0.015;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.85, 0.16, 8),
      i % 2 === 0 ? brassMat : darkBrassMat
    );
    seg.rotation.x = Math.PI / 2;
    seg.position.z = -i * 0.15;
    seg.castShadow = true;
    abdomen.add(seg);
  }
  group.add(abdomen);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), brassMat);
  head.position.z = 0.22;
  head.castShadow = true;
  group.add(head);
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 6);
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.08, 0.02, 0.27);
    eye.scale.set(1, 1, 0.7);
    group.add(eye);
  });

  // 4 wings on 2 pivot pairs (front/back) so each pair flutters slightly
  // out of phase, like a real dragonfly rather than a single flat flap.
  function makeWing() {
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.16), wingMat);
    const vein = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.02), darkBrassMat);
    wing.add(vein);
    return wing;
  }
  const wingPairs = [];
  [0.12, -0.08].forEach((zOff, pairIdx) => {
    [-1, 1].forEach((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.05, 0.08, zOff);
      const wing = makeWing();
      wing.position.x = side * 0.3;
      wing.rotation.y = side > 0 ? 0.1 : -0.1;
      pivot.add(wing);
      group.add(pivot);
      wingPairs.push({ pivot, side, pairIdx });
    });
  });

  group.userData = {
    wingPairs,
    materials: { brassMat, darkBrassMat, eyeMat, wingMat },
    hoverPhase: Math.random() * Math.PI * 2,
  };

  // Fast wing flutter (two pairs out of phase) + a gentle hover bob/yaw so
  // it reads as flying, not sliding along a rail.
  group.userData.update = (t) => {
    const ud = group.userData;
    const flutter = t * 26;
    wingPairs.forEach(({ pivot, side, pairIdx }) => {
      pivot.rotation.z = side * (0.15 + Math.sin(flutter + pairIdx * 1.1) * 0.55);
    });
    const hover = t * 2.2 + ud.hoverPhase;
    group.position.y = Math.sin(hover) * 0.08;
    group.rotation.z = Math.sin(hover * 0.6) * 0.06;
    group.rotation.y = Math.sin(hover * 0.4) * 0.1;
  };

  return group;
}
