// Bootstrap: assets → renderer → world → sim → controls → HUD → loop.
// Exposes the required debug/screenshot API on window.
import * as THREE from 'three';
import { SHOT_MODE } from './core/rng.js';
import { initAssets, uTime } from './core/assets.js';
import { createRenderer, createComposer } from './core/renderer.js';
import { buildArena } from './world/arena.js';
import { buildEnvironment } from './world/environment.js';
import { buildWater } from './world/water.js';
import { VFX } from './vfx/vfx.js';
import { Sim } from './game/sim.js';
import { Controls } from './game/controls.js';
import { HUD } from './game/hud.js';

const STEP = 1 / 60;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _shake = new THREE.Vector3();

// ------------------------------------------------------------------- boot --
const quality = (navigator.hardwareConcurrency || 8) <= 4 ? 0.65 : 1;
initAssets(quality);

const container = document.getElementById('app');
const renderer = createRenderer(container);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 900);
camera.position.set(-46, 19, 15);

const post = createComposer(renderer, scene, camera);
const arena = buildArena(scene);
const env = buildEnvironment(scene, quality);
const water = buildWater(scene);
const hud = new HUD();
const vfx = new VFX({
  scene,
  groundHeight: arena.groundHeight,
  gradeUniforms: post.gradeUniforms,
  onText: (pos, str, kind) => hud.damageNumber(pos, str, kind),
});
const sim = new Sim({ scene, arena, vfx, hud });
const controls = new Controls(sim);
hud.bind(sim, camera);

// ----------------------------------------------------------------- camera --
const CAM = {
  mode: 'follow',
  pitchDist: 23.5,
  height: Math.sin(THREE.MathUtils.degToRad(53)),
  depth: Math.cos(THREE.MathUtils.degToRad(53)),
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  snap: true,
};
function followTarget(out) {
  const p = sim.player;
  out.copy(p.pos);
  out.x += 1.6 + sim.input.x * 1.5; // forward lead
  out.z += sim.input.z * 1.2;
  return out;
}
function updateCamera(dt) {
  if (CAM.mode === 'follow') {
    followTarget(_v1);
    _v2.set(_v1.x, _v1.y + CAM.pitchDist * CAM.height, _v1.z + CAM.pitchDist * CAM.depth);
    const k = CAM.snap ? 1 : 1 - Math.exp(-5.5 * dt);
    CAM.pos.lerp(_v2, k);
    CAM.look.lerp(_v1, k);
    CAM.snap = false;
  }
  camera.position.copy(CAM.pos);
  const tr = vfx.getShakeOffset(_shake, uTime.value);
  camera.position.add(_shake);
  camera.lookAt(CAM.look.x + _shake.x * 0.4, CAM.look.y, CAM.look.z + _shake.z * 0.4);
  if (tr > 0) camera.rotation.z += _shake.x * 0.03;
}

// ------------------------------------------------------------ frame logic --
let paused = SHOT_MODE;
let running = false;
let acc = 0;
let last = performance.now();

function visualUpdate(dt) {
  uTime.value += dt;
  sim.updateVisuals(dt, camera);
  env.update(dt);
  water.update(dt);
  vfx.update(dt);
  updateCamera(dt);
  controls.update(dt);
  hud.update(dt);
}
function renderFrame() {
  renderer.info.reset();
  post.composer.render();
}
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 5) {
      sim.step(STEP);
      acc -= STEP;
    }
    visualUpdate(dt);
    renderFrame();
  }
}
function startLoop() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- presets --
function setCam(px, py, pz, lx, ly, lz) {
  CAM.mode = 'fixed';
  CAM.pos.set(px, py, pz);
  CAM.look.set(lx, ly, lz);
  camera.position.copy(CAM.pos);
  camera.lookAt(CAM.look);
}
function settle(simSteps, visSteps) {
  for (let i = 0; i < simSteps; i++) sim.step(STEP);
  for (let i = 0; i < visSteps; i++) visualUpdate(STEP);
}
const PRESETS = {
  overview() {
    sim.stage('overview');
    setCam(-58, 42, 52, 2, -2, -3);
    settle(6, 10);
  },
  gameplay() {
    sim.stage('gameplay');
    CAM.mode = 'follow';
    CAM.snap = true;
    settle(8, 9);
  },
  hero() {
    sim.stage('hero');
    const p = sim.player.pos;
    // pulled back and biased left so her head clears the top scoreboard and she
    // sits off the ability cluster
    setCam(p.x + 2.7, p.y + 2.1, p.z + 4.9, p.x + 0.2, p.y + 1.05, p.z);
    settle(2, 8);
  },
  ult() {
    sim.stage('ult');
    const p = sim.player.pos;
    setCam(p.x - 3.5, p.y + 10.5, p.z + 12.5, p.x + 0.6, p.y + 0.6, p.z - 0.4);
    settle(2, 8);
    vfx.flash(0.14);
    visualUpdate(0.016);
  },
  river() {
    sim.stage('river');
    setCam(7.4, 1.7, 10.6, -2.6, 2.1, -13.5);
    settle(2, 10);
  },
  base() {
    sim.stage('base');
    setCam(-62.5, 8.5, 14.5, -44.5, 3.2, -1.5);
    settle(2, 10);
  },
};

// -------------------------------------------------------------- debug API --
window.__WR_DEBUG = {
  step(seconds = 1) {
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n; i++) {
      sim.step(STEP);
      visualUpdate(STEP);
    }
    renderFrame();
  },
  preset(name) {
    const fn = PRESETS[name];
    if (fn) fn();
    renderFrame();
  },
  stats() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
  resume() {
    paused = false;
    CAM.mode = 'follow';
    startLoop();
  },
};

// internal diagnostics (harmless in production)
window.__WR_DIAG = { renderer, scene, camera, post, sim, arena, THREE };

// ------------------------------------------------------------------ start --
if (SHOT_MODE) {
  // stage a sensible default frame, render once, wait for preset() calls
  visualUpdate(STEP);
  renderFrame();
} else {
  CAM.snap = true;
  startLoop();
  hud.announce('AETHER RIFT', 'Destroy the Ember nexus!', 'kill');
}
window.__WR_READY = true;
