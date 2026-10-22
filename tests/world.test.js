import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, START } from '../src/world.js';

// テスト用の決まった乱数
function seeded(s = 1) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const inAny = (w, x, z) => w.boxes.some(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
const world = (x = 0, z = 0) => { const w = new World(new THREE.Scene()); w.update(x, z); return w; };
const blockCenter = v => Math.round(v / 60) * 60;
const snapshot = (w, cx, cz, r) => w.boxes
  .filter(b => Math.abs(b.minX - cx) < r && Math.abs(b.minZ - cz) < r)
  .map(b => [b.minX, b.maxX, b.minZ, b.maxZ].map(v => v.toFixed(3)).join(','))
  .sort();

test('isRoad: 道路は x,z = 30+60k の幅16m、歩道は道路ではない', () => {
  const w = world();
  assert.ok(w.isRoad(30, 0));
  assert.ok(w.isRoad(23, 10));
  assert.ok(w.isRoad(-30, 100));
  assert.ok(w.isRoad(5, -90));
  assert.ok(!w.isRoad(0, 0));
  assert.ok(!w.isRoad(21, 0));
  assert.ok(!w.isRoad(-21, 125));
});

test('START は道路の車線上で、車体の四隅が箱にも歩道にもかからない', () => {
  const w = world(START.x, START.z);
  const c = Math.cos(START.yaw), s = Math.sin(START.yaw);
  for (const [lx, lz] of [[-0.9, -2.15], [0.9, -2.15], [-0.9, 2.15], [0.9, 2.15], [0, 0]]) {
    const x = START.x + lx * c + lz * s, z = START.z - lx * s + lz * c;
    assert.ok(w.isRoad(x, z), `off road at ${x},${z}`);
    assert.ok(!inAny(w, x, z), `inside box at ${x},${z}`);
  }
  // 前方30mも道路(すぐ壁にぶつからない)
  for (let d = 0; d < 30; d += 1) {
    const x = START.x - Math.sin(START.yaw) * d, z = START.z - Math.cos(START.yaw) * d;
    assert.ok(w.isRoad(x, z) && !inAny(w, x, z), `blocked ${d}m ahead`);
  }
});

test('どの箱も道路にはみ出さない', () => {
  const w = world(13, -7);
  assert.ok(w.boxes.length > 100, `boxes ${w.boxes.length}`);
  for (const b of w.boxes) {
    const cx = blockCenter((b.minX + b.maxX) / 2), cz = blockCenter((b.minZ + b.maxZ) / 2);
    assert.ok(b.minX >= cx - 22 && b.maxX <= cx + 22 && b.minZ >= cz - 22 && b.maxZ <= cz + 22,
      `box ${JSON.stringify(b)} leaves block ${cx},${cz}`);
  }
  const rand = seeded(3);
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    const x = (rand() - 0.5) * 360, z = (rand() - 0.5) * 360;
    if (!w.isRoad(x, z)) continue;
    n++;
    assert.ok(!inAny(w, x, z), `box on road at ${x},${z}`);
  }
  assert.ok(n > 3000);
});

test('sidewalkSpots は歩道上・箱の外・距離の範囲内', () => {
  const w = world(100, 40);
  const spots = w.sidewalkSpots(100, 40, 20, 80, 30, seeded(5));
  assert.ok(spots.length >= 25, `only ${spots.length}`);
  for (const p of spots) {
    const d = Math.hypot(p.x - 100, p.z - 40);
    assert.ok(d >= 20 && d <= 80, `dist ${d}`);
    assert.ok(!w.isRoad(p.x, p.z), `on road ${p.x},${p.z}`);
    assert.ok(!inAny(w, p.x, p.z), `in box ${p.x},${p.z}`);
    assert.ok(Math.abs(p.x - blockCenter(p.x)) <= 22 && Math.abs(p.z - blockCenter(p.z)) <= 22);
  }
});

test('roadSpot は車線上・距離の範囲内・向きは車線方向(左側通行)', () => {
  const w = world();
  const rand = seeded(7);
  for (let i = 0; i < 100; i++) {
    const p = w.roadSpot(-20, 35, 40, 120, rand);
    assert.ok(p, 'no spot');
    const d = Math.hypot(p.x + 20, p.z - 35);
    assert.ok(d >= 40 && d <= 120, `dist ${d}`);
    assert.ok(w.isRoad(p.x, p.z) && !inAny(w, p.x, p.z));
    // 前後2.5mも道路
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    assert.ok(w.isRoad(p.x + fx * 2.5, p.z + fz * 2.5) && w.isRoad(p.x - fx * 2.5, p.z - fz * 2.5));
    // 進行方向の左側は道路の中心より左(日本は左側通行): 右を向いたベクトルで中心線側にある
    const rx = -fz, rz = fx; // 右向き
    const along = Math.abs(fx) > 0.5 ? 'x' : 'z';
    const center = along === 'z' ? Math.round((p.x - 30) / 60) * 60 + 30 : Math.round((p.z - 30) / 60) * 60 + 30;
    const toCenter = along === 'z' ? (center - p.x) * rx : (center - p.z) * rz;
    assert.ok(toCenter > 0, `wrong side yaw=${p.yaw} at ${p.x},${p.z}`);
  }
});

test('遠くへ行くと読み込みが外れ、戻ると同じ街になる', () => {
  const w = world();
  const first = snapshot(w, 0, 0, 100);
  const n0 = w.boxes.length;
  w.update(3000, -3000);
  assert.ok(w.boxes.length < n0 * 2, `boxes grew ${n0} -> ${w.boxes.length}`);
  assert.equal(snapshot(w, 0, 0, 100).length, 0);
  w.update(0, 0);
  assert.deepEqual(snapshot(w, 0, 0, 100), first);
  // 別インスタンスでも同じ
  assert.deepEqual(snapshot(world(), 0, 0, 100), first);
});

test('update は外から足した箱を消さない', () => {
  const w = new World(new THREE.Scene());
  const mine = { minX: 1, maxX: 2, minZ: 1, maxZ: 2 };
  w.boxes.push(mine);
  w.update(0, 0);
  w.update(5000, 5000);
  assert.ok(w.boxes.includes(mine));
});
