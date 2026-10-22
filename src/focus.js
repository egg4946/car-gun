// 集中(スローモーション)ゲージ。ドリフトと撃破で溜め、押している間だけ時間をゆっくりにする(three.js 非依存)

export const SLOW = 0.35; // スロー中の時間の速さ
const CHARGE_DRIFT = 0.3; // ドリフト1秒で溜まる量
const CHARGE_KILL = 0.12;
const DRAIN = 0.3; // スロー1秒(実時間)で減る量。満タンで約3秒

export class Focus {
  constructor() {
    this.gauge = 0;
    this.timeScale = 1;
    this.active = false;
  }

  // dt は実時間。s: { slipDeg, kmh, want(押しているか) }
  update(dt, { slipDeg, kmh, want }) {
    if (Math.abs(slipDeg) > 15 && kmh > 25) this.gauge = Math.min(1, this.gauge + CHARGE_DRIFT * dt);
    this.active = want && this.gauge > 0;
    if (this.active) this.gauge = Math.max(0, this.gauge - DRAIN * dt);
    // 急に切り替えず、なめらかに遅く・速くする
    const target = this.active ? SLOW : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * 10);
    if (Math.abs(this.timeScale - target) < 0.01) this.timeScale = target;
    return this.timeScale;
  }

  onKill() {
    this.gauge = Math.min(1, this.gauge + CHARGE_KILL);
  }
}
