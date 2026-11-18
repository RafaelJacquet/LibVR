// Bouton rond touchable (icône), utilisé partout : fermer, poignet, contrôles vidéo…
import * as THREE from 'three';
import { surface, toTexture, icon } from './canvas.js';
import { plane } from './kit.js';
import { C } from './theme.js';
import { Interactable } from '../input/Interaction.js';

export class RoundButton {
  constructor(interaction, { size = 0.04, icon: iconName = 'close', onPress, enabled, filled = false, sound } = {}) {
    this.size = size;
    this.filled = filled;
    this.group = new THREE.Group();

    this.face = plane(size, size, null, { order: 12 });
    this.ring = plane(size * 1.18, size * 1.18, ringTexture(), { order: 13 });
    this.ring.userData.opacity = 0;
    this.ring.position.z = 0.0005;
    this.group.add(this.face, this.ring);
    this.setIcon(iconName);

    this.it = interaction.add(new Interactable(this.group, {
      width: size, height: size, onPress, enabled, sound,
    }));
  }

  setIcon(name) {
    if (name === this.iconName) return;
    this.iconName = name;
    const s = surface(this.size, this.size, 5200);
    const r = s.w / 2;
    s.g.beginPath();
    s.g.arc(r, r, r - 2, 0, Math.PI * 2);
    s.g.fillStyle = this.filled ? C.ink : C.cardTop;
    s.g.fill();
    s.g.lineWidth = Math.max(2, s.w * 0.014);
    s.g.strokeStyle = this.filled ? 'rgba(0,0,0,0)' : 'rgba(42, 40, 38, 0.2)';
    s.g.stroke();
    icon(s.g, name, r, r, s.w * 0.42, this.filled ? C.paper : C.text, s.w * 0.034);
    this.face.material.map?.dispose();
    this.face.material.map = toTexture(s.canvas);
    this.face.material.needsUpdate = true;
  }

  update(t) {
    const h = this.it.hover;
    const since = t - this.it.pressedAt;
    const press = since >= 0 && since < 0.25 ? Math.sin((since / 0.25) * Math.PI) : 0;
    this.group.scale.setScalar(1 + h * 0.06 - press * 0.08);
    this.ring.userData.opacity = h;
  }
}

let _ring = null;
function ringTexture() {
  if (_ring) return _ring;
  const s = surface(1, 1, 256);
  s.g.strokeStyle = C.accent;
  s.g.lineWidth = 6;
  s.g.beginPath();
  s.g.arc(128, 128, 124, 0, Math.PI * 2);
  s.g.stroke();
  _ring = toTexture(s.canvas);
  return _ring;
}
