// 道路に出るアイテム(three.js 非依存)。取りに行くには運転が要る=撃つか拾いに行くか
export const PICKUP_TYPES = ['repair', 'nitro', 'ammo'];
const RADIUS = 3.2; // 車がこの距離まで近づけば拾える

export class Pickups {
  constructor({ interval = 7, max = 3 } = {}) {
    this.interval = interval;
    this.max = max;
    this.timer = interval;
    this.list = [];
    this.next = 0;
  }

  // spot(): 出す場所 {x,z} か null。拾った物の配列を返す
  update(dt, car, spot) {
    this.timer -= dt;
    if (this.timer <= 0 && this.list.length < this.max) {
      this.timer = this.interval;
      const s = spot();
      if (s) this.list.push({ type: PICKUP_TYPES[this.next++ % PICKUP_TYPES.length], x: s.x, z: s.z, id: this.next });
    }
    const got = this.list.filter(p => Math.hypot(p.x - car.x, p.z - car.z) < RADIUS);
    if (got.length) this.list = this.list.filter(p => !got.includes(p));
    return got;
  }

  clear() {
    this.list = [];
    this.timer = this.interval;
  }
}
