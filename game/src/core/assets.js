// ALL procedural canvas textures & shared materials for Aether Rift.
// Everything is hand-painted in code — zero network fetches.
import * as THREE from 'three';
import { makeRng, SEED } from './rng.js';

export const tex = {};   // textures by name
export const mats = {};  // shared materials by name

// One global time uniform shared by every animated shader.
export const uTime = { value: 0 };
// World-space sun direction (points *toward* the sun). environment.js owns the
// real value and writes it here at build time; shaders in any module read it.
export const uSunDir = { value: new THREE.Vector3(-0.44, 0.50, -0.60).normalize() };

// ---------------------------------------------------------------- palette --
export const PAL = {
  sun: 0xffd9a6,
  skyZenith: 0x2a6096, skyMid: 0x7fb2d9, skyHorizon: 0xffcf96, skyGlow: 0xffe9c2,
  fog: 0xe8b988,
  stone: 0xcfc5ae, stoneDark: 0x8d8571, moss: 0x7ca35c,
  grassLo: 0x4e7d36, grassHi: 0x8fbf52,
  teal: 0x59f2ff, arcane: 0x6fd4ff, gold: 0xffcf6e, goldDeep: 0xc98f2e,
  blue: 0x4f9dff, red: 0xff6a4d,
  blossom: 0xffa9c1, blossomDeep: 0xd16f96,
  waterDeep: 0x155a66, waterShallow: 0x5fd6c9, foam: 0xeafff8,
  ember: 0xff8a3d,
};

const TR = makeRng(SEED ^ 0x7ac1e5); // texture paint stream

// ------------------------------------------------------------ canvas utils --
function mkCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { srgb = true, wrap = THREE.RepeatWrapping, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function css(h, a = 1) {
  const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255;
  return `rgba(${r},${g},${b},${a})`;
}
function mixh(h1, h2, t) {
  const r = ((h1 >> 16) & 255) + (((h2 >> 16) & 255) - ((h1 >> 16) & 255)) * t;
  const g = ((h1 >> 8) & 255) + (((h2 >> 8) & 255) - ((h1 >> 8) & 255)) * t;
  const b = (h1 & 255) + ((h2 & 255) - (h1 & 255)) * t;
  return (r << 16) | (g << 8) | (b | 0);
}
function splat(ctx, x, y, r, color, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(color, a));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Tileable value noise (lattice N) with fbm.
function makeNoise(n, seedX) {
  const rng = makeRng(seedX);
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rng.next();
  const at = (x, y) => g[((y % n + n) % n) * n + ((x % n + n) % n)];
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
export const cpuNoise = makeNoise(64, SEED ^ 0x33aa71);

// ================================================================ TEXTURES ==

// -- generic RGBA noise texture for shaders (linear space) --
function texNoise() {
  const S = 256, [c, ctx] = mkCanvas(S);
  const img = ctx.createImageData(S, S);
  const n1 = makeNoise(32, 101), n2 = makeNoise(32, 202), n3 = makeNoise(32, 303);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, u = x / S * 32, v = y / S * 32;
    img.data[i] = n1.fbm(u, v, 4) * 255;
    img.data[i + 1] = n2.fbm(u * 0.5, v * 0.5, 4) * 255;
    img.data[i + 2] = n3.sample(u * 2, v * 2) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = toTex(c, { srgb: false });
  return t;
}

// -- lane paving: pale irregular stone tiles, AO grout, moss, painterly wear --
function texStone() {
  const S = 1024, [c, ctx] = mkCanvas(S);
  // grout base (deep cool shadow w/ moss)
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#4c4a3e'); bg.addColorStop(1, '#3e4238');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(8, 42), 0x55663f, 0.35);

  // Irregular tile grid. The texture tiles with RepeatWrapping, so any tile that
  // runs off the right edge must be stamped again on the left with IDENTICAL
  // randomness — otherwise a dead-straight discontinuity crosses the lane every
  // repeat. That means every TR.* draw is rolled ONCE into `P` up front, and
  // `stamp(ox)` only reads from it.
  const rows = 7;
  const tints = [0xcfc5ae, 0xc6bda2, 0xd8cbb4, 0xbdb9a6, 0xcbc0b3, 0xc2c3b0, 0xd2c3a4];
  // jittered course heights, renormalised to sum exactly S so the band rhythm
  // stops reading as a metronome while the texture still tiles vertically
  const courseH = [];
  let hSum = 0;
  for (let r = 0; r < rows; r++) { const v = TR.f(0.82, 1.18); courseH.push(v); hSum += v; }
  for (let r = 0; r < rows; r++) courseH[r] = (courseH[r] / hSum) * S;

  let yTop = 0;
  for (let r = 0; r < rows; r++) {
    const h = courseH[r], rowY = yTop;
    yTop += h;
    let x = (r % 2) * -TR.f(40, 130);
    while (x < S + 10) {
      const w = TR.f(110, 220);
      const P = {
        j: Array.from({ length: 16 }, () => TR.spread(9)),
        tint: TR.i(0, tints.length - 1),
        cool: TR.chance(0.16), warm: TR.chance(0.12),
        patches: Array.from({ length: 7 }, () => ({
          x: TR.f(w), y: TR.f(h), r: TR.f(10, 46), c: TR.chance(0.5) ? 0xb9c4bb : 0xd9c9a6,
        })),
        crack: TR.chance(0.4),
        crackX: TR.f(w), crackY: TR.f(h),
        crackSteps: Array.from({ length: 4 }, () => [TR.spread(38), TR.spread(30)]),
        speckles: Array.from({ length: 26 }, () => ({
          light: TR.chance(0.5), x: TR.f(w), y: TR.f(h),
        })),
      };
      let base = tints[P.tint];
      if (P.cool) base = mixh(base, 0x8fa3a0, 0.4);   // cool blue-gray tile
      if (P.warm) base = mixh(base, 0xc9a276, 0.35);  // warm sand tile

      const stamp = (ox) => {
        const x0 = x + 5 + ox, y0 = rowY + 5, x1 = x + w - 5 + ox, y1 = rowY + h - 5;
        const J = P.j;
        // tile poly with jittered corners + midpoints (hand-cut look)
        const pts = [
          [x0 + J[0], y0 + J[1]], [(x0 + x1) / 2 + J[2], y0 + J[3] * 1.6], [x1 + J[4], y0 + J[5]],
          [x1 + J[6] * 1.6, (y0 + y1) / 2 + J[7]], [x1 + J[8], y1 + J[9]],
          [(x0 + x1) / 2 + J[10], y1 + J[11] * 1.6], [x0 + J[12], y1 + J[13]],
          [x0 + J[14] * 1.6, (y0 + y1) / 2 + J[15]],
        ];
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
        ctx.closePath();
        ctx.fillStyle = css(base);
        ctx.fill();
        ctx.save();
        ctx.clip();
        // inner shading: light top-left, AO bottom-right (baked sun feel)
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        splat(ctx, cx - w * 0.18, cy - h * 0.2, w * 0.75, 0xfff3da, 0.22);
        splat(ctx, cx + w * 0.25, cy + h * 0.28, w * 0.8, 0x4e5347, 0.3);
        for (const p of P.patches) splat(ctx, x0 + p.x, y0 + p.y, p.r, p.c, 0.14);
        // edge AO ring
        ctx.lineWidth = 14; ctx.strokeStyle = css(0x3a3d33, 0.4); ctx.stroke();
        ctx.lineWidth = 6; ctx.strokeStyle = css(0x2f3129, 0.5); ctx.stroke();
        // top-left worn highlight edge
        ctx.beginPath();
        ctx.moveTo(pts[6][0] + 4, pts[6][1] - 4);
        ctx.lineTo(pts[0][0] + 4, pts[0][1] + 4);
        ctx.lineTo(pts[2][0] - 4, pts[2][1] + 4);
        ctx.lineWidth = 3.5; ctx.strokeStyle = css(0xfff6e0, 0.35); ctx.stroke();
        if (P.crack) {
          ctx.beginPath();
          let px = x0 + P.crackX, py = y0 + P.crackY;
          ctx.moveTo(px, py);
          for (const [dx, dy] of P.crackSteps) { px += dx; py += dy; ctx.lineTo(px, py); }
          ctx.lineWidth = 2; ctx.strokeStyle = css(0x3c3f35, 0.55); ctx.stroke();
        }
        for (const s of P.speckles) {
          ctx.fillStyle = css(s.light ? 0xffffff : 0x33352c, 0.08);
          ctx.fillRect(x0 + s.x, y0 + s.y, 2.4, 2.4);
        }
        ctx.restore();
      };

      stamp(0);
      if (x + w > S) stamp(-S);   // wrap the overhang onto the left edge
      if (x < 0) stamp(S);        // and the row's negative-start tile onto the right
      x += w;
    }
  }
  // moss creeping from grout
  for (let i = 0; i < 520; i++) {
    const x = TR.f(S), y = TR.f(S);
    splat(ctx, x, y, TR.f(4, 20), mixh(0x6f9a4e, 0x93b25d, TR.next()), 0.16);
  }
  // large-scale hue variation (golden pools & teal shadow pools)
  for (let i = 0; i < 14; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(120, 320), 0xffd9a0, 0.06);
  for (let i = 0; i < 14; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(120, 320), 0x39586c, 0.07);
  // The lane runs toward the horizon at a grazing angle; at the default aniso
  // its far half mips down to featureless mush.
  return toTex(c, { aniso: 16 });
}

// -- cliff / boulder rock: chunky facets, painterly --
function texRock() {
  const S = 512, [c, ctx] = mkCanvas(S);
  ctx.fillStyle = '#8f887a'; ctx.fillRect(0, 0, S, S);
  const n = makeNoise(16, 909);
  // faceted plates
  for (let i = 0; i < 90; i++) {
    const x = TR.f(S), y = TR.f(S), r = TR.f(26, 88);
    const base = mixh(0x9c9382, 0x7a7466, TR.next());
    const tone = TR.chance(0.3) ? mixh(base, 0x5e6f72, 0.4) : base;
    ctx.beginPath();
    const k = TR.i(5, 7);
    for (let p = 0; p < k; p++) {
      const a = (p / k) * Math.PI * 2, rr = r * TR.f(0.6, 1.1);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      p ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = css(tone, 0.85); ctx.fill();
    ctx.save(); ctx.clip();
    splat(ctx, x - r * 0.3, y - r * 0.35, r, 0xd9cfb8, 0.28);
    splat(ctx, x + r * 0.3, y + r * 0.4, r, 0x4a4c44, 0.3);
    ctx.restore();
  }
  // horizontal strata hints
  for (let i = 0; i < 22; i++) {
    const y = TR.f(S);
    ctx.strokeStyle = css(TR.chance(0.5) ? 0x4a4a40 : 0xd8cdb2, 0.14);
    ctx.lineWidth = TR.f(2, 6);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + n.sample(x * 0.05, y * 0.05) * 26 - 13);
    ctx.stroke();
  }
  for (let i = 0; i < 200; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(3, 14), 0x76935b, 0.14); // lichen
  for (let i = 0; i < 8; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(100, 240), 0xffd9a0, 0.05);
  return toTex(c);
}

// -- painted grass --
function texGrass() {
  const S = 512, [c, ctx] = mkCanvas(S);
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#5c8f3c'); bg.addColorStop(1, '#4a7431');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
  // big soft variation
  for (let i = 0; i < 26; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(60, 170), TR.chance(0.5) ? 0x77a844 : 0x3f6b2e, 0.22);
  for (let i = 0; i < 10; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(60, 150), 0xa8b84e, 0.14);
  // blade strokes (wrap-drawn twice for tiling)
  const stroke = (x, y) => {
    const h = TR.f(9, 26), lean = TR.spread(6);
    const bright = TR.next();
    ctx.strokeStyle = css(mixh(0x3f6a2c, 0xb9d05e, bright * bright), TR.f(0.35, 0.8));
    ctx.lineWidth = TR.f(1.2, 2.6);
    for (const ox of [0, x < 30 ? S : x > S - 30 ? -S : 0]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.quadraticCurveTo(x + ox + lean * 0.4, y - h * 0.6, x + ox + lean, y - h);
      ctx.stroke();
      if (!ox) break;
    }
  };
  for (let i = 0; i < 2600; i++) stroke(TR.f(S), TR.f(S));
  // tiny flowers
  for (let i = 0; i < 46; i++) {
    const x = TR.f(S), y = TR.f(S);
    ctx.fillStyle = css(TR.chance(0.5) ? 0xffe9f2 : 0xffd2e0, 0.85);
    for (let p = 0; p < 4; p++) ctx.fillRect(x + TR.spread(2.4), y + TR.spread(2.4), 1.8, 1.8);
    ctx.fillStyle = css(0xffcf5e, 0.9); ctx.fillRect(x - 0.6, y - 0.6, 1.4, 1.4);
  }
  for (let i = 0; i < 8; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(100, 200), 0xffe0a0, 0.06);
  return toTex(c);
}

// -- bark --
function texBark() {
  const S = 256, [c, ctx] = mkCanvas(S);
  ctx.fillStyle = '#5b4636'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const x = TR.f(S);
    ctx.strokeStyle = css(mixh(0x3d2e22, 0x7a604a, TR.next()), TR.f(0.4, 0.85));
    ctx.lineWidth = TR.f(2, 8);
    ctx.beginPath();
    ctx.moveTo(x, -8);
    for (let y = 0; y <= S + 8; y += 22) ctx.lineTo(x + TR.spread(7), y);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(4, 16), 0x8a9a5a, 0.2); // moss
  for (let i = 0; i < 24; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(6, 22), 0x2c211a, 0.3);
  splat(ctx, S * 0.3, S * 0.3, S * 0.5, 0xffd9a0, 0.08);
  return toTex(c);
}

// -- canopy speckle (drawn neutral-bright, tinted by material+vertex color) --
function texCanopy(hiA, hiB, gap) {
  const S = 256, [c, ctx] = mkCanvas(S);
  ctx.fillStyle = css(gap); ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 240; i++) splat(ctx, TR.f(S), TR.f(S), TR.f(6, 26), mixh(hiA, gap, TR.f(0.5)), 0.5);
  for (let i = 0; i < 900; i++) {
    const x = TR.f(S), y = TR.f(S), r = TR.f(2.2, 7);
    ctx.fillStyle = css(mixh(hiA, hiB, TR.next()), TR.f(0.5, 0.95));
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = css(0xffffff, 0.22);
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.45, 0, 7); ctx.fill();
  }
  return toTex(c);
}

// -- banner cloth with team emblem --
function emblemPath(ctx, S, team) {
  ctx.save();
  ctx.translate(S / 2, S / 2);
  if (team === 'blue') { // dawn blade: sun disc + upward sword
    ctx.fillStyle = css(0xffd98c, 0.95);
    ctx.beginPath(); ctx.arc(0, -S * 0.02, S * 0.16, 0, 7); ctx.fill();
    ctx.strokeStyle = css(0xffd98c, 0.9); ctx.lineWidth = S * 0.028;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * S * 0.2, -S * 0.02 + Math.sin(a) * S * 0.2);
      ctx.lineTo(Math.cos(a) * S * 0.27, -S * 0.02 + Math.sin(a) * S * 0.27);
      ctx.stroke();
    }
    ctx.fillStyle = css(0xf4f8ff, 0.95);
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.3); ctx.lineTo(S * 0.035, -S * 0.05); ctx.lineTo(S * 0.035, S * 0.22);
    ctx.lineTo(0, S * 0.3); ctx.lineTo(-S * 0.035, S * 0.22); ctx.lineTo(-S * 0.035, -S * 0.05);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(-S * 0.1, S * 0.02, S * 0.2, S * 0.03);
  } else { // ember horns + axe
    ctx.fillStyle = css(0xffb36a, 0.95);
    ctx.beginPath(); ctx.arc(0, 0, S * 0.14, 0, 7); ctx.fill();
    ctx.strokeStyle = css(0xffb36a, 0.92); ctx.lineWidth = S * 0.05;
    ctx.beginPath(); ctx.arc(-S * 0.13, -S * 0.05, S * 0.17, Math.PI * 0.9, Math.PI * 1.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(S * 0.13, -S * 0.05, S * 0.17, Math.PI * 1.3, Math.PI * 2.1); ctx.stroke();
    ctx.fillStyle = css(0x2b1712, 0.9);
    ctx.beginPath(); ctx.arc(0, 0, S * 0.07, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function texCloth(team) {
  const S = 256, H = 384, [c, ctx] = mkCanvas(S, H);
  const base = team === 'blue' ? 0x27508e : 0x8e2b22;
  const dark = team === 'blue' ? 0x16305c : 0x571812;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(mixh(base, 0xffffff, 0.12)));
  g.addColorStop(0.65, css(base));
  g.addColorStop(1, css(dark));
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, H);
  // weave
  for (let y = 0; y < H; y += 3) {
    ctx.fillStyle = css(0x000000, 0.05 + 0.03 * Math.sin(y));
    ctx.fillRect(0, y, S, 1);
  }
  for (let i = 0; i < 40; i++) splat(ctx, TR.f(S), TR.f(H), TR.f(20, 70), TR.chance(0.5) ? 0xffffff : 0x000000, 0.06);
  // borders + filigree
  ctx.strokeStyle = css(0xffcf6e, 0.9); ctx.lineWidth = 7;
  ctx.strokeRect(9, 9, S - 18, H - 18);
  ctx.lineWidth = 2; ctx.strokeStyle = css(0xffe9b0, 0.7);
  ctx.strokeRect(17, 17, S - 34, H - 34);
  ctx.save(); ctx.translate(0, -H * 0.12);
  emblemPath(ctx, S, team);
  ctx.restore();
  // bottom V cut shading + tassel dots
  ctx.fillStyle = css(0xffcf6e, 0.9);
  for (let i = 0; i < 5; i++) ctx.fillRect(20 + i * ((S - 40) / 4) - 3, H - 22, 6, 12);
  splat(ctx, S / 2, H * 0.2, S * 0.6, 0xffffff, 0.1);
  splat(ctx, S / 2, H * 0.9, S * 0.7, 0x000000, 0.22);
  return toTex(c);
}

// -- round shield emblem texture for HUD portrait --
function texPortrait() {
  const S = 128, [c, ctx] = mkCanvas(S);
  const g = ctx.createRadialGradient(S * 0.4, S * 0.32, 6, S / 2, S / 2, S * 0.7);
  g.addColorStop(0, '#4d6ea8'); g.addColorStop(0.55, '#243b66'); g.addColorStop(1, '#0d1526');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  // Sera stylized bust: hair + face silhouette
  ctx.fillStyle = '#f2cba6'; // face
  ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.52, S * 0.17, S * 0.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffe7b8'; // hair
  ctx.beginPath();
  ctx.ellipse(S * 0.5, S * 0.4, S * 0.21, S * 0.17, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); ctx.ellipse(S * 0.66, S * 0.62, S * 0.07, S * 0.22, -0.35, 0, 7); ctx.fill();
  // eyes
  ctx.fillStyle = '#274a5c';
  ctx.beginPath(); ctx.ellipse(S * 0.44, S * 0.53, 3.4, 4.6, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(S * 0.57, S * 0.53, 3.4, 4.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(S * 0.435, S * 0.505, 1.6, 1.6); ctx.fillRect(S * 0.565, S * 0.505, 1.6, 1.6);
  ctx.strokeStyle = 'rgba(140,60,40,0.6)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(S * 0.5, S * 0.62, 3.6, 0.3, Math.PI - 0.3); ctx.stroke();
  // armor collar
  ctx.fillStyle = '#c9a24e';
  ctx.beginPath(); ctx.moveTo(S * 0.22, S); ctx.lineTo(S * 0.5, S * 0.74); ctx.lineTo(S * 0.78, S); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#31548c';
  ctx.beginPath(); ctx.moveTo(S * 0.3, S); ctx.lineTo(S * 0.5, S * 0.82); ctx.lineTo(S * 0.7, S); ctx.closePath(); ctx.fill();
  splat(ctx, S * 0.35, S * 0.3, S * 0.5, 0xffe9c0, 0.25);
  return c.toDataURL();
}

// -- faces --
function texFace(kind) {
  // 512 rather than 128: the head fills ~200 screen px in the close-up preset,
  // so a 128px decal shows visibly soft eyes. `k` scales the hand-placed pixel
  // coordinates below, which were authored against a 128px canvas.
  const S = 512, k = S / 128, [c, ctx] = mkCanvas(S);
  ctx.clearRect(0, 0, S, S);
  const skin = kind === 'sera' ? 0xf2cba6 : 0xc98a5e;
  // soft skin oval fades out (decal patch)
  splat(ctx, S / 2, S / 2, S * 0.52, skin, 1);
  splat(ctx, S / 2, S / 2, S * 0.5, skin, 1);
  if (kind === 'sera') {
    // restrained blush — heavy blush is what pushes a stylized face from
    // "heroic" toward "mascot"
    splat(ctx, S * 0.3, S * 0.63, 12 * k, 0xff9d88, 0.2);
    splat(ctx, S * 0.7, S * 0.63, 12 * k, 0xff9d88, 0.2);
    for (const sx of [-1, 1]) {
      const ex = S / 2 + sx * S * 0.16, ey = S * 0.48;
      // eye socket shading gives the brow ridge something to sit on
      splat(ctx, ex, ey - 1.5 * k, 13 * k, 0xb08064, 0.22);
      // almond eye: narrower than tall-round, outer corner lifted
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(sx * -0.09);
      ctx.fillStyle = '#fffaf4';
      ctx.beginPath(); ctx.ellipse(0, 0, 10.2 * k, 6.4 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2d6474';
      ctx.beginPath(); ctx.ellipse(0, 0.5 * k, 6.0 * k, 6.0 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#17506b';
      ctx.beginPath(); ctx.ellipse(0, 2.0 * k, 5.2 * k, 4.0 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#08202b';
      ctx.beginPath(); ctx.ellipse(0, 0.8 * k, 2.9 * k, 3.2 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.beginPath(); ctx.arc(-2.4 * k, -2.2 * k, 2.1 * k, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(180,235,255,0.5)';
      ctx.beginPath(); ctx.arc(1.9 * k, 2.3 * k, 1.3 * k, 0, 7); ctx.fill();
      // upper lash line, thickest at the outer corner
      ctx.strokeStyle = '#3b2418'; ctx.lineWidth = 2.6 * k; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-10.2 * k, 0.4 * k);
      ctx.quadraticCurveTo(0, -8.2 * k, 10.4 * k, -1.4 * k);
      ctx.stroke();
      ctx.lineWidth = 3.6 * k;
      ctx.beginPath(); ctx.moveTo(7.2 * k, -3.4 * k); ctx.lineTo(11.6 * k, -2.0 * k); ctx.stroke();
      ctx.restore();
      // brow: angled down toward the nose for a determined, not doe-eyed, read
      ctx.strokeStyle = '#6d4a2f'; ctx.lineWidth = 3.6 * k; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - sx * 9.5 * k, ey - 12.0 * k);
      ctx.quadraticCurveTo(ex + sx * 1 * k, ey - 16.4 * k, ex + sx * 10 * k, ey - 13.6 * k);
      ctx.stroke();
    }
    // nose: a shadow plane and nostril hint, no outline
    ctx.fillStyle = 'rgba(150,96,66,0.30)';
    ctx.beginPath(); ctx.ellipse(S / 2 + 2 * k, S * 0.578, 2.6 * k, 4.6 * k, 0.2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(110,62,42,0.34)';
    ctx.beginPath(); ctx.ellipse(S / 2, S * 0.596, 1.6 * k, 1.1 * k, 0, 0, 7); ctx.fill();
    // mouth: a confident set, not a wide smile
    ctx.strokeStyle = 'rgba(150,70,55,0.9)'; ctx.lineWidth = 2.3 * k; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(S / 2 - 5.4 * k, S * 0.663);
    ctx.quadraticCurveTo(S / 2, S * 0.676, S / 2 + 5.4 * k, S * 0.661);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,190,0.35)';
    ctx.beginPath(); ctx.ellipse(S / 2, S * 0.652, 4.4 * k, 1.5 * k, 0, 0, 7); ctx.fill();
    // chin/jaw shading so the head reads as a volume, not a painted ball
    ctx.fillStyle = 'rgba(150,96,66,0.16)';
    ctx.beginPath(); ctx.ellipse(S / 2, S * 0.735, 9 * k, 4 * k, 0, 0, 7); ctx.fill();
  } else {
    // Kargath: glowing ember eyes, warpaint, scowl
    for (const sx of [-1, 1]) {
      const ex = S / 2 + sx * S * 0.16, ey = S * 0.46;
      splat(ctx, ex, ey, 11 * k, 0xff5a22, 0.85);
      ctx.fillStyle = '#ffd9a0';
      ctx.beginPath(); ctx.ellipse(ex, ey, 5 * k, 3.2 * k, sx * 0.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff4dc';
      ctx.beginPath(); ctx.ellipse(ex - sx * 0.8 * k, ey, 2.4 * k, 1.6 * k, sx * 0.2, 0, 7); ctx.fill();
      // heavy angled brow — the whole scowl lives here
      ctx.strokeStyle = '#3a1d12'; ctx.lineWidth = 4.2 * k; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 9 * k, ey - 7 * k + sx * 2.4 * k);
      ctx.lineTo(ex + 9 * k, ey - 9.5 * k - sx * 2.4 * k);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(60,20,14,0.75)'; ctx.lineWidth = 3.2 * k;
    ctx.beginPath(); ctx.arc(S / 2, S * 0.72, 7.5 * k, Math.PI + 0.5, -0.5); ctx.stroke();
    ctx.fillStyle = 'rgba(140,30,20,0.5)';
    ctx.fillRect(S * 0.44, S * 0.58, 3 * k, 16 * k);
    ctx.fillRect(S * 0.53, S * 0.58, 3 * k, 16 * k);
    ctx.strokeStyle = 'rgba(70,30,20,0.8)'; ctx.lineWidth = 2.6 * k;
    ctx.beginPath(); ctx.moveTo(S * 0.68, S * 0.3); ctx.lineTo(S * 0.62, S * 0.6); ctx.stroke(); // scar
  }
  return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
}

// -- soft radial dot sprite --
function texDot() {
  const S = 64, [c, ctx] = mkCanvas(S);
  splat(ctx, S / 2, S / 2, S / 2, 0xffffff, 1);
  splat(ctx, S / 2, S / 2, S / 4, 0xffffff, 1);
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- 4-point star spark --
function texSpark() {
  const S = 64, [c, ctx] = mkCanvas(S);
  const arm = (a, len, w) => {
    ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -w); ctx.lineTo(len, 0); ctx.lineTo(0, w); ctx.closePath(); ctx.fill();
    ctx.restore();
  };
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2, 30, 4.5);
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2 + Math.PI / 4, 16, 2.5);
  splat(ctx, S / 2, S / 2, 10, 0xffffff, 1);
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- petal --
function texPetal() {
  const S = 64, [c, ctx] = mkCanvas(S);
  ctx.translate(S / 2, S / 2); ctx.rotate(0.6);
  const g = ctx.createLinearGradient(-14, -18, 10, 16);
  g.addColorStop(0, '#ffe3ee'); g.addColorStop(0.55, '#ffb1c9'); g.addColorStop(1, '#e87ba4');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -19);
  ctx.bezierCurveTo(13, -14, 13, 8, 2, 17);
  ctx.bezierCurveTo(-3, 12, -13, 2, -8, -12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.ellipse(-2, -8, 4, 7, 0.4, 0, 7); ctx.fill();
  return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
}
// -- soft smoke puff --
function texSmoke() {
  const S = 128, [c, ctx] = mkCanvas(S);
  for (let i = 0; i < 26; i++) {
    const a = TR.f(Math.PI * 2), r = TR.f(0, 34);
    splat(ctx, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, TR.f(12, 30), 0xffffff, 0.16);
  }
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- annulus ring (shockwave) --
function texRing() {
  const S = 256, [c, ctx] = mkCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.86, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- crater cracks decal --
function texCrack() {
  const S = 512, [c, ctx] = mkCanvas(S);
  const cx = S / 2, cy = S / 2;
  splat(ctx, cx, cy, S * 0.3, 0x140d06, 0.85);
  splat(ctx, cx, cy, S * 0.16, 0x000000, 0.9);
  ctx.strokeStyle = 'rgba(12,8,4,0.9)'; ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + TR.spread(0.3);
    let a = a0, r = S * 0.1, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.lineWidth = TR.f(5, 10);
    ctx.beginPath(); ctx.moveTo(x, y);
    const len = TR.f(0.3, 0.46) * S;
    for (let s = 0; s < 5; s++) {
      r += len / 5; a += TR.spread(0.25);
      x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
      ctx.lineTo(x, y);
      ctx.lineWidth *= 0.72;
    }
    ctx.stroke();
    if (TR.chance(0.7)) { // branch
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + TR.spread(40), y + TR.spread(40)); ctx.stroke();
    }
  }
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- crescent slash arc --
function texSlash() {
  const S = 256, [c, ctx] = mkCanvas(S);
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.36, Math.PI * 1.16, Math.PI * 1.84);
    ctx.arc(0, -S * 0.1, S * 0.27, Math.PI * 1.8, Math.PI * 1.2, true);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${0.32 + i * 0.3})`;
    ctx.fill();
    ctx.scale(0.88, 0.82);
  }
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- flame teardrop with halo (for instanced torch quads) --
function texFlame() {
  const S = 128, [c, ctx] = mkCanvas(S);
  splat(ctx, S / 2, S * 0.62, S * 0.42, 0xff7a22, 0.5); // halo
  const flame = (w, h, col, a) => {
    ctx.fillStyle = css(col, a);
    ctx.beginPath();
    ctx.moveTo(S / 2, S * 0.62 - h);
    ctx.bezierCurveTo(S / 2 + w, S * 0.62 - h * 0.45, S / 2 + w * 0.8, S * 0.62 + h * 0.28, S / 2, S * 0.62 + h * 0.3);
    ctx.bezierCurveTo(S / 2 - w * 0.8, S * 0.62 + h * 0.28, S / 2 - w, S * 0.62 - h * 0.45, S / 2, S * 0.62 - h);
    ctx.fill();
  };
  flame(20, 42, 0xff6a1c, 0.95);
  flame(13, 30, 0xffb13d, 1);
  flame(7, 17, 0xfff3c8, 1);
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- vertical light shaft gradient --
function texShaft() {
  const [c, ctx] = mkCanvas(64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,236,190,0.85)');
  g.addColorStop(0.7, 'rgba(255,220,160,0.25)');
  g.addColorStop(1, 'rgba(255,210,150,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.25, 'rgba(0,0,0,0)');
  h.addColorStop(0.75, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 256);
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}
// -- painted cloud sprite --
function texCloud() {
  const S = 256, [c, ctx] = mkCanvas(S, S / 2);
  const puff = (x, y, r) => {
    splat(ctx, x, y, r, 0xfff4e0, 0.5);
    splat(ctx, x - r * 0.2, y - r * 0.25, r * 0.7, 0xffffff, 0.55);
    splat(ctx, x + r * 0.25, y + r * 0.3, r * 0.6, 0xe8b98f, 0.3);
  };
  for (let i = 0; i < 12; i++) puff(S * 0.5 + TR.spread(S * 0.3), S * 0.28 + TR.spread(10), TR.f(18, 40));
  for (let i = 0; i < 8; i++) puff(S * 0.5 + TR.spread(S * 0.36), S * 0.33 + TR.f(6), TR.f(10, 22));
  return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
}
// -- waterfall streaks --
function texFalls() {
  const S = 256, [c, ctx] = mkCanvas(S);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = TR.f(S), w = TR.f(3, 14), l = TR.f(60, 200), y = TR.f(S);
    const g = ctx.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${TR.f(0.25, 0.7)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y, w, l);
    if (x < 20) ctx.fillRect(x - w / 2 + S, y, w, l);
    if (x > S - 20) ctx.fillRect(x - w / 2 - S, y, w, l);
  }
  return toTex(c, { srgb: false });
}
// -- rune ring decal (glyphs around a circle) --
function texRuneRing() {
  const S = 512, [c, ctx] = mkCanvas(S);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.42, 0, 7); ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.355, 0, 7); ctx.stroke();
  const glyph = (x, y, s, a) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    const k = TR.i(3, 5);
    let px = -s / 2, py = TR.spread(s / 2);
    ctx.moveTo(px, py);
    for (let i = 0; i < k; i++) { px += s / k; py = TR.spread(s * 0.55); ctx.lineTo(px, py); }
    ctx.stroke();
    if (TR.chance(0.6)) { ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * TR.f(1, 2)); ctx.stroke(); }
    ctx.restore();
  };
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    glyph(cx + Math.cos(a) * S * 0.388, cy + Math.sin(a) * S * 0.388, 22, a + Math.PI / 2);
  }
  // center sigil
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.1, 0, 7); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * S * 0.1, cy + Math.sin(a) * S * 0.1);
    ctx.lineTo(cx + Math.cos(a + 2.09) * S * 0.1, cy + Math.sin(a + 2.09) * S * 0.1);
    ctx.stroke();
  }
  return toTex(c, { srgb: false, wrap: THREE.ClampToEdgeWrapping });
}

// ============================================================ SHADER PATCH ==
// Accumulating onBeforeCompile patch system so multiple effects can stack.
export function patchMaterial(mat, patch) {
  if (!mat.userData.patches) {
    mat.userData.patches = [];
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      for (const p of mat.userData.patches) p(shader);
    };
    mat.customProgramCacheKey = () => mat.userData.patchKey || '';
    mat.userData.patchKey = '';
  }
  mat.userData.patches.push(patch.apply);
  mat.userData.patchKey += '|' + patch.id;
  return mat;
}

// Fresnel rim glow injected into standard material emissive term.
export function addRim(mat, { color = 0xbfe8ff, power = 2.6, strength = 0.6 } = {}) {
  const col = new THREE.Color(color);
  return patchMaterial(mat, {
    id: `rim${color.toString(16)}${power}${strength}`,
    apply(shader) {
      shader.uniforms.uRimColor = { value: col };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), ${power.toFixed(2)});
            totalEmissiveRadiance += uRimColor * (rimF * ${strength.toFixed(3)});
          }`)
        .replace('void main() {', 'uniform vec3 uRimColor;\nvoid main() {');
    },
  });
}

// Fake subsurface scattering for foliage. Without it a backlit blossom crown
// only gets cool ambient and reads dark plum; real petals/leaves transmit the
// sun and glow warm from behind. `wrap` also lifts the shaded side so canopies
// never go blue-purple in shadow.
export function addTranslucency(mat, {
  color = 0xffb8cf, power = 2.6, strength = 0.9, wrap = 0.22, wrapColor = null,
} = {}) {
  const col = new THREE.Color(color);
  const wcol = new THREE.Color(wrapColor ?? color);
  return patchMaterial(mat, {
    id: `sss${color.toString(16)}${power}${strength}${wrap}`,
    apply(shader) {
      shader.uniforms.uSssColor = { value: col };
      shader.uniforms.uWrapColor = { value: wcol };
      shader.uniforms.uSunDir = uSunDir;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // sun direction in view space (viewMatrix is provided by three.js)
            vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 V = normalize(vViewPosition);           // fragment → camera
            vec3 N = normalize(normal);
            // light travelling toward the camera through the surface
            float back = pow(saturate(dot(-sunV, V)), ${power.toFixed(2)});
            // strongest where the surface faces away from the sun
            float away = saturate(0.5 - dot(N, sunV) * 0.5);
            totalEmissiveRadiance += uSssColor * (back * away * ${strength.toFixed(3)});
            // soft warm wrap so shaded foliage keeps its hue
            totalEmissiveRadiance += uWrapColor * (away * ${wrap.toFixed(3)});
          }`)
        .replace('void main() {', 'uniform vec3 uSssColor;\nuniform vec3 uWrapColor;\nuniform vec3 uSunDir;\nvoid main() {');
    },
  });
}

// Wind sway using per-vertex aSway attribute (geometry must provide it).
// Merged world-space geometry ⇒ `position` is already world space.
export function addWindSway(mat, { amp = 0.14, freq = 1.1 } = {}) {
  return patchMaterial(mat, {
    id: `wind${amp}${freq}`,
    apply(shader) {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aSway;\nuniform float uTime;\nvoid main() {')
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float wp = dot(position.xz, vec2(0.11, 0.147)) + uTime * ${freq.toFixed(2)};
            float sw = max(aSway, 0.0);
            transformed.x += (sin(wp) + sin(wp * 1.73 + 1.3) * 0.5) * ${amp.toFixed(3)} * sw;
            transformed.z += cos(wp * 0.83 + 2.1) * ${(amp * 0.7).toFixed(3)} * sw;
            transformed.y += sin(uTime * 0.8 + position.x * 0.35 + position.z) * min(aSway, 0.0) * -0.35;
          }`);
    },
  });
}

// Emissive pulse (crystals, runes).
export function addPulse(mat, { speed = 2.2, min = 0.82, max = 1.25 } = {}) {
  return patchMaterial(mat, {
    id: `pulse${speed}`,
    apply(shader) {
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uTime;\nvoid main() {')
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance *= mix(${min.toFixed(2)}, ${max.toFixed(2)},
            0.5 + 0.5 * sin(uTime * ${speed.toFixed(2)} + vViewPosition.x * 0.2));`);
    },
  });
}

// =============================================================== MATERIALS ==
function buildMaterials() {
  const T = tex;

  T.stone.repeat.set(1, 1);
  mats.lane = new THREE.MeshStandardMaterial({
    map: T.stone, roughness: 0.92, metalness: 0.02, vertexColors: true,
  });
  mats.grass = new THREE.MeshStandardMaterial({
    map: T.grassT, roughness: 1, metalness: 0, vertexColors: true,
  });
  mats.cliff = new THREE.MeshStandardMaterial({
    map: T.rock, roughness: 0.95, metalness: 0.02, vertexColors: true,
  });
  mats.stoneProp = new THREE.MeshStandardMaterial({
    map: T.rock, roughness: 0.9, metalness: 0.03, vertexColors: true,
  });
  addRim(mats.stoneProp, { color: 0xffd9a0, power: 3.4, strength: 0.12 });
  mats.trim = new THREE.MeshStandardMaterial({
    color: 0xf7c052, roughness: 0.32, metalness: 0.85, vertexColors: true,
    emissive: 0x2a1503, emissiveIntensity: 0.4,
  });
  addRim(mats.trim, { color: 0xffe9b0, power: 3.0, strength: 0.35 });
  mats.bark = new THREE.MeshStandardMaterial({ map: T.bark, roughness: 0.95, vertexColors: true });
  mats.canopyPink = new THREE.MeshStandardMaterial({
    map: T.canopyPink, roughness: 0.9, vertexColors: true,
  });
  addWindSway(mats.canopyPink, { amp: 0.16, freq: 1.2 });
  addRim(mats.canopyPink, { color: 0xffdce8, power: 2.4, strength: 0.28 });
  addTranslucency(mats.canopyPink, {
    color: 0xff9ec4, power: 3.0, strength: 0.78, wrap: 0.085, wrapColor: 0xffc0a2,
  });
  mats.canopyGreen = new THREE.MeshStandardMaterial({
    map: T.canopyGreen, roughness: 0.95, vertexColors: true,
  });
  addWindSway(mats.canopyGreen, { amp: 0.12, freq: 1.35 });
  addTranslucency(mats.canopyGreen, {
    color: 0xa8e05a, power: 3.0, strength: 0.62, wrap: 0.06, wrapColor: 0xcbbe78,
  });
  mats.stoneFloat = new THREE.MeshStandardMaterial({
    map: T.rock, roughness: 0.9, metalness: 0.03, vertexColors: true,
  });
  addWindSway(mats.stoneFloat, { amp: 0.0, freq: 0.8 });
  mats.crystal = new THREE.MeshStandardMaterial({
    color: 0x1d6a80, emissive: 0x2fc8e8, emissiveIntensity: 0.95,
    roughness: 0.18, metalness: 0.1, vertexColors: true,
  });
  addRim(mats.crystal, { color: 0xa8f2ff, power: 2.0, strength: 0.75 });
  addPulse(mats.crystal, { speed: 1.8, min: 0.8, max: 1.3 });
  mats.crystalRed = new THREE.MeshStandardMaterial({
    color: 0x6e1c14, emissive: 0xd83518, emissiveIntensity: 0.7,
    roughness: 0.18, metalness: 0.1, vertexColors: true,
  });
  addRim(mats.crystalRed, { color: 0xffb98a, power: 2.0, strength: 0.65 });
  addPulse(mats.crystalRed, { speed: 2.1, min: 0.8, max: 1.3 });
  mats.pool = new THREE.MeshStandardMaterial({
    color: 0x14555e, emissive: 0x2fc8e8, emissiveIntensity: 0.4,
    roughness: 0.2, metalness: 0, vertexColors: true,
  });
  mats.rune = new THREE.MeshBasicMaterial({
    map: T.runeRing, color: 0x6fe8ff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  mats.clothBlue = new THREE.MeshStandardMaterial({
    map: T.clothBlue, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true,
  });
  addWindSway(mats.clothBlue, { amp: 0.2, freq: 1.7 });
  mats.clothRed = new THREE.MeshStandardMaterial({
    map: T.clothRed, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true,
  });
  addWindSway(mats.clothRed, { amp: 0.2, freq: 1.55 });
  mats.wood = new THREE.MeshStandardMaterial({ map: T.bark, color: 0xa8845c, roughness: 0.9, vertexColors: true });
}

export function initAssets() {
  tex.noise = texNoise();
  tex.stone = texStone();
  tex.rock = texRock();
  tex.grassT = texGrass();
  tex.bark = texBark();
  tex.canopyPink = texCanopy(0xffd9e4, 0xffa9c4, 0xc9748e);
  tex.canopyGreen = texCanopy(0x9cc45e, 0x6da33f, 0x39632c);
  tex.clothBlue = texCloth('blue');
  tex.clothRed = texCloth('red');
  tex.faceSera = texFace('sera');
  tex.faceKargath = texFace('kargath');
  tex.dot = texDot();
  tex.spark = texSpark();
  tex.petal = texPetal();
  tex.smoke = texSmoke();
  tex.ring = texRing();
  tex.crack = texCrack();
  tex.slash = texSlash();
  tex.flame = texFlame();
  tex.shaft = texShaft();
  tex.cloud = texCloud();
  tex.falls = texFalls();
  tex.runeRing = texRuneRing();
  tex.portraitURL = texPortrait();
  buildMaterials();
}
