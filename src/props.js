// 壊せる小物の性能と状態(three.js 非依存)。
// breakSpeed: 車がこの速さ(m/s, 当たった面に垂直な成分)以上でぶつかるとなぎ倒せる。0 は倒せない。
// hp: 弾で壊れるまでの数。0 は撃っても壊れない。points は壊したときのおまけ点。
export const PROPS = {
  lamp: { hp: 4, breakSpeed: 3, mass: 150, points: 20 },
  signal: { hp: 5, breakSpeed: 5, mass: 250, points: 30 },
  tree: { hp: 0, breakSpeed: 6, mass: 300, points: 10 },
  bench: { hp: 0, breakSpeed: 2, mass: 60, points: 10 },
  vending: { hp: 3, breakSpeed: 3, mass: 300, points: 50 },
  hydrant: { hp: 2, breakSpeed: 2, mass: 80, points: 40 },
  barrel: { hp: 2, breakSpeed: 2, mass: 60, points: 20, explode: { radius: 7, fuse: 0 } },
  parked: { hp: 8, breakSpeed: 0, mass: 1200, points: 100, explode: { radius: 9, fuse: 2.5 } },
  glass: { hp: 1, breakSpeed: 0, mass: 0, points: 10 },
};

export class PropState {
  constructor(kind) {
    this.kind = kind;
    this.def = PROPS[kind];
    this.hp = this.def.hp;
    this.state = 'intact'; // intact → (burning →) broken
    this.fuse = 0;
  }

  // 弾・爆風のダメージ。起きたこと({type:'break'|'ignite'|'explode'})を返す
  hit(n) {
    if (this.state !== 'intact' || this.def.hp === 0 && n < 50) return [];
    this.hp -= n;
    if (this.hp > 0) return [];
    const ex = this.def.explode;
    if (ex && ex.fuse > 0 && n < 50) {
      // 燃えてから爆発する(爆風を食らったら即爆発)
      this.state = 'burning';
      this.fuse = ex.fuse;
      return [{ type: 'ignite' }];
    }
    return this.break();
  }

  // 車でなぎ倒された
  smash() {
    return this.state === 'broken' ? [] : this.break();
  }

  break() {
    this.state = 'broken';
    return this.def.explode ? [{ type: 'break' }, { type: 'explode' }] : [{ type: 'break' }];
  }

  update(dt) {
    if (this.state !== 'burning') return [];
    this.fuse -= dt;
    return this.fuse <= 0 ? this.break() : [];
  }
}

// 光線 (o + t*d, t>=0) と高さつき箱の交差。最初に当たる t、当たらなければ null
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, min, max] of [[ox, dx, b.minX, b.maxX], [oy, dy, b.minY, b.maxY], [oz, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }
    let u0 = (min - o) / d, u1 = (max - o) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return null;
  }
  return t0;
}
