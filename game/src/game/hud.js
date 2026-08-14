// DOM HUD: bars, cooldown sweeps, minimap canvas, damage numbers, kill feed,
// announcements, end screen. All element lookups cached; text writes throttled.
import * as THREE from 'three';
import { tex } from '../core/assets.js';
import { A } from '../world/arena.js';

const _v = new THREE.Vector3();
const AB_KEYS = ['Q', 'W', 'E', 'R'];
const AB_MANA = { Q: 20, W: 25, E: 30, R: 60 };
const AB_MAX = { Q: 5.5, W: 9.5, E: 11, R: 46 };

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hpFill: $('hpFill'), hpGhost: $('hpGhost'), hpText: $('hpText'),
      mpFill: $('mpFill'), mpText: $('mpText'), xpFill: $('xpFill'),
      level: $('levelBadge'), portrait: $('portraitImg'),
      gold: $('statGold'), cs: $('statCS'), kda: $('statKDA'),
      scoreBlue: $('scoreBlue'), scoreRed: $('scoreRed'), timer: $('gameTimer'),
      feed: $('killFeed'), dmgLayer: $('dmgLayer'),
      announce: $('announce'), annTitle: $('announceTitle'), annSub: $('announceSub'),
      end: $('endScreen'), endBanner: $('endBanner'), endStats: $('endStats'), endReplay: $('endReplay'),
      minimap: $('minimap'),
      btns: { A: $('btnA'), Q: $('btnQ'), W: $('btnW'), E: $('btnE'), R: $('btnR') },
    };
    this.el.portrait.style.backgroundImage = `url(${tex.portraitURL})`;
    this.mm = this.el.minimap.getContext('2d');
    this.mmT = 0;
    this.txtT = 0;
    this.annT = 0;
    this.lastVals = {};
    // damage number pool
    this.nums = [];
    for (let i = 0; i < 22; i++) {
      const el = document.createElement('div');
      el.className = 'dmgNum';
      el.style.display = 'none';
      this.el.dmgLayer.appendChild(el);
      this.nums.push({ el, active: false, t: 0, life: 1, wp: new THREE.Vector3(), ox: 0, kind: '' });
    }
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

  // wipe transient overlays (damage numbers, feed, announce) — used by staging
  reset() {
    for (const n of this.nums) { n.active = false; n.el.style.display = 'none'; }
    for (const r of this.feedRows) r.el.remove();
    this.feedRows.length = 0;
    this.el.announce.style.opacity = '0';
    this.annT = 0;
    this.txtT = 0;
    this.lastVals = {};
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

  damageNumber(worldPos, text, kind = 'phys') {
    let slot = null;
    for (const n of this.nums) { if (!n.active) { slot = n; break; } }
    if (!slot) { slot = this.nums[0]; }
    slot.active = true;
    slot.t = 0;
    slot.life = kind === 'crit' ? 1.1 : 0.85;
    slot.wp.copy(worldPos);
    slot.wp.y += 1.3;
    slot.ox = (Math.random() - 0.5) * 26;
    slot.kind = kind;
    slot.el.className = 'dmgNum ' + kind;
    slot.el.textContent = text;
    slot.el.style.display = 'block';
    this.placeNum(slot);
  }
  placeNum(n) {
    if (!this.camera) return;
    _v.copy(n.wp);
    _v.y += n.t * 1.1; // rise
    _v.project(this.camera);
    const x = (_v.x * 0.5 + 0.5) * innerWidth + n.ox;
    const y = (-_v.y * 0.5 + 0.5) * innerHeight - n.t * 14;
    const s = n.kind === 'crit' ? 1 + Math.max(0, 0.5 - n.t) : 1;
    n.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%,-100%) scale(${s.toFixed(2)})`;
    n.el.style.opacity = Math.max(0, 1 - (n.t / n.life) * (n.t / n.life)).toFixed(2);
  }

  showEnd(victory, player, time) {
    this.el.end.style.display = 'flex';
    this.el.endBanner.textContent = victory ? 'VICTORY' : 'DEFEAT';
    this.el.endBanner.className = victory ? '' : 'defeat';
    const mm = Math.floor(time / 60), ss = Math.floor(time % 60);
    this.el.endStats.innerHTML =
      `<b>${player.kills}</b> / ${player.deaths} &nbsp;·&nbsp; <b>${player.cs}</b> CS &nbsp;·&nbsp; <b>${Math.floor(player.gold)}</b> gold &nbsp;·&nbsp; ${mm}:${String(ss).padStart(2, '0')}`;
  }

  // --------------------------------------------------------------- update --
  update(dt) {
    const sim = this.sim;
    if (!sim) return;
    const p = sim.player;
    // bars every frame (cheap transforms)
    const hpF = Math.max(0, p.hp / p.maxHp);
    this.el.hpFill.style.transform = `scaleX(${hpF.toFixed(3)})`;
    this.el.hpGhost.style.transform = `scaleX(${hpF.toFixed(3)})`;
    this.el.mpFill.style.transform = `scaleX(${Math.max(0, p.mana / p.maxMana).toFixed(3)})`;
    const xpNeed = 60 + p.level * 55;
    this.el.xpFill.style.transform = `scaleX(${Math.min(1, p.xp / xpNeed).toFixed(3)})`;

    // cooldown sweeps + mana dim
    for (const k of AB_KEYS) {
      const btn = this.el.btns[k];
      const cd = p.cds[k];
      const locked = k === 'R' && p.level < 5;
      const sweep = btn.querySelector('.cdSweep');
      const txt = btn.querySelector('.cdText');
      const key = 'cd' + k;
      if (locked) {
        btn.classList.add('locked');
        if (this.lastVals[key] !== -1) { sweep.style.background = 'none'; txt.textContent = ''; this.lastVals[key] = -1; }
      } else {
        btn.classList.remove('locked');
        if (cd > 0) {
          const frac = cd / AB_MAX[k];
          const deg = Math.round(frac * 360);
          if (this.lastVals[key] !== deg) {
            this.lastVals[key] = deg;
            sweep.style.background = `conic-gradient(rgba(4,8,16,0.85) ${deg}deg, transparent ${deg}deg)`;
          }
          const t = cd > 3 ? Math.ceil(cd) : cd.toFixed(1);
          if (txt.textContent !== String(t)) txt.textContent = t;
          btn.classList.remove('ready');
        } else {
          if (this.lastVals[key] !== 0) {
            this.lastVals[key] = 0;
            sweep.style.background = 'none';
            txt.textContent = '';
          }
          btn.classList.add('ready');
        }
        btn.classList.toggle('noMana', p.mana < AB_MANA[k]);
      }
    }
    // ability rank pips
    if (this.lastVals.lvl !== p.level) {
      this.lastVals.lvl = p.level;
      this.el.level.textContent = p.level;
      const ranks = {
        Q: Math.min(5, 1 + Math.floor(p.level / 3)),
        W: Math.min(5, 1 + Math.floor((p.level - 1) / 3)),
        E: Math.min(5, 1 + Math.floor((p.level - 2) / 3)),
        R: p.level >= 13 ? 3 : p.level >= 9 ? 2 : p.level >= 5 ? 1 : 0,
      };
      for (const k of AB_KEYS) {
        const pips = this.el.btns[k].querySelector('.pips');
        if (!pips) continue;
        let html = '';
        for (let i = 0; i < ranks[k]; i++) html += '<span class="pip"></span>';
        pips.innerHTML = html;
      }
    }

    // throttled text
    this.txtT -= dt;
    if (this.txtT <= 0) {
      this.txtT = 0.24;
      const set = (el, v) => { if (this.lastVals[el.id] !== v) { this.lastVals[el.id] = v; el.textContent = v; } };
      set(this.el.gold, String(Math.floor(p.gold)));
      set(this.el.cs, String(p.cs));
      set(this.el.kda, `${p.kills}/${p.deaths}/${Math.floor(p.cs / 10)}`);
      set(this.el.scoreBlue, String(sim.score.blue));
      set(this.el.scoreRed, String(sim.score.red));
      const mm = Math.floor(sim.time / 60), ss = Math.floor(sim.time % 60);
      set(this.el.timer, `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
      set(this.el.hpText, `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`);
      set(this.el.mpText, `${Math.ceil(p.mana)}/${p.maxMana}`);
    }

    // damage numbers
    for (const n of this.nums) {
      if (!n.active) continue;
      n.t += dt;
      if (n.t >= n.life) { n.active = false; n.el.style.display = 'none'; continue; }
      this.placeNum(n);
    }
    // announce fade
    if (this.annT > 0) {
      this.annT -= dt;
      if (this.annT <= 0) this.el.announce.style.opacity = '0';
    }
    // feed fade
    for (let i = this.feedRows.length - 1; i >= 0; i--) {
      const r = this.feedRows[i];
      r.t -= dt;
      if (r.t < 1) r.el.style.opacity = Math.max(0, r.t).toFixed(2);
      if (r.t <= 0) { r.el.remove(); this.feedRows.splice(i, 1); }
    }
    // minimap at ~8 Hz
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.12;
      this.drawMinimap();
    }
  }

  // -------------------------------------------------------------- minimap --
  drawMinimap() {
    const ctx = this.mm, sim = this.sim;
    const S = 256, cx = S / 2, cy = S / 2;
    ctx.clearRect(0, 0, S, S);
    // circular parchment-dark backing
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, S / 2, 0, 7); ctx.clip();
    const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, S / 2);
    bg.addColorStop(0, 'rgba(18,28,42,0.92)');
    bg.addColorStop(1, 'rgba(6,10,18,0.96)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    const sx = (x) => cx + (x / (A.HALF_X + 4)) * (S / 2 - 10);
    const sy = (z) => cy + (z / (A.HALF_X + 4)) * (S / 2 - 10); // same scale (band)
    // arena band
    const bandH = sy(A.EDGE_Z) - sy(-A.EDGE_Z);
    ctx.fillStyle = 'rgba(64,94,66,0.85)';
    this.rr(ctx, sx(-A.HALF_X), sy(-A.EDGE_Z), sx(A.HALF_X) - sx(-A.HALF_X), bandH, 12);
    ctx.fill();
    // bases
    ctx.fillStyle = 'rgba(70,102,150,0.9)';
    ctx.beginPath(); ctx.arc(sx(-A.BASE_X), cy, 20, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(150,74,60,0.9)';
    ctx.beginPath(); ctx.arc(sx(A.BASE_X), cy, 20, 0, 7); ctx.fill();
    // lane
    ctx.fillStyle = 'rgba(196,182,148,0.8)';
    ctx.fillRect(sx(-48), cy - 6.5, sx(48) - sx(-48), 13);
    // river
    ctx.fillStyle = 'rgba(72,166,178,0.9)';
    ctx.fillRect(sx(-A.RIVER_HALF), sy(-A.EDGE_Z), sx(A.RIVER_HALF) - sx(-A.RIVER_HALF), bandH);
    ctx.fillStyle = 'rgba(196,182,148,0.9)';
    ctx.fillRect(sx(-A.RIVER_HALF), cy - 5, sx(A.RIVER_HALF) - sx(-A.RIVER_HALF), 10);
    if (sim) {
      // towers
      for (const t of sim.towers) {
        ctx.save();
        ctx.translate(sx(t.pos.x), sy(t.pos.z));
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = !t.alive ? 'rgba(80,80,80,0.8)' : t.team === 'blue' ? '#59a2ff' : '#ff6a55';
        ctx.fillRect(-4, -4, 8, 8);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(-4, -4, 8, 8);
        ctx.restore();
      }
      // nexus
      for (const n of sim.nexuses) {
        ctx.fillStyle = !n.alive ? '#555' : n.team === 'blue' ? '#8fd0ff' : '#ffab90';
        this.star(ctx, sx(n.pos.x), sy(n.pos.z), 7, 3.2);
      }
      // minions
      for (const m of sim.minions) {
        ctx.fillStyle = m.team === 'blue' ? '#6fb5ff' : '#ff8a70';
        ctx.fillRect(sx(m.pos.x) - 1.5, sy(m.pos.z) - 1.5, 3, 3);
      }
      // heroes
      for (const h of [sim.bot, sim.player]) {
        if (!h.alive) continue;
        ctx.beginPath();
        ctx.arc(sx(h.pos.x), sy(h.pos.z), h === sim.player ? 6 : 5.4, 0, 7);
        ctx.fillStyle = h.team === 'blue' ? '#66d9ff' : '#ff5a45';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = h === sim.player ? '#fff' : 'rgba(0,0,0,0.65)';
        ctx.stroke();
      }
      // camera bracket
      if (this.camera) {
        const px = sim.player.alive ? sim.player.pos.x : 0;
        const pz = sim.player.alive ? sim.player.pos.z : 0;
        ctx.strokeStyle = 'rgba(255,230,170,0.75)';
        ctx.lineWidth = 1.6;
        const w = 44, h = 26, bx = sx(px), by = sy(pz);
        const L = 8;
        ctx.beginPath();
        for (const [ox, oy, dx, dy] of [[-w / 2, -h / 2, 1, 1], [w / 2, -h / 2, -1, 1], [-w / 2, h / 2, 1, -1], [w / 2, h / 2, -1, -1]]) {
          ctx.moveTo(bx + ox + dx * L, by + oy);
          ctx.lineTo(bx + ox, by + oy);
          ctx.lineTo(bx + ox, by + oy + dy * L);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  star(ctx, x, y, r1, r2) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? r1 : r2;
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}
