// Sky + atmosphere: view-ray gradient dome (warm horizon → deep zenith, sun glow,
// god-ray streaks, high cirrus), exp2 aerial haze, a layered parallax cloud sea whose
// far field dissolves *into the sky colour itself* (no horizon edge anywhere), a
// distant cumulus band, floating rock islets, mist curling up the cliff edges, and
// drifting petals / fireflies / dust motes + light shafts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, mats, uTime, uSunDir, PAL } from '../core/assets.js';
import { SEED, makeRng } from '../core/rng.js';
import { Bucket, mat4, lathe, jitterGeo, boxUV } from './props.js';

// Local deterministic stream so environment tweaks never shift other modules' RNG.
const ER = makeRng(SEED ^ 0x7c1d53);

// ----------------------------------------------------------------- palette --
// Linear-light sky stops (rendered through ACES + grade, so they read brighter).
const SKY_ZEN = new THREE.Vector3(0.028, 0.086, 0.265);
const SKY_MID = new THREE.Vector3(0.155, 0.345, 0.610);
const SKY_HOR = new THREE.Vector3(0.640, 0.372, 0.208);
const SKY_DEEP = new THREE.Vector3(0.135, 0.160, 0.275); // below-horizon chasm haze
const SUN_TINT = new THREE.Vector3(1.000, 0.600, 0.255);
const HAZE_HEX = 0xebbd93; // scene fog / horizon haze

// Shared GLSL: uniform block + the single sky function used by the dome, the cloud
// strata and the cumulus band. Because every one of them evaluates the *same*
// function on the *same* view ray, a fully hazed cloud fragment is bit-identical to
// the sky behind it — the transition simply cannot produce a visible edge.
const SKY_UNIFORMS_GLSL = `
  uniform vec3 uSunDir;
  uniform vec3 uZen, uMid, uHor, uDeep, uSunTint;
`;
const SKY_FN_GLSL = `
  vec3 skyRay(vec3 dir) {
    float h = dir.y;
    vec3 col = mix(uMid, uZen, smoothstep(0.08, 0.72, h));
    col = mix(uHor, col, smoothstep(0.0, 0.19, h));
    col = mix(uDeep, col, smoothstep(-0.46, 0.004, h));
    // horizon warms toward the sun azimuth
    vec2 da = normalize(dir.xz + vec2(1e-5));
    vec2 sa = normalize(uSunDir.xz + vec2(1e-5));
    float az = dot(da, sa) * 0.5 + 0.5;
    col += uSunTint * exp(-abs(h) * 7.5) * az * az * 0.30;
    // forward scattering toward the sun
    float d = max(dot(dir, uSunDir), 0.0);
    col += uSunTint * (pow(d, 3.0) * 0.16 + pow(d, 24.0) * 0.42);
    return col;
  }
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
`;

export function buildEnvironment(scene, quality = 1) {
  const group = new THREE.Group();
  scene.add(group);

  // ----------------------------------------------------------------- light --
  // Lower, warmer key = long golden-hour shadows and real contrast.
  const sunDir = new THREE.Vector3(-0.44, 0.50, -0.60).normalize();
  uSunDir.value.copy(sunDir);   // shared with foliage/grass shaders in other modules
  const sun = new THREE.DirectionalLight(PAL.sun, 3.15);
  sun.position.copy(sunDir).multiplyScalar(100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -66; sun.shadow.camera.right = 66;
  sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 18; sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.55;
  scene.add(sun);
  scene.add(sun.target);
  // Cooler, dimmer fill so shadows read teal instead of milky grey.
  const hemi = new THREE.HemisphereLight(0x93cbf8, 0x8f7450, 0.95);
  scene.add(hemi);

  // The cloud strata are read at extreme grazing angles; without high anisotropy
  // the far deck mips down to featureless mush.
  if (tex.noise) { tex.noise.anisotropy = 16; tex.noise.needsUpdate = true; }

  // -------------------------------------------------------- aerial haze fog --
  // exp2 so distant islets / far arena ends lift into the horizon colour smoothly.
  scene.fog = new THREE.FogExp2(HAZE_HEX, 0.0030);

  // --------------------------------------------------------- sky uniforms ---
  const skyU = {
    uSunDir: { value: sunDir },
    uZen: { value: SKY_ZEN },
    uMid: { value: SKY_MID },
    uHor: { value: SKY_HOR },
    uDeep: { value: SKY_DEEP },
    uSunTint: { value: SUN_TINT },
  };
  const shareSky = (extra) => Object.assign({}, skyU, extra);

  // ------------------------------------------------------------------- sky --
  {
    const g = new THREE.SphereGeometry(430, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: shareSky({ uTime, tNoise: { value: tex.noise } }),
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.999995;  // pin to far plane
        }`,
      fragmentShader: `
        ${SKY_UNIFORMS_GLSL}
        uniform sampler2D tNoise; uniform float uTime;
        varying vec3 vWorld;
        ${SKY_FN_GLSL}
        void main() {
          vec3 dir = normalize(vWorld - cameraPosition);
          vec3 col = skyRay(dir);
          float d = max(dot(dir, uSunDir), 0.0);

          // soft god-ray streaks radiating from the sun
          vec3 T = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
          vec3 B = cross(uSunDir, T);
          float phi = atan(dot(dir, B), dot(dir, T));
          float rays = 0.55 + 0.45 * sin(phi * 7.0 + 1.3) * sin(phi * 3.0 - 0.6 + uTime * 0.012);
          col += uSunTint * pow(d, 9.0) * rays * 0.34;
          // sun disc (bloom seed)
          col += vec3(2.6, 2.0, 1.35) * smoothstep(0.99925, 0.99972, d);

          // high cirrus, plane-projected so it converges at the horizon
          float hy = max(dir.y, 0.0);
          if (hy > 0.008) {
            vec2 cp = dir.xz / (hy + 0.13) * 0.026;
            cp += vec2(uTime * 0.0021, uTime * 0.0012);
            float n = texture2D(tNoise, cp).g * 0.62
                    + texture2D(tNoise, cp * 2.7 + 0.31).r * 0.38;
            float streak = smoothstep(0.44, 0.74, n);
            float mask = smoothstep(0.010, 0.13, hy) * smoothstep(0.92, 0.30, hy);
            vec3 cc = mix(vec3(0.50, 0.52, 0.66), vec3(1.90, 1.32, 0.86), pow(d, 1.3));
            col = mix(col, cc, streak * mask * 0.52);
          }

          // dither: a 430-unit gradient dome bands badly at 8 bit otherwise
          col += (hash21(gl_FragCoord.xy) - 0.5) * 0.0055;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(g, mat);
    sky.frustumCulled = false;
    sky.matrixAutoUpdate = false; sky.updateMatrix();
    group.add(sky);
  }

  // ------------------------------------------------- cloud sea (3 strata) ---
  // Huge horizontal discs. Every fragment blends toward skyRay(viewDir) with an
  // exp2 falloff and is discarded once that blend is complete, so the layers have
  // no silhouette at all — they just become sky.
  const CLOUD_FRAG = `
    ${SKY_UNIFORMS_GLSL}
    uniform sampler2D tNoise; uniform float uTime;
    uniform vec2 uDrift; uniform float uScale, uThresh, uOpacity, uHazeK, uRadius, uWarp, uSunOff;
    uniform vec3 uLit, uMidC, uShadow;
    varying vec3 vWorld;
    ${SKY_FN_GLSL}
    // .x = fbm density, .y = top octave (reused as the silhouette scallop),
    // .z = base octave (reused for the cast-shadow lookup) — three fetches total.
    vec3 cn(vec2 p, float det) {
      float o1 = texture2D(tNoise, p * 0.85).g;
      float o2 = texture2D(tNoise, p * 2.30 + vec2(0.37, 0.71)).r;
      float o3 = texture2D(tNoise, p * 5.30 + vec2(0.13, 0.59)).r;
      return vec3((o1 + o2 * 0.55 * det + o3 * 0.22 * det) / (1.0 + 0.77 * det), o3, o1);
    }
    void main() {
      vec3 rv = vWorld - cameraPosition;
      float dist = length(rv);
      float hd = dist * uHazeK;
      float haze = 1.0 - exp(-hd * hd);
      if (haze > 0.9915) discard;                 // beyond here it *is* the sky
      vec3 dir = rv / dist;

      // fade high-frequency octaves with distance: kills grazing-angle shimmer
      float det = 1.0 - smoothstep(240.0, 660.0, dist);
      vec2 p = (vWorld.xz + uDrift * uTime) * uScale;
      p += (texture2D(tNoise, p * 0.31).rg - 0.5) * uWarp;   // domain warp, hides tiling
      // macro coverage: huge banks and wide open holes, so the deck has structure
      float macro = texture2D(tNoise, p * 0.60 + vec2(0.61, 0.22)).g;
      float thr = uThresh + (macro - 0.5) * 0.34;
      vec3 nn = cn(p, det);
      float n = nn.x;
      // scalloped, cauliflower-ish silhouette instead of smooth contour bands
      float cov = smoothstep(thr, thr + 0.115, n + (nn.y - 0.5) * 0.115 * det);
      // fake optical thickness: seen edge-on the ray crosses far more of the deck,
      // so the horizon reads as a solid bank instead of a thin smear
      float grazing = 1.0 - clamp(abs(dir.y) * 3.2, 0.0, 1.0);
      cov = pow(cov, mix(1.0, 0.45, grazing));
      if (cov < 0.004) discard;

      // Volumetric read comes from a LONG shadow offset — roughly a quarter of the
      // dominant feature size, so the key rakes across whole banks instead of
      // tracing contour lines. Only the base octave matters for cast shadow, so
      // this costs a single extra fetch.
      vec2 sxz = normalize(uSunDir.xz + vec2(1e-5)) * uSunOff;
      float shadeS = texture2D(tNoise, (p + sxz) * 0.85).g;
      float lit = smoothstep(-0.075, 0.055, nn.z - shadeS);
      float top = smoothstep(thr + 0.01, thr + 0.19, n);

      // shadowed valleys stay deep and cool; only sunward crests take the key
      vec3 col = mix(uShadow, uMidC, top);
      col = mix(col, uLit, lit * (0.25 + 0.75 * top));
      col *= mix(0.55, 1.0, lit);                                // cast self-shadow
      col += uSunTint * lit * pow(1.0 - cov, 3.0) * 0.42;        // silver lining

      col = mix(col, skyRay(dir), haze);
      float a = cov * uOpacity * (1.0 - haze * 0.5);
      a *= 1.0 - smoothstep(0.82, 0.99, length(vWorld.xz) / uRadius);
      gl_FragColor = vec4(col, a);
    }`;
  const CLOUD_VERT = `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  const CLOUD_R = 620;
  function cloudLayer({ y, scale, thresh, opacity, drift, hazeK, warp, sunOff, lit, mid, shadow, order }) {
    const g = new THREE.CircleGeometry(CLOUD_R, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: shareSky({
        uTime, tNoise: { value: tex.noise },
        uDrift: { value: new THREE.Vector2(drift[0], drift[1]) },
        uScale: { value: scale },
        uThresh: { value: thresh },
        uOpacity: { value: opacity },
        uHazeK: { value: hazeK },
        uRadius: { value: CLOUD_R },
        uWarp: { value: warp },
        uSunOff: { value: sunOff },
        uLit: { value: new THREE.Vector3(...lit) },
        uMidC: { value: new THREE.Vector3(...mid) },
        uShadow: { value: new THREE.Vector3(...shadow) },
      }),
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
    return mesh;
  }
  // deepest → nearest (drawn back to front)
  cloudLayer({
    y: -58, scale: 0.00086, thresh: 0.505, opacity: 0.95, drift: [0.40, -0.36],
    hazeK: 0.0068, warp: 0.055, sunOff: 0.20, order: -9,
    lit: [0.235, 0.215, 0.245], mid: [0.070, 0.085, 0.150], shadow: [0.026, 0.034, 0.072],
  });
  cloudLayer({
    y: -29, scale: 0.00128, thresh: 0.495, opacity: 0.94, drift: [-0.78, 0.55],
    hazeK: 0.0048, warp: 0.065, sunOff: 0.20, order: -8,
    lit: [0.62, 0.40, 0.23], mid: [0.098, 0.115, 0.200], shadow: [0.034, 0.045, 0.098],
  });
  cloudLayer({
    y: -11, scale: 0.00178, thresh: 0.488, opacity: 0.96, drift: [1.15, 0.32],
    hazeK: 0.0034, warp: 0.075, sunOff: 0.20, order: -7,
    lit: [1.42, 0.92, 0.47], mid: [0.175, 0.200, 0.320], shadow: [0.058, 0.080, 0.185],
  });

  // ------------------------------------------------ distant cumulus band ----
  // A ring of camera-facing puffs sitting *on* the cloud-sea horizon, hazed toward
  // the sky with a gentler constant (bright clouds punch through haze).
  {
    const geos = [];
    const ring = (n, r0, r1, w0, w1, ar0, ar1, y0, y1, off) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + off + ER.f(0.24);
        const r = ER.f(r0, r1);
        const w = ER.f(w0, w1);
        const h = w * ER.f(ar0, ar1);
        const g = new THREE.PlaneGeometry(w, h);
        g.applyMatrix4(mat4(Math.cos(a) * r, ER.f(y0, y1), Math.sin(a) * r, 0, -a - Math.PI / 2, 0));
        geos.push(g.toNonIndexed());
      }
    };
    // near bank: wide, sits on the cloud-sea horizon
    ring(12, 140, 235, 120, 215, 0.34, 0.52, -16, 8, 0);
    // far towers: taller, hazier, break the skyline
    ring(9, 285, 395, 95, 175, 0.60, 1.00, 6, 38, 0.55);
    const merged = mergeGeometries(geos, false);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: shareSky({
        tMap: { value: tex.cloud },
        uWarm: { value: new THREE.Vector3(1.30, 0.92, 0.60) },
        uCool: { value: new THREE.Vector3(0.26, 0.30, 0.48) },
      }),
      vertexShader: `
        varying vec3 vWorld; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        ${SKY_UNIFORMS_GLSL}
        uniform sampler2D tMap; uniform vec3 uWarm, uCool;
        varying vec3 vWorld; varying vec2 vUv;
        ${SKY_FN_GLSL}
        void main() {
          vec4 t = texture2D(tMap, vUv);
          if (t.a < 0.006) discard;
          vec3 rv = vWorld - cameraPosition;
          float dist = length(rv);
          float hd = dist * 0.0019;
          float haze = 1.0 - exp(-hd * hd);
          vec3 dir = rv / dist;
          float az = dot(normalize(vWorld.xz + vec2(1e-5)), normalize(uSunDir.xz + vec2(1e-5)));
          vec3 col = t.rgb * mix(uCool, uWarm, smoothstep(-0.7, 0.8, az));
          col *= mix(1.0, 0.24, smoothstep(0.72, 0.08, vUv.y));   // shaded undersides
          col += uSunTint * smoothstep(0.28, 0.88, vUv.y) * smoothstep(-0.2, 0.9, az) * 0.55;
          col = mix(col, skyRay(dir), haze);
          float av = smoothstep(0.10, 0.46, t.a);                 // crisper silhouette
          gl_FragColor = vec4(col, av * 0.94 * (1.0 - haze * 0.40));
        }`,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
  }

  // ----------------------------------------------------------------- islets --
  // One merged bucket (4 draw calls total) — was two, which doubled them.
  const isletHolder = new THREE.Group();
  {
    const spots = [
      [72, -5.0, 26, 2.6], [-70, -6.5, 30, 3.2], [66, -8.0, -30, 2.2], [-64, -4.5, -26, 1.8],
      [12, -7.5, 42, 2.8], [-18, -9.0, 44, 3.4], [30, -10.5, -46, 2.4], [-40, -6.5, -40, 2.0],
      [92, -11.5, 4, 3.8], [-95, -9.5, -8, 4.2],
      [48, -14.0, 62, 3.0], [-52, -16.0, 66, 3.6], [8, -17.0, -72, 3.2], [-6, -13.0, 70, 2.6],
      [118, -18.0, -34, 4.4], [-124, -15.0, 30, 4.0], [86, -21.0, -66, 3.4], [-88, -22.0, -60, 3.8],
    ];
    const B = new Bucket();
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z, s] = spots[i];
      const rock = lathe([[0.01, -1.6], [0.55, -1.1], [0.85, -0.45], [1.0, 0], [0.92, 0.18]], 8, true);
      jitterGeo(rock, 0.16, ER);
      B.add(rock, 'cliff', mat4(x, y, z, 0, ER.f(6.28), 0, s, s * ER.f(0.8, 1.2), s),
        { base: 0xa89a84, jitter: 0.12, moss: 0.4, ao: 0.25, aoY0: -1.6, aoY1: 0.2 });
      const cap = new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.42);
      boxUV(cap, 0.5);
      B.add(cap, 'grass', mat4(x, y - 0.12, z, 0, 0, 0, s * 0.98, s * 0.45, s * 0.98),
        { base: 0x7cb050, jitter: 0.14, ao: 0, topLight: 0.25 });
      if (s > 2.4) {
        const trunk = new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 0.5 * s, 5);
        trunk.translate(0, 0.25 * s, 0);
        B.add(trunk, 'bark', mat4(x + s * 0.2, y + 0.3, z), { base: 0x9c8161 });
        const blob = new THREE.IcosahedronGeometry(0.32 * s, 1);
        jitterGeo(blob, 0.05 * s, ER);
        B.add(blob, 'canopyPink', mat4(x + s * 0.2, y + 0.62 * s, z),
          { base: 0xff9db8, jitter: 0.1, ao: 0.3, aoY0: -0.4 * s, aoY1: 0.3 * s });
      }
    }
    B.build(isletHolder, {});
    group.add(isletHolder);
  }

  // ------------------------------------------------------- cliff-edge mist --
  // Billboarded quads (one merged draw call) that rise and curl over the rim,
  // selling the drop from the arena into the chasm.
  {
    const COUNT = Math.round(104 * quality);
    const pos = new Float32Array(COUNT * 4 * 3);
    const corner = new Float32Array(COUNT * 4 * 2);
    const data = new Float32Array(COUNT * 4 * 3);   // size, seed, riseRate
    const index = new Uint16Array(COUNT * 6);
    const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
    const AX = 60.5, AZ = 19.0, EXP = 0.5;          // rounded-rect arena rim
    for (let i = 0; i < COUNT; i++) {
      const t = (i / COUNT) * Math.PI * 2 + ER.f(0.16);
      const ca = Math.cos(t), sa = Math.sin(t);
      const spread = ER.f(0.96, 1.16);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), EXP) * AX * spread;
      const z = Math.sign(sa) * Math.pow(Math.abs(sa), EXP) * AZ * spread;
      const y = ER.f(-8.5, -0.8);
      const size = ER.f(6.0, 16.0);
      const seed = ER.next();
      const rise = ER.f(0.026, 0.055);
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v) * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        data[o] = size; data[o + 1] = seed; data[o + 2] = rise;
        corner[(i * 4 + v) * 2] = CX[v] * 0.5;
        corner[(i * 4 + v) * 2 + 1] = CY[v] * 0.5;
      }
      const b = i * 4, q = i * 6;
      index[q] = b; index[q + 1] = b + 1; index[q + 2] = b + 2;
      index[q + 3] = b; index[q + 4] = b + 2; index[q + 5] = b + 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: shareSky({ uTime, tMap: { value: tex.cloud } }),
      vertexShader: `
        attribute vec2 aCorner; attribute vec3 aData;
        uniform float uTime;
        varying vec2 vUv; varying float vFade; varying float vSeed;
        void main() {
          float seed = aData.y;
          float life = fract(uTime * aData.z + seed);
          vec3 p = position;
          p.y += life * 8.0;
          p.x += sin(uTime * 0.20 + seed * 41.0) * 1.8 * life;
          p.z += cos(uTime * 0.17 + seed * 23.0) * 1.8 * life;
          float sz = aData.x * (0.5 + life * 1.15);
          vSeed = seed;
          vUv = aCorner + 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.xy += aCorner * sz;
          gl_Position = projectionMatrix * mv;
          // fade out anything about to swallow the camera
          vFade = sin(life * 3.14159265) * smoothstep(0.0, 0.12, life)
                * smoothstep(7.0, 22.0, -mv.z);
        }`,
      fragmentShader: `
        ${SKY_UNIFORMS_GLSL}
        uniform sampler2D tMap;
        varying vec2 vUv; varying float vFade; varying float vSeed;
        void main() {
          vec4 t = texture2D(tMap, vUv);
          float a = t.a * vFade * 0.34;
          if (a < 0.003) discard;
          vec3 warm = vec3(1.05, 0.82, 0.62);
          vec3 cool = vec3(0.34, 0.42, 0.62);
          vec3 col = t.rgb * mix(cool, warm, 0.25 + 0.75 * vSeed);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
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
    mk(-38, 4.8, -12.0, 3.0, 11, 0.28);
    mk(40, 4.6, -12.6, 2.6, 10, -0.22);
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
      map: tex.shaft, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, opacity: 0.11, color: 0xffd49a,
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
      pos[i * 3] = ER.f(box[0], box[3]);
      pos[i * 3 + 1] = ER.f(box[1], box[4]);
      pos[i * 3 + 2] = ER.f(box[2], box[5]);
      seed[i] = ER.next();
      c.setHex(tint[Math.floor(ER.next() * tint.length)]);
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
    isletHolder.position.y = Math.sin(uTime.value * 0.4) * 0.5;
    isletHolder.rotation.y = Math.sin(uTime.value * 0.11) * 0.012;
    // rune decal pulse (shared material)
    mats.rune.opacity = 0.62 + 0.25 * Math.sin(uTime.value * 1.9);
  }

  return { group, sun, hemi, sunDir, update };
}
