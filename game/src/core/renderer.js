// Renderer + post pipeline: bloom, color grade + vignette + flash, FXAA, output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The one WebGLRenderer, published so world modules that need a GL context at
// build time (environment.js prefilters its sky IBL through PMREMGenerator) can
// reach it without main.js having to thread it through every factory. Set by
// createRenderer(), which main.js calls before it builds anything.
let _renderer = null;
export function getRenderer() { return _renderer; }

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // manual reset per frame so stats cover all passes
  container.appendChild(renderer.domElement);
  _renderer = renderer;
  return renderer;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVig: { value: 0.39 },
    uFlash: { value: 0 },
    uSat: { value: 1.40 },
    uContrast: { value: 0.34 },
    // Black point. The set was measured at p1 = 51/255 on the overview: nothing
    // in the frame was allowed to be dark, which is half of the "milky" read.
    // Pulled down hard; the teal lift below is what stops it going to mud.
    uBlack: { value: 0.0215 },
    // Shadow lift: the linear-light value of 0x1a3346 (cool teal), scaled by how
    // deep in shadow the pixel is. ACES + the S-curve were crushing every shadow
    // to an untinted near-black, which the design doc explicitly forbids.
    // Re-weighted CHROMA-FORWARD (luma 0.030 -> 0.019 for the same visible
    // teal): the tint is the point, the luminance it drags along is the cost.
    uLift: { value: new THREE.Vector3(0.0035, 0.0206, 0.0620) },
    // The shadow lift buys teal shadows but costs frame-wide chroma; 0.40 read
    // as a milky wash over the whole ult frame.
    uLiftK: { value: 0.36 },
    // ---- highlight range -------------------------------------------------
    // Everything above uHiKnee gets pushed apart. This is a *narrow* expansion,
    // not an exposure lift: the knee sits above the sunlit-stone value so broad
    // lit surfaces are untouched and only speculars, rune cores, water sparkle
    // and lamp glass ride up past 245. Widening p99 without lifting p10 is the
    // whole brief.
    uHiKnee: { value: 0.71 },
    uHiGain: { value: 1.45 },
    // ---- shoulder --------------------------------------------------------
    // Filmic shoulder ahead of ACES. Without it the expansion above (and a 500x
    // HDR ult core) slams into the ACES clip as one flat white blob with no
    // internal ramp. uShoK is where compression starts, uShoW the total extra
    // range the shoulder can absorb — so a 2x core and an 8x core still land on
    // different display values instead of both reading 255.
    uShoK: { value: 0.94 },
    uShoW: { value: 7.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVig; uniform float uFlash; uniform float uSat; uniform float uContrast;
    uniform vec3 uLift; uniform float uLiftK; uniform float uBlack;
    uniform float uHiKnee; uniform float uHiGain; uniform float uShoK; uniform float uShoW;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = max(c.rgb, 0.0);

      // black point: reclaim the milky floor. The teal lift further down puts
      // colour back into what survives, so this can be aggressive.
      col = max(vec3(0.0), col - uBlack) / (1.0 - uBlack);

      // filmic S-curve, pivoted so midtones stay put
      vec3 sc = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0));
      col = mix(col, sc, uContrast);

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Highlight expansion. Masked on luminance and applied per channel, so a
      // warm specular stays warm as it climbs instead of desaturating to white.
      col *= 1.0 + uHiGain * smoothstep(uHiKnee, uHiKnee + 0.50, luma);

      // Shoulder: soft-knee compression of everything above uShoK toward
      // uShoK + uShoW. Bright cores keep a value ramp instead of clipping flat.
      vec3 over = max(col - uShoK, 0.0);
      col = min(col, vec3(uShoK)) + over / (1.0 + over / uShoW);

      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // vibrance: push flat areas, leave already-saturated pixels alone
      float mx = max(col.r, max(col.g, col.b));
      float mn = min(col.r, min(col.g, col.b));
      float sat = (mx - mn) / max(mx, 1e-4);
      col = mix(vec3(luma), col, uSat + (1.0 - sat) * 0.26);

      // split tone: teal shadows / golden highlights
      float sh = 1.0 - smoothstep(0.0, 0.42, luma);
      float hi = smoothstep(0.45, 1.0, luma);
      col *= mix(vec3(1.0), vec3(0.90, 1.005, 1.11), sh * 0.62);
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

      // 8-bit dither: large sky gradients band without it. Gated on luminance —
      // sRGB encoding is near-vertical at the bottom of the range, so a fixed
      // linear-light dither that is invisible in the sky becomes visible salt
      // in the shadows, and this grade puts far more of the frame down there
      // than the old one did (measured: dark-region local sigma 3.4 -> 4.6).
      float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col += (dth - 0.5) * 0.0032 * smoothstep(0.015, 0.16, luma);

      // LIT-1 / half-float guard. The S-curve above squares its input, so an
      // unbounded additive VFX core (~500 linear) becomes ~250000 — past the
      // half-float ceiling of 65504. The composer's RGBA16F target stores +Inf,
      // ACES in OutputPass then evaluates Inf/Inf = NaN and writes 0: a hole of
      // pure black pixels in the middle of the ult core with every neighbour at
      // 255 and no AA ramp. 64.0 is far above the value ACES maps to 1.0, so
      // clamping here costs no highlight its ramp.
      gl_FragColor = vec4(min(col, vec3(64.0)), c.a);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Tighter, brighter bloom: only genuine highlights (sun, runes, crystals) glow,
  // so the frame keeps filmic contrast instead of going milky.
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.80, 0.125, 1.02);
  // --- give the bloom an actual shoulder -----------------------------------
  // Two separate defects were reading as "bloom washes the frame into mush":
  //
  // 1) The high-pass is a HARD gate (smoothWidth 0.01): a pixel at threshold
  //    contributes nothing, a pixel a hair above contributes its FULL value.
  //    Ramp it so the glow enters gradually instead of popping on.
  bloom.highPassUniforms.smoothWidth.value = 0.34;
  // 2) UnrealBloomPass mixes each blur mip by `mix(f, 1.2 - f, radius)`, so the
  //    stock radius of 0.48 made the widest, softest mip weigh essentially the
  //    same as the tightest one (0.584 vs 0.616) — every highlight sprayed a
  //    screen-wide veil, which is exactly the ult frame's p10 = 113. A small
  //    radius plus a steep factor ramp puts the energy back in the core: the
  //    bright thing stays bright, the halo falls off fast.
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.52, 0.26, 0.11, 0.045];
  // Chromatic falloff: neutral core, warm mid halo, cool-violet outer veil. The
  // panel measured the ult core spanning a 27-degree amber band; giving the
  // glow itself a hue ramp is the cheapest available hue opposition.
  bloom.bloomTintColors[0].set(1.00, 1.00, 1.00);
  bloom.bloomTintColors[1].set(1.00, 0.94, 0.86);
  bloom.bloomTintColors[2].set(1.00, 0.82, 0.62);
  bloom.bloomTintColors[3].set(0.92, 0.72, 0.70);
  bloom.bloomTintColors[4].set(0.72, 0.66, 0.92);
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

    /**
     * Link every scene material NOW instead of on the frame that first draws it.
     *
     * Must go through here rather than calling renderer.compile() directly:
     * three bakes `toneMapping` and `outputColorSpace` into its program cache
     * key, and both of those depend on whether the current render target is the
     * canvas or an offscreen buffer. The composer renders the scene into
     * renderTarget1, so compiling against the canvas would link a *different*
     * program variant and leave the real one to stall on first use.
     */
    compileScene(scene_, camera_) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(composer.renderTarget1);
      renderer.compile(scene_, camera_);
      renderer.setRenderTarget(prev);
    },
  };
}
