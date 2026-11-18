// Suivi des mains WebXR : accès aux articulations, rendu sobre des mains,
// bout de l'index (pour toucher) et orientation de la paume.
import * as THREE from 'three';
import { C } from '../ui/theme.js';

const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

class Hand {
  constructor(renderer, index, parent) {
    this.group = renderer.xr.getHand(index);
    this.handedness = null;
    this.lastSeen = -Infinity;
    parent.add(this.group);

    this.group.addEventListener('connected', (e) => {
      this.handedness = e.data.hand ? e.data.handedness : null;
    });
    this.group.addEventListener('disconnected', () => { this.handedness = null; });

    // Mains : petites sphères grises chaudes semi-transparentes, index en chêne.
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, JOINTS.length);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    const skin = new THREE.Color(C.hand), tip = new THREE.Color(C.accent);
    JOINTS.forEach((n, i) => this.mesh.setColorAt(i, n === 'index-finger-tip' ? tip : skin));
    this.group.add(this.mesh);
  }

  joint(name) {
    const j = this.group.joints?.[name];
    return j && j.visible ? j : null;
  }

  get tracked() {
    return !!(this.handedness && this.group.visible && this.joint('index-finger-tip') && this.joint('wrist'));
  }

  update(time) {
    if (!this.tracked) { this.mesh.visible = false; return; }
    this.lastSeen = time;
    this.mesh.visible = true;
    JOINTS.forEach((n, i) => {
      const j = this.group.joints[n];
      if (!j || !j.visible) { _m.makeScale(0, 0, 0); }
      else {
        const r = (j.jointRadius || 0.008) * (n.endsWith('tip') ? 0.95 : 0.85);
        _m.copy(j.matrix).scale(_s.setScalar(r)); // j.matrix = pose locale fournie par WebXR
      }
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Position monde d'une articulation (ou null). */
  world(name, target) {
    const j = this.joint(name);
    if (!j) return null;
    return j.getWorldPosition(target);
  }

  /** Normale de la paume (monde), calculée géométriquement : robuste quel que soit le casque. */
  palmNormal(target) {
    const w = this.world('wrist', new THREE.Vector3());
    const i = this.world('index-finger-metacarpal', _a);
    const p = this.world('pinky-finger-metacarpal', _b);
    if (!w || !i || !p) return null;
    i.sub(w); p.sub(w);
    if (this.handedness === 'left') target.crossVectors(p, i); else target.crossVectors(i, p);
    return target.normalize();
  }
}

export class Hands {
  constructor(renderer, parent) {
    this.list = [new Hand(renderer, 0, parent), new Hand(renderer, 1, parent)];
    this.time = 0;
  }

  get(handedness) {
    return this.list.find((h) => h.handedness === handedness && h.tracked) || null;
  }

  anyTracked() { return this.list.some((h) => h.tracked); }

  /** Temps écoulé depuis qu'une main a été vue pour la dernière fois. */
  sinceSeen() { return this.time - Math.max(...this.list.map((h) => h.lastSeen)); }

  update(dt) {
    this.time += dt;
    this.list.forEach((h) => h.update(this.time));
  }
}
