// Hero rig builder + procedural animation state machine.
// Sera, Blade of Dawn (BLUE) and Kargath, Ember Warlord (RED) share a skeleton;
// meshes/materials/proportions differ. All animation is procedural poses with
// exponential smoothing between targets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, addRim, uTime } from '../core/assets.js';
import { bakeTint, chamferBox, lathe } from '../world/props.js';
import { Unit } from './units.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();

function M(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.5, metalness: opts.metal ?? 0.1,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
    transparent: !!opts.alpha, opacity: opts.alpha ?? 1,
    map: opts.map || null, side: opts.side || THREE.FrontSide,
  });
}
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
  rig.joints[name] = j;
  return j;
}
function capsule(r, len, axis = 'y') {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  if (axis === 'y-') g.translate(0, -len / 2, 0);
  else g.translate(0, len / 2, 0);
  return g;
}

// ---------------------------------------------------------------- palettes --
const SERA = {
  armor: 0xe4e4da, armor2: 0x3f6fd4, trim: 0xf0b64e, dark: 0x33417e,
  skin: 0xf2c9a6, hair: 0xffdf9e, blade: 0xcfd9e8, core: 0x54e8ff,
  capeTex: 'clothBlue', gem: 0x54e8ff, rim: 0x9fd4ff,
  scale: 1.1, bulk: 1.0, headR: 0.215,
};
const KARGATH = {
  armor: 0x5c636f, armor2: 0xa8492c, trim: 0xd49348, dark: 0x33302c,
  skin: 0xd49a6a, hair: 0x3a332c, blade: 0x8a8278, core: 0xff8a36,
  capeTex: 'clothRed', gem: 0xff8a36, rim: 0xffb36a,
  scale: 1.2, bulk: 1.16, headR: 0.205,
};

// ------------------------------------------------------------- rig builder --
function buildRig(spec, isSera) {
  const rig = { joints: {}, mats: [], spec };
  const root = new THREE.Group();
  rig.root = root;
  root.scale.setScalar(spec.scale);

  const mArmor = M(spec.armor, { rough: 0.5, metal: 0.4 });
  const mArmor2 = M(spec.armor2, { rough: 0.5, metal: 0.35 });
  const mTrim = M(spec.trim, { rough: 0.42, metal: 0.8 });
  const mDark = M(spec.dark, { rough: 0.75 });
  const mSkin = M(spec.skin, { rough: 0.62 });
  const mHair = M(spec.hair, { rough: 0.55 });
  const mBlade = M(spec.blade, { rough: 0.3, metal: 0.75 });
  const mCore = M(0x0a1a20, { emissive: spec.core, ei: 1.15, rough: 0.3 });
  const mCape = M(0xffffff, { map: tex[spec.capeTex], rough: 0.85, side: THREE.DoubleSide });
  addRim(mArmor, { color: spec.rim, power: 2.6, strength: 0.32 });
  addRim(mArmor2, { color: spec.rim, power: 2.6, strength: 0.3 });
  addRim(mSkin, { color: 0xffc9a0, power: 3.0, strength: 0.28 });
  addRim(mHair, { color: 0xfff2cf, power: 2.8, strength: 0.3 });
  addRim(mBlade, { color: 0xdfefff, power: 2.4, strength: 0.35 });
  rig.mats.push(mArmor, mArmor2, mTrim, mDark, mSkin, mHair, mBlade, mCore, mCape);
  for (const mm of rig.mats) mm.userData.baseEmissive = mm.emissive.clone();

  const B = spec.bulk;

  // -- hips --
  const hips = joint(root, 0, 1.04, 0, 'hips', rig);
  {
    const belt = new THREE.TorusGeometry(0.2 * B, 0.04, 6, 12);
    belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.9);
    const plates = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const p = chamferBox(0.12, 0.26, 0.035, 0.015);
      p.rotateX(0.16);
      p.translate(0, -0.3, 0.195 * B);
      p.rotateY(a);
      plates.push(p);
    }
    const skirt = mergeGeometries([belt.toNonIndexed(), ...plates.map(p => p.toNonIndexed())], false);
    const hm = mesh(skirt, mArmor2);
    hm.position.y = 0.02;
    hips.add(hm);
    const pelvis = new THREE.SphereGeometry(0.185 * B, 10, 8);
    pelvis.scale(1.05, 0.78, 0.88);
    hips.add(mesh(pelvis, mDark));
  }

  // -- legs --
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const hip = joint(hips, sx * 0.16 * B, -0.06, 0, 'hip' + side, rig);
    const thigh = mesh(capsule(0.115 * B, 0.34, 'y-'), mDark, true);
    hip.add(thigh);
    const knee = joint(hip, 0, -0.46, 0, 'knee' + side, rig);
    const shin = mesh(capsule(0.09 * B, 0.3, 'y-'), mDark);
    knee.add(shin);
    // armored boot
    const bootG = mergeGeometries([
      chamferBox(0.19 * B, 0.3, 0.2, 0.04).translate(0, -0.48, 0.01).toNonIndexed(),
      chamferBox(0.17 * B, 0.12, 0.3, 0.04).translate(0, -0.5, 0.09).toNonIndexed(),
      new THREE.ConeGeometry(0.075, 0.16, 6).rotateX(Math.PI / 2).translate(0, -0.44, 0.26).toNonIndexed(),
    ], false);
    knee.add(mesh(bootG, mArmor, true));
    // knee cop
    const cop = new THREE.SphereGeometry(0.072 * B, 8, 6);
    cop.translate(0, -0.02, 0.075);
    knee.add(mesh(cop, mArmor));
  }

  // -- torso --
  const torso = joint(hips, 0, 0.16, 0, 'torso', rig);
  {
    const chest = lathe([
      [0.165 * B, 0], [0.205 * B, 0.1], [0.165 * B, 0.26], [0.235 * B, 0.44], [0.26 * B, 0.53], [0.17 * B, 0.62],
    ], 12);
    torso.add(mesh(chest, mArmor, true));
    const sash = new THREE.TorusGeometry(0.175 * B, 0.032, 6, 14);
    sash.rotateX(Math.PI / 2); sash.translate(0, 0.2, 0);
    torso.add(mesh(sash, mTrim));
    // neck
    const neckG = new THREE.CylinderGeometry(0.055 * B, 0.07 * B, 0.14, 8);
    neckG.translate(0, 0.66, 0.01);
    torso.add(mesh(neckG, mSkin));
    // gold collar + belt line
    const collar = new THREE.TorusGeometry(0.21 * B, 0.035, 6, 12);
    collar.rotateX(Math.PI / 2); collar.translate(0, 0.56, 0);
    torso.add(mesh(collar, mTrim));
    // chest gem
    const gem = new THREE.OctahedronGeometry(0.06, 0);
    gem.scale(1, 1.4, 0.6); gem.translate(0, 0.42, 0.27 * B);
    torso.add(mesh(gem, mCore));
    if (!isSera) {
      // Kargath: heavy chest straps + spikes
      const strap = chamferBox(0.1, 0.6, 0.04, 0.015);
      strap.rotateZ(0.5); strap.translate(0.02, 0.3, 0.28 * B);
      torso.add(mesh(strap, mDark));
    }
  }

  // -- shoulders/arms --
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? -1 : 1;
    const sh = joint(torso, sx * 0.34 * B, 0.5, 0, 'sh' + side, rig);
    // pauldron
    const pd = new THREE.SphereGeometry(0.16 * B, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.6);
    pd.scale(1.25, 1, 1.25);
    const pauldron = mergeGeometries(isSera ? [
      pd.toNonIndexed(),
      new THREE.SphereGeometry(0.05 * B, 6, 5).translate(0, 0.15, 0).toNonIndexed(),
    ] : [
      pd.toNonIndexed(),
      new THREE.ConeGeometry(0.05, 0.22, 6).translate(0, 0.16, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.04, 0.16, 6).rotateZ(sx * -0.7).translate(sx * 0.12, 0.1, 0).toNonIndexed(),
    ], false);
    const pm = mesh(pauldron, isSera ? mArmor : mArmor2);
    pm.position.y = 0.02;
    sh.add(pm);
    const upper = mesh(capsule(isSera ? 0.075 * B : 0.09 * B, 0.28, 'y-'), isSera ? mSkin : mDark);
    sh.add(upper);
    const elbow = joint(sh, 0, -0.34, 0, 'el' + side, rig);
    // forearm + gauntlet flare + hand
    const foreG = mergeGeometries([
      capsule(0.07 * B, 0.22, 'y-').toNonIndexed(),
      lathe([[0.09 * B, -0.3], [0.115 * B, -0.16], [0.1 * B, -0.05]], 8).toNonIndexed(),
      new THREE.SphereGeometry(0.075 * B, 8, 6).translate(0, -0.34, 0).toNonIndexed(),
    ], false);
    elbow.add(mesh(foreG, mArmor));
  }

  // -- head --
  const neck = joint(torso, 0, 0.64, 0.02, 'head', rig);
  {
    const R = spec.headR;
    const head = new THREE.SphereGeometry(R, 14, 12);
    head.scale(0.94, 1.05, 0.98);
    neck.add(mesh(head, mSkin, true));
    // face decal patch
    const face = new THREE.SphereGeometry(R * 1.03, 12, 10, Math.PI / 2 - 0.66, 1.32, Math.PI * 0.28, Math.PI * 0.4);
    const fm = new THREE.MeshStandardMaterial({
      map: isSera ? tex.faceSera : tex.faceKargath, transparent: true, roughness: 0.62,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    neck.add(mesh(face, fm));
    rig.mats.push(fm);
    fm.userData.baseEmissive = fm.emissive.clone();
    if (isSera) {
      // hair cap + ponytail + tiara
      const cap = new THREE.SphereGeometry(R * 1.14, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58);
      cap.translate(0, R * 0.08, -R * 0.14);
      const bangs = new THREE.SphereGeometry(R * 1.12, 12, 6, Math.PI / 2 - 1.25, 2.5, Math.PI * 0.16, Math.PI * 0.22);
      bangs.translate(0, R * 0.1, 0);
      const sideL = new THREE.SphereGeometry(R * 1.08, 8, 6, Math.PI * 0.92, Math.PI * 0.3, Math.PI * 0.3, Math.PI * 0.42);
      const sideR = new THREE.SphereGeometry(R * 1.08, 8, 6, Math.PI * 1.78, Math.PI * 0.3, Math.PI * 0.3, Math.PI * 0.42);
      const hairG = mergeGeometries([cap.toNonIndexed(), bangs.toNonIndexed(), sideL.toNonIndexed(), sideR.toNonIndexed()], false);
      neck.add(mesh(hairG, mHair));
      const tail = lathe([[0.02, 0], [0.08, 0.18], [0.095, 0.45], [0.05, 0.72], [0.012, 0.95]], 8);
      tail.rotateX(-Math.PI * 0.68);
      const tailM = mesh(tail, mHair);
      tailM.position.set(0, R * 0.62, -R * 0.6);
      neck.add(tailM);
      rig.ponytail = tailM;
      const tiara = new THREE.TorusGeometry(R * 1.05, 0.02, 5, 14, Math.PI * 1.2);
      tiara.rotateZ(Math.PI * -0.1);
      const tm = mesh(tiara, mTrim);
      tm.rotation.x = Math.PI / 2 - 0.22;
      tm.rotation.z = Math.PI;
      tm.position.y = R * 0.42;
      neck.add(tm);
      const jewel = new THREE.OctahedronGeometry(0.032, 0);
      jewel.translate(0, R * 0.38, R * 1.02);
      neck.add(mesh(jewel, mCore));
    } else {
      // horned helm
      const helm = new THREE.SphereGeometry(R * 1.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58);
      helm.translate(0, R * 0.1, 0);
      neck.add(mesh(helm, mArmor));
      for (const sx of [-1, 1]) {
        const horn = new THREE.TorusGeometry(R * 0.9, 0.05, 6, 10, Math.PI * 0.55);
        horn.rotateY(sx > 0 ? 0 : Math.PI);
        const hm = mesh(horn, mTrim);
        hm.position.set(sx * R * 0.95, R * 0.3, 0);
        hm.rotation.z = sx * -0.5;
        neck.add(hm);
      }
      const jaw = new THREE.SphereGeometry(R * 0.5, 8, 6);
      jaw.scale(1.2, 0.7, 0.9); jaw.translate(0, -R * 0.75, R * 0.3);
      neck.add(mesh(jaw, mHair)); // beard
    }
  }

  // -- cape --
  const capeRoot = joint(torso, 0, 0.52, -0.2 * B, 'cape', rig);
  {
    const cape = new THREE.PlaneGeometry(0.46 * B, 1.28, 5, 8);
    cape.translate(0, -0.64, 0);
    const sway = new Float32Array(cape.attributes.position.count);
    const pp = cape.attributes.position;
    for (let i = 0; i < pp.count; i++) sway[i] = Math.pow(Math.max(0, -pp.getY(i) / 1.28), 1.4) * 0.55;
    cape.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    // Note: cloth material already carries the wind sway patch (aSway-driven)
    const cm = mesh(cape, mCape);
    cm.rotation.x = 0.24;
    capeRoot.add(cm);
    rig.capeMesh = cm;
  }

  // -- weapon --
  const grip = joint(rig.joints.elR, 0, -0.36, 0.03, 'grip', rig);
  if (isSera) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.045, 0.06); shape.lineTo(0.05, 0.85); shape.lineTo(0, 1.1);
    shape.lineTo(-0.05, 0.85); shape.lineTo(-0.045, 0.06); shape.closePath();
    const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    blade.translate(0, 0.18, -0.015);
    const guard = mergeGeometries([
      chamferBox(0.24, 0.05, 0.07, 0.02).translate(0, 0.16, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.035, 0.1, 6).rotateZ(Math.PI / 2).translate(-0.14, 0.165, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.035, 0.1, 6).rotateZ(-Math.PI / 2).translate(0.14, 0.165, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.028, 0.032, 0.16, 8).translate(0, 0.04, 0).toNonIndexed(),
      new THREE.SphereGeometry(0.045, 8, 6).translate(0, -0.05, 0).toNonIndexed(),
    ], false);
    const wG = new THREE.Group();
    wG.add(mesh(blade.toNonIndexed(), mBlade, true));
    wG.add(mesh(guard, mTrim));
    const core = chamferBox(0.022, 0.8, 0.062, 0.008);
    core.translate(0, 0.24, -0.031);
    wG.add(mesh(core, mCore));
    grip.add(wG);
    rig.weapon = wG;
    rig.bladeBase = new THREE.Vector3(0, 0.2, 0);
    rig.bladeTip = new THREE.Vector3(0, 1.28, 0);
  } else {
    const wG = new THREE.Group();
    const handle = new THREE.CylinderGeometry(0.035, 0.045, 1.15, 7);
    handle.translate(0, 0.42, 0);
    wG.add(mesh(handle, mDark));
    const headShape = new THREE.Shape();
    headShape.moveTo(0, -0.3); headShape.quadraticCurveTo(0.42, -0.28, 0.46, 0);
    headShape.quadraticCurveTo(0.42, 0.28, 0, 0.3); headShape.closePath();
    let first = true;
    for (const sx of [1, -1]) {
      const hd = new THREE.ExtrudeGeometry(headShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
      hd.scale(sx, 1, 1);
      hd.translate(0, 0.88, -0.025);
      wG.add(mesh(hd.toNonIndexed(), mBlade, first));
      first = false;
    }
    const emberCore = new THREE.SphereGeometry(0.075, 8, 6);
    emberCore.translate(0, 0.88, 0);
    wG.add(mesh(emberCore, mCore));
    const spike = new THREE.ConeGeometry(0.05, 0.22, 6);
    spike.translate(0, 1.28, 0);
    wG.add(mesh(spike, mTrim));
    grip.add(wG);
    rig.weapon = wG;
    rig.bladeBase = new THREE.Vector3(0, 0.55, 0);
    rig.bladeTip = new THREE.Vector3(0.42, 0.92, 0);
  }
  return rig;
}

// ------------------------------------------------------------------- poses --
// Each pose writes joint deltas into out: {jointName: [rx, ry, rz, px?, py?, pz?]}
const POSES = {
  idle(t, p, o) {
    const b = Math.sin(t * 1.6);
    o.torso = [0.03 + b * 0.025, 0, 0];
    o.hips = [0, 0, 0, 0, b * 0.012, 0];
    o.head = [-0.04 + b * 0.02, Math.sin(t * 0.43) * 0.14, 0];
    o.shL = [0.12 + b * 0.03, 0, -0.12];
    o.elL = [0.25, 0, -0.06];
    o.shR = [0.1 + b * 0.03, 0, 0.2];
    o.elR = [0.42, 0, 0.12];
    o.grip = [-0.5, 0, 0];
    o.hipL = [0.02, 0, -0.03]; o.kneeL = [0.05, 0, 0];
    o.hipR = [-0.04, 0.06, 0.03]; o.kneeR = [0.08, 0, 0];
    o.cape = [0.06 + b * 0.02, 0, 0];
  },
  run(t, p, o) {
    const f = t * 11 * (p.rate || 1);
    const s = Math.sin(f), c = Math.cos(f);
    const lean = 0.3 * (p.rate || 1);
    o.torso = [lean, s * 0.07, -s * 0.04];
    o.hips = [0.06, -s * 0.12, 0, 0, Math.abs(c) * 0.05 - 0.02, 0];
    o.head = [-lean * 0.55, s * 0.05, 0];
    o.hipL = [s * 0.82 - 0.1, 0, -0.02];
    o.kneeL = [Math.max(0.12, -s * 1.1 + 0.25), 0, 0];
    o.hipR = [-s * 0.82 - 0.1, 0, 0.02];
    o.kneeR = [Math.max(0.12, s * 1.1 + 0.25), 0, 0];
    o.shL = [-s * 0.62 + 0.15, 0, -0.16];
    o.elL = [0.5, 0, 0];
    o.shR = [s * 0.5 + 0.2, 0, 0.24];
    o.elR = [0.55, 0, 0.1];
    o.grip = [-0.6, 0, 0];
    o.cape = [0.35 + Math.abs(s) * 0.1, 0, -s * 0.05];
  },
  atk1(t, p, o) { // horizontal slash R→L
    const w = sm01(t / 0.34), st = sm01((t - 0.34) / 0.2), rec = sm01((t - 0.62) / 0.38);
    const swing = -1.5 * w + 3.1 * st - 1.0 * rec;
    o.torso = [0.14, -0.62 * w + 1.15 * st - 0.5 * rec, 0];
    o.head = [0, 0.4 * w - 0.55 * st + 0.2 * rec, 0];
    o.shR = [-0.5 - 0.9 * w + 1.5 * st, -0.25 + swing * 0.4, 0.9 * w - 0.6 * st];
    o.elR = [0.35 - 0.25 * st, 0, 0.15];
    o.grip = [-1.35 + 0.45 * st, 0, 1.35 * w - 2.3 * st + 0.9 * rec];
    o.shL = [0.35 * w, 0, -0.4 - 0.3 * w];
    o.elL = [0.7, 0, -0.1];
    o.hipL = [-0.15 * st, 0, 0]; o.hipR = [0.2 * st, 0, 0];
    o.kneeL = [0.2, 0, 0]; o.kneeR = [0.25, 0, 0];
    o.cape = [0.2 + st * 0.25, -st * 0.3, 0];
    o.hips = [0, -0.35 * w + 0.75 * st, 0, 0, -0.03 * st, 0.12 * st];
  },
  atk2(t, p, o) { // backhand L→R
    const w = sm01(t / 0.32), st = sm01((t - 0.32) / 0.2), rec = sm01((t - 0.6) / 0.4);
    o.torso = [0.16, 0.7 * w - 1.25 * st + 0.55 * rec, 0];
    o.head = [0, -0.45 * w + 0.6 * st - 0.2 * rec, 0];
    o.shR = [-0.3 - 0.5 * w + 0.9 * st, 0.5 * w - 1.1 * st + 0.4 * rec, 0.4 + 0.5 * w - 0.7 * st];
    o.elR = [0.3, 0.4 * w - 0.7 * st, 0.2];
    o.grip = [-1.2 + 0.3 * st, 0.5 * w - 0.9 * st, -1.1 * w + 2.0 * st - 0.9 * rec];
    o.shL = [0.2, 0, -0.5];
    o.elL = [0.75, 0, 0];
    o.kneeL = [0.25, 0, 0]; o.kneeR = [0.2, 0, 0];
    o.cape = [0.2 + st * 0.2, st * 0.3, 0];
    o.hips = [0, 0.4 * w - 0.8 * st, 0, 0, -0.02 * st, -0.1 * st];
  },
  atk3(t, p, o) { // overhead heavy
    const w = sm01(t / 0.36), st = sm01((t - 0.36) / 0.18), rec = sm01((t - 0.64) / 0.36);
    o.torso = [-0.3 * w + 0.75 * st - 0.3 * rec, 0, 0];
    o.head = [0.25 * w - 0.35 * st, 0, 0];
    o.shR = [-2.5 * w + 3.4 * st - 0.9 * rec, 0, 0.25 * w];
    o.elR = [0.5 * w - 0.4 * st, 0, 0.1];
    o.grip = [-0.8 - 0.9 * w + 1.7 * st - 0.5 * rec, 0, 0];
    o.shL = [-1.9 * w + 2.6 * st - 0.7 * rec, 0, -0.35];
    o.elL = [0.6 - 0.3 * st, 0, -0.1];
    o.hips = [0, 0, 0, 0, -0.05 * w + (st > 0.9 ? -0.06 : 0), 0];
    o.kneeL = [0.3 * st, 0, 0]; o.kneeR = [0.3 * st, 0, 0];
    o.cape = [0.15 + st * 0.35, 0, 0];
  },
  q(t, p, o) { // crescent wave: big roundhouse slash
    const w = sm01(t / 0.3), st = sm01((t - 0.3) / 0.22), rec = sm01((t - 0.62) / 0.38);
    o.torso = [0.2, -0.9 * w + 1.9 * st - 1.0 * rec, 0];
    o.head = [0, 0.5 * w - 0.8 * st + 0.3 * rec, 0];
    o.shR = [-1.2 * w + 1.3 * st, -0.4 * w + 0.7 * st, 1.3 * w - 1.1 * st];
    o.elR = [0.4 - 0.3 * st, 0, 0.2];
    o.grip = [-1.5 + 0.6 * st, 0, 1.6 * w - 2.9 * st + 1.3 * rec];
    o.shL = [0.4 * w, 0, -0.55];
    o.elL = [0.8, 0, 0];
    o.hips = [0, -0.5 * w + 1.05 * st - 0.55 * rec, 0, 0, -0.04 * st, 0.14 * st];
    o.kneeL = [0.25, 0, 0]; o.kneeR = [0.3, 0, 0];
    o.cape = [0.25 + st * 0.3, -st * 0.4, 0];
  },
  dash(t, p, o) { // W pose
    o.torso = [0.62, 0, 0];
    o.head = [-0.35, 0, 0];
    o.shR = [0.9, 0, 0.85];
    o.elR = [0.5, 0, 0.3];
    o.grip = [-2.1, 0, 0.4];
    o.shL = [-0.7, 0, -0.5];
    o.elL = [0.9, 0, 0];
    o.hipL = [0.9, 0, 0]; o.kneeL = [0.5, 0, 0];
    o.hipR = [-0.85, 0, 0]; o.kneeR = [1.1, 0, 0];
    o.cape = [0.9, 0, 0];
    o.hips = [0.1, 0, 0];
  },
  spin(t, p, o) { // E blade-storm (root yaw handled via extraYaw)
    o.torso = [0.12, 0, 0];
    o.shR = [0.05, 0, 1.35];
    o.elR = [0.05, 0, 0.1];
    o.grip = [-1.55, 0, 0];
    o.shL = [0.05, 0, -1.35];
    o.elL = [0.1, 0, 0];
    o.head = [0.05, 0, 0];
    o.hipL = [0.1, 0, -0.06]; o.hipR = [0.1, 0, 0.06];
    o.kneeL = [0.25, 0, 0]; o.kneeR = [0.25, 0, 0];
    o.cape = [0.7, 0, 0];
  },
  ultLeap(t, p, o) { // airborne, sword overhead
    o.torso = [-0.25, 0, 0];
    o.head = [0.3, 0, 0];
    o.shR = [-2.9, 0, 0.3];
    o.elR = [0.4, 0, 0];
    o.grip = [-1.5, 0, 0];
    o.shL = [-2.4, 0, -0.4];
    o.elL = [0.5, 0, 0];
    o.hipL = [0.5, 0, 0]; o.kneeL = [0.9, 0, 0];
    o.hipR = [-0.3, 0, 0]; o.kneeR = [1.2, 0, 0];
    o.cape = [1.0, 0, 0];
  },
  ultSlam(t, p, o) { // crouched impact, blade buried
    o.torso = [0.85, 0, 0];
    o.head = [-0.5, 0, 0];
    o.shR = [1.6, 0, 0.2];
    o.elR = [0.3, 0, 0];
    o.grip = [-2.2, 0, 0];
    o.shL = [0.6, 0, -0.9];
    o.elL = [0.8, 0, 0];
    o.hips = [0, 0, 0, 0, -0.3, 0];
    o.hipL = [1.15, 0, -0.1]; o.kneeL = [1.5, 0, 0];
    o.hipR = [-0.6, 0, 0.1]; o.kneeR = [1.6, 0, 0];
    o.cape = [1.1, 0, 0];
  },
  hit(t, p, o) {
    POSES.idle(0, p, o);
    const k = Math.sin(Math.min(t / 0.3, 1) * Math.PI);
    o.torso = [-0.16 * k, 0.08 * k, 0];
    o.head = [0.2 * k, 0, 0];
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
    o.cape = [-0.3 * k, 0, 0];
  },
  showcase(t, p, o) { // hero-shot stance: blade angled across the body
    const b = Math.sin(t * 1.5);
    o.torso = [0.04 + b * 0.02, -0.32, 0];
    o.hips = [0, -0.18, 0, 0, b * 0.012, 0];
    o.head = [-0.05 + b * 0.02, 0.3, 0];
    o.shR = [-1.55, -0.15, 0.62];
    o.elR = [0.5, 0, 0.15];
    o.grip = [-1.1, 0.25, -0.45];
    o.shL = [0.25 + b * 0.03, 0, -0.35];
    o.elL = [0.55, 0, -0.15];
    o.hipL = [0.03, 0, -0.04]; o.kneeL = [0.06, 0, 0];
    o.hipR = [-0.1, 0.1, 0.05]; o.kneeR = [0.18, 0, 0];
    o.cape = [0.14 + b * 0.03, 0, 0.06];
  },
  channel(t, p, o) { // recall / victory
    POSES.idle(t, p, o);
    const k = Math.min(t / 0.5, 1);
    o.shR = [-2.6 * k, 0, 0.4];
    o.grip = [-1.2, 0, 0];
    o.shL = [-2.2 * k, 0, -0.5];
    o.head = [0.35 * k, 0, 0];
  },
};
function sm01(x) { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); }

// -------------------------------------------------------------------- Hero --
export class Hero extends Unit {
  constructor({ name, team, build, x = 0, z = 0 }) {
    super({ team, kind: 'hero', maxHp: 600, radius: 0.5, speed: 7.0, x, z, hpW: 1.35, hpY: 2.75 });
    this.isHero = true;
    this.name = name;
    this.isSera = build === 'sera';
    this.rig = buildRig(this.isSera ? SERA : KARGATH, this.isSera);
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
    // ponytail counter-sway
    if (this.rig.ponytail) {
      this.rig.ponytail.rotation.z = Math.sin(uTime.value * 2.2 + 1) * 0.12 + (this.moving ? Math.sin(a.t * 11) * 0.14 : 0);
    }
    // cape root responds to motion
    const capeJ = this.rig.joints.cape;
    if (this.moving) capeJ.rotation.x = Math.max(capeJ.rotation.x, 0.2);
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
