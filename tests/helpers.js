import * as THREE from 'three';
import { Vehicle } from '../src/vehicle.js';
import { World } from '../src/world.js';

export const DT = 1 / 60;
export const keys = (o = {}) => ({ up: false, down: false, left: false, right: false, handsOff: false, handbrake: false, ...o });
export const kmh = v => v * 3.6;
export const deg = r => r * 180 / Math.PI;

export function carAt(speedKmh = 0, x = 0, z = 0, yaw = 0) {
  const v = new Vehicle();
  v.reset(x, z, yaw);
  v.vx = -Math.sin(yaw) * speedKmh / 3.6;
  v.vz = -Math.cos(yaw) * speedKmh / 3.6;
  return v;
}

// 自動生成せず、テスト用のビルだけを置いた街
export function emptyWorld(...boxes) {
  const w = new World(new THREE.Scene());
  w.boxes.push(...boxes);
  return w;
}

export function run(v, secs, input, world, each, dt = DT) {
  for (let t = 0; t < secs; t += dt) {
    v.update(dt, typeof input === 'function' ? input(v, t) : input, world);
    each?.(v, t);
  }
}

export function insideBox(v, b) {
  return v.x > b.minX && v.x < b.maxX && v.z > b.minZ && v.z < b.maxZ;
}
