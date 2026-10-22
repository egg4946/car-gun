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
