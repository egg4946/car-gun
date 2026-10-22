import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pickups, PICKUP_TYPES } from '../src/pickups.js';
import { laneInput } from '../src/ai.js';
import { Vehicle } from '../src/vehicle.js';

// ---- アイテム ----
const spotAt = (x, z) => () => ({ x, z, yaw: 0 });

test('アイテムは一定間隔で出て、同時に出る数には上限がある', () => {
  const p = new Pickups({ interval: 1, max: 3 });
  for (let t = 0; t < 10; t += 0.1) p.update(0.1, { x: 0, z: 0 }, spotAt(50, 0));
  assert.equal(p.list.length, 3);
  for (const it of p.list) assert.ok(PICKUP_TYPES.includes(it.type));
});

test('近くを通ると拾え、遠いと拾えない', () => {
  const p = new Pickups({ interval: 1, max: 1 });
  p.update(1.1, { x: 0, z: 0 }, spotAt(50, 0));
  assert.deepEqual(p.update(0.1, { x: 0, z: 0 }, () => null), []);
  const got = p.update(0.1, { x: 49, z: 1 }, () => null);
  assert.equal(got.length, 1);
  assert.equal(p.list.length, 0);
});

test('出現場所が見つからなければ出ない', () => {
  const p = new Pickups({ interval: 1, max: 3 });
  for (let t = 0; t < 5; t += 0.1) p.update(0.1, { x: 0, z: 0 }, () => null);
  assert.equal(p.list.length, 0);
});

// ---- 一般車の車線走行 ----
test('一般車は車線からずれていても戻り、車線に沿ってまっすぐ走る', () => {
  const v = new Vehicle();
  v.reset(1.5, 0, 0.15); // 車線(x=0, -z 向き)から 1.5m ずれて少し斜め
  const lane = { axis: 'z', coord: 0, dir: -1 };
  for (let t = 0; t < 6; t += 1 / 60) v.update(1 / 60, laneInput(v, lane, 40));
  assert.ok(Math.abs(v.x) < 0.4, `x ${v.x.toFixed(2)}`);
  assert.ok(Math.abs(v.yaw) < 0.05, `yaw ${v.yaw.toFixed(3)}`);
  const kmh = v.speed * 3.6;
  assert.ok(kmh > 32 && kmh < 48, `kmh ${kmh.toFixed(0)}`);
});

test('東西の車線(+x 向き)も走れる', () => {
  const v = new Vehicle();
  v.reset(0, 2, -Math.PI / 2); // +x 向き
  const lane = { axis: 'x', coord: 1, dir: 1 };
  for (let t = 0; t < 6; t += 1 / 60) v.update(1 / 60, laneInput(v, lane, 40));
  assert.ok(Math.abs(v.z - 1) < 0.4, `z ${v.z.toFixed(2)}`);
  assert.ok(v.x > 40, `x ${v.x.toFixed(1)}`);
});
