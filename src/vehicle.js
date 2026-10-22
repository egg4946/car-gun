// 車両物理(three.js 非依存)。
// 2輪(自転車)モデル + タイヤの横力。前後のスリップ角から横力を出し、
// 荷重移動・FR駆動の空転・サイドブレーキでリアのグリップが抜けるとドリフトする。
// 座標: ワールドの x/z 平面。yaw=0 で -z が前、yaw が増えると左に回る。

import { pointInBox } from './geom.js';

const G = 9.81;
const RAD2RPM = 60 / (2 * Math.PI);
const STEP = 1 / 120;
const DRIFT = 0.35; // ハンドルを離している間、舵角が勝手に増える速さ

export const CFG = {
  mass: 1250,
  inertia: 2000,
  cgToFront: 1.25, // 重心から前軸まで
  cgToRear: 1.35, // 重心から後軸まで
  cgHeight: 0.5,
  wheelRadius: 0.32,
  tireGrip: 1.15, // 摩擦係数(フロント)
  rearGrip: 1.3, // リアを少し強くして弱アンダーにする
  handbrakeGrip: 0.5, // サイド時のリアのグリップ倍率
  peakFront: 0.17, // 横力が最大になるスリップ角(rad)
  peakRear: 0.12,
  slideFront: 0.85, // 滑りきったときの横力の割合
  slideRear: 0.7,
  yawDamping: 1500,
  driftPower: 0.45, // ドリフト中にアクセルでリアのグリップを下げる量
  spinRecovery: 25000,
  weightTransfer: 0.35,
  brakeForce: 11500,
  handbrakeForce: 3000,
  engineBrake: 1400,
  airResist: 1.0,
  rollResist: 14,
  maxSteer: 0.7,
  steerRate: 2.4, // ハンドルを切る速さ(1/秒)
  steerReturn: 14, // 戻す・逆に切る速さ
  steerFalloff: 11, // 速いほどハンドルが切れなくなる
  gears: [3.3, 2.1, 1.5, 1.16, 0.94, 0.79],
  reverseGear: 3.2,
  finalDrive: 3.7,
  efficiency: 0.85,
  halfLength: 2.15,
  halfWidth: 0.9,
  restitution: 0.2,
  wallFriction: 0.3,
  idleRpm: 900,
  redline: 7000,
  shiftUp: 6400,
  shiftDown: 2700,
  shiftTime: 0.22,
};

// 最大トルク約 305Nm @4400rpm
export function engineTorque(rpm) {
  const x = rpm / 1000;
  return Math.max(0, 140 + 75 * x - 8.5 * x * x);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// タイヤの横力(1=最大)。スリップ角 peak で最大になり、それを超えると slide まで落ちる
function tireForce(slip, peak, slide) {
  const x = Math.abs(slip) / peak;
  const y = x < 1 ? x * (2 - x) : slide + (1 - slide) * Math.exp(-1.2 * (x - 1));
  return -Math.sign(slip) * y;
}

export class Vehicle {
  // cfg で車種ごとの性能に差し替えられる(トラックなど)。省略時は CFG
  constructor(cfg = CFG) {
    this.cfg = cfg;
    this.reset(0, 15, 0);
  }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, z, yaw, vx: 0, vz: 0, yawRate: 0,
      steer: 0, delta: 0, throttle: 0, brake: 0, handbrake: 0,
      acc: 0, boost: 1, gear: 1, reverse: false, rpm: this.cfg.idleRpm, shiftTimer: 0, shifted: false,
      impact: 0, lastNormal: { x: 0, z: 1 },
      accelLong: 0, accelLat: 0, slipFront: 0, slipRear: 0, wheelspin: 0,
    });
  }

  // [前後速度, 横速度(左が+)]
  localVel() {
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    return [-sn * this.vx - cs * this.vz, -cs * this.vx + sn * this.vz];
  }

  get speed() { return this.localVel()[0]; }

  // 車体の向きと進行方向のずれ(ドリフト角)。左に滑っていると +
  get bodySlip() {
    const [f, l] = this.localVel();
    return Math.hypot(f, l) < 3 ? 0 : Math.atan2(l, Math.abs(f));
  }

  update(dt, input, world) {
    // ハンドル: 握っていれば入力に追従、離すと今の向きにさらに切れていく
    if (input.handsOff) {
      if (Math.abs(this.steer) < 0.02) this.steer = Math.random() < 0.5 ? 0.05 : -0.05;
      // 手放しのハンドルは路面の凹凸で小刻みに暴れる(速いほど大きい)
      const shake = (Math.random() - 0.5) * 3 * dt * clamp(Math.abs(this.speed) / 15, 0, 1);
      this.steer = clamp(this.steer + Math.sign(this.steer) * DRIFT * dt + shake, -1, 1);
    } else {
      const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      const returning = target === 0 || Math.sign(target) !== Math.sign(this.steer);
      const rate = (returning ? this.cfg.steerReturn : this.cfg.steerRate) * dt;
      this.steer += clamp(target - this.steer, -rate, rate);
    }

    // ペダル: 止まりかけでブレーキを踏み続けるとバックに入る
    const vF = this.speed;
    if (!this.reverse && input.down && !input.up && vF < 0.5) this.reverse = true;
    if (this.reverse && input.up && !input.down && vF > -0.5) this.reverse = false;
    const gas = this.reverse ? input.down : input.up;
    this.brake = (this.reverse ? input.up : input.down) ? 1 : 0;
    this.handbrake = input.handbrake ? 1 : 0;
    this.throttle += ((gas ? 1 : 0) - this.throttle) * Math.min(1, dt * 10);

    this.shifted = false;
    this.impact = 0;
    // 固定ステップ(1/120秒)で進めるので、フレームレートが変わっても挙動は同じ
    this.acc = Math.min(this.acc + dt, STEP * 8);
    while (this.acc >= STEP - 1e-9) {
      this.acc -= STEP;
      this.step(STEP);
      if (world) this.collideWorld(world);
    }
  }

  step(dt) {
    const c = this.cfg;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const fx = -sn, fz = -cs; // 前
    const lx = -cs, lz = sn; // 左
    const vF = fx * this.vx + fz * this.vz;
    const vL = lx * this.vx + lz * this.vz;
    const L = c.cgToFront + c.cgToRear;

    // 荷重移動: 加速でリア、ブレーキでフロントに荷重が乗る
    const transfer = c.mass * c.weightTransfer * this.accelLong * c.cgHeight / L;
    const wF = Math.max(0.2 * c.mass * G, c.mass * G * c.cgToRear / L - transfer);
    const wR = Math.max(0.2 * c.mass * G, c.mass * G * c.cgToFront / L + transfer);

    // 車体の向きと進行方向のずれ
    const beta = Math.atan2(vL, Math.max(Math.abs(vF), 2));

    // エンジンとギア(AT)。ドリフト中はシフトしない(駆動が途切れて戻ってしまうため)
    if (this.reverse) this.gear = 1;
    const ratio = (this.reverse ? c.reverseGear : c.gears[this.gear - 1]) * c.finalDrive;
    const wheelRpm = Math.abs(vF) / c.wheelRadius * ratio * RAD2RPM;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (!this.reverse && (Math.abs(beta) < 0.2 || wheelRpm > c.redline)) {
      if (wheelRpm > c.shiftUp && this.gear < c.gears.length) {
        this.gear++; this.shiftTimer = c.shiftTime; this.shifted = true;
      } else if (wheelRpm < c.shiftDown && this.gear > 1) {
        this.gear--; this.shiftTimer = c.shiftTime * 0.5; this.shifted = true;
      }
    }
    let rpmTarget = Math.max(c.idleRpm, wheelRpm);
    if (this.gear === 1) { // 発進時の半クラ
      rpmTarget = Math.max(rpmTarget, c.idleRpm + this.throttle * 3300 * clamp(1 - wheelRpm / 3500, 0, 1));
    }
    rpmTarget += this.wheelspin * 2500;
    this.rpm += (Math.min(rpmTarget, c.redline + 150) - this.rpm) * Math.min(1, dt * (this.shiftTimer > 0 ? 7 : 20));

    let drive = 0;
    if (this.shiftTimer <= 0) {
      if (this.throttle > 0.02) {
        if (this.rpm < c.redline) {
          drive = this.throttle * engineTorque(this.rpm) * (c.torqueScale ?? 1) * ratio * c.efficiency / c.wheelRadius;
          if (this.reverse) drive *= vF < -5.5 ? 0 : -0.4; // バックは20km/hまで
        }
      } else {
        drive = -Math.sign(vF) * Math.min(1, Math.abs(vF)) * (this.rpm / c.redline) * c.engineBrake;
      }
    }

    // リア(駆動輪)のグリップ。縦に力を使うほど横に踏ん張れなくなる(摩擦円)
    const gripR = c.rearGrip * (1 - this.handbrake * (1 - c.handbrakeGrip));
    const limitR = gripR * wR;
    this.wheelspin = this.throttle > 0.02 ? Math.max(0, (Math.abs(drive) - limitR) / limitR) : 0;
    drive = clamp(drive, -limitR, limitR);
    // 踏むほどリアが流れる。ただし 30° を超えたらアクセルの効きを弱めてスピンしにくくする
    const gov = this.throttle > 0.02 ? 1 - clamp((Math.abs(beta) - 0.5) / 0.2, 0, 1) : 1;
    const use = Math.min(1, Math.abs(drive) / limitR * gov + this.handbrake * c.handbrakeForce / limitR);
    const latGripR = gripR * Math.sqrt(Math.max(0.04, 1 - 0.9 * use * use));
    // ドリフトアシスト: すでに滑っているときはアクセルでリアが流れ続ける(LSD+空転の代わり)
    const sliding = clamp((Math.abs(beta) - 0.1) / 0.15, 0, 1);
    const driftGrip = 1 - this.throttle * gov * sliding * c.driftPower;

    // ブレーキ(止まっている車を逆向きに押さない)
    let brakeF = -Math.sign(vF) * (this.brake * c.brakeForce + this.handbrake * c.handbrakeForce);
    const stopF = Math.abs(vF) * c.mass / dt;
    if (Math.abs(brakeF) > stopF) brakeF = Math.sign(brakeF) * stopF;

    // タイヤの横力
    // ハンドルは「前輪が滑らない向き」からの切れ角。キーを離せば前輪は進行方向を向き(カウンター)、
    // 速いほど切れる量が減るのでフロントはグリップの山付近にとどまる
    const vLf = vL + this.yawRate * c.cgToFront;
    const d0 = clamp((vF - 3) / 5, 0, 1) * Math.atan2(vLf, Math.max(vF, 1));
    const auth = Math.max(0.2, c.maxSteer / (1 + Math.abs(vF) / c.steerFalloff));
    this.delta = clamp(d0 + this.steer * auth, -c.maxSteer, c.maxSteer);
    const absF = Math.abs(vF) + 1;
    this.slipFront = Math.atan2(vLf, absF) - Math.sign(vF) * this.delta;
    this.slipRear = Math.atan2(vL - this.yawRate * c.cgToRear, absF);
    const FyF = tireForce(this.slipFront, c.peakFront, c.slideFront) * c.tireGrip * wF;
    const FyR = tireForce(this.slipRear, c.peakRear, c.slideRear) * latGripR * driftGrip * wR;

    const dragF = -c.rollResist * vF - c.airResist * vF * Math.abs(vF);
    const dragL = -c.rollResist * vL - c.airResist * vL * Math.abs(vL);
    // ニトロはタイヤを介さずに車を押す(グリップの限界を超えて加速できる)
    const nitro = this.throttle > 0.02 && !this.reverse ? (this.boost - 1) * 4000 * this.throttle : 0;
    const totF = drive + nitro + brakeF + dragF - FyF * Math.sin(this.delta);
    const totL = dragL + FyF * Math.cos(this.delta) + FyR;
    this.accelLong = totF / c.mass;
    this.accelLat = totL / c.mass;
    this.vx += (fx * this.accelLong + lx * this.accelLat) * dt;
    this.vz += (fz * this.accelLong + lz * this.accelLat) * dt;
    let torque = FyF * Math.cos(this.delta) * c.cgToFront - FyR * c.cgToRear;
    torque -= c.yawDamping * this.yawRate;
    // 40° を超えて回り込んだら車体を進行方向へ戻す(キーボードでも立て直せるように)
    const over = Math.abs(beta) - 0.75;
    if (over > 0 && vF > 5) torque += Math.sign(beta) * over * c.spinRecovery;
    this.yawRate += torque / c.inertia * dt;

    // 低速ではタイヤモデルが不安定なので、幾何学的な曲がり方に寄せる
    const spd = Math.hypot(this.vx, this.vz);
    if (spd < 4) {
      const k = (1 - spd / 4) * (1 - Math.exp(-20 * dt));
      const vF2 = fx * this.vx + fz * this.vz;
      const vL2 = lx * this.vx + lz * this.vz;
      this.yawRate += (vF2 * Math.tan(this.delta) / L - this.yawRate) * k;
      this.vx -= lx * vL2 * k;
      this.vz -= lz * vL2 * k;
    }
    if (spd < 0.2 && this.throttle < 0.05) { this.vx = this.vz = 0; this.yawRate = 0; }

    this.yaw += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  // 点(px,pz)に撃力 J=(jx,jz) を加える。r×J で回転も変わる。
  applyImpulse(px, pz, jx, jz) {
    const rx = px - this.x, rz = pz - this.z;
    this.vx += jx / this.cfg.mass;
    this.vz += jz / this.cfg.mass;
    this.yawRate += (rz * jx - rx * jz) / this.cfg.inertia;
  }

  // 車体上の点の速度(並進 + 回転)
  pointVel(px, pz) {
    const rx = px - this.x, rz = pz - this.z;
    return [this.vx + this.yawRate * rz, this.vz - this.yawRate * rx];
  }

  // 接触点 p・法線 n(車が押し出される向き)での衝突応答。反発 + こすれる摩擦。
  resolveContact(px, pz, nx, nz) {
    const c = this.cfg;
    const rx = px - this.x, rz = pz - this.z;
    const [vpx, vpz] = this.pointVel(px, pz);
    const vn = vpx * nx + vpz * nz;
    if (vn >= 0) return 0;
    const rn = rz * nx - rx * nz;
    const j = -(1 + c.restitution) * vn / (1 / c.mass + rn * rn / c.inertia);
    this.applyImpulse(px, pz, j * nx, j * nz);

    // 接線方向はクーロン摩擦(押し付けた強さに比例して減速、回される)
    const [ux, uz] = this.pointVel(px, pz);
    const tx = -nz, tz = nx;
    const vt = ux * tx + uz * tz;
    const rt = rz * tx - rx * tz;
    const jt = clamp(-vt / (1 / c.mass + rt * rt / c.inertia), -c.wallFriction * j, c.wallFriction * j);
    this.applyImpulse(px, pz, jt * tx, jt * tz);
    return -vn;
  }

  // 車体(長方形)とビル(AABB)の接触。一番深い接触と、同じ面でほぼ同じ深さの点を平均した接触点を返す。
  deepestContact(boxes) {
    const c = this.cfg;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const fx = -sn, fz = -cs, lx = -cs, lz = sn;
    const hits = [];
    for (const b of boxes) {
      if (b.broken) continue;
      if (this.x < b.minX - 3 || this.x > b.maxX + 3 || this.z < b.minZ - 3 || this.z > b.maxZ + 3) continue;
      // 車の角と辺の中点がビルに入った
      for (const [a, s] of CAR_POINTS) {
        const px = this.x + fx * a * c.halfLength + lx * s * c.halfWidth;
        const pz = this.z + fz * a * c.halfLength + lz * s * c.halfWidth;
        const hit = pointInBox(px, pz, b);
        if (hit) hits.push({ px, pz, box: b, ...hit });
      }
      // ビルの角が車に刺さった
      for (const [qx, qz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) {
        const dx = qx - this.x, dz = qz - this.z;
        const lf = dx * fx + dz * fz, ll = dx * lx + dz * lz;
        const dF = c.halfLength - Math.abs(lf), dL = c.halfWidth - Math.abs(ll);
        if (dF <= 0 || dL <= 0) continue;
        // 中心線ちょうどでも向きが 0 にならないよう、0 は + 側に寄せる
        const sf = lf < 0 ? -1 : 1, sl = ll < 0 ? -1 : 1;
        hits.push(dF < dL
          ? { px: qx, pz: qz, box: b, nx: -sf * fx, nz: -sf * fz, depth: dF }
          : { px: qx, pz: qz, box: b, nx: -sl * lx, nz: -sl * lz, depth: dL });
      }
    }
    if (!hits.length) return null;
    const best = hits.reduce((a, b) => (b.depth > a.depth ? b : a));
    let px = 0, pz = 0, n = 0;
    for (const h of hits) {
      if (h !== best && (h.depth < best.depth - 0.1 || h.nx * best.nx + h.nz * best.nz < 0.9)) continue;
      px += h.px; pz += h.pz; n++;
    }
    return { ...best, px: px / n, pz: pz / n };
  }

  collideWorld(world) {
    for (let i = 0; i < 4; i++) {
      const hit = this.deepestContact(world.boxes);
      if (!hit) return;
      // 街灯や木など軽い物は、勢いよく当たればなぎ倒して進む(重さの分だけ減速)
      const b = hit.box;
      if (b.breakSpeed > 0) {
        const [vpx, vpz] = this.pointVel(hit.px, hit.pz);
        const vn = vpx * hit.nx + vpz * hit.nz;
        if (-vn >= b.breakSpeed) {
          b.broken = true;
          const j = -vn * this.cfg.mass * b.mass / (this.cfg.mass + b.mass);
          this.applyImpulse(hit.px, hit.pz, j * hit.nx, j * hit.nz);
          world.onBreak?.(b, -vn, this.vx, this.vz, this);
          continue;
        }
      }
      this.x += hit.nx * hit.depth;
      this.z += hit.nz * hit.depth;
      const vn = this.resolveContact(hit.px, hit.pz, hit.nx, hit.nz);
      if (vn > this.impact) { this.impact = vn; this.lastNormal = { x: hit.nx, z: hit.nz }; }
    }
  }

  // 敵車(質量 mass、速度 ev)が点 at に突っ込んできた
  ram(atX, atZ, evx, evz, mass) {
    const c = this.cfg;
    const [vpx, vpz] = this.pointVel(atX, atZ);
    const relX = evx - vpx, relZ = evz - vpz;
    const rel = Math.hypot(relX, relZ);
    if (rel < 0.01) return;
    const nx = relX / rel, nz = relZ / rel;
    const rx = atX - this.x, rz = atZ - this.z;
    const rn = rz * nx - rx * nz;
    const j = (1 + c.restitution) * rel / (1 / c.mass + rn * rn / c.inertia + 1 / mass);
    this.applyImpulse(atX, atZ, j * nx, j * nz);
    this.impact = Math.max(this.impact, rel);
  }
}

// 車体上の判定点 [前後(+前), 左右(+左)] 単位は半長・半幅
const CAR_POINTS = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
