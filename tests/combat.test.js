import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Weapon } from '../src/weapon.js';
import { Shooter, hitChance, chaseInput, Combo } from '../src/ai.js';
import { segmentHitsBox, lineOfSight } from '../src/geom.js';
import { Vehicle } from '../src/vehicle.js';
import { emptyWorld } from './helpers.js';

const DT = 1 / 60;
function tick(w, secs, state) {
  let shots = 0;
  for (let t = 0; t < secs; t += DT) shots += w.update(DT, state).length;
  return shots;
}

// ---- 銃 ----
test('ハンドルを握っている間は撃てない', () => {
  const w = new Weapon();
  assert.equal(tick(w, 1, { handsOff: false, trigger: true }), 0);
});

test('手放しで引き金を引くと 0.1 秒に 1 発、弾を消費する', () => {
  const w = new Weapon();
  const shots = tick(w, 1, { handsOff: true, trigger: true });
  assert.ok(shots >= 9 && shots <= 11, `${shots} shots`);
  assert.equal(w.ammo, w.magSize - shots);
});

test('弾切れになると撃てない', () => {
  const w = new Weapon();
  tick(w, 5, { handsOff: true, trigger: true });
  assert.equal(w.ammo, 0);
  assert.equal(tick(w, 1, { handsOff: true, trigger: true }), 0);
});

test('リロードはハンドルを握っている間だけ進み、約1.5秒で満タン', () => {
  const w = new Weapon();
  tick(w, 5, { handsOff: true, trigger: true });
  tick(w, 3, { handsOff: true, trigger: false });
  assert.equal(w.ammo, 0, '手放し中に回復した');
  tick(w, 1.6, { handsOff: false, trigger: false });
  assert.equal(w.ammo, w.magSize);
});

test('速く走るほど・車が回っているほど弾がばらける', () => {
  const w = new Weapon();
  const still = w.spread(0, 0);
  assert.ok(w.spread(30, 0) > still * 2);
  assert.ok(w.spread(10, 1.5) > w.spread(10, 0) * 1.5);
});

// ---- 視線 ----
test('線分と箱の交差判定', () => {
  const b = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  assert.equal(segmentHitsBox(-5, 0, 5, 0, b), true);
  assert.equal(segmentHitsBox(-5, 3, 5, 3, b), false);
  assert.equal(segmentHitsBox(-5, 0, -2, 0, b), false);
  assert.equal(lineOfSight([b], -5, 0, 5, 0), false);
  assert.equal(lineOfSight([b], -5, 3, 5, 3), true);
});

// ---- 撃ってくる敵 ----
function runShooter(s, secs, ctx) {
  const events = [];
  for (let t = 0; t < secs; t += DT) for (const e of s.update(DT, typeof ctx === 'function' ? ctx(t) : ctx)) events.push({ t, ...e });
  return events;
}
const seen = { dist: 30, los: true };

test('見えていなければ撃たない', () => {
  const s = new Shooter();
  assert.equal(runShooter(s, 5, { dist: 30, los: false }).filter(e => e.type === 'fire').length, 0);
});

test('射程外なら撃たない', () => {
  const s = new Shooter({ range: 50 });
  assert.equal(runShooter(s, 5, { dist: 80, los: true }).filter(e => e.type === 'fire').length, 0);
});

test('撃つ前に 0.8 秒以上の予告(照準レーザー)がある', () => {
  const s = new Shooter();
  const ev = runShooter(s, 4, seen);
  const aim = ev.find(e => e.type === 'aim');
  const fire = ev.find(e => e.type === 'fire');
  assert.ok(aim && fire, 'no aim/fire');
  assert.ok(fire.t - aim.t >= 0.8, `telegraph ${(fire.t - aim.t).toFixed(2)}s`);
});

test('照準中に見えなくなったら撃たずにやめる', () => {
  const s = new Shooter();
  const ev = runShooter(s, 3, t => ({ dist: 30, los: t < 0.6 }));
  assert.equal(ev.filter(e => e.type === 'fire').length, 0);
});

test('3 連射のあと休む', () => {
  const s = new Shooter();
  const ev = runShooter(s, 2.6, seen).filter(e => e.type === 'fire');
  assert.equal(ev.length, 3);
});

test('止まっている車には当たりやすく、100km/h では当たりにくい', () => {
  assert.ok(hitChance({ dist: 20, speed: 0 }) > 0.6);
  assert.ok(hitChance({ dist: 20, speed: 0 }) <= 0.75, '止まっていても確実には当たらない');
  assert.ok(hitChance({ dist: 20, speed: 28 }) < 0.35);
  assert.ok(hitChance({ dist: 60, speed: 0 }) < hitChance({ dist: 20, speed: 0 }));
});

// ---- 追ってくる車 ----
test('追跡車は止まっている標的に 8 秒以内にぶつかる', () => {
  const v = new Vehicle();
  v.reset(0, 0, 0);
  const target = { x: 60, z: -50 };
  const ai = {};
  let d = Infinity; // 体当たりしたら爆発するので、一番近づいた距離を見る
  for (let t = 0; t < 8; t += DT) {
    v.update(DT, chaseInput(v, target, DT, ai));
    d = Math.min(d, Math.hypot(v.x - target.x, v.z - target.z));
  }
  assert.ok(d < 4, `closest ${d.toFixed(1)}`);
});

test('壁に詰まった追跡車はバックして抜け出そうとする', () => {
  const w = emptyWorld({ minX: -10, maxX: 10, minZ: -6, maxZ: -3 });
  const v = new Vehicle();
  v.reset(0, 0, 0);
  const target = { x: 0, z: -60 };
  const ai = {};
  let reversed = false;
  for (let t = 0; t < 6; t += DT) {
    const k = chaseInput(v, target, DT, ai);
    if (k.down && !k.up) reversed = true;
    v.update(DT, k, w);
  }
  assert.ok(reversed, 'never reversed');
});

// ---- コンボ ----
test('3 秒以内に倒し続けると倍率が上がり、途切れると 1 に戻る', () => {
  const c = new Combo();
  assert.equal(c.add(100), 100);
  c.update(1);
  assert.equal(c.add(100), 200);
  c.update(1);
  assert.equal(c.add(100), 300);
  c.update(3.5);
  assert.equal(c.multiplier, 1);
  assert.equal(c.add(100), 100);
});

test('無限弾の間は撃っても弾が減らず、時間が切れると元に戻る', () => {
  const w = new Weapon();
  w.infinite = 2;
  tick(w, 1.5, { handsOff: true, trigger: true });
  assert.equal(w.ammo, w.magSize);
  tick(w, 1.5, { handsOff: true, trigger: true });
  assert.ok(w.ammo < w.magSize);
});
