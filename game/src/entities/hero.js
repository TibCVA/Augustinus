// Hero rig builder + procedural animation state machine.
//
// Sera, Blade of Dawn (BLUE) and Kargath, Ember Warlord (RED) share a skeleton
// but nothing else: proportions, plating, headgear, weapon and cloth are built
// separately so the two silhouettes never read as recolours of each other.
//
// Everything a joint carries is merged into at most three meshes (matte body /
// metal plate / emissive) using vertex colours, so a fully detailed hero costs
// ~21 draw calls instead of one per part. Rim light (warm gold from the sun
// side, cool teal from ambient) is injected into every material — that fresnel
// edge is what separates a MOBA character from a grey mannequin.
import * as THREE from 'three';
import { tex, uTime } from '../core/assets.js';
import { chamferBox, lathe } from '../world/props.js';
import { Unit, assemble, addDualRim, addVertexGlow, ell, cbox, strand } from './units.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m4 = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

function sm01(x) { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); }
function outCubic(x) { x = THREE.MathUtils.clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
function outQuint(x) { x = THREE.MathUtils.clamp(x, 0, 1); return 1 - Math.pow(1 - x, 5); }
function inQuad(x) { x = THREE.MathUtils.clamp(x, 0, 1); return x * x; }

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
// partial revolve (armour band / collar) — real thickness via an out-and-back profile
function band(rIn, rOut, y0, y1, seg = 14) {
  return lathe([[rIn, y0], [rOut, (y0 + y1) * 0.5], [rOut * 0.99, y1], [rIn * 0.96, y1]], seg);
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
    const t = THREE.MathUtils.clamp(p.getZ(i) / len, 0, 1);
    let f = 1 - 0.16 * t;
    if (t > 0.84) f *= Math.max(0.03, 1 - Math.pow((t - 0.84) / 0.16, 1.25));
    p.setX(i, p.getX(i) * f);
    p.setY(i, p.getY(i) * f);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2); // length now runs along +Y, thickness along Z
  return g;
}

// ------------------------------------------------------------------- cape --
// One draw call. Rows are transformed in the vertex shader by a CPU-run chain
// so the cloth lags behind on turns, billows on dashes and never clips the body.
class Cape {
  constructor(mat, o) {
    this.rows = o.rows; this.seg = o.seg;
    this.uT = []; this.uR = [];
    for (let i = 0; i < this.rows; i++) { this.uT.push(new THREE.Vector3()); this.uR.push(new THREE.Matrix3()); }
    this.nodes = []; this.dirs = []; this.stiff = [];
    for (let i = 0; i < this.rows; i++) {
      this.nodes.push(new THREE.Vector3(0, -i * this.seg, 0));
      this.dirs.push(new THREE.Vector3(0, -1, -0.06).normalize());
      this.stiff.push(26 - i * 2.6);
    }
    this.geo = this.build(o);
    // wrap whatever patches the material already carries (rim light) with the
    // per-row vertex transform
    this.patch(mat, this.rows, this.uT, this.uR);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.phase = Math.random() * 10;
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
    const { rows, seg, cols, w0, w1, thick, curl = 0.09, ragged = 0, fold = 0.05, folds = 3 } = o;
    const nx = cols + 1;
    const N = rows * nx;
    const pos = new Float32Array(N * 2 * 3);
    const uvs = new Float32Array(N * 2 * 2);
    const aRow = new Float32Array(N * 2);
    const aLoc = new Float32Array(N * 2 * 3);
    const cols3 = new Float32Array(N * 2 * 3);
    const idx = [];
    const put = (base, i, j, sgn) => {
      const k = base + i * nx + j;
      const u = (j / cols) * 2 - 1;
      const hw = w0 + (w1 - w0) * (i / (rows - 1));
      let y = -i * seg;
      if (ragged && i === rows - 1) y -= ragged * (j % 2 === 0 ? 0 : 1);
      const f = i / (rows - 1);
      const x = u * hw;
      // baked vertical folds so the cloth never reads as a flat board
      const fz = Math.sin((j / cols) * Math.PI * folds) * fold * (0.25 + 0.75 * f);
      const z = -curl * u * u - sgn * thick * 0.5 + fz;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      aLoc[k * 3] = x; aLoc[k * 3 + 1] = y + i * seg; aLoc[k * 3 + 2] = z;
      aRow[k] = i;
      uvs[k * 2] = j / cols; uvs[k * 2 + 1] = 1 - f;
      const sh = (1 - 0.16 * f * f) * (1 + 0.10 * Math.cos((j / cols) * Math.PI * folds));
      cols3[k * 3] = sh; cols3[k * 3 + 1] = sh; cols3[k * 3 + 2] = sh;
    };
    for (let i = 0; i < rows; i++) for (let j = 0; j < nx; j++) { put(0, i, j, 1); put(N, i, j, -1); }
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
  // ctx: lean (0..1 backward), side (turn lag), lift (billow up), gust
  update(dt, ctx) {
    this.phase += dt;
    const R = this.rows;
    for (let i = 1; i < R; i++) {
      const f = i / (R - 1);
      const flap = Math.sin(this.phase * 3.1 - i * 0.85) * (0.05 + 0.11 * f) * (0.35 + ctx.lean);
      _v1.set(
        ctx.side * (0.22 + 0.75 * f) + Math.sin(this.phase * 1.6 + i * 0.7) * 0.045 * (0.3 + f),
        -1 + ctx.lift * (0.35 + 0.8 * f),
        -(0.08 + ctx.lean * (0.45 + 0.75 * f)) + flap,
      ).normalize();
      if (_v1.z > -0.04) { _v1.z = -0.04; _v1.normalize(); }   // never swing into the body
      const k = 1 - Math.exp(-this.stiff[i] * dt);
      this.dirs[i].lerp(_v1, k).normalize();
      this.nodes[i].copy(this.nodes[i - 1]).addScaledVector(this.dirs[i], this.seg);
    }
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
const SERA = {
  hero: 'sera',
  plate: 0xf8f4e8, plateShade: 0xd8dfee, plate2: 0x4c7fe0, trim: 0xf7c65e,
  cloth: 0x3b52b4, clothDark: 0x232c74, skin: 0xfbd9b8, skinShade: 0xe6ad88,
  hair: 0xffd86e, hairTip: 0xfff3cd, steel: 0xe3ecf7, core: 0x7cf0ff,
  capeTex: 'clothBlue', rimW: 0xffd79a, rimC: 0x74d3f0,
  scale: 1.20, bulk: 1.04, headR: 0.218, hipY: 1.00, shX: 0.268, shY: 0.46,
};
const KARGATH = {
  hero: 'kargath',
  plate: 0x949aa4, plateShade: 0x62666f, plate2: 0xc4522f, trim: 0xeaa550,
  cloth: 0x7a2f1e, clothDark: 0x431a14, skin: 0xd89a67, skinShade: 0xa66c44,
  hair: 0x3d332a, hairTip: 0x5d5042, steel: 0xd0c9ba, core: 0xff9440,
  capeTex: 'clothRed', rimW: 0xffc078, rimC: 0x8fb6d8,
  scale: 1.30, bulk: 1.32, headR: 0.225, hipY: 0.95, shX: 0.315, shY: 0.43,
};

// ------------------------------------------------------------- rig builder --
function buildRig(spec) {
  const rig = { joints: {}, mats: [], spec };
  const root = new THREE.Group();
  rig.root = root;
  root.scale.setScalar(spec.scale);
  const S = spec.hero === 'sera';
  const B = spec.bulk;

  // No env map in the scene: metalness above ~0.3 reads as black, so the
  // "metal" look comes from a tight roughness + the fresnel rim instead.
  const mBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.03 });
  const mPlate = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.44, metalness: 0.22 });
  const mGlow = new THREE.MeshStandardMaterial({
    vertexColors: true, color: 0x0a1218, emissive: 0xffffff, emissiveIntensity: 1.05,
    roughness: 0.22, metalness: 0,
  });
  const mCape = new THREE.MeshStandardMaterial({
    map: tex[spec.capeTex], vertexColors: true, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
  });
  addDualRim(mBody, { warm: spec.rimW, cool: spec.rimC, power: 2.9, strength: 0.32 });
  addDualRim(mPlate, { warm: spec.rimW, cool: spec.rimC, power: 2.1, strength: 0.5 });
  addDualRim(mCape, { warm: spec.rimW, cool: spec.rimC, power: 2.4, strength: 0.32 });
  addVertexGlow(mGlow);
  rig.mats.push(mBody, mPlate, mGlow, mCape);
  for (const mm of rig.mats) mm.userData.baseEmissive = mm.emissive.clone();

  const P = spec.plate, PS = spec.plateShade, P2 = spec.plate2, TR = spec.trim;
  const CL = spec.cloth, CD = spec.clothDark, SK = spec.skin, SS = spec.skinShade;

  // ================================================================= hips ==
  const hips = joint(root, 0, spec.hipY, 0, 'hips', rig);
  {
    const bodyP = [
      [ell(0.19 * B, 0.16, 0.16 * B, 10, 8).translate(0, -0.03, 0), CD, { ao: 0.3, aoY0: -0.2, aoY1: 0.1 }],
      [lathe([[0.155 * B, 0.10], [0.20 * B, 0.0], [0.215 * B, -0.14], [0.19 * B, -0.26]], 11), CL,
        { ao: 0.34, aoY0: -0.28, aoY1: 0.1, top: 0.1, to: spec.plate2, y0: -0.26, y1: 0.0 }],
    ];
    hips.add(mesh(assemble(bodyP), mBody));
    const plateP = [];
    // belt + buckle
    plateP.push([new THREE.TorusGeometry(0.20 * B, 0.042, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.92).translate(0, 0.03, 0),
      TR, { ao: 0, top: 0.15 }]);
    plateP.push([new THREE.OctahedronGeometry(0.062, 0).scale(1, 1.2, 0.5).translate(0, 0.03, 0.20 * B), TR, { ao: 0 }]);
    if (S) {
      // ivory faulds over a blue under-skirt: longest at the front, shorter at
      // the sides, gold hem, with a half-step inner row showing in the gaps
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const fr = Math.cos(a);
        const h = 0.20 + 0.11 * Math.max(0, fr) + 0.07 * Math.max(0, -fr);
        plateP.push([chamferBox(0.16, h, 0.055, 0.022).translate(0, -h, 0).rotateX(-0.21).translate(0, 0.02, 0.198 * B).rotateY(a),
          P, { ao: 0.26, aoY0: -0.30, aoY1: 0.02, top: 0.18 }]);
        plateP.push([chamferBox(0.145, 0.05, 0.05, 0.016).translate(0, -h + 0.012, 0).rotateX(-0.21).translate(0, 0.02, 0.206 * B).rotateY(a),
          TR, { ao: 0 }]);
      }
      for (const g of ringPlates(8, { r: 0.176 * B, y: -0.015, w: 0.12, h: 0.19, d: 0.045, tilt: -0.13, phase: 0 }))
        plateP.push([g, PS, { ao: 0.34, aoY0: -0.24, aoY1: -0.01 }]);
    } else {
      // Kargath: four heavy slab tassets, front pair huge
      const slabs = [[0, 0.24, 0.36], [Math.PI, 0.20, 0.28], [Math.PI * 0.5, 0.19, 0.30], [-Math.PI * 0.5, 0.19, 0.30]];
      for (const [a, w, h] of slabs) {
        plateP.push([chamferBox(w, h, 0.07, 0.03).translate(0, -h, 0).rotateX(-0.14).translate(0, 0.0, 0.185 * B).rotateY(a),
          P, { ao: 0.34, aoY0: -0.34, aoY1: 0.0, top: 0.12 }]);
        plateP.push([chamferBox(w * 0.9, 0.05, 0.055, 0.016).translate(0, -h + 0.02, 0).rotateX(-0.14).translate(0, 0, 0.21 * B).rotateY(a),
          TR, { ao: 0 }]);
      }
      for (const g of ringPlates(6, { r: 0.20 * B, y: -0.05, w: 0.10, h: 0.20, d: 0.045, tilt: -0.24, phase: Math.PI / 6 }))
        plateP.push([g, PS, { ao: 0.36, aoY0: -0.3, aoY1: -0.05 }]);
    }
    hips.add(mesh(assemble(plateP), mPlate, true));
  }

  // ================================================================= legs ==
  const legLen = S ? 0.44 : 0.40;
  const shinLen = S ? 0.40 : 0.37;
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const hip = joint(hips, sx * 0.135 * B, -0.05, 0, 'hip' + side, rig);
    hip.add(mesh(assemble([
      [limb(0.138 * B, 0.10 * B, legLen, 9), CD, { ao: 0.38, aoY0: -legLen, aoY1: -0.02, to: CL, y0: -legLen, y1: 0 }],
    ]), mBody, true));
    const knee = joint(hip, 0, -legLen, 0, 'knee' + side, rig);
    const gp = [];
    // knee cop + greave + boot, all one plate mesh
    gp.push([ell(0.112 * B, 0.105, 0.118 * B, 9, 7).translate(0, 0.005, 0.022), P, { ao: 0.18, aoY0: -0.08, aoY1: 0.06, top: 0.16 }]);
    gp.push([ell(0.062 * B, 0.085, 0.075, 7, 5).translate(0, -0.035, 0.095 * B), P, { ao: 0.15, aoY0: -0.1, aoY1: 0.02, top: 0.18 }]);
    gp.push([limb(0.118 * B, 0.106 * B, shinLen, 9).translate(0, -0.05, 0.005), P,
      { ao: 0.28, aoY0: -shinLen, aoY1: -0.1, to: PS, y0: -shinLen, y1: -0.1 }]);
    gp.push([cbox(0.034, shinLen * 0.62, 0.05, 0.012).translate(0, -shinLen * 0.48, 0.108 * B), TR, { ao: 0 }]);
    gp.push([new THREE.TorusGeometry(0.112 * B, 0.024, 5, 12).rotateX(Math.PI / 2).translate(0, -shinLen + 0.03, 0), TR, { ao: 0 }]);
    // foot: sole slab + toe cap + heel
    gp.push([chamferBox(0.165 * B, 0.11, 0.26, 0.035).translate(0, -shinLen - 0.11, 0.05), PS, { ao: 0.3, aoY0: -shinLen - 0.13, aoY1: -shinLen }]);
    gp.push([ell(0.088 * B, 0.072, 0.115, 8, 6).translate(0, -shinLen - 0.045, 0.15), P, { ao: 0.18, aoY0: -shinLen - 0.1, aoY1: -shinLen, top: 0.14 }]);
    gp.push([ell(0.072 * B, 0.068, 0.07, 7, 5).translate(0, -shinLen - 0.055, -0.08), PS, { ao: 0.26, aoY0: -shinLen - 0.1, aoY1: -shinLen }]);
    if (!S) for (const zz of [0.02, 0.14]) // Kargath: spiked boot studs
      gp.push([new THREE.ConeGeometry(0.028, 0.09, 5).rotateX(-Math.PI / 2).translate(0, -shinLen - 0.03, zz + 0.14), TR, { ao: 0 }]);
    knee.add(mesh(assemble(gp), mPlate, true));
  }

  // ================================================================ torso ==
  const torso = joint(hips, 0, 0.15, 0, 'torso', rig);
  {
    // matte underlayer: tapered, real waist, neck
    const bp = [
      [lathe([[0.150 * B, -0.04], [0.154 * B, 0.05], [0.186 * B, 0.22], [0.208 * B, 0.38], [0.192 * B, 0.50], [0.145 * B, 0.58]], 11),
        CD, { ao: 0.36, aoY0: -0.05, aoY1: 0.35, to: CL, y0: 0.0, y1: 0.5 }],
      [lathe([[0.072 * B, 0.48], [0.080 * B, 0.56], [0.076 * B, 0.66]], 8).translate(0, 0, 0.012), SK,
        { ao: 0.42, aoY0: 0.46, aoY1: 0.64 }],
      // shoulder mantle: soft cloth over the cape anchor, no visible seam
      [lathe([[0.125 * B, 0.585], [0.215 * B, 0.50], [0.255 * B, 0.415], [0.235 * B, 0.375]], 13).translate(0, 0, -0.012),
        S ? spec.plate2 : spec.cloth, { ao: 0.22, aoY0: 0.36, aoY1: 0.58, top: 0.18 }],
    ];
    if (!S) { // fur ruff over the gorget
      bp.push([new THREE.TorusGeometry(0.21 * B, 0.09, 6, 14).rotateX(Math.PI / 2).translate(0, 0.53, 0.01), spec.hair,
        { ao: 0.22, aoY0: 0.43, aoY1: 0.58, jitter: 0.12 }]);
    }
    torso.add(mesh(assemble(bp), mBody));

    // layered plate: 3 abdominal lames -> breastplate -> gorget, each lapping the last
    const pp = [];
    // ribbed abdomen: one watertight lathe whose profile steps out/in three
    // times — reads as overlapping lames with no gaps or sawtooth seams
    const rib = S
      ? [[0.150, 0.00], [0.178, 0.035], [0.168, 0.080], [0.192, 0.115], [0.182, 0.160], [0.206, 0.195], [0.198, 0.240]]
      : [[0.186, 0.00], [0.218, 0.04], [0.206, 0.090], [0.234, 0.130], [0.222, 0.180], [0.252, 0.215], [0.240, 0.255]];
    pp.push([lathe(rib.map(([r, y]) => [r * B, y]), 15), P,
      { ao: 0.26, aoY0: 0.0, aoY1: 0.26, top: 0.14, to: PS, y0: 0.24, y1: 0.0 }]);
    const chest = S
      ? [[0.198 * B, 0.24], [0.234 * B, 0.34], [0.250 * B, 0.43], [0.238 * B, 0.505], [0.176 * B, 0.575]]
      : [[0.228 * B, 0.22], [0.272 * B, 0.32], [0.288 * B, 0.42], [0.268 * B, 0.50], [0.196 * B, 0.565]];
    pp.push([lathe(chest, 13), P, { ao: 0.26, aoY0: 0.2, aoY1: 0.5, top: 0.16, to: PS, y0: 0.5, y1: 0.2 }]);
    // sternum ridge + V trim (cbox is centred, so rotate-then-place is safe)
    pp.push([cbox(0.05, 0.26, 0.05, 0.018).rotateX(-0.12).translate(0, 0.34, 0.232 * B), TR, { ao: 0 }]);
    for (const sx of [-1, 1])
      pp.push([cbox(0.036, 0.26, 0.04, 0.012).rotateZ(sx * 0.66).translate(sx * 0.098 * B, 0.395, 0.222 * B), TR, { ao: 0 }]);
    // thin gold gorget ring at the base of the neck (must not swallow the head)
    pp.push([new THREE.TorusGeometry(0.108 * B, 0.024, 5, 14).rotateX(Math.PI / 2).translate(0, 0.535, 0.005),
      TR, { ao: 0, top: 0.2 }]);
    // mantle clasp brooches over the shoulder line
    for (const sx of [-1, 1])
      pp.push([new THREE.OctahedronGeometry(0.045, 0).scale(1, 1.3, 0.6).translate(sx * 0.115 * B, 0.505, 0.135 * B), TR, { ao: 0 }]);
    if (!S) { // Kargath: bolted straps across the chest
      for (const sx of [-1, 1])
        pp.push([cbox(0.07, 0.46, 0.045, 0.016).rotateZ(sx * 0.42).translate(sx * 0.075 * B, 0.34, 0.245 * B),
          spec.clothDark, { ao: 0.2, aoY0: 0.1, aoY1: 0.4 }]);
      pp.push([new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(-1.4).translate(0, 0.50, 0.24 * B), TR, { ao: 0 }]);
    }
    torso.add(mesh(assemble(pp), mPlate, true));

    // emissive: chest core + rune trim
    const gp = [];
    gp.push([new THREE.OctahedronGeometry(0.062, 0).scale(1, 1.55, 0.6).translate(0, 0.395, 0.242 * B), spec.core, { ao: 0 }]);
    for (const sx of [-1, 1])
      gp.push([chamferBox(0.016, 0.19, 0.02, 0.005).translate(0, 0.26, 0).rotateZ(sx * 0.5).translate(sx * 0.13 * B, 0.20, 0.222 * B),
        spec.core, { ao: 0, to: 0x0a1418, y0: 0.16, y1: 0.06 }]);
    gp.push([new THREE.TorusGeometry(0.145 * B, 0.011, 4, 14).rotateX(Math.PI / 2).translate(0, 0.10, 0), spec.core, { ao: 0 }]);
    torso.add(mesh(assemble(gp), mGlow));
  }

  // ============================================================ shoulders ==
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const big = !S && side === 'L' ? 1.28 : 1.0; // Kargath is asymmetric
    const sh = joint(torso, sx * spec.shX * B, spec.shY, 0, 'sh' + side, rig);
    // deltoid ball fills the pauldron so it can never read as floating
    const ap = [
      [ell(0.118 * B, 0.115 * B, 0.118 * B, 9, 7), S ? SK : CD, { ao: 0.18, aoY0: -0.1, aoY1: 0.06 }],
      [limb(0.100 * B, 0.084 * B, 0.37, 9).translate(0, -0.02, 0), S ? SK : CD,
        { ao: 0.3, aoY0: -0.34, aoY1: -0.02, to: SS, y0: -0.3, y1: 0 }],
    ];
    if (S) ap.push([new THREE.TorusGeometry(0.098 * B, 0.021, 5, 10).rotateX(Math.PI / 2).translate(0, -0.14, 0), CD, { ao: 0 }]);
    sh.add(mesh(assemble(ap), mBody));

    const pp = [];
    const R0 = 0.142 * B * big;
    // main dome, pushed inboard so it sinks into the chest
    pp.push([new THREE.SphereGeometry(R0, 11, 7, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1.22, 1.0, 1.16)
      .translate(-sx * 0.035 * B, 0.03, 0), P, { ao: 0.22, aoY0: -0.14, aoY1: 0.12, top: 0.2, to: PS, y0: 0.12, y1: -0.12 }]);
    // second lame wrapping the upper arm — the overlap kills the shoulder gap
    pp.push([new THREE.SphereGeometry(R0 * 0.94, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(1.14, 0.72, 1.08)
      .translate(-sx * 0.02 * B, -0.085, 0), S ? P2 : PS, { ao: 0.3, aoY0: -0.2, aoY1: -0.02 }]);
    pp.push([new THREE.TorusGeometry(R0 * 1.08, 0.019, 5, 14).rotateX(Math.PI / 2).scale(1.16, 1, 1.1)
      .translate(-sx * 0.035 * B, 0.015, 0), TR, { ao: 0 }]);
    if (S) {
      // swept dawn-wing fin, laid back along the pauldron
      pp.push([strand(0.052, 0.26, 0.03, 0.2).rotateX(-1.25).rotateZ(sx * -0.30).translate(sx * 0.075, 0.075, -0.05), TR, { ao: 0 }]);
    } else {
      for (let i = 0; i < 3; i++)
        pp.push([new THREE.ConeGeometry(0.042 * big, 0.20 * big, 5).rotateZ(sx * -(0.45 + i * 0.35))
          .translate(sx * (0.06 + i * 0.055) * B, 0.11 - i * 0.045, -0.02 + i * 0.02), spec.steel, { ao: 0 }]);
    }
    sh.add(mesh(assemble(pp), mPlate, true));

    // ------------------------------------------------------------ forearm --
    const elbow = joint(sh, 0, -0.34, 0, 'el' + side, rig);
    const fp = [];
    fp.push([lathe([[0.112 * B, 0.03], [0.098 * B, -0.05], [0.078 * B, -0.16], [0.074 * B, -0.26]], 9), P,
      { ao: 0.3, aoY0: -0.28, aoY1: 0.02, top: 0.12, to: PS, y0: 0.02, y1: -0.26 }]);
    fp.push([new THREE.TorusGeometry(0.104 * B, 0.02, 5, 12).rotateX(Math.PI / 2).translate(0, 0.0, 0), TR, { ao: 0 }]);
    fp.push([new THREE.TorusGeometry(0.076 * B, 0.016, 5, 10).rotateX(Math.PI / 2).translate(0, -0.27, 0), TR, { ao: 0 }]);
    // fist + thumb
    fp.push([ell(0.062 * B, 0.076, 0.078 * B, 8, 6).translate(0, -0.325, 0.012), S ? SK : CD, { ao: 0.25, aoY0: -0.4, aoY1: -0.28 }]);
    fp.push([ell(0.03 * B, 0.045, 0.035, 6, 5).rotateZ(sx * 0.4).translate(-sx * 0.045, -0.30, 0.05), S ? SK : CD, { ao: 0 }]);
    elbow.add(mesh(assemble(fp), mPlate));
  }

  // ================================================================= head ==
  const neck = joint(torso, 0, 0.615, 0.012, 'head', rig);
  {
    const R = spec.headR;
    const hy = R * 0.70;   // skull centre above the neck joint
    const bp = [];
    // skull + jaw + chin give an actual face taper instead of a box
    bp.push([ell(R * 0.97, R * 1.03, R * 1.00, 14, 11).translate(0, hy, 0), SK, { ao: 0.2, aoY0: hy - R, aoY1: hy + R * 0.5, top: 0.1 }]);
    bp.push([ell(R * 0.78, R * 0.68, R * 0.84, 10, 8).translate(0, hy - R * 0.40, R * 0.09), SK, { ao: 0.24, aoY0: hy - R, aoY1: hy }]);
    bp.push([ell(R * 0.42, R * 0.30, R * 0.34, 8, 6).translate(0, hy - R * 0.70, R * 0.28), SK, { ao: 0.2, aoY0: hy - R, aoY1: hy - R * 0.4 }]);
    if (S) {
      // --- eyes: lidded almond, iris, pupil, catchlight, brow ---
      for (const sx of [-1, 1]) {
        const ex = sx * R * 0.335, ey = hy + R * 0.11, ez = R * 0.80;
        const eye = ell(R * 0.235, R * 0.185, R * 0.13, 9, 7).rotateZ(sx * 0.18).rotateY(sx * 0.26).translate(ex, ey, ez);
        bp.push([eye, 0xfdf8f0, { ao: 0.3, aoY0: ey - R * 0.16, aoY1: ey + R * 0.06 }]);
        bp.push([ell(R * 0.135, R * 0.158, R * 0.088, 8, 6).translate(ex + sx * 0.004, ey - R * 0.01, ez + R * 0.075), 0x1d6bb4,
          { ao: 0, to: 0x74d6f5, y0: ey - R * 0.14, y1: ey + R * 0.12 }]);
        bp.push([ell(R * 0.062, R * 0.078, R * 0.055, 7, 5).translate(ex + sx * 0.004, ey - R * 0.02, ez + R * 0.10), 0x0d1522, { ao: 0 }]);
        bp.push([ell(R * 0.042, R * 0.042, R * 0.034, 6, 5).translate(ex - sx * 0.022, ey + R * 0.085, ez + R * 0.108), 0xffffff, { ao: 0 }]);
        // upper lid rolls over the eye — removes the dead stare
        bp.push([ell(R * 0.255, R * 0.125, R * 0.155, 9, 6).rotateZ(sx * 0.20).translate(ex, ey + R * 0.165, ez - R * 0.03), SK,
          { ao: 0.18, aoY0: ey, aoY1: ey + R * 0.2 }]);
        // brow
        bp.push([cbox(R * 0.32, R * 0.055, R * 0.07, R * 0.02).rotateZ(sx * 0.26).rotateX(-0.28)
          .translate(ex, ey + R * 0.36, ez - R * 0.04), 0xc79a4e, { ao: 0 }]);
      }
      // nose + mouth, deliberately tiny
      bp.push([new THREE.ConeGeometry(R * 0.07, R * 0.13, 4).rotateY(Math.PI / 4).rotateX(-1.9)
        .translate(0, hy - R * 0.20, R * 0.85), SS, { ao: 0 }]);
      bp.push([ell(R * 0.105, R * 0.04, R * 0.05, 7, 5).translate(0, hy - R * 0.54, R * 0.76), 0xc4736a, { ao: 0 }]);
      // --- hair: layered swept volumes with strand tips, not a solid blob ---
      const hp = [];
      const HA = { ao: 0.16, aoY0: hy - R * 0.8, aoY1: hy + R, top: 0.18 };
      hp.push([new THREE.SphereGeometry(R * 1.09, 13, 9, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1.07, 1.07, 1.10)
        .translate(0, hy + R * 0.04, -R * 0.06), spec.hair, HA]);
      // forehead mass, swept up and to one side
      hp.push([ell(R * 1.00, R * 0.46, R * 0.66, 12, 8).rotateZ(0.16).translate(-R * 0.06, hy + R * 0.70, R * 0.32), spec.hair, HA]);
      hp.push([ell(R * 0.56, R * 0.52, R * 0.52, 9, 7).translate(-R * 0.64, hy + R * 0.56, R * 0.42), spec.hair, HA]);
      // back volume
      hp.push([ell(R * 1.00, R * 0.94, R * 0.86, 12, 9).translate(0, hy + R * 0.08, -R * 0.46), spec.hair,
        { ao: 0.3, aoY0: hy - R * 0.8, aoY1: hy + R * 0.6 }]);
      // fringe tips sweeping across the temples (never over the eyes)
      const fr = [[-1.10, 1.00, 0.95], [-0.80, 0.80, 0.80], [-0.42, 0.52, 0.62], [0.72, 0.62, -0.70], [1.02, 0.86, -0.85]];
      for (const [a, len, roll] of fr) {
        const g = strand(R * 0.21, R * len, R * 0.13, 0.10)
          .rotateX(Math.PI - 0.20).rotateZ(roll)
          .translate(Math.sin(a) * R * 0.88, hy + R * 0.62, Math.cos(a) * R * 0.80);
        hp.push([g, spec.hair, { ao: 0.1, aoY0: hy - R * 0.6, aoY1: hy + R * 0.8, to: spec.hairTip, y0: hy + R * 0.7, y1: hy - R * 0.3 }]);
      }
      // face-framing side locks (asymmetric)
      for (const [sx, len, tilt] of [[-1, 1.75, -0.10], [1, 1.15, 0.14]]) {
        const g = strand(R * 0.30, R * len, R * 0.20, 0.22).rotateX(Math.PI + 0.10).rotateZ(sx * tilt)
          .translate(sx * R * 0.94, hy + R * 0.52, R * 0.26);
        hp.push([g, spec.hair, { ao: 0.16, aoY0: hy - R, aoY1: hy + R * 0.6, to: spec.hairTip, y0: hy + R * 0.5, y1: hy - R }]);
      }
      bp.push(...hp);
    } else {
      // Kargath: full horned helm, glowing visor slit, no visible face
      bp.push([ell(R * 0.62, R * 0.42, R * 0.44, 9, 7).translate(0, hy - R * 0.55, R * 0.42), spec.hair,
        { ao: 0.3, aoY0: hy - R, aoY1: hy, jitter: 0.1 }]); // beard
    }
    neck.add(mesh(assemble(bp), mBody, true));

    const hp = [];
    if (S) {
      // circlet with an upswept dawn ornament
      hp.push([new THREE.TorusGeometry(R * 1.06, 0.019, 5, 16, Math.PI * 1.25).rotateZ(Math.PI * -0.12)
        .rotateX(Math.PI / 2 - 0.20).rotateY(Math.PI).translate(0, hy + R * 0.36, 0), TR, { ao: 0 }]);
      hp.push([strand(0.036, 0.12, 0.02, 0.0).rotateX(-0.5).translate(0, hy + R * 0.52, R * 0.88), TR, { ao: 0 }]);
      for (const sx of [-1, 1])
        hp.push([strand(0.026, 0.085, 0.016, 0.0).rotateX(-0.4).rotateZ(sx * 0.5)
          .translate(sx * R * 0.42, hy + R * 0.48, R * 0.80), TR, { ao: 0 }]);
    } else {
      hp.push([new THREE.SphereGeometry(R * 1.10, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.66).scale(1.04, 1.08, 1.06)
        .translate(0, hy + R * 0.02, 0), P, { ao: 0.2, aoY0: hy - R * 0.5, aoY1: hy + R, top: 0.2 }]);
      hp.push([cbox(R * 1.5, R * 0.55, R * 0.9, R * 0.12).translate(0, hy + R * 0.18, R * 0.30), PS, { ao: 0.25, aoY0: hy - R * 0.3, aoY1: hy + R * 0.4 }]);
      hp.push([ell(R * 0.62, R * 0.40, R * 0.40, 8, 6).translate(0, hy - R * 0.30, R * 0.62), PS, { ao: 0.3, aoY0: hy - R, aoY1: hy }]);
      for (const sx of [-1, 1]) {
        hp.push([new THREE.TorusGeometry(R * 0.85, 0.055, 6, 10, Math.PI * 0.72).rotateY(sx > 0 ? 0.25 : Math.PI - 0.25)
          .rotateZ(sx * -0.55).translate(sx * R * 0.90, hy + R * 0.42, -R * 0.05), spec.steel, { ao: 0, to: 0xe4dcc8, y0: hy, y1: hy + R }]);
        hp.push([new THREE.ConeGeometry(0.032, 0.10, 5).rotateZ(sx * 0.6).translate(sx * R * 0.62, hy + R * 0.95, 0), TR, { ao: 0 }]);
      }
    }
    neck.add(mesh(assemble(hp), mPlate, S));

    if (!S) {
      neck.add(mesh(assemble([
        [cbox(R * 0.92, R * 0.10, R * 0.06, R * 0.02).translate(0, hy + R * 0.12, R * 0.80), spec.core, { ao: 0 }],
        [ell(R * 0.09, R * 0.07, R * 0.05, 6, 5).translate(0, hy + R * 0.62, R * 0.62), spec.core, { ao: 0 }],
      ]), mGlow));
    }

    // ---------------------------------------------------------- ponytail --
    if (S) {
      const t0 = joint(neck, 0, hy + R * 0.42, -R * 0.92, null, rig);
      const t1 = joint(t0, 0, -0.24, -0.18, null, rig);
      const segA = strand(0.085, 0.30, 0.062, 0.62).rotateX(-2.50);
      const segB = strand(0.055, 0.26, 0.042, 0.12).rotateX(-2.85);
      t0.add(mesh(assemble([[segA, spec.hair, { ao: 0.12, aoY0: -0.3, aoY1: 0.05, to: spec.hairTip, y0: 0.05, y1: -0.3 }]]), mBody));
      t1.add(mesh(assemble([[segB, spec.hairTip, { ao: 0.1, aoY0: -0.3, aoY1: 0.0 }]]), mBody));
      // gold hair tie
      t0.add(mesh(assemble([[new THREE.TorusGeometry(0.062, 0.016, 5, 10).rotateX(1.1).translate(0, -0.03, -0.06), TR, { ao: 0 }]]), mPlate));
      rig.tail = [t0, t1];
    }
  }

  // ================================================================= cape ==
  {
    const capeRoot = joint(torso, 0, 0.485, -0.175 * B, null, rig);
    rig.capeRoot = capeRoot;
    const cape = S
      ? new Cape(mCape, { rows: 7, cols: 6, seg: 0.165, w0: 0.28, w1: 0.50, thick: 0.022, curl: 0.11, fold: 0.05, folds: 3 })
      : new Cape(mCape, { rows: 6, cols: 6, seg: 0.185, w0: 0.34, w1: 0.64, thick: 0.028, curl: 0.13, ragged: 0.16, fold: 0.06, folds: 4 });
    capeRoot.add(cape.mesh);
    rig.cape = cape;
  }

  // =============================================================== weapon ==
  const grip = joint(rig.joints.elR, 0, -0.345, 0.055, 'grip', rig);
  const wG = new THREE.Group();
  if (S) {
    const pp = [];
    pp.push([bladeGeo({ len: 1.06, w: 0.058, th: 0.023, steps: 8 }).translate(0, 0.20, 0), spec.steel,
      { ao: 0, to: 0xffffff, y0: 0.2, y1: 1.2, top: 0.1 }]);
    // crossguard: swept wings + collar
    for (const sx of [-1, 1]) {
      pp.push([new THREE.TorusGeometry(0.085, 0.024, 5, 9, Math.PI * 0.66).rotateY(sx > 0 ? 0 : Math.PI)
        .rotateZ(sx * -0.35).translate(sx * 0.055, 0.175, 0), TR, { ao: 0 }]);
      pp.push([new THREE.ConeGeometry(0.026, 0.08, 5).rotateZ(sx * -1.35).translate(sx * 0.175, 0.22, 0), TR, { ao: 0 }]);
    }
    pp.push([lathe([[0.042, 0.11], [0.055, 0.16], [0.05, 0.215], [0.032, 0.24]], 9), TR, { ao: 0 }]);
    // wrapped grip
    pp.push([new THREE.CylinderGeometry(0.026, 0.030, 0.17, 8).translate(0, 0.025, 0), 0x2a2438, { ao: 0 }]);
    for (let i = 0; i < 4; i++)
      pp.push([new THREE.TorusGeometry(0.029, 0.007, 4, 8).rotateX(Math.PI / 2).translate(0, -0.03 + i * 0.042, 0), 0x453a52, { ao: 0 }]);
    pp.push([new THREE.OctahedronGeometry(0.05, 0).scale(1, 0.85, 0.85).translate(0, -0.075, 0), TR, { ao: 0 }]);
    wG.add(mesh(assemble(pp), mPlate, true));
    const gp = [];
    // fuller glow, bright at the guard fading up the blade + hot tip
    for (const zz of [0.0125, -0.0125])
      gp.push([cbox(0.021, 0.86, 0.008, 0.003).translate(0, 1.10, zz), spec.core,
        { ao: 0, to: 0x18424f, y0: 0.26, y1: 1.10 }]);
    gp.push([ell(0.022, 0.075, 0.012, 6, 5).translate(0, 1.20, 0), 0xffffff, { ao: 0 }]);
    gp.push([new THREE.OctahedronGeometry(0.024, 0).translate(0, -0.075, 0), spec.core, { ao: 0 }]);
    wG.add(mesh(assemble(gp), mGlow));
    rig.bladeBase = new THREE.Vector3(0, 0.24, 0);
    rig.bladeTip = new THREE.Vector3(0, 1.26, 0);
  } else {
    // Kargath: two-handed ember greataxe
    const pp = [];
    pp.push([new THREE.CylinderGeometry(0.036, 0.046, 1.34, 8).translate(0, 0.44, 0), 0x2f2620, { ao: 0 }]);
    for (let i = 0; i < 5; i++)
      pp.push([new THREE.TorusGeometry(0.041, 0.009, 4, 8).rotateX(Math.PI / 2).translate(0, -0.10 + i * 0.10, 0), 0x50412f, { ao: 0 }]);
    pp.push([lathe([[0.05, 0.98], [0.075, 1.04], [0.06, 1.12]], 8), TR, { ao: 0 }]);
    {
      const s = new THREE.Shape();
      s.moveTo(0.03, -0.30);
      s.quadraticCurveTo(0.44, -0.34, 0.52, 0.02);
      s.quadraticCurveTo(0.44, 0.36, 0.03, 0.32);
      s.quadraticCurveTo(0.14, 0.02, 0.03, -0.30);
      s.closePath();
      for (const sx of [1, -1]) {
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
        g.scale(sx, 1, 1);
        g.translate(0, 1.02, -0.03);
        pp.push([g, spec.steel, { ao: 0, to: 0xf0eadd, y0: 1.0, y1: 1.3 }]);
      }
    }
    pp.push([new THREE.ConeGeometry(0.05, 0.24, 6).translate(0, 1.44, 0), TR, { ao: 0 }]);
    pp.push([new THREE.ConeGeometry(0.045, 0.16, 5).rotateX(Math.PI).translate(0, -0.12, 0), TR, { ao: 0 }]);
    wG.add(mesh(assemble(pp), mPlate, true));
    const gp = [];
    for (const sx of [1, -1])
      gp.push([cbox(0.03, 0.60, 0.045, 0.008).rotateZ(sx * -0.1).translate(sx * 0.50, 1.32, 0), spec.core,
        { ao: 0, to: 0x3a1806, y0: 1.32, y1: 1.02 }]);
    gp.push([ell(0.075, 0.085, 0.05, 8, 6).translate(0, 1.02, 0), spec.core, { ao: 0 }]);
    wG.add(mesh(assemble(gp), mGlow));
    rig.bladeBase = new THREE.Vector3(0, 0.70, 0);
    rig.bladeTip = new THREE.Vector3(0.48, 1.05, 0);
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
    o.hips = [0.02, ws * 0.09, -ws * 0.05, ws * 0.035, br * 0.014 - Math.abs(ws) * 0.012, 0];
    o.torso = [0.035 + br * 0.03, -ws * 0.05, ws * 0.06];
    o.head = [-0.05 + br * 0.022, Math.sin(t * 0.31 + 0.7) * 0.20 - ws * 0.06, -ws * 0.03];
    o.shL = [0.14 + br * 0.035, 0.05, -0.155 - ws * 0.03];
    o.elL = [0.30 + br * 0.03, 0, -0.08];
    o.shR = [0.10 + br * 0.035, -0.06, 0.225 + ws * 0.03];
    o.elR = [0.46, 0.05, 0.13];
    o.grip = [-0.62, 0.1, -0.05];
    o.hipL = [0.03 - ws * 0.06, 0, -0.035]; o.kneeL = [0.06 + Math.max(0, ws) * 0.12, 0, 0];
    o.hipR = [-0.05 + ws * 0.06, 0.06, 0.035]; o.kneeR = [0.10 + Math.max(0, -ws) * 0.12, 0, 0];
    o.capeLean = 0.04 + Math.abs(ws2) * 0.03;
  },
  run(t, p, o) {
    const rate = p.rate || 1;
    const f = t * 10.5 * rate;
    const s = Math.sin(f), c = Math.cos(f);
    const lean = 0.34 * rate;
    // foot plant: the support knee snaps straight as the heel lands
    const plantL = Math.max(0, -c), plantR = Math.max(0, c);
    o.torso = [lean, s * 0.10, -s * 0.05];
    o.hips = [0.09, -s * 0.16, c * 0.03, 0, Math.abs(c) * 0.055 - 0.03, 0];
    o.head = [-lean * 0.72 - 0.04, s * 0.06, 0];
    o.hipL = [s * 0.88 - 0.12, 0, -0.03];
    o.kneeL = [Math.max(0.06, -s * 1.25 + 0.30) * (1 - plantL * 0.55), 0, 0];
    o.hipR = [-s * 0.88 - 0.12, 0, 0.03];
    o.kneeR = [Math.max(0.06, s * 1.25 + 0.30) * (1 - plantR * 0.55), 0, 0];
    // arms counter-swing the legs
    o.shL = [-s * 0.72 + 0.12, -s * 0.1, -0.20];
    o.elL = [0.60 + Math.max(0, -s) * 0.55, 0, -0.05];
    o.shR = [s * 0.58 + 0.20, s * 0.08, 0.26];
    o.elR = [0.62 + Math.max(0, s) * 0.35, 0, 0.12];
    o.grip = [-0.72, 0.15, -0.1];
    o.capeLean = 0.55 + rate * 0.45;
  },
  atk1(t, p, o) { // horizontal slash R -> L
    const w = inQuad(t / 0.30), st = outQuint((t - 0.30) / 0.13), rec = sm01((t - 0.52) / 0.42);
    o.torso = [0.10 + 0.10 * w, -0.78 * w + 1.42 * st - 0.62 * rec, 0.10 * w - 0.08 * st];
    o.head = [0.05 * w, 0.52 * w - 0.78 * st + 0.28 * rec, 0];
    o.shR = [-0.55 - 1.00 * w + 1.62 * st - 0.2 * rec, -0.30 - 0.55 * w + 1.10 * st, 1.05 * w - 0.75 * st];
    o.elR = [0.55 + 0.35 * w - 0.55 * st, 0, 0.15];
    o.grip = [-1.45 + 0.55 * st, 0, 1.45 * w - 2.55 * st + 1.0 * rec];
    o.shL = [0.45 * w - 0.25 * st, 0.3 * w, -0.42 - 0.42 * w + 0.25 * st];
    o.elL = [0.75 + 0.4 * w, 0, -0.12];
    o.hipL = [-0.22 * st, 0, 0]; o.hipR = [0.26 * st - 0.12 * w, 0, 0];
    o.kneeL = [0.22 + 0.2 * w, 0, 0]; o.kneeR = [0.30, 0, 0];
    o.hips = [0.04, -0.42 * w + 0.92 * st - 0.4 * rec, 0, 0, -0.05 * w, 0.14 * st];
    o.capeLean = 0.25 + st * 0.75 - rec * 0.5;
    o.capeSide = -0.55 * st;
  },
  atk2(t, p, o) { // backhand L -> R
    const w = inQuad(t / 0.28), st = outQuint((t - 0.28) / 0.13), rec = sm01((t - 0.50) / 0.44);
    o.torso = [0.13 + 0.08 * w, 0.85 * w - 1.55 * st + 0.70 * rec, -0.1 * w];
    o.head = [0.04 * w, -0.55 * w + 0.82 * st - 0.3 * rec, 0];
    o.shR = [-0.35 - 0.55 * w + 1.05 * st, 0.60 * w - 1.30 * st + 0.45 * rec, 0.42 + 0.60 * w - 0.85 * st];
    o.elR = [0.40 + 0.5 * w - 0.3 * st, 0.5 * w - 0.85 * st, 0.2];
    o.grip = [-1.30 + 0.35 * st, 0.55 * w - 1.0 * st, -1.20 * w + 2.20 * st - 1.0 * rec];
    o.shL = [0.25 - 0.2 * st, -0.25 * w, -0.55 - 0.2 * w];
    o.elL = [0.85, 0, 0];
    o.hipL = [0.18 * st, 0, 0]; o.hipR = [-0.20 * st, 0, 0];
    o.kneeL = [0.28, 0, 0]; o.kneeR = [0.24 + 0.2 * w, 0, 0];
    o.hips = [0.04, 0.48 * w - 0.98 * st, 0, 0, -0.04 * w, -0.10 * st];
    o.capeLean = 0.25 + st * 0.7 - rec * 0.45;
    o.capeSide = 0.55 * st;
  },
  atk3(t, p, o) { // overhead heavy, big anticipation + hard stop
    const w = inQuad(t / 0.34), st = outQuint((t - 0.34) / 0.12), rec = sm01((t - 0.56) / 0.44);
    o.torso = [-0.42 * w + 1.00 * st - 0.42 * rec, 0.18 * w - 0.14 * st, 0];
    o.head = [0.35 * w - 0.48 * st + 0.1 * rec, 0, 0];
    o.shR = [-2.75 * w + 3.75 * st - 0.95 * rec, 0.1 * w, 0.30 * w - 0.15 * st];
    o.elR = [0.75 * w - 0.65 * st, 0, 0.1];
    o.grip = [-0.85 - 1.05 * w + 1.90 * st - 0.55 * rec, 0, 0];
    o.shL = [-2.15 * w + 2.95 * st - 0.80 * rec, 0, -0.40];
    o.elL = [0.70 - 0.35 * st, 0, -0.1];
    o.hips = [0.05, 0, 0, 0, -0.08 * w - 0.13 * st + 0.10 * rec, 0];
    o.hipL = [0.18 * st - 0.1 * w, 0, 0]; o.hipR = [-0.16 * st, 0, 0];
    o.kneeL = [0.20 + 0.45 * st, 0, 0]; o.kneeR = [0.22 + 0.45 * st, 0, 0];
    o.capeLean = 0.20 + w * 0.75 + st * 0.35 - rec * 0.6;
    o.capeLift = w * 0.45 - st * 0.45;
  },
  q(t, p, o) { // crescent wave: full-body roundhouse
    const w = inQuad(t / 0.26), st = outQuint((t - 0.26) / 0.15), rec = sm01((t - 0.52) / 0.44);
    o.torso = [0.18, -1.05 * w + 2.15 * st - 1.10 * rec, 0.12 * w];
    o.head = [0, 0.60 * w - 0.95 * st + 0.35 * rec, 0];
    o.shR = [-1.40 * w + 1.55 * st, -0.50 * w + 0.85 * st, 1.45 * w - 1.25 * st];
    o.elR = [0.50 + 0.3 * w - 0.55 * st, 0, 0.2];
    o.grip = [-1.55 + 0.65 * st, 0, 1.75 * w - 3.10 * st + 1.35 * rec];
    o.shL = [0.50 * w, 0.35 * w, -0.60];
    o.elL = [0.90, 0, 0];
    o.hips = [0, -0.58 * w + 1.20 * st - 0.62 * rec, 0, 0, -0.05 * st, 0.16 * st];
    o.hipL = [-0.18 * st, 0, 0]; o.hipR = [0.22 * st, 0, 0];
    o.kneeL = [0.28, 0, 0]; o.kneeR = [0.34, 0, 0];
    o.capeLean = 0.3 + st * 0.9 - rec * 0.6;
    o.capeSide = -0.7 * st;
  },
  dash(t, p, o) {
    o.torso = [0.66, 0, 0];
    o.head = [-0.42, 0, 0];
    o.shR = [0.95, 0, 0.88];
    o.elR = [0.50, 0, 0.30];
    o.grip = [-2.15, 0, 0.40];
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
    o.grip = [-1.58, 0, 0];
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
    o.grip = [-1.45, 0, 0];
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
    o.grip = [-2.25, 0, 0];
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
  showcase(t, p, o) { // hero-shot: contrapposto, blade angled across the body
    const br = Math.sin(t * 1.5);
    o.hips = [0.01, -0.30, -0.075, 0.03, br * 0.012 - 0.01, 0];
    o.torso = [0.02 + br * 0.022, 0.12, 0.085];
    o.head = [-0.10 + br * 0.02, 0.30, -0.04];
    o.shR = [-0.62, -0.35, 0.62];
    o.elR = [0.92, 0.1, 0.18];
    o.grip = [-0.55, 0.35, -0.62];
    o.shL = [0.20 + br * 0.03, 0.15, -0.40];
    o.elL = [0.62, 0, -0.22];
    o.hipL = [0.16, 0.06, -0.04]; o.kneeL = [0.30, 0, 0];
    o.hipR = [-0.10, 0.10, 0.055]; o.kneeR = [0.06, 0, 0];
    o.capeLean = 0.20 + br * 0.04;
    o.capeSide = 0.12 + Math.sin(t * 0.9) * 0.10;
  },
  channel(t, p, o) {
    POSES.idle(t, p, o);
    const k = Math.min(t / 0.5, 1);
    o.shR = [-2.6 * k, 0, 0.4];
    o.grip = [-1.2, 0, 0];
    o.shL = [-2.2 * k, 0, -0.5];
    o.head = [0.35 * k, 0, 0];
    o.capeLean = 0.3 * k;
    o.capeLift = 0.4 * k;
  },
};

// -------------------------------------------------------------------- Hero --
export class Hero extends Unit {
  constructor({ name, team, build, x = 0, z = 0 }) {
    super({ team, kind: 'hero', maxHp: 600, radius: 0.5, speed: 7.0, x, z, hpW: 1.35, hpY: 2.75 });
    this.isHero = true;
    this.name = name;
    this.isSera = build === 'sera';
    this.rig = buildRig(this.isSera ? SERA : KARGATH);
    this.group.add(this.rig.root);
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

  hitFlash() { this.flashT = 1; }

  getBladePoints(base, tip) {
    this.rig.weapon.localToWorld(base.copy(this.rig.bladeBase));
    this.rig.weapon.localToWorld(tip.copy(this.rig.bladeTip));
  }

  update(dt) {
    const a = this.anim;
    a.t += dt;
    for (const e of a.events) {
      if (!e.fired && a.t >= e.t) { e.fired = true; e.fn(); }
    }
    if (a.t >= a.dur && !a.loop) {
      this.anim = { name: this.moving ? 'run' : 'idle', t: Math.random() * 3, dur: 1e9, lock: false, events: [], loop: true, poseParams: {} };
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
    // blend joints toward targets
    const k = 1 - Math.exp(-this.blendK * dt);
    for (const name in this.rig.joints) {
      const j = this.rig.joints[name];
      const b = j.userData.bind;
      const d = out[name];
      _e1.set(d ? d[0] : 0, d ? d[1] : 0, d ? d[2] : 0);
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
    this.rig.root.position.y = this.airY;

    // ------------------------------------------------- secondary motion --
    const idt = dt > 1e-5 ? 1 / dt : 0;
    let df = this.facing - this._prevFacing;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this._prevFacing = this.facing;
    this._turn += (THREE.MathUtils.clamp(df * idt, -8, 8) - this._turn) * Math.min(1, dt * 12);
    const vAir = THREE.MathUtils.clamp((this.airY - this._prevAirY) * idt, -14, 14);
    this._prevAirY = this.airY;

    const c = this._capeCtx;
    const speedLean = this.moving ? 0.30 + 0.75 * this.moveRate : 0;
    const wantLean = Math.max(speedLean, out.capeLean || 0) + (this.spinRate ? 0.9 : 0);
    const wantSide = THREE.MathUtils.clamp(-this._turn * 0.11, -0.85, 0.85) + (out.capeSide || 0);
    const wantLift = (out.capeLift || 0) + THREE.MathUtils.clamp(-vAir * 0.09, -0.5, 0.9);
    const ck = Math.min(1, dt * 11);
    c.lean += (wantLean - c.lean) * ck;
    c.side += (wantSide - c.side) * ck;
    c.lift += (wantLift - c.lift) * ck;
    this.rig.cape.update(dt, c);

    // ponytail: two damped springs, the tip lagging the root
    if (this.rig.tail) {
      const tgtX = [0.08 + c.lean * 0.50, 0.12 + c.lean * 0.72];
      const tgtZ = [c.side * 0.55 + Math.sin(uTime.value * 1.9) * 0.06,
        c.side * 0.85 + Math.sin(uTime.value * 1.7 + 1.2) * 0.09];
      const stiff = [95, 62], damp = [13, 10];
      for (let i = 0; i < 2; i++) {
        this._tailVel[i] += (tgtX[i] - this._tailAng[i]) * stiff[i] * dt - this._tailVel[i] * damp[i] * dt;
        this._tailAng[i] += this._tailVel[i] * dt;
        this._tailSideVel[i] += (tgtZ[i] - this._tailSide[i]) * stiff[i] * dt - this._tailSideVel[i] * damp[i] * dt;
        this._tailSide[i] += this._tailSideVel[i] * dt;
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
