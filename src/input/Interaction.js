// Système d'interaction unifié :
//  - « poke » : le bout de l'index touche une surface (VR, suivi des mains)
//  - « pointer » : rayon souris (ordinateur)
// Chaque Interactable est une surface rectangulaire dans le plan XY local
// de son objet (+Z = face avant, tournée vers l'utilisateur).
import * as THREE from 'three';

const HOVER_DEPTH = 0.07;  // m devant la surface où le survol commence
const PRESS_DEPTH = 0.006; // m : franchissement = appui
const REARM_DEPTH = 0.02;  // m : il faut ressortir au-delà pour ré-appuyer
const BEHIND = 0.04;       // m derrière la surface encore pris en compte
const MARGIN = 0.008;      // tolérance latérale

export class Interactable {
  constructor(object, { width, height, onPress, enabled = () => true, sound = 'tap' }) {
    this.object = object;
    this.width = width;
    this.height = height;
    this.onPress = onPress;
    this.enabled = enabled;
    this.sound = sound;
    this.hover = 0;          // 0..1, mis à jour chaque image
    this.pressedAt = -1;     // horodatage du dernier appui (pour l'animation)
  }

  isActive() {
    if (!this.enabled()) return false;
    for (let o = this.object; o; o = o.parent) if (!o.visible) return false;
    return true;
  }
}

const _local = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class InteractionSystem {
  constructor({ audio }) {
    this.items = new Set();
    this.pokers = [];      // { id, getTip(): Vector3|null, exclude: Set<Interactable>, cursor }
    this.pointerRay = null; // THREE.Ray en coordonnées monde (ordinateur)
    this.pointerHit = null;
    this.cooldown = 0;
    this.time = 0;
    this.audio = audio;
    this._state = new Map(); // id -> { target, armed }
  }

  add(it) { this.items.add(it); return it; }
  remove(it) { this.items.delete(it); }

  addPoker(poker) {
    this.pokers.push(poker);
    this._state.set(poker.id, { target: null, armed: false });
  }

  trigger(it) {
    if (this.cooldown > 0) return;
    this.cooldown = 0.35;
    it.pressedAt = this.time;
    this.audio?.play(it.sound);
    it.onPress?.();
  }

  /** Clic souris : déclenche l'élément actuellement survolé par le pointeur. */
  click() {
    if (this.pointerHit) { this.trigger(this.pointerHit); return true; }
    return false;
  }

  update(dt) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const active = [...this.items].filter((it) => it.isActive());
    for (const it of active) it._h = 0;

    // ----- doigts
    for (const p of this.pokers) {
      const st = this._state.get(p.id);
      const tip = p.getTip();
      let best = null, bestZ = Infinity, bx = 0, by = 0;
      if (tip) {
        for (const it of active) {
          if (p.exclude?.has(it)) continue;
          it.object.updateWorldMatrix(true, false);
          _local.copy(tip).applyMatrix4(_inv.copy(it.object.matrixWorld).invert());
          // repasse en mètres réels (les panneaux peuvent être mis à l'échelle)
          const sc = it.object.matrixWorld.getMaxScaleOnAxis();
          _local.multiplyScalar(sc);
          const hw = (it.width * sc) / 2 + MARGIN, hh = (it.height * sc) / 2 + MARGIN;
          if (Math.abs(_local.x) > hw || Math.abs(_local.y) > hh) continue;
          if (_local.z > HOVER_DEPTH || _local.z < -BEHIND) continue;
          if (_local.z < bestZ) { bestZ = _local.z; best = it; bx = _local.x; by = _local.y; }
        }
      }

      if (best !== st.target) { st.target = best; st.armed = best ? bestZ > REARM_DEPTH : false; }

      if (best) {
        best._h = Math.max(best._h, 1 - THREE.MathUtils.clamp(bestZ / HOVER_DEPTH, 0, 1));
        if (bestZ > REARM_DEPTH) st.armed = true;
        if (st.armed && bestZ <= PRESS_DEPTH) {
          st.armed = false;
          this.trigger(best);
        }
      }

      // curseur : petit anneau projeté sur la surface sous le doigt
      if (p.cursor) {
        if (best && bestZ > -0.01) {
          p.cursor.visible = true;
          const sc = best.object.matrixWorld.getMaxScaleOnAxis();
          _local.set(bx / sc, by / sc, 0.0015 / sc).applyMatrix4(best.object.matrixWorld);
          p.cursor.position.copy(_local);
          best.object.getWorldQuaternion(p.cursor.quaternion);
          const k = THREE.MathUtils.clamp(bestZ / HOVER_DEPTH, 0, 1);
          p.cursor.scale.setScalar(0.45 + k * 0.9);
          p.cursor.material.opacity = 0.9 - k * 0.55;
        } else p.cursor.visible = false;
      }
    }

    // ----- pointeur souris (ordinateur)
    this.pointerHit = null;
    if (this.pointerRay) {
      let bestT = Infinity;
      for (const it of active) {
        const t = rayHit(this.pointerRay, it);
        if (t !== null && t < bestT) { bestT = t; this.pointerHit = it; }
      }
      if (this.pointerHit) this.pointerHit._h = Math.max(this.pointerHit._h, 1);
    }

    // lissage du survol (animations douces)
    const a = 1 - Math.exp(-dt * 14);
    for (const it of this.items) it.hover += ((it._h || 0) - it.hover) * a;
  }
}

/** Distance le long du rayon si le rayon touche la surface, sinon null. */
export function rayHit(ray, it) {
  it.object.updateWorldMatrix(true, false);
  _inv.copy(it.object.matrixWorld).invert();
  _o.copy(ray.origin).applyMatrix4(_inv);
  _d.copy(ray.direction).transformDirection(_inv);
  if (Math.abs(_d.z) < 1e-6) return null;
  const t = -_o.z / _d.z;
  if (t <= 0) return null;
  const x = _o.x + _d.x * t, y = _o.y + _d.y * t;
  if (Math.abs(x) > it.width / 2 || Math.abs(y) > it.height / 2) return null;
  // distance monde
  _local.set(x, y, 0).applyMatrix4(it.object.matrixWorld);
  return _local.distanceTo(ray.origin);
}
