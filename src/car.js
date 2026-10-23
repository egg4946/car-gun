import * as THREE from 'three';
import { Vehicle } from './vehicle.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _camDir = new THREE.Vector3();

// なめらかなランダム揺れ(-1〜1)
function wobble(t, seed) {
  return Math.sin(t * 17.3 + seed) * 0.5 + Math.sin(t * 31.7 + seed * 2.1) * 0.3 + Math.sin(t * 53.1 + seed * 3.7) * 0.2;
}

// 見た目・カメラ・揺れ。物理は Vehicle に任せる。
export class Car {
  constructor(scene) {
    this.phys = new Vehicle();
    this.pos = new THREE.Vector3();
    this.handsOff = false;
    this.view = 'cockpit';
    this.slip = 0; // タイヤの滑り具合 0〜1(音・煙・揺れ用)
    this.skidding = false;

    this.group = new THREE.Group(); // 位置と向き
    this.body = new THREE.Group(); // サスペンションで傾く車体
    this.group.add(this.body);
    scene.add(this.group);
    this.buildModel();

    this.head = new THREE.Object3D(); // 運転席(右ハンドル)
    this.head.position.set(0.38, 1.34, 0.05);
    this.body.add(this.head);
    // 銃は車体ではなく視点に付ける。横を向いても画面の右下に残る。
    this.gunRig = new THREE.Group();
    this.head.add(this.gunRig);
    this.gunRig.add(this.gun);
    this.gun.position.set(0.17, -0.28, -0.57);
    this.gun.rotation.set(-0.02, 0, 0);
    this.gunRig.visible = false;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 400);
    this.world = null;
    this.recoil = 0;
    this.gunKick = 0;
    this.muzzleTimer = 0;
    this.reset();
  }

  buildModel() {
    const paint = new THREE.MeshLambertMaterial({ color: 0xc8202a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1b1b1f });
    const glass = new THREE.MeshLambertMaterial({ color: 0x223344 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.3), paint);
    chassis.position.y = 0.6;
    this.chassis = chassis;

    // 外から見たときだけ表示する部分
    this.exterior = new THREE.Group();
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), glass);
    cabin.position.set(0, 1.15, 0.35);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.35), dark);
    wing.position.set(0, 1.05, 2.0);
    this.exterior.add(cabin, wing);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    for (const s of [-0.6, 0.6]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), headMat);
      h.position.set(s, 0.72, -2.16);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), tailMat);
      t.position.set(s, 0.75, 2.16);
      this.exterior.add(h, t);
    }

    // 運転席から見える部分
    this.interior = new THREE.Group();
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.5), dark);
    dash.position.set(0, 0.92, -0.8);
    const tilt = new THREE.Group();
    // 上端が目線より十分下になる高さ(地平線の先にいる敵をハンドルで隠さない)
    tilt.position.set(0.38, 0.86, -0.48);
    tilt.rotation.x = -0.35;
    this.steerWheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    this.steerWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.02), new THREE.MeshLambertMaterial({ color: 0x444444 })));
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    mark.position.y = 0.17;
    this.steerWheel.add(mark);
    tilt.add(this.steerWheel);

    // コックピットでは赤いボンネットの上に暗いカバーを置き、照準のコントラストを保つ
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.02, 1.35), new THREE.MeshLambertMaterial({ color: 0x24262a }));
    hood.position.set(0, 0.89, -1.4);

    // 銃と腕。三人称では interior ごと隠れる。
    const gun = new THREE.Group();
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x4a3528 });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd8a878 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.36), gunMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6).rotateX(Math.PI / 2), gunMat);
    barrel.position.set(0, 0.03, -0.33);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.11), gripMat);
    grip.position.set(0, -0.13, 0.08);
    grip.rotation.x = -0.25;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.2), skinMat);
    hand.position.set(-0.02, -0.13, 0.02);
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.18), skinMat);
    support.position.set(0.05, -0.08, -0.22);
    gun.add(receiver, barrel, grip, hand, support);
    gun.position.set(0.55, 1.06, -0.52);
    gun.rotation.set(-0.02, -0.04, 0);
    this.gun = gun;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.03, -0.5);
    this.ejectPort = new THREE.Object3D();
    this.ejectPort.position.set(0.08, 0.04, 0.05);
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    gun.add(this.muzzle, this.ejectPort, this.flash);
    this.interior.add(dash, tilt, hood, gun);

    this.body.add(chassis, this.exterior, this.interior);

    // タイヤは車体と一緒に傾かない
    const tyreGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14).rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    this.wheels = [];
    for (const [x, z, front] of [[-0.82, -1.25, true], [0.82, -1.25, true], [-0.82, 1.35, false], [0.82, 1.35, false]]) {
      const holder = new THREE.Group();
      holder.position.set(x, 0.32, z);
      const tyre = new THREE.Mesh(tyreGeo, dark);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.4, 0.08), rimMat);
      tyre.add(rim);
      holder.add(tyre);
      this.group.add(holder);
      this.wheels.push({ holder, tyre, front });
    }
  }

  reset(start = { x: 0, z: 15, yaw: 0 }) {
    this.phys.reset(start.x, start.z, start.yaw);
    this.lookYaw = this.lookPitch = 0;
    this.lookHold = 0;
    this.trauma = 0;
    this.fovKick = 0;
    this.time = 0;
    this.roll = this.rollVel = this.pitch = this.pitchVel = 0;
    this.wheelAngle = 0;
    this.chaseYaw = start.yaw;
    this.pos.set(this.phys.x, 0, this.phys.z);
    this.recoil = this.gunKick = this.muzzleTimer = 0;
    if (this.flash) this.flash.visible = false;
  }

  get yaw() { return this.phys.yaw; }
  get speed() { return this.phys.speed; }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  // 発砲の見た目と反動。弾の方向は呼び出し側がカメラから決める。
  fire() {
    this.gunKick = Math.min(0.14, this.gunKick + 0.09);
    this.recoil = Math.min(0.025, this.recoil + 0.012);
    this.addTrauma(0.05);
    this.muzzleTimer = 0.05;
    if (this.flash) {
      this.flash.visible = true;
      this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    }
    this.group.updateMatrixWorld(true);
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    const eject = this.view === 'cockpit' ? this.ejectPort.getWorldPosition(new THREE.Vector3()) : null;
    const s = Math.sin(this.phys.yaw), c = Math.cos(this.phys.yaw);
    const shellVel = eject
      ? new THREE.Vector3(c * 2 + s * 0.5 + (Math.random() - 0.5), 2 + Math.random(), -s * 2 + c * 0.5 + (Math.random() - 0.5))
      : null;
    return { muzzle, eject, shellVel };
  }

  toggleView() {
    this.view = this.view === 'cockpit' ? 'chase' : 'cockpit';
    this.chaseYaw = this.phys.yaw;
  }

  update(dt, input, world) {
    this.handsOff = input.handsOff;
    this.world = world;
    const p = this.phys;
    p.update(dt, input, world);
    this.pos.set(p.x, 0, p.z);

    const spd = Math.hypot(p.vx, p.vz);
    const rear = Math.max(0, Math.abs(p.slipRear) - 0.1) * 2.2 + p.wheelspin * 0.6 + (p.handbrake && spd > 3 ? 0.4 : 0);
    const front = Math.max(0, Math.abs(p.slipFront) - 0.18) * 1.6;
    this.slip = Math.min(1, Math.max(rear, front)) * Math.min(1, spd / 6);
    this.skidding = this.slip > 0.15;
    if (p.impact > 1.5) this.jolt(p.impact, p.lastNormal);
  }

  // 衝撃で車体を揺らす。n はぶつかった面から車を押し返す向き
  jolt(impact, n) {
    const sn = Math.sin(this.phys.yaw), cs = Math.cos(this.phys.yaw);
    const back = n.x * sn + n.z * cs; // 後ろ向き成分(正面衝突で +)
    const left = -n.x * cs + n.z * sn;
    this.pitchVel -= back * impact * 0.06;
    this.rollVel += left * impact * 0.08;
    this.fovKick = Math.min(10, this.fovKick + impact * 0.4);
  }

  // 敵(速度 ev)が位置 at から突っ込んできて爆発した
  rammedFrom(at, evx, evz) {
    const p = this.phys;
    // 車体の表面のうち敵に一番近い点が接触点
    const sn = Math.sin(p.yaw), cs = Math.cos(p.yaw);
    const fx = -sn, fz = -cs, lx = -cs, lz = sn;
    const dx = at.x - p.x, dz = at.z - p.z;
    const f = THREE.MathUtils.clamp(dx * fx + dz * fz, -2.15, 2.15);
    const l = THREE.MathUtils.clamp(dx * lx + dz * lz, -0.9, 0.9);
    const px = p.x + fx * f + lx * l, pz = p.z + fz * f + lz * l;
    p.ram(px, pz, evx, evz, 900);
    // 爆風は重心を押す
    const d = Math.hypot(dx, dz) || 1;
    p.applyImpulse(p.x, p.z, -dx / d * 4000, -dz / d * 4000);
    this.addTrauma(0.8);
    this.jolt(14, { x: -dx / d, z: -dz / d });
  }

  // 車体の座標系での点(side=右+, along=後ろ+)をワールド座標へ
  localToGround(side, along) {
    const s = Math.sin(this.phys.yaw), c = Math.cos(this.phys.yaw);
    return new THREE.Vector3(this.phys.x + c * side + s * along, 0, this.phys.z - s * side + c * along);
  }

  sync(dt) {
    const p = this.phys;
    this.time += dt;
    this.group.position.copy(this.pos);
    this.group.rotation.y = p.yaw;

    // サスペンション(バネ+ダンパー): 曲がると外側に傾き、ブレーキで前に沈む
    const tRoll = -p.accelLat * 0.0065, tPitch = p.accelLong * 0.006;
    this.rollVel += ((tRoll - this.roll) * 140 - this.rollVel * 12) * dt;
    this.pitchVel += ((tPitch - this.pitch) * 140 - this.pitchVel * 12) * dt;
    this.roll += this.rollVel * dt;
    this.pitch += this.pitchVel * dt;
    this.body.rotation.set(this.pitch, 0, this.roll);

    this.wheelAngle += p.speed / 0.32 * dt;
    for (const w of this.wheels) {
      if (w.front) w.holder.rotation.y = p.delta;
      w.tyre.rotation.x = -(this.wheelAngle + (w.front ? 0 : p.wheelspin * this.time * 40));
    }
    this.steerWheel.rotation.z = p.steer * 2.4;

    // 揺れ: 衝撃(trauma)は二乗で効かせ、ドリフト中と高速時は細かく震える
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    const shake = this.trauma * this.trauma;
    const rumble = this.slip * 0.6 + Math.min(1, Math.abs(p.speed) / 45) * 0.12;
    const t = this.time;
    const sx = wobble(t, 1) * shake * 0.12 + wobble(t * 2.3, 7) * rumble * 0.012;
    const sy = wobble(t, 2) * shake * 0.12 + wobble(t * 2.7, 8) * rumble * 0.015;
    const sPitch = wobble(t, 4) * shake * 0.05 + wobble(t * 3.1, 9) * rumble * 0.008;
    const sYaw = wobble(t, 3) * shake * 0.05;
    const sRoll = wobble(t, 5) * shake * 0.07 + wobble(t * 2.1, 10) * rumble * 0.01;

    // ハンドルを握っている間は進行方向(滑っている方)を見る。
    // ただしマウスを動かした直後は、先に狙いをつけておけるよう戻さない
    this.lookHold = Math.max(0, this.lookHold - dt);
    if (!this.handsOff && this.lookHold === 0) {
      const k = Math.min(1, dt * 4);
      const target = this.view === 'cockpit' ? THREE.MathUtils.clamp(p.bodySlip * 0.8, -0.7, 0.7) : 0;
      this.lookYaw += (target - this.lookYaw) * k;
      this.lookPitch -= this.lookPitch * k;
    }

    const fov = 72 + Math.min(16, Math.abs(p.speed) * 0.4) + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // 発砲後の反動と薬莢・マズルフラッシュの寿命
    this.recoil *= Math.max(0, 1 - dt * 18);
    this.gunKick *= Math.max(0, 1 - dt * 16);
    this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
    if (this.flash) this.flash.visible = this.muzzleTimer > 0;
    if (this.gun) {
      this.gun.position.z = -0.57 + this.gunKick * 0.22;
      this.gun.rotation.x = -0.02 + this.gunKick * 1.5;
    }

    const cockpit = this.view === 'cockpit';
    this.exterior.visible = !cockpit;
    this.interior.visible = cockpit;
    if (this.gunRig) this.gunRig.visible = cockpit;
    if (cockpit) {
      this.group.updateMatrixWorld(true);
      this.head.getWorldPosition(this.camera.position);
      this.head.getWorldQuaternion(this.camera.quaternion);
      _e.set(this.lookPitch + sPitch + this.recoil, this.lookYaw + sYaw, sRoll);
      this.gunRig.quaternion.setFromEuler(_e);
    } else {
      // 追従カメラ: 車の向きに少し遅れてついていく
      let d = p.yaw + this.lookYaw - this.chaseYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.chaseYaw += d * Math.min(1, dt * (this.handsOff ? 12 : 3.5));
      const dist = 6.5 + Math.min(2, Math.abs(p.speed) * 0.05);
      const cs = Math.sin(this.chaseYaw), cc = Math.cos(this.chaseYaw);
      let camX = this.pos.x + cs * dist, camY = 2.6 - this.lookPitch * 2, camZ = this.pos.z + cc * dist;
      // 建物や木の後ろにカメラが回り込んだら手前まで寄せる。
      // 近すぎるときは車の上へ逃がし、車内や壁の中を見せない。
      if (this.world?.raycast) {
        const ox = this.pos.x, oy = 1.4, oz = this.pos.z;
        _camDir.set(camX - ox, camY - oy, camZ - oz);
        const len = _camDir.length();
        if (len > 0.01) {
          _camDir.multiplyScalar(1 / len);
          const hit = this.world.raycast({ x: ox, y: oy, z: oz }, _camDir, len);
          if (hit && hit.t < len) {
            const t = Math.max(0.15, hit.t - 0.35);
            camX = ox + _camDir.x * t;
            camY = oy + _camDir.y * t;
            camZ = oz + _camDir.z * t;
            if (t < 2.5) camY = Math.max(camY, 3.4);
          }
        }
      }
      this.camera.position.set(camX, camY, camZ);
      this.camera.lookAt(_v.set(this.pos.x - cs * 5, 1.2 + this.lookPitch * 6, this.pos.z - cc * 5));
      _e.set(sPitch + this.recoil, sYaw, sRoll);
    }
    this.camera.quaternion.multiply(_q.setFromEuler(_e));
    this.camera.position.add(_v.set(sx, sy, 0).applyQuaternion(this.camera.quaternion));
  }

  look(dx, dy) {
    // 握っている間も視点は動かせる(撃てるのは離している間だけ)
    if (dx || dy) this.lookHold = 1.2;
    this.lookYaw = Math.max(-2.4, Math.min(2.4, this.lookYaw - dx * 0.0025));
    this.lookPitch = Math.max(-0.7, Math.min(0.7, this.lookPitch - dy * 0.0025));
  }
}
