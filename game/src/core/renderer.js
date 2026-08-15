// Renderer + post pipeline: bloom, color grade + vignette + flash, FXAA, output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // manual reset per frame so stats cover all passes
  container.appendChild(renderer.domElement);
  return renderer;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVig: { value: 0.44 },
    uFlash: { value: 0 },
    uSat: { value: 1.14 },
    uContrast: { value: 0.26 },
    // Shadow lift: the linear-light value of 0x1a3346 (cool teal), scaled by how
    // deep in shadow the pixel is. ACES + the S-curve were crushing every shadow
    // to an untinted near-black, which the design doc explicitly forbids.
    uLift: { value: new THREE.Vector3(0.0103, 0.0331, 0.0613) },
    uLiftK: { value: 0.40 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVig; uniform float uFlash; uniform float uSat; uniform float uContrast;
    uniform vec3 uLift; uniform float uLiftK;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = max(c.rgb, 0.0);

      // black point: reclaim the milky floor without crushing detail. Kept small
      // now that the shadows carry a deliberate teal lift instead of a crush.
      col = max(vec3(0.0), col - 0.004) / (1.0 - 0.004);

      // filmic S-curve, pivoted so midtones stay put
      vec3 sc = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0));
      col = mix(col, sc, uContrast);

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // vibrance: push flat areas, leave already-saturated pixels alone
      float mx = max(col.r, max(col.g, col.b));
      float mn = min(col.r, min(col.g, col.b));
      float sat = (mx - mn) / max(mx, 1e-4);
      col = mix(vec3(luma), col, uSat + (1.0 - sat) * 0.22);

      // split tone: teal shadows / golden highlights
      float sh = 1.0 - smoothstep(0.0, 0.42, luma);
      float hi = smoothstep(0.45, 1.0, luma);
      col *= mix(vec3(1.0), vec3(0.92, 1.005, 1.09), sh * 0.55);
      col *= mix(vec3(1.0), vec3(1.06, 1.005, 0.92), hi * 0.50);

      // Cool teal shadow lift. Additive, so it raises the floor without washing
      // the midtones, and on a NARROWER mask than the split-tone: the dark grout
      // inside lit paving must keep its warmth, only true shadow gets the tint.
      float shL = 1.0 - smoothstep(0.0, 0.24, luma);
      col += uLift * (uLiftK * shL * shL);

      // vignette (slightly cool at the corners, like a wide lens)
      vec2 d = vUv - 0.5;
      float v = uVig * smoothstep(0.20, 0.98, dot(d, d) * 2.4);
      col *= 1.0 - v;
      col = mix(col, col * vec3(0.94, 0.98, 1.06), v * 0.7);

      // impact flash
      col += vec3(1.0, 0.95, 0.85) * uFlash;

      // 8-bit dither: large sky gradients band without it
      float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col += (dth - 0.5) * 0.0032;

      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Tighter, brighter bloom: only genuine highlights (sun, runes, crystals) glow,
  // so the frame keeps filmic contrast instead of going milky.
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.62, 0.48, 0.94);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const fxaa = new FXAAPass();
  fxaa.enabled = renderer.getPixelRatio() < 2;
  composer.addPass(fxaa);
  return {
    composer, bloom, fxaa,
    gradeUniforms: grade.material.uniforms,
    setSize(w, h) { composer.setSize(w, h); },
  };
}
