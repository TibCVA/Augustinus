// Fixed-step simulation: minion waves, combat, bot AI, towers, fountains,
// win/lose, gold/xp — plus deterministic staging for the screenshot presets.
//
// FEEL NOTES (Wild-Rift-style targets this file is tuned against):
//  * Movement is velocity-based: ~0.11 s acceleration ramp, a finite turn rate
//    that falls off with speed (the hero pivots, it never snaps), and a slide
//    fallback so nobody can wedge themselves on a tower collider.
//  * Autos are windup → damage point → recovery. Only the windup roots you; the
//    recovery is cancellable by moving or by casting (animation cancelling).
//  * Abilities have cast times, ranks that match the HUD pips, and telegraphs.
//  * Cooldowns / mana costs must stay <= the values hard-coded in hud.js
//    (AB_MAX / AB_MANA) or the radial cooldown sweep goes out of sync.
import * as THREE from 'three';
import { makeRng, simSeed } from '../core/rng.js';
import { A } from '../world/arena.js';
import { buildTower, buildNexusCrystal } from '../world/props.js';
import { Hero } from '../entities/hero.js';
import { Minion, Tower, Nexus, HPBars, BlobShadows } from '../entities/units.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TEAM_COL = { blue: 0x59a2ff, red: 0xff6a55 };
const ENEMY = { blue: 'red', red: 'blue' };
const TAU = Math.PI * 2;
const AB_KEYS = ['Q', 'W', 'E', 'R'];

// cd / mana MUST mirror AB_MAX / AB_MANA in hud.js
const ABILITY = {
  Q: { cd: 5.5, mana: 20, cast: 0.24, range: 5.4 },
  W: { cd: 9.5, mana: 25, cast: 0.05, range: 7.6 },
  E: { cd: 11, mana: 30, cast: 0.10, range: 4.0 },
  R: { cd: 46, mana: 60, cast: 0.20, range: 7.2 },
};
// ability ranks mirror the pip counts hud.js draws, so the UI never lies
const RANK = {
  Q: (l) => Math.min(5, Math.max(1, 1 + Math.floor(l / 3))),
  W: (l) => Math.min(5, Math.max(1, 1 + Math.floor((l - 1) / 3))),
  E: (l) => Math.min(5, Math.max(1, 1 + Math.floor((l - 2) / 3))),
  R: (l) => (l >= 13 ? 3 : l >= 9 ? 2 : l >= 5 ? 1 : 0),
};

// ------------------------------------------------------------ feel tuning --
const MOVE = {
  deadzone: 0.14,   // joystick slack; controls.js already remaps past this
  accel: 62,        // u/s^2  -> 0..7 u/s in ~0.11 s
  decel: 96,        // u/s^2  -> full stop in ~0.07 s
  turnStand: 24,    // rad/s pivot rate at a standstill
  // rad/s pivot rate at full speed. Nominally pi/10.5 = 0.30 s for a 180, but
  // turnBleed sheds speed through the turn and the rate climbs toward turnStand
  // as it does, so a measured full-speed 180 lands at 0.22 s heading-reversed /
  // 0.23 s back at full speed. It pivots — it never snaps.
  turnRun: 10.5,
  turnBleed: 0.45,  // fraction of speed shed while hauling through a hard turn
  faceRate: 20,     // how fast the mesh yaw chases the movement heading
};
const ATK = {
  range: 3.0,       // + target radius
  acquire: 8.0,     // attack-move chase acquisition
  hold: 1.25,       // how long one attack-button press keeps the intent alive
  windupFrac: 0.30, // share of the attack cycle spent in the rooted windup
  windupMax: 0.26,
  recover: 0.34,    // cosmetic follow-through, cancellable
  comboMul: 1.4,    // 3rd swing of the combo
};
const HERO = {
  hp: (l, bot) => (bot ? 665 : 640) + 105 * (l - 1),
  mana: (l) => 120 + 14 * (l - 1),
  ad: (l) => 60 + 7 * (l - 1),
  aps: (l) => 0.93 + 0.022 * (l - 1),   // attacks per second
};
// Input buffering: a button pressed a beat early is held, not eaten. Covers both
// "an action currently owns the hero" and "the cooldown is about to tick over",
// which is the case a player actually notices — you tap Q as the sweep closes
// and nothing happens.
const CAST_BUF = 0.35;     // how long a queued press stays live
const CAST_BUF_CD = 0.30;  // queue a press this far before the cooldown ends
// hit-stop: the sim crawls for a few frames. Character animation is scaled by
// the same factor in updateVisuals or the "freeze" is invisible — the rig keeps
// swinging at full rate while only the damage and the positions slow down.
const HITSTOP_SCALE = 0.14;
// a hit smaller than this share of your health bar does not move the camera;
// otherwise every minion auto rattles the screen for the whole laning phase
const SHAKE_MIN_FRAC = 0.035;
// A champion alone is a bad siege engine — that is what the wave is for. At
// 0.72 a hero out-DPSed the minions it was standing behind, so a bot with a
// free lane could solo a base in under six minutes.
const STRUCT_MUL = 0.48;   // heroes hit towers/nexus for a fraction (fortification)
const XP_RADIUS2 = 9.5 * 9.5;
const DASH_SPEED = 27, DASH_TIME = 0.28;
const WAVE_PERIOD = 24;   // shortens as the game runs long (see wavePeriod)
const MINION_STRUCT_MUL = 1.4;  // waves are what actually siege a tower
const MINION_CAP = 32;
// slide-around-obstacle probes (cos/sin pairs), tried both ways round
const SLIDE = [0.73, 0.68, 0.22, 0.97];
// hoisted target filters: these run on the bot's think tick and on every minion
// re-acquire, so allocating a fresh closure per call is pure garbage
const IS_STRUCT = (u) => u.kind === 'tower' || u.kind === 'nexus';
const NOT_STRUCT = (u) => u.kind !== 'tower' && u.kind !== 'nexus';

export class Sim {
  constructor({ scene, arena, vfx, hud }) {
    this.scene = scene;
    this.arena = arena;
    this.vfx = vfx;
    this.hud = hud;
    this.rng = makeRng(simSeed);
    this.time = 0;
    this.state = 'playing';
    this.score = { blue: 0, red: 0 };
    this.firstBlood = false;
    this.pending = [];        // {t, fn} scheduled events
    this.minions = [];
    this.waveT = 8;           // first wave
    this.waveN = 0;
    this.hitStop = 0;
    this.superWave = { blue: false, red: false };

    this.hpBars = new HPBars(scene, 64);
    this.blobs = new BlobShadows(scene, 56);

    // towers & nexus
    this.towers = [];
    for (const spec of arena.towerSpecs) {
      const built = buildTower(spec.team);
      const t = new Tower({ ...spec, built });
      t.maxHp = spec.tier === 'inner' ? 2400 : 1950;
      t.hp = t.maxHp;
      t.aggroT = 0;
      t.towerRamp = 0;
      scene.add(t.group);
      t.blocker = arena.addBlocker(spec.x, spec.z, 2.05);
      t.barIdx = this.hpBars.alloc();
      this.towers.push(t);
    }
    this.nexuses = [];
    for (const spec of arena.nexusSpecs) {
      const built = buildNexusCrystal(spec.team);
      const n = new Nexus({ ...spec, built });
      n.maxHp = 2800; n.hp = n.maxHp;
      scene.add(n.group);
      arena.addBlocker(spec.x, spec.z, 2.5);
      n.barIdx = this.hpBars.alloc();
      this.nexuses.push(n);
    }

    // heroes
    this.player = new Hero({ name: 'Sera', team: 'blue', build: 'sera', x: arena.spawn.blue.x, z: 0 });
    this.bot = new Hero({ name: 'Kargath', team: 'red', build: 'kargath', x: arena.spawn.red.x, z: 0 });
    this.heroes = [this.player, this.bot];
    for (const h of this.heroes) {
      scene.add(h.group);
      h.barIdx = this.hpBars.alloc();
      h.shadowIdx = this.blobs.alloc();
      h.pos.y = arena.groundHeight(h.pos.x, h.pos.z);
      h.maxHp = HERO.hp(1, h === this.bot); h.hp = h.maxHp;
      h.maxMana = HERO.mana(1); h.mana = h.maxMana;
      h.invulnT = 0;
      h.comboIdx = 0; h.comboT = 0;
      h.dashT = -1; h.dashDir = new THREE.Vector3();
      h.dashHit = [];
      h.ultPhase = null;
      h.attackHold = 0;
      h.chaseTarget = null;
      h.lastDamagedT = -99;
      h.combatT = -99;
      h.towerRamp = 0;
      // movement state (velocity-based, no per-frame allocation)
      h.moveSpd = 0;
      h.moveAng = h.facing;
      h.slideSide = 0;
      // action timers: rootT blocks movement, busyT blocks new actions
      h.rootT = 0;
      h.busyT = 0;
      h.spinUntil = 0; h.spinNext = 0;
      h.aggroUntil = -99;
    }
    this.input = { x: 0, z: 0, mag: 0 };
    this.aimDir = new THREE.Vector3(1, 0, 0);
    this.botAiT = 0;
    this.castBuf = '';
    this.castBufT = 0;
    this.botBuf = '';
    this.botBufT = 0;
    this.botBufTgt = null;
    // `follow` is the unit the destination is derived from. The *decision* runs
    // on a human-ish clock, but the destination is re-read from the live target
    // every frame — otherwise the bot walks at where you stood a third of a
    // second ago and loses every duel to a moving player.
    this.botIntent = { x: 0, z: 0, move: false, target: null, face: null, follow: null };
    this.fountainT = 0;
    this.trailBusy = [false, false];
  }

  // ============================================================== helpers ==
  announce(t, s, kind) { this.hud?.announce(t, s, kind); }
  schedule(delay, fn) { this.pending.push({ t: this.time + delay, fn }); }

  autoDmg(h) { return HERO.ad(h.level); }
  playerAutoDmg(h) { return HERO.ad(h.level); }   // kept: legacy name
  atkRange(h, target) { return ATK.range + (target ? target.radius : 0.45); }
  rank(h, key) { return RANK[key](h.level); }
  minute() { return this.time / 60; }
  flat(a, b) { const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z; return Math.sqrt(dx * dx + dz * dz); }

  eachEnemy(team, fn) {
    for (const m of this.minions) if (m.alive && m.team !== team) { if (fn(m)) return; }
    const eh = team === 'blue' ? this.bot : this.player;
    if (eh.alive) { if (fn(eh)) return; }
    for (const t of this.towers) if (t.alive && t.team !== team) { if (fn(t)) return; }
    for (const n of this.nexuses) if (n.alive && n.team !== team && !n.invulnerable) { if (fn(n)) return; }
  }
  nearestEnemy(team, x, z, maxD, filter) {
    let best = null, bd = maxD * maxD;
    this.eachEnemy(team, (u) => {
      if (filter && !filter(u)) return false;
      const dx = u.pos.x - x, dz = u.pos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = u; }
      return false;
    });
    return best;
  }
  // how many living minions of `team` sit within r of (x,z)
  countMinions(team, x, z, r) {
    let n = 0;
    const r2 = r * r;
    for (const m of this.minions) {
      if (!m.alive || m.team !== team) continue;
      const dx = m.pos.x - x, dz = m.pos.z - z;
      if (dx * dx + dz * dz < r2) n++;
    }
    return n;
  }
  // an alive enemy tower whose gun already covers (x,z)
  towerThreat(team, x, z, pad = 0.6) {
    for (const t of this.towers) {
      if (!t.alive || t.team === team) continue;
      const dx = t.pos.x - x, dz = t.pos.z - z;
      const r = t.range + pad;
      if (dx * dx + dz * dz < r * r) return t;
    }
    return null;
  }

  // ============================================================= movement ==
  // arena.resolveMove pins anything that walks dead-on into a round blocker
  // (dz === 0 makes the push-out degenerate) — which is exactly what happens
  // when you run down the lane centre into your own tower. Slide around it.
  moveUnit(u, dx, dz) {
    const px = u.pos.x, pz = u.pos.z;
    const want2 = dx * dx + dz * dz;
    this.arena.resolveMove(u.pos, dx, dz, u.radius);
    if (want2 < 1e-10) return true;
    let gx = u.pos.x - px, gz = u.pos.z - pz;
    if (gx * gx + gz * gz >= want2 * 0.25) { u.slideSide = 0; return true; }
    const len = Math.sqrt(want2);
    const nx = dx / len, nz = dz / len;
    let side = u.slideSide || (u.pos.z >= 0 ? 1 : -1);
    for (let a = 0; a < 4; a += 2) {
      for (let s = 0; s < 2; s++) {
        const sgn = s === 0 ? side : -side;
        const ca = SLIDE[a], sa = SLIDE[a + 1] * sgn;
        u.pos.x = px; u.pos.z = pz;
        this.arena.resolveMove(u.pos, (nx * ca - nz * sa) * len, (nx * sa + nz * ca) * len, u.radius);
        gx = u.pos.x - px; gz = u.pos.z - pz;
        if (gx * gx + gz * gz >= want2 * 0.25) { u.slideSide = sgn; return false; }
      }
    }
    u.pos.x = px; u.pos.z = pz;
    this.arena.resolveMove(u.pos, dx, dz, u.radius);
    u.slideSide = 0;
    return false;
  }

  // Velocity-based hero locomotion: instant-feeling but weighty.
  stepMove(h, dirX, dirZ, mag, dt, speedMul) {
    let spd = h.moveSpd;
    if (mag > MOVE.deadzone) {
      const want = Math.atan2(dirX, dirZ);
      let d = want - h.moveAng;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      const frac = Math.min(1, spd / h.speed);
      const turn = (MOVE.turnStand + (MOVE.turnRun - MOVE.turnStand) * frac) * dt;
      if (spd < 0.4) h.moveAng = want;
      else if (d > turn) h.moveAng += turn;
      else if (d < -turn) h.moveAng -= turn;
      else h.moveAng = want;
      if (h.moveAng > Math.PI) h.moveAng -= TAU; else if (h.moveAng < -Math.PI) h.moveAng += TAU;
      const bleed = 1 - MOVE.turnBleed * Math.min(1, Math.abs(d) / 2.0);
      const target = h.speed * speedMul * Math.min(1, mag) * bleed;
      spd = spd < target ? Math.min(target, spd + MOVE.accel * dt)
        : Math.max(target, spd - MOVE.decel * dt);
    } else {
      spd = Math.max(0, spd - MOVE.decel * dt);
    }
    h.moveSpd = spd;
    h.moving = spd > 0.08;
    h.moveRate = Math.min(1, spd / h.speed);
    if (!h.moving) return false;
    const clear = this.moveUnit(h, Math.sin(h.moveAng) * spd * dt, Math.cos(h.moveAng) * spd * dt);
    if (!clear) h.moveSpd = spd * 0.9;   // scrape along geometry, don't stick
    // yaw chases the movement heading (finite rate -> visible pivot)
    let fd = h.moveAng - h.facing;
    if (fd > Math.PI) fd -= TAU; else if (fd < -Math.PI) fd += TAU;
    h.facing += fd * Math.min(1, MOVE.faceRate * dt);
    // run dust
    if ((h.dustAcc = (h.dustAcc || 0) + dt) > 0.17 && h.moveRate > 0.45) {
      h.dustAcc = 0;
      this.vfx.pAlpha.spawn({
        x: h.pos.x - Math.sin(h.facing) * 0.3, y: h.pos.y + 0.08, z: h.pos.z - Math.cos(h.facing) * 0.3,
        vx: 0, vy: 0.7, vz: 0, life: 0.5, size: 0.28, sizeEnd: 0.7, col: 0xcabd9c, alpha: 0.32, sprite: 0, glow: 1, drag: 1,
      });
    }
    return true;
  }

  // Moving (or casting) out of an attack's follow-through cuts it short.
  cancelRecovery(h) {
    const a = h.anim;
    if (a.lock && a.t < a.dur && a.t > 0.02 && h.rootT <= 0 && h.busyT <= 0 &&
      a.name !== 'death' && a.name !== 'ultLeap' && a.name !== 'dash') {
      a.dur = a.t;
    }
  }

  // =============================================================== damage ==
  damage(src, dst, amount, kind = 'phys') {
    if (!dst.alive || (dst.invulnT && dst.invulnT > 0)) return 0;
    if (dst.kind === 'nexus' && dst.invulnerable) {
      if (src === this.player) this.hud?.damageNumber(dst.pos, 'IMMUNE', 'magic');
      return 0;
    }
    if (dst.kind === 'tower' || dst.kind === 'nexus') {
      if (src && src.isHero) amount *= STRUCT_MUL;
      else if (src && src.kind !== 'tower') amount *= MINION_STRUCT_MUL;
    }
    const dealt = dst.takeDamage(amount);
    dst.lastDamagedT = this.time;
    if (src && src.isHero) { dst.lastAttacker = src; dst.lastHeroHitT = this.time; }
    if (dst.isHero) dst.combatT = this.time;
    if (src && src.isHero) src.combatT = this.time;
    if (dst.hitScale !== undefined) dst.hitScale = 1;
    // Directional flinch: units auto-flinch off a hitScale rise, but passing the
    // attacker's position lets the rig pick the shoulder that actually took the
    // hit instead of rocking back on an arbitrary side.
    if (src && dst.flinch) dst.flinch(src.pos.x, src.pos.z);
    if (dst.isHero) {
      dst.hitFlash();
      if (dst === this.player) {
        const frac = dealt / dst.maxHp;
        if (frac > SHAKE_MIN_FRAC) this.vfx.shake(Math.min(0.28, 0.06 + frac * 1.7));
      }
    }
    // hero-on-hero aggression pulls the defender's tower and wave onto you
    if (src && src.isHero && dst.isHero) this.onHeroAggression(src, dst);
    // damage numbers: only player-relevant to avoid spam
    if (src === this.player) {
      this.hud?.damageNumber(dst.pos, Math.round(dealt), kind === 'crit' ? 'crit' : kind);
    } else if (dst === this.player) {
      this.hud?.damageNumber(dst.pos, Math.round(dealt), 'taken');
    } else if (src && src.isHero && dst.isHero) {
      this.hud?.damageNumber(dst.pos, Math.round(dealt), 'phys');
    }
    if (dst.hp <= 0) this.kill(src, dst);
    return dealt;
  }

  // Wild Rift rule: hit an enemy champion and every tower/minion of theirs in
  // range drops what it is doing and comes for you.
  onHeroAggression(src, dst) {
    src.aggroUntil = this.time + 4;
    for (const t of this.towers) {
      if (!t.alive || t.team !== dst.team) continue;
      const dx = t.pos.x - src.pos.x, dz = t.pos.z - src.pos.z;
      const r = t.range + 0.6;
      if (dx * dx + dz * dz < r * r && t.target !== src) {
        t.target = src; t.chargeT = 0.55; t.towerRamp = 0; t.aggroT = this.time + 4;
      }
    }
    for (const m of this.minions) {
      if (!m.alive || m.team !== dst.team) continue;
      const dx = m.pos.x - src.pos.x, dz = m.pos.z - src.pos.z;
      if (dx * dx + dz * dz < 64) m.target = src;
    }
  }

  stop(amount) { this.hitStop = Math.min(0.09, Math.max(this.hitStop, amount)); }

  kill(src, dst) {
    if (dst.isHero) this.heroDeath(src, dst);
    else if (dst.kind === 'tower') this.towerDeath(src, dst);
    else if (dst.kind === 'nexus') this.nexusDeath(dst);
    else this.minionDeath(src, dst);
  }

  minionDeath(src, m) {
    m.alive = false;
    this.vfx.deathBurst(m.pos.x, m.pos.y + 0.6, m.pos.z, TEAM_COL[m.team]);
    const gold = m.isSuper ? 62 : m.kind === 'melee' ? 24 : 32;
    if (src && src.isHero && src.team !== m.team) {
      src.gold += gold;
      src.cs += 1;
      if (src === this.player) this.hud?.damageNumber(m.pos, '+' + gold, 'gold');
    }
    // XP is shared by presence (both heroes level off lane pressure, not CS)
    const xp = m.isSuper ? 110 : m.kind === 'melee' ? 42 : 38;
    for (const h of this.heroes) {
      if (!h.alive || h.team === m.team) continue;
      const dx = h.pos.x - m.pos.x, dz = h.pos.z - m.pos.z;
      if (dx * dx + dz * dz < XP_RADIUS2 || h === src) this.giveXp(h, xp);
    }
  }

  heroDeath(src, h) {
    h.alive = false;
    h.deaths++;
    h.spinRate = 0;
    h.ultPhase = null;
    h.moveSpd = 0;
    h.rootT = 0; h.busyT = 0; h.dashT = -1;
    h.play('death', { dur: 1.1, lock: true, blend: 9 });
    this.vfx.deathBurst(h.pos.x, h.pos.y + 1, h.pos.z, TEAM_COL[h.team]);
    this.vfx.shake(h === this.player ? 0.5 : 0.3);
    this.stop(0.08);
    const killer = src && src.isHero ? src : (h.team === 'blue' ? this.bot : this.player);
    if (killer.isHero) {
      killer.kills++;
      killer.gold += 180 + 26 * h.level;
      this.giveXp(killer, 140 + 26 * h.level);
      if (killer === this.player) this.hud?.damageNumber(h.pos, '+' + (180 + 26 * h.level), 'gold');
    }
    this.score[ENEMY[h.team]]++;
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.announce('FIRST BLOOD', killer.name + ' has drawn first blood', 'kill');
    } else {
      this.announce(h === this.player ? 'SLAIN' : 'ENEMY SLAIN',
        killer.name + ' slew ' + h.name, h === this.player ? 'bad' : 'kill');
    }
    this.hud?.killFeed(killer.name, killer.team, h.name, h.team);
    h.respawnT = Math.min(40, 5 + 2.0 * h.level);
    this.schedule(1.6, () => { if (!h.alive) h.group.visible = false; });
  }

  towerDeath(src, t) {
    t.destroy();
    this.hpBars.release(t.barIdx); t.barIdx = -1;
    if (t.blocker) t.blocker.r = 1.5;
    this.vfx.dawnfall(t.pos.x, 0.2, t.pos.z, 3.4);
    this.vfx.burst(t.pos.x, 4, t.pos.z, { count: 20, col: 0xc9bda4, speed: 6, up: 6, life: 1.1, size: 0.5, gravity: 9, sprite: 3, pool: 'alpha', glow: 1 });
    const attacker = ENEMY[t.team];
    this.announce(t.team === 'red' ? 'TOWER DESTROYED' : 'YOUR TOWER HAS FALLEN',
      (attacker === 'blue' ? 'Dawn legion' : 'Ember legion') + ' toppled the ' + t.tier + ' tower', attacker === 'blue' ? 'kill' : 'bad');
    if (attacker === 'blue') { this.player.gold += 250; this.hud?.damageNumber(t.pos, '+250', 'gold'); }
    else this.bot.gold += 250;
    if (t.tier === 'inner') {
      const nx = this.nexuses.find(n => n.team === t.team);
      if (nx) nx.invulnerable = false;
      // whoever cracked the base gets siege minions — this is what closes games
      this.superWave[attacker] = true;
    }
  }

  nexusDeath(n) {
    n.destroy();
    this.hpBars.release(n.barIdx);
    this.vfx.dawnfall(n.pos.x, 0.7, n.pos.z, 5);
    this.vfx.flash(0.4);
    this.vfx.shake(1.1);
    this.vfx.burst(n.pos.x, 4, n.pos.z, {
      count: 40, col: n.team === 'blue' ? 0x8fd4ff : 0xffab7a, col2: 0xffffff,
      speed: 8, up: 9, life: 1.4, size: 0.5, gravity: 7, sprite: 1, glow: 2,
    });
    this.state = 'ended';
    const victory = n.team === 'red';
    this.announce(victory ? 'VICTORY' : 'DEFEAT', victory ? 'The Ember nexus shatters' : 'The Dawn nexus has fallen', victory ? 'kill' : 'bad');
    this.schedule(1.8, () => this.hud?.showEnd(victory, this.player, this.time));
  }

  giveXp(h, xp) {
    if (h.level >= 15) return;
    h.xp += xp;
    let need = 60 + h.level * 55;
    while (h.xp >= need && h.level < 15) {
      h.xp -= need;
      h.level++;
      need = 60 + h.level * 55;
      const oldMax = h.maxHp;
      h.maxHp = HERO.hp(h.level, h === this.bot);
      h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - oldMax) + 45);
      h.maxMana = HERO.mana(h.level);
      h.mana = Math.min(h.maxMana, h.mana + 32);
      this.vfx.levelUpFx(h);
      if (h === this.player) this.announce('LEVEL ' + h.level, h.level === 5 ? 'Dawnfall unlocked!' : '', 'level');
    }
  }

  // ================================================================ waves ==
  spawnMinion(team, mkind, x, z, opts = {}) {
    if (this.minions.length >= MINION_CAP) return null;
    const min = this.minute();
    const sup = !!opts.sup;
    const base = mkind === 'melee' ? 190 + 16 * min : 125 + 12 * min;
    const m = new Minion({ team, mkind, x, z, maxHp: Math.round(sup ? base * 3.1 : base) });
    m.isSuper = sup;
    const dmg = mkind === 'melee' ? 14 + 1.4 * min : 17 + 1.7 * min;
    m.dmg = sup ? dmg * 2.2 : dmg;
    m.range = mkind === 'melee' ? 1.35 : 6.4;
    m.atkCd = mkind === 'melee' ? 1.25 : 2.0;
    m.hitT = -1; m.hitTgt = null;
    m.slideSide = 0;
    if (sup) { m.hpW = 1.05; m.speed *= 0.94; }
    m.pos.y = this.arena.groundHeight(x, z);
    m.barIdx = this.hpBars.alloc();
    m.shadowIdx = this.blobs.alloc();
    this.scene.add(m.group);
    this.minions.push(m);
    if (!opts.silent) {
      this.vfx.burst(x, 0.6, z, { count: 5, col: TEAM_COL[team], speed: 1.4, up: 1.6, life: 0.4, size: 0.2, sprite: 1 });
    }
    return m;
  }
  // waves come faster as the game runs long so a lead can actually be cashed in
  wavePeriod() {
    const min = this.minute();
    return min > 11 ? 17 : min > 6 ? 20 : WAVE_PERIOD;
  }
  spawnWave(team) {
    const sp = this.arena.waveSpawn[team];
    const dir = team === 'blue' ? 1 : -1;
    for (let i = 0; i < 3; i++) this.spawnMinion(team, 'melee', sp.x + dir * (i % 2) * -1.1, -1.1 + i * 1.1);
    for (let i = 0; i < 2; i++) this.spawnMinion(team, 'caster', sp.x - dir * 1.8, -0.8 + i * 1.6);
    if (this.superWave[team]) this.spawnMinion(team, 'melee', sp.x - dir * 3.2, 0, { sup: true });
  }

  // ============================================================== combat ==
  // windup -> damage point -> (cancellable) recovery
  heroAttack(h, target) {
    const idx = h.comboIdx % 3;
    h.comboIdx++;
    h.comboT = this.time + 3.0;
    const interval = 1 / HERO.aps(h.level);
    const windup = Math.min(ATK.windupMax, interval * ATK.windupFrac);
    const dur = windup + ATK.recover;
    const finisher = idx === 2;
    const dmgMul = finisher ? ATK.comboMul : 1;
    h.attackCd = interval;
    h.rootT = windup;
    h.busyT = windup;
    const anim = ['atk1', 'atk2', 'atk3'][idx];
    const trailId = h === this.player ? 0 : 1;
    this.vfx.trailActive(trailId, true, h.isSera ? 0x9fe8ff : 0xffab6a);
    h.trailUntil = this.time + dur * 0.8;
    h.play(anim, {
      dur, lock: true, blend: 17,
      events: [{
        t: windup,
        fn: () => {
          if (!target.alive || !h.alive) return;
          const d = this.flat(h, target);
          if (d < this.atkRange(h, target) + 0.7) {
            const dmg = this.autoDmg(h) * dmgMul;
            this.damage(h, target, dmg, finisher ? 'crit' : 'phys');
            _v1.copy(target.pos); _v1.y += target.kind === 'tower' ? 4 : 0.9;
            this.vfx.meleeImpact(_v1.x, _v1.y, _v1.z, h.isSera ? 0xbfe8ff : 0xffab6a);
            if (finisher) { this.vfx.shake(0.14); if (target.isHero) this.stop(0.045); }
          }
          const yaw = h.facing + (idx === 1 ? 0.5 : -0.2);
          this.vfx.slashArc(h.pos.x + Math.sin(h.facing) * 1.2, h.pos.y + 1.25, h.pos.z + Math.cos(h.facing) * 1.2,
            yaw, { col: h.isSera ? 0x9fe8ff : 0xffab6a, size: 2.5, tilt: finisher ? -0.5 : -1.2, dur: 0.24 });
        },
      }],
    });
  }

  // ============================================================ abilities ==
  canCast(h, key) {
    if (this.state === 'ended') return false;
    if (!h.alive || h.rootT > 0 || h.busyT > 0 || h.dashT >= 0 || h.ultPhase) return false;
    const ab = ABILITY[key];
    if (!ab || h.cds[key] > 0 || h.mana < ab.mana) return false;
    if (this.rank(h, key) <= 0) return false;
    if (key === 'E' && h.spinRate) return false;
    return true;
  }

  // player entry point (controls.js)
  tryCast(key) {
    const h = this.player;
    if (!this.canCast(h, key)) {
      // Pressed a beat early? Hold it briefly instead of eating the input.
      // Queued while an action owns the hero (root / windup / dash) AND while
      // the cooldown is within a buffer of expiring. Never queued when the bar
      // is short of mana or the rank is not learned — those are real refusals
      // and the HUD already says so.
      const ab = ABILITY[key];
      if (ab && h.alive && this.state !== 'ended' && !h.ultPhase &&
        h.cds[key] <= CAST_BUF_CD && h.mana >= ab.mana && this.rank(h, key) > 0) {
        this.castBuf = key; this.castBufT = CAST_BUF;
      }
      return;
    }
    this.castBuf = ''; this.castBufT = 0;
    const aim = _v3;
    if (this.input.mag > MOVE.deadzone) aim.set(this.input.x, 0, this.input.z).normalize();
    else {
      const t = this.nearestEnemy(h.team, h.pos.x, h.pos.z, ABILITY[key].range + 2,
        NOT_STRUCT);
      if (t) aim.copy(t.pos).sub(h.pos).setY(0).normalize();
      else aim.set(Math.sin(h.facing), 0, Math.cos(h.facing));
    }
    this.castAbility(h, key, aim);
  }

  castAbility(h, key, aim) {
    const ab = ABILITY[key];
    h.mana -= ab.mana;
    h.cds[key] = ab.cd;
    h.facing = Math.atan2(aim.x, aim.z);
    h.chaseTarget = null;
    if (key === 'Q') this.castQ(h, aim);
    else if (key === 'W') this.castW(h, aim);
    else if (key === 'E') this.castE(h);
    else if (key === 'R') this.castR(h, aim);
  }

  castQ(h, aim) {
    const yaw = Math.atan2(aim.x, aim.z);
    const col = h.isSera ? 0x8fe8ff : 0xffab6a;
    h.rootT = ABILITY.Q.cast;
    h.busyT = ABILITY.Q.cast;
    // wind-up tell so the other side can react to the swing
    this.vfx.ring(h.pos.x + aim.x * 1.6, h.pos.y + 0.16, h.pos.z + aim.z * 1.6,
      { r0: 0.4, r1: 3.2, dur: ABILITY.Q.cast, col, alpha: 0.34 });
    const dmg = 50 + 30 * this.rank(h, 'Q') + 0.6 * this.autoDmg(h);
    h.play('q', {
      dur: ABILITY.Q.cast + 0.3, lock: true, blend: 18,
      events: [{
        t: ABILITY.Q.cast,
        fn: () => {
          if (!h.alive) return;
          this.vfx.slashArc(h.pos.x + aim.x * 1.4, h.pos.y + 1.15, h.pos.z + aim.z * 1.4, yaw,
            { col, size: 3.6, dur: 0.42, tilt: -1.35, vel: 13, grow: 2.2 });
          this.vfx.burst(h.pos.x + aim.x * 2, h.pos.y + 1, h.pos.z + aim.z * 2,
            { count: 8, col, speed: 4, up: 1, life: 0.4, size: 0.22, sprite: 1 });
          // the arc sweeps outward: inner band lands now, outer band a beat
          // later, so getting clipped at the tip reads as a late hit
          this.qHit(h, aim, dmg, 0, 3.0);
          h.qAim = h.qAim || new THREE.Vector3();
          h.qAim.copy(aim);
          h.qOx = h.pos.x; h.qOz = h.pos.z; h.qDmg = dmg;
          this.schedule(0.08, () => { if (h.alive) this.qHit(h, h.qAim, h.qDmg, 3.0, ABILITY.Q.range, true); });
          this.vfx.shake(0.1);
        },
      }],
    });
  }

  // cone damage band between r0 and r1 (fromOrigin uses the captured cast spot)
  qHit(h, aim, dmg, r0, r1, fromOrigin) {
    const ox = fromOrigin ? h.qOx : h.pos.x, oz = fromOrigin ? h.qOz : h.pos.z;
    this.eachEnemy(h.team, (u) => {
      _v1.set(u.pos.x - ox, 0, u.pos.z - oz);
      const d = _v1.length();
      if (d >= r0 - u.radius && d < r1 + u.radius && (d < 1.2 || _v1.normalize().dot(aim) > 0.5)) {
        this.damage(h, u, dmg, 'magic');
        if (u.isHero) this.stop(0.04);
      }
      return false;
    });
  }

  castW(h, aim) {
    h.dashT = 0;
    h.dashDir.copy(aim);
    h.dashHit.length = 0;
    h.rootT = 0; h.busyT = ABILITY.W.cast;
    h.moveSpd = 0;
    h.play('dash', { dur: 0.3, lock: true, blend: 20 });
    this.vfx.burst(h.pos.x, h.pos.y + 0.4, h.pos.z, { count: 6, col: h.isSera ? 0xbfe8ff : 0xffc08a, speed: 3, up: 1, life: 0.3, size: 0.3, sprite: 0 });
  }

  castE(h) {
    h.spinRate = 21;
    h.spinUntil = this.time + 0.95;
    h.spinNext = this.time + 0.12;
    h.rootT = ABILITY.E.cast;
    h.busyT = ABILITY.E.cast;
    h.play('spin', { dur: 0.95, lock: false, blend: 16 });
    const trailId = h === this.player ? 0 : 1;
    this.vfx.trailActive(trailId, true, h.isSera ? 0x9fe8ff : 0xffab6a);
    h.trailUntil = this.time + 0.95;
  }

  spinTick(h) {
    const col = h.isSera ? 0x9fe8ff : 0xffab6a;
    const dmg = 12 + 8 * this.rank(h, 'E') + 0.18 * this.autoDmg(h);
    this.vfx.ring(h.pos.x, h.pos.y + 0.2, h.pos.z, { r0: 0.5, r1: ABILITY.E.range, dur: 0.32, col, alpha: 0.65 });
    this.eachEnemy(h.team, (u) => {
      if (this.flat(h, u) < ABILITY.E.range + u.radius) this.damage(h, u, dmg, 'magic');
      return false;
    });
  }

  castR(h, aim) {
    const from = _v1.copy(h.pos);
    const to = _v2.copy(from).addScaledVector(aim, ABILITY.R.range);
    // clamp landing into walkable space
    if (!this.arena.isWalkable(to.x, to.z)) {
      to.copy(from).addScaledVector(aim, 3.5);
      if (!this.arena.isWalkable(to.x, to.z)) to.copy(from);
    }
    h.ultPhase = 'crouch';
    h.ultT = 0;
    h.rootT = 0.2; h.busyT = 0.2;
    h.moveSpd = 0;
    h.ultFrom = h.ultFrom || new THREE.Vector3();
    h.ultTo = h.ultTo || new THREE.Vector3();
    h.ultFrom.copy(from);
    h.ultTo.set(to.x, 0, to.z);
    h.ultTele = this.vfx.telegraph(to.x, to.z, 5.5, h.isSera ? 0xffc36a : 0xff7a44);
    h.play('ultLeap', { dur: 2, lock: true, blend: 12 });
  }

  ultSlam(h) {
    const p = h.pos;
    const dmg = 180 + 120 * this.rank(h, 'R') + 1.0 * this.autoDmg(h);
    if (h.ultTele) { this.vfx.endTelegraph(h.ultTele); h.ultTele = null; }
    this.vfx.dawnfall(p.x, p.y, p.z, 5.5);
    this.vfx.shake(0.55);
    this.stop(0.075);
    h.rootT = 0.22; h.busyT = 0.22;
    h.play('ultSlam', { dur: 0.55, lock: true, blend: 20 });
    this.eachEnemy(h.team, (u) => {
      if (this.flat(h, u) < 5.8 + u.radius) this.damage(h, u, dmg, 'crit');
      return false;
    });
  }

  // ============================================================ hero steps ==
  tickDeadCds(h, dt) {
    for (let i = 0; i < AB_KEYS.length; i++) {
      const k = AB_KEYS[i];
      if (h.cds[k] > 0) h.cds[k] = Math.max(0, h.cds[k] - dt);
    }
  }

  // shared per-frame bookkeeping for both heroes
  tickHero(h, dt) {
    for (let i = 0; i < AB_KEYS.length; i++) {
      const k = AB_KEYS[i];
      if (h.cds[k] > 0) h.cds[k] = Math.max(0, h.cds[k] - dt);
    }
    h.attackCd = Math.max(0, h.attackCd - dt);
    h.rootT = Math.max(0, h.rootT - dt);
    h.busyT = Math.max(0, h.busyT - dt);
    h.attackHold = Math.max(0, h.attackHold - dt);
    if (h.invulnT > 0) h.invulnT -= dt;
    h.mana = Math.min(h.maxMana, h.mana + (2.2 + h.level * 0.25) * dt);
    if (h.hp < h.maxHp) {
      // Out-of-combat regen is the lane's reset button. At 1.4 %/s a champion
      // needed ~28 s of standing still to get from a lost trade back to fighting
      // weight, so the bot simply walked home instead — the fountain round trip
      // was eating a quarter of its game. 3 %/s makes "back off behind the
      // tower, come back" a real option for both sides, which is the Wild Rift
      // laning rhythm; in-combat regen stays negligible so duels are unaffected.
      const ooc = this.time - Math.max(h.lastDamagedT, h.combatT) > 5;
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (ooc ? 0.030 : 0.005) * dt);
    }
    if (h.spinRate) {
      while (h.spinNext <= this.time && h.spinNext < h.spinUntil) { this.spinTick(h); h.spinNext += 0.3; }
      if (this.time >= h.spinUntil) h.spinRate = 0;
    }
    if (h.trailUntil && this.time > h.trailUntil) {
      this.vfx.trailActive(h === this.player ? 0 : 1, false);
      h.trailUntil = 0;
    }
  }

  // returns true when the ult sequence owns this frame
  stepUlt(h, dt) {
    if (!h.ultPhase) return false;
    h.ultT += dt;
    if (h.ultPhase === 'crouch') {
      if (h.ultT > 0.2) {
        h.ultPhase = 'leap'; h.ultT = 0;
        this.vfx.burst(h.pos.x, h.pos.y + 0.2, h.pos.z, { count: 10, col: 0xffe2a0, speed: 3.5, up: 1, life: 0.4, size: 0.3, sprite: 0 });
      }
      h.moving = false;
      return true;
    }
    const T = 0.52;
    const t = Math.min(h.ultT / T, 1);
    h.pos.x = h.ultFrom.x + (h.ultTo.x - h.ultFrom.x) * t;
    h.pos.z = h.ultFrom.z + (h.ultTo.z - h.ultFrom.z) * t;
    h.pos.y = this.arena.groundHeight(h.pos.x, h.pos.z);
    h.airY = Math.sin(t * Math.PI) * 3.4;
    if (h.ultTele) h.ultTele.prog = t;
    if (t >= 1) {
      h.ultPhase = null; h.airY = 0;
      this.ultSlam(h);
    }
    h.moving = false;
    h.syncTransform();
    return true;
  }

  // returns true when the dash owns this frame
  stepDash(h, dt) {
    if (h.dashT < 0) return false;
    h.dashT += dt;
    this.moveUnit(h, h.dashDir.x * DASH_SPEED * dt, h.dashDir.z * DASH_SPEED * dt);
    h.facing = Math.atan2(h.dashDir.x, h.dashDir.z);
    h.moveAng = h.facing;
    if ((h.dashGhostAcc = (h.dashGhostAcc || 0) + dt) > 0.055) {
      h.dashGhostAcc = 0;
      this.vfx.spawnGhost(h.pos, h.facing, 0.5, h.isSera ? 0x6fd4ff : 0xff9a5e);
    }
    const dmg = 40 + 22 * this.rank(h, 'W') + 0.5 * this.autoDmg(h);
    this.eachEnemy(h.team, (u) => {
      if (u.kind === 'tower' || u.kind === 'nexus') return false;
      if (h.dashHit.indexOf(u.id) >= 0) return false;
      if (this.flat(h, u) < 1.5 + u.radius) {
        h.dashHit.push(u.id);
        this.damage(h, u, dmg, 'magic');
        if (u.isHero) { this.vfx.shake(0.18); this.stop(0.05); }
      }
      return false;
    });
    if (h.dashT > DASH_TIME) { h.dashT = -1; h.moveSpd = h.speed * 0.55; }
    h.moving = true;
    h.moveRate = 1;
    h.syncTransform();
    return true;
  }

  stepPlayer(dt) {
    const h = this.player;
    if (!h.alive) {
      h.respawnT -= dt;
      this.tickDeadCds(h, dt);
      if (h.respawnT <= 0) this.respawn(h);
      return;
    }
    this.tickHero(h, dt);
    if (this.castBufT > 0) {
      // try first, expire second: on the frame the buffer runs out the press
      // still gets its shot rather than being dropped a frame early
      if (this.canCast(h, this.castBuf)) {
        const k = this.castBuf; this.castBuf = ''; this.castBufT = 0; this.tryCast(k);
      } else {
        this.castBufT -= dt;
        if (this.castBufT <= 0) this.castBuf = '';
      }
    }
    if (this.stepUlt(h, dt)) return;
    if (this.stepDash(h, dt)) return;

    // ---- movement (input is never eaten: it applies the frame the root ends)
    const inp = this.input;
    let dirX = 0, dirZ = 0, mag = 0;
    const free = h.rootT <= 0;
    if (free && inp.mag > MOVE.deadzone) {
      dirX = inp.x; dirZ = inp.z; mag = inp.mag;
      h.chaseTarget = null;
      this.cancelRecovery(h);
    } else if (free && h.attackHold > 0 && h.chaseTarget && h.chaseTarget.alive) {
      // attack-move: walk into range of the thing we asked to hit
      const want = this.atkRange(h, h.chaseTarget) - 0.35;
      const d = this.flat(h, h.chaseTarget);
      if (d > want) {
        dirX = h.chaseTarget.pos.x - h.pos.x; dirZ = h.chaseTarget.pos.z - h.pos.z;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l; dirZ /= l; mag = 1;
        this.cancelRecovery(h);
      }
    }
    this.stepMove(h, dirX, dirZ, mag, dt, h.spinRate ? 0.75 : 1);

    // ---- attacking
    if (h.attackHold > 0 && h.rootT <= 0 && h.busyT <= 0 && h.attackCd <= 0 && !h.spinRate) {
      const target = this.pickAttackTarget(h);
      if (target) {
        h.chaseTarget = target;
        if (this.flat(h, target) < this.atkRange(h, target)) {
          h.faceToward(target.pos.x, target.pos.z, dt, 50);
          h.moveAng = h.facing;
          if (this.time > h.comboT) h.comboIdx = 0;
          this.heroAttack(h, target);
        }
      }
    }
  }

  // Last-hit priority, then champions, then whatever is closest. Structures are
  // only chosen when nothing else is worth swinging at.
  pickAttackTarget(h) {
    const px = h.pos.x, pz = h.pos.z;
    const ad = this.autoDmg(h) * (h.comboIdx % 3 === 2 ? ATK.comboMul : 1);
    const reach = ATK.range + 0.5;
    // 1. a minion this swing would execute
    let best = null, bestHp = 1e9;
    for (const m of this.minions) {
      if (!m.alive || m.team === h.team) continue;
      if (this.flat(h, m) > reach + m.radius) continue;
      if (m.hp <= ad * 1.02 && m.hp < bestHp) { bestHp = m.hp; best = m; }
    }
    // 2. the enemy champion, when they are in reach — and they jump the queue
    //    ahead of a last hit if they are the one currently hitting us
    const eh = h === this.player ? this.bot : this.player;
    const inReach = eh.alive && this.flat(h, eh) < reach + eh.radius;
    if (inReach && h.lastAttacker === eh && this.time - (h.lastHeroHitT || -99) < 3) return eh;
    if (best) return best;
    if (inReach) return eh;
    // 3. stay on the current target while it lives and stays close
    if (h.chaseTarget && h.chaseTarget.alive && h.chaseTarget.team !== h.team &&
      this.flat(h, h.chaseTarget) < ATK.acquire) return h.chaseTarget;
    // 4. nearest minion in acquisition range
    let near = null, nd = ATK.acquire;
    for (const m of this.minions) {
      if (!m.alive || m.team === h.team) continue;
      const d = this.flat(h, m);
      if (d < nd) { nd = d; near = m; }
    }
    if (near) return near;
    // 5. champion at chase distance, then structures
    if (eh.alive && this.flat(h, eh) < ATK.acquire) return eh;
    return this.nearestEnemy(h.team, px, pz, ATK.acquire, IS_STRUCT);
  }

  respawn(h) {
    h.alive = true;
    h.hp = h.maxHp; h.mana = h.maxMana;
    const sp = this.arena.spawn[h.team];
    h.pos.set(sp.x, 0, sp.z);
    h.pos.y = this.arena.groundHeight(sp.x, sp.z);
    h.facing = h.team === 'blue' ? Math.PI / 2 : -Math.PI / 2;
    h.moveAng = h.facing;
    h.moveSpd = 0;
    h.rootT = 0; h.busyT = 0; h.dashT = -1; h.ultPhase = null; h.spinRate = 0;
    h.chaseTarget = null;
    // a press queued in the half-second before dying must not fire on respawn
    if (h === this.player) { this.castBuf = ''; this.castBufT = 0; }
    else { this.botBuf = ''; this.botBufT = 0; this.botBufTgt = null; }
    h.group.visible = true;
    h.invulnT = 2;
    h.combatT = -99; h.lastDamagedT = -99;
    h.play('idle', { dur: 1e9, lock: false, loop: true });
    this.vfx.respawnFx(h, TEAM_COL[h.team]);
    if (h === this.bot) h.aiState = 'lane';
  }

  // =============================================================== bot AI ==
  stepBot(dt) {
    const b = this.bot;
    if (!b.alive) {
      b.respawnT -= dt;
      this.tickDeadCds(b, dt);
      if (b.respawnT <= 0) this.respawn(b);
      return;
    }
    this.tickHero(b, dt);
    if (this.stepUlt(b, dt)) return;
    if (this.stepDash(b, dt)) return;

    if (this.botBufT > 0) {
      if (this.canCast(b, this.botBuf)) {
        const k = this.botBuf, t = this.botBufTgt;
        this.botBuf = ''; this.botBufT = 0; this.botBufTgt = null;
        this.botCast(b, k, t && t.alive ? t : null);
      } else {
        this.botBufT -= dt;
        if (this.botBufT <= 0) { this.botBuf = ''; this.botBufTgt = null; }
      }
    }
    this.botAiT -= dt;
    if (this.botAiT <= 0) {
      // a human re-reads a duel faster than they re-read a farming pattern
      const hot = this.player.alive && this.flat(b, this.player) < 8.5 &&
        (b.aiState === 'trade' || b.aiState === 'execute' || b.aiState === 'retreat');
      this.botAiT = hot ? 0.09 + this.rng.f(0.07) : 0.16 + this.rng.f(0.14);
      this.botThink();
    }

    const I = this.botIntent;
    if (I.follow && I.follow.alive) { I.x = I.follow.pos.x; I.z = I.follow.pos.z; }
    let dirX = 0, dirZ = 0, mag = 0;
    if (I.move && b.rootT <= 0) {
      dirX = I.x - b.pos.x; dirZ = I.z - b.pos.z;
      const l = Math.hypot(dirX, dirZ);
      if (l > 0.35) { dirX /= l; dirZ /= l; mag = 1; this.cancelRecovery(b); }
    }
    this.stepMove(b, dirX, dirZ, mag, dt, b.spinRate ? 0.75 : 1);

    const tgt = I.target;
    if (tgt && tgt.alive && b.rootT <= 0 && b.busyT <= 0 && b.attackCd <= 0 && !b.spinRate &&
      this.flat(b, tgt) < this.atkRange(b, tgt)) {
      b.faceToward(tgt.pos.x, tgt.pos.z, dt, 50);
      b.moveAng = b.facing;
      if (this.time > b.comboT) b.comboIdx = 0;
      this.heroAttack(b, tgt);
    }
  }

  // Picks a state, a destination and an attack target; fires abilities.
  botThink() {
    const b = this.bot, p = this.player;
    const I = this.botIntent;
    I.move = false; I.target = null; I.follow = null;
    const hpP = b.hp / b.maxHp;
    const pAlive = p.alive;
    const pd = pAlive ? this.flat(b, p) : 1e9;
    const php = pAlive ? p.hp / p.maxHp : 1;
    const cover = this.countMinions('red', b.pos.x, b.pos.z, 7.5);
    const front = this.frontlineX('red');
    // A corpse on a 15-40 s timer is the whole reason kills are worth anything.
    // While that clock runs the bot stops nursing its health bar and cashes the
    // lead in on a structure — the old thresholds sent it home to heal instead,
    // which is how it managed to go 17-3 up and still deal ZERO tower damage.
    const free = !pAlive && p.respawnT > 7;
    const winning = pAlive && php < hpP - 0.08;
    // Is an enemy tower currently chewing on us, and how many stacks deep? A
    // dive is only a dive if you leave before the ramp catches up; without this
    // the bot happily stood in a tower it had aggroed until it fell over.
    let lock = null;
    for (const t of this.towers) {
      if (t.alive && t.team === 'blue' && t.target === b) { lock = t; break; }
    }
    const ramp = lock ? (lock.towerRamp || 0) : 0;
    const towerPressure = !!lock && (ramp >= 3 || (ramp >= 2 && hpP < 0.55));

    // ---- state machine -----------------------------------------------------
    const st = b.aiState;
    if (hpP < 0.12 && !(pd < 5 && php < 0.25) && !(free && hpP > 0.22)) b.aiState = 'heal';
    else if (st === 'heal' && hpP < (free ? 0.42 : 0.55)) b.aiState = 'heal';
    else if (towerPressure && !(pAlive && php < 0.15 && pd < 6)) b.aiState = 'retreat';
    else if (pAlive && php < 0.34 && hpP > 0.42 && pd < 10) b.aiState = 'execute';
    else if (hpP < 0.30 && !winning && !(free && hpP > 0.24)) b.aiState = 'retreat';
    else if (st === 'retreat' && hpP < (free ? 0.34 : 0.48)) b.aiState = 'retreat';
    // fight unless clearly losing: at hpP > php - 0.05 the bot bailed out of any
    // trade it was a hair behind in and then got chased down anyway
    else if (pAlive && pd < 7.0 && hpP > php - 0.18) b.aiState = 'trade';
    else if (!pAlive || b.level >= p.level + 2 || (front < -12 && cover >= 2)) b.aiState = 'siege';
    else b.aiState = 'lane';

    const state = b.aiState;
    let tx = front, tz = 0;

    if (state === 'heal') {
      tx = A.FOUNTAIN_X - 1.5; tz = 0;
      I.move = true; I.x = tx; I.z = tz;
      return;
    }
    if (state === 'retreat') {
      if (lock) {
        // Pulled off a dive: step out of the gun, which is a couple of metres,
        // not all the way home. Running 35 u back to base every time a tower
        // connected was how a successful dive still ended in a lost lane.
        const dx = b.pos.x - lock.pos.x, dz = b.pos.z - lock.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        I.move = true;
        I.x = lock.pos.x + (dx / l) * (lock.range + 2.5);
        I.z = lock.pos.z + (dz / l) * (lock.range + 2.5);
        I.target = this.botPickTarget(b, false);
        return;
      }
      // Fall back behind our own outer tower while we are actually being chased;
      // otherwise hold on the tower's near side and keep farming. Sprinting to
      // x=21.5 every time the health bar dipped was 16 % of the match spent
      // walking away from a lane nobody was contesting.
      const chased = pAlive && pd < 9;
      tx = Math.max(b.pos.x, chased ? A.TOWER_OUTER_X + 3.5 : A.TOWER_OUTER_X - 1.5);
      tz = pAlive && pd < 6 ? (b.pos.z >= p.pos.z ? 3.2 : -3.2) : 0;
      if (pAlive && pd < 4.2 && this.canCast(b, 'W')) {
        _v1.set(b.pos.x - p.pos.x, 0, b.pos.z - p.pos.z).normalize();
        this.castAbility(b, 'W', _v1);
      }
      I.move = true; I.x = tx; I.z = tz;
      // still swat anything that walks into range on the way out
      I.target = this.botPickTarget(b, false);
      return;
    }

    // don't stand in an enemy tower unless we are finishing someone off
    const diveOk = state === 'execute' && (php < 0.22 || cover >= 2);

    if ((state === 'trade' || state === 'execute') && pAlive) {
      const tower = this.towerThreat('red', p.pos.x, p.pos.z, 1.0);
      if (tower && !diveOk) {
        // poke from outside the tower's reach instead of walking in
        const dx = b.pos.x - tower.pos.x, dz = b.pos.z - tower.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        I.move = true;
        I.x = tower.pos.x + (dx / l) * (tower.range + 2.5);
        I.z = tower.pos.z + (dz / l) * (tower.range + 2.5);
        I.target = this.botPickTarget(b, false);
        if (pd < ABILITY.Q.range) this.botTryCast(b, 'Q', p);
        return;
      }
      I.target = p;
      I.follow = p;
      I.move = pd > this.atkRange(b, p) - 0.4;
      I.x = p.pos.x; I.z = p.pos.z;
      // ---- ability usage -------------------------------------------------
      const ad = this.autoDmg(b);
      const rDmg = 180 + 120 * this.rank(b, 'R') + ad;
      // ...or when the fight is plainly committed — both bars past halfway and
      // the enemy in leap range. Holding the ultimate for a guaranteed execute
      // meant the bot ate the player's ult every duel and answered with autos.
      const committed = hpP < 0.72 && php < 0.72 && pd < ABILITY.R.range;
      if (this.canCast(b, 'R') && pd < ABILITY.R.range + 1.5 &&
        (p.hp < rDmg * 1.15 || committed || (state === 'execute' && hpP > 0.5) || (php < 0.6 && hpP > php + 0.2))) {
        _v1.copy(p.pos).sub(b.pos).setY(0);
        if (_v1.lengthSq() < 1e-4) _v1.set(Math.sin(b.facing), 0, Math.cos(b.facing));
        this.castAbility(b, 'R', _v1.normalize());
        return;
      }
      if (pd > 3.4 && pd < ABILITY.W.range && this.botTryCast(b, 'W', p)) return;
      if (pd < ABILITY.Q.range && this.botTryCast(b, 'Q', p)) return;
      if (pd < ABILITY.E.range - 0.4 && this.botTryCast(b, 'E', p)) return;
      return;
    }

    // ---- lane / siege ------------------------------------------------------
    const target = this.botPickTarget(b, state === 'siege');
    I.target = target;
    if (target) {
      const want = this.atkRange(b, target) - 0.4;
      const d = this.flat(b, target);
      I.move = d > want;
      I.x = target.pos.x; I.z = target.pos.z;
      if (target.kind !== 'tower' && target.kind !== 'nexus') I.follow = target;
    } else if (state === 'siege') {
      // Nothing to hit and no wave to follow. frontlineX() falls back to our own
      // outer tower when the wave is dead, so the bot used to walk all the way
      // HOME and stand there — 27 % of a match spent with nothing in range and
      // no structure within 12 u. Hold at the frontier instead: just outside the
      // next enemy building's gun, or right on it while the enemy is respawning.
      I.move = true;
      const st2 = this.nearestEnemy('red', b.pos.x, b.pos.z, 90, IS_STRUCT);
      if (st2) {
        const dx = b.pos.x - st2.pos.x, dz = b.pos.z - st2.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const hold = free ? 0.5 : (st2.range || 0) + 1.4;
        I.x = st2.pos.x + (dx / l) * hold;
        I.z = st2.pos.z + (dz / l) * hold;
      } else { I.x = front - 1.5; I.z = 0; }
    } else {
      I.move = true;
      I.x = Math.max(-A.TOWER_INNER_X + 4, Math.min(front - 1.5, A.SPAWN_X));
      I.z = 0;
    }
    // Hold position outside enemy tower range unless the wave is in front of us.
    // With the enemy champion on a respawn clock one minion of cover is enough:
    // that is the difference between "respects tower range" and "never takes an
    // objective in its life".
    const tw = this.towerThreat('red', I.x, I.z, 0.8);
    const needCover = free ? 1 : 2;
    if (tw && this.countMinions('red', tw.pos.x, tw.pos.z, tw.range) < needCover) {
      const dx = b.pos.x - tw.pos.x, dz = b.pos.z - tw.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      I.x = tw.pos.x + (dx / l) * (tw.range + 2.2);
      I.z = tw.pos.z + (dz / l) * (tw.range + 2.2);
      I.move = true;
      // the hold-off point is a fixed spot, not a chase — leaving `follow` set
      // would let stepBot overwrite it with the target's live position every
      // frame and walk straight back into the gun this clause just dodged
      I.follow = null;
      if (target && target.kind !== 'tower' && this.flat(b, target) > this.atkRange(b, target)) I.target = null;
    }
    // wave clear / poke
    if (b.mana > b.maxMana * 0.45) {
      if (this.canCast(b, 'E') && this.countMinions('blue', b.pos.x, b.pos.z, ABILITY.E.range) >= 2) {
        this.castAbility(b, 'E', this.botAim(b, target || p));
        return;
      }
      if (this.canCast(b, 'Q') && target && this.flat(b, target) < ABILITY.Q.range &&
        (this.countMinions('blue', target.pos.x, target.pos.z, 3.2) >= 2 || target.isHero)) {
        this.botCast(b, 'Q', target);
      }
    }
  }

  // The player's presses survive a windup (castBuf). The bot only re-tries on
  // its next think tick, so every ability it wanted mid-animation cost it up to
  // a reaction window. Same buffer, same rules — the aim is re-read from the
  // live target when it finally fires, so it never throws at a ghost.
  botTryCast(b, key, target) {
    if (this.canCast(b, key)) { this.botCast(b, key, target); return true; }
    const ab = ABILITY[key];
    if (ab && b.alive && !b.ultPhase && b.cds[key] <= 0 && b.mana >= ab.mana &&
      this.rank(b, key) > 0 && (b.rootT > 0 || b.busyT > 0 || b.dashT >= 0)) {
      this.botBuf = key; this.botBufT = 0.25; this.botBufTgt = target || null;
    }
    return false;
  }

  botAim(b, t) {
    if (t) {
      _v1.copy(t.pos).sub(b.pos).setY(0);
      if (_v1.lengthSq() > 1e-4) return _v1.normalize();
    }
    return _v1.set(Math.sin(b.facing), 0, Math.cos(b.facing));
  }
  botCast(b, key, t) { this.castAbility(b, key, this.botAim(b, t)); }

  // bot's auto-attack choice: last-hit first, then champion, then structures
  botPickTarget(b, siege) {
    const ad = this.autoDmg(b);
    const reach = ATK.range + 0.6;
    let exec = null, execHp = 1e9, near = null, nd = ATK.acquire;
    for (const m of this.minions) {
      if (!m.alive || m.team === 'red') continue;
      const d = this.flat(b, m);
      if (d < reach + m.radius && m.hp <= ad * 1.02 && m.hp < execHp) { execHp = m.hp; exec = m; }
      if (d < nd) { nd = d; near = m; }
    }
    if (exec) return exec;
    const p = this.player;
    if (p.alive && this.flat(b, p) < reach + p.radius) return p;
    if (siege) {
      // Structures used to sit BELOW "nearest minion within 8 u", so as long as
      // one blue minion was wandering the lane the bot would farm it forever and
      // the tower never took a scratch. A sieging player hits the building while
      // their own wave tanks it; the minion only wins the slot if it is actually
      // in our face or about to die.
      const st = this.nearestEnemy('red', b.pos.x, b.pos.z, 11.5, IS_STRUCT);
      if (st) {
        const sd = this.flat(b, st);
        const covered = this.countMinions('red', st.pos.x, st.pos.z, 7.5) >= 1;
        // in swing range with our wave present: hit the building
        if (sd < this.atkRange(b, st) + 0.6 && (covered || !near)) return st;
        // nothing chewing on us: walk the last step to the building
        if (!near || (covered && nd > 4.2)) return st;
      }
    }
    if (near) return near;
    return null;
  }

  // legacy hook kept for stage(): Kargath's cone slash
  castBotCleave(b, aim) {
    b.cds.Q = ABILITY.Q.cd;
    this.castQ(b, aim);
  }

  frontlineX(team) {
    // furthest pushed allied minion
    let x = team === 'red' ? A.SPAWN_X : -A.SPAWN_X;
    let any = false;
    for (const m of this.minions) {
      if (!m.alive || m.team !== team) continue;
      any = true;
      if (team === 'red') x = Math.min(x, m.pos.x);
      else x = Math.max(x, m.pos.x);
    }
    return any ? x : (team === 'red' ? A.TOWER_OUTER_X : -A.TOWER_OUTER_X);
  }

  // ============================================================== minions ==
  stepMinions(dt) {
    for (const m of this.minions) {
      if (!m.alive) continue;
      m.attackCd = Math.max(0, m.attackCd - dt);
      // delayed swing / bolt (no closure allocation per attack)
      if (m.hitT >= 0 && this.time >= m.hitT) {
        const tgt = m.hitTgt;
        m.hitT = -1; m.hitTgt = null;
        if (tgt && tgt.alive) {
          if (m.kind === 'melee') {
            if (this.flat(m, tgt) < m.range + tgt.radius + 0.9) {
              this.damage(m, tgt, m.dmg);
              _v2.copy(tgt.pos); _v2.y += tgt.kind === 'tower' ? 3.5 : 0.75;
              this.vfx.hitSpark(_v2.x, _v2.y, _v2.z, 0xffe0b0);
            }
          } else {
            m.getMuzzle(_v2);
            this.vfx.projectile({
              from: _v2, target: tgt, to: tgt.pos, speed: 15,
              col: m.team === 'blue' ? 0x76c8ff : 0xff9a5e, size: 0.26,
              onHit: () => { if (tgt.alive) this.damage(m, tgt, m.dmg, 'magic'); },
            });
          }
        }
      }
      // acquire: enemy minions first, champions only when they are the closest
      // meaningful thing (or aggroed by attacking a champion), towers last
      if (!m.target || !m.target.alive || this.flat(m, m.target) > 11) m.target = this.minionTarget(m);
      const dir = m.team === 'blue' ? 1 : -1;
      let mvx = 0, mvz = 0;
      if (m.target) {
        const d = this.flat(m, m.target);
        const range = m.range + m.target.radius;
        if (d > range) {
          _v1.copy(m.target.pos).sub(m.pos).setY(0);
          const l = _v1.length() || 1;
          mvx = (_v1.x / l) * m.speed * dt; mvz = (_v1.z / l) * m.speed * dt;
          m.faceToward(m.target.pos.x, m.target.pos.z, dt, 10);
        } else {
          m.faceToward(m.target.pos.x, m.target.pos.z, dt, 10);
          if (m.attackCd <= 0) {
            m.attackCd = m.atkCd;
            m.playAttack();
            m.hitT = this.time + (m.kind === 'melee' ? 0.22 : 0.34);
            m.hitTgt = m.target;
          }
        }
      } else {
        // push down lane
        const targetX = dir * A.HALF_X;
        _v1.set(Math.sign(targetX - m.pos.x), 0, (0 - m.pos.z) * 0.3);
        _v1.normalize();
        mvx = _v1.x * m.speed * dt; mvz = _v1.z * m.speed * dt;
        m.faceToward(m.pos.x + mvx * 10, m.pos.z + mvz * 10, dt, 6);
      }
      m.moving = (mvx !== 0 || mvz !== 0);
      if (m.moving) this.moveUnit(m, mvx, mvz);
    }
    // separation (allies only, cheap n²  on ≤32)
    for (let i = 0; i < this.minions.length; i++) {
      const a = this.minions[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.minions.length; j++) {
        const b = this.minions[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz, min = 0.95;
        if (d2 < min * min && d2 > 1e-5) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5 / d;
          if (this.arena.isWalkable(a.pos.x - dx * push, a.pos.z - dz * push)) { a.pos.x -= dx * push; a.pos.z -= dz * push; }
          if (this.arena.isWalkable(b.pos.x + dx * push, b.pos.z + dz * push)) { b.pos.x += dx * push; b.pos.z += dz * push; }
        }
      }
    }
  }

  minionTarget(m) {
    let best = null, bd = 8.5;
    for (const o of this.minions) {
      if (!o.alive || o.team === m.team) continue;
      const d = this.flat(m, o);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) return best;
    const eh = m.team === 'blue' ? this.bot : this.player;
    if (eh.alive) {
      const d = this.flat(m, eh);
      if (d < 8.5 || (d < 11 && this.time < eh.aggroUntil)) return eh;
    }
    return this.nearestEnemy(m.team, m.pos.x, m.pos.z, 10.5, IS_STRUCT);
  }

  // =============================================================== towers ==
  stepTowers(dt) {
    const minDmg = 170 + 8 * this.minute();
    for (const t of this.towers) {
      if (!t.alive) { t.update(dt); continue; }
      // validate target
      if (t.target && (!t.target.alive || this.flat(t.target, t) > t.range + 1)) t.target = null;
      if (t.target && t.target.isHero && this.time > t.aggroT) {
        // aggro lock expired: drop back to minions if any are in range
        const m = this.nearestEnemy(t.team, t.pos.x, t.pos.z, t.range, u => !u.isHero && u.kind !== 'tower' && u.kind !== 'nexus');
        if (m) { t.target = m; t.towerRamp = 0; }
      }
      if (!t.target) {
        t.target = this.nearestEnemy(t.team, t.pos.x, t.pos.z, t.range, u => !u.isHero) ||
          this.nearestEnemy(t.team, t.pos.x, t.pos.z, t.range, u => u.isHero);
        t.chargeT = 0;
        t.towerRamp = 0;
      }
      if (t.target) {
        t.chargeT = Math.min(1, t.chargeT + dt * 2.2);
        t.beamCd -= dt;
        if (t.chargeT >= 1 && t.beamCd <= 0) {
          t.beamCd = 1.05;
          const tgt = t.target;
          _v1.set(t.pos.x, 7.6, t.pos.z);
          _v2.copy(tgt.pos); _v2.y += tgt.isHero ? 1.2 : 0.7;
          this.vfx.beam(_v1, _v2, { col: t.team === 'blue' ? 0x7ac8ff : 0xff8a4d, dur: 0.3, r: 0.3 });
          this.vfx.hitSpark(_v2.x, _v2.y, _v2.z, t.team === 'blue' ? 0x9fd8ff : 0xffab7a);
          let dmg;
          if (tgt.isHero) {
            // Anti-dive tax: 100 / 125 / 156 / 195 / 244 / 305 per shot. The old
            // 4-stack / 175 cap let a level-15 champion loiter under a tower for
            // twelve seconds. Measured both over 8 seeds x 3 policies: the deeper
            // ramp does not change who wins, but it keeps matches inside
            // 9-16 min instead of letting one drag to 24, and it costs the side
            // that overstays rather than the side that respects the gun.
            t.towerRamp = Math.min(6, (t.towerRamp || 0) + 1);
            dmg = 100 * Math.pow(1.25, t.towerRamp - 1);
            if (tgt === this.player) this.vfx.shake(0.22);
          } else dmg = minDmg;
          this.damage(t, tgt, dmg, 'magic');
        }
      } else t.chargeT = Math.max(0, t.chargeT - dt * 3);
      t.update(dt);
    }
    for (const n of this.nexuses) n.update(dt);
  }

  // ============================================================ fountains ==
  stepFountains(dt) {
    this.fountainT -= dt;
    const tick = this.fountainT <= 0;
    if (tick) this.fountainT = 0.5;
    for (let i = 0; i < 2; i++) {
      const team = i === 0 ? 'blue' : 'red';
      const fx = i === 0 ? -A.FOUNTAIN_X : A.FOUNTAIN_X;
      const hero = i === 0 ? this.player : this.bot;
      if (hero.alive && Math.hypot(hero.pos.x - fx, hero.pos.z) < 6) {
        const heal = hero.maxHp * 0.15 * dt;
        if (hero.hp < hero.maxHp) {
          hero.hp = Math.min(hero.maxHp, hero.hp + heal);
          if (tick && hero === this.player) this.hud?.damageNumber(hero.pos, '+' + Math.round(hero.maxHp * 0.05), 'heal');
        }
        hero.mana = Math.min(hero.maxMana, hero.mana + hero.maxMana * 0.12 * dt);
      }
      // fountain zaps intruders — diving a base is death, not a strategy
      const enemy = i === 0 ? this.bot : this.player;
      if (tick && enemy.alive && Math.hypot(enemy.pos.x - fx, enemy.pos.z) < 7.5) {
        _v1.set(fx, 3.4, 0);
        _v2.copy(enemy.pos); _v2.y += 1;
        this.vfx.beam(_v1, _v2, { col: i === 0 ? 0x7ac8ff : 0xff8a4d, dur: 0.25, r: 0.24 });
        this.damage(null, enemy, 220 + enemy.maxHp * 0.06, 'magic');
      }
    }
  }

  // ================================================================= step ==
  step(dt) {
    // hit-stop: a couple of frames of near-freeze sells the impact
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      dt *= HITSTOP_SCALE;
    }
    this.time += dt;
    // scheduled events
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].t <= this.time) {
        const e = this.pending[i];
        this.pending.splice(i, 1);
        e.fn();
      }
    }
    if (this.state !== 'ended') {
      this.waveT -= dt;
      if (this.waveT <= 0) {
        this.waveT = this.wavePeriod();
        this.waveN++;
        this.spawnWave('blue');
        this.spawnWave('red');
      }
      this.stepPlayer(dt);
      this.stepBot(dt);
      this.stepMinions(dt);
      this.stepFountains(dt);
    } else {
      // idle anims post-game
      this.player.moving = false;
      this.bot.moving = false;
    }
    this.stepTowers(dt);

    // passive gold
    if (this.state !== 'ended' && this.time > 10) {
      this.player.gold += 1.3 * dt;
      this.bot.gold += 1.3 * dt;
    }

    // cull dead minions
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      if (!m.alive) {
        this.hpBars.release(m.barIdx);
        this.blobs.release(m.shadowIdx);
        this.scene.remove(m.group);
        this.minions.splice(i, 1);
      }
    }
  }

  // Visual-rate update (called every render frame with real dt)
  updateVisuals(dt, camera) {
    // Characters share the sim's clock so hit-stop actually reads: without this
    // the rigs kept swinging at full speed through the freeze and only the
    // damage lagged, which felt like input lag instead of impact. VFX and
    // camera stay on real time (main.js) — particles flying past a frozen
    // silhouette is the whole point of the effect.
    const adt = this.hitStop > 0 ? dt * HITSTOP_SCALE : dt;
    for (const m of this.minions) m.update(adt);
    this.player.update(adt);
    this.bot.update(adt);
    // sword trails sampling (indexed loop: no per-frame array allocation)
    for (let i = 0; i < 2; i++) {
      const h = this.heroes[i];
      if (h.trailUntil && h.alive) {
        h.getBladePoints(_v1, _v2);
        this.vfx.trailPush(i, _v1, _v2);
      }
    }
    // hp bars + blob shadows
    const bars = this.hpBars, blobs = this.blobs;
    for (const m of this.minions) {
      bars.set(m.barIdx, m.pos.x, m.pos.y + m.hpY, m.pos.z, m.hp / m.maxHp, m.hpW,
        m.team === 'blue' ? 0x4fa8ff : 0xe0342a, 0);
      blobs.set(m.shadowIdx, m.pos.x, m.pos.y + 0.06, m.pos.z, 1.0);
    }
    for (let i = 0; i < 2; i++) {
      const h = this.heroes[i];
      if (h.alive) {
        bars.set(h.barIdx, h.pos.x, h.pos.y + h.hpY + h.airY, h.pos.z, h.hp / h.maxHp, h.hpW,
          h === this.player ? 0x5ce87a : 0xe0342a, h === this.player ? 1 : 0);
        blobs.set(h.shadowIdx, h.pos.x, h.pos.y + 0.06, h.pos.z, 1.35);
      } else {
        bars.set(h.barIdx, 0, -99, 0, 0, 0.1, 0, 0);
        blobs.set(h.shadowIdx, 0, -99, 0, 0);
      }
    }
    for (const t of this.towers) {
      if (t.alive && t.barIdx >= 0) {
        bars.set(t.barIdx, t.pos.x, t.hpY, t.pos.z, t.hp / t.maxHp, t.hpW,
          t.team === 'blue' ? 0x4fa8ff : 0xe0342a, 0);
      }
    }
    for (const n of this.nexuses) {
      if (n.alive && n.barIdx >= 0) {
        const show = !n.invulnerable || n.hp < n.maxHp;
        bars.set(n.barIdx, n.pos.x, n.hpY, n.pos.z, n.hp / n.maxHp, show ? n.hpW : 0,
          n.team === 'blue' ? 0x4fa8ff : 0xe0342a, 0);
        if (!show) bars.set(n.barIdx, 0, -99, 0, 0, 0.1, 0, 0);
      }
    }
    bars.flush();
    blobs.flush();
  }

  // input API (controls)
  setMove(x, z, mag) { this.input.x = x; this.input.z = z; this.input.mag = mag; }
  pressAttack() {
    if (this.state === 'ended') return;
    const h = this.player;
    h.wantAttack = true;
    h.attackHold = ATK.hold;
    if (!h.chaseTarget || !h.chaseTarget.alive) h.chaseTarget = this.pickAttackTarget(h);
  }

  // ============================================================== staging ==
  clearMinions() {
    for (const m of this.minions) {
      m.alive = false;
      this.hpBars.release(m.barIdx);
      this.blobs.release(m.shadowIdx);
      this.scene.remove(m.group);
    }
    this.minions.length = 0;
    this.pending.length = 0;
    this.hitStop = 0;
  }

  stage(name) {
    const P = this.player, B = this.bot;
    this.clearMinions();
    this.hud?.reset();
    this.vfx.resetAll();
    P.trailUntil = 0; B.trailUntil = 0;
    this.state = 'playing';
    for (const h of [P, B]) {
      h.alive = true; h.group.visible = true;
      h.spinRate = 0; h.extraYaw = 0; h.airY = 0; h.dashT = -1; h.ultPhase = null;
      h.play('idle', { dur: 1e9, lock: false, loop: true });
    }
    const clash = (bx, rx, n = 5) => {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const m = this.spawnMinion('blue', 'melee', bx + (i % 2) * 0.9, -1.6 + i * 1.5, { silent: true });
        const r = this.spawnMinion('red', 'melee', rx - (i % 2) * 0.9, -1.3 + i * 1.4, { silent: true });
        if (m && r) { m.target = r; r.target = m; m.facing = Math.PI / 2; r.facing = -Math.PI / 2; }
        out.push(m, r);
      }
      for (let i = 0; i < 2; i++) {
        const c = this.spawnMinion('blue', 'caster', bx - 2.6, -1 + i * 2, { silent: true });
        const rc = this.spawnMinion('red', 'caster', rx + 2.6, -0.9 + i * 1.9, { silent: true });
        if (c) c.facing = Math.PI / 2;
        if (rc) rc.facing = -Math.PI / 2;
        out.push(c, rc);
      }
      return out;
    };
    const fight = (list) => {
      for (const m of list) {
        if (!m) continue;
        m.playAttack();
        m.attackAnimT = m.kind === 'melee' ? 0.28 : 0.4;
      }
    };

    // sensible HUD numbers for the shot
    P.level = 7; P.gold = 2843; P.cs = 64; P.kills = 4; P.deaths = 2;
    // derive from the live stat curve so the staged HUD can't drift from it
    P.maxHp = HERO.hp(P.level, false); P.hp = P.maxHp * 0.72;
    P.maxMana = HERO.mana(P.level); P.mana = P.maxMana * 0.55;
    P.xp = 180;
    P.cds.Q = 2.1; P.cds.W = 0; P.cds.E = 4.2; P.cds.R = 0;
    B.level = 7; B.maxHp = HERO.hp(B.level, true); B.hp = B.maxHp * 0.6;
    this.score.blue = 7; this.score.red = 5;
    this.time = 9 * 60 + 21;
    this.waveT = 18;

    if (name === 'overview') {
      P.pos.set(-14, 0, 2.2); P.facing = Math.PI / 2;
      B.pos.set(15, 0, -2); B.facing = -Math.PI / 2;
      P.moving = true; B.moving = true;
      P.play('run', { dur: 1e9, lock: false, loop: true });
      B.play('run', { dur: 1e9, lock: false, loop: true });
      fight(clash(-3.4, 2.4));
      const t = this.towers[2];
      _v1.set(t.pos.x, 7.6, t.pos.z); _v2.set(t.pos.x - 6, 1, t.pos.z + 1);
    } else if (name === 'gameplay') {
      P.pos.set(-7.6, 0, 1.6); P.facing = Math.PI / 2 - 0.15;
      B.pos.set(-1.4, 0, -2.2); B.facing = -Math.PI / 2 - 0.3;
      const list = clash(-6.4, -2.6);
      fight(list);
      // player mid-slash on nearest red melee
      const victim = list[1];
      if (victim) {
        victim.pos.set(-5.3, 0, 1.3);
        victim.hp = victim.maxHp * 0.4;
        P.faceToward(victim.pos.x, victim.pos.z, 1, 99);
        this.heroAttack(P, victim);
        P.anim.t = 0.19;
      }
      // Kargath cleaving
      this.castBotCleave(B, _v1.set(-1, 0, 0.62).normalize().clone());
      B.anim.t = 0.24;
      // an enemy caster bolt mid-flight
      const rc = list[7] || list[6];
      if (rc) {
        rc.getMuzzle(_v2);
        this.vfx.projectile({ from: _v2, to: _v3.set(P.pos.x + 1.6, 0.6, P.pos.z + 2.2), speed: 12, col: 0xff9a5e, size: 0.28 });
      }
      const bc = list[6] || list[7];
      if (bc && bc.team === 'blue') {
        bc.getMuzzle(_v2);
        this.vfx.projectile({ from: _v2, to: _v3.set(-2.4, 0.9, -0.7), speed: 12, col: 0x76c8ff, size: 0.28 });
      }
      this.hud?.damageNumber(_v1.set(-5.3, 1.4, 1.3), 118, 'crit');
      this.hud?.damageNumber(_v1.set(-4.4, 1.2, -0.6), 42, 'phys');
      this.hud?.damageNumber(_v1.set(P.pos.x, 1.5, P.pos.z), 37, 'taken');
    } else if (name === 'hero') {
      // forward is (sin f, cos f); camera sits at +X/+Z, so f ≈ 0.5 faces it.
      // Bias off-axis for a 3/4 hero shot rather than a flat front-on.
      // Camera azimuth is ~0.50, so facing 0.50 is dead frontal. 0.17 was only
      // 19 degrees off; -0.30 overshot to 46 and stacked with the rig's own
      // contrapposto yaw until the cape faced the lens. 0.28 lands the 3/4.
      // Nudged a metre down-lane off the old mark: a banner pole stood directly
      // behind her and ran a hard vertical through the silhouette. Moving her
      // further (to -11.6) instead put a tower base in each third, which is
      // worse — this keeps the open sunlit plaza behind her.
      P.pos.set(-14.3, 0, 3.4); P.facing = 0.28;
      B.pos.set(30, 0, -2);
      P.play('showcase', { dur: 1e9, lock: true, loop: true, blend: 20 });
      P.anim.t = 1.2;
    } else if (name === 'ult') {
      P.pos.set(7.2, 0, 0.4); P.facing = Math.PI / 2;
      B.pos.set(10.6, 0, -1.8); B.facing = -Math.PI / 2;
      B.hp = B.maxHp * 0.35;
      B.play('hit', { dur: 0.5, lock: true });
      const reds = [];
      for (let i = 0; i < 3; i++) reds.push(this.spawnMinion('red', 'melee', 9.5 + (i % 2) * 1.4, -2.2 + i * 1.9, { silent: true }));
      this.spawnMinion('red', 'caster', 11.5, 1.8, { silent: true });
      for (const m of this.minions) { if (m) { m.hitScale = 1; m.facing = -Math.PI / 2; } }
      P.play('ultSlam', { dur: 0.6, lock: true, blend: 30 });
      P.anim.t = 0.1;
      this.vfx.dawnfall(P.pos.x + Math.sin(P.facing) * 0.8, P.pos.y, P.pos.z + Math.cos(P.facing) * 0.8, 5.5);
      this.hud?.damageNumber(_v1.set(10.6, 1.8, -1.8), 428, 'crit');
      this.hud?.damageNumber(_v1.set(9.5, 1.3, -0.4), 428, 'crit');
      this.hud?.damageNumber(_v1.set(11.2, 1.2, 1.8), 428, 'crit');
    } else if (name === 'river') {
      P.pos.set(-6.5, 0, 6.4); P.facing = 0.8;
      B.pos.set(30, 0, -2);
    } else if (name === 'base') {
      P.pos.set(-A.BASE_X + 4, 0, 2.5); P.facing = Math.PI * 0.75;
      B.pos.set(30, 0, -2);
    }
    for (const h of [P, B]) {
      h.pos.y = this.arena.groundHeight(h.pos.x, h.pos.z);
      h.syncTransform();
    }
  }
}
