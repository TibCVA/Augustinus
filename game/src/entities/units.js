// Unit base class (hp, team, movement), billboard HP bars (single instanced
// draw), blob shadows, and the minion rigs.
//
// Minions are drawn through InstancedMesh pools: one pool per (kind, team) with
// 2-3 instanced meshes each, so the whole army costs ~10 draw calls no matter
// how many minions are alive. The per-minion Object3D hierarchy is kept purely
// as a transform rig; its world matrices are copied into the instance buffers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uTime, patchMaterial } from '../core/assets.js';
import { chamferBox, lathe } from '../world/props.js';

// ---------------------------------------------------------------- helpers --
const _c0 = new THREE.Color(), _c1 = new THREE.Color();
const _mtmp = new THREE.Matrix4();

// Must match environment.js's `sunDir` exactly — the rim is keyed to it, and a
// rim keyed 8 degrees off the key light puts the hot edge on the wrong contour.
export const SUN_DIR = new THREE.Vector3(-0.44, 0.50, -0.60).normalize();
// The sun's shadow direction projected on the ground (unit, XZ). Contact
// shadows stretch along it.
export const SUN_GROUND = new THREE.Vector2(-SUN_DIR.x, -SUN_DIR.z).normalize();

function h3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
// 1-D hash, used to give every unit its own stance/phase/proportions from its id
// so a wave never renders as six copies of the same puppet on the same frame.
function h1(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const _clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
function sm01(x) { x = _clamp01(x); return x * x * (3 - 2 * x); }
function outCubic(x) { x = _clamp01(x); return 1 - (1 - x) * (1 - x) * (1 - x); }

// Per-vertex painterly colour: flat base or vertical gradient, optional baked AO
// toward the bottom, top-light and hue jitter. Everything a minion needs so all
// its parts can live in one vertex-coloured material.
// Global strength of the baked contact darkening — characters are lit from
// behind at golden hour, so heavy baked AO just turns them into silhouettes.
const AO_SCALE = 0.58;

export function paintGeo(geo, hex, opts = {}) {
  const { to = null, y0 = 0, y1 = 1, ao: ao0 = 0, aoY0 = 0, aoY1 = 1, top = 0, jitter = 0 } = opts;
  const ao = ao0 * AO_SCALE;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  const grad = to !== null ? new THREE.Color(to) : null;
  const invY = 1 / Math.max(1e-4, y1 - y0);
  const invAo = 1 / Math.max(1e-4, aoY1 - aoY0);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    _c0.copy(base);
    if (grad) _c0.lerp(grad, THREE.MathUtils.clamp((y - y0) * invY, 0, 1));
    if (jitter) _c0.multiplyScalar(1 - jitter + h3(x * 7.1, y * 9.3, z * 5.7) * jitter * 2);
    const ny = nor.getY(i);
    if (top && ny > 0) _c0.multiplyScalar(1 + top * ny);
    if (ao) {
      const t = THREE.MathUtils.clamp((y - aoY0) * invAo, 0, 1);
      _c0.multiplyScalar(1 - ao * (1 - t * t));
    }
    col[i * 3] = _c0.r; col[i * 3 + 1] = _c0.g; col[i * 3 + 2] = _c0.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Normalise attribute sets then merge into a single buffer.
export function mergeGeos(list) {
  const out = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) {
      const c = new Float32Array(n * 3); c.fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    out.push(g);
  }
  return mergeGeometries(out, false);
}

// [geo, colour, paintOpts] triples -> one merged, vertex-coloured geometry.
export function assemble(parts) {
  return mergeGeos(parts.map(([g, hex, o]) => paintGeo(g, hex, o || undefined)));
}

// Forward lean applied to a torso/hood part (hunch).
export function shear(geo, k, y0 = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > y0) p.setZ(i, p.getZ(i) + k * (y - y0));
  }
  geo.computeVertexNormals();
  return geo;
}

export function ell(rx, ry, rz, w = 10, h = 8) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}
export function cbox(w, h, d, c = 0.02) {
  return chamferBox(w, h, d, c).translate(0, -h / 2, 0);
}
// A flat tapered blade/strand: 4-sided pyramid squashed on Z, tip at +Y.
export function strand(w, len, thick, taper = 0.0) {
  const g = new THREE.CylinderGeometry(w * taper, w, len, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, thick / w);
  g.translate(0, len / 2, 0);
  g.computeVertexNormals();
  return g;
}

// Directional back-light rim + ambient wrap.
//
// MEASURED FAILURE OF THE PREVIOUS VERSION (hero.png, A/B against strength=0):
// the old term was `mix(uRimC, uRimW, lit) * rimF * strength` — the SAME
// magnitude everywhere on the silhouette, with `lit` changing only the hue. It
// therefore added +22 8-bit luma at the sunward edge and +33 at the shadow-side
// edge, and was still adding +10 nine pixels INSIDE the body. That is not a rim,
// it is an omnidirectional fresnel haze: it lifts the whole character by a
// constant, which reads as flat ambient and is exactly the "sprite composited
// over a backplate" tell. Final-image sunward edge minus near-interior measured
// +5.4 luma; on a subject lit by a low back-sun it needs to be 10-20x that.
//
// This version multiplies the HOT term by `lit` (how far the surface has turned
// into the sun), so the rim only exists where a back-light could physically put
// it, and can therefore be an order of magnitude stronger without turning into a
// glow around the whole body. The shadow side keeps a faint cool sky edge at
// `coolK` of the hot strength, and `fill` is unchanged: a wrap-around bounce so
// the camera-facing side does not fall to a flat blue slab.
export function addDualRim(mat, {
  warm = 0xffd79a, cool = 0x63c9e8, power = 2.7, strength = 0.34, fill = 0.13, coolK = 0.16,
} = {}) {
  if (typeof location !== 'undefined' && location.search.includes('norim')) strength = 0;
  const cw = new THREE.Color(warm), cc = new THREE.Color(cool);
  return patchMaterial(mat, {
    id: `drim2${warm.toString(16)}_${cool.toString(16)}_${power}_${strength}_${fill}_${coolK}`,
    apply(shader) {
      shader.uniforms.uRimW = { value: cw };
      shader.uniforms.uRimC = { value: cc };
      shader.uniforms.uRimS = { value: SUN_DIR };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {',
          'uniform vec3 uRimW;\nuniform vec3 uRimC;\nuniform vec3 uRimS;\nvoid main() {')
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 nrm = normalize( normal );
            float rimF = pow( 1.0 - saturate( dot( nrm, normalize( vViewPosition ) ) ), ${power.toFixed(2)} );
            vec3 sunV = normalize( ( viewMatrix * vec4( uRimS, 0.0 ) ).xyz );
            // 0 on the shadow side, 1 once the surface has turned into the sun
            float lit = smoothstep( -0.34, 0.50, dot( nrm, sunV ) );
            // hot key edge — gated hard so it is a LIGHT, not a halo
            totalEmissiveRadiance += uRimW * ( rimF * lit * lit * ${strength.toFixed(3)} );
            // faint cool sky edge everywhere else, so the shadow side still cuts
            // out against dark ground instead of merging with it
            totalEmissiveRadiance += uRimC * ( rimF * ( 1.0 - lit ) * ${(strength * coolK).toFixed(4)} );
            totalEmissiveRadiance += diffuseColor.rgb * mix( uRimC, uRimW, 0.35 )
              * ( ${fill.toFixed(3)} * ( 1.0 - lit ) );
          }`);
    },
  });
}

// Per-vertex emissive tint (vColor drives the glow gradient).
export function addVertexGlow(mat) {
  return patchMaterial(mat, {
    id: 'vglow',
    apply(shader) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
    },
  });
}

// ---------------------------------------------------------------- materials --
let unitMat = null, orbBlueMat = null, orbRedMat = null;
function ensureUnitMats() {
  if (unitMat) return;
  // NOTE: no environment map in the scene, so high metalness = black. Keep it low.
  unitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.08 });
  addDualRim(unitMat, { warm: 0xffd6a0, cool: 0x6fcdf0, power: 2.5, strength: 0.90, fill: 0.13, coolK: 0.20 });
  orbBlueMat = new THREE.MeshStandardMaterial({
    color: 0x0d2b4c, emissive: 0x5fd0ff, emissiveIntensity: 2.0, roughness: 0.24, metalness: 0,
  });
  orbRedMat = new THREE.MeshStandardMaterial({
    color: 0x4d1608, emissive: 0xff8036, emissiveIntensity: 2.0, roughness: 0.24, metalness: 0,
  });
}

const TEAM = {
  blue: {
    cloth: 0x4a86e4, clothDark: 0x27479a, metal: 0xdbe4f2, metalDark: 0x7d92b2,
    trim: 0xecc46a, accent: 0x9fe9ff, dark: 0x131b2c,
  },
  red: {
    cloth: 0xd85a2e, clothDark: 0x7e2c15, metal: 0xb99a78, metalDark: 0x6d523a,
    trim: 0xf0a244, accent: 0xffa055, dark: 0x1e0f07,
  },
};
// Minions read at ~2.5 m on a phone screen: keep them chunky — but not so
// chunky that they out-read the champion standing next to them. At 1.14/1.02 a
// melee minion's crest reached 75% of Sera's total height, which is why the
// overview frame contained no findable player character. 1.02/0.93 puts them at
// ~63%, the Wild Rift proportion, and buys the hero silhouette its read without
// inflating a rig that the head-tight hero-preset camera cannot afford.
const MINION_SCALE = { melee: 1.02, caster: 0.93 };

// ============================================================ minion rigs ==
// Shape language: BLUE reads as ordered sanctum guard — hexagonal/faceted forms,
// hard points, tall crest, straight kite shield, symmetric. RED reads as ember
// raider — round organic volumes, heavy hunch, horns, jagged spiked buckler.

// A pair of legs in a braced stance, merged into the body mesh.
//
// Both melee minions used to end at the waist in a single conical "greaves"
// lathe, which is why the panel read them as "a lidded barrel with a floating
// shield, no arms and no legs" — and why last round's fight poses were
// invisible: there were no limbs to pose. These are static (the body mesh is
// one instanced draw and a third animated mesh per pool would cost four more
// draw calls against a six-call headroom), but the body node already leans,
// rolls, yaws and bobs about the feet, so a staggered stance under it reads as
// a braced fighter shifting weight rather than a barrel sliding.
// `fwd` staggers the right foot forward, `out` splays the stance.
function legPair(T, {
  hipY = 0.50, thighR = 0.100, shinR = 0.090, out = 0.118, fwd = 0.11,
  bootW = 0.135, bootD = 0.235, thighC, shinC, bootC, bow = 0,
}) {
  const parts = [];
  for (const sx of [-1, 1]) {
    const z = sx > 0 ? fwd : -fwd * 0.85;
    const x = sx * (out + bow);
    parts.push([lathe([[thighR * 0.94, hipY + 0.04], [thighR * 1.14, hipY - 0.10],
      [thighR * 1.02, hipY * 0.52]], 6, true).translate(x, 0, z * 0.42), thighC,
    { ao: 0.34, aoY0: hipY * 0.4, aoY1: hipY + 0.05 }]);
    parts.push([lathe([[shinR * 1.10, hipY * 0.58], [shinR * 1.22, hipY * 0.42],
      [shinR * 0.94, 0.085]], 6, true).translate(sx * out, 0, z * 0.80), shinC,
    { ao: 0.42, aoY0: 0.02, aoY1: hipY * 0.6, top: 0.14 }]);
    // boot: a wedge with a raised toe so the foot has a direction
    parts.push([chamferBox(bootW, 0.088, bootD, 0.026).translate(sx * out, 0, z - 0.035), bootC,
      { ao: 0.46, aoY0: 0, aoY1: 0.11, top: 0.20 }]);
    parts.push([chamferBox(bootW * 0.80, 0.055, bootD * 0.36, 0.02)
      .translate(sx * out, 0.070, z + bootD * 0.28), T.trim, { ao: 0.1, aoY0: 0.05, aoY1: 0.13 }]);
  }
  return parts;
}

function meleeBlue(T) {
  const body = [];
  // ---------------------------------------------------------------- legs --
  for (const p of legPair(T, {
    hipY: 0.50, out: 0.120, fwd: 0.115, thighC: T.clothDark, shinC: T.metalDark, bootC: T.dark,
  })) body.push(p);
  // faceted torso, slight forward hunch
  body.push([shear(lathe([[0.245, 0.44], [0.325, 0.60], [0.35, 0.82], [0.285, 0.96]], 6, true), 0.14, 0.44),
    T.metal, { ao: 0.42, aoY0: 0.3, aoY1: 0.95, top: 0.1 }]);
  // tassets: four angular plates overlapping the thighs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    body.push([chamferBox(0.20, 0.20, 0.055, 0.02).translate(0, -0.20, 0).rotateX(-0.15).translate(0, 0.55, 0.20).rotateY(a),
      T.cloth, { ao: 0.42, aoY0: 0.3, aoY1: 0.55 }]);
  }
  // tabard plate + trim
  body.push([chamferBox(0.26, 0.34, 0.07, 0.025).translate(0, 0.50, 0.235).rotateX(-0.06), T.cloth, { ao: 0.3, aoY0: 0.45, aoY1: 0.8 }]);
  body.push([chamferBox(0.06, 0.30, 0.03, 0.012).translate(0, 0.52, 0.28), T.trim, { ao: 0 }]);
  // ---- pauldrons -----------------------------------------------------------
  // TEAM READ. At the 52-degree game camera almost nothing of a minion's flank
  // is visible: the frame is filled by helm crown, shoulder caps and whatever
  // sits on the back. Those were all T.metal (0xdbe4f2) here and T.metal
  // (0xb99a78) on the red brute, and under a warm key both resolve to the same
  // tan dome inside a ring — which is exactly why the panel scored the two
  // melee minions as one asset in one palette. Every UP-FACING surface is now
  // team cloth; the steel is pushed to the rims and the underside.
  for (const sx of [-1, 1]) {
    body.push([chamferBox(0.25, 0.15, 0.29, 0.045).translate(0, 0.06, 0).rotateZ(sx * 0.42).translate(sx * 0.26, 0.86, 0.02),
      0x3f8ae8, { ao: 0.22, aoY0: 0.7, aoY1: 0.95, top: 0.28, to: T.clothDark, y0: 1.0, y1: 0.76 }]);
    body.push([chamferBox(0.27, 0.045, 0.31, 0.02).translate(0, 0.02, 0).rotateZ(sx * 0.42).translate(sx * 0.26, 0.80, 0.02),
      T.metal, { ao: 0.2, aoY0: 0.7, aoY1: 0.9 }]);
  }
  // gorget + tall crested helm
  body.push([lathe([[0.135, 0.94], [0.20, 1.00], [0.175, 1.07]], 6, true), T.metalDark, { ao: 0.2, aoY0: 0.9, aoY1: 1.05 }]);
  body.push([lathe([[0.06, 1.02], [0.185, 1.12], [0.195, 1.26], [0.10, 1.38]], 6, true), T.metal,
    { ao: 0.25, aoY0: 1.0, aoY1: 1.3, top: 0.18 }]);
  // brush crest: a fore-aft ridge, not a needle. From directly above this is a
  // 0.21 x 0.40 solid blue bar across the crown — the strongest single team cue
  // the game camera can actually see, because it is the one surface pointing
  // straight at it.
  body.push([new THREE.CylinderGeometry(0.105, 0.105, 0.40, 7).rotateX(Math.PI / 2)
    .translate(0, 1.35, -0.02), 0x3f8ae8,
  { ao: 0, to: T.accent, y0: 1.26, y1: 1.47, top: 0.34 }]);
  body.push([chamferBox(0.036, 0.10, 0.34, 0.012).translate(0, 1.42, -0.02), T.accent,
    { ao: 0, to: 0xffffff, y0: 1.42, y1: 1.55 }]);
  body.push([strand(0.052, 0.28, 0.034).rotateX(0.40).translate(0, 1.44, -0.14), T.accent,
    { ao: 0, to: 0xffffff, y0: 1.40, y1: 1.75 }]);
  body.push([chamferBox(0.25, 0.05, 0.06, 0.012).translate(0, 1.19, 0.155), T.dark, { ao: 0 }]);
  body.push([chamferBox(0.06, 0.14, 0.06, 0.015).translate(0, 1.06, 0.17), T.metalDark, { ao: 0 }]);
  // banner roll strapped across the back — another blue mass from above
  body.push([chamferBox(0.30, 0.40, 0.075, 0.03).translate(0, 0.46, -0.235).rotateX(0.20), T.cloth,
    { ao: 0.34, aoY0: 0.42, aoY1: 0.84, top: 0.24, to: T.clothDark, y0: 0.42, y1: 0.9 }]);
  // shield arm braced forward (merged: it doesn't animate)
  body.push([new THREE.CapsuleGeometry(0.078, 0.20, 3, 6).rotateZ(1.15).translate(-0.27, 0.75, 0.06), T.metalDark, { ao: 0 }]);
  body.push([chamferBox(0.36, 0.52, 0.075, 0.04).translate(-0.42, 0.80, 0.20).rotateY(-0.28), T.cloth,
    { ao: 0.3, aoY0: 0.3, aoY1: 0.8, to: T.clothDark, y0: 0.9, y1: 0.35 }]);
  body.push([new THREE.ConeGeometry(0.255, 0.28, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(-0.42, 0.32, 0.20).rotateY(-0.28),
    T.clothDark, { ao: 0.5, aoY0: 0.2, aoY1: 0.4 }]);
  body.push([chamferBox(0.045, 0.46, 0.02, 0.008).translate(-0.42, 0.80, 0.245).rotateY(-0.28), T.trim, { ao: 0 }]);
  body.push([chamferBox(0.34, 0.045, 0.02, 0.008).translate(-0.42, 0.94, 0.245).rotateY(-0.28), T.trim, { ao: 0 }]);
  body.push([new THREE.OctahedronGeometry(0.082, 0).scale(1, 1, 0.6).translate(-0.42, 0.62, 0.26).rotateY(-0.28), T.accent, { ao: 0 }]);

  // ---- sword arm (animated) -------------------------------------------------
  // The whole shoulder cap now rides on the animated node, so a swing moves a
  // real mass through the frame instead of waving a 0.078 m capsule.
  const arm = [];
  arm.push([chamferBox(0.22, 0.14, 0.26, 0.04).translate(0, -0.02, 0).rotateZ(-0.34).translate(-0.015, 0.045, 0.01),
    T.cloth, { ao: 0.18, aoY0: -0.14, aoY1: 0.08, top: 0.22, to: T.clothDark, y0: 0.10, y1: -0.14 }]);
  arm.push([new THREE.CapsuleGeometry(0.082, 0.21, 3, 6).translate(0, -0.13, 0), T.metalDark, { ao: 0 }]);
  arm.push([lathe([[0.092, -0.32], [0.104, -0.23], [0.080, -0.07]], 6, true), T.metal, { ao: 0 }]);
  arm.push([ell(0.072, 0.078, 0.084, 7, 5).translate(0, -0.35, 0.02), T.metal, { ao: 0 }]);
  // broad sword, held blade-up
  arm.push([chamferBox(0.038, 0.16, 0.038, 0.012).translate(0, -0.43, 0.10), T.dark, { ao: 0 }]);
  arm.push([chamferBox(0.24, 0.05, 0.07, 0.015).translate(0, -0.43, 0.10), T.trim, { ao: 0 }]);
  arm.push([chamferBox(0.115, 0.56, 0.036, 0.014).translate(0, -0.42, 0.10), 0xd6e2ee, { ao: 0, to: 0xffffff, y0: -0.4, y1: 0.16 }]);
  return { body: assemble(body), arm: assemble(arm), armPivot: new THREE.Vector3(0.30, 0.86, 0.03), orb: null };
}

function meleeRed(T) {
  const body = [];
  // bowed, heavy-set legs, wider stance than the guard
  for (const p of legPair(T, {
    hipY: 0.48, out: 0.150, fwd: 0.095, bootW: 0.165, bootD: 0.245,
    thighR: 0.115, shinR: 0.105, thighC: T.clothDark, shinC: 0x4a3325, bootC: T.dark,
  })) body.push(p);
  // ragged hide kilt
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const len = 0.20 + (i % 3) * 0.06;
    body.push([strand(0.10, len, 0.055, 0.35).rotateX(Math.PI - 0.2).translate(0, 0.52, 0.235).rotateY(a),
      T.clothDark, { ao: 0.4, aoY0: 0.25, aoY1: 0.55 }]);
  }
  // heavy hunched barrel torso
  body.push([shear(lathe([[0.265, 0.42], [0.375, 0.60], [0.395, 0.80], [0.30, 0.90]], 10), 0.30, 0.42),
    T.cloth, { ao: 0.42, aoY0: 0.3, aoY1: 0.9, top: 0.1, jitter: 0.04 }]);
  // spine spikes — fanned wide so from the game camera the back reads as an
  // ember starburst, not a smooth lid
  for (let i = 0; i < 4; i++) {
    for (const sx of (i < 2 ? [0] : [-1, 1])) {
      body.push([new THREE.ConeGeometry(0.058 - i * 0.006, 0.24 + i * 0.045, 5).rotateX(-0.95)
        .rotateY(sx * 0.5).translate(sx * (0.10 + i * 0.05), 0.52 + i * 0.13, -0.30 + i * 0.05), T.accent,
      { ao: 0, to: 0xffe0b0, y0: 0.5, y1: 1.15, top: 0.24 }]);
    }
  }
  // ember pelt over the shoulders: the up-facing team surface. Kept inside the
  // torso radius — at 0.435 it out-read the head and horns and the brute
  // resolved as an orange doughnut.
  body.push([lathe([[0.215, 1.00], [0.325, 0.92], [0.350, 0.83], [0.315, 0.76]], 10), T.cloth,
    { ao: 0.26, aoY0: 0.74, aoY1: 1.00, top: 0.26, to: T.clothDark, y0: 1.02, y1: 0.74, jitter: 0.06 }]);
  // fur ruff (dark red hide, not the old neutral brown)
  body.push([new THREE.TorusGeometry(0.285, 0.095, 6, 12).rotateX(Math.PI / 2).translate(0, 0.84, 0.06), T.clothDark,
    { ao: 0.24, aoY0: 0.72, aoY1: 0.92, jitter: 0.1 }]);
  // low forward-jutting head + horns. The skull was T.metal (0xb99a78) — the
  // exact tan that made the top-down read identical to the blue guard's helm.
  body.push([ell(0.215, 0.205, 0.225, 10, 8).translate(0, 1.03, 0.11), 0x8f4526,
    { ao: 0.25, aoY0: 0.88, aoY1: 1.10, top: 0.22, to: T.cloth, y0: 0.88, y1: 1.22 }]);
  body.push([ell(0.150, 0.095, 0.105, 8, 6).translate(0, 0.97, 0.25), T.dark, { ao: 0 }]);
  body.push([chamferBox(0.21, 0.038, 0.05, 0.012).translate(0, 1.04, 0.26), T.accent, { ao: 0 }]);
  for (const sx of [-1, 1]) {
    body.push([new THREE.TorusGeometry(0.205, 0.052, 5, 9, Math.PI * 0.90).rotateY(sx > 0 ? 0.4 : Math.PI - 0.4)
      .rotateZ(sx * -0.62).translate(sx * 0.215, 1.14, 0.02), 0xe4d6ba,
    { ao: 0, to: 0xfff0d4, y0: 0.95, y1: 1.40 }]);
    body.push([new THREE.ConeGeometry(0.032, 0.11, 5).rotateZ(sx * 0.5).translate(sx * 0.10, 1.25, -0.04), T.trim, { ao: 0 }]);
  }
  // spiked round buckler, tipped so its face catches the game camera
  body.push([new THREE.CapsuleGeometry(0.082, 0.18, 3, 6).rotateZ(1.25).translate(-0.26, 0.70, 0.08), T.clothDark, { ao: 0 }]);
  body.push([new THREE.CylinderGeometry(0.245, 0.225, 0.09, 10).rotateZ(Math.PI / 2 - 0.30).translate(-0.40, 0.64, 0.16), T.cloth,
    { ao: 0.25, aoY0: 0.4, aoY1: 0.8, jitter: 0.05, top: 0.26, to: T.clothDark, y0: 0.9, y1: 0.4 }]);
  body.push([ell(0.06, 0.10, 0.10, 7, 5).translate(-0.46, 0.64, 0.16), T.trim, { ao: 0 }]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    body.push([new THREE.ConeGeometry(0.035, 0.13, 5).rotateZ(Math.PI / 2)
      .translate(-0.50, 0.64 + Math.sin(a) * 0.15, 0.16 + Math.cos(a) * 0.15), T.metal, { ao: 0 }]);
  }

  const arm = [];
  // shoulder mass rides with the swing
  arm.push([ell(0.155, 0.135, 0.165, 8, 6).translate(-0.005, 0.03, 0.01), T.cloth,
    { ao: 0.18, aoY0: -0.12, aoY1: 0.10, top: 0.26, to: T.clothDark, y0: 0.12, y1: -0.12, jitter: 0.05 }]);
  arm.push([new THREE.CapsuleGeometry(0.090, 0.23, 3, 6).translate(0, -0.14, 0), T.clothDark, { ao: 0 }]);
  arm.push([ell(0.092, 0.135, 0.094, 8, 6).translate(0, -0.30, 0.01), 0x4a3325, { ao: 0 }]);
  // chunky curved cleaver
  {
    const s = new THREE.Shape();
    s.moveTo(0, -0.06);
    s.quadraticCurveTo(0.30, -0.14, 0.40, 0.14);
    s.quadraticCurveTo(0.35, 0.40, 0.02, 0.35);
    s.lineTo(-0.02, 0.10);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
    g.rotateY(Math.PI / 2).rotateZ(-0.2).translate(0.02, -0.32, 0.26);
    arm.push([g, 0xc9d2da, { ao: 0, to: 0xf2f7fb, y0: -0.42, y1: 0.0 }]);
  }
  arm.push([chamferBox(0.048, 0.28, 0.048, 0.014).translate(0, -0.47, 0.10), T.dark, { ao: 0 }]);
  return { body: assemble(body), arm: assemble(arm), armPivot: new THREE.Vector3(0.33, 0.82, 0.04), orb: null };
}

function casterBlue(T) {
  const body = [];
  // straight, tall, faceted robe
  body.push([lathe([[0.285, 0.0], [0.315, 0.12], [0.20, 0.82], [0.235, 1.00], [0.135, 1.24]], 6, true), T.clothDark,
    { ao: 0.5, aoY0: 0, aoY1: 0.9, top: 0.16, to: T.cloth, y0: 0.1, y1: 1.0, jitter: 0.05 }]);
  // hard-edged hem points
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    body.push([strand(0.09, 0.18, 0.05, 0.0).rotateX(Math.PI).translate(0, 0.20, 0.275).rotateY(a), T.clothDark, { ao: 0.5, aoY0: 0, aoY1: 0.22 }]);
  }
  body.push([new THREE.TorusGeometry(0.215, 0.03, 5, 6).rotateX(Math.PI / 2).translate(0, 0.80, 0), T.trim, { ao: 0 }]);
  // angular mantle
  body.push([lathe([[0.185, 1.04], [0.345, 0.90], [0.31, 0.80]], 6, true), T.clothDark, { ao: 0.25, aoY0: 0.78, aoY1: 1.04, top: 0.14 }]);
  // tall peaked hood
  body.push([lathe([[0.185, 1.10], [0.238, 1.26], [0.208, 1.48], [0.085, 1.74], [0.018, 1.90]], 6, true), T.clothDark,
    { ao: 0.2, aoY0: 1.05, aoY1: 1.6, top: 0.16, to: T.cloth, y0: 1.1, y1: 1.85 }]);
  body.push([new THREE.OctahedronGeometry(0.055, 0).scale(1, 1.5, 1).translate(0, 1.92, 0), T.accent, { ao: 0 }]);
  body.push([ell(0.155, 0.15, 0.09, 8, 6).translate(0, 1.28, 0.115), T.dark, { ao: 0 }]);
  for (const sx of [-1, 1])
    body.push([ell(0.035, 0.028, 0.02, 6, 5).translate(sx * 0.058, 1.30, 0.185), T.accent, { ao: 0 }]);
  // rune band on the chest
  body.push([chamferBox(0.20, 0.05, 0.04, 0.012).translate(0, 0.92, 0.20), T.trim, { ao: 0 }]);
  // tome arm (merged)
  body.push([new THREE.CapsuleGeometry(0.068, 0.20, 3, 6).rotateZ(1.05).translate(-0.20, 0.92, 0.10), T.clothDark, { ao: 0 }]);
  body.push([chamferBox(0.19, 0.24, 0.075, 0.02).translate(-0.30, 0.90, 0.19).rotateX(0.35), 0x9a7a42, { ao: 0 }]);
  body.push([chamferBox(0.20, 0.045, 0.085, 0.012).translate(-0.30, 0.86, 0.19).rotateX(0.35), T.trim, { ao: 0 }]);

  const arm = [];
  arm.push([new THREE.CapsuleGeometry(0.068, 0.20, 3, 6).translate(0, -0.10, 0), T.clothDark, { ao: 0 }]);
  arm.push([ell(0.062, 0.07, 0.07, 7, 5).translate(0, -0.26, 0.03), T.clothDark, { ao: 0 }]);
  arm.push([new THREE.CylinderGeometry(0.028, 0.036, 1.34, 6).translate(0.02, -0.10, 0.06), 0x6d5b45, { ao: 0 }]);
  for (let i = 0; i < 3; i++)
    arm.push([new THREE.TorusGeometry(0.038, 0.012, 4, 6).rotateX(Math.PI / 2).translate(0.02, -0.30 + i * 0.14, 0.06), T.trim, { ao: 0 }]);
  // geometric crescent finial holding the orb
  for (const sx of [-1, 1])
    arm.push([chamferBox(0.035, 0.22, 0.035, 0.012).translate(0, 0.05, 0).rotateZ(sx * 0.55).translate(0.02 + sx * 0.07, 0.44, 0.06),
      T.metal, { ao: 0 }]);
  arm.push([new THREE.OctahedronGeometry(0.055, 0).translate(0.02, 0.62, 0.06), T.trim, { ao: 0 }]);
  return {
    body: assemble(body), arm: assemble(arm),
    armPivot: new THREE.Vector3(0.255, 1.00, 0.04),
    orb: new THREE.OctahedronGeometry(0.10, 0).scale(1, 1.25, 1),
    orbPos: new THREE.Vector3(0.02, 0.50, 0.06),
  };
}

function casterRed(T) {
  const body = [];
  body.push([shear(lathe([[0.30, 0.0], [0.335, 0.12], [0.215, 0.80], [0.25, 0.96], [0.15, 1.16]], 10), 0.10, 0.5), T.cloth,
    { ao: 0.5, aoY0: 0, aoY1: 0.9, to: T.clothDark, y0: 0.4, y1: 1.16, jitter: 0.05 }]);
  // ragged hem
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    body.push([strand(0.085, 0.10 + (i % 4) * 0.07, 0.05, 0.2).rotateX(Math.PI + 0.12).translate(0, 0.16, 0.30).rotateY(a),
      T.clothDark, { ao: 0.5, aoY0: 0, aoY1: 0.2 }]);
  }
  // hunched mantle of pelts
  body.push([shear(lathe([[0.20, 1.00], [0.375, 0.86], [0.335, 0.74]], 10), 0.12, 0.7), T.metalDark,
    { ao: 0.25, aoY0: 0.7, aoY1: 1.0, jitter: 0.1 }]);
  // wide, forward-bent hood
  body.push([shear(lathe([[0.215, 1.02], [0.305, 1.18], [0.265, 1.38], [0.12, 1.54]], 10), 0.30, 1.02), T.clothDark,
    { ao: 0.2, aoY0: 1.0, aoY1: 1.45, top: 0.14, jitter: 0.06 }]);
  body.push([ell(0.165, 0.135, 0.10, 8, 6).translate(0, 1.20, 0.22), T.dark, { ao: 0 }]);
  for (const sx of [-1, 1]) {
    body.push([ell(0.035, 0.028, 0.02, 6, 5).translate(sx * 0.06, 1.22, 0.29), T.accent, { ao: 0 }]);
    body.push([new THREE.ConeGeometry(0.042, 0.19, 5).rotateX(-0.5).rotateZ(sx * 0.6).translate(sx * 0.19, 1.32, 0.12), 0xd9cbb0, { ao: 0 }]);
  }
  // bone charms
  for (let i = 0; i < 3; i++)
    body.push([ell(0.028, 0.055, 0.028, 5, 4).translate(-0.06 + i * 0.06, 0.72, 0.27), 0xcabfa4, { ao: 0 }]);
  // tome/claw arm (merged)
  body.push([new THREE.CapsuleGeometry(0.072, 0.20, 3, 6).rotateZ(0.95).translate(-0.21, 0.88, 0.14), T.clothDark, { ao: 0 }]);
  body.push([ell(0.075, 0.085, 0.085, 7, 5).translate(-0.30, 0.80, 0.22), T.metalDark, { ao: 0 }]);

  const arm = [];
  arm.push([new THREE.CapsuleGeometry(0.072, 0.20, 3, 6).translate(0, -0.10, 0), T.clothDark, { ao: 0 }]);
  arm.push([ell(0.066, 0.075, 0.075, 7, 5).translate(0, -0.26, 0.03), T.metalDark, { ao: 0 }]);
  // gnarled bent staff (two kinked segments)
  arm.push([new THREE.CylinderGeometry(0.032, 0.042, 0.80, 6).translate(0.02, -0.32, 0.06), 0x5a4632, { ao: 0, jitter: 0.08 }]);
  arm.push([new THREE.CylinderGeometry(0.026, 0.034, 0.62, 6).rotateX(0.02).rotateZ(-0.24).translate(0.10, 0.34, 0.06), 0x5a4632, { ao: 0, jitter: 0.08 }]);
  // claw finial
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    arm.push([new THREE.TorusGeometry(0.075, 0.019, 4, 7, Math.PI * 0.7).rotateY(a).rotateZ(0.9)
      .translate(0.165, 0.60, 0.06), 0xd9cbb0, { ao: 0 }]);
  }
  return {
    body: assemble(body), arm: assemble(arm),
    armPivot: new THREE.Vector3(0.26, 0.94, 0.06),
    orb: new THREE.SphereGeometry(0.115, 10, 8),
    orbPos: new THREE.Vector3(0.165, 0.66, 0.06),
  };
}

const geoCache = new Map();
function minionGeos(kind, team) {
  const key = kind + team;
  if (geoCache.has(key)) return geoCache.get(key);
  const T = TEAM[team];
  let out;
  if (kind === 'melee') out = team === 'blue' ? meleeBlue(T) : meleeRed(T);
  else out = team === 'blue' ? casterBlue(T) : casterRed(T);
  const s = MINION_SCALE[kind];
  out.body.scale(s, s, s);
  out.arm.scale(s, s, s);
  out.armPivot.multiplyScalar(s);
  if (out.orb) { out.orb.scale(s, s, s); out.orbPos.multiplyScalar(s); }
  out.orbMat = team === 'blue' ? orbBlueMat : orbRedMat;
  geoCache.set(key, out);
  return out;
}

// ---------------------------------------------------------- instance pools --
class MinionPool {
  constructor(scene, geos, cap) {
    this.cap = cap;
    this.n = 0;
    this.owners = new Array(cap).fill(null);
    this.meshes = [
      new THREE.InstancedMesh(geos.body, unitMat, cap),
      new THREE.InstancedMesh(geos.arm, unitMat, cap),
    ];
    if (geos.orb) this.meshes.push(new THREE.InstancedMesh(geos.orb, geos.orbMat, cap));
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
  }
  alloc(owner) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.owners[i] = owner;
    for (const m of this.meshes) m.count = this.n;
    return i;
  }
  release(i) {
    if (i < 0 || i >= this.n) return;
    const last = --this.n;
    if (i !== last) {
      const o = this.owners[last];
      this.owners[i] = o;
      if (o) o.slot = i;
    }
    this.owners[last] = null;
    for (const m of this.meshes) m.count = this.n;
  }
  set(part, slot, matrixWorld) {
    const m = this.meshes[part];
    if (!m || slot < 0) return;
    m.setMatrixAt(slot, matrixWorld);
    m.instanceMatrix.needsUpdate = true;
  }
}

let BATCH = null;
function poolFor(scene, kind, team) {
  if (!BATCH || BATCH.scene !== scene) BATCH = { scene, pools: new Map() };
  const key = kind + team;
  let p = BATCH.pools.get(key);
  if (!p) { p = new MinionPool(scene, minionGeos(kind, team), 26); BATCH.pools.set(key, p); }
  return p;
}

/**
 * Build all four minion pools up front instead of on their first spawn.
 *
 * A pool — its merged rig geometry, its InstancedMeshes and, critically, the
 * shared `unitMat` / orb materials — is created the first time a minion of that
 * (kind, team) is added to the scene. That is the first wave, 8 s into every
 * single match, and it costs a rig build plus the GL link for two materials on
 * one frame. main.js's shader pre-warm could not reach those materials because
 * nothing owning them existed in the scene yet: `renderer.compile()` walks the
 * graph, and an object that has not been created is not in the graph.
 *
 * The pools sit in the scene with `count = 0` until a minion allocates a slot.
 * three's `renderInstances()` returns early at `primcount === 0`, so an empty
 * pool costs zero draw calls and zero triangles — but `renderBufferDirect()`
 * still runs `setProgram()` on it, so the boot render links the program. Draw
 * calls and triangles are therefore unchanged; only the timing moves.
 */
export function prewarmUnits(scene) {
  ensureUnitMats();
  for (const kind of ['melee', 'caster'])
    for (const team of ['blue', 'red']) poolFor(scene, kind, team);
}

// ------------------------------------------------------------------- Unit --
let UID = 1;
export class Unit {
  constructor({ team, kind, maxHp, radius = 0.45, speed = 3.4, x = 0, z = 0, hpW = 0.85, hpY = 1.6 }) {
    this.id = UID++;
    this.team = team;
    this.kind = kind;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.radius = radius;
    this.speed = speed;
    this.alive = true;
    this.pos = new THREE.Vector3(x, 0, z);
    this.facing = team === 'blue' ? Math.PI / 2 : -Math.PI / 2; // toward enemy
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.hpW = hpW; this.hpY = hpY;
    this.attackCd = 0;
    this.attackAnimT = -1;
    this.target = null;
    this.isHero = false;
    this.barIdx = -1;
    this.shadowIdx = -1;
  }
  takeDamage(amount) {
    if (!this.alive) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    return dealt;
  }
  faceToward(x, z, dt = 1 / 60, rate = 14) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (!Number.isFinite(this.facing)) this.facing = 0;
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * Math.min(1, rate * dt);
  }
  // Non-finite pos/facing must never reach a matrix: one NaN in a world matrix
  // propagates into every child (cloth chains, instanced buffers, shadow maps)
  // and shows up as screen-filling garbage geometry.
  syncTransform() {
    const p = this.pos;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) p.copy(this.group.position);
    if (!Number.isFinite(this.facing)) this.facing = this.group.rotation.y || 0;
    this.group.position.copy(p);
    this.group.rotation.y = this.facing;
  }
  update(dt) { this.syncTransform(); }
}

// ------------------------------------------------------------------ Minion --
// Hit-reaction envelope: snap to the impact pose, hold it for ~0.1 s so the eye
// can catch it under the VFX, then release over the remaining ~0.24 s. A pure
// exponential decay is gone before the damage number has finished rising.
const FLINCH_DUR = 0.34;
const FLINCH_HOLD = 0.28;                        // fraction of the envelope held at full
function flinchEnv(remain) {
  const u = 1 - remain / FLINCH_DUR;             // 0 at impact -> 1 at release
  return u < FLINCH_HOLD ? 1 : 1 - sm01((u - FLINCH_HOLD) / (1 - FLINCH_HOLD));
}

export class Minion extends Unit {
  constructor(opts) {
    super({
      ...opts, kind: opts.mkind,
      radius: 0.42, speed: opts.mkind === 'melee' ? 3.5 : 3.2,
      // bar heights track MINION_SCALE — a bar left at the old height floats
      hpW: 0.76, hpY: opts.mkind === 'melee' ? 1.51 : 1.83,
    });
    ensureUnitMats();
    const g = minionGeos(opts.mkind, opts.team);
    this.geos = g;
    // pure transform rig — rendering happens through the instance pool
    this.body = new THREE.Object3D();
    this.arm = new THREE.Object3D();
    this.arm.position.copy(g.armPivot);
    this.body.add(this.arm);
    this.group.add(this.body);
    if (g.orb) {
      this.orb = new THREE.Object3D();
      this.orb.position.copy(g.orbPos);
      this.arm.add(this.orb);
    }
    this.pool = null;
    this.slot = -1;
    this._onAdded = () => {
      const parent = this.group.parent;
      if (!parent) return;
      this.pool = poolFor(parent, this.kind, this.team);
      this.slot = this.pool.alloc(this);
      this.pushMatrices();
    };
    this._onRemoved = () => {
      if (this.pool) this.pool.release(this.slot);
      this.pool = null; this.slot = -1;
    };
    this.group.addEventListener('added', this._onAdded);
    this.group.addEventListener('removed', this._onRemoved);
    // ------------------------------------------------- per-unit variation --
    // A wave used to spawn six byte-identical rigs playing the same clip on the
    // same frame: at map scale that reads as a picket fence, which is the single
    // loudest "this is a tech demo" tell in the overview shot. Everything below
    // is derived from the unit id (not Math.random) so screenshots stay
    // deterministic while no two neighbours ever match.
    const r1 = h1(this.id * 1.37), r2 = h1(this.id * 2.71 + 5.1), r3 = h1(this.id * 4.13 + 11.7);
    this.jScale = 0.95 + r1 * 0.11;          // ±5.5% mass
    this.jYaw = (r2 - 0.5) * 0.30;           // ±0.15 rad stance yaw
    this.jLean = (r3 - 0.5) * 0.09;          // ±0.045 rad stance lean
    this.jPhase = r2 * 6.2832;               // idle-break clock offset
    this.jRate = 0.80 + r3 * 0.45;           // idle-break clock rate
    this.walkPhase = r1 * 6.2832;
    this.moving = false;
    // stagger the swing length too, so two minions trading blows never land on
    // the same frame of the same animation
    this.attackDur = (opts.mkind === 'melee' ? 0.5 : 0.8) * (0.90 + r3 * 0.20);
    this.hitScale = 0;
    this.bodyLean = opts.mkind === 'melee' ? 0.05 : 0.0;
    // reaction / locomotion state (all scalars — no per-frame allocation)
    this.flinchT = 0;
    this.flinchSide = 0;
    this._hitPrev = 0;
    this._fN = 0;
    this._roll = 0; this._bx = 0; this._by = 0;
    this._armX = 0; this._armZ = 0;
  }
  playAttack() { this.attackAnimT = 0; }
  // Hit reaction. Callable directly by the sim with the attacker's position for
  // a directional knockback; with no argument the unit rocks straight back
  // along its own facing. Also auto-fires whenever the sim raises hitScale, so
  // existing damage plumbing needs no change.
  flinch(fromX, fromZ) {
    this.flinchT = FLINCH_DUR;
    if (Number.isFinite(fromX) && Number.isFinite(fromZ)) {
      // sign of the cross product of facing x (attacker - me): which cheek took it
      const f = Number.isFinite(this.facing) ? this.facing : 0;
      const dx = fromX - this.pos.x, dz = fromZ - this.pos.z;
      const side = Math.sin(f) * dz - Math.cos(f) * dx;
      this.flinchSide = side >= 0 ? 1 : -1;
    } else {
      this.flinchSide = (this._fN++ + this.id) % 2 ? 1 : -1;
    }
  }
  getMuzzle(out) {
    if (this.orb) return this.orb.getWorldPosition(out);
    out.copy(this.pos); out.y += 1.0;
    return out;
  }
  pushMatrices() {
    const p = this.pool;
    if (!p || this.slot < 0) return;
    this.group.updateMatrixWorld(true);
    p.set(0, this.slot, this.body.matrixWorld);
    p.set(1, this.slot, this.arm.matrixWorld);
    if (this.orb) p.set(2, this.slot, this.orb.matrixWorld);
  }
  update(dt) {
    // a non-finite dt used to poison walkPhase and from there every instance
    // matrix in the pool — same class of bug as the old cape NaN latch
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    const b = this.body, a = this.arm;
    // the sim raises hitScale on every damage event (and the screenshot presets
    // set it directly) — treat any rise as a fresh impact
    if (this.hitScale > this._hitPrev + 1e-3) this.flinch();

    // ------------------------------------------------------- idle break ----
    // Constant low-amplitude stance drift on a per-unit clock. Without it a rank
    // of minions is a picket fence; with it the crowd is never twice the same.
    const bt = uTime.value * this.jRate + this.jPhase;
    let lean = this.bodyLean + this.jLean + Math.sin(bt * 0.87 + 1.3) * 0.040;
    let yaw = this.jYaw + Math.sin(bt * 0.63) * 0.060;
    let push = 0;

    // ------------------------------------------------------ locomotion ----
    if (this.moving) {
      this.walkPhase += dt * this.speed * 3.1;
      const s = Math.sin(this.walkPhase);
      this._roll = s * 0.09;
      this._bx = s * 0.03;
      this._by = Math.abs(s) * 0.075;
      lean += 0.05;
      if (this.attackAnimT < 0) {
        this._armX = -s * 0.55;
        this._armZ = s * 0.1;
      }
    } else {
      this._roll *= 0.86;
      this._bx *= 0.86;
      this._by += (Math.sin(uTime.value * 2 + this.id) * 0.018 - this._by) * 0.2;
      if (this.attackAnimT < 0) { this._armX *= 0.86; this._armZ *= 0.86; }
    }

    // ---------------------------------------------------- attack lunge ----
    // `drive` runs -0.30 (coil back) -> +1 (weight through the blow) -> 0, and
    // feeds both the torso lean and a root push so the unit actually travels
    // into the swing instead of waving an arm from a fixed spot.
    if (this.attackAnimT >= 0) {
      this.attackAnimT += dt;
      const t = this.attackAnimT / this.attackDur;
      if (t >= 1) { this.attackAnimT = -1; }
      else if (this.kind === 'melee') {
        // slow coil, fast chop, settle
        if (t < 0.45) {
          const w = t / 0.45;
          this._armX = -1.75 * (w * w * (3 - 2 * w));
          this._armZ = -0.35 * w;
          yaw += 0.22 * w;
        } else {
          const w = Math.min(1, (t - 0.45) / 0.22);
          const e = outCubic(w);
          this._armX = -1.75 + 2.55 * e;
          this._armZ = -0.35 + 0.45 * e;
          yaw += 0.22 - 0.42 * e;
        }
        const drive = t < 0.45 ? -0.30 * sm01(t / 0.45)
          : t < 0.67 ? -0.30 + 1.30 * outCubic((t - 0.45) / 0.22)
            : 1 - sm01((t - 0.67) / 0.33);
        lean += drive * 0.26;
        push += drive * 0.15;
      } else {
        const w = Math.sin(Math.min(t, 1) * Math.PI);
        const cast = t < 0.55 ? t / 0.55 : 1;
        this._armX = -0.35 - 1.55 * w;
        this._armZ = 0.35 * w;
        // casters wind back onto the heel while the orb charges, then shove the
        // bolt out — the opposite phase to the melee line in front of them
        const drive = t < 0.55 ? -0.90 * sm01(t / 0.55)
          : t < 0.70 ? -0.90 + 1.90 * outCubic((t - 0.55) / 0.15)
            : 1 - sm01((t - 0.70) / 0.30);
        lean += drive * 0.17;
        push += drive * 0.07;
        if (this.orb) {
          const s = 1 + cast * 0.85 - (t > 0.6 ? (t - 0.6) * 2.0 : 0);
          this.orb.scale.setScalar(Math.max(0.4, s));
          this.orb.rotation.y += dt * 6;
        }
      }
    } else if (this.orb) {
      this.orb.scale.setScalar(1 + Math.sin(uTime.value * 3 + this.id) * 0.06);
      this.orb.rotation.y += dt * 1.4;
    }

    // ----------------------------------------------------- hit reaction ----
    // Torso rocks back, the whole rig slides back off the impact, and one
    // shoulder drops. Decays inside 0.2 s so it reads as an impact, not a limp.
    let roll = this._roll;
    let armX = this._armX, armZ = this._armZ;
    if (this.flinchT > 0) {
      this.flinchT = Math.max(0, this.flinchT - dt);
      const p = flinchEnv(this.flinchT);
      lean -= 0.18 * p;
      push -= 0.08 * p;
      roll += this.flinchSide * 0.11 * p;
      armX += 0.34 * p;                       // weapon arm thrown wide by the hit
      armZ -= this.flinchSide * 0.20 * p;
    }
    if (this.hitScale > 0) this.hitScale = Math.max(0, this.hitScale - dt * 4);
    this._hitPrev = this.hitScale;

    a.rotation.x = armX;
    a.rotation.z = armZ;
    b.rotation.x = lean;
    b.rotation.y = yaw;
    b.rotation.z = roll;
    b.position.x = this._bx;
    b.position.y = this._by;
    b.position.z = push;
    b.scale.setScalar(this.jScale * (1 + this.hitScale * 0.12));
    this.syncTransform();
    this.pushMatrices();
  }
}

// -------------------------------------------------------------- Tower unit --
export class Tower extends Unit {
  constructor({ team, x, z, tier, built }) {
    super({ team, kind: 'tower', maxHp: 1450, radius: 2.15, speed: 0, x, z, hpW: 2.0, hpY: 8.7 });
    this.tier = tier;
    this.range = 9.6;
    this.built = built; // {group, crystal, rubble}
    this.group = built.group;
    this.group.position.set(x, 0, z);
    this.chargeT = 0; // 0..1 charging glow
    this.beamCd = 0;
  }
  update(dt) {
    const c = this.built.crystal;
    if (this.alive) {
      c.rotation.y += dt * (0.6 + this.chargeT * 6);
      c.position.y = 7.65 + Math.sin(uTime.value * 1.4 + this.id) * 0.12;
      const s = 1 + this.chargeT * 0.35 + Math.sin(uTime.value * 3 + this.id) * 0.04;
      c.scale.setScalar(s);
    }
  }
  destroy() {
    this.alive = false;
    for (const m of Object.values(this.built.body)) m.visible = false;
    this.built.crystal.visible = false;
    this.built.rubble.visible = true;
  }
}

// -------------------------------------------------------------- Nexus unit --
export class Nexus extends Unit {
  constructor({ team, x, z, built }) {
    super({ team, kind: 'nexus', maxHp: 2400, radius: 2.6, speed: 0, x, z, hpW: 2.6, hpY: 7.3 });
    this.built = built;
    this.group = built.group;
    this.group.position.set(x, 0, z);
    this.invulnerable = true; // until inner tower falls
  }
  update(dt) {
    if (!this.alive) return;
    const b = this.built;
    b.crystal.rotation.y += dt * 0.7;
    b.crystal.position.y = 4.1 + Math.sin(uTime.value * 1.1 + this.id) * 0.22;
    b.rings[0].rotation.z += dt * 0.45;
    b.rings[1].rotation.z -= dt * 0.3;
    for (const sh of b.shards.children) {
      sh.userData.a += dt * 0.5;
      sh.position.x = Math.cos(sh.userData.a) * 2.1;
      sh.position.z = Math.sin(sh.userData.a) * 2.1;
      sh.position.y = 3.6 + Math.sin(uTime.value * 1.3 + sh.userData.a * 3) * 0.4;
      sh.rotation.y += dt;
    }
  }
  destroy() {
    this.alive = false;
    this.built.crystal.visible = false;
    this.built.shards.visible = false;
  }
}

// ---------------------------------------------------------------- HP bars --
export class HPBars {
  constructor(scene, cap = 48) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // frac,w,on,isPlayer
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = cap;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: {},
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aData; attribute vec3 aCol;
        varying vec2 vUv; varying vec4 vData; varying vec3 vCol;
        void main() {
          vUv = uv; vData = aData; vCol = aCol;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = aPos + right * position.x * aData.y * aData.z + up * position.y * 0.19 * aData.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec4 vData; varying vec3 vCol;
        void main() {
          if (vData.z < 0.5) discard;
          // thicker frame: at gameplay distance a hairline border disappears and
          // the bars read as bare colour swatches
          vec2 b = vec2(0.075, 0.24);
          float border = step(vUv.x, b.x) + step(1.0 - b.x, vUv.x) + step(vUv.y, b.y) + step(1.0 - b.y, vUv.y);
          float gold = vData.w;
          vec3 frame = mix(vec3(0.02, 0.02, 0.03), vec3(0.95, 0.78, 0.4), gold * 0.85);
          float fill = step((vUv.x - b.x) / (1.0 - b.x * 2.0), vData.x);
          vec3 hpCol = vCol * (0.75 + 0.5 * smoothstep(0.2, 0.9, vUv.y));
          vec3 col = mix(vec3(0.13, 0.05, 0.06), hpCol, fill);
          // segment ticks every 25%
          float seg = step(0.94, fract((vUv.x - b.x) / (1.0 - b.x * 2.0) * 4.0 + 0.001));
          col = mix(col, col * 0.55, seg * fill);
          col = mix(col, frame, clamp(border, 0.0, 1.0));
          gl_FragColor = vec4(col, 0.92);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
  }
  alloc() { return this.free.length ? this.free.pop() : -1; }
  release(i) {
    if (i < 0) return;
    this.aData.array[i * 4 + 2] = 0;
    this.free.push(i);
    this.aData.needsUpdate = true;
  }
  set(i, x, y, z, frac, w, colorHex, isPlayer = 0) {
    if (i < 0) return;
    this.aPos.array[i * 3] = x; this.aPos.array[i * 3 + 1] = y; this.aPos.array[i * 3 + 2] = z;
    const d = this.aData.array;
    d[i * 4] = frac; d[i * 4 + 1] = w; d[i * 4 + 2] = 1; d[i * 4 + 3] = isPlayer;
    const c = this.aCol.array;
    const r = ((colorHex >> 16) & 255) / 255, g = ((colorHex >> 8) & 255) / 255, b = (colorHex & 255) / 255;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  }
  flush() {
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }
}

// --------------------------------------------------------- contact shadows --
// One instanced draw for every character's ground contact.
//
// This used to be a centred, circular, airbrushed dot at alpha 0.5 — which is a
// generic AO puddle, not a shadow: it has no light direction, and its softest
// value is exactly where the foot meets the floor, so the foot never gets an
// anchor. Combined with environment.js's `sun.shadow.normalBias = 0.55` (about
// 0.2 m of peter-panning on a 1 m caster) the result was characters hovering
// over their own shadow maps.
//
// The replacement is a real contact shadow: a hard, near-opaque core clamped to
// the feet, plus a soft penumbra stretched along the sun's ground direction and
// fading with distance. Same one draw call, no texture fetch.
export class BlobShadows {
  constructor(scene, cap = 40) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // xyz + scale
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.instanceCount = cap;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      // The paving is not a plane — tiles carry per-tile height variation of a
      // few cm — and sim.js posts the blob at only ground + 0.03, so without a
      // depth bias the quad was being eaten tile by tile and survived as
      // triangular slivers. Offset in depth rather than in Y so it still hugs
      // sloped ground and is still occluded by real geometry standing in front.
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10,
      uniforms: { uSunG: { value: SUN_GROUND } },
      vertexShader: `
        attribute vec4 aPos;
        uniform vec2 uSunG;
        varying vec2 vL; varying float vOn;
        void main() {
          vOn = step(0.01, aPos.w);
          // local frame: +x runs down-sun (where the shadow falls), +y across
          vec2 perp = vec2(-uSunG.y, uSunG.x);
          float s = aPos.w;
          // the quad is offset down-sun so the contact end sits at the feet
          vec2 off = uSunG * (position.x * 2.05 * s + 0.56 * s) + perp * (position.z * 1.26 * s);
          vL = vec2(position.x, position.z) * 2.0;
          gl_Position = projectionMatrix * viewMatrix
            * vec4(aPos.xyz + vec3(off.x, 0.045, off.y), 1.0);
        }`,
      fragmentShader: `
        varying vec2 vL; varying float vOn;
        void main() {
          // Soft-edged ellipse, full value across the inner half. NB every
          // smoothstep here keeps edge0 < edge1: reversed edges are undefined
          // in GLSL ES and SwiftShader returns 0, which silently deleted the
          // whole penumbra in an earlier pass.
          float e = length(vL);
          float pen = 1.0 - smoothstep(0.28, 1.0, e);
          // dense at the feet, opening out toward the tip of the shadow
          pen *= 0.52 + 0.48 * (1.0 - smoothstep(-0.9, 0.9, vL.x));
          // hard contact core clamped under the feet (vL.x = -0.54 is the body)
          float c = length(vec2((vL.x + 0.54) * 2.30, vL.y * 1.65));
          float core = 1.0 - smoothstep(0.10, 1.0, c);
          // 0.8 at the contact, ~0.45 through the body of the penumbra. A real
          // shadow here is ~45% of the lit paving, and ACES's shoulder eats
          // anything gentler: at alpha 0.4 the measured darkening was 3 luma.
          float a = pen * 0.60 + core * 0.40;
          gl_FragColor = vec4(0.024, 0.048, 0.068, min(a, 0.86) * vOn);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
  }
  alloc() { return this.free.length ? this.free.pop() : -1; }
  release(i) {
    if (i < 0) return;
    this.aPos.array[i * 4 + 3] = 0;
    this.free.push(i);
    this.aPos.needsUpdate = true;
  }
  set(i, x, y, z, scale) {
    if (i < 0) return;
    const a = this.aPos.array;
    a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; a[i * 4 + 3] = scale;
  }
  flush() { this.aPos.needsUpdate = true; }
}
