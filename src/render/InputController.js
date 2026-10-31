// InputController.js
// Unifies touch and desktop input for the diorama camera + tile/tower
// selection, per GDD section 4 ("Ovladanie"):
//   - tap/click empty buildable tile -> radial menu (tower choice)
//   - tap/click tower -> select (upgrade/sell/target menu)
//   - tap outside / Esc / right-click -> cancel selection
//   - pinch = zoom, wheel = zoom
//   - one-finger drag = pan camera, WASD = pan camera
//   - two-finger rotation / Q,E = rotate camera 90 deg
// Touch and desktop controls are both always active (not either/or).

import * as THREE from 'three';
import {
  setIsoAngle, rotateIso90, computeFitViewSize, panBy, updateIsoCameraAspect, getYaw,
} from './IsoCamera.js';

const TAP_MOVE_THRESHOLD = 10; // px - beyond this a pointer-down/up is a drag, not a tap
const TAP_MAX_DURATION = 350; // ms
const ROTATE_TRIGGER_DEG = 55; // accumulated two-finger twist needed to rotate 90deg
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.4;
const PAN_SPEED = 10; // world units/sec for WASD/arrow keys
const PITCH_FORESHORTEN = 1 / Math.sin(Math.atan(1 / Math.sqrt(2))); // undo iso pitch for vertical drag

function createInputController(opts) {
  const {
    domElement, camera, dist, tileGrid, towers,
    onSelectTile, onSelectTower, onDeselect,
  } = opts;

  let zoomScale = 1;
  const pressedKeys = new Set();
  const activePointers = new Map(); // pointerId -> {x,y}
  let dragStart = null; // {x,y,t,moved}
  let pinchStartDist = null;
  let pinchStartZoom = 1;
  let rotateAccumDeg = 0;
  let rotateStartAngle = null;

  const raycaster = new THREE.Raycaster();

  function currentAspect() {
    const w = domElement.clientWidth || window.innerWidth;
    const h = domElement.clientHeight || window.innerHeight;
    return w / Math.max(h, 1);
  }

  function currentViewSize() {
    return computeFitViewSize(currentAspect()) / zoomScale;
  }

  function applyCamera() {
    updateIsoCameraAspect(camera, currentAspect(), currentViewSize());
    setIsoAngle(camera, dist);
  }

  function screenToNDC(x, y) {
    const rect = domElement.getBoundingClientRect();
    return {
      x: ((x - rect.left) / rect.width) * 2 - 1,
      y: -((y - rect.top) / rect.height) * 2 + 1,
    };
  }

  function pickAt(x, y) {
    const ndc = screenToNDC(x, y);
    raycaster.setFromCamera(ndc, camera);

    const towerHits = raycaster.intersectObjects(towers, true);
    if (towerHits.length) {
      let obj = towerHits[0].object;
      while (obj && !obj.userData.isTower) obj = obj.parent;
      if (obj) return { type: 'tower', object: obj };
    }

    const tileHits = raycaster.intersectObjects(tileGrid.children, true);
    if (tileHits.length) {
      let obj = tileHits[0].object;
      while (obj && obj.userData.isRoad === undefined) obj = obj.parent;
      if (obj) return { type: 'tile', object: obj };
    }
    return null;
  }

  function groundAxes() {
    const yaw = getYaw();
    return {
      right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
      forward: { x: Math.sin(yaw), z: Math.cos(yaw) },
    };
  }

  function panByScreenDelta(dxPx, dyPx) {
    const worldPerPixel = (currentViewSize() * 2) / Math.max(domElement.clientHeight, 1);
    const { right, forward } = groundAxes();
    // Drag right/down should make the content appear to follow the
    // finger, so the pan target moves opposite to the drag direction.
    panBy(
      -right.x * dxPx * worldPerPixel - forward.x * dyPx * worldPerPixel * PITCH_FORESHORTEN,
      -right.z * dxPx * worldPerPixel - forward.z * dyPx * worldPerPixel * PITCH_FORESHORTEN
    );
  }

  function handlePointerDown(e) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    domElement.setPointerCapture && domElement.setPointerCapture(e.pointerId);

    if (activePointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    } else if (activePointers.size === 2) {
      dragStart = null; // two-finger gesture takes over
      const pts = [...activePointers.values()];
      pinchStartDist = distanceOf(pts[0], pts[1]);
      pinchStartZoom = zoomScale;
      rotateStartAngle = angleOf(pts[0], pts[1]);
      rotateAccumDeg = 0;
    }
  }

  function handlePointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    const prev = activePointers.get(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      const pts = [...activePointers.values()];
      const d2 = distanceOf(pts[0], pts[1]);
      if (pinchStartDist) {
        zoomScale = clamp(pinchStartZoom * (d2 / pinchStartDist), ZOOM_MIN, ZOOM_MAX);
      }
      const ang = angleOf(pts[0], pts[1]);
      if (rotateStartAngle !== null) {
        let delta = ang - rotateStartAngle;
        delta = ((delta + 180) % 360 + 360) % 360 - 180; // normalize to [-180,180]
        rotateAccumDeg += delta;
        rotateStartAngle = ang;
        if (Math.abs(rotateAccumDeg) >= ROTATE_TRIGGER_DEG) {
          rotateIso90(camera, dist);
          rotateAccumDeg = 0;
        }
      }
      applyCamera();
      return;
    }

    if (activePointers.size === 1 && dragStart) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(e.clientX - dragStart.x) > TAP_MOVE_THRESHOLD ||
          Math.abs(e.clientY - dragStart.y) > TAP_MOVE_THRESHOLD) {
        dragStart.moved = true;
      }
      if (dragStart.moved) {
        panByScreenDelta(dx, dy);
        applyCamera();
      }
    }
  }

  function handlePointerUp(e) {
    const wasTap =
      activePointers.size === 1 && dragStart && !dragStart.moved &&
      (performance.now() - dragStart.t) < TAP_MAX_DURATION;

    activePointers.delete(e.pointerId);

    if (wasTap) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit && hit.type === 'tower') onSelectTower && onSelectTower(hit.object, e.clientX, e.clientY);
      else if (hit && hit.type === 'tile') onSelectTile && onSelectTile(hit.object, e.clientX, e.clientY);
      else onDeselect && onDeselect();
    }

    if (activePointers.size < 2) {
      pinchStartDist = null;
      rotateStartAngle = null;
    }
    if (activePointers.size === 0) dragStart = null;
  }

  function handleWheel(e) {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    zoomScale = clamp(zoomScale * (1 + dir * 0.08), ZOOM_MIN, ZOOM_MAX);
    applyCamera();
  }

  function handleContextMenu(e) {
    e.preventDefault();
    onDeselect && onDeselect();
  }

  function handleKeyDown(e) {
    pressedKeys.add(e.code);
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      rotateIso90(camera, dist);
      applyCamera();
    }
    if (e.code === 'Escape') onDeselect && onDeselect();
  }
  function handleKeyUp(e) {
    pressedKeys.delete(e.code);
  }

  function update(dtSeconds) {
    if (!pressedKeys.size) return;
    const { right, forward } = groundAxes();
    let mx = 0, mz = 0;
    if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) { mx -= forward.x; mz -= forward.z; }
    if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) { mx += forward.x; mz += forward.z; }
    if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
    if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) { mx += right.x; mz += right.z; }
    if (mx || mz) {
      panBy(mx * PAN_SPEED * dtSeconds, mz * PAN_SPEED * dtSeconds);
      applyCamera();
    }
  }

  function attach() {
    domElement.style.touchAction = 'none';
    domElement.addEventListener('pointerdown', handlePointerDown);
    domElement.addEventListener('pointermove', handlePointerMove);
    domElement.addEventListener('pointerup', handlePointerUp);
    domElement.addEventListener('pointercancel', handlePointerUp);
    domElement.addEventListener('wheel', handleWheel, { passive: false });
    domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
  }

  function destroy() {
    domElement.removeEventListener('pointerdown', handlePointerDown);
    domElement.removeEventListener('pointermove', handlePointerMove);
    domElement.removeEventListener('pointerup', handlePointerUp);
    domElement.removeEventListener('pointercancel', handlePointerUp);
    domElement.removeEventListener('wheel', handleWheel);
    domElement.removeEventListener('contextmenu', handleContextMenu);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  }

  attach();
  applyCamera();

  return { update, applyCamera, destroy, getZoomScale: () => zoomScale, setZoomScale: (z) => { zoomScale = clamp(z, ZOOM_MIN, ZOOM_MAX); applyCamera(); } };
}

function distanceOf(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function angleOf(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

export { createInputController };
