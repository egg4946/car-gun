import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Focus, SLOW } from '../src/focus.js';

const DT = 1 / 60;
const run = (f, secs, s) => { for (let t = 0; t < secs; t += DT) f.update(DT, s); };

test('最初は空で、押してもスローにならない', () => {
  const f = new Focus();
  run(f, 1, { slipDeg: 0, kmh: 50, want: true });
  assert.equal(f.gauge, 0);
  assert.equal(f.timeScale, 1);
});

test('ドリフトでゲージが溜まる(遅い・まっすぐでは溜まらない)', () => {
  const f = new Focus();
  run(f, 2, { slipDeg: 5, kmh: 80, want: false });
  run(f, 2, { slipDeg: 30, kmh: 10, want: false });
  assert.equal(f.gauge, 0);
  run(f, 2, { slipDeg: 30, kmh: 60, want: false });
  assert.ok(f.gauge > 0.4 && f.gauge <= 1, `gauge ${f.gauge}`);
});

test('撃破でも溜まり、満タンで止まる', () => {
  const f = new Focus();
  for (let i = 0; i < 20; i++) f.onKill();
  assert.equal(f.gauge, 1);
});

test('押している間は時間がゆっくりになり、ゲージが減って、空になると戻る', () => {
  const f = new Focus();
  f.gauge = 1;
  run(f, 0.5, { slipDeg: 0, kmh: 50, want: true });
  assert.ok(f.timeScale < 0.5, `scale ${f.timeScale}`);
  assert.ok(f.gauge < 1);
  run(f, 5, { slipDeg: 0, kmh: 50, want: true });
  assert.equal(f.gauge, 0);
  run(f, 0.5, { slipDeg: 0, kmh: 50, want: true });
  assert.ok(f.timeScale > 0.95, `scale ${f.timeScale}`);
  assert.ok(SLOW < 0.5);
});
