// FX.js
// Pooled, cheap gameplay effects that make combat readable:
//  - muzzle flashes (additive glow sprite + short point light-free flash)
//  - impact puffs (expanding soft sprite ring: dust for cannon/catapult,
//    icy for frost, sparks for balista)
//  - death debris (little cogs / springs / plates that bounce on the ground
//    and fade -- GDD 5.4 "hracka sa rozleti na kolieska")
//  - floating "+5" gold labels (DOM, crisp at any DPI)
//  - enemy HP bars (tiny billboard bars, only shown once damaged)
// Everything is pooled / reused; no per-frame allocation in the hot path.

import * as THREE from 'three';

function makeRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW_TEX = makeRadialTexture();

export function createFX(scene, camera, container) {
  // ---------------------------------------------------------------- sprites
  const SPRITES = 48;
  const sprites = [];
  for (let i = 0; i < SPRITES; i++) {
    const mat = new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    s.renderOrder = 10;
    scene.add(s);
    sprites.push({ s, life: 0, max: 1, size0: 1, size1: 1, op: 1, vy: 0 });
  }
  let spriteIdx = 0;
  function spawnSprite(pos, color, size0, size1, life, opacity = 1, additive = true, vy = 0) {
    const e = sprites[spriteIdx];
    spriteIdx = (spriteIdx + 1) % SPRITES;
    e.s.position.copy(pos);
    e.s.material.color.set(color);
    e.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    e.s.visible = true;
    e.life = life; e.max = life; e.size0 = size0; e.size1 = size1; e.op = opacity; e.vy = vy;
  }

  // ---------------------------------------------------------------- debris
  const DEBRIS = 140;
  const cogGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 8);
  const plateGeo = new THREE.BoxGeometry(0.1, 0.03, 0.07);
  const springGeo = new THREE.TorusGeometry(0.045, 0.014, 4, 10);
  const geos = [cogGeo, plateGeo, springGeo];
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xe4572e, metalness: 0.2, roughness: 0.45 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x5a5e78, metalness: 0.7, roughness: 0.45 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, metalness: 0.4, roughness: 0.8 });
  const debris = [];
  for (let i = 0; i < DEBRIS; i++) {
    const m = new THREE.Mesh(geos[i % 3], brass);
    m.visible = false;
    m.castShadow = true;
    scene.add(m);
    debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, ground: 0.5 });
  }
  let debrisIdx = 0;
  function spawnDebris(pos, count, palette, ground = 0.5, scale = 1) {
    for (let i = 0; i < count; i++) {
      const d = debris[debrisIdx];
      debrisIdx = (debrisIdx + 1) % DEBRIS;
      d.m.material = palette[i % palette.length];
      d.m.position.copy(pos);
      d.m.position.y += 0.2 + Math.random() * 0.3;
      d.s0 = scale * (0.7 + Math.random() * 0.7);
      d.m.scale.setScalar(d.s0);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.2;
      d.v.set(Math.cos(a) * sp, 2.5 + Math.random() * 3, Math.sin(a) * sp);
      d.w.set(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7);
      d.life = 1.6 + Math.random() * 0.6;
      d.ground = ground;
      d.m.visible = true;
    }
  }

  // ---------------------------------------------------------------- DOM labels
  const labelLayer = document.createElement('div');
  labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
  container.appendChild(labelLayer);
  const labels = [];
  const tmpV = new THREE.Vector3();
  function spawnLabel(worldPos, text, color = '#ffd34d') {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute;left:0;top:0;font:900 15px/1 system-ui,sans-serif;color:${color};` +
      'text-shadow:0 2px 0 #5a3a00,0 0 6px rgba(0,0,0,.6);white-space:nowrap;will-change:transform,opacity;';
    labelLayer.appendChild(el);
    labels.push({ el, pos: worldPos.clone(), life: 1.1, max: 1.1 });
  }

  // ---------------------------------------------------------------- HP bars
  const barBgMat = new THREE.SpriteMaterial({ color: 0x1a1a22, transparent: true, opacity: 0.85, depthTest: false });
  const barGeoScale = { w: 0.75, h: 0.09 };
  function createHpBar() {
    const g = new THREE.Group();
    const bg = new THREE.Sprite(barBgMat);
    bg.scale.set(barGeoScale.w + 0.06, barGeoScale.h + 0.05, 1);
    bg.center.set(0.5, 0.5);
    bg.renderOrder = 20;
    const fgMat = new THREE.SpriteMaterial({ color: 0x7ee04a, depthTest: false });
    const fg = new THREE.Sprite(fgMat);
    fg.center.set(0, 0.5);
    fg.position.x = -barGeoScale.w / 2;
    fg.scale.set(barGeoScale.w, barGeoScale.h, 1);
    fg.renderOrder = 21;
    g.add(bg, fg);
    g.visible = false;
    g.userData.set = (frac) => {
      const f = Math.max(0, Math.min(1, frac));
      g.visible = f < 0.999;
      fg.scale.x = Math.max(0.001, barGeoScale.w * f);
      fgMat.color.setHSL(0.33 * f, 0.85, 0.5);
    };
    return g;
  }

  // ---------------------------------------------------------------- API
  const up = new THREE.Vector3();
  return {
    createHpBar,
    muzzleFlash(pos, type) {
      if (type === 'frost') {
        spawnSprite(pos, 0x7fe8ff, 0.5, 1.4, 0.3, 0.9);
      } else if (type === 'balista') {
        spawnSprite(pos, 0xfff1b0, 0.3, 0.7, 0.12, 0.8);
      } else {
        spawnSprite(pos, 0xffc24a, 0.6, 1.3, 0.14, 1);
        up.copy(pos); up.y += 0.1;
        spawnSprite(up, 0x9a9a9a, 0.4, 1.4, 0.7, 0.45, false, 0.8);
      }
    },
    impact(pos, type, splash = 0) {
      if (type === 'frost') {
        spawnSprite(pos, 0x9be8ff, 0.3, 0.9, 0.3, 0.8);
      } else if (type === 'balista') {
        spawnSprite(pos, 0xffe6a0, 0.2, 0.6, 0.15, 0.7);
      } else {
        const r = Math.max(1, splash) * 2.2;
        spawnSprite(pos, 0xffa53a, 0.6, r * 0.9, 0.22, 1);
        spawnSprite(pos, 0xb59a7a, 0.6, r * 1.2, 0.8, 0.55, false, 0.5);
      }
    },
    death(pos, zombie, big = false) {
      const palette = zombie ? [rust, iron, brass] : [brass, red, iron];
      spawnDebris(pos, big ? 26 : 9, palette, 0.5, big ? 1.8 : 1);
      spawnSprite(pos, zombie ? 0x9ef01a : 0xfff0c0, 0.4, big ? 3 : 1.4, 0.35, 0.8);
    },
    goldLabel(pos, amount) {
      tmpV.copy(pos); tmpV.y += 1;
      spawnLabel(tmpV, `+${amount}`);
    },
    update(dt) {
      for (const e of sprites) {
        if (e.life <= 0) continue;
        e.life -= dt;
        if (e.life <= 0) { e.s.visible = false; continue; }
        const p = 1 - e.life / e.max;
        const sz = e.size0 + (e.size1 - e.size0) * (1 - (1 - p) * (1 - p));
        e.s.scale.set(sz, sz, 1);
        e.s.material.opacity = e.op * (1 - p);
        e.s.position.y += e.vy * dt;
      }
      for (const d of debris) {
        if (d.life <= 0) continue;
        d.life -= dt;
        if (d.life <= 0) { d.m.visible = false; continue; }
        d.v.y -= 14 * dt;
        d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
        if (d.m.position.y < d.ground + 0.03) {
          d.m.position.y = d.ground + 0.03;
          d.v.y = Math.abs(d.v.y) * 0.35;
          d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
        }
        if (d.life < 0.4) d.m.scale.setScalar(d.s0 * (d.life / 0.4));
      }
      const rect = container.getBoundingClientRect();
      for (let i = labels.length - 1; i >= 0; i--) {
        const L = labels[i];
        L.life -= dt;
        if (L.life <= 0) { L.el.remove(); labels.splice(i, 1); continue; }
        L.pos.y += dt * 1.2;
        tmpV.copy(L.pos).project(camera);
        const x = (tmpV.x * 0.5 + 0.5) * rect.width;
        const y = (-tmpV.y * 0.5 + 0.5) * rect.height;
        const p = 1 - L.life / L.max;
        const sc = p < 0.15 ? 0.6 + p / 0.15 * 0.6 : 1.2 - Math.min(0.2, (p - 0.15));
        L.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${sc})`;
        L.el.style.opacity = String(Math.min(1, L.life / 0.35));
      }
    },
  };
}
