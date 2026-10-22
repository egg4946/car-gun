// 点が箱の中なら、いちばん浅い面から外へ出る向きと深さ
export function pointInBox(x, z, b) {
  if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) return null;
  let best = { nx: -1, nz: 0, depth: x - b.minX };
  for (const [depth, nx, nz] of [[b.maxX - x, 1, 0], [z - b.minZ, 0, -1], [b.maxZ - z, 0, 1]]) {
    if (depth < best.depth) best = { nx, nz, depth };
  }
  return best;
}

// 線分 a→b が箱を横切るか(スラブ法)
export function segmentHitsBox(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, min, max] of [[ax, dx, b.minX, b.maxX], [az, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return false;
      continue;
    }
    let u0 = (min - p) / d, u1 = (max - p) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}

// a から b が見えるか(間にビルがないか)
export function lineOfSight(boxes, ax, az, bx, bz) {
  for (const b of boxes) if (segmentHitsBox(ax, az, bx, bz, b)) return false;
  return true;
}

// 光線 (o + t*d) と高さつき箱の交差。入射面の法線も返す。
// 始点が箱の中なら inside=true とし、t は出口の距離になる。
export function rayBoxHit(ox, oy, oz, dx, dy, dz, b) {
  const minY = b.minY ?? 0, maxY = b.maxY ?? 8;
  let t0 = -Infinity, t1 = Infinity;
  for (const [o, d, min, max] of [[ox, dx, b.minX, b.maxX], [oy, dy, minY, maxY], [oz, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }
    let u0 = (min - o) / d, u1 = (max - o) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    if (t0 > t1) return null;
  }
  if (t1 < 0 || !Number.isFinite(t1)) return null;
  const inside = t0 < 0;
  const t = inside ? t1 : t0;
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  const eps = 1e-4;
  let nx = 0, ny = 0, nz = 0;
  if (Math.abs(px - b.minX) < eps) nx = -1;
  else if (Math.abs(px - b.maxX) < eps) nx = 1;
  else if (Math.abs(py - minY) < eps) ny = -1;
  else if (Math.abs(py - maxY) < eps) ny = 1;
  else if (Math.abs(pz - b.minZ) < eps) nz = -1;
  else if (Math.abs(pz - b.maxZ) < eps) nz = 1;
  else if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz)) nx = -Math.sign(dx);
  else if (Math.abs(dy) >= Math.abs(dz)) ny = -Math.sign(dy);
  else nz = -Math.sign(dz);
  return { t, inside, nx, ny, nz };
}

// 高さを考慮した視線判定。始点が箱の中ならその箱は無視する
// (追従カメラが建物にめり込んだときの保険)。
export function lineOfSight3D(boxes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const b of boxes) {
    const h = rayBoxHit(ax, ay, az, dx, dy, dz, b);
    if (!h || h.inside) continue;
    if (h.t > 1e-4 && h.t < 1 - 1e-4) return false;
  }
  return true;
}

// 地面と高さつき箱のうち、光線が最初に当たるもの。
// 小物(box.prop)は destructibles.js が別に扱うので飛ばす。
export function raycastWorldBoxes(boxes, o, d, maxT = 90) {
  let best = null;
  if (d.y < -1e-9) {
    const t = -o.y / d.y;
    if (t >= 0 && t <= maxT) best = { t, nx: 0, ny: 1, nz: 0, kind: 'ground', surface: 'ground' };
  }
  for (const b of boxes) {
    if (b.prop) continue;
    const h = rayBoxHit(o.x, o.y, o.z, d.x, d.y, d.z, b);
    if (!h || h.inside || h.t < 0 || h.t > maxT) continue;
    if (!best || h.t < best.t) {
      best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, kind: 'box', surface: b.surface ?? 'hard' };
    }
  }
  return best;
}
