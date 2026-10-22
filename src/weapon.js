// プレイヤーの銃。撃てるのはハンドルから手を離している間だけ、
// 弾の補充はハンドルを握っている間だけ進む(運転するか撃つか)。
export class Weapon {
  constructor() {
    this.magSize = 24;
    this.ammo = this.magSize;
    this.interval = 0.1;
    this.cooldown = 0;
    this.reloadDelay = 0.3; // 握り直してから補充が始まるまで
    this.reloadRate = 20; // 発/秒
    this.reloadWait = 0;
    this.reloadAcc = 0;
    this.bloom = 0; // 連射でばらける
    this.infinite = 0; // 無限弾(アイテム)の残り秒
  }

  get reloading() { return this.ammo < this.magSize && this.reloadWait <= 0; }

  // 撃った弾の数だけ要素を返す
  update(dt, { handsOff, trigger }) {
    const shots = [];
    this.cooldown -= dt;
    this.infinite = Math.max(0, this.infinite - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    if (handsOff) {
      this.reloadWait = this.reloadDelay;
      this.reloadAcc = 0;
      while (trigger && this.ammo > 0 && this.cooldown <= 0) {
        if (this.infinite <= 0) this.ammo--;
        this.cooldown += this.interval;
        this.bloom = Math.min(0.015, this.bloom + 0.002);
        shots.push({});
      }
      if (this.cooldown < 0) this.cooldown = 0;
    } else {
      this.cooldown = Math.max(0, this.cooldown);
      this.reloadWait -= dt;
      if (this.reloadWait <= 0 && this.ammo < this.magSize) {
        this.reloadAcc += dt * this.reloadRate;
        const n = Math.floor(this.reloadAcc);
        this.reloadAcc -= n;
        this.ammo = Math.min(this.magSize, this.ammo + n);
      }
    }
    return shots;
  }

  // 弾のばらつき(rad)。速度 m/s と車の回転 rad/s が大きいほど狙いにくい
  spread(speed, yawRate) {
    return 0.004 + Math.abs(speed) * 0.0007 + Math.abs(yawRate) * 0.02 + this.bloom;
  }

  reset() {
    this.ammo = this.magSize;
    this.cooldown = this.bloom = this.reloadAcc = this.reloadWait = this.infinite = 0;
  }
}
