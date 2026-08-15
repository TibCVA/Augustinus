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
import { prewarmUnits } from './entities/units.js';
import { Sim } from './game/sim.js';
import { Controls } from './game/controls.js';
import { HUD } from './game/hud.js';

const STEP = 1 / 60;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _shake = new THREE.Vector3();

// ------------------------------------------------------------------- boot --
// The HUD is a DOM overlay and several of its flourishes are infinite CSS
// animations (ability shine, ult charge, level-up pulse) driven by the wall
// clock. ?shot=1 freezes the sim but not the CSS clock, so every preset
// screenshot caught the ability cluster at whatever phase boot happened to take
// that run — the last remaining reason two runs of the harness did not produce
// identical images. Pin the CSS clock at 0 as early as possible, before boot
// has had time to accumulate any phase. Shot mode only; play is untouched.
if (SHOT_MODE) {
  const s = document.createElement('style');
  s.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
  document.head.appendChild(s);
}

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
    // A frame that overran the 5-step cap (a real hitch, a tab switch, a slow
    // first frame) leaves backlog behind. Carrying it forward makes every
    // following frame run the full five steps — the sim fast-forwards and the
    // accumulator may never drain, which reads as the game lurching after a
    // stutter. Drop the surplus: one hitch costs a little sim time, not a
    // time-warp.
    if (acc >= STEP) acc = 0;
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

// iOS Safari drops the WebGL context when the tab is backgrounded or memory is
// tight. Without preventDefault() on the lost event the context can never be
// restored and the canvas stays black for good.
let ctxLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  ctxLost = true;
  paused = true;
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  ctxLost = false;
  // three.js re-uploads its own GPU resources; re-assert the size-dependent
  // render targets, which the composer owns.
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  if (!SHOT_MODE) paused = false;
  last = performance.now();
});

// Backgrounding the tab suspends rAF anyway; pausing explicitly stops the sim
// from being handed one huge catch-up frame on return, and saves battery.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    paused = true;
  } else if (!ctxLost && !SHOT_MODE) {
    paused = false;
    last = performance.now();
    acc = 0;
  }
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
    // Closer for a real close-up, with the look-at pushed along screen-right so
    // she sits in the left third and her head clears the centred scoreboard.
    setCam(p.x + 2.35, p.y + 1.95, p.z + 4.3, p.x + 1.05, p.y + 1.0, p.z - 0.52);
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

// ----------------------------------------------------------- shader warm --
// three.js links a GL program the first time a mesh is really DRAWN. Every VFX
// pool mesh starts hidden, so without this the first Dawnfall is the frame that
// links the telegraph, crater decal, shockwave ring, light pillar, debris,
// ghost, beam and trail programs in one go — a synchronous compile the driver
// cannot defer. On a phone that is a several-hundred-millisecond stall on the
// exact frame the player pressed R, which is the "casting the ult freezes the
// game" report. Pay it here, once, before the first frame is shown.
function prewarmShaders() {
  // 1) really draw one throw-away instance of every pooled effect, parked far
  //    under the arena, through the exact runtime path — so the driver builds
  //    the pipeline state for every blend mode and for the debris shadow too.
  //    This must come FIRST: three r185 deprecates PCFSoftShadowMap and rewrites
  //    renderer.shadowMap.type to PCFShadowMap on the first shadow pass, and the
  //    shadow type is part of the program cache key. Compiling before that first
  //    render links a variant the renderer then never uses, and every material
  //    compiles a second time anyway.
  // 0) minion pools are built on their first spawn — the first wave, 8 s into
  //    every match. Nothing owning `unitMat` or the caster orb material is in
  //    the scene at boot, so step 2's compile() cannot see them and the wave
  //    frame paid the link. Measured: programs went 68 -> 70 at sim t=8.25 s,
  //    and the frame that did it ran 2.1x the surrounding steady state.
  prewarmUnits(scene);
  vfx.prewarm();
  visualUpdate(STEP);
  renderFrame();
  vfx.resetAll();
  // 2) with the render state settled, link the rest of the scene — including
  //    objects still hidden (tower rubble, nexus shards), which three's
  //    compile() reaches because it walks the whole graph, not just the visible
  //    part — so no later reveal pays a compile either.
  post.compileScene(scene, camera);
  uTime.value = 0;
  CAM.snap = true;
}

// ------------------------------------------------------------------ start --
prewarmShaders();
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
