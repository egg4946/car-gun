import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeKill, Stats, titleFor } from '../src/style.js';

const base = { how: 'shot', slipDeg: 0, handsOffTime: 0.5, aimDeg: 10, kmh: 40, dist: 30 };

test('普通の撃破はボーナスなし', () => {
  const r = judgeKill(base);
  assert.equal(r.mult, 1);
  assert.deepEqual(r.tags, []);
});

test('ドリフト中の撃破はドリフトキル', () => {
  const r = judgeKill({ ...base, slipDeg: -28 });
  assert.ok(r.tags.includes('ドリフトキル'));
  assert.ok(r.mult > 1);
});

test('後ろを向いて撃つとノールック、手放し3秒以上・高速・遠距離もボーナス', () => {
  const r = judgeKill({ ...base, aimDeg: 150, handsOffTime: 3.5, kmh: 110, dist: 70 });
  for (const t of ['ノールック', '手放し3秒', '高速キル', 'ロングショット']) assert.ok(r.tags.includes(t), t);
  assert.ok(r.mult >= 2);
});

test('巻き込みはボーナス、轢きは専用の点があるので倍率なし', () => {
  assert.ok(judgeKill({ ...base, how: 'blast' }).tags.includes('巻き込み'));
  assert.equal(judgeKill({ ...base, how: 'runover', slipDeg: 30 }).mult, 1);
});

test('統計: 続けたドリフトと手放しの最長時間を記録する', () => {
  const s = new Stats();
  for (let i = 0; i < 120; i++) s.update(1 / 60, { slipDeg: 25, handsOff: i < 60, kmh: 80 });
  for (let i = 0; i < 30; i++) s.update(1 / 60, { slipDeg: 0, handsOff: false, kmh: 80 });
  for (let i = 0; i < 60; i++) s.update(1 / 60, { slipDeg: 25, handsOff: true, kmh: 120 });
  assert.ok(Math.abs(s.longestDrift - 2) < 0.05, `drift ${s.longestDrift}`);
  assert.ok(Math.abs(s.longestHandsOff - 1) < 0.05, `handsOff ${s.longestHandsOff}`);
  assert.equal(Math.round(s.maxKmh), 120);
});

test('統計: 撃破の種類とトリックを数える', () => {
  const s = new Stats();
  s.kill('runover', []);
  s.kill('shot', ['ノールック']);
  s.kill('blast', ['巻き込み']);
  assert.equal(s.kills, 3);
  assert.equal(s.byHow.runover, 1);
  assert.equal(s.tricks['ノールック'], 1);
});

test('称号: いちばん目立った遊び方で決まる', () => {
  const s = new Stats();
  assert.equal(titleFor(s), '安全運転');
  s.kill('shot', []);
  assert.equal(titleFor(s), 'ドライブバイ見習い');
  s.destroyed = 45;
  assert.equal(titleFor(s), '街の破壊神');
  const h = new Stats();
  h.kill('shot', []);
  h.longestHandsOff = 9;
  assert.equal(titleFor(h), 'ハンドルいらない人');
});
