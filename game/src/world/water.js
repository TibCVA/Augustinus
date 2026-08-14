// River + waterfall — painterly stylized water.
//
//  * river surface is a channel-fitted mesh (no quad): every row is fitted to the
//    real shoreline of the carved riverbed, and alpha/colour fade out with water
//    depth so the water never ends on a straight edge.
//  * two scrolling derivative (slope) layers drive normals -> fresnel sky
//    reflection, sun sparkle glints, caustic shimmer on the shallow bed.
//  * foam hugs the shore / rock band / plunge pool / spill lip and breathes with
//    animated noise.
//  * waterfall is a curved-lip sheet (widening toward the base) with three streak
//    layers at different speeds, a noisy silhouette, a spray plume and a glowing
//    plunge pool. Values stay well under the bloom threshold.
//
// Textures used here are generated locally (canvas, procedural) so nothing new is
// pushed into core/assets.js. Draw calls: 4 (river+source pool, both falling
// sheets, mist, sparkles) — two fewer than the previous version.
import * as THREE from 'three';
import { tex, uTime, cpuNoise } from '../core/assets.js';
import { makeRng, SEED } from '../core/rng.js';
import { A } from './arena.js';

const smooth = THREE.MathUtils.smoothstep;
const WR = makeRng(SEED ^ 0x5eaf00d);   // local stream: keeps world-gen RNG untouched

const WATER_Y = -0.5;                   // river surface height
const Z_BACK = -14.35;                  // behind the falls (plunge basin)
const Z_LIP = 16.55;                    // where the river reaches the arena rim
const PLUNGE_Z = -12.35;                // where the sheet hits the pool

// ===========================================================  local textures ==
// tileable value noise (same construction as core/assets so scales feel related)
function tileNoise(n, seed) {
  const rng = makeRng(seed);
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rng.next();
  const at = (x, y) => g[((((y % n) + n) % n) * n) + (((x % n) + n) % n)];
  const sm = (t) => t * t * (3 - 2 * t);
  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return {
    sample,
    fbm(x, y, oct = 4) {
      let v = 0, amp = 0.5, f = 1;
      for (let o = 0; o < oct; o++) { v += sample(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
      return v;
    },
  };
}

function mkCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Ripple field: rg = surface slope (0.5 = flat), b = wave height.
// Anisotropic (stretched across the flow) so ripples read as travelling wavelets.
function makeRippleTex() {
  const S = 128, L = 8;
  const na = tileNoise(L, 0x51fe1a), nb = tileNoise(L, 0x77ac3b);
  const h = new Float32Array(S * S);
  let hmin = 1e9, hmax = -1e9;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * L, v = (y / S) * L;
      // integer frequency multipliers keep every octave tileable
      const a = na.fbm(u, v * 2, 4);
      const b = nb.fbm(u * 2, v * 4, 3);
      const w = a * 0.68 + b * 0.32;
      h[y * S + x] = w;
      if (w < hmin) hmin = w;
      if (w > hmax) hmax = w;
    }
  }
  const inv = 1 / Math.max(1e-4, hmax - hmin);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - hmin) * inv;
  // finite-difference slopes, normalised so 0/1 = steepest
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S);
  let gmax = 1e-5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[(((y + 1) % S) * S) + x] - h[(((y + S - 1) % S) * S) + x];
      gx[i] = dx; gy[i] = dy;
      gmax = Math.max(gmax, Math.abs(dx), Math.abs(dy));
    }
  }
  const [c, ctx] = mkCanvas(S);
  const img = ctx.createImageData(S, S);
  const k = 0.5 / gmax;
  for (let i = 0; i < S * S; i++) {
    img.data[i * 4] = Math.round((0.5 + gx[i] * k) * 255);
    img.data[i * 4 + 1] = Math.round((0.5 + gy[i] * k) * 255);
    img.data[i * 4 + 2] = Math.round(h[i] * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Falling-water streaks: three independent fibre sets (r/g/b) so one fetch gives
// three layers. Tileable in both axes.
function makeStreakTex() {
  const S = 256;
  const buf = [new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S)];
  const sets = [
    { n: 74, w: [0.9, 2.6], a: [0.35, 0.85] },
    { n: 40, w: [2.2, 6.0], a: [0.30, 0.75] },
    { n: 18, w: [5.0, 13.0], a: [0.25, 0.60] },
  ];
  for (let ch = 0; ch < 3; ch++) {
    const st = sets[ch], dst = buf[ch];
    for (let f = 0; f < st.n; f++) {
      const cx = WR.f(S), w = WR.f(st.w[0], st.w[1]), amp = WR.f(st.a[0], st.a[1]);
      const k1 = WR.i(1, 3), k2 = WR.i(2, 6), ph = WR.f(Math.PI * 2), ph2 = WR.f(Math.PI * 2);
      const span = Math.ceil(w * 3);
      for (let dx = -span; dx <= span; dx++) {
        const g = Math.exp(-(dx * dx) / (2 * w * w));
        if (g < 0.01) continue;
        const x = (((Math.round(cx) + dx) % S) + S) % S;
        for (let y = 0; y < S; y++) {
          const t = (y / S) * Math.PI * 2;
          const m = 0.55 + 0.45 * Math.sin(t * k1 + ph) * Math.sin(t * k2 + ph2);
          dst[y * S + x] += g * amp * m;
        }
      }
    }
  }
  const [c, ctx] = mkCanvas(S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    img.data[i * 4] = Math.min(255, buf[0][i] * 210);
    img.data[i * 4 + 1] = Math.min(255, buf[1][i] * 215);
    img.data[i * 4 + 2] = Math.min(255, buf[2][i] * 220);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ===========================================================  riverbed shape ==
// Mirrors arena.js terrainHeight() inside the river band (the base plateau term
// is zero this far from the bases) so the water can be fitted to the real banks.
function grassNoise(x, z) { return (cpuNoise.fbm(x * 0.14 + 31, z * 0.14 + 11, 3) - 0.5) * 0.55; }
function bedH(x, z) {
  const riverT = 1 - smooth(Math.abs(x), A.RIVER_HALF - 1.4, A.RIVER_HALF + 2.4);
  const laneF = smooth(Math.abs(z), A.LANE_HALF - 1.6, A.LANE_HALF + 1.2);
  return -riverT * 2.0 + grassNoise(x, z) * laneF * (1 - riverT);
}
// |x| of the waterline on side s for a given z (bisection; bed rises with |x|)
function shoreX(z, s) {
  let lo = 1.6, hi = 7.6;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) * 0.5;
    if (bedH(s * m, z) < WATER_Y + 0.03) lo = m; else hi = m;
  }
  return s * lo;
}

// ================================================================== builders ==
function buildRiverGeometry() {
  const NX = 26, NZ = 66;
  const pos = [], wat = [], idx = [];
  // rows: flat channel, then a short curl over the arena rim
  const rows = [];
  for (let j = 0; j < NZ; j++) {
    const z = Z_BACK + (Z_LIP - Z_BACK) * (j / (NZ - 1));
    rows.push({ z, y: WATER_Y, fade: 1, curl: 0 });
  }
  const curl = [[0.30, 0.10, 0.92], [0.62, 0.34, 0.7], [0.9, 0.72, 0.4], [1.12, 1.2, 0]];
  for (const [dz, dy, f] of curl) rows.push({ z: Z_LIP + dz, y: WATER_Y - dy, fade: f, curl: 1 });

  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    const zr = Math.min(r.z, Z_LIP);
    // the waterline wanders inward from the true bank so the channel is never a
    // pair of parallel lines (outward would float the water above the bank)
    const wl = 0.10 + cpuNoise.fbm(zr * 0.09 + 5, 1.7, 3) * 0.62 + cpuNoise.fbm(zr * 0.31 + 2, 6.1, 2) * 0.34;
    const wr = 0.10 + cpuNoise.fbm(zr * 0.09 + 41, 9.3, 3) * 0.62 + cpuNoise.fbm(zr * 0.31 + 17, 3.4, 2) * 0.34;
    const xl = shoreX(zr, -1) + (r.curl ? 0.2 : wl);
    const xr = shoreX(zr, 1) - (r.curl ? 0.2 : wr);
    for (let i = 0; i < NX; i++) {
      const u = i / (NX - 1);
      const x = xl + (xr - xl) * u;
      // effective depth also encodes the distance to the mesh edge, so the alpha /
      // foam falloff follows the wandering waterline instead of the bed alone
      const edge = Math.min(x - xl, xr - x) * 1.15;
      const d = r.curl ? Math.min(1.3, edge) : Math.min(Math.max(0, WATER_Y - bedH(x, r.z)), edge);
      pos.push(x, r.y, r.z);
      wat.push(d, r.fade);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // source pool up on the falls cliff (same material -> same draw call)
  {
    const cx = 0, cz = -15.95, R = 2.95, N = 26;
    const base = pos.length / 3;
    pos.push(cx, 2.42, cz); wat.push(1.15, 1);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * (0.82 + cpuNoise.fbm(Math.cos(a) * 2 + 9, Math.sin(a) * 2 + 3, 2) * 0.42);
      pos.push(cx + Math.cos(a) * rr, 2.42, cz + Math.sin(a) * rr * 0.82);
      wat.push(0, 1);
    }
    for (let i = 0; i < N; i++) idx.push(base, base + 1 + ((i + 1) % N), base + 1 + i);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array(wat), 2));
  g.setIndex(idx);
  return g;
}

// Curved falling sheet from a mid-line profile.
// row = [y, z, halfWidth, planArc, crest, alphaMul, tNorm, lipWave]
function pushSheet(out, rows, cols) {
  const base = out.pos.length / 3;
  // arclength along the mid-line -> streak scrolling is uniform in metres
  const vlen = [0];
  for (let i = 1; i < rows.length; i++) {
    vlen.push(vlen[i - 1] + Math.hypot(rows[i][0] - rows[i - 1][0], rows[i][1] - rows[i - 1][1]));
  }
  for (let j = 0; j < rows.length; j++) {
    const [y, z, hw, arc, crest, aMul, tN, wav = 0] = rows[j];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1), q = u * 2 - 1;
      const bow = 1 - q * q;
      // irregular crest so the lip is never a ruler-straight line
      const lw = Math.sin(u * 8.4 + 0.9) * 0.55 + Math.sin(u * 15.1 + 2.2) * 0.28
               + Math.sin(u * 4.2 + 5.0) * 0.30;
      out.pos.push(q * hw, y - bow * 0.06 * arc + lw * wav, z + bow * arc);
      out.uv.push(u, vlen[j]);
      out.data.push(Math.abs(q), tN, crest, THREE.MathUtils.clamp(aMul * (1 + lw * wav * 2.4), 0, 1));
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      out.idx.push(a, c, b, b, c, d);
    }
  }
}

export function buildWater(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const tRip = makeRippleTex();
  const tStreak = makeStreakTex();
  // golden-hour key light (mirrors environment.js sunDir)
  const uSunDir = { value: new THREE.Vector3(-0.42, 0.62, -0.55).normalize() };
  const uSunCol = { value: new THREE.Color(1.0, 0.86, 0.62) };

  // --------------------------------------------------------------- river mat --
  const riverMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime, uSunDir, uSunCol,
      tRip: { value: tRip }, tNoise: { value: tex.noise },
      uDeep: { value: new THREE.Color(0x125a66) },
      uShallow: { value: new THREE.Color(0x41b0a3) },
      uFoam: { value: new THREE.Color(0xdff7ef) },
    },
    vertexShader: /* glsl */`
      attribute vec2 aWater;          // x: depth under the surface, y: mesh fade
      uniform float uTime;
      varying vec3 vWp;
      varying float vDepth;
      varying float vFade;
      void main() {
        vDepth = aWater.x;
        vFade = aWater.y;
        vec3 p = position;
        float k = min(vDepth, 1.0);
        p.y += (sin(p.z * 0.85 + uTime * 1.3) + sin(p.x * 1.6 - uTime * 0.9)) * 0.022 * k;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tRip; uniform sampler2D tNoise;
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uFoam, uSunDir, uSunCol;
      varying vec3 vWp;
      varying float vDepth;
      varying float vFade;

      vec3 skyTint(vec3 d) {
        float h = d.y;
        vec3 zen = vec3(0.13, 0.30, 0.55);
        vec3 mid = vec3(0.46, 0.66, 0.84);
        vec3 hor = vec3(0.98, 0.71, 0.45);
        vec3 c = mix(mid, zen, smoothstep(0.15, 0.75, h));
        c = mix(hor, c, smoothstep(-0.05, 0.28, h));
        return mix(c, vec3(0.52, 0.63, 0.72), 0.28);   // compress: painted, not mirror
      }

      void main() {
        vec2 p = vWp.xz;               // p.x = world X, p.y = world Z
        float px = vWp.x, pz = vWp.z;
        float t = uTime;
        // ---- two scrolling slope layers (flow runs +Z, downstream)
        vec4 r1 = texture2D(tRip, p * vec2(0.085, 0.055) + vec2(0.004, -0.030) * t);
        vec4 r2 = texture2D(tRip, p * vec2(0.205, 0.140) + vec2(-0.009, -0.078) * t
                                   + (r1.rg - 0.5) * 0.06);
        vec2 slope = (r1.rg - 0.5) * 0.72 + (r2.rg - 0.5) * 0.48;
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
        float wav = r1.b * 0.55 + r2.b * 0.45;

        float d = vDepth;
        float dn = smoothstep(0.05, 0.85, d);

        // ---- depth tint: turquoise shallows -> deep teal channel
        vec3 col = mix(uShallow, uDeep, dn);
        col *= 0.88 + wav * 0.30;

        // ---- caustic web on the shallow bed (crossing wave crests)
        float caus = pow((1.0 - abs(r1.b * 2.0 - 1.0)) * (1.0 - abs(r2.b * 2.0 - 1.0)), 5.5);
        col += uSunCol * caus * (1.0 - smoothstep(0.1, 0.95, d)) * 0.12;

        // ---- long flow streaks (stretched along the channel)
        float streak = texture2D(tRip, vec2(px * 0.30, pz * 0.030 - t * 0.10)).b;
        col *= 0.95 + streak * 0.11;
        // ---- macro tone drift: low frequency, survives mipmapping at map zoom
        float macro = texture2D(tNoise, p * vec2(0.030, 0.018) + vec2(0.0, -t * 0.006)).b;
        col *= 0.86 + macro * 0.30;

        // ---- fresnel sky reflection
        vec3 V = normalize(cameraPosition - vWp);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.6);
        vec3 R = reflect(-V, N);
        col = mix(col, skyTint(R), clamp(0.03 + fres * 0.42, 0.0, 0.35) * (0.3 + 0.7 * dn));

        // ---- sun specular: broad sheen + tight sparkle glints
        vec3 H = normalize(V + uSunDir);
        float ndh = max(dot(N, H), 0.0);
        col += uSunCol * pow(ndh, 24.0) * 0.07;
        col += uSunCol * pow(ndh, 200.0) * 1.1 * smoothstep(0.4, 0.78, wav);

        // ---- foam: broken shoreline lines, rock froth, plunge pool, spill lip
        float fn = texture2D(tNoise, p * vec2(0.085, 0.05) + vec2(0.0, -t * 0.04)).r;
        float fn2 = texture2D(tNoise, p * vec2(0.24, 0.17) + vec2(0.03, -t * 0.11)).g;
        float nz = fn * 0.55 + fn2 * 0.45;
        // thin line that hugs the waterline and breathes with the noise
        float line = smoothstep(0.36, 0.06, d) * smoothstep(0.02, 0.10, d);
        float hiN = texture2D(tNoise, p * vec2(0.55, 0.42) + vec2(0.0, -t * 0.16)).b;
        float foam = smoothstep(0.40, 0.78, line * (0.42 + nz * 0.95 + hiN * 0.28));
        // wet froth around the bank rocks
        float rockBand = 1.0 - smoothstep(0.3, 1.3, abs(abs(px) - 4.0));
        foam += smoothstep(0.74, 0.96, nz) * rockBand * 0.4;
        // plunge pool under the falls + expanding rings
        float pd = length(p - vec2(0.0, -12.35));
        float plunge = 1.0 - smoothstep(0.4, 2.7, pd);
        foam += plunge * (0.22 + 0.78 * smoothstep(0.32, 0.82, fn2));
        float rings = sin(pd * 2.6 - t * 3.0) * 0.5 + 0.5;
        foam += (1.0 - smoothstep(1.8, 5.4, pd)) * rings * smoothstep(0.44, 0.82, fn) * 0.38;
        // acceleration froth as the river reaches the rim
        foam += smoothstep(13.8, 16.5, pz) * (0.18 + 0.6 * smoothstep(0.42, 0.86, fn2));
        foam = clamp(foam, 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.72);

        // ---- bridge shadow band (the deck occludes the key light here)
        float bsh = 1.0 - smoothstep(3.2, 5.6, abs(pz - 1.1));
        bsh *= 1.0 - smoothstep(5.4, 7.0, abs(px));
        col *= mix(1.0, 0.58, bsh);
        col = mix(col, col * vec3(0.86, 0.98, 1.06), bsh * 0.8);

        // ---- alpha: translucent at the banks, opaque in the channel, 0 at the line
        float alpha = mix(0.20, 0.92, smoothstep(0.05, 0.85, d));
        alpha = max(alpha, foam * 0.9);
        alpha *= smoothstep(0.0, 0.34, d) * vFade;   // wide dissolve into the bank
        gl_FragColor = vec4(col, alpha);
      }`,
  });

  {
    const river = new THREE.Mesh(buildRiverGeometry(), riverMat);
    river.renderOrder = 1;
    river.matrixAutoUpdate = false; river.updateMatrix();
    group.add(river);
  }

  // --------------------------------------------------------------- falls mat --
  const fallsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime, tStreak: { value: tStreak }, tRip: { value: tRip },
      uCool: { value: new THREE.Color(0x3f7f8c) },
      uPale: { value: new THREE.Color(0xbfe0e2) },
      uWarm: { value: new THREE.Color(0xe6d9c2) },
    },
    vertexShader: /* glsl */`
      attribute vec4 aData;           // edge | fall progress | crest | alpha mul
      varying vec2 vUv; varying vec4 vData;
      void main() {
        vUv = uv; vData = aData;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tStreak; uniform sampler2D tRip;
      uniform float uTime;
      uniform vec3 uCool, uPale, uWarm;
      varying vec2 vUv; varying vec4 vData;
      void main() {
        float u = vUv.x, v = vUv.y;
        float edge = vData.x, tN = vData.y, crest = vData.z, aMul = vData.w;
        float T = uTime;

        // lateral wobble so nothing reads as a straight bar
        float wob = texture2D(tRip, vec2(u * 0.8, v * 0.05 - T * 0.06)).b;
        float uu = u + (wob - 0.5) * 0.05;

        // three streak layers, different scale + speed
        float s1 = texture2D(tStreak, vec2(uu * 1.10, v * 0.105 - T * 0.52)).r;
        float s2 = texture2D(tStreak, vec2(uu * 2.05 + 0.33, v * 0.062 - T * 0.34)).g;
        float s3 = texture2D(tStreak, vec2(uu * 0.55 + 0.71, v * 0.040 - T * 0.22)).b;
        float body = s1 * 0.46 + s2 * 0.34 + s3 * 0.44;

        // noisy silhouette: ragged sides, more broken further down
        float en = texture2D(tRip, vec2(u * 1.7 + 0.2, v * 0.17 - T * 0.20)).b;
        float sil = smoothstep(0.0, 0.20, (1.0 - edge) + (en - 0.5) * 0.42 * (0.35 + tN));

        // the crest at the lip runs fast and bright
        float lip = texture2D(tStreak, vec2(uu * 1.7, v * 0.5 - T * 1.15)).g;
        float crestBand = crest * (0.45 + 0.75 * lip);

        // the base shatters into fingers of spray
        float dis = smoothstep(0.55, 1.0, tN);
        float fingers = smoothstep(0.18, 0.62, body * 0.75 + en * 0.55);

        vec3 col = mix(uCool, uPale, clamp(body * 0.95, 0.0, 1.0));
        col += uPale * crestBand * 0.30;
        col += uPale * smoothstep(0.5, 1.0, edge) * 0.10;          // aerated rim
        col += uWarm * (1.0 - smoothstep(0.0, 0.55, body)) * 0.06;  // backlight bleed
        col = mix(col, uWarm, dis * 0.35);
        col *= 0.93 + s2 * 0.14;

        float a = clamp(mix(0.62, 0.26, tN) + body * 0.85 + crestBand * 0.20, 0.0, 1.0);
        a *= sil * aMul * mix(1.0, fingers, dis);
        a *= 0.96;
        gl_FragColor = vec4(col, a);
      }`,
  });

  {
    const out = { pos: [], uv: [], data: [], idx: [] };
    const ZF = -13.95;
    // main fall: horizontal approach -> curled lip -> widening sheet -> plunge
    pushSheet(out, [
      //  y      z            halfW  arc  crest aMul  tN    lipWave
      [2.46, ZF - 1.62, 2.80, 0.55, 0.00, 0.00, 0.00, 0.04],
      [2.50, ZF - 0.95, 2.98, 0.70, 0.50, 0.50, 0.00, 0.09],
      [2.47, ZF - 0.34, 3.10, 0.82, 1.00, 0.95, 0.04, 0.13],
      [2.24, ZF + 0.02, 3.20, 0.78, 0.70, 1.00, 0.12, 0.11],
      [1.78, ZF + 0.30, 3.32, 0.64, 0.22, 1.00, 0.25, 0.07],
      [1.08, ZF + 0.60, 3.46, 0.52, 0.04, 1.00, 0.44, 0.03],
      [0.28, ZF + 0.96, 3.62, 0.42, 0.00, 0.95, 0.64, 0.00],
      [-0.30, ZF + 1.34, 3.80, 0.34, 0.00, 0.60, 0.85, 0.00],
      [-0.78, ZF + 1.66, 3.96, 0.28, 0.00, 0.00, 1.00, 0.00],
    ], 22);
    // rim spill: the river leaving the arena into the cloud chasm
    pushSheet(out, [
      [-0.42, 17.00, 4.10, 0.34, 0.85, 0.00, 0.00, 0.07],
      [-0.85, 17.42, 4.20, 0.32, 0.55, 0.55, 0.10, 0.09],
      [-1.45, 17.95, 4.35, 0.28, 0.25, 0.95, 0.24, 0.07],
      [-2.60, 18.50, 4.55, 0.24, 0.05, 0.85, 0.45, 0.04],
      [-3.90, 19.00, 4.80, 0.18, 0.00, 0.50, 0.68, 0.00],
      [-5.30, 19.40, 5.05, 0.14, 0.00, 0.18, 0.88, 0.00],
      [-6.60, 19.60, 5.20, 0.10, 0.00, 0.00, 1.00, 0.00],
    ], 18);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.uv), 2));
    g.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(out.data), 4));
    g.setIndex(out.idx);
    const falls = new THREE.Mesh(g, fallsMat);
    falls.renderOrder = 3;
    falls.matrixAutoUpdate = false; falls.updateMatrix();
    group.add(falls);
  }

  // -------------------------------------------------------------- mist plume --
  {
    const spots = [];
    // plunge basin: low wispy mist hugging the pool
    for (let i = 0; i < 18; i++) {
      const a = WR.f(Math.PI * 2);
      spots.push([
        Math.cos(a) * WR.f(0.3, 3.4),
        WR.f(-0.45, 0.85),
        PLUNGE_Z + Math.sin(a) * WR.f(0.2, 1.4),
        WR.f(0.7, 1.5), WR.f(1), WR.f(0.8, 1.2),
      ]);
    }
    // rim spill mist
    for (let i = 0; i < 6; i++) {
      spots.push([WR.spread(3.4), WR.f(-4.2, -1.2), 18.1 + WR.f(1.4), WR.f(1.1, 2.0), WR.f(1), WR.f(0.6, 0.95)]);
    }
    const n = spots.length;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const off = new Float32Array(n * 4), ph = new Float32Array(n * 2);
    spots.forEach((s, i) => {
      off[i * 4] = s[0]; off[i * 4 + 1] = s[1]; off[i * 4 + 2] = s[2]; off[i * 4 + 3] = s[3];
      ph[i * 2] = s[4]; ph[i * 2 + 1] = s[5];
    });
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 2));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, tMap: { value: tex.smoke } },
      vertexShader: /* glsl */`
        attribute vec4 aOff; attribute vec2 aPhase;
        uniform float uTime;
        varying vec2 vUv; varying float vA; varying float vY;
        void main() {
          vUv = uv;
          float cyc = fract(uTime * 0.155 * aPhase.y + aPhase.x);
          float sc = aOff.w * (0.45 + cyc * 1.05) * aPhase.y;
          vA = sin(cyc * 3.14159) * 0.20 * (0.6 + aPhase.y * 0.5);
          vY = cyc;
          vec3 wp = aOff.xyz + vec3(sin(cyc * 4.0 + aPhase.x * 6.0) * 0.45, cyc * 1.15, cyc * 0.4);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          wp += right * position.x * sc + up * position.y * sc;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap;
        varying vec2 vUv; varying float vA; varying float vY;
        void main() {
          vec4 c = texture2D(tMap, vUv);
          vec3 col = mix(vec3(0.80, 0.88, 0.92), vec3(0.95, 0.92, 0.85), vY);
          gl_FragColor = vec4(col, c.a * vA);
        }`,
    });
    const mist = new THREE.Mesh(geo, mat);
    mist.frustumCulled = false;
    mist.renderOrder = 4;
    group.add(mist);
  }

  // ---------------------------------------------------------- spray sparkles --
  {
    const count = 44;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const spill = i >= 32;
      pos[i * 3] = spill ? WR.spread(3.6) : WR.spread(3.1);
      pos[i * 3 + 1] = spill ? -0.6 : -0.35;
      pos[i * 3 + 2] = spill ? 17.2 + WR.f(0.7) : PLUNGE_Z + WR.spread(1.0);
      seed[i * 2] = WR.next();
      seed[i * 2 + 1] = spill ? 1.0 : 0.0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime, tMap: { value: tex.spark } },
      vertexShader: /* glsl */`
        attribute vec2 aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          float s = aSeed.x;
          float cyc = fract(uTime * (0.55 + s * 0.5) + s * 7.0);
          vec3 p = position;
          float up = 1.5 + s * 1.7;
          p.y += cyc * up - cyc * cyc * up * 0.75;             // ballistic arc
          p.z += cyc * (0.6 + s * 1.4) * mix(1.0, 1.7, aSeed.y);   // spill spray throws further
          p.x += cyc * (s - 0.5) * 2.4;
          vA = (1.0 - cyc) * (0.22 + s * 0.3);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.3 + s * 1.9) * (44.0 / max(-mv.z, 3.0));
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap;
        varying float vA;
        void main() {
          vec4 c = texture2D(tMap, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.80, 0.93, 0.96), c.a * vA);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    group.add(pts);
  }

  return { group, riverMat, fallsMat, update() {} };
}
