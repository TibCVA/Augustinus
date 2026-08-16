// Geometry builders: tower, nexus, tree, statue, column, crystal, torch, banner…
// Everything is built from primitives with chunky stylized proportions, vertex-
// tinted (AO + moss + hue jitter) and merged into per-material static buckets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mats, tex, uTime, uSunDir, PAL, cpuNoise } from '../core/assets.js';
import { RNG, hash2 } from '../core/rng.js';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// --------------------------------------------------------- geometry helpers --
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sy = null, sz = null) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), _q.clone(),
    new THREE.Vector3(s, sy ?? s, sz ?? sy ?? s));
}

// Chamfered box: base sits at y=0, height h.
export function chamferBox(w, h, d, c = 0.08) {
  c = Math.min(c, w / 3, h / 3, d / 3);
  const shape = new THREE.Shape();
  const hw = w / 2 - c, hd = d / 2 - c;
  shape.moveTo(-hw, -hd); shape.lineTo(hw, -hd); shape.lineTo(hw, hd); shape.lineTo(-hw, hd);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, c, 0); // base sits at y=0, top at y=h
  boxUV(g, 0.35);
  g.computeVertexNormals();
  return g;
}

// Lathe from [r, y] pairs. Base assumed lowest y in profile.
export function lathe(profile, seg = 10, flat = false) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y));
  const g = new THREE.LatheGeometry(pts, seg);
  boxUV(g, 0.4);
  const ni = g.toNonIndexed();
  if (flat) ni.computeVertexNormals();
  return ni;
}

// Box-projected UVs (tri-planar by dominant normal axis).
export function boxUV(geo, scale = 0.35) {
  geo.computeVertexNormals?.();
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = pos.getX(i); v = pos.getZ(i); }
    else if (nx >= nz) { u = pos.getZ(i); v = pos.getY(i); }
    else { u = pos.getX(i); v = pos.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Replace zero-length normals (degenerate tris) with up — they would produce
// NaN in lighting, and one NaN pixel poisons the whole bloom chain.
export function fixNormals(geo) {
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    const l2 = x * x + y * y + z * z;
    if (!(l2 > 1e-8) || !isFinite(l2)) n.setXYZ(i, 0, 1, 0);
  }
  return geo;
}

// Radial "puff" normals: makes low-poly canopy blobs read soft, not faceted.
// `mix` < 1 keeps some of the faceted normal, which is what stops a canopy blob
// from shading as a perfect sphere with a texture pasted on it.
export function puffNormals(geo, mix = 1) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    let nx = x / l, ny = y / l, nz = z / l;
    if (mix < 1) {
      const k = 1 - mix;
      nx = nx * mix + nor.getX(i) * k;
      ny = ny * mix + nor.getY(i) * k;
      nz = nz * mix + nor.getZ(i) * k;
      const m = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= m; ny /= m; nz /= m;
    }
    nor.setXYZ(i, nx, ny, nz);
  }
  return geo;
}

export function jitterGeo(geo, amt, rng = RNG, ymul = 1) {
  const pos = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = seen.get(key);
    if (!o) { o = [rng.spread(amt), rng.spread(amt * ymul), rng.spread(amt)]; seen.set(key, o); }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

// Per-vertex painterly tint: base color w/ hue jitter, moss on up-facing,
// AO darkening near local y=aoY0.
export function bakeTint(geo, {
  base = 0xffffff, jitter = 0.06, moss = 0, mossColor = PAL.moss,
  ao = 0.35, aoY0 = 0, aoY1 = 0.8, topLight = 0.1,
} = {}) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const cBase = new THREE.Color(base), cMoss = new THREE.Color(mossColor);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = hash2((x * 37.7) | 0, (z * 41.3 + y * 13.7) | 0);
    _c.copy(cBase).multiplyScalar(1 - jitter + h * jitter * 2);
    const ny = nor.getY(i);
    if (moss > 0 && ny > 0.45) {
      const m = moss * (ny - 0.45) * 1.8 * (0.4 + 0.6 * cpuNoise.fbm(x * 0.6 + 7, z * 0.6, 3));
      _c.lerp(cMoss, Math.min(m, 0.85));
    }
    if (topLight > 0 && ny > 0.3) _c.multiplyScalar(1 + topLight * ny);
    if (ao > 0) {
      const t = THREE.MathUtils.clamp((y - aoY0) / Math.max(aoY1 - aoY0, 0.001), 0, 1);
      _c.multiplyScalar(1 - ao * (1 - t * t));
    }
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function ensureAttrs(geo) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) {
    const c = new Float32Array(n * 3); c.fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (!geo.attributes.aSway) geo.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  // drop anything else so merge succeeds
  for (const k of Object.keys(geo.attributes))
    if (!['position', 'normal', 'uv', 'color', 'aSway'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

export function setSway(geo, v) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n);
  if (typeof v === 'function') {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < n; i++) a[i] = v(pos.getX(i), pos.getY(i), pos.getZ(i), uv ? uv.getY(i) : 0);
  } else a.fill(v);
  geo.setAttribute('aSway', new THREE.BufferAttribute(a, 1));
  return geo;
}

// ----------------------------------------------------------- foliage cards --
// Alpha-tested cutout cards. The crown blobs are opaque icosahedra, so however
// many of them you stack the outline stays a smooth mathematical curve. These
// break it: a ragged alpha edge riding the crown surface, reading at both the
// overview pitch and the near river/base framing.
//
// tex.leaf is a 2x2 atlas — 0 dense clump, 1 open lacy clump, 2 twig sprig,
// 3 blade tuft (trunk skirt / bush fringe).
const _UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const LEAF_INSET = 0.006;

function leafUV(cell) {
  const cx = cell & 1, cy = (cell >> 1) & 1;              // cy 0 = TOP canvas row
  return [
    cx * 0.5 + LEAF_INSET, (cx + 1) * 0.5 - LEAF_INSET,   // u0, u1
    1 - (cy + 1) * 0.5 + LEAF_INSET, 1 - cy * 0.5 - LEAF_INSET, // v0, v1
  ];
}

// Crossed quad pair. Local +Y is the growth direction; pivot sits `base` of the
// way down so the card can be planted on a surface and stick outward from it.
// Both windings are emitted with a single +Y normal, which lets the material
// stay FrontSide: THREE flips the normal per gl_FrontFacing on DoubleSide, and
// on a crossed card that blackens roughly half the leaves.
export function leafCard(w, h, cell, spin = 0, base = -0.3) {
  const [u0, u1, v0, v1] = leafUV(cell);
  const hw = w * 0.5, y0 = h * base, y1 = h * (1 + base);
  const pos = [], uv = [], nor = [], idx = [];
  // Normals splay outward from the growth axis instead of all pointing +Y, so a
  // card shades like a rounded clump rather than a flat billboard, and the
  // specular term lands as a moving highlight across it rather than a flat
  // blown-out sheet.
  const K = 0.85, NL = Math.hypot(1, K);
  const push = (px, py, pz, pu, pv, sx, ca, sa) => {
    pos.push(px, py, pz); uv.push(pu, pv);
    nor.push(sx * ca * K / NL, 1 / NL, sx * sa * K / NL);
  };
  for (let k = 0; k < 2; k++) {
    const a = spin + k * Math.PI * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    const o = pos.length / 3;
    push(-hw * ca, y0, -hw * sa, u0, v0, -1, ca, sa);
    push(hw * ca, y0, hw * sa, u1, v0, 1, ca, sa);
    push(hw * ca, y1, hw * sa, u1, v1, 1, ca, sa);
    push(-hw * ca, y1, -hw * sa, u0, v1, -1, ca, sa);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3,   // front winding
      o, o + 2, o + 1, o, o + 3, o + 2);         // back winding, same normal
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// Matrix that rotates local +Y onto `dir`.
export function alignY(x, y, z, dx, dy, dz, s = 1) {
  _dir.set(dx, dy, dz);
  if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
  _dir.normalize();
  _qa.setFromUnitVectors(_UP, _dir);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), _qa.clone(), new THREE.Vector3(s, s, s));
}

// ------------------------------------------------------------------ bucket --
export class Bucket {
  constructor() { this.byMat = new Map(); }
  add(geo, matName, matrix, tint) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g === geo) g = geo.clone();
    if (tint) bakeTint(g, tint);
    ensureAttrs(g);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.byMat.has(matName)) this.byMat.set(matName, []);
    this.byMat.get(matName).push(g);
    return g;
  }
  build(parent, { shadows = [] } = {}) {
    const meshes = {};
    for (const [name, list] of this.byMat) {
      const merged = mergeGeometries(list, false);
      fixNormals(merged);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mats[name]);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = true;
      if (shadows.includes(name)) mesh.castShadow = true;
      parent.add(mesh);
      meshes[name] = mesh;
      for (const g of list) g.dispose?.();
    }
    return meshes;
  }
}

// ================================================================= BUILDERS ==
// All add* functions push into a Bucket at world position.

const STONE_TINT = { base: 0xe8dfcc, jitter: 0.09, moss: 0.42, ao: 0.28, aoY0: 0, aoY1: 1.1 };

export function addColumn(b, x, z, { h = 3.4, broken = 0, r = 0.42, ry = 0 } = {}) {
  const rng = RNG;
  const m = (dy = 0, rr = 0) => mat4(x, dy, z, 0, ry + rr);
  b.add(chamferBox(r * 3, 0.42, r * 3, 0.1), 'stoneProp', m(), { ...STONE_TINT, ao: 0.5, aoY1: 0.5 });
  const H = h * (broken ? rng.f(0.35, 0.62) : 1);
  const prof = [];
  const rings = 7;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    let rr = r * (1.06 - t * 0.16) * (1 + Math.sin(t * 19) * 0.03);
    prof.push([rr, 0.42 + t * H]);
  }
  const shaft = lathe(prof, 11);
  if (broken) jitterGeo(shaft, 0.05, rng);
  b.add(shaft, 'stoneProp', m(), { ...STONE_TINT, aoY1: 1.6 });
  if (!broken) {
    b.add(chamferBox(r * 2.9, 0.3, r * 2.9, 0.08), 'stoneProp', m(0.42 + H), STONE_TINT);
    b.add(chamferBox(r * 3.3, 0.22, r * 3.3, 0.08), 'stoneProp', m(0.72 + H), { ...STONE_TINT, moss: 0.8 });
  } else {
    // fallen chunk
    const chunk = lathe([[r * 0.9, 0], [r * 1.02, 0.5], [r * 0.7, 0.9]], 9);
    jitterGeo(chunk, 0.06, rng);
    b.add(chunk, 'stoneProp', mat4(x + rng.spread(1.4), 0.05, z + rng.spread(1.2), rng.f(2.6, 3.4), rng.f(6.28), 0.4), STONE_TINT);
  }
  return { x, z, r: r * 1.7 };
}

export function addRock(b, x, z, s = 1, opts = {}) {
  const g = new THREE.IcosahedronGeometry(s, 1);
  jitterGeo(g, s * 0.22, RNG);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) * 0.72;
    if (y < -s * 0.1) y = -s * 0.1; // flatten bottom
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  boxUV(g, 0.4);
  b.add(g, opts.mat || 'stoneProp', mat4(x, s * 0.08 + (opts.y || 0), z, 0, RNG.f(6.28)),
    { base: 0xcfc8b6, jitter: 0.12, moss: 0.75, ao: 0.45, aoY0: -s, aoY1: s * 0.5 });
  return { x, z, r: s * 0.9 };
}

export function addTree(b, x, z, s = 1, { pink = true, ry = RNG.f(6.28) } = {}) {
  const rng = RNG;
  const lean = rng.spread(0.09);

  // ---- species / hue roll -------------------------------------------------
  // arena.js hands every tree `pink: true`; a rail of ~25 identical magenta
  // pom-poms is the overview's loudest tell. Roll a stable per-position variant
  // here so the grove has coral / magenta / cream / green in it.
  const hA = hash2(Math.round(x * 8.7), Math.round(z * 12.3));
  const hB = hash2(Math.round(z * 5.1) + 91, Math.round(x * 9.9) - 17);
  let kind = pink ? 'pink' : 'green';
  if (pink) { if (hA < 0.14) kind = 'white'; else if (hA < 0.25) kind = 'green'; }
  const green = kind === 'green';
  const matName = green ? 'canopyGreen' : 'canopyPink';
  const cCrown = new THREE.Color(
    green ? 0x7fae54 : kind === 'white' ? 0xffe7e2 : 0xffb2c6);
  if (kind === 'pink') cCrown.offsetHSL((hB - 0.5) * 0.115, -hA * 0.32, (hB - 0.5) * 0.15);
  if (green) cCrown.offsetHSL((hB - 0.5) * 0.05, 0, (hB - 0.5) * 0.1);
  const crownHex = cCrown.getHex();
  const cardBase = (k = 1) => cCrown.clone().multiplyScalar(0.85 * k);

  // ---- trunk: real root flare, not a cylinder punched into the grass ------
  const trunk = lathe([
    [0.94, 0], [0.68, 0.13], [0.46, 0.38], [0.31, 1.0], [0.23, 1.9],
    [0.27, 2.45], [0.07, 2.9],
  ], 10);
  jitterGeo(trunk, 0.05, rng);
  b.add(trunk, 'bark', mat4(x, -0.06, z, lean, ry, lean * 0.7, s),
    { base: 0xa78a68, jitter: 0.15, ao: 0.5, aoY1: 1.1 });
  // splayed root spurs that run out along the ground instead of stopping dead
  const ROOTS = 6;
  for (let i = 0; i < ROOTS; i++) {
    const a = (i / ROOTS) * Math.PI * 2 + rng.f(0.55);
    const len = rng.f(0.9, 1.5);
    const root = new THREE.ConeGeometry(rng.f(0.15, 0.23), len, 5);
    root.translate(0, len * 0.36, 0);
    root.rotateZ(1.32 + rng.spread(0.14));
    root.scale(1, 1, 0.62);                       // flatten against the ground
    b.add(root, 'bark', mat4(x + Math.cos(a) * 0.34 * s, -0.02, z + Math.sin(a) * 0.34 * s, 0, -a, 0, s),
      { base: 0x977c5e, jitter: 0.16, moss: 0.5, ao: 0.45, aoY1: 0.5 });
  }

  // ---- branches ------------------------------------------------------------
  // Two of these deliberately overshoot the crown radius: a bare tip crossing
  // the sky is the cheapest hard break in a blossom outline.
  const tops = [];
  const tips = [];
  const BR = 5;
  // one tapered cylinder from (px,py,pz) heading out along azimuth `a` at
  // `pitch` from vertical; returns the far end
  const limb = (px, py, pz, a, pitch, len, r0, r1, tint) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 5);
    g.translate(0, len * 0.5, 0); g.rotateZ(pitch); g.rotateY(-a);
    b.add(g, 'bark', mat4(px, py, pz, 0, 0, 0, s), tint);
    const rad = Math.sin(pitch) * len * s;
    return [px + Math.cos(a) * rad, py + Math.cos(pitch) * len * s, pz + Math.sin(a) * rad];
  };
  for (let i = 0; i < BR; i++) {
    const a = (i / BR) * Math.PI * 2 + rng.f(0.8);
    if (i < 2) {
      // Long climbing twig whose bare tip clears the TOP of the crown against
      // sky. Built in two bending segments and tinted light: a dead-straight
      // dark pin reads as a TV aerial at the overview pitch.
      const L = rng.f(2.3, 2.95);
      const p0 = rng.f(0.5, 0.74), p1 = p0 - rng.f(0.24, 0.42);
      const l0 = L * 0.58, l1 = L * 0.42;
      const e0 = limb(x, 2.5 * s, z, a, p0, l0, 0.055, 0.12,
        { base: 0xc0a37e, jitter: 0.2, ao: 0.14 });
      const e1 = limb(e0[0], e0[1], e0[2], a, p1, l1, 0.022, 0.055,
        { base: 0xd0b891, jitter: 0.22, ao: 0 });
      tips.push([e0, e1, Math.cos(a), Math.sin(a)]);
    } else {
      // spread the pitch hard: equal-pitch branches put every blob at the same
      // height and the crown reads as a pancake instead of a dome
      const len = rng.f(1.0, 1.7), pitch = rng.f(0.52, 1.22);
      const e = limb(x, 2.5 * s, z, a, pitch, len, 0.04, 0.11,
        { base: 0x9c8161, jitter: 0.18, ao: 0.2 });
      tops.push([e[0], e[1] + 0.2 * s, e[2]]);
    }
  }
  tops.push([x, 3.3 * s, z]);
  tops.push([x + rng.spread(0.3) * s, 4.0 * s, z + rng.spread(0.3) * s]);   // apex

  // ---- canopy blobs (shrunk ~12% so the cards read as the outer surface) ---
  const cTint = green
    ? { base: crownHex, jitter: 0.18, ao: 0.52, aoY0: -1.2, aoY1: 1.1, topLight: 0.26 }
    : { base: crownHex, jitter: 0.18, ao: 0.54, aoY0: -1.5, aoY1: 1.3, topLight: 0.42, mossColor: 0xb0507e };
  // Per-blob value offset. Lighting alone cannot separate blobs that all share
  // one flat albedo — this is what makes a crown read as stacked clumps rather
  // than one pink mass, and unlike texture detail it survives any minification.
  const shade = (k) => cCrown.clone().multiplyScalar(k);
  const shells = [];
  // Height range the blobs will span, so their value can follow it instead of
  // being rolled at random — a random spread is evenly noisy and reads flat.
  let tLo = Infinity, tHi = -Infinity;
  for (const t of tops) { tLo = Math.min(tLo, t[1]); tHi = Math.max(tHi, t[1]); }
  const tSpan = Math.max(tHi - tLo, 0.001);
  const blobCount = 5 + (s > 1.1 ? 2 : 0);
  for (let i = 0; i < blobCount; i++) {
    const t = tops[i % tops.length];
    const bs = rng.f(0.7, 1.35) * s * 0.88;
    const g = new THREE.IcosahedronGeometry(bs, 2);
    jitterGeo(g, bs * 0.19, rng);
    // per-blob squash/stretch: a crown should read as one sculpted mass, not
    // a stack of identical spheres
    const kx = rng.f(1.12, 1.46), ky = rng.f(0.72, 1.02), kz = rng.f(1.08, 1.42);
    g.scale(kx, ky, kz);
    puffNormals(g, 0.66);
    setSway(g, 0.35 + rng.f(0.5));
    const cx = t[0] + rng.spread(0.42), cy = t[1] + rng.f(-0.1, 0.4), cz = t[2] + rng.spread(0.42);
    // blobs riding high on the crown catch the sun; inner/low ones sit in shade
    const high = t[1] > 2.7 * s ? 1 : 0;
    b.add(g, matName, mat4(cx, cy, cz, rng.spread(0.16), rng.f(6.28), rng.spread(0.16)),
      {
        ...cTint,
        base: shade(rng.f(0.92, 1.06) * (0.60 + 0.58 * Math.min(1, Math.max(0, (cy - tLo) / tSpan)))),
        topLight: cTint.topLight + high * 0.24, ao: cTint.ao - high * 0.12,
      });
    shells.push([cx, cy, cz, bs * Math.max(kx, kz) * 0.94, bs * ky, high]);
  }
  // small outlier tufts so the crown silhouette isn't a clean bubble outline
  for (let i = 0; i < 3; i++) {
    const t = tops[(i * 2 + 1) % tops.length];
    const bs = rng.f(0.3, 0.56) * s;
    const g = new THREE.IcosahedronGeometry(bs, 1);
    jitterGeo(g, bs * 0.28, rng);
    g.scale(1.35, 0.78, 1.2);
    puffNormals(g, 0.6);
    setSway(g, 0.8 + rng.f(0.5));
    const cx = t[0] + rng.spread(1.4) * s, cy = t[1] + rng.f(-0.45, 0.75) * s, cz = t[2] + rng.spread(1.4) * s;
    b.add(g, matName, mat4(cx, cy, cz, 0, rng.f(6.28)),
      { ...cTint, base: shade(rng.f(0.95, 1.22)), topLight: cTint.topLight + 0.26 });
    shells.push([cx, cy, cz, bs * 1.3, bs * 0.78, 1]);
  }

  // ---- alpha-cutout cards on the crown surface ----------------------------
  let ccx = 0, ccy = 0, ccz = 0;
  for (const sh of shells) { ccx += sh[0]; ccy += sh[1]; ccz += sh[2]; }
  ccx /= shells.length; ccy /= shells.length; ccz /= shells.length;

  // Vertical extent of the whole crown. Card value is driven by height within
  // it, not by a per-card random: a random spread gives an evenly noisy mass,
  // which is why the crown still read as one flat saturated colour with no lit
  // side and no shadow side. A sunlit top and a deep underside is what makes a
  // canopy read as a volume.
  let crownLo = Infinity, crownHi = -Infinity;
  for (const sh of shells) {
    crownLo = Math.min(crownLo, sh[1] - sh[4]);
    crownHi = Math.max(crownHi, sh[1] + sh[4]);
  }
  const crownSpan = Math.max(crownHi - crownLo, 0.001);

  const cards = 16 + (s > 1.1 ? 4 : 0);
  for (let i = 0; i < cards; i++) {
    const sh = shells[i % shells.length];
    let dx, dy, dz;
    if (i % 3 === 2) {                             // up: breaks the overview outline
      const a = rng.f(6.28), ty = rng.f(0.42, 0.98), rr = Math.sqrt(1 - ty * ty);
      dx = Math.cos(a) * rr; dy = ty; dz = Math.sin(a) * rr;
    } else {                                       // out: breaks the river/base outline
      const a = rng.f(6.28);
      dy = rng.f(-0.3, 0.4);
      const rr = Math.sqrt(Math.max(0.04, 1 - dy * dy));
      dx = Math.cos(a) * rr; dz = Math.sin(a) * rr;
    }
    // bias away from the crown centroid so cards land on the actual silhouette
    dx += (sh[0] - ccx) * 0.55 / s; dy += (sh[1] - ccy) * 0.45 / s; dz += (sh[2] - ccz) * 0.55 / s;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    // shells: [cx, cy, cz, horizontal radius, vertical radius, sunlit]
    const px = sh[0] + dx * sh[3] * 0.9;
    const py = sh[1] + dy * sh[4] * 0.9;
    const pz = sh[2] + dz * sh[3] * 0.9;
    const cell = i % 5 === 4 ? 2 : i % 2;
    const w = rng.f(0.78, 1.45) * s, h = rng.f(0.66, 1.2) * s;
    const g = leafCard(w, h, cell, rng.f(3.14), -0.3);
    setSway(g, 0.85 + rng.f(0.7));
    // hT 0 at the crown's underside, 1 at its top; the card's own facing adds a
    // little on top so upward-tilted cards catch more than side-on ones.
    const hT = Math.min(1, Math.max(0, (py - crownLo) / crownSpan));
    const face = 0.94 + 0.14 * Math.max(dy, 0);
    b.add(g, 'canopyCard', alignY(px, py, pz, dx, dy, dz), {
      base: cardBase(rng.f(0.9, 1.08) * (0.58 + 0.66 * hT * hT) * face),
      jitter: 0.14, ao: 0.5, aoY0: -h * 0.34, aoY1: h * 0.5,
      topLight: (sh[5] ? 0.10 : 0.02) + 0.26 * hT,
    });
  }
  // drooping sprigs under the crown — the river camera looks up into these
  for (let i = 0; i < 4; i++) {
    const sh = shells[(i * 3 + 1) % shells.length];
    const a = rng.f(6.28);
    const dxs = Math.cos(a) * 0.55, dzs = Math.sin(a) * 0.55, dys = -0.82;
    const g = leafCard(rng.f(0.6, 1.0) * s, rng.f(0.9, 1.55) * s, 2, rng.f(3.14), -0.12);
    setSway(g, 1.35 + rng.f(0.8));
    b.add(g, 'canopyCard',
      alignY(sh[0] + dxs * sh[3] * 0.8, sh[1] - sh[4] * 0.72, sh[2] + dzs * sh[3] * 0.8, dxs, dys, dzs),
      { base: cardBase(rng.f(0.78, 1.05)), jitter: 0.16, ao: 0.42, aoY0: 0, aoY1: s * 0.8, topLight: 0 });
  }
  // blossom sprigs at the elbow and low on the outer twig; the last ~45% of the
  // twig stays bare so a hard woody tip crosses the sky
  for (const [e0, e1, ca, sa] of tips) {
    for (let k = 0; k < 2; k++) {
      const t = k ? 0.42 : 0.72;
      const bx = e0[0] + (e1[0] - e0[0]) * (k ? t : 0) + (k ? 0 : (e0[0] - x) * (t - 1));
      const by = k ? e0[1] + (e1[1] - e0[1]) * t : 2.5 * s + (e0[1] - 2.5 * s) * t;
      const bz = e0[2] + (e1[2] - e0[2]) * (k ? t : 0) + (k ? 0 : (e0[2] - z) * (t - 1));
      const g = leafCard(rng.f(0.55, 0.95) * s, rng.f(0.55, 0.95) * s, k ? 2 : 1, rng.f(3.14), -0.24);
      setSway(g, 1.5 + rng.f(0.6));
      b.add(g, 'canopyCard', alignY(bx, by, bz, ca * 0.55, 0.7, sa * 0.55),
        { base: cardBase(rng.f(0.9, 1.15)), jitter: 0.16, ao: 0.3, aoY0: -0.2, aoY1: 0.5, topLight: 0.1 });
    }
  }

  // ---- ground skirt: grass + root litter where the trunk meets the terrain -
  const skirt = 9 + (s > 1.15 ? 3 : 0);
  for (let i = 0; i < skirt; i++) {
    const a = (i / skirt) * Math.PI * 2 + rng.f(0.6);
    const rr = rng.f(0.42, 1.5) * s;
    const tilt = rng.f(0.1, 0.42);
    const g = leafCard(rng.f(0.6, 1.1) * s, rng.f(0.4, 0.78) * s, 3, rng.f(3.14), 0);
    setSway(g, 0.28 + rng.f(0.3));
    b.add(g, 'canopyCard',
      alignY(x + Math.cos(a) * rr, -0.07, z + Math.sin(a) * rr,
        Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      { base: rng.chance(0.72) ? 0x74a04a : cardBase(0.85), jitter: 0.2, ao: 0.55, aoY0: 0, aoY1: 0.5 * s, topLight: 0.2 });
  }
  return { x, z, r: 0.7 * s };
}

export function addBush(b, x, z, s = 1) {
  const rng = RNG;
  const g = new THREE.IcosahedronGeometry(s * 0.7, 2);
  jitterGeo(g, s * 0.13, rng);
  g.scale(1.35, 0.72, 1.35);
  puffNormals(g, 0.7);
  setSway(g, 0.3);
  b.add(g, 'canopyGreen', mat4(x, s * 0.36, z, 0, rng.f(6.28)),
    { base: 0x74a84e, jitter: 0.16, ao: 0.5, aoY0: -s * 0.6, aoY1: s * 0.4, topLight: 0.25 });
  // cutout fringe so the bush isn't a smooth squashed sphere either
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.f(1.1);
    const up = rng.f(0.15, 0.85);
    const rr = Math.sqrt(Math.max(0.05, 1 - up * up));
    const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
    const card = leafCard(rng.f(0.5, 0.95) * s, rng.f(0.45, 0.8) * s, rng.chance(0.55) ? 3 : 1, rng.f(3.14), -0.3);
    setSway(card, 0.55 + rng.f(0.5));
    b.add(card, 'canopyCard',
      alignY(x + dx * s * 0.85, s * 0.36 + up * s * 0.4, z + dz * s * 0.85, dx, up, dz),
      { base: 0x7fb050, jitter: 0.2, ao: 0.45, aoY0: -s * 0.2, aoY1: s * 0.4, topLight: 0.2 });
  }
  return { x, z, r: s * 0.8 };
}

export function addCrystals(b, x, z, s = 1, { red = false, n = 4 } = {}) {
  const rng = RNG;
  addRock(b, x, z, s * 0.7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.f(1);
    const cs = s * rng.f(0.3, 0.72);
    const g = new THREE.OctahedronGeometry(cs, 0);
    g.scale(0.55, 2.1, 0.55);
    g.translate(0, cs * 1.4, 0);
    b.add(g, red ? 'crystalRed' : 'crystal',
      mat4(x + Math.cos(a) * s * 0.42, s * 0.2, z + Math.sin(a) * s * 0.42,
        rng.f(0.15, 0.5) * Math.sin(a), a, rng.f(0.15, 0.5) * Math.cos(a)),
      { base: 0xffffff, jitter: 0.3, ao: 0.4, aoY0: 0, aoY1: cs * 2.2 });
  }
  return { x, z, r: s * 0.75 };
}

export function addStatue(b, x, z, { ry = 0, s = 1, broken = false } = {}) {
  const m = (dy = 0) => mat4(x, dy * s, z, 0, ry, 0, s);
  b.add(chamferBox(1.5, 0.35, 1.5, 0.09), 'stoneProp', m(0), { ...STONE_TINT, ao: 0.5 });
  b.add(chamferBox(1.2, 0.3, 1.2, 0.08), 'stoneProp', m(0.35), STONE_TINT);
  // robed body
  const body = lathe([[0.52, 0.6], [0.46, 0.9], [0.3, 1.5], [0.36, 1.9], [0.3, 2.15]], 9);
  b.add(body, 'stoneProp', m(0), { ...STONE_TINT, aoY1: 1.4 });
  // arms holding sword hilt at front
  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.09, 0.11, 0.72, 6);
    arm.translate(0, -0.3, 0);
    arm.rotateX(0.95); arm.rotateY(side * 0.5);
    b.add(arm, 'stoneProp', mat4(x + Math.sin(ry + side * 0.45) * 0.3 * s, 1.95 * s, z + Math.cos(ry + side * 0.45) * 0.3 * s, 0, ry, 0, s), STONE_TINT);
  }
  // sword point-down in front
  const blade = chamferBox(0.16, 1.35, 0.05, 0.02);
  b.add(blade, 'stoneProp', mat4(x + Math.sin(ry) * 0.62 * s, 0.42 * s, z + Math.cos(ry) * 0.62 * s, 0, ry, 0, s), STONE_TINT);
  b.add(chamferBox(0.42, 0.09, 0.09, 0.02), 'stoneProp', mat4(x + Math.sin(ry) * 0.62 * s, 1.68 * s, z + Math.cos(ry) * 0.62 * s, 0, ry, 0, s), STONE_TINT);
  if (!broken) {
    // hooded head + gold halo ring
    const head = new THREE.SphereGeometry(0.24, 10, 8);
    b.add(head, 'stoneProp', m(2.28), STONE_TINT);
    const hood = lathe([[0.3, 0], [0.34, 0.22], [0.1, 0.52]], 8);
    b.add(hood, 'stoneProp', m(2.16), { ...STONE_TINT, moss: 0.7 });
    const halo = new THREE.TorusGeometry(0.34, 0.035, 6, 20);
    b.add(halo, 'trim', mat4(x - Math.sin(ry) * 0.12 * s, 2.5 * s, z - Math.cos(ry) * 0.12 * s, 0, ry, 0, s), { base: 0xffe2a0, ao: 0 });
  } else {
    const stump = lathe([[0.26, 0], [0.3, 0.14], [0.12, 0.3]], 7);
    jitterGeo(stump, 0.05, RNG);
    b.add(stump, 'stoneProp', m(2.1), STONE_TINT);
  }
  return { x, z, r: 0.85 * s };
}

export function addTorch(b, x, z, { s = 1, ry = 0 } = {}) {
  const pole = lathe([[0.1, 0], [0.055, 0.2], [0.05, 1.5], [0.09, 1.72]], 7);
  b.add(pole, 'stoneProp', mat4(x, 0, z, 0, ry, 0, s), { base: 0x9a9284, jitter: 0.08, ao: 0.4, aoY1: 0.7 });
  // crescent prong (gold)
  const prong = new THREE.TorusGeometry(0.24, 0.045, 6, 14, Math.PI * 1.25);
  prong.rotateZ(-Math.PI * 0.12);
  b.add(prong, 'trim', mat4(x, 1.85 * s, z, 0, ry), { base: 0xffdf9e, ao: 0 });
  const bowl = lathe([[0.05, 0], [0.16, 0.08], [0.13, 0.16]], 8);
  b.add(bowl, 'trim', mat4(x, 1.68 * s, z), { base: 0xdfb26e, ao: 0.2 });
  return { flame: [x, 1.82 * s, z], blocker: { x, z, r: 0.28 } };
}

export function addBanner(b, x, z, team, { ry = 0, s = 1 } = {}) {
  const m = (dy = 0) => mat4(x, dy * s, z, 0, ry, 0, s);
  b.add(lathe([[0.16, 0], [0.07, 0.25], [0.055, 3.2], [0.08, 3.3]], 7), 'stoneProp', m(0),
    { base: 0x8f8a7c, jitter: 0.06, ao: 0.4, aoY1: 0.8 });
  b.add(new THREE.SphereGeometry(0.11, 8, 6), 'trim', m(3.42), { base: 0xffe2a0, ao: 0 });
  const spike = new THREE.ConeGeometry(0.07, 0.35, 6);
  b.add(spike, 'trim', m(3.62), { base: 0xffe2a0, ao: 0 });
  // crossbar
  const bar = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6);
  bar.rotateZ(Math.PI / 2);
  b.add(bar, 'trim', m(3.18), { base: 0xe8bd76, ao: 0 });
  // cloth (sways)
  const cloth = new THREE.PlaneGeometry(0.95, 1.55, 5, 9);
  cloth.translate(0, -0.775 + 0, 0);
  setSway(cloth, (px, py) => Math.pow(THREE.MathUtils.clamp(-py / 1.55, 0, 1), 1.3) * 0.75);
  b.add(cloth, team === 'blue' ? 'clothBlue' : 'clothRed', m(3.14),
    { base: 0xffffff, jitter: 0.03, ao: 0.25, aoY0: -1.9, aoY1: -0.1 });
  return { x, z, r: 0.3 };
}

// Bridge rails + arches under the deck (deck itself is the lane drape).
export function addBridge(b, deckH, { halfW = 4.9, halfL = 6.2 } = {}) {
  // side rails: posts + low wall following the arch
  for (const side of [-1, 1]) {
    const zr = side * (halfW - 0.3);
    for (let i = 0; i <= 6; i++) {
      const px = -halfL + (i / 6) * halfL * 2;
      const y = deckH(px);
      b.add(chamferBox(0.34, 0.72, 0.34, 0.06), 'stoneProp', mat4(px, y - 0.06, zr),
        { ...STONE_TINT, aoY1: 0.4 });
      b.add(new THREE.SphereGeometry(0.13, 7, 6), 'trim', mat4(px, y + 0.72, zr), { base: 0xffe2a0, ao: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const x0 = -halfL + (i / 6) * halfL * 2, x1 = -halfL + ((i + 1) / 6) * halfL * 2;
      const xm = (x0 + x1) / 2, y = (deckH(x0) + deckH(x1)) / 2;
      const wall = chamferBox(x1 - x0 - 0.3, 0.42, 0.16, 0.05);
      const tilt = Math.atan2(deckH(x1) - deckH(x0), x1 - x0);
      b.add(wall, 'stoneProp', mat4(xm, y + 0.1, zr, 0, 0, tilt), STONE_TINT);
    }
    // proper arch wall under the deck (annular segment, visible from river)
    {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 3.7, Math.PI, 0, true);
      shape.lineTo(2.5, 0);
      shape.absarc(0, 0, 2.5, 0, Math.PI, false);
      shape.closePath();
      const arch = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
      boxUV(arch, 0.35);
      b.add(arch, 'stoneProp', mat4(0, -2.75, zr - 0.2 + side * 0.0, 0, 0, 0), { ...STONE_TINT, ao: 0.15, aoY0: -2.6, aoY1: 0.4 });
    }
    // deck fascia boards (hide the paper-thin deck edge from low angles)
    for (let i = 0; i < 6; i++) {
      const x0 = -halfL + (i / 6) * halfL * 2, x1 = -halfL + ((i + 1) / 6) * halfL * 2;
      const xm = (x0 + x1) / 2, y = (deckH(x0) + deckH(x1)) / 2;
      const tilt = Math.atan2(deckH(x1) - deckH(x0), x1 - x0);
      b.add(chamferBox(x1 - x0 + 0.05, 0.5, 0.18, 0.04), 'stoneProp', mat4(xm, y - 0.52, zr + side * 0.05, 0, 0, tilt), { ...STONE_TINT, ao: 0.3, aoY0: 0, aoY1: 0.5 });
    }
  }
  // piers
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(chamferBox(1.1, 2.4, 0.9, 0.1), 'stoneProp', mat4(sx * (halfL - 0.9), -2.2, sz * (halfW - 0.25)),
      { ...STONE_TINT, ao: 0.15 });
  }
}

export function addGateRuins(b, x, { s = 1 } = {}) {
  const blockers = [];
  for (const sz of [-1, 1]) {
    blockers.push(addColumn(b, x, sz * 7.6, { h: 4.6, r: 0.55, broken: sz > 0 }));
  }
  // floating cracked arc pieces (elven magic)
  for (let i = 0; i < 3; i++) {
    const t = (i - 1) / 1.6;
    const g = chamferBox(0.9 - Math.abs(t) * 0.2, 0.55, 0.7, 0.08);
    setSway(g, -0.5 - RNG.f(0.5));
    b.add(g, 'stoneFloat', mat4(x + RNG.spread(0.4), 5.6 + Math.abs(t) * -0.8 + RNG.f(0.4), t * 5.4, RNG.spread(0.3), RNG.spread(0.5), RNG.spread(0.25)),
      { ...STONE_TINT, ao: 0.15 });
  }
  return blockers;
}

export function addFountain(b, x, team) {
  const dir = Math.sign(-x) || 1; // faces arena center
  const blockers = [];
  b.add(lathe([[2.4, 0], [2.2, 0.35], [1.75, 0.5], [1.62, 0.75]], 12), 'stoneProp', mat4(x, 0, 0),
    { ...STONE_TINT, ao: 0.3 });
  const pool = new THREE.CylinderGeometry(1.45, 1.45, 0.16, 12);
  b.add(pool, 'pool', mat4(x, 0.72, 0), { base: 0xffffff, jitter: 0.12, ao: 0 });
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i - 1) * 0.85; // arc behind
    const px = x - dir * Math.cos((i - 1) * 0.85) * 2.9, pz = Math.sin((i - 1) * 0.85) * 2.9;
    blockers.push(addColumn(b, px, pz, { h: 3.1, r: 0.36 }));
  }
  // floating gold halo above the pool
  const halo = new THREE.TorusGeometry(1.7, 0.08, 6, 22);
  halo.rotateX(Math.PI / 2);
  const haloG = setSway(halo, -0.6);
  b.add(haloG, 'stoneFloat', mat4(x, 3.3, 0), { base: 0xffd98c, ao: 0 });
  const halo2 = new THREE.TorusGeometry(1.15, 0.05, 6, 18);
  halo2.rotateX(Math.PI / 2);
  b.add(setSway(halo2, -0.9), 'stoneFloat', mat4(x, 3.9, 0), { base: 0xffe9b0, ao: 0 });
  blockers.push({ x, z: 0, r: 1.2 });
  return blockers;
}

export function addRuneDecal(parent, list) {
  const geos = [];
  for (const [x, z, y, size] of list) {
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    geos.push(g.toNonIndexed());
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), mats.rune);
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

// ------------------------------------------------------------ tower & nexus --
export function buildTower(team) {
  const g = new THREE.Group();
  const bucket = new Bucket();
  const crystalMat = team === 'blue' ? 'crystal' : 'crystalRed';
  const stTint = { base: 0xf2e9d6, jitter: 0.08, moss: 0.32, ao: 0.22, aoY0: 0, aoY1: 2.2 };
  // tiered octagonal base
  bucket.add(lathe([[2.5, 0], [2.35, 0.5], [1.9, 0.62], [1.8, 1.05], [1.5, 1.15]], 8), 'stoneProp', mat4(0, 0, 0, 0, Math.PI / 8), stTint);
  // shaft with entasis
  bucket.add(lathe([[1.42, 1.1], [1.18, 2.2], [1.06, 4.2], [1.12, 5.3], [1.35, 5.7], [1.42, 6.1]], 8), 'stoneProp', mat4(0, 0, 0, 0, Math.PI / 8), { ...stTint, aoY1: 3 });
  // buttress fins
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = chamferBox(0.44, 2.6, 1.0, 0.07);
    bucket.add(fin, 'stoneProp', mat4(Math.cos(a) * 1.65, 0.4, Math.sin(a) * 1.65, 0, -a + Math.PI / 2), stTint);
    bucket.add(new THREE.SphereGeometry(0.16, 7, 5), 'trim', mat4(Math.cos(a) * 1.65, 3.1, Math.sin(a) * 1.65), { base: 0xffe2a0, ao: 0 });
  }
  // crown
  bucket.add(lathe([[1.5, 6.05], [1.95, 6.35], [2.0, 6.9], [1.7, 7.0]], 8), 'stoneProp', mat4(0, 0, 0, 0, Math.PI / 8), { ...stTint, ao: 0.15, moss: 0.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    bucket.add(chamferBox(0.42, 0.5, 0.3, 0.05), 'stoneProp', mat4(Math.cos(a) * 1.72, 6.98, Math.sin(a) * 1.72, 0, -a), stTint);
  }
  // gold rune band
  const band = new THREE.CylinderGeometry(1.24, 1.24, 0.5, 8, 1, true);
  bucket.add(band, 'trim', mat4(0, 5.05, 0, 0, Math.PI / 8), { base: 0xffd98c, ao: 0 });
  // claw prongs holding crystal
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = new THREE.TorusGeometry(0.72, 0.07, 5, 10, Math.PI * 0.6);
    prong.rotateZ(Math.PI * 0.22);
    bucket.add(prong, 'trim', mat4(Math.cos(a) * 0.5, 7.35, Math.sin(a) * 0.5, 0, -a + Math.PI / 2), { base: 0xffe2a0, ao: 0 });
  }
  // rubble (hidden until destroyed)
  const rubbleBucket = new Bucket();
  for (let i = 0; i < 7; i++) {
    const a = RNG.f(6.28), r = RNG.f(0.4, 1.9);
    const rock = new THREE.IcosahedronGeometry(RNG.f(0.35, 0.85), 0);
    jitterGeo(rock, 0.18, RNG);
    rubbleBucket.add(rock, 'stoneProp', mat4(Math.cos(a) * r, RNG.f(0.1, 0.45), Math.sin(a) * r, RNG.f(3), RNG.f(3)), stTint);
  }
  rubbleBucket.add(lathe([[1.9, 0], [1.6, 0.7], [1.2, 1.0], [1.3, 1.5]], 8).scale(1, 1, 1), 'stoneProp', mat4(0, 0, 0, 0, 0.4), stTint);

  const meshes = bucket.build(g, { shadows: ['stoneProp'] });
  const rubbleG = new THREE.Group();
  rubbleBucket.build(rubbleG, {});
  rubbleG.visible = false;
  g.add(rubbleG);
  // floating crystal (own mesh — pulses/spins)
  const cg = new THREE.OctahedronGeometry(0.62, 0);
  cg.scale(0.8, 1.7, 0.8);
  bakeTint(cg, { base: 0xffffff, ao: 0 });
  ensureAttrs(cg);
  const crystal = new THREE.Mesh(cg, mats[crystalMat]);
  crystal.position.y = 7.65;
  g.add(crystal);
  return { group: g, crystal, rubble: rubbleG, body: meshes, height: 7.6 };
}

export function buildNexusPlatform(bucket, x, team) {
  const tint = { base: 0xeae0cc, jitter: 0.08, moss: 0.32, ao: 0.24, aoY0: 0, aoY1: 1.2 };
  bucket.add(lathe([[5.2, 0], [4.9, 0.35], [4.2, 0.5], [4.0, 0.85], [3.2, 0.98], [3.05, 1.25]], 12), 'stoneProp', mat4(x, 0, 0, 0, Math.PI / 12), tint);
  // pylons
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = x + Math.cos(a) * 3.6, pz = Math.sin(a) * 3.6;
    const pylon = chamferBox(0.55, 3.4, 0.55, 0.09);
    bucket.add(pylon, 'stoneProp', mat4(px, 0.8, pz, Math.sin(a) * -0.22, 0, Math.cos(a) * 0.22), { ...tint, aoY1: 2 });
    bucket.add(new THREE.ConeGeometry(0.34, 0.6, 4), 'trim',
      mat4(px - Math.cos(a) * 0.74, 4.35, pz - Math.sin(a) * 0.74), { base: 0xffe2a0, ao: 0 });
  }
  // floating rune stones
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const st = chamferBox(0.5, 0.4, 0.42, 0.06);
    setSway(st, -0.4 - RNG.f(0.6));
    bucket.add(st, 'stoneFloat', mat4(x + Math.cos(a) * 4.6, 2.6 + RNG.f(1.2), Math.sin(a) * 4.6, RNG.spread(0.4), RNG.f(3), RNG.spread(0.4)), tint);
  }
}

export function buildNexusCrystal(team) {
  const g = new THREE.Group();
  const matName = team === 'blue' ? 'crystal' : 'crystalRed';
  const cg = new THREE.OctahedronGeometry(1.25, 0);
  cg.scale(0.85, 1.9, 0.85);
  const gg = cg.toNonIndexed();
  bakeTint(gg, { base: 0xe0f4ff, jitter: 0.3, ao: 0.25, aoY0: -2.4, aoY1: 1.8 });
  ensureAttrs(gg);
  const crystal = new THREE.Mesh(gg, mats[matName]);
  crystal.position.y = 4.1;
  crystal.castShadow = true;
  g.add(crystal);
  // shard satellites
  const shards = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const sg = new THREE.OctahedronGeometry(0.22, 0);
    sg.scale(0.7, 1.8, 0.7);
    const sTint = sg.toNonIndexed();
    bakeTint(sTint, { base: 0xffffff, ao: 0 });
    ensureAttrs(sTint);
    const sh = new THREE.Mesh(sTint, mats[matName]);
    const a = (i / 4) * Math.PI * 2;
    sh.position.set(Math.cos(a) * 2.1, 3.6 + Math.sin(i * 2.4) * 0.5, Math.sin(a) * 2.1);
    sh.userData.a = a;
    shards.add(sh);
  }
  g.add(shards);
  // gold orbit rings
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const rg = new THREE.TorusGeometry(1.9 + i * 0.55, 0.06, 5, 34);
    bakeTint(rg, { base: 0xffd98c, ao: 0 });
    const eg = rg.toNonIndexed(); ensureAttrs(eg);
    const ring = new THREE.Mesh(eg, mats.trim);
    ring.position.y = 4.1;
    ring.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.35);
    g.add(ring);
    rings.push(ring);
  }
  return { group: g, crystal, rings, shards };
}

// --------------------------------------------------------- instanced extras --
export function makeFlames(points) {
  const n = points.length;
  const quad = new THREE.PlaneGeometry(0.62, 0.86);
  quad.translate(0, 0.32, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) phase[i] = (i * 0.618) % 1;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const offs = new Float32Array(n * 3);
  points.forEach((p, i) => { offs[i * 3] = p[0]; offs[i * 3 + 1] = p[1]; offs[i * 3 + 2] = p[2]; });
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 3));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, tMap: { value: tex.flame }, tNoise: { value: tex.noise } },
    vertexShader: `
      attribute vec3 aOffset; attribute float aPhase;
      uniform float uTime;
      varying vec2 vUv; varying float vPhase;
      void main() {
        vUv = uv; vPhase = aPhase;
        float flick = 1.0 + 0.16 * sin(uTime * 9.0 + aPhase * 40.0) + 0.09 * sin(uTime * 23.0 + aPhase * 71.0);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 wp = aOffset + right * position.x * flick + vec3(0.0, position.y * flick, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tMap; uniform sampler2D tNoise; uniform float uTime;
      varying vec2 vUv; varying float vPhase;
      void main() {
        vec2 uv = vUv;
        float n = texture2D(tNoise, vec2(uv.x * 0.6 + vPhase, uv.y * 0.7 - uTime * 0.9 + vPhase)).r;
        uv.x += (n - 0.5) * 0.28 * (1.0 - uv.y) * uv.y * 2.2;
        vec4 c = texture2D(tMap, uv);
        gl_FragColor = vec4(c.rgb * vec3(1.9, 1.35, 0.85), c.a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function makeGrassBlades(list) {
  const n = list.length;
  const p1 = new THREE.PlaneGeometry(0.2, 1, 1, 4);
  p1.translate(0, 0.5, 0);
  const p2 = p1.clone().rotateY(Math.PI / 2);
  const blade = mergeGeometries([p1.toNonIndexed(), p2.toNonIndexed()], false);
  const geo = new THREE.InstancedBufferGeometry();
  geo.attributes.position = blade.attributes.position;
  geo.attributes.uv = blade.attributes.uv;
  const off = new Float32Array(n * 4);   // xyz + scale
  const tint = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const it = list[i];
    off[i * 4] = it.x; off[i * 4 + 1] = it.y; off[i * 4 + 2] = it.z; off[i * 4 + 3] = it.s;
    tint[i * 3] = it.r; tint[i * 3 + 1] = it.g; tint[i * 3 + 2] = it.b;
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uSunDir },
    vertexShader: `
      attribute vec4 aOff; attribute vec3 aTint;
      uniform float uTime; uniform vec3 uSunDir;
      varying vec3 vCol;
      void main() {
        float t = uv.y;
        float hash = fract(aOff.x * 12.9898 + aOff.z * 78.233);
        float hash2 = fract(aOff.x * 45.164 + aOff.z * 21.731 + 7.13);
        float ry = hash * 6.28;
        vec3 p = position;
        p.x *= (1.0 - t * 0.85);
        vec3 rp = vec3(p.x * cos(ry) - p.z * sin(ry), p.y, p.x * sin(ry) + p.z * cos(ry));
        // constant droop + wind bend: real blades arc over, they don't stand
        // up as straight cards
        float droop = 0.28 + hash2 * 0.42;
        float bend = (sin(uTime * 1.5 + hash * 6.28 + aOff.x * 0.24) + 0.55 * sin(uTime * 3.1 + aOff.z * 0.5)) * 0.16 + 0.1;
        vec2 lean = vec2(cos(ry * 1.7), sin(ry * 1.7));
        float arc = t * t;
        rp.x += arc * (bend + droop * lean.x) * aOff.w;
        rp.z += arc * (bend * 0.6 + droop * lean.y) * aOff.w;
        rp.y -= arc * droop * 0.30 * aOff.w;   // tip dips as it arcs
        vec3 wp = aOff.xyz + rp * aOff.w;

        // fake directional shading: blades facing the sun stay warm, blades
        // turned away fall into cool shadow — kills the flat-cardboard look
        vec3 face = normalize(vec3(sin(ry), 0.55, cos(ry)));
        float lam = max(dot(face, uSunDir), 0.0);
        vec3 base = mix(aTint * 0.34, aTint, t * t);
        // a minority of blades go dry/straw for hue variety
        base = mix(base, base * vec3(1.28, 1.1, 0.62), step(0.86, hash2) * 0.75);
        base *= 0.72 + lam * 0.55;
        // golden-hour sheen on the top third
        base += vec3(0.16, 0.13, 0.05) * smoothstep(0.62, 1.0, t) * (0.35 + lam);
        vCol = base;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vCol;
      void main() { gl_FragColor = vec4(vCol, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
