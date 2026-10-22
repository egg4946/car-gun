import * as THREE from 'three';

const MAX_MARKS = 1500;
const MAX_SMOKE = 48;
const MAX_HOLES = 180;
const MAX_SHELLS = 16;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// タイヤ痕とタイヤスモーク
export class Effects {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x111111, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.marks = new THREE.InstancedMesh(geo, mat, MAX_MARKS);
    this.marks.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_MARKS; i++) this.marks.setMatrixAt(i, zero);
    scene.add(this.marks);
    this.markIdx = 0;
    this.last = [null, null];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);

    const tex = puffTexture();
    this.smoke = [];
    for (let i = 0; i < MAX_SMOKE; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.smoke.push({ sprite: s, life: 0, vel: new THREE.Vector3() });
    }
    this.smokeIdx = 0;
    this.smokeTimer = 0;

    // 弾痕。壁・地面の法線に合わせて薄い円を貼る。
    this.holes = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.09, 8),
      new THREE.MeshBasicMaterial({
        color: 0x141414, transparent: true, opacity: 0.82, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4,
      }),
      MAX_HOLES
    );
    this.holes.frustumCulled = false;
    for (let i = 0; i < MAX_HOLES; i++) this.holes.setMatrixAt(i, zero);
    this.holes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.holes);
    this.holeIdx = 0;
    this.holePos = new THREE.Vector3();
    this.holeN = new THREE.Vector3();
    this.holeQ = new THREE.Quaternion();
    this.holeM = new THREE.Matrix4();
    this.holeScale = new THREE.Vector3();
    this.zAxis = new THREE.Vector3(0, 0, 1);

    // 薬莢。撃つたびにコックピット右側から飛ばす。
    this.shells = [];
    const shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6);
    const shellMat = new THREE.MeshLambertMaterial({ color: 0xc8a040 });
    for (let i = 0; i < MAX_SHELLS; i++) {
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      mesh.visible = false;
      scene.add(mesh);
      this.shells.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.shellIdx = 0;
  }

  addHole(point, normal) {
    this.holeN.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (this.holeN.lengthSq() < 1e-8) this.holeN.set(0, 1, 0);
    this.holeN.normalize();
    this.holeQ.setFromUnitVectors(this.zAxis, this.holeN);
    this.holePos.copy(point).addScaledVector(this.holeN, 0.012);
    this.holeScale.setScalar(0.75 + Math.random() * 0.5);
    this.holeM.compose(this.holePos, this.holeQ, this.holeScale);
    this.holes.setMatrixAt(this.holeIdx, this.holeM);
    this.holeIdx = (this.holeIdx + 1) % MAX_HOLES;
    this.holes.instanceMatrix.needsUpdate = true;
  }

  ejectShell(pos, vel) {
    const s = this.shells[this.shellIdx];
    this.shellIdx = (this.shellIdx + 1) % MAX_SHELLS;
    s.mesh.position.copy(pos);
    s.mesh.rotation.set(0, 0, 0);
    s.mesh.visible = true;
    s.vel.copy(vel);
    s.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    s.life = s.max = 1.2;
  }

  addMark(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.m.compose(new THREE.Vector3((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2), this.q, new THREE.Vector3(0.24, 1, len + 0.05));
    this.marks.setMatrixAt(this.markIdx, this.m);
    this.markIdx = (this.markIdx + 1) % MAX_MARKS;
    this.marks.instanceMatrix.needsUpdate = true;
  }

  update(dt, car) {
    const rears = [car.localToGround(-0.82, 1.35), car.localToGround(0.82, 1.35)];
    for (let i = 0; i < 2; i++) {
      if (!car.skidding) { this.last[i] = null; continue; }
      if (!this.last[i]) { this.last[i] = rears[i]; continue; }
      if (rears[i].distanceTo(this.last[i]) > 0.4) {
        this.addMark(this.last[i], rears[i]);
        this.last[i] = rears[i];
      }
    }

    this.smokeTimer -= dt;
    if (car.slip > 0.3 && this.smokeTimer <= 0) {
      this.smokeTimer = 0.06 / car.slip;
      const s = this.smoke[this.smokeIdx];
      this.smokeIdx = (this.smokeIdx + 1) % MAX_SMOKE;
      s.sprite.position.copy(rears[Math.random() < 0.5 ? 0 : 1]).setY(0.4);
      s.vel.set((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2);
      s.life = s.max = 1.2 + Math.random() * 0.6;
      s.strength = car.slip;
      s.sprite.visible = true;
    }
    for (const s of this.smoke) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = 1 - s.life / s.max;
      s.sprite.position.addScaledVector(s.vel, dt);
      s.sprite.scale.setScalar(1 + k * 4);
      s.sprite.material.opacity = Math.max(0, (1 - k) * 0.45 * s.strength);
      if (s.life <= 0) s.sprite.visible = false;
    }

    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 18 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < 0.03 && s.vel.y < 0) {
        s.mesh.position.y = 0.03;
        s.vel.y *= -0.3;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.spin.multiplyScalar(0.6);
      }
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
}
