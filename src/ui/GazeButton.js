// Bouton « regard » de secours : flotte en bas du champ de vision et s'active
// quand on le fixe (anneau de progression). Cliquable aussi à la souris.
import * as THREE from 'three';
import { RoundButton } from './RoundButton.js';
import { surface, toTexture, pill } from './canvas.js';
import { plane, setGroupOpacity, approach } from './kit.js';
import { C, F } from './theme.js';
import { rayHit } from '../input/Interaction.js';
import { INTERACTION } from '../config.js';

const SIZE = 0.075;
const DIST = 1.0;
const DROP = 0.5;       // m sous le niveau des yeux
const FOLLOW_ANGLE = THREE.MathUtils.degToRad(28);

const _fwd = new THREE.Vector3();
const _ray = new THREE.Ray();
const _p = new THREE.Vector3();

export class GazeButton {
  constructor(interaction, onPress, sounds) {
    this.onPress = onPress;
    this.sounds = sounds;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.active = false;
    this.appear = 0;
    this.yaw = null;
    this.dwell = 0;
    this.locked = false; // après déclenchement : il faut détourner le regard

    this.button = new RoundButton(interaction, { size: SIZE, icon: 'library', onPress, sound: 'open' });
    this.root.add(this.button.group);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.6, SIZE * 0.66, 64), progressMaterial());
    this.ring.renderOrder = 15;
    this.ring.position.z = 0.001;
    this.root.add(this.ring);

    this.labels = {};
    this.label = plane(0.2, 0.03, null, { order: 12 });
    this.label.position.set(0, -SIZE * 0.5 - 0.024, 0);
    this.root.add(this.label);
    this.setMode('library');
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.button.setIcon(mode === 'menu' ? 'menu' : 'library');
    if (!this.labels[mode]) {
      const s = surface(0.2, 0.03, 3000);
      pill(s, mode === 'menu' ? 'Fixer pour le menu' : 'Fixer pour la bibliothèque', { font: `500 ${0.0125 * s.k}px ${F.sans}`, color: C.textDim });
      this.labels[mode] = toTexture(s.canvas);
    }
    this.label.material.map = this.labels[mode];
    this.label.material.needsUpdate = true;
  }

  /** Renvoie true si le regard est posé sur le bouton (pour afficher le réticule). */
  update(dt, t, headPos, headQuat) {
    this.appear = approach(this.appear, this.active ? 1 : 0, dt, 6);
    this.root.visible = this.appear > 0.02;
    this.button.update(t);
    if (!this.root.visible) { this.yaw = null; this.dwell = 0; return false; }

    // suit l'orientation de la tête « paresseusement » (seulement si on tourne beaucoup)
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    const headYaw = Math.atan2(-_fwd.x, -_fwd.z);
    if (this.yaw === null) this.yaw = headYaw;
    let d = headYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > FOLLOW_ANGLE) this.yaw += d * (1 - Math.exp(-dt * 3));
    this.root.position.set(
      headPos.x - Math.sin(this.yaw) * DIST,
      headPos.y - (this.drop ?? DROP),
      headPos.z - Math.cos(this.yaw) * DIST,
    );
    this.root.lookAt(headPos);

    // fixation
    let looking = false;
    if (this.active) {
      _ray.origin.copy(headPos);
      _ray.direction.copy(_fwd);
      // zone de détection un peu plus large que le bouton
      const hit = rayHit(_ray, { object: this.button.group, width: SIZE * 1.6, height: SIZE * 1.6 });
      looking = hit !== null;
    }
    if (looking && !this.locked) {
      this.dwell += dt;
      if (this.dwell >= INTERACTION.gazeDwell) {
        this.dwell = 0;
        this.locked = true;
        this.sounds?.play('open');
        this.onPress();
      }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 2);
      if (!looking) this.locked = false;
    }
    this.ring.material.uniforms.progress.value = this.dwell / INTERACTION.gazeDwell;
    this.ring.material.uniforms.opacity.value = this.appear;
    setGroupOpacity(this.root, this.appear);
    return looking;
  }
}

function progressMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      progress: { value: 0 },
      opacity: { value: 1 },
      color: { value: new THREE.Color(C.accent) },
    },
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float progress; uniform float opacity; uniform vec3 color;
      varying vec2 vPos;
      void main() {
        float a = atan(vPos.x, vPos.y);               // 0 en haut, sens horaire
        float p = (a < 0.0 ? a + 6.2831853 : a) / 6.2831853;
        if (p > progress || progress <= 0.001) discard;
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }`,
  });
}
