// Fondu au noir accroché à la tête, avec message optionnel (« Chargement… »).
import * as THREE from 'three';
import { surface, toTexture, text } from './canvas.js';
import { C, F } from './theme.js';

export class Fader {
  constructor(camera) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x0b0b0c, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 12), this.mat);
    this.sphere.renderOrder = 1000;
    this.sphere.visible = false;
    this.sphere.frustumCulled = false;
    camera.add(this.sphere);

    this.labelMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), this.labelMat);
    this.label.position.z = -1.0;
    this.label.renderOrder = 1001;
    this.sphere.add(this.label);

    this.value = 0;
    this.labelValue = 0;
    this.anim = null;
    this.message = '';
  }

  setMessage(msg) {
    if (msg === this.message) return;
    this.message = msg;
    if (!msg) { this.labelMat.map = null; this.labelMat.needsUpdate = true; return; }
    const s = surface(0.9, 0.12, 1600);
    text(s.g, msg, s.w / 2, s.h * 0.62, { font: `italic 500 ${0.05 * s.k}px ${F.serif}`, color: C.paper, align: 'center' });
    this.labelMat.map?.dispose();
    this.labelMat.map = toTexture(s.canvas);
    this.labelMat.needsUpdate = true;
  }

  /** Anime l'opacité vers `to` en `dur` secondes ; renvoie une promesse. */
  to(to, dur = 0.5) {
    this.anim?.resolve();
    return new Promise((resolve) => {
      this.anim = { from: this.value, to, dur: Math.max(0.001, dur), t: 0, resolve };
    });
  }
  out(dur = 0.5, msg = '') { this.setMessage(msg); return this.to(1, dur); }
  in(dur = 0.6) { return this.to(0, dur); }

  update(dt, time) {
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = k * k * (3 - 2 * k);
      this.value = a.from + (a.to - a.from) * e;
      if (k >= 1) { this.anim = null; a.resolve(); }
    }
    this.mat.opacity = this.value;
    this.sphere.visible = this.value > 0.001;
    // le message n'apparaît qu'une fois le noir complet, avec une respiration lente
    const target = this.message && this.value > 0.98 ? 0.55 + 0.35 * Math.sin(time * 2.2) : 0;
    this.labelValue += (target - this.labelValue) * (1 - Math.exp(-dt * 6));
    this.labelMat.opacity = this.labelValue;
  }
}
