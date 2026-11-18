// Boutons au poignet : apparaissent quand l'intérieur du poignet est tourné vers le visage.
// On les touche avec l'index de l'autre main.
//  - bouton principal : Bibliothèque (dans la scène) ou Menu (pendant une vidéo)
//  - bouton « Lieux » : à côté, uniquement dans la scène (pas pendant une vidéo)
import * as THREE from 'three';
import { RoundButton } from './RoundButton.js';
import { surface, toTexture, pill } from './canvas.js';
import { plane, setGroupOpacity, approach } from './kit.js';
import { F } from './theme.js';
import { INTERACTION } from '../config.js';

const SIZE = 0.036;
const SPREAD = 0.026;   // m : demi-écart entre les deux boutons (centre à centre = 5,2 cm)
const LABEL_W = 0.05, LABEL_H = 0.014;
const _w = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _n = new THREE.Vector3();
const _toHead = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _m = new THREE.Matrix4();

const labelCache = {};
function labelTexture(str) {
  if (!labelCache[str]) {
    const s = surface(LABEL_W, LABEL_H, 4600);
    pill(s, str, { font: `500 ${0.0064 * s.k}px ${F.sans}`, padX: 0.25 });
    labelCache[str] = toTexture(s.canvas);
  }
  return labelCache[str];
}

export class WristButton {
  /**
   * @param {object} o
   * @param {() => void} o.onMenu    bouton principal (bibliothèque / menu)
   * @param {() => void} o.onPlaces  bouton « Lieux »
   */
  constructor(interaction, hands, { onMenu, onPlaces }) {
    this.hands = hands;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.appear = 0;
    this.shownFor = 0;
    this.showing = false;
    this.placesShown = 1;   // 0..1 : le bouton « Lieux » s'efface pendant les vidéos
    this.placesWanted = true;

    const ready = () => this.appear > 0.85 && this.shownFor > 0.3;
    this.main = this.slot(interaction, 'library', onMenu, 'open', ready);
    this.places = this.slot(interaction, 'places', onPlaces, 'open', () => ready() && this.placesShown > 0.9);
    this.places.label.material.map = labelTexture('Lieux');
    this.places.label.material.needsUpdate = true;
    this.setMode('library');
  }

  slot(interaction, iconName, onPress, sound, enabled) {
    const group = new THREE.Group();
    const button = new RoundButton(interaction, { size: SIZE, icon: iconName, onPress, sound, enabled });
    const label = plane(LABEL_W, LABEL_H, null, { order: 12 });
    label.position.set(0, -SIZE * 0.5 - 0.0095, 0);
    group.add(button.group, label);
    this.root.add(group);
    return { group, button, label };
  }

  /** 'library' (dans la scène) ou 'menu' (pendant une vidéo) */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.main.button.setIcon(mode === 'menu' ? 'menu' : 'library');
    this.main.label.material.map = labelTexture(mode === 'menu' ? 'Menu' : 'Bibliothèque');
    this.main.label.material.needsUpdate = true;
    this.placesWanted = mode !== 'menu';
  }

  /** Les doigts de la main qui porte les boutons ne doivent pas les déclencher. */
  owns(it) { return it === this.main.button.it || it === this.places.button.it; }

  update(dt, t, headPos, headQuat) {
    const hand = this.hands.get(INTERACTION.wristHand);
    let want = false;

    if (hand && hand.world('wrist', _w) && hand.world('middle-finger-metacarpal', _mid) && hand.palmNormal(_n)) {
      _toHead.copy(headPos).sub(_w).normalize();
      const facing = _n.dot(_toHead);
      _fwd.set(0, 0, -1).applyQuaternion(headQuat);
      const inView = _fwd.dot(_toHead.clone().negate());
      want = this.showing ? facing > 0.35 && inView > 0.6 : facing > 0.6 && inView > 0.78;

      // repère des boutons : Z = normale paume, Y = vers les doigts, X = en travers du poignet
      _arm.copy(_w).sub(_mid).normalize();          // vers l'avant-bras
      _y.copy(_arm).negate();
      _y.addScaledVector(_n, -_y.dot(_n)).normalize();
      _x.crossVectors(_y, _n).normalize();
      _m.makeBasis(_x, _y, _n);
      this.root.quaternion.setFromRotationMatrix(_m);
      this.root.position.copy(_w).addScaledVector(_n, 0.024).addScaledVector(_arm, 0.03);
    }

    this.showing = want;
    this.shownFor = want ? this.shownFor + dt : 0;
    this.appear = approach(this.appear, want ? 1 : 0, dt, 12);
    this.placesShown = approach(this.placesShown, this.placesWanted ? 1 : 0, dt, 10);
    this.root.visible = this.appear > 0.02;
    this.root.scale.setScalar(0.85 + 0.15 * this.appear);

    // deux boutons côte à côte ; seul, le bouton principal revient au centre
    const p = this.placesShown;
    this.main.group.position.x = -SPREAD * p;
    this.places.group.position.x = SPREAD * p;
    this.places.group.visible = p > 0.02;
    this.places.group.scale.setScalar(0.6 + 0.4 * p);
    this.main.button.update(t);
    this.places.button.update(t);
    setGroupOpacity(this.root, this.appear);
    if (p < 1) setGroupOpacity(this.places.group, this.appear * p);
  }
}
