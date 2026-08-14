// Fixed-step simulation: minion waves, combat, bot AI, towers, fountains,
// win/lose, gold/xp — plus deterministic staging for the screenshot presets.
import * as THREE from 'three';
import { makeRng, simSeed } from '../core/rng.js';
import { A } from '../world/arena.js';
import { buildTower, buildNexusCrystal } from '../world/props.js';
import { Hero } from '../entities/hero.js';
import { Minion, Tower, Nexus, HPBars, BlobShadows } from '../entities/units.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TEAM_COL = { blue: 0x59a2ff, red: 0xff6a55 };
const ENEMY = { blue: 'red', red: 'blue' };

const ABILITY = {
  Q: { cd: 5.5, mana: 20 },
  W: { cd: 9.5, mana: 25 },
  E: { cd: 11, mana: 30 },
  R: { cd: 46, mana: 60 },
};

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
    this.waveT = 4;           // first wave
    this.waveN = 0;

    this.hpBars = new HPBars(scene, 48);
    this.blobs = new BlobShadows(scene, 40);

    // towers & nexus
    this.towers = [];
    for (const spec of arena.towerSpecs) {
      const built = buildTower(spec.team);
      const t = new Tower({ ...spec, built });
      scene.add(t.group);
      t.blocker = arena.addBlocker(spec.x, spec.z, 2.05);
      t.barIdx = this.hpBars.alloc();
      this.towers.push(t);
    }
    this.nexuses = [];
    for (const spec of arena.nexusSpecs) {
      const built = buildNexusCrystal(spec.team);
      const n = new Nexus({ ...spec, built });
      scene.add(n.group);
      arena.addBlocker(spec.x, spec.z, 2.5);
      n.barIdx = this.hpBars.alloc();
      this.nexuses.push(n);
    }

    // heroes
    this.player = new Hero({ name: 'Sera', team: 'blue', build: 'sera', x: arena.spawn.blue.x, z: 0 });
    this.bot = new Hero({ name: 'Kargath', team: 'red', build: 'kargath', x: arena.spawn.red.x, z: 0 });
    this.bot.maxHp = 640; this.bot.hp = 640;
    for (const h of [this.player, this.bot]) {
      scene.add(h.group);
      h.barIdx = this.hpBars.alloc();
      h.shadowIdx = this.blobs.alloc();
      h.pos.y = arena.groundHeight(h.pos.x, h.pos.z);
      h.invulnT = 0;
      h.comboIdx = 0; h.comboT = 0;
      h.dashT = -1; h.dashDir = new THREE.Vector3();
      h.ultPhase = null;
      h.attackHold = 0;
      h.chaseTarget = null;
      h.regenT = 0;
      h.lastDamagedT = -99;
      h.towerRamp = 0;
    }
    this.input = { x: 0, z: 0, mag: 0 };
    this.aimDir = new THREE.Vector3(1, 0, 0);
    this.botAiT = 0;
    this.fountainT = 0;
    this.trailBusy = [false, false];
  }

  // ============================================================== helpers ==
  announce(t, s, kind) { this.hud?.announce(t, s, kind); }
  schedule(delay, fn) { this.pending.push({ t: this.time + delay, fn }); }

  playerAutoDmg(hero) { return 50 + 9.5 * hero.level; }

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

  damage(src, dst, amount, kind = 'phys') {
    if (!dst.alive || (dst.invulnT && dst.invulnT > 0)) return 0;
    if (dst.kind === 'nexus' && dst.invulnerable) {
      if (src === this.player) this.hud?.damageNumber(dst.pos, 'IMMUNE', 'magic');
      return 0;
    }
    const dealt = dst.takeDamage(amount);
    dst.lastDamagedT = this.time;
    if (dst.hitScale !== undefined) dst.hitScale = 1;
    if (dst.isHero) {
      dst.hitFlash();
      if (dst === this.player) this.vfx.shake(0.12);
    }
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

  kill(src, dst) {
    if (dst.isHero) this.heroDeath(src, dst);
    else if (dst.kind === 'tower') this.towerDeath(src, dst);
    else if (dst.kind === 'nexus') this.nexusDeath(dst);
    else this.minionDeath(src, dst);
  }

  minionDeath(src, m) {
    m.alive = false;
    this.vfx.deathBurst(m.pos.x, m.pos.y + 0.6, m.pos.z, TEAM_COL[m.team]);
    if (src === this.player) {
      const gold = m.kind === 'melee' ? 24 : 32;
      this.player.gold += gold;
      this.player.cs += 1;
      this.giveXp(this.player, 32);
      this.hud?.damageNumber(m.pos, '+' + gold, 'gold');
    } else if (src === this.bot) {
      this.bot.gold += 26; this.bot.cs += 1;
      this.giveXp(this.bot, 32);
    } else {
      // proximity xp for heroes near the death
      for (const h of [this.player, this.bot]) {
        if (h.alive && h.team !== m.team && h.pos.distanceTo(m.pos) < 11) this.giveXp(h, 22);
      }
    }
  }

  heroDeath(src, h) {
    h.alive = false;
    h.deaths++;
    h.spinRate = 0;
    h.ultPhase = null;
    h.play('death', { dur: 1.1, lock: true, blend: 9 });
    this.vfx.deathBurst(h.pos.x, h.pos.y + 1, h.pos.z, TEAM_COL[h.team]);
    this.vfx.shake(h === this.player ? 0.5 : 0.3);
    const killer = src && src.isHero ? src : (h.team === 'blue' ? this.bot : this.player);
    if (killer.isHero) {
      killer.kills++;
      killer.gold += 300;
      this.giveXp(killer, 150 + 20 * h.level);
      if (killer === this.player) this.hud?.damageNumber(h.pos, '+300', 'gold');
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
    h.respawnT = 6 + h.level * 1.6;
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
      h.maxHp = (h === this.player ? 560 : 620) + 95 * (h.level - 1);
      h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - oldMax) + 40);
      h.maxMana = 120 + 14 * (h.level - 1);
      h.mana = Math.min(h.maxMana, h.mana + 30);
      this.vfx.levelUpFx(h);
      if (h === this.player) this.announce('LEVEL ' + h.level, h.level === 5 ? 'Dawnfall unlocked!' : '', 'level');
    }
  }

  // ================================================================ waves ==
  spawnMinion(team, mkind, x, z, opts = {}) {
    if (this.minions.length >= 26) return null;
    const lvl = Math.floor(this.time / 60);
    const m = new Minion({
      team, mkind, x, z,
      maxHp: (mkind === 'melee' ? 135 : 95) + lvl * 9,
    });
    m.dmg = (mkind === 'melee' ? 13 : 17) + lvl * 1.3;
    m.range = mkind === 'melee' ? 1.35 : 6.4;
    m.atkCd = mkind === 'melee' ? 1.35 : 2.2;
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
  spawnWave(team) {
    const sp = this.arena.waveSpawn[team];
    const dir = team === 'blue' ? 1 : -1;
    for (let i = 0; i < 3; i++) this.spawnMinion(team, 'melee', sp.x + dir * (i % 2) * -1.1, -1.1 + i * 1.1);
    for (let i = 0; i < 2; i++) this.spawnMinion(team, 'caster', sp.x - dir * 1.8, -0.8 + i * 1.6);
  }

  // ============================================================== combat ==
  heroAttack(h, target) {
    const idx = h.comboIdx % 3;
    h.comboIdx++;
    h.comboT = this.time + 2.4;
    const dur = idx === 2 ? 0.62 : 0.48;
    const dmgMul = idx === 2 ? 1.32 : 1;
    h.attackCd = idx === 2 ? 0.72 : 0.55;
    const anim = ['atk1', 'atk2', 'atk3'][idx];
    const trailId = h === this.player ? 0 : 1;
    this.vfx.trailActive(trailId, true, h.isSera ? 0x9fe8ff : 0xffab6a);
    h.trailUntil = this.time + dur * 0.8;
    h.play(anim, {
      dur, lock: true, blend: 17,
      events: [{
        t: dur * 0.42,
        fn: () => {
          if (!target.alive || !h.alive) return;
          const d = h.pos.distanceTo(target.pos);
          if (d < 3.6) {
            const crit = this.rng.chance(0.12 + 0.01 * h.level);
            const dmg = this.playerAutoDmg(h) * dmgMul * (crit ? 1.7 : 1);
            this.damage(h, target, dmg, crit ? 'crit' : 'phys');
            _v1.copy(target.pos); _v1.y += target.kind === 'tower' ? 4 : 0.9;
            this.vfx.meleeImpact(_v1.x, _v1.y, _v1.z, h.isSera ? 0xbfe8ff : 0xffab6a);
            if (idx === 2) this.vfx.shake(0.14);
          }
          const yaw = h.facing + (idx === 1 ? 0.5 : -0.2);
          this.vfx.slashArc(h.pos.x + Math.sin(h.facing) * 1.2, h.pos.y + 1.25, h.pos.z + Math.cos(h.facing) * 1.2,
            yaw, { col: h.isSera ? 0x9fe8ff : 0xffab6a, size: 2.5, tilt: idx === 2 ? -0.5 : -1.2, dur: 0.24 });
        },
      }],
    });
  }

  tryCast(key) {
    if (this.state === 'ended') return;
    const h = this.player;
    if (!h.alive || h.isLocked() || h.dashT >= 0 || h.ultPhase) return;
    const ab = ABILITY[key];
    if (!ab || h.cds[key] > 0 || h.mana < ab.mana) return;
    if (key === 'R' && h.level < 5) return;
    if (key === 'E' && h.spinRate) return;
    h.mana -= ab.mana;
    h.cds[key] = ab.cd;
    // aim: joystick dir, else facing
    const aim = _v3;
    if (this.input.mag > 0.25) aim.set(this.input.x, 0, this.input.z).normalize();
    else {
      const t = this.nearestEnemy(h.team, h.pos.x, h.pos.z, 9, u => u.kind !== 'tower' && u.kind !== 'nexus');
      if (t) aim.copy(t.pos).sub(h.pos).setY(0).normalize();
      else aim.set(Math.sin(h.facing), 0, Math.cos(h.facing));
    }
    h.facing = Math.atan2(aim.x, aim.z);
    if (key === 'Q') this.castQ(h, aim);
    else if (key === 'W') this.castW(h, aim);
    else if (key === 'E') this.castE(h);
    else if (key === 'R') this.castR(h, aim);
  }

  castQ(h, aim) {
    const yaw = Math.atan2(aim.x, aim.z);
    h.play('q', {
      dur: 0.55, lock: true, blend: 18,
      events: [{
        t: 0.26,
        fn: () => {
          const col = h.isSera ? 0x8fe8ff : 0xffab6a;
          this.vfx.slashArc(h.pos.x + aim.x * 1.4, h.pos.y + 1.15, h.pos.z + aim.z * 1.4, yaw,
            { col, size: 3.6, dur: 0.42, tilt: -1.35, vel: 13, grow: 2.2 });
          this.vfx.burst(h.pos.x + aim.x * 2, h.pos.y + 1, h.pos.z + aim.z * 2,
            { count: 8, col, speed: 4, up: 1, life: 0.4, size: 0.22, sprite: 1 });
          const dmg = 55 + 14 * h.level;
          this.eachEnemy(h.team, (u) => {
            _v1.copy(u.pos).sub(h.pos); _v1.y = 0;
            const d = _v1.length();
            if (d < 5.2 && _v1.normalize().dot(aim) > 0.5) {
              this.damage(h, u, dmg, 'magic');
            }
            return false;
          });
          this.vfx.shake(0.1);
        },
      }],
    });
  }

  castW(h, aim) {
    h.dashT = 0;
    h.dashDir.copy(aim);
    h.dashHit = new Set();
    h.play('dash', { dur: 0.3, lock: true, blend: 20 });
    this.vfx.burst(h.pos.x, h.pos.y + 0.4, h.pos.z, { count: 6, col: 0xbfe8ff, speed: 3, up: 1, life: 0.3, size: 0.3, sprite: 0 });
  }

  castE(h) {
    h.spinRate = 21;
    h.play('spin', { dur: 0.9, lock: false, blend: 16 });
    const trailId = h === this.player ? 0 : 1;
    this.vfx.trailActive(trailId, true, 0x9fe8ff);
    h.trailUntil = this.time + 0.9;
    const dmg = 34 + 9 * h.level;
    for (const tickT of [0.12, 0.42, 0.72]) {
      this.schedule(tickT, () => {
        if (!h.alive) return;
        this.vfx.ring(h.pos.x, h.pos.y + 0.2, h.pos.z, { r0: 0.5, r1: 3.8, dur: 0.32, col: 0x9fe8ff, alpha: 0.65 });
        this.eachEnemy(h.team, (u) => {
          if (u.pos.distanceTo(h.pos) < 3.8) this.damage(h, u, dmg, 'magic');
          return false;
        });
      });
    }
    this.schedule(0.9, () => { h.spinRate = 0; });
  }

  castR(h, aim) {
    const from = _v1.copy(h.pos);
    const dist = 7;
    const to = _v2.copy(from).addScaledVector(aim, dist);
    // clamp landing into walkable space
    if (!this.arena.isWalkable(to.x, to.z)) {
      to.copy(from).addScaledVector(aim, 3.5);
      if (!this.arena.isWalkable(to.x, to.z)) to.copy(from);
    }
    h.ultPhase = 'crouch';
    h.ultT = 0;
    h.ultFrom = h.ultFrom || new THREE.Vector3();
    h.ultTo = h.ultTo || new THREE.Vector3();
    h.ultFrom.copy(from);
    h.ultTo.set(to.x, 0, to.z);
    h.ultTele = this.vfx.telegraph(to.x, to.z, 5.5, 0xffc36a);
    h.play('ultLeap', { dur: 2, lock: true, blend: 12 });
  }

  ultSlam(h) {
    const p = h.pos;
    const rank = h.level >= 13 ? 3 : h.level >= 9 ? 2 : 1;
    const dmg = 160 + 90 * rank;
    this.vfx.endTelegraph(h.ultTele); h.ultTele = null;
    this.vfx.dawnfall(p.x, p.y, p.z, 5.5);
    h.play('ultSlam', { dur: 0.55, lock: true, blend: 20 });
    this.eachEnemy(h.team, (u) => {
      if (u.pos.distanceTo(p) < 5.8) {
        this.damage(h, u, dmg, 'crit');
      }
      return false;
    });
  }

  // ============================================================ hero steps ==
  stepPlayer(dt) {
    const h = this.player;
    if (!h.alive) {
      h.respawnT -= dt;
      if (h.respawnT <= 0) this.respawn(h);
      return;
    }
    for (const k in h.cds) h.cds[k] = Math.max(0, h.cds[k] - dt);
    h.mana = Math.min(h.maxMana, h.mana + (2.2 + h.level * 0.25) * dt);
    if (this.time - h.lastDamagedT > 6) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.012 * dt);
    if (h.invulnT > 0) h.invulnT -= dt;
    h.attackCd = Math.max(0, h.attackCd - dt);

    // R sequence
    if (h.ultPhase) {
      h.ultT += dt;
      if (h.ultPhase === 'crouch' && h.ultT > 0.2) {
        h.ultPhase = 'leap'; h.ultT = 0;
        this.vfx.burst(h.pos.x, h.pos.y + 0.2, h.pos.z, { count: 10, col: 0xffe2a0, speed: 3.5, up: 1, life: 0.4, size: 0.3, sprite: 0 });
      } else if (h.ultPhase === 'leap') {
        const T = 0.52;
        const t = Math.min(h.ultT / T, 1);
        h.pos.x = h.ultFrom.x + (h.ultTo.x - h.ultFrom.x) * t;
        h.pos.z = h.ultFrom.z + (h.ultTo.z - h.ultFrom.z) * t;
        h.pos.y = this.arena.groundHeight(h.pos.x, h.pos.z);
        h.airY = Math.sin(t * Math.PI) * 3.4;
        if (h.ultTele) h.ultTele.mesh.material.uniforms.uProg.value = t;
        if (t >= 1) {
          h.ultPhase = null; h.airY = 0;
          this.ultSlam(h);
        }
        h.syncTransform();
        return;
      }
      if (h.ultPhase === 'crouch') return;
    }

    // W dash
    if (h.dashT >= 0) {
      h.dashT += dt;
      const spd = 26;
      this.arena.resolveMove(h.pos, h.dashDir.x * spd * dt, h.dashDir.z * spd * dt, h.radius);
      if ((h.dashGhostAcc = (h.dashGhostAcc || 0) + dt) > 0.055) {
        h.dashGhostAcc = 0;
        this.vfx.spawnGhost(h.pos, h.facing, 0.5, 0x6fd4ff);
      }
      const dmg = 45 + 11 * h.level;
      this.eachEnemy(h.team, (u) => {
        if (!h.dashHit.has(u.id) && u.kind !== 'tower' && u.kind !== 'nexus' && u.pos.distanceTo(h.pos) < 1.6) {
          h.dashHit.add(u.id);
          this.damage(h, u, dmg, 'magic');
        }
        return false;
      });
      if (h.dashT > 0.27) { h.dashT = -1; }
      h.moving = true;
      h.syncTransform();
      return;
    }

    // movement
    const locked = h.isLocked();
    let mvx = 0, mvz = 0;
    if (!locked && this.input.mag > 0.12) {
      const sp = h.speed * (h.spinRate ? 0.72 : 1) * this.input.mag;
      mvx = this.input.x * sp * dt;
      mvz = this.input.z * sp * dt;
      h.chaseTarget = null;
    } else if (!locked && h.attackHold > 0 && h.chaseTarget && h.chaseTarget.alive) {
      _v1.copy(h.chaseTarget.pos).sub(h.pos); _v1.y = 0;
      if (_v1.length() > 2.6) {
        _v1.normalize();
        mvx = _v1.x * h.speed * dt; mvz = _v1.z * h.speed * dt;
      }
    }
    h.moving = (mvx !== 0 || mvz !== 0);
    if (h.moving) {
      this.arena.resolveMove(h.pos, mvx, mvz, h.radius);
      if (!h.spinRate && this.input.mag > 0.12) h.faceToward(h.pos.x + mvx, h.pos.z + mvz, dt, 16);
      h.moveRate = this.input.mag > 0.12 ? this.input.mag : 1;
      // run dust
      if ((h.dustAcc = (h.dustAcc || 0) + dt) > 0.17) {
        h.dustAcc = 0;
        this.vfx.pAlpha.spawn({
          x: h.pos.x - Math.sin(h.facing) * 0.3, y: h.pos.y + 0.08, z: h.pos.z - Math.cos(h.facing) * 0.3,
          vx: 0, vy: 0.7, vz: 0, life: 0.5, size: 0.28, sizeEnd: 0.7, col: 0xcabd9c, alpha: 0.32, sprite: 0, glow: 1, drag: 1,
        });
      }
    }
    h.attackHold = Math.max(0, h.attackHold - dt);

    // attacking
    if (h.wantAttack && !locked && h.attackCd <= 0 && !h.spinRate) {
      const target = this.pickAttackTarget(h);
      if (target) {
        h.chaseTarget = target;
        const d = h.pos.distanceTo(target.pos);
        if (d < 2.9 + target.radius) {
          h.faceToward(target.pos.x, target.pos.z, dt, 50);
          if (this.time > h.comboT) h.comboIdx = 0;
          this.heroAttack(h, target);
        }
      }
    }
    h.wantAttack = false;
    if (h.trailUntil && this.time > h.trailUntil) {
      this.vfx.trailActive(0, false);
      h.trailUntil = 0;
    }
  }

  pickAttackTarget(h) {
    const px = h.pos.x, pz = h.pos.z;
    // prefer last-hittable minion in reach
    let best = null;
    const auto = this.playerAutoDmg(h);
    best = this.nearestEnemy(h.team, px, pz, 3.3, u => u.kind !== 'tower' && u.kind !== 'nexus' && !u.isHero && u.hp <= auto * 1.05);
    if (best) return best;
    const hero = this.nearestEnemy(h.team, px, pz, 3.3, u => u.isHero);
    if (hero) return hero;
    return this.nearestEnemy(h.team, px, pz, 8.5, () => true);
  }

  respawn(h) {
    h.alive = true;
    h.hp = h.maxHp; h.mana = h.maxMana;
    const sp = this.arena.spawn[h.team];
    h.pos.set(sp.x, 0, sp.z);
    h.pos.y = this.arena.groundHeight(sp.x, sp.z);
    h.facing = h.team === 'blue' ? Math.PI / 2 : -Math.PI / 2;
    h.group.visible = true;
    h.invulnT = 2;
    h.play('idle', { dur: 1e9, lock: false, loop: true });
    this.vfx.respawnFx(h, TEAM_COL[h.team]);
  }

  // =============================================================== bot AI ==
  stepBot(dt) {
    const b = this.bot;
    if (!b.alive) {
      b.respawnT -= dt;
      if (b.respawnT <= 0) this.respawn(b);
      return;
    }
    for (const k in b.cds) b.cds[k] = Math.max(0, b.cds[k] - dt);
    b.attackCd = Math.max(0, b.attackCd - dt);
    b.mana = Math.min(b.maxMana, b.mana + 2.5 * dt);
    if (this.time - b.lastDamagedT > 6) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.012 * dt);
    if (b.invulnT > 0) b.invulnT -= dt;
    if (b.isLocked()) { b.moving = false; return; }

    this.botAiT -= dt;
    if (this.botAiT <= 0) {
      this.botAiT = 0.35;
      const hpP = b.hp / b.maxHp;
      const player = this.player;
      const pd = player.alive ? b.pos.distanceTo(player.pos) : 99;
      if (b.aiState === 'retreat') {
        if (hpP > 0.62) b.aiState = 'push';
      } else if (hpP < 0.27) {
        b.aiState = 'retreat';
      } else if (player.alive && pd < 6.5 && (hpP > player.hp / player.maxHp + 0.06 || player.hp / player.maxHp < 0.3)) {
        b.aiState = 'trade';
      } else {
        b.aiState = 'push';
      }
    }

    let tx = A.FOUNTAIN_X - 3, tz = 0; // default: home
    let attackTarget = null;
    const player = this.player;
    if (b.aiState === 'retreat') {
      tx = this.arena.spawn.red.x; tz = 0;
    } else if (b.aiState === 'trade' && player.alive) {
      attackTarget = player;
      tx = player.pos.x; tz = player.pos.z;
      // charge gap-closer
      const d = b.pos.distanceTo(player.pos);
      if (d > 3.4 && d < 9 && b.cds.W <= 0) {
        b.cds.W = 13;
        b.dashT = 0;
        b.dashDir.copy(player.pos).sub(b.pos).setY(0).normalize();
        b.dashHit = new Set();
        b.play('dash', { dur: 0.3, lock: true, blend: 20 });
      }
    } else {
      // push: go to frontline
      let frontX = A.TOWER_OUTER_X - 4; // fallback push toward blue side
      let bestD = 1e9;
      let nearMinion = null;
      for (const m of this.minions) {
        if (!m.alive) continue;
        if (m.team === 'red' && m.pos.x < frontX + 30) {
          // follow own wave's lowest x
        }
        const d = m.pos.distanceTo(b.pos);
        if (m.team === 'blue' && d < bestD) { bestD = d; nearMinion = m; }
      }
      if (nearMinion && bestD < 9) {
        attackTarget = nearMinion;
        tx = nearMinion.pos.x; tz = nearMinion.pos.z;
      } else {
        // walk mid
        tx = Math.max(-A.TOWER_OUTER_X + 2, Math.min(this.frontlineX('red'), A.TOWER_OUTER_X + 10));
        tz = 0;
      }
      if (player.alive && b.pos.distanceTo(player.pos) < 4.4 && b.cds.Q <= 0) {
        // cleave harass
        b.cds.Q = 8;
        const aim = _v1.copy(player.pos).sub(b.pos).setY(0).normalize();
        b.facing = Math.atan2(aim.x, aim.z);
        this.castBotCleave(b, aim.clone());
      }
    }

    // dash update
    if (b.dashT >= 0) {
      b.dashT += dt;
      this.arena.resolveMove(b.pos, b.dashDir.x * 24 * dt, b.dashDir.z * 24 * dt, b.radius);
      if (player.alive && !b.dashHit.has(player.id) && b.pos.distanceTo(player.pos) < 1.8) {
        b.dashHit.add(player.id);
        this.damage(b, player, 50 + 10 * b.level, 'magic');
        this.vfx.shake(0.2);
      }
      if (b.dashT > 0.3) b.dashT = -1;
      b.syncTransform();
      return;
    }

    // move toward (tx, tz)
    _v1.set(tx - b.pos.x, 0, tz - b.pos.z);
    const dist = _v1.length();
    const wantRange = attackTarget ? 2.7 : 1.5;
    if (dist > wantRange) {
      _v1.normalize();
      this.arena.resolveMove(b.pos, _v1.x * b.speed * 0.92 * dt, _v1.z * b.speed * 0.92 * dt, b.radius);
      b.faceToward(b.pos.x + _v1.x, b.pos.z + _v1.z, dt, 12);
      b.moving = true;
      b.moveRate = 0.92;
    } else {
      b.moving = false;
      if (attackTarget && attackTarget.alive && b.attackCd <= 0) {
        b.faceToward(attackTarget.pos.x, attackTarget.pos.z, dt, 40);
        if (this.time > b.comboT) b.comboIdx = 0;
        this.heroAttack(b, attackTarget);
      }
    }
    if (b.trailUntil && this.time > b.trailUntil) {
      this.vfx.trailActive(1, false);
      b.trailUntil = 0;
    }
  }

  castBotCleave(b, aim) {
    b.play('q', {
      dur: 0.6, lock: true, blend: 16,
      events: [{
        t: 0.3,
        fn: () => {
          this.vfx.slashArc(b.pos.x + aim.x * 1.5, b.pos.y + 1.2, b.pos.z + aim.z * 1.5,
            Math.atan2(aim.x, aim.z), { col: 0xff9a5e, size: 3.4, dur: 0.4, tilt: -1.3, vel: 8, grow: 2 });
          this.vfx.burst(b.pos.x + aim.x * 2, b.pos.y + 0.8, b.pos.z + aim.z * 2,
            { count: 9, col: 0xff8a3d, col2: 0xffd9a0, speed: 4, up: 2, life: 0.45, size: 0.26, sprite: 1 });
          const dmg = 60 + 13 * b.level;
          this.eachEnemy(b.team, (u) => {
            _v2.copy(u.pos).sub(b.pos); _v2.y = 0;
            if (_v2.length() < 4.6 && _v2.normalize().dot(aim) > 0.45) this.damage(b, u, dmg, 'magic');
            return false;
          });
        },
      }],
    });
  }

  frontlineX(team) {
    // furthest pushed allied minion
    let x = team === 'red' ? A.SPAWN_X : -A.SPAWN_X;
    for (const m of this.minions) {
      if (!m.alive || m.team !== team) continue;
      if (team === 'red') x = Math.min(x, m.pos.x);
      else x = Math.max(x, m.pos.x);
    }
    return x;
  }

  // ============================================================== minions ==
  stepMinions(dt) {
    for (const m of this.minions) {
      if (!m.alive) continue;
      m.attackCd = Math.max(0, m.attackCd - dt);
      // acquire
      if (!m.target || !m.target.alive || m.pos.distanceTo(m.target.pos) > 11) {
        m.target = this.nearestEnemy(m.team, m.pos.x, m.pos.z, 8.5, u => !u.isHero || u.alive) ||
          this.nearestEnemy(m.team, m.pos.x, m.pos.z, 10.5, () => true);
      }
      const dir = m.team === 'blue' ? 1 : -1;
      let mvx = 0, mvz = 0;
      if (m.target) {
        const d = m.pos.distanceTo(m.target.pos);
        const range = m.range + m.target.radius;
        if (d > range) {
          _v1.copy(m.target.pos).sub(m.pos).setY(0).normalize();
          mvx = _v1.x * m.speed * dt; mvz = _v1.z * m.speed * dt;
          m.faceToward(m.target.pos.x, m.target.pos.z, dt, 10);
        } else {
          m.faceToward(m.target.pos.x, m.target.pos.z, dt, 10);
          if (m.attackCd <= 0) {
            m.attackCd = m.atkCd;
            m.playAttack();
            const tgt = m.target;
            if (m.kind === 'melee') {
              this.schedule(0.22, () => {
                if (tgt.alive && m.alive && m.pos.distanceTo(tgt.pos) < range + 0.9) {
                  this.damage(m, tgt, m.dmg);
                  _v2.copy(tgt.pos); _v2.y += tgt.kind === 'tower' ? 3.5 : 0.75;
                  if (Math.random() < 0.4) this.vfx.hitSpark(_v2.x, _v2.y, _v2.z, 0xffe0b0);
                }
              });
            } else {
              this.schedule(0.34, () => {
                if (!m.alive) return;
                m.getMuzzle(_v2);
                this.vfx.projectile({
                  from: _v2, target: tgt.alive ? tgt : null, to: tgt.pos, speed: 13,
                  col: m.team === 'blue' ? 0x76c8ff : 0xff9a5e, size: 0.26,
                  onHit: () => { if (tgt.alive) this.damage(m, tgt, m.dmg, 'magic'); },
                });
              });
            }
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
      if (m.moving) this.arena.resolveMove(m.pos, mvx, mvz, m.radius);
    }
    // separation (allies only, cheap n²  on ≤26)
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

  // =============================================================== towers ==
  stepTowers(dt) {
    for (const t of this.towers) {
      if (!t.alive) { t.update(dt); continue; }
      // validate target
      if (t.target && (!t.target.alive || t.target.pos.distanceTo(t.pos) > t.range + 1)) t.target = null;
      if (!t.target) {
        t.target = this.nearestEnemy(t.team, t.pos.x, t.pos.z, t.range, u => !u.isHero) ||
          this.nearestEnemy(t.team, t.pos.x, t.pos.z, t.range, u => u.isHero);
        t.chargeT = 0;
        if (t.target && t.target.isHero) t.towerRamp = 0;
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
            t.towerRamp = Math.min(4, (t.towerRamp || 0) + 1);
            dmg = 85 * Math.pow(1.22, t.towerRamp - 1);
            if (tgt === this.player) this.vfx.shake(0.22);
          } else dmg = 210;
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
    for (const team of ['blue', 'red']) {
      const fx = team === 'blue' ? -A.FOUNTAIN_X : A.FOUNTAIN_X;
      const hero = team === 'blue' ? this.player : this.bot;
      if (hero.alive && Math.hypot(hero.pos.x - fx, hero.pos.z) < 6) {
        const heal = hero.maxHp * 0.07 * dt;
        if (hero.hp < hero.maxHp) {
          hero.hp = Math.min(hero.maxHp, hero.hp + heal);
          hero.mana = Math.min(hero.maxMana, hero.mana + hero.maxMana * 0.09 * dt);
          if (tick && hero === this.player) this.hud?.damageNumber(hero.pos, '+' + Math.round(hero.maxHp * 0.035), 'heal');
        }
      }
      // fountain zaps intruders
      const enemy = team === 'blue' ? this.bot : this.player;
      if (tick && enemy.alive && Math.hypot(enemy.pos.x - fx, enemy.pos.z) < 7) {
        _v1.set(fx, 3.4, 0);
        _v2.copy(enemy.pos); _v2.y += 1;
        this.vfx.beam(_v1, _v2, { col: team === 'blue' ? 0x7ac8ff : 0xff8a4d, dur: 0.25, r: 0.24 });
        this.damage(null, enemy, 130, 'magic');
      }
    }
  }

  // ================================================================= step ==
  step(dt) {
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
        this.waveT = 25;
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
    for (const m of this.minions) m.update(dt);
    this.player.update(dt);
    this.bot.update(dt);
    // sword trails sampling
    for (const [id, h] of [[0, this.player], [1, this.bot]]) {
      if (h.trailUntil && h.alive) {
        h.getBladePoints(_v1, _v2);
        this.vfx.trailPush(id, _v1, _v2);
      }
    }
    // hp bars + blob shadows
    const bars = this.hpBars, blobs = this.blobs;
    for (const m of this.minions) {
      bars.set(m.barIdx, m.pos.x, m.pos.y + m.hpY, m.pos.z, m.hp / m.maxHp, m.hpW,
        m.team === 'blue' ? 0x4fa8ff : 0xff5a45, 0);
      blobs.set(m.shadowIdx, m.pos.x, m.pos.y + 0.03, m.pos.z, 1.0);
    }
    for (const h of [this.player, this.bot]) {
      if (h.alive) {
        bars.set(h.barIdx, h.pos.x, h.pos.y + h.hpY + h.airY, h.pos.z, h.hp / h.maxHp, h.hpW,
          h === this.player ? 0x5ce87a : 0xff5a45, h === this.player ? 1 : 0);
        blobs.set(h.shadowIdx, h.pos.x, h.pos.y + 0.03, h.pos.z, 1.35);
      } else {
        bars.set(h.barIdx, 0, -99, 0, 0, 0.1, 0, 0);
        blobs.set(h.shadowIdx, 0, -99, 0, 0);
      }
    }
    for (const t of this.towers) {
      if (t.alive && t.barIdx >= 0) {
        bars.set(t.barIdx, t.pos.x, t.hpY, t.pos.z, t.hp / t.maxHp, t.hpW,
          t.team === 'blue' ? 0x4fa8ff : 0xff5a45, 0);
      }
    }
    for (const n of this.nexuses) {
      if (n.alive && n.barIdx >= 0) {
        const show = !n.invulnerable || n.hp < n.maxHp;
        bars.set(n.barIdx, n.pos.x, n.hpY, n.pos.z, n.hp / n.maxHp, show ? n.hpW : 0,
          n.team === 'blue' ? 0x4fa8ff : 0xff5a45, 0);
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
    this.player.wantAttack = true;
    this.player.attackHold = 0.5;
    if (!this.player.chaseTarget || !this.player.chaseTarget.alive) {
      this.player.chaseTarget = this.nearestEnemy('blue', this.player.pos.x, this.player.pos.z, 9, () => true);
    }
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
    P.maxHp = 560 + 95 * 6; P.hp = P.maxHp * 0.72;
    P.maxMana = 120 + 14 * 6; P.mana = P.maxMana * 0.55;
    P.xp = 180;
    P.cds.Q = 2.1; P.cds.W = 0; P.cds.E = 4.2; P.cds.R = 0;
    B.level = 7; B.maxHp = 620 + 95 * 6; B.hp = B.maxHp * 0.6;
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
      P.pos.set(-13.2, 0, 3.4); P.facing = 0.55;
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
