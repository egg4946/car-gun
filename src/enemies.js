import * as THREE from 'three';
import { Vehicle, CFG } from './vehicle.js';
import { Shooter, hitChance, chaseInput } from './ai.js';
import { lineOfSight } from './geom.js';

// 敵の種類ごとの性能
const TYPES = {
  gunman: { hp: 2, points: 100, damage: 4, shooter: { range: 65, aimTime: 0.9, burst: 3 } },
  drone: { hp: 4, points: 200, damage: 4, shooter: { range: 60, aimTime: 1.1, burst: 4, burstGap: 0.12 } },
  chaser: { hp: 6, points: 300, mass: 1250, blast: 6 },
  // ボス: ★4 で装甲トラック、★5 でヘリ
  truck: { hp: 40, points: 1500, damage: 5, mass: 4000, blast: 10, shooter: { range: 60, aimTime: 1.0, burst: 5, burstGap: 0.12 } },
  heli: { hp: 30, points: 2000, damage: 3, blast: 10, shooter: { range: 95, aimTime: 1.2, burst: 8, burstGap: 0.08 } },
};
const BOSSES = ['truck', 'heli'];
const BOSS_RESPAWN = 30; // 倒されたボスがまた来るまでの秒数
// 手配度ごとに揃えたい敵の数
const WANT = [
  { gunman: 4, chaser: 0, drone: 0 },
  { gunman: 6, chaser: 1, drone: 0 },
  { gunman: 7, chaser: 2, drone: 1 },
  { gunman: 8, chaser: 3, drone: 2 },
  { gunman: 8, chaser: 3, drone: 2, truck: 1 },
  { gunman: 9, chaser: 4, drone: 3, truck: 1, heli: 1 },
];
// 装甲トラックは重く大きい。エンジンも強くして追いつけるように
const TRUCK_CFG = { ...CFG, mass: 4000, inertia: 12000, halfLength: 3.6, halfWidth: 1.3, torqueScale: 3.2, maxSteer: 0.5 };
const missileRingGeo = new THREE.RingGeometry(6.2, 7, 32).rotateX(-Math.PI / 2);
const missileRingMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.7, depthWrite: false });
const RUN_OVER_POINTS = 150;
const RAM_KILL_POINTS = 300;
const DESPAWN = 170;

// 敵の材質は少し自分で光らせ、霧でもくすませない(灰色の街に溶け込まないように)
const mat = (c, glow = 0.3) => {
  const m = new THREE.MeshLambertMaterial({ color: c, fog: false });
  m.emissive.setHex(c).multiplyScalar(glow);
  m.userData.base = m.emissive.clone();
  return m;
};
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide, fog: false });
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe080, fog: false });
const flashGeo = new THREE.SphereGeometry(0.35, 8, 6);
const AIM_COLOR = new THREE.Color(0xff2000);
const WHITE = new THREE.Color(0xffffff);

// 黒い輪郭線(裏面だけ描く一回り大きい複製)。シルエットを背景から浮かせる
function outline(group, k = 1.14) {
  for (const m of [...group.children]) {
    if (!m.isMesh) continue;
    const o = new THREE.Mesh(m.geometry, outlineMat);
    o.position.copy(m.position);
    o.rotation.copy(m.rotation);
    o.scale.copy(m.scale).multiplyScalar(k);
    o.userData.outline = true;
    group.add(o);
  }
}
const sparkGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const sparkMats = [0xffa030, 0xff3020, 0x333333].map(c => new THREE.MeshBasicMaterial({ color: c }));
const laserMat = new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.8 });
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffaa55 });
// 当たり判定は見た目より少し大きい透明な箱(遠くの小さな敵にも当てやすく)
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
const HITBOX = {
  gunman: [new THREE.BoxGeometry(1.3, 2.2, 1.3), 1.1],
  drone: [new THREE.BoxGeometry(2.4, 1.2, 2.4), 0],
  chaser: [new THREE.BoxGeometry(2.2, 1.6, 4.6), 0.8],
  truck: [new THREE.BoxGeometry(3, 3.4, 7.6), 1.7],
  heli: [new THREE.BoxGeometry(3.2, 2.4, 9), 0],
};

function tag(root, enemy) {
  root.traverse(o => { o.userData.enemy = enemy; });
}

// 歩兵: 赤橙の上着と黄色いバンダナ。体は人より大きめ(遠くでも点にならないように)
function buildGunman() {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.32), mat(0x26262a, 0.15));
  legs.position.y = 0.45;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.42), mat(0xff4a14, 0.45));
  body.position.y = 1.3;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(0xe0a878, 0.3));
  head.position.y = 1.92;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.44), mat(0xffd400, 0.6));
  band.position.y = 2.0;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), mat(0x111111, 0));
  gun.position.set(0.28, 1.42, -0.38);
  g.add(legs, body, head, band, gun);
  outline(g);
  g.scale.setScalar(1.3);
  g.userData.body = body.material; // 狙っているときに赤く光らせる
  g.userData.gun = gun;
  return g;
}

function buildDrone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), mat(0xffb000, 0.45));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false }));
  eye.position.set(0, -0.15, -0.5);
  g.add(body, eye);
  g.userData.body = body.material;
  g.userData.rotors = [];
  for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.08), mat(0x888888));
    r.position.set(x, 0.22, z);
    g.add(r);
    g.userData.rotors.push(r);
  }
  outline(g, 1.1);
  g.scale.setScalar(1.4);
  return g;
}

function buildChaser() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4.3), mat(0xc81818, 0.35));
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), mat(0x101418));
  cabin.position.set(0, 1.15, 0.3);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.12, 4.32), mat(0x111111, 0));
  stripe.position.y = 0.75;
  const lights = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
  lights.position.set(0, 0.75, -2.17);
  g.add(body, cabin, stripe, lights);
  g.userData.body = body.material;
  return g;
}

function buildTruck() {
  const g = new THREE.Group();
  const armor = mat(0x3a4030);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 4.8), armor);
  body.position.set(0, 1.7, 1.1);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.8, 2.2), mat(0x2c3226));
  cab.position.set(0, 1.4, -2.4);
  const grill = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.3), mat(0x111111));
  grill.position.set(0, 0.9, -3.6);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe080 }));
  lights.position.set(0, 1.5, -3.52);
  // 屋根の銃手
  const gunner = buildGunman();
  gunner.scale.setScalar(0.9);
  gunner.position.set(0, 2.9, 1.5);
  g.add(body, cab, grill, lights, gunner);
  for (const [x, z] of [[-1.2, -2.4], [1.2, -2.4], [-1.2, 0.6], [1.2, 0.6], [-1.2, 2.4], [1.2, 2.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12).rotateZ(Math.PI / 2), mat(0x151515));
    w.position.set(x, 0.55, z);
    g.add(w);
  }
  return g;
}

function buildHeli() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 4.4), mat(0x1f2a22));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.2), mat(0x203040));
  glass.position.set(0, 0.2, -2.4);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), mat(0x1f2a22));
  tail.position.set(0, 0.3, 4.6);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.9), mat(0x1f2a22));
  fin.position.set(0, 0.9, 6.9);
  const rotor = new THREE.Group();
  rotor.position.y = 1.25;
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.4), mat(0x333333));
    blade.rotation.y = a;
    rotor.add(blade);
  }
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.2), mat(0x333333));
  tailRotor.position.set(0.3, 0.9, 6.9);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  light.position.set(0, -1.05, -1.5);
  g.add(body, glass, tail, fin, rotor, tailRotor, light);
  g.userData.rotors = [rotor];
  g.userData.tailRotor = tailRotor;
  return g;
}

// 敵の出現・思考・見た目をまとめて管理する
export class Enemies {
  constructor(scene, world, sound) {
    this.scene = scene;
    this.world = world;
    this.sound = sound;
    this.list = [];
    this.sparks = [];
    this.corpses = [];
    this.tracers = [];
    this.spawnTimer = 0;
    this.missiles = [];
    this.bossCd = {}; // ボスごとの再出現待ち
    // main から差し替える
    this.onPlayerHit = () => {};
    this.onKill = () => {};
    this.onWreck = null; // (mesh, vx, vz) 倒した車・ドローンの残骸を渡す先
    this.onBlast = () => {}; // (x, y, z, r) 追跡車が爆発した・ミサイルが着弾した
    this.onBoss = () => {}; // (type) ボスが現れた
  }

  // プレイヤーの弾が当たる対象
  get hitMeshes() {
    return this.list.map(e => e.hitbox);
  }

  count(type) { return this.list.filter(e => e.type === type).length; }

  // 手配度(★)に合わせて敵を揃える。おとなしくしていても時間で少しずつ増える
  director(dt, car, elapsed, level) {
    for (const b of BOSSES) this.bossCd[b] = (this.bossCd[b] ?? 0) - dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 0.5;
    const want = WANT[Math.min(5, Math.max(level, Math.floor(elapsed / 30)))];
    // ボスを先に。出せる場所がなかった種類は飛ばして次を試す
    for (const type of [...BOSSES, 'chaser', 'drone', 'gunman']) {
      if (this.count(type) >= (want[type] ?? 0)) continue;
      if (BOSSES.includes(type) && this.bossCd[type] > 0) continue;
      if (!this.spawn(type, car)) continue;
      if (BOSSES.includes(type)) this.onBoss(type);
      return;
    }
  }

  // 候補のうちプレイヤーの前方にあるものを選ぶ
  pickAhead(car, spots) {
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    let best = null, bestDot = -Infinity;
    for (const s of spots) {
      const dx = s.x - car.pos.x, dz = s.z - car.pos.z;
      const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      if (dot > bestDot) { bestDot = dot; best = s; }
    }
    return best;
  }

  spawn(type, car) {
    const p = car.pos;
    let e;
    if (type === 'gunman') {
      const spot = this.pickAhead(car, this.world.sidewalkSpots(p.x, p.z, 30, 85, 6));
      if (!spot) return false;
      e = { mesh: buildGunman(), shooter: new Shooter(TYPES.gunman.shooter) };
      e.mesh.position.set(spot.x, 0.15, spot.z);
      e.muzzleY = 1.45;
    } else if (type === 'drone') {
      const a = Math.random() * Math.PI * 2;
      e = { mesh: buildDrone(), shooter: new Shooter(TYPES.drone.shooter), orbit: a, orbitR: 22 + Math.random() * 10 };
      e.mesh.position.set(p.x + Math.cos(a) * 90, 12, p.z + Math.sin(a) * 90);
      e.muzzleY = 0;
    } else if (type === 'heli') {
      const a = Math.random() * Math.PI * 2;
      e = { mesh: buildHeli(), shooter: new Shooter(TYPES.heli.shooter), orbit: a, orbitR: 35, air: true, missileTimer: 4 };
      e.mesh.position.set(p.x + Math.cos(a) * 130, 30, p.z + Math.sin(a) * 130);
      e.muzzleY = -1;
    } else {
      const spot = this.world.roadSpot(p.x, p.z, type === 'truck' ? 90 : 70, 130);
      if (!spot) return false;
      const v = new Vehicle(type === 'truck' ? TRUCK_CFG : CFG);
      v.reset(spot.x, spot.z, spot.yaw);
      e = { mesh: type === 'truck' ? buildTruck() : buildChaser(), vehicle: v, drive: {}, ramCd: 0 };
      if (type === 'truck') { e.shooter = new Shooter(TYPES.truck.shooter); e.muzzleY = 4.2; }
    }
    Object.assign(e, { type, hp: TYPES[type].hp, flash: 0, laser: null });
    const [geo, y] = HITBOX[type];
    e.hitbox = new THREE.Mesh(geo, hitboxMat);
    e.hitbox.position.y = y;
    e.mesh.add(e.hitbox);
    tag(e.mesh, e);
    this.scene.add(e.mesh);
    this.list.push(e);
    return true;
  }

  update(dt, car, elapsed, active, level = 0) {
    if (active) this.director(dt, car, elapsed, level);
    const head = new THREE.Vector3(car.pos.x, 1.3, car.pos.z);
    const speed = Math.hypot(car.phys.vx, car.phys.vz);

    for (const e of [...this.list]) {
      const m = e.mesh;
      const dx = car.pos.x - m.position.x, dz = car.pos.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > DESPAWN && e.type !== 'heli') { this.remove(e); continue; }

      if (e.vehicle) this.updateChaser(e, dt, car, active);
      if (e.type === 'drone') this.updateDrone(e, dt, car);
      if (e.type === 'heli') this.updateHeli(e, dt, car, active);
      if (e.type === 'gunman') {
        e.t = (e.t ?? Math.random() * 10) + dt;
        // 気づくまではきょろきょろ見回す(動いている物は目に入りやすい)
        if (e.shooter.state !== 'idle') m.rotation.y = Math.atan2(dx, dz) + Math.PI;
        else m.rotation.y = (e.idleYaw ??= Math.random() * Math.PI * 2) + Math.sin(e.t * 1.3) * 0.8;
        // 遠いほど少し大きく描いて、画面上で小さくなりすぎないようにする
        m.scale.setScalar(1.3 * (1 + Math.min(0.5, Math.max(0, dist - 30) / 100)));
        e.muzzleY = 1.42 * m.scale.y;
        // 速い車に轢かれる
        if (active && speed > 5 && this.underCar(car, m.position)) {
          this.kill(e, 'runover', RUN_OVER_POINTS, car);
          car.addTrauma(0.25);
          continue;
        }
      }

      if (e.shooter && active) this.updateShooter(e, dt, car, head, dist, speed);

      e.flash -= dt;
      this.glow(e);
    }
    this.updateMissiles(dt);
    this.updateFx(dt);
  }

  updateShooter(e, dt, car, head, dist, speed) {
    const m = e.mesh;
    // 視線チェックは 0.2 秒ごと
    e.losTimer = (e.losTimer ?? Math.random() * 0.2) - dt;
    if (e.losTimer <= 0) {
      e.losTimer = 0.2;
      // ヘリは上空からビル越しに撃てる
      e.los = e.air || lineOfSight(this.world.losBoxes ?? this.world.boxes, m.position.x, m.position.z, car.pos.x, car.pos.z);
    }
    const muzzle = new THREE.Vector3(m.position.x, m.position.y + e.muzzleY, m.position.z);
    for (const ev of e.shooter.update(dt, { dist, los: e.los })) {
      if (ev.type === 'aim') this.sound.lockOn(Math.max(0.2, 1 - dist / 70));
      if (ev.type === 'fire') this.enemyFire(e, muzzle, head, dist, speed);
    }
    // 照準中は赤いレーザーで予告する
    const aiming = e.shooter.state === 'aim';
    if (aiming && !e.laser) {
      e.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([muzzle, head]), laserMat);
      this.scene.add(e.laser);
    }
    if (!aiming && e.laser) this.dropLaser(e);
    if (e.laser) e.laser.geometry.setFromPoints([muzzle, head]);
  }

  // 被弾は白、狙っている間は体が赤く脈打つ
  glow(e) {
    const aiming = e.shooter?.state === 'aim';
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
    e.mesh.traverse(o => {
      const mt = o.material;
      if (!o.isMesh || !mt?.emissive || !mt.userData.base) return;
      if (e.flash > 0) mt.emissive.copy(WHITE);
      else if (aiming && mt === e.mesh.userData.body) mt.emissive.copy(mt.userData.base).lerp(AIM_COLOR, pulse);
      else mt.emissive.copy(mt.userData.base);
    });
    if (e.muzzle) {
      e.muzzleLife -= 1 / 60;
      e.muzzle.visible = e.muzzleLife > 0;
    }
  }

  // 銃口の光(撃った瞬間だけ)
  muzzleFlash(e, at) {
    if (!e.muzzle) {
      e.muzzle = new THREE.Mesh(flashGeo, flashMat);
      this.scene.add(e.muzzle);
    }
    e.muzzle.position.copy(at);
    e.muzzle.scale.setScalar(0.8 + Math.random() * 0.6);
    e.muzzle.visible = true;
    e.muzzleLife = 0.05;
  }

  enemyFire(e, muzzle, head, dist, speed) {
    this.muzzleFlash(e, muzzle);
    const hit = Math.random() < hitChance({ dist, speed });
    const to = head.clone();
    if (!hit) to.add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.3) * 3, (Math.random() - 0.5) * 6));
    this.tracer(muzzle, to, 0.06);
    this.sound.enemyShot(Math.max(0.15, 1 - dist / 80));
    if (hit) this.onPlayerHit(TYPES[e.type].damage, e.mesh.position.x, e.mesh.position.z);
  }

  updateDrone(e, dt, car) {
    const m = e.mesh;
    e.orbit += dt * 0.35;
    const tx = car.pos.x + Math.cos(e.orbit) * e.orbitR;
    const tz = car.pos.z + Math.sin(e.orbit) * e.orbitR;
    const ty = 7 + Math.sin(e.orbit * 3) * 1.2;
    const k = Math.min(1, dt * 1.2);
    m.position.x += (tx - m.position.x) * k;
    m.position.z += (tz - m.position.z) * k;
    m.position.y += (ty - m.position.y) * k;
    m.rotation.y = Math.atan2(car.pos.x - m.position.x, car.pos.z - m.position.z) + Math.PI;
    for (const r of m.userData.rotors) r.rotation.y += dt * 40;
  }

  // ヘリ: 上空を回りながら機銃と、赤い円で予告するミサイル
  updateHeli(e, dt, car, active) {
    const m = e.mesh;
    e.orbit += dt * 0.2;
    const tx = car.pos.x + Math.cos(e.orbit) * e.orbitR;
    const tz = car.pos.z + Math.sin(e.orbit) * e.orbitR;
    const k = Math.min(1, dt * 0.6);
    m.position.x += (tx - m.position.x) * k;
    m.position.z += (tz - m.position.z) * k;
    m.position.y += (18 + Math.sin(e.orbit * 2) * 2 - m.position.y) * k;
    m.rotation.y = Math.atan2(car.pos.x - m.position.x, car.pos.z - m.position.z) + Math.PI;
    m.rotation.z = Math.sin(e.orbit * 2) * 0.08;
    m.userData.rotors[0].rotation.y += dt * 30;
    m.userData.tailRotor.rotation.x += dt * 40;
    if (!active) return;
    e.missileTimer -= dt;
    if (e.missileTimer <= 0) {
      e.missileTimer = 4 + Math.random() * 2;
      // 少し先を狙う。予告の円から逃げれば当たらない
      const x = car.pos.x + car.phys.vx * 1.2, z = car.pos.z + car.phys.vz * 1.2;
      const ring = new THREE.Mesh(missileRingGeo, missileRingMat);
      ring.position.set(x, 0.1, z);
      this.scene.add(ring);
      this.missiles.push({ x, z, t: 1.6, ring });
      this.sound.lockOn(1);
    }
  }

  updateMissiles(dt) {
    for (const ms of [...this.missiles]) {
      ms.t -= dt;
      ms.ring.scale.setScalar(0.4 + 0.6 * Math.min(1, ms.t / 1.6));
      if (ms.t > 0) continue;
      this.scene.remove(ms.ring);
      this.missiles.splice(this.missiles.indexOf(ms), 1);
      this.onBlast(ms.x, 0.5, ms.z, 7);
    }
  }

  updateChaser(e, dt, car, active) {
    const v = e.vehicle;
    // 少し先を狙う
    const target = { x: car.pos.x + car.phys.vx * 0.4, z: car.pos.z + car.phys.vz * 0.4 };
    v.update(dt, active ? chaseInput(v, target, dt, e.drive) : { up: false, down: true }, this.world);
    e.mesh.position.set(v.x, 0, v.z);
    e.mesh.rotation.y = v.yaw;
    e.ramCd -= dt;
    if (!active || e.ramCd > 0) return;

    // プレイヤーの車とぶつかった
    const dx = v.x - car.pos.x, dz = v.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > (e.type === 'truck' ? 5 : 3.6)) return;
    const nx = dx / (d || 1), nz = dz / (d || 1);
    const closing = (car.phys.vx - v.vx) * nx + (car.phys.vz - v.vz) * nz;
    if (closing < 2) return;
    e.ramCd = 0.8;
    const mx = (v.x + car.pos.x) / 2, mz = (v.z + car.pos.z) / 2;
    const playerFast = Math.hypot(car.phys.vx, car.phys.vz) > Math.hypot(v.vx, v.vz); // 突っ込んだ側は痛くない
    car.phys.ram(mx, mz, v.vx, v.vz, TYPES[e.type].mass);
    v.ram(mx, mz, car.phys.vx, car.phys.vz, 1250);
    car.addTrauma(Math.min(0.9, closing / 15));
    car.jolt(closing, { x: -nx, z: -nz });
    this.sound.impact(closing);
    e.hp -= closing * 0.25;
    if (e.hp <= 0) this.kill(e, 'ram', e.type === 'truck' ? TYPES.truck.points : RAM_KILL_POINTS, car);
    else this.onPlayerHit(Math.round(closing * (playerFast ? 0.5 : 1.2) * (e.type === 'truck' ? 1.8 : 1)), v.x, v.z, true);
  }

  // 位置 p が車体の下(少し広め)にあるか
  underCar(car, p) {
    const dx = p.x - car.pos.x, dz = p.z - car.pos.z;
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const f = dx * fx + dz * fz, l = dx * fz - dz * fx;
    return Math.abs(f) < 2.6 && Math.abs(l) < 1.3;
  }

  // プレイヤーの弾が当たった。倒したら true
  damage(e, n, car) {
    if (!this.list.includes(e)) return false;
    e.hp -= n;
    e.flash = 0.06;
    if (e.hp > 0) return false;
    this.kill(e, 'shot', TYPES[e.type].points, car);
    return true;
  }

  kill(e, how, points, car) {
    const p = e.mesh.position;
    const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
    if (e.type === 'gunman') {
      // 吹き飛ぶ
      const away = new THREE.Vector3(p.x - car.pos.x, 0, p.z - car.pos.z).normalize();
      const power = how === 'runover' ? 14 : 4;
      this.corpses.push({ mesh: e.mesh, life: 1.6, vel: away.multiplyScalar(power).setY(how === 'runover' ? 8 : 2), spin: (Math.random() - 0.5) * 12 });
      this.dropLaser(e);
      this.list.splice(this.list.indexOf(e), 1);
      if (how === 'runover') this.sound.impact(8);
    } else {
      this.explode(p, e.type === 'chaser' ? 22 : 14);
      this.sound.explosion(Math.max(0.25, 1 - d / 150));
      car.addTrauma(Math.max(0, 0.5 - d / 80));
      if (this.onWreck) {
        // 消さずに残骸として渡す(黒こげで跳ね上がって燃える)
        this.dropLaser(e);
        this.list.splice(this.list.indexOf(e), 1);
        e.mesh.remove(e.hitbox);
        // 輪郭線は残骸にしない(黒こげの材質で膨らんで見えるため)
        const outlines = [];
        e.mesh.traverse(o => { if (o.userData.outline) outlines.push(o); });
        for (const o of outlines) o.parent.remove(o);
        this.onWreck(e.mesh, e.vehicle?.vx ?? 0, e.vehicle?.vz ?? 0);
      } else this.remove(e);
    }
    if (BOSSES.includes(e.type)) this.bossCd[e.type] = BOSS_RESPAWN;
    const at = { x: p.x, y: p.y, z: p.z };
    this.onKill({ type: e.type, how, points, ...at });
    if (TYPES[e.type].blast) this.onBlast(at.x, at.y, at.z, TYPES[e.type].blast);
  }

  // 爆風に巻き込む。近いほど大ダメージ
  blast(x, y, z, r, car) {
    for (const e of [...this.list]) {
      if (!this.list.includes(e)) continue;
      const p = e.mesh.position;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d > r) continue;
      // 車やボスは一撃では壊れない
      e.hp -= e.type === 'gunman' || e.type === 'drone' ? 99 : 3 + 8 * (1 - d / r);
      e.flash = 0.1;
      if (e.hp <= 0) this.kill(e, 'blast', TYPES[e.type].points, car);
    }
  }

  explode(pos, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sparkGeo, sparkMats[i % 3]);
      m.position.copy(pos).setY(pos.y + 0.8);
      this.scene.add(m);
      this.sparks.push({ mesh: m, life: 0.8, vel: new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 12, (Math.random() - 0.5) * 16) });
    }
  }

  tracer(from, to, life) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), tracerMat);
    this.scene.add(line);
    this.tracers.push({ line, life });
  }

  updateFx(dt) {
    for (const s of [...this.sparks]) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 18 * dt;
      s.mesh.scale.setScalar(Math.max(0.01, s.life * 1.5));
      if (s.life <= 0) { this.scene.remove(s.mesh); this.sparks.splice(this.sparks.indexOf(s), 1); }
    }
    for (const c of [...this.corpses]) {
      c.life -= dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.vel.y -= 20 * dt;
      if (c.mesh.position.y < 0) { c.mesh.position.y = 0; c.vel.multiplyScalar(0.5); c.vel.y = 0; }
      c.mesh.rotation.x += c.spin * dt * (c.mesh.position.y > 0.05 ? 1 : 0);
      if (c.life <= 0) { this.scene.remove(c.mesh); this.corpses.splice(this.corpses.indexOf(c), 1); }
    }
    for (const t of [...this.tracers]) {
      t.life -= dt;
      if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); this.tracers.splice(this.tracers.indexOf(t), 1); }
    }
  }

  dropLaser(e) {
    // 銃口の光も一緒に片付ける(倒された・消えたときに必ず通る)
    if (e.muzzle) { this.scene.remove(e.muzzle); e.muzzle = null; }
    if (!e.laser) return;
    this.scene.remove(e.laser);
    e.laser.geometry.dispose();
    e.laser = null;
  }

  remove(e) {
    this.dropLaser(e);
    this.scene.remove(e.mesh);
    this.list.splice(this.list.indexOf(e), 1);
  }

  clear() {
    [...this.list].forEach(e => this.remove(e));
    for (const c of this.corpses) this.scene.remove(c.mesh);
    this.corpses = [];
    for (const ms of this.missiles) this.scene.remove(ms.ring);
    this.missiles = [];
    this.bossCd = {};
  }
}
