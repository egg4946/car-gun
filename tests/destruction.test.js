import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PROPS, PropState, rayBox } from '../src/props.js';
import { World } from '../src/world.js';
import { carAt, emptyWorld, keys, run, kmh } from './helpers.js';

// ---- 小物の状態 ----
test('ドラム缶は 2 発で爆発する', () => {
  const p = new PropState('barrel');
  assert.deepEqual(p.hit(1), []);
  assert.deepEqual(p.hit(1).map(e => e.type), ['break', 'explode']);
  assert.equal(p.state, 'broken');
  assert.deepEqual(p.hit(1), [], '壊れた後は何も起きない');
});

test('駐車車両は撃つと燃えだし、しばらくして爆発する', () => {
  const p = new PropState('parked');
  let ev = [];
  for (let i = 0; i < PROPS.parked.hp; i++) ev.push(...p.hit(1));
  assert.deepEqual(ev.map(e => e.type), ['ignite']);
  assert.equal(p.state, 'burning');
  ev = [];
  for (let t = 0; t < PROPS.parked.explode.fuse + 0.1; t += 0.1) ev.push(...p.update(0.1));
  assert.deepEqual(ev.map(e => e.type), ['break', 'explode']);
});

test('撃っても壊れない物(木)は弾で何も起きない', () => {
  const p = new PropState('tree');
  for (let i = 0; i < 20; i++) assert.deepEqual(p.hit(1), []);
  assert.equal(p.state, 'intact');
});

test('爆風の大ダメージなら一度で壊れる', () => {
  const p = new PropState('vending');
  assert.deepEqual(p.hit(99).map(e => e.type), ['break']);
});

test('光線と箱(高さつき)の交差距離', () => {
  const b = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 2 };
  assert.equal(rayBox(-5, 1, 0, 1, 0, 0, b), 4);
  assert.equal(rayBox(-5, 3, 0, 1, 0, 0, b), null, '上を通過');
  assert.equal(rayBox(5, 1, 0, 1, 0, 0, b), null, '後ろ向き');
});

// ---- 車でなぎ倒す ----
function lamp(x, z) {
  return { minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, minY: 0, maxY: 7, breakSpeed: PROPS.lamp.breakSpeed, mass: PROPS.lamp.mass };
}

test('60km/h で街灯にぶつかるとなぎ倒し、速度はほとんど落ちない', () => {
  const b = lamp(0, -20);
  const w = emptyWorld(b);
  const broken = [];
  w.onBreak = (box, speed) => broken.push({ box, speed });
  const v = carAt(60);
  run(v, 2, keys(), w);
  assert.equal(broken.length, 1);
  assert.ok(b.broken);
  assert.ok(kmh(v.speed) > 45, `speed ${kmh(v.speed).toFixed(0)}`);
  assert.ok(v.z < -25, 'passed through');
});

test('ゆっくり当たると街灯は倒れず、車が止まる', () => {
  const b = lamp(0, -5);
  const w = emptyWorld(b);
  const broken = [];
  w.onBreak = box => broken.push(box);
  const v = carAt(6);
  run(v, 3, keys(), w);
  assert.equal(broken.length, 0);
  assert.ok(v.z > -5, 'went through');
});

test('壊せない箱(建物・駐車車両)は今までどおり止める', () => {
  const w = emptyWorld({ minX: -1, maxX: 1, minZ: -22, maxZ: -20 });
  w.onBreak = () => assert.fail('should not break');
  const v = carAt(60);
  run(v, 2, keys(), w);
  assert.ok(v.z > -20);
});

// ---- 街に壊せる小物がある ----
test('街の小物は壊せる箱として登録され、壊すと箱が消え、戻っても壊れたまま', () => {
  const w = new World(new THREE.Scene());
  w.update(0, 0);
  const props = w.boxes.filter(b => b.prop);
  assert.ok(props.length > 50, `props ${props.length}`);
  const kinds = new Set(props.map(b => b.prop.kind));
  for (const k of ['lamp', 'signal', 'tree']) assert.ok(kinds.has(k), `no ${k}`);
  assert.ok(props.every(b => b.maxY > b.minY));
  const target = props.find(b => b.prop.kind === 'lamp');
  const key = target.prop.key;
  w.breakProp(target.prop);
  assert.ok(!w.boxes.includes(target));
  w.update(3000, 3000);
  w.update(0, 0);
  const again = w.boxes.find(b => b.prop && b.prop.key === key);
  assert.equal(again, undefined, '戻ったら復活していた');
});

test('ドラム缶・消火栓・駐車車両・自販機が置かれる', () => {
  const w = new World(new THREE.Scene());
  const kinds = new Set();
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    w.update(i * 400, j * 400);
    for (const b of w.boxes) if (b.prop) kinds.add(b.prop.kind);
  }
  for (const k of ['barrel', 'hydrant', 'parked', 'vending']) assert.ok(kinds.has(k), `no ${k}`);
});

test('視線判定用の箱(losBoxes)に小物は含まれない', () => {
  const w = new World(new THREE.Scene());
  w.update(0, 0);
  assert.ok(w.losBoxes.length > 0);
  assert.ok(w.losBoxes.every(b => !b.prop));
});

test('細い柱の角が車の中心線ちょうどに来ても NaN にならない', () => {
  // 角が x=0(車の中心線上)にある柱。車は止まった状態で柱に重なって置かれる
  const w = emptyWorld({ minX: 0, maxX: 0.4, minZ: -1.6, maxZ: -1.2, minY: 0, maxY: 6, breakSpeed: 5, mass: 250 });
  const v = carAt(0);
  run(v, 0.5, keys(), w);
  assert.ok(Number.isFinite(v.x + v.z + v.vx + v.vz + v.yawRate), `x=${v.x} vx=${v.vx}`);
});
