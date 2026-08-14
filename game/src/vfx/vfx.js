// VFX system for AETHER RIFT.
//
// Everything is pooled and instanced: the whole effects layer costs at most a
// dozen draw calls no matter how much is on screen, and pools that hold nothing
// issue zero. Zero per-frame allocations — all state lives in preallocated typed
// arrays / preallocated records, all math uses module-scope scratch vectors.
//
//   pAdd / pAlpha ..... billboard sprite particles (1 draw each)
//   arcs .............. oriented additive quads: crescents, pillars, rays
//   rings ............. procedural ground shockwaves (bright edge + dust trail)
//   decals ............ craters / scars, dark scorch + cooling hot fissures
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

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _sc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const TAU = Math.PI * 2;

// deterministic paint stream for the procedural atlases
let _s = 0x9e3779b9;
function rnd() {
  _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rf = (a, b) => a + (b - a) * rnd();

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
  t.userData.canvas = c;
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
  t.userData.canvas = c;
  return t;
}

// sprite ids -------------------------------------------------------------
const S_DOT = 0, S_SPARK = 1, S_SLASH = 2, S_RING = 3;
const S_STREAK = 4, S_FLARE = 5, S_EMBER = 6, S_CRESC = 7;
const S_RAY = 8, S_GLOW = 9, S_PUFF = 10, S_BOLT = 11;
const S_HALO = 12, S_DOME = 13, S_SHARD = 14, S_SPARK2 = 15;
const A_SMOKE = 0, A_PETAL = 1, A_CRACK = 2, A_DOT = 3;
const A_ROCK = 4, A_SOOT = 5, A_WISP = 6;

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
      uniforms: { tMap: { value: texture } },
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aData; attribute vec3 aCol; attribute vec4 aExt;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
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
          vec2 ax = vec2(dir.y, -dir.x);
          vec2 p = (ax * position.x + dir * position.y * st) * aData.x;
          vec3 wp = aPos + right * p.x + up * p.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        void main() {
          vec2 cell = vec2(mod(vSprite, 4.0), floor(vSprite / 4.0));
          vec4 c = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.25);
          gl_FragColor = vec4(c.rgb * vCol, c.a * vA);
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

function pushRange(attr, count) {
  if (attr.clearUpdateRanges) { attr.clearUpdateRanges(); attr.addUpdateRange(0, count); }
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
      uniforms: { tMap: { value: texture } },
      vertexShader: `
        attribute vec3 aPos; attribute vec3 aR; attribute vec3 aU; attribute vec3 aCol; attribute vec3 aData;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
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
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        void main() {
          vec2 cell = vec2(mod(vSprite, 4.0), floor(vSprite / 4.0));
          vec4 c = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.25);
          gl_FragColor = vec4(c.rgb * vCol, c.a * vA);
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
  constructor(scene, cap, texture) {
    this.cap = cap; this.n = 0;
    for (const k of ['t', 'dur', 'hot', 'x', 'y', 'z', 'size', 'rot', 'sprite', 'cr', 'cg', 'cb', 'a'])
      this[k] = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // xyz, halfsize
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // rot, heat, alpha, sprite
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
      uniforms: { tMap: { value: texture } },
      vertexShader: `
        attribute vec4 aPos; attribute vec4 aPar; attribute vec3 aCol;
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol; varying float vSprite;
        void main() {
          float c = cos(aPar.x), s = sin(aPar.x);
          vec3 p = vec3(position.x * c - position.z * s, 0.0, position.x * s + position.z * c) * aPos.w;
          vUv = uv; vPar = vec3(aPar.y, aPar.z, 0.0); vCol = aCol; vSprite = aPar.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + p, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol; varying float vSprite;
        void main() {
          vec2 cell = vec2(mod(vSprite, 2.0), floor(vSprite / 2.0));
          vec3 m = texture2D(tMap, (cell + clamp(vUv, 0.004, 0.996)) * 0.5).rgb;
          float heat = vPar.x, sa = vPar.y;
          float edgeFade = 1.0 - smoothstep(0.80, 1.0, length(vUv - 0.5) * 2.0);
          float a = clamp(m.g * sa * edgeFade, 0.0, 0.88);
          // fissures cool: white-gold -> orange -> deep red -> out
          vec3 hotCol = mix(vec3(0.75, 0.10, 0.02), vCol, smoothstep(0.0, 0.75, heat));
          hotCol = mix(hotCol, vec3(1.0, 0.93, 0.78), smoothstep(0.72, 1.0, heat));
          float fis = m.r * pow(heat, 0.55);
          float rim = m.b * heat * 0.55;
          vec3 emis = hotCol * (fis * fis * 1.35 + fis * 0.30 + rim);
          vec3 dark = vec3(0.055, 0.040, 0.030);
          gl_FragColor = vec4(dark * a + emis, a);
          if (gl_FragColor.a < 0.003 && emis.r + emis.g + emis.b < 0.004) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(o) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = 0; let best = -1; for (let k = 0; k < this.n; k++) { const p = this.t[k] / this.dur[k]; if (p > best) { best = p; i = k; } } }
    this.t[i] = 0; this.dur[i] = o.dur || 7;
    this.hot[i] = o.hot ?? 0;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    this.size[i] = o.size * 0.5;
    this.rot[i] = o.rot ?? rf(0, TAU);
    this.sprite[i] = o.sprite || 0;
    _c.setHex(o.col ?? 0xffb04d);
    this.cr[i] = _c.r; this.cg[i] = _c.g; this.cb[i] = _c.b;
    this.a[i] = o.alpha ?? 1;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) for (const k of ['t', 'dur', 'hot', 'x', 'y', 'z', 'size', 'rot', 'sprite', 'cr', 'cg', 'cb', 'a'])
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
    const P = this.aPos.array, R = this.aPar.array, C = this.aCol.array;
    for (let j = 0; j < n; j++) {
      const t = this.t[j] / this.dur[j];
      const j4 = j * 4, j3 = j * 3;
      P[j4] = this.x[j]; P[j4 + 1] = this.y[j]; P[j4 + 2] = this.z[j]; P[j4 + 3] = this.size[j];
      R[j4] = this.rot[j];
      // heat cools over ~2 s regardless of the scorch lifetime
      const heat = this.hot[j] > 0 ? Math.max(0, 1 - this.t[j] / (this.hot[j] * 2.0)) : 0;
      R[j4 + 1] = heat * heat * (0.35 + 0.65 * heat);
      R[j4 + 2] = this.a[j] * Math.min(1, this.t[j] * 14) * Math.pow(1 - t, 1.6);
      R[j4 + 3] = this.sprite[j];
      C[j3] = this.cr[j]; C[j3 + 1] = this.cg[j]; C[j3 + 2] = this.cb[j];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { pushRange(this.aPos, n * 4); pushRange(this.aPar, n * 4); pushRange(this.aCol, n * 3); }
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
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol;
        void main() {
          vUv = uv; vPar = aPar; vCol = aCol;
          gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + position * aPos.w, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D tRune;
        varying vec2 vUv; varying vec3 vPar; varying vec3 vCol;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float d = length(q);
          if (d > 1.001) discard;
          float age = vPar.x, A = vPar.y, prog = vPar.z;
          float ang = atan(q.y, q.x);
          // outer rim: double line, pulsing
          float pulse = 0.72 + 0.28 * sin(uTime * 7.0);
          float rim = (1.0 - smoothstep(0.0, 0.030, abs(d - 0.985))) * pulse;
          rim += (1.0 - smoothstep(0.0, 0.016, abs(d - 0.895))) * 0.55;
          // radar sweep
          float sw = fract((ang / 6.2831) + 0.5 - uTime * 0.55);
          float sweep = pow(1.0 - sw, 7.0) * (1.0 - smoothstep(0.86, 1.0, d)) * 0.65;
          // fill that charges up with the cast
          float fill = step(d, prog) * (0.09 + 0.05 * sin(uTime * 6.0 - d * 8.0));
          fill += smoothstep(prog + 0.06, prog - 0.02, d) * smoothstep(prog - 0.16, prog - 0.02, d) * 0.5;
          // marching chevrons
          float chev = smoothstep(0.86, 0.99, fract(d * 3.0 - uTime * 1.4)) * (1.0 - smoothstep(0.5, 0.95, d)) * 0.22;
          // rune band
          vec2 ru = (q * 1.06) * 0.5 + 0.5;
          float rr = texture2D(tRune, clamp(ru, 0.0, 1.0)).a * (0.55 + 0.45 * sin(uTime * 3.0));
          float glow = (rim * 1.5 + sweep + fill + chev + rr * 0.85) * A;
          float dark = (1.0 - smoothstep(0.55, 1.0, d)) * 0.16 * A;
          gl_FragColor = vec4(vCol * glow * 1.25 + vec3(0.02, 0.015, 0.012) * dark, dark);
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
      uniforms: { uTime },
      vertexShader: `
        attribute vec3 aA; attribute vec3 aB; attribute vec2 aPar; attribute vec3 aCol;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main() {
          vUv = uv; vCol = aCol; vA = aPar.y;
          float s = position.y + 0.5;
          vec3 p = mix(aA, aB, s);
          vec3 axis = normalize(aB - aA);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = cross(axis, toCam);
          float l = length(side);
          side = (l > 1e-4) ? side / l : vec3(1.0, 0.0, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p + side * position.x * aPar.x * 2.0, 1.0);
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
    for (const k of ['t', 'dur', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'sc', 'ax', 'ay', 'az', 'aw', 'ground'])
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
    parts.push(g0.toNonIndexed());
    const geo = mergeGeometries(parts, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      _c.setHSL(0.085 + rf(-0.02, 0.03), rf(0.14, 0.30), rf(0.42, 0.74));
      this.mesh.setColorAt(i, _c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this.warm = 2;
  }
  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.t[i] = 0; this.dur[i] = o.life;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.sc[i] = o.size;
    this.ground[i] = o.ground ?? 0;
    const l = Math.hypot(o.ax, o.ay, o.az) || 1;
    this.ax[i] = o.ax / l; this.ay[i] = o.ay / l; this.az[i] = o.az / l;
    this.aw[i] = o.spin;
    this.qx[i] = 0; this.qy[i] = 0; this.qz[i] = 0; this.qw[i] = 1;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) {
      for (const k of ['t', 'dur', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'sc', 'ax', 'ay', 'az', 'aw', 'ground', 'qx', 'qy', 'qz', 'qw'])
        this[k][i] = this[k][l];
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
    for (let j = 0; j < n; j++) {
      const t = this.t[j] / this.dur[j];
      const k = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      _v1.set(this.x[j], this.y[j], this.z[j]);
      _q.set(this.qx[j], this.qy[j], this.qz[j], this.qw[j]);
      _sc.setScalar(this.sc[j] * k);
      _m.compose(_v1, _q, _sc);
      this.mesh.setMatrixAt(j, _m);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }
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
  static DEBUG_DECALS = false;
  constructor({ scene, groundHeight, gradeUniforms, onText }) {
    this.scene = scene;
    this.groundHeight = groundHeight || (() => 0);
    this.grade = gradeUniforms;
    this.onText = onText || (() => {});
    this.trauma = 0;
    this.kick = 0;
    this.kickX = 0; this.kickZ = 0;
    this.time = 0;

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
    ]);
    this.decalTex = buildDecalAtlas();
    this.atlases = { add: atlasAdd, alpha: atlasAlpha, decal: this.decalTex };

    // render order: decals(3) → dust(4) → rings(5) → telegraphs(5.5) →
    // ghosts(6) → arcs(7) → additive particles(8) → beams/projectiles(9).
    // Dust sits under the light so a shockwave still punches through smoke.
    this.pAdd = new ParticlePool(scene, 1000, atlasAdd, true, 8);
    this.pAlpha = new ParticlePool(scene, 420, atlasAlpha, false, 4);
    this.arcs = new ArcPool(scene, 72, atlasAdd, 7);
    this.ringPool = new RingPool(scene, 22);
    this.decalPool = new DecalPool(scene, 14, this.decalTex);
    this.telePool = new TelePool(scene, 6);
    this.beamPool = new BeamPool(scene, 8);
    this.debris = new DebrisPool(scene, 56);
    this.ghostPool = new GhostPool(scene, 12);
    this.trailBank = new TrailBank(scene, 2, 18);

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
  burst(x, y, z, {
    count = 10, col = 0xffe9b0, col2 = null, colEnd, speed = 5, up = 2.5, life = 0.5,
    size = 0.28, sizeEnd = 0.05, gravity = 6, spread = 1, sprite = 1, pool = 'add',
    glow = 1.6, drag = 2, alpha = 1, stretch = 1, fadePow = 2, cone = null, coneWidth = 1,
  } = {}) {
    const P = pool === 'add' ? this.pAdd : this.pAlpha;
    for (let i = 0; i < count; i++) {
      let ax, az;
      if (cone !== null) {
        const a = cone + (Math.random() - 0.5) * coneWidth;
        ax = Math.sin(a); az = Math.cos(a);
      } else {
        const a = Math.random() * TAU;
        ax = Math.cos(a); az = Math.sin(a);
      }
      const r = Math.random();
      const sp = speed * (0.4 + Math.random() * 0.6);
      P.spawn({
        x: x + ax * r * spread * 0.4, y: y + Math.random() * 0.2, z: z + az * r * spread * 0.4,
        vx: ax * sp * spread, vy: up * (0.5 + Math.random() * 0.8), vz: az * sp * spread,
        life: life * (0.6 + Math.random() * 0.7), size: size * (0.7 + Math.random() * 0.6), sizeEnd,
        col: col2 && Math.random() < 0.5 ? col2 : col, colEnd, gravity, drag,
        rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 6,
        sprite, glow, alpha, stretch, fadePow,
      });
    }
  }

  ring(x, y, z, { r0 = 0.3, r1 = 5, dur = 0.5, col = 0xfff2cf, alpha = 0.75,
    thick = 0.14, dust = 0.45, emis = 1, ease = 3, kick = true } = {}) {
    this.ringPool.spawn({ x, y: y + 0.14, z, r0, r1, dur, col, alpha, thick, dust, emis, ease });
    if (!kick) return;
    // ground dust + sparks kicked up along the leading edge
    const n = Math.min(14, Math.max(3, Math.round(r1 * 1.6)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rr = r0 + (r1 - r0) * 0.22;
      this.pAlpha.spawn({
        x: x + ca * rr, y: y + 0.1, z: z + sa * rr,
        vx: ca * r1 * 1.5, vy: 0.6 + Math.random() * 0.9, vz: sa * r1 * 1.5,
        life: dur * 1.9, size: 0.34 + r1 * 0.09, sizeEnd: 0.9 + r1 * 0.22,
        col: 0xbfae90, alpha: 0.3, sprite: A_SMOKE, glow: 1, drag: 3.4, fadePow: 1.5,
      });
      if (i % 2 === 0) {
        this.pAdd.spawn({
          x: x + ca * rr, y: y + 0.16, z: z + sa * rr,
          vx: ca * r1 * 3.4, vy: 1.4 + Math.random() * 2.6, vz: sa * r1 * 3.4,
          life: 0.26 + Math.random() * 0.18, size: 0.2, sizeEnd: 0.04,
          col, glow: 2.0, sprite: S_SPARK2, gravity: 9, drag: 2.6, stretch: 2.6,
        });
      }
    }
  }

  // Crescent blade arc: bright leading edge + soft trailing ghosts + edge sparks.
  slashArc(x, y, z, yaw, { col = 0x9fe8ff, size = 2.6, dur = 0.26, tilt = -1.15,
    vel = 0, grow = 1.6, scar = null } = {}) {
    const el = tilt + Math.PI / 2;                 // elevation above the ground plane
    const vx = Math.sin(yaw) * vel, vz = Math.cos(yaw) * vel;
    const g = 0.55 + grow * 0.32;
    // main body
    this.arcs.spawn({
      x, y, z, vx, vz, life: dur, yaw, el,
      roll: -0.30, rollV: 1.5,
      sx0: size * 0.55, sx1: size * g * 1.28,
      sy0: size * 0.68, sy1: size * g * 1.06,
      col, glow: 1.35, alpha: 0.92, sprite: S_SLASH, fadePow: 1.7,
    });
    // hot leading edge, slightly bigger and much shorter lived
    this.arcs.spawn({
      x, y, z, vx: vx * 1.12, vz: vz * 1.12, life: dur * 0.55, yaw, el,
      roll: -0.24, rollV: 1.4,
      sx0: size * 0.62, sx1: size * g * 1.42,
      sy0: size * 0.74, sy1: size * g * 1.16,
      col: 0xffffff, glow: 1.5, alpha: 0.85, sprite: S_CRESC, fadePow: 3,
    });
    // trailing gradient ghosts
    for (let i = 1; i <= 2; i++) {
      this.arcs.spawn({
        x: x - Math.sin(yaw) * 0.22 * i, y: y - 0.05 * i, z: z - Math.cos(yaw) * 0.22 * i,
        vx: vx * 0.72, vz: vz * 0.72, life: dur * (1.1 + i * 0.25), yaw, el,
        roll: -0.38 - i * 0.1, rollV: 1.2,
        sx0: size * 0.44, sx1: size * g * (1.05 - i * 0.1),
        sy0: size * 0.56, sy1: size * g * (0.9 - i * 0.08),
        col, glow: 0.9, alpha: 0.32 / i, sprite: S_SLASH, fadePow: 1.3,
      });
    }
    // sparks along the cutting edge
    const cnt = Math.round(6 + size * 2.4);
    for (let i = 0; i < cnt; i++) {
      const a = yaw + (Math.random() - 0.5) * 1.5;
      const rr = size * (0.45 + Math.random() * 0.55);
      const sx = x + Math.sin(a) * rr, sz = z + Math.cos(a) * rr;
      this.pAdd.spawn({
        x: sx, y: y + (Math.random() - 0.4) * 0.4, z: sz,
        vx: Math.sin(a) * (4 + vel * 0.5), vy: 1.2 + Math.random() * 2.4, vz: Math.cos(a) * (4 + vel * 0.5),
        life: 0.2 + Math.random() * 0.2, size: 0.17 + Math.random() * 0.1, sizeEnd: 0.02,
        col: Math.random() < 0.4 ? 0xffffff : col, glow: 2.0, sprite: S_SPARK2,
        gravity: 8, drag: 2.5, stretch: 2.2,
      });
    }
    if (scar) {
      const gy = this.groundHeight(x, z);
      this.decalPool.spawn({
        x, y: gy + 0.105, z, size: size * 2.0, dur: scar, rot: -yaw,
        sprite: 1, col, hot: 0.34, alpha: 0.55,
      });
    }
  }

  decal(x, z, { size = 5, dur = 7, glowCol = 0xffa93d, sprite = 0, hot = 1, alpha = 1 } = {}) {
    const y = this.groundHeight(x, z);
    this.decalPool.spawn({ x, y: y + 0.11, z, size, dur, col: glowCol, sprite, hot, alpha });
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
      this.pAdd.spawn({
        x: from.x, y: from.y, z: from.z, life: 0.16, size: size * 3.2, sizeEnd: size * 0.6,
        col, glow: 1.7, alpha: 0.8, sprite: S_GLOW, drag: 0, gravity: 0,
      });
      return p;
    }
    return null;
  }

  beam(from, to, { col = 0xff8a4d, dur = 0.32, r = 0.22, delay = 0.1 } = {}) {
    this.beamPool.spawn(from, to, dur, r, col, delay);
    // charge-up telegraph at the muzzle
    this.pAdd.spawn({
      x: from.x, y: from.y, z: from.z, life: delay + 0.06,
      size: 0.12, sizeEnd: r * 5.2, col, glow: 1.5, alpha: 0.9, sprite: S_GLOW, fadePow: 4,
    });
    this.pAdd.spawn({
      x: from.x, y: from.y, z: from.z, life: delay + 0.02,
      size: 0.05, sizeEnd: r * 9, col: 0xffffff, glow: 1.3, alpha: 0.55, sprite: S_FLARE, fadePow: 5,
      rot: Math.random() * 6.28,
    });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * TAU, rr = 1.1 + Math.random() * 0.9;
      const p = Math.random() * Math.PI - Math.PI / 2;
      const cx = Math.cos(a) * Math.cos(p) * rr, cy = Math.sin(p) * rr, cz = Math.sin(a) * Math.cos(p) * rr;
      this.pAdd.spawn({
        x: from.x + cx, y: from.y + cy, z: from.z + cz,
        vx: -cx / delay, vy: -cy / delay, vz: -cz / delay,
        life: delay, size: 0.16, sizeEnd: 0.03, col, glow: 1.8, sprite: S_SPARK2, drag: 0, stretch: 2.4,
      });
    }
  }
  _beamImpact(x, y, z, r, g, b) {
    _c.setRGB(r, g, b);
    const hex = _c.getHex();
    this.pAdd.spawn({ x, y, z, life: 0.2, size: 0.5, sizeEnd: 2.0, col: hex, glow: 1.6, alpha: 0.8, sprite: S_GLOW, fadePow: 3 });
    this.burst(x, y, z, { count: 8, col: hex, col2: 0xffffff, speed: 6, up: 2.6, life: 0.3, size: 0.19, sizeEnd: 0.02, gravity: 10, sprite: S_SPARK2, glow: 2.1, stretch: 2.6, drag: 3 });
  }

  pillar(x, y, z, { col = 0xffd98c, dur = 0.5, r = 0.8, h = 6, glow = 1.2 } = {}) {
    this.arcs.spawn({
      x, y, z, life: dur, mode: 1, pin: 1,
      sx0: r * 2.2, sx1: r * 3.4, sy0: h * 0.55, sy1: h * 1.06,
      col, glow, alpha: 0.5, sprite: S_RAY, fadePow: 2,
    });
    this.arcs.spawn({
      x, y, z, life: dur * 0.7, mode: 1, pin: 1,
      sx0: r * 0.7, sx1: r * 1.2, sy0: h * 0.7, sy1: h * 1.12,
      col: 0xffffff, glow: 1.3, alpha: 0.55, sprite: S_RAY, fadePow: 3,
    });
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
        const s = Math.random();
        const px = D.px + mx * s, pz = D.pz + mz * s;
        const off = (Math.random() - 0.5) * 1.15;
        this.pAdd.spawn({
          x: px - D.dz * off, y: pos.y + 0.35 + Math.random() * 1.5, z: pz + D.dx * off,
          vx: -D.dx * 5.5, vy: 0.25, vz: -D.dz * 5.5,
          dirX: D.dx, dirY: 0, dirZ: D.dz,
          life: 0.24 + Math.random() * 0.12, size: 0.16, sizeEnd: 0.02,
          col: 0xbfeeff, glow: 1.5, alpha: 0.75, sprite: S_STREAK, drag: 2.4, stretch: 7 + Math.random() * 5,
        });
      }
      this.pAlpha.spawn({
        x: pos.x, y: pos.y + 0.08, z: pos.z, vy: 0.5,
        life: 0.45, size: 0.34, sizeEnd: 1.0, col: 0xc8bda2, alpha: 0.26, sprite: A_SMOKE, drag: 2.2,
      });
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
    this.pAdd.spawn({
      x, y: y + 1.0, z, life: 0.2, size: 0.6, sizeEnd: 2.6,
      col: 0xbfeeff, glow: 1.6, alpha: 0.8, sprite: S_GLOW, fadePow: 3,
    });
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
        this.pAdd.spawn({
          x: tip.x, y: tip.y, z: tip.z,
          vx: dx * inv * 2.2, vy: dy * inv * 2.2 + 0.6, vz: dz * inv * 2.2,
          dirX: dx * inv, dirY: dy * inv, dirZ: dz * inv,
          life: 0.2 + Math.random() * 0.12, size: 0.13, sizeEnd: 0.02,
          col: 0xd8f6ff, glow: 1.8, alpha: 0.8, sprite: S_SPARK2, gravity: 5, drag: 3, stretch: 2.6,
        });
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
  hitSpark(x, y, z, col = 0xffe9b0, dirYaw = null) {
    // victim flash — brief white pop that reads as a damage flash
    this.pAdd.spawn({
      x, y, z, life: 0.13, size: 1.5, sizeEnd: 0.85,
      col: 0xffffff, glow: 1.15, alpha: 0.62, sprite: S_GLOW, fadePow: 3, drag: 0,
    });
    this.pAdd.spawn({
      x, y, z, life: 0.17, size: 0.6, sizeEnd: 2.1, rot: Math.random() * 6.28,
      col, glow: 1.9, alpha: 0.75, sprite: S_FLARE, fadePow: 3, drag: 0,
    });
    this.burst(x, y, z, {
      count: 9, col, col2: 0xffffff, speed: 6.5, up: 2.4, life: 0.26, size: 0.16, sizeEnd: 0.02,
      gravity: 11, sprite: S_SPARK2, glow: 2.1, stretch: 3, drag: 3.2,
      cone: dirYaw, coneWidth: 2.2,
    });
  }
  meleeImpact(x, y, z, col, dirYaw = null) {
    this.hitSpark(x, y, z, col, dirYaw);
    this.pAdd.spawn({
      x, y, z, life: 0.15, size: 0.4, sizeEnd: 1.15,
      col, glow: 1.3, alpha: 0.42, sprite: S_HALO, fadePow: 3,
    });
    this.burst(x, y, z, {
      count: 4, col: 0x9a8a70, speed: 2.6, up: 2.2, life: 0.5, size: 0.16, sizeEnd: 0.45,
      gravity: 6, sprite: A_SMOKE, pool: 'alpha', glow: 1, alpha: 0.35,
    });
  }
  deathBurst(x, y, z, col = 0x8fd4ff) {
    this.burst(x, y, z, { count: 18, col, col2: 0xffffff, speed: 4.5, up: 3.4, life: 0.65, size: 0.26, sizeEnd: 0.02, gravity: 6, sprite: S_SPARK2, glow: 2, stretch: 2.4, drag: 2.4 });
    this.burst(x, y, z, { count: 10, col, colEnd: 0x5a2a12, speed: 1.6, up: 3.0, life: 1.2, size: 0.15, sizeEnd: 0.05, gravity: 2.4, sprite: S_EMBER, glow: 1.9, drag: 1.4, fadePow: 4 });
    this.burst(x, y, z, { count: 7, col: 0xdad4c8, speed: 1.8, up: 1.2, life: 0.85, size: 0.5, sizeEnd: 1.35, gravity: -0.3, sprite: A_SMOKE, pool: 'alpha', alpha: 0.4, glow: 1, fadePow: 1.4 });
    this.pAdd.spawn({ x, y, z, life: 0.22, size: 0.8, sizeEnd: 2.6, col, glow: 1.5, alpha: 0.7, sprite: S_GLOW, fadePow: 3 });
    this.ring(x, y - 0.4, z, { r0: 0.25, r1: 2.9, dur: 0.42, col, alpha: 0.7, thick: 0.2, dust: 0.5, ease: 2.6 });
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
  dawnfall(x, y, z, r) {
    const gy = this.groundHeight(x, z);
    this.flash(0.72);
    this.shake(1.25);

    // --- impact frame: a very short, very hot core -------------------------
    this.pAdd.spawn({ x, y: gy + 0.5, z, life: 0.095, size: r * 1.1, sizeEnd: r * 2.0, col: 0xfff6e2, glow: 1.5, alpha: 0.9, sprite: S_GLOW, fadePow: 4 });
    this.pAdd.spawn({ x, y: gy + 0.9, z, life: 0.13, size: r * 0.7, sizeEnd: r * 2.6, col: 0xffe6b4, glow: 1.7, alpha: 0.8, sprite: S_FLARE, fadePow: 3, rot: 0.2 });
    // lingering anamorphic star, lifted off the deck so the crater stays visible
    this.pAdd.spawn({ x, y: gy + 2.1, z, life: 0.55, size: r * 0.34, sizeEnd: r * 0.95, col: 0xffd58a, glow: 1.3, alpha: 0.42, sprite: S_FLARE, fadePow: 2.6, rot: 1.1 });

    // --- shockwave train ---------------------------------------------------
    // fast thin outrunner
    this.ringPool.spawn({ x, y: gy + 0.20, z, r0: 0.8, r1: r * 2.2, dur: 0.6, col: 0xcfe6ff, alpha: 0.8, thick: 0.045, dust: 0.14, emis: 0.8, ease: 3.4 });
    // main bright shockwave
    this.ringPool.spawn({ x, y: gy + 0.19, z, r0: 1.2, r1: r * 1.9, dur: 0.9, col: 0xffbe64, alpha: 1, thick: 0.16, dust: 0.7, emis: 1.05, ease: 3 });
    // hot inner ring
    this.ringPool.spawn({ x, y: gy + 0.18, z, r0: 0.3, r1: r * 1.0, dur: 0.5, col: 0xffe3ab, alpha: 0.85, thick: 0.24, dust: 0.35, emis: 0.8, ease: 2.4 });
    // slow soot skirt
    this.ringPool.spawn({ x, y: gy + 0.17, z, r0: 0.6, r1: r * 1.4, dur: 1.6, col: 0xc79055, alpha: 1, thick: 0.3, dust: 1.0, emis: 0.18, ease: 2.2 });
    // shock dome
    this.arcs.spawn({
      x, y: gy, z, life: 0.42, mode: 1,
      sx0: r * 0.8, sx1: r * 2.6, sy0: r * 0.45, sy1: r * 1.3,
      yoff: 0, col: 0xffe9c0, glow: 0.85, alpha: 0.20, sprite: S_DOME, fadePow: 2.4,
    });

    // --- crater + scorch ---------------------------------------------------
    this.decalPool.spawn({ x, y: gy + 0.11, z, size: r * 1.9, dur: 11, col: 0xffb254, sprite: 0, hot: 1, alpha: 1 });
    this.decalPool.spawn({ x, y: gy + 0.10, z, size: r * 3.0, dur: 8, col: 0xff9a3c, sprite: 2, hot: 0.35, alpha: 0.7 });
    this.decalPool.spawn({ x, y: gy + 0.12, z, size: r * 2.2, dur: 1.6, col: 0xffd28a, sprite: 3, hot: 1, alpha: 0.0 });
    if (VFX.DEBUG_DECALS) return;

    // --- vertical light burst ---------------------------------------------
    // the column uses a double-tapered streak so its hot zone sits ABOVE the
    // deck: the crater stays readable underneath instead of being washed out.
    this.arcs.spawn({
      x, y: gy, z, life: 0.85, mode: 1, pin: 1,
      sx0: r * 0.8, sx1: r * 1.4, sy0: 11, sy1: 23,
      col: 0xffc978, glow: 1.2, alpha: 0.7, sprite: S_STREAK, fadePow: 2.2,
    });
    this.arcs.spawn({
      x, y: gy, z, life: 0.6, mode: 1, pin: 1,
      sx0: r * 0.26, sx1: r * 0.48, sy0: 13, sy1: 21,
      col: 0xfff6e6, glow: 1.45, alpha: 0.85, sprite: S_STREAK, fadePow: 3,
    });
    // soft light bloom wrapped around the column (sells "burst", not "beam")
    this.arcs.spawn({
      x, y: gy + 3.4, z, life: 0.7, mode: 1,
      sx0: r * 1.0, sx1: r * 1.9, sy0: r * 0.9, sy1: r * 1.7,
      col: 0xffd190, glow: 1.0, alpha: 0.3, sprite: S_GLOW, fadePow: 2.4,
    });
    this.arcs.spawn({
      x, y: gy, z, life: 1.15, mode: 1, pin: 1,
      sx0: r * 1.45, sx1: r * 2.2, sy0: 8, sy1: 16,
      col: 0xffa858, glow: 0.7, alpha: 0.11, sprite: S_STREAK, fadePow: 1.8,
    });
    // small root flare where the column meets the stone
    this.arcs.spawn({
      x, y: gy, z, life: 0.45, mode: 1, pin: 1,
      sx0: r * 0.34, sx1: r * 0.6, sy0: 2.2, sy1: 3.4,
      col: 0xfff0cf, glow: 1.2, alpha: 0.3, sprite: S_RAY, fadePow: 3,
    });

    // --- radial god-ray streaks -------------------------------------------
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + rf(-0.13, 0.13);
      const pitch = rf(0.55, 1.35);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dx = Math.cos(a) * cp, dy = sp, dz = Math.sin(a) * cp;
      const sp0 = rf(8, 15);
      this.pAdd.spawn({
        x: x + dx * 2.0, y: gy + 1.5 + dy * 2.0, z: z + dz * 2.0,
        vx: dx * sp0, vy: dy * sp0, vz: dz * sp0,
        dirX: dx, dirY: dy, dirZ: dz,
        life: rf(0.44, 0.7), size: rf(0.5, 0.95), sizeEnd: rf(0.1, 0.24),
        col: i % 3 === 0 ? 0xfff0cc : 0xffc06a, glow: 1.25, alpha: 0.62,
        sprite: S_RAY, drag: 4.5, stretch: rf(8, 14), fadePow: 2.4,
      });
    }
    // sunlit dust catching the burst — additive, so the plume glows instead of
    // turning the frame grey the way pure alpha smoke does.
    for (let i = 0; i < 20; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.35, r * 1.05);
      this.pAdd.spawn({
        x: x + Math.cos(a) * rr, y: gy + rf(0.3, 1.8), z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * rf(1.5, 5), vy: rf(2.2, 5.5), vz: Math.sin(a) * rf(1.5, 5),
        life: rf(0.8, 1.5), size: rf(1.4, 2.4), sizeEnd: rf(3.2, 5.0),
        col: 0xffc887, glow: 1.0, alpha: 0.2, sprite: S_PUFF, drag: 1.8,
        rot: rf(0, 6.28), rotV: rf(-0.9, 0.9), fadePow: 1.5,
      });
    }

    // --- radial ground speed-lines ----------------------------------------
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU);
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp0 = rf(38, 62);
      this.pAdd.spawn({
        x: x + ca * 2.0, y: gy + rf(0.15, 0.9), z: z + sa * 2.0,
        vx: ca * sp0, vy: rf(0.4, 2.2), vz: sa * sp0,
        dirX: ca, dirY: 0, dirZ: sa,
        life: rf(0.26, 0.4), size: rf(0.14, 0.26), sizeEnd: 0.04,
        col: 0xffe6bb, glow: 1.25, alpha: 0.38, sprite: S_STREAK, drag: 8, stretch: rf(6, 11), fadePow: 2.2,
      });
    }

    // --- chunky debris -----------------------------------------------------
    for (let i = 0; i < 34; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(11, 26);
      this.debris.spawn({
        x: x + Math.cos(a) * rf(0.3, 1.3), y: gy + rf(0.15, 0.7), z: z + Math.sin(a) * rf(0.3, 1.3),
        vx: Math.cos(a) * sp0, vy: rf(8, 17), vz: Math.sin(a) * sp0,
        size: rf(0.18, 0.58), life: rf(1.5, 2.6), ground: gy + 0.06,
        ax: rf(-1, 1), ay: rf(-1, 1), az: rf(-1, 1), spin: rf(-16, 16),
      });
    }
    // glowing shard sprites so the debris reads even against dark stone
    for (let i = 0; i < 14; i++) {
      const a = rf(0, TAU), sp0 = rf(10, 22);
      this.pAdd.spawn({
        x, y: gy + 0.4, z,
        vx: Math.cos(a) * sp0, vy: rf(7, 15), vz: Math.sin(a) * sp0,
        life: rf(0.5, 0.9), size: rf(0.18, 0.34), sizeEnd: 0.06,
        col: 0xffb058, colEnd: 0x6a2408, glow: 1.7, glowEnd: 1.2,
        sprite: S_SHARD, gravity: 24, drag: 0.4, rotV: rf(-9, 9), fadePow: 3,
      });
    }

    // --- sparks ------------------------------------------------------------
    for (let i = 0; i < 56; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(7, 26);
      const upv = rf(4, 16);
      this.pAdd.spawn({
        x: x + Math.cos(a) * rf(0, 1), y: gy + rf(0.1, 0.5), z: z + Math.sin(a) * rf(0, 1),
        vx: Math.cos(a) * sp0, vy: upv, vz: Math.sin(a) * sp0,
        life: rf(0.32, 0.68), size: rf(0.14, 0.26), sizeEnd: 0.02,
        col: i % 4 === 0 ? 0xffffff : 0xffd07a,
        glow: 2.1, sprite: S_SPARK2, gravity: 20, drag: 1.6, stretch: rf(2.2, 4.5), fadePow: 3,
      });
    }

    // --- embers that linger and cool --------------------------------------
    for (let i = 0; i < 46; i++) {
      const a = rf(0, TAU), rr = rf(0.3, r * 0.95);
      this.pAdd.spawn({
        x: x + Math.cos(a) * rr, y: gy + rf(0.2, 1.4), z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * rf(1, 5), vy: rf(1.5, 6.5), vz: Math.sin(a) * rf(1, 5),
        life: rf(1.1, 2.6), size: rf(0.1, 0.26), sizeEnd: rf(0.03, 0.08),
        col: 0xffca7a, colEnd: 0x8c2606, glow: 2.0, glowEnd: 1.1,
        sprite: S_EMBER, gravity: 2.4, drag: 1.3, fadePow: 4,
      });
    }

    // --- dust: annular curtain + outward-riding skirt -----------------------
    // spawned in a ring, not at the centre, so the crater and the hero stay
    // readable while the plume frames the impact.
    // curtain sits OUTSIDE the crater lip so it darkens bright pavement rather
    // than washing out the scorch mark it is supposed to frame
    for (let i = 0; i < 30; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.9, r * 1.7);
      this.pAlpha.spawn({
        x: x + Math.cos(a) * rr, y: gy + rf(0.3, 3.0), z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * rf(1.0, 4.0), vy: rf(2.0, 5.6), vz: Math.sin(a) * rf(1.0, 4.0),
        life: rf(1.2, 2.1), size: rf(2.0, 3.6), sizeEnd: rf(4.4, 7.0),
        col: 0xa48b68, alpha: rf(0.42, 0.68), sprite: A_SMOKE, drag: 1.5, glow: 1,
        rot: rf(0, 6.28), rotV: rf(-0.8, 0.8), fadePow: 1.5,
      });
    }
    for (let i = 0; i < 26; i++) {
      const a = rf(0, TAU);
      const sp0 = rf(16, 32);
      this.pAlpha.spawn({
        x: x + Math.cos(a) * 1.4, y: gy + rf(0.1, 0.6), z: z + Math.sin(a) * 1.4,
        vx: Math.cos(a) * sp0, vy: rf(0.6, 2.0), vz: Math.sin(a) * sp0,
        life: rf(0.9, 1.7), size: rf(0.9, 1.8), sizeEnd: rf(3.2, 5.2),
        col: 0xc2ab88, alpha: rf(0.26, 0.44), sprite: A_SMOKE, drag: 4.2, glow: 1,
        rot: rf(0, 6.28), rotV: rf(-1.2, 1.2), fadePow: 1.4,
      });
    }
    // dark soot puffs, kept out at the rim so the core stays clean
    for (let i = 0; i < 16; i++) {
      const a = rf(0, TAU), rr = rf(r * 0.85, r * 1.5);
      this.pAlpha.spawn({
        x: x + Math.cos(a) * rr, y: gy + rf(0.6, 3.2), z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * rf(2, 7), vy: rf(2.4, 5.4), vz: Math.sin(a) * rf(2, 7),
        life: rf(0.9, 1.8), size: rf(1.1, 2.1), sizeEnd: rf(2.8, 4.6),
        col: 0x3a2f24, alpha: rf(0.34, 0.55), sprite: A_SOOT, drag: 2.6, glow: 1, fadePow: 1.4,
      });
    }
  }

  // -------------------------------------------------------------- lifecycle --
  resetAll() {
    this.pAdd.clear(); this.pAlpha.clear();
    this.arcs.clear(); this.ringPool.clear(); this.decalPool.clear();
    this.telePool.clear(); this.beamPool.clear();
    this.debris.clear(); this.ghostPool.clear(); this.trailBank.clear();
    for (const p of this.projs) p.active = false;
    this.projGeo.instanceCount = 0;
    this.projMesh.visible = false;
    this.trauma = 0; this.kick = 0;
    this.dash.on = false; this.dash.last = -99;
    if (this.grade) this.grade.uFlash.value = 0;
  }

  update(dt) {
    this.time += dt;
    this.pAdd.update(dt);
    this.pAlpha.update(dt);
    this.arcs.update(dt);
    this.ringPool.update(dt);
    this.decalPool.update(dt);
    this.telePool.update(dt);
    this.beamPool.update(dt, this._onBeamFire);
    this.debris.update(dt);
    this.ghostPool.update(dt);
    this.trailBank.update(dt);

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
          this.pAdd.spawn({
            x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0.25, vz: 0,
            life: 0.3, size: p.size * 1.5, sizeEnd: 0.01, col: p.col, colEnd: 0xffffff,
            gravity: 0, drag: 0.6, sprite: S_DOT, glow: 1.3, alpha: 0.7, fadePow: 1.6,
          });
          if (Math.random() < 0.5) {
            this.pAdd.spawn({
              x: p.pos.x, y: p.pos.y, z: p.pos.z,
              vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2,
              dirX: p.dx, dirY: p.dy, dirZ: p.dz,
              life: 0.24, size: p.size * 0.6, sizeEnd: 0.01, col: 0xffffff,
              gravity: 0, drag: 1.5, sprite: S_STREAK, glow: 1.4, alpha: 0.5, stretch: 3.5,
            });
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
