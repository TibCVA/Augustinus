// VFX system for AETHER RIFT.
//
// Everything is pooled and instanced: the whole effects layer costs at most a
// dozen draw calls no matter how much is on screen, and pools that hold nothing
// issue zero. Zero per-frame allocations — all state lives in preallocated typed
// arrays / preallocated records, all math uses module-scope scratch vectors.
//
//   pAdd / pAlpha ..... billboard sprite particles (1 draw each)
//   pSoot ............. SAME class as pAlpha but ordered AFTER pAdd, so smoke
//                       and debris silhouettes can occlude the additive plume
//                       instead of being buried under it (shares its program)
//   arcs .............. oriented additive quads: crescents, pillars, rays
//   rings ............. procedural ground shockwaves (bright edge + dust trail)
//   decals ............ craters / scars, dark scorch + cooling hot fissures
//   wear .............. STATIC plaza grime: cracks, moss creep, damp, scuffs
//   tele .............. animated AoE telegraphs (sweep, rim pulse, runes)
//   beams ............. tower beams w/ charge-up then snap
//   debris ............ chunky 3D shards w/ real physics + shadows
//   ghosts ............ dash afterimage silhouettes
//   trails ............ both sword ribbons in one merged mesh
//   projs ............. projectile cores
//
// Public API is stable: sim.js / main.js call burst, ring, slashArc, decal,
// telegraph/endTelegraph, projectile, beam, pillar, spawnGhost, trailPush,
// trailActive, shake, flash, hitSpark, meleeImpact, deathBurst, levelUpFx,
// respawnFx, dawnfall, resetAll, update, getShakeOffset, text, pAlpha.spawn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, uTime } from '../core/assets.js';
import { pulseLight } from '../world/environment.js';
import { A, isWalkable } from '../world/arena.js';

// ---- shared VFX uniforms -------------------------------------------------
// uHole: a world-space sphere (xyz + radius) that additive effects fade out of,
// so the caster can be found INSIDE her own ultimate instead of being deleted
// by her own light. uHoleK ramps it in for the duration of the flash only.
const uHole = { value: new THREE.Vector4(0, 0, 0, 1.2) };
const uHoleK = { value: 0 };
// Minimum angular size for additive sprites: world size >= dist * uMinAng, so
// clash sparks and tower beams survive at overview distance instead of going
// sub-pixel. Resolution independent — it is an angle, not a pixel count.
const uMinAng = { value: 0.0045 };
const HOLE_GLSL = `
  uniform vec4 uHole; uniform float uHoleK;
  float holeFade(vec3 wp) {
    if (uHoleK <= 0.0) return 1.0;
    float d = length(wp - uHole.xyz);
    return mix(1.0, smoothstep(uHole.w * 0.42, uHole.w, d), uHoleK);
  }
`;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _sc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const TAU = Math.PI * 2;

// Deterministic stream for the procedural atlases AND for every particle spawn.
// DESIGN.md makes `?seed=N` fix the RNG, but 37 raw Math.random() calls in the
// spawn paths meant the six reference presets differed run-to-run by up to 8% of
// their pixels — enough to drown any real visual regression in noise, which is
// exactly what a screenshot harness exists to catch. Everything random in this
// file now comes from here. Under fixed stepping (?shot=1) the spawn order is
// fixed, so the stream position is too, and the presets are reproducible.
let _s = 0x9e3779b9;
function rnd() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rf = (a, b) => a + (b - a) * rnd();

// ---- reusable spawn records ---------------------------------------------
// Every pool's spawn() copies the record's fields into its typed arrays and
// keeps no reference, so ONE record per pool kind can be reused forever.
// dawnfall() alone was allocating ~300 short-lived object literals per cast,
// against this file's zero-per-frame-allocation contract; the burst / ring /
// slash inner loops allocated one more per particle on every hit in the game.
//
// Contract for callers: acquire with pRec()/aRec()/…, fill, spawn IMMEDIATELY.
// Never hold a record across a call that might acquire the same one.
const PFIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size', 'sizeEnd', 'rot', 'rotV',
  'gravity', 'drag', 'col', 'colEnd', 'glow', 'glowEnd', 'alpha', 'sprite', 'stretch',
  'dirX', 'dirY', 'dirZ', 'fadePow'];
const AFIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'yaw', 'el', 'roll', 'rollV',
  'sx0', 'sx1', 'sy0', 'sy1', 'col', 'glow', 'alpha', 'sprite', 'mode', 'gravity',
  'fadePow', 'yoff', 'pin'];
const RFIELDS = ['x', 'y', 'z', 'r0', 'r1', 'dur', 'col', 'alpha', 'thick', 'dust', 'emis', 'ease'];
const DFIELDS = ['x', 'y', 'z', 'size', 'dur', 'rot', 'sprite', 'col', 'hot', 'alpha', 'wear', 't0'];
const BFIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'size', 'life', 'ground', 'ax', 'ay', 'az', 'spin', 'hot'];
function mkRec(fields) {
  const o = {};
  for (let i = 0; i < fields.length; i++) o[fields[i]] = undefined;
  return () => { for (let i = 0; i < fields.length; i++) o[fields[i]] = undefined; return o; };
}
const pRec = mkRec(PFIELDS);   // ParticlePool
const aRec = mkRec(AFIELDS);   // ArcPool
const rRec = mkRec(RFIELDS);   // RingPool
const dRec = mkRec(DFIELDS);   // DecalPool
const bRec = mkRec(BFIELDS);   // DebrisPool

// ============================================================== textures ==
function mkc(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h || w;
  return c;
}
function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.01, r));
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
const W = (a) => `rgba(255,255,255,${a})`;

// ---- additive sprite cells (id → drawn into the atlas) -------------------
// soft glow ball: hot pinpoint core, long controlled falloff (bloom-friendly)
function spDot(x, S) {
  radial(x, S / 2, S / 2, S * 0.5, [
    [0, W(1)], [0.1, W(0.98)], [0.24, W(0.62)], [0.46, W(0.22)], [0.72, W(0.05)], [1, W(0)]]);
}
// crisp 4-point star
function spSpark(x, S, big) {
  const cx = S / 2, cy = S / 2;
  const arm = (a, len, w) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    const g = x.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, W(1)); g.addColorStop(0.28, W(0.5)); g.addColorStop(1, W(0));
    x.fillStyle = g;
    x.beginPath(); x.moveTo(0, -w); x.lineTo(len, 0); x.lineTo(0, w); x.closePath(); x.fill();
    x.restore();
  };
  const L = big ? 0.48 : 0.3;
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2, S * L, S * 0.05);
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2 + Math.PI / 4, S * L * 0.42, S * 0.026);
  radial(x, cx, cy, S * (big ? 0.16 : 0.12), [[0, W(1)], [0.35, W(0.7)], [1, W(0)]]);
}
// crescent blade arc — bright outer (leading) edge, soft inner gradient,
// tapered tips. Outer edge points toward sprite +Y (canvas up).
function spCrescent(x, S, thin) {
  // Arc centre is pushed down so the band sits centred in the cell; the outer
  // (leading) edge points at sprite +Y, which is the swing direction in world.
  const cx = S / 2, cy = S / 2 + S * 0.30;
  const R = S * 0.47, r = S * (thin ? 0.40 : 0.255);
  const span = thin ? 1.16 : 1.38;
  x.save(); x.translate(cx, cy);
  x.beginPath();
  x.arc(0, 0, R, -Math.PI / 2 - span, -Math.PI / 2 + span);
  x.arc(0, 0, r, -Math.PI / 2 + span, -Math.PI / 2 - span, true);
  x.closePath();
  x.fillStyle = '#fff'; x.fill();
  // radial profile: hot at the outer edge, fading inward
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(0, 0, r * 0.78, 0, 0, R * 1.02);
  g.addColorStop(0, W(0));
  g.addColorStop(0.30, W(thin ? 0.24 : 0.34));
  g.addColorStop(0.74, W(0.80));
  g.addColorStop(0.93, W(1));
  g.addColorStop(1, W(0.05));
  x.fillStyle = g; x.fillRect(-S, -S, S * 2, S * 2);
  // taper the tips to points
  const gv = x.createLinearGradient(-R, 0, R, 0);
  gv.addColorStop(0, W(0)); gv.addColorStop(0.16, W(0.42));
  gv.addColorStop(0.5, W(1)); gv.addColorStop(0.84, W(0.42)); gv.addColorStop(1, W(0));
  x.fillStyle = gv; x.fillRect(-S, -S, S * 2, S * 2);
  x.globalCompositeOperation = 'source-over';
  // razor-thin hot lip riding the outer edge
  x.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    x.strokeStyle = W(i ? 0.95 : 0.4);
    x.lineWidth = S * (i ? 0.010 : 0.030);
    x.beginPath();
    x.arc(0, 0, R * 0.982, -Math.PI / 2 - span * 0.9, -Math.PI / 2 + span * 0.9);
    x.stroke();
  }
  x.restore();
}
// annulus with a hot leading edge
function spRing(x, S, thin) {
  const g = x.createRadialGradient(S / 2, S / 2, S * (thin ? 0.4 : 0.26), S / 2, S / 2, S * 0.5);
  g.addColorStop(0, W(0));
  g.addColorStop(thin ? 0.55 : 0.62, W(thin ? 0.22 : 0.45));
  g.addColorStop(0.87, W(1));
  g.addColorStop(0.96, W(0.85));
  g.addColorStop(1, W(0));
  x.fillStyle = g; x.fillRect(0, 0, S, S);
}
// soft bidirectional streak along sprite +Y (velocity-stretch sprite)
function spStreak(x, S, pow, oneSided) {
  for (let y = 0; y < S; y++) {
    const v = 1 - (y + 0.5) / S; // 0 at canvas bottom → sprite -Y
    const along = oneSided
      ? Math.pow(Math.max(0, 1 - v), pow)
      : Math.pow(Math.max(0, Math.sin(Math.PI * v)), pow);
    if (along < 0.004) continue;
    const w = S * (0.035 + 0.13 * along);
    const g = x.createLinearGradient(S / 2 - w, 0, S / 2 + w, 0);
    g.addColorStop(0, W(0)); g.addColorStop(0.34, W(along * 0.45));
    g.addColorStop(0.5, W(along)); g.addColorStop(0.66, W(along * 0.45)); g.addColorStop(1, W(0));
    x.fillStyle = g;
    x.fillRect(S / 2 - w, y, w * 2, 1.02);
  }
}
// anamorphic lens-ish flare: long horizontal spikes + short vertical + core
function spFlare(x, S) {
  const cx = S / 2, cy = S / 2;
  const spike = (dx, dy, len, w, a) => {
    const g = x.createLinearGradient(cx, cy, cx + dx * len, cy + dy * len);
    g.addColorStop(0, W(a)); g.addColorStop(0.22, W(a * 0.42)); g.addColorStop(1, W(0));
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx - dy * w, cy + dx * w);
    x.lineTo(cx + dx * len, cy + dy * len);
    x.lineTo(cx + dy * w, cy - dx * w);
    x.closePath(); x.fill();
  };
  for (let i = 0; i < 2; i++) {
    spike(i ? -1 : 1, 0, S * 0.5, S * 0.022, 1);      // long anamorphic bar
    spike(i ? -1 : 1, 0, S * 0.26, S * 0.05, 0.6);
    spike(0, i ? -1 : 1, S * 0.34, S * 0.020, 0.9);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    spike(Math.cos(a), Math.sin(a), S * 0.19, S * 0.013, 0.42);
  }
  radial(x, cx, cy, S * 0.2, [[0, W(1)], [0.2, W(0.8)], [0.5, W(0.16)], [1, W(0)]]);
}
// soft lit dust / smoke puff (bright, turbulent)
function spPuff(x, S, dense) {
  for (let i = 0; i < 30; i++) {
    const a = rf(0, TAU), r = rf(0, S * 0.24);
    radial(x, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rf(S * 0.1, S * 0.26),
      [[0, W(dense ? 0.2 : 0.11)], [0.55, W(dense ? 0.07 : 0.04)], [1, W(0)]]);
  }
}
// shock dome: half sphere with a bright rim, flat bottom at sprite -Y
function spDome(x, S) {
  const cx = S / 2, cy = S * 0.94;
  x.save();
  x.beginPath(); x.rect(0, 0, S, cy); x.clip();
  const g = x.createRadialGradient(cx, cy, S * 0.24, cx, cy, S * 0.47);
  g.addColorStop(0, W(0)); g.addColorStop(0.72, W(0.1));
  g.addColorStop(0.93, W(0.85)); g.addColorStop(1, W(0));
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  x.restore();
}
// jagged energy bolt
function spBolt(x, S) {
  x.strokeStyle = W(0.9); x.lineCap = 'round'; x.lineJoin = 'round';
  for (let p = 0; p < 3; p++) {
    x.lineWidth = S * (0.09 - p * 0.028);
    x.strokeStyle = W(0.35 + p * 0.3);
    x.beginPath();
    x.moveTo(S * 0.5, S * 0.03);
    let y = S * 0.03;
    while (y < S * 0.97) {
      y += S * rf(0.12, 0.22);
      x.lineTo(S * 0.5 + rf(-0.17, 0.17) * S, Math.min(y, S * 0.97));
    }
    x.stroke();
  }
}
// small hot ember: tiny white core, warm wide halo
function spEmber(x, S) {
  radial(x, S / 2, S / 2, S * 0.5, [[0, W(0.5)], [0.3, W(0.14)], [0.62, W(0.03)], [1, W(0)]]);
  radial(x, S / 2, S / 2, S * 0.13, [[0, W(1)], [0.5, W(0.8)], [1, W(0)]]);
}
// chunky glowing shard silhouette
function spShard(x, S) {
  x.save(); x.translate(S / 2, S / 2);
  x.beginPath();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, r = S * rf(0.22, 0.42);
    const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.75;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
  x.fillStyle = W(0.9); x.fill();
  x.restore();
}

// ---- alpha (normal-blend) sprite cells ----------------------------------
function spSmoke(x, S) {
  radial(x, S / 2, S / 2, S * 0.48, [[0, W(0.16)], [0.45, W(0.08)], [1, W(0)]]);
  for (let i = 0; i < 40; i++) {
    const a = rf(0, TAU), r = rf(0, S * 0.22);
    radial(x, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rf(S * 0.14, S * 0.3),
      [[0, W(0.10)], [0.4, W(0.055)], [1, W(0)]]);
  }
}
function spPetal(x, S) {
  const k = S / 64;
  x.save(); x.translate(S / 2, S / 2); x.rotate(0.6);
  const g = x.createLinearGradient(-14 * k, -18 * k, 10 * k, 16 * k);
  g.addColorStop(0, '#ffe3ee'); g.addColorStop(0.55, '#ffb1c9'); g.addColorStop(1, '#e87ba4');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(0, -19 * k);
  x.bezierCurveTo(13 * k, -14 * k, 13 * k, 8 * k, 2 * k, 17 * k);
  x.bezierCurveTo(-3 * k, 12 * k, -13 * k, 2 * k, -8 * k, -12 * k);
  x.closePath(); x.fill();
  x.restore();
}
// dark angular rock chip
function spRock(x, S) {
  x.save(); x.translate(S / 2, S / 2); x.rotate(rf(0, TAU));
  x.beginPath();
  const n = 5;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rf(-0.3, 0.3), r = S * rf(0.2, 0.4);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
  x.closePath();
  x.fillStyle = 'rgba(255,255,255,1)'; x.fill();
  // baked shading: darker lower-right
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(-S * 0.3, -S * 0.3, S * 0.35, S * 0.35);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = g; x.fillRect(-S, -S, S * 2, S * 2);
  x.globalCompositeOperation = 'source-over';
  x.restore();
}

// Dense billowing smoke lobe. spSmoke tops out at alpha 0.16 — it can only TINT
// what is behind it. A detonation needs mass that OCCLUDES: an opaque-ish core
// with a lobed, hard-ish edge and turbulent holes punched back out, so the puff
// still reads as a shape (and not a grey disc) after the judging downscale.
function spBillow(x, S) {
  const cx = S / 2, cy = S / 2;
  for (let i = 0; i < 10; i++) {
    const a = rf(0, TAU), r = rf(0, S * 0.16);
    radial(x, cx + Math.cos(a) * r, cy + Math.sin(a) * r, rf(S * 0.16, S * 0.27),
      [[0, W(0.92)], [0.30, W(0.70)], [0.60, W(0.33)], [0.84, W(0.09)], [1, W(0)]]);
  }
  // lit shoulders: the top-left of each lobe catches the blast, so the puff has
  // an internal value ramp instead of one flat grey
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(S * 0.18, S * 0.14, S * 0.86, S * 0.9);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(150,150,150,1)');
  g.addColorStop(1, 'rgba(46,46,46,1)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // turbulence: bite holes out of the silhouette so the edge is not a circle
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 16; i++) {
    const a = rf(0, TAU), r = rf(S * 0.14, S * 0.30);
    radial(x, cx + Math.cos(a) * r, cy + Math.sin(a) * r, rf(S * 0.06, S * 0.15),
      [[0, W(rf(0.25, 0.7))], [0.6, W(0.2)], [1, W(0)]]);
  }
  x.globalCompositeOperation = 'source-over';
}
// Hard-edged debris chunk: an OPAQUE angular silhouette with a lit top facet and
// a near-black underside. Additive shard sprites can only add light and so read
// as confetti over a bright core; this reads as thrown stone.
function spChunk(x, S) {
  x.save(); x.translate(S / 2, S / 2); x.rotate(rf(0, TAU));
  const n = 7;
  x.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rf(-0.24, 0.24), r = S * rf(0.24, 0.44);
    const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.84;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
  x.fillStyle = W(1); x.fill();
  x.globalCompositeOperation = 'source-atop';
  const g = x.createLinearGradient(-S * 0.34, -S * 0.38, S * 0.3, S * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.36, 'rgba(120,120,120,1)');
  g.addColorStop(1, 'rgba(26,26,26,1)');
  x.fillStyle = g; x.fillRect(-S, -S, S * 2, S * 2);
  // one bright chipped facet so the chunk has a specular tell at 30 px
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.beginPath();
  x.moveTo(-S * 0.18, -S * 0.24); x.lineTo(S * 0.04, -S * 0.31);
  x.lineTo(-S * 0.02, -S * 0.10); x.closePath(); x.fill();
  x.globalCompositeOperation = 'source-over';
  x.restore();
}

// Build a 4x4 sprite atlas. Sprite id s maps to canvas cell
// (col = s % 4, row = 3 - floor(s / 4)) so uv space matches shader indexing.
function buildAtlas(cellDrawers, S = 512) {
  const c = mkc(S), ctx = c.getContext('2d');
  const cell = S / 4;
  for (let id = 0; id < cellDrawers.length && id < 16; id++) {
    const fn = cellDrawers[id];
    if (!fn) continue;
    ctx.save();
    ctx.translate((id % 4) * cell, (3 - Math.floor(id / 4)) * cell);
    ctx.beginPath(); ctx.rect(0, 0, cell, cell); ctx.clip();
    fn(ctx, cell);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

// Ground-decal atlas (2x2). Channels are independent masks:
//   R = glowing fissures/lines   G = dark scorch   B = rim / secondary glow
function buildDecalAtlas(S = 512) {
  const c = mkc(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  const cell = S / 2;
  const chan = (i) => {
    ctx.save();
    ctx.translate((i % 2) * cell, (1 - Math.floor(i / 2)) * cell);
    ctx.beginPath(); ctx.rect(0, 0, cell, cell); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    return cell;
  };
  const splat = (x, y, r, col, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.01, r));
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(0.6, `rgba(${col},${a * 0.35})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // --- 0: impact crater ---------------------------------------------------
  {
    const s = chan(0), cx = s / 2, cy = s / 2;
    // scorch (green)
    for (let i = 0; i < 40; i++) {
      const a = rf(0, TAU), r = rf(0, s * 0.2);
      splat(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rf(s * 0.1, s * 0.26), '0,255,0', 0.28);
    }
    splat(cx, cy, s * 0.24, '0,255,0', 0.7);
    // rim ring (blue) — thrown-up debris lip
    ctx.strokeStyle = 'rgba(0,0,255,0.34)';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = s * (0.020 - i * 0.006);
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * TAU;
        const r = s * (0.35 + 0.028 * Math.sin(a * 5 + i) + 0.018 * Math.sin(a * 9 - i * 2));
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    }
    // fissures (red) — thin branching cracks that will glow hot
    ctx.lineCap = 'round';
    const crack = (a0, r0, len, w, depth) => {
      let a = a0, r = r0;
      let px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(255,0,0,0.95)';
      ctx.beginPath(); ctx.moveTo(px, py);
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        r += len / seg; a += rf(-0.22, 0.22);
        px = cx + Math.cos(a) * r; py = cy + Math.sin(a) * r;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (depth > 0) {
        for (let b = 0; b < 2; b++) {
          if (rnd() < 0.45) continue;
          crack(a + rf(-0.9, 0.9), r * rf(0.45, 0.8), len * 0.45, w * 0.55, depth - 1);
        }
      }
    };
    for (let i = 0; i < 11; i++) crack((i / 11) * TAU + rf(-0.2, 0.2), s * 0.05, s * rf(0.2, 0.4), s * rf(0.006, 0.013), 1);
    splat(cx, cy, s * 0.1, '255,0,0', 0.5);
    ctx.restore();
  }
  // --- 1: slash scar ------------------------------------------------------
  {
    const s = chan(1), cx = s / 2, cy = s / 2;
    const R = s * 0.42;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? 'rgba(255,0,0,0.85)' : 'rgba(0,255,0,0.55)';
      ctx.lineWidth = s * (pass ? 0.008 : 0.022);
      ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const a = -Math.PI / 2 - 1.05 + (i / 32) * 2.1;
          const r = R + k * s * 0.045 + Math.sin(i * 0.9) * s * 0.008;
          const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.72;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // --- 2: soft scorch blotch ---------------------------------------------
  {
    const s = chan(2), cx = s / 2, cy = s / 2;
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU), r = rf(0, s * 0.2);
      splat(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rf(s * 0.12, s * 0.3), '0,255,0', 0.3);
    }
    ctx.restore();
  }
  // --- 3: rune circle (glyph lines in R) -----------------------------------
  {
    const s = chan(3);
    if (tex.runeRing && tex.runeRing.image) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tex.runeRing.image, 0, 0, s, s);
      // keep only the red channel worth of intensity
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

// Static plaza-wear atlas (2x2). Only the G channel is read (these spawn with
// heat = 0, which zeroes the fissure/rim terms), so each cell is a pure
// darkening MASK; the tint that mask is painted with is per-instance.
// 60% of the gameplay frame is one uniform tan tile field — this is the pass
// that puts texture frequency where the frame already scores best (VFX-2).
function buildWearAtlas(S = 512) {
  const c = mkc(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  const cell = S / 2;
  const chan = (i) => {
    ctx.save();
    ctx.translate((i % 2) * cell, (1 - Math.floor(i / 2)) * cell);
    ctx.beginPath(); ctx.rect(0, 0, cell, cell); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return cell;
  };
  const G = (a) => `rgba(0,${Math.round(255 * a)},0,1)`;
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.01, r));
    g.addColorStop(0, `rgba(0,255,0,${a})`);
    g.addColorStop(0.55, `rgba(0,255,0,${a * 0.42})`);
    g.addColorStop(1, 'rgba(0,255,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // --- 0: crack network ---------------------------------------------------
  {
    const s = chan(0);
    const branch = (x0, y0, ang, len, w, depth) => {
      let x = x0, y = y0, a = ang;
      ctx.lineWidth = w;
      ctx.strokeStyle = G(0.85);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        a += rf(-0.42, 0.42);
        x += Math.cos(a) * (len / 7); y += Math.sin(a) * (len / 7);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (depth > 0) for (let b = 0; b < 2; b++) {
        if (rnd() < 0.4) continue;
        branch(x0 + (x - x0) * rf(0.3, 0.8), y0 + (y - y0) * rf(0.3, 0.8),
          a + rf(-1.3, 1.3), len * rf(0.35, 0.6), w * 0.6, depth - 1);
      }
    };
    for (let i = 0; i < 7; i++) {
      branch(s * rf(0.15, 0.85), s * rf(0.15, 0.85), rf(0, TAU), s * rf(0.24, 0.46), s * rf(0.010, 0.024), 2);
    }
    // spalled chips around the cracks
    for (let i = 0; i < 30; i++) blob(s * rf(0.1, 0.9), s * rf(0.1, 0.9), s * rf(0.014, 0.042), 0.62);
  }
  ctx.restore();
  // --- 1: moss creep along a tile joint -----------------------------------
  {
    const s = chan(1);
    const y0 = s * rf(0.42, 0.58);
    for (let i = 0; i < 90; i++) {
      const t = i / 90;
      const jx = t * s;
      const jy = y0 + Math.sin(t * 9.0) * s * 0.035 + rf(-s * 0.05, s * 0.05);
      blob(jx, jy, s * rf(0.020, 0.062), rf(0.25, 0.62));
    }
    // creep spreading off the joint into the tile faces
    for (let i = 0; i < 40; i++) {
      blob(s * rf(0, 1), y0 + rf(-s * 0.22, s * 0.22), s * rf(0.012, 0.030), rf(0.18, 0.45));
    }
    // a second, fainter joint at right angles
    const x1 = s * rf(0.25, 0.75);
    for (let i = 0; i < 40; i++) blob(x1 + rf(-s * 0.02, s * 0.02), s * (i / 40), s * rf(0.010, 0.030), 0.3);
  }
  ctx.restore();
  // --- 2: damp / ground-in dirt blotch ------------------------------------
  {
    const s = chan(2), cx = s / 2, cy = s / 2;
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU), r = rf(0, s * 0.22);
      blob(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rf(s * 0.10, s * 0.28), 0.24);
    }
    // grain so the blotch is not a soft airbrush at 1:1
    for (let i = 0; i < 260; i++) blob(s * rf(0.06, 0.94), s * rf(0.06, 0.94), s * rf(0.004, 0.014), rf(0.2, 0.6));
  }
  ctx.restore();
  // --- 3: scuff arcs + pits ------------------------------------------------
  {
    const s = chan(3), cx = s / 2, cy = s / 2;
    for (let p = 0; p < 9; p++) {
      const R = s * rf(0.16, 0.44), a0 = rf(0, TAU), sp = rf(0.7, 2.0);
      ctx.lineWidth = s * rf(0.008, 0.022);
      ctx.strokeStyle = G(rf(0.4, 0.8));
      ctx.beginPath();
      for (let i = 0; i <= 26; i++) {
        const a = a0 + (i / 26) * sp;
        const rr = R + Math.sin(i * 0.8) * s * 0.01;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.7;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 60; i++) blob(s * rf(0.08, 0.92), s * rf(0.08, 0.92), s * rf(0.006, 0.022), rf(0.3, 0.75));
  }
  ctx.restore();

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

// sprite ids -------------------------------------------------------------
const S_DOT = 0, S_SPARK = 1, S_SLASH = 2, S_RING = 3;
const S_STREAK = 4, S_FLARE = 5, S_EMBER = 6, S_CRESC = 7;
const S_RAY = 8, S_GLOW = 9, S_PUFF = 10, S_BOLT = 11;
const S_HALO = 12, S_DOME = 13, S_SHARD = 14, S_SPARK2 = 15;
const A_SMOKE = 0, A_PETAL = 1, A_CRACK = 2, A_DOT = 3;
const A_ROCK = 4, A_SOOT = 5, A_WISP = 6;
const A_BILLOW = 8, A_CHUNK = 9;
// wear atlas cells
const WR_CRACK = 0, WR_MOSS = 1, WR_DAMP = 2, WR_SCUFF = 3;

const PKEYS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size0', 'size1',
  'rot', 'rotV', 'grav', 'drag', 'cr', 'cg', 'cb', 'cr2', 'cg2', 'cb2', 'alpha',
  'sprite', 'stretch', 'dx', 'dy', 'dz', 'fp'];

// ========================================================= particle pool ==
class ParticlePool {
  constructor(scene, cap, texture, additive, renderOrder) {
    this.cap = cap;
    this.n = 0;
    for (const k of PKEYS) this[k] = new Float32Array(cap);

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // size, rot, alpha, sprite
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aExt = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);  // stretch, dir.xyz
    for (const a of [this.aPos, this.aData, this.aCol, this.aExt]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aExt', this.aExt);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { tMap: { value: texture }, uHole, uHoleK, uMinAng },
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aData; attribute vec3 aCol; attribute vec4 aExt;
        uniform float uMinAng;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        varying vec3 vWP;
        void main() {
          vUv = uv; vCol = aCol; vA = aData.z; vSprite = aData.w;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float st = max(aExt.x, 1.0);
          vec2 dir;
          if (aExt.x > 1.001) {
            vec2 sv = vec2(dot(aExt.yzw, right), dot(aExt.yzw, up));
            float l = length(sv);
            dir = (l > 1e-4) ? sv / l : vec2(0.0, 1.0);
          } else {
            dir = vec2(-sin(aData.y), cos(aData.y));
          }
          // never let a spark shrink below a minimum solid angle
          float sz = max(aData.x, length(aPos - cameraPosition) * uMinAng);
          vec2 ax = vec2(dir.y, -dir.x);
          vec2 p = (ax * position.x + dir * position.y * st) * sz;
          vec3 wp = aPos + right * p.x + up * p.y;
          vWP = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        varying vec3 vWP;
        ${HOLE_GLSL}
        void main() {
          vec2 cell = vec2(mod(vSprite, 4.0), floor(vSprite / 4.0));
          vec4 c = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.25);
          gl_FragColor = vec4(c.rgb * vCol, c.a * vA * holeFade(vWP));
          if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    const vx = o.vx || 0, vy = o.vy || 0, vz = o.vz || 0;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = 0; this.maxLife[i] = o.life || 0.6;
    this.size0[i] = o.size ?? 0.3; this.size1[i] = o.sizeEnd ?? (o.size ?? 0.3);
    this.rot[i] = o.rot || 0; this.rotV[i] = o.rotV || 0;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag ?? 0.5;
    const glow = o.glow || 1;
    _c.setHex(o.col ?? 0xffffff);
    this.cr[i] = _c.r * glow; this.cg[i] = _c.g * glow; this.cb[i] = _c.b * glow;
    if (o.colEnd !== undefined) {
      const g2 = o.glowEnd ?? glow;
      _c.setHex(o.colEnd);
      this.cr2[i] = _c.r * g2; this.cg2[i] = _c.g * g2; this.cb2[i] = _c.b * g2;
    } else {
      this.cr2[i] = this.cr[i]; this.cg2[i] = this.cg[i]; this.cb2[i] = this.cb[i];
    }
    this.alpha[i] = o.alpha ?? 1;
    this.sprite[i] = o.sprite || 0;
    const st = o.stretch || 1;
    this.stretch[i] = st;
    if (st > 1) {
      let dx = o.dirX, dy = o.dirY, dz = o.dirZ;
      if (dx === undefined) { dx = vx; dy = vy; dz = vz; }
      const l = Math.hypot(dx, dy, dz) || 1;
      this.dx[i] = dx / l; this.dy[i] = dy / l; this.dz[i] = dz / l;
    } else { this.dx[i] = 0; this.dy[i] = 1; this.dz[i] = 0; }
    this.fp[i] = o.fadePow ?? 2;
  }

  kill(i) {
    const l = --this.n;
    if (i !== l) for (let k = 0; k < PKEYS.length; k++) { const A = this[PKEYS[k]]; A[i] = A[l]; }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr;
      this.vy[i] = this.vy[i] * dr - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
    const n = this.n;
    const P = this.aPos.array, D = this.aData.array, C = this.aCol.array, E = this.aExt.array;
    for (let j = 0; j < n; j++) {
      const t = this.life[j] / this.maxLife[j];
      const j3 = j * 3, j4 = j * 4;
      P[j3] = this.px[j]; P[j3 + 1] = this.py[j]; P[j3 + 2] = this.pz[j];
      D[j4] = this.size0[j] + (this.size1[j] - this.size0[j]) * t;
      D[j4 + 1] = this.rot[j];
      const fadeIn = Math.min(1, this.life[j] * 16);
      D[j4 + 2] = this.alpha[j] * fadeIn * Math.max(0, 1 - Math.pow(t, this.fp[j]));
      D[j4 + 3] = this.sprite[j];
      C[j3] = this.cr[j] + (this.cr2[j] - this.cr[j]) * t;
      C[j3 + 1] = this.cg[j] + (this.cg2[j] - this.cg[j]) * t;
      C[j3 + 2] = this.cb[j] + (this.cb2[j] - this.cb[j]) * t;
      E[j4] = this.stretch[j]; E[j4 + 1] = this.dx[j]; E[j4 + 2] = this.dy[j]; E[j4 + 3] = this.dz[j];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      pushRange(this.aPos, n * 3); pushRange(this.aData, n * 4);
      pushRange(this.aCol, n * 3); pushRange(this.aExt, n * 4);
    }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// Upload only the live slice of an instanced attribute. The range record is
// allocated once per attribute and then reused, so the loop stays alloc-free.
function pushRange(attr, count) {
  const r = attr.updateRanges;
  if (r) {
    if (r.length === 0) r.push({ start: 0, count });
    else { r[0].start = 0; r[0].count = count; r.length = 1; }
  }
  attr.needsUpdate = true;
}

// ====================================================== oriented quads ====
// Additive quads with an explicit world basis (mode 0) or a Y-axis billboard
// (mode 1). Used for crescent slashes, light pillars and shock domes.
const AKEYS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'yaw', 'el', 'roll',
  'rollV', 'sx0', 'sx1', 'sy0', 'sy1', 'cr', 'cg', 'cb', 'a0', 'sprite', 'mode', 'grav', 'fp',
  'yoff', 'pin'];
class ArcPool {
  constructor(scene, cap, texture, renderOrder) {
    this.cap = cap; this.n = 0;
    for (const k of AKEYS) this[k] = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aR = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aU = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); // alpha, sprite, mode
    for (const a of [this.aPos, this.aR, this.aU, this.aCol, this.aData]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aR', this.aR);
    geo.setAttribute('aU', this.aU);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aData', this.aData);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { tMap: { value: texture }, uHole, uHoleK },
      vertexShader: `
        attribute vec3 aPos; attribute vec3 aR; attribute vec3 aU; attribute vec3 aCol; attribute vec3 aData;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        varying vec3 vWP;
        void main() {
          vUv = uv; vCol = aCol; vA = aData.x; vSprite = aData.y;
          vec3 R = aR, U = aU;
          if (aData.z > 0.5) {
            vec3 toCam = normalize(cameraPosition - aPos);
            vec3 s = cross(vec3(0.0, 1.0, 0.0), toCam);
            float l = length(s);
            R = (l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0)) * aR.x;
            U = vec3(0.0, aU.y, 0.0);
          }
          vec3 wp = aPos + R * position.x + U * position.y;
          vWP = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        varying vec3 vWP;
        ${HOLE_GLSL}
        void main() {
          vec2 cell = vec2(mod(vSprite, 4.0), floor(vSprite / 4.0));
          vec4 c = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.25);
          gl_FragColor = vec4(c.rgb * vCol, c.a * vA * holeFade(vWP));
          if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 0.3;
    this.yaw[i] = o.yaw || 0; this.el[i] = o.el || 0;
    this.roll[i] = o.roll || 0; this.rollV[i] = o.rollV || 0;
    this.sx0[i] = o.sx0 ?? 1; this.sx1[i] = o.sx1 ?? this.sx0[i];
    this.sy0[i] = o.sy0 ?? 1; this.sy1[i] = o.sy1 ?? this.sy0[i];
    const glow = o.glow || 1;
    _c.setHex(o.col ?? 0xffffff);
    this.cr[i] = _c.r * glow; this.cg[i] = _c.g * glow; this.cb[i] = _c.b * glow;
    this.a0[i] = o.alpha ?? 1;
    this.sprite[i] = o.sprite ?? S_CRESC;
    this.mode[i] = o.mode || 0;
    this.grav[i] = o.gravity || 0;
    this.fp[i] = o.fadePow ?? 2;
    this.yoff[i] = o.yoff || 0;
    this.pin[i] = o.pin ? 1 : 0;   // keep the quad's bottom edge on aPos.y
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) for (let k = 0; k < AKEYS.length; k++) { const A = this[AKEYS[k]]; A[i] = A[l]; }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); continue; }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.roll[i] += this.rollV[i] * dt;
      i++;
    }
    const n = this.n;
    const P = this.aPos.array, R = this.aR.array, U = this.aU.array, C = this.aCol.array, D = this.aData.array;
    for (let j = 0; j < n; j++) {
      const t = this.life[j] / this.maxLife[j];
      const j3 = j * 3;
      const sx = this.sx0[j] + (this.sx1[j] - this.sx0[j]) * t;
      const sy = this.sy0[j] + (this.sy1[j] - this.sy0[j]) * t;
      P[j3] = this.px[j];
      P[j3 + 1] = this.py[j] + this.yoff[j] + (this.pin[j] ? sy * 0.5 : 0);
      P[j3 + 2] = this.pz[j];
      if (this.mode[j] > 0.5) {
        R[j3] = sx; R[j3 + 1] = 0; R[j3 + 2] = 0;
        U[j3] = 0; U[j3 + 1] = sy; U[j3 + 2] = 0;
      } else {
        const cy = Math.cos(this.yaw[j]), sy2 = Math.sin(this.yaw[j]);
        const ce = Math.cos(this.el[j]), se = Math.sin(this.el[j]);
        // base: right = ground-perpendicular, up = swing direction lifted by el
        let rx = cy, ry = 0, rz = -sy2;
        let ux = sy2 * ce, uy = se, uz = cy * ce;
        const rl = this.roll[j];
        if (rl !== 0) {
          const cr = Math.cos(rl), sr = Math.sin(rl);
          const nrx = rx * cr + ux * sr, nry = ry * cr + uy * sr, nrz = rz * cr + uz * sr;
          ux = -rx * sr + ux * cr; uy = -ry * sr + uy * cr; uz = -rz * sr + uz * cr;
          rx = nrx; ry = nry; rz = nrz;
        }
        R[j3] = rx * sx; R[j3 + 1] = ry * sx; R[j3 + 2] = rz * sx;
        U[j3] = ux * sy; U[j3 + 1] = uy * sy; U[j3 + 2] = uz * sy;
      }
      C[j3] = this.cr[j]; C[j3 + 1] = this.cg[j]; C[j3 + 2] = this.cb[j];
      const fadeIn = Math.min(1, this.life[j] * 40);
      D[j3] = this.a0[j] * fadeIn * Math.max(0, 1 - Math.pow(t, this.fp[j]));
      D[j3 + 1] = this.sprite[j];
      D[j3 + 2] = this.mode[j];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      pushRange(this.aPos, n * 3); pushRange(this.aR, n * 3); pushRange(this.aU, n * 3);
      pushRange(this.aCol, n * 3); pushRange(this.aData, n * 3);
    }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ======================================================== shockwave rings ==
// Procedural ground rings: bright wobbling leading edge, hot inner falloff with
// radial streaks, and a smoky trailing skirt (premultiplied so one pass gives
// both additive light and soft dust darkening).
class RingPool {
  constructor(scene, cap) {
    this.cap = cap; this.n = 0;
    this.t = new Float32Array(cap); this.dur = new Float32Array(cap);
    this.r0 = new Float32Array(cap); this.r1 = new Float32Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.cr = new Float32Array(cap); this.cg = new Float32Array(cap); this.cb = new Float32Array(cap);
    this.alpha = new Float32Array(cap); this.th = new Float32Array(cap);
    this.dust = new Float32Array(cap); this.emis = new Float32Array(cap);
    this.ease = new Float32Array(cap);

    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // xyz, radius
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // t, thick, emis, dust
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (const a of [this.aPos, this.aPar, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aPar', this.aPar);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uTime },
      vertexShader: `
        attribute vec4 aPos; attribute vec4 aPar; attribute vec3 aCol;
        varying vec2 vUv; varying vec4 vP; varying vec3 vCol; varying float vSeed;
        void main() {
          vUv = uv; vP = aPar; vCol = aCol;
          vSeed = fract(aPos.x * 0.137 + aPos.z * 0.0731) * 6.2831;
          vec3 wp = aPos.xyz + position * aPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv; varying vec4 vP; varying vec3 vCol; varying float vSeed;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q);
          if (d > 1.02) discard;
          float ang = atan(q.y, q.x);
          float t = vP.x, th = clamp(vP.y, 0.010, 0.34);
          // the front distorts more as it travels
          float wob = 1.0
            + (0.026 + 0.050 * t) * sin(ang * 5.0 + vSeed)
            + (0.015 + 0.028 * t) * sin(ang * 11.0 - vSeed * 1.7 + t * 3.0)
            + 0.011 * sin(ang * 21.0 + vSeed * 2.3);
          float dd = d / wob;
          // bright leading edge hugging dd = 1
          float lead = smoothstep(1.0 - th, 1.0 - th * 0.18, dd) * (1.0 - smoothstep(1.0, 1.0 + th * 0.28, dd));
          lead = pow(lead, 1.9);
          float streak = 0.5 + 0.5 * sin(ang * 17.0 + vSeed * 3.0) * sin(ang * 7.0 - vSeed);
          float hot = smoothstep(1.0 - th * 2.6, 1.0 - th * 0.5, dd) * (1.0 - smoothstep(1.0, 1.0 + th * 0.2, dd));
          // smoky skirt trailing behind the front (width capped so wide rings
          // stay rings instead of turning into filled discs)
          float sw = min(th * 5.5, 0.45);
          float skirt = smoothstep(1.0 - sw, 1.0 - th * 0.9, dd) * (1.0 - smoothstep(1.0 - th * 0.15, 1.0 + th * 0.15, dd));
          float turb = 0.55 + 0.45 * sin(ang * 9.0 - vSeed * 4.0 + uTime * 1.5);
          float a = skirt * turb * vP.w;
          vec3 dustCol = vec3(0.075, 0.061, 0.050);
          vec3 emis = vCol * (lead * 1.30 + hot * 0.16 * streak) * vP.z;
          emis += vec3(1.0, 0.94, 0.84) * lead * lead * 0.26 * vP.z;
          gl_FragColor = vec4(emis + dustCol * a, a);
          if (gl_FragColor.a < 0.002 && emis.r + emis.g + emis.b < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(o) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { // recycle the oldest
      i = 0; let best = -1;
      for (let k = 0; k < this.n; k++) { const p = this.t[k] / this.dur[k]; if (p > best) { best = p; i = k; } }
    }
    this.t[i] = 0; this.dur[i] = o.dur || 0.5;
    this.r0[i] = o.r0 ?? 0.3; this.r1[i] = o.r1 ?? 5;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    _c.setHex(o.col ?? 0xffffff);
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    this.alpha[i] = o.alpha ?? 1;
    this.th[i] = o.thick ?? 0.13;
    this.dust[i] = o.dust ?? 0.3;
    this.emis[i] = o.emis ?? 1;
    this.ease[i] = o.ease ?? 3;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) {
      for (const k of ['t', 'dur', 'r0', 'r1', 'x', 'y', 'z', 'cr', 'cg', 'cb', 'alpha', 'th', 'dust', 'emis', 'ease'])
        this[k][i] = this[k][l];
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      if (this.t[i] >= this.dur[i]) { this.kill(i); continue; }
      i++;
    }
    const n = this.n;
    const P = this.aPos.array, R = this.aPar.array, C = this.aCol.array;
    for (let j = 0; j < n; j++) {
      const t = Math.min(this.t[j] / this.dur[j], 1);
      const e = 1 - Math.pow(1 - t, this.ease[j]);
      const r = this.r0[j] + (this.r1[j] - this.r0[j]) * e;
      const j4 = j * 4, j3 = j * 3;
      P[j4] = this.x[j]; P[j4 + 1] = this.y[j]; P[j4 + 2] = this.z[j]; P[j4 + 3] = r;
      // thickness shrinks (in world terms it stays similar as radius grows)
      R[j4] = t;
      R[j4 + 1] = Math.max(0.012, this.th[j] * (this.r0[j] + 1.0) / (r + 1.0) * 1.9);
      const fade = Math.pow(1 - t, 0.9);
      R[j4 + 2] = this.alpha[j] * this.emis[j] * fade;
      R[j4 + 3] = this.alpha[j] * this.dust[j] * Math.pow(1 - t, 1.4) * Math.min(1, t * 6);
      C[j3] = this.cr[j]; C[j3 + 1] = this.cg[j]; C[j3 + 2] = this.cb[j];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { pushRange(this.aPos, n * 4); pushRange(this.aPar, n * 4); pushRange(this.aCol, n * 3); }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ============================================================ ground decals ==
// Dark scorch (alpha blend) + glowing fissures that cool from white-hot to
// dull red, in one premultiplied pass.
class DecalPool {
  constructor(scene, cap, texture, renderOrder = 3, staticMode = false) {
    this.cap = cap; this.n = 0;
    this.staticMode = staticMode;
    for (const k of ['t', 'dur', 'hot', 'x', 'y', 'z', 'size', 'rot', 'sprite', 'cr', 'cg', 'cb', 'a', 'wear'])
      this[k] = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // xyz, halfsize
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // rot, heat, alpha, sprite
    // .w is the WEAR flag: 0 = blast decal (rgb is the hot fissure colour),
    // 1 = static grime (rgb is the darkening tint, emissive term forced off).
    // Both pools instantiate the same class, so they still share one program.
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aPar, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aPar', this.aPar);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tMap: { value: texture } },
      vertexShader: `
        attribute vec4 aPos; attribute vec4 aPar; attribute vec4 aCol;
        varying vec2 vUv; varying vec3 vPar; varying vec4 vCol; varying float vSprite;
        void main() {
          float c = cos(aPar.x), s = sin(aPar.x);
          vec3 p = vec3(position.x * c - position.z * s, 0.0, position.x * s + position.z * c) * aPos.w;
          vUv = uv; vPar = vec3(aPar.y, aPar.z, 0.0); vCol = aCol; vSprite = aPar.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + p, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vPar; varying vec4 vCol; varying float vSprite;
        void main() {
          vec2 cell = vec2(mod(vSprite, 2.0), floor(vSprite / 2.0));
          vec3 m = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.5).rgb;
          float heat = vPar.x, sa = vPar.y, wear = vCol.w;
          float edgeFade = 1.0 - smoothstep(0.80, 1.0, length(vUv - 0.5) * 2.0);
          float a = clamp(m.g * sa * edgeFade, 0.0, 0.88);
          // fissures cool: white-gold -> orange -> deep red -> out
          vec3 hotCol = mix(vec3(0.75, 0.10, 0.02), vCol.rgb, smoothstep(0.0, 0.75, heat));
          hotCol = mix(hotCol, vec3(1.0, 0.93, 0.78), smoothstep(0.72, 1.0, heat));
          float fis = m.r * pow(heat, 0.55);
          float rim = m.b * heat * 0.55;
          vec3 emis = hotCol * (fis * fis * 1.35 + fis * 0.30 + rim) * (1.0 - wear);
          vec3 dark = mix(vec3(0.055, 0.040, 0.030), vCol.rgb, wear);
          gl_FragColor = vec4(dark * a + emis, a);
          if (gl_FragColor.a < 0.003 && emis.r + emis.g + emis.b < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(o) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = 0; let best = -1; for (let k = 0; k < this.n; k++) { const p = this.t[k] / this.dur[k]; if (p > best) { best = p; i = k; } } }
    // t0 lets a static decal skip the 0.07 s fade-in, so it is already on screen
    // for the very first rendered frame instead of popping in.
    this.t[i] = o.t0 || 0; this.dur[i] = o.dur || 7;
    this.hot[i] = o.hot ?? 0;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    this.size[i] = o.size * 0.5;
    this.rot[i] = o.rot ?? rf(0, TAU);
    this.sprite[i] = o.sprite || 0;
    _c.setHex(o.col ?? 0xffb04d);
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    this.a[i] = o.alpha ?? 1;
    this.wear[i] = o.wear ? 1 : 0;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) for (const k of ['t', 'dur', 'hot', 'x', 'y', 'z', 'size', 'rot', 'sprite', 'cr', 'cg', 'cb', 'a', 'wear'])
      this[k][i] = this[k][l];
  }
  update(dt) {
    // static pools (plaza wear) are written once by flush() and then never
    // touched again — no ageing, no per-frame attribute upload.
    if (this.staticMode) return;
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      if (this.t[i] >= this.dur[i]) { this.kill(i); continue; }
      i++;
    }
    this.flush();
  }
  flush() {
    const n = this.n;
    const P = this.aPos.array, R = this.aPar.array, C = this.aCol.array;
    for (let j = 0; j < n; j++) {
      const t = this.t[j] / this.dur[j];
      const j4 = j * 4;
      P[j4] = this.x[j]; P[j4 + 1] = this.y[j]; P[j4 + 2] = this.z[j]; P[j4 + 3] = this.size[j];
      R[j4] = this.rot[j];
      // heat cools over ~2 s regardless of the scorch lifetime
      const heat = this.hot[j] > 0 ? Math.max(0, 1 - this.t[j] / (this.hot[j] * 2.0)) : 0;
      R[j4 + 1] = heat * heat * (0.35 + 0.65 * heat);
      R[j4 + 2] = this.a[j] * Math.min(1, this.t[j] * 14) * Math.pow(1 - t, 1.6);
      R[j4 + 3] = this.sprite[j];
      C[j4] = this.cr[j]; C[j4 + 1] = this.cg[j]; C[j4 + 2] = this.cb[j]; C[j4 + 3] = this.wear[j];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { pushRange(this.aPos, n * 4); pushRange(this.aPar, n * 4); pushRange(this.aCol, n * 4); }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ============================================================= telegraphs ==
class TelePool {
  constructor(scene, cap) {
    this.cap = cap;
    this.slots = [];
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); // age, alpha, prog
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (const a of [this.aPos, this.aPar, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aPar', this.aPar);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uTime, tRune: { value: tex.runeRing } },
      vertexShader: `
        attribute vec4 aPos; attribute vec3 aPar; attribute vec3 aCol;
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol; varying float vR;
        void main() {
          vUv = uv; vPar = aPar; vCol = aCol; vR = aPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + position * aPos.w, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D tRune;
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol; varying float vR;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q);
          if (d > 1.001) discard;
          float age = vPar.x, A = vPar.y, prog = vPar.z;
          float ang = atan(q.y, q.x);
          // Line weights are WORLD units converted to normalised radius, so a
          // 5.5 m telegraph and a 2 m one draw the same physical stroke instead
          // of the big one turning into a CAD hairline at map scale.
          float u = 1.0 / max(vR, 0.35);         // 1 world metre in q-space
          float wRim  = clamp(0.165 * u, 0.018, 0.22);
          float wThin = clamp(0.075 * u, 0.010, 0.11);
          // outer rim: double line, pulsing, with a soft outward falloff over
          // ~8% of the radius so the edge sits in the world instead of floating
          float pulse = 0.72 + 0.28 * sin(uTime * 7.0);
          float rim = (1.0 - smoothstep(0.0, wRim, abs(d - 0.960))) * pulse;
          rim += (1.0 - smoothstep(0.0, wThin, abs(d - 0.855))) * 0.55;
          float bleed = smoothstep(1.075, 0.960, d) * smoothstep(0.885, 0.955, d) * 0.42 * pulse;
          // radar sweep
          float sw = fract((ang / 6.2831) + 0.5 - uTime * 0.55);
          float sweep = pow(1.0 - sw, 7.0) * (1.0 - smoothstep(0.86, 1.0, d)) * 0.65;
          // interior membrane: an actual surface that charges with the cast,
          // 0.10 → 0.16 alpha, not the empty air a wireframe leaves behind
          float interior = (0.10 + 0.06 * prog)
                         * (0.80 + 0.20 * sin(uTime * 4.0 - d * 5.0))
                         * (1.0 - smoothstep(0.55, 1.0, d) * 0.35);
          float fill = step(d, prog) * (0.09 + 0.05 * sin(uTime * 6.0 - d * 8.0));
          fill += smoothstep(prog + 0.06, prog - 0.02, d) * smoothstep(prog - 0.16, prog - 0.02, d) * 0.5;
          // marching chevrons
          float chev = smoothstep(0.86, 0.99, fract(d * 3.0 - uTime * 1.4)) * (1.0 - smoothstep(0.5, 0.95, d)) * 0.22;
          // rune band
          vec2 ru = (q * 1.06) * 0.5 + 0.5;
          float rr = texture2D(tRune, clamp(ru, 0.0, 1.0)).a * (0.55 + 0.45 * sin(uTime * 3.0));
          float glow = (rim * 1.5 + bleed + sweep + fill + chev + rr * 0.85 + interior * 1.0) * A;
          // multiply pass: darken the paving underneath so the decal sits ON the
          // stone. Strongest just inside the rim, where a real shadow would be.
          float dark = ((1.0 - smoothstep(0.62, 1.02, d)) * 0.16
                      + interior * 1.1
                      + (1.0 - smoothstep(0.0, wRim * 2.2, abs(d - 0.960))) * 0.26) * A;
          dark = min(dark, 0.34);
          gl_FragColor = vec4(vCol * glow * 1.25 + vec3(0.030, 0.022, 0.016) * dark, dark);
          if (gl_FragColor.a < 0.003 && glow < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5.5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    for (let i = 0; i < cap; i++) {
      this.slots.push({ active: false, x: 0, y: 0, z: 0, r: 1, age: 0, alpha: 1, prog: 0, cr: 1, cg: 1, cb: 1, dying: 0 });
    }
  }
  acquire(x, y, z, r, colHex) {
    for (const T of this.slots) {
      if (T.active || T.dying > 0) continue;
      T.active = true; T.dying = 0;
      T.x = x; T.y = y; T.z = z; T.r = r; T.age = 0; T.alpha = 1; T.prog = 0;
      _c.setHex(colHex);
      T.cr = _c.r; T.cg = _c.g; T.cb = _c.b;
      return T;
    }
    return null;
  }
  release(T) { if (T && T.active) { T.active = false; T.dying = 0.18; } }
  update(dt) {
    let n = 0;
    const P = this.aPos.array, R = this.aPar.array, C = this.aCol.array;
    for (const T of this.slots) {
      if (!T.active && T.dying <= 0) continue;
      T.age += dt;
      if (!T.active) { T.dying -= dt; T.alpha = Math.max(0, T.dying / 0.18); if (T.dying <= 0) continue; }
      else T.prog = Math.min(1, T.prog + dt * 1.5);
      const j4 = n * 4, j3 = n * 3;
      P[j4] = T.x; P[j4 + 1] = T.y; P[j4 + 2] = T.z; P[j4 + 3] = T.r;
      R[j3] = T.age; R[j3 + 1] = T.alpha * Math.min(1, T.age * 7); R[j3 + 2] = T.prog;
      C[j3] = T.cr; C[j3 + 1] = T.cg; C[j3 + 2] = T.cb;
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { pushRange(this.aPos, n * 4); pushRange(this.aPar, n * 3); pushRange(this.aCol, n * 3); }
  }
  clear() {
    for (const T of this.slots) { T.active = false; T.dying = 0; }
    this.geo.instanceCount = 0; this.mesh.visible = false;
  }
}

// ================================================================== beams ==
class BeamPool {
  constructor(scene, cap) {
    this.cap = cap; this.n = 0;
    for (const k of ['t', 'dur', 'delay', 'r', 'ax', 'ay', 'az', 'bx', 'by', 'bz', 'cr', 'cg', 'cb', 'fired'])
      this[k] = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); // radius, alpha
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (const a of [this.aA, this.aB, this.aPar, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aA', this.aA);
    geo.setAttribute('aB', this.aB);
    geo.setAttribute('aPar', this.aPar);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime, uMinAng },
      vertexShader: `
        attribute vec3 aA; attribute vec3 aB; attribute vec2 aPar; attribute vec3 aCol;
        uniform float uMinAng;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main() {
          vUv = uv; vCol = aCol; vA = aPar.y;
          float s = position.y + 0.5;
          vec3 p = mix(aA, aB, s);
          vec3 axis = normalize(aB - aA);
          vec3 toCam = cameraPosition - p;
          float camD = length(toCam);
          vec3 side = cross(axis, toCam / max(camD, 1e-4));
          float l = length(side);
          side = (l > 1e-4) ? side / l : vec3(1.0, 0.0, 0.0);
          // tower beams must still read as beams from the overview camera
          float rad = max(aPar.x, camD * uMinAng * 1.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(p + side * position.x * rad * 2.0, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main() {
          float x = abs(vUv.x - 0.5) * 2.0;
          float k = max(0.0, 1.0 - x);
          float core = pow(k, 7.0);
          float glow = pow(k, 2.2);
          float ends = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          float flow = 0.8 + 0.2 * sin((vUv.y - uTime * 5.0) * 55.0);
          vec3 c = vCol * glow * 1.35 * flow + vec3(1.0, 0.97, 0.92) * core * 2.0;
          gl_FragColor = vec4(c * vA * ends, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(from, to, dur, r, colHex, delay) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = 0; let best = -1; for (let k = 0; k < this.n; k++) { const p = this.t[k] / this.dur[k]; if (p > best) { best = p; i = k; } } }
    this.t[i] = 0; this.dur[i] = dur; this.delay[i] = delay; this.r[i] = r; this.fired[i] = 0;
    this.ax[i] = from.x; this.ay[i] = from.y; this.az[i] = from.z;
    this.bx[i] = to.x; this.by[i] = to.y; this.bz[i] = to.z;
    _c.setHex(colHex);
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    return i;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) for (const k of ['t', 'dur', 'delay', 'r', 'ax', 'ay', 'az', 'bx', 'by', 'bz', 'cr', 'cg', 'cb', 'fired'])
      this[k][i] = this[k][l];
  }
  update(dt, onFire) {
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      if (this.t[i] >= this.dur[i] + this.delay[i]) { this.kill(i); continue; }
      if (!this.fired[i] && this.t[i] >= this.delay[i]) {
        this.fired[i] = 1;
        onFire(this.bx[i], this.by[i], this.bz[i], this.cr[i], this.cg[i], this.cb[i]);
      }
      i++;
    }
    const n = this.n;
    let m = 0;
    const A = this.aA.array, B = this.aB.array, R = this.aPar.array, C = this.aCol.array;
    for (let j = 0; j < n; j++) {
      if (this.t[j] < this.delay[j]) continue;
      const t = Math.min((this.t[j] - this.delay[j]) / this.dur[j], 1);
      const m3 = m * 3, m2 = m * 2;
      A[m3] = this.ax[j]; A[m3 + 1] = this.ay[j]; A[m3 + 2] = this.az[j];
      B[m3] = this.bx[j]; B[m3 + 1] = this.by[j]; B[m3 + 2] = this.bz[j];
      // snap: overshoot the width for ~1 frame, then thin out
      const w = t < 0.09 ? 1.0 + (1.0 - t / 0.09) * 1.5 : 1.0 - (t - 0.09) * 0.55;
      R[m2] = this.r[j] * Math.max(0.15, w);
      R[m2 + 1] = Math.pow(1 - t, 1.7);
      C[m3] = this.cr[j]; C[m3 + 1] = this.cg[j]; C[m3 + 2] = this.cb[j];
      m++;
    }
    this.geo.instanceCount = m;
    this.mesh.visible = m > 0;
    if (m > 0) { pushRange(this.aA, m * 3); pushRange(this.aB, m * 3); pushRange(this.aPar, m * 2); pushRange(this.aCol, m * 3); }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ================================================================ debris ===
// Real chunky shards: ballistic arcs, tumbling, ground bounce, shadow casting.
class DebrisPool {
  constructor(scene, cap) {
    this.cap = cap; this.n = 0;
    for (const k of ['t', 'dur', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'sc', 'ax', 'ay', 'az', 'aw', 'ground',
      'hot', 'br', 'bg', 'bb'])
      this[k] = new Float32Array(cap);
    this.qx = new Float32Array(cap); this.qy = new Float32Array(cap);
    this.qz = new Float32Array(cap); this.qw = new Float32Array(cap);

    const parts = [];
    const g0 = new THREE.IcosahedronGeometry(0.5, 0);
    const pos = g0.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i,
        pos.getX(i) * rf(0.6, 1.35),
        pos.getY(i) * rf(0.45, 1.1),
        pos.getZ(i) * rf(0.6, 1.35));
    }
    g0.computeVertexNormals();
    const geo = mergeGeometries([g0.toNonIndexed()], false);
    // Flat shading gave every chunk one dead value per face — at blast scale
    // that reads as cut paper. Jitter the per-vertex normals off the face normal
    // instead: each triangle still reads faceted but carries a gradient, so the
    // chunks tumble with real form.
    {
      const np = geo.attributes.position, nn = geo.attributes.normal;
      const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _cc = new THREE.Vector3();
      const _n = new THREE.Vector3();
      for (let f = 0; f < np.count; f += 3) {
        _a.fromBufferAttribute(np, f); _b.fromBufferAttribute(np, f + 1); _cc.fromBufferAttribute(np, f + 2);
        _b.sub(_a); _cc.sub(_a);
        _n.crossVectors(_b, _cc).normalize();
        for (let k = 0; k < 3; k++) {
          _a.set(_n.x + rf(-0.42, 0.42), _n.y + rf(-0.42, 0.42), _n.z + rf(-0.42, 0.42)).normalize();
          nn.setXYZ(f + k, _a.x, _a.y, _a.z);
        }
      }
      nn.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      // Lightness used to run to 0.74 — pale sand chips with a 30-value spread,
      // which against a saturated blast read as paper confetti rather than
      // shattered stone. Darker and wider now, so the chunks carry a real value
      // range and some of them silhouette instead of glowing.
      _c.setHSL(0.082 + rf(-0.02, 0.03), rf(0.12, 0.34), rf(0.16, 0.50));
      this.mesh.setColorAt(i, _c);
      this.br[i] = _c.r; this.bg[i] = _c.g; this.bb[i] = _c.b;
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.mesh.instanceColor.needsUpdate = true;
    }
    scene.add(this.mesh);
    this.warm = 2;
    this.anyHot = false;
  }
  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.t[i] = 0; this.dur[i] = o.life;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.sc[i] = o.size;
    this.ground[i] = o.ground ?? 0;
    // blast light: chunks near the core take the warm flash, chunks at the rim
    // barely do. Decays over 0.4 s (see update()).
    this.hot[i] = o.hot ?? 0;
    if (this.hot[i] > 0) this.anyHot = true;
    const l = Math.hypot(o.ax, o.ay, o.az) || 1;
    this.ax[i] = o.ax / l; this.ay[i] = o.ay / l; this.az[i] = o.az / l;
    this.aw[i] = o.spin;
    this.qx[i] = 0; this.qy[i] = 0; this.qz[i] = 0; this.qw[i] = 1;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) {
      for (const k of ['t', 'dur', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'sc', 'ax', 'ay', 'az', 'aw', 'ground',
        'hot', 'qx', 'qy', 'qz', 'qw'])
        this[k][i] = this[k][l];
      // br/bg/bb deliberately do NOT travel: base albedo belongs to the instance
      // SLOT (it is uploaded by instance index) and is random per slot anyway.
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      if (this.t[i] >= this.dur[i]) { this.kill(i); continue; }
      this.vy[i] -= 26 * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      if (this.y[i] < this.ground[i]) {
        this.y[i] = this.ground[i];
        this.vy[i] = -this.vy[i] * 0.34;
        this.vx[i] *= 0.55; this.vz[i] *= 0.55;
        this.aw[i] *= 0.5;
        if (Math.abs(this.vy[i]) < 0.7) { this.vy[i] = 0; this.aw[i] *= 0.2; }
      }
      // integrate the tumble quaternion
      const half = this.aw[i] * dt * 0.5;
      const s = Math.sin(half), cw = Math.cos(half);
      const dx = this.ax[i] * s, dy = this.ay[i] * s, dz = this.az[i] * s;
      const x = this.qx[i], y = this.qy[i], z = this.qz[i], w = this.qw[i];
      this.qx[i] = cw * x + dx * w + dy * z - dz * y;
      this.qy[i] = cw * y - dx * z + dy * w + dz * x;
      this.qz[i] = cw * z + dx * y - dy * x + dz * w;
      this.qw[i] = cw * w - dx * x - dy * y - dz * z;
      i++;
    }
    const n = this.n;
    if (this.warm > 0) {
      this.warm--;
      _v1.set(0, -400, 0); _q.set(0, 0, 0, 1); _sc.setScalar(0.001);
      _m.compose(_v1, _q, _sc);
      this.mesh.setMatrixAt(0, _m);
      this.mesh.count = 1;
      this.mesh.visible = true;
      this.mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    // Blast light on the chunks: tint toward 0xffb066 by the per-chunk `hot`
    // weight, decaying over 0.4 s. Only touched while something is still hot,
    // so the instanceColor buffer is not re-uploaded on idle frames.
    let stillHot = false;
    const IC = this.anyHot && this.mesh.instanceColor ? this.mesh.instanceColor.array : null;
    for (let j = 0; j < n; j++) {
      const t = this.t[j] / this.dur[j];
      const k = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      _v1.set(this.x[j], this.y[j], this.z[j]);
      _q.set(this.qx[j], this.qy[j], this.qz[j], this.qw[j]);
      _sc.setScalar(this.sc[j] * k);
      _m.compose(_v1, _q, _sc);
      this.mesh.setMatrixAt(j, _m);
      if (IC) {
        const h = this.hot[j] > 0 ? this.hot[j] * Math.max(0, 1 - this.t[j] / 0.4) : 0;
        if (h > 0.002) stillHot = true;
        const j3 = j * 3;
        // 0xffb066 in linear-ish working space, pushed hard enough to survive ACES
        IC[j3] = this.br[j] + (1.00 - this.br[j]) * h;
        IC[j3 + 1] = this.bg[j] + (0.43 - this.bg[j]) * h;
        IC[j3 + 2] = this.bb[j] + (0.14 - this.bb[j]) * h;
      }
    }
    if (IC) {
      this.mesh.instanceColor.needsUpdate = true;
      if (!stillHot) this.anyHot = false;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; this.anyHot = false; }
}

// ================================================================ ghosts ===
class GhostPool {
  constructor(scene, cap) {
    this.cap = cap; this.n = 0;
    for (const k of ['t', 'dur', 'x', 'y', 'z', 'yaw', 'lean', 'cr', 'cg', 'cb'])
      this[k] = new Float32Array(cap);
    const body = new THREE.CapsuleGeometry(0.33, 0.85, 4, 10);
    body.translate(0, 1.15, 0);
    const head = new THREE.SphereGeometry(0.23, 10, 8);
    head.translate(0, 1.95, 0);
    const src = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()], false);
    const geo = new THREE.InstancedBufferGeometry();
    geo.attributes.position = src.attributes.position;
    geo.attributes.normal = src.attributes.normal;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aRot, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {},
      vertexShader: `
        attribute vec3 aPos; attribute vec2 aRot; attribute vec4 aCol;
        varying vec4 vCol; varying float vFres;
        void main() {
          vCol = aCol;
          float cy = cos(aRot.x), sy = sin(aRot.x);
          float cl = cos(aRot.y), sl = sin(aRot.y);
          vec3 p = position;
          p = vec3(p.x, p.y * cl - p.z * sl, p.y * sl + p.z * cl);
          p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
          vec3 nn = normal;
          nn = vec3(nn.x, nn.y * cl - nn.z * sl, nn.y * sl + nn.z * cl);
          nn = vec3(nn.x * cy + nn.z * sy, nn.y, -nn.x * sy + nn.z * cy);
          vec3 wp = aPos + p;
          vec3 v = normalize(cameraPosition - wp);
          vFres = pow(1.0 - abs(dot(normalize(nn), v)), 2.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        varying vec4 vCol; varying float vFres;
        void main() {
          float a = vCol.a * (0.16 + vFres * 1.1);
          gl_FragColor = vec4(vCol.rgb * (0.5 + vFres * 1.4), a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(x, y, z, yaw, lean, colHex, dur) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = 0; let best = -1; for (let k = 0; k < this.n; k++) { const p = this.t[k] / this.dur[k]; if (p > best) { best = p; i = k; } } }
    this.t[i] = 0; this.dur[i] = dur;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.yaw[i] = yaw; this.lean[i] = lean;
    _c.setHex(colHex);
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) for (const k of ['t', 'dur', 'x', 'y', 'z', 'yaw', 'lean', 'cr', 'cg', 'cb'])
      this[k][i] = this[k][l];
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      if (this.t[i] >= this.dur[i]) { this.kill(i); continue; }
      i++;
    }
    const n = this.n;
    const P = this.aPos.array, R = this.aRot.array, C = this.aCol.array;
    for (let j = 0; j < n; j++) {
      const t = this.t[j] / this.dur[j];
      const j3 = j * 3, j2 = j * 2, j4 = j * 4;
      P[j3] = this.x[j]; P[j3 + 1] = this.y[j]; P[j3 + 2] = this.z[j];
      R[j2] = this.yaw[j]; R[j2 + 1] = this.lean[j];
      C[j4] = this.cr[j]; C[j4 + 1] = this.cg[j]; C[j4 + 2] = this.cb[j];
      C[j4 + 3] = 0.5 * Math.pow(1 - t, 1.5);
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { pushRange(this.aPos, n * 3); pushRange(this.aRot, n * 2); pushRange(this.aCol, n * 4); }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ============================================================ sword trails ==
// Both hero ribbons live in one geometry → one draw call, hidden when idle.
class TrailBank {
  constructor(scene, count, N) {
    this.count = count; this.N = N;
    const verts = count * N * 2;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const rib = new Float32Array(verts);
    const idx = [];
    for (let r = 0; r < count; r++) {
      const base = r * N * 2;
      for (let s = 0; s < N; s++) {
        const a = base + s * 2;
        uv[a * 2] = s / (N - 1); uv[a * 2 + 1] = 0;
        uv[(a + 1) * 2] = s / (N - 1); uv[(a + 1) * 2 + 1] = 1;
        rib[a] = r; rib[a + 1] = r;
        if (s < N - 1) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aRib', new THREE.BufferAttribute(rib, 1));
    geo.setIndex(idx);
    geo.setDrawRange(0, idx.length);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uC0: { value: new THREE.Color(0x9fe8ff) }, uC1: { value: new THREE.Color(0xffab6a) },
        uA0: { value: 0 }, uA1: { value: 0 },
      },
      vertexShader: `
        attribute float aRib;
        varying vec2 vUv; varying float vR;
        void main() { vUv = uv; vR = aRib; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uC0; uniform vec3 uC1; uniform float uA0; uniform float uA1;
        varying vec2 vUv; varying float vR;
        void main() {
          vec3 col = mix(uC0, uC1, vR);
          float A = mix(uA0, uA1, vR);
          float head = pow(vUv.x, 1.45);            // soft trailing gradient
          float lead = pow(vUv.x, 14.0);            // crisp leading edge
          float across = smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.02, 0.68, vUv.y);
          float spine = pow(max(0.0, 1.0 - abs(vUv.y - 0.30) * 3.4), 2.5);
          float a = (head * 0.8 + lead * 0.7) * across * A;
          vec3 c = mix(col, vec3(1.0), min(1.0, head * 0.30 + spine * 0.55 + lead));
          gl_FragColor = vec4(c * (1.0 + spine * 0.9 + lead * 0.8), a);
          if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.state = [];
    for (let i = 0; i < count; i++) {
      this.state.push({ active: false, fade: 0, filled: 0, tx: 0, ty: 0, tz: 0, has: false, acc: 0 });
    }
  }
  push(id, base, tip) {
    const T = this.state[id];
    const N = this.N;
    const g = this.geo.attributes.position.array;
    const off = id * N * 2 * 3;
    if (T.filled === 0) {
      for (let s = 0; s < N; s++) {
        const a = off + s * 6;
        g[a] = base.x; g[a + 1] = base.y; g[a + 2] = base.z;
        g[a + 3] = tip.x; g[a + 4] = tip.y; g[a + 5] = tip.z;
      }
      T.filled = N;
    } else {
      for (let s = 0; s < N - 1; s++) {
        const a = off + s * 6, b = off + (s + 1) * 6;
        g[a] = g[b]; g[a + 1] = g[b + 1]; g[a + 2] = g[b + 2];
        g[a + 3] = g[b + 3]; g[a + 4] = g[b + 4]; g[a + 5] = g[b + 5];
      }
      const last = off + (N - 1) * 6;
      g[last] = base.x; g[last + 1] = base.y; g[last + 2] = base.z;
      g[last + 3] = tip.x; g[last + 4] = tip.y; g[last + 5] = tip.z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  setActive(id, on, colHex) {
    const T = this.state[id];
    if (on && !T.active) { T.filled = 0; T.has = false; }
    T.active = on;
    if (colHex !== null && colHex !== undefined) {
      (id === 0 ? this.mat.uniforms.uC0 : this.mat.uniforms.uC1).value.setHex(colHex);
    }
    if (on) T.fade = 1;
  }
  update(dt) {
    let vis = false;
    for (let i = 0; i < this.count; i++) {
      const T = this.state[i];
      if (!T.active) T.fade = Math.max(0, T.fade - dt * 5.5);
      const a = T.active ? 1 : T.fade;
      (i === 0 ? this.mat.uniforms.uA0 : this.mat.uniforms.uA1).value = a;
      if (a > 0.002) vis = true;
    }
    this.mesh.visible = vis;
  }
  clear() {
    for (const T of this.state) { T.active = false; T.fade = 0; T.filled = 0; T.has = false; }
    this.mat.uniforms.uA0.value = 0; this.mat.uniforms.uA1.value = 0;
    this.mesh.visible = false;
  }
}

// =================================================================== VFX ===
export class VFX {
  constructor({ scene, groundHeight, gradeUniforms, onText }) {
    this.scene = scene;
    this.groundHeight = groundHeight || (() => 0);
    this.grade = gradeUniforms;
    this.onText = onText || (() => {});
    this.trauma = 0;
    this.kick = 0;
    this.kickX = 0; this.kickZ = 0;
    this.time = 0;
    this._holeT = 0; this._holeDur = 0;

    const atlasAdd = buildAtlas([
      spDot,
      (x, S) => spSpark(x, S, true),
      (x, S) => spCrescent(x, S, false),
      (x, S) => spRing(x, S, false),
      (x, S) => spStreak(x, S, 0.7, false),
      spFlare,
      spEmber,
      (x, S) => spCrescent(x, S, true),
      (x, S) => spStreak(x, S, 1.35, true),
      (x, S) => radial(x, S / 2, S / 2, S * 0.5,
        [[0, W(0.95)], [0.22, W(0.55)], [0.5, W(0.18)], [0.78, W(0.04)], [1, W(0)]]),
      (x, S) => spPuff(x, S, true),
      spBolt,
      (x, S) => spRing(x, S, true),
      spDome,
      spShard,
      (x, S) => spSpark(x, S, false),
    ]);
    const atlasAlpha = buildAtlas([
      spSmoke, spPetal,
      (x, S) => { if (tex.crack && tex.crack.image) x.drawImage(tex.crack.image, 0, 0, S, S); },
      spDot,
      spRock,
      (x, S) => spPuff(x, S, true),
      (x, S) => spSmoke(x, S),
      (x, S) => spRock(x, S),
      spBillow,   // 8 A_BILLOW — occluding smoke mass
      spChunk,    // 9 A_CHUNK  — opaque debris silhouette
    ]);
    this.decalTex = buildDecalAtlas();
    this.wearTex = buildWearAtlas();
    this.atlases = { add: atlasAdd, alpha: atlasAlpha, decal: this.decalTex, wear: this.wearTex };

    // render order: wear(2) → decals(3) → dust(4) → rings(5) → telegraphs(5.5)
    // → ghosts(6) → arcs(7) → additive particles(8) → SOOT(8.6) →
    // beams/projectiles(9).
    // Ground dust sits under the light so a shockwave still punches through it.
    // pSoot is the exception and the whole point of the pool: it draws AFTER
    // the additive plume, so a smoke lobe or a stone chunk can put real dark
    // mass in front of the core instead of glowing along with it. Same class,
    // same shader source and same uniform set as pAlpha, so three hands both
    // meshes the same linked program — no extra compile, no extra prewarm cost.
    this.pAdd = new ParticlePool(scene, 1000, atlasAdd, true, 8);
    this.pAlpha = new ParticlePool(scene, 420, atlasAlpha, false, 4);
    this.pSoot = new ParticlePool(scene, 180, atlasAlpha, false, 8.6);
    this.arcs = new ArcPool(scene, 72, atlasAdd, 7);
    this.ringPool = new RingPool(scene, 22);
    this.decalPool = new DecalPool(scene, 14, this.decalTex);
    this.wearPool = new DecalPool(scene, 72, this.wearTex, 2, true);
    this.telePool = new TelePool(scene, 6);
    this.beamPool = new BeamPool(scene, 8);
    this.debris = new DebrisPool(scene, 76);
    this.ghostPool = new GhostPool(scene, 12);
    this.trailBank = new TrailBank(scene, 2, 18);
    this._scatterWear();

    // legacy-shaped aliases so external code that pokes at these keeps working
    this.trails = this.trailBank.state;
    this.tele = this.telePool.slots;

    // dash tracking (turns spawnGhost calls into a wind ribbon + end burst)
    this.dash = { on: false, last: -99, x: 0, y: 0, z: 0, px: 0, pz: 0, dx: 0, dz: 0, col: 0x6fd4ff };
    this._onBeamFire = (x, y, z, r, g, b) => this._beamImpact(x, y, z, r, g, b);

    // ---- projectiles ----
    this.projs = [];
    const PCAP = 16;
    for (let i = 0; i < PCAP; i++) {
      this.projs.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        target: null, to: new THREE.Vector3(), speed: 10, size: 0.3,
        col: 0xffffff, onHit: null, t: 0, trailAcc: 0, arc: 0, dur: 0, from: new THREE.Vector3(),
        dx: 0, dy: 0, dz: 1,
      });
    }
    {
      const quad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.attributes.position = quad.attributes.position;
      geo.attributes.uv = quad.attributes.uv;
      this.projPos = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 4), 4);
      this.projCol = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 3), 3);
      this.projDir = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * 3), 3);
      for (const a of [this.projPos, this.projCol, this.projDir]) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPos', this.projPos);
      geo.setAttribute('aCol', this.projCol);
      geo.setAttribute('aDir', this.projDir);
      geo.instanceCount = 0;
      this.projGeo = geo;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {},
        vertexShader: `
          attribute vec4 aPos; attribute vec3 aCol; attribute vec3 aDir;
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            vUv = uv; vCol = aCol;
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec2 sv = vec2(dot(aDir, right), dot(aDir, up));
            float l = length(sv);
            vec2 d = (l > 1e-4) ? sv / l : vec2(0.0, 1.0);
            vec2 ax = vec2(d.y, -d.x);
            vec2 p = (ax * position.x + d * position.y * 1.75) * aPos.w;
            gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + right * p.x + up * p.y, 1.0);
          }`,
        fragmentShader: `
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            vec2 q = (vUv - 0.5) * vec2(2.4, 2.0);
            float d = length(q);
            float k = max(0.0, 1.0 - d);
            float core = pow(k, 8.0);
            float halo = pow(k, 2.0);
            vec3 c = vCol * halo * 1.25 + vec3(1.0, 0.98, 0.94) * core * 1.9;
            float a = clamp(halo * 1.2, 0.0, 1.0);
            if (a < 0.006) discard;
            gl_FragColor = vec4(c, a);
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; m.renderOrder = 9;
      m.visible = false;
      this.projMesh = m;
      scene.add(m);
    }
  }

  // ------------------------------------------------------------ primitives --
  // ------------------------------------------------------- static plaza wear --
  // VFX-2. 60% of the gameplay frame is one uniform tan tile field with no
  // authored detail anywhere on it. These are 40-odd permanent grime decals —
  // crack networks, moss creeping out of the tile joints, damp darkening near
  // the river, scuffs where the waves meet — laid down once at construction.
  // One extra draw call, zero per-frame cost (the pool is staticMode), and it
  // puts texture frequency exactly where the frame already scores best.
  _scatterWear() {
    // The lane drape narrows as it funnels onto the bridge (arena.js:336); match
    // it so nothing spills off the stone onto grass.
    const laneHalf = (x) => A.LANE_HALF *
      (1 - 0.26 * (1 - THREE.MathUtils.smoothstep(Math.abs(x), A.BRIDGE_HALF_X, A.BRIDGE_HALF_X + 5)));
    const put = (sprite, col, x, z, size, alpha) => {
      if (!isWalkable(x, z)) return;
      const y = this.groundHeight(x, z * 0.92);
      if (y < -0.4) return;                       // riverbed, not deck
      const o = dRec();
      o.x = x; o.y = y + 0.085; o.z = z;          // lane top is groundHeight+0.055
      o.size = size; o.dur = 1e9; o.t0 = 1;
      o.rot = rf(0, TAU); o.sprite = sprite; o.col = col;
      o.hot = 0; o.alpha = alpha; o.wear = 1;
      this.wearPool.spawn(o);
    };
    const onLane = (x) => {
      const h = laneHalf(x) - 0.7;
      return rf(-h, h);
    };
    // crack networks: everywhere, densest mid-lane where the waves grind
    for (let i = 0; i < 24; i++) {
      const x = rf(-40, 40);
      put(WR_CRACK, 0x2b251e, x, onLane(x), rf(3.2, 6.6), rf(0.55, 0.86));
    }
    // moss creep: out of the joints at the lane edge, and heaviest by the water
    for (let i = 0; i < 14; i++) {
      const x = rf(-34, 34);
      const h = laneHalf(x) - 0.7;
      const z = (rnd() < 0.5 ? -1 : 1) * rf(h * 0.42, h);
      const wet = 1 - Math.min(1, Math.abs(x) / 16);
      put(WR_MOSS, 0x3f5c2a, x, z, rf(3.2, 6.6), 0.42 + wet * 0.4);
    }
    // damp darkening: river approach + under the tower footprints
    for (let i = 0; i < 12; i++) {
      const x = i < 7 ? (rnd() < 0.5 ? -1 : 1) * rf(4.6, 15)
        : (rnd() < 0.5 ? -1 : 1) * (A.TOWER_OUTER_X + rf(-6, 6));
      put(WR_DAMP, 0x2a343d, x, onLane(x), rf(4.0, 8.0), rf(0.4, 0.7));
    }
    // scuffs and pits: the two contested spots — bridge mouth and outer towers
    for (let i = 0; i < 12; i++) {
      const x = i < 6 ? rf(-11, 11) : (rnd() < 0.5 ? -1 : 1) * (A.TOWER_OUTER_X + rf(-7, 7));
      put(WR_SCUFF, 0x3d362d, x, onLane(x), rf(2.6, 5.4), rf(0.48, 0.8));
    }
    this.wearPool.flush();
  }

  burst(x, y, z, {
    count = 10, col = 0xffe9b0, col2 = null, colEnd, speed = 5, up = 2.5, life = 0.5,
    size = 0.28, sizeEnd = 0.05, gravity = 6, spread = 1, sprite = 1, pool = 'add',
    glow = 1.6, drag = 2, alpha = 1, stretch = 1, fadePow = 2, cone = null, coneWidth = 1,
  } = {}) {
    const P = pool === 'add' ? this.pAdd : (pool === 'soot' ? this.pSoot : this.pAlpha);
    for (let i = 0; i < count; i++) {
      let ax, az;
      if (cone !== null) {
        const a = cone + (rnd() - 0.5) * coneWidth;
        ax = Math.sin(a); az = Math.cos(a);
      } else {
        const a = rnd() * TAU;
        ax = Math.cos(a); az = Math.sin(a);
      }
      const r = rnd();
      const sp = speed * (0.4 + rnd() * 0.6);
      const o = pRec();
      o.x = x + ax * r * spread * 0.4; o.y = y + rnd() * 0.2; o.z = z + az * r * spread * 0.4;
      o.vx = ax * sp * spread; o.vy = up * (0.5 + rnd() * 0.8); o.vz = az * sp * spread;
      o.life = life * (0.6 + rnd() * 0.7); o.size = size * (0.7 + rnd() * 0.6); o.sizeEnd = sizeEnd;
      o.col = col2 && rnd() < 0.5 ? col2 : col; o.colEnd = colEnd;
      o.gravity = gravity; o.drag = drag;
      o.rot = rnd() * 6.28; o.rotV = (rnd() - 0.5) * 6;
      o.sprite = sprite; o.glow = glow; o.alpha = alpha; o.stretch = stretch; o.fadePow = fadePow;
      P.spawn(o);
    }
  }

  ring(x, y, z, { r0 = 0.3, r1 = 5, dur = 0.5, col = 0xfff2cf, alpha = 0.75,
    thick = 0.14, dust = 0.45, emis = 1, ease = 3, kick = true } = {}) {
    {
      const R = rRec();
      R.x = x; R.y = y + 0.14; R.z = z; R.r0 = r0; R.r1 = r1; R.dur = dur;
      R.col = col; R.alpha = alpha; R.thick = thick; R.dust = dust; R.emis = emis; R.ease = ease;
      this.ringPool.spawn(R);
    }
    if (!kick) return;
    // ground dust + sparks kicked up along the leading edge
    const n = Math.min(14, Math.max(3, Math.round(r1 * 1.6)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = r0 + (r1 - r0) * 0.22;
      let o = pRec();
      o.x = x + ca * rr; o.y = y + 0.1; o.z = z + sa * rr;
      o.vx = ca * r1 * 1.5; o.vy = 0.6 + rnd() * 0.9; o.vz = sa * r1 * 1.5;
      o.life = dur * 1.9; o.size = 0.34 + r1 * 0.09; o.sizeEnd = 0.9 + r1 * 0.22;
      o.col = 0xbfae90; o.alpha = 0.3; o.sprite = A_SMOKE; o.glow = 1; o.drag = 3.4; o.fadePow = 1.5;
      this.pAlpha.spawn(o);
      if (i % 2 === 0) {
        o = pRec();
        o.x = x + ca * rr; o.y = y + 0.16; o.z = z + sa * rr;
        o.vx = ca * r1 * 3.4; o.vy = 1.4 + rnd() * 2.6; o.vz = sa * r1 * 3.4;
        o.life = 0.26 + rnd() * 0.18; o.size = 0.2; o.sizeEnd = 0.04;
        o.col = col; o.glow = 2.0; o.sprite = S_SPARK2; o.gravity = 9; o.drag = 2.6; o.stretch = 2.6;
        this.pAdd.spawn(o);
      }
    }
  }

  // Crescent blade arc: bright leading edge + soft trailing ghosts + edge sparks.
  slashArc(x, y, z, yaw, { col = 0x9fe8ff, size = 2.6, dur = 0.26, tilt = -1.15,
    vel = 0, grow = 1.6, scar = null } = {}) {
    const el = tilt + Math.PI / 2;                 // elevation above the ground plane
    const vx = Math.sin(yaw) * vel, vz = Math.cos(yaw) * vel;
    const g = 0.55 + grow * 0.32;
    let a2 = aRec();
    // main body
    a2.x = x; a2.y = y; a2.z = z; a2.vx = vx; a2.vz = vz; a2.life = dur; a2.yaw = yaw; a2.el = el;
    a2.roll = -0.30; a2.rollV = 1.5;
    a2.sx0 = size * 0.55; a2.sx1 = size * g * 1.28;
    a2.sy0 = size * 0.68; a2.sy1 = size * g * 1.06;
    a2.col = col; a2.glow = 1.35; a2.alpha = 0.92; a2.sprite = S_SLASH; a2.fadePow = 1.7;
    this.arcs.spawn(a2);
    // hot leading edge, slightly bigger and much shorter lived
    a2 = aRec();
    a2.x = x; a2.y = y; a2.z = z; a2.vx = vx * 1.12; a2.vz = vz * 1.12;
    a2.life = dur * 0.55; a2.yaw = yaw; a2.el = el; a2.roll = -0.24; a2.rollV = 1.4;
    a2.sx0 = size * 0.62; a2.sx1 = size * g * 1.42;
    a2.sy0 = size * 0.74; a2.sy1 = size * g * 1.16;
    a2.col = 0xffffff; a2.glow = 1.5; a2.alpha = 0.85; a2.sprite = S_CRESC; a2.fadePow = 3;
    this.arcs.spawn(a2);
    // trailing gradient ghosts
    for (let i = 1; i <= 2; i++) {
      a2 = aRec();
      a2.x = x - Math.sin(yaw) * 0.22 * i; a2.y = y - 0.05 * i; a2.z = z - Math.cos(yaw) * 0.22 * i;
      a2.vx = vx * 0.72; a2.vz = vz * 0.72; a2.life = dur * (1.1 + i * 0.25); a2.yaw = yaw; a2.el = el;
      a2.roll = -0.38 - i * 0.1; a2.rollV = 1.2;
      a2.sx0 = size * 0.44; a2.sx1 = size * g * (1.05 - i * 0.1);
      a2.sy0 = size * 0.56; a2.sy1 = size * g * (0.9 - i * 0.08);
      a2.col = col; a2.glow = 0.9; a2.alpha = 0.32 / i; a2.sprite = S_SLASH; a2.fadePow = 1.3;
      this.arcs.spawn(a2);
    }
    // sparks along the cutting edge
    const cnt = Math.round(6 + size * 2.4);
    for (let i = 0; i < cnt; i++) {
      const a = yaw + (rnd() - 0.5) * 1.5;
      const rr = size * (0.45 + rnd() * 0.55);
      const o = pRec();
      o.x = x + Math.sin(a) * rr; o.y = y + (rnd() - 0.4) * 0.4; o.z = z + Math.cos(a) * rr;
      o.vx = Math.sin(a) * (4 + vel * 0.5); o.vy = 1.2 + rnd() * 2.4; o.vz = Math.cos(a) * (4 + vel * 0.5);
      o.life = 0.2 + rnd() * 0.2; o.size = 0.17 + rnd() * 0.1; o.sizeEnd = 0.02;
      o.col = rnd() < 0.4 ? 0xffffff : col; o.glow = 2.0; o.sprite = S_SPARK2;
      o.gravity = 8; o.drag = 2.5; o.stretch = 2.2;
      this.pAdd.spawn(o);
    }
    if (scar) {
      const gy = this.groundHeight(x, z);
      const d = dRec();
      d.x = x; d.y = gy + 0.105; d.z = z; d.size = size * 2.0; d.dur = scar; d.rot = -yaw;
      d.sprite = 1; d.col = col; d.hot = 0.34; d.alpha = 0.55;
      this.decalPool.spawn(d);
    }
  }

  decal(x, z, { size = 5, dur = 7, glowCol = 0xffa93d, sprite = 0, hot = 1, alpha = 1 } = {}) {
    const y = this.groundHeight(x, z);
    const d = dRec();
    d.x = x; d.y = y + 0.11; d.z = z; d.size = size; d.dur = dur;
    d.col = glowCol; d.sprite = sprite; d.hot = hot; d.alpha = alpha;
    this.decalPool.spawn(d);
  }

  telegraph(x, z, r, col = 0xff5533) {
    return this.telePool.acquire(x, this.groundHeight(x, z) + 0.1, z, r, col);
  }
  endTelegraph(T) { this.telePool.release(T); }

  projectile({ from, target = null, to = null, speed = 14, col = 0x8fd4ff, size = 0.34, onHit = null, arc = 0, trail = true }) {
    for (const p of this.projs) {
      if (p.active) continue;
      p.active = true;
      p.pos.copy(from); p.from.copy(from);
      p.target = target;
      if (to) p.to.copy(to);
      else if (target) { p.to.copy(target.pos); p.to.y += 0.9; }
      p.speed = speed; p.col = col; p.size = size; p.onHit = onHit;
      p.t = 0; p.arc = arc; p.trailAcc = trail ? 0 : null;
      p.dur = Math.max(0.05, p.pos.distanceTo(p.to) / speed);
      _v1.copy(p.to).sub(p.pos).normalize();
      p.dx = _v1.x; p.dy = _v1.y; p.dz = _v1.z;
      // muzzle pop
      const o = pRec();
      o.x = from.x; o.y = from.y; o.z = from.z; o.life = 0.16;
      o.size = size * 3.2; o.sizeEnd = size * 0.6;
      o.col = col; o.glow = 1.7; o.alpha = 0.8; o.sprite = S_GLOW; o.drag = 0; o.gravity = 0;
      this.pAdd.spawn(o);
      return p;
    }
    return null;
  }

  beam(from, to, { col = 0xff8a4d, dur = 0.32, r = 0.22, delay = 0.1 } = {}) {
    this.beamPool.spawn(from, to, dur, r, col, delay);
    // charge-up telegraph at the muzzle
    let o = pRec();
    o.x = from.x; o.y = from.y; o.z = from.z; o.life = delay + 0.06;
    o.size = 0.12; o.sizeEnd = r * 5.2; o.col = col; o.glow = 1.5; o.alpha = 0.9;
    o.sprite = S_GLOW; o.fadePow = 4;
    this.pAdd.spawn(o);
    o = pRec();
    o.x = from.x; o.y = from.y; o.z = from.z; o.life = delay + 0.02;
    o.size = 0.05; o.sizeEnd = r * 9; o.col = 0xffffff; o.glow = 1.3; o.alpha = 0.55;
    o.sprite = S_FLARE; o.fadePow = 5; o.rot = rnd() * 6.28;
    this.pAdd.spawn(o);
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU, rr = 1.1 + rnd() * 0.9;
      const p = rnd() * Math.PI - Math.PI / 2;
      const cx = Math.cos(a) * Math.cos(p) * rr, cy = Math.sin(p) * rr, cz = Math.sin(a) * Math.cos(p) * rr;
      o = pRec();
      o.x = from.x + cx; o.y = from.y + cy; o.z = from.z + cz;
      o.vx = -cx / delay; o.vy = -cy / delay; o.vz = -cz / delay;
      o.life = delay; o.size = 0.16; o.sizeEnd = 0.03; o.col = col; o.glow = 1.8;
      o.sprite = S_SPARK2; o.drag = 0; o.stretch = 2.4;
      this.pAdd.spawn(o);
    }
  }
  _beamImpact(x, y, z, r, g, b) {
    _c.setRGB(r, g, b);
    const hex = _c.getHex();
    // a tower shot throws real light onto the ground it hits (L3), but from
    // 1.6 m up instead of 0.3 m: at y+0.3 the light was INSIDE the unit it was
    // lighting, and 16 cd / (0.3 m)^2 is 178 lux on a single mesh.
    pulseLight(x, y + 1.6, z, { color: hex, peak: 12, dur: 0.26, distance: 12 });
    const o = pRec();
    o.x = x; o.y = y; o.z = z; o.life = 0.2; o.size = 0.5; o.sizeEnd = 2.0;
    o.col = hex; o.glow = 1.6; o.alpha = 0.8; o.sprite = S_GLOW; o.fadePow = 3;
    this.pAdd.spawn(o);
    this.burst(x, y, z, { count: 8, col: hex, col2: 0xffffff, speed: 6, up: 2.6, life: 0.3, size: 0.19, sizeEnd: 0.02, gravity: 10, sprite: S_SPARK2, glow: 2.1, stretch: 2.6, drag: 3 });
  }

  pillar(x, y, z, { col = 0xffd98c, dur = 0.5, r = 0.8, h = 6, glow = 1.2 } = {}) {
    let a2 = aRec();
    a2.x = x; a2.y = y; a2.z = z; a2.life = dur; a2.mode = 1; a2.pin = 1;
    a2.sx0 = r * 2.2; a2.sx1 = r * 3.4; a2.sy0 = h * 0.55; a2.sy1 = h * 1.06;
    a2.col = col; a2.glow = glow; a2.alpha = 0.5; a2.sprite = S_RAY; a2.fadePow = 2;
    this.arcs.spawn(a2);
    a2 = aRec();
    a2.x = x; a2.y = y; a2.z = z; a2.life = dur * 0.7; a2.mode = 1; a2.pin = 1;
    a2.sx0 = r * 0.7; a2.sx1 = r * 1.2; a2.sy0 = h * 0.7; a2.sy1 = h * 1.12;
    a2.col = 0xffffff; a2.glow = 1.3; a2.alpha = 0.55; a2.sprite = S_RAY; a2.fadePow = 3;
    this.arcs.spawn(a2);
  }

  spawnGhost(pos, yaw, lean = 0.4, col = 0x6fd4ff) {
    this.ghostPool.spawn(pos.x, pos.y, pos.z, yaw, lean, col, 0.4);
    const D = this.dash;
    if (!D.on || this.time - D.last > 0.3) {
      D.on = true; D.px = pos.x; D.pz = pos.z; D.dx = Math.sin(yaw); D.dz = Math.cos(yaw);
    } else {
      const mx = pos.x - D.px, mz = pos.z - D.pz;
      const l = Math.hypot(mx, mz);
      if (l > 0.05) { D.dx = mx / l; D.dz = mz / l; }
      // wind ribbon: streaks trailing back along the path
      for (let i = 0; i < 3; i++) {
        const s = rnd();
        const px = D.px + mx * s, pz = D.pz + mz * s;
        const off = (rnd() - 0.5) * 1.15;
        const o = pRec();
        o.x = px - D.dz * off; o.y = pos.y + 0.35 + rnd() * 1.5; o.z = pz + D.dx * off;
        o.vx = -D.dx * 5.5; o.vy = 0.25; o.vz = -D.dz * 5.5;
        o.dirX = D.dx; o.dirY = 0; o.dirZ = D.dz;
        o.life = 0.24 + rnd() * 0.12; o.size = 0.16; o.sizeEnd = 0.02;
        o.col = 0xbfeeff; o.glow = 1.5; o.alpha = 0.75; o.sprite = S_STREAK;
        o.drag = 2.4; o.stretch = 7 + rnd() * 5;
        this.pAdd.spawn(o);
      }
      const o = pRec();
      o.x = pos.x; o.y = pos.y + 0.08; o.z = pos.z; o.vy = 0.5;
      o.life = 0.45; o.size = 0.34; o.sizeEnd = 1.0; o.col = 0xc8bda2;
      o.alpha = 0.26; o.sprite = A_SMOKE; o.drag = 2.2;
      this.pAlpha.spawn(o);
    }
    D.last = this.time;
    D.x = pos.x; D.y = pos.y; D.z = pos.z;
    D.px = pos.x; D.pz = pos.z;
    D.col = col;
  }
  _dashEnd() {
    const D = this.dash;
    D.on = false;
    const yaw = Math.atan2(D.dx, D.dz);
    const x = D.x + D.dx * 0.9, y = D.y, z = D.z + D.dz * 0.9;
    this.slashArc(x, y + 1.0, z, yaw, { col: 0x9fe8ff, size: 2.6, dur: 0.22, tilt: -1.0, vel: 6, grow: 2 });
    this.ring(x, y, z, { r0: 0.4, r1: 3.4, dur: 0.34, col: 0xa8e8ff, alpha: 0.6, thick: 0.2, dust: 0.4, ease: 2.4 });
    this.burst(x, y + 0.9, z, {
      count: 16, col: 0xcaf2ff, col2: 0xffffff, speed: 11, up: 2.2, life: 0.28, size: 0.2, sizeEnd: 0.02,
      gravity: 6, sprite: S_SPARK2, glow: 2.1, stretch: 3.2, drag: 3.4, cone: yaw, coneWidth: 1.7,
    });
    const o = pRec();
    o.x = x; o.y = y + 1.0; o.z = z; o.life = 0.2; o.size = 0.6; o.sizeEnd = 2.6;
    o.col = 0xbfeeff; o.glow = 1.6; o.alpha = 0.8; o.sprite = S_GLOW; o.fadePow = 3;
    this.pAdd.spawn(o);
    this.shake(0.14);
  }

  trailPush(id, base, tip) {
    this.trailBank.push(id, base, tip);
    const T = this.trailBank.state[id];
    if (T.has) {
      const dx = tip.x - T.tx, dy = tip.y - T.ty, dz = tip.z - T.tz;
      const d = Math.hypot(dx, dy, dz);
      T.acc += d;
      if (d > 0.06 && T.acc > 0.34) {
        T.acc = 0;
        const inv = 1 / d;
        const o = pRec();
        o.x = tip.x; o.y = tip.y; o.z = tip.z;
        o.vx = dx * inv * 2.2; o.vy = dy * inv * 2.2 + 0.6; o.vz = dz * inv * 2.2;
        o.dirX = dx * inv; o.dirY = dy * inv; o.dirZ = dz * inv;
        o.life = 0.2 + rnd() * 0.12; o.size = 0.13; o.sizeEnd = 0.02;
        o.col = 0xd8f6ff; o.glow = 1.8; o.alpha = 0.8; o.sprite = S_SPARK2;
        o.gravity = 5; o.drag = 3; o.stretch = 2.6;
        this.pAdd.spawn(o);
      }
    }
    T.tx = tip.x; T.ty = tip.y; T.tz = tip.z; T.has = true;
  }
  trailActive(id, on, col = null) { this.trailBank.setActive(id, on, col); }

  // -------------------------------------------------------------- camera --
  shake(amt, dirX = 0, dirZ = 0) {
    this.trauma = Math.min(1.35, this.trauma + amt);
    if (amt > 0.4) { this.kick = Math.min(1, this.kick + amt * 0.8); this.kickX = dirX; this.kickZ = dirZ; }
  }
  flash(amt) { if (this.grade) this.grade.uFlash.value = Math.min(0.85, this.grade.uFlash.value + amt); }

  /**
   * Open a world-space hole in the additive VFX so a character standing inside
   * a blast stays findable. Decays to nothing over `dur`.
   */
  hole(x, y, z, radius = 1.2, dur = 0.28) {
    uHole.value.set(x, y, z, radius);
    uHoleK.value = 1;
    this._holeDur = dur;
    this._holeT = 0;
  }
  text(pos, str, kind) { this.onText(pos, str, kind); }

  getShakeOffset(out, t) {
    const tr = this.trauma;
    if (tr <= 0.0005) { out.set(0, 0, 0); return 0; }
    const k = Math.pow(tr, 1.55);
    // two octaves: a fast rattle over a slower sway, so the decay reads as weight
    const hi = 1, lo = 0.55;
    out.set(
      (Math.sin(t * 61.7) * hi + Math.sin(t * 23.3 + 1.7) * lo) * 0.42,
      (Math.sin(t * 74.1 + 2.0) * hi + Math.sin(t * 19.7 + 0.4) * lo) * 0.36,
      (Math.sin(t * 55.3 + 4.0) * hi + Math.sin(t * 27.1 + 2.9) * lo) * 0.42,
    ).multiplyScalar(k * 0.62);
    if (this.kick > 0.001) {
      const kk = this.kick * this.kick * 0.9;
      out.x += this.kickX * kk;
      out.z += this.kickZ * kk;
      out.y += kk * 0.35;
    }
    return k;
  }

  // ---------------------------------------------------------- composites --
  /**
   * Every hit in the game funnels through here (minion melee, tower beams,
   * caster bolts), and it used to be four sparkle sprites: a unit could eat 428
   * damage without a pixel changing on it. This is the stacked-cue version —
   * body flash, hot core, expanding shock ring, cross cut, directional spray,
   * scuff dust — so a hit reads as an EVENT at 50 px and not as a number.
   *
   * `y` is the victim's chest (sim passes pos.y + 0.75..0.9), so the flash is
   * sized and stretched to cover a body silhouette rather than a point.
   */
  hitSpark(x, y, z, col = 0xffe9b0, dirYaw = null) {
    const yw = dirYaw === null ? rf(0, TAU) : dirYaw;
    // 1) VICTIM FLASH — a body-shaped white pop over the unit. Vertically
    //    stretched so it covers a torso, not a dot, and gone in 5 frames.
    let o = pRec();
    o.x = x; o.y = y; o.z = z; o.life = 0.10; o.size = 0.98; o.sizeEnd = 1.32;
    o.col = 0xffffff; o.glow = 2.3; o.alpha = 0.92; o.sprite = S_GLOW; o.fadePow = 4;
    o.drag = 0; o.stretch = 1.75; o.dirX = 0; o.dirY = 1; o.dirZ = 0;
    this.pAdd.spawn(o);
    // 2) hot tinted core, slightly longer, carrying the attacker's colour
    o = pRec();
    o.x = x; o.y = y; o.z = z; o.life = 0.17; o.size = 0.55; o.sizeEnd = 1.9;
    o.rot = rnd() * 6.28; o.col = col; o.glow = 1.9; o.alpha = 0.75;
    o.sprite = S_FLARE; o.fadePow = 3; o.drag = 0;
    this.pAdd.spawn(o);
    // 3) IMPACT RING — a hard expanding annulus. This is the cue Wild Rift uses
    //    to make a 40-damage poke land; it costs one instance in an existing pool.
    let a2 = aRec();
    a2.x = x; a2.y = y; a2.z = z; a2.life = 0.19; a2.mode = 1;
    a2.sx0 = 0.30; a2.sx1 = 1.55; a2.sy0 = 0.30; a2.sy1 = 1.55;
    a2.col = 0xfff4e2; a2.glow = 1.45; a2.alpha = 0.85; a2.sprite = S_RING; a2.fadePow = 2.6;
    this.arcs.spawn(a2);
    // 4) CROSS CUT — a short crescent through the contact point, oriented along
    //    the blow, so a melee bonk shows a cut and not just a sparkle.
    a2 = aRec();
    a2.x = x; a2.y = y; a2.z = z; a2.life = 0.13; a2.yaw = yw; a2.el = -0.55 + Math.PI / 2;
    a2.roll = rf(-0.5, 0.5); a2.rollV = 2.2;
    a2.sx0 = 0.7; a2.sx1 = 1.5; a2.sy0 = 0.55; a2.sy1 = 1.15;
    a2.col = 0xffffff; a2.glow = 1.5; a2.alpha = 0.7; a2.sprite = S_CRESC; a2.fadePow = 3;
    this.arcs.spawn(a2);
    // 5) directional spray
    this.burst(x, y, z, {
      count: 10, col, col2: 0xffffff, speed: 7.0, up: 2.6, life: 0.26, size: 0.16, sizeEnd: 0.02,
      gravity: 11, sprite: S_SPARK2, glow: 2.1, stretch: 3.2, drag: 3.2,
      cone: dirYaw, coneWidth: 2.2,
    });
    // 6) two puffs of scuffed dust — the only NON-glowing cue in the stack, so
    //    the hit has a dark note against all the light.
    for (let i = 0; i < 2; i++) {
      const a = yw + rf(-1.1, 1.1);
      o = pRec();
      o.x = x + Math.sin(a) * 0.25; o.y = y - rf(0.15, 0.5); o.z = z + Math.cos(a) * 0.25;
      o.vx = Math.sin(a) * rf(1.2, 2.6); o.vy = rf(0.5, 1.4); o.vz = Math.cos(a) * rf(1.2, 2.6);
      o.life = rf(0.34, 0.55); o.size = rf(0.18, 0.3); o.sizeEnd = rf(0.6, 0.95);
      o.col = 0x8d7f68; o.alpha = 0.30; o.sprite = A_SMOKE; o.glow = 1; o.drag = 3.2; o.fadePow = 1.5;
      this.pAlpha.spawn(o);
    }
  }
  meleeImpact(x, y, z, col, dirYaw = null) {
    this.hitSpark(x, y, z, col, dirYaw);
    const yw = dirYaw === null ? rf(0, TAU) : dirYaw;
    let o = pRec();
    o.x = x; o.y = y; o.z = z; o.life = 0.15; o.size = 0.4; o.sizeEnd = 1.15;
    o.col = col; o.glow = 1.3; o.alpha = 0.42; o.sprite = S_HALO; o.fadePow = 3;
    this.pAdd.spawn(o);
    // ground scuff ring under the trade — grounds the exchange on the paving
    const gy = this.groundHeight(x, z);
    if (y - gy < 3.0) {
      this.ring(x, gy, z, {
        r0: 0.25, r1: 1.5, dur: 0.26, col: 0xffe6c0, alpha: 0.5,
        thick: 0.16, dust: 0.5, emis: 0.7, ease: 2.4, kick: false,
      });
    }
    // three real chips of stone, thrown along the blow
    for (let i = 0; i < 3; i++) {
      const a = yw + rf(-0.8, 0.8);
      const b = bRec();
      b.x = x + Math.sin(a) * 0.2; b.y = y - 0.2; b.z = z + Math.cos(a) * 0.2;
      b.vx = Math.sin(a) * rf(2.5, 6); b.vy = rf(3, 6.5); b.vz = Math.cos(a) * rf(2.5, 6);
      b.size = rf(0.07, 0.15); b.life = rf(0.7, 1.2); b.ground = gy + 0.05;
      b.ax = rf(-1, 1); b.ay = rf(-1, 1); b.az = rf(-1, 1); b.spin = rf(-14, 14); b.hot = 0;
      this.debris.spawn(b);
    }
    this.burst(x, y, z, {
      count: 4, col: 0x9a8a70, speed: 2.6, up: 2.2, life: 0.5, size: 0.16, sizeEnd: 0.45,
      gravity: 6, sprite: A_SMOKE, pool: 'alpha', glow: 1, alpha: 0.35,
    });
  }
  deathBurst(x, y, z, col = 0x8fd4ff) {
    this.burst(x, y, z, { count: 18, col, col2: 0xffffff, speed: 4.5, up: 3.4, life: 0.65, size: 0.26, sizeEnd: 0.02, gravity: 6, sprite: S_SPARK2, glow: 2, stretch: 2.4, drag: 2.4 });
    this.burst(x, y, z, { count: 10, col, colEnd: 0x5a2a12, speed: 1.6, up: 3.0, life: 1.2, size: 0.15, sizeEnd: 0.05, gravity: 2.4, sprite: S_EMBER, glow: 1.9, drag: 1.4, fadePow: 4 });
    this.burst(x, y, z, { count: 7, col: 0xdad4c8, speed: 1.8, up: 1.2, life: 0.85, size: 0.5, sizeEnd: 1.35, gravity: -0.3, sprite: A_SMOKE, pool: 'alpha', alpha: 0.4, glow: 1, fadePow: 1.4 });
    const o = pRec();
    o.x = x; o.y = y; o.z = z; o.life = 0.22; o.size = 0.8; o.sizeEnd = 2.6;
    o.col = col; o.glow = 1.5; o.alpha = 0.7; o.sprite = S_GLOW; o.fadePow = 3;
    this.pAdd.spawn(o);
    this.ring(x, y - 0.4, z, { r0: 0.25, r1: 2.9, dur: 0.42, col, alpha: 0.7, thick: 0.2, dust: 0.5, ease: 2.6 });
    // Lifted clear of the corpse. A point light sitting 0.2 m from a lit surface
    // is an inverse-square singularity: see the comment on the pulseLight call
    // in dawnfall() for what that costs downstream.
    pulseLight(x, y + 1.5, z, { color: col, peak: 10, dur: 0.3, distance: 10 });
  }
  levelUpFx(unit) {
    const p = unit.pos;
    this.ring(p.x, p.y, p.z, { r0: 0.3, r1: 3.6, dur: 0.6, col: 0xffd98c, alpha: 0.8, thick: 0.16, dust: 0.3 });
    this.pillar(p.x, p.y, p.z, { col: 0xffd98c, dur: 0.65, r: 0.55, h: 6.5 });
    this.burst(p.x, p.y + 0.4, p.z, { count: 22, col: 0xffd98c, col2: 0xfff6dd, speed: 1.6, up: 7, life: 0.9, size: 0.2, sizeEnd: 0.02, gravity: -1.5, sprite: S_SPARK2, glow: 2.1, stretch: 2.6, drag: 0.8 });
  }
  respawnFx(unit, col) {
    const p = unit.pos;
    this.ring(p.x, p.y, p.z, { r0: 0.4, r1: 3.2, dur: 0.55, col, alpha: 0.75, thick: 0.17, dust: 0.28 });
    this.pillar(p.x, p.y, p.z, { col, dur: 0.6, r: 0.7, h: 7 });
    this.burst(p.x, p.y + 0.4, p.z, { count: 16, col, col2: 0xffffff, speed: 1.4, up: 6, life: 0.8, size: 0.2, sizeEnd: 0.02, gravity: -1, sprite: S_SPARK2, glow: 2, stretch: 2.4, drag: 0.9 });
  }

  // ------------------------------------------------------------- DAWNFALL --
  // Layered radial slam. Everything launches fast and decelerates so the frame
  // right after impact reads as WEIGHT: hard flash → shockwave train → debris
  // arcs → light pillar + god rays → cooling crater → settling embers.
  //
  // ROUND-3 REBUILD. The previous version was 100% additive: ~180 sprites that
  // can only ADD light, so the whole detonation was one 27°-wide amber band with
  // no value range and no silhouette — a lens flare composited over the scene
  // rather than an explosion inside it. Three things changed:
  //   * a real value ramp — white-hot centre, saturated amber mid, deep-orange
  //     outer. The core is the one thing in this game that SHOULD clip.
  //   * real dark mass — pSoot draws after the additive plume, so smoke lobes
  //     and opaque stone chunks silhouette against the core instead of glowing.
  //   * hue opposition — shards, plume tops and outer dust are desaturated cool
  //     grey-violet, against the amber, so the frame is not one colour.
  // Paid for by DELETING additive overdraw: the column's wrap-glow, the widest
  // ray, and 12 of the 20 large "sunlit dust" quads are gone. Net full-radius
  // additive quad count is DOWN, which is where the ult's remaining cost lives.
  //
  // Allocation-free: every spawn goes through the shared pRec/aRec/rRec/dRec/
  // bRec records. This used to allocate ~300 object literals per cast.
  dawnfall(x, y, z, r) {
    const gy = this.groundHeight(x, z);
    // The full-screen flash was the single biggest cause of the "clips to pure
    // white" read — it alone drove the whole frame past 1.0 before bloom.
    this.flash(0.30);
    this.shake(1.25);
    // Real light in the world (L3 + V2), lifted clear of the caster.
    //
    // This call used to put a 26 cd point light at gy + 2.0 — exactly head
    // height, i.e. INSIDE the caster's own skull mesh. three clamps the
    // inverse-square term at 1/max(d^2, 0.01), so at d ~ 0.45 m the irradiance
    // was ~130 lux and the shaded radiance on that one mesh measured 452-640 in
    // linear light: an unbounded near-field singularity aimed at the most
    // looked-at pixel in the game. Bisecting the ult frame, the pure-black
    // cluster in the core switched on between light intensity 8 and 10 and
    // scaled monotonically with it; hiding pAdd / arcs / rings did not touch it.
    // (The NaN itself — that value squared by the grade's S-curve, overflowing
    // the half-float composer target to +Inf and coming out of ACES as NaN — is
    // fixed properly by the clamp + shoulder in renderer.js. This is the other
    // half: not emitting a 500x spike off a light source in the first place.
    // A 2.6 m stand-off drops the near-field irradiance ~10x while the deck,
    // debris and combatants keep essentially the same illumination.)
    pulseLight(x, gy + 2.6, z, { color: 0xffb347, peak: 18, dur: 0.42, distance: 20 });
    // Punch the caster out of her own core (V1) — but SHORTER and TIGHTER than
    // before. holeFade() suppresses additive light inside this sphere, and at
    // r 1.9 / 0.34 s it was also deleting the incandescent core that is supposed
    // to be the focal point of the whole game: the ult's brightest moment had no
    // bright centre, only a ring. Sera still reads; the heart of the blast now
    // sits ABOVE the sphere instead of being erased by it.
    this.hole(x, gy + 1.10, z, 1.70, 0.22);

    let o, a2, R, d, b;

    // --- impact frame: a REAL value ramp, not one flat amber disc -----------
    // Four tiers, stacked bottom-to-top so the hue travels with the height:
    // ember red at the deck -> gold -> white-hot heart clear of the punch-out.
    // The white heart CLIPS, deliberately: p99 luminance across this build sits
    // at 213-220 because nothing is ever allowed to reach white, and a
    // detonation core is precisely the thing that has earned it.
    //
    // The tier glows are chosen against the grade's filmic shoulder
    // (renderer.js uShoK 0.94 / uShoW 7.0), which compresses everything above
    // 0.94 into a 7-stop soft knee: 0.5 / 1.2 / 5 / 9 land on visibly different
    // display values instead of all reading 255. They are bounded values picked
    // for that curve, not "as bright as possible and let the clamp sort it out".
    o = pRec();                                     // deep ember shell, on the deck
    o.x = x; o.y = gy + 0.7; o.z = z; o.life = 0.44;
    o.size = r * 1.25; o.sizeEnd = r * 2.35;
    o.col = 0xff6f18; o.glow = 0.60; o.alpha = 0.50; o.sprite = S_GLOW; o.fadePow = 2.0;
    this.pAdd.spawn(o);
    o = pRec();                                     // saturated gold mid
    o.x = x; o.y = gy + 1.5; o.z = z; o.life = 0.36;
    o.size = r * 0.78; o.sizeEnd = r * 1.55;
    o.col = 0xffbe57; o.glow = 1.5; o.alpha = 0.85; o.sprite = S_GLOW; o.fadePow = 2.4;
    this.pAdd.spawn(o);
    o = pRec();                                     // white-hot heart
    o.x = x; o.y = gy + 2.55; o.z = z; o.life = 0.34;
    o.size = r * 0.30; o.sizeEnd = r * 0.66;
    o.col = 0xfff4e2; o.glow = 5.0; o.alpha = 1.0; o.sprite = S_GLOW; o.fadePow = 3;
    this.pAdd.spawn(o);
    o = pRec();                                     // clipping pinpoint inside it
    o.x = x; o.y = gy + 2.55; o.z = z; o.life = 0.30;
    o.size = r * 0.12; o.sizeEnd = r * 0.28;
    o.col = 0xffffff; o.glow = 9.0; o.alpha = 1.0; o.sprite = S_DOT; o.fadePow = 3;
    this.pAdd.spawn(o);
    o = pRec();
    o.x = x; o.y = gy + 1.1; o.z = z; o.life = 0.20;
    o.size = r * 0.65; o.sizeEnd = r * 2.4;
    o.col = 0xffcf90; o.glow = 0.94; o.alpha = 0.62; o.sprite = S_FLARE; o.fadePow = 3; o.rot = 0.2;
    this.pAdd.spawn(o);
    // lingering anamorphic star, lifted off the deck so the crater stays visible
    o = pRec();
    o.x = x; o.y = gy + 2.55; o.z = z; o.life = 0.62;
    o.size = r * 0.34; o.sizeEnd = r * 0.95;
    o.col = 0xffe6b4; o.glow = 1.35; o.alpha = 0.48; o.sprite = S_FLARE; o.fadePow = 2.6; o.rot = 1.1;
    this.pAdd.spawn(o);

    // --- shockwave train ---------------------------------------------------
    // fast thin outrunner
    R = rRec();
    R.x = x; R.y = gy + 0.20; R.z = z; R.r0 = 0.8; R.r1 = r * 2.2; R.dur = 0.6;
    R.col = 0xcfe6ff; R.alpha = 0.85; R.thick = 0.032; R.dust = 0.14; R.emis = 0.95; R.ease = 3.4;
    this.ringPool.spawn(R);
    // main bright shockwave — thin band, hot lip, heavy dust skirt behind it
    R = rRec();
    R.x = x; R.y = gy + 0.19; R.z = z; R.r0 = 1.2; R.r1 = r * 1.9; R.dur = 0.9;
    R.col = 0xffbe64; R.alpha = 1; R.thick = 0.10; R.dust = 0.85; R.emis = 1.3; R.ease = 3;
    this.ringPool.spawn(R);
    // hot inner ring
    R = rRec();
    R.x = x; R.y = gy + 0.18; R.z = z; R.r0 = 0.3; R.r1 = r * 1.0; R.dur = 0.5;
    R.col = 0xffe3ab; R.alpha = 0.85; R.thick = 0.24; R.dust = 0.35; R.emis = 0.8; R.ease = 2.4;
    this.ringPool.spawn(R);
    // slow soot skirt
    R = rRec();
    R.x = x; R.y = gy + 0.17; R.z = z; R.r0 = 0.6; R.r1 = r * 1.4; R.dur = 1.6;
    R.col = 0xc79055; R.alpha = 1; R.thick = 0.3; R.dust = 1.0; R.emis = 0.18; R.ease = 2.2;
    this.ringPool.spawn(R);
    // shock dome
    a2 = aRec();
    a2.x = x; a2.y = gy; a2.z = z; a2.life = 0.42; a2.mode = 1;
    a2.sx0 = r * 0.8; a2.sx1 = r * 2.6; a2.sy0 = r * 0.45; a2.sy1 = r * 1.3;
    a2.yoff = 0; a2.col = 0xffe9c0; a2.glow = 0.85; a2.alpha = 0.20;
    a2.sprite = S_DOME; a2.fadePow = 2.4;
    this.arcs.spawn(a2);

    // --- crater + scorch ---------------------------------------------------
    d = dRec();
    d.x = x; d.y = gy + 0.11; d.z = z; d.size = r * 1.9; d.dur = 11;
    d.col = 0xffb254; d.sprite = 0; d.hot = 1; d.alpha = 1;
    this.decalPool.spawn(d);
    d = dRec();
    d.x = x; d.y = gy + 0.10; d.z = z; d.size = r * 3.0; d.dur = 8;
    d.col = 0xff9a3c; d.sprite = 2; d.hot = 0.35; d.alpha = 0.7;
    this.decalPool.spawn(d);
    d = dRec();
    d.x = x; d.y = gy + 0.12; d.z = z; d.size = r * 2.2; d.dur = 1.6;
    d.col = 0xffd28a; d.sprite = 3; d.hot = 1; d.alpha = 0.0;
    this.decalPool.spawn(d);

    // --- vertical light burst ---------------------------------------------
    // the column uses a double-tapered streak so its hot zone sits ABOVE the
    // deck: the crater stays readable underneath instead of being washed out.
    a2 = aRec();
    a2.x = x; a2.y = gy; a2.z = z; a2.life = 0.85; a2.mode = 1; a2.pin = 1;
    a2.sx0 = r * 0.8; a2.sx1 = r * 1.4; a2.sy0 = 11; a2.sy1 = 23;
    a2.col = 0xffc978; a2.glow = 1.2; a2.alpha = 0.7; a2.sprite = S_STREAK; a2.fadePow = 2.2;
    this.arcs.spawn(a2);
    a2 = aRec();
    a2.x = x; a2.y = gy; a2.z = z; a2.life = 0.6; a2.mode = 1; a2.pin = 1;
    a2.sx0 = r * 0.26; a2.sx1 = r * 0.48; a2.sy0 = 13; a2.sy1 = 21;
    a2.col = 0xfff6e6; a2.glow = 1.45; a2.alpha = 0.85; a2.sprite = S_STREAK; a2.fadePow = 3;
    this.arcs.spawn(a2);
    // (deleted: the r*1.9 wrap-glow and the r*2.2 x 16 outer ray. Two
    //  full-blast-radius additive quads at 0.30 / 0.11 alpha that only flattened
    //  the value range they were sitting on. Their removal is what pays for the
    //  soot pool below.)
    // small root flare where the column meets the stone
    a2 = aRec();
    a2.x = x; a2.y = gy; a2.z = z; a2.life = 0.45; a2.mode = 1; a2.pin = 1;
    a2.sx0 = r * 0.34; a2.sx1 = r * 0.6; a2.sy0 = 2.2; a2.sy1 = 3.4;
    a2.col = 0xfff0cf; a2.glow = 1.2; a2.alpha = 0.3; a2.sprite = S_RAY; a2.fadePow = 3;
    this.arcs.spawn(a2);

    // --- radial god-ray streaks -------------------------------------------
    // 12 -> 9 and dimmer: these are long additive quads and they were the thing
    // painting the entire frame one 27-degree amber band.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rf(-0.16, 0.16);
      const pitch = rf(0.55, 1.35);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dx = Math.cos(a) * cp, dy = sp, dz = Math.sin(a) * cp;
      const sp0 = rf(8, 15);
      o = pRec();
      o.x = x + dx * 2.0; o.y = gy + 1.5 + dy * 2.0; o.z = z + dz * 2.0;
      o.vx = dx * sp0; o.vy = dy * sp0; o.vz = dz * sp0;
      o.dirX = dx; o.dirY = dy; o.dirZ = dz;
      o.life = rf(0.44, 0.7); o.size = rf(0.5, 0.95); o.sizeEnd = rf(0.1, 0.24);
      o.col = i % 3 === 0 ? 0xfff0cc : 0xffab48; o.glow = 1.1; o.alpha = 0.48;
      o.sprite = S_RAY; o.drag = 4.5; o.stretch = rf(8, 14); o.fadePow = 2.4;
      this.pAdd.spawn(o);
    }
    // sunlit dust catching the burst. Cut 20 -> 8 and shrunk: these were the
    // single largest additive-overdraw item in the frame, and the plume's body
    // is now carried by pSoot, which can actually occlude.
    for (let i = 0; i < 8; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.45, r * 1.05);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(0.4, 1.8); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(1.5, 5); o.vy = rf(2.2, 5.5); o.vz = Math.sin(a) * rf(1.5, 5);
      o.life = rf(0.8, 1.4); o.size = rf(1.0, 1.7); o.sizeEnd = rf(2.2, 3.3);
      o.col = 0xffc887; o.glow = 1.0; o.alpha = 0.16; o.sprite = S_PUFF; o.drag = 1.8;
      o.rot = rf(0, 6.28); o.rotV = rf(-0.9, 0.9); o.fadePow = 1.5;
      this.pAdd.spawn(o);
    }

    // --- radial ground speed-lines ----------------------------------------
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU);
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp0 = rf(38, 62);
      o = pRec();
      o.x = x + ca * 2.0; o.y = gy + rf(0.15, 0.9); o.z = z + sa * 2.0;
      o.vx = ca * sp0; o.vy = rf(0.4, 2.2); o.vz = sa * sp0;
      o.dirX = ca; o.dirY = 0; o.dirZ = sa;
      o.life = rf(0.26, 0.4); o.size = rf(0.14, 0.26); o.sizeEnd = 0.04;
      o.col = 0xffe6bb; o.glow = 1.25; o.alpha = 0.38; o.sprite = S_STREAK;
      o.drag = 8; o.stretch = rf(6, 11); o.fadePow = 2.2;
      this.pAdd.spawn(o);
    }

    // --- chunky debris -----------------------------------------------------
    for (let i = 0; i < 34; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(11, 26);
      const dd = rf(0.3, 1.3);
      b = bRec();
      b.x = x + Math.cos(a) * dd; b.y = gy + rf(0.15, 0.7); b.z = z + Math.sin(a) * dd;
      b.vx = Math.cos(a) * sp0; b.vy = rf(8, 17); b.vz = Math.sin(a) * sp0;
      b.size = rf(0.18, 0.58); b.life = rf(1.5, 2.6); b.ground = gy + 0.06;
      b.ax = rf(-1, 1); b.ay = rf(-1, 1); b.az = rf(-1, 1); b.spin = rf(-16, 16);
      b.hot = Math.max(0, 1 - dd / r) * 0.92;   // V2: blast light on the chunks
      this.debris.spawn(b);
    }
    // Hot shard sprites, recoloured from amber to a desaturated grey-violet.
    // Additive amber-on-amber was exactly the "confetti" read: pale triangles
    // with no hue of their own. Cool now, cooling to near-black.
    for (let i = 0; i < 12; i++) {
      const a = rf(0, TAU), sp0 = rf(10, 22);
      o = pRec();
      o.x = x; o.y = gy + 0.4; o.z = z;
      o.vx = Math.cos(a) * sp0; o.vy = rf(7, 15); o.vz = Math.sin(a) * sp0;
      o.life = rf(0.5, 0.9); o.size = rf(0.18, 0.34); o.sizeEnd = 0.06;
      o.col = 0x8f8ea8; o.colEnd = 0x2e2a3a; o.glow = 1.35; o.glowEnd = 0.8;
      o.sprite = S_SHARD; o.gravity = 24; o.drag = 0.4; o.rotV = rf(-9, 9); o.fadePow = 3;
      this.pAdd.spawn(o);
    }
    // OPAQUE stone chunks thrown UP THROUGH the core, drawn after the additive
    // plume. These are the silhouettes the frame had none of: hard dark shapes
    // with a lit facet, reading against the white-hot centre.
    for (let i = 0; i < 21; i++) {
      const a = rf(0, TAU), sp0 = rf(5, 15);
      o = pRec();
      o.x = x + Math.cos(a) * rf(0.2, r * 0.7); o.y = gy + rf(0.3, 1.0); o.z = z + Math.sin(a) * rf(0.2, r * 0.7);
      o.vx = Math.cos(a) * sp0; o.vy = rf(10, 22); o.vz = Math.sin(a) * sp0;
      o.life = rf(0.7, 1.5); o.size = rf(0.26, 0.78); o.sizeEnd = rf(0.22, 0.62);
      o.col = 0x453a2f; o.colEnd = 0x1e1a17; o.alpha = 0.97; o.glow = 1; o.glowEnd = 1;
      o.sprite = A_CHUNK; o.gravity = 21; o.drag = 0.35;
      o.rot = rf(0, 6.28); o.rotV = rf(-11, 11); o.fadePow = 5;
      this.pSoot.spawn(o);
    }
    // fine ash flakes tumbling THROUGH the incandescent zone. Small, opaque and
    // numerous: at judging resolution these are the pepper of dark speckle that
    // tells the eye there is matter inside the light.
    for (let i = 0; i < 16; i++) {
      const a = rf(0, TAU), sp0 = rf(2, 9);
      o = pRec();
      o.x = x + Math.cos(a) * rf(0.1, r * 0.55); o.y = gy + rf(0.6, 2.6); o.z = z + Math.sin(a) * rf(0.1, r * 0.55);
      o.vx = Math.cos(a) * sp0; o.vy = rf(6, 16); o.vz = Math.sin(a) * sp0;
      o.life = rf(1.0, 1.9); o.size = rf(0.10, 0.24); o.sizeEnd = rf(0.06, 0.16);
      o.col = 0x3a3128; o.colEnd = 0x16130f; o.alpha = 0.92; o.glow = 1; o.glowEnd = 1;
      o.sprite = A_ROCK; o.gravity = 9; o.drag = 1.1;
      o.rot = rf(0, 6.28); o.rotV = rf(-14, 14); o.fadePow = 4;
      this.pSoot.spawn(o);
    }

    // --- sparks ------------------------------------------------------------
    for (let i = 0; i < 50; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(7, 26);
      const upv = rf(4, 16);
      o = pRec();
      o.x = x + Math.cos(a) * rf(0, 1); o.y = gy + rf(0.1, 0.5); o.z = z + Math.sin(a) * rf(0, 1);
      o.vx = Math.cos(a) * sp0; o.vy = upv; o.vz = Math.sin(a) * sp0;
      o.life = rf(0.32, 0.68); o.size = rf(0.14, 0.26); o.sizeEnd = 0.02;
      o.col = i % 4 === 0 ? 0xffffff : 0xffd07a;
      o.glow = 2.1; o.sprite = S_SPARK2; o.gravity = 20; o.drag = 1.6;
      o.stretch = rf(2.2, 4.5); o.fadePow = 3;
      this.pAdd.spawn(o);
    }

    // --- embers that linger and cool --------------------------------------
    for (let i = 0; i < 40; i++) {
      const a = rf(0, TAU), rr = rf(0.3, r * 0.95);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(0.2, 1.4); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(1, 5); o.vy = rf(1.5, 6.5); o.vz = Math.sin(a) * rf(1, 5);
      o.life = rf(1.1, 2.6); o.size = rf(0.1, 0.26); o.sizeEnd = rf(0.03, 0.08);
      o.col = 0xffca7a; o.colEnd = 0x8c2606; o.glow = 2.0; o.glowEnd = 1.1;
      o.sprite = S_EMBER; o.gravity = 2.4; o.drag = 1.3; o.fadePow = 4;
      this.pAdd.spawn(o);
    }

    // --- SOOT: the dark mass, drawn after the plume ------------------------
    // VFX-1, and the whole reason pSoot exists. Three bands:
    //   a) a low, near-opaque bank hugging the crater lip. This is the value
    //      FLOOR the blast reads against — measured, the old frame had 0.02% of
    //      the core region below L=60, i.e. no dark pixels at all.
    //   b) mid lobes rising through the light column, silhouetted by it.
    //   c) a cool grey-violet cap on top, for hue opposition against the amber.
    // NOTE ON ALPHA. These are near-OPAQUE on purpose. Alpha-blending over a
    // core whose linear radiance is >1 cannot make a dark pixel at alpha 0.6:
    // 0.4 of an HDR background still tone-maps bright. Measured, an 0.8-alpha
    // lobe over the core lands around L=150. Only the 0.9+ band, where the
    // billow's own opaque centre survives, actually reads as smoke MASS. The
    // sprite's edges fall off on their own, so the lobes are still soft-edged.
    // Sized and placed as a RING, not a lid: everything sits at r*0.5 or further
    // out so the incandescent centre and the caster stay clear, and the lobes
    // are small enough that the plume reads as boiling volume rather than as one
    // opaque splat over the hero moment (which is what r*0.7 lobes at alpha 0.95
    // gave — measured and looked at; too much dark is its own failure).
    for (let i = 0; i < 11; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.52, r * 1.20);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(0.35, 1.3); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(2.2, 6.0); o.vy = rf(0.9, 2.6); o.vz = Math.sin(a) * rf(2.2, 6.0);
      o.life = rf(1.3, 2.3); o.size = r * rf(0.24, 0.42); o.sizeEnd = r * rf(0.8, 1.35);
      o.col = 0x271c13; o.alpha = rf(0.72, 0.92); o.sprite = A_BILLOW;
      o.drag = 2.2; o.glow = 1; o.rot = rf(0, 6.28); o.rotV = rf(-0.6, 0.6); o.fadePow = 1.6;
      this.pSoot.spawn(o);
    }
    for (let i = 0; i < 16; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.38, r * 0.95);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(1.6, 4.2); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(1.2, 3.8); o.vy = rf(3.0, 7.2); o.vz = Math.sin(a) * rf(1.2, 3.8);
      o.life = rf(1.3, 2.3); o.size = r * rf(0.22, 0.40); o.sizeEnd = r * rf(0.75, 1.3);
      o.col = 0x372718; o.alpha = rf(0.68, 0.92); o.sprite = A_BILLOW;
      o.drag = 1.6; o.glow = 1; o.rot = rf(0, 6.28); o.rotV = rf(-0.7, 0.7); o.fadePow = 1.5;
      this.pSoot.spawn(o);
    }
    for (let i = 0; i < 9; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.25, r * 0.80);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(4.0, 6.8); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(0.8, 2.6); o.vy = rf(3.4, 7.0); o.vz = Math.sin(a) * rf(0.8, 2.6);
      o.life = rf(1.4, 2.4); o.size = r * rf(0.20, 0.38); o.sizeEnd = r * rf(0.7, 1.2);
      o.col = 0x6a6884; o.alpha = rf(0.42, 0.66); o.sprite = A_BILLOW;
      o.drag = 1.3; o.glow = 1; o.rot = rf(0, 6.28); o.rotV = rf(-0.6, 0.6); o.fadePow = 1.4;
      this.pSoot.spawn(o);
    }
    // SECONDARY HUE, bright side. The dark smoke supplies value range but no
    // colour: every pixel above L=170 in this frame was inside a 27-degree amber
    // band. These are the cool half of the palette — the condensation flash
    // riding the shock front and the sky-lit edge of the plume — and they are
    // bright enough to actually count against the gold.
    for (let i = 0; i < 11; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.55, r * 1.35);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(1.0, 4.4); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(2.0, 6.5); o.vy = rf(1.6, 5.0); o.vz = Math.sin(a) * rf(2.0, 6.5);
      o.life = rf(0.45, 0.85); o.size = rf(0.9, 1.9); o.sizeEnd = rf(2.0, 3.4);
      o.col = 0x9dc2ff; o.glow = 1.15; o.alpha = 0.34; o.sprite = S_PUFF;
      o.drag = 2.4; o.rot = rf(0, 6.28); o.rotV = rf(-0.8, 0.8); o.fadePow = 1.8;
      this.pAdd.spawn(o);
    }

    // --- dust: annular curtain + outward-riding skirt -----------------------
    // spawned in a ring, not at the centre, so the crater and the hero stay
    // readable while the plume frames the impact. Recoloured to a cool
    // grey-violet: the outer dust used to be the same 30° amber band as the
    // fire, which is why the whole effect read as one colour.
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.9, r * 1.7);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(0.3, 3.0); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(1.0, 4.0); o.vy = rf(2.0, 5.6); o.vz = Math.sin(a) * rf(1.0, 4.0);
      o.life = rf(1.2, 2.1); o.size = rf(2.0, 3.6); o.sizeEnd = rf(4.4, 7.0);
      o.col = 0x6f7d95; o.alpha = rf(0.26, 0.44); o.sprite = A_SMOKE;
      o.drag = 1.5; o.glow = 1; o.rot = rf(0, 6.28); o.rotV = rf(-0.8, 0.8); o.fadePow = 1.5;
      this.pAlpha.spawn(o);
    }
    for (let i = 0; i < 24; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(16, 32);
      o = pRec();
      o.x = x + Math.cos(a) * 1.4; o.y = gy + rf(0.1, 0.6); o.z = z + Math.sin(a) * 1.4;
      o.vx = Math.cos(a) * sp0; o.vy = rf(0.6, 2.0); o.vz = Math.sin(a) * sp0;
      o.life = rf(0.9, 1.7); o.size = rf(0.9, 1.8); o.sizeEnd = rf(3.2, 5.2);
      o.col = 0x8f8ea8; o.alpha = rf(0.26, 0.44); o.sprite = A_SMOKE;
      o.drag = 4.2; o.glow = 1; o.rot = rf(0, 6.28); o.rotV = rf(-1.2, 1.2); o.fadePow = 1.4;
      this.pAlpha.spawn(o);
    }
    // low soot rolling out along the deck, at the rim
    for (let i = 0; i < 14; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.85, r * 1.5);
      o = pRec();
      o.x = x + Math.cos(a) * rr; o.y = gy + rf(0.6, 3.2); o.z = z + Math.sin(a) * rr;
      o.vx = Math.cos(a) * rf(2, 7); o.vy = rf(2.4, 5.4); o.vz = Math.sin(a) * rf(2, 7);
      o.life = rf(0.9, 1.8); o.size = rf(1.1, 2.1); o.sizeEnd = rf(2.8, 4.6);
      o.col = 0x3a2f24; o.alpha = rf(0.2, 0.36); o.sprite = A_SOOT;
      o.drag = 2.6; o.glow = 1; o.fadePow = 1.4;
      this.pAlpha.spawn(o);
    }
  }

  // -------------------------------------------------------------- lifecycle --
  /**
   * Drop one throw-away instance into EVERY pool so that a single render links
   * every VFX program at load.
   *
   * three.js creates and links a GL program the first time a mesh is actually
   * drawn, and every pool mesh here starts `visible = false`. Left alone, the
   * first Dawnfall is the frame that links the telegraph, crater decal,
   * shockwave ring, light pillar, debris, ghost, beam and trail programs all at
   * once — a synchronous driver compile that no amount of pooling avoids, and on
   * iOS a multi-hundred-millisecond stall that reads exactly as a freeze.
   *
   * Everything is parked far below the deck and sized/alpha'd to nothing, so the
   * warm-up frame draws (and therefore links) all of it without a pixel of it
   * being visible. main.js calls this, renders one frame, then resetAll()s.
   */
  prewarm() {
    const Y = -400;   // under the arena: still drawn (frustumCulled is false)
    const T = 1e-3;   // degenerate size
    const L = 1e4;    // long enough that nothing expires before the reset
    this.pAdd.spawn({ x: 0, y: Y, z: 0, life: L, size: T, sizeEnd: T, alpha: 0, sprite: S_DOT });
    this.pAdd.spawn({ x: 0, y: Y, z: 0, life: L, size: T, sizeEnd: T, alpha: 0, sprite: S_STREAK, stretch: 4, dirX: 1, dirY: 0, dirZ: 0 });
    this.pAlpha.spawn({ x: 0, y: Y, z: 0, life: L, size: T, sizeEnd: T, alpha: 0, sprite: A_SMOKE });
    // pSoot shares pAlpha's shader source verbatim, so three hands it the same
    // linked program — but it is a separate MESH with its own draw call and its
    // own attribute buffers, so it still has to be really drawn once here.
    this.pSoot.spawn({ x: 0, y: Y, z: 0, life: L, size: T, sizeEnd: T, alpha: 0, sprite: A_BILLOW });
    // the wear pool is populated for the whole session by _scatterWear(), so it
    // is already drawn on the warm-up frame; nothing to seed.
    this.arcs.spawn({ x: 0, y: Y, z: 0, life: L, sx0: T, sx1: T, sy0: T, sy1: T, alpha: 0, sprite: S_SLASH });
    this.arcs.spawn({ x: 0, y: Y, z: 0, life: L, mode: 1, pin: 1, sx0: T, sx1: T, sy0: T, sy1: T, alpha: 0, sprite: S_RAY });
    this.ringPool.spawn({ x: 0, y: Y, z: 0, r0: T, r1: T, dur: L, alpha: 0, thick: 0.02, dust: 0, emis: 0 });
    // explicit rot: DecalPool defaults it from the shared rf() stream, and the
    // warm-up must not shift the deterministic paint sequence the shots rely on
    this.decalPool.spawn({ x: 0, y: Y, z: 0, size: T, dur: L, alpha: 0, hot: 0, sprite: 0, rot: 0 });
    this.telePool.acquire(0, Y, 0, T, 0xffffff);
    // delay 0 so the quad is actually emitted this frame; pre-marked as fired so
    // the impact callback (particles + a light pulse) never runs.
    _v1.set(0, Y, 0); _v2.set(0, Y + T, 0);
    this.beamPool.fired[this.beamPool.spawn(_v1, _v2, L, T, 0xffffff, 0)] = 1;
    // hot > 0 also exercises the instanceColor upload path
    this.debris.spawn({
      x: 0, y: Y, z: 0, vx: 0, vy: 0, vz: 0, size: T, life: L, ground: Y - 1,
      ax: 0, ay: 1, az: 0, spin: 0, hot: 1,
    });
    this.ghostPool.spawn(0, Y, 0, 0, 0, 0xffffff, L);
    this.trailBank.setActive(0, true, 0x9fe8ff);
    this.trailBank.setActive(1, true, 0xffab6a);
    this.trailBank.push(0, _v1, _v2);
    this.trailBank.push(1, _v1, _v2);
    const p = this.projs[0];
    p.active = true; p.target = null; p.onHit = null; p.t = 0; p.trailAcc = null;
    p.pos.set(0, Y, 0); p.from.copy(p.pos); p.to.set(0, Y, 1e5);
    p.speed = 1e-4; p.size = T; p.col = 0xffffff; p.dur = 1e6; p.arc = 0;
    p.dx = 0; p.dy = 0; p.dz = 1;
  }

  resetAll() {
    this.pAdd.clear(); this.pAlpha.clear(); this.pSoot.clear();
    // NOT wearPool: it is permanent scenery, not an effect.
    this.arcs.clear(); this.ringPool.clear(); this.decalPool.clear();
    this.telePool.clear(); this.beamPool.clear();
    this.debris.clear(); this.ghostPool.clear(); this.trailBank.clear();
    for (const p of this.projs) p.active = false;
    this.projGeo.instanceCount = 0;
    this.projMesh.visible = false;
    this.trauma = 0; this.kick = 0;
    this._holeDur = 0; uHoleK.value = 0;
    this.dash.on = false; this.dash.last = -99;
    if (this.grade) this.grade.uFlash.value = 0;
  }

  update(dt) {
    this.time += dt;
    this.pAdd.update(dt);
    this.pAlpha.update(dt);
    this.pSoot.update(dt);
    this.arcs.update(dt);
    this.ringPool.update(dt);
    this.decalPool.update(dt);
    this.telePool.update(dt);
    this.beamPool.update(dt, this._onBeamFire);
    this.debris.update(dt);
    this.ghostPool.update(dt);
    this.trailBank.update(dt);

    // caster punch-out closes back up once the flash is over
    if (this._holeDur > 0) {
      this._holeT += dt;
      const k = this._holeT / this._holeDur;
      if (k >= 1) { this._holeDur = 0; uHoleK.value = 0; }
      else uHoleK.value = 1 - k * k;
    }

    // shake decays fast at first then settles — reads as a real impact
    this.trauma = Math.max(0, this.trauma - dt * (1.5 + this.trauma * 2.6));
    this.kick = Math.max(0, this.kick - dt * (5 + this.kick * 10));
    if (this.grade) {
      const f = this.grade.uFlash.value;
      if (f > 0) this.grade.uFlash.value = Math.max(0, f - dt * (2.2 + f * 15));
    }
    if (this.dash.on && this.time - this.dash.last > 0.1) this._dashEnd();

    // projectiles
    let pi = 0;
    const PP = this.projPos.array, PC = this.projCol.array, PD = this.projDir.array;
    for (const p of this.projs) {
      if (!p.active) continue;
      p.t += dt;
      if (p.target && p.target.alive) { p.to.copy(p.target.pos); p.to.y += 0.9; }
      const totalD = Math.max(p.dur, 0.01);
      _v1.copy(p.to).sub(p.pos);
      const dist = _v1.length();
      const step = p.speed * dt;
      if (dist <= step || p.t > 3) {
        p.active = false;
        this.hitSpark(p.to.x, p.to.y, p.to.z, p.col, Math.atan2(p.dx, p.dz));
        if (p.onHit) p.onHit(p);
        continue;
      }
      _v1.normalize();
      p.dx = _v1.x; p.dy = _v1.y; p.dz = _v1.z;
      p.pos.addScaledVector(_v1, step);
      if (p.arc > 0) {
        const ft = Math.min(p.t / totalD, 1);
        p.pos.y += Math.sin(ft * Math.PI) * p.arc * dt * 4;
      }
      if (p.trailAcc !== null) {
        p.trailAcc += dt;
        if (p.trailAcc > 0.016) {
          p.trailAcc = 0;
          let o = pRec();
          o.x = p.pos.x; o.y = p.pos.y; o.z = p.pos.z; o.vx = 0; o.vy = 0.25; o.vz = 0;
          o.life = 0.3; o.size = p.size * 1.5; o.sizeEnd = 0.01;
          o.col = p.col; o.colEnd = 0xffffff;
          o.gravity = 0; o.drag = 0.6; o.sprite = S_DOT; o.glow = 1.3; o.alpha = 0.7; o.fadePow = 1.6;
          this.pAdd.spawn(o);
          if (rnd() < 0.5) {
            o = pRec();
            o.x = p.pos.x; o.y = p.pos.y; o.z = p.pos.z;
            o.vx = (rnd() - 0.5) * 1.2; o.vy = (rnd() - 0.5) * 1.2; o.vz = (rnd() - 0.5) * 1.2;
            o.dirX = p.dx; o.dirY = p.dy; o.dirZ = p.dz;
            o.life = 0.24; o.size = p.size * 0.6; o.sizeEnd = 0.01; o.col = 0xffffff;
            o.gravity = 0; o.drag = 1.5; o.sprite = S_STREAK; o.glow = 1.4; o.alpha = 0.5; o.stretch = 3.5;
            this.pAdd.spawn(o);
          }
        }
      }
      const i4 = pi * 4, i3 = pi * 3;
      PP[i4] = p.pos.x; PP[i4 + 1] = p.pos.y; PP[i4 + 2] = p.pos.z; PP[i4 + 3] = p.size * 3.0;
      _c.setHex(p.col);
      PC[i3] = _c.r; PC[i3 + 1] = _c.g; PC[i3 + 2] = _c.b;
      PD[i3] = p.dx; PD[i3 + 1] = p.dy; PD[i3 + 2] = p.dz;
      pi++;
    }
    this.projGeo.instanceCount = pi;
    this.projMesh.visible = pi > 0;
    if (pi > 0) {
      pushRange(this.projPos, pi * 4); pushRange(this.projCol, pi * 3); pushRange(this.projDir, pi * 3);
    }
  }
}
