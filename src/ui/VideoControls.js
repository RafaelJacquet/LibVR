// Barre de contrôle pendant la vidéo : titre, progression, Recommencer / Pause / Quitter.
import * as THREE from 'three';
import { surface, toTexture, glassPanel, text, fmtClock } from './canvas.js';
import { plane, softShadow, setGroupOpacity, approach, uiMaterial } from './kit.js';
import { C, F } from './theme.js';
import { RoundButton } from './RoundButton.js';

const W = 0.62, H = 0.28; // dimensions de référence (le groupe est mis à l'échelle)
const BAR_W = W - 0.1;

export class VideoControls {
  constructor(interaction, { onRestart, onTogglePlay, onQuit }) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.content = new THREE.Group();
    this.root.add(this.content);
    this.appear = 0;
    this.target = 0;
    this.time = 0;

    const shadow = softShadow(W, H, 0.03, 0.035, 0.28);
    shadow.position.set(0, -0.01, -0.006);
    const bg = surface(W, H, 2000);
    glassPanel(bg.g, bg.w, bg.h, 0.03 * bg.k);
    this.content.add(shadow, plane(W, H, toTexture(bg.canvas), { order: 10 }));

    // titre + temps (texture redessinée à chaque seconde)
    this.info = plane(W - 0.08, 0.07, null, { order: 11 });
    this.info.position.set(0, H / 2 - 0.06, 0.001);
    this.content.add(this.info);

    // barre de progression
    const track = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, 0.004), uiMaterial(null, 1));
    track.material.color.set(C.text);
    track.userData.opacity = 0.18;
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, 0.004), uiMaterial(null, 1));
    this.fill.material.color.set(C.accent);
    this.fill.geometry.translate(BAR_W / 2, 0, 0);
    this.fill.position.x = -BAR_W / 2;
    track.renderOrder = 11; this.fill.renderOrder = 12;
    const barY = H / 2 - 0.112;
    track.position.set(0, barY, 0.001);
    this.fill.position.y = barY; this.fill.position.z = 0.0015;
    this.content.add(track, this.fill);

    // boutons
    const y = -H / 2 + 0.09;
    this.restart = new RoundButton(interaction, { size: 0.068, icon: 'restart', onPress: onRestart });
    this.play = new RoundButton(interaction, { size: 0.086, icon: 'pause', onPress: onTogglePlay, filled: true });
    this.quit = new RoundButton(interaction, { size: 0.068, icon: 'back', onPress: onQuit, sound: 'close' });
    this.restart.group.position.set(-0.13, y, 0.002);
    this.play.group.position.set(0, y, 0.002);
    this.quit.group.position.set(0.13, y, 0.002);
    this.content.add(this.restart.group, this.play.group, this.quit.group);

    // légendes discrètes sous les boutons
    // (centrées verticalement dans leur bande, qui reste entièrement à l'intérieur du panneau)
    const cap = surface(W, 0.03, 2000);
    const ck = cap.k;
    for (const [label, x] of [['Recommencer', -0.13], ['Quitter', 0.13]]) {
      text(cap.g, label, (W / 2 + x) * ck, 0.015 * ck, { font: `500 ${0.015 * ck}px ${F.sans}`, color: C.textDim, align: 'center', base: 'middle' });
    }
    const caption = plane(W, 0.03, toTexture(cap.canvas), { order: 11 });
    caption.position.set(0, y - 0.056, 0.001);
    this.content.add(caption);

    this._key = '';
  }

  setInfo(title, current, duration, playing) {
    this.play.setIcon(playing ? 'pause' : 'play');
    this.fill.scale.x = duration > 0 ? THREE.MathUtils.clamp(current / duration, 0.0001, 1) : 0.0001;
    const key = `${title}|${Math.floor(current)}|${Math.floor(duration)}`;
    if (key === this._key) return;
    this._key = key;
    const s = surface(W - 0.08, 0.07, 2000);
    const k = s.k;
    text(s.g, 'EN LECTURE', 0, 0.022 * k, { font: `600 ${0.0135 * k}px ${F.sans}`, color: C.accent, spacing: 0.0035 * k });
    text(s.g, title, 0, 0.06 * k, { font: `500 ${0.036 * k}px ${F.serif}`, maxW: s.w * 0.7 });
    text(s.g, `${fmtClock(current)}  /  ${fmtClock(duration)}`, s.w, 0.058 * k, {
      font: `400 ${0.017 * k}px ${F.sans}`, color: C.textDim, align: 'right',
    });
    this.info.material.map?.dispose();
    this.info.material.map = toTexture(s.canvas);
    this.info.material.needsUpdate = true;
  }

  placeAt(headPos, yaw, distance, drop) {
    const sc = distance / 1.0;
    this.root.position.set(headPos.x - Math.sin(yaw) * distance, headPos.y - drop, headPos.z - Math.cos(yaw) * distance);
    this.root.rotation.set(-0.12, yaw, 0, 'YXZ'); // légèrement incliné vers l'utilisateur
    this.root.scale.setScalar(sc * 0.85);
  }

  show() { this.target = 1; this.root.visible = true; this.idle = 0; }
  hide() { this.target = 0; }
  get isOpen() { return this.target === 1; }

  update(dt) {
    this.time += dt;
    this.appear = approach(this.appear, this.target, dt, 10);
    if (this.target === 0 && this.appear < 0.01) { this.appear = 0; this.root.visible = false; return; }
    this.content.position.y = (1 - this.appear) * -0.03;
    [this.restart, this.play, this.quit].forEach((b) => b.update(this.time));
    setGroupOpacity(this.root, this.appear);
  }

  /** true si un bouton est survolé (pour suspendre le masquage automatique) */
  get hovered() {
    return [this.restart, this.play, this.quit].some((b) => b.it.hover > 0.2);
  }
}
