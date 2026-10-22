import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInBox } from './geom.js';

/**
 * 遊び方: タイトルの「マップ」で「森の林道」を選び、START を押す。
 * ?map=forest でも直接開ける。マップ変更は再読込し、市街地を既定のまま残す。
 * main.js は World/街の START の代わりに Forest/START を使う。
 * 背景は new THREE.Color(BACKGROUND_COLOR)、
 * 霧は new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR) を呼出側で設定する。
 * 初回の敵出現前に update(START.x, START.z)、以後は毎フレーム update を呼ぶ。
 * 出現候補は読込済みセルだけ。マップを捨てる際は dispose() で共有資源も解放する。
 */

export const START = { x: -3, z: 0, yaw: 0 };
export const BACKGROUND_COLOR = 0x7fa88a;
export const FOG_COLOR = 0x7fa88a;
export const FOG_NEAR = 35;
export const FOG_FAR = 180;

const CELL = 64, RANGE = 3, HALF_ROAD = 6;
// 中心線の最大傾きより大きい値。箱全体と道の間に余白を保証する。
const MAX_SLOPE = 18 / 105 + 10 / 53;
const center = z => {
  const q = Math.max(0, Math.abs(z) - 48);
  return Math.sign(z) * (18 * Math.sin(q / 105) + 10 * Math.sin(q / 53));
};
const slope = z => {
  if (Math.abs(z) <= 48) return 0;
  const q = Math.abs(z) - 48;
  return 18 / 105 * Math.cos(q / 105) + 10 / 53 * Math.cos(q / 53);
};
function random(i, j) {
  let s = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ 0x51f15e;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function colored(geometry, color) {
  const c = new THREE.Color(color), n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
const touches = (x, z, r, b) => {
  const dx = x - Math.max(b.minX, Math.min(x, b.maxX));
  const dz = z - Math.max(b.minZ, Math.min(z, b.maxZ));
  return dx * dx + dz * dz <= r * r;
};

// main.js 側で背景と霧を設定する。街と同じ生成・出現・衝突インターフェース。
export class Forest {
  constructor(scene) {
    this.scene = scene;
    this.cells = new Map();
    this.boxes = [];
    this.cx = null;
    this.cz = null;
    const trunk = colored(new THREE.CylinderGeometry(0.32, 0.48, 5, 6).translate(0, 2.5, 0), 0x654a30);
    const crown = colored(new THREE.ConeGeometry(2.5, 8, 7).translate(0, 7, 0), 0x285538);
    this.treeGeometry = mergeGeometries([trunk, crown]);
    trunk.dispose();
    crown.dispose();
    this.rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    this.logGeometry = new THREE.CylinderGeometry(0.45, 0.45, 5, 7).rotateZ(Math.PI / 2);
    this.groundGeometry = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
    this.treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.rockMaterial = new THREE.MeshLambertMaterial({ color: 0x72766a, flatShading: true });
    this.logMaterial = new THREE.MeshLambertMaterial({ color: 0x654a30 });
    this.groundMaterial = new THREE.MeshLambertMaterial({ color: 0x486640 });
    this.roadMaterial = new THREE.MeshLambertMaterial({ color: 0x9b8962 });
    this.transform = new THREE.Object3D();
    this.tint = new THREE.Color();
  }

  update(px, pz) {
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    const removed = new Set();
    for (const [key, cell] of this.cells) {
      if (Math.abs(cell.i - cx) <= RANGE && Math.abs(cell.j - cz) <= RANGE) continue;
      this.removeCell(cell);
      for (const b of cell.boxes) removed.add(b);
      this.cells.delete(key);
    }
    if (removed.size) {
      let n = 0;
      for (const b of this.boxes) if (!removed.has(b)) this.boxes[n++] = b;
      this.boxes.length = n;
    }
    for (let i = cx - RANGE; i <= cx + RANGE; i++) {
      for (let j = cz - RANGE; j <= cz + RANGE; j++) {
        const key = i + ',' + j;
        if (!this.cells.has(key)) this.cells.set(key, this.spawn(i, j));
      }
    }
  }

  spawn(i, j) {
    const rand = random(i, j), meshes = [], boxes = [];
    const x0 = i * CELL, z0 = j * CELL;
    const ground = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
    ground.position.set(x0 + CELL / 2, -0.025, z0 + CELL / 2);
    meshes.push(ground);
    // z の境界と分割位置を全セルで共有し、隣のセルとの道の継ぎ目をなくす。
    if (x0 <= 35 && x0 + CELL >= -35) {
      const vertices = [], indices = [];
      for (let k = 0; k <= 32; k++) {
        const z = z0 + k * CELL / 32, x = center(z);
        vertices.push(Math.max(x0, Math.min(x0 + CELL, x - HALF_ROAD)), 0, z,
          Math.max(x0, Math.min(x0 + CELL, x + HALF_ROAD)), 0, z);
        if (k < 32) {
          const a = k * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      meshes.push(new THREE.Mesh(geometry, this.roadMaterial));
    }
    const trees = [], rocks = [], logs = [];
    const place = (list, x, z, hx, hz, y, sx, sy, sz, yaw = 0) => {
      if (Math.abs(x - center(z)) <= HALF_ROAD + 1.8 + hx + MAX_SLOPE * hz) return;
      const b = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
      if (boxes.some(other => b.minX <= other.maxX && b.maxX >= other.minX && b.minZ <= other.maxZ && b.maxZ >= other.minZ)) return;
      boxes.push(b);
      list.push({ x, z, y, sx, sy, sz, yaw, tint: 0.8 + rand() * 0.35 });
    };
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 8; b++) {
        const x = x0 + a * 8 + 2 + rand() * 4, z = z0 + b * 8 + 2 + rand() * 4;
        const s = 0.8 + rand() * 0.5;
        place(trees, x, z, 0.48 * s, 0.48 * s, 0, s, s, s, rand() * Math.PI * 2);
      }
    }
    for (let k = 0; k < 3; k++) {
      const x = x0 + 4 + rand() * (CELL - 8), z = z0 + 4 + rand() * (CELL - 8);
      const s = 0.8 + rand();
      place(rocks, x, z, s, s, s * 0.55, s, s * 0.9, s);
    }
    const lx = x0 + 5 + rand() * (CELL - 10), lz = z0 + 5 + rand() * (CELL - 10);
    place(logs, lx, lz, 2.5, 0.45, 0.45, 1, 1, 1);
    for (const [items, geometry, material] of [[trees, this.treeGeometry, this.treeMaterial],
      [rocks, this.rockGeometry, this.rockMaterial], [logs, this.logGeometry, this.logMaterial]]) {
      if (!items.length) continue;
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      for (let k = 0; k < items.length; k++) {
        const p = items[k], t = this.transform;
        t.position.set(p.x, p.y, p.z);
        t.rotation.set(0, p.yaw, 0);
        t.scale.set(p.sx, p.sy, p.sz);
        t.updateMatrix();
        mesh.setMatrixAt(k, t.matrix);
        mesh.setColorAt(k, this.tint.setScalar(p.tint));
      }
      mesh.computeBoundingSphere();
      meshes.push(mesh);
    }
    for (const mesh of meshes) {
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    this.boxes.push(...boxes);
    return { i, j, meshes, boxes };
  }

  isRoad(x, z) {
    return Math.abs(x - center(z)) <= HALF_ROAD;
  }

  cellAt(x, z) {
    return this.cells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  }

  roadSpot(px, pz, minR, maxR, rand = Math.random) {
    for (let tries = 0; tries < 100; tries++) {
      const z = pz + (rand() * 2 - 1) * maxR;
      const side = rand() < 0.5 ? -1 : 1;
      const x = center(z) + side * 3;
      const d = Math.hypot(x - px, z - pz);
      if (d < minR || d > maxR || !this.cellAt(x, z)) continue;
      const yaw = Math.atan(slope(z)) + (side < 0 ? 0 : Math.PI);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let safe = true;
      for (const offset of [-2.5, 0, 2.5]) {
        const xx = x + fx * offset, zz = z + fz * offset;
        if (!this.isRoad(xx, zz) || this.boxes.some(b => touches(xx, zz, 1.2, b))) { safe = false; break; }
      }
      if (safe) return { x, z, yaw };
    }
    return null;
  }

  sidewalkSpots(px, pz, minR, maxR, count, rand = Math.random) {
    const out = [];
    for (let tries = count * 40; tries > 0 && out.length < count; tries--) {
      const z = pz + (rand() * 2 - 1) * maxR;
      const x = center(z) + (rand() < 0.5 ? -1 : 1) * (7.2 + rand() * 6);
      const d = Math.hypot(x - px, z - pz);
      if (d < minR || d > maxR || !this.cellAt(x, z) || this.isRoad(x, z)) continue;
      if (this.boxes.some(b => touches(x, z, 0.7, b))) continue;
      if (out.some(p => Math.hypot(x - p.x, z - p.z) < 1.4)) continue;
      out.push({ x, z });
    }
    return out;
  }

  collide(pos, r) {
    let hit = false;
    for (const b of this.boxes) {
      const inside = pointInBox(pos.x, pos.z, b);
      if (inside) {
        pos.x += inside.nx * (inside.depth + r);
        pos.z += inside.nz * (inside.depth + r);
        hit = true;
        continue;
      }
      const dx = pos.x - Math.max(b.minX, Math.min(pos.x, b.maxX));
      const dz = pos.z - Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (r - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
      hit = true;
    }
    return hit;
  }

  removeCell(cell) {
    for (const mesh of cell.meshes) {
      this.scene.remove(mesh);
      if (mesh.isInstancedMesh) mesh.dispose();
      else if (mesh.geometry !== this.groundGeometry) mesh.geometry.dispose();
    }
  }

  // マップ切替時だけ共有資源を解放する。外部から足された箱・描画物は所有しない。
  dispose() {
    for (const cell of this.cells.values()) this.removeCell(cell);
    const own = new Set();
    for (const cell of this.cells.values()) for (const b of cell.boxes) own.add(b);
    let n = 0;
    for (const b of this.boxes) if (!own.has(b)) this.boxes[n++] = b;
    this.boxes.length = n;
    this.cells.clear();
    this.cx = this.cz = null;
    for (const g of [this.treeGeometry, this.rockGeometry, this.logGeometry, this.groundGeometry]) g.dispose();
    for (const m of [this.treeMaterial, this.rockMaterial, this.logMaterial, this.groundMaterial, this.roadMaterial]) m.dispose();
  }
}
