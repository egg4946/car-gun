import * as THREE from 'three';

// 1 ブロック(60m 四方の中の 44m 歩道スラブ)のジオメトリと当たり箱を作る。
// 頂点色の solid と、窓テクスチャの facade の 2 つにまとめる(描画 2 回/ブロック)。
export const PITCH = 60, SLAB = 22, LOT = 18, CURB_H = 0.15;
const FLOOR = 3.5, TEX_W = 12, TEX_H = 14; // 窓テクスチャ 1 枚 = 4スパン x 4階

// ブロックごとの決まった乱数
export function blockRand(i, j) {
  let s = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ 0x5bd1e995) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 頂点をためるバッファ
class Buf {
  constructor(uv) { this.pos = []; this.nor = []; this.col = []; this.uv = uv ? [] : null; this.idx = []; this.n = 0; }

  // 4 点の面。法線 (nx,ny,nz) の側から見て表になるよう並びを直す
  quad(p, nx, ny, nz, c, uv) {
    const [a, b, , d] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    let order = [0, 1, 2, 3];
    if (cx * nx + cy * ny + cz * nz < 0) order = [0, 3, 2, 1];
    for (const k of order) {
      this.pos.push(...p[k]);
      this.nor.push(nx, ny, nz);
      this.col.push(c.r, c.g, c.b);
      if (this.uv) this.uv.push(...(uv ? uv[k] : [0, 0]));
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }

  top(x0, x1, z0, z1, y, c) {
    this.quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], 0, 1, 0, c);
  }

  box(x0, x1, y0, y1, z0, z1, c) {
    this.top(x0, x1, z0, z1, y1, c);
    this.quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 1, 0, 0, c);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, c);
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, c);
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0, 0, -1, c);
  }

  // three のジオメトリを拡大・移動して足す
  geom(g, x, y, z, sx, sy, sz, c) {
    const p = g.attributes.position.array, nr = g.attributes.normal.array;
    const count = p.length / 3, base = this.n;
    for (let k = 0; k < count; k++) {
      this.pos.push(x + p[k * 3] * sx, y + p[k * 3 + 1] * sy, z + p[k * 3 + 2] * sz);
      this.nor.push(nr[k * 3], nr[k * 3 + 1], nr[k * 3 + 2]);
      this.col.push(c.r, c.g, c.b);
      if (this.uv) this.uv.push(0, 0);
    }
    if (g.index) for (const v of g.index.array) this.idx.push(base + v);
    else for (let k = 0; k < count; k++) this.idx.push(base + k);
    this.n += count;
  }

  build() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// 色はキャッシュ(リニア値)
const colors = new Map();
const C = hex => { let c = colors.get(hex); if (!c) colors.set(hex, c = new THREE.Color(hex)); return c; };

const CYL = new THREE.CylinderGeometry(1, 1, 1, 6, 1); // 半径1・高さ1・中心原点
const BALL = new THREE.IcosahedronGeometry(1, 0);

const TINTS = [0xffffff, 0xe8dcc8, 0xd8d8d8, 0xc9d2dc, 0xd9c3a8, 0xb8b4ae, 0xe6d3c0, 0xa9b4b8, 0xcfc7b0];
const ROOFS = [0x8a8a86, 0x77797c, 0x9a958c, 0x6e7276];
const LEAVES = [0x4f7f3a, 0x5c8a40, 0x467536, 0x6a9248];
const CARS = [0xf2f2f2, 0x222428, 0xb8bcc2, 0x8c1c1c, 0x1f3d7a, 0x5a6066];

// 区画 [x0,x1,z0,z1] を n 個に割る
function split(r, n, rand) {
  if (n <= 1) return [r];
  const [x0, x1, z0, z1] = r;
  const alongX = x1 - x0 > z1 - z0 ? true : x1 - x0 < z1 - z0 ? false : rand() < 0.5;
  const t = 0.35 + rand() * 0.3;
  let a, b;
  if (alongX) { const m = x0 + (x1 - x0) * t; a = [x0, m, z0, z1]; b = [m, x1, z0, z1]; }
  else { const m = z0 + (z1 - z0) * t; a = [x0, x1, z0, m]; b = [x0, x1, m, z1]; }
  const na = n === 4 ? 2 : 1, nb = n - na;
  return [...split(a, na, rand), ...split(b, nb, rand)];
}

// ブロック (i,j) を作る。戻り値 { solid, facade: BufferGeometry|null, boxes, props, kind }
// props は壊せる小物 { kind, key, geo, box }。geo はワールド座標。box は boxes にも入る(ガラスを除く)。
// broken に入っている key の小物は作らない(壊した物は戻っても壊れたまま)。
export function buildBlock(i, j, broken = null) {
  const rand = blockRand(i, j);
  const cx = i * PITCH, cz = j * PITCH;
  const solid = new Buf(false), facade = new Buf(true);
  const boxes = [], props = [];
  const pick = a => a[Math.floor(rand() * a.length)];
  // 部品の描き込み先。小物を作っている間だけ小物用のバッファに切り替える
  let cur = solid, propCount = 0;
  // 壊せる小物。fn で描いた物を 1 つにまとめ、(x,z) 中心 w×d・高さ h の当たり箱をつける。
  // 壊れていても fn は呼ぶ(乱数の消費をそろえて、街の形を変えないため)
  const prop = (kind, x, z, w, d, h, fn) => {
    const key = i + ',' + j + ',' + propCount++;
    cur = new Buf(false);
    fn();
    const buf = cur;
    cur = solid;
    if (broken?.has(key)) return;
    const box = { minX: cx + x - w / 2, maxX: cx + x + w / 2, minZ: cz + z - d / 2, maxZ: cz + z + d / 2, minY: 0, maxY: CURB_H + h };
    props.push({ kind, key, geo: buf.build(), box });
    if (kind !== 'glass') boxes.push(box);
  };

  const r0 = rand();
  const kind = r0 < 0.08 ? 'park' : r0 < 0.15 ? 'parking' : 'city';

  // 歩道スラブと縁石・点字ブロック
  solid.box(cx - SLAB, cx + SLAB, 0, CURB_H, cz - SLAB, cz + SLAB, C(0xb4b3ad));
  const e = SLAB - 0.3, y2 = CURB_H + 0.03;
  solid.top(cx - SLAB, cx + SLAB, cz - SLAB, cz - e, y2, C(0xd2d1cb));
  solid.top(cx - SLAB, cx + SLAB, cz + e, cz + SLAB, y2, C(0xd2d1cb));
  solid.top(cx - SLAB, cx - e, cz - e, cz + e, y2, C(0xd2d1cb));
  solid.top(cx + e, cx + SLAB, cz - e, cz + e, y2, C(0xd2d1cb));
  const ty = 19.3, tw = 0.3;
  solid.top(cx - ty - tw, cx + ty + tw, cz - ty - tw, cz - ty, y2, C(0xd8b830));
  solid.top(cx - ty - tw, cx + ty + tw, cz + ty, cz + ty + tw, y2, C(0xd8b830));
  solid.top(cx - ty - tw, cx - ty, cz - ty, cz + ty, y2, C(0xd8b830));
  solid.top(cx + ty, cx + ty + tw, cz - ty, cz + ty, y2, C(0xd8b830));

  // 部品
  const pole = (x, z, h, r, c) => cur.geom(CYL, cx + x, CURB_H + h / 2, cz + z, r, h, r, c);
  const tree = (x, z, s = 1) => prop('tree', x, z, 0.6, 0.6, 4.9 * s, () => {
    pole(x, z, 2.4 * s, 0.14 * s, C(0x5a4030));
    cur.geom(BALL, cx + x, CURB_H + 3.4 * s, cz + z, 1.7 * s, 1.5 * s, 1.7 * s, C(pick(LEAVES)));
  });
  // 街灯: (dx,dz) は道路側への向き
  const light = (x, z, dx, dz) => prop('lamp', x, z, 0.4, 0.4, 7, () => {
    pole(x, z, 7, 0.09, C(0x5b5e62));
    const ax = cx + x + dx * 0.8, az = cz + z + dz * 0.8;
    cur.box(ax - 0.8 * Math.abs(dx) - 0.06, ax + 0.8 * Math.abs(dx) + 0.06, CURB_H + 6.9, CURB_H + 7.0, az - 0.8 * Math.abs(dz) - 0.06, az + 0.8 * Math.abs(dz) + 0.06, C(0x5b5e62));
    const lx = cx + x + dx * 1.6, lz = cz + z + dz * 1.6;
    cur.box(lx - 0.25, lx + 0.25, CURB_H + 6.75, CURB_H + 6.95, lz - 0.25, lz + 0.25, C(0xfff4d0));
  });
  // 信号: 角 (sx,sz)。腕は x か z のどちらかの道路の上へ
  const signal = (sx, sz) => prop('signal', sx * 21, sz * 21, 0.4, 0.4, 5.6, () => {
    const x = sx * 21, z = sz * 21;
    pole(x, z, 5.6, 0.12, C(0x6a6d70));
    const alongX = sx * sz > 0;
    const dx = alongX ? sx : 0, dz = alongX ? 0 : sz;
    const y = CURB_H + 5.3;
    const ex = cx + x + dx * 4, ez = cz + z + dz * 4;
    cur.box(Math.min(cx + x, ex) - 0.06, Math.max(cx + x, ex) + 0.06, y, y + 0.12, Math.min(cz + z, ez) - 0.06, Math.max(cz + z, ez) + 0.06, C(0x6a6d70));
    // 灯器(横型 青・黄・赤)
    const hx = cx + x + dx * 3, hz = cz + z + dz * 3;
    const lw = alongX ? 1.2 : 0.3, ld = alongX ? 0.3 : 1.2;
    cur.box(hx - lw / 2, hx + lw / 2, y - 0.45, y, hz - ld / 2, hz + ld / 2, C(0x3a3c40));
    [0x20c080, 0xffb000, 0xff2a2a].forEach((col, k) => {
      const o = (k - 1) * 0.38;
      const lx = hx + (alongX ? o : 0), lz = hz + (alongX ? 0 : o);
      const a = alongX ? 0.14 : 0.2, b = alongX ? 0.2 : 0.14;
      cur.box(lx - a, lx + a, y - 0.36, y - 0.08, lz - b, lz + b, C(col));
    });
  });
  const vending = (x, z, dx, dz) => {
    const w = Math.abs(dz) > 0 ? 0.9 : 0.7, d = Math.abs(dz) > 0 ? 0.7 : 0.9;
    prop('vending', x, z, w, d, 1.8, () => vendingBody(x, z, dx, dz, w, d));
  };
  const vendingBody = (x, z, dx, dz, w, d) => {
    const body = pick([0xf4f4f0, 0xc8202a, 0x2050a8, 0xe0e4e8]);
    cur.box(cx + x - w / 2, cx + x + w / 2, CURB_H, CURB_H + 1.8, cz + z - d / 2, cz + z + d / 2, C(body));
    // 前面の明るい商品窓
    const fx = cx + x + dx * (w / 2 + 0.01), fz = cz + z + dz * (d / 2 + 0.01);
    if (dx) cur.quad([[fx, CURB_H + 0.9, cz + z - 0.35], [fx, CURB_H + 0.9, cz + z + 0.35], [fx, CURB_H + 1.6, cz + z + 0.35], [fx, CURB_H + 1.6, cz + z - 0.35]], dx, 0, 0, C(0xf8f0d8));
    else cur.quad([[cx + x - 0.35, CURB_H + 0.9, fz], [cx + x + 0.35, CURB_H + 0.9, fz], [cx + x + 0.35, CURB_H + 1.6, fz], [cx + x - 0.35, CURB_H + 1.6, fz]], 0, 0, dz, C(0xf8f0d8));
  };
  const bench = (x, z, alongX) => {
    const w = alongX ? 1.8 : 0.5, d = alongX ? 0.5 : 1.8;
    prop('bench', x, z, w, d, 0.45, () => {
      cur.box(cx + x - w / 2, cx + x + w / 2, CURB_H + 0.35, CURB_H + 0.45, cz + z - d / 2, cz + z + d / 2, C(0x8a6040));
      cur.box(cx + x - w / 2 + 0.1, cx + x + w / 2 - 0.1, CURB_H, CURB_H + 0.35, cz + z - d / 2 + 0.1, cz + z + d / 2 - 0.1, C(0x505458));
    });
  };
  const parkedCar = (x, z, alongX) => {
    const w = alongX ? 4.3 : 1.8, d = alongX ? 1.8 : 4.3;
    const col = C(pick(CARS));
    prop('parked', x, z, w, d, 1.45, () => {
      const y = CURB_H + 0.03;
      cur.box(cx + x - w / 2, cx + x + w / 2, y + 0.25, y + 0.85, cz + z - d / 2, cz + z + d / 2, col);
      const cw = alongX ? 2.2 : 1.6, cd = alongX ? 1.6 : 2.2;
      cur.box(cx + x - cw / 2, cx + x + cw / 2, y + 0.85, y + 1.4, cz + z - cd / 2, cz + z + cd / 2, C(0x30363e));
      // タイヤ
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        const tx = alongX ? a * 1.3 : b * 0.85, tz = alongX ? b * 0.85 : a * 1.3;
        cur.box(cx + x + tx - 0.2, cx + x + tx + 0.2, y, y + 0.5, cz + z + tz - 0.2, cz + z + tz + 0.2, C(0x18181a));
      }
    });
  };
  // 赤いドラム缶(撃つと爆発)
  const barrel = (x, z) => prop('barrel', x, z, 0.7, 0.7, 1.0, () => {
    cur.geom(CYL, cx + x, CURB_H + 0.5, cz + z, 0.32, 1.0, 0.32, C(0xc0281e));
    cur.geom(CYL, cx + x, CURB_H + 0.75, cz + z, 0.33, 0.06, 0.33, C(0x2a2a2a));
    cur.geom(CYL, cx + x, CURB_H + 0.3, cz + z, 0.33, 0.06, 0.33, C(0x2a2a2a));
  });
  const barrels = (x, z) => {
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) barrel(x + (k % 2) * 0.75 - 0.35, z + Math.floor(k / 2) * 0.75 - 0.35);
  };
  // 消火栓
  const hydrant = (x, z) => prop('hydrant', x, z, 0.45, 0.45, 0.9, () => {
    cur.geom(CYL, cx + x, CURB_H + 0.4, cz + z, 0.17, 0.8, 0.17, C(0xd02a20));
    cur.geom(CYL, cx + x, CURB_H + 0.85, cz + z, 0.12, 0.12, 0.12, C(0xd02a20));
    cur.box(cx + x - 0.28, cx + x + 0.28, CURB_H + 0.5, CURB_H + 0.62, cz + z - 0.07, cz + z + 0.07, C(0xd8d8d8));
  });
  // 店のショーウィンドウ(撃つと割れる)。(x0..x1, z0..z1) の細い板
  const glass = (x0, x1, z0, z1) => prop('glass', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 2.3, () => {
    cur.box(cx + x0, cx + x1, CURB_H + 0.35, CURB_H + 2.3, cz + z0, cz + z1, C(0x9fc8dc));
  });
  // 小さなコインパーキング
  const miniLot = (x0, x1, z0, z1) => {
    solid.top(cx + x0, cx + x1, cz + z0, cz + z1, CURB_H + 0.04, C(0x55585c));
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (let s = -len / 2 + 1.6; s <= len / 2 - 1.6; s += 2.8) {
      if (rand() < 0.35) continue;
      if (alongX) parkedCar(mx + s, mz, false); else parkedCar(mx, mz + s, true);
    }
    if (rand() < 0.6) barrels(alongX ? x0 + 0.8 : mx, alongX ? mz : z0 + 0.8);
  };

  // 四隅の信号
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) signal(sx, sz);
  // 四辺の街灯と街路樹。side: 外向き (ox,oz)
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const at = (off, t) => (ox ? [ox * off, t] : [t, oz * off]);
    for (const t of [-9, 9]) { const [x, z] = at(21.2, t); light(x, z, ox, oz); }
    for (const t of [-15, 0, 15]) if (rand() < 0.7) { const [x, z] = at(20.3, t); tree(x, z, 0.85 + rand() * 0.3); }
    if (rand() < 0.5) { const [x, z] = at(20.9, -4); hydrant(x, z); }
    if (rand() < 0.3) { const [x, z] = at(19.6, 5); barrels(x, z); }
  }

  if (kind === 'park') {
    solid.top(cx - LOT, cx + LOT, cz - LOT, cz + LOT, CURB_H + 0.06, C(0x6c9a4a));
    solid.top(cx - 1.5, cx + 1.5, cz - LOT, cz + LOT, CURB_H + 0.09, C(0xc8b896));
    solid.top(cx - LOT, cx + LOT, cz - 1.5, cz + 1.5, CURB_H + 0.09, C(0xc8b896));
    for (let k = 0; k < 14; k++) {
      const x = (rand() < 0.5 ? -1 : 1) * (3.5 + rand() * 13.5), z = (rand() < 0.5 ? -1 : 1) * (3.5 + rand() * 13.5);
      tree(x, z, 0.9 + rand() * 0.6);
    }
    bench(-4, 3, true); bench(4, -3, true); bench(3, 4, false);
  } else if (kind === 'parking') {
    solid.top(cx - LOT, cx + LOT, cz - LOT, cz + LOT, CURB_H + 0.03, C(0x55585c));
    const alongX = rand() < 0.5;
    for (const row of [-12, 12]) {
      for (let s = -15; s <= 15; s += 2.8) {
        const [lx, lz] = alongX ? [row, s] : [s, row];
        // 白線
        if (alongX) solid.top(cx + lx - 2.6, cx + lx + 2.6, cz + lz - 1.4 - 0.06, cz + lz - 1.4 + 0.06, CURB_H + 0.06, C(0xe8e8e2));
        else solid.top(cx + lx - 1.4 - 0.06, cx + lx - 1.4 + 0.06, cz + lz - 2.6, cz + lz + 2.6, CURB_H + 0.06, C(0xe8e8e2));
        if (rand() < 0.55) parkedCar(lx, lz, alongX);
      }
    }
    barrels(alongX ? 16 : -16, alongX ? 16 : -16);
    // 精算機
    vending(alongX ? 0 : -16, alongX ? -16 : 0, alongX ? 0 : 1, alongX ? 1 : 0);
  } else {
    solid.top(cx - LOT, cx + LOT, cz - LOT, cz + LOT, CURB_H + 0.03, C(0x9a9890));
    const n = 1 + Math.floor(rand() * 4);
    for (const r of split([-LOT, LOT, -LOT, LOT], n, rand)) {
      const ins = () => 0.4 + rand() * 1.2;
      const x0 = r[0] + ins(), x1 = r[1] - ins(), z0 = r[2] + ins(), z1 = r[3] - ins();
      const w = x1 - x0, d = z1 - z0;
      if (w < 4 || d < 4) continue;
      if (Math.min(w, d) < 12 && Math.max(w, d) > 6 && rand() < 0.3) { miniLot(x0, x1, z0, z1); continue; }
      const k = rand();
      let floors;
      if (k < 0.35) floors = 2 + Math.floor(rand() * 2); // 低い商店
      else if (k < 0.82 || Math.min(w, d) < 12) floors = 4 + Math.floor(rand() * 5);
      else floors = 10 + Math.floor(rand() * 7); // 高層
      const h = floors * FLOOR, y0 = CURB_H + 0.03, y1 = y0 + h;
      addFacade(facade, cx + x0, cx + x1, cz + z0, cz + z1, y0, y1, C(pick(TINTS)));
      solid.top(cx + x0, cx + x1, cz + z0, cz + z1, y1, C(pick(ROOFS)));
      boxes.push({ minX: cx + x0, maxX: cx + x1, minZ: cz + z0, maxZ: cz + z1 });
      // 屋上の設備
      if (floors >= 4 && w > 6 && d > 6) {
        const mx = cx + (x0 + x1) / 2 + (rand() - 0.5) * (w - 5), mz = cz + (z0 + z1) / 2 + (rand() - 0.5) * (d - 5);
        const s = 1.2 + rand() * 1.5;
        solid.box(mx - s, mx + s, y1, y1 + 1 + rand() * 2, mz - s, mz + s, C(0xa8aaa6));
      }
      // 低い店は道路側に日よけ
      if (floors <= 3) {
        const aw = C(pick([0xb03030, 0x2a6a40, 0x2a4a90, 0xd08020, 0x404448]));
        const ay = y0 + 2.7;
        if (x1 > 16.5) solid.box(cx + x1, cx + x1 + 1.2, ay, ay + 0.25, cz + z0 + 0.5, cz + z1 - 0.5, aw);
        if (x0 < -16.5) solid.box(cx + x0 - 1.2, cx + x0, ay, ay + 0.25, cz + z0 + 0.5, cz + z1 - 0.5, aw);
        if (z1 > 16.5) solid.box(cx + x0 + 0.5, cx + x1 - 0.5, ay, ay + 0.25, cz + z1, cz + z1 + 1.2, aw);
        if (z0 < -16.5) solid.box(cx + x0 + 0.5, cx + x1 - 0.5, ay, ay + 0.25, cz + z0 - 1.2, cz + z0, aw);
        // 道路側のショーウィンドウ
        const gy = 0.06;
        if (x1 > 16.5) glass(x1, x1 + gy, z0 + 0.8, z1 - 0.8);
        if (x0 < -16.5) glass(x0 - gy, x0, z0 + 0.8, z1 - 0.8);
        if (z1 > 16.5) glass(x0 + 0.8, x1 - 0.8, z1, z1 + gy);
        if (z0 < -16.5) glass(x0 + 0.8, x1 - 0.8, z0 - gy, z0);
        // 店先の自販機
        if (rand() < 0.5 && x1 > 16.5 && d > 4) vending(18.9, z0 + 1.2, 1, 0);
        else if (rand() < 0.5 && z0 < -16.5 && w > 4) vending(x0 + 1.2, -18.9, 0, -1);
      }
    }
  }

  return { solid: solid.build(), facade: facade.build(), boxes, props, kind };
}

// ビルの 4 面の壁(窓テクスチャ)
function addFacade(buf, x0, x1, z0, z1, y0, y1, tint) {
  const w = x1 - x0, d = z1 - z0;
  // 窓が角でそろうよう、テクスチャの u は左端から
  const v0 = 0, v1 = (y1 - y0) / TEX_H;
  const uvs = len => [[0, v0], [len / TEX_W, v0], [len / TEX_W, v1], [0, v1]];
  buf.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, tint, uvs(w));
  buf.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1, tint, uvs(w));
  buf.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0, tint, uvs(d));
  buf.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, tint, uvs(d));
}
