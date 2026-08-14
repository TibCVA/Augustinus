// DOM HUD: hero plate, ability cluster states, lane minimap canvas, floating
// combat text, kill feed, announcements, end screen.
// Every element ref is cached; the per-frame loop only writes values that
// actually changed and never reads layout.
import * as THREE from 'three';
import { tex } from '../core/assets.js';
import { A } from '../world/arena.js';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cam = { x: 0, z: 0, hw: 0, hd: 0, ok: false };

const AB_KEYS = ['Q', 'W', 'E', 'R'];
const AB_MANA = { Q: 20, W: 25, E: 30, R: 60 };
const AB_MAX = { Q: 5.5, W: 9.5, E: 11, R: 46 };
const AB_RANKS = { Q: 5, W: 5, E: 5, R: 3 };
const AB_REQ = { Q: 1, W: 1, E: 1, R: 5 };

// screen-space stacking slots so simultaneous numbers never sit on top of
// each other (first free slot wins)
const STACK = [[0, 0], [36, -14], [-36, -14], [18, -32], [-18, -32], [0, -50], [52, -42], [-52, -42]];

const DEG = Math.PI / 180;

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hpFill: $('hpFill'), hpGhost: $('hpGhost'), hpText: $('hpText'),
      mpFill: $('mpFill'), mpText: $('mpText'), xpFill: $('xpFill'),
      level: $('levelBadge'), portrait: $('portraitImg'),
      ticks: document.querySelector('.barTicks'),
      gold: $('statGold'), cs: $('statCS'), kda: $('statKDA'),
      scoreBlue: $('scoreBlue'), scoreRed: $('scoreRed'), timer: $('gameTimer'),
      feed: $('killFeed'), dmgLayer: $('dmgLayer'),
      announce: $('announce'), annTitle: $('announceTitle'), annSub: $('announceSub'),
      end: $('endScreen'), endBanner: $('endBanner'), endStats: $('endStats'), endReplay: $('endReplay'),
      minimap: $('minimap'), cluster: $('abilityCluster'),
      btns: { A: $('btnA'), Q: $('btnQ'), W: $('btnW'), E: $('btnE'), R: $('btnR') },
    };
    this.el.portrait.style.setProperty('--portrait', `url(${tex.portraitURL})`);

    // ---- ability button state cache -------------------------------------
    this.ab = {};
    for (const k of ['A', 'Q', 'W', 'E', 'R']) {
      const el = this.el.btns[k];
      this.ab[k] = {
        el,
        sweep: el.querySelector('.abSweep'),
        cd: el.querySelector('.abCd'),
        pips: el.querySelector('.abPips'),
        state: '', deg: -1, txt: '', prevCd: null, castT: 0, castCls: '', castAlt: false,
      };
    }
    this.setState(this.ab.A, 'ready');

    // ---- minimap --------------------------------------------------------
    this.mm = this.el.minimap.getContext('2d');
    this.mmW = this.el.minimap.width;
    this.mmH = this.el.minimap.height;
    const pad = 11;
    this.mmHX = A.HALF_X + 2;              // world half-extent along the lane
    this.mmS = (this.mmW - pad * 2) / (this.mmHX * 2);
    this.mmSZ = this.mmS * 1.2;            // slight vertical exaggeration: 114x34 is unreadable at 1:1
    this.mmCx = this.mmW * 0.5;
    this.mmCy = this.mmH * 0.5;
    this.mmT = 0;

    this.txtT = 0;
    this.annT = 0;
    this.lastVals = {};
    this.ghostV = -1;
    this.ghostHold = 0;
    this.vw = innerWidth; this.vh = innerHeight;
    addEventListener('resize', () => { this.vw = innerWidth; this.vh = innerHeight; });

    // ---- floating combat text pool --------------------------------------
    this.nums = [];
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('div');
      el.className = 'dmgNum';
      el.style.display = 'none';
      const out = document.createElement('span');
      out.className = 'dmgOut';
      const inn = document.createElement('span');
      inn.className = 'dmgIn';
      el.appendChild(out);
      el.appendChild(inn);
      this.el.dmgLayer.appendChild(el);
      this.nums.push({
        el, out, inn, active: false, t: 0, life: 1, wp: new THREE.Vector3(),
        ox: 0, oy: 0, vx: 0, sx: 0, sy: 0, hw: 20, hh: 11, peak: 1.15, rot: 0, kind: '',
      });
    }
    this.seq = 0;

    this.feedRows = [];
    this.el.endReplay.addEventListener('click', () => {
      const u = new URL(location.href);
      u.searchParams.delete('shot');
      location.href = u.toString();
    });
    this.camera = null;
    this.sim = null;
  }

  bind(sim, camera) {
    this.sim = sim;
    this.camera = camera;
  }

  // wipe transient overlays (combat text, feed, announce) — used by staging
  reset() {
    for (const n of this.nums) { n.active = false; n.el.style.display = 'none'; }
    for (const r of this.feedRows) r.el.remove();
    this.feedRows.length = 0;
    this.el.announce.style.opacity = '0';
    this.annT = 0;
    this.txtT = 0;
    this.lastVals = {};
    this.ghostV = -1;
    this.ghostHold = 0;
    this.seq = 0;
    for (const k of AB_KEYS) {
      const a = this.ab[k];
      a.prevCd = null; a.castT = 0; a.castCls = '';
      a.el.classList.remove('cast');
      a.el.classList.remove('cast2');
    }
    this.snapStates();
  }

  // suppress state cross-fades for one frame so a staged/respawned HUD paints
  // its final look immediately instead of easing into it
  snapStates() {
    const cl = this.el.cluster;
    if (!cl) return;
    cl.classList.add('snap');
    if (this.snapT) clearTimeout(this.snapT);
    this.snapT = setTimeout(() => cl.classList.remove('snap'), 60);
  }

  // ------------------------------------------------------------- announce --
  announce(title, sub = '', kind = 'kill') {
    this.el.annTitle.textContent = title;
    this.el.annSub.textContent = sub;
    this.el.annTitle.style.color = kind === 'bad' ? '#ff8f7a' : kind === 'level' ? '#aef0ff' : '#ffd98c';
    this.el.announce.style.opacity = '1';
    this.annT = 2.4;
  }

  killFeed(killer, kTeam, victim, vTeam) {
    const row = document.createElement('div');
    row.className = 'feedRow';
    row.innerHTML = `<span class="${kTeam}">${killer}</span><span class="x">⚔</span><span class="${vTeam}">${victim}</span>`;
    this.el.feed.prepend(row);
    this.feedRows.push({ el: row, t: 6.5 });
    while (this.feedRows.length > 4) {
      const r = this.feedRows.shift();
      r.el.remove();
    }
  }

  // -------------------------------------------------- floating combat text --
  damageNumber(worldPos, text, kind = 'phys') {
    let slot = null;
    for (const n of this.nums) { if (!n.active) { slot = n; break; } }
    if (!slot) slot = this.nums[0];
    const crit = kind === 'crit';
    const s = String(text);
    slot.active = true;
    slot.t = 0;
    slot.life = crit ? 1.15 : kind === 'gold' ? 1.0 : 0.9;
    slot.wp.copy(worldPos);
    slot.wp.y += 1.35;
    slot.kind = kind;
    slot.peak = crit ? 1.42 : kind === 'taken' ? 1.2 : 1.16;
    slot.rot = crit ? ((this.seq & 1) ? 3.5 : -3.5) : 0;
    slot.vx = ((this.seq % 3) - 1) * 16 + (crit ? 0 : 6);
    slot.ox = 0; slot.oy = 0;
    slot.hw = s.length * (crit ? 9 : kind === 'gold' ? 4.4 : 5.6) + 8;
    slot.hh = crit ? 16 : 11;
    this.seq++;
    if (slot.el.className !== 'dmgNum ' + kind) slot.el.className = 'dmgNum ' + kind;
    if (slot.out.textContent !== s) { slot.out.textContent = s; slot.inn.textContent = s; }
    slot.el.style.display = 'block';

    // resolve against everything currently on screen
    this.placeNum(slot);
    const bx = slot.sx, by = slot.sy;
    for (let i = 0; i < STACK.length; i++) {
      const ox = STACK[i][0], oy = STACK[i][1];
      const x = bx + ox, y = by + oy;
      let clash = false;
      for (const n of this.nums) {
        if (n === slot || !n.active) continue;
        if (Math.abs(n.sx - x) < n.hw + slot.hw && Math.abs(n.sy - y) < n.hh + slot.hh) { clash = true; break; }
      }
      slot.ox = ox; slot.oy = oy;
      if (!clash) break;
    }
    this.placeNum(slot);
  }

  placeNum(n) {
    if (!this.camera) return;
    const t = n.t;
    _v.copy(n.wp);
    _v.project(this.camera);
    // arc: quick pop upward that decelerates, plus a lateral drift
    const rise = 52 * t - 20 * t * t;
    const x = (_v.x * 0.5 + 0.5) * this.vw + n.ox + n.vx * t;
    const y = (-_v.y * 0.5 + 0.5) * this.vh + n.oy - rise;
    n.sx = x; n.sy = y;
    // scale punch: overshoot then settle
    let s;
    if (t < 0.07) s = 0.46 + (n.peak - 0.46) * (t / 0.07);
    else s = n.peak - (n.peak - 1) * Math.min(1, (t - 0.07) / 0.17);
    const fadeAt = n.life * 0.55;
    const o = t <= fadeAt ? 1 : Math.max(0, 1 - (t - fadeAt) / (n.life - fadeAt));
    n.el.style.transform =
      `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%,-100%) scale(${s.toFixed(3)})` +
      (n.rot ? ` rotate(${n.rot}deg)` : '');
    n.el.style.opacity = o.toFixed(2);
  }

  showEnd(victory, player, time) {
    this.el.end.style.display = 'flex';
    this.el.endBanner.textContent = victory ? 'VICTORY' : 'DEFEAT';
    this.el.endBanner.className = victory ? '' : 'defeat';
    const mm = Math.floor(time / 60), ss = Math.floor(time % 60);
    this.el.endStats.innerHTML =
      `<b>${player.kills}</b> / ${player.deaths} &nbsp;·&nbsp; <b>${player.cs}</b> CS &nbsp;·&nbsp; <b>${Math.floor(player.gold)}</b> gold &nbsp;·&nbsp; ${mm}:${String(ss).padStart(2, '0')}`;
  }

  // ------------------------------------------------------- ability buttons --
  setState(a, state) {
    if (a.state === state) return;
    if (a.state) a.el.classList.remove(a.state);
    a.el.classList.add(state);
    a.state = state;
  }

  updateAbilities(p, dt) {
    for (const k of AB_KEYS) {
      const a = this.ab[k];
      const cd = p.cds[k];
      const locked = p.level < AB_REQ[k];
      const state = locked ? 'locked'
        : cd > 0 ? 'cooling'
          : p.mana < AB_MANA[k] ? 'noMana' : 'ready';
      this.setState(a, state);

      // cast / press feedback: cooldown jumped up from zero.
      // alternate two identical classes so the keyframes restart without a
      // forced reflow (no layout reads in the frame loop)
      if (!locked && a.prevCd !== null && cd > a.prevCd + 0.05 && a.prevCd <= 0.02) {
        const on = a.castAlt ? 'cast2' : 'cast';
        if (a.castCls) a.el.classList.remove(a.castCls);
        a.el.classList.add(on);
        a.castCls = on;
        a.castAlt = !a.castAlt;
        a.castT = 0.45;
      }
      a.prevCd = cd;
      if (a.castT > 0) {
        a.castT -= dt;
        if (a.castT <= 0 && a.castCls) { a.el.classList.remove(a.castCls); a.castCls = ''; }
      }

      if (state === 'cooling') {
        const deg = Math.round((1 - cd / AB_MAX[k]) * 180) * 2;
        if (a.deg !== deg) {
          a.deg = deg;
          const e = Math.min(360, deg + 3);
          a.sweep.style.background =
            `conic-gradient(rgba(255,244,214,0.16) 0deg ${deg}deg,` +
            `rgba(255,236,186,0.95) ${deg}deg ${e}deg,` +
            `rgba(2,4,10,0.9) ${e}deg 360deg)`;
        }
        const t = cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1);
        if (a.txt !== t) { a.txt = t; a.cd.textContent = t; }
      } else {
        if (a.deg !== -1) { a.deg = -1; a.sweep.style.background = 'none'; }
        if (a.txt !== '') { a.txt = ''; a.cd.textContent = ''; }
      }
    }
  }

  // --------------------------------------------------------------- update --
  update(dt) {
    const sim = this.sim;
    if (!sim) return;
    const p = sim.player;
    const L = this.lastVals;

    // ---- bars (transform-only writes, guarded) ----
    const hpF = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0;
    if (L.hp === undefined || Math.abs(L.hp - hpF) > 0.0015) {
      L.hp = hpF;
      this.el.hpFill.style.transform = `scaleX(${hpF.toFixed(4)})`;
    }
    // delayed "ghost" damage trail
    if (this.ghostV < 0) { this.ghostV = hpF; this.ghostHold = 0.42; }
    if (hpF < this.ghostV) {
      if (this.ghostHold > 0) this.ghostHold -= dt;
      else this.ghostV = Math.max(hpF, this.ghostV - dt * (0.5 + (this.ghostV - hpF) * 1.6));
    } else {
      this.ghostV = hpF;
      this.ghostHold = 0.42;
    }
    if (L.ghost === undefined || Math.abs(L.ghost - this.ghostV) > 0.0015) {
      L.ghost = this.ghostV;
      this.el.hpGhost.style.transform = `scaleX(${this.ghostV.toFixed(4)})`;
    }
    const mpF = p.maxMana > 0 ? Math.max(0, Math.min(1, p.mana / p.maxMana)) : 0;
    if (L.mp === undefined || Math.abs(L.mp - mpF) > 0.0025) {
      L.mp = mpF;
      this.el.mpFill.style.transform = `scaleX(${mpF.toFixed(4)})`;
    }
    const xpNeed = 60 + p.level * 55;
    const xpF = Math.max(0, Math.min(1, p.xp / xpNeed));
    if (L.xp === undefined || Math.abs(L.xp - xpF) > 0.004) {
      L.xp = xpF;
      this.el.xpFill.style.strokeDashoffset = (286.5 * (1 - xpF)).toFixed(1);
    }

    this.updateAbilities(p, dt);

    // ---- level-driven chrome (rank pips, badge, HP segment ticks) ----
    if (L.lvl !== p.level) {
      L.lvl = p.level;
      this.el.level.textContent = p.level;
      const ranks = {
        Q: Math.min(5, 1 + Math.floor(p.level / 3)),
        W: Math.min(5, 1 + Math.floor((p.level - 1) / 3)),
        E: Math.min(5, 1 + Math.floor((p.level - 2) / 3)),
        R: p.level >= 13 ? 3 : p.level >= 9 ? 2 : p.level >= 5 ? 1 : 0,
      };
      for (const k of AB_KEYS) {
        const pips = this.ab[k].pips;
        if (!pips) continue;
        let html = '';
        for (let i = 0; i < AB_RANKS[k]; i++) html += `<i class="pip${i < ranks[k] ? ' on' : ''}"></i>`;
        pips.innerHTML = html;
      }
    }
    if (L.maxHp !== p.maxHp && this.el.ticks) {
      L.maxHp = p.maxHp;
      const seg = Math.max(4, Math.min(10, Math.round(p.maxHp / 180)));
      this.el.ticks.style.setProperty('--seg', (100 / seg).toFixed(3) + '%');
    }

    // ---- throttled text ----
    this.txtT -= dt;
    if (this.txtT <= 0) {
      this.txtT = 0.2;
      const set = (el, v) => { if (L[el.id] !== v) { L[el.id] = v; el.textContent = v; } };
      set(this.el.gold, String(Math.floor(p.gold)));
      set(this.el.cs, String(p.cs));
      const kda = `${p.kills}/${p.deaths}/${Math.floor(p.cs / 10)}`;
      if (L.kda !== kda) {
        L.kda = kda;
        this.el.kda.innerHTML =
          `<span class="k">${p.kills}</span><em>/</em><span class="d">${p.deaths}</span><em>/</em><span class="a">${Math.floor(p.cs / 10)}</span>`;
      }
      set(this.el.scoreBlue, String(sim.score.blue));
      set(this.el.scoreRed, String(sim.score.red));
      const mm = Math.floor(sim.time / 60), ss = Math.floor(sim.time % 60);
      set(this.el.timer, `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
      set(this.el.hpText, `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`);
      set(this.el.mpText, `${Math.ceil(p.mana)}/${p.maxMana}`);
    }

    // ---- floating combat text ----
    for (const n of this.nums) {
      if (!n.active) continue;
      n.t += dt;
      if (n.t >= n.life) { n.active = false; n.el.style.display = 'none'; continue; }
      this.placeNum(n);
    }
    // ---- announce fade ----
    if (this.annT > 0) {
      this.annT -= dt;
      if (this.annT <= 0) this.el.announce.style.opacity = '0';
    }
    // ---- kill feed fade ----
    for (let i = this.feedRows.length - 1; i >= 0; i--) {
      const r = this.feedRows[i];
      r.t -= dt;
      if (r.t < 1) r.el.style.opacity = Math.max(0, r.t).toFixed(2);
      if (r.t <= 0) { r.el.remove(); this.feedRows.splice(i, 1); }
    }
    // ---- minimap ~8 Hz ----
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.12;
      this.drawMinimap();
    }
  }

  // -------------------------------------------------------------- minimap --
  drawMinimap() {
    const ctx = this.mm, sim = this.sim;
    const W = this.mmW, H = this.mmH, s = this.mmS, sz = this.mmSZ;
    const sx = (x) => this.mmCx + x * s;
    const sy = (z) => this.mmCy + z * sz;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    this.rr(ctx, 1, 1, W - 2, H - 2, 27);
    ctx.clip();

    // parchment-dark backing
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(24,34,54,0.96)');
    bg.addColorStop(1, 'rgba(6,10,18,0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const x0 = sx(-A.HALF_X), x1 = sx(A.HALF_X);
    const z0 = sy(-A.EDGE_Z), z1 = sy(A.EDGE_Z);
    const bandH = z1 - z0;

    // ---- jungle / terrain band ----
    ctx.save();
    this.rr(ctx, x0, z0, x1 - x0, bandH, 20);
    ctx.clip();
    const gr = ctx.createLinearGradient(0, z0, 0, z1);
    gr.addColorStop(0, '#24401f');
    gr.addColorStop(0.5, '#4b7a40');
    gr.addColorStop(1, '#24401f');
    ctx.fillStyle = gr;
    ctx.fillRect(x0, z0, x1 - x0, bandH);

    // team territory wash
    const tw = ctx.createLinearGradient(x0, 0, x1, 0);
    tw.addColorStop(0, 'rgba(46,104,196,0.5)');
    tw.addColorStop(0.4, 'rgba(46,104,196,0.0)');
    tw.addColorStop(0.6, 'rgba(196,58,42,0.0)');
    tw.addColorStop(1, 'rgba(196,58,42,0.5)');
    ctx.fillStyle = tw;
    ctx.fillRect(x0, z0, x1 - x0, bandH);

    // lane road
    ctx.fillStyle = 'rgba(206,186,136,0.62)';
    this.rr(ctx, sx(-49), sy(-3.2), sx(49) - sx(-49), (sy(3.2) - sy(-3.2)), 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,208,160,0.35)';
    ctx.lineWidth = 1.4;
    this.rr(ctx, sx(-49), sy(-3.2), sx(49) - sx(-49), (sy(3.2) - sy(-3.2)), 9);
    ctx.stroke();

    // base discs
    for (const side of [-1, 1]) {
      const g = ctx.createRadialGradient(sx(side * A.BASE_X), this.mmCy, 4, sx(side * A.BASE_X), this.mmCy, A.BASE_R * s);
      const c = side < 0 ? '86,150,236' : '224,92,72';
      g.addColorStop(0, `rgba(${c},0.5)`);
      g.addColorStop(1, `rgba(${c},0.02)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(side * A.BASE_X), this.mmCy, A.BASE_R * s, 0, 7);
      ctx.fill();
    }

    // river + bridge
    const rvg = ctx.createLinearGradient(sx(-A.RIVER_HALF), 0, sx(A.RIVER_HALF), 0);
    rvg.addColorStop(0, 'rgba(52,166,186,0.7)');
    rvg.addColorStop(0.5, 'rgba(112,232,240,0.95)');
    rvg.addColorStop(1, 'rgba(52,166,186,0.7)');
    ctx.fillStyle = rvg;
    ctx.fillRect(sx(-A.RIVER_HALF), z0, sx(A.RIVER_HALF) - sx(-A.RIVER_HALF), bandH);
    ctx.fillStyle = 'rgba(206,190,150,0.9)';
    ctx.fillRect(sx(-A.RIVER_HALF) - 2, sy(-A.BRIDGE_HALF_Z), sx(A.RIVER_HALF) - sx(-A.RIVER_HALF) + 4, sy(A.BRIDGE_HALF_Z) - sy(-A.BRIDGE_HALF_Z));

    // jungle darkening top/bottom
    const jg = ctx.createLinearGradient(0, z0, 0, z1);
    jg.addColorStop(0, 'rgba(2,8,6,0.6)');
    jg.addColorStop(0.32, 'rgba(2,8,6,0)');
    jg.addColorStop(0.68, 'rgba(2,8,6,0)');
    jg.addColorStop(1, 'rgba(2,8,6,0.6)');
    ctx.fillStyle = jg;
    ctx.fillRect(x0, z0, x1 - x0, bandH);
    ctx.restore();

    // band outline
    ctx.strokeStyle = 'rgba(255,214,146,0.30)';
    ctx.lineWidth = 2;
    this.rr(ctx, x0, z0, x1 - x0, bandH, 20);
    ctx.stroke();

    if (sim) {
      // ---- camera view bracket (drawn under the icons) ----
      if (this.viewRect()) {
        const bx = sx(_cam.x), by = sy(_cam.z);
        const hw = Math.min(_cam.hw * s, (x1 - x0) * 0.46);
        const hd = Math.min(_cam.hd * sz, bandH * 0.44);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,240,200,0.62)';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;
        const L = Math.min(13, hw * 0.5), M = Math.min(11, hd * 0.5);
        ctx.beginPath();
        for (const [ox, oy, dx, dy] of [[-hw, -hd, 1, 1], [hw, -hd, -1, 1], [-hw, hd, 1, -1], [hw, hd, -1, -1]]) {
          ctx.moveTo(bx + ox + dx * L, by + oy);
          ctx.lineTo(bx + ox, by + oy);
          ctx.lineTo(bx + ox, by + oy + dy * M);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ---- towers ----
      for (const t of sim.towers) {
        this.towerIcon(ctx, sx(t.pos.x), sy(t.pos.z), t.team, t.alive);
      }
      // ---- nexus / team crest ----
      for (const n of sim.nexuses) {
        this.crestIcon(ctx, sx(n.pos.x), sy(n.pos.z), n.team, n.alive);
      }
      // ---- minions ----
      for (const m of sim.minions) {
        if (!m) continue;
        ctx.fillStyle = m.team === 'blue' ? '#7cc0ff' : '#ff9276';
        ctx.beginPath();
        ctx.arc(sx(m.pos.x), sy(m.pos.z), 2.6, 0, 7);
        ctx.fill();
      }
      // ---- heroes ----
      const bot = sim.bot;
      if (bot && bot.alive) this.heroIcon(ctx, sx(bot.pos.x), sy(bot.pos.z), bot.facing, '#ff5a3c', false);
      if (sim.player && sim.player.alive) this.heroIcon(ctx, sx(sim.player.pos.x), sy(sim.player.pos.z), sim.player.facing, '#6fe0ff', true);
    }

    // inner vignette so the frame reads as inset glass
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(0,0,0,0.34)');
    vg.addColorStop(0.2, 'rgba(0,0,0,0)');
    vg.addColorStop(0.8, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ground footprint of the current camera → _cam
  viewRect() {
    const cam = this.camera;
    if (!cam) return false;
    _dir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (_dir.y > -0.1) return false;
    const t = (0.7 - cam.position.y) / _dir.y;
    if (!(t > 0)) return false;
    _cam.x = cam.position.x + _dir.x * t;
    _cam.z = cam.position.z + _dir.z * t;
    const tanH = Math.tan(cam.fov * 0.5 * DEG);
    _cam.hw = t * tanH * cam.aspect;
    _cam.hd = t * tanH / Math.max(0.3, -_dir.y);
    return true;
  }

  towerIcon(ctx, x, y, team, alive) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(2,5,10,0.85)';
    ctx.fillStyle = !alive ? '#5a5f68' : team === 'blue' ? '#5aa4ff' : '#ff6a52';
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 6);
    ctx.lineTo(x - 5, y - 1.5);
    ctx.lineTo(x, y - 7);
    ctx.lineTo(x + 5, y - 1.5);
    ctx.lineTo(x + 5, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (alive) {
      ctx.strokeStyle = 'rgba(255,226,170,0.75)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x - 1.4, y - 0.6, 2.8, 3.4);
    } else {
      ctx.strokeStyle = 'rgba(20,24,30,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  crestIcon(ctx, x, y, team, alive) {
    const c = !alive ? '#6b6f78' : team === 'blue' ? '#7ec6ff' : '#ff8a6e';
    ctx.save();
    if (alive) { ctx.shadowColor = team === 'blue' ? 'rgba(90,180,255,0.9)' : 'rgba(255,110,80,0.9)'; ctx.shadowBlur = 8; }
    // shield crest
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 7.5, y - 6);
    ctx.lineTo(x + 7.5, y + 2.5);
    ctx.quadraticCurveTo(x + 7.5, y + 8.5, x, y + 11);
    ctx.quadraticCurveTo(x - 7.5, y + 8.5, x - 7.5, y + 2.5);
    ctx.lineTo(x - 7.5, y - 6);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(3,6,12,0.9)';
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = alive ? 'rgba(255,226,170,0.95)' : 'rgba(120,124,132,0.9)';
    ctx.stroke();
    // inner crystal mark
    ctx.fillStyle = alive ? 'rgba(255,255,255,0.92)' : 'rgba(40,44,52,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, y - 5.2); ctx.lineTo(x + 3.4, y); ctx.lineTo(x, y + 5.2); ctx.lineTo(x - 3.4, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  heroIcon(ctx, x, y, facing, col, isPlayer) {
    const r = isPlayer ? 8.2 : 7.2;
    ctx.save();
    ctx.translate(x, y);
    // facing wedge (world facing: +x = sin, +z = cos → screen angle)
    const ang = Math.atan2(Math.cos(facing || 0), Math.sin(facing || 0));
    ctx.save();
    ctx.rotate(-ang);
    ctx.fillStyle = isPlayer ? 'rgba(150,240,255,0.42)' : 'rgba(255,120,90,0.38)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 2.5, -0.45, 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // body
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = isPlayer ? '#ffffff' : 'rgba(3,6,12,0.92)';
    ctx.stroke();
    if (!isPlayer) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,190,170,0.75)';
      ctx.beginPath(); ctx.arc(0, 0, r - 1.3, 0, 7); ctx.stroke();
    }
    if (isPlayer) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.arc(0, 0, r + 1.8, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
}
