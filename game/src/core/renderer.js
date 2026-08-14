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
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // manual reset per frame so stats cover all passes
  container.appendChild(renderer.domElement);
  return renderer;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVig: { value: 0.42 },
    uFlash: { value: 0 },
    uSat: { value: 1.16 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVig; uniform float uFlash; uniform float uSat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // gentle S-curve contrast
      col = mix(col, col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0)), 0.14);
      // saturation
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);
      // split tone: teal shadows / warm highlights
      float sh = 1.0 - smoothstep(0.0, 0.45, luma);
      float hi = smoothstep(0.5, 1.0, luma);
      col *= mix(vec3(1.0), vec3(0.94, 1.015, 1.06), sh * 0.5);
      col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.94), hi * 0.4);
      // vignette
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVig * smoothstep(0.28, 0.92, dot(d, d) * 2.4);
      // impact flash
      col += vec3(1.0, 0.95, 0.85) * uFlash;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.4, 0.88);
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
