// Unit base class (hp, team, movement), billboard HP bars (single instanced
// draw), blob shadows, and the minion rigs.
//
// Minions are drawn through InstancedMesh pools: one pool per (kind, team) with
// 2-3 instanced meshes each, so the whole army costs ~10 draw calls no matter
// how many minions are alive. The per-minion Object3D hierarchy is kept purely
// as a transform rig; its world matrices are copied into the instance buffers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, uTime, patchMaterial } from '../core/assets.js';
import { chamferBox, lathe } from '../world/props.js';

// ---------------------------------------------------------------- helpers --
const _c0 = new THREE.Color(), _c1 = new THREE.Color();
const _mtmp = new THREE.Matrix4();

export const SUN_DIR = new THREE.Vector3(-0.42, 0.62, -0.55).normalize();

function h3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

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

// Fresnel rim: warm gold on the sun-facing side, cool teal from ambient. This is
// what lifts characters off the ground plane at MOBA camera distance.
export function addDualRim(mat, { warm = 0xffd79a, cool = 0x63c9e8, power = 2.7, strength = 0.34 } = {}) {
  const cw = new THREE.Color(warm), cc = new THREE.Color(cool);
  return patchMaterial(mat, {
    id: `drim${warm.toString(16)}_${cool.toString(16)}_${power}_${strength}`,
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
            float lit = smoothstep( -0.5, 0.62, dot( nrm, sunV ) );
            totalEmissiveRadiance += mix( uRimC, uRimW, lit ) * ( rimF * ${strength.toFixed(3)} );
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
  addDualRim(unitMat, { warm: 0xffd08a, cool: 0x6fcdf0, power: 2.4, strength: 0.34 });
  orbBlueMat = new THREE.MeshStandardMaterial({
    color: 0x0d2b4c, emissive: 0x5fd0ff, emissiveIntensity: 2.0, roughness: 0.24, metalness: 0,
  });
  orbRedMat = new THREE.MeshStandardMaterial({
    color: 0x4d1608, emissive: 0xff8036, emissiveIntensity: 2.0, roughness: 0.24, metalness: 0,
  });
}

const TEAM = {
  blue: {
    cloth: 0x4f86dc, clothDark: 0x2b4d96, metal: 0xd2dced, metalDark: 0x8296b0,
    trim: 0xf3cf76, accent: 0xa6e6ff, dark: 0x151d2e,
  },
  red: {
    cloth: 0xd9603a, clothDark: 0x8e3520, metal: 0xc3ab93, metalDark: 0x7a604b,
    trim: 0xefac52, accent: 0xffb478, dark: 0x22110a,
  },
};
// Minions read at ~2.5 m on a phone screen: keep them chunky.
const MINION_SCALE = { melee: 1.12, caster: 1.06 };

// ============================================================ minion rigs ==
// Shape language: BLUE reads as ordered sanctum guard — hexagonal/faceted forms,
// hard points, tall crest, straight kite shield, symmetric. RED reads as ember
// raider — round organic volumes, heavy hunch, horns, jagged spiked buckler.

function meleeBlue(T) {
  const body = [];
  // greaves + boots
  body.push([lathe([[0.235, 0.03], [0.30, 0.13], [0.275, 0.28], [0.245, 0.44]], 6, true), T.metalDark,
    { ao: 0.5, aoY0: 0, aoY1: 0.5, to: T.metal, y0: 0.1, y1: 0.44 }]);
  for (const sx of [-1, 1])
    body.push([chamferBox(0.165, 0.115, 0.29, 0.03).translate(sx * 0.115, 0, 0.05), T.dark, { ao: 0.35, aoY0: 0, aoY1: 0.2 }]);
  // faceted torso, slight forward hunch
  body.push([shear(lathe([[0.245, 0.44], [0.325, 0.60], [0.35, 0.82], [0.285, 0.96]], 6, true), 0.14, 0.44),
    T.metal, { ao: 0.42, aoY0: 0.3, aoY1: 0.95, top: 0.1 }]);
  // tassets: four angular plates overlapping the greaves
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    body.push([chamferBox(0.20, 0.20, 0.055, 0.02).translate(0, -0.20, 0).rotateX(-0.15).translate(0, 0.55, 0.20).rotateY(a),
      T.cloth, { ao: 0.42, aoY0: 0.3, aoY1: 0.55 }]);
  }
  // tabard plate + trim
  body.push([chamferBox(0.26, 0.34, 0.07, 0.025).translate(0, 0.50, 0.235).rotateX(-0.06), T.cloth, { ao: 0.3, aoY0: 0.45, aoY1: 0.8 }]);
  body.push([chamferBox(0.06, 0.30, 0.03, 0.012).translate(0, 0.52, 0.28), T.trim, { ao: 0 }]);
  // pauldrons (angular wedges, inset into the torso)
  for (const sx of [-1, 1])
    body.push([chamferBox(0.24, 0.16, 0.28, 0.045).translate(0, 0.08, 0).rotateZ(sx * 0.42).translate(sx * 0.26, 0.86, 0.02),
      T.metal, { ao: 0.22, aoY0: 0.7, aoY1: 0.95, top: 0.16 }]);
  // gorget + tall crested helm
  body.push([lathe([[0.135, 0.94], [0.20, 1.00], [0.175, 1.07]], 6, true), T.trim, { ao: 0.2, aoY0: 0.9, aoY1: 1.05 }]);
  body.push([lathe([[0.06, 1.02], [0.185, 1.12], [0.195, 1.26], [0.10, 1.38]], 6, true), T.metal,
    { ao: 0.25, aoY0: 1.0, aoY1: 1.3, top: 0.18 }]);
  body.push([strand(0.05, 0.30, 0.035).rotateX(0.25).translate(0, 1.24, -0.02), T.accent, { ao: 0 }]);
  body.push([chamferBox(0.25, 0.05, 0.06, 0.012).translate(0, 1.19, 0.155), T.dark, { ao: 0 }]);
  body.push([chamferBox(0.06, 0.14, 0.06, 0.015).translate(0, 1.06, 0.17), T.metalDark, { ao: 0 }]);
  // shield arm braced forward (merged: it doesn't animate)
  body.push([new THREE.CapsuleGeometry(0.078, 0.20, 3, 6).rotateZ(1.15).translate(-0.27, 0.75, 0.06), T.metalDark, { ao: 0 }]);
  body.push([chamferBox(0.30, 0.44, 0.075, 0.035).translate(-0.40, 0.78, 0.20).rotateY(-0.28), T.cloth,
    { ao: 0.3, aoY0: 0.3, aoY1: 0.75 }]);
  body.push([new THREE.ConeGeometry(0.215, 0.24, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(-0.40, 0.34, 0.20).rotateY(-0.28),
    T.cloth, { ao: 0.5, aoY0: 0.2, aoY1: 0.4 }]);
  body.push([chamferBox(0.045, 0.40, 0.02, 0.008).translate(-0.40, 0.78, 0.245).rotateY(-0.28), T.trim, { ao: 0 }]);
  body.push([new THREE.OctahedronGeometry(0.075, 0).scale(1, 1, 0.6).translate(-0.40, 0.58, 0.26).rotateY(-0.28), T.trim, { ao: 0 }]);

  // sword arm (animated)
  const arm = [];
  arm.push([new THREE.CapsuleGeometry(0.078, 0.20, 3, 6).translate(0, -0.11, 0), T.metalDark, { ao: 0 }]);
  arm.push([lathe([[0.085, -0.30], [0.095, -0.22], [0.075, -0.06]], 6, true), T.metal, { ao: 0 }]);
  arm.push([ell(0.07, 0.075, 0.08, 7, 5).translate(0, -0.33, 0.02), T.metal, { ao: 0 }]);
  // stubby broad sword, held blade-up
  arm.push([chamferBox(0.035, 0.15, 0.035, 0.012).translate(0, -0.40, 0.10), T.dark, { ao: 0 }]);
  arm.push([chamferBox(0.20, 0.045, 0.065, 0.015).translate(0, -0.40, 0.10), T.trim, { ao: 0 }]);
  arm.push([chamferBox(0.105, 0.46, 0.035, 0.014).translate(0, -0.39, 0.10), 0xd6e2ee, { ao: 0, to: 0xffffff, y0: -0.4, y1: 0.1 }]);
  return { body: assemble(body), arm: assemble(arm), armPivot: new THREE.Vector3(0.30, 0.84, 0.03), orb: null };
}

function meleeRed(T) {
  const body = [];
  body.push([lathe([[0.27, 0.03], [0.325, 0.13], [0.30, 0.28], [0.265, 0.42]], 9), T.metalDark,
    { ao: 0.5, aoY0: 0, aoY1: 0.5, jitter: 0.05 }]);
  for (const sx of [-1, 1])
    body.push([ell(0.115, 0.075, 0.17, 7, 5).translate(sx * 0.125, 0.06, 0.06), T.dark, { ao: 0.3, aoY0: 0, aoY1: 0.15 }]);
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
  // spine spikes
  for (let i = 0; i < 3; i++)
    body.push([new THREE.ConeGeometry(0.05 - i * 0.008, 0.17 + i * 0.02, 5).rotateX(-0.9)
      .translate(0, 0.56 + i * 0.13, -0.28 + i * 0.05), T.metal, { ao: 0 }]);
  // fur ruff
  body.push([new THREE.TorusGeometry(0.28, 0.10, 6, 12).rotateX(Math.PI / 2).translate(0, 0.86, 0.06), T.metalDark,
    { ao: 0.2, aoY0: 0.75, aoY1: 0.92, jitter: 0.1 }]);
  // low forward-jutting head + horns
  body.push([ell(0.20, 0.185, 0.21, 10, 8).translate(0, 0.99, 0.12), T.metal, { ao: 0.25, aoY0: 0.85, aoY1: 1.05, top: 0.16 }]);
  body.push([ell(0.145, 0.09, 0.10, 8, 6).translate(0, 0.93, 0.25), T.dark, { ao: 0 }]);
  for (const sx of [-1, 1])
    body.push([new THREE.TorusGeometry(0.115, 0.036, 5, 8, Math.PI * 0.8).rotateY(sx > 0 ? 0.4 : Math.PI - 0.4)
      .rotateZ(sx * -0.5).translate(sx * 0.16, 1.10, 0.06), 0xd9cbb0, { ao: 0 }]);
  // spiked round buckler
  body.push([new THREE.CapsuleGeometry(0.082, 0.18, 3, 6).rotateZ(1.25).translate(-0.26, 0.70, 0.08), T.clothDark, { ao: 0 }]);
  body.push([new THREE.CylinderGeometry(0.245, 0.225, 0.09, 10).rotateZ(Math.PI / 2).translate(-0.40, 0.62, 0.16), T.metalDark,
    { ao: 0.25, aoY0: 0.4, aoY1: 0.8, jitter: 0.05 }]);
  body.push([ell(0.06, 0.10, 0.10, 7, 5).translate(-0.46, 0.62, 0.16), T.trim, { ao: 0 }]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    body.push([new THREE.ConeGeometry(0.035, 0.13, 5).rotateZ(Math.PI / 2)
      .translate(-0.50, 0.62 + Math.sin(a) * 0.15, 0.16 + Math.cos(a) * 0.15), T.metal, { ao: 0 }]);
  }

  const arm = [];
  arm.push([new THREE.CapsuleGeometry(0.085, 0.22, 3, 6).translate(0, -0.12, 0), T.clothDark, { ao: 0 }]);
  arm.push([ell(0.088, 0.13, 0.09, 8, 6).translate(0, -0.28, 0.01), T.metalDark, { ao: 0 }]);
  // chunky curved cleaver
  {
    const s = new THREE.Shape();
    s.moveTo(0, -0.06);
    s.quadraticCurveTo(0.26, -0.12, 0.34, 0.12);
    s.quadraticCurveTo(0.30, 0.34, 0.02, 0.30);
    s.lineTo(-0.02, 0.10);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 1 });
    g.rotateY(Math.PI / 2).rotateZ(-0.2).translate(0.02, -0.30, 0.24);
    arm.push([g, 0xc9d2da, { ao: 0, to: 0xf2f7fb, y0: -0.4, y1: 0.0 }]);
  }
  arm.push([chamferBox(0.045, 0.26, 0.045, 0.014).translate(0, -0.44, 0.10), T.dark, { ao: 0 }]);
  return { body: assemble(body), arm: assemble(arm), armPivot: new THREE.Vector3(0.32, 0.80, 0.04), orb: null };
}

function casterBlue(T) {
  const body = [];
  // straight, tall, faceted robe
  body.push([lathe([[0.285, 0.0], [0.315, 0.12], [0.20, 0.82], [0.235, 1.00], [0.135, 1.24]], 6, true), T.cloth,
    { ao: 0.5, aoY0: 0, aoY1: 0.9, to: T.clothDark, y0: 0.5, y1: 1.24 }]);
  // hard-edged hem points
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    body.push([strand(0.09, 0.18, 0.05, 0.0).rotateX(Math.PI).translate(0, 0.20, 0.275).rotateY(a), T.clothDark, { ao: 0.5, aoY0: 0, aoY1: 0.22 }]);
  }
  body.push([new THREE.TorusGeometry(0.215, 0.03, 5, 6).rotateX(Math.PI / 2).translate(0, 0.80, 0), T.trim, { ao: 0 }]);
  // angular mantle
  body.push([lathe([[0.185, 1.04], [0.345, 0.90], [0.31, 0.80]], 6, true), T.clothDark, { ao: 0.25, aoY0: 0.78, aoY1: 1.04, top: 0.14 }]);
  // tall peaked hood
  body.push([lathe([[0.185, 1.10], [0.235, 1.24], [0.205, 1.42], [0.09, 1.62], [0.02, 1.72]], 6, true), T.clothDark,
    { ao: 0.2, aoY0: 1.05, aoY1: 1.5, top: 0.16, to: T.cloth, y0: 1.1, y1: 1.7 }]);
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
  body.push([shear(lathe([[0.20, 1.04], [0.28, 1.18], [0.245, 1.36], [0.11, 1.50]], 10), 0.26, 1.04), T.clothDark,
    { ao: 0.2, aoY0: 1.0, aoY1: 1.4, top: 0.14 }]);
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
export class Minion extends Unit {
  constructor(opts) {
    super({
      ...opts, kind: opts.mkind,
      radius: 0.42, speed: opts.mkind === 'melee' ? 3.5 : 3.2,
      hpW: 0.8, hpY: opts.mkind === 'melee' ? 1.68 : 2.0,
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
    this.walkPhase = Math.random() * 6.28;
    this.moving = false;
    this.attackDur = opts.mkind === 'melee' ? 0.5 : 0.8;
    this.hitScale = 0;
    this.bodyLean = opts.mkind === 'melee' ? 0.05 : 0.0;
  }
  playAttack() { this.attackAnimT = 0; }
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
    const b = this.body, a = this.arm;
    if (this.moving) {
      this.walkPhase += dt * this.speed * 3.1;
      const s = Math.sin(this.walkPhase);
      b.rotation.z = s * 0.09;
      b.rotation.x = this.bodyLean + 0.05;
      b.position.y = Math.abs(s) * 0.075;
      b.position.x = s * 0.03;
      if (this.attackAnimT < 0) {
        a.rotation.x = -s * 0.55;
        a.rotation.z = s * 0.1;
      }
    } else {
      b.rotation.z *= 0.86;
      b.rotation.x += (this.bodyLean - b.rotation.x) * 0.14;
      b.position.x *= 0.86;
      b.position.y += (Math.sin(uTime.value * 2 + this.id) * 0.018 - b.position.y) * 0.2;
      if (this.attackAnimT < 0) { a.rotation.x *= 0.86; a.rotation.z *= 0.86; }
    }
    if (this.attackAnimT >= 0) {
      this.attackAnimT += dt;
      const t = this.attackAnimT / this.attackDur;
      if (t >= 1) { this.attackAnimT = -1; }
      else if (this.kind === 'melee') {
        // slow coil, fast chop, settle
        if (t < 0.45) {
          const w = t / 0.45;
          a.rotation.x = -1.75 * (w * w * (3 - 2 * w));
          a.rotation.z = -0.35 * w;
          b.rotation.x = this.bodyLean - 0.12 * w;
          b.rotation.y = 0.22 * w;
        } else {
          const w = Math.min(1, (t - 0.45) / 0.22);
          const e = 1 - Math.pow(1 - w, 3);
          a.rotation.x = -1.75 + 2.55 * e;
          a.rotation.z = -0.35 + 0.45 * e;
          b.rotation.x = this.bodyLean - 0.12 + 0.34 * e;
          b.rotation.y = 0.22 - 0.42 * e;
        }
      } else {
        const w = Math.sin(Math.min(t, 1) * Math.PI);
        const cast = t < 0.55 ? t / 0.55 : 1;
        a.rotation.x = -0.35 - 1.55 * w;
        a.rotation.z = 0.35 * w;
        b.rotation.x = this.bodyLean - 0.12 * w;
        if (this.orb) {
          const s = 1 + cast * 0.85 - (t > 0.6 ? (t - 0.6) * 2.0 : 0);
          this.orb.scale.setScalar(Math.max(0.4, s));
          this.orb.rotation.y += dt * 6;
        }
      }
    } else if (this.orb) {
      this.orb.scale.setScalar(1 + Math.sin(uTime.value * 3 + this.id) * 0.06);
      this.orb.rotation.y += dt * 1.4;
      this.body.rotation.y *= 0.9;
    }
    if (this.hitScale > 0) {
      this.hitScale = Math.max(0, this.hitScale - dt * 4);
      b.scale.setScalar(1 + this.hitScale * 0.12);
    }
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
          vec3 wp = aPos + right * position.x * aData.y * aData.z + up * position.y * 0.16 * aData.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec4 vData; varying vec3 vCol;
        void main() {
          if (vData.z < 0.5) discard;
          vec2 b = vec2(0.045, 0.16);
          float border = step(vUv.x, b.x) + step(1.0 - b.x, vUv.x) + step(vUv.y, b.y) + step(1.0 - b.y, vUv.y);
          float gold = vData.w;
          vec3 frame = mix(vec3(0.05, 0.06, 0.09), vec3(0.95, 0.78, 0.4), gold * 0.85);
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

// ------------------------------------------------------------ blob shadows --
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
      uniforms: { tMap: { value: tex.dot } },
      vertexShader: `
        attribute vec4 aPos;
        varying vec2 vUv; varying float vOn;
        void main() {
          vUv = uv; vOn = step(0.01, aPos.w);
          vec3 wp = aPos.xyz + position * aPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying float vOn;
        void main() {
          float a = texture2D(tMap, vUv).a;
          gl_FragColor = vec4(0.02, 0.03, 0.05, a * a * 0.5 * vOn);
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
