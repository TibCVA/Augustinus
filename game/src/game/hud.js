// DOM HUD: hero plate, ability cluster states, lane minimap canvas, floating
// combat text, kill feed, announcements, end screen.
// Every element ref is cached; the per-frame loop only writes values that
// actually changed and never reads layout.
import * as THREE from 'three';
import { tex } from '../core/assets.js';
import { A, isWalkable } from '../world/arena.js';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cam = { x: 0, z: 0, hw: 0, hd: 0, ok: false };

const AB_KEYS = ['Q', 'W', 'E', 'R'];
const AB_MANA = { Q: 20, W: 25, E: 30, R: 60 };
const AB_MAX = { Q: 5.5, W: 9.5, E: 11, R: 46 };
const AB_RANKS = { Q: 5, W: 5, E: 5, R: 3 };
const AB_REQ = { Q: 1, W: 1, E: 1, R: 5 };

// summoner column (hud-owned: neither spell touches sim state beyond the
// player's own hp / position, both of which the sim treats as authoritative
// per frame)
const MEND_CD = 100;      // s
const MEND_FRAC = 0.25;   // of max hp
const RECALL_CHANNEL = 5; // s, cancelled by damage or by moving

// screen-space stacking slots so simultaneous numbers never sit on top of
// each other (first free slot wins). Biased horizontal: stacked crits in the
// same fight used to climb straight into the score plate.
const STACK = [[0, 0], [44, -12], [-44, -12], [82, -26], [-82, -26], [24, -34], [-24, -34], [0, -52]];

const DEG = Math.PI / 180;
const sstep = (v, a, b) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

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
      minimap: $('minimap'), cluster: $('abilityCluster'), hud: $('hud'),
      items: Array.prototype.slice.call(document.querySelectorAll('#itemRail .itemSlot')),
      btns: { A: $('btnA'), Q: $('btnQ'), W: $('btnW'), E: $('btnE'), R: $('btnR') },
    };
    // painted bust, baked once; the flat two-tone vector face stays as the
    // context-loss fallback
    this.el.portrait.style.setProperty('--portrait', `url(${bakePortrait() || tex.portraitURL})`);

    // keycaps are a desktop tell on a touch HUD — reveal them only once the
    // player actually uses a keyboard (keyboard control itself is untouched)
    this.kbShown = false;
    addEventListener('keydown', (e) => {
      if (this.kbShown) return;
      const k = e.key.toLowerCase();
      if (k === 'q' || k === 'w' || k === 'e' || k === 'r' || k === 'f' || k === 'j' ||
          k === 'a' || k === 's' || k === 'd' || k === ' ' || (k >= '1' && k <= '4')) {
        this.kbShown = true;
        if (this.el.hud) this.el.hud.classList.add('kb');
      }
    }, { passive: true });

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

    // ---- summoner column ------------------------------------------------
    this.sum = {};
    for (const [key, id, max] of [['mend', 'sumMend', MEND_CD], ['recall', 'sumRecall', 0]]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const s = {
        el, sweep: el.querySelector('.sumSweep'), cd: el.querySelector('.sumCd'),
        t: 0, max, deg: -1, txt: '', cooling: false,
      };
      this.sum[key] = s;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.useSummoner(key);
      });
    }
    this.recall = { t: 0, x: 0, z: 0, hp: 0 };
    this.itemsOn = -1;

    // ---- minimap --------------------------------------------------------
    this.mm = this.el.minimap.getContext('2d');
    this.mmW = this.el.minimap.width;
    this.mmH = this.el.minimap.height;
    const pad = 11;
    this.mmHX = A.HALF_X + 2;              // world half-extent along the lane
    this.mmS = (this.mmW - pad * 2) / (this.mmHX * 2);
    this.mmSZ = this.mmS * 1.45;           // vertical exaggeration: a 114 x 21 walkable corridor is unreadable at 1:1
    this.mmCx = this.mmW * 0.5;
    this.mmCy = this.mmH * 0.5;
    this.mmT = 0;
    this.mmBase = this.bakeMinimapBase();   // static layer, baked once

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
    this.cancelRecall();
    for (const k in this.sum) {
      const s = this.sum[k];
      s.t = 0; s.deg = -1; s.txt = ''; s.cooling = false;
      s.cd.textContent = '';
      s.sweep.style.background = 'none';
      s.el.classList.remove('cooling');
    }
    this.itemsOn = -1;
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
    let x = (_v.x * 0.5 + 0.5) * this.vw + n.ox + n.vx * t;
    let y = (-_v.y * 0.5 + 0.5) * this.vh + n.oy - rise;
    // keep inside a safe rect: 8% off the top (score plate + timer live there)
    // and 4% off the sides, so a stacked crit never rides off the frame
    const mx = n.hw * 0.6, my = n.hh * 1.6;
    const lx = this.vw * 0.04 + mx, rx = this.vw * 0.96 - mx;
    const ty = this.vh * 0.08 + my, by = this.vh * 0.97;
    if (x < lx) x = lx; else if (x > rx) x = rx;
    if (y < ty) y = ty; else if (y > by) y = by;
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
          // dark scrim RECEDES over the icon (the universal read); the elapsed
          // wedge clears to almost nothing so the glyph comes back as it cools
          a.sweep.style.background =
            `conic-gradient(rgba(255,246,220,0.07) 0deg ${deg}deg,` +
            `rgba(255,242,200,0.9) ${deg}deg ${e}deg,` +
            `rgba(3,6,14,0.55) ${e}deg 360deg)`;
        }
        const t = cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1);
        if (a.txt !== t) { a.txt = t; a.cd.textContent = t; }
      } else {
        if (a.deg !== -1) { a.deg = -1; a.sweep.style.background = 'none'; }
        if (a.txt !== '') { a.txt = ''; a.cd.textContent = ''; }
      }
    }
  }

  // ------------------------------------------------------------ summoners --
  // Both spells are hud-owned and only ever touch the player's own hp /
  // position — the sim reads both fresh every step, so there is nothing to
  // desync. Cooldowns live here, not in sim.cds (which the ability sweep owns).
  useSummoner(key) {
    const p = this.sim && this.sim.player;
    if (!p || !p.alive) return;
    const s = this.sum[key];
    if (!s || s.t > 0) return;
    if (key === 'mend') {
      const amt = Math.min(p.maxHp - p.hp, p.maxHp * MEND_FRAC);
      if (amt <= 1) return;
      p.hp += amt;
      s.t = s.max;
      this.damageNumber(p.pos, '+' + Math.round(amt), 'heal');
    } else if (key === 'recall') {
      if (this.recall.t > 0) { this.cancelRecall(); return; }
      this.recall.t = RECALL_CHANNEL;
      this.recall.x = p.pos.x; this.recall.z = p.pos.z; this.recall.hp = p.hp;
      s.el.classList.add('channel');
    }
  }

  cancelRecall() {
    this.recall.t = 0;
    const s = this.sum.recall;
    if (!s) return;
    s.el.classList.remove('channel');
    s.deg = -1; s.sweep.style.background = 'none';
    if (s.txt !== '') { s.txt = ''; s.cd.textContent = ''; }
  }

  updateSummoners(dt) {
    const p = this.sim && this.sim.player;
    // --- recall channel: cancelled by damage, by moving, or by dying ---
    if (this.recall.t > 0) {
      const r = this.recall;
      if (!p || !p.alive || p.hp < r.hp - 0.5 ||
          Math.abs(p.pos.x - r.x) > 0.35 || Math.abs(p.pos.z - r.z) > 0.35) {
        this.cancelRecall();
      } else {
        r.hp = p.hp;
        r.t -= dt;
        if (r.t <= 0) {
          // home to the fountain apron: the sim's own heal zone takes it from here
          const fx = -A.FOUNTAIN_X + 1.2;
          p.pos.x = fx; p.pos.z = 0;
          const arena = this.sim.arena;
          if (arena && arena.groundHeight) p.pos.y = arena.groundHeight(fx, 0);
          this.cancelRecall();
          this.damageNumber(p.pos, 'RECALL', 'magic');
        }
      }
    }
    for (const key in this.sum) {
      const s = this.sum[key];
      const chan = key === 'recall' && this.recall.t > 0;
      if (s.t > 0) s.t = Math.max(0, s.t - dt);
      const cooling = s.t > 0;
      if (cooling !== s.cooling) {
        s.cooling = cooling;
        s.el.classList.toggle('cooling', cooling);
      }
      let deg = -1, txt = '';
      if (chan) {
        deg = Math.round((1 - this.recall.t / RECALL_CHANNEL) * 180) * 2;
        txt = this.recall.t.toFixed(1);
      } else if (cooling && s.max > 0) {
        deg = Math.round((1 - s.t / s.max) * 180) * 2;
        txt = s.t >= 1 ? String(Math.ceil(s.t)) : s.t.toFixed(1);
      }
      if (s.deg !== deg) {
        s.deg = deg;
        if (deg < 0) s.sweep.style.background = 'none';
        else {
          const e = Math.min(360, deg + 3);
          s.sweep.style.background = chan
            ? `conic-gradient(rgba(150,215,255,0.5) 0deg ${deg}deg,` +
              `rgba(226,244,255,0.95) ${deg}deg ${e}deg,rgba(4,10,22,0.42) ${e}deg 360deg)`
            : `conic-gradient(rgba(255,246,220,0.07) 0deg ${deg}deg,` +
              `rgba(255,242,200,0.9) ${deg}deg ${e}deg,rgba(3,6,14,0.55) ${e}deg 360deg)`;
        }
      }
      if (s.txt !== txt) { s.txt = txt; s.cd.textContent = txt; }
    }
  }

  // relic sockets fill on the level milestones the sim actually grants
  updateItems(level) {
    const items = this.el.items;
    if (!items || !items.length) return;
    let n = 0;
    for (let i = 0; i < items.length; i++) if (level >= +items[i].dataset.lv) n++;
    if (n === this.itemsOn) return;
    const first = this.itemsOn < 0;
    for (let i = 0; i < items.length; i++) {
      const on = i < n;
      items[i].classList.toggle('on', on);
      // each socket only ever unlocks once, so adding the class is enough to
      // start the animation — no reflow poke, no layout read in the loop
      if (on && !first && i >= this.itemsOn) items[i].classList.add('pop');
    }
    this.itemsOn = n;
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
    this.updateSummoners(dt);

    // ---- level-driven chrome (rank pips, badge, HP segment ticks) ----
    if (L.lvl !== p.level) {
      L.lvl = p.level;
      this.el.level.textContent = p.level;
      this.updateItems(p.level);
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

  // ------------------------------------------------------------ minimap ----
  // STATIC LAYER, baked once at boot. The terrain outline is the real
  // collision mask (isWalkable), the lane is drawn at its true half-width
  // with the bridge pinch, and the plateaus are ellipses because the map's
  // x and z scales differ (mmS 3.68 vs mmSZ 5.52 — an arc would be wrong).
  // ~460 mask probes: far too expensive to repeat at 8 Hz.
  bakeMinimapBase() {
    const W = this.mmW, H = this.mmH, s = this.mmS, sz = this.mmSZ;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const sx = (x) => this.mmCx + x * s;
    const sy = (z) => this.mmCy + z * sz;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(21,30,49,0.96)');
    bg.addColorStop(1, 'rgba(5,8,16,0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ---- walkable mask → one z-span per column ----
    // for any x the walkable set is a single interval symmetric about z=0, so
    // a binary search on |z| is exact (and 9 probes instead of a full scan)
    const top = [], bot = [];
    for (let px = 0; px <= W; px += 3) {
      const wx = (px - this.mmCx) / s;
      if (!isWalkable(wx, 0)) continue;
      let lo = 0, hi = A.EDGE_Z + 2;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) * 0.5;
        if (isWalkable(wx, mid)) lo = mid; else hi = mid;
      }
      top.push(px, sy(-lo));
      bot.push(px, sy(lo));
    }
    const silhouette = () => {
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      for (let i = 2; i < top.length; i += 2) ctx.lineTo(top[i], top[i + 1]);
      for (let i = bot.length - 2; i >= 0; i -= 2) ctx.lineTo(bot[i], bot[i + 1]);
      ctx.closePath();
    };

    ctx.save();
    this.rr(ctx, 1, 1, W - 2, H - 2, 27);
    ctx.clip();

    // soft drop under the island so it sits on the panel
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 7; ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(10,16,12,0.9)';
    silhouette(); ctx.fill();
    ctx.restore();

    ctx.save();
    silhouette();
    ctx.clip();

    // ---- terrain ----
    const gr = ctx.createLinearGradient(0, sy(-A.WALK_Z), 0, sy(A.WALK_Z));
    gr.addColorStop(0, '#1e3f1c');
    gr.addColorStop(0.13, '#417f37');
    gr.addColorStop(0.5, '#4f9243');
    gr.addColorStop(0.87, '#417f37');
    gr.addColorStop(1, '#1e3f1c');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);

    // team territory wash
    const tw = ctx.createLinearGradient(sx(-A.HALF_X), 0, sx(A.HALF_X), 0);
    tw.addColorStop(0, 'rgba(46,104,196,0.5)');
    tw.addColorStop(0.42, 'rgba(46,104,196,0.0)');
    tw.addColorStop(0.58, 'rgba(196,58,42,0.0)');
    tw.addColorStop(1, 'rgba(196,58,42,0.5)');
    ctx.fillStyle = tw;
    ctx.fillRect(0, 0, W, H);

    // ---- base plateaus (ellipse: the two axes are not the same scale) ----
    for (const side of [-1, 1]) {
      const bx = sx(side * A.BASE_X), r = A.BASE_R - 0.6;
      ctx.fillStyle = 'rgba(96,104,110,0.42)';
      ctx.beginPath();
      ctx.ellipse(bx, this.mmCy, r * s, r * sz, 0, 0, 7);
      ctx.fill();
      ctx.save();
      ctx.translate(bx, this.mmCy);
      ctx.scale(1, sz / s);
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, A.BASE_R * s);
      const col = side < 0 ? '86,150,236' : '224,92,72';
      g.addColorStop(0, `rgba(${col},0.85)`);
      g.addColorStop(0.55, `rgba(${col},0.42)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, A.BASE_R * s, 0, 7);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = side < 0 ? 'rgba(150,200,255,0.45)' : 'rgba(255,160,130,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(bx, this.mmCy, r * s, r * sz, 0, 0, 7);
      ctx.stroke();
    }

    // ---- lane at true width, pinched over the bridge ----
    const lanePath = () => {
      ctx.beginPath();
      for (let x = -49; x <= 49.001; x += 1) {
        const hw = A.LANE_HALF * (1 - 0.26 * (1 - sstep(Math.abs(x), A.RIVER_HALF, A.BRIDGE_HALF_X + 3.4)));
        const px = sx(x), py = sy(-hw);
        if (x === -49) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      for (let x = 49; x >= -49.001; x -= 1) {
        const hw = A.LANE_HALF * (1 - 0.26 * (1 - sstep(Math.abs(x), A.RIVER_HALF, A.BRIDGE_HALF_X + 3.4)));
        ctx.lineTo(sx(x), sy(hw));
      }
      ctx.closePath();
    };
    const lg = ctx.createLinearGradient(0, sy(-A.LANE_HALF), 0, sy(A.LANE_HALF));
    lg.addColorStop(0, 'rgba(150,130,88,0.9)');
    lg.addColorStop(0.5, 'rgba(203,184,136,0.94)');
    lg.addColorStop(1, 'rgba(150,130,88,0.9)');
    lanePath(); ctx.fillStyle = lg; ctx.fill();
    lanePath(); ctx.strokeStyle = 'rgba(238,224,178,0.45)'; ctx.lineWidth = 1.4; ctx.stroke();

    ctx.restore();

    // ---- river gorge: it CUTS the island, so it is drawn outside the
    // walkable clip (the water is not walkable and the mask has a hole there)
    const r0 = sx(-A.RIVER_HALF - 1.5), r1 = sx(A.RIVER_HALF + 1.5);
    const gz0 = sy(-A.WALK_Z - 1.7), gz1 = sy(A.WALK_Z + 1.7);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r0, gz0, r1 - r0, gz1 - gz0);
    ctx.clip();
    const rvg = ctx.createLinearGradient(r0, 0, r1, 0);
    rvg.addColorStop(0, 'rgba(46,150,176,0)');
    rvg.addColorStop(0.2, 'rgba(58,178,200,0.62)');
    rvg.addColorStop(0.5, 'rgba(118,234,242,0.9)');
    rvg.addColorStop(0.8, 'rgba(58,178,200,0.62)');
    rvg.addColorStop(1, 'rgba(46,150,176,0)');
    ctx.fillStyle = rvg;
    ctx.fillRect(r0, gz0, r1 - r0, gz1 - gz0);
    // the gorge mouths fade into the cliff instead of stopping dead
    const rvv = ctx.createLinearGradient(0, gz0, 0, gz1);
    rvv.addColorStop(0, 'rgba(5,13,20,0.92)');
    rvv.addColorStop(0.24, 'rgba(5,13,20,0)');
    rvv.addColorStop(0.76, 'rgba(5,13,20,0)');
    rvv.addColorStop(1, 'rgba(5,13,20,0.92)');
    ctx.fillStyle = rvv;
    ctx.fillRect(r0, gz0, r1 - r0, gz1 - gz0);
    ctx.restore();

    ctx.save();
    silhouette();
    ctx.clip();
    // bridge
    const bz0 = sy(-A.BRIDGE_HALF_Z + 0.15), bz1 = sy(A.BRIDGE_HALF_Z - 0.15);
    ctx.fillStyle = 'rgba(196,178,138,0.95)';
    ctx.fillRect(sx(-A.BRIDGE_HALF_X), bz0, sx(A.BRIDGE_HALF_X) - sx(-A.BRIDGE_HALF_X), bz1 - bz0);
    ctx.strokeStyle = 'rgba(60,46,28,0.7)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(sx(-A.BRIDGE_HALF_X), bz0, sx(A.BRIDGE_HALF_X) - sx(-A.BRIDGE_HALF_X), bz1 - bz0);
    ctx.strokeStyle = 'rgba(84,64,38,0.45)';
    ctx.lineWidth = 1;
    for (let x = -A.BRIDGE_HALF_X + 2.1; x < A.BRIDGE_HALF_X - 0.5; x += 2.1) {
      ctx.beginPath(); ctx.moveTo(sx(x), bz0 + 1); ctx.lineTo(sx(x), bz1 - 1); ctx.stroke();
    }

    // ---- cliff shading along the rim + top/bottom falloff ----
    const jg = ctx.createLinearGradient(0, sy(-A.WALK_Z - 1), 0, sy(A.WALK_Z + 1));
    jg.addColorStop(0, 'rgba(2,10,8,0.45)');
    jg.addColorStop(0.17, 'rgba(2,10,8,0)');
    jg.addColorStop(0.83, 'rgba(2,10,8,0)');
    jg.addColorStop(1, 'rgba(2,10,8,0.45)');
    ctx.fillStyle = jg;
    ctx.fillRect(0, 0, W, H);
    // inner rim darkening reads as a cliff edge, not a cut-out
    silhouette();
    ctx.strokeStyle = 'rgba(10,26,14,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // island outline
    silhouette();
    ctx.strokeStyle = 'rgba(160,190,130,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    return c;
  }

  drawMinimap() {
    const ctx = this.mm, sim = this.sim;
    const W = this.mmW, H = this.mmH, s = this.mmS, sz = this.mmSZ;
    const sx = (x) => this.mmCx + x * s;
    const sy = (z) => this.mmCy + z * sz;
    const bandH = (A.WALK_Z + 1.5) * 2 * sz;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    this.rr(ctx, 1, 1, W - 2, H - 2, 27);
    ctx.clip();
    if (this.mmBase) ctx.drawImage(this.mmBase, 0, 0);

    const x0 = sx(-A.HALF_X), x1 = sx(A.HALF_X);

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

      // ---- towers (+ structure health pip) ----
      for (const t of sim.towers) {
        const tx = sx(t.pos.x), ty = sy(t.pos.z);
        this.towerIcon(ctx, tx, ty, t.team, t.alive);
        if (t.alive && t.maxHp) this.hpPip(ctx, tx, ty + 9, t.hp / t.maxHp, t.team);
      }
      // ---- nexus / team crest (+ structure health pip) ----
      for (const n of sim.nexuses) {
        const nx = sx(n.pos.x), ny = sy(n.pos.z);
        this.crestIcon(ctx, nx, ny, n.team, n.alive);
        if (n.alive && n.maxHp) this.hpPip(ctx, nx, ny + 14, n.hp / n.maxHp, n.team);
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

  // structure health, framed dark so it survives against pale terrain
  hpPip(ctx, x, y, f, team) {
    const w = 15, h = 3.4;
    const v = Math.max(0, Math.min(1, f));
    if (v > 0.995) return;
    ctx.fillStyle = 'rgba(2,4,9,0.9)';
    ctx.fillRect(x - w * 0.5 - 1.2, y - 1.2, w + 2.4, h + 2.4);
    ctx.fillStyle = team === 'blue' ? '#4fa8ff' : '#e0342a';
    ctx.fillRect(x - w * 0.5, y, w * v, h);
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


// =====================================================================
// HERO PORTRAIT — painted bust, baked once into a data URL.
// The shipped placeholder was a 128px two-dot-eyes vector face sitting
// 40px from the rendered hero; this is the same character (blonde,
// circlet + gem, white/blue/gold plate, blue cape) painted with form
// shading, a lit/shadow split, real eyes and a rim light, so the plate
// stops reading as a prototype at 54-108 device px.
// =====================================================================
function bakePortrait() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    if (!g) return null;
    paintSeraBust(g, 256);
    return c.toDataURL();
  } catch (e) {
    return null;   // context-loss / tainted canvas: fall back to tex.portraitURL
  }
}

function paintSeraBust(g, S) {
  const u = S / 256;                       // authored against a 256 canvas
  const rgba = (h, a) => `rgba(${(h >> 16) & 255},${(h >> 8) & 255},${h & 255},${a})`;
  const blob = (x, y, r, col, a, a2 = 0) => {
    const rg = g.createRadialGradient(x * u, y * u, 0, x * u, y * u, r * u);
    rg.addColorStop(0, rgba(col, a)); rg.addColorStop(1, rgba(col, a2));
    g.fillStyle = rg; g.beginPath(); g.arc(x * u, y * u, r * u, 0, 7); g.fill();
  };
  const ell = (x, y, rx, ry, rot, col) => {
    g.fillStyle = typeof col === 'string' ? col : rgba(col, 1);
    g.beginPath(); g.ellipse(x * u, y * u, rx * u, ry * u, rot, 0, 7); g.fill();
  };
  const path = (pts, col, close = true) => {
    g.fillStyle = typeof col === 'string' ? col : rgba(col, 1);
    g.beginPath();
    g.moveTo(pts[0][0] * u, pts[0][1] * u);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 6) g.bezierCurveTo(p[0] * u, p[1] * u, p[2] * u, p[3] * u, p[4] * u, p[5] * u);
      else if (p.length === 4) g.quadraticCurveTo(p[0] * u, p[1] * u, p[2] * u, p[3] * u);
      else g.lineTo(p[0] * u, p[1] * u);
    }
    if (close) g.closePath();
    g.fill();
  };

  const SKIN = 0xf2cba6, SKIN_D = 0xc99a76, SKIN_L = 0xffe6c8;
  const HAIR = 0xf2d79a, HAIR_D = 0xa8763a, HAIR_L = 0xfff2cf;
  const GOLD = 0xd9a53f, GOLD_L = 0xffe7b4;
  const BLUE = 0x2b4a86, BLUE_L = 0x5f8fd6;

  // ---- backdrop -----------------------------------------------------------
  const bg = g.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#33507f'); bg.addColorStop(0.52, '#1b2b4d'); bg.addColorStop(1, '#0a1122');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  blob(196, 44, 130, 0xffd9a0, 0.34);        // warm dawn light, upper right
  blob(44, 210, 120, 0x0a1020, 0.5);         // lower-left falloff
  // sun disc glow behind the head
  blob(128, 96, 92, 0xffe1ad, 0.2);

  // figure is authored head-large; pull back slightly so the armour reads
  g.save();
  g.translate(128 * u, 150 * u); g.scale(0.93, 0.93); g.translate(-128 * u, -140 * u);

  // ---- hair : back mass ---------------------------------------------------
  path([[128, 20], [186, 26, 200, 96, 196, 148], [200, 196, 176, 214, 158, 220],
        [140, 226, 116, 226, 98, 220], [80, 214, 56, 196, 60, 148],
        [56, 96, 70, 26, 128, 20]], rgba(HAIR_D, 1));
  blob(104, 92, 78, HAIR, 0.55);
  blob(168, 150, 62, 0x8a5f2c, 0.5);

  // ---- neck ---------------------------------------------------------------
  path([[104, 150], [104, 190], [152, 190], [152, 150]], rgba(SKIN_D, 1));
  blob(128, 176, 40, SKIN, 0.75);
  blob(128, 158, 42, 0x8f6248, 0.55);        // jaw shadow on the neck

  // ---- shoulders / armour -------------------------------------------------
  // cape behind
  path([[10, 256], [34, 196, 78, 182, 96, 180], [96, 256]], rgba(0x24407a, 1));
  path([[246, 256], [222, 196, 178, 182, 160, 180], [160, 256]], rgba(0x1a3162, 1));
  // chest plate
  path([[74, 256], [80, 208, 104, 190, 128, 190], [152, 190, 176, 208, 182, 256]], '#e7eefb');
  path([[100, 256], [104, 216, 114, 202, 128, 202], [142, 202, 152, 216, 156, 256]], rgba(BLUE, 1));
  // gold collar trim
  g.lineWidth = 7 * u; g.strokeStyle = rgba(GOLD, 1); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(72 * u, 250 * u);
  g.bezierCurveTo(80 * u, 206 * u, 104 * u, 186 * u, 128 * u, 186 * u);
  g.bezierCurveTo(152 * u, 186 * u, 176 * u, 206 * u, 184 * u, 250 * u);
  g.stroke();
  g.lineWidth = 2.4 * u; g.strokeStyle = rgba(GOLD_L, 0.85); g.stroke();
  // pauldrons
  path([[16, 256], [18, 214, 44, 196, 70, 200], [82, 202, 84, 224, 82, 256]], rgba(0xdfe8f7, 1));
  path([[240, 256], [238, 214, 212, 196, 186, 200], [174, 202, 172, 224, 174, 256]], rgba(0xc3d1e8, 1));
  g.lineWidth = 5 * u; g.strokeStyle = rgba(GOLD, 1);
  g.beginPath(); g.moveTo(17 * u, 250 * u); g.bezierCurveTo(20 * u, 212 * u, 44 * u, 194 * u, 72 * u, 199 * u); g.stroke();
  g.beginPath(); g.moveTo(239 * u, 250 * u); g.bezierCurveTo(236 * u, 212 * u, 212 * u, 194 * u, 184 * u, 199 * u); g.stroke();
  blob(40, 236, 46, 0x0a1226, 0.42);
  blob(214, 236, 46, 0x0a1226, 0.5);

  // ---- face ---------------------------------------------------------------
  path([[128, 58], [166, 58, 180, 86, 178, 116],
        [177, 142, 166, 166, 148, 178],
        [138, 185, 118, 185, 108, 178],
        [90, 166, 79, 142, 78, 116],
        [76, 86, 90, 58, 128, 58]], rgba(SKIN, 1));
  // silhouette contour: separates skin from hair at portrait scale
  g.lineWidth = 2.2 * u; g.strokeStyle = rgba(0x86543a, 0.4); g.stroke();
  // form shading — key from camera-left, deep shadow on the turned side
  blob(100, 100, 52, SKIN_L, 0.55);           // lit temple / forehead
  blob(174, 140, 50, 0x9a6244, 0.6);         // shadow side
  blob(176, 100, 32, 0x8f5a3e, 0.5);
  blob(88, 112, 26, 0x8f5a3e, 0.38);   // hairline AO, lit side
  blob(130, 178, 38, 0x8f5c42, 0.45);        // under-chin
  blob(126, 100, 46, 0x9a6448, 0.3);        // fringe cast shadow on the brow
  blob(98, 150, 24, 0xff9d88, 0.22);         // blush
  blob(162, 150, 24, 0xff9d88, 0.14);
  // cheekbone catch
  blob(104, 138, 22, 0xffeed6, 0.34);
  // brow ridge shadow
  blob(108, 124, 20, 0xb08064, 0.24);
  blob(154, 124, 20, 0xa4714f, 0.3);
  // nose
  path([[132, 124], [136, 148, 140, 152, 136, 156], [129, 158, 127, 154, 128, 151]], rgba(0xc08a68, 0.46));
  blob(137, 155, 8, 0xb37a58, 0.42);
  blob(130, 150, 7, 0xfff0d8, 0.4);          // nose-tip highlight
  // mouth
  g.lineCap = 'round';
  g.lineWidth = 4.6 * u; g.strokeStyle = rgba(0x9c4a44, 0.92);
  g.beginPath(); g.moveTo(119 * u, 169 * u); g.quadraticCurveTo(132 * u, 176 * u, 145 * u, 167 * u); g.stroke();
  g.lineWidth = 2.6 * u; g.strokeStyle = rgba(0xe4867c, 0.72);
  g.beginPath(); g.moveTo(122 * u, 173 * u); g.quadraticCurveTo(132 * u, 177 * u, 142 * u, 171 * u); g.stroke();
  blob(126, 165, 8, 0xfff0d8, 0.3);

  // ---- eyes ---------------------------------------------------------------
  for (const s of [-1, 1]) {
    const near = s < 0;                       // camera-left eye reads larger
    const ex = 131 + s * (near ? 25 : 22), ey = 135, k = near ? 0.94 : 0.85;
    // socket shadow
    blob(ex, ey - 1, 20 * k, 0xa4724e, 0.3);
    // sclera
    ell(ex, ey, 14.2 * k, 10.6, 0, '#f2ece6');
    blob(ex, ey - 5, 12 * k, 0x6d5344, 0.5);  // lid shadow on the sclera
    // iris
    ell(ex + s * 1.2, ey + 1, 9.2 * k, 9.6, 0, '#3f93b8');
    ell(ex + s * 1.2, ey + 3.4, 7.8 * k, 6.8, 0, '#1b5a80');
    // pupil
    ell(ex + s * 1.2, ey + 1.6, 4.3 * k, 4.9, 0, '#0d1826');
    // catchlight
    ell(ex + s * 1.2 - 3.2, ey - 3.4, 2.9 * k, 2.9, 0, 'rgba(255,255,255,0.96)');
    ell(ex + s * 1.2 + 3.6, ey + 4.4, 1.6, 1.6, 0, 'rgba(180,230,255,0.55)');
    // upper lash line
    g.lineWidth = 5.2 * u; g.strokeStyle = 'rgba(52,30,24,0.95)'; g.lineCap = 'round';
    g.beginPath();
    g.moveTo((ex - s * 14 * k) * u, (ey - 2) * u);
    g.quadraticCurveTo(ex * u, (ey - 13) * u, (ex + s * 14.5 * k) * u, (ey - 4.5) * u);
    g.stroke();
    // outer lash flick
    g.lineWidth = 3.6 * u;
    g.beginPath();
    g.moveTo((ex + s * 11 * k) * u, (ey - 6) * u);
    g.quadraticCurveTo((ex + s * 17 * k) * u, (ey - 10) * u, (ex + s * 19.5 * k) * u, (ey - 13) * u);
    g.stroke();
    // lower lid
    g.lineWidth = 2 * u; g.strokeStyle = 'rgba(120,74,56,0.5)';
    g.beginPath();
    g.moveTo((ex - s * 11 * k) * u, (ey + 7.5) * u);
    g.quadraticCurveTo(ex * u, (ey + 11) * u, (ex + s * 12 * k) * u, (ey + 5.5) * u);
    g.stroke();
    // brow
    g.lineWidth = 4.2 * u; g.strokeStyle = rgba(0xbb8f4a, near ? 0.88 : 0.72);
    g.beginPath();
    g.moveTo((ex - s * 14 * k) * u, (ey - 17.5) * u);
    g.quadraticCurveTo((ex + s * 2) * u, (ey - 22.5) * u, (ex + s * 15 * k) * u, (ey - 18.5) * u);
    g.stroke();
  }

  // ---- hair : fringe + locks (over the forehead) ---------------------------
  path([[78, 106], [80, 62, 104, 42, 128, 42], [156, 42, 180, 66, 180, 108],
        [176, 88, 170, 78, 163, 71], [161, 92, 156, 106, 150, 116],
        [148, 96, 142, 84, 134, 78], [128, 90, 122, 96, 114, 98],
        [110, 108, 106, 114, 102, 118], [98, 100, 94, 86, 90, 72],
        [84, 82, 80, 94, 78, 106]], rgba(HAIR, 1));
  // lock highlights
  path([[92, 76], [100, 92, 112, 102, 126, 105], [116, 100, 104, 90, 98, 74]], rgba(HAIR_L, 0.8));
  path([[160, 78], [154, 92, 146, 100, 136, 104], [148, 98, 156, 90, 162, 76]], rgba(HAIR_L, 0.4));
  blob(110, 60, 44, HAIR_L, 0.55);
  blob(158, 66, 30, 0xb5852f, 0.3);
  // strand separations across the fringe
  g.lineWidth = 1.6 * u; g.strokeStyle = rgba(0xa8763a, 0.3); g.lineCap = 'round';
  for (const [x0, y0, cx, cy, x1, y1] of [
    [98, 62, 98, 78, 104, 96], [116, 50, 116, 68, 118, 88],
    [142, 50, 146, 68, 148, 84], [162, 58, 168, 76, 170, 94]]) {
    g.beginPath(); g.moveTo(x0 * u, y0 * u); g.quadraticCurveTo(cx * u, cy * u, x1 * u, y1 * u); g.stroke();
  }
  // side locks — pointed elven tips
  path([[78, 102], [62, 140, 58, 178, 62, 216], [72, 200, 80, 190, 84, 176],
        [88, 196, 90, 208, 86, 222], [96, 200, 96, 172, 90, 146],
        [86, 126, 80, 112, 78, 102]], rgba(HAIR, 1));
  path([[180, 104], [196, 142, 200, 180, 196, 218], [186, 202, 178, 192, 174, 178],
        [170, 198, 168, 210, 172, 224], [162, 202, 162, 174, 168, 148],
        [172, 128, 178, 114, 180, 104]], rgba(0xd0ab6c, 1));
  blob(72, 148, 28, HAIR_L, 0.45);
  blob(190, 158, 24, HAIR_L, 0.26);
  blob(86, 208, 26, 0x9c6c2e, 0.4);
  blob(176, 210, 26, 0x8a5c26, 0.45);

  // ---- circlet ------------------------------------------------------------
  g.lineWidth = 6.5 * u; g.strokeStyle = rgba(GOLD, 1);
  g.beginPath();
  g.moveTo(80 * u, 94 * u);
  g.quadraticCurveTo(130 * u, 117 * u, 178 * u, 98 * u);
  g.stroke();
  g.lineWidth = 2.2 * u; g.strokeStyle = rgba(GOLD_L, 0.9);
  g.beginPath();
  g.moveTo(82 * u, 92 * u);
  g.quadraticCurveTo(130 * u, 114 * u, 176 * u, 96 * u);
  g.stroke();
  // centre gem
  path([[131, 100], [139, 110], [131, 122], [123, 110]], '#bfe9ff');
  path([[131, 106], [135, 111], [131, 117], [127, 111]], '#ffffff');

  // ---- rim light ----------------------------------------------------------
  g.save();
  g.globalCompositeOperation = 'lighter';
  blob(192, 124, 34, 0x9fc6ff, 0.42);
  blob(180, 70, 30, 0xffe0b0, 0.4);
  blob(200, 198, 34, 0x7fb0ff, 0.3);
  blob(66, 90, 26, 0xffe8c0, 0.24);
  g.restore();

  g.restore();

  // ---- vignette -----------------------------------------------------------
  const vg = g.createRadialGradient(S * 0.5, S * 0.46, S * 0.24, S * 0.5, S * 0.5, S * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,5,12,0.6)');
  g.fillStyle = vg; g.fillRect(0, 0, S, S);
}
