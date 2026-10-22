// 効果音はすべて Web Audio で合成する(音声ファイルなし)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function distortion(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
  }
  return curve;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // ブラウザの制約でユーザー操作の中から呼ぶ
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    // スロー中は全体をこもらせる
    this.slowFilter = this.filter('lowpass', 20000, 0.7);
    this.master.connect(this.slowFilter).connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // エンジン: 点火周波数ののこぎり波 + 半分の矩形波を歪ませてローパス
    this.engGain = this.gain(0);
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(4);
    this.engOsc = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.15]].map(([type, mult, vol]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.connect(this.gain(vol)).connect(shaper);
      o.start();
      return { o, mult };
    });
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    const intake = this.loopNoise();
    this.intakeGain = this.gain(0);
    intake.connect(this.filter('bandpass', 700, 1)).connect(this.intakeGain).connect(this.master);

    // スキール音: 帯域を絞ったノイズ + 揺らした三角波
    this.squealGain = this.gain(0);
    this.squealBand = this.filter('bandpass', 1600, 10);
    this.loopNoise().connect(this.squealBand).connect(this.squealGain);
    this.squealTone = ctx.createOscillator();
    this.squealTone.type = 'triangle';
    this.squealTone.frequency.value = 800;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    lfo.connect(this.gain(35)).connect(this.squealTone.frequency);
    this.squealTone.connect(this.gain(0.2)).connect(this.squealGain);
    this.squealTone.start();
    lfo.start();
    this.squealGain.connect(this.master);

    // 風切り・ロードノイズ
    this.windGain = this.gain(0);
    this.loopNoise().connect(this.filter('lowpass', 450, 0.7)).connect(this.windGain).connect(this.master);
  }

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  update({ rpm, throttle, slip, speed }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = rpm / 30; // 4気筒の点火周波数
    for (const { o, mult } of this.engOsc) o.frequency.setTargetAtTime(f * mult, t, 0.02);
    this.engFilter.frequency.setTargetAtTime(250 + throttle * 1800 + rpm * 0.18, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.1 + throttle * 0.18 + rpm / 7000 * 0.08, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(throttle * rpm / 7000 * 0.12, t, 0.05);
    const sq = clamp(slip, 0, 1);
    this.squealGain.gain.setTargetAtTime(sq * sq * 0.45, t, 0.04);
    this.squealBand.frequency.setTargetAtTime(1300 + sq * 900, t, 0.1);
    this.squealTone.frequency.setTargetAtTime(700 + sq * 250, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.35, speed * speed / 4000), t, 0.2);
  }

  // フィルタを通したノイズの一発音
  burst({ dur, freq, type = 'lowpass', q = 1, vol, sweepTo }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.filter(type, freq, q);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.gain(vol);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  // 周波数が下がっていく低音
  thump(f0, f1, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.gain(vol);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  gunshot() {
    this.burst({ dur: 0.13, freq: 2200, type: 'bandpass', q: 0.6, vol: 0.45 });
    this.burst({ dur: 0.04, freq: 5000, type: 'highpass', vol: 0.2 });
    this.thump(170, 45, 0.1, 0.45);
  }

  enemyShot(vol) {
    this.burst({ dur: 0.1, freq: 1400, type: 'bandpass', q: 0.8, vol: 0.3 * vol });
    this.thump(120, 50, 0.08, 0.25 * vol);
  }

  // 敵に狙われた合図
  lockOn(vol) {
    this.thump(1500, 1500, 0.07, 0.08 * vol, 'square');
    setTimeout(() => this.thump(1500, 1500, 0.07, 0.08 * vol, 'square'), 110);
  }

  // ガラスが割れる: 高いノイズと、ちりんと鳴る破片
  glass() {
    this.burst({ dur: 0.25, freq: 5000, type: 'highpass', vol: 0.35 });
    for (let k = 0; k < 4; k++) {
      setTimeout(() => this.thump(2500 + Math.random() * 2500, 2000, 0.08, 0.05, 'triangle'), 40 + k * 60);
    }
  }

  // 消火栓から水が吹き出す
  water() {
    this.burst({ dur: 2.5, freq: 3000, type: 'highpass', vol: 0.18 });
  }

  // 車に火がつく
  ignite() {
    this.burst({ dur: 0.6, freq: 600, sweepTo: 2000, type: 'bandpass', q: 0.8, vol: 0.3 });
  }

  kill() {
    this.thump(880, 1320, 0.12, 0.12, 'triangle');
  }

  hit() {
    this.thump(1900, 1400, 0.05, 0.12, 'square');
  }

  explosion(vol = 1) {
    this.burst({ dur: 1.2, freq: 2000, sweepTo: 100, vol: 0.9 * vol });
    this.thump(90, 25, 0.7, 0.9 * vol);
  }

  impact(strength) {
    const v = clamp(strength / 15, 0.15, 1);
    this.burst({ dur: 0.35, freq: 900, sweepTo: 120, vol: v });
    this.thump(130, 40, 0.25, v);
    this.thump(240, 200, 0.18, v * 0.12, 'square'); // 金属音
  }

  shift() {
    this.burst({ dur: 0.05, freq: 2500, type: 'highpass', vol: 0.05 });
  }

  // ---- BGM: 128BPM の16分音符を少し先まで予約して鳴らす。intensity(0〜3)で楽器が増える ----
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicGain ??= (() => { const g = this.gain(0.2); g.connect(this.master); return g; })();
    this.musicGain.gain.setTargetAtTime(0.2, this.ctx.currentTime, 0.1);
    this.musicStep = 0;
    this.musicNext = this.ctx.currentTime + 0.1;
    this.intensity ??= 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 25);
  }

  stopMusic() {
    if (!this.musicTimer) return;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  setIntensity(n) { this.intensity = n; }

  scheduleMusic() {
    const step = 60 / 128 / 4;
    while (this.musicNext < this.ctx.currentTime + 0.12) {
      this.playStep(this.musicStep, this.musicNext);
      this.musicNext += step;
      this.musicStep = (this.musicStep + 1) % 64;
    }
  }

  playStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16);
    const root = [55, 43.65, 65.41, 49][bar]; // A F C G
    const lv = this.intensity;
    if (s % 4 === 0) this.note('sine', 150, 40, t, 0.25, 0.7);
    if (lv >= 1 && s % 2 === 1) this.noiseHit(t, 0.04, 7000, 'highpass', 0.12);
    if (lv >= 1 && (s === 4 || s === 12)) { this.noiseHit(t, 0.15, 1800, 'bandpass', 0.3); this.note('triangle', 220, 160, t, 0.1, 0.15); }
    if (lv >= 2 && s % 2 === 0) this.note('sawtooth', root * (s % 4 === 2 ? 2 : 1), null, t, 0.16, 0.18, 500);
    if (lv >= 3 && [0, 3, 6, 10, 12].includes(s)) {
      const k = [1, 1.5, 2, 1.5, 1.25][[0, 3, 6, 10, 12].indexOf(s)];
      this.note('square', root * 8 * k, null, t, 0.12, 0.06, 2500);
    }
  }

  // 時刻 t に鳴らす音(f1 があれば周波数が下がる)。BGM 用で musicGain に流す
  note(type, f0, f1, t, dur, vol, lowpass) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = o.connect(g);
    if (lowpass) node = node.connect(this.filter('lowpass', lowpass, 1));
    node.connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(t, dur, freq, type, vol) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const g = this.gain(0);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(this.filter(type, freq, 1)).connect(g).connect(this.musicGain);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  // 体力が少ないときの心音
  heartbeat() {
    this.thump(70, 40, 0.12, 0.5);
    setTimeout(() => this.thump(65, 38, 0.12, 0.35), 160);
  }

  pickup() {
    [660, 880, 1320].forEach((f, k) => setTimeout(() => this.thump(f, f, 0.08, 0.15, 'triangle'), k * 60));
  }

  nitro() {
    this.burst({ dur: 1.2, freq: 300, sweepTo: 3000, type: 'bandpass', q: 0.7, vol: 0.4 });
  }

  // timeScale(1=通常, 0.35=スロー)に合わせて音をこもらせる
  setSlow(timeScale) {
    if (!this.ctx) return;
    this.slowFilter.frequency.setTargetAtTime(timeScale > 0.99 ? 20000 : 600 + timeScale * 4000, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
