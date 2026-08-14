// VFX system: pooled particles (one instanced draw per blend mode), projectile
// pool, shockwave rings, ground decals & telegraphs, sword ribbon-trails, tower
// beams, dash afterimages, screen shake + flash. Zero per-frame allocations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, uTime } from '../core/assets.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

// ------------------------------------------------------------ particle pool --
class ParticlePool {
  constructor(scene, cap, texture, additive, atlas = 2) {
    this.cap = cap;
    this.n = 0;
    this.atlas = atlas;
    // CPU state
    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.life = new Float32Array(cap); this.maxLife = new Float32Array(cap);
    this.size0 = new Float32Array(cap); this.size1 = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.rotV = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap);
    this.cr = new Float32Array(cap); this.cg = new Float32Array(cap); this.cb = new Float32Array(cap);
    this.alpha = new Float32Array(cap); this.sprite = new Float32Array(cap);
    // GPU attributes
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // size, rot, alpha, sprite
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aCol', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { tMap: { value: texture } },
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aData; attribute vec3 aCol;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        void main() {
          vUv = uv; vCol = aCol; vA = aData.z; vSprite = aData.w;
          float cr = cos(aData.y), sr = sin(aData.y);
          vec2 p = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * aData.x;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = aPos + right * p.x + up * p.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vSprite;
        void main() {
          float k = ${atlas.toFixed(1)};
          vec2 cell = vec2(mod(vSprite, k), floor(vSprite / k));
          vec4 c = texture2D(tMap, (vUv + cell) / k);
          gl_FragColor = vec4(c.rgb * vCol, c.a * vA);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }
  spawn(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 0.6;
    this.size0[i] = o.size ?? 0.3; this.size1[i] = o.sizeEnd ?? (o.size ?? 0.3);
    this.rot[i] = o.rot || 0; this.rotV[i] = o.rotV || 0;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag ?? 0.5;
    _c.setHex(o.col ?? 0xffffff);
    this.cr[i] = _c.r * (o.glow || 1); this.cg[i] = _c.g * (o.glow || 1); this.cb[i] = _c.b * (o.glow || 1);
    this.alpha[i] = o.alpha ?? 1;
    this.sprite[i] = o.sprite || 0;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) {
      for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size0', 'size1', 'rot', 'rotV', 'grav', 'drag', 'cr', 'cg', 'cb', 'alpha', 'sprite'])
        this[k][i] = this[k][l];
    }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }
    // write attributes
    const P = this.aPos.array, D = this.aData.array, C = this.aCol.array;
    for (let j = 0; j < this.n; j++) {
      const t = this.life[j] / this.maxLife[j];
      P[j * 3] = this.px[j]; P[j * 3 + 1] = this.py[j]; P[j * 3 + 2] = this.pz[j];
      D[j * 4] = this.size0[j] + (this.size1[j] - this.size0[j]) * t;
      D[j * 4 + 1] = this.rot[j];
      const fadeIn = Math.min(1, this.life[j] * 12);
      D[j * 4 + 2] = this.alpha[j] * fadeIn * (1 - t * t);
      D[j * 4 + 3] = this.sprite[j];
      C[j * 3] = this.cr[j]; C[j * 3 + 1] = this.cg[j]; C[j * 3 + 2] = this.cb[j];
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}

function makeAtlas(items, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const k = 2, cell = size / k;
  items.forEach((t, i) => {
    ctx.drawImage(t.image, (i % k) * cell, Math.floor(i / k) * cell, cell, cell);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------- VFX --
export class VFX {
  constructor({ scene, groundHeight, gradeUniforms, onText }) {
    this.scene = scene;
    this.groundHeight = groundHeight;
    this.grade = gradeUniforms;
    this.onText = onText || (() => {});
    this.trauma = 0;
    this.time = 0;

    // canvas row0 = uv TOP → sprite id s maps to items[(s+2)%4]; order so that:
    // pAdd: 0=dot 1=spark 2=slash 3=ring · pAlpha: 0=smoke 1=petal 2=crack 3=dot
    const atlasAdd = makeAtlas([tex.slash, tex.ring, tex.dot, tex.spark]);
    const atlasAlpha = makeAtlas([tex.crack, tex.dot, tex.smoke, tex.petal]);
    this.pAdd = new ParticlePool(scene, 300, atlasAdd, true);
    this.pAlpha = new ParticlePool(scene, 160, atlasAlpha, false);

    // ---- ring pool (flat expanding shockwaves) ----
    this.rings = [];
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: tex.ring, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffffff, opacity: 1,
      }));
      m.visible = false; m.renderOrder = 7; m.frustumCulled = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 1e9, dur: 1, r0: 0, r1: 1, alpha: 1 });
    }

    // ---- slash arc pool ----
    this.slashes = [];
    const slashGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(slashGeo, new THREE.MeshBasicMaterial({
        map: tex.slash, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false; m.renderOrder = 7; m.frustumCulled = false;
      scene.add(m);
      this.slashes.push({ mesh: m, t: 1e9, dur: 0.3, vel: new THREE.Vector3(), grow: 1 });
    }

    // ---- decal pool (craters / scorch) ----
    this.decals = [];
    const decalGeo = new THREE.PlaneGeometry(2, 2);
    decalGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const dark = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
        map: tex.crack, transparent: true, depthWrite: false, color: 0x120c08, opacity: 0.9,
      }));
      const glow = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
        map: tex.crack, transparent: true, depthWrite: false, color: 0xffa93d,
        blending: THREE.AdditiveBlending, opacity: 0.9,
      }));
      dark.visible = glow.visible = false;
      dark.renderOrder = 3; glow.renderOrder = 4;
      dark.frustumCulled = glow.frustumCulled = false;
      scene.add(dark, glow);
      this.decals.push({ dark, glow, t: 1e9, dur: 7 });
    }

    // ---- telegraph pool ----
    this.tele = [];
    const teleGeo = new THREE.CircleGeometry(1, 40);
    teleGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          uTime, uColor: { value: new THREE.Color(0xff5533) }, uProg: { value: 0 }, uA: { value: 1 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uProg; uniform float uA; uniform float uTime;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float edge = smoothstep(0.86, 0.94, d) * (1.0 - smoothstep(0.97, 1.0, d));
            float fill = (1.0 - smoothstep(0.0, 1.0, d)) * (0.16 + 0.06 * sin(uTime * 6.0));
            float sweep = step(d, uProg) * (1.0 - smoothstep(0.0, 1.0, d)) * 0.28;
            float a = (edge * 0.9 + fill + sweep) * uA;
            gl_FragColor = vec4(uColor * 1.4, a);
          }`,
      });
      const m = new THREE.Mesh(teleGeo, mat);
      m.visible = false; m.renderOrder = 5; m.frustumCulled = false;
      scene.add(m);
      this.tele.push({ mesh: m, active: false });
    }

    // ---- projectiles ----
    this.projs = [];
    for (let i = 0; i < 14; i++) {
      this.projs.push({
        active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        target: null, to: new THREE.Vector3(), speed: 10, size: 0.3,
        col: 0xffffff, onHit: null, t: 0, trailAcc: 0, arc: 0, dur: 0, from: new THREE.Vector3(),
      });
    }
    {
      const quad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.attributes.position = quad.attributes.position;
      geo.attributes.uv = quad.attributes.uv;
      this.projPos = new THREE.InstancedBufferAttribute(new Float32Array(14 * 4), 4);
      this.projCol = new THREE.InstancedBufferAttribute(new Float32Array(14 * 3), 3);
      this.projPos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPos', this.projPos);
      geo.setAttribute('aCol', this.projCol);
      geo.instanceCount = 0;
      this.projGeo = geo;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { tMap: { value: tex.dot } },
        vertexShader: `
          attribute vec4 aPos; attribute vec3 aCol;
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            vUv = uv; vCol = aCol;
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 wp = aPos.xyz + (right * position.x + up * position.y) * aPos.w;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D tMap;
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            vec4 c = texture2D(tMap, vUv);
            gl_FragColor = vec4(vCol * 1.7, c.a);
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; m.renderOrder = 7;
      scene.add(m);
    }

    // ---- beams ----
    this.beams = [];
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime, uColor: { value: new THREE.Color(0xffffff) }, uA: { value: 1 } },
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uA; uniform float uTime;
          varying vec2 vUv;
          void main() {
            float stripes = 0.75 + 0.25 * sin((vUv.y - uTime * 3.0) * 40.0);
            float endFade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
            gl_FragColor = vec4(uColor * (1.1 + stripes * 0.5), uA * endFade * 0.55);
          }`,
      });
      const m = new THREE.Mesh(beamGeo, mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 7;
      scene.add(m);
      this.beams.push({ mesh: m, t: 1e9, dur: 0.4, r: 0.2 });
    }

    // ---- sword trails ----
    this.trails = [];
    for (let i = 0; i < 2; i++) {
      const N = 16;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 2 * 3);
      const uv = new Float32Array(N * 2 * 2);
      const idx = [];
      for (let s = 0; s < N; s++) {
        uv[(s * 2) * 2] = s / (N - 1); uv[(s * 2) * 2 + 1] = 0;
        uv[(s * 2 + 1) * 2] = s / (N - 1); uv[(s * 2 + 1) * 2 + 1] = 1;
        if (s < N - 1) {
          const a = s * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0x9fe8ff) }, uA: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uA;
          varying vec2 vUv;
          void main() {
            float a = vUv.x * vUv.x * uA * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.05, 0.4, vUv.y);
            gl_FragColor = vec4(mix(uColor, vec3(1.0), vUv.x * 0.6) * 1.2, a);
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; m.renderOrder = 7;
      scene.add(m);
      this.trails.push({ mesh: m, geo, N, head: 0, filled: 0, active: false, fade: 0 });
    }

    // ---- dash ghosts ----
    this.ghosts = [];
    {
      const body = new THREE.CapsuleGeometry(0.34, 0.85, 4, 10);
      body.translate(0, 1.15, 0);
      const head = new THREE.SphereGeometry(0.23, 10, 8);
      head.translate(0, 1.95, 0);
      const g = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()], false);
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: 0x6fd4ff, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        m.visible = false; m.frustumCulled = false; m.renderOrder = 6;
        this.scene.add(m);
        this.ghosts.push({ mesh: m, t: 1e9, dur: 0.34 });
      }
    }
  }

  // ------------------------------------------------------------- primitives --
  burst(x, y, z, { count = 10, col = 0xffe9b0, col2 = null, speed = 5, up = 2.5, life = 0.5, size = 0.28, sizeEnd = 0.05, gravity = 6, spread = 1, sprite = 1, pool = 'add', glow = 1.6, drag = 2, alpha = 1 } = {}) {
    const P = pool === 'add' ? this.pAdd : this.pAlpha;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const sp = speed * (0.4 + Math.random() * 0.6);
      P.spawn({
        x: x + Math.cos(a) * r * spread * 0.4, y: y + Math.random() * 0.2, z: z + Math.sin(a) * r * spread * 0.4,
        vx: Math.cos(a) * sp * spread, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * sp * spread,
        life: life * (0.6 + Math.random() * 0.7), size: size * (0.7 + Math.random() * 0.6), sizeEnd,
        col: col2 && Math.random() < 0.5 ? col2 : col, gravity, drag,
        rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 6, sprite, glow, alpha,
      });
    }
  }
  ring(x, y, z, { r0 = 0.3, r1 = 5, dur = 0.5, col = 0xfff2cf, alpha = 0.75 } = {}) {
    for (const R of this.rings) {
      if (R.t < R.dur) continue;
      R.t = 0; R.dur = dur; R.r0 = r0; R.r1 = r1; R.alpha = alpha;
      R.mesh.position.set(x, y + 0.12, z);
      R.mesh.material.color.setHex(col);
      R.mesh.visible = true;
      return;
    }
  }
  slashArc(x, y, z, yaw, { col = 0x9fe8ff, size = 2.6, dur = 0.26, tilt = -1.15, vel = 0, grow = 1.6 } = {}) {
    for (const S of this.slashes) {
      if (S.t < S.dur) continue;
      S.t = 0; S.dur = dur; S.grow = grow;
      S.mesh.position.set(x, y, z);
      S.mesh.rotation.set(tilt, yaw, 0, 'YXZ');
      S.mesh.scale.setScalar(size * 0.55);
      S.mesh.material.color.setHex(col);
      S.mesh.material.opacity = 1;
      S.mesh.visible = true;
      S.baseSize = size;
      S.vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(vel);
      return;
    }
  }
  decal(x, z, { size = 5, dur = 7, glowCol = 0xffa93d } = {}) {
    let best = this.decals[0];
    for (const D of this.decals) { if (D.t >= D.dur) { best = D; break; } if (D.t > best.t) best = D; }
    const y = this.groundHeight(x, z);
    best.t = 0; best.dur = dur;
    best.dark.position.set(x, y + 0.06, z);
    best.glow.position.set(x, y + 0.08, z);
    best.dark.scale.setScalar(size / 2); best.glow.scale.setScalar(size / 2);
    best.dark.rotation.y = best.glow.rotation.y = Math.random() * 6.28;
    best.glow.material.color.setHex(glowCol);
    best.dark.visible = best.glow.visible = true;
  }
  telegraph(x, z, r, col = 0xff5533) {
    for (const T of this.tele) {
      if (T.active) continue;
      T.active = true;
      T.mesh.position.set(x, this.groundHeight(x, z) + 0.1, z);
      T.mesh.scale.setScalar(r);
      T.mesh.material.uniforms.uColor.value.setHex(col);
      T.mesh.material.uniforms.uProg.value = 0;
      T.mesh.material.uniforms.uA.value = 1;
      T.mesh.visible = true;
      return T;
    }
    return null;
  }
  endTelegraph(T) { if (T) { T.active = false; T.mesh.visible = false; } }

  projectile({ from, target = null, to = null, speed = 14, col = 0x8fd4ff, size = 0.34, onHit = null, arc = 0, trail = true }) {
    for (const p of this.projs) {
      if (p.active) continue;
      p.active = true;
      p.pos.copy(from); p.from.copy(from);
      p.target = target;
      if (to) p.to.copy(to);
      else if (target) { p.to.copy(target.pos); p.to.y += 0.9; }
      p.speed = speed; p.col = col; p.size = size; p.onHit = onHit;
      p.t = 0; p.arc = arc; p.trailAcc = 0;
      p.dur = Math.max(0.05, p.pos.distanceTo(p.to) / speed);
      return p;
    }
    return null;
  }
  beam(from, to, { col = 0xff8a4d, dur = 0.32, r = 0.22 } = {}) {
    for (const b of this.beams) {
      if (b.t < b.dur) continue;
      b.t = 0; b.dur = dur; b.r = r;
      _v1.copy(to).sub(from);
      const len = _v1.length();
      b.mesh.position.copy(from).addScaledVector(_v1, 0.5);
      _q.setFromUnitVectors(UP, _v1.normalize());
      b.mesh.quaternion.copy(_q);
      b.mesh.scale.set(r, len, r);
      b.mesh.material.uniforms.uColor.value.setHex(col);
      b.mesh.material.uniforms.uA.value = 1;
      b.mesh.visible = true;
      return;
    }
  }
  pillar(x, y, z, { col = 0xffd98c, dur = 0.5, r = 0.8, h = 6 } = {}) {
    _v1.set(x, y, z); _v2.set(x, y + h, z);
    this.beam(_v1, _v2, { col, dur, r });
  }
  spawnGhost(pos, yaw, lean = 0.4, col = 0x6fd4ff) {
    for (const g of this.ghosts) {
      if (g.t < g.dur) continue;
      g.t = 0;
      g.mesh.position.copy(pos);
      g.mesh.rotation.set(lean, yaw, 0, 'YXZ');
      g.mesh.material.color.setHex(col);
      g.mesh.visible = true;
      return;
    }
  }
  trailPush(id, base, tip) {
    const T = this.trails[id];
    const g = T.geo.attributes.position.array;
    if (T.filled === 0) {
      // prime the whole ribbon at the current blade position
      for (let s = 0; s < T.N; s++) {
        const a = s * 6;
        g[a] = base.x; g[a + 1] = base.y; g[a + 2] = base.z;
        g[a + 3] = tip.x; g[a + 4] = tip.y; g[a + 5] = tip.z;
      }
      T.filled = T.N;
    } else {
      // shift left, append newest at the end
      for (let s = 0; s < T.N - 1; s++) {
        const a = s * 6, b = (s + 1) * 6;
        for (let k = 0; k < 6; k++) g[a + k] = g[b + k];
      }
      const last = (T.N - 1) * 6;
      g[last] = base.x; g[last + 1] = base.y; g[last + 2] = base.z;
      g[last + 3] = tip.x; g[last + 4] = tip.y; g[last + 5] = tip.z;
    }
    T.geo.attributes.position.needsUpdate = true;
  }
  trailActive(id, on, col = null) {
    const T = this.trails[id];
    if (on && !T.active) { T.filled = 0; }
    T.active = on;
    if (col !== null) T.mesh.material.uniforms.uColor.value.setHex(col);
    if (on) T.fade = 1;
  }

  shake(amt) { this.trauma = Math.min(1.2, this.trauma + amt); }
  flash(amt) { if (this.grade) this.grade.uFlash.value = Math.min(0.8, this.grade.uFlash.value + amt); }
  text(pos, str, kind) { this.onText(pos, str, kind); }

  getShakeOffset(out, t) {
    const k = this.trauma * this.trauma;
    out.set(
      Math.sin(t * 47.1) * 0.5 + Math.sin(t * 89.7) * 0.5,
      Math.sin(t * 61.3 + 2) * 0.5 + Math.sin(t * 101.1) * 0.5,
      Math.sin(t * 53.7 + 4) * 0.6,
    ).multiplyScalar(k * 0.55);
    return k;
  }

  // -------------------------------------------------------------- composites --
  hitSpark(x, y, z, col = 0xffe9b0) {
    this.burst(x, y, z, { count: 7, col, col2: 0xffffff, speed: 4, up: 2, life: 0.34, size: 0.22, gravity: 5, sprite: 1 });
    this.burst(x, y, z, { count: 1, col, speed: 0, up: 0, life: 0.14, size: 0.42, sizeEnd: 0.12, gravity: 0, sprite: 0, glow: 1.3, alpha: 0.6 });
  }
  meleeImpact(x, y, z, col) {
    this.hitSpark(x, y, z, col);
    this.burst(x, y, z, { count: 3, col: 0x9a8a70, speed: 2.5, up: 2.2, life: 0.5, size: 0.14, gravity: 7, sprite: 3, pool: 'alpha', glow: 1 });
  }
  deathBurst(x, y, z, col = 0x8fd4ff) {
    this.burst(x, y, z, { count: 14, col, col2: 0xffffff, speed: 3.5, up: 3.2, life: 0.7, size: 0.3, gravity: 3, sprite: 1 });
    this.burst(x, y, z, { count: 6, col: 0xdad4c8, speed: 1.6, up: 1.2, life: 0.8, size: 0.55, sizeEnd: 1.1, gravity: -0.4, sprite: 0, pool: 'alpha', alpha: 0.5, glow: 1 });
    this.ring(x, y + 0.05, z, { r0: 0.2, r1: 2.6, dur: 0.4, col });
  }
  levelUpFx(unit) {
    const p = unit.pos;
    this.ring(p.x, p.y, p.z, { r0: 0.3, r1: 3.4, dur: 0.6, col: 0xffd98c });
    this.pillar(p.x, p.y, p.z, { col: 0xffd98c, dur: 0.55, r: 0.9, h: 5 });
    this.burst(p.x, p.y + 1, p.z, { count: 16, col: 0xffd98c, col2: 0xfff6dd, speed: 2, up: 5, life: 0.8, size: 0.26, gravity: 2, sprite: 1 });
  }
  respawnFx(unit, col) {
    const p = unit.pos;
    this.ring(p.x, p.y, p.z, { r0: 0.4, r1: 3, dur: 0.5, col });
    this.pillar(p.x, p.y, p.z, { col, dur: 0.5, r: 1.1, h: 6 });
    this.burst(p.x, p.y + 1, p.z, { count: 12, col, speed: 1.5, up: 4, life: 0.7, size: 0.22, sprite: 1 });
  }
  dawnfall(x, y, z, r) {
    this.flash(0.2);
    this.shake(0.9);
    this.ring(x, y, z, { r0: 0.5, r1: r * 1.6, dur: 0.5, col: 0xffe2a0, alpha: 0.7 });
    this.ring(x, y, z, { r0: 0.2, r1: r * 1.05, dur: 0.38, col: 0x8fe8ff, alpha: 0.6 });
    this.decal(x, z, { size: r * 1.7, dur: 8, glowCol: 0xffb04d });
    this.pillar(x, y, z, { col: 0xffe9b0, dur: 0.4, r: 0.75, h: 7 });
    this.burst(x, y + 0.4, z, { count: 34, col: 0xffd98c, col2: 0xfff6dd, speed: 9, up: 5, life: 0.7, size: 0.34, gravity: 8, spread: 1.2, sprite: 1, glow: 2 });
    this.burst(x, y + 0.2, z, { count: 12, col: 0x8a7a5e, speed: 6, up: 6, life: 0.9, size: 0.3, gravity: 9, sprite: 3, pool: 'alpha', glow: 1 });
    this.burst(x, y + 0.3, z, { count: 10, col: 0xc9b89a, speed: 3, up: 1.4, life: 1.1, size: 0.9, sizeEnd: 2.2, gravity: -0.2, sprite: 0, pool: 'alpha', alpha: 0.55, glow: 1 });
  }

  // wipe all transient effects (used by preset staging)
  resetAll() {
    this.pAdd.n = 0; this.pAlpha.n = 0;
    this.pAdd.geo.instanceCount = 0; this.pAlpha.geo.instanceCount = 0;
    for (const R of this.rings) { R.t = 1e9; R.mesh.visible = false; }
    for (const S of this.slashes) { S.t = 1e9; S.mesh.visible = false; }
    for (const D of this.decals) { D.t = 1e9; D.dark.visible = D.glow.visible = false; }
    for (const T of this.tele) { T.active = false; T.mesh.visible = false; }
    for (const b of this.beams) { b.t = 1e9; b.mesh.visible = false; }
    for (const g of this.ghosts) { g.t = 1e9; g.mesh.visible = false; }
    for (const p of this.projs) p.active = false;
    this.projGeo.instanceCount = 0;
    for (const T of this.trails) { T.active = false; T.fade = 0; T.filled = 0; T.mesh.material.uniforms.uA.value = 0; }
    this.trauma = 0;
    if (this.grade) this.grade.uFlash.value = 0;
  }

  // ------------------------------------------------------------------ update --
  update(dt) {
    this.time += dt;
    this.pAdd.update(dt);
    this.pAlpha.update(dt);
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    if (this.grade) this.grade.uFlash.value = Math.max(0, this.grade.uFlash.value - dt * 2.4);

    for (const R of this.rings) {
      if (R.t >= R.dur) { R.mesh.visible = false; continue; }
      R.t += dt;
      const t = Math.min(R.t / R.dur, 1);
      const e = 1 - (1 - t) * (1 - t);
      const r = R.r0 + (R.r1 - R.r0) * e;
      R.mesh.scale.setScalar(r);
      R.mesh.material.opacity = R.alpha * (1 - t);
      if (t >= 1) R.mesh.visible = false;
    }
    for (const S of this.slashes) {
      if (S.t >= S.dur) { S.mesh.visible = false; continue; }
      S.t += dt;
      const t = Math.min(S.t / S.dur, 1);
      S.mesh.scale.setScalar(S.baseSize * (0.55 + t * S.grow * 0.45));
      S.mesh.material.opacity = 0.8 * (1 - t * t);
      S.mesh.position.addScaledVector(S.vel, dt);
      if (t >= 1) S.mesh.visible = false;
    }
    for (const D of this.decals) {
      if (D.t >= D.dur) { D.dark.visible = D.glow.visible = false; continue; }
      D.t += dt;
      const t = Math.min(D.t / D.dur, 1);
      D.dark.material.opacity = 0.85 * (1 - t * t);
      D.glow.material.opacity = Math.max(0, 0.95 - D.t * 1.4);
    }
    for (const b of this.beams) {
      if (b.t >= b.dur) { b.mesh.visible = false; continue; }
      b.t += dt;
      const t = Math.min(b.t / b.dur, 1);
      b.mesh.material.uniforms.uA.value = 1 - t * t;
      const w = 1 + t * 0.5;
      b.mesh.scale.x = b.r * w; b.mesh.scale.z = b.r * w;
      if (t >= 1) b.mesh.visible = false;
    }
    for (const g of this.ghosts) {
      if (g.t >= g.dur) { g.mesh.visible = false; continue; }
      g.t += dt;
      const t = g.t / g.dur;
      g.mesh.material.opacity = 0.42 * (1 - t);
      g.mesh.visible = true;
    }
    // projectiles
    let pi = 0;
    const PP = this.projPos.array, PC = this.projCol.array;
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
        this.hitSpark(p.to.x, p.to.y, p.to.z, p.col);
        if (p.onHit) p.onHit(p);
        continue;
      }
      p.pos.addScaledVector(_v1.normalize(), step);
      if (p.arc > 0) {
        const ft = Math.min(p.t / totalD, 1);
        p.pos.y += Math.sin(ft * Math.PI) * p.arc * dt * 4;
      }
      if (p.trailAcc !== null) {
        p.trailAcc += dt;
        if (p.trailAcc > 0.022) {
          p.trailAcc = 0;
          this.pAdd.spawn({
            x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0.3, vz: 0,
            life: 0.3, size: p.size * 0.8, sizeEnd: 0.02, col: p.col, gravity: 0, drag: 0, sprite: 0, glow: 1.6,
          });
        }
      }
      PP[pi * 4] = p.pos.x; PP[pi * 4 + 1] = p.pos.y; PP[pi * 4 + 2] = p.pos.z; PP[pi * 4 + 3] = p.size * 2.4;
      _c.setHex(p.col);
      PC[pi * 3] = _c.r; PC[pi * 3 + 1] = _c.g; PC[pi * 3 + 2] = _c.b;
      pi++;
    }
    this.projGeo.instanceCount = pi;
    this.projPos.needsUpdate = true;
    this.projCol.needsUpdate = true;
    // trails fade out
    for (const T of this.trails) {
      if (!T.active) {
        T.fade = Math.max(0, T.fade - dt * 6);
      }
      T.mesh.material.uniforms.uA.value = T.active ? 1 : T.fade;
    }
  }
}
