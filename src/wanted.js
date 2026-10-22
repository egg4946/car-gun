// 手配度(★0〜5)。暴れるほど熱が上がり、しばらくおとなしくしていると冷める(three.js 非依存)

// 出来事ごとの熱の量
export const HEAT = { gunman: 1, drone: 1.5, chaser: 2.5, boss: 5, prop: 0.15, explosion: 0.5 };
const STARS = [1.5, 5, 10, 17, 26]; // ★1〜★5 になる熱
const QUIET = 6; // この秒数なにもしないと冷め始める
const COOL = 0.5; // 冷める速さ(熱/秒)

export class Wanted {
  constructor() {
    this.heat = 0;
    this.level = 0;
    this.quiet = 0;
  }

  add(amount) {
    this.heat = Math.min(STARS[4] + 5, this.heat + amount);
    this.quiet = 0;
    return this.refresh();
  }

  update(dt) {
    this.quiet += dt;
    if (this.quiet > QUIET) this.heat = Math.max(0, this.heat - COOL * dt);
    return this.refresh();
  }

  // ★を計算し直し、上がったか下がったかを返す
  refresh() {
    const before = this.level;
    this.level = STARS.filter(h => this.heat >= h).length;
    return { level: this.level, levelUp: this.level > before, levelDown: this.level < before };
  }
}
