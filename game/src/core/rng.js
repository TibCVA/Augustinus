// Seeded RNG (mulberry32) + URL params. All procedural generation flows from here
// so ?seed=N reproduces the exact same world.

export const urlParams = new URLSearchParams(location.search);

export const SEED = (() => {
  const s = parseInt(urlParams.get('seed'), 10);
  return Number.isFinite(s) ? s : 1337;
})();

export const SHOT_MODE = urlParams.get('shot') === '1';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rich helper wrapper around a raw generator.
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    // float in [a,b) — f() → [0,1), f(a) → [0,a), f(a,b) → [a,b)
    f(a = 1, b) { return b === undefined ? next() * a : a + next() * (b - a); },
    i(a, b) { return a + Math.floor(next() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    sign() { return next() < 0.5 ? -1 : 1; },
    chance(p) { return next() < p; },
    // gaussian-ish (sum of 2)
    spread(amt = 1) { return (next() + next() - 1) * amt; },
  };
}

// World-generation stream (art). Sim uses its own stream so gameplay doesn't
// perturb world gen determinism.
export const RNG = makeRng(SEED ^ 0x9e3779b9);
export const simSeed = SEED ^ 0x51ab3c;

// Small stateless hash for shader-ish CPU needs.
export function hash2(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 972663749);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
