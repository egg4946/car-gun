import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Weapon } from '../src/weapon.js';
import { Shooter, hitChance, chaseInput, Combo } from '../src/ai.js';
import { segmentHitsBox, lineOfSight, rayBoxHit, lineOfSight3D, raycastWorldBoxes } from '../src/geom.js';
import { gunmanHitboxScale } from '../src/enemies.js';
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

test('弾切れで引くと空撃ちフラグが立ち、短い間隔で繰り返さない', () => {
  const w = new Weapon();
  w.ammo = 0;
  assert.equal(w.update(DT, { handsOff: true, trigger: true }).length, 0);
  assert.equal(w.dry, true);
  w.update(DT, { handsOff: true, trigger: true });
  assert.equal(w.dry, false);
  let dryCount = 0;
  for (let t = 0; t < 0.4; t += DT) {
    w.update(DT, { handsOff: true, trigger: true });
    if (w.dry) dryCount++;
  }
  assert.ok(dryCount >= 1 && dryCount <= 2, `${dryCount} dry clicks`);
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

test('高さつき光線は箱の上を通過し、当たった面の法線を返す', () => {
  const b = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 2 };
  const hit = rayBoxHit(-5, 1, 0, 1, 0, 0, b);
  assert.ok(hit);
  assert.equal(hit.t, 4);
  assert.equal(hit.nx, -1);
  assert.equal(hit.ny, 0);
  assert.equal(rayBoxHit(-5, 3, 0, 1, 0, 0, b), null);
  const inside = rayBoxHit(0, 1, 0, 1, 0, 0, b);
  assert.equal(inside.inside, true);
  assert.equal(inside.t, 1);
});

test('3D 視線は低い物の上を通せる', () => {
  const low = { minX: 0, maxX: 10, minZ: -1, maxZ: 1, minY: 0, maxY: 0.9 };
  const tall = { ...low, maxY: 5 };
  assert.equal(lineOfSight3D([low], -5, 1.3, 0, 15, 1.3, 0), true);
  assert.equal(lineOfSight3D([low], -5, 0.5, 0, 15, 0.5, 0), false);
  assert.equal(lineOfSight3D([tall], -5, 1.3, 0, 15, 1.3, 0), false);
});

test('レイキャストは地面・建物を返し、小物は destructibles に任せる', () => {
  const b = { minX: 5, maxX: 6, minZ: -1, maxZ: 1, minY: 0, maxY: 5, surface: 'building' };
  const h = raycastWorldBoxes([b], { x: 0, y: 1.3, z: 0 }, { x: 1, y: 0, z: 0 }, 20);
  assert.equal(h.t, 5);
  assert.equal(h.surface, 'building');
  assert.equal(h.nx, -1);
  const g = raycastWorldBoxes([], { x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
  assert.equal(g.kind, 'ground');
  assert.equal(g.t, 2);
  const prop = { ...b, surface: 'hard' };
  Object.defineProperty(prop, 'prop', { value: {} });
  assert.equal(raycastWorldBoxes([prop], { x: 0, y: 1.3, z: 0 }, { x: 1, y: 0, z: 0 }, 20), null);
});

test('歩兵の当たり判定は近距離で見た目に近づき、遠距離で少し広がる', () => {
  assert.equal(gunmanHitboxScale(10), 1);
  assert.equal(gunmanHitboxScale(20), 1);
  assert.ok(gunmanHitboxScale(60) > 1.1);
  assert.equal(gunmanHitboxScale(200), 1.35);
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

test('弾が 0 でも無限弾の間は撃てる', () => {
  const w = new Weapon();
  w.ammo = 0;
  w.infinite = 1;
  assert.equal(w.update(DT, { handsOff: true, trigger: true }).length, 1);
  assert.equal(w.ammo, 0);
  assert.equal(w.dry, false);
});
