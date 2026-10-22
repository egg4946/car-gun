import * as THREE from 'three';

// キャンバスで作るテクスチャ。DOM が無い(Node)ときは null を返す。
const hasDOM = () => typeof document !== 'undefined';
let roadTex = null, facadeTex = null;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

// 60m 四方の 1 タイル。左上が世界座標 (60k, 60k)。道路は 22..38 (中心 30)、交差点は中央。
export function roadTexture(repeat) {
  if (!hasDOM()) return null;
  if (roadTex) return roadTex;
  const S = 1024, k = S / 60;
  const c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#44474c';
  g.fillRect(0, 0, S, S);
  // アスファルトのざらつき
  for (let i = 0; i < 9000; i++) {
    const v = 55 + Math.random() * 30 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // 補修跡っぽいムラ
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(30,32,36,${0.08 + Math.random() * 0.08})`;
    g.fillRect(Math.random() * S, Math.random() * S, 40 + Math.random() * 120, 30 + Math.random() * 90);
  }
  // 縦の道路(x 方向が横)で描き、転置して横の道路にも描く
  const both = (fn) => { fn((x, z, w, h) => g.fillRect(x * k, z * k, w * k, h * k)); fn((x, z, w, h) => g.fillRect(z * k, x * k, h * k, w * k)); };
  both(rect => {
    // 外側線
    g.fillStyle = '#e8e8e2';
    rect(22.3, 0, 0.15, 17); rect(37.55, 0, 0.15, 17);
    rect(22.3, 43, 0.15, 17); rect(37.55, 43, 0.15, 17);
    // 中央の黄色二重線 (z 44..60 と 0..16 は繋がっている)
    g.fillStyle = '#e8b830';
    for (const x of [29.72, 30.13]) { rect(x, 0, 0.15, 16); rect(x, 44, 0.15, 16); }
    // 車線の破線
    g.fillStyle = '#e8e8e2';
    for (const x of [25.93, 33.93]) for (const z of [44, 50, 56, 2, 8]) rect(x, z, 0.15, 3);
    // 停止線: +z 方向に進む車線(x 30..38)は交差点手前 z=16、-z 方向(x 22..30)は z=44
    rect(30.3, 15.6, 7.4, 0.45);
    rect(22.3, 44, 7.4, 0.45);
    // 横断歩道
    for (let x = 22.6; x < 37.5; x += 1) { rect(x, 17.2, 0.5, 4); rect(x, 38.8, 0.5, 4); }
  });
  roadTex = finish(c, repeat);
  return roadTex;
}

// ビルの壁: 横 12m(4スパン) x 縦 14m(4階) で 1 回分。色は頂点色で掛ける。
export function facadeTexture() {
  if (!hasDOM()) return null;
  if (facadeTex) return facadeTex;
  const S = 256, bx = S / 4, by = S / 4;
  const c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#f2f0ea';
  g.fillRect(0, 0, S, S);
  for (let fy = 0; fy < 4; fy++) {
    // 階の境目の帯
    g.fillStyle = '#d6d3cc';
    g.fillRect(0, fy * by + by - 6, S, 6);
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * bx + 8, y = fy * by + 12, w = bx - 16, h = by - 26;
      g.fillStyle = '#8a8d90';
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      const lit = Math.random() < 0.25;
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, lit ? '#c9c2a0' : '#5d7286');
      grd.addColorStop(1, lit ? '#9a9478' : '#2e3a48');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, w * 0.35, h);
      g.fillStyle = '#7a7d80';
      g.fillRect(x + w / 2 - 1, y, 2, h);
    }
  }
  facadeTex = finish(c);
  return facadeTex;
}
