// River + waterfall: custom flow shader with foam, sparkle glints, falling
// sheet, mist puffs and splash sparkles. All time-driven on the GPU.
import * as THREE from 'three';
import { tex, uTime, PAL } from '../core/assets.js';
import { RNG } from '../core/rng.js';
import { A } from './arena.js';

export function buildWater(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // ------------------------------------------------------------- river mat --
  const riverMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime, tNoise: { value: tex.noise },
      uDeep: { value: new THREE.Color(0x18606e) },
      uShallow: { value: new THREE.Color(0x4fc2b4) },
      uFoam: { value: new THREE.Color(0xeafff8) },
      uSunTint: { value: new THREE.Color(0xffe2b0) },
      uFlow: { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vWp;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform sampler2D tNoise; uniform float uTime; uniform float uFlow;
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSunTint;
      varying vec3 vWp;
      void main() {
        vec2 p = vWp.xz;
        float t = uTime * uFlow;
        // layered flowing noise
        float n1 = texture2D(tNoise, p * vec2(0.10, 0.055) + vec2(0.0, -t * 0.09)).r;
        float n2 = texture2D(tNoise, p * vec2(0.23, 0.11) + vec2(0.03, -t * 0.17) + n1 * 0.08).g;
        float n = (n1 + n2) * 0.5;
        float bank = abs(p.x);
        vec3 col = mix(uDeep, uShallow, smoothstep(1.6, 3.9, bank) * 0.8 + n * 0.25);
        // wavelet shading
        col *= 0.85 + n * 0.4;
        col += uSunTint * pow(n2, 3.0) * 0.35;
        // sparkle glints (bloom food)
        float sp = texture2D(tNoise, p * vec2(0.5, 0.3) + vec2(n1 * 0.1, -t * 0.35)).b;
        col += vec3(1.15, 1.12, 1.0) * smoothstep(0.895, 0.95, sp);
        // bank foam
        float foamN = texture2D(tNoise, p * vec2(0.3, 0.16) + vec2(0.0, -t * 0.22)).r;
        float foam = smoothstep(3.15, 3.75, bank + foamN * 0.7 - 0.35);
        // bridge arch foam
        float wz = vWp.z;
        float arch = (1.0 - smoothstep(4.2, 6.0, abs(wz))) * step(3.4, abs(wz));
        foam += arch * smoothstep(0.45, 0.75, foamN) * 0.9;
        // waterfall plunge foam at far end
        foam += (1.0 - smoothstep(-13.4, -11.8, wz)) * smoothstep(0.35, 0.8, foamN);
        // flow streaks
        float streak = texture2D(tNoise, vec2(p.x * 0.45, wz * 0.06 - t * 0.3)).g;
        foam += smoothstep(0.84, 0.95, streak) * 0.4;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0));
        float alpha = mix(0.82, 0.94, smoothstep(3.9, 2.0, bank)) ;
        gl_FragColor = vec4(col, alpha);
      }`,
  });

  // river surface
  {
    const g = new THREE.PlaneGeometry(8.6, 32.5, 4, 24);
    g.rotateX(-Math.PI / 2);
    const river = new THREE.Mesh(g, riverMat);
    river.position.set(0, -0.52, 0.8);
    river.renderOrder = 1;
    river.matrixAutoUpdate = false; river.updateMatrix();
    group.add(river);
  }
  // source pool up on the falls cliff
  {
    const g = new THREE.CircleGeometry(3.1, 20);
    g.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(g, riverMat);
    pool.position.set(0, 2.42, -15.6);
    pool.renderOrder = 1;
    pool.matrixAutoUpdate = false; pool.updateMatrix();
    group.add(pool);
  }

  // -------------------------------------------------------------- waterfall --
  const fallsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime, tFalls: { value: tex.falls }, tNoise: { value: tex.noise },
      uTint: { value: new THREE.Color(0xbfe4e2) },
      uSpeed: { value: 1.05 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D tFalls; uniform sampler2D tNoise; uniform float uTime; uniform float uSpeed;
      uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        float wob = texture2D(tNoise, vec2(uv.x * 1.4, uv.y * 0.4 - uTime * 0.11)).r;
        uv.x += (wob - 0.5) * 0.06;
        float s1 = texture2D(tFalls, vec2(uv.x * 1.6, uv.y * 0.75 - uTime * uSpeed * 0.32)).r;
        float s2 = texture2D(tFalls, vec2(uv.x * 2.6 + 0.4, uv.y * 0.45 - uTime * uSpeed * 0.21)).r;
        float body = s1 * 0.75 + s2 * 0.55;
        float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x);
        float topBoost = smoothstep(0.55, 1.0, uv.y) * 0.3;          // bright lip
        float bottomFoam = smoothstep(0.32, 0.02, uv.y) * 0.7;       // plunge froth
        float a = clamp(body * 0.8 + topBoost * 0.35 + bottomFoam * body, 0.0, 1.0) * edge;
        vec3 col = uTint * (0.62 + body * 0.5 + topBoost * 0.6 + bottomFoam * 0.3);
        gl_FragColor = vec4(col, a * 0.85);
      }`,
    });
  {
    // curtain with a curled base
    const g = new THREE.PlaneGeometry(6.4, 3.6, 8, 12);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 1.8) / 3.6; // 0 bottom → 1 top
      pos.setZ(i, Math.pow(1 - t, 2.2) * 1.1);
      pos.setX(i, pos.getX(i) * (1 + (1 - t) * 0.14));
    }
    g.computeVertexNormals();
    const falls = new THREE.Mesh(g, fallsMat);
    falls.position.set(0, 1.05, -13.75);
    falls.renderOrder = 3;
    falls.matrixAutoUpdate = false; falls.updateMatrix();
    group.add(falls);

    // edge spill where the river leaves the arena (into the cloud chasm)
    const g2 = new THREE.PlaneGeometry(7.2, 9, 6, 10);
    const pos2 = g2.attributes.position;
    for (let i = 0; i < pos2.count; i++) {
      const t = (pos2.getY(i) + 4.5) / 9;
      pos2.setZ(i, Math.pow(1 - t, 1.8) * 2.4);
    }
    g2.computeVertexNormals();
    const spillMat = fallsMat.clone();
    spillMat.uniforms.uTime = uTime;
    spillMat.uniforms.uSpeed.value = 0.8;
    const spill = new THREE.Mesh(g2, spillMat);
    spill.position.set(0, -4.9, 16.45);
    spill.rotation.y = Math.PI;
    spill.renderOrder = 3;
    spill.matrixAutoUpdate = false; spill.updateMatrix();
    group.add(spill);
  }

  // ------------------------------------------------------------- mist puffs --
  {
    const spots = [
      [-1.9, 0.1, -12.9, 1.5], [0.2, 0.2, -13.3, 2.0], [2.0, 0.1, -12.8, 1.6],
      [-1.0, 1.3, -13.6, 1.2], [1.2, 1.5, -13.7, 1.3],
      [0, 2.6, -14.3, 1.1], [-2.6, 0.6, -13.2, 1.0],
      [-1.4, -3.4, 17.3, 1.7], [1.6, -4.2, 17.5, 2.0],
    ];
    const n = spots.length;
    const quad = new THREE.PlaneGeometry(2.6, 2.0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const off = new Float32Array(n * 4), ph = new Float32Array(n);
    spots.forEach((s, i) => {
      off[i * 4] = s[0]; off[i * 4 + 1] = s[1]; off[i * 4 + 2] = s[2]; off[i * 4 + 3] = s[3];
      ph[i] = (i * 0.37) % 1;
    });
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime, tMap: { value: tex.smoke } },
      vertexShader: `
        attribute vec4 aOff; attribute float aPhase;
        uniform float uTime;
        varying vec2 vUv; varying float vA;
        void main() {
          vUv = uv;
          float cyc = fract(uTime * 0.22 + aPhase);
          float sc = aOff.w * (0.55 + cyc * 1.1);
          vA = sin(cyc * 3.14159) * 0.3;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = aOff.xyz + vec3(0.0, cyc * 1.3, 0.0) + right * position.x * sc + up * position.y * sc;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying vec2 vUv; varying float vA;
        void main() {
          vec4 c = texture2D(tMap, vUv);
          gl_FragColor = vec4(vec3(0.94, 0.99, 1.0), c.a * vA);
        }`,
    });
    const mist = new THREE.Mesh(geo, mat);
    mist.frustumCulled = false;
    mist.renderOrder = 4;
    group.add(mist);
  }

  // --------------------------------------------------------- splash sparkles --
  {
    const count = 26;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = RNG.spread(2.6);
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = -13 + RNG.spread(0.8);
      seed[i] = RNG.next();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime, tMap: { value: tex.spark } },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          float cyc = fract(uTime * (0.7 + aSeed * 0.6) + aSeed * 7.0);
          vec3 p = position;
          p.y += cyc * (1.2 + aSeed * 1.6);
          p.x += cyc * cyc * (aSeed - 0.5) * 2.2;
          vA = (1.0 - cyc) * 0.9;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (5.0 + aSeed * 7.0) * (120.0 / max(-mv.z, 4.0));
        }`,
      fragmentShader: `
        uniform sampler2D tMap;
        varying float vA;
        void main() {
          vec4 c = texture2D(tMap, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.9, 1.0, 1.0), c.a * vA);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    group.add(pts);
  }

  return { group, riverMat, update() {} };
}
