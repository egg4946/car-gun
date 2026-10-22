import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Forest, START } from '../src/forest.js';
import { Vehicle } from '../src/vehicle.js';

function seeded(s = 1) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const forest = (t, x = START.x, z = START.z) => {
  const f = new Forest(new THREE.Scene());
  t.after(() => f.dispose());
  f.update(x, z);
  return f;
};
const blocked = (f, x, z, r = 0) => f.boxes.some(b =>
  x >= b.minX - r && x <= b.maxX + r && z >= b.minZ - r && z <= b.maxZ + r);
const snapshot = f => [...f.cells].map(([key, cell]) => ({ key, boxes: cell.boxes,
  instances: cell.meshes.filter(m => m.isInstancedMesh).map(m => Array.from(m.instanceMatrix.array)) }));
// 中心線の実装ではなく、路面判定の左右の境界から車線中心を測る。
function roadCenter(f, z) {
  let first, last;
  for (let x = -40; x <= 40; x += 0.125) {
    if (f.isRoad(x, z)) { first ??= x; last = x; }
  }
  assert.notEqual(first, undefined, `no road at z=${z}`);
  assert.ok(last - first >= 11.75 && last - first <= 12);
  return (first + last) / 2;
}

test('林道は幅12mで無限に蛇行し、草地と区別される', t => {
  const f = forest(t);
  assert.ok(f.isRoad(-6, 0) && f.isRoad(6, 0));
  assert.ok(!f.isRoad(-6.01, 0) && !f.isRoad(6.01, 0));
  const centers = [-100000, -1000, -200, -64, 0, 64, 200, 1000, 100000].map(z => roadCenter(f, z));
  assert.ok(Math.max(...centers) - Math.min(...centers) > 20);
});

test('START の車体と前方30mの走行帯が安全', t => {
  const f = forest(t);
  const c = Math.cos(START.yaw), s = Math.sin(START.yaw);
  for (let d = -2.15; d <= 32.15; d += 0.25) {
    for (const dx of [-0.9, 0, 0.9]) {
      const x = START.x + dx * c - d * s, z = START.z - dx * s - d * c;
      assert.ok(f.isRoad(x, z));
      assert.ok(!blocked(f, x, z));
    }
  }
  const v = new Vehicle();
  v.reset(START.x, START.z, START.yaw);
  const distance = () => -(v.x - START.x) * s - (v.z - START.z) * c;
  for (let i = 0; i < 600 && distance() <= 30; i++) {
    v.update(1 / 60, { up: true }, f);
    assert.equal(v.impact, 0);
  }
  assert.ok(distance() > 30, `did not drive forward: ${distance()}`);
});

test('木・岩・倒木の箱全体が路面と余白を塞がない', t => {
  const f = forest(t);
  for (const [x, z] of [[0, 0], [0, 180], [-10, -400], [0, 2000]]) {
    f.update(x, z);
    for (const b of f.boxes) {
      for (let zz = b.minZ; zz <= b.maxZ + 1e-9; zz += (b.maxZ - b.minZ) / 4) {
        for (const xx of [b.minX, (b.minX + b.maxX) / 2, b.maxX]) {
          assert.ok(!f.isRoad(xx, zz), `obstacle on road ${xx},${zz}`);
          assert.ok(!f.isRoad(xx - 1.5, zz) && !f.isRoad(xx + 1.5, zz));
        }
      }
    }
  }
});

test('roadSpot は左側車線・指定距離・前後2.5mの路面・箱の外', t => {
  const f = forest(t), rand = seeded(7);
  for (const z of [-300, 0, 300, 1000]) {
    const px = roadCenter(f, z) - 3;
    f.update(px, z);
    for (let i = 0; i < 40; i++) {
      const p = f.roadSpot(px, z, 70, 130, rand);
      assert.ok(p, `no spot near ${px},${z}`);
      const d = Math.hypot(p.x - px, p.z - z);
      assert.ok(d >= 70 && d <= 130);
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const n of [-2.5, 0, 2.5]) {
        assert.ok(f.isRoad(p.x + fx * n, p.z + fz * n));
        assert.ok(!blocked(f, p.x + fx * n, p.z + fz * n, 1.2));
      }
      assert.ok((roadCenter(f, p.z) - p.x) * -fz > 0, 'wrong traffic side');
    }
  }
});

test('sidewalkSpots は路肩の空き地・指定距離・木から0.7m以上離れる', t => {
  const f = forest(t), rand = seeded(5);
  for (const z of [-300, 0, 300]) {
    const px = roadCenter(f, z);
    f.update(px, z);
    const spots = f.sidewalkSpots(px, z, 45, 110, 30, rand);
    assert.equal(spots.length, 30);
    for (const p of spots) {
      const d = Math.hypot(p.x - px, p.z - z);
      assert.ok(d >= 45 && d <= 110);
      assert.ok(!f.isRoad(p.x, p.z));
      // 正方形で検査すると円の角を過剰に除外するので、円と箱の最短距離を使う。
      for (const b of f.boxes) {
        const dx = p.x - Math.max(b.minX, Math.min(p.x, b.maxX));
        const dz = p.z - Math.max(b.minZ, Math.min(p.z, b.maxZ));
        assert.ok(Math.hypot(dx, dz) > 0.7);
      }
    }
  }
});

test('未読込・距離条件を満たせない場所・外から塞がれた道には敵を出さない', t => {
  const f = forest(t);
  assert.equal(f.roadSpot(5000, 5000, 10, 100, seeded()), null);
  assert.deepEqual(f.sidewalkSpots(5000, 5000, 10, 100, 6, seeded()), []);
  assert.equal(f.roadSpot(1000, 0, 10, 20, seeded()), null);
  f.boxes.push({ minX: -50, maxX: 50, minZ: -200, maxZ: 200 });
  assert.equal(f.roadSpot(0, 0, 70, 130, seeded()), null);
  assert.deepEqual(f.sidewalkSpots(0, 0, 45, 110, 6, seeded()), []);
});

test('遠方セルの描画・衝突・GPU資源を破棄し、往復後の配置も同じ', t => {
  const f = forest(t), first = snapshot(f);
  const oldCells = [...f.cells.values()], oldMeshes = oldCells.flatMap(c => c.meshes);
  const released = new Set();
  for (const m of oldMeshes) {
    const resource = m.isInstancedMesh ? m : m.geometry !== f.groundGeometry ? m.geometry : null;
    resource?.addEventListener('dispose', () => released.add(resource));
  }
  const boxes = f.boxes;
  f.update(5000, -5000);
  assert.equal(f.cells.size, 49);
  assert.equal(f.boxes, boxes);
  for (const c of oldCells) for (const b of c.boxes) assert.ok(!f.boxes.includes(b));
  for (const m of oldMeshes) {
    assert.ok(!f.scene.children.includes(m));
    if (m.isInstancedMesh) assert.ok(released.has(m));
    else if (m.geometry !== f.groundGeometry) assert.ok(released.has(m.geometry));
  }
  f.update(START.x, START.z);
  assert.deepEqual(snapshot(f), first);
  assert.deepEqual(snapshot(forest(t)), first);
});

test('セル境界を繰り返し越えてもセル数と描画資源は増え続けない', t => {
  const f = forest(t);
  for (let n = 1; n <= 12; n++) {
    f.update(n * 64, -n * 64);
    assert.equal(f.cells.size, 49);
    assert.ok(f.scene.children.length <= 49 * 5);
  }
});

test('外部の箱・描画物をupdateとdisposeで消さず、所有資源は解放する', t => {
  const f = forest(t);
  const b = { minX: 1, maxX: 2, minZ: 1, maxZ: 2 }, mesh = new THREE.Object3D();
  f.boxes.push(b);
  f.scene.add(mesh);
  f.update(5000, 5000);
  assert.ok(f.boxes.includes(b));
  let released = 0;
  f.treeGeometry.addEventListener('dispose', () => released++);
  f.dispose();
  assert.equal(released, 1);
  assert.deepEqual(f.boxes, [b]);
  assert.deepEqual(f.scene.children, [mesh]);
});

test('幹の箱で車両が衝突し、collideは中心からも有限値で押し出す', t => {
  const f = forest(t);
  const b = f.boxes.find(b => b.minX > 15 && b.maxX - b.minX < 1.3 && b.maxZ - b.minZ < 1.3);
  assert.ok(b);
  const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
  const pos = { x, z };
  assert.ok(f.collide(pos, 0.5));
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z));
  assert.ok(!blocked({ boxes: [b] }, pos.x, pos.z, 0.49));
  const v = new Vehicle();
  v.reset(x, b.maxZ + 5, 0);
  v.vz = -10;
  let impact = 0;
  for (let i = 0; i < 90; i++) {
    v.update(1 / 60, { up: true }, { boxes: [b] });
    impact = Math.max(impact, v.impact);
  }
  assert.ok(impact > 1.5, `no collision: ${impact}`);
  assert.ok(v.z >= b.maxZ);
});
