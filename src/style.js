// スタイル得点・プレイ統計・称号(three.js 非依存)

// 撃破したときの状況からトリックを判定する。
// ctx: { how, slipDeg(車体の滑り角), handsOffTime(手放しが続いた秒), aimDeg(車の正面と狙った向きの角度), kmh, dist }
// 戻り値: { mult: 得点倍率, tags: ポップアップに出す名前 }
const TRICKS = [
  ['ドリフトキル', c => Math.abs(c.slipDeg) > 20, 0.5],
  ['ノールック', c => c.aimDeg > 120, 0.5],
  ['手放し3秒', c => c.handsOffTime >= 3, 0.3],
  ['高速キル', c => c.kmh >= 100, 0.3],
  ['ロングショット', c => c.dist >= 60, 0.3],
];

export function judgeKill(ctx) {
  // 轢き・体当たりは専用の点があるので重ねない
  if (ctx.how === 'runover' || ctx.how === 'ram') return { mult: 1, tags: [] };
  const tags = [];
  let mult = 1;
  if (ctx.how === 'blast') { tags.push('巻き込み'); mult += 0.5; }
  else {
    for (const [name, ok, bonus] of TRICKS) if (ok(ctx)) { tags.push(name); mult += bonus; }
  }
  return { mult, tags };
}

// 1 ラウンドの記録
export class Stats {
  constructor() {
    this.kills = 0;
    this.byHow = {};
    this.tricks = {};
    this.destroyed = 0;
    this.maxCombo = 1;
    this.longestDrift = 0;
    this.longestHandsOff = 0;
    this.maxKmh = 0;
    this.driftTime = 0;
    this.handsOffTime = 0;
  }

  update(dt, { slipDeg, handsOff, kmh }) {
    this.driftTime = Math.abs(slipDeg) > 15 ? this.driftTime + dt : 0;
    this.handsOffTime = handsOff ? this.handsOffTime + dt : 0;
    this.longestDrift = Math.max(this.longestDrift, this.driftTime);
    this.longestHandsOff = Math.max(this.longestHandsOff, this.handsOffTime);
    this.maxKmh = Math.max(this.maxKmh, kmh);
  }

  kill(how, tags) {
    this.kills++;
    this.byHow[how] = (this.byHow[how] ?? 0) + 1;
    for (const t of tags) this.tricks[t] = (this.tricks[t] ?? 0) + 1;
  }
}

// 称号。上から順に当てはまった物
const TITLES = [
  ['街の破壊神', s => s.destroyed >= 40],
  ['爆破職人', s => (s.byHow.blast ?? 0) >= 4],
  ['歩道の暴走族', s => (s.byHow.runover ?? 0) >= 5],
  ['ハンドルいらない人', s => s.longestHandsOff >= 8],
  ['背中に目がある人', s => (s.tricks['ノールック'] ?? 0) >= 3],
  ['ドリフト職人', s => s.longestDrift >= 4 || (s.tricks['ドリフトキル'] ?? 0) >= 4],
  ['コンボマスター', s => s.maxCombo >= 5],
  ['街の掃除屋', s => s.kills >= 20],
  ['ドライブバイ見習い', s => s.kills > 0],
  ['安全運転', () => true],
];

export function titleFor(stats) {
  return TITLES.find(([, ok]) => ok(stats))[0];
}
