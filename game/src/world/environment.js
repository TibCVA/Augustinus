// Sky + atmosphere: view-ray gradient dome (warm horizon → deep zenith, sun glow,
// god-ray streaks, high cirrus), exp2 aerial haze, a layered parallax cloud sea whose
// far field dissolves *into the sky colour itself* (no horizon edge anywhere), a
// distant cumulus band, floating rock islets, mist curling up the cliff edges, and
// drifting petals / fireflies / dust motes + light shafts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex, mats, uTime, uSunDir, PAL } from '../core/assets.js';
import { SEED, makeRng } from '../core/rng.js';
import { Bucket, mat4, lathe, jitterGeo, boxUV, bakeTint, chamferBox, puffNormals } from './props.js';

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

  // ============================================== midground + background ====
  // The world beyond the arena rim: floating karst islets at three depth tiers,
  // ruined elven architecture (viaducts, colonnades, a rotunda) and two landmark
  // spires standing out of the cloud sea. Everything merges into ONE opaque draw
  // call (+1 for the mist skirts) and is shaded by the *same* skyRay() the dome
  // and the cloud strata use, blended with the same exp2 curve as scene.fog — so
  // each tier lands in correct aerial perspective and can never read as a decal
  // pasted on the sky. Read-only set dressing: nothing is closer than 78 units
  // from the arena centre and nothing rises near the play surface.
  {
    const KEEP = ['position', 'normal', 'color'];
    const solid = [];
    const skirts = [];                       // [x, y, z, w, h] mist puffs

    // `bands` bakes horizontal sedimentary strata into the vertex colour before
    // the placement matrix, so cliff faces carry rock structure instead of
    // reading as one flat facetted value.
    function add(geo, M, tint, bands) {
      let g = geo.index ? geo.toNonIndexed() : geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      bakeTint(g, tint);
      if (bands) {
        const p = g.attributes.position, c = g.attributes.color, k = bands[0], a = bands[1];
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          const b = 1 + a * (Math.sin(y * k) * 0.62 + Math.sin(y * k * 2.37 + 1.7) * 0.38);
          c.setXYZ(i, c.getX(i) * b, c.getY(i) * b, c.getZ(i) * b);
        }
      }
      if (M) g.applyMatrix4(M);
      for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
      solid.push(g);
    }
    const sub = (M, l) => (M ? M.clone().multiply(l) : l);
    const D2R = Math.PI / 180;
    const px = (deg, r) => Math.cos(deg * D2R) * r;
    const pz = (deg, r) => Math.sin(deg * D2R) * r;
    // Placement matrix: long axis tangent to the ring, so faces turn to the arena.
    const at = (deg, r, y = 0, skew = 0, tilt = 0) =>
      mat4(px(deg, r), y, pz(deg, r), tilt, -(deg + 90 + skew) * D2R, tilt * 0.6);

    // Deliberately darker than the arena palette: these masses are backlit and
    // must hold a value *below* the sky so the haze — not the albedo — is what
    // lifts them toward the horizon.
    const T_ROCK = { base: 0x6c6151, jitter: 0.16, moss: 0.26, ao: 0.55 };
    const T_STONE = { base: 0xa79b83, jitter: 0.11, moss: 0.34, ao: 0.36 };
    const T_GRASS = { base: 0x4d7331, jitter: 0.18, ao: 0.28, topLight: 0.22 };
    const T_PINK = { base: 0xcd7d9a, jitter: 0.13, ao: 0.36, topLight: 0.40 };
    const T_GREEN = { base: 0x4b7431, jitter: 0.16, ao: 0.36, topLight: 0.30 };
    const T_GOLD = { base: 0xffcf8e, jitter: 0.05, ao: 0 };

    // ------------------------------------------------------------ dressing --
    // Trees and columns are built at *absolute* size no matter how big the mass
    // under them is: they are the scale reference that makes the islets read as
    // landmasses rather than pebbles.
    function bgTree(M, x, z, h, pink) {
      const tr = new THREE.CylinderGeometry(h * 0.04, h * 0.08, h * 0.55, 5);
      tr.translate(0, h * 0.27, 0);
      add(tr, sub(M, mat4(x, 0, z)), { base: 0x8a7154, jitter: 0.1, ao: 0.45, aoY0: 0, aoY1: h * 0.4 });
      for (let i = 0; i < 3; i++) {
        const bs = h * ER.f(0.23, 0.34);
        const g = new THREE.IcosahedronGeometry(bs, 0);
        g.scale(1.35, 0.82, 1.25);
        puffNormals(g);
        add(g, sub(M, mat4(x + ER.spread(h * 0.22), h * ER.f(0.56, 0.82), z + ER.spread(h * 0.22), 0, ER.f(6.28))),
          { ...(pink ? T_PINK : T_GREEN), aoY0: -bs, aoY1: bs });
      }
    }
    function bgColumn(M, x, z, h, r = 0.55, broken = false, ry = 0) {
      const hh = broken ? h * ER.f(0.26, 0.68) : h;
      add(chamferBox(r * 3.1, r * 0.6, r * 3.1, r * 0.14), sub(M, mat4(x, 0, z, 0, ry)),
        { ...T_STONE, ao: 0.45, aoY0: 0, aoY1: r * 0.6 });
      const shaft = lathe([[r * 1.12, 0], [r, r * 0.6], [r * 0.85, hh * 0.92], [r * 0.92, hh]], 8);
      if (broken) jitterGeo(shaft, r * 0.17, ER);
      add(shaft, sub(M, mat4(x, r * 0.6, z, 0, ry)), { ...T_STONE, aoY0: 0, aoY1: hh * 0.55 });
      if (!broken) {
        add(chamferBox(r * 2.7, r * 0.5, r * 2.7, r * 0.12), sub(M, mat4(x, hh + r * 0.55, z, 0, ry)),
          { ...T_STONE, ao: 0.2, aoY0: 0, aoY1: r * 0.5 });
      }
    }

    // ------------------------------------------------------------- islets ---
    // Inverted teardrop: a flat plateau with a long root that dives into the
    // cloud deck, so the mass reads as floating without ever showing a "cut".
    // Three archetypes so a ring of islets never reads as one shape repeated:
    // anvil (plateau on a tapered root), stack (sheer sea-stack cliffs) and
    // raft (low, wide, barely more than a shelf).
    // Roots end blunt and broken, never in a needle point — a tapered cone is
    // the single most "default 3D" shape a floating island can have.
    const ISLE_PROFILE = {
      anvil: (R, deep) => [
        [R * 0.02, -deep * 1.06], [R * 0.13, -deep], [R * 0.30, -deep * 0.84],
        [R * 0.45, -deep * 0.62], [R * 0.64, -deep * 0.40], [R * 0.82, -deep * 0.20],
        [R * 0.93, -deep * 0.07], [R * 1.00, -R * 0.34], [R * 0.99, -R * 0.10],
        [R * 0.87, R * 0.12],
      ],
      stack: (R, deep) => [
        [R * 0.02, -deep * 1.04], [R * 0.30, -deep], [R * 0.55, -deep * 0.82],
        [R * 0.76, -deep * 0.60], [R * 0.90, -deep * 0.38], [R * 0.97, -deep * 0.18],
        [R * 1.02, -R * 0.55], [R * 0.96, -R * 0.16], [R * 0.84, R * 0.14],
      ],
      raft: (R, deep) => [
        [R * 0.02, -deep * 1.05], [R * 0.26, -deep], [R * 0.48, -deep * 0.68],
        [R * 0.72, -deep * 0.42], [R * 0.90, -deep * 0.18], [R * 1.00, -R * 0.20],
        [R * 1.00, -R * 0.06], [R * 0.90, R * 0.08],
      ],
    };
    function bgIslet(M, R, o = {}) {
      const {
        deep = R * 2.6, trees = 0, ruin = 0, stack = 0, pink = true, seg = 11,
        grass = true, style = 'anvil', sx = 1, sz = 1,
      } = o;
      const shape = mat4(0, 0, 0, 0, ER.f(6.28), 0, sx, 1, sz);
      const body = lathe(ISLE_PROFILE[style](R, deep), seg, true);
      jitterGeo(body, R * 0.14, ER, 0.55);
      add(body, sub(M, shape), { ...T_ROCK, aoY0: -deep * 0.5, aoY1: R * 0.12 }, [18 / R, 0.13]);
      if (grass) {
        const cap = new THREE.SphereGeometry(R * 0.88, seg, 4, 0, 6.2832, 0, Math.PI * 0.46);
        jitterGeo(cap, R * 0.07, ER, 0.25);
        add(cap, sub(M, mat4(0, -R * 0.08, 0, 0, ER.f(6.28), 0, sx, 0.3, sz)),
          { ...T_GRASS, aoY0: -R * 0.3, aoY1: R * 0.1 });
        // scrub clumps so the plateau isn't a flat painted disc
        for (let i = 0, n = 2 + (R > 15 ? 2 : 0); i < n; i++) {
          const a = ER.f(6.28), rr = R * ER.f(0.25, 0.78), bs = R * ER.f(0.09, 0.17);
          const g = new THREE.IcosahedronGeometry(bs, 0);
          g.scale(1.4, 0.62, 1.3);
          puffNormals(g);
          add(g, sub(M, mat4(Math.cos(a) * rr * sx, R * 0.06, Math.sin(a) * rr * sz, 0, ER.f(6.28))),
            { ...T_GREEN, aoY0: -bs, aoY1: bs });
        }
      }
      if (stack > 0) {
        // blunt, broken rock tower — a pinnacle, not a party hat
        const sp = lathe([
          [R * 0.38, 0], [R * 0.34, stack * 0.22], [R * 0.30, stack * 0.5],
          [R * 0.25, stack * 0.74], [R * 0.19, stack * 0.9], [R * 0.13, stack],
        ], 8, true);
        jitterGeo(sp, R * 0.10, ER, 0.4);
        add(sp, sub(M, mat4(ER.spread(R * 0.36 * sx), R * 0.02, ER.spread(R * 0.36 * sz), 0, ER.f(6.28))),
          { ...T_ROCK, ao: 0.5, aoY0: 0, aoY1: stack * 0.8 }, [26 / R, 0.12]);
      }
      for (let i = 0; i < trees; i++) {
        const a = ER.f(6.28), rr = R * ER.f(0.18, 0.7);
        bgTree(M, Math.cos(a) * rr * sx, Math.sin(a) * rr * sz, ER.f(4.2, 6.4), pink && ER.next() > 0.3);
      }
      for (let i = 0; i < ruin; i++) {
        const a = ER.f(6.28), rr = R * ER.f(0.15, 0.62);
        bgColumn(M, Math.cos(a) * rr * sx, Math.sin(a) * rr * sz, ER.f(5, 9), ER.f(0.45, 0.7), ER.next() > 0.45);
      }
    }

    // --------------------------------------------------------- architecture --
    // Broken viaduct: repeated bays are the strongest scale cue in the frame.
    function bgViaduct(M, { bays = 5, span = 22, pierH = 18, w = 7, dead = 2 } = {}) {
      const R = span * 0.5, t = span * 0.15, total = bays * span;
      for (let i = 0; i <= bays; i++) {
        const x = -total / 2 + i * span;
        const gone = i > bays - dead;
        const ph = gone ? pierH * ER.f(0.3, 0.62) : pierH;
        add(chamferBox(t * 1.7, ph, w * 1.12, t * 0.18), sub(M, mat4(x, 0, 0)),
          { ...T_STONE, ao: 0.42, aoY0: 0, aoY1: ph * 0.7 });
      }
      for (let i = 0; i < bays; i++) {
        const cx = -total / 2 + span * (i + 0.5);
        const gone = i >= bays - dead;
        const segs = 9;
        for (let k = 0; k < segs; k++) {
          const a = Math.PI * (k + 0.5) / segs;
          if (gone && a < 2.0) continue;         // collapsed half of the end bays
          const rr = R - t * 0.5;
          add(chamferBox(Math.PI * R / segs * 1.1, t, w, t * 0.16),
            sub(M, mat4(cx + Math.cos(a) * rr, pierH + Math.sin(a) * rr, 0, 0, 0, a - Math.PI / 2)),
            { ...T_STONE, ao: 0.3, aoY0: 0, aoY1: t });
        }
        if (!gone) {
          add(chamferBox(span * 1.02, t * 0.85, w * 1.2, t * 0.16), sub(M, mat4(cx, pierH + R, 0)),
            { ...T_STONE, ao: 0.25, moss: 0.6, aoY0: 0, aoY1: t });
          for (const s of [-1, 1]) {
            add(chamferBox(span * 0.9, t * 0.5, t * 0.4, t * 0.1),
              sub(M, mat4(cx, pierH + R + t * 0.85, s * w * 0.55)), { ...T_STONE, ao: 0.2, aoY0: 0, aoY1: t });
          }
        }
      }
      // rock plinth, stretched along the span, diving into the cloud deck
      const plinth = lathe([
        [total * 0.02, -52], [total * 0.16, -32], [total * 0.28, -14],
        [total * 0.34, -3], [total * 0.30, 1.5],
      ], 9, true);
      jitterGeo(plinth, total * 0.02, ER);
      add(plinth, sub(M, mat4(0, 0, 0, 0, 0, 0, 1.45, 1, 0.5)), { ...T_ROCK, aoY0: -30, aoY1: 1 });
    }

    // Colonnade terrace: platform, two rows of columns (half of them snapped),
    // a surviving stretch of architrave and a pediment stub.
    function bgTemple(M, { w = 46, h = 13, n = 7 } = {}) {
      const d = w * 0.42;
      add(chamferBox(w * 1.22, 3.2, d * 1.5, 0.7), sub(M, mat4(0, -3.2, 0)), { ...T_STONE, ao: 0.45, aoY0: -3.2, aoY1: 1.5 });
      add(chamferBox(w * 1.08, 2.2, d * 1.3, 0.55), sub(M, mat4(0, -1.0, 0)), { ...T_STONE, ao: 0.35, aoY0: -1, aoY1: 1.4 });
      const gap = w / (n - 1);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + i * gap;
        const broken = i > n - 3.5;
        bgColumn(M, x, -d * 0.5, h, 1.05, broken);
        bgColumn(M, x, d * 0.5, h * 0.94, 0.9, broken || ER.next() > 0.6);
      }
      const keep = w * 0.62;
      add(chamferBox(keep, 2.3, d * 1.35, 0.4), sub(M, mat4(-w * 0.5 + keep * 0.5, h + 1.2, 0)),
        { ...T_STONE, ao: 0.3, moss: 0.55, aoY0: 0, aoY1: 2.3 });
      add(chamferBox(keep * 0.55, 1.5, d * 1.5, 0.35), sub(M, mat4(-w * 0.5 + keep * 0.35, h + 3.5, 0)),
        { ...T_STONE, ao: 0.2, moss: 0.6, aoY0: 0, aoY1: 1.5 });
      // rubble + the rock shelf the whole thing stands on
      for (let i = 0; i < 4; i++) {
        const g = new THREE.IcosahedronGeometry(ER.f(1.2, 2.6), 0);
        jitterGeo(g, 0.5, ER);
        add(g, sub(M, mat4(ER.spread(w * 0.6), -1.4, d * ER.f(0.6, 1.1) * (ER.next() > 0.5 ? 1 : -1), ER.f(3), ER.f(3))),
          { ...T_STONE, ao: 0.3, aoY0: -2, aoY1: 2 });
      }
      const shelf = lathe([[w * 0.06, -46], [w * 0.3, -26], [w * 0.55, -11], [w * 0.72, -3], [w * 0.66, -1]], 9, true);
      jitterGeo(shelf, w * 0.035, ER);
      add(shelf, sub(M, mat4(0, -3, 0, 0, 0, 0, 1.15, 1, 0.75)), { ...T_ROCK, aoY0: -26, aoY1: -1 });
    }

    // Landmark spire: tapered elven tower + buttress fins + floating gold rings.
    function bgSpire(M, { h = 52, r = 8, sat = 3, root = true } = {}) {
      add(lathe([
        [r * 1.75, 0], [r * 1.62, h * 0.035], [r * 1.30, h * 0.06], [r * 1.22, h * 0.11],
        [r, h * 0.15], [r * 0.9, h * 0.33], [r * 1.06, h * 0.36], [r * 0.98, h * 0.40],
        [r * 0.80, h * 0.60], [r * 0.72, h * 0.70], [r * 0.94, h * 0.745],
        [r * 0.86, h * 0.785], [r * 0.62, h * 0.83],
      ], 10), M, { ...T_STONE, ao: 0.42, aoY0: 0, aoY1: h * 0.5 }, [26 / h, 0.09]);
      add(new THREE.ConeGeometry(r * 0.62, h * 0.30, 8), sub(M, mat4(0, h * 0.96, 0)),
        { ...T_STONE, ao: 0.25, moss: 0.5, aoY0: -h * 0.15, aoY1: h * 0.15 });
      // buttress fins + the little satellite turrets that give it elven scale
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        add(chamferBox(r * 0.34, h * 0.44, r * 1.05, r * 0.08),
          sub(M, mat4(Math.cos(a) * r * 1.3, h * 0.05, Math.sin(a) * r * 1.3, 0, -a + Math.PI / 2)),
          { ...T_STONE, ao: 0.45, aoY0: 0, aoY1: h * 0.3 });
      }
      for (let i = 0; i < sat; i++) {
        const a = (i / sat) * Math.PI * 2 + 1.1, sh = h * ER.f(0.30, 0.46), sr = r * 0.34;
        add(lathe([[sr * 1.4, 0], [sr * 1.15, sh * 0.08], [sr, sh * 0.14], [sr * 0.86, sh]], 8),
          sub(M, mat4(Math.cos(a) * r * 1.9, -h * 0.02, Math.sin(a) * r * 1.9)),
          { ...T_STONE, ao: 0.45, aoY0: 0, aoY1: sh * 0.5 });
        add(new THREE.ConeGeometry(sr * 1.0, sh * 0.34, 7), sub(M, mat4(Math.cos(a) * r * 1.9, sh * 1.15, Math.sin(a) * r * 1.9)),
          { ...T_STONE, ao: 0.2, moss: 0.5, aoY0: -sh * 0.17, aoY1: sh * 0.17 });
      }
      const ring = new THREE.TorusGeometry(r * 1.15, r * 0.07, 5, 16);
      ring.rotateX(Math.PI / 2);
      add(ring, sub(M, mat4(0, h * 1.15, 0)), T_GOLD);
      const ring2 = new THREE.TorusGeometry(r * 0.75, r * 0.055, 5, 14);
      ring2.rotateX(Math.PI / 2);
      add(ring2, sub(M, mat4(0, h * 1.23, 0)), T_GOLD);
      // root, so the tower stands on a piece of the world rather than on nothing
      if (root) {
        const rk = lathe([
          [r * 0.06, -h * 1.0], [r * 0.9, -h * 0.62], [r * 1.7, -h * 0.34],
          [r * 2.4, -h * 0.12], [r * 2.6, -h * 0.02], [r * 2.2, h * 0.02],
        ], 10, true);
        jitterGeo(rk, r * 0.2, ER, 0.5);
        add(rk, M, { ...T_ROCK, aoY0: -h * 0.5, aoY1: 0 }, [40 / h, 0.12]);
      }
    }

    // Rotunda: drum, ring of columns, surviving arc of entablature. Reads as a
    // sanctum silhouette from any angle.
    function bgRotunda(M, { R = 22, h = 12, cols = 12 } = {}) {
      add(lathe([[R * 1.3, -3.2], [R * 1.26, -1.2], [R * 1.12, -0.6], [R * 1.06, 0]], 14),
        M, { ...T_STONE, ao: 0.4, aoY0: -3.2, aoY1: 0 });
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * Math.PI * 2;
        bgColumn(M, Math.cos(a) * R, Math.sin(a) * R, h, 0.95, i % 5 === 3, -a);
      }
      add(lathe([[R * 1.1, h + 1.1], [R * 1.16, h + 1.9], [R * 1.1, h + 3.0], [R * 0.96, h + 3.3]], 14),
        M, { ...T_STONE, ao: 0.25, moss: 0.6, aoY0: h, aoY1: h + 3.3 });
      // drum wall + truncated dome (never seen from inside — these sit far below
      // the horizon line of every camera)
      add(lathe([[R * 0.62, 0], [R * 0.66, h * 0.9], [R * 0.6, h + 2.4]], 12),
        M, { ...T_STONE, ao: 0.4, aoY0: 0, aoY1: h });
      const dome = [];
      for (let i = 0; i <= 5; i++) {
        const t = (i / 5) * 0.78;
        dome.push([Math.cos(t * Math.PI / 2) * R * 0.62, h + 2.4 + Math.sin(t * Math.PI / 2) * R * 0.5]);
      }
      const dg = lathe(dome, 12, false);
      jitterGeo(dg, R * 0.035, ER);
      add(dg, M, { ...T_STONE, ao: 0.15, moss: 0.7, aoY0: h, aoY1: h + R * 0.5 });
      const shelf = lathe([[R * 0.1, -44], [R * 0.6, -24], [R * 1.1, -10], [R * 1.5, -3.4], [R * 1.4, -2.8]], 10, true);
      jitterGeo(shelf, R * 0.08, ER);
      add(shelf, M, { ...T_ROCK, aoY0: -24, aoY1: -3 });
    }

    // Far ghost: a big hazed massif that only ever reads as a value shape.
    function bgMassif(M, { R = 70, h = 26, deep = 70 } = {}) {
      // Flat-shouldered mesa: at this range only the value shape survives, and a
      // stepped table silhouette reads as land where a cone reads as a paper tent.
      const g = lathe([
        [R * 0.05, -deep], [R * 0.34, -deep * 0.6], [R * 0.70, -deep * 0.28],
        [R * 0.95, -deep * 0.06], [R, -R * 0.04], [R * 0.97, h * 0.42],
        [R * 0.74, h * 0.55], [R * 0.68, h * 0.86], [R * 0.34, h],
      ], 11, true);
      jitterGeo(g, R * 0.17, ER, 0.5);
      add(g, M, { ...T_ROCK, moss: 0.16, aoY0: -deep * 0.5, aoY1: h }, [30 / R, 0.11]);
      for (let i = 0; i < 3; i++) {
        const a = ER.f(6.28), rr = R * ER.f(0.1, 0.45);
        const sp = lathe([[R * 0.14, 0], [R * 0.11, h * 0.5], [R * 0.07, h * 0.8], [R * 0.03, h]], 6, true);
        jitterGeo(sp, R * 0.03, ER, 0.4);
        add(sp, sub(M, mat4(Math.cos(a) * rr, h * 0.7, Math.sin(a) * rr)), { ...T_ROCK, aoY0: 0, aoY1: h * 0.7 });
      }
    }

    const skirt = (deg, r, y, w, h) => skirts.push([px(deg, r), y, pz(deg, r), w, h]);

    // ------------------------------------------------------- near-mid ring --
    // First layer past the rim: reads at full contrast and overlaps everything
    // behind it. Kept low — tops hover around the deck so these never crowd the
    // arena silhouette, they sit under it.
    for (const [deg, r, y, R, o] of [
      [-118, 92, -6, 10, { deep: 24, style: 'stack', stack: 8, trees: 3, ruin: 1, sx: 1.3, sz: 0.8 }],
      [-100, 104, -4, 12, { deep: 26, trees: 3, stack: 8, sx: 1.25, sz: 0.85 }],
      [-84, 124, 0, 10, { deep: 20, style: 'raft', trees: 2, ruin: 1, sx: 1.35, sz: 0.9 }],
      [-80, 96, -5, 11, { deep: 24, stack: 9, trees: 2, sx: 1.2, sz: 0.9 }],
      [-68, 148, -5, 15, { deep: 34, style: 'stack', stack: 12, trees: 2 }],
      [-48, 112, -10, 9, { deep: 20, style: 'raft' }],
      [-131, 130, -3, 12, { deep: 26, trees: 2, ruin: 1, sx: 0.85, sz: 1.3 }],
      [-150, 142, -7, 14, { deep: 32, style: 'stack', ruin: 2, stack: 9 }],
      [-166, 118, -9, 9, { deep: 19, style: 'raft', trees: 1 }],
      [-32, 124, -7, 10, { deep: 22, trees: 1, sx: 1.3 }],
      [-12, 142, -2, 13, { deep: 27, style: 'stack', stack: 10 }],
      [18, 114, -9, 9, { deep: 19, style: 'raft' }],
      [52, 132, -4, 12, { deep: 25, trees: 2, sx: 1.25, sz: 0.85 }],
      [88, 104, -8, 9, { deep: 19, style: 'raft' }],
      [118, 130, 0, 13, { deep: 27, trees: 2, ruin: 1 }],
      [150, 144, -6, 11, { deep: 22, style: 'stack', stack: 8 }],
      [176, 112, -11, 9, { deep: 19, style: 'raft' }],
      [70, 154, 2, 14, { deep: 30, style: 'stack', stack: 11 }],
    ]) {
      bgIslet(at(deg, r, y, 0, ER.spread(0.05)), R, o);
      if (R >= 12) skirt(deg, r, y - R * 0.9, R * 3.0, R * 1.1);
    }

    // Bare rock down *inside* the chasm, mostly veiled by the deck: read only as
    // dark shapes through the gaps, which is what gives the drop its depth.
    for (const [deg, r, y, R, o] of [
      [-95, 96, -30, 11, { deep: 24, grass: false }],
      [-72, 130, -36, 13, { deep: 28, grass: false, style: 'stack' }],
      [-135, 112, -28, 10, { deep: 22, grass: false, sx: 1.3 }],
      [-158, 152, -38, 12, { deep: 26, grass: false, style: 'raft' }],
      [-20, 118, -32, 11, { deep: 24, grass: false }],
      [60, 142, -34, 12, { deep: 26, grass: false, style: 'stack' }],
      [130, 108, -30, 10, { deep: 22, grass: false, style: 'raft' }],
    ]) bgIslet(at(deg, r, y, 0, ER.spread(0.07)), R, o);

    // ------------------------------------------------------------ mid ring --
    for (const [deg, r, y, R, o] of [
      [-91, 205, -4, 20, { deep: 42, trees: 3, ruin: 2, stack: 15, sx: 1.3, sz: 0.85 }],
      [-118, 244, 3, 18, { deep: 36, style: 'raft', trees: 2, sx: 1.4 }],
      [-152, 196, -10, 16, { deep: 34, style: 'stack', ruin: 1 }],
      [-76, 246, -2, 17, { deep: 36, trees: 2, stack: 13 }],
      [-40, 232, -5, 20, { deep: 42, style: 'stack', stack: 17, trees: 2 }],
      [-14, 268, -8, 16, { deep: 33, style: 'raft', sx: 1.3 }],
      [40, 218, -6, 18, { deep: 36, trees: 2 }],
      [96, 252, 0, 19, { deep: 38, ruin: 2, style: 'raft', sx: 1.35 }],
      [140, 202, -9, 15, { deep: 32, style: 'stack' }],
      [168, 248, -5, 17, { deep: 35, trees: 1 }],
    ]) {
      bgIslet(at(deg, r, y, 0, ER.spread(0.04)), R, o);
      skirt(deg, r, y - R * 0.8, R * 3.2, R * 1.2);
    }

    // River-frame cluster: tall karst pinnacles standing against the sun glow,
    // stacked near→far so the low camera gets real parallax up the left side.
    bgIslet(at(-114, 252, 30), 20, { deep: 54, style: 'stack', trees: 3, ruin: 2, stack: 14 });
    skirt(-114, 252, -4, 96, 40);
    // citadel karst: seen from the river camera this is pure underside, so it
    // needs a silhouette standing on it to read as anything but a floating slab
    bgIslet(at(-124, 292, 46), 17, { deep: 74, style: 'stack', trees: 2, ruin: 2 });
    bgSpire(at(-124, 292, 46), { h: 26, r: 4.2, sat: 2, root: false });
    skirt(-124, 292, 2, 104, 46);
    bgIslet(at(-141, 250, 32), 15, { deep: 58, style: 'stack', trees: 2, stack: 10 });
    skirt(-141, 250, -4, 92, 40);
    bgIslet(at(-145, 300, 22), 22, { deep: 62, trees: 2, ruin: 1, sx: 1.35, sz: 0.8 });
    bgTemple(at(-145, 300, 22, 26), { w: 30, h: 9, n: 5 });
    skirt(-145, 300, -6, 110, 44);

    // ---------------------------------------------------------- structures --
    bgViaduct(at(-70, 250, -32, 6), { bays: 5, span: 26, pierH: 26, w: 8, dead: 2 });
    skirt(-70, 250, -24, 200, 58);
    bgTemple(at(-97, 216, -8, -14), { w: 46, h: 13, n: 7 });
    skirt(-97, 216, -14, 110, 40);
    bgViaduct(at(-133, 232, -18, -10), { bays: 4, span: 21, pierH: 19, w: 6, dead: 1 });
    skirt(-133, 232, -14, 150, 48);
    bgTemple(at(34, 262, -8, 20), { w: 40, h: 12, n: 6 });
    bgViaduct(at(128, 268, -16, -8), { bays: 4, span: 22, pierH: 20, w: 6, dead: 1 });

    // Base-frame landmark pair: a broken sanctum with its bell tower beside it.
    bgSpire(at(-61, 344, -34), { h: 66, r: 12 });
    skirt(-61, 344, -22, 116, 50);
    bgSpire(at(-55, 316, -26), { h: 34, r: 6, sat: 2 });
    bgRotunda(at(-73, 336, -16), { R: 24, h: 13, cols: 12 });
    skirt(-73, 336, -20, 132, 48);
    // River-frame landmark: a needle standing clear of the cloud sea.
    bgSpire(at(-130, 288, -26), { h: 84, r: 11 });
    skirt(-130, 288, -14, 118, 54);
    bgSpire(at(-137, 340, -20), { h: 46, r: 8, sat: 2 });
    bgRotunda(at(150, 330, -14), { R: 18, h: 10, cols: 10 });

    // --------------------------------------------------- far ghost skyline --
    for (const [deg, r, y, R, h] of [
      [-95, 480, -24, 78, 26], [-52, 512, -26, 88, 22], [-24, 460, -22, 62, 20],
      [-146, 448, -20, 70, 30], [-172, 505, -24, 82, 22], [16, 495, -22, 74, 24],
      [62, 460, -20, 60, 18], [108, 500, -24, 80, 22], [136, 450, -22, 66, 20],
    ]) {
      bgMassif(at(deg, r, y), { R, h, deep: 80 });
      skirt(deg, r, y + 2, R * 3.0, R * 1.1);
    }

    // ------------------------------------------------------------ material --
    const merged = mergeGeometries(solid, false);
    merged.computeBoundingSphere();
    for (const g of solid) g.dispose?.();
    const bgMat = new THREE.ShaderMaterial({
      fog: false, vertexColors: true,
      uniforms: shareSky({ uHazeK: { value: 0.0030 } }),
      vertexShader: `
        varying vec3 vWorld; varying vec3 vNrm; varying vec3 vCol;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vNrm = normalize(mat3(modelMatrix) * normal);
          vCol = color;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        ${SKY_UNIFORMS_GLSL}
        uniform float uHazeK;
        varying vec3 vWorld; varying vec3 vNrm; varying vec3 vCol;
        ${SKY_FN_GLSL}
        void main() {
          vec3 rv = vWorld - cameraPosition;
          float dist = length(rv);
          vec3 dir = rv / dist;
          vec3 N = normalize(vNrm);
          float lam = max(dot(N, uSunDir), 0.0);
          float up = N.y * 0.5 + 0.5;
          // cool sky dome above, warm bounce off the cloud sea below
          // cool sky dome above, warm bounce off the lit cloud sea underneath
          vec3 col = vCol * mix(vec3(0.30, 0.23, 0.17), vec3(0.22, 0.28, 0.43), up);
          col += vCol * uSunTint * lam * 1.25;
          col += vCol * uSunTint * (dot(N, uSunDir) * 0.5 + 0.5) * 0.08;   // wrap
          // backlit halo: the key sits behind this ring, so edges catch light
          float rim = pow(1.0 - abs(dot(N, dir)), 2.6);
          col += uSunTint * rim * (0.10 + 0.90 * max(dot(dir, uSunDir), 0.0)) * 0.50;
          vec3 sky = skyRay(dir);
          // roots soften as they go down into the deck instead of hanging there
          col = mix(col, sky * 1.03, smoothstep(-3.0, -30.0, vWorld.y) * 0.62);
          // aerial perspective — same exp2 curve as scene.fog and the strata
          float hd = dist * uHazeK;
          col = mix(col, sky, 1.0 - exp(-hd * hd));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const bgMesh = new THREE.Mesh(merged, bgMat);
    bgMesh.castShadow = false;
    bgMesh.receiveShadow = false;
    // default renderOrder on purpose: it stays in the normal front-to-back
    // opaque sort, so the arena's depth rejects most of these pixels for free
    bgMesh.matrixAutoUpdate = false; bgMesh.updateMatrix();
    group.add(bgMesh);

    // ------------------------------------------------------- mist skirts ----
    // Soft cloud caught around the feet of the big masses: hides every place a
    // silhouette meets the deck, so nothing looks stamped onto the cloud sea.
    {
      const N = skirts.length;
      const pos = new Float32Array(N * 4 * 3);
      const cor = new Float32Array(N * 4 * 2);
      const uvs = new Float32Array(N * 4 * 2);
      const index = new Uint16Array(N * 6);
      const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
      for (let i = 0; i < N; i++) {
        const [x, y, z, w, h] = skirts[i];
        for (let v = 0; v < 4; v++) {
          const o = (i * 4 + v) * 3, o2 = (i * 4 + v) * 2;
          pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
          cor[o2] = CX[v] * 0.5 * w; cor[o2 + 1] = CY[v] * 0.5 * h;
          uvs[o2] = CX[v] * 0.5 + 0.5; uvs[o2 + 1] = CY[v] * 0.5 + 0.5;
        }
        const b = i * 4, q = i * 6;
        index[q] = b; index[q + 1] = b + 1; index[q + 2] = b + 2;
        index[q + 3] = b; index[q + 4] = b + 2; index[q + 5] = b + 3;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: shareSky({ tMap: { value: tex.cloud }, uHazeK: { value: 0.0026 } }),
        vertexShader: `
          attribute vec2 aCorner;
          varying vec2 vUv; varying vec3 vWorld;
          void main() {
            vUv = uv;
            vWorld = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            mv.xy += aCorner;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          ${SKY_UNIFORMS_GLSL}
          uniform sampler2D tMap; uniform float uHazeK;
          varying vec2 vUv; varying vec3 vWorld;
          ${SKY_FN_GLSL}
          void main() {
            vec4 t = texture2D(tMap, vUv);
            if (t.a < 0.01) discard;
            vec3 rv = vWorld - cameraPosition;
            float dist = length(rv);
            vec3 dir = rv / dist;
            float az = dot(normalize(vWorld.xz + vec2(1e-5)), normalize(uSunDir.xz + vec2(1e-5)));
            vec3 col = t.rgb * mix(vec3(0.42, 0.44, 0.62), vec3(1.30, 0.94, 0.62), smoothstep(-0.8, 0.9, az));
            col *= mix(1.0, 0.42, smoothstep(0.78, 0.10, vUv.y));
            float hd = dist * uHazeK;
            float haze = 1.0 - exp(-hd * hd);
            col = mix(col, skyRay(dir), haze);
            gl_FragColor = vec4(col, smoothstep(0.10, 0.62, t.a) * 0.40 * (1.0 - haze * 0.45));
          }`,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -9.5;   // behind every cloud stratum, ahead of the band
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
    }
  }

  // ---------------------------------------------------------------- update --
  function update(dt) {
    isletHolder.position.y = Math.sin(uTime.value * 0.4) * 0.5;
    isletHolder.rotation.y = Math.sin(uTime.value * 0.11) * 0.012;
    // rune decal pulse (shared material)
    mats.rune.opacity = 0.62 + 0.25 * Math.sin(uTime.value * 1.9);
  }

  return { group, sun, hemi, sunDir, update };
}
