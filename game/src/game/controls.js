// Touch joystick (left half) + ability buttons + WASD/QWER keyboard.
// Pointer events with touch fallback; safe against multi-touch.
//
// The joystick and the keyboard feed the *same* normalised (dir, mag) pair into
// sim.setMove, so a champion driven by a thumb and one driven by WASD accelerate,
// pivot and stop identically. Past the dead zone the magnitude curve starts at
// WALK so there is never a band of travel that visibly does nothing, and it is
// at 1.0 by FULL so most of the throw is pure direction.
//
// Wild Rift's move stick is effectively *direction only*: a champion runs at its
// movement speed whether you feather the stick or slam it to the rim. A curve
// that ramped 0.45 -> 1.0 across the whole throw meant a half tilt walked at
// 4.7 u/s instead of 7, which is the single biggest "this is not Wild Rift"
// tell on a thumb. So: a small dead zone, then almost full speed immediately,
// with a short ramp that exists only so a resting thumb cannot lurch.
const DEAD = 0.12;     // fraction of knob travel treated as slack (~5 px of 44)
const WALK = 0.82;     // magnitude the moment you leave the dead zone
const FULL = 0.42;     // fraction of travel at which you are already at full speed
const ATTACK_REPEAT = 0.25;

export class Controls {
  constructor(sim) {
    this.sim = sim;
    this.joyId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.joyVec = { x: 0, y: 0, mag: 0 };
    this.keys = new Set();
    this.base = document.getElementById('joyBase');
    this.knob = document.getElementById('joyKnob');
    this.R = 44; // knob travel radius (px)
    this.attackHeld = false;
    this.attackRepeat = 0;
    this.bind();
  }

  bind() {
    const opts = { passive: false };
    document.addEventListener('touchmove', (e) => { if (e.target.tagName !== 'BUTTON') e.preventDefault(); }, opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), opts);

    const pDown = (e) => {
      const x = e.clientX, y = e.clientY;
      if (this.joyId === null && x < innerWidth * 0.52 && !e.target.closest('button')) {
        this.joyId = e.pointerId ?? 'mouse';
        this.joyOrigin.x = x; this.joyOrigin.y = y;
        this.base.style.display = 'block';
        this.base.style.left = x + 'px';
        this.base.style.top = y + 'px';
        this.setKnob(0, 0);
        this.joyVec.x = this.joyVec.y = this.joyVec.mag = 0;
      }
    };
    const pMove = (e) => {
      if (this.joyId !== (e.pointerId ?? 'mouse')) return;
      const rx = e.clientX - this.joyOrigin.x, ry = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(rx, ry);
      let dx = rx, dy = ry;
      if (len > this.R) { dx = rx / len * this.R; dy = ry / len * this.R; }
      this.setKnob(dx, dy);   // knob tracks the finger 1:1, dead zone or not
      const t = Math.min(1, len / this.R);
      if (t <= DEAD || len < 1e-3) {
        this.joyVec.mag = 0;
      } else {
        // Direction must come off the RAW delta: dividing the clamped knob
        // offset by the raw length shrank the vector past the rim (1.6x throw
        // gave a 0.625-long "unit" vector), which quietly shortened the
        // camera's forward lead exactly when the player was pushing hardest.
        this.joyVec.x = rx / len;
        this.joyVec.y = ry / len;
        this.joyVec.mag = t >= FULL ? 1 : WALK + (1 - WALK) * ((t - DEAD) / (FULL - DEAD));
      }
    };
    const pUp = (e) => {
      if (this.joyId !== (e.pointerId ?? 'mouse')) return;
      this.joyId = null;
      this.joyVec.x = this.joyVec.y = this.joyVec.mag = 0;
      this.base.style.display = 'none';
    };
    document.addEventListener('pointerdown', pDown);
    document.addEventListener('pointermove', pMove);
    document.addEventListener('pointerup', pUp);
    document.addEventListener('pointercancel', pUp);

    // ability buttons — fire on pointerdown so a tap has zero added latency
    const bindBtn = (id, fn, repeat = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        // Capture so a thumb that slides off the button keeps the hold and
        // still delivers pointerup here. Touch gets this implicitly; a mouse
        // does not, and without it a drag-off left the attack latched on.
        if (el.setPointerCapture && e.pointerId !== undefined) {
          try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        fn();
        if (repeat) { this.attackHeld = true; this.attackRepeat = ATTACK_REPEAT; }
      });
      el.addEventListener('pointerup', () => { if (repeat) this.attackHeld = false; });
      el.addEventListener('pointercancel', () => { if (repeat) this.attackHeld = false; });
      el.addEventListener('pointerleave', (e) => { if (repeat && e.pointerType === 'mouse' && !e.buttons) this.attackHeld = false; });
    };
    bindBtn('btnA', () => this.sim.pressAttack(), true);
    bindBtn('btnQ', () => this.sim.tryCast('Q'));
    bindBtn('btnW', () => this.sim.tryCast('W'));
    bindBtn('btnE', () => this.sim.tryCast('E'));
    bindBtn('btnR', () => this.sim.tryCast('R'));

    // keyboard: WASD moves, QER cast, W needs an alias because it also walks
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if (!e.repeat) {
        if (k === 'q' || k === '1') this.sim.tryCast('Q');
        else if (k === '2' || k === 'f' || (k === 'w' && (e.shiftKey || this.keys.has('shift')))) this.sim.tryCast('W');
        else if (k === 'e' || k === '3') this.sim.tryCast('E');
        else if (k === 'r' || k === '4') this.sim.tryCast('R');
        else if (k === ' ' || k === 'j') { this.sim.pressAttack(); this.attackHeld = true; this.attackRepeat = ATTACK_REPEAT; }
      }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'j') this.attackHeld = false;
      this.keys.delete(k);
    });
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
  }

  setKnob(dx, dy) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  update(dt) {
    // merge joystick + WASD/arrows onto one normalised (dir, mag)
    let x = this.joyVec.x, y = this.joyVec.y, mag = this.joyVec.mag;
    if (mag <= 0) {
      let kx = 0, ky = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1;
      const l = Math.hypot(kx, ky);
      if (l > 0) { x = kx / l; y = ky / l; mag = 1; }
      else { x = 0; y = 0; mag = 0; }
    }
    // screen space → world: screen right = +X, screen up = -Z
    this.sim.setMove(x, y, mag);
    if (this.attackHeld) {
      this.attackRepeat -= dt;
      if (this.attackRepeat <= 0) { this.attackRepeat = ATTACK_REPEAT; this.sim.pressAttack(); }
    }
  }
}
