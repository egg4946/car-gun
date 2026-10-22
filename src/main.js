import * as THREE from 'three';
import { World, START } from './world.js';
import { Forest, START as FOREST_START, BACKGROUND_COLOR, FOG_COLOR, FOG_NEAR, FOG_FAR } from './forest.js';
import { Car } from './car.js';
import { Enemies } from './enemies.js';
import { Destructibles } from './destructibles.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Weapon } from './weapon.js';
import { Combo } from './ai.js';
import { judgeKill, Stats, titleFor } from './style.js';
import { Wanted, HEAT } from './wanted.js';
import { Focus } from './focus.js';
import { Traffic } from './traffic.js';
import { Pickups } from './pickups.js';
import { PickupView } from './pickupView.js';

const ROUND = 90;
const GAME_URL = 'https://car-gun.egg4946.workers.dev/'; // 公開先(Cloudflare)。シェアに付ける
const $ = id => document.getElementById(id);
const forestMap = new URLSearchParams(location.search).get('map') === 'forest';
const spawn = forestMap ? FOREST_START : START;
$('map').value = forestMap ? 'forest' : 'city';
// ページ単位で切り替え、前のマップの敵・衝突箱・描画資源を持ち越さない。
$('map').addEventListener('change', () => {
  const url = new URL(location.href);
  if ($('map').value === 'forest') url.searchParams.set('map', 'forest');
  else url.searchParams.delete('map');
  location.assign(url.href);
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(forestMap ? BACKGROUND_COLOR : 0xa9c4dc);
scene.fog = forestMap
  ? new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)
  : new THREE.Fog(0xa9c4dc, 50, 200);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a5a55, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(80, 120, 40);
scene.add(sun);

const world = forestMap ? new Forest(scene) : new World(scene);
const car = new Car(scene);
const sound = new Sound();
const enemies = new Enemies(scene, world, sound);
const destructibles = new Destructibles(scene, world, sound);
const effects = new Effects(scene);
const weapon = new Weapon();
const combo = new Combo();
// 一般車は碁盤の目の街だけ(森の曲がった道では車線走行できない)
const traffic = forestMap ? null : new Traffic(scene, world, sound);
const pickups = new Pickups();
const pickupView = new PickupView(scene);

const input = { up: false, down: false, left: false, right: false, handsOff: false, handbrake: false };
const noInput = { ...input };
let state = 'title', score = 0, hp = 100, timeLeft = ROUND, elapsed = 0, kills = 0, destroyed = 0;
let wallCd = 0, firing = false;
let stats = new Stats();
let wanted = new Wanted();
let focus = new Focus(), focusWant = false;
let hitstop = 0, heartTimer = 0, nitroTimer = 0, timeFlash = 0;
let hintIdx = 0, hintTime = 0, tutorialDone = false;
let flashCd = 0;
let hadLock = false, lockLost = false;
let reduceFx = false;
try { reduceFx = localStorage.getItem('driveby-reducefx') === '1'; } catch {}

const keyMap = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'handsOff', ShiftLeft: 'handbrake', ShiftRight: 'handbrake',
};
addEventListener('keydown', e => {
  if (keyMap[e.code]) { input[keyMap[e.code]] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyC') car.toggleView();
  if (e.code === 'KeyM') sound.toggleMute();
});
addEventListener('keyup', e => { if (keyMap[e.code]) input[keyMap[e.code]] = false; });
addEventListener('mousemove', e => { if (state === 'play') car.look(e.movementX, e.movementY); });
addEventListener('mousedown', e => {
  if (state !== 'play') return;
  // Esc でロックを外した後の最初のクリックは、射撃せずロックし直す
  if (lockLost && !document.pointerLockElement) { lockPointer(); return; }
  // 右クリック長押しで集中(スロー)、それ以外は射撃
  if (e.button === 2) focusWant = true;
  else firing = true;
  if (!document.pointerLockElement) lockPointer();
});
addEventListener('mouseup', e => {
  if (e.button === 2) focusWant = false;
  else firing = false;
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k in input) input[k] = false; firing = false; focusWant = false; });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  car.camera.aspect = innerWidth / innerHeight;
  car.camera.updateProjectionMatrix();
});

// ポインタロックできない環境(iframe等)でも遊べるように失敗は無視する
function lockPointer() {
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch {}
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { hadLock = true; lockLost = false; }
  else if (hadLock) lockLost = true;
});
document.addEventListener('pointerlockerror', () => { hadLock = false; lockLost = false; });

const fxToggle = $('reducefx');
if (fxToggle) {
  fxToggle.checked = reduceFx;
  fxToggle.addEventListener('change', () => {
    reduceFx = fxToggle.checked;
    try { localStorage.setItem('driveby-reducefx', reduceFx ? '1' : '0'); } catch {}
  });
}

function start() {
  score = 0; hp = 100; timeLeft = ROUND; elapsed = 0; kills = 0; destroyed = 0;
  car.reset(spawn);
  world.update(spawn.x, spawn.z);
  enemies.clear();
  destructibles.clear();
  stats = new Stats();
  wanted = new Wanted();
  focus = new Focus();
  weapon.reset();
  traffic?.clear();
  pickups.clear();
  pickupView.clear();
  hitstop = heartTimer = nitroTimer = 0;
  hintIdx = hintTime = 0;
  combo.multiplier = 1; combo.timer = 0;
  car.view = 'cockpit';
  state = 'play';
  document.body.classList.add('playing');
  sound.init();
  sound.startMusic();
  $('screen').classList.add('hidden');
  lockPointer();
}

function end(reason) {
  state = 'over';
  firing = false;
  focusWant = false;
  tutorialDone = true;
  document.body.classList.remove('playing');
  car.view = 'chase';
  sound.stopMusic();
  $('hint').className = '';
  document.exitPointerLock?.();
  stats.destroyed = destroyed;
  const title = titleFor(stats);
  const best = loadBest();
  const record = score > best;
  if (record) saveBest(score);
  $('title').textContent = reason === 'dead' ? 'GAME OVER' : 'TIME UP';
  $('msg').innerHTML = `称号 <b class="rank">「${title}」</b><br>`
    + `SCORE <b style="font-size:36px">${score}</b> ${record ? '<span class="new">自己ベスト更新！</span>' : `(ベスト ${best})`}<br>`
    + `<span class="stats">撃破 ${kills}　破壊 ${destroyed}　最高コンボ x${stats.maxCombo}<br>`
    + `最長ドリフト ${stats.longestDrift.toFixed(1)}秒　最長手放し ${stats.longestHandsOff.toFixed(1)}秒　最高 ${Math.round(stats.maxKmh)}km/h</span>`;
  const text = `称号「${title}」${score}点(${kills}撃破・${destroyed}破壊・最長手放し${stats.longestHandsOff.toFixed(1)}秒)。ハンドルを離して撃て！ #ドライブバイガンナー`;
  $('share').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(GAME_URL);
  $('share').classList.remove('hidden');
  $('start').textContent = 'RETRY';
  $('screen').classList.remove('hidden');
}

// 自己ベスト(保存できない環境でも遊べるように失敗は無視)
function loadBest() {
  try { return Number(localStorage.getItem('driveby-best')) || 0; } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('driveby-best', String(v)); } catch {}
}

$('start').addEventListener('click', e => { e.stopPropagation(); start(); });

// ---- プレイヤーの射撃 ----
const ray = new THREE.Raycaster();
ray.far = 150;
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffee88 });
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

function shoot() {
  // 走りながら・ドリフトしながらだと弾がばらける
  const spread = weapon.spread(car.speed, car.phys.yawRate);
  car.camera.getWorldDirection(_dir);
  _dir.x += (Math.random() - 0.5) * 2 * spread;
  _dir.y += (Math.random() - 0.5) * 2 * spread;
  _dir.z += (Math.random() - 0.5) * 2 * spread;
  _dir.normalize();
  car.camera.getWorldPosition(_from);
  const fx = car.fire();
  sound.gunshot();
  if (fx.eject) effects.ejectShell(fx.eject, fx.shellVel);
  ray.set(_from, _dir);

  // 建物・地面・木のどこで止まるか。小物は destructibles が別に判定する。
  const wh = world.raycast ? world.raycast(_from, _dir, ray.far) : null;
  const limit = wh ? wh.t : ray.far;
  const targets = traffic ? [...enemies.hitMeshes, ...traffic.hitMeshes] : enemies.hitMeshes;
  const hit = ray.intersectObjects(targets, false).find(h => h.distance <= limit);
  // 手前に小物(街灯・自販機・ドラム缶など)があればそちらに当たる
  const ph = destructibles.raycast(_from, _dir, hit ? hit.distance : limit);
  const propHit = ph && (!hit || ph.t < hit.distance)
    ? { prop: ph.prop, point: _from.clone().addScaledVector(_dir, ph.t) }
    : null;
  const enemyHit = propHit ? null : hit;
  const worldPoint = !enemyHit && !propHit && wh ? _from.clone().addScaledVector(_dir, wh.t) : null;
  const to = enemyHit ? enemyHit.point : propHit ? propHit.point : worldPoint ?? _from.clone().addScaledVector(_dir, 90);

  // コックピットでは銃口から、三人称ではカメラから線を引く。
  // 銃口が着弾点より先にある近距離では、カメラから引く。
  const muzzleGap = fx.muzzle ? fx.muzzle.distanceTo(_from) : Infinity;
  const start = car.view === 'cockpit' && to.distanceTo(_from) > muzzleGap + 0.4 ? fx.muzzle : _from.clone();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, to]), tracerMat);
  scene.add(line);
  setTimeout(() => { scene.remove(line); line.geometry.dispose(); }, 50);

  if (propHit) {
    const surface = propHit.prop.kind === 'tree' ? 'wood' : 'hard';
    destructibles.impact(to.x, to.y, to.z, 0, 1, 0, surface);
    sound.bulletImpact(surface);
    destructibles.shoot(propHit.prop, 1);
    return;
  }
  if (!enemyHit) {
    if (wh && worldPoint) {
      effects.addHole(worldPoint, { x: wh.nx, y: wh.ny, z: wh.nz });
      destructibles.impact(worldPoint.x, worldPoint.y, worldPoint.z, wh.nx, wh.ny, wh.nz, wh.surface);
      sound.bulletImpact(wh.surface);
    }
    return;
  }
  sound.hit();
  hitMarker();
  const civ = enemyHit.object.userData.civ;
  if (civ) traffic.damage(civ, 1);
  else enemies.damage(enemyHit.object.userData.enemy, enemyHit.object.userData.weakspot ? 2 : 1, car);
}

enemies.onKill = ({ type, how, points, x, y, z }) => {
  kills++;
  // どんな状況で倒したか(ドリフト中、後ろ向き、手放しが長い…)で倍率がつく
  const dx = x - car.pos.x, dz = z - car.pos.z;
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  const aimDeg = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1)))) * 180 / Math.PI;
  const style = judgeKill({ how, slipDeg: car.phys.bodySlip * 180 / Math.PI, handsOffTime: stats.handsOffTime, aimDeg, kmh: Math.abs(car.speed) * 3.6, dist: Math.hypot(dx, dz) });
  const got = combo.add(Math.round(points * style.mult));
  score += got;
  stats.kill(how, style.tags);
  focus.onKill();
  heat(HEAT[type] ?? HEAT.boss);
  // 倒すほど長く遊べる(ボスは大きく延びる)
  const boss = type === 'truck' || type === 'heli';
  timeLeft = Math.min(99, timeLeft + (boss ? 10 : 2));
  timeFlash = 0.6;
  hitstop = boss ? 0.18 : 0.05;
  stats.maxCombo = Math.max(stats.maxCombo, combo.multiplier);
  sound.kill();
  const label = { shot: '撃破', runover: '轢いた！', ram: '体当たり撃破！', blast: '巻き込み！' }[how];
  const tags = style.tags.filter(t => t !== '巻き込み');
  popup(`${tags.length ? tags.join('・') + '！ ' : ''}${label} +${got}${combo.multiplier > 1 ? ` x${combo.multiplier}` : ''}`,
    new THREE.Vector3(x, y + 2.5, z), how !== 'shot' || tags.length > 0);
};

// ---- 破壊 ----
enemies.onWreck = (mesh, vx, vz) => destructibles.addWreck(mesh, vx, vz);
enemies.onBlast = (x, y, z, r) => destructibles.explode(x, y, z, r);

// 爆発(ドラム缶・駐車車両・追跡車)。敵を巻き込み、近ければ自分も吹き飛ぶ
destructibles.onExplode = (x, y, z, r) => {
  const d = Math.hypot(x - car.pos.x, z - car.pos.z);
  sound.explosion(Math.max(0.3, 1 - d / 120));
  car.addTrauma(Math.max(0, 0.9 - d / 60));
  if (state !== 'play') return;
  enemies.blast(x, y, z, r, car);
  for (const c of [...(traffic?.list ?? [])]) {
    if (Math.hypot(c.vehicle.x - x, c.vehicle.z - z) < r) traffic.damage(c, 99);
  }
  if (d < r) {
    const k = 1 - d / r;
    damage(Math.round(25 * k));
    const nx = (car.pos.x - x) / (d || 1), nz = (car.pos.z - z) / (d || 1);
    car.phys.applyImpulse(car.pos.x, car.pos.z, nx * 9000 * k, nz * 9000 * k);
    car.jolt(12 * k, { x: nx, z: nz });
  }
};

const PROP_NAMES = { lamp: '街灯', signal: '信号', tree: '木', bench: 'ベンチ', vending: '自販機', hydrant: '消火栓', barrel: 'ドラム缶', parked: '駐車車両', glass: 'ガラス' };
// 破壊はおまけの加点(コンボ倍率はかけない)
destructibles.onDestroy = ({ kind, by, points, x, y, z }) => {
  // 敵の車がなぎ倒した物は数えない
  if (state !== 'play' || (by && by !== car.phys)) return;
  destroyed++;
  score += points;
  heat(kind === 'barrel' || kind === 'parked' ? HEAT.explosion : HEAT.prop);
  popup(`${PROP_NAMES[kind]} +${points}`, new THREE.Vector3(x, y + 1, z), false, true);
};

// ---- 一般車 ----
if (traffic) {
  traffic.onWreck = (mesh, vx, vz) => destructibles.addWreck(mesh, vx, vz);
  traffic.onBlast = (x, y, z, r) => destructibles.explode(x, y, z, r);
  traffic.onPlayerHit = dmg => { if (state === 'play') damage(dmg); };
  traffic.onDestroy = ({ points, x, y, z }) => {
    if (state !== 'play') return;
    destroyed++;
    score += points;
    heat(1.5);
    popup(`一般車 +${points}`, new THREE.Vector3(x, y + 1, z), false, true);
  };
}

// ---- アイテム ----
const PICKUP_TEXT = { repair: 'リペア！ HP+35', nitro: 'ニトロ！', ammo: '無限弾 8秒！' };
function collect(p) {
  sound.pickup();
  banner(PICKUP_TEXT[p.type]);
  if (p.type === 'repair') hp = Math.min(100, hp + 35);
  if (p.type === 'nitro') { nitroTimer = 4; car.phys.boost = 2.2; car.fovKick = 10; sound.nitro(); }
  if (p.type === 'ammo') { weapon.infinite = 8; weapon.ammo = weapon.magSize; }
}

// ---- チュートリアル(最初の1回だけ) ----
const HINTS = [
  { text: 'W で加速、A/D で曲がる。Shift でサイドブレーキ', done: () => elapsed > 5 },
  { text: 'Space を押している間ハンドルを離せる。マウスで狙ってクリックで撃て！', done: () => stats.handsOffTime > 1.5 || kills > 0 },
  { text: 'ハンドルを握ると弾が補充される', done: () => hintTime > 4 },
  { text: 'ドリフトで集中ゲージが溜まる。右クリック長押しでスロー！', done: () => focus.active || hintTime > 8 },
  { text: '光の柱はアイテム。倒すと時間が延びる。暴れるほど手配度★が上がる', done: () => hintTime > 6 },
];
function updateHint(dt) {
  if (tutorialDone || state !== 'play' || hintIdx >= HINTS.length) { $('hint').className = ''; return; }
  hintTime += dt;
  $('hint').textContent = HINTS[hintIdx].text;
  $('hint').className = 'show';
  if (hintTime > 2 && HINTS[hintIdx].done()) { hintIdx++; hintTime = 0; }
}

// ---- 手配度 ----
function heat(amount) {
  const r = wanted.add(amount);
  if (r.levelUp) banner(`手配度 ${'★'.repeat(r.level)}`, r.level >= 4 ? 'danger' : '');
}
const BOSS_NAMES = { truck: '装甲トラック接近！', heli: '武装ヘリ接近！' };
enemies.onBoss = type => { banner(BOSS_NAMES[type], 'danger'); sound.lockOn(1); };

let bannerTimer = 0;
function banner(text, cls) {
  $('banner').textContent = text;
  $('banner').className = 'show ' + (cls ?? '');
  bannerTimer = 2;
}

enemies.onPlayerHit = (dmg, fromX, fromZ, rammed) => {
  if (state !== 'play') return;
  damage(dmg);
  if (!rammed) showDamageDir(fromX, fromZ);
  car.addTrauma(rammed ? 0 : 0.2);
};

// ---- HUD ----
function damage(n) {
  hp -= n;
  if (flashCd <= 0) {
    $('flash').style.opacity = reduceFx ? 0.22 : 1;
    setTimeout(() => { $('flash').style.opacity = 0; }, reduceFx ? 70 : 110);
    flashCd = 0.15;
  }
  if (hp <= 0) end('dead');
}

let hitTimer = 0;
function hitMarker() {
  hitTimer = 0.12;
  $('hitmark').style.opacity = 1;
}

let dmgTimer = 0;
function showDamageDir(x, z) {
  car.camera.getWorldDirection(_dir);
  const f = Math.hypot(_dir.x, _dir.z) || 1;
  const fx = _dir.x / f, fz = _dir.z / f;
  const dx = x - car.pos.x, dz = z - car.pos.z;
  const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz); // 右が正
  $('dmgdir').style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
  $('dmgdir').style.opacity = 1;
  dmgTimer = 1;
}

const popups = [];
function popup(text, pos, big, small) {
  const el = document.createElement('div');
  el.className = 'popup' + (big ? ' big' : '') + (small ? ' small' : '');
  el.textContent = text;
  $('popups').appendChild(el);
  popups.push({ el, pos, life: 1.2 });
}
const _p = new THREE.Vector3();
function updatePopups(dt) {
  for (const p of [...popups]) {
    p.life -= dt;
    p.pos.y += dt * 1.5;
    _p.copy(p.pos).project(car.camera);
    const vis = _p.z < 1 && p.life > 0;
    p.el.style.display = vis ? '' : 'none';
    p.el.style.left = (_p.x * 0.5 + 0.5) * innerWidth + 'px';
    p.el.style.top = (-_p.y * 0.5 + 0.5) * innerHeight + 'px';
    p.el.style.opacity = Math.min(1, p.life * 2);
    if (p.life <= 0) { p.el.remove(); popups.splice(popups.indexOf(p), 1); }
  }
}

function updateHud(dt) {
  const p = car.phys;
  $('time').textContent = Math.max(0, Math.ceil(timeLeft));
  $('score').textContent = score;
  $('hp').style.width = Math.max(0, hp) + '%';
  $('kmh').textContent = Math.round(Math.abs(p.speed) * 3.6);
  $('gear').textContent = p.reverse ? 'R' : p.gear;
  $('rpm').style.width = Math.min(100, p.rpm / 70) + '%';
  $('rpm').className = p.rpm > 6000 ? 'red' : '';
  $('ammoNum').textContent = weapon.infinite > 0 ? '∞' : weapon.ammo;
  $('ammoMax').textContent = weapon.infinite > 0 ? '' : ` / ${weapon.magSize}`;
  $('ammo').className = weapon.infinite <= 0 && weapon.ammo === 0 ? 'empty' : '';
  $('reload').textContent = weapon.infinite > 0
    ? `無限弾 残り${weapon.infinite.toFixed(1)}秒`
    : weapon.ammo === weapon.magSize ? '' : input.handsOff ? 'ハンドルを握ると補充' : '補充中…';
  $('combo').textContent = combo.multiplier > 1 ? `COMBO x${combo.multiplier}` : '';
  $('mode').textContent = input.handsOff
    ? 'GUN — ハンドル離し中！車が曲がっていく'
    : 'DRIVING — Spaceでハンドルを離して撃つ';
  $('mode').className = input.handsOff ? 'gun' : '';
  $('cross').className = input.handsOff ? 'on' : '';
  const spread = weapon.spread(car.speed, p.yawRate);
  // 実際のばらつき(角度)を画面のピクセルに直し、照準リングの大きさを合わせる
  const halfPx = Math.tan(spread * 1.15) / Math.tan(car.camera.fov * Math.PI / 360) * innerHeight / 2;
  const crossSize = Math.round(Math.min(180, Math.max(14, halfPx * 2)));
  $('cross').style.width = $('cross').style.height = crossSize + 'px';
  hitTimer -= dt;
  if (hitTimer <= 0) $('hitmark').style.opacity = 0;
  dmgTimer -= dt;
  $('dmgdir').style.opacity = Math.max(0, dmgTimer);
  updatePopups(dt);
  $('focus').style.width = focus.gauge * 100 + '%';
  $('focusbar').className = focus.gauge >= 0.3 ? 'ready' : '';
  $('slowfx').style.opacity = (1 - focus.timeScale) / (1 - 0.35);
  flashCd = Math.max(0, flashCd - dt);
  // 体力が少ないと画面のふちが赤く脈打ち、心音が鳴る
  const low = state === 'play' && hp < 30;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  $('lowhp').style.opacity = low ? (reduceFx ? 0.22 + 0.12 * pulse : 0.55 + 0.45 * pulse) : 0;
  heartTimer -= dt;
  if (low && heartTimer <= 0) { sound.heartbeat(); heartTimer = 0.9; }
  const kmh = Math.abs(p.speed) * 3.6;
  $('speedlines').style.opacity = Math.min(0.8, Math.max(0, (kmh - 90) / 60) + (nitroTimer > 0 ? 0.6 : 0));
  timeFlash -= dt;
  $('time').className = timeFlash > 0 ? 'plus' : '';
  updateHint(dt);
  $('stars').textContent = '★'.repeat(wanted.level) + '☆'.repeat(5 - wanted.level);
  $('stars').className = wanted.level >= 4 ? 'hot' : '';
  // ボスの体力バー(複数いるときは近いほう)
  let boss = null, bossDist = Infinity;
  for (const e of enemies.list) {
    if (e.type !== 'truck' && e.type !== 'heli') continue;
    const d = Math.hypot(e.mesh.position.x - car.pos.x, e.mesh.position.z - car.pos.z);
    if (d < bossDist) { boss = e; bossDist = d; }
  }
  $('bosshp').classList.toggle('hidden', !(state === 'play' && boss));
  if (state === 'play' && boss) {
    $('bossname').textContent = boss.type === 'truck' ? '装甲トラック' : '武装ヘリ';
    $('bossfill').style.width = Math.max(0, Math.min(100, boss.hp / (boss.maxHp || 1) * 100)) + '%';
  }
  bannerTimer -= dt;
  if (bannerTimer <= 0) $('banner').className = '';
}

// ---- メインループ ----
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const realDt = Math.min(clock.getDelta(), 0.05);
  const playing = state === 'play';
  // 集中中は世界の時間だけ遅くする(照準・カメラ・連射は実時間のまま)
  const timeScale = playing
    ? focus.update(realDt, { slipDeg: car.phys.bodySlip * 180 / Math.PI, kmh: Math.abs(car.speed) * 3.6, want: focusWant })
    : 1;
  let dt = realDt * timeScale;
  // 撃破の瞬間だけ一瞬止める(ヒットストップ)
  if (hitstop > 0) { hitstop -= realDt; dt *= 0.08; }

  if (playing) {
    elapsed += dt;
    timeLeft -= dt;
    car.update(dt, input, world);
    // 射撃の前にカメラを現在の照準へ同期する(前フレームの向きで撃たない)
    car.sync(realDt);
    wallCd -= dt;
    const impact = car.phys.impact;
    if (impact > 1.5) {
      sound.impact(impact);
      car.addTrauma(Math.min(0.9, impact / 14));
      if (impact > 6 && wallCd <= 0) { damage(Math.round(impact * 0.8)); wallCd = 0.4; }
    }
    const shots = weapon.update(realDt, { handsOff: input.handsOff, trigger: firing });
    for (const _ of shots) shoot();
    if (weapon.dry) { sound.dry(); car.addTrauma(0.006); }
    stats.update(dt, { slipDeg: car.phys.bodySlip * 180 / Math.PI, handsOff: input.handsOff, kmh: Math.abs(car.speed) * 3.6 });
    for (const it of pickups.update(dt, car.pos, () => world.roadSpot(car.pos.x, car.pos.z, 40, 110))) collect(it);
    // ニトロ中は後ろから炎
    if (nitroTimer > 0) {
      nitroTimer -= dt;
      if (nitroTimer <= 0) car.phys.boost = 1;
      const back = car.localToGround(0, 2.4);
      destructibles.emit('fire', back.x, 0.5, back.z, car.phys.vx * 0.5, 0.5, car.phys.vz * 0.5, 0.25, 0.7);
    }
    combo.update(dt);
  } else {
    car.update(dt, noInput, world);
    car.sync(realDt);
  }
  if (state === 'play') wanted.update(dt);
  enemies.update(dt, car, elapsed, state === 'play', wanted.level);
  traffic?.update(dt, car, state === 'play');
  pickupView.sync(pickups.list, dt);
  // BGM は手配度・コンボ・ボスで激しくなる
  const bossOut = enemies.list.some(e => e.type === 'truck' || e.type === 'heli');
  sound.setIntensity(bossOut || wanted.level >= 4 ? 3 : wanted.level >= 2 || combo.multiplier >= 3 ? 2 : wanted.level >= 1 || elapsed > 15 ? 1 : 0);
  if (state === 'play' && timeLeft <= 0) end('time');

  world.update(car.pos.x, car.pos.z);
  destructibles.update(dt);
  effects.update(dt, car);
  const p = car.phys;
  sound.update({ rpm: p.rpm, throttle: p.throttle, slip: car.slip, speed: Math.abs(p.speed) });
  sound.setSlow(timeScale);
  if (p.shifted) sound.shift();
  updateHud(realDt);
  renderer.render(scene, car.camera);
}
// 開発時のみ: 自動テスト(Playwright)から状態を覗けるようにする
if (import.meta.env.DEV) {
  window.__game = { car, enemies, weapon, world, destructibles, effects, traffic, pickups, scene, get state() { return state; }, get score() { return score; }, get hp() { return hp; }, get kills() { return kills; }, get destroyed() { return destroyed; }, get stats() { return stats; }, get wanted() { return wanted; }, get focus() { return focus; }, end, renderer };
}
car.reset(spawn);
document.body.classList.remove('playing');
car.view = 'chase'; // タイトルはコックピットのダッシュボードではなく街を見せる
loop();
