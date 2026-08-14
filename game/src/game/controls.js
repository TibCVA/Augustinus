// Touch joystick (left half) + ability buttons + WASD/QWER keyboard.
// Pointer events with touch fallback; safe against multi-touch.
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
      }
    };
    const pMove = (e) => {
      if (this.joyId !== (e.pointerId ?? 'mouse')) return;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > this.R) { dx = dx / len * this.R; dy = dy / len * this.R; }
      this.setKnob(dx, dy);
      this.joyVec.x = dx / this.R;
      this.joyVec.y = dy / this.R;
      this.joyVec.mag = Math.min(1, len / this.R);
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

    // ability buttons
    const bindBtn = (id, fn, repeat = false) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        fn();
        if (repeat) { this.attackHeld = true; this.attackRepeat = 0.28; }
      });
      el.addEventListener('pointerup', () => { if (repeat) this.attackHeld = false; });
      el.addEventListener('pointercancel', () => { if (repeat) this.attackHeld = false; });
    };
    bindBtn('btnA', () => this.sim.pressAttack(), true);
    bindBtn('btnQ', () => this.sim.tryCast('Q'));
    bindBtn('btnW', () => this.sim.tryCast('W'));
    bindBtn('btnE', () => this.sim.tryCast('E'));
    bindBtn('btnR', () => this.sim.tryCast('R'));

    // keyboard
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.repeat) return;
      if (k === 'q') this.sim.tryCast('Q');
      else if (k === 'w' && (this.keys.has('shift') || false)) this.sim.tryCast('W');
      else if (k === 'e') this.sim.tryCast('E');
      else if (k === 'r') this.sim.tryCast('R');
      else if (k === ' ' || k === 'j') this.sim.pressAttack();
      this.keys.add(k);
      // W doubles as movement; shift+W casts — also map '2' to W cast
      if (k === '2') this.sim.tryCast('W');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  setKnob(dx, dy) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  update(dt) {
    // merge joystick + WASD/arrows
    let x = this.joyVec.x, y = this.joyVec.y, mag = this.joyVec.mag;
    if (mag < 0.05) {
      let kx = 0, ky = 0;
      if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1;
      const l = Math.hypot(kx, ky);
      if (l > 0) { x = kx / l; y = ky / l; mag = 1; }
    }
    // screen space → world: screen right = +X, screen up = -Z
    this.sim.setMove(x, y, mag);
    if (this.attackHeld) {
      this.attackRepeat -= dt;
      if (this.attackRepeat <= 0) { this.attackRepeat = 0.28; this.sim.pressAttack(); }
    }
  }
}
