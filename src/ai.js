// 敵の思考(three.js 非依存)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 撃ってくる敵(歩兵・ドローン)の状態機械。
// idle → aim(照準レーザーで予告) → fire(連射) → cooldown → aim …
// 見えなくなったら idle に戻る。
const TRANSITIONS = {
  idle: { spotted: 'aim' },
  aim: { lost: 'idle', aimed: 'fire' },
  fire: { burstDone: 'cooldown' },
  cooldown: { rested: 'aim', lost: 'idle' },
};

export class Shooter {
  constructor({ range = 70, aimTime = 0.9, burst = 3, burstGap = 0.15, rest = [1.4, 2.4] } = {}) {
    Object.assign(this, { range, aimTime, burst, burstGap, rest });
    this.state = 'idle';
    this.timer = 0;
    this.shotsLeft = 0;
  }

  send(event) {
    const next = TRANSITIONS[this.state]?.[event];
    if (!next) return false;
    this.state = next;
    if (next === 'aim') this.timer = this.aimTime;
    if (next === 'fire') { this.shotsLeft = this.burst; this.timer = 0; }
    if (next === 'cooldown') this.timer = this.rest[0] + Math.random() * (this.rest[1] - this.rest[0]);
    return true;
  }

  // ctx: { dist, los }。起きたこと({type:'aim'|'fire'|'lost'})を返す
  update(dt, { dist, los }) {
    const out = [];
    const visible = los && dist <= this.range;
    this.timer -= dt;
    switch (this.state) {
      case 'idle':
        if (visible && this.send('spotted')) out.push({ type: 'aim' });
        break;
      case 'aim':
        if (!visible) { this.send('lost'); out.push({ type: 'lost' }); }
        else if (this.timer <= 0) this.send('aimed');
        break;
      case 'cooldown':
        if (!visible) this.send('lost');
        else if (this.timer <= 0 && this.send('rested')) out.push({ type: 'aim' });
        break;
    }
    if (this.state === 'fire') {
      while (this.timer <= 0 && this.shotsLeft > 0) {
        this.shotsLeft--;
        this.timer += this.burstGap;
        out.push({ type: 'fire' });
      }
      if (this.shotsLeft === 0) this.send('burstDone');
    }
    return out;
  }
}

// 敵の弾がプレイヤーに当たる確率。遠いほど、速く走っているほど外れる
export function hitChance({ dist, speed }) {
  const d = clamp(1 - (dist - 15) / 80, 0.3, 1);
  const s = clamp(1 - Math.abs(speed) / 32, 0.15, 1);
  return clamp(0.75 * d * s, 0.03, 0.75);
}

// 追跡車の運転。目標の少し先を狙ってハンドルを切り、詰まったらバックする。
// ai は呼び出し側が持つ状態オブジェクト
export function chaseInput(v, target, dt, ai) {
  ai.stuck ??= 0;
  ai.backing ??= 0;
  const dx = target.x - v.x, dz = target.z - v.z;
  // 車の前は (-sin, -cos)。左が正の角度
  const fwdX = -Math.sin(v.yaw), fwdZ = -Math.cos(v.yaw);
  const ang = Math.atan2(fwdX * dz - fwdZ * dx, fwdX * dx + fwdZ * dz);
  const turn = -ang; // 左に目標がある → 正
  const speed = v.speed;

  if (ai.backing > 0) {
    ai.backing -= dt;
    // 逆にハンドルを切りながら下がる
    return { up: false, down: true, left: turn < 0, right: turn > 0, handbrake: false, handsOff: false };
  }
  if (Math.abs(speed) < 1.5) ai.stuck += dt;
  else ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 1.2) { ai.stuck = 0; ai.backing = 1.0; }

  const steer = Math.abs(turn) > 0.05;
  const sharp = Math.abs(turn) > 1.2 && speed > 12;
  return {
    up: !sharp,
    down: sharp,
    left: steer && turn > 0,
    right: steer && turn < 0,
    handbrake: false,
    handsOff: false,
  };
}

// 一般車の運転。車線(axis 方向に dir 向きに進み、もう一方の座標が coord)の 12m 先を狙い、kmh を保つ
export function laneInput(v, lane, kmh) {
  const tx = lane.axis === 'x' ? v.x + lane.dir * 12 : lane.coord;
  const tz = lane.axis === 'z' ? v.z + lane.dir * 12 : lane.coord;
  const dx = tx - v.x, dz = tz - v.z;
  const fwdX = -Math.sin(v.yaw), fwdZ = -Math.cos(v.yaw);
  const turn = -Math.atan2(fwdX * dz - fwdZ * dx, fwdX * dx + fwdZ * dz); // 左が正
  const speed = v.speed * 3.6;
  return {
    up: speed < kmh - 1,
    down: speed > kmh + 4,
    left: turn > 0.03,
    right: turn < -0.03,
    handbrake: false,
    handsOff: false,
  };
}

// 連続撃破の倍率。window 秒以内に次を倒すと倍率+1(最大5)
export class Combo {
  constructor(window = 3) {
    this.window = window;
    this.multiplier = 1;
    this.timer = 0;
  }

  add(points) {
    if (this.timer > 0) this.multiplier = Math.min(5, this.multiplier + 1);
    this.timer = this.window;
    return points * this.multiplier;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) this.multiplier = 1;
  }
}
