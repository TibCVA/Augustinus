// Unit base class (hp, team, movement), billboard HP bars (single instanced
// draw), blob shadows, and the chunky minion rigs (3 meshes each).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mats, tex, uTime } from '../core/assets.js';
import { bakeTint, chamferBox, lathe } from '../world/props.js';

// ---------------------------------------------------------------- materials --
let unitMat = null, orbBlueMat = null, orbRedMat = null;
function ensureUnitMats() {
  if (unitMat) return;
  unitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.12 });
  orbBlueMat = new THREE.MeshStandardMaterial({
    color: 0x123c66, emissive: 0x53c8ff, emissiveIntensity: 2.2, roughness: 0.3,
  });
  orbRedMat = new THREE.MeshStandardMaterial({
    color: 0x571a10, emissive: 0xff7a36, emissiveIntensity: 2.2, roughness: 0.3,
  });
}

const TEAM = {
  blue: { cloth: 0x3667c9, clothDark: 0x24447e, trim: 0xcdd9ea, metal: 0x8fa3b8, accent: 0x7ab5ff },
  red: { cloth: 0xd4573a, clothDark: 0x8e3222, trim: 0x9a7a5c, metal: 0x8a7468, accent: 0xff9a5e },
};

function tintPart(geo, hex, opts = {}) {
  bakeTint(geo, { base: hex, jitter: 0.05, ao: opts.ao ?? 0.25, aoY0: opts.aoY0 ?? -0.4, aoY1: opts.aoY1 ?? 0.5, topLight: 0.12 });
  return geo.index ? geo.toNonIndexed() : geo;
}
function mergeParts(parts) {
  const geos = parts.map(([geo, hex, opts]) => {
    const g = tintPart(geo, hex, opts);
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(geos, false);
}

// ------------------------------------------------------------- minion geos --
const geoCache = new Map();
function minionGeos(kind, team) {
  const key = kind + team;
  if (geoCache.has(key)) return geoCache.get(key);
  const T = TEAM[team];
  let out;
  if (kind === 'melee') {
    // body: egg + helm + face shadow + tabard + feet
    const egg = new THREE.SphereGeometry(0.42, 12, 10);
    egg.scale(1, 1.12, 0.94); egg.translate(0, 0.52, 0);
    const helm = new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
    helm.translate(0, 0.78, 0);
    const brim = new THREE.TorusGeometry(0.335, 0.05, 6, 14);
    brim.rotateX(Math.PI / 2); brim.translate(0, 0.8, 0);
    const plume = new THREE.ConeGeometry(0.07, 0.3, 6);
    plume.translate(0, 1.22, -0.05);
    const face = new THREE.SphereGeometry(0.3, 8, 6, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.3);
    face.scale(1.05, 1, 1.05); face.translate(0, 0.78, 0.03);
    const tabard = new THREE.BoxGeometry(0.4, 0.5, 0.1);
    tabard.translate(0, 0.42, 0.4);
    const beltG = new THREE.TorusGeometry(0.4, 0.055, 6, 14);
    beltG.rotateX(Math.PI / 2); beltG.scale(1, 1, 0.94); beltG.translate(0, 0.42, 0);
    const footL = new THREE.SphereGeometry(0.13, 7, 5);
    footL.scale(1, 0.7, 1.3); footL.translate(-0.17, 0.08, 0.05);
    const footR = footL.clone().translate(0.34, 0, 0);
    const body = mergeParts([
      [egg, T.metal, { aoY0: 0, aoY1: 0.9 }],
      [helm, T.trim], [brim, T.cloth], [plume, T.accent],
      [face, 0x101418, { ao: 0 }],
      [tabard, T.cloth], [beltG, 0x3a2e20],
      [footL, T.clothDark], [footR, T.clothDark],
    ]);
    // shield arm
    const shArm = new THREE.CapsuleGeometry(0.09, 0.3, 3, 6);
    shArm.rotateZ(Math.PI / 2); shArm.translate(-0.18, 0, 0);
    const shield = new THREE.CylinderGeometry(0.26, 0.26, 0.07, 10);
    shield.rotateZ(Math.PI / 2); shield.translate(-0.4, 0, 0);
    const boss = new THREE.SphereGeometry(0.08, 6, 5);
    boss.translate(-0.46, 0, 0);
    const armL = mergeParts([[shArm, T.metal], [shield, T.cloth], [boss, T.trim]]);
    // sword arm
    const swArm = new THREE.CapsuleGeometry(0.09, 0.3, 3, 6);
    swArm.rotateZ(-Math.PI / 2); swArm.translate(0.18, 0, 0);
    const blade = chamferBox(0.09, 0.62, 0.03, 0.015);
    blade.translate(0.38, 0.05, 0);
    const guard = new THREE.BoxGeometry(0.2, 0.05, 0.08);
    guard.translate(0.38, 0.06, 0);
    const armR = mergeParts([[swArm, T.metal], [blade, 0xd9e2ec, { ao: 0 }], [guard, T.trim]]);
    out = { body, armL, armR, armY: 0.62, emissive: null };
  } else {
    // caster: hooded robe
    const robe = lathe([[0.34, 0], [0.4, 0.14], [0.22, 0.72], [0.26, 0.98], [0.14, 1.18]], 9);
    const hood = new THREE.SphereGeometry(0.24, 9, 7);
    hood.scale(1, 1.15, 1.05); hood.translate(0, 1.06, 0.02);
    const faceC = new THREE.SphereGeometry(0.19, 8, 6, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.36);
    faceC.translate(0, 1.05, 0.05);
    const mantle = lathe([[0.24, 0.85], [0.36, 0.72], [0.3, 0.62]], 9);
    const body = mergeParts([
      [robe, TEAM[team].cloth, { aoY0: 0, aoY1: 0.8 }],
      [mantle, TEAM[team].clothDark],
      [hood, TEAM[team].clothDark],
      [faceC, 0x0c0f14, { ao: 0 }],
    ]);
    // staff arm
    const arm = new THREE.CapsuleGeometry(0.075, 0.26, 3, 6);
    arm.rotateZ(-Math.PI / 2); arm.translate(0.16, 0, 0);
    const staff = new THREE.CylinderGeometry(0.035, 0.045, 1.15, 6);
    staff.translate(0.34, 0.18, 0.06);
    const crook = new THREE.TorusGeometry(0.11, 0.032, 5, 10, Math.PI * 1.4);
    crook.translate(0.34, 0.78, 0.06);
    const armR = mergeParts([[arm, TEAM[team].clothDark], [staff, 0x6e5138], [crook, team === 'blue' ? 0xcdd9ea : 0x4e4342]]);
    // tome arm
    const armL0 = new THREE.CapsuleGeometry(0.075, 0.2, 3, 6);
    armL0.rotateZ(Math.PI / 2); armL0.translate(-0.14, 0, 0.1);
    const tome = new THREE.BoxGeometry(0.2, 0.26, 0.08);
    tome.translate(-0.26, 0.02, 0.16);
    const armL = mergeParts([[armL0, TEAM[team].clothDark], [tome, team === 'blue' ? 0x8a6a3a : 0x3a2c28]]);
    out = { body, armL, armR, armY: 0.68, orbY: 0.92, emissive: true };
  }
  geoCache.set(key, out);
  return out;
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
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * Math.min(1, rate * dt);
  }
  syncTransform() {
    this.group.position.copy(this.pos);
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
      hpW: 0.8, hpY: opts.mkind === 'melee' ? 1.55 : 1.6,
    });
    ensureUnitMats();
    const g = minionGeos(opts.mkind, opts.team);
    this.body = new THREE.Mesh(g.body, unitMat);
    this.body.castShadow = false;
    this.armL = new THREE.Mesh(g.armL, unitMat);
    this.armR = new THREE.Mesh(g.armR, unitMat);
    this.armL.position.set(-0.34, g.armY, 0.08);
    this.armR.position.set(0.34, g.armY, 0.08);
    this.body.add(this.armL, this.armR);
    if (g.emissive) {
      this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), opts.team === 'blue' ? orbBlueMat : orbRedMat);
      this.orb.position.set(0.34, 0.78 + 0.14, 0.06);
      this.armR.add(this.orb);
    }
    this.group.add(this.body);
    this.walkPhase = Math.random() * 6.28;
    this.moving = false;
    this.attackDur = opts.mkind === 'melee' ? 0.5 : 0.8;
    this.hitScale = 0;
  }
  playAttack() { this.attackAnimT = 0; }
  getMuzzle(out) {
    if (this.orb) return this.orb.getWorldPosition(out);
    out.copy(this.pos); out.y += 0.9;
    return out;
  }
  update(dt) {
    const b = this.body;
    if (this.moving) {
      this.walkPhase += dt * this.speed * 3.1;
      b.rotation.z = Math.sin(this.walkPhase) * 0.1;
      b.rotation.x = 0.07;
      b.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.09;
      this.armL.rotation.x = Math.sin(this.walkPhase) * 0.55;
      this.armR.rotation.x = -Math.sin(this.walkPhase) * 0.55;
    } else {
      b.rotation.z *= 0.86; b.rotation.x *= 0.86;
      b.position.y += (Math.sin(uTime.value * 2 + this.id) * 0.02 - b.position.y) * 0.2;
      this.armL.rotation.x *= 0.86;
      if (this.attackAnimT < 0) this.armR.rotation.x *= 0.86;
    }
    if (this.attackAnimT >= 0) {
      this.attackAnimT += dt;
      const t = this.attackAnimT / this.attackDur;
      if (t >= 1) { this.attackAnimT = -1; }
      else if (this.kind === 'melee') {
        // windup then chop
        const w = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.25;
        this.armR.rotation.x = -1.6 * Math.min(w, 1) + (t > 0.4 ? (t - 0.4) * 4.4 : 0);
        b.rotation.x = t > 0.4 ? 0.18 : -0.06;
      } else {
        const w = Math.sin(Math.min(t, 1) * Math.PI);
        this.armR.rotation.x = -1.9 * w;
        this.armR.rotation.z = 0.4 * w;
        if (this.orb) {
          const s = 1 + w * 0.9;
          this.orb.scale.setScalar(s);
        }
      }
    } else if (this.orb) this.orb.scale.setScalar(1);
    if (this.hitScale > 0) {
      this.hitScale = Math.max(0, this.hitScale - dt * 4);
      b.scale.setScalar(1 + this.hitScale * 0.12);
    }
    this.syncTransform();
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
