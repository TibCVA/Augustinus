// Sky gradient dome, golden-hour sun + shadows, fog, cloud sea below the arena,
// floating rock islets, drifting petals / fireflies / dust motes, light shafts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, mats, uTime, PAL } from '../core/assets.js';
import { RNG } from '../core/rng.js';
import { Bucket, mat4, lathe, jitterGeo, boxUV } from './props.js';

export function buildEnvironment(scene, quality = 1) {
  const group = new THREE.Group();
  scene.add(group);

  // ------------------------------------------------------------------ fog --
  scene.fog = new THREE.Fog(0xf0c79b, 130, 480);

  // ----------------------------------------------------------------- light --
  const sunDir = new THREE.Vector3(-0.42, 0.62, -0.55).normalize();
  const sun = new THREE.DirectionalLight(PAL.sun, 2.9);
  sun.position.copy(sunDir).multiplyScalar(70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -64; sun.shadow.camera.right = 64;
  sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 12; sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.55;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xa8d8ff, 0x8f7a55, 0.95);
  scene.add(hemi);

  // ------------------------------------------------------------------- sky --
  {
    const g = new THREE.SphereGeometry(420, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSunDir: { value: sunDir } },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uSunDir;
        void main() {
          float h = vDir.y;
          vec3 zen = vec3(0.10, 0.28, 0.54);
          vec3 mid = vec3(0.46, 0.67, 0.84);
          vec3 hor = vec3(1.0, 0.7, 0.44);
          vec3 low = vec3(0.94, 0.54, 0.3);
          vec3 col = mix(mid, zen, smoothstep(0.12, 0.72, h));
          col = mix(hor, col, smoothstep(0.0, 0.22, h));
          col = mix(low, col, smoothstep(-0.32, 0.04, h));
          float d = max(dot(vDir, uSunDir), 0.0);
          col += vec3(1.0, 0.72, 0.4) * pow(d, 6.0) * 0.14;         // warm haze
          col += vec3(1.0, 0.85, 0.6) * pow(d, 120.0) * 0.55;       // halo
          col += vec3(1.25, 1.05, 0.8) * smoothstep(0.99945, 0.99975, d); // disc
          // painted streak clouds
          float band = sin(vDir.x * 4.0 + vDir.y * 22.0) * sin(vDir.z * 3.0 - vDir.y * 16.0);
          float cl = smoothstep(0.55, 0.9, band) * smoothstep(0.4, 0.16, h) * step(0.02, h);
          col = mix(col, vec3(1.0, 0.86, 0.72), cl * 0.22);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(g, mat);
    sky.frustumCulled = false;
    group.add(sky);
  }

  // --------------------------------------------------------- distant clouds --
  {
    const geos = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + RNG.f(0.5);
      const r = RNG.f(230, 300);
      const w = RNG.f(90, 150);
      const g = new THREE.PlaneGeometry(w, w * 0.5);
      const y = RNG.f(6, 46);
      const m = mat4(Math.cos(a) * r, y, Math.sin(a) * r, 0, -a - Math.PI / 2, 0);
      g.applyMatrix4(m);
      geos.push(g.toNonIndexed());
    }
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
      map: tex.cloud, transparent: true, depthWrite: false, fog: false,
      opacity: 0.85, color: 0xffe8cf,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // -------------------------------------------------------------- cloud sea --
  const seaMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uTime, tNoise: { value: tex.noise },
      uCol1: { value: new THREE.Color(0x415f8c) },
      uCol2: { value: new THREE.Color(0xf2bf88) },
      uDir: { value: new THREE.Vector2(1, 0.3) },
      uScale: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vWp;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D tNoise; uniform float uTime;
      uniform vec3 uCol1; uniform vec3 uCol2; uniform vec2 uDir; uniform float uScale;
      varying vec2 vUv; varying vec3 vWp;
      void main() {
        vec2 p = vUv * 4.2 * uScale;
        float t = uTime * 0.008;
        float n = texture2D(tNoise, p * 0.5 + uDir * t * 4.0).g;
        n += texture2D(tNoise, p * 1.7 - uDir.yx * t * 9.0).r * 0.5;
        n /= 1.5;
        float a = smoothstep(0.44, 0.66, n);
        vec3 col = mix(uCol1, uCol2, pow(smoothstep(0.4, 0.92, n), 2.6));
        float edge = 1.0 - smoothstep(150.0, 240.0, length(vWp.xz));
        gl_FragColor = vec4(col, a * 0.94 * edge);
      }`,
  });
  {
    const g1 = new THREE.PlaneGeometry(560, 560);
    g1.rotateX(-Math.PI / 2);
    // deep abyss floor under the clouds (parallax depth in the chasm)
    const voidPlane = new THREE.Mesh(g1, new THREE.MeshBasicMaterial({ color: 0x415f8a, fog: false }));
    voidPlane.position.y = -26;
    voidPlane.renderOrder = -9;
    voidPlane.matrixAutoUpdate = false; voidPlane.updateMatrix();
    group.add(voidPlane);
    const sea1 = new THREE.Mesh(g1, seaMat);
    sea1.position.y = -13.5;
    sea1.renderOrder = -6;
    const seaMat2 = seaMat.clone();
    seaMat2.uniforms.uTime = uTime;
    seaMat2.uniforms.uDir.value = new THREE.Vector2(-0.7, 0.6);
    seaMat2.uniforms.uCol1.value = new THREE.Color(0x3b5578);
    seaMat2.uniforms.uCol2.value = new THREE.Color(0xc99e72);
    seaMat2.uniforms.uScale.value = 1.9;
    const sea2 = new THREE.Mesh(g1, seaMat2);
    sea2.position.y = -18.5;
    sea2.renderOrder = -7;
    group.add(sea1, sea2);
    sea1.matrixAutoUpdate = false; sea1.updateMatrix();
    sea2.matrixAutoUpdate = false; sea2.updateMatrix();
  }

  // ----------------------------------------------------------------- islets --
  const isletGroups = [];
  {
    const spots = [
      [72, -4.5, 26, 2.6], [-70, -6, 30, 3.2], [66, -7.5, -30, 2.2], [-64, -4, -26, 1.8],
      [12, -7, 42, 2.8], [-18, -8.5, 44, 3.4], [30, -10, -46, 2.4], [-40, -6, -40, 2.0],
      [92, -11, 4, 3.8], [-95, -9, -8, 4.2],
    ];
    for (let k = 0; k < 2; k++) {
      const B = new Bucket();
      for (let i = k; i < spots.length; i += 2) {
        const [x, y, z, s] = spots[i];
        // rock blob
        const rock = lathe([[0.01, -1.6], [0.55, -1.1], [0.85, -0.45], [1.0, 0], [0.92, 0.18]], 8, true);
        jitterGeo(rock, 0.16, RNG);
        B.add(rock, 'cliff', mat4(x, y, z, 0, RNG.f(6.28), 0, s, s * RNG.f(0.8, 1.2), s),
          { base: 0xa89a84, jitter: 0.12, moss: 0.4, ao: 0.25, aoY0: -1.6, aoY1: 0.2 });
        // grass cap
        const cap = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.42);
        boxUV(cap, 0.5);
        B.add(cap, 'grass', mat4(x, y - 0.12, z, 0, 0, 0, s * 0.98, s * 0.45, s * 0.98),
          { base: 0x7cb050, jitter: 0.14, ao: 0, topLight: 0.25 });
        if (s > 2.4) { // mini blossom tree
          const trunk = new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 0.5 * s, 5);
          trunk.translate(0, 0.25 * s, 0);
          B.add(trunk, 'bark', mat4(x + s * 0.2, y + 0.3, z), { base: 0x9c8161 });
          const blob = new THREE.IcosahedronGeometry(0.32 * s, 1);
          jitterGeo(blob, 0.05 * s, RNG);
          B.add(blob, 'canopyPink', mat4(x + s * 0.2, y + 0.62 * s, z),
            { base: 0xff9db8, jitter: 0.1, ao: 0.3, aoY0: -0.4 * s, aoY1: 0.3 * s });
        }
      }
      const holder = new THREE.Group();
      B.build(holder, {});
      holder.userData.phase = k * 2.4;
      group.add(holder);
      isletGroups.push(holder);
    }
  }

  // ------------------------------------------------------------ light shafts --
  {
    const geos = [];
    const mk = (x, y, z, w, h, ry) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.applyMatrix4(mat4(x, y, z, 0.42, ry, 0.12));
      geos.push(g.toNonIndexed());
    };
    mk(-3, 5.2, -12.5, 3.4, 12, 0.4);
    mk(4.5, 4.6, -11.8, 2.6, 10, -0.3);
    mk(-19, 4.2, -12.8, 2.2, 9, 0.2);
    mk(21, 4.4, -12.2, 2.8, 10, -0.15);
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
      map: tex.shaft, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, opacity: 0.14, color: 0xffd9a0,
      side: THREE.DoubleSide,
    }));
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 5;
    group.add(mesh);
  }

  // ------------------------------------------------ GPU particles (points) --
  function makeDrifters({ count, box, tint, size, tex_, speed, flutter, rise = 0, additive = false, opacity = 1 }) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = RNG.f(box[0], box[3]);
      pos[i * 3 + 1] = RNG.f(box[1], box[4]);
      pos[i * 3 + 2] = RNG.f(box[2], box[5]);
      seed[i] = RNG.next();
      c.setHex(tint[Math.floor(RNG.next() * tint.length)]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTime, tMap: { value: tex_ }, uSize: { value: size }, uOp: { value: opacity } },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime; uniform float uSize;
        varying float vSeed; varying vec3 vCol;
        void main() {
          vSeed = aSeed; vCol = color;
          vec3 p = position;
          float t = uTime * ${speed.toFixed(3)};
          p.x = mod(p.x + t * (0.6 + aSeed * 0.8) - (${box[0].toFixed(1)}), ${(box[3] - box[0]).toFixed(1)}) + (${box[0].toFixed(1)});
          p.y += sin(uTime * (0.5 + aSeed) + aSeed * 40.0) * ${flutter.toFixed(2)} + uTime * ${rise.toFixed(3)};
          p.y = mod(p.y - (${box[1].toFixed(1)}), ${(box[4] - box[1]).toFixed(1)}) + (${box[1].toFixed(1)});
          p.z += cos(uTime * (0.4 + aSeed * 0.7) + aSeed * 17.0) * ${(flutter * 1.4).toFixed(2)};
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(uSize * (1.0 + aSeed * 0.7) * (140.0 / max(-mv.z, 4.0)), 38.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap; uniform float uTime; uniform float uOp;
        varying float vSeed; varying vec3 vCol;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float a = uTime * (1.5 + vSeed * 3.0) + vSeed * 6.28;
          vec2 ruv = vec2(uv.x * cos(a) - uv.y * sin(a), uv.x * sin(a) + uv.y * cos(a)) + 0.5;
          vec4 c = texture2D(tMap, ruv);
          float tw = 0.75 + 0.25 * sin(uTime * (2.0 + vSeed * 4.0) + vSeed * 31.0);
          gl_FragColor = vec4(c.rgb * vCol, c.a * tw * uOp);
          if (gl_FragColor.a < 0.02) discard;
        }`,
      vertexColors: true,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    return pts;
  }

  // blossom petals drifting across the whole arena
  group.add(makeDrifters({
    count: Math.round(230 * quality), box: [-58, 0.3, -17, 58, 11, 17],
    tint: [0xffc9d8, 0xffa9c1, 0xff8fb0, 0xffe0ea], size: 7.5, tex_: tex.petal,
    speed: 1.4, flutter: 0.8,
  }));
  // fireflies at the rails (bloom picks these up)
  group.add(makeDrifters({
    count: Math.round(70 * quality), box: [-50, 0.6, -16, 50, 3.2, 16],
    tint: [0xaffff0, 0x8fe8ff, 0xfff0b0], size: 3.6, tex_: tex.dot,
    speed: 0.24, flutter: 0.5, additive: true, opacity: 0.5,
  }));
  // warm dust motes floating over the lane
  group.add(makeDrifters({
    count: Math.round(110 * quality), box: [-40, 0.4, -8, 40, 5.5, 8],
    tint: [0xffe2b0, 0xffd9a0], size: 2.6, tex_: tex.dot,
    speed: 0.5, flutter: 0.35, rise: 0.02, additive: true, opacity: 0.5,
  }));

  // ---------------------------------------------------------------- update --
  function update(dt) {
    for (const g of isletGroups) {
      g.position.y = Math.sin(uTime.value * 0.4 + g.userData.phase) * 0.5;
      g.rotation.y = Math.sin(uTime.value * 0.11 + g.userData.phase) * 0.012;
    }
    // rune decal pulse (shared material)
    mats.rune.opacity = 0.62 + 0.25 * Math.sin(uTime.value * 1.9);
  }

  return { group, sun, hemi, sunDir, update };
}
