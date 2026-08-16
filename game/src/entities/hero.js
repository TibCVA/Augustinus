// Hero rig builder + procedural animation state machine.
//
// Sera, Blade of Dawn (BLUE) and Kargath, Ember Warlord (RED) share a skeleton
// but nothing else: proportions, plating, headgear, weapon and cloth are built
// separately so the two silhouettes never read as recolours of each other.
//
// Everything a joint carries is merged into at most three meshes (matte body /
// metal plate / emissive) using vertex colours, so a fully detailed hero costs
// ~22 draw calls instead of one per part. Rim light (warm gold from the sun
// side, cool teal from ambient) is injected into every material — that fresnel
// edge is what separates a MOBA character from a grey mannequin.
//
// The face is a painted alpha decal (core/assets.js texFace) laid on a
// spherical patch that hugs the skull: geometry eyes at this scale just read as
// buried beads, a painted decal reads as a character.
import * as THREE from 'three';
import { tex, uTime } from '../core/assets.js';
import { chamferBox, lathe } from '../world/props.js';
import { Unit, assemble, addDualRim, addVertexGlow, addSurfaceDetail, ell, cbox, strand } from './units.js';

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m4 = new THREE.Matrix4();
const _vFoot = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;
const fin = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
// Deterministic stand-in for Math.random(). Only ever drives animation phase —
// no gameplay state — but an unseeded call inside the render frame still made
// the ?shot=1 presets irreproducible, and DESIGN.md makes ?seed=N fix the RNG.
let _rs = 0x2545f491;
function rnd() {
  _rs |= 0; _rs = (_rs + 0x6d2b79f5) | 0;
  let t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function sm01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
function outCubic(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
function outQuint(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 5); }
function inQuad(x) { x = clamp(x, 0, 1); return x * x; }

function mesh(geo, mat, cast = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  return m;
}
function joint(parent, x, y, z, name, rig) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  j.userData.bind = { px: x, py: y, pz: z };
  parent.add(j);
  if (name) rig.joints[name] = j;
  return j;
}
// tapered limb: r0 at the top, r1 at the bottom, length len downward from y=0
function limb(r0, r1, len, seg = 8) {
  return lathe([[r0 * 0.86, 0.03], [r0, -0.02], [(r0 + r1) * 0.52, -len * 0.55], [r1, -len], [r1 * 0.7, -len - 0.03]], seg);
}
// ring of chamfered plates hanging off a waist / shoulder
function ringPlates(n, { r, y, w, h, d, tilt = -0.16, phase = 0, c = 0.02 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    out.push(chamferBox(w, h, d, c).translate(0, -h, 0).rotateX(tilt).translate(0, y, r).rotateY(a));
  }
  return out;
}
// partial revolve (armour band / collar) — real thickness via an out-and-back
// profile, so a trim band always sinks into the plate it wraps instead of
// hovering next to it like a hula hoop.
function band(rIn, rOut, y0, y1, seg = 14) {
  return lathe([[rIn, y0], [rOut, (y0 + y1) * 0.5], [rOut * 0.99, y1], [rIn * 0.96, y1]], seg);
}
// place a feature on the surface of a head sphere of radius d centred at (0,hy,0)
function onHead(g, az, el, d, hy) {
  return g.translate(0, 0, d).rotateX(-el).rotateY(az).translate(0, hy, 0);
}
// Every part in a plate mesh IS armour unless it says otherwise, so default the
// whole list to full edge wear rather than annotating sixty call sites. Parts
// that ride in the plate mesh but are not metal (hands, leather) opt out with
// an explicit `metal: 0` / `wear: 0`.
function armour(parts, w = 1) {
  for (const p of parts) {
    const o = p[2] || (p[2] = {});
    if (o.wear === undefined && o.metal === undefined) o.wear = w;
  }
  return parts;
}
// A line of rivets stepped along a straight run — one of the cheapest pieces of
// high-frequency detail available: ~30 triangles each, sub-pixel at gameplay
// distance and unmistakable in a close frame.
function rivets(n, x0, y0, z0, x1, y1, z1, r = 0.0125) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push(ell(r, r * 0.72, r, 5, 4)
      .translate(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t));
  }
  return out;
}
// Rivets stepped around a circle of radius `rad` at height y, pushed out to
// radius `rad` on the surface of whatever they are studding.
function rivetRing(n, rad, y, r = 0.0125, phase = 0, arc = Math.PI * 2, tilt = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (arc === Math.PI * 2 ? (i / n) : (i / Math.max(1, n - 1))) * arc;
    out.push(ell(r, r * 0.74, r, 5, 4).translate(0, y + Math.cos(a) * tilt, rad).rotateY(a));
  }
  return out;
}

// --------------------------------------------------------------- face decal --
// A spherical patch conforming to the skull, carrying the painted face texture.
// The UV window is chosen so the painted pupils land at ±0.30 R — anything
// narrower and she goes cross-eyed, anything wider and the eyes slide onto the
// temples.
function facePatch(rx, ry, rz, hy, {
  az = 0.72, el1 = 0.56, el0 = -0.70, seg = 11,
  u0 = 0.12, u1 = 0.88, v0 = 0.08, v1 = 0.92, lift = 1.018,
} = {}) {
  const nx = seg + 1, ny = seg + 1, N = nx * ny;
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  const col = new Float32Array(N * 3);
  const idx = [];
  for (let j = 0; j < ny; j++) {
    const t = j / (ny - 1);
    const e = el1 + (el0 - el1) * t;
    const ce = Math.cos(e), se = Math.sin(e);
    for (let i = 0; i < nx; i++) {
      const s = i / (nx - 1);
      const a = (s * 2 - 1) * az;
      const k = j * nx + i;
      const dx = Math.sin(a) * ce, dy = se, dz = Math.cos(a) * ce;
      pos[k * 3] = dx * rx * lift; pos[k * 3 + 1] = hy + dy * ry * lift; pos[k * 3 + 2] = dz * rz * lift;
      const nl = 1 / Math.hypot(dx / rx, dy / ry, dz / rz);
      nor[k * 3] = dx / rx * nl; nor[k * 3 + 1] = dy / ry * nl; nor[k * 3 + 2] = dz / rz * nl;
      uv[k * 2] = u0 + (u1 - u0) * s;
      uv[k * 2 + 1] = v1 + (v0 - v1) * t;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 1;
    }
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------ ground ring --
// Team-coloured selection ring laid on the ground under the player.
//
// At the overview camera the hero silhouette is ~14 screen px tall and reads as
// a minion; the ring is what lets a player find their own character without
// parsing the HUD. Built as one annulus with a 4-component colour attribute
// (three auto-defines USE_COLOR_ALPHA), so a single transparent draw carries a
// dark contour, a bright core and a soft feathered edge — that dark contour is
// why it still reads against sunlit cream paving and not just against grass.
function ringGeo(hex, rows, seg = 44) {
  const c = new THREE.Color(hex);
  const nr = rows.length, N = nr * (seg + 1);
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2), col = new Float32Array(N * 4);
  for (let i = 0; i < nr; i++) {
    const [r, mul, a] = rows[i];
    for (let j = 0; j <= seg; j++) {
      const t = j / seg, ang = t * Math.PI * 2;
      const k = i * (seg + 1) + j;
      pos[k * 3] = Math.sin(ang) * r; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = Math.cos(ang) * r;
      nor[k * 3 + 1] = 1;
      uv[k * 2] = t; uv[k * 2 + 1] = i / (nr - 1);
      col[k * 4] = c.r * mul; col[k * 4 + 1] = c.g * mul; col[k * 4 + 2] = c.b * mul; col[k * 4 + 3] = a;
    }
  }
  const idx = [];
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, d = a + seg + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}
// A flat chevron tick, apex pointing outward along +Z, laid in the XZ plane.
function ringTick(hex, r0, r1, halfW, a) {
  const c = new THREE.Color(hex);
  const pos = new Float32Array([-halfW, 0, r0, halfW, 0, r0, 0, 0, r1]);
  const col = new Float32Array([c.r, c.g, c.b, 0.0, c.r, c.g, c.b, 0.0, c.r, c.g, c.b, 0.95]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex([0, 2, 1]);
  return g.rotateY(a);
}
function buildGroundRing(hex) {
  const dark = 0x0a1622;
  // [radius, colour multiplier, alpha] — dark shoulder / hot core / dark shoulder
  const band = ringGeo(hex, [
    [0.60, 0.00, 0.00], [0.665, 0.10, 0.55], [0.715, 1.00, 0.92],
    [0.775, 1.00, 0.92], [0.825, 0.10, 0.50], [0.98, 0.00, 0.00],
  ]);
  // The hot band is ~0.7 screen px at the overview camera; this inner wash is
  // what finds the player from 60 units up.
  //
  // Alphas here used to be 0.15/0.22/0.40 on a plane at y = 0.07 with
  // polygonOffset -6. Sera's boots occupy y -0.04..0.07, so the disc sat ON them
  // and, winning the depth test by the polygon offset, composited an
  // unshadowable cyan wash over both feet: in hero.png her right leg visibly
  // terminated in the ankle band with no boot below it. That is a large part of
  // the "floats above the tiles" read — the character literally had no feet
  // touching anything. Dropped to y = 0.015 with a third of the fill so the disc
  // is a marker under the boots, not a lightbox in front of them.
  const fill = ringGeo(hex, [[0.0, 0.75, 0.05], [0.44, 0.80, 0.08], [0.665, 1.00, 0.17], [0.71, 0.0, 0.0]]);
  const shade = ringGeo(dark, [[0.60, 1, 0], [0.70, 1, 0.34], [0.86, 1, 0.30], [1.02, 1, 0]]);
  const parts = [shade, fill, band];
  for (let i = 0; i < 3; i++) parts.push(ringTick(hex, 0.80, 1.00, 0.085, i * (Math.PI * 2 / 3) + 0.4));
  const geo = mergeGeos4(parts);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  m.position.y = 0.015;
  m.frustumCulled = false;
  return m;
}
// mergeGeos() in units.js normalises colour to itemSize 3; the ring needs the
// alpha channel, so it gets its own tiny merge.
function mergeGeos4(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 4);
  const idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    col.set(g.attributes.color.array, vo * 4);
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += n; io += src.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ------------------------------------------------------------------ blade --
// Hexagonal cross-section with a fuller groove, extruded then tapered to a point.
function bladeGeo({ len = 1.05, w = 0.058, th = 0.022, steps = 8 }) {
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(-w * 0.60, th);
  s.lineTo(-w * 0.30, th * 0.50);
  s.lineTo(0, th * 0.78);
  s.lineTo(w * 0.30, th * 0.50);
  s.lineTo(w * 0.60, th);
  s.lineTo(w, 0);
  s.lineTo(w * 0.60, -th);
  s.lineTo(w * 0.30, -th * 0.50);
  s.lineTo(0, -th * 0.78);
  s.lineTo(-w * 0.30, -th * 0.50);
  s.lineTo(-w * 0.60, -th);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getZ(i) / len, 0, 1);
    let f = 1 - 0.16 * t;
    if (t > 0.84) f *= Math.max(0.03, 1 - Math.pow((t - 0.84) / 0.16, 1.25));
    p.setX(i, p.getX(i) * f);
    p.setY(i, p.getY(i) * f);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2); // length now runs along +Y, thickness along Z
  return g;
}

// -------------------------------------------------------------------- hands --
// Mitten-simple but with a real thumb and separated fingers: at MOBA distance
// that is all a hand needs, and at close range it is the difference between a
// character and a mannequin.
function gripFist(sx, sk, ss) {
  // Wraps a hilt of radius ~0.030 running along local +Y through the origin.
  //
  // The fingers used to be four straight chamfered boxes 0.142 wide centred at
  // x = +0.014: the hilt occupies x -0.030..0.030, so every finger ran clean
  // THROUGH the grip and stuck 0.055 out the far side. That is the "sword
  // passing through the fist" read, and no amount of posing hides it, because
  // the intersection is in the rest geometry. They are now partial tori that
  // actually curl round the hilt and close on the palm, so the grip is a
  // closed loop from every angle.
  const p = [];
  // palm heel, on the far side of the hilt from the fingertips
  p.push([chamferBox(0.076, 0.205, 0.124, 0.030).translate(0, -0.102, 0).translate(-sx * 0.060, 0.020, 0), sk,
    { ao: 0.20, aoY0: -0.07, aoY1: 0.11, top: 0.14, metal: 0 }]);
  // gap in the curl faces the palm, so finger tips and palm heel close on each
  // other instead of the fingers spearing out the far side of the grip
  const gapRot = Math.PI * 0.6 + (sx < 0 ? Math.PI : 0);
  for (let i = 0; i < 4; i++) {
    const y = 0.072 - i * 0.045;
    const r = 0.052 - i * 0.002;
    const f = new THREE.TorusGeometry(r, 0.0215 - i * 0.0008, 4, 7, Math.PI * 1.20)
      .rotateX(Math.PI / 2).rotateY(gapRot).scale(1, 1, 1.06).translate(0, y, 0.004);
    p.push([f, sk, { ao: 0.20, aoY0: y - 0.030, aoY1: y + 0.022, top: 0.26, metal: 0 }]);
  }
  // knuckle ridge across the outside of the curled fingers
  p.push([chamferBox(0.040, 0.185, 0.104, 0.018).translate(0, -0.093, 0)
    .translate(sx * 0.056, 0.018, 0.010), sk, { ao: 0.14, aoY0: -0.03, aoY1: 0.09, top: 0.22, metal: 0 }]);
  // thumb laid diagonally over the fingers
  p.push([chamferBox(0.048, 0.122, 0.052, 0.02).translate(0, -0.122, 0).rotateZ(sx * 1.22).rotateX(-0.32)
    .translate(-sx * 0.050, 0.082, 0.055), sk, { ao: 0.1, aoY0: 0.0, aoY1: 0.09, top: 0.16, metal: 0 }]);
  // wrist plug so the cuff never shows a gap
  p.push([ell(0.062, 0.05, 0.062, 8, 5).translate(0, 0.118, 0), ss, { ao: 0, metal: 0 }]);
  return p;
}
function openHand(sx, sk, ss) {
  // relaxed half-closed hand hanging from a wrist at the origin. Fingers are a
  // single curled mass with two grooves — separate twig fingers read as a rake.
  const p = [];
  // One compact mass: palm + a single curled finger block + thumb. A row of
  // separate finger beads reads as a string of pearls at gameplay distance.
  p.push([ell(0.058, 0.046, 0.054, 8, 6), ss, { ao: 0, metal: 0 }]);
  p.push([chamferBox(0.104, 0.115, 0.086, 0.036).translate(0, -0.112, 0).rotateX(0.16)
    .translate(0, 0.006, 0.004), sk, { ao: 0.24, aoY0: -0.13, aoY1: 0.0, top: 0.18, metal: 0 }]);
  p.push([chamferBox(0.096, 0.062, 0.070, 0.028).translate(0, -0.062, 0).rotateX(1.02)
    .translate(0, -0.096, 0.028), sk, { ao: 0.30, aoY0: -0.17, aoY1: -0.08, top: 0.24, metal: 0 }]);
  // two shallow grooves so the finger mass reads as fingers, not a mitten
  for (const gz of [-0.020, 0.020])
    p.push([chamferBox(0.014, 0.056, 0.076, 0.005).translate(0, -0.056, 0).rotateX(1.02)
      .translate(gz, -0.092, 0.030), ss, { ao: 0.2, aoY0: -0.16, aoY1: -0.08, metal: 0 }]);
  // thumb tucked along the index side
  p.push([chamferBox(0.030, 0.070, 0.036, 0.013).translate(0, -0.070, 0).rotateZ(-sx * 0.70).rotateX(0.30)
    .translate(-sx * 0.044, -0.032, 0.024), sk, { ao: 0.16, aoY0: -0.11, aoY1: -0.01, top: 0.18, metal: 0 }]);
  return p;
}

// ------------------------------------------------------------ cape texture --
// The panel's note was that the cape is "the largest flat untextured area on
// her — a plain navy sheet". It was: it borrowed core/assets.js `texCloth`,
// which is a BANNER texture (square-ish, its own border and emblem sized for a
// 1:1 hanging), stretched over a 0.5 x 1.15 trapezoid and then mostly hidden
// behind the geometry's UV inset. Nothing of it survived except the base
// gradient, which is exactly a plain navy sheet.
//
// This is a purpose-built cape sheet instead, and it carries BOTH faces of the
// cloth in one image so the whole cape is still a single draw call:
//
//   x  [6 .. 378]  OUTER  heraldic face — twill weave, embroidered border,
//                         dawn sigil, drape shading, worn hem
//   x  [384..416]  guard band, so mip bleed never crosses the two panels
//   x  [422..634]  LINING inner face — pale quilted satin, a completely
//                         different value and hue, grubbier toward the hem
//
// It is also wired in as the material's bumpMap, so the weave, the embroidery
// and the sigil all get real relief: the embroidery stands proud of the cloth,
// the weave catches the fresnel rim, and the cape stops being one flat polygon
// at any distance.
const CAPE_TEX = { W: 640, H: 512, O0: 6, O1: 378, I0: 422, I1: 634 };

// Local deterministic RNG so painting the sheet never perturbs the animation
// phase stream that `rnd()` above feeds.
function texRng(seed) {
  let s = seed | 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The lining is deliberately the BRIGHT half. From any camera in front of the
// champion the cape's concave face is the one turned toward the lens — you look
// at the inside of a cloak, not the outside — so from the hero preset the
// lining is 100% of the cape's read, while the heraldic outer face is what the
// gameplay and overview cameras see from behind. Painting the lining dark was
// what left a black sheet in the beauty shot even after the sheet was textured.
const CAPE_PAL = {
  sera: {
    top: 0x4c66dc, mid: 0x2c3ca6, bot: 0x121a5e, seed: 0x51e2a7,
    gold: 0xf0c46a, goldHi: 0xffeeb4, goldDk: 0x8a6420,
    // amber, not cream: a cream lining sat at the same value AND the same hue
    // as the ivory plate next to it, so the cape stopped separating from the
    // body. Gold-lined navy also states the champion's palette in one shape.
    lin0: 0xf7d489, lin1: 0xcf9c48, linDk: 0x815b28, sigil: 0xffd77a,
  },
  kargath: {
    top: 0x9e4331, mid: 0x6b2416, bot: 0x2f0f0a, seed: 0x2c7b19,
    gold: 0xd79a46, goldHi: 0xf7dda0, goldDk: 0x6b4413,
    lin0: 0xf0cfa0, lin1: 0xd2a26a, linDk: 0x8e6b42, sigil: 0xffb15e,
  },
};
let _capeTexCache = null;
function capeTexture(heroName) {
  _capeTexCache = _capeTexCache || {};
  if (_capeTexCache[heroName]) return _capeTexCache[heroName];
  const { W, H, O0, O1, I0, I1 } = CAPE_TEX;
  const OW = O1 - O0, IW = I1 - I0;
  const P = CAPE_PAL[heroName] || CAPE_PAL.sera;
  const R = texRng(P.seed);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const cs = (v, a = 1) => `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  const splat = (x, y, r, v, a) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, cs(v, a)); rg.addColorStop(1, cs(v, 0));
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // ------------------------------------------------------------- ground --
  g.fillStyle = cs(P.mid); g.fillRect(0, 0, W, H);

  // ================================================== OUTER heraldic face ==
  g.save();
  g.beginPath(); g.rect(0, 0, O1 + 4, H); g.clip();
  {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0.00, cs(P.top));
    grd.addColorStop(0.42, cs(P.mid));
    grd.addColorStop(1.00, cs(P.bot));
    g.fillStyle = grd; g.fillRect(0, 0, O1 + 4, H);
    // hand-painted value mottling: no two square inches the same
    for (let i = 0; i < 110; i++)
      splat(R() * (O1 + 8) - 4, R() * H, 26 + R() * 120, R() < 0.5 ? 0xffffff : 0x000000, 0.035 + R() * 0.05);
    // drape shading matched to the geometry's baked folds (3 half-cycles across
    // the width) so painted and modelled folds agree instead of fighting
    for (let x = 0; x < O1 + 4; x++) {
      const u = (x - O0) / OW;
      const f = Math.sin(u * Math.PI * 3);
      const s = f * f * f;                                  // valleys, signed
      g.fillStyle = s < 0 ? cs(0x000000, -s * 0.22) : cs(0xffffff, s * 0.10);
      g.fillRect(x, 0, 1, H);
    }
    // vertical seam lines where the panels of the cloth are stitched together
    for (const u of [0.335, 0.665]) {
      const x = O0 + u * OW;
      g.fillStyle = cs(0x000000, 0.24); g.fillRect(x - 1, 0, 2, H);
      g.fillStyle = cs(0xffffff, 0.10); g.fillRect(x + 1, 0, 1, H);
    }
  }
  // ------------------------------------------------ embroidered border --
  {
    const bx = O0 + 16, by = 14, bw = OW - 32, bh = H - 28;
    g.strokeStyle = cs(P.goldDk, 0.85); g.lineWidth = 9;
    g.strokeRect(bx, by, bw, bh);
    g.strokeStyle = cs(P.gold, 0.95); g.lineWidth = 6;
    g.strokeRect(bx, by, bw, bh);
    g.strokeStyle = cs(P.goldHi, 0.55); g.lineWidth = 1.6;
    g.strokeRect(bx - 2.5, by - 2.5, bw + 5, bh + 5);
    // running lozenge motif inside the rule — the actual embroidery
    g.fillStyle = cs(P.goldHi, 0.62);
    const lz = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); };
    for (let y = by + 20; y < by + bh - 12; y += 26) { lz(bx + 15, y, 5); lz(bx + bw - 15, y, 5); }
    for (let x = bx + 20; x < bx + bw - 12; x += 26) { lz(x, by + 15, 5); lz(x, by + bh - 15, 5); }
    // inner hair-rule
    g.strokeStyle = cs(P.gold, 0.40); g.lineWidth = 2;
    g.strokeRect(bx + 27, by + 27, bw - 54, bh - 54);
  }
  // -------------------------------------------------------- dawn sigil --
  {
    const cx = O0 + OW * 0.5, cy = H * 0.33, rr = OW * 0.30;
    g.save(); g.translate(cx, cy);
    // rays
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.11;
      const len = rr * (i % 2 ? 0.72 : 1.0);
      g.save(); g.rotate(a);
      g.fillStyle = cs(P.sigil, 0.30);
      g.beginPath(); g.moveTo(-rr * 0.075, -rr * 0.42); g.lineTo(0, -len); g.lineTo(rr * 0.075, -rr * 0.42); g.closePath(); g.fill();
      g.restore();
    }
    // disc + horizon bar: a sun rising over a line
    g.fillStyle = cs(P.sigil, 0.34);
    g.beginPath(); g.arc(0, 0, rr * 0.40, 0, Math.PI * 2); g.fill();
    g.strokeStyle = cs(P.goldDk, 0.40); g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, rr * 0.40, 0, Math.PI * 2); g.stroke();
    g.fillStyle = cs(P.bot, 0.55);
    g.fillRect(-rr * 0.66, rr * 0.10, rr * 1.32, rr * 0.13);
    g.fillStyle = cs(P.goldHi, 0.42);
    g.fillRect(-rr * 0.62, rr * 0.10, rr * 1.24, rr * 0.05);
    // chevron wings beneath
    g.strokeStyle = cs(P.gold, 0.30); g.lineWidth = 7; g.lineCap = 'round';
    for (const s of [1, 1.34]) {
      g.beginPath();
      g.moveTo(-rr * 0.80 * s, rr * 0.62 * s); g.lineTo(0, rr * 0.34 * s); g.lineTo(rr * 0.80 * s, rr * 0.62 * s);
      g.stroke();
    }
    g.lineCap = 'butt';
    g.restore();
  }
  // ---------------------------------------------------------- hem wear --
  {
    const hem = H - 4;
    // abraded gold: chew notches out of the bottom rule
    for (let i = 0; i < 26; i++) {
      const x = O0 + R() * OW, w = 4 + R() * 16;
      g.fillStyle = cs(P.bot, 0.55 + R() * 0.35);
      g.fillRect(x, hem - 26 - R() * 8, w, 12 + R() * 14);
    }
    // frayed threads hanging off the edge
    for (let i = 0; i < 140; i++) {
      const x = O0 + R() * OW, l = 3 + R() * 16;
      g.fillStyle = R() < 0.45 ? cs(P.gold, 0.20 + R() * 0.3) : cs(P.top, 0.16 + R() * 0.3);
      g.fillRect(x, hem - l, 1, l);
    }
    // bare, sun-bleached patches where the cloth has rubbed thin
    for (let i = 0; i < 22; i++)
      splat(O0 + R() * OW, H - 8 - R() * 68, 8 + R() * 26, 0xcfd6ea, 0.10 + R() * 0.13);
    // and a soft dirt gradient into the very bottom
    const dg = g.createLinearGradient(0, H - 90, 0, H);
    dg.addColorStop(0, cs(0x000000, 0)); dg.addColorStop(1, cs(0x100c08, 0.42));
    g.fillStyle = dg; g.fillRect(0, H - 90, O1 + 4, 90);
  }
  g.restore();

  // ========================================================= LINING face ==
  g.save();
  g.beginPath(); g.rect(I0 - 4, 0, IW + 8, H); g.clip();
  {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0.00, cs(P.lin0));
    grd.addColorStop(0.55, cs(P.lin1));
    grd.addColorStop(1.00, cs(P.linDk));
    g.fillStyle = grd; g.fillRect(I0 - 4, 0, IW + 8, H);
    // quilted satin lattice: dark valley with a lit ridge alongside, so the
    // diamonds read as padding rather than as a printed grid
    g.strokeStyle = cs(P.linDk, 0.34); g.lineWidth = 2.4;
    for (let k = -H; k < IW + H; k += 30) {
      g.beginPath(); g.moveTo(I0 + k, 0); g.lineTo(I0 + k + H, H); g.stroke();
      g.beginPath(); g.moveTo(I0 + k, H); g.lineTo(I0 + k + H, 0); g.stroke();
    }
    g.strokeStyle = cs(0xffffff, 0.22); g.lineWidth = 1.2;
    for (let k = -H; k < IW + H; k += 30) {
      g.beginPath(); g.moveTo(I0 + k + 2.5, 0); g.lineTo(I0 + k + H + 2.5, H); g.stroke();
      g.beginPath(); g.moveTo(I0 + k + 2.5, H); g.lineTo(I0 + k + H + 2.5, 0); g.stroke();
    }
    // a tack stitch at every lattice crossing
    g.fillStyle = cs(P.linDk, 0.40);
    for (let y = 15; y < H; y += 30) for (let x = I0 - 15 + ((y / 30 | 0) % 2) * 15; x < I1 + 15; x += 30)
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    for (let i = 0; i < 70; i++)
      splat(I0 + R() * IW, R() * H, 18 + R() * 90, R() < 0.5 ? 0xfff4d8 : 0x241703, 0.06 + R() * 0.10);
    // broad drape passages, matched to the geometry's four folds, so at arm's
    // length the lining has form instead of being one flat panel of pattern
    for (let x = I0 - 4; x < I1 + 4; x++) {
      const uu = (x - I0) / IW;
      const q = Math.sin(uu * Math.PI * 4 + 0.5);
      const q3 = q * q * q;
      g.fillStyle = q3 < 0 ? cs(0x1c1204, -q3 * 0.30) : cs(0xfff2d2, q3 * 0.16);
      g.fillRect(x, 0, 1, H);
    }
    // gold binding stitched round the whole edge — this is the band the player
    // actually sees running down the visible border of the cape
    g.strokeStyle = cs(P.goldDk, 0.75); g.lineWidth = 14;
    g.strokeRect(I0 + 11, 13, IW - 22, H - 26);
    g.strokeStyle = cs(P.gold, 0.85); g.lineWidth = 9;
    g.strokeRect(I0 + 11, 13, IW - 22, H - 26);
    g.strokeStyle = cs(P.goldHi, 0.45); g.lineWidth = 1.6;
    g.strokeRect(I0 + 6, 8, IW - 12, H - 16);
    // saddle-stitch marks along the binding
    g.fillStyle = cs(P.goldDk, 0.55);
    for (let y = 22; y < H - 18; y += 14) { g.fillRect(I0 + 9, y, 5, 5); g.fillRect(I1 - 14, y, 5, 5); }
    for (let x = I0 + 22; x < I1 - 18; x += 14) { g.fillRect(x, 11, 5, 5); g.fillRect(x, H - 16, 5, 5); }
    // the lining is the face that drags: grubbier and worn at the hem, but
    // nothing like the outer face — this half has to stay bright to read
    const dg = g.createLinearGradient(0, H - 110, 0, H);
    dg.addColorStop(0, cs(0x000000, 0)); dg.addColorStop(1, cs(0x2a1c0e, 0.30));
    g.fillStyle = dg; g.fillRect(I0 - 4, H - 110, IW + 8, 110);
    for (let i = 0; i < 26; i++)
      splat(I0 + R() * IW, H - R() * 80, 6 + R() * 20, 0x3a2a14, 0.08 + R() * 0.12);
    for (let i = 0; i < 70; i++) {   // pulled threads at the hem
      const x = I0 + R() * IW, l = 3 + R() * 12;
      g.fillStyle = cs(R() < 0.5 ? P.gold : P.linDk, 0.20 + R() * 0.28);
      g.fillRect(x, H - 4 - l, 1, l);
    }
  }
  g.restore();

  // ------------------------------------------------ guard band + weave --
  // One pixel pass: fills the mip-bleed guard, then lays the actual thread
  // structure down at texel resolution. A 4 px twill rib is the coarsest weave
  // that still reads as cloth and the finest that survives the mip chain at
  // gameplay distance; the 3 px warp/weft and the per-texel grain underneath it
  // guarantee there is no flat pixel anywhere on the sheet.
  {
    const im = g.getImageData(0, 0, W, H);
    const d = im.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (x >= O1 + 4 && x < I0 - 4) {              // guard: average of both edges
          const a = (y * W + (O1 + 2)) * 4, b = (y * W + (I0 - 2)) * 4;
          const t = (x - (O1 + 4)) / ((I0 - 4) - (O1 + 4));
          d[o] = d[a] + (d[b] - d[a]) * t;
          d[o + 1] = d[a + 1] + (d[b + 1] - d[a + 1]) * t;
          d[o + 2] = d[a + 2] + (d[b + 2] - d[a + 2]) * t;
          continue;
        }
        const lining = x >= I0 - 4;
        let m;
        if (lining) {
          // satin: fine horizontal sheen, almost no rib
          m = 1 + 0.035 * Math.sin(y * 1.05) + (((x + y) & 7) < 4 ? 0.014 : -0.014);
        } else {
          const twill = ((x + y) % 4) < 2 ? 1.050 : 0.952;   // diagonal rib
          const warp = (x % 3) === 0 ? 0.968 : 1.0;
          const weft = (y % 3) === 0 ? 0.974 : 1.0;
          m = twill * warp * weft;
        }
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        m *= 1 + ((h - Math.floor(h)) - 0.5) * (lining ? 0.055 : 0.085);
        d[o] = Math.min(255, d[o] * m);
        d[o + 1] = Math.min(255, d[o + 1] * m);
        d[o + 2] = Math.min(255, d[o + 2] * m);
      }
    }
    g.putImageData(im, 0, 0);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  _capeTexCache[heroName] = t;
  return t;
}

// ------------------------------------------------------------------- cape --
// One draw call. Rows are transformed in the vertex shader by a CPU-run chain
// so the cloth lags behind on turns, billows on dashes and never clips the body.
//
// The chain is deliberately paranoid: a single non-finite value coming out of
// the sim (a bad facing, a bad airY) used to poison `dirs` permanently and the
// cloth exploded into a screen-filling sheet. Every input is sanitised, every
// node is hard-clamped to its rest reach from the root, and if anything still
// comes out non-finite the whole chain snaps back to the rest pose.
class Cape {
  constructor(mat, o) {
    this.rows = o.rows; this.seg = o.seg;
    this.maxReach = (this.rows - 1) * this.seg;
    this.uT = []; this.uR = [];
    this.nodes = []; this.dirs = []; this.stiff = []; this.rest = [];
    for (let i = 0; i < this.rows; i++) {
      this.uT.push(new THREE.Vector3());
      this.uR.push(new THREE.Matrix3());
      this.nodes.push(new THREE.Vector3());
      this.dirs.push(new THREE.Vector3());
      this.rest.push(new THREE.Vector3(0, -1, -0.10 - 0.03 * i).normalize());
      // Stiffness is now expressed against the row FRACTION, not the row index:
      // with the mesh resolution raised the old `23 - i * 2.1` fell to 2.0 at the
      // hem and the tip of the cloth turned to jelly.
      this.stiff.push(24 - (i / Math.max(1, o.rows - 1)) * 14);
    }
    this.reset();
    this.geo = this.build(o);
    // wrap whatever patches the material already carries (rim light) with the
    // per-row vertex transform
    this.patch(mat, this.rows, this.uT, this.uR);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.phase = rnd() * 10;
  }
  reset() {
    for (let i = 0; i < this.rows; i++) {
      this.dirs[i].copy(this.rest[i]);
      if (i === 0) this.nodes[0].set(0, 0, 0);
      else this.nodes[i].copy(this.nodes[i - 1]).addScaledVector(this.dirs[i], this.seg);
      this.uT[i].copy(this.nodes[i]);
      this.uR[i].identity();
    }
  }
  patch(mat, rows, uT, uR) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      shader.uniforms.uCapeT = { value: uT };
      shader.uniforms.uCapeR = { value: uR };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {',
          `attribute float aRow;
           attribute vec3 aLocal;
           uniform vec3 uCapeT[${rows}];
           uniform mat3 uCapeR[${rows}];
           void main() {`)
        .replace('#include <beginnormal_vertex>',
          `int capeRow = int( aRow + 0.5 );
           mat3 capeR = uCapeR[ capeRow ];
           vec3 objectNormal = capeR * vec3( normal );`)
        .replace('#include <begin_vertex>',
          'vec3 transformed = capeR * aLocal + uCapeT[ capeRow ];');
    };
    const key = mat.userData.patchKey || '';
    mat.customProgramCacheKey = () => key + '|cape' + rows;
  }
  build(o) {
    const {
      rows, seg, cols, w0, w1, thick, curl = 0.09, ragged = 0, vhem = 0,
      fold = 0.05, folds = 3, lining = [1, 1, 1], vIn = 0.012,
      // texel windows for the two faces of the sheet — see capeTexture()
      uOut = [0, 1], uLin = [0, 1],
    } = o;
    const nx = cols + 1;
    const N = rows * nx;
    const pos = new Float32Array(N * 2 * 3);
    const uvs = new Float32Array(N * 2 * 2);
    const aRow = new Float32Array(N * 2);
    const aLoc = new Float32Array(N * 2 * 3);
    const cols3 = new Float32Array(N * 2 * 3);
    const put = (base, i, j, sgn) => {
      const k = base + i * nx + j;
      const u = (j / cols) * 2 - 1;
      // width wobbles down the length so the two side edges are wavy cloth
      // edges rather than the ruled sides of a trapezoid
      const hw = (w0 + (w1 - w0) * (i / (rows - 1)))
        * (1 + 0.045 * Math.sin(i * 1.63 + 0.6) + 0.022 * Math.sin(i * 3.1));
      let y = -i * seg;
      if (i === rows - 1) {
        // hem: a soft V that is deepest at the spine, plus an irregular
        // nibble so the bottom edge is never a ruled line
        if (vhem) y -= vhem * (1 - u * u);
        if (ragged) y -= ragged * (0.35 + 0.65 * Math.abs(Math.sin(j * 2.399 + 1.7)));
      }
      const f = i / (rows - 1);
      const x = u * hw;
      // Baked drape. Two harmonics plus a stable per-column offset: one sine was
      // a corrugation, this reads as cloth that has actually hung. Amplitude
      // grows toward the hem, where real cloth is free to move.
      const uu = j / cols;
      const w1h = Math.sin(uu * Math.PI * folds);
      const w2h = Math.sin(uu * Math.PI * folds * 2.7 + 0.9);
      const w3h = Math.sin(j * 5.13 + 2.1);
      const amp = 0.20 + 0.80 * f;
      const fz = (w1h * fold + w2h * fold * 0.40 + w3h * fold * 0.16) * amp;
      const z = -curl * u * u - sgn * thick * 0.5 + fz;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      aLoc[k * 3] = x; aLoc[k * 3 + 1] = y + i * seg; aLoc[k * 3 + 2] = z;
      aRow[k] = i;
      const L = base === 0 ? 1 : 0;
      const uw = L ? uOut : uLin;
      uvs[k * 2] = uw[0] + (uw[1] - uw[0]) * uu;
      uvs[k * 2 + 1] = 1 - vIn - (1 - 2 * vIn) * f;
      // Form shading on top of the sheet: fold valleys darker, hem darker,
      // side rims darker. Tracks the same harmonics as the geometry so the
      // painted and modelled folds land on top of each other.
      const sh = (1 - 0.30 * f * f)
        * (1 + 0.20 * Math.cos(uu * Math.PI * folds) + 0.085 * Math.cos(uu * Math.PI * folds * 2.7 + 0.9))
        * (1 - 0.16 * u * u * u * u);
      cols3[k * 3] = sh * (L ? 1 : lining[0]);
      cols3[k * 3 + 1] = sh * (L ? 1 : lining[1]);
      cols3[k * 3 + 2] = sh * (L ? 1 : lining[2]);
    };
    for (let i = 0; i < rows; i++) for (let j = 0; j < nx; j++) { put(0, i, j, 1); put(N, i, j, -1); }
    const idx = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * nx + j, b = a + 1, c = a + nx + 1, d = a + nx;
        idx.push(a, b, c, a, c, d);                                  // outer (-Z)
        idx.push(N + a, N + c, N + b, N + a, N + d, N + c);           // inner (+Z)
      }
      // side rims
      const l0 = i * nx, l1 = l0 + nx;
      idx.push(l0, N + l0, N + l1, l0, N + l1, l1);
      const r0 = i * nx + cols, r1 = r0 + nx;
      idx.push(r0, r1, N + r1, r0, N + r1, N + r0);
    }
    for (let j = 0; j < cols; j++) { // bottom rim
      const a = (rows - 1) * nx + j;
      idx.push(a, a + 1, N + a + 1, a, N + a + 1, N + a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(cols3, 3));
    g.setAttribute('aRow', new THREE.BufferAttribute(aRow, 1));
    g.setAttribute('aLocal', new THREE.BufferAttribute(aLoc, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // ctx: lean (0..1 backward), side (turn lag), lift (billow up), all sanitised
  update(dt, ctx) {
    dt = fin(dt, 1 / 60);
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const lean = clamp(fin(ctx.lean), 0, 2.2);
    const side = clamp(fin(ctx.side), -1.1, 1.1);
    const lift = clamp(fin(ctx.lift), -0.8, 1.6);
    this.phase += dt;
    const R = this.rows, seg = this.seg;
    let bad = false;
    for (let i = 1; i < R; i++) {
      const f = i / (R - 1);
      const flap = Math.sin(this.phase * 3.1 - i * 0.85) * (0.05 + 0.11 * f) * (0.35 + lean);
      _v1.set(
        side * (0.22 + 0.75 * f) + Math.sin(this.phase * 1.6 + i * 0.7) * 0.045 * (0.3 + f),
        -1 + lift * (0.35 + 0.8 * f),
        -(0.08 + lean * (0.45 + 0.75 * f)) + flap,
      );
      if (_v1.z > -0.04) _v1.z = -0.04;   // never swing into the body
      const len = _v1.length();
      if (!(len > 1e-4) || !Number.isFinite(len)) _v1.copy(this.rest[i]);
      else _v1.multiplyScalar(1 / len);
      const k = 1 - Math.exp(-this.stiff[i] * dt);
      const d = this.dirs[i].lerp(_v1, k);
      const dl = d.length();
      if (!(dl > 1e-3) || !Number.isFinite(dl)) { d.copy(this.rest[i]); bad = true; } else d.multiplyScalar(1 / dl);
      const n = this.nodes[i].copy(this.nodes[i - 1]).addScaledVector(d, seg);
      // hard clamp: a segment can never reach further from the root than the
      // rest chain would. Belt and braces on top of the unit-length dirs.
      const reach = i * seg;
      if (n.lengthSq() > reach * reach) n.setLength(reach);
      if (!Number.isFinite(n.x + n.y + n.z)) bad = true;
    }
    if (bad) { this.reset(); return; }
    this.uR[0].identity();
    this.uT[0].set(0, 0, 0);
    for (let i = 1; i < R; i++) {
      _q1.setFromUnitVectors(DOWN, this.dirs[i]);
      _m4.makeRotationFromQuaternion(_q1);
      this.uR[i].setFromMatrix4(_m4);
      this.uT[i].copy(this.nodes[i]);
    }
  }
}

// ---------------------------------------------------------------- palettes --
// Values are deliberately kept off pure white: the sun + fresnel rim add ~0.35
// on top of albedo and the bloom threshold is 0.94, so a 0xf8f4e8 plate blows
// out into a white blob. Mid-value plate + dark shade + small bright accents is
// what gives the Wild Rift read.
const SERA = {
  hero: 'sera',
  plate: 0xeee6d2, plateShade: 0xb0bdd6, plate2: 0x4a7ede, trim: 0xcd9633, trimDeep: 0x8b5f1f,
  cloth: 0x3d55c4, clothDark: 0x232c7e, skin: 0xf3cba4, skinShade: 0xd39a72,
  hair: 0xffc63c, hairMid: 0xffdc79, hairTip: 0xfff2c0, steel: 0xdae6f4, core: 0x7cf0ff,
  capeTex: 'clothBlue', faceTex: 'faceSera', rimW: 0xffd79a, rimC: 0x74d3f0,
  // Champions have to out-read minions at map scale. Sera stood 1.32x a melee
  // minion's crest — inside the noise once both are 30 px tall, which is why
  // the overview frame lost the player entirely. The hero-preset camera is
  // framed head-tight (11 px of headroom at 1.07), so the ratio is bought by
  // shrinking the minions (units.js MINION_SCALE) and by the dawn crest rather
  // than by inflating the rig, which would decapitate the beauty shot.
  scale: 1.09, bulk: 1.0, headR: 0.198, hipY: 1.20, shX: 0.266, shY: 0.505,
  thigh: 0.545, shin: 0.485, armU: 0.375, armF: 0.335, neck: 0.700,
  hpY: 3.02, ring: 0x63d8ff,
};
const KARGATH = {
  hero: 'kargath',
  plate: 0xa08d78, plateShade: 0x5c4d40, plate2: 0xc0512c, trim: 0xc98531, trimDeep: 0x7d4c18,
  cloth: 0x7d3020, clothDark: 0x3a1611, skin: 0xc98a5e, skinShade: 0x94603c,
  hair: 0x3b3028, hairMid: 0x4f4235, hairTip: 0x635444, steel: 0xc9c2b2, core: 0xff8a30,
  capeTex: 'clothRed', faceTex: 'faceKargath', rimW: 0xffc078, rimC: 0x8fb6d8,
  // Kargath never gets a tight close-up preset, so he can carry the full bruiser
  // scale bump; he must still out-mass Sera.
  scale: 1.24, bulk: 1.40, headR: 0.205, hipY: 1.06, shX: 0.335, shY: 0.455,
  thigh: 0.445, shin: 0.415, armU: 0.365, armF: 0.325, neck: 0.640,
  hpY: 3.04, ring: 0xff7a3c,
  // Kargath is permanently hunched forward — baked as a pose bias so every
  // animation inherits the stance instead of only the idle.
  bias: { torso: [0.16, 0, 0], head: [-0.13, 0, 0], hips: [0.05, 0, 0] },
};

// ------------------------------------------------------------- rig builder --
function buildRig(spec) {
  const rig = { joints: {}, mats: [], spec, bias: spec.bias || {} };
  // Lowest point of the boot in knee-local space (heel ellipsoid bottom). Used
  // by the per-frame foot plant — see Hero.update.
  rig.sole = new THREE.Vector3(0, -spec.shin - 0.108, 0.02);
  const root = new THREE.Group();
  rig.root = root;
  root.scale.setScalar(spec.scale);
  const S = spec.hero === 'sera';
  const B = spec.bulk;

  // environment.js prefilters a sky IBL through PMREM into scene.environment, so
  // the old note here ("no env map in the scene, metalness above ~0.3 reads as
  // black") no longer holds: there IS a specular lobe, and armour can finally
  // be metal. Base roughness comes DOWN and metalness goes UP, and
  // addSurfaceDetail then spreads roughness back out across each individual
  // plate — a single value everywhere is what made these read as coloured
  // gradients rather than as forged steel.
  const mBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.03 });
  // Base metalness stays modest: the ivory plates are painted/enamelled, i.e.
  // dielectric. It is the WORN rims that go metallic (addSurfaceDetail lifts
  // them to ~0.6), which is exactly where bare steel would actually be showing.
  const mPlate = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.24 });
  const mGlow = new THREE.MeshStandardMaterial({
    vertexColors: true, color: 0x0a1218, emissive: 0xffffff, emissiveIntensity: 1.0,
    roughness: 0.22, metalness: 0,
  });
  const capeMap = capeTexture(spec.hero);
  const mCape = new THREE.MeshStandardMaterial({
    map: capeMap, vertexColors: true, roughness: 0.90, metalness: 0.0, side: THREE.DoubleSide,
    // the sheet doubles as its own relief: woven twill, raised embroidery and an
    // embossed sigil, all catching the sun and the fresnel rim
    bumpMap: capeMap, bumpScale: 0.55,
  });
  const mFace = new THREE.MeshStandardMaterial({
    map: tex[spec.faceTex], transparent: true, depthWrite: false, roughness: 0.86, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (!S) {
    // Kargath's painted eyes are ember-bright: drive emissive from the same
    // decal so they actually glow under the helm brow instead of reading flat.
    mFace.emissiveMap = tex[spec.faceTex];
    mFace.emissive = new THREE.Color(0xff6a22);
    mFace.emissiveIntensity = 0.16;
  }
  // strength is ~3x the old value because the term is now gated by `lit` — see
  // addDualRim in units.js. The old un-gated 0.28 measured +22 luma on the
  // sunward silhouette and +33 on the shadow silhouette, i.e. no light direction
  // at all; these numbers put ~+90 on the sunward contour and ~+12 elsewhere.
  addDualRim(mBody, { warm: spec.rimW, cool: spec.rimC, power: 4.2, strength: 1.30, fill: 0.20, coolK: 0.09 });
  addDualRim(mPlate, { warm: spec.rimW, cool: spec.rimC, power: 4.0, strength: 1.45, fill: 0.17, coolK: 0.08 });
  addDualRim(mCape, { warm: spec.rimW, cool: spec.rimC, power: 3.4, strength: 1.20, fill: 0.16, coolK: 0.10 });
  // Armour carries the full treatment: scratch clusters, grime in every lap,
  // bare-metal wear on every up-facing rim, and roughness spread ~0.18-0.72
  // across a single plate. Cloth/skin/hair get value break-up and crevice grime
  // only — no wear, no metal.
  addSurfaceDetail(mPlate, {
    id: 'plate', rough: 0.15, fine: 0.13, wearK: 1.0, cavK: 1.0, scratch: 0.16, metalW: 0.24,
    tint: [0.80, 0.81, 0.85], floor: 0.19,
  });
  addSurfaceDetail(mBody, {
    id: 'body', rough: 0.13, fine: 0.07, wearK: 0.0, cavK: 0.7, scratch: 0.04, metalW: 0.0,
    tint: [0.5, 0.5, 0.5], floor: 0.35,
  });
  addVertexGlow(mGlow);
  rig.mats.push(mBody, mPlate, mGlow, mCape, mFace);
  for (const mm of rig.mats) mm.userData.baseEmissive = mm.emissive.clone();

  const P = spec.plate, PS = spec.plateShade, P2 = spec.plate2, TR = spec.trim, TD = spec.trimDeep;
  const CL = spec.cloth, CD = spec.clothDark, SK = spec.skin, SS = spec.skinShade;

  // ================================================================= hips ==
  const hips = joint(root, 0, spec.hipY, 0, 'hips', rig);
  {
    const bodyP = [
      [ell(0.19 * B, 0.16, 0.16 * B, 10, 8).translate(0, -0.03, 0), CD, { ao: 0.3, aoY0: -0.2, aoY1: 0.1 }],
      [lathe([[0.152 * B, 0.10], [0.198 * B, 0.0], [0.213 * B, -0.14], [0.188 * B, -0.26]], 11), CL,
        { ao: 0.34, aoY0: -0.28, aoY1: 0.1, top: 0.1, to: spec.plate2, y0: -0.26, y1: 0.0, jitter: 0.05 }],
    ];
    hips.add(mesh(assemble(bodyP), mBody));
    const plateP = [];
    // belt: a real band, not a torus hoop, with a faceted buckle
    plateP.push([band(0.176 * B, 0.214 * B, -0.03, 0.072, 16), TR,
      { ao: 0.30, aoY0: -0.03, aoY1: 0.07, top: 0.02, to: TD, y0: 0.072, y1: -0.03 }]);
    plateP.push([new THREE.OctahedronGeometry(0.068, 0).scale(1, 1.25, 0.5).translate(0, 0.022, 0.205 * B), TR, { ao: 0.1, aoY0: -0.02, aoY1: 0.05 }]);
    // studs around the belt — the one detail that reads on a belt at any range
    for (const g of rivetRing(14, 0.219 * B, 0.020, 0.0135)) plateP.push([g, TD, { ao: 0 }]);
    if (S) {
      // ivory faulds over a blue under-skirt: longest at the front, shorter at
      // the sides, gold hem, with a half-step inner row showing in the gaps
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const fr = Math.cos(a);
        const h = 0.22 + 0.12 * Math.max(0, fr) + 0.07 * Math.max(0, -fr);
        plateP.push([chamferBox(0.158, h, 0.055, 0.024).translate(0, -h, 0).rotateX(-0.21).translate(0, 0.015, 0.196 * B).rotateY(a),
          P, { ao: 0.30, aoY0: -0.32, aoY1: 0.02, top: 0.20, to: PS, y0: 0.02, y1: -0.30, jitter: 0.04 }]);
        plateP.push([chamferBox(0.142, 0.046, 0.05, 0.016).translate(0, -h + 0.012, 0).rotateX(-0.21).translate(0, 0.015, 0.204 * B).rotateY(a),
          TR, { ao: 0, to: TD, y0: -0.1, y1: -0.3 }]);
      }
      for (const g of ringPlates(8, { r: 0.174 * B, y: -0.02, w: 0.115, h: 0.20, d: 0.045, tilt: -0.13, phase: 0 }))
        plateP.push([g, PS, { ao: 0.38, aoY0: -0.26, aoY1: -0.01 }]);
      // fauld suspension rivets: two per plate, right under the belt line
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        for (const dx of [-0.046, 0.046])
          plateP.push([ell(0.0125, 0.0092, 0.0125, 5, 4).translate(dx, -0.028, 0.206 * B).rotateY(a),
            TD, { ao: 0 }]);
      }
    } else {
      // Kargath: four heavy slab tassets, front pair huge
      const slabs = [[0, 0.26, 0.40], [Math.PI, 0.21, 0.30], [Math.PI * 0.5, 0.20, 0.32], [-Math.PI * 0.5, 0.20, 0.32]];
      for (const [a, w, h] of slabs) {
        plateP.push([chamferBox(w, h, 0.075, 0.03).translate(0, -h, 0).rotateX(-0.14).translate(0, 0.0, 0.185 * B).rotateY(a),
          P, { ao: 0.36, aoY0: -0.36, aoY1: 0.0, top: 0.14, to: PS, y0: -0.34, y1: 0.0, jitter: 0.05 }]);
        plateP.push([chamferBox(w * 0.9, 0.05, 0.058, 0.016).translate(0, -h + 0.02, 0).rotateX(-0.14).translate(0, 0, 0.212 * B).rotateY(a),
          TD, { ao: 0 }]);
        plateP.push([new THREE.ConeGeometry(0.032, 0.09, 5).rotateX(-1.45).translate(0, -h * 0.55, 0.235 * B).rotateY(a), spec.steel, { ao: 0 }]);
      }
      for (const g of ringPlates(6, { r: 0.20 * B, y: -0.05, w: 0.10, h: 0.20, d: 0.045, tilt: -0.24, phase: Math.PI / 6 }))
        plateP.push([g, PS, { ao: 0.4, aoY0: -0.3, aoY1: -0.05 }]);
    }
    hips.add(mesh(assemble(armour(plateP)), mPlate, true));
  }

  // ================================================================= legs ==
  const legLen = spec.thigh, shinLen = spec.shin;
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const hip = joint(hips, sx * 0.135 * B, -0.055, 0, 'hip' + side, rig);
    // thigh: dark legging + an ivory cuisse over the top so the leg reads as
    // armoured mass instead of a bare tube between skirt and greave
    hip.add(mesh(assemble([
      [limb(0.140 * B, 0.098 * B, legLen, 9), CD, { ao: 0.40, aoY0: -legLen, aoY1: -0.02, to: CL, y0: -legLen, y1: 0 }],
      [lathe([[0.104 * B, -0.05], [0.146 * B, -0.10], [0.140 * B, -legLen * 0.55], [0.108 * B, -legLen * 0.80]], 9, true)
        .translate(0, 0, 0.014), P,
      { ao: 0.34, aoY0: -legLen * 0.85, aoY1: -0.08, top: 0.22, to: PS, y0: -0.08, y1: -legLen * 0.8, jitter: 0.04 }],
      [cbox(0.030, legLen * 0.44, 0.032, 0.010).translate(0, -0.17, 0.128 * B), TR, { ao: 0.2, aoY0: -legLen * 0.6, aoY1: -0.15 }],
    ]), mBody, true));
    const knee = joint(hip, 0, -legLen, 0, 'knee' + side, rig);
    rig.knees = rig.knees || [];
    rig.knees.push(knee);
    const gp = [];
    // knee cop + greave + boot, all one plate mesh
    // knee cop: a faceted plate with a forward point, not a billiard ball
    gp.push([lathe([[0.062 * B, 0.086], [0.110 * B, 0.034], [0.118 * B, -0.026], [0.098 * B, -0.080], [0.070 * B, -0.104]], 9, true)
      .scale(1, 1, 1.12).translate(0, 0.005, 0.016), P,
    { ao: 0.22, aoY0: -0.10, aoY1: 0.06, top: 0.22, to: PS, y0: 0.06, y1: -0.10 }]);
    gp.push([strand(0.062 * B, 0.11, 0.048, 0.12).rotateX(1.45).translate(0, -0.006, 0.086 * B), P,
      { ao: 0.10, aoY0: -0.1, aoY1: 0.02, top: 0.24 }]);
    gp.push([limb(0.116 * B, 0.102 * B, shinLen, 9).translate(0, -0.05, 0.005), P,
      { ao: 0.30, aoY0: -shinLen, aoY1: -0.1, to: PS, y0: -0.10, y1: -shinLen, jitter: 0.04 }]);
    gp.push([cbox(0.032, shinLen * 0.60, 0.05, 0.012).translate(0, -shinLen * 0.46, 0.106 * B), TR, { ao: 0, to: TD, y0: -0.1, y1: -shinLen }]);
    gp.push([band(0.094 * B, 0.118 * B, -shinLen + 0.01, -shinLen + 0.072, 12), TR,
      { ao: 0.34, aoY0: -shinLen, aoY1: -shinLen + 0.08, top: 0.04, to: TD, y0: -shinLen + 0.08, y1: -shinLen }]);
    // foot: sole slab + toe cap + heel
    gp.push([chamferBox(0.160 * B, 0.100, 0.255, 0.032).translate(0, -shinLen - 0.10, 0.05), PS, { ao: 0.32, aoY0: -shinLen - 0.12, aoY1: -shinLen }]);
    gp.push([ell(0.086 * B, 0.070, 0.112, 8, 6).translate(0, -shinLen - 0.038, 0.148), P, { ao: 0.18, aoY0: -shinLen - 0.1, aoY1: -shinLen, top: 0.16 }]);
    gp.push([ell(0.070 * B, 0.064, 0.068, 7, 5).translate(0, -shinLen - 0.048, -0.078), PS, { ao: 0.28, aoY0: -shinLen - 0.1, aoY1: -shinLen }]);
    if (!S) for (const zz of [0.02, 0.14]) // Kargath: spiked boot studs
      gp.push([new THREE.ConeGeometry(0.028, 0.09, 5).rotateX(-Math.PI / 2).translate(0, -shinLen - 0.02, zz + 0.14), spec.steel, { ao: 0 }]);
    // ---- greave hardware -------------------------------------------------
    // Rivets down both edges of the shin plate and a second lame lapping the
    // ankle: a bare tapered tube is a leg, a riveted lapped tube is a greave.
    for (const rx of [-1, 1])
      for (const g of rivets(4, rx * 0.098 * B, -0.16, 0.048, rx * 0.086 * B, -shinLen * 0.86, 0.040, 0.0115))
        gp.push([g, TD, { ao: 0.12, aoY0: -shinLen, aoY1: 0 }]);
    gp.push([lathe([[0.104 * B, -shinLen * 0.52], [0.125 * B, -shinLen * 0.60],
      [0.120 * B, -shinLen * 0.76], [0.100 * B, -shinLen * 0.82]], 10, true).translate(0, 0, 0.006), PS,
    { ao: 0.28, aoY0: -shinLen * 0.9, aoY1: -shinLen * 0.5, top: 0.20 }]);
    for (const g of rivetRing(5, 0.128 * B, -shinLen * 0.61, 0.0115, -0.85, 1.70))
      gp.push([g, TD, { ao: 0.1, aoY0: -shinLen, aoY1: 0 }]);
    // knee cop rivets, following its rim
    for (const g of rivetRing(6, 0.122 * B, -0.030, 0.0118, -1.25, 2.50))
      gp.push([g.scale(1, 1, 1.12).translate(0, 0.005, 0.016), TD, { ao: 0 }]);
    // boot: welt seam where the sole meets the upper
    gp.push([chamferBox(0.170 * B, 0.020, 0.265, 0.006).translate(0, -shinLen - 0.052, 0.05), TD,
      { ao: 0.2, aoY0: -shinLen - 0.1, aoY1: -shinLen }]);
    for (const g of rivets(3, -0.052 * B, -shinLen - 0.066, 0.165, 0.052 * B, -shinLen - 0.066, 0.165, 0.010))
      gp.push([g, TR, { ao: 0 }]);
    knee.add(mesh(assemble(armour(gp)), mPlate, true));
  }

  // ================================================================ torso ==
  const torso = joint(hips, 0, 0.15, 0, 'torso', rig);
  {
    // matte underlayer: tapered, real waist, neck
    const bp = [
      [lathe([[0.150 * B, -0.06], [0.148 * B, 0.06], [0.174 * B, 0.23], [0.200 * B, 0.40], [0.186 * B, 0.53], [0.140 * B, 0.60]], 12),
        CD, { ao: 0.36, aoY0: -0.05, aoY1: 0.35, to: CL, y0: 0.0, y1: 0.5 }],
      [lathe([[0.070 * B, 0.52], [0.079 * B, 0.60], [0.075 * B, spec.neck]], 9).translate(0, 0, 0.010), SK,
        { ao: 0.44, aoY0: 0.50, aoY1: spec.neck }],
      // shoulder mantle: soft cloth over the cape anchor, no visible seam
      [lathe([[0.126 * B, 0.615], [0.222 * B, 0.525], [0.262 * B, 0.435], [0.240 * B, 0.395]], 14).translate(0, 0, -0.012),
        S ? spec.plate2 : spec.cloth, { ao: 0.24, aoY0: 0.38, aoY1: 0.61, top: 0.20, jitter: 0.05 }],
    ];
    if (!S) { // fur ruff over the gorget
      bp.push([new THREE.TorusGeometry(0.215 * B, 0.098, 6, 14).rotateX(Math.PI / 2).translate(0, 0.545, 0.01), spec.hair,
        { ao: 0.24, aoY0: 0.44, aoY1: 0.60, jitter: 0.16, top: 0.2 }]);
    }
    torso.add(mesh(assemble(bp), mBody));

    // layered plate: 3 abdominal lames -> breastplate -> gorget, each lapping the last
    const pp = [];
    // ribbed abdomen: one watertight lathe whose profile steps out/in three
    // times — reads as overlapping lames with no gaps or sawtooth seams
    const rib = S
      ? [[0.140, 0.00], [0.176, 0.030], [0.158, 0.078], [0.192, 0.108], [0.172, 0.156], [0.206, 0.188], [0.192, 0.245]]
      : [[0.182, 0.00], [0.226, 0.036], [0.204, 0.086], [0.244, 0.124], [0.220, 0.176], [0.260, 0.210], [0.240, 0.260]];
    pp.push([lathe(rib.map(([r, y]) => [r * B, y]), 16), P,
      { ao: 0.30, aoY0: 0.0, aoY1: 0.26, top: 0.16, to: PS, y0: 0.24, y1: 0.0, jitter: 0.045 }]);
    const chest = S
      ? [[0.192 * B, 0.245], [0.234 * B, 0.345], [0.254 * B, 0.44], [0.240 * B, 0.52], [0.172 * B, 0.60]]
      : [[0.228 * B, 0.24], [0.272 * B, 0.33], [0.288 * B, 0.42], [0.268 * B, 0.51], [0.196 * B, 0.575]];
    pp.push([lathe(chest, 14), P, { ao: 0.28, aoY0: 0.2, aoY1: 0.5, top: 0.20, to: PS, y0: 0.52, y1: 0.22, jitter: 0.045 }]);
    // sternum ridge + V trim (cbox is centred, so rotate-then-place is safe)
    pp.push([cbox(0.046, 0.24, 0.048, 0.016).rotateX(-0.12).translate(0, 0.345, 0.230 * B), TR, { ao: 0, to: TD, y0: 0.36, y1: 0.16 }]);
    for (const sx of [-1, 1])
      pp.push([cbox(0.034, 0.25, 0.038, 0.012).rotateZ(sx * 0.66).translate(sx * 0.096 * B, 0.40, 0.220 * B), TR,
        { ao: 0, to: TD, y0: 0.42, y1: 0.20 }]);
    // gorget band at the base of the neck (sunk into the mantle, never a hoop)
    pp.push([band(0.092 * B, 0.124 * B, 0.515, 0.575, 14), TR, { ao: 0.16, aoY0: 0.51, aoY1: 0.58, top: 0.22, to: TD, y0: 0.51, y1: 0.58 }]);
    // gold setting around the chest gem — the frame is what makes it a jewel
    {
      const gy = S ? 0.405 : 0.40;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        pp.push([chamferBox(0.026, 0.064, 0.022, 0.008).translate(0, -0.032, 0).rotateZ(a)
          .translate(Math.sin(a) * 0.085, gy + Math.cos(a) * 0.085, 0.236 * B), TR, { ao: 0, top: 0.2 }]);
      }
    }
    // mantle clasp brooches over the shoulder line
    for (const sx of [-1, 1])
      pp.push([new THREE.OctahedronGeometry(0.048, 0).scale(1, 1.3, 0.6).translate(sx * 0.122 * B, 0.505, 0.128 * B), TR, { ao: 0, top: 0.2 }]);
    // ---- torso hardware ---------------------------------------------------
    // Rivet lines along the step of every abdominal lame, plus a lapped panel
    // seam either side of the sternum. This is the biggest single flat area on
    // the character after the cape; without it the whole chest is a two-stop
    // gradient with a gem stuck on the front of it.
    {
      const lam = S ? [[0.038, 0.182], [0.116, 0.198], [0.196, 0.212]]
        : [[0.044, 0.232], [0.132, 0.250], [0.218, 0.266]];
      for (const [ly, lr] of lam)
        for (const g of rivetRing(9, lr * B, ly, 0.0118, -1.35, 2.70))
          pp.push([g, TD, { ao: 0.14, aoY0: 0.0, aoY1: 0.26 }]);
      // A lapped seam across the breastplate splitting it into an upper and a
      // lower panel, with its own rivet run — the chest is the second largest
      // flat area on the character and without this it is one gradient with a
      // gem stuck to the front of it.
      const cy = S ? 0.352 : 0.345, cr = S ? 0.238 : 0.276;
      pp.push([band(cr * 0.90 * B, cr * 1.045 * B, cy - 0.030, cy + 0.028, 14), PS,
        { ao: 0.18, aoY0: cy - 0.06, aoY1: cy + 0.04, top: 0.16 }]);
      for (const g of rivetRing(9, cr * 1.055 * B, cy, 0.0118, -1.45, 2.90))
        pp.push([g, TD, { ao: 0.1, aoY0: 0.24, aoY1: 0.52 }]);
      // vertical panel seams either side of the sternum. Placed against the
      // WIDEST part of the breastplate (y 0.44, r 0.254) — at y 0.50 the lathe
      // has already pulled back in and the strips were half-buried, surfacing
      // as two dark slivers over her collarbone.
      for (const sx of [-1, 1])
        pp.push([cbox(0.013, 0.17, 0.016, 0.004).rotateZ(sx * 0.14)
          .translate(sx * 0.112 * B, 0.435, 0.234 * B), PS, { ao: 0.18, aoY0: 0.30, aoY1: 0.50 }]);
      // neckline rim rivets on the gorget band
      for (const g of rivetRing(8, 0.128 * B, 0.545, 0.0105, -1.15, 2.30)) pp.push([g, TD, { ao: 0 }]);
    }
    if (!S) { // Kargath: bolted straps across the chest
      for (const sx of [-1, 1])
        pp.push([cbox(0.07, 0.46, 0.045, 0.016).rotateZ(sx * 0.42).translate(sx * 0.075 * B, 0.34, 0.245 * B),
          spec.clothDark, { ao: 0.2, aoY0: 0.1, aoY1: 0.4 }]);
      pp.push([new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(-1.4).translate(0, 0.50, 0.24 * B), spec.steel, { ao: 0 }]);
      // shoulder-to-hip chain of rivets: reads as heavy industrial armour
      for (let i = 0; i < 4; i++)
        pp.push([ell(0.022, 0.022, 0.018, 5, 4).translate(-0.14 * B + i * 0.093 * B, 0.075, 0.238 * B), TD, { ao: 0 }]);
    }
    torso.add(mesh(assemble(armour(pp)), mPlate, true));

    // emissive: chest core (the single focal point) + rune trim
    const gp = [];
    const gemY = S ? 0.405 : 0.40;
    gp.push([new THREE.OctahedronGeometry(0.075, 0).scale(1, 1.5, 0.62).translate(0, gemY, 0.244 * B), spec.core, { ao: 0 }]);
    gp.push([new THREE.OctahedronGeometry(0.038, 0).scale(1, 1.5, 0.5).translate(0, gemY, 0.256 * B), 0xffffff, { ao: 0 }]);
    for (const sx of [-1, 1])
      gp.push([chamferBox(0.015, 0.18, 0.018, 0.005).translate(0, 0.25, 0).rotateZ(sx * 0.5).translate(sx * 0.128 * B, 0.195, 0.220 * B),
        spec.core, { ao: 0, to: 0x0a1418, y0: 0.16, y1: 0.05 }]);
    gp.push([new THREE.TorusGeometry(0.142 * B, 0.010, 4, 14).rotateX(Math.PI / 2).translate(0, 0.095, 0), spec.core, { ao: 0 }]);
    torso.add(mesh(assemble(gp), mGlow));
  }

  // ============================================================ shoulders ==
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const big = !S && side === 'L' ? 1.30 : 1.0; // Kargath is asymmetric
    const sh = joint(torso, sx * spec.shX * B, spec.shY, 0, 'sh' + side, rig);
    const armU = spec.armU;
    // deltoid ball fills the pauldron so it can never read as floating; the arm
    // is sleeved, not bare — a bare tube with rings on it reads as a broomstick
    const ap = [
      [ell(0.118 * B, 0.115 * B, 0.118 * B, 9, 7), S ? CL : CD, { ao: 0.20, aoY0: -0.1, aoY1: 0.06, top: 0.16 }],
      [limb(0.100 * B, 0.082 * B, armU, 9).translate(0, -0.02, 0), S ? CL : CD,
        { ao: 0.32, aoY0: -armU, aoY1: -0.02, to: S ? CD : 0x2c1a14, y0: -armU, y1: 0 }],
      [ell(0.086 * B, 0.080 * B, 0.088 * B, 9, 7).translate(0, -armU + 0.010, 0), S ? CL : CD,
        { ao: 0.26, aoY0: -armU - 0.02, aoY1: -armU + 0.07, top: 0.14 }],
    ];
    sh.add(mesh(assemble(ap), mBody));

    const pp = [];
    const R0 = 0.160 * B * big;
    // Main dome: a faceted lathe, not a smooth sphere — the hard plane changes
    // are what make armour read as forged metal at MOBA distance.
    pp.push([lathe([[0.001, R0 * 0.86], [R0 * 0.44, R0 * 0.74], [R0 * 0.80, R0 * 0.40],
      [R0 * 0.98, R0 * -0.10], [R0 * 0.94, R0 * -0.46]], 9, true)
      .scale(1.26, 1.0, 1.18).translate(-sx * 0.040 * B, 0.030, 0), P,
    { ao: 0.24, aoY0: -0.14, aoY1: 0.12, top: 0.26, to: PS, y0: 0.12, y1: -0.12, jitter: 0.05 }]);
    // rim band welded to the dome's own edge (matched radii = no floating hoop)
    pp.push([lathe([[R0 * 0.86, R0 * -0.62], [R0 * 1.04, R0 * -0.44], [R0 * 1.02, R0 * -0.10], [R0 * 0.82, R0 * 0.04]], 9, true)
      .scale(1.26, 1.0, 1.18).translate(-sx * 0.040 * B, 0.030, 0), TR,
    { ao: 0.16, aoY0: -0.10, aoY1: 0.02, top: 0.18, to: TD, y0: 0.02, y1: -0.10 }]);
    // second lame wrapping the upper arm — the overlap kills the shoulder gap
    pp.push([lathe([[R0 * 0.70, -0.012], [R0 * 0.92, -0.048], [R0 * 0.88, -0.115], [R0 * 0.60, -0.148]], 9, true)
      .scale(1.16, 1.0, 1.10).translate(-sx * 0.024 * B, -0.020, 0), S ? P2 : PS,
    { ao: 0.32, aoY0: -0.20, aoY1: -0.02, top: 0.22 }]);
    // ---- pauldron hardware -----------------------------------------------
    // Rivets round the rim band and round the lame below it, plus a raised boss
    // ring on the crown. The pauldron is the largest single plate on the
    // silhouette; a smooth dome with a hoop on it is the thing that most reads
    // as "primitive with a gradient".
    //
    // NB an earlier attempt at a fore-aft crest ridge here was a straight strand
    // laid across a curved dome: it sank into the crown in the middle and speared
    // out through the FRONT of the pauldron at both ends, which rendered as two
    // dark slivers floating over her collarbone. Anything added to this dome has
    // to be revolved on the dome's own axis, like the boss below.
    pp.push([lathe([[R0 * 0.30, R0 * 0.84], [R0 * 0.52, R0 * 0.70], [R0 * 0.46, R0 * 0.58]], 9, true)
      .scale(1.26, 1.0, 1.18).translate(-sx * 0.040 * B, 0.030, 0), PS,
    { ao: 0.08, aoY0: 0.05, aoY1: 0.16, top: 0.28 }]);
    for (const g of rivetRing(6, R0 * 0.56, R0 * 0.60, 0.0105, -1.6, 3.2))
      pp.push([g.scale(1.26, 1.0, 1.18).translate(-sx * 0.040 * B, 0.030, 0), TD, { ao: 0 }]);
    for (const g of rivetRing(9, R0 * 0.97, R0 * -0.28, 0.0135, -1.5, 3.0))
      pp.push([g.scale(1.26, 1.0, 1.18).translate(-sx * 0.040 * B, 0.030, 0), TD, { ao: 0.1, aoY0: -0.14, aoY1: 0.06 }]);
    for (const g of rivetRing(7, R0 * 0.86, -0.082, 0.0118, -1.3, 2.6))
      pp.push([g.scale(1.16, 1.0, 1.10).translate(-sx * 0.024 * B, -0.020, 0), TD, { ao: 0.16, aoY0: -0.18, aoY1: -0.02 }]);
    if (S) {
      // swept dawn-wing fin, laid back along the pauldron
      pp.push([strand(0.050, 0.27, 0.028, 0.18).rotateX(-1.22).rotateZ(sx * -0.30).translate(sx * 0.078, 0.082, -0.05), TR,
        { ao: 0, to: 0xfbe6a8, y0: 0, y1: 0.1 }]);
      pp.push([strand(0.034, 0.17, 0.022, 0.15).rotateX(-1.05).rotateZ(sx * -0.60).translate(sx * 0.108, 0.045, -0.03), TD, { ao: 0 }]);
    } else {
      for (let i = 0; i < 3; i++)
        pp.push([new THREE.ConeGeometry(0.045 * big, 0.23 * big, 5).rotateZ(sx * -(0.45 + i * 0.35))
          .translate(sx * (0.06 + i * 0.058) * B, 0.12 - i * 0.048, -0.02 + i * 0.02), spec.steel,
        { ao: 0, to: 0xf0ead8, y0: 0, y1: 0.15 }]);
    }
    sh.add(mesh(assemble(armour(pp)), mPlate, true));

    // ------------------------------------------------------------ forearm --
    const armF = spec.armF;
    const elbow = joint(sh, 0, -armU, 0, 'el' + side, rig);
    const fp = [];
    // The bracer IS the forearm. Every gold edge is cut from a profile that
    // starts *inside* the piece it wraps — a trim ring whose inner radius is
    // larger than the arm underneath is what made the old rig look like it was
    // wearing hula hoops.
    fp.push([lathe([[0.078 * B, 0.058], [0.108 * B, 0.034], [0.118 * B, 0.006], [0.100 * B, -0.018]], 12), TR,
      { ao: 0.16, aoY0: -0.02, aoY1: 0.08, top: 0.12, to: TD, y0: 0.08, y1: -0.02 }]);
    fp.push([lathe([[0.108 * B, 0.006], [0.100 * B, -0.07], [0.084 * B, -0.20], [0.078 * B, -armF + 0.06], [0.072 * B, -armF + 0.02]], 11), P,
      { ao: 0.34, aoY0: -armF, aoY1: 0.02, top: 0.20, to: PS, y0: 0.0, y1: -armF, jitter: 0.04 }]);
    fp.push([lathe([[0.058 * B, -armF - 0.006], [0.082 * B, -armF + 0.014], [0.080 * B, -armF + 0.044], [0.064 * B, -armF + 0.062]], 12), TR,
      { ao: 0, to: TD, y0: -armF + 0.07, y1: -armF }]);
    // knuckle-guard ridge running down the outside of the bracer
    fp.push([cbox(0.028, armF * 0.58, 0.030, 0.010).translate(sx * 0.082 * B, -0.055, 0.030), TD, { ao: 0 }]);
    // bracer hardware: buckle strap across the middle, rivets on both cuffs
    fp.push([band(0.078 * B, 0.096 * B, -armF * 0.56, -armF * 0.40, 11), TD,
      { ao: 0.2, aoY0: -armF * 0.6, aoY1: -armF * 0.36 }]);
    fp.push([chamferBox(0.030, 0.034, 0.016, 0.005).translate(0, -armF * 0.40, 0.096 * B), TR, { ao: 0 }]);
    for (const g of rivetRing(6, 0.114 * B, 0.014, 0.0105, -1.2, 2.4)) fp.push([g, TD, { ao: 0 }]);
    for (const g of rivetRing(5, 0.086 * B, -armF + 0.030, 0.0098, -1.1, 2.2)) fp.push([g, TD, { ao: 0 }]);
    if (side === 'L' || !S) for (const q of openHand(sx, S ? SK : SS, S ? SS : spec.skinShade))
      fp.push([q[0].translate(0, -armF - 0.005, 0.008), q[1], q[2]]);
    elbow.add(mesh(assemble(armour(fp)), mPlate));
  }

  // ================================================================= head ==
  const neck = joint(torso, 0, spec.neck, 0.012, 'head', rig);
  {
    const R = spec.headR;
    const hy = R * 0.76;   // skull centre above the neck joint
    const skR = S ? [R * 0.93, R * 0.99, R * 0.96] : [R * 1.00, R * 1.00, R * 0.98];
    const bp = [];
    // skull -> cheek -> chin: three overlapping volumes that taper, so the head
    // has a jaw line instead of being a ball with a face painted on it
    bp.push([ell(skR[0], skR[1], skR[2], 15, 11).translate(0, hy, 0), SK,
      { ao: 0.16, aoY0: hy - R, aoY1: hy + R * 0.5, top: 0.14 }]);
    bp.push([ell(R * 0.80, R * 0.56, R * 0.86, 11, 8).translate(0, hy - R * 0.30, R * 0.05), SK,
      { ao: 0.24, aoY0: hy - R * 0.9, aoY1: hy }]);
    bp.push([ell(R * 0.46, R * 0.28, R * 0.44, 9, 6).translate(0, hy - R * 0.60, R * 0.22), SK,
      { ao: 0.22, aoY0: hy - R * 0.9, aoY1: hy - R * 0.3 }]);
    // nose: tiny, just enough to break the profile
    bp.push([new THREE.ConeGeometry(R * 0.075, R * 0.14, 4).rotateY(Math.PI / 4).rotateX(-1.86)
      .translate(0, hy - R * 0.13, R * 0.88), SK, { ao: 0 }]);
    // elven ears, swept back — cheap, and instantly says "elven sanctum"
    for (const sx of [-1, 1]) {
      const ear = strand(R * 0.15, R * 0.46, R * 0.07, 0.10).rotateX(0.9).rotateZ(sx * -1.05)
        .translate(sx * R * 0.84, hy - R * 0.05, -R * 0.04);
      bp.push([ear, SK, { ao: 0.24, aoY0: hy - R * 0.3, aoY1: hy + R * 0.3, to: SS, y0: hy + R * 0.35, y1: hy - R * 0.1 }]);
    }

    if (S) {
      // --- hair: one carved shell + real locks laid tangent to the skull ---
      // A lock is born at (az, el) on a sphere of radius d and falls from there,
      // so nothing ever sprouts out of the crown like a leaf.
      const lock = (w, len, th, taper, az, el, d, swing, roll) => strand(w, len, th, taper)
        .rotateX(Math.PI - swing).rotateZ(roll).translate(0, 0, d).rotateX(-el).rotateY(az).translate(0, hy, 0);
      const HA = { ao: 0.20, aoY0: hy - R * 0.9, aoY1: hy + R * 0.9, top: 0.26, to: spec.hairMid, y0: hy - R, y1: hy + R };
      // Crown shell. Lifted and pulled back so its front-lower silhouette sits
      // at el +0.64 rad on centre and never drops below +0.41 across the width
      // of the face decal (|az| <= 0.70). The old shell bottomed out at el
      // +0.12/-0.16 — i.e. ON the brow row — which is what buried the painted
      // face under 0.3 px of hair. The visible hairline is set by the fringe
      // locks below, not by this shell; the shell only has to stop occluding.
      bp.push([ell(R * 1.06, R * 1.03, R * 1.02, 15, 11).translate(0, hy + R * 0.21, -R * 0.16), spec.hair, HA]);
      // occipital mass — gives the profile a real back-of-head silhouette
      bp.push([ell(R * 0.96, R * 0.90, R * 0.86, 12, 9).translate(0, hy - R * 0.10, -R * 0.50), spec.hair,
        { ao: 0.36, aoY0: hy - R, aoY1: hy + R * 0.5, to: spec.hairMid, y0: hy - R, y1: hy + R * 0.6 }]);
      // swept fringe: a deep side part on her right, locks fanning left,
      // tips stopping just above the brows
      // Locks are wide and blunt-tipped (taper 0.5) and overlap each other:
      // needle-thin strands read as a crown of leaves, not as hair.
      // [az, len, el, roll]. el is where the lock is born on the skull, len how
      // far it falls. Every anchor is inside the crown shell (roots hidden) and
      // every tip over the brow row (|az| < 0.45) lands at el >= +0.38, i.e.
      // ~15 screen px clear of the brow and ~25 px clear of the eyes in the
      // hero shot. Outside the brow zone the locks are longer on purpose —
      // they frame the temples, which is what stops the raised hairline from
      // reading as a shaved forehead.
      const fringe = [
        [-0.98, 0.60, 0.62, -0.30], [-0.60, 0.56, 0.80, -0.20], [-0.22, 0.50, 0.92, -0.06],
        [0.20, 0.46, 0.90, 0.10], [0.60, 0.52, 0.82, 0.24], [0.98, 0.52, 0.66, 0.36],
      ];
      for (const [az, len, el, roll] of fringe) {
        bp.push([lock(R * 0.40, R * len, R * 0.15, 0.52, az, el, R * 0.90, 0.10, roll), spec.hair,
          { ao: 0.14, aoY0: hy - R * 0.5, aoY1: hy + R * 0.9, top: 0.16, to: spec.hairMid, y0: hy + R * 0.9, y1: hy - R * 0.2 }]);
      }
      // face-framing side locks (asymmetric — the long one on her right)
      for (const [az, len, roll] of [[-1.34, 1.55, -0.08], [1.32, 1.05, 0.10]]) {
        bp.push([lock(R * 0.36, R * len, R * 0.18, 0.42, az, 0.16, R * 0.90, -0.10, roll), spec.hair,
          { ao: 0.20, aoY0: hy - R * 1.3, aoY1: hy + R * 0.5, to: spec.hairTip, y0: hy + R * 0.4, y1: hy - R * 1.2 }]);
      }
      // two short locks breaking the back silhouette
      for (const [az, len, roll] of [[2.5, 0.80, -0.2], [-2.5, 0.68, 0.2]]) {
        bp.push([lock(R * 0.34, R * len, R * 0.16, 0.45, az, 0.34, R * 0.92, -0.25, roll), spec.hair,
          { ao: 0.26, aoY0: hy - R, aoY1: hy + R * 0.5, to: spec.hairMid, y0: hy + R * 0.3, y1: hy - R }]);
      }
    } else {
      // Kargath: braided beard + heavy jaw under an open-faced horned helm
      bp.push([ell(R * 0.66, R * 0.46, R * 0.46, 10, 7).translate(0, hy - R * 0.60, R * 0.40), spec.hair,
        { ao: 0.32, aoY0: hy - R, aoY1: hy, jitter: 0.14 }]);
      for (const sx of [-1, 1])
        bp.push([strand(R * 0.16, R * 0.62, R * 0.14, 0.35).rotateX(Math.PI - 0.30).rotateZ(sx * 0.18)
          .translate(sx * R * 0.26, hy - R * 0.78, R * 0.42), spec.hair,
        { ao: 0.2, aoY0: hy - R * 1.4, aoY1: hy - R * 0.5, to: spec.hairTip, y0: hy - R * 1.3, y1: hy - R * 0.6 }]);
    }
    neck.add(mesh(assemble(bp), mBody, true));

    // painted face decal on a patch that hugs the skull
    const face = mesh(facePatch(skR[0], skR[1], skR[2], hy, S
      ? { az: 0.70, el1: 0.52, el0: -0.80 }
      : { az: 0.66, el1: 0.44, el0: -0.72, u0: 0.16, u1: 0.84 }), mFace);
    face.renderOrder = 2;
    neck.add(face);

    const hp = [];
    if (S) {
      // circlet with an upswept dawn ornament
      hp.push([new THREE.TorusGeometry(R * 1.09, 0.014, 5, 20, Math.PI * 1.34).rotateZ(Math.PI * -0.10)
        .rotateX(Math.PI / 2 - 0.13).rotateY(Math.PI).translate(0, hy + R * 0.26, 0), TR, { ao: 0, to: TD, y0: hy + R, y1: hy }]);
      // Dawn crest. The hero preset frames her head-tight — measured 2 px of
      // headroom above the crown once she is posed — so the champion silhouette
      // is bought in WIDTH, not height: a short centre spike to break the dome,
      // plus a pair of swept temple wings that take the head from 0.42 to 0.76
      // units across. Width survives the overview camera exactly as well as
      // height would, and it cannot be guillotined by the top of the frame.
      hp.push([strand(0.048, 0.175, 0.024, 0.10).rotateX(-0.62)
        .translate(0, hy + R * 0.72, R * 0.24), TR,
      { ao: 0, to: 0xfbe6a8, y0: hy + R * 0.7, y1: hy + R * 1.8 }]);
      for (const sx of [-1, 1]) {
        hp.push([strand(0.052, 0.26, 0.026, 0.12).rotateZ(sx * -1.10).rotateY(sx * 0.55)
          .translate(sx * R * 0.92, hy + R * 0.30, -R * 0.05), TR,
        { ao: 0, to: 0xfbe6a8, y0: hy, y1: hy + R * 1.2 }]);
        hp.push([strand(0.034, 0.15, 0.020, 0.10).rotateZ(sx * -0.80).rotateY(sx * 0.75)
          .translate(sx * R * 0.86, hy + R * 0.10, -R * 0.16), TD, { ao: 0 }]);
      }
    } else {
      // open-faced horned helm: a deep skull cap tipped forward so its rim
      // clears the eyes at the front while still swallowing the whole occiput
      hp.push([new THREE.SphereGeometry(R * 1.06, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62)
        .scale(1.05, 1.05, 1.08).rotateX(-0.55).translate(0, hy + R * 0.02, R * 0.02), P,
      { ao: 0.24, aoY0: hy - R * 0.4, aoY1: hy + R, top: 0.26, to: PS, y0: hy + R, y1: hy - R * 0.4, jitter: 0.05 }]);
      // brow bar with a nasal, right on the helm's front rim
      hp.push([cbox(R * 1.30, R * 0.24, R * 0.42, R * 0.07).rotateX(0.22).translate(0, hy + R * 0.44, R * 0.70), PS,
        { ao: 0.25, aoY0: hy + R * 0.1, aoY1: hy + R * 0.45, top: 0.2 }]);
      hp.push([cbox(R * 0.16, R * 0.42, R * 0.20, R * 0.05).translate(0, hy + R * 0.30, R * 0.86), PS, { ao: 0.2, aoY0: hy - R * 0.1, aoY1: hy + R * 0.3 }]);
      for (const sx of [-1, 1]) {
        hp.push([chamferBox(R * 0.26, R * 0.80, R * 0.52, R * 0.08).translate(0, -R * 0.8, 0).rotateZ(sx * 0.10)
          .translate(sx * R * 0.84, hy + R * 0.20, R * 0.26), PS, { ao: 0.3, aoY0: hy - R * 0.7, aoY1: hy + R * 0.2 }]);
        // big curled horns
        hp.push([new THREE.TorusGeometry(R * 0.92, 0.060, 6, 11, Math.PI * 0.80).rotateY(sx > 0 ? 0.22 : Math.PI - 0.22)
          .rotateZ(sx * -0.52).translate(sx * R * 0.94, hy + R * 0.46, -R * 0.06), spec.steel,
        { ao: 0, to: 0xefe6cf, y0: hy, y1: hy + R * 1.2 }]);
        hp.push([new THREE.ConeGeometry(0.030, 0.11, 5).rotateZ(sx * 0.55).translate(sx * R * 0.58, hy + R * 1.02, -R * 0.02), TR, { ao: 0 }]);
      }
      // central crest spike
      hp.push([strand(0.034, 0.20, 0.020, 0.0).rotateX(-0.30).translate(0, hy + R * 0.90, -R * 0.18), TR,
        { ao: 0, to: TD, y0: hy + R * 1.4, y1: hy + R * 0.8 }]);
    }
    neck.add(mesh(assemble(armour(hp)), mPlate, true));

    // ---------------------------------------------------------- ponytail --
    if (S) {
      const t0 = joint(neck, 0, hy + R * 0.20, -R * 0.95, null, rig);
      const t1 = joint(t0, 0, -0.30, -0.10, null, rig);
      const a0 = [];
      // gold tie wrapping the base, then three tapered strands falling back
      a0.push([lathe([[0.022, 0.018], [0.048, 0.002], [0.050, -0.036], [0.024, -0.050]], 10).rotateX(-0.42), TR,
        { ao: 0, to: TD, y0: 0.02, y1: -0.06 }]);
      a0.push([ell(0.066, 0.060, 0.070, 9, 7).translate(0, -0.02, -0.030), spec.hair,
        { ao: 0.18, aoY0: -0.08, aoY1: 0.02 }]);
      for (const [sx, len, w, roll] of [[0, 0.40, 0.080, 0], [-1, 0.33, 0.060, -0.20], [1, 0.31, 0.056, 0.18]]) {
        a0.push([strand(w, len, w * 0.66, 0.46).rotateX(Math.PI + 0.55).rotateZ(roll)
          .translate(sx * 0.048, -0.030, -0.045), spec.hair,
        { ao: 0.16, aoY0: -0.36, aoY1: 0.02, to: spec.hairMid, y0: 0.02, y1: -0.34 }]);
      }
      t0.add(mesh(assemble(a0), mBody));
      const a1 = [];
      for (const [sx, len, w, roll] of [[0, 0.36, 0.058, 0], [-0.9, 0.28, 0.044, -0.18], [0.9, 0.26, 0.042, 0.16]]) {
        a1.push([strand(w, len, w * 0.66, 0.16).rotateX(Math.PI + 0.30).rotateZ(roll)
          .translate(sx * 0.030, 0.015, -0.012), spec.hairMid,
        { ao: 0.14, aoY0: -0.34, aoY1: 0.02, to: spec.hairTip, y0: 0.0, y1: -0.32 }]);
      }
      t1.add(mesh(assemble(a1), mBody));
      rig.tail = [t0, t1];
    }
  }

  // ================================================================= cape ==
  {
    const capeRoot = joint(torso, 0, 0.525, -0.180 * B, null, rig);
    rig.capeRoot = capeRoot;
    const CT = CAPE_TEX;
    const uOut = [CT.O0 / CT.W, CT.O1 / CT.W];
    const uLin = [CT.I0 / CT.W, CT.I1 / CT.W];
    // Denser mesh than before (8x7 -> 11x14 for Sera). It is ~700 triangles on a
    // 280k-triangle budget and it is what lets the drape be a curve rather than
    // three facets; the cloth chain cost is per ROW, and 11 rows of a solver
    // that already runs in 40 lines is not measurable.
    const cape = S
      ? new Cape(mCape, {
        rows: 11, cols: 14, seg: 0.116, w0: 0.25, w1: 0.47, thick: 0.020, curl: 0.27,
        fold: 0.095, folds: 4, vhem: 0.12, ragged: 0.026,
        lining: [1.0, 1.0, 1.0], uOut, uLin, vIn: 0.010,
      })
      : new Cape(mCape, {
        rows: 8, cols: 12, seg: 0.128, w0: 0.32, w1: 0.60, thick: 0.028, curl: 0.24,
        ragged: 0.19, fold: 0.075, folds: 4,
        lining: [0.94, 0.94, 0.94], uOut, uLin, vIn: 0.010,
      });
    capeRoot.add(cape.mesh);
    rig.cape = cape;
  }

  // =============================================================== weapon ==
  const grip = joint(rig.joints.elR, 0, -spec.armF - 0.02, 0.05, 'grip', rig);
  const wG = new THREE.Group();
  if (S) {
    const pp = [];
    // The blade is the one surface in the rig that faces the sun edge-on for
    // most of its length, so it is the first thing to blow out once the plates
    // went metallic: keep its albedo off white, its wear low (a polished blade
    // is uniform, not chipped) and let the fuller glow carry the brightness.
    pp.push([bladeGeo({ len: 1.10, w: 0.060, th: 0.023, steps: 8 }).translate(0, 0.20, 0), 0xa9b8cc,
      { ao: 0, to: 0xd4dfee, y0: 0.2, y1: 1.2, top: 0.05, wear: 0 }]);
    // crossguard: swept wings + collar
    for (const sx of [-1, 1]) {
      pp.push([new THREE.TorusGeometry(0.088, 0.024, 5, 9, Math.PI * 0.66).rotateY(sx > 0 ? 0 : Math.PI)
        .rotateZ(sx * -0.35).translate(sx * 0.055, 0.175, 0), TR, { ao: 0, to: TD, y0: 0.24, y1: 0.12 }]);
      pp.push([new THREE.ConeGeometry(0.026, 0.085, 5).rotateZ(sx * -1.35).translate(sx * 0.182, 0.222, 0), TR, { ao: 0 }]);
    }
    pp.push([lathe([[0.042, 0.11], [0.056, 0.16], [0.05, 0.215], [0.032, 0.24]], 10), TR, { ao: 0, to: TD, y0: 0.24, y1: 0.11 }]);
    // wrapped grip — 0.21 long so the whole fist (y -0.082..0.123) has hilt to
    // hold, and the pommel dropped clear of the heel of the hand instead of
    // sitting buried inside it
    pp.push([new THREE.CylinderGeometry(0.026, 0.030, 0.215, 8).translate(0, 0.012, 0), 0x2a2438, { ao: 0, metal: 0 }]);
    for (let i = 0; i < 4; i++)
      pp.push([new THREE.TorusGeometry(0.029, 0.007, 4, 8).rotateX(Math.PI / 2).translate(0, -0.050 + i * 0.044, 0), 0x453a52, { ao: 0, metal: 0 }]);
    pp.push([new THREE.OctahedronGeometry(0.052, 0).scale(1, 0.85, 0.85).translate(0, -0.122, 0), TR, { ao: 0 }]);
    // right hand, welded to the hilt so the grip is never a floating ball
    for (const q of gripFist(1, SK, SS)) pp.push(q);
    wG.add(mesh(assemble(armour(pp)), mPlate, true));
    const gp = [];
    // fuller glow, bright at the guard fading up the blade + hot tip
    for (const zz of [0.0125, -0.0125])
      gp.push([cbox(0.021, 0.88, 0.008, 0.003).translate(0, 1.12, zz), spec.core,
        { ao: 0, to: 0x18424f, y0: 0.26, y1: 1.10 }]);
    gp.push([ell(0.022, 0.078, 0.012, 6, 5).translate(0, 1.22, 0), 0xffffff, { ao: 0 }]);
    gp.push([new THREE.OctahedronGeometry(0.024, 0).translate(0, -0.122, 0), spec.core, { ao: 0 }]);
    wG.add(mesh(assemble(gp), mGlow));
    rig.bladeBase = new THREE.Vector3(0, 0.24, 0);
    rig.bladeTip = new THREE.Vector3(0, 1.30, 0);
  } else {
    // Kargath: two-handed ember greataxe
    const pp = [];
    pp.push([new THREE.CylinderGeometry(0.038, 0.050, 1.40, 8).translate(0, 0.46, 0), 0x2f2620, { ao: 0, metal: 0 }]);
    for (let i = 0; i < 5; i++)
      pp.push([new THREE.TorusGeometry(0.044, 0.010, 4, 8).rotateX(Math.PI / 2).translate(0, -0.10 + i * 0.10, 0), 0x50412f, { ao: 0 }]);
    pp.push([lathe([[0.052, 0.98], [0.082, 1.04], [0.064, 1.13]], 8), TR, { ao: 0, to: TD, y0: 1.13, y1: 0.98 }]);
    {
      const s = new THREE.Shape();
      s.moveTo(0.03, -0.34);
      s.quadraticCurveTo(0.50, -0.38, 0.60, 0.02);
      s.quadraticCurveTo(0.50, 0.42, 0.03, 0.36);
      s.quadraticCurveTo(0.15, 0.02, 0.03, -0.34);
      s.closePath();
      for (const sx of [1, -1]) {
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 1 });
        g.scale(sx, 1, 1);
        g.translate(0, 1.04, -0.035);
        pp.push([g, spec.steel, { ao: 0, to: 0xf0eadd, y0: 1.0, y1: 1.35, jitter: 0.05 }]);
      }
    }
    pp.push([new THREE.ConeGeometry(0.055, 0.26, 6).translate(0, 1.48, 0), TR, { ao: 0 }]);
    pp.push([new THREE.ConeGeometry(0.048, 0.17, 5).rotateX(Math.PI).translate(0, -0.13, 0), TR, { ao: 0 }]);
    for (const q of gripFist(1, SS, spec.skinShade)) pp.push(q);
    wG.add(mesh(assemble(armour(pp)), mPlate, true));
    const gp = [];
    for (const sx of [1, -1])
      gp.push([cbox(0.03, 0.66, 0.05, 0.008).rotateZ(sx * -0.1).translate(sx * 0.57, 1.36, 0), spec.core,
        { ao: 0, to: 0x3a1806, y0: 1.36, y1: 1.02 }]);
    gp.push([ell(0.078, 0.09, 0.05, 8, 6).translate(0, 1.04, 0), spec.core, { ao: 0 }]);
    wG.add(mesh(assemble(gp), mGlow));
    rig.bladeBase = new THREE.Vector3(0, 0.72, 0);
    rig.bladeTip = new THREE.Vector3(0.54, 1.08, 0);
  }
  grip.add(wG);
  rig.weapon = wG;
  return rig;
}

// ------------------------------------------------------------------- poses --
// Each pose writes joint deltas into out: {jointName: [rx, ry, rz, px?, py?, pz?]}
// plus optional out.capeLean / out.capeSide / out.capeLift for the cloth sim.
const POSES = {
  idle(t, p, o) {
    const br = Math.sin(t * 1.55);              // breath
    const ws = Math.sin(t * 0.42);              // slow weight shift
    const ws2 = Math.sin(t * 0.42 + 1.1);
    o.hips = [0.02, ws * 0.10, -ws * 0.055, ws * 0.04, br * 0.016 - Math.abs(ws) * 0.014, 0];
    o.torso = [0.035 + br * 0.032, -ws * 0.055, ws * 0.065];
    o.head = [-0.05 + br * 0.024, Math.sin(t * 0.31 + 0.7) * 0.22 - ws * 0.07, -ws * 0.035];
    o.shL = [0.14 + br * 0.035, 0.05, -0.175 - ws * 0.03];
    o.elL = [0.34 + br * 0.03, 0, -0.10];
    o.shR = [0.10 + br * 0.035, -0.06, 0.235 + ws * 0.03];
    o.elR = [0.48, 0.05, 0.13];
    o.grip = [-0.58, 0.1, -0.05];
    o.hipL = [0.03 - ws * 0.06, 0, -0.035]; o.kneeL = [0.06 + Math.max(0, ws) * 0.13, 0, 0];
    o.hipR = [-0.05 + ws * 0.06, 0.06, 0.035]; o.kneeR = [0.10 + Math.max(0, -ws) * 0.13, 0, 0];
    o.capeLean = 0.05 + Math.abs(ws2) * 0.035;
    o.capeSide = ws2 * 0.05;
  },
  run(t, p, o) {
    const rate = p.rate || 1;
    const f = t * 10.5 * rate;
    const s = Math.sin(f), c = Math.cos(f);
    const lean = 0.36 * rate;
    // foot plant: the support knee snaps straight as the heel lands
    const plantL = Math.max(0, -c), plantR = Math.max(0, c);
    o.torso = [lean, s * 0.11, -s * 0.055];
    o.hips = [0.10, -s * 0.18, c * 0.035, 0, Math.abs(c) * 0.06 - 0.03, 0];
    o.head = [-lean * 0.78 - 0.04, s * 0.07, 0];
    o.hipL = [s * 0.92 - 0.14, 0, -0.03];
    o.kneeL = [Math.max(0.06, -s * 1.30 + 0.30) * (1 - plantL * 0.60), 0, 0];
    o.hipR = [-s * 0.92 - 0.14, 0, 0.03];
    o.kneeR = [Math.max(0.06, s * 1.30 + 0.30) * (1 - plantR * 0.60), 0, 0];
    // arms counter-swing the legs
    o.shL = [-s * 0.76 + 0.12, -s * 0.1, -0.22];
    o.elL = [0.62 + Math.max(0, -s) * 0.58, 0, -0.06];
    o.shR = [s * 0.60 + 0.20, s * 0.08, 0.27];
    o.elR = [0.64 + Math.max(0, s) * 0.36, 0, 0.12];
    o.grip = [-0.70, 0.15, -0.1];
    o.capeLean = 0.55 + rate * 0.45;
    o.capeSide = s * 0.10;
  },
  atk1(t, p, o) { // horizontal slash R -> L
    const w = inQuad(t / 0.30), st = outQuint((t - 0.30) / 0.13), rec = sm01((t - 0.52) / 0.42);
    o.torso = [0.10 + 0.10 * w, -0.82 * w + 1.48 * st - 0.66 * rec, 0.10 * w - 0.08 * st];
    o.head = [0.05 * w, 0.54 * w - 0.82 * st + 0.30 * rec, 0];
    o.shR = [-0.55 - 1.00 * w + 1.62 * st - 0.2 * rec, -0.30 - 0.55 * w + 1.10 * st, 1.05 * w - 0.75 * st];
    o.elR = [0.55 + 0.35 * w - 0.55 * st, 0, 0.15];
    o.grip = [-1.35 + 0.50 * st, 0, 1.20 * w - 2.10 * st + 0.85 * rec];
    o.shL = [0.45 * w - 0.25 * st, 0.3 * w, -0.44 - 0.42 * w + 0.25 * st];
    o.elL = [0.78 + 0.4 * w, 0, -0.12];
    o.hipL = [-0.24 * st, 0, 0]; o.hipR = [0.28 * st - 0.12 * w, 0, 0];
    o.kneeL = [0.22 + 0.2 * w, 0, 0]; o.kneeR = [0.30, 0, 0];
    o.hips = [0.04, -0.44 * w + 0.96 * st - 0.42 * rec, 0, 0, -0.05 * w, 0.14 * st];
    o.capeLean = 0.25 + st * 0.78 - rec * 0.5;
    o.capeSide = -0.58 * st;
    o.lunge = -0.07 * w + 0.32 * st - 0.25 * rec;   // step through the cut
  },
  atk2(t, p, o) { // backhand L -> R
    const w = inQuad(t / 0.28), st = outQuint((t - 0.28) / 0.13), rec = sm01((t - 0.50) / 0.44);
    o.torso = [0.13 + 0.08 * w, 0.90 * w - 1.60 * st + 0.74 * rec, -0.1 * w];
    o.head = [0.04 * w, -0.58 * w + 0.86 * st - 0.32 * rec, 0];
    o.shR = [-0.35 - 0.55 * w + 1.05 * st, 0.60 * w - 1.30 * st + 0.45 * rec, 0.42 + 0.60 * w - 0.85 * st];
    o.elR = [0.40 + 0.5 * w - 0.3 * st, 0.5 * w - 0.85 * st, 0.2];
    o.grip = [-1.20 + 0.32 * st, 0.45 * w - 0.85 * st, -1.00 * w + 1.85 * st - 0.85 * rec];
    o.shL = [0.25 - 0.2 * st, -0.25 * w, -0.58 - 0.2 * w];
    o.elL = [0.88, 0, 0];
    o.hipL = [0.20 * st, 0, 0]; o.hipR = [-0.22 * st, 0, 0];
    o.kneeL = [0.28, 0, 0]; o.kneeR = [0.24 + 0.2 * w, 0, 0];
    o.hips = [0.04, 0.50 * w - 1.02 * st, 0, 0, -0.04 * w, -0.10 * st];
    o.capeLean = 0.25 + st * 0.72 - rec * 0.45;
    o.capeSide = 0.58 * st;
    o.lunge = -0.07 * w + 0.30 * st - 0.23 * rec;
  },
  atk3(t, p, o) { // overhead heavy, big anticipation + hard stop
    const w = inQuad(t / 0.34), st = outQuint((t - 0.34) / 0.12), rec = sm01((t - 0.56) / 0.44);
    o.torso = [-0.46 * w + 1.06 * st - 0.44 * rec, 0.20 * w - 0.16 * st, 0];
    o.head = [0.38 * w - 0.52 * st + 0.1 * rec, 0, 0];
    o.shR = [-2.80 * w + 3.82 * st - 0.98 * rec, 0.1 * w, 0.30 * w - 0.15 * st];
    o.elR = [0.78 * w - 0.68 * st, 0, 0.1];
    o.grip = [-0.80 - 0.95 * w + 1.72 * st - 0.50 * rec, 0, 0];
    o.shL = [-2.20 * w + 3.00 * st - 0.82 * rec, 0, -0.42];
    o.elL = [0.72 - 0.35 * st, 0, -0.1];
    o.hips = [0.05, 0, 0, 0, -0.08 * w - 0.15 * st + 0.11 * rec, 0];
    o.hipL = [0.20 * st - 0.1 * w, 0, 0]; o.hipR = [-0.18 * st, 0, 0];
    o.kneeL = [0.20 + 0.50 * st, 0, 0]; o.kneeR = [0.22 + 0.50 * st, 0, 0];
    o.capeLean = 0.20 + w * 0.75 + st * 0.35 - rec * 0.6;
    o.capeLift = w * 0.50 - st * 0.50;
    o.lunge = -0.12 * w + 0.46 * st - 0.34 * rec;  // heavy: a real step in
  },
  q(t, p, o) { // crescent wave: full-body roundhouse
    const w = inQuad(t / 0.26), st = outQuint((t - 0.26) / 0.15), rec = sm01((t - 0.52) / 0.44);
    o.torso = [0.18, -1.05 * w + 2.15 * st - 1.10 * rec, 0.12 * w];
    o.head = [0, 0.60 * w - 0.95 * st + 0.35 * rec, 0];
    o.shR = [-1.40 * w + 1.55 * st, -0.50 * w + 0.85 * st, 1.45 * w - 1.25 * st];
    o.elR = [0.50 + 0.3 * w - 0.55 * st, 0, 0.2];
    o.grip = [-1.42 + 0.55 * st, 0, 1.45 * w - 2.55 * st + 1.10 * rec];
    o.shL = [0.50 * w, 0.35 * w, -0.62];
    o.elL = [0.92, 0, 0];
    o.hips = [0, -0.58 * w + 1.20 * st - 0.62 * rec, 0, 0, -0.05 * st, 0.16 * st];
    o.hipL = [-0.18 * st, 0, 0]; o.hipR = [0.22 * st, 0, 0];
    o.kneeL = [0.28, 0, 0]; o.kneeR = [0.34, 0, 0];
    o.capeLean = 0.3 + st * 0.9 - rec * 0.6;
    o.capeSide = -0.7 * st;
    o.lunge = -0.08 * w + 0.28 * st - 0.20 * rec;
  },
  dash(t, p, o) {
    o.torso = [0.66, 0, 0];
    o.head = [-0.42, 0, 0];
    o.shR = [0.95, 0, 0.88];
    o.elR = [0.50, 0, 0.30];
    o.grip = [-1.95, 0, 0.35];
    o.shL = [-0.80, 0, -0.55];
    o.elL = [1.00, 0, 0];
    o.hipL = [1.00, 0, 0]; o.kneeL = [0.55, 0, 0];
    o.hipR = [-0.95, 0, 0]; o.kneeR = [1.25, 0, 0];
    o.hips = [0.12, 0, 0, 0, 0.04, 0];
    o.capeLean = 1.4;
    o.capeLift = 0.35;
  },
  spin(t, p, o) { // E blade-storm
    const b = Math.sin(t * 22);
    o.torso = [0.14, 0, b * 0.05];
    o.shR = [0.02, 0, 1.42];
    o.elR = [0.05, 0, 0.08];
    o.grip = [-1.52, 0, 0];
    o.shL = [0.02, 0, -1.42];
    o.elL = [0.10, 0, 0];
    o.head = [0.06, 0, 0];
    o.hipL = [0.12, 0, -0.07]; o.hipR = [0.12, 0, 0.07];
    o.kneeL = [0.28, 0, 0]; o.kneeR = [0.28, 0, 0];
    o.hips = [0, 0, 0, 0, 0.02 + b * 0.02, 0];
    o.capeLean = 1.15;
    o.capeLift = 0.55;
  },
  ultLeap(t, p, o) {
    o.torso = [-0.32, 0.1, 0];
    o.head = [0.36, 0, 0];
    o.shR = [-3.00, 0, 0.32];
    o.elR = [0.42, 0, 0];
    o.grip = [-1.35, 0, 0];
    o.shL = [-2.55, 0, -0.42];
    o.elL = [0.55, 0, 0];
    o.hipL = [0.62, 0, 0]; o.kneeL = [1.05, 0, 0];
    o.hipR = [-0.40, 0, 0]; o.kneeR = [1.35, 0, 0];
    o.capeLean = 0.9;
    o.capeLift = 1.1;
  },
  ultSlam(t, p, o) {
    const k = outCubic(t / 0.16);
    o.torso = [0.92 * k, 0, 0];
    o.head = [-0.55 * k, 0, 0];
    o.shR = [1.70 * k, 0, 0.22];
    o.elR = [0.30, 0, 0];
    o.grip = [-2.05, 0, 0];
    o.shL = [0.65 * k, 0, -0.95];
    o.elL = [0.85, 0, 0];
    o.hips = [0, 0, 0, 0, -0.34 * k, 0];
    o.hipL = [1.25 * k, 0, -0.1]; o.kneeL = [1.60 * k, 0, 0];
    o.hipR = [-0.68 * k, 0, 0.1]; o.kneeR = [1.70 * k, 0, 0];
    o.capeLean = 1.5 - k * 0.6;
    o.capeLift = 1.2 - k * 1.4;
  },
  hit(t, p, o) {
    POSES.idle(0, p, o);
    const k = Math.sin(Math.min(t / 0.3, 1) * Math.PI);
    o.torso = [-0.20 * k, 0.10 * k, 0];
    o.head = [0.24 * k, 0, 0];
    o.shL = [0.14 - 0.3 * k, 0, -0.16 - 0.2 * k];
    o.shR = [0.10 - 0.2 * k, 0, 0.22 + 0.2 * k];
    o.hips = [0, 0, 0, 0, -0.05 * k, -0.06 * k];
    o.capeLean = 0.2 + k * 0.4;
    o.lunge = -0.22 * k;                            // knocked off balance
  },
  death(t, p, o) {
    const k = sm01(t / 0.7);
    o.torso = [-0.5 * k, 0, 0.15 * k];
    o.head = [0.4 * k, 0, 0.2 * k];
    o.shR = [-0.4 * k, 0, 0.8 * k];
    o.shL = [-0.3 * k, 0, -0.9 * k];
    o.grip = [-0.4, 0, 0];
    o.hips = [-1.35 * k, 0, 0, 0, -0.72 * k, -0.35 * k];
    o.hipL = [0.6 * k, 0, -0.15 * k]; o.kneeL = [0.5 * k, 0, 0];
    o.hipR = [0.9 * k, 0, 0.2 * k]; o.kneeR = [0.8 * k, 0, 0];
    o.capeLean = 0.5 * k;
  },
  showcase(t, p, o) { // hero-shot: real contrapposto, blade composed in frame
    const br = Math.sin(t * 1.5), sw = Math.sin(t * 0.62), dr = Math.sin(t * 0.41 + 0.8);
    // WHY THESE EXACT NUMBERS. The hero preset's camera is fixed in main.js
    // (p + (2.35, 1.95, 4.3) looking at p + (1.05, 1.0, -0.52), 38 deg on a
    // 1688x780 target) and this file cannot touch it, so the pose was solved
    // against a projection of the joint chain rather than eyeballed. Measured,
    // on that exact camera:
    //
    //   BEFORE                          AFTER
    //   shoulder line tilt   -1 px      +27 px   (sword-side shoulder dropped)
    //   pelvis tilt         +11 px       -8 px   (weight-side hip raised —
    //                                             i.e. it now counter-rotates
    //                                             against the shoulders)
    //   blade tip        (559, -65)  (961, 554)  — was 65 px ABOVE the top of
    //                                             the frame; now a diagonal
    //                                             finishing in the open paving
    //   crown clearance    ~16 px      ~33 px
    //
    // The previous version had the counter-rotation in YAW only, and yaw is
    // almost invisible from a camera the subject is facing: her local forward
    // projects to -0.09 of screen-x, so a hip twist moved her silhouette by
    // nothing. Contrapposto has to be carried in ROLL and in lateral pelvis
    // shift, which is what the three z terms and hips[3] below are for.
    //
    // Weight is on her right leg (screen right): that hip rides high, the
    // pelvis slides 0.075 over the supporting foot, the shoulders roll the
    // other way, and the free left leg is splayed out and flexed 0.80.
    o.hips = [0.02, -0.34, 0.19 + dr * 0.012, 0.075, br * 0.012 - 0.145, 0];
    o.torso = [0.03 + br * 0.024, -0.12, -0.36 - dr * 0.010];
    // head leads: brought round almost to the lens and tilted against the
    // shoulder roll, so the gaze is the last link in the S-curve
    o.head = [-0.10 + br * 0.018, 0.66 + sw * 0.05, 0.10];
    // Sword arm swung out and forward off the flank — the abduction is what
    // opens daylight under the arm — with the elbow nearly straight and the
    // wrist rolled so the blade rakes DOWN and across into the empty right of
    // the frame instead of standing up out of the top of it.
    o.shR = [-0.60, -0.28, 0.90 + br * 0.02];
    o.elR = [0.40, 0.10, 0.10];
    o.grip = [2.75, 0.20, -0.20];
    // off arm: relaxed, hanging slightly behind the hip. Deliberately NOT a
    // mirror of the sword arm — two matching bent elbows read as handlebars.
    o.shL = [-0.24 + br * 0.03, 0.05, -0.34];
    o.elL = [0.62, 0.30, -0.22];
    o.hipL = [-0.30, 0.05, -0.52]; o.kneeL = [0.82, 0, 0];
    o.hipR = [0.10, 0.14, -0.19]; o.kneeR = [0.38, 0, 0];
    // cape thrown to the opposite side from the blade, so the two big diagonals
    // balance instead of stacking on top of each other
    // The cloak hangs BEHIND her, so swinging it to her left simply parks it
    // out of sight behind the torso. Held near centre it instead breaks the
    // silhouette on both sides of the body and frames her, which is what a
    // cape is for in a champion portrait.
    o.capeLean = 0.18 + br * 0.05;
    o.capeSide = 0.26 + Math.sin(t * 0.9) * 0.09;
  },
  channel(t, p, o) {
    POSES.idle(t, p, o);
    const k = Math.min(t / 0.5, 1);
    o.shR = [-2.6 * k, 0, 0.4];
    o.grip = [-1.1, 0, 0];
    o.shL = [-2.2 * k, 0, -0.5];
    o.head = [0.35 * k, 0, 0];
    o.capeLean = 0.3 * k;
    o.capeLift = 0.4 * k;
  },
};

// -------------------------------------------------------------------- Hero --
// Hit reaction envelope, same shape as the minions': snap, short hold, release.
const HFLINCH_DUR = 0.30;
function hflinchEnv(remain) {
  const u = 1 - remain / HFLINCH_DUR;
  return u < 0.25 ? 1 : 1 - sm01((u - 0.25) / 0.75);
}

export class Hero extends Unit {
  constructor({ name, team, build, x = 0, z = 0 }) {
    const spec = build === 'sera' ? SERA : KARGATH;
    super({ team, kind: 'hero', maxHp: 600, radius: 0.5, speed: 7.0, x, z, hpW: 1.35, hpY: spec.hpY });
    this.isHero = true;
    this.name = name;
    this.isSera = build === 'sera';
    this.rig = buildRig(spec);
    this.group.add(this.rig.root);
    // Player selection ring. On by default for Sera (the local player); the sim
    // can move it with setGroundRing() if the played champion ever changes.
    this.ringMesh = null;
    this.ringHex = spec.ring;
    if (this.isSera) this.setGroundRing(true);
    this.anim = { name: 'idle', t: 0, dur: 1e9, lock: false, events: [], loop: true, poseParams: {} };
    this.tgt = {};
    this.moving = false;
    this.moveRate = 1;
    this.flashT = 0;
    this.extraYaw = 0;
    this.spinRate = 0;
    this.airY = 0;         // sim-driven jump height (R leap)
    this.blendK = 14;
    // cloth / hair secondary motion state (all preallocated, no per-frame allocs)
    this._prevFacing = this.facing;
    this._prevAirY = 0;
    this._turn = 0;
    this._capeCtx = { lean: 0.05, side: 0, lift: 0 };
    this._tailAng = [0, 0];
    this._tailVel = [0, 0];
    this._tailSide = [0, 0];
    this._tailSideVel = [0, 0];
    // attack lunge / hit flinch (root-level, so they are instant and cannot be
    // swallowed by the joint blend)
    this._lunge = 0;
    this._flinchT = 0;
    this._flinchSide = 1;
    this._flinchN = 0;
    // combat/economy stats (sim mutates)
    this.level = 1; this.xp = 0; this.gold = 0; this.cs = 0;
    this.kills = 0; this.deaths = 0;
    this.mana = 120; this.maxMana = 120;
    this.cds = { Q: 0, W: 0, E: 0, R: 0, A: 0 };
    this.respawnT = 0;
  }

  play(name, { dur = 0.5, lock = true, events = [], loop = false, blend = 16, poseParams = {} } = {}) {
    this.anim = { name, t: 0, dur, lock, events: events.map(e => ({ ...e, fired: false })), loop, poseParams };
    this.blendK = blend;
  }
  isLocked() { return this.anim.lock && this.anim.t < this.anim.dur; }

  // The sim already calls this on every point of damage a champion takes, so
  // the flinch rides in for free on the existing plumbing.
  hitFlash() { this.flashT = 1; this.flinch(); }

  // Hit reaction: the whole rig rocks back off the blow and slides. Optional
  // attacker position picks the shoulder that takes it.
  flinch(fromX, fromZ) {
    this._flinchT = HFLINCH_DUR;
    if (Number.isFinite(fromX) && Number.isFinite(fromZ)) {
      const f = fin(this.facing);
      const side = Math.sin(f) * (fromZ - this.pos.z) - Math.cos(f) * (fromX - this.pos.x);
      this._flinchSide = side >= 0 ? 1 : -1;
    } else {
      this._flinchSide = (this._flinchN++) % 2 ? 1 : -1;
    }
  }

  // Team-coloured ground ring under the champion. One extra transparent draw
  // call; only the local player carries it by default.
  setGroundRing(on, hex) {
    if (hex !== undefined) this.ringHex = hex;
    if (on && !this.ringMesh) {
      this.ringMesh = buildGroundRing(this.ringHex);
      this.group.add(this.ringMesh);
    } else if (!on && this.ringMesh) {
      this.group.remove(this.ringMesh);
      this.ringMesh.geometry.dispose();
      this.ringMesh.material.dispose();
      this.ringMesh = null;
    }
  }

  getBladePoints(base, tip) {
    this.rig.weapon.localToWorld(base.copy(this.rig.bladeBase));
    this.rig.weapon.localToWorld(tip.copy(this.rig.bladeTip));
  }

  update(dt) {
    dt = fin(dt, 1 / 60);
    if (dt <= 0) dt = 1 / 60;
    const a = this.anim;
    a.t += dt;
    for (const e of a.events) {
      if (!e.fired && a.t >= e.t) { e.fired = true; e.fn(); }
    }
    if (a.t >= a.dur && !a.loop) {
      this.anim = { name: this.moving ? 'run' : 'idle', t: rnd() * 3, dur: 1e9, lock: false, events: [], loop: true, poseParams: {} };
      this.blendK = 10;
    } else if (a.loop && !a.lock) {
      const want = this.moving ? 'run' : 'idle';
      if (a.name !== want && a.name !== 'death' && a.name !== 'channel') {
        this.anim.name = want; this.blendK = 12;
      }
    }
    // pose targets
    const out = this.tgt;
    for (const k in out) out[k] = null;
    const pose = POSES[this.anim.name] || POSES.idle;
    this.anim.poseParams.rate = this.moveRate;
    pose(this.anim.t, this.anim.poseParams, out);
    // blend joints toward targets (+ per-hero stance bias, e.g. Kargath's hunch)
    const bias = this.rig.bias;
    const k = 1 - Math.exp(-this.blendK * dt);
    for (const name in this.rig.joints) {
      const j = this.rig.joints[name];
      const b = j.userData.bind;
      const d = out[name];
      const bb = bias[name];
      _e1.set(
        (d ? d[0] : 0) + (bb ? bb[0] : 0),
        (d ? d[1] : 0) + (bb ? bb[1] : 0),
        (d ? d[2] : 0) + (bb ? bb[2] : 0),
      );
      _q1.setFromEuler(_e1);
      j.quaternion.slerp(_q1, k);
      const px = b.px + (d && d[3] !== undefined ? d[3] : 0);
      const py = b.py + (d && d[4] !== undefined ? d[4] : 0);
      const pz = b.pz + (d && d[5] !== undefined ? d[5] : 0);
      j.position.x += (px - j.position.x) * k;
      j.position.y += (py - j.position.y) * k;
      j.position.z += (pz - j.position.z) * k;
    }
    // E spin
    if (this.spinRate) {
      this.extraYaw += this.spinRate * dt;
      this.rig.root.rotation.y = this.extraYaw;
    } else if (this.extraYaw) {
      this.extraYaw *= Math.max(0, 1 - dt * 10);
      if (Math.abs(this.extraYaw % (Math.PI * 2)) < 0.05) this.extraYaw = 0;
      this.rig.root.rotation.y = this.extraYaw;
    }
    // leap height
    const airY = clamp(fin(this.airY), -2, 12);
    this.airY = airY;
    const root = this.rig.root;

    // ------------------------------------------------------- foot plant ----
    // Every pose that bends a knee or sinks the pelvis shortens the leg, and
    // nothing was compensating: `showcase` drops the hips 0.13 and flexes both
    // knees, which buried Sera's boots 0.18 m under the paving in her own
    // beauty shot. The old ground ring (a bright disc at y = 0.07) hid it, so
    // the bug read as "she floats" rather than "she is knee-deep in the floor".
    //
    // Resolve the two knee joints in root-local space, find the lower sole, and
    // lift the rig root until it touches. Two 4x4 concatenations per frame, no
    // allocation, and it grounds every pose in the state machine rather than
    // hand-tuning each one.
    let lift = 0;
    {
      const J = this.rig.joints, sole = this.rig.sole;
      const hips = J.hips;
      if (hips) {
        hips.updateMatrix();
        let lo = Infinity;
        for (const side of ['L', 'R']) {
          const hip = J['hip' + side], knee = J['knee' + side];
          if (!hip || !knee) continue;
          hip.updateMatrix(); knee.updateMatrix();
          _m4.copy(hips.matrix).multiply(hip.matrix).multiply(knee.matrix);
          _vFoot.copy(sole).applyMatrix4(_m4);
          if (_vFoot.y < lo) lo = _vFoot.y;
        }
        if (Number.isFinite(lo)) lift = clamp(-lo * this.rig.spec.scale, 0, 0.34);
      }
    }
    root.position.y = airY + lift;

    // ------------------------------------------- attack lunge / hit flinch --
    // Both live on the rig root: a champion who swings without travelling and
    // takes 428 damage without moving is why the critique said the VFX was
    // doing 100% of the acting. Root-level means instant — the joint blend
    // (blendK 10-16) would swallow a 0.12 s impulse.
    const wantLunge = clamp(fin(out.lunge), -0.5, 0.7);
    this._lunge += (wantLunge - this._lunge) * Math.min(1, dt * 22);
    if (!Number.isFinite(this._lunge)) this._lunge = 0;
    let fl = 0;
    if (this._flinchT > 0) {
      this._flinchT = Math.max(0, fin(this._flinchT) - dt);
      fl = hflinchEnv(this._flinchT);
    }
    root.rotation.x = -0.15 * fl;
    root.rotation.z = this._flinchSide * 0.07 * fl;
    root.position.z = clamp(this._lunge - 0.11 * fl, -0.8, 0.9);

    // ------------------------------------------------- secondary motion --
    // Every quantity that reaches the cloth solver is sanitised here: a single
    // NaN arriving from the sim used to latch into the chain and blow the cape
    // up into a screen-filling sheet that never recovered.
    const idt = dt > 1e-5 ? 1 / dt : 0;
    const facing = fin(this.facing);
    let df = facing - fin(this._prevFacing);
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this._prevFacing = facing;
    this._turn += (clamp(fin(df * idt), -8, 8) - this._turn) * Math.min(1, dt * 12);
    if (!Number.isFinite(this._turn)) this._turn = 0;
    const vAir = clamp(fin((airY - this._prevAirY) * idt), -14, 14);
    this._prevAirY = airY;

    const c = this._capeCtx;
    const speedLean = this.moving ? 0.30 + 0.75 * clamp(fin(this.moveRate, 1), 0, 2) : 0;
    const wantLean = Math.max(speedLean, fin(out.capeLean)) + (this.spinRate ? 0.9 : 0);
    const wantSide = clamp(-this._turn * 0.11, -0.85, 0.85) + fin(out.capeSide);
    const wantLift = fin(out.capeLift) + clamp(-vAir * 0.09, -0.5, 0.9);
    const ck = Math.min(1, dt * 11);
    c.lean += (clamp(wantLean, 0, 2.2) - c.lean) * ck;
    c.side += (clamp(wantSide, -1.1, 1.1) - c.side) * ck;
    c.lift += (clamp(wantLift, -0.8, 1.6) - c.lift) * ck;
    if (!Number.isFinite(c.lean + c.side + c.lift)) { c.lean = 0.05; c.side = 0; c.lift = 0; }
    this.rig.cape.update(dt, c);

    // ponytail: two damped springs, the tip lagging the root
    if (this.rig.tail) {
      const tgtX = [0.10 + c.lean * 0.50, 0.14 + c.lean * 0.72];
      const tgtZ = [c.side * 0.55 + Math.sin(uTime.value * 1.9) * 0.06,
        c.side * 0.85 + Math.sin(uTime.value * 1.7 + 1.2) * 0.09];
      const stiff = [95, 62], damp = [13, 10];
      for (let i = 0; i < 2; i++) {
        this._tailVel[i] += (tgtX[i] - this._tailAng[i]) * stiff[i] * dt - this._tailVel[i] * damp[i] * dt;
        this._tailAng[i] += this._tailVel[i] * dt;
        this._tailSideVel[i] += (tgtZ[i] - this._tailSide[i]) * stiff[i] * dt - this._tailSideVel[i] * damp[i] * dt;
        this._tailSide[i] += this._tailSideVel[i] * dt;
        if (!Number.isFinite(this._tailAng[i] + this._tailSide[i])) {
          this._tailAng[i] = 0; this._tailSide[i] = 0; this._tailVel[i] = 0; this._tailSideVel[i] = 0;
        }
        this._tailAng[i] = clamp(this._tailAng[i], -1.2, 1.6);
        this._tailSide[i] = clamp(this._tailSide[i], -1.1, 1.1);
        const j = this.rig.tail[i];
        j.rotation.x = this._tailAng[i];
        j.rotation.z = this._tailSide[i];
      }
    }

    // hit flash on materials
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 5);
      const f = this.flashT * this.flashT;
      for (const m of this.rig.mats) {
        m.emissive.copy(m.userData.baseEmissive).addScalar(f * 0.85);
      }
    }
    this.syncTransform();
  }
}
