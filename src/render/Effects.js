// Effects.js
// Cheap, assetless visual helpers: a vertical-gradient sky dome (replaces
// flat background color), a round AO/drop-shadow "blob" decal used under
// towers/enemies, and a CSS-canvas vignette overlay for the day/night mood.

import * as THREE from 'three';

/**
 * Clean screen-space sky gradient (bottom -> horizon band -> top) drawn as a
 * fullscreen quad behind everything. Screen-space on purpose: the diorama
 * uses an orthographic iso camera, where a world-space sky dome only ever
 * shows a narrow, oddly-banded slice. A very soft radial brightening behind
 * the island and (night only, derived from how dark the top color is) a
 * sparse field of tiny faint stars. Same function name/signature and
 * uniform names as before, so main.js/updateSkyDome keep working.
 */
export function createSkyDome(topColor, bottomColor, radius = 220, horizonColor = bottomColor) {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(topColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
      horizonColor: { value: new THREE.Color(horizonColor) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      varying vec2 vUv;
      float sh(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      void main() {
        float y = vUv.y;
        vec3 col = mix(bottomColor, horizonColor, smoothstep(0.0, 0.5, y));
        col = mix(col, topColor, smoothstep(0.42, 1.0, y));
        // soft glow behind the island
        float d = length((vUv - vec2(0.5, 0.48)) * vec2(1.4, 1.0));
        col += (horizonColor * 0.08 + 0.025) * (1.0 - smoothstep(0.0, 0.7, d));
        // tiny faint stars, only when the sky top is dark (night theme)
        float lum = dot(topColor, vec3(0.299, 0.587, 0.114));
        float night = 1.0 - smoothstep(0.03, 0.12, lum);
        if (night > 0.0) {
          vec2 cell = floor(gl_FragCoord.xy / 3.0);
          float r = sh(cell);
          float star = step(0.9965, r) * (0.35 + 0.65 * sh(cell + 7.0));
          col += vec3(0.75, 0.82, 1.0) * star * night * smoothstep(0.35, 0.95, y) * 0.55;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.raycast = () => {};
  return mesh;
}

/** Re-tint an existing sky dome when the theme changes. */
export function updateSkyDome(mesh, topColor, bottomColor, horizonColor = bottomColor) {
  mesh.material.uniforms.topColor.value.set(topColor);
  mesh.material.uniforms.bottomColor.value.set(bottomColor);
  mesh.material.uniforms.horizonColor.value.set(horizonColor);
}

// Sky props: the puffy clouds / moon / star sprites were removed (they read
// as cheap toys floating next to the board). Kept as empty groups so
// main.js's existing calls keep working; the night sky gets its subtle
// stars from the gradient shader above instead.
export function createDaySkyProps() {
  return new THREE.Group();
}

export function createNightSkyProps() {
  return new THREE.Group();
}

/**
 * Cheap round AO / contact-shadow decal: a dark, soft-edged disc placed
 * flat on the ground under an object so it reads as "sitting on" the
 * diorama instead of floating, without any real SSAO pass.
 */
export function createShadowBlob(radius = 0.5, opacity = 0.4) {
  const geo = new THREE.CircleGeometry(radius, 20);
  // Fade opacity toward the rim via vertex colors for a soft blob instead
  // of a hard-edged disc.
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * A transparent canvas overlay drawn on top of the WebGL canvas with a
 * radial-gradient vignette. Strength and tint differ between Basic (light,
 * warm) and Zombie (heavy, cold) to make the mood switch readable even on
 * a single still frame.
 */
export function createVignetteOverlay(container) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  container.appendChild(canvas);

  function resize(width, height) {
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }

  let lastKey = '';
  function render(strength = 0.3, tintHex = '#000000') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    // Only redraw when something actually changed (main.js calls this every
    // frame; a full-screen canvas gradient fill per frame is wasted fillrate
    // on phones).
    const key = `${w}x${h}|${strength}|${tintHex}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.32,
      w / 2, h / 2, Math.max(w, h) * 0.72
    );
    const alphaHex = Math.round(Math.min(Math.max(strength, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0');
    grad.addColorStop(0, tintHex + '00');
    grad.addColorStop(1, tintHex + alphaHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  return { canvas, resize, render };
}
