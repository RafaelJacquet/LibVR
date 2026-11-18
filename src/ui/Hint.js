// Message d'accueil flottant : explique comment ouvrir la bibliothèque.
import * as THREE from 'three';
import { surface, toTexture, glassPanel, text, icon } from './canvas.js';
import { plane, softShadow, setGroupOpacity, approach } from './kit.js';
import { C, F } from './theme.js';

const W = 0.9, H = 0.2;

export class Hint {
  constructor() {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.mesh = plane(W, H, null, { order: 10 });
    const shadow = softShadow(W, H, 0.04, 0.04, 0.3);
    shadow.position.set(0, -0.012, -0.01);
    this.root.add(shadow, this.mesh);
    this.appear = 0;
    this.target = 0;
    this.variant = null;
    this.yaw = null;
  }

  /** 'xr' : explication poignet ; 'desktop' : clavier/souris */
  setVariant(v) {
    if (v === this.variant) return;
    this.variant = v;
    const s = surface(W, H, 1800);
    const k = s.k;
    glassPanel(s.g, s.w, s.h, 0.04 * k);
    // pastille icône
    s.g.beginPath();
    s.g.arc(0.1 * k, H / 2 * k, 0.05 * k, 0, Math.PI * 2);
    s.g.strokeStyle = C.accentDim;
    s.g.lineWidth = 0.002 * k;
    s.g.stroke();
    icon(s.g, 'library', 0.1 * k, H / 2 * k, 0.05 * k, C.accent, 0.0022 * k);
    const x = 0.19 * k;
    text(s.g, 'BIENVENUE', x, 0.062 * k, { font: `600 ${0.017 * k}px ${F.sans}`, color: C.accent, spacing: 0.004 * k });
    if (v === 'xr') {
      text(s.g, 'Tournez l’intérieur du poignet gauche vers vous', x, 0.112 * k, { font: `500 ${0.036 * k}px ${F.serif}`, maxW: (W - 0.22) * k });
      text(s.g, 'puis touchez le bouton avec l’index droit — ou fixez le bouton situé en bas.', x, 0.152 * k, {
        font: `400 ${0.017 * k}px ${F.sans}`, color: C.textDim, maxW: (W - 0.22) * k,
      });
    } else {
      text(s.g, 'Ouvrez la bibliothèque', x, 0.112 * k, { font: `500 ${0.04 * k}px ${F.serif}` });
      text(s.g, 'Barre Espace, clic sur le bouton en bas, ou fixez-le 1,5 seconde.', x, 0.152 * k, {
        font: `400 ${0.017 * k}px ${F.sans}`, color: C.textDim, maxW: (W - 0.22) * k,
      });
    }
    this.mesh.material.map?.dispose();
    this.mesh.material.map = toTexture(s.canvas);
    this.mesh.material.needsUpdate = true;
  }

  show() { this.target = 1; this.root.visible = true; this.yaw = null; }
  hide() { this.target = 0; }

  update(dt, headPos, headYaw) {
    this.appear = approach(this.appear, this.target, dt, 4);
    if (this.target === 0 && this.appear < 0.01) { this.root.visible = false; return; }
    // reste devant l'utilisateur, avec un suivi lent
    if (this.yaw === null) this.yaw = headYaw;
    let d = Math.atan2(Math.sin(headYaw - this.yaw), Math.cos(headYaw - this.yaw));
    if (Math.abs(d) > 0.5) this.yaw += d * (1 - Math.exp(-dt * 2));
    const dist = 1.6;
    this.root.position.set(headPos.x - Math.sin(this.yaw) * dist, headPos.y + 0.02, headPos.z - Math.cos(this.yaw) * dist);
    this.root.lookAt(headPos.x, headPos.y + 0.02, headPos.z);
    setGroupOpacity(this.root, this.appear);
  }
}
