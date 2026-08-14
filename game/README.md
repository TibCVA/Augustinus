# AETHER RIFT — Three.js AAA-style Mobile MOBA Arena

A single-arena mobile MOBA in the spirit of Wild Rift, rendered entirely in Three.js
with procedural assets (zero downloads beyond the code). One complete, beautiful
lane-arena: two bases, towers, nexus crystals, minion waves, an AI enemy hero, four
abilities with full VFX, and a Wild Rift-style touch HUD.

- **Art**: "Sunken Elven Sanctum" — golden-hour painterly stylization, ACES filmic
  tone mapping, bloom, hand-painted procedural textures, animated water/grass/petals.
- **Mobile-first**: virtual joystick + ability cluster, safe-area aware, targets
  60 fps on recent iPhones (WebGL2, iOS Safari 16.4+).
- **Desktop fallback**: WASD to move, Q/W/E/R abilities, A to attack.

## Run

Any static file server works (ES modules require http, not file://):

```bash
cd game
python3 -m http.server 8080
# open http://localhost:8080  (on iPhone: http://<your-ip>:8080)
```

## Dev tools

Headless screenshot/QA harness (needs `playwright-core` + Chromium):

```bash
PW_NODE_MODULES=/path/to/node_modules CHROME_PATH=/path/to/chromium \
  node tools/capture.mjs --perf
```

Captures the six beauty-shot presets defined in `DESIGN.md` (`overview`, `gameplay`,
`hero`, `ult`, `river`, `base`) to `tools/shots/` and reports draw calls / triangles /
fps plus any console errors. `DESIGN.md` is the binding art + architecture spec.
