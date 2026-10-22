import * as THREE from 'three';

// アイテムの見た目。回る箱と、遠くからでも見える光の柱
const COLORS = { repair: 0x40e070, nitro: 0x40a0ff, ammo: 0xffc030 };
const boxGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 40, 12, 1, true);

export class PickupView {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map(); // id → Group
    this.time = 0;
  }

  // pickups.list と見た目をそろえる
  sync(list, dt) {
    this.time += dt;
    const alive = new Set(list.map(p => p.id));
    for (const [id, g] of this.meshes) {
      if (alive.has(id)) continue;
      this.scene.remove(g);
      this.meshes.delete(id);
    }
    for (const p of list) {
      let g = this.meshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const c = COLORS[p.type];
        const box = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.5 }));
        box.position.y = 1.2;
        const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.y = 20;
        g.add(box, beam);
        g.userData.box = box;
        g.position.set(p.x, 0, p.z);
        this.scene.add(g);
        this.meshes.set(p.id, g);
      }
      g.userData.box.rotation.y = this.time * 2;
      g.userData.box.position.y = 1.2 + Math.sin(this.time * 3 + p.id) * 0.25;
    }
  }

  clear() {
    for (const g of this.meshes.values()) this.scene.remove(g);
    this.meshes.clear();
  }
}
