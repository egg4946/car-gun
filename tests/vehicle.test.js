import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, keys, kmh, deg, carAt, emptyWorld, run, insideBox } from './helpers.js';
import { Vehicle } from '../src/vehicle.js';

// ---- 既存の挙動(回帰) ----
test('0-100km/h は 4.5〜8秒', () => {
  const v = new Vehicle();
  let t = 0;
  while (kmh(v.speed) < 100 && t < 15) { v.update(DT, keys({ up: true })); t += DT; }
  assert.ok(t > 4.5 && t < 8, `0-100: ${t.toFixed(2)}s`);
});

test('100km/h からのフルブレーキは 45m 以内で止まる', () => {
  const v = carAt(100);
  let d = 0;
  for (let i = 0; i < 600 && v.speed > 0.1; i++) { const z = v.z; v.update(DT, keys({ down: true })); d += Math.abs(v.z - z); }
  assert.ok(d < 45, `${d.toFixed(1)}m`);
});

test('80km/h でフルロックしてもスピンしない(弱アンダー)', () => {
  const v = carAt(80);
  let max = 0;
  run(v, 4, keys({ left: true }), null, v => { max = Math.max(max, Math.abs(v.bodySlip)); });
  assert.ok(deg(max) < 25, `slip ${deg(max).toFixed(1)}°`);
});

test('止まっていると動かない', () => {
  const v = new Vehicle();
  run(v, 2, keys());
  assert.equal(Math.hypot(v.x, v.z - 15), 0);
});

test('バックは 22km/h まで', () => {
  const v = new Vehicle();
  run(v, 5, keys({ down: true }));
  assert.ok(v.reverse && kmh(v.speed) > -22, `${kmh(v.speed).toFixed(1)}`);
});

test('ランダム入力で NaN にならない', () => {
  const v = new Vehicle();
  for (let i = 0; i < 4000; i++) {
    v.update(0.05, keys({ up: Math.random() < 0.7, down: Math.random() < 0.1, left: Math.random() < 0.4, right: Math.random() < 0.4, handbrake: Math.random() < 0.1, handsOff: Math.random() < 0.2 }));
    assert.ok(Number.isFinite(v.x + v.z + v.yawRate + v.vx + v.vz));
  }
});

// ---- ドリフト ----
// キー操作だけの簡単なドライバー: サイドで左に振り出し、アクセルとカウンターで target° 前後を保つ。
// 人と同じく角度の増え方を見て早めにカウンターを当てる。
function drifter(target = 30) {
  let prev = 0;
  return (v, t) => {
    if (t < 0.6) return keys({ left: true, up: true, handbrake: t > 0.25 });
    const a = -deg(v.bodySlip); // 左ドリフトで正
    const pred = a + (a - prev) / DT * 0.25;
    prev = a;
    if (pred > target + 10) return keys({ right: true });
    if (pred > target) return keys({ right: true, up: true });
    if (pred > target - 10) return keys({ up: true });
    return keys({ left: true, up: true });
  };
}

test('アクセルとカウンターで 30° 前後のドリフトを 3 秒以上保てる', () => {
  const v = carAt(60);
  const slips = [];
  let spun = false;
  run(v, 4.5, drifter(30), null, (v, t) => {
    if (Math.abs(deg(v.bodySlip)) > 90) spun = true;
    if (t > 1.5) slips.push(Math.abs(deg(v.bodySlip)));
  });
  const avg = slips.reduce((a, b) => a + b, 0) / slips.length;
  const inRange = slips.filter(s => s > 15 && s < 50).length / slips.length;
  assert.ok(!spun, 'spun out');
  assert.ok(avg > 18 && avg < 45, `avg slip ${avg.toFixed(1)}°`);
  assert.ok(inRange > 0.8, `in range ${(inRange * 100).toFixed(0)}%`);
  assert.ok(kmh(Math.hypot(v.vx, v.vz)) > 25, `too slow: ${kmh(Math.hypot(v.vx, v.vz)).toFixed(0)}km/h`);
});

test('ドリフト中にキーを離すと 2 秒以内にグリップ走行へ戻る', () => {
  const v = carAt(60);
  run(v, 2.5, drifter(30));
  run(v, 2, keys());
  assert.ok(Math.abs(deg(v.bodySlip)) < 6, `slip ${deg(v.bodySlip).toFixed(1)}°`);
});

// ---- 衝突 ----
const wallAhead = () => ({ minX: -20, maxX: 20, minZ: -40, maxZ: -20 }); // z=-20 に壁

test('壁の中に中心が入った円は外に押し出される', () => {
  const w = emptyWorld({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 });
  const p = { x: 0.5, z: 0.2 };
  w.collide(p, 1);
  assert.ok(Math.abs(p.x) >= 5.99 || Math.abs(p.z) >= 5.99, `still inside: ${p.x},${p.z}`);
});

test('180km/h・20fps で正面衝突してもビルを突き抜けない', () => {
  const b = wallAhead();
  const w = emptyWorld(b);
  const v = carAt(180);
  let minZ = Infinity;
  run(v, 2, keys({ up: true }), w, v => { minZ = Math.min(minZ, v.z); assert.ok(!insideBox(v, b), 'center inside wall'); }, 0.05);
  assert.ok(minZ > b.maxZ + 1.5, `nose penetrated: center reached z=${minZ.toFixed(2)}`);
});

test('正面衝突で速度の大半を失い、少し跳ね返る', () => {
  const w = emptyWorld(wallAhead());
  const v = carAt(80, 0, 0);
  let impact = 0;
  run(v, 1, keys(), w, v => { impact = Math.max(impact, v.impact); });
  assert.ok(impact > 15, `impact ${impact.toFixed(1)}`);
  assert.ok(v.speed < 2 && v.speed > -8, `speed after ${v.speed.toFixed(2)}`);
});

test('浅い角度でこすると速度を保ったまま壁沿いに向きが変わる', () => {
  const w = emptyWorld({ minX: -100, maxX: -3, minZ: -200, maxZ: 50 }); // 左側に壁
  const yaw = 0.25; // 少し左(壁側)を向いて走る
  const v = carAt(100, 0, 0, yaw);
  run(v, 1.5, keys(), w);
  const s = kmh(Math.hypot(v.vx, v.vz));
  assert.ok(s > 65, `kept speed ${s.toFixed(0)}`);
  assert.ok(Math.abs(v.yaw) < 0.15, `yaw ${v.yaw.toFixed(2)}`);
  assert.ok(v.x > -3.1, 'went into wall');
});

test('左前の角だけが当たると左に回される(yaw が増える)', () => {
  const w = emptyWorld({ minX: -10, maxX: -0.4, minZ: -40, maxZ: -20 }); // 左半分だけ塞ぐ
  const v = carAt(50, 0, 0);
  let maxYaw = 0;
  run(v, 2, keys(), w, v => { maxYaw = Math.max(maxYaw, v.yawRate); }); // 壁まで約18m
  assert.ok(maxYaw > 0.5, `yawRate ${maxYaw.toFixed(2)}`);
});

test('右後ろから体当たりされると左に押され、鼻先は右へ回る(乱数なし)', () => {
  const results = [0, 1].map(() => {
    const v = carAt(0);
    // 敵は右(+x)後方から左向きに 20m/s で当たる
    v.ram(v.x + 1, v.z + 1.5, -20, 0, 900);
    return { vx: v.vx, yawRate: v.yawRate };
  });
  assert.ok(results[0].vx < -3, `vx ${results[0].vx.toFixed(2)}`);
  assert.ok(results[0].yawRate < -0.3, `yawRate ${results[0].yawRate.toFixed(2)}`);
  assert.deepEqual(results[0], results[1]);
});

test('ニトロ(boost)中は加速が速い', () => {
  const a = new Vehicle(), b = new Vehicle();
  b.boost = 2;
  run(a, 3, keys({ up: true }));
  run(b, 3, keys({ up: true }));
  assert.ok(b.speed > a.speed * 1.15, `${kmh(a.speed).toFixed(0)} vs ${kmh(b.speed).toFixed(0)}`);
});
