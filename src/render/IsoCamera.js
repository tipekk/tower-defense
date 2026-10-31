// IsoCamera.js
import * as THREE from 'three';
// Orthographic isometric camera rig for the diorama view.
// Pitch is the classic "true isometric" angle (~35.26deg = atan(1/sqrt(2))),
// yaw starts at 45deg and can be rotated in 90deg steps (useful to peek
// around towers/buildings without breaking the iso look).
//
// Mobile-first addition: the camera also supports a ground-plane pan
// target (so touch/mouse drag can shift the view) and a helper that
// computes the ortho half-height ("viewSize") needed so the WHOLE grid
// stays visible regardless of the viewport's aspect ratio (portrait,
// landscape, tablet, desktop) instead of a single fixed value tuned for
// one window shape.

const ISO_PITCH = Math.atan(1 / Math.sqrt(2)); // ~35.26 degrees
let currentYaw = Math.PI / 4; // 45 degrees

// --- Fit-to-grid geometry (replaces the old fixed "16:9 reference window"
// hack) -----------------------------------------------------------------
// At any yaw that is a multiple of 90deg away from the diorama's 45deg
// base rotation, a square grid's footprint corners project onto the
// screen-right axis with a combined reach of half*(|cos(yaw)|+|sin(yaw)|),
// which for 45deg (and 135/225/315) is always half*sqrt(2) -- i.e. the
// grid's diagonal. That reach is independent of the live rotation state,
// so the fit math can use the 45deg base case as a constant.
const DIAGONAL_FACTOR = Math.SQRT2;

// Half-extent (world units) of the grid footprint currently being framed,
// and how much extra vertical screen room to reserve above the ground
// plane for tall objects (towers, selection rings, etc.) so the camera
// doesn't need to be re-tuned by hand for every scene size. Scenes set
// their real size via setFitExtent(); these are just safe fallbacks.
let gridHalfExtent = 9;
let heightMargin = 2;
const FIT_PADDING = 1.04; // small breathing room so edges aren't razor-tight (task S: tightened from 1.08 -- the grid was reading small/distant even on a big canvas)

/**
 * Tell the fit-to-grid math the actual size of the scene it needs to keep
 * on screen, so computeFitViewSize() reflects the real diorama instead of
 * an arbitrary reference window. Call this once the grid is built (and
 * again if the map/grid size changes).
 * @param {number} halfExtent world-unit half-width/-depth of the square grid footprint
 * @param {number} [margin]   extra world units of headroom for tall objects above the ground plane
 */
function setFitExtent(halfExtent, margin = heightMargin) {
  gridHalfExtent = halfExtent;
  heightMargin = margin;
}

/**
 * Ground-plane point the camera orbits/looks at. Panning (drag) moves
 * this instead of the camera itself, so rotation/zoom keep working the
 * same way around whatever the player panned to.
 */
const panTarget = { x: 0, z: 0 };

function setPanTarget(x, z) {
  panTarget.x = x;
  panTarget.z = z;
}

function getPanTarget() {
  return panTarget;
}

function panBy(dx, dz) {
  panTarget.x += dx;
  panTarget.z += dz;
}

/**
 * Half-height ("viewSize") of the orthographic frustum that keeps the
 * whole diorama visible at the given aspect ratio (width/height), using
 * the ACTUAL grid size set via setFitExtent() rather than a fixed
 * reference window.
 *
 * Ortho frustum: left/right = ±viewSize*aspect, top/bottom = ±viewSize.
 * The grid footprint's screen-space reach at the iso angle is:
 *   horizontal reach = gridHalfExtent * DIAGONAL_FACTOR
 *   vertical reach   = sin(ISO_PITCH) * gridHalfExtent * DIAGONAL_FACTOR
 *                       + heightMargin * cos(ISO_PITCH)   (room for tall objects)
 * To never crop the grid we need:
 *   viewSize        >= vertical reach
 *   viewSize*aspect >= horizontal reach
 * so viewSize = max(vertical reach, horizontal reach / aspect) * padding.
 * Unlike a fixed reference, this scales correctly for ANY aspect ratio
 * (extreme portrait phones included) and for any grid size passed to
 * setFitExtent() -- it stops over-zooming out on narrow screens, which is
 * what was leaving the diorama looking tiny with empty space top/bottom.
 */
function computeFitViewSize(aspect) {
  const horizontalReach = gridHalfExtent * DIAGONAL_FACTOR;
  const verticalReach = Math.sin(ISO_PITCH) * horizontalReach + heightMargin * Math.cos(ISO_PITCH);
  return Math.max(verticalReach, horizontalReach / aspect) * FIT_PADDING;
}

/**
 * Create an orthographic camera framed at the isometric angle.
 * @param {number} aspect   viewport width / height
 * @param {number} viewSize half-height of the ortho frustum (world units)
 * @param {number} dist     distance of the camera from the origin
 */
function createIsoCamera(aspect, viewSize = computeFitViewSize(aspect), dist = 30) {
  const camera = new THREE.OrthographicCamera(
    -viewSize * aspect, viewSize * aspect,
    viewSize, -viewSize,
    0.1, 500
  );
  setIsoAngle(camera, dist);
  return camera;
}

/** Position the camera at the current yaw/pitch, looking at the pan target. */
function setIsoAngle(camera, dist = 30) {
  const horizontal = dist * Math.cos(ISO_PITCH);
  camera.position.set(
    panTarget.x + horizontal * Math.sin(currentYaw),
    dist * Math.sin(ISO_PITCH),
    panTarget.z + horizontal * Math.cos(currentYaw)
  );
  camera.lookAt(panTarget.x, 0, panTarget.z);
}

/** Rotate the diorama view by +90deg (useful "peek around" control). */
function rotateIso90(camera, dist = 30) {
  currentYaw += Math.PI / 2;
  setIsoAngle(camera, dist);
}

function getYaw() {
  return currentYaw;
}

/**
 * World-space "right" and "forward" (ground-projected) axes for the
 * current yaw, used to turn a screen-space drag/WASD input into a
 * ground-plane pan that always feels camera-relative.
 */
function getGroundAxes() {
  return {
    right: { x: Math.cos(currentYaw), z: -Math.sin(currentYaw) },
    forward: { x: Math.sin(currentYaw), z: Math.cos(currentYaw) },
  };
}

/** Keep the ortho frustum correct after a resize/zoom (viewSize already includes zoom + fit-to-screen). */
function updateIsoCameraAspect(camera, aspect, viewSize = computeFitViewSize(aspect)) {
  camera.left = -viewSize * aspect;
  camera.right = viewSize * aspect;
  camera.top = viewSize;
  camera.bottom = -viewSize;
  camera.updateProjectionMatrix();
}

export {
  createIsoCamera, updateIsoCameraAspect, rotateIso90, setIsoAngle,
  computeFitViewSize, setFitExtent, setPanTarget, getPanTarget, panBy, getYaw, getGroundAxes,
};
