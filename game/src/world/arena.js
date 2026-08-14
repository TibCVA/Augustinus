// Arena layout: terrain, lane, cliffs, bases + collision map (walkable mask).
// Places all static props via props.js builders and merges them into few draws.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { mats, PAL, cpuNoise } from '../core/assets.js';
import {
  Bucket, mat4, addColumn, addRock, addTree, addBush, addCrystals, addStatue,
  addTorch, addBanner, addBridge, addGateRuins, addFountain, addRuneDecal,
  buildNexusPlatform, makeFlames, makeGrassBlades, fixNormals,
} from './props.js';

export const A = {
  HALF_X: 57,          // playable x extent
  EDGE_Z: 17,          // ground half width
  LANE_HALF: 6.2,
  RIVER_HALF: 3.6,     // river band |x| < this
  BRIDGE_HALF_Z: 4.6,
  BRIDGE_HALF_X: 6.4,
  BASE_X: 46, BASE_R: 10.5,
  FOUNTAIN_X: 52.5,
  TOWER_OUTER_X: 18, TOWER_INNER_X: 33,
  NEXUS_X: 46.5,
  SPAWN_X: 41,
  WALK_Z: 10.4,
};

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep; // (x, min, max)

// ------------------------------------------------------------------ heights --
function plateauH(x, z) {
  const d = Math.hypot(Math.abs(x) - A.BASE_X, z);
  return 0.55 * (1 - smooth(d, A.BASE_R - 2.5, A.BASE_R + 1.5));
}
function bridgeH(x) {
  if (Math.abs(x) >= A.BRIDGE_HALF_X) return 0;
  return Math.cos((x / A.BRIDGE_HALF_X) * Math.PI * 0.5) * 0.8;
}
function grassNoise(x, z) {
  return (cpuNoise.fbm(x * 0.14 + 31, z * 0.14 + 11, 3) - 0.5) * 0.55;
}
// walkable surface height (bridge counts, riverbed does not)
export function groundHeight(x, z) {
  let h = plateauH(x, z);
  const inRiver = Math.abs(x) < A.RIVER_HALF + 1.6;
  if (Math.abs(x) < A.BRIDGE_HALF_X && Math.abs(z) < A.BRIDGE_HALF_Z + 1.6) {
    h += bridgeH(x) * (1 - smooth(Math.abs(z), A.BRIDGE_HALF_Z - 0.4, A.BRIDGE_HALF_Z + 1.4));
  } else if (inRiver) {
    return -1.35; // riverbed (not walkable anyway)
  }
  // grass undulation fades out on lane + bridge
  const laneF = smooth(Math.abs(z), A.LANE_HALF - 1.6, A.LANE_HALF + 1.2);
  const riverF = 1 - smooth(Math.abs(x), A.RIVER_HALF + 1.2, A.RIVER_HALF + 3.2);
  h += grassNoise(x, z) * laneF * (1 - riverF) * (1 - plateauH(x, z));
  return h;
}
// visual terrain height (river carved)
function terrainHeight(x, z) {
  let h = plateauH(x, z);
  const riverT = 1 - smooth(Math.abs(x), A.RIVER_HALF - 1.4, A.RIVER_HALF + 2.4);
  h -= riverT * 2.0;
  const laneF = smooth(Math.abs(z), A.LANE_HALF - 1.6, A.LANE_HALF + 1.2);
  h += grassNoise(x, z) * laneF * (1 - riverT);
  return h;
}

// superellipse arena footprint boundary radius for direction (dx,dz)
function boundaryScale(dx, dz) {
  const n = 5;
  const q = Math.pow(Math.abs(dx / (A.HALF_X + 1.5)) ** n + Math.abs(dz / (A.EDGE_Z + 0.5)) ** n, 1 / n);
  return q; // >1 → outside
}

// ---------------------------------------------------------------- collision --
export function isWalkable(x, z) {
  if (Math.abs(z) > A.WALK_Z) return false;
  if (Math.abs(x) > A.HALF_X - 1.2) return false;
  // river only crossable on the bridge
  if (Math.abs(x) < A.RIVER_HALF + 0.4 && Math.abs(z) > A.BRIDGE_HALF_Z - 0.15) return false;
  // beyond lane end, must be on base plateau or lane corridor
  if (Math.abs(x) > 39) {
    const d = Math.hypot(Math.abs(x) - A.BASE_X, z);
    if (d > A.BASE_R - 0.4 && Math.abs(z) > A.LANE_HALF) return false;
    if (Math.abs(x) > A.FOUNTAIN_X + 2.6) return false;
  }
  return true;
}

export function buildArena(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const blockers = [];   // {x, z, r}
  const flamePoints = [];
  const aoSpots = [];    // ground AO bakes {x, z, r, k}

  const addBlocker = (x, z, r) => { const o = { x, z, r }; blockers.push(o); return o; };
  const removeBlocker = (o) => { const i = blockers.indexOf(o); if (i >= 0) blockers.splice(i, 1); };

  // ================================================================= PROPS ==
  const B = new Bucket();

  // bridge rails + underside arches (deck comes from the lane drape)
  addBridge(B, (x) => bridgeH(x) + 0.02, { halfW: A.BRIDGE_HALF_Z + 0.4, halfL: A.BRIDGE_HALF_X });
  addBlocker(0, A.BRIDGE_HALF_Z + 0.55, 1.0);
  addBlocker(0, -A.BRIDGE_HALF_Z - 0.55, 1.0);
  for (const sx of [-1, 1]) {
    addBlocker(sx * (A.BRIDGE_HALF_X - 0.6), A.BRIDGE_HALF_Z + 0.2, 0.7);
    addBlocker(sx * (A.BRIDGE_HALF_X - 0.6), -A.BRIDGE_HALF_Z - 0.2, 0.7);
  }

  for (const side of [-1, 1]) {
    const team = side < 0 ? 'blue' : 'red';
    const S = (x, z = 0) => [side * x, side < 0 ? z : -z]; // mirror flip

    // fountain shrine + nexus platform
    for (const bl of addFountain(B, side * A.FOUNTAIN_X, team)) blockers.push(bl);
    buildNexusPlatform(B, side * A.NEXUS_X, team);
    aoSpots.push({ x: side * A.NEXUS_X, z: 0, r: 6.4, k: 0.5 });

    // gate ruins at base entry
    for (const bl of addGateRuins(B, side * 36.5)) blockers.push(bl);

    // banners marching down the lane
    for (const [bx, bz] of [[40.5, 5.4], [40.5, -5.4], [26.5, 6.0], [26.5, -6.0], [49, 4.6], [49, -4.6]]) {
      blockers.push(addBanner(B, side * bx, bz, team, { ry: side < 0 ? Math.PI / 2 : -Math.PI / 2 }));
    }
    // torches along lane edges
    for (const [tx, tz] of [[13.5, 6.9], [13.5, -6.9], [22.5, 7.1], [22.5, -7.1], [30, 6.9], [30, -6.9], [43.5, 8.2], [43.5, -8.2]]) {
      const t = addTorch(B, side * tx, tz);
      flamePoints.push(t.flame);
      blockers.push(t.blocker);
      aoSpots.push({ x: side * tx, z: tz, r: 0.8, k: 0.5 });
    }
    // broken columns near lane
    blockers.push(addColumn(B, side * 10.5, 7.6, { broken: true, ry: RNG.f(3) }));
    blockers.push(addColumn(B, side * 10.5, -7.6, { broken: false, h: 3.2 }));
    blockers.push(addColumn(B, side * 24.5, 8.1, { broken: false, h: 3.6 }));
    blockers.push(addColumn(B, side * 24.5, -8.1, { broken: true }));
    // statues guarding the bridge + base gate
    blockers.push(addStatue(B, side * 8.6, 5.6, { ry: side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, s: 1.05 }));
    blockers.push(addStatue(B, side * 8.6, -5.6, { ry: side < 0 ? Math.PI * 0.25 : -Math.PI * 0.75, s: 1.05, broken: side > 0 }));

    // rail dressing: trees / crystals / rocks / bushes
    const treeXs = [6.5, 19, 30.5, 42.5];
    for (const tx of treeXs) {
      for (const sz of [-1, 1]) {
        if (RNG.chance(0.82)) {
          const jx = side * tx + RNG.spread(1.6), jz = sz * RNG.f(12.2, 14.6);
          addTree(B, jx, jz, RNG.f(0.95, 1.45), { pink: true });
          aoSpots.push({ x: jx, z: jz, r: 3.2, k: 0.35 });
        }
      }
    }
    addTree(B, side * 44.5, 9.2, RNG.f(1.1, 1.3), { pink: true });
    addTree(B, side * 44.5, -9.2, RNG.f(1.1, 1.3), { pink: true });
    aoSpots.push({ x: side * 44.5, z: 9.2, r: 3, k: 0.35 }, { x: side * 44.5, z: -9.2, r: 3, k: 0.35 });

    addCrystals(B, side * 15.5, 12.6, 1.3, { red: team === 'red', n: 5 });
    addCrystals(B, side * 34, -12.4, 1.1, { red: team === 'red', n: 4 });
    // rail rocks + bushes filler
    for (let x = 4; x < 44; x += RNG.f(3.4, 5.6)) {
      for (const sz of [-1, 1]) {
        const rz = sz * RNG.f(11.6, 15.4);
        if (RNG.chance(0.5)) addRock(B, side * x + RNG.spread(1.2), rz, RNG.f(0.7, 1.7));
        else addBush(B, side * x + RNG.spread(1.2), rz, RNG.f(0.8, 1.5));
      }
    }
    // brazier flames at nexus
    flamePoints.push([side * (A.NEXUS_X - 3.4), 1.7, 3.4], [side * (A.NEXUS_X - 3.4), 1.7, -3.4]);
    const tor1 = addTorch(B, side * (A.NEXUS_X - 3.6), 3.6);
    const tor2 = addTorch(B, side * (A.NEXUS_X - 3.6), -3.6);
    blockers.push(tor1.blocker, tor2.blocker);
  }

  // waterfall source: rock outcrop at far rail (-Z)
  {
    const F = -1; // z sign (far side)
    addRock(B, -4.4, F * 15.8, 3.1); addRock(B, 4.6, F * 16.2, 3.4);
    addRock(B, -2.2, F * 17.2, 2.6, { y: 1.4 }); addRock(B, 2.4, F * 17.4, 2.8, { y: 1.6 });
    addRock(B, 0, F * 18.2, 3.6, { y: 2.2 });
    addRock(B, -3.3, F * 14.6, 1.5, { y: 2.0 }); addRock(B, 3.4, F * 14.8, 1.6, { y: 2.1 });
    addTree(B, -5.6, F * 14.2, 1.35, { pink: true });
    addTree(B, 5.8, F * 14.6, 1.25, { pink: true });
    // spill lip rocks at near rail (+Z) where river exits
    addRock(B, -4.2, 15.6, 2.2); addRock(B, 4.3, 15.9, 2.4);
  }

  // river bank stones
  for (let z = -12; z <= 12; z += RNG.f(2.6, 4.2)) {
    if (Math.abs(z) < A.BRIDGE_HALF_Z + 1.4) continue;
    for (const sx of [-1, 1]) {
      if (RNG.chance(0.7)) addRock(B, sx * RNG.f(3.9, 5.1), z + RNG.spread(1), RNG.f(0.4, 0.95));
    }
  }

  // rune circles on the lane (single merged mesh, one draw)
  addRuneDecal(group, [
    [-11, 0, groundHeight(-11, 0) + 0.07, 5.4],
    [11, 0, groundHeight(11, 0) + 0.07, 5.4],
    [-A.NEXUS_X, 0, 0.62, 7.5],
    [A.NEXUS_X, 0, 0.62, 7.5],
  ]);

  const staticMeshes = B.build(group, { shadows: ['stoneProp', 'bark', 'canopyPink', 'trim'] });

  // =============================================================== TERRAIN ==
  // ground (painterly grass w/ riverbed + baked prop AO)
  {
    const segX = 160, segZ = 52;
    const g = new THREE.PlaneGeometry(150, 40, segX, segZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(PAL.grassLo), cB = new THREE.Color(PAL.grassHi);
    const cMoss = new THREE.Color(0x4a7a52), cSand = new THREE.Color(0xc9b98a);
    const cRiverBed = new THREE.Color(0x3d6b5c), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), z = pos.getZ(i);
      const bs = boundaryScale(x, z);
      let y;
      if (bs > 1) {
        const s = 1 / bs;
        x *= s; z *= s;
        pos.setX(i, x * 1.001); pos.setZ(i, z * 1.001);
        y = terrainHeight(x, z) - 0.15;
      } else {
        y = terrainHeight(x, z);
      }
      pos.setY(i, y);
      // color
      const n = cpuNoise.fbm(x * 0.09 + 3, z * 0.09 + 9, 4);
      tmp.copy(cA).lerp(cB, clamp(n * 1.6 - 0.2, 0, 1));
      const n2 = cpuNoise.fbm(x * 0.3 + 40, z * 0.3, 3);
      if (n2 > 0.62) tmp.lerp(cMoss, (n2 - 0.62) * 2);
      if (n2 < 0.34) tmp.lerp(cSand, (0.34 - n2) * 1.4);
      // riverbed
      const riverT = 1 - smooth(Math.abs(x), A.RIVER_HALF - 1.4, A.RIVER_HALF + 2.4);
      if (riverT > 0) tmp.lerp(cRiverBed, riverT * 0.9);
      // warm sunlit patch bias on +x side of trees is baked via aoSpots below
      let ao = 1;
      for (let s = 0; s < aoSpots.length; s++) {
        const sp = aoSpots[s];
        const d = Math.hypot(x - sp.x, z - sp.z);
        if (d < sp.r) ao = Math.min(ao, 1 - sp.k * (1 - d / sp.r));
      }
      // rail-side gentle occlusion + lane-edge warm wear
      ao *= 1 - 0.22 * smooth(Math.abs(z), 10.5, 15.5);
      const laneEdge = 1 - smooth(Math.abs(Math.abs(z) - A.LANE_HALF), 0, 2.2);
      tmp.lerp(cSand, laneEdge * 0.28);
      tmp.multiplyScalar(ao);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    fixNormals(g);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.11, pos.getZ(i) * 0.11);
    const ground = new THREE.Mesh(g, mats.grass);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    group.add(ground);
  }

  // lane drape (stone paving, funnels onto the bridge)
  {
    const segX = 150, segZ = 8;
    const g = new THREE.PlaneGeometry(1, 1, segX, segZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cLight = new THREE.Color(0xfff4e0), cDark = new THREE.Color(0x5e6558);
    const cMoss = new THREE.Color(0x6d8f56), tmp = new THREE.Color(0xffffff);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, v = pos.getZ(i) + 0.5; // 0..1
      const x = (u - 0.5) * 79;
      const widthF = 1 - 0.26 * (1 - smooth(Math.abs(x), A.BRIDGE_HALF_X, A.BRIDGE_HALF_X + 5));
      let z = (v - 0.5) * 2 * A.LANE_HALF * widthF;
      const edge = Math.abs(v - 0.5) * 2; // 0 center → 1 edge
      if (edge > 0.85) z += cpuNoise.fbm(x * 0.5, z, 2) * 0.9 - 0.45;
      pos.setX(i, x); pos.setZ(i, z);
      pos.setY(i, groundHeight(x, z * 0.92) + 0.055);
      tmp.setScalar(1);
      const n = cpuNoise.fbm(x * 0.22 + 60, z * 0.22, 3);
      tmp.lerp(cLight, clamp((n - 0.5) * 1.2, 0, 0.5));
      tmp.lerp(cDark, clamp((0.45 - n) * 1.1, 0, 0.55) * 0.65);
      const e2 = smooth(edge, 0.55, 1);
      tmp.lerp(cMoss, e2 * 0.5);
      tmp.multiplyScalar(1 - e2 * 0.38);
      let ao = 1;
      for (let s = 0; s < aoSpots.length; s++) {
        const sp = aoSpots[s];
        const d = Math.hypot(x - sp.x, z - sp.z);
        if (d < sp.r) ao = Math.min(ao, 1 - sp.k * 0.8 * (1 - d / sp.r));
      }
      tmp.multiplyScalar(ao);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    fixNormals(g);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.155, pos.getZ(i) * 0.155);
    const lane = new THREE.Mesh(g, mats.lane);
    lane.receiveShadow = true;
    lane.matrixAutoUpdate = false;
    group.add(lane);
  }

  // base plateau paving discs
  for (const side of [-1, 1]) {
    const g = new THREE.CircleGeometry(A.BASE_R - 0.6, 28);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const wx = lx + side * A.BASE_X;
      pos.setY(i, plateauH(wx, lz) + 0.05 - side * lx * 0.0001);
      const d = Math.hypot(lx, lz) / (A.BASE_R - 0.6);
      const n = cpuNoise.fbm(wx * 0.2, lz * 0.2, 3);
      tmp.setScalar(0.92 + (n - 0.5) * 0.3);
      tmp.lerp(new THREE.Color(0x74905c), smooth(d, 0.62, 1) * 0.55);
      tmp.multiplyScalar(1 - smooth(d, 0.75, 1) * 0.3);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    fixNormals(g);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * 0.15, pos.getZ(i) * 0.15);
    const disc = new THREE.Mesh(g, mats.lane);
    disc.position.set(side * A.BASE_X, 0, 0);
    disc.receiveShadow = true;
    disc.matrixAutoUpdate = false;
    disc.updateMatrix();
    group.add(disc);
  }

  // ================================================================ CLIFFS ==
  {
    const N = 150;
    const rows = [
      { s: 0.985, y: 0.45, n: 0.4 },
      { s: 1.02, y: -0.9, n: 0.9 },
      { s: 1.075, y: -3.2, n: 1.6 },
      { s: 1.13, y: -6.4, n: 2.2 },
      { s: 1.06, y: -9.8, n: 1.8 },
      { s: 0.72, y: -12.6, n: 1.2 },
      { s: 0.22, y: -14.4, n: 0.4 },
    ];
    const ring = [];
    for (let r = 0; r < rows.length; r++) {
      ring.push([]);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2;
        let dx = Math.cos(th) * (A.HALF_X + 1.5), dz = Math.sin(th) * (A.EDGE_Z + 0.5);
        const b = boundaryScale(dx, dz);
        dx /= b; dz /= b;
        const jr = 1 + (cpuNoise.fbm(i * 0.35, r * 1.7, 3) - 0.5) * 0.14 * rows[r].n;
        ring[r].push([dx * rows[r].s * jr, rows[r].y + (cpuNoise.fbm(i * 0.5 + 9, r * 2.3, 2) - 0.5) * rows[r].n, dz * rows[r].s * jr]);
      }
    }
    const posArr = [], uvArr = [], colArr = [];
    const shade = [1.0, 0.92, 0.7, 0.52, 0.38, 0.3, 0.26];
    const cool = new THREE.Color(0x8d9db2), warm = new THREE.Color(0xd9c9a8), tmp = new THREE.Color();
    const push = (p, u, v, r) => {
      posArr.push(p[0], p[1], p[2]);
      uvArr.push(u * 10, v * 2.2);
      const nn = cpuNoise.fbm(p[0] * 0.15, p[2] * 0.15, 3);
      tmp.copy(warm).lerp(cool, clamp(r / 4 - 0.1 + (nn - 0.5) * 0.6, 0, 1)).multiplyScalar(shade[r] * (0.85 + nn * 0.3));
      colArr.push(tmp.r, tmp.g, tmp.b);
    };
    for (let r = 0; r < rows.length - 1; r++) {
      for (let i = 0; i < N; i++) {
        const i2 = (i + 1) % N;
        const a = ring[r][i], b2 = ring[r][i2], c2 = ring[r + 1][i], d = ring[r + 1][i2];
        push(a, i / N, r, r); push(c2, i / N, r + 1, r + 1); push(b2, i2 / N || 1, r, r);
        push(b2, i2 / N || 1, r, r); push(c2, i / N, r + 1, r + 1); push(d, i2 / N || 1, r + 1, r + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvArr), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
    g.computeVertexNormals();
    fixNormals(g);
    const cliffs = new THREE.Mesh(g, mats.cliff);
    cliffs.matrixAutoUpdate = false;
    group.add(cliffs);
  }

  // ========================================================== INSTANCED BITS ==
  const flames = makeFlames(flamePoints);
  group.add(flames);

  // grass blades on the green strips
  {
    const list = [];
    const grassRng = RNG;
    const cA = new THREE.Color(0x477631), cB = new THREE.Color(0x7ca843);
    const tmp = new THREE.Color();
    let guard = 0;
    while (list.length < 2500 && guard++ < 11000) {
      const x = grassRng.f(-53, 53);
      const zone = grassRng.next();
      let z;
      if (zone < 0.72) z = grassRng.sign() * grassRng.f(A.LANE_HALF + 0.4, A.WALK_Z + 3.4);
      else z = grassRng.sign() * grassRng.f(A.LANE_HALF - 1.2, A.LANE_HALF + 0.5); // lane fringe
      if (Math.abs(x) < A.RIVER_HALF + 2.2) continue;
      const d = Math.hypot(Math.abs(x) - A.BASE_X, z);
      if (Math.abs(x) > 39 && d < A.BASE_R) continue; // keep plateau paved
      if (boundaryScale(x, z) > 0.97) continue;
      let blocked = false;
      for (const bl of blockers) {
        if (Math.hypot(x - bl.x, z - bl.z) < bl.r + 0.2) { blocked = true; break; }
      }
      if (blocked) continue;
      const n = cpuNoise.fbm(x * 0.09 + 3, z * 0.09 + 9, 3);
      tmp.copy(cA).lerp(cB, clamp(n * 1.5 - 0.1, 0, 1)).multiplyScalar(grassRng.f(0.85, 1.15));
      list.push({
        x, y: terrainHeight(x, z) - 0.05, z,
        s: grassRng.f(0.34, 0.72) * (0.75 + 0.5 * smooth(Math.abs(z), 6.6, 12)),
        r: tmp.r, g: tmp.g, b: tmp.b,
      });
    }
    group.add(makeGrassBlades(list));
  }

  // ============================================================== COLLISION ==
  const walkableR = (x, z, r, dx, dz) => {
    if (!isWalkable(x, z)) return false;
    const len = Math.hypot(dx, dz) || 1;
    if (!isWalkable(x + (dx / len) * r, z + (dz / len) * r)) return false;
    return true;
  };
  const resolveMove = (pos, dx, dz, r = 0.5) => {
    let nx = pos.x + dx, nz = pos.z + dz;
    if (!walkableR(nx, nz, r, dx, dz)) {
      if (walkableR(pos.x + dx, pos.z, r, dx, 0)) { nx = pos.x + dx; nz = pos.z; }
      else if (walkableR(pos.x, pos.z + dz, r, 0, dz)) { nx = pos.x; nz = pos.z + dz; }
      else { nx = pos.x; nz = pos.z; }
    }
    // blocker push-out
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      const ddx = nx - b.x, ddz = nz - b.z;
      const d2 = ddx * ddx + ddz * ddz, rr = b.r + r * 0.7;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = b.x + (ddx / d) * rr; nz = b.z + (ddz / d) * rr;
      }
    }
    if (!isWalkable(nx, nz)) { nx = pos.x; nz = pos.z; }
    pos.x = nx; pos.z = nz;
    pos.y = groundHeight(nx, nz);
    return pos;
  };

  return {
    group, A, blockers, addBlocker, removeBlocker,
    groundHeight, terrainHeight, isWalkable, resolveMove,
    staticMeshes, flames,
    towerSpecs: [
      { team: 'blue', x: -A.TOWER_OUTER_X, z: 0, tier: 'outer' },
      { team: 'blue', x: -A.TOWER_INNER_X, z: 0, tier: 'inner' },
      { team: 'red', x: A.TOWER_OUTER_X, z: 0, tier: 'outer' },
      { team: 'red', x: A.TOWER_INNER_X, z: 0, tier: 'inner' },
    ],
    nexusSpecs: [
      { team: 'blue', x: -A.NEXUS_X, z: 0 },
      { team: 'red', x: A.NEXUS_X, z: 0 },
    ],
    spawn: {
      blue: new THREE.Vector3(-A.FOUNTAIN_X + 2.2, 0, 0),
      red: new THREE.Vector3(A.FOUNTAIN_X - 2.2, 0, 0),
    },
    waveSpawn: {
      blue: new THREE.Vector3(-A.SPAWN_X, 0, 0),
      red: new THREE.Vector3(A.SPAWN_X, 0, 0),
    },
  };
}
