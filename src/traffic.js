import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { laneInput } from './ai.js';

// 一般車。車線に沿って走るだけの車。撃っても体当たりしても壊れ、壊すと手配度が上がる(減点はしない)
const MAX = 6;
const HP = 4;
const POINTS = 80;
const DESPAWN = 170;
const COLORS = [0xf2f2f2, 0x222428, 0xb8bcc2, 0x8c1c1c, 0x1f3d7a, 0x5a6066, 0xd8c040, 0x3a7a50];
const hitboxGeo = new THREE.BoxGeometry(2.1, 1.6, 4.5);
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

function buildCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4.2), paint);
  body.position.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.1), new THREE.MeshLambertMaterial({ color: 0x2a3440 }));
  cabin.position.set(0, 1.17, 0.2);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  tail.position.set(0, 0.75, 2.12);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff3c0 }));
  head.position.set(0, 0.72, -2.12);
  g.add(body, cabin, tail, head);
  for (const [x, z] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x151515 }));
    w.position.set(x, 0.32, z);
    g.add(w);
  }
  return g;
}

export class Traffic {
  constructor(scene, world, sound) {
    this.scene = scene;
    this.world = world;
    this.sound = sound;
    this.list = [];
    this.timer = 0;
    // main から差し替える
    this.onWreck = () => {}; // (mesh, vx, vz)
    this.onDestroy = () => {}; // ({ points, x, y, z }) プレイヤーが壊した
    this.onBlast = () => {}; // (x, y, z, r)
    this.onPlayerHit = () => {}; // (dmg)
  }

  get hitMeshes() { return this.list.map(c => c.hitbox); }

  spawn(car) {
    const s = this.world.roadSpot(car.pos.x, car.pos.z, 50, 140);
    if (!s) return;
    // roadSpot の向きから車線を決める(yaw=0 は -z 向き)
    const alongZ = Math.abs(Math.sin(s.yaw)) < 0.5;
    const lane = alongZ
      ? { axis: 'z', coord: s.x, dir: Math.cos(s.yaw) > 0 ? -1 : 1 }
      : { axis: 'x', coord: s.z, dir: -Math.sin(s.yaw) > 0 ? 1 : -1 };
    const v = new Vehicle();
    v.reset(s.x, s.z, s.yaw);
    const mesh = buildCar(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const c = { mesh, vehicle: v, lane, kmh: 30 + Math.random() * 20, hp: HP, ramCd: 0 };
    c.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    c.hitbox.position.y = 0.8;
    mesh.add(c.hitbox);
    mesh.traverse(o => { o.userData.civ = c; });
    this.scene.add(mesh);
    this.list.push(c);
  }

  update(dt, car, active) {
    this.timer -= dt;
    if (active && this.timer <= 0 && this.list.length < MAX) {
      this.timer = 1.2;
      this.spawn(car);
    }
    for (const c of [...this.list]) {
      const v = c.vehicle;
      if (Math.hypot(v.x - car.pos.x, v.z - car.pos.z) > DESPAWN) { this.remove(c); continue; }
      const input = laneInput(v, c.lane, c.kmh);
      // 前にプレイヤーの車がいたら止まる
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const dx = car.pos.x - v.x, dz = car.pos.z - v.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 10 && side < 2.5) { input.up = false; input.down = true; }
      v.update(dt, input, this.world);
      c.mesh.position.set(v.x, 0, v.z);
      c.mesh.rotation.y = v.yaw;
      if (active) this.bump(c, dt, car);
    }
  }

  // プレイヤーとの衝突
  bump(c, dt, car) {
    const v = c.vehicle;
    c.ramCd -= dt;
    if (c.ramCd > 0) return;
    const dx = v.x - car.pos.x, dz = v.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.4) return;
    const nx = dx / (d || 1), nz = dz / (d || 1);
    const closing = (car.phys.vx - v.vx) * nx + (car.phys.vz - v.vz) * nz;
    if (closing < 2) return;
    c.ramCd = 0.6;
    const mx = (v.x + car.pos.x) / 2, mz = (v.z + car.pos.z) / 2;
    car.phys.ram(mx, mz, v.vx, v.vz, 1250);
    v.ram(mx, mz, car.phys.vx, car.phys.vz, 1250);
    car.addTrauma(Math.min(0.8, closing / 15));
    car.jolt(closing, { x: -nx, z: -nz });
    this.sound.impact(closing);
    this.onPlayerHit(Math.round(closing * 0.3));
    this.damage(c, closing * 0.3);
  }

  // 撃たれた・ぶつけられた。壊れたら true
  damage(c, n) {
    if (!this.list.includes(c)) return false;
    c.hp -= n;
    if (c.hp > 0) return false;
    const v = c.vehicle, p = c.mesh.position;
    this.list.splice(this.list.indexOf(c), 1);
    c.mesh.remove(c.hitbox);
    this.onWreck(c.mesh, v.vx, v.vz);
    this.onDestroy({ points: POINTS, x: p.x, y: 1.5, z: p.z });
    this.onBlast(p.x, 0.8, p.z, 5);
    return true;
  }

  remove(c) {
    this.scene.remove(c.mesh);
    this.list.splice(this.list.indexOf(c), 1);
  }

  clear() {
    [...this.list].forEach(c => this.remove(c));
  }
}
