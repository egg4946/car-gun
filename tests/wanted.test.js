import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wanted, HEAT } from '../src/wanted.js';

test('最初は★0', () => {
  assert.equal(new Wanted().level, 0);
});

test('撃破や破壊で★が上がり、上がった瞬間だけ知らせる', () => {
  const w = new Wanted();
  const ups = [];
  for (let i = 0; i < 30; i++) { const r = w.add(HEAT.gunman); if (r.levelUp) ups.push(r.level); }
  assert.deepEqual(ups, [1, 2, 3, 4, 5]);
  assert.equal(w.level, 5);
});

test('★は 5 が上限', () => {
  const w = new Wanted();
  w.add(1000);
  assert.equal(w.level, 5);
});

test('しばらく何もしないと★が下がる', () => {
  const w = new Wanted();
  w.add(HEAT.chaser * 3);
  const lv = w.level;
  assert.ok(lv >= 2);
  for (let t = 0; t < 5; t += 0.1) w.update(0.1);
  assert.equal(w.level, lv, '5秒では下がらない');
  for (let t = 0; t < 30; t += 0.1) w.update(0.1);
  assert.ok(w.level < lv, `level ${w.level}`);
});

test('暴れ続けている間は下がらない', () => {
  const w = new Wanted();
  w.add(HEAT.chaser * 3);
  const lv = w.level;
  for (let t = 0; t < 30; t += 0.1) { w.update(0.1); if (Math.round(t * 10) % 40 === 0) w.add(HEAT.prop); }
  assert.ok(w.level >= lv);
});
