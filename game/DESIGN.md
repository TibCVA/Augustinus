# AETHER RIFT — AAA Mobile MOBA Arena (Three.js)

A single-arena mobile MOBA rendered in Three.js, targeting the visual quality bar of
Wild Rift / recent AAA stylized mobile titles. Original IP (no Riot assets/names).
Must run at 60 fps on a recent iPhone (Safari, WebGL2, import maps OK — iOS 16.4+).

## Art direction

**Theme:** "Sunken Elven Sanctum" — an ancient overgrown elven bridge-arena floating
above a cloud chasm at golden hour. Painterly, saturated, hand-painted stylization
(NOT photoreal): warm gold key light, cool teal shadows, emissive arcane-blue runes,
pink-blossom trees, mossy pale stone.

**Non-negotiable quality bar (what critics will judge):**
- Filmic look: ACESFilmicToneMapping, subtle bloom (UnrealBloomPass, threshold ~0.85),
  vignette, gentle color grade. No blown-out whites, no flat ambient gray.
- Lighting: 1 warm directional sun (casts 2048 PCFSoft shadows) + hemisphere sky/ground
  fill + emissive accents. Rim-light feel via fresnel in custom/onBeforeCompile materials.
- Hand-painted procedural textures (canvas-generated, 512–1024px): stone tiles with
  edge wear + AO baked in, moss gradients, painted grass, wood grain. NO flat
  MeshStandardMaterial colors on large surfaces — every big surface needs albedo
  variation + baked AO darkening at borders.
- Silhouettes: props read clearly at game camera distance. Chunky stylized proportions,
  bevels — never default unbeveled BoxGeometry look.
- Motion everywhere: swaying grass/leaves (instanced, vertex-shader wind), drifting
  cloud chasm below, waterfall + river flow with foam, floating particles (petals,
  fireflies, dust motes in light shafts), banner cloth sway, torch flames.
- VFX: every ability has projectile + impact + lingering decal; hit flashes; soft
  additive glows; ground AoE telegraphs; damage numbers. Trails on projectiles.

## Gameplay (complete, one arena)

Single-lane arena (~110×34 units, X axis), two bases. Per side: nexus crystal + 2 towers
(outer mid-lane, inner at base). River band crossing the middle (flowing water, bridge).
Side rails: broken columns, statues, blossom trees, glowing crystals, jungle walls.
Below the arena edges: cloud sea + floating rock islets (parallax depth).

- Player hero: **Sera, Blade of Dawn** — stylized female warrior (procedural mesh:
  layered armor, cape, glowing sword). Procedurally animated: idle breathe, run cycle
  (lean + cape flow), 3-hit basic attack combo, cast poses. Team BLUE (left base).
- Enemy bot hero: **Kargath, Ember Warlord** (recolor/variant rig, RED), simple AI:
  pushes lane, trades, retreats at low HP, respawns.
- Abilities (buttons bottom-right, cooldown sweeps): Q crescent slash (cone dmg),
  W dash-strike with afterimages, E spinning blade-storm AoE, R **Dawnfall** — leap +
  massive radial slam (screen shake, shockwave ring, crater decal). Basic-attack button
  with auto-target nearest.
- Minions: waves of 3 melee + 2 casters every 25 s both sides, walk lane, fight
  (melee bonk anim, caster bolt projectiles). Towers target minions first, then heroes;
  charging beam VFX. Nexus destroyed → victory/defeat screen with banner UI.
- Economy/feel: gold + CS on last hit, XP levels 1–15 scaling stats, hero kill gold,
  respawn timers scaling with level.

## Controls & HUD (DOM overlay, Wild Rift layout, safe-area aware)

- Left: floating virtual joystick (touch anywhere left half; also WASD on desktop).
- Right: ability cluster — big attack button, Q/W/E around it, R above; radial
  cooldown sweeps, mana cost dimming, level-up pips. Tap = smart-cast.
- Top-left: circular minimap (canvas, live icons, camera brackets). Top-right:
  gold / CS / KDA / game timer. Top-center: team kill score.
- Hero: portrait + HP/mana bars bottom-left with level badge; floating HP bars above
  all units (billboard sprites in-world, NOT DOM, so they occlude correctly).
- Style: glassy dark panels, gold filigree borders, subtle gradients — crisp at 3x DPR.
- `viewport-fit=cover`, `env(safe-area-inset-*)` padding, no page scroll/zoom/selection.

## Performance budget (recent iPhone @60fps)

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; antialias false (post FX
  handles AA via FXAA when DPR<2, else none needed).
- ≤ ~180 draw calls: merge static world geometry by material (BufferGeometryUtils),
  InstancedMesh for grass/petals/rocks/trees, single particle BufferGeometry pools.
- One shadow-casting light; shadow camera tight on play area; `matrixAutoUpdate=false`
  for statics. Bloom at half resolution. No per-frame allocations in the loop
  (preallocate vectors); object pools for projectiles/particles/damage numbers.

## Architecture contract (file ownership — keep these boundaries)

```
game/
  index.html            # import map: "three"→./vendor/three.module.js, "three/addons/"→./vendor/addons/ ; HUD DOM; loads src/main.js
  css/hud.css
  src/main.js           # bootstrap, resize, quality detect, game loop, debug API
  src/core/renderer.js  # renderer + EffectComposer (bloom, vignette/grade, FXAA, output)
  src/core/assets.js    # ALL procedural canvas textures & shared materials
  src/core/rng.js       # seeded RNG (mulberry32), read ?seed=
  src/world/arena.js    # terrain/lane/walls/bases layout + collision map (walkable mask)
  src/world/props.js    # geometry builders: tower, nexus, tree, statue, column, crystal, torch, banner
  src/world/environment.js # sky gradient dome, sun+lights, fog, cloud sea, islets, ambient particles
  src/world/water.js    # river + waterfall custom shader (flow, foam, sparkle)
  src/entities/hero.js  # hero rig builder + procedural animation state machine
  src/entities/units.js # minion rigs, unit base class (hp, team, movement, billboard hp bars)
  src/game/sim.js       # fixed-step sim: waves, combat, AI, towers, win/lose, gold/xp
  src/game/controls.js  # touch joystick + buttons + WASD/QWER keyboard
  src/game/hud.js       # DOM HUD updates, minimap canvas, damage numbers, kill feed
  src/vfx/vfx.js        # particle pools, projectiles, ability VFX, screen shake, decals
```

## Debug / screenshot API (REQUIRED, do not remove)

Expose on `window`:
- `__WR_READY` → true once first frame rendered.
- `__WR_DEBUG.step(seconds)` — advance the *simulation* by N seconds in fixed steps
  (no realtime wait), then render one frame.
- `__WR_DEBUG.preset(name)` — stage deterministic beauty shots, then render:
  - `overview` – elevated 3/4 view of whole arena at golden hour
  - `gameplay` – standard in-game camera, mid-lane minion clash + hero fighting, VFX live
  - `hero` – close-up orbit shot of Sera (sword glow, rim light, cape)
  - `ult` – Sera mid-Dawnfall impact: shockwave, particles, screen flash
  - `river` – low angle over water toward waterfall, blossoms drifting
  - `base` – blue base: nexus crystal, towers, banners, torches
- `__WR_DEBUG.stats()` → `{calls, triangles}` from `renderer.info.render`;
  `__WR_DEBUG.resume()` — resume realtime loop after ?shot=1 pause.
- `?seed=N` fixes RNG; `?shot=1` pauses auto sim (staging controlled by preset only).
- Never cache-bust vendor imports; keep module URLs relative.

Game camera: MOBA 3/4 top-down (pitch ~52° elevation, yaw aligned to lane), smooth
follow on hero, slight forward lead, FOV ~38 (long lens look). Screen shake on big hits.
