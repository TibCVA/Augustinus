// Touch joystick (left half) + ability buttons + WASD/QWER keyboard.
// Pointer events with touch fallback; safe against multi-touch.
//
// The joystick and the keyboard feed the *same* normalised (dir, mag) pair into
// sim.setMove, so a champion driven by a thumb and one driven by WASD accelerate,
// pivot and stop identically. Past the dead zone the magnitude curve starts at
// WALK so there is never a band of travel that visibly does nothing.
const DEAD = 0.18;     // fraction of knob travel treated as slack
const WALK = 0.45;     // magnitude the moment you leave the dead zone
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
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > this.R) { dx = dx / len * this.R; dy = dy / len * this.R; }
      this.setKnob(dx, dy);   // knob tracks the finger 1:1, dead zone or not
      const t = Math.min(1, len / this.R);
      if (t <= DEAD || len < 1e-3) {
        this.joyVec.mag = 0;
      } else {
        // direction is pure (unit vector); magnitude carries the tilt
        this.joyVec.x = dx / len;
        this.joyVec.y = dy / len;
        this.joyVec.mag = WALK + (1 - WALK) * ((t - DEAD) / (1 - DEAD));
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
        fn();
        if (repeat) { this.attackHeld = true; this.attackRepeat = ATTACK_REPEAT; }
      });
      el.addEventListener('pointerup', () => { if (repeat) this.attackHeld = false; });
      el.addEventListener('pointercancel', () => { if (repeat) this.attackHeld = false; });
      el.addEventListener('pointerleave', () => { if (repeat) this.attackHeld = false; });
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
