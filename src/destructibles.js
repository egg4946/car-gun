import * as THREE from 'three';
import { PROPS, rayBox } from './props.js';

// 壊れた物の見た目: 倒れて転がる破片、火・煙・水・ガラス片、爆発と連鎖。
// 当たり箱や壊れたかどうかは world.js / props.js が持ち、ここは world.events を受けて演出する。

const MAX_DEBRIS = 70;
const MAX_PARTICLES = 260;
const GRAVITY = 18;

const charMat = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });
const shardGeo = new THREE.BoxGeometry(0.25, 0.02, 0.18);
const shardMat = new THREE.MeshLambertMaterial({ color: 0xbfe4f2 });
const canGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 6);
const canMats = [0xd02020, 0x2060c0, 0xf0c020, 0x30a050].map(c => new THREE.MeshLambertMaterial({ color: c }));
const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10).rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x151515 });

function puffTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// 粒子の種類: 色、加算合成か、重力、大きくなる速さ
const KINDS = {
  fire: { color: 0xff8a30, additive: true, gravity: -3, grow: 2.5 },
  smoke: { color: 0x555555, additive: false, gravity: -1.5, grow: 3 },
  water: { color: 0xcfe8ff, additive: false, gravity: GRAVITY * 0.8, grow: 0.8 },
  spark: { color: 0xffd060, additive: true, gravity: GRAVITY * 0.6, grow: -0.5 },
};

export class Destructibles {
  constructor(scene, world, sound) {
    this.scene = scene;
    this.world = world;
    this.sound = sound;
    this.debris = [];
    this.burning = []; // { prop?, mesh?, x, y, z, life } 炎と煙を出し続ける物
    this.geysers = []; // 消火栓の水柱
    this.pending = []; // 連鎖爆発の待ち { x, y, z, r, t }
    // main から差し替える
    this.onExplode = () => {};
    this.onDestroy = () => {};

    const tex = puffTexture();
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.particles.push({ sprite: s, life: 0, max: 1, vel: new THREE.Vector3(), kind: KINDS.smoke, size: 1 });
    }
    this.pIdx = 0;
  }

  emit(kind, x, y, z, vx, vy, vz, life, size) {
    const p = this.particles[this.pIdx];
    this.pIdx = (this.pIdx + 1) % MAX_PARTICLES;
    const k = KINDS[kind];
    p.kind = k;
    p.life = p.max = life;
    p.size = size;
    p.vel.set(vx, vy, vz);
    p.sprite.position.set(x, y, z);
    p.sprite.material.color.setHex(k.color);
    p.sprite.material.blending = k.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.visible = true;
  }

  // 弾の光線で最初に当たる小物。{ prop, t } か null
  raycast(o, d, maxT) {
    let best = null;
    for (const prop of this.world.props ?? []) {
      const b = prop.box;
      // 遠い箱は細かい判定を省く
      const mx = (b.minX + b.maxX) / 2 - o.x, mz = (b.minZ + b.maxZ) / 2 - o.z;
      if (mx * mx + mz * mz > maxT * maxT) continue;
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b);
      if (t !== null && t <= maxT && (!best || t < best.t)) best = { prop, t };
    }
    return best;
  }

  // 撃たれた
  shoot(prop, n) {
    this.handle(prop, prop.state.hit(n), 'shot');
  }

  // PropState の出来事を処理する
  handle(prop, events, how) {
    for (const ev of events) {
      if (ev.type === 'ignite') {
        this.burning.push({ prop, life: Infinity });
        this.sound.ignite?.();
      }
    }
    if (events.some(e => e.type === 'break')) this.world.breakProp(prop, { how, events });
  }

  update(dt) {
    // 壊れた知らせ(車でなぎ倒した物もここに来る)
    for (const ev of this.world.events?.splice(0) ?? []) if (ev.type === 'broken') this.onBroken(ev);

    // 燃えている駐車車両などの導火線
    for (const b of [...this.burning]) {
      if (b.prop) {
        const box = b.prop.box;
        b.x = (box.minX + box.maxX) / 2; b.z = (box.minZ + box.maxZ) / 2; b.y = box.maxY;
        if (b.prop.state.state === 'burning') this.handle(b.prop, b.prop.state.update(dt), 'fire');
        if (b.prop.state.state === 'broken') { this.burning.splice(this.burning.indexOf(b), 1); continue; }
      } else {
        b.life -= dt;
        if (b.mesh) { b.x = b.mesh.position.x; b.y = b.mesh.position.y + 1; b.z = b.mesh.position.z; }
        if (b.life <= 0) { this.burning.splice(this.burning.indexOf(b), 1); continue; }
      }
      if (Math.random() < dt * 30) this.emit('fire', b.x + rnd(0.8), b.y, b.z + rnd(0.8), rnd(0.5), 2 + Math.random() * 2, rnd(0.5), 0.6, 1.2);
      if (Math.random() < dt * 12) this.emit('smoke', b.x + rnd(0.5), b.y + 1, b.z + rnd(0.5), rnd(0.6), 2.5, rnd(0.6), 2.2, 1.8);
    }

    // 消火栓の水柱
    for (const g of [...this.geysers]) {
      g.life -= dt;
      if (g.life <= 0) { this.geysers.splice(this.geysers.indexOf(g), 1); continue; }
      for (let k = 0; k < 3; k++) this.emit('water', g.x + rnd(0.15), 0.9, g.z + rnd(0.15), rnd(1.2), 9 + Math.random() * 3, rnd(1.2), 1.4, 0.7);
    }

    // 連鎖爆発は少し遅らせて「ドドドン」と鳴らす
    for (const e of [...this.pending]) {
      e.t -= dt;
      if (e.t > 0) continue;
      this.pending.splice(this.pending.indexOf(e), 1);
      this.explode(e.x, e.y, e.z, e.r);
    }

    this.updateDebris(dt);
    this.updateParticles(dt);
  }

  onBroken({ prop, how, speed = 0, vx = 0, vz = 0, events = [], by = null }) {
    const b = prop.box;
    const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
    const def = PROPS[prop.kind];
    const exploded = events.some(e => e.type === 'explode');
    this.onDestroy({ kind: prop.kind, how, by, points: def.points, x, y: b.maxY, z });

    if (prop.kind === 'glass') {
      this.sound.glass?.();
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      for (let k = 0; k < 16; k++) {
        const m = new THREE.Mesh(shardGeo, shardMat);
        m.position.set(b.minX + Math.random() * w, 0.5 + Math.random() * 1.8, b.minZ + Math.random() * d);
        this.addDebris(m, rnd(3), 1 + Math.random() * 2, rnd(3), 3, 1.5);
      }
      return;
    }

    // 本体は根元を軸に倒れて転がる。なぎ倒されたら車の進む向きへ飛ぶ
    const mesh = new THREE.Mesh(prop.geo.clone().translate(-x, 0, -z), exploded ? charMat : this.world.solidMat);
    mesh.position.set(x, 0, z);
    let dvx = vx * 0.8 + rnd(1), dvz = vz * 0.8 + rnd(1), dvy = how === 'smash' ? 1.5 + speed * 0.1 : 1;
    if (exploded) { dvx = rnd(4); dvz = rnd(4); dvy = prop.kind === 'parked' ? 7 : 9; }
    const spin = exploded ? 4 : 2 + speed * 0.15;
    this.addDebris(mesh, dvx, dvy, dvz, spin, prop.kind === 'parked' ? 12 : 9, true);

    if (prop.kind === 'vending') {
      this.sound.impact?.(6);
      for (let k = 0; k < 14; k++) {
        const c = new THREE.Mesh(canGeo, canMats[k % canMats.length]);
        c.position.set(x + rnd(0.3), 1 + Math.random(), z + rnd(0.3));
        this.addDebris(c, vx * 0.5 + rnd(4), 3 + Math.random() * 4, vz * 0.5 + rnd(4), 10, 4);
      }
    }
    if (prop.kind === 'hydrant') {
      this.geysers.push({ x, z, life: 8 });
      this.sound.water?.();
    }
    if (prop.kind === 'parked' && exploded) {
      for (let k = 0; k < 4; k++) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x + rnd(1.5), 0.6, z + rnd(1.5));
        this.addDebris(w, rnd(8), 6 + Math.random() * 5, rnd(8), 8, 8);
      }
      this.burning.push({ mesh, life: 8 });
    }
    if (how === 'smash' && prop.kind !== 'tree' && prop.kind !== 'bench') {
      for (let k = 0; k < 8; k++) this.emit('spark', x, 0.8, z, vx * 0.3 + rnd(4), 2 + Math.random() * 3, vz * 0.3 + rnd(4), 0.4, 0.25);
    }
    if (exploded) this.explode(x, b.maxY * 0.5, z, def.explode.radius);
  }

  // 爆発: 見た目と音、まわりへの影響は onExplode(main)と blast(小物の連鎖)
  explode(x, y, z, r) {
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
      this.emit('fire', x, y + 0.5, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 0.5 + Math.random() * 0.4, 1.6 + Math.random());
    }
    for (let k = 0; k < 12; k++) this.emit('smoke', x + rnd(2), y + 1, z + rnd(2), rnd(2), 3 + Math.random() * 2, rnd(2), 2.5, 3);
    for (let k = 0; k < 14; k++) this.emit('spark', x, y + 0.5, z, rnd(14), 4 + Math.random() * 10, rnd(14), 0.8, 0.3);
    this.onExplode(x, y, z, r);
    // まわりの小物(ドラム缶など)は少し遅れて連鎖する
    for (const prop of [...(this.world.props ?? [])]) {
      const b = prop.box;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const d = Math.hypot(cx - x, cz - z);
      if (d > r) continue;
      const ev = prop.state.hit(99);
      const boom = ev.find(e => e.type === 'explode');
      if (boom) {
        // 爆発する物は break だけ先に処理し、爆発は遅らせる
        prop.state.state = 'broken';
        this.world.breakProp(prop, { how: 'blast', events: ev.filter(e => e.type !== 'explode') });
        this.pending.push({ x: cx, y: b.maxY * 0.5, z: cz, r: PROPS[prop.kind].explode.radius, t: 0.12 + d * 0.02 });
      } else if (ev.length) this.handle(prop, ev, 'blast');
    }
  }

  // 敵の車の残骸: 黒こげで跳ね上がり、しばらく燃える
  addWreck(mesh, vx, vz) {
    mesh.traverse(o => { if (o.isMesh && o.material?.visible !== false) o.material = charMat; });
    this.addDebris(mesh, vx * 0.3 + rnd(2), 7, vz * 0.3 + rnd(2), 3, 10, true);
    this.burning.push({ mesh, life: 8 });
    for (let k = 0; k < 4; k++) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.copy(mesh.position).add(new THREE.Vector3(rnd(1.5), 0.6, rnd(1.5)));
      this.addDebris(w, vx * 0.4 + rnd(8), 5 + Math.random() * 6, vz * 0.4 + rnd(8), 8, 8);
    }
  }

  // 破片: 速度・回転・地面で跳ねる。big は寝転ぶまで回る大物
  addDebris(mesh, vx, vy, vz, spin, life, big = false) {
    if (this.debris.length >= MAX_DEBRIS) this.removeDebris(this.debris[0]);
    if (!mesh.parent) this.scene.add(mesh);
    const axis = new THREE.Vector3(rnd(1), rnd(0.3), rnd(1)).normalize();
    this.debris.push({ mesh, vel: new THREE.Vector3(vx, vy, vz), axis, spin, life, big });
  }

  removeDebris(d) {
    this.scene.remove(d.mesh);
    this.debris.splice(this.debris.indexOf(d), 1);
  }

  updateDebris(dt) {
    const q = new THREE.Quaternion();
    for (const d of [...this.debris]) {
      d.life -= dt;
      const m = d.mesh;
      d.vel.y -= GRAVITY * dt;
      m.position.addScaledVector(d.vel, dt);
      if (m.position.y < 0) {
        // 地面で跳ねて止まっていく
        m.position.y = 0;
        d.vel.y *= -0.25;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin *= 0.6;
      }
      // 大物は横倒し(90度)まで回ったら止める
      const tilt = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).y;
      if (!(d.big && tilt < 0.05 && m.position.y < 0.05)) m.quaternion.premultiply(q.setFromAxisAngle(d.axis, d.spin * dt));
      if (d.life < 1) m.position.y -= dt * 0.8; // 最後は地面に沈めて消す
      if (d.life <= 0) this.removeDebris(d);
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.vel.y -= p.kind.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(Math.max(0.05, p.size * (1 + k * p.kind.grow)));
      p.sprite.material.opacity = Math.max(0, 1 - k) * (p.kind.additive ? 1 : 0.6);
      if (p.life <= 0) p.sprite.visible = false;
    }
  }

  clear() {
    for (const d of [...this.debris]) this.removeDebris(d);
    this.burning = [];
    this.geysers = [];
    this.pending = [];
    for (const p of this.particles) { p.life = 0; p.sprite.visible = false; }
  }
}

const rnd = s => (Math.random() - 0.5) * 2 * s;
