import * as THREE from 'three';
import { pointInBox } from './geom.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBlock, PITCH, SLAB, LOT } from './cityBlock.js';
import { PROPS, PropState } from './props.js';
import { roadTexture, facadeTexture } from './cityTextures.js';

const RANGE = 3; // 自分のまわり ±3 ブロックを読み込む
const ROAD_HALF = PITCH / 2 - SLAB; // 8m
const LANES = [-6, -2, 2, 6]; // 道路中心からの車線中心
const GROUND_TILES = 16;

// 左側通行。道路は x,z = 30+60k。スタートは x=30 の道路の左側(内側)車線、-z 向き。
export const START = { x: 28, z: 0, yaw: 0 };

const mod = v => ((v % PITCH) + PITCH) % PITCH;
const roadCenter = v => Math.round((v - PITCH / 2) / PITCH) * PITCH + PITCH / 2;

// 市街地を無限に生成する。60m ピッチのブロックと幅16mの道路。
export class World {
  constructor(scene) {
    this.scene = scene;
    this.cells = new Map();
    this.boxes = []; // 衝突判定用 {minX,maxX,minZ,maxZ}
    this.losBoxes = []; // 視線・弾をさえぎる箱(建物など。小物は含まない)
    this.props = []; // 読み込み済みの壊せる小物
    this.broken = new Set(); // 壊した小物の key(戻っても壊れたまま)
    this.events = []; // 小物が壊れた等の知らせ。見た目側(destructibles.js)が受け取る
    const size = PITCH * GROUND_TILES;
    const tex = roadTexture(GROUND_TILES);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshLambertMaterial(tex ? { map: tex } : { color: 0x44474c })
    );
    ground.rotation.x = -Math.PI / 2;
    this.ground = ground;
    scene.add(ground);
    const fTex = facadeTexture();
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.facadeMat = new THREE.MeshLambertMaterial(fTex ? { map: fTex, vertexColors: true } : { vertexColors: true });
  }

  update(px, pz) {
    // 地面は 60m 単位でずらすので路面標示は世界に固定されたまま
    this.ground.position.set(Math.round(px / PITCH) * PITCH, 0, Math.round(pz / PITCH) * PITCH);
    const cx = Math.round(px / PITCH), cz = Math.round(pz / PITCH);
    let removed = null;
    for (const [key, cell] of this.cells) {
      if (Math.abs(cell.i - cx) <= RANGE + 1 && Math.abs(cell.j - cz) <= RANGE + 1) continue;
      for (const m of cell.meshes) { this.scene.remove(m); m.geometry.dispose(); }
      for (const p of cell.props) p.geo.dispose();
      removed ??= new Set();
      for (const b of cell.boxes) removed.add(b);
      for (const p of cell.props) removed.add(p);
      this.cells.delete(key);
    }
    if (removed) {
      // その場で詰める(外から足された箱は残す)
      compact(this.boxes, removed);
      compact(this.losBoxes, removed);
      compact(this.props, removed);
    }
    for (let i = cx - RANGE; i <= cx + RANGE; i++) {
      for (let j = cz - RANGE; j <= cz + RANGE; j++) {
        const key = i + ',' + j;
        if (!this.cells.has(key)) this.cells.set(key, this.spawn(i, j));
      }
    }
  }

  spawn(i, j) {
    const b = buildBlock(i, j, this.broken);
    const meshes = [];
    if (b.solid) meshes.push(new THREE.Mesh(b.solid, this.solidMat));
    if (b.facade) meshes.push(new THREE.Mesh(b.facade, this.facadeMat));
    // 小物はブロックごとに 1 つのメッシュにまとめ、壊れたら頂点をつぶして消す
    const cell = { i, j, meshes, boxes: b.boxes, kind: b.kind, props: [], propMesh: null };
    if (b.props.length) {
      let start = 0;
      for (const p of b.props) {
        const count = p.geo.attributes.position.count;
        const prop = { ...p, cell, start, count, state: new PropState(p.kind) };
        start += count;
        Object.assign(p.box, { breakSpeed: PROPS[p.kind].breakSpeed, mass: PROPS[p.kind].mass });
        // 箱→小物の参照は列挙しない(箱は素直なデータのままにしておく)
        Object.defineProperty(p.box, 'prop', { value: prop, enumerable: false });
        cell.props.push(prop);
      }
      cell.propMesh = new THREE.Mesh(mergeGeometries(b.props.map(p => p.geo)), this.solidMat);
      meshes.push(cell.propMesh);
    }
    for (const m of meshes) { m.matrixAutoUpdate = false; this.scene.add(m); }
    this.boxes.push(...b.boxes);
    for (const box of b.boxes) if (!box.prop) this.losBoxes.push(box);
    this.props.push(...cell.props);
    return cell;
  }

  // 車が小物をなぎ倒した(vehicle.js から呼ばれる)
  onBreak(box, speed, vx, vz, by) {
    if (!box.prop) return;
    const events = box.prop.state.smash();
    this.breakProp(box.prop, { how: 'smash', speed, vx, vz, events, by });
  }

  // 小物を壊す: 当たり箱を外し、描画からも消し、見た目側に知らせる
  breakProp(prop, info = {}) {
    if (this.broken.has(prop.key)) return;
    this.broken.add(prop.key);
    prop.box.broken = true;
    const gone = new Set([prop.box, prop]);
    compact(this.boxes, gone);
    compact(this.props, gone);
    const mesh = prop.cell.propMesh;
    if (mesh && this.cells.get(prop.cell.i + ',' + prop.cell.j) === prop.cell) {
      const pos = mesh.geometry.attributes.position;
      const x = pos.getX(prop.start), y = pos.getY(prop.start), z = pos.getZ(prop.start);
      for (let k = prop.start; k < prop.start + prop.count; k++) pos.setXYZ(k, x, y, z);
      pos.needsUpdate = true;
    }
    this.events.push({ type: 'broken', prop, ...info });
  }

  // 道路面(歩道スラブの外)なら true
  isRoad(x, z) {
    return Math.abs(mod(x) - PITCH / 2) <= ROAD_HALF || Math.abs(mod(z) - PITCH / 2) <= ROAD_HALF;
  }

  cellAt(x, z) {
    return this.cells.get(Math.round(x / PITCH) + ',' + Math.round(z / PITCH));
  }

  // 読み込み済みの歩道で、箱から 0.5m 以上離れた点を最大 count 個
  sidewalkSpots(px, pz, minR, maxR, count, rand = Math.random) {
    const out = [];
    for (let tries = count * 40; tries > 0 && out.length < count; tries--) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(minR * minR + rand() * (maxR * maxR - minR * minR));
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const cell = this.cellAt(x, z);
      if (!cell) continue;
      const lx = Math.abs(x - cell.i * PITCH), lz = Math.abs(z - cell.j * PITCH);
      if (lx > SLAB - 0.6 || lz > SLAB - 0.6) continue;
      // 建物の区画の中(路地)は除く。公園と駐車場は中も使う
      if (cell.kind === 'city' && lx < LOT + 0.5 && lz < LOT + 0.5) continue;
      if (cell.boxes.some(b => circleBox(x, z, 0.5, b))) continue;
      out.push({ x, z });
    }
    return out;
  }

  // 車線上の点と、その車線の向き。見つからなければ null
  roadSpot(px, pz, minR, maxR, rand = Math.random) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rand() * Math.PI * 2, d = minR + rand() * (maxR - minR);
      let x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const off = LANES[Math.floor(rand() * LANES.length)];
      let yaw;
      if (rand() < 0.5) {
        // 南北の道路。-z 向きは x の小さい側
        x = roadCenter(x) + off;
        yaw = off < 0 ? 0 : Math.PI;
        if (Math.abs(mod(z) - PITCH / 2) < ROAD_HALF + 6) continue; // 交差点は避ける
      } else {
        // 東西の道路。-x 向きは z の大きい側
        z = roadCenter(z) + off;
        yaw = off > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (Math.abs(mod(x) - PITCH / 2) < ROAD_HALF + 6) continue;
      }
      const r = Math.hypot(x - px, z - pz);
      if (r < minR || r > maxR) continue;
      return { x, z, yaw };
    }
    return null;
  }

  // 円(半径r)とビルの衝突。押し出して、ぶつかったら true。
  collide(pos, r) {
    let hit = false;
    for (const b of this.boxes) {
      const c = circleBox(pos.x, pos.z, r, b);
      if (!c) continue;
      pos.x += c.nx * c.depth;
      pos.z += c.nz * c.depth;
      hit = true;
    }
    return hit;
  }
}

// 配列から set に入っている物を取り除く(並びは保つ)
function compact(arr, set) {
  let n = 0;
  for (const v of arr) if (!set.has(v)) arr[n++] = v;
  arr.length = n;
}

function circleBox(x, z, r, b) {
  const inside = pointInBox(x, z, b);
  if (inside) return { nx: inside.nx, nz: inside.nz, depth: inside.depth + r };
  const cx = Math.max(b.minX, Math.min(x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, nz: dz / d, depth: r - d };
}
