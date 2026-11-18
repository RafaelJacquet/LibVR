// Panneau incurvé centré sur l'utilisateur, avec une rangée de cartes touchables.
// Base commune de la bibliothèque (vidéos) et du panneau « Lieux » (maps).
// Toutes les dimensions sont en mètres (échelle VR) ; sur ordinateur le groupe est agrandi.
import * as THREE from 'three';
import { surface, toTexture, glassPanel, text, icon } from './canvas.js';
import { plane, softShadow, outline, setGroupOpacity, approach } from './kit.js';
import { C, F } from './theme.js';
import { RoundButton } from './RoundButton.js';
import { Interactable } from '../input/Interaction.js';

const R = 1.0;            // rayon de référence de l'arc (le groupe est mis à l'échelle)
export const CARD_W = 0.3;
export const CARD_H = 0.41;
export const THUMB_H = 0.2;
export const CARD_RADIUS = 0.018;
const GAP = 0.034;
const PAD = 0.06;
const HEADER_H = 0.15;
const FOOTER_H = 0.07;

export class ArcPanel {
  /**
   * @param {object} o
   * @param {import('../input/Interaction.js').InteractionSystem} o.interaction
   * @param {string} o.kicker  surtitre (petites capitales)
   * @param {string} o.title   titre
   * @param {string} o.count   mention à droite du titre (« 3 expériences »)
   * @param {string} o.footer  consigne sous les cartes
   * @param {PanelCard[]} o.cards
   * @param {() => void} o.onClose
   */
  constructor({ interaction, kicker, title, count, footer, cards, onClose }) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.appear = 0;
    this.target = 0;
    this.content = new THREE.Group(); // décalage vertical / léger recul à l'apparition
    this.root.add(this.content);
    this.cards = cards;

    const n = cards.length;
    const arcLen = n * CARD_W + (n - 1) * GAP + PAD * 2;
    const theta = arcLen / R;
    const panelH = HEADER_H + CARD_H + FOOTER_H + PAD * 0.9;
    const top = panelH / 2;

    // ---- fond incurvé (cylindre vu de l'intérieur)
    const bg = surface(arcLen, panelH, 1800);
    glassPanel(bg.g, bg.w, bg.h, 0.03 * bg.k);
    const k = bg.k;
    text(bg.g, kicker.toUpperCase(), PAD * k, 0.062 * k, {
      font: `600 ${0.017 * k}px ${F.sans}`, color: C.accent, spacing: 0.0042 * k,
    });
    text(bg.g, title, PAD * k, 0.118 * k, { font: `500 ${0.058 * k}px ${F.serif}` });
    text(bg.g, count, (arcLen - PAD - 0.07) * k, 0.112 * k, {
      font: `400 ${0.019 * k}px ${F.sans}`, color: C.textDim, align: 'right',
    });
    // filet sous l'en-tête
    bg.g.fillStyle = C.hairline;
    bg.g.fillRect(PAD * k, (HEADER_H - 0.012) * k, (arcLen - PAD * 2) * k, Math.max(1.5, 0.0012 * k));
    text(bg.g, footer, (arcLen / 2) * k, (panelH - 0.034) * k, {
      font: `400 ${0.018 * k}px ${F.sans}`, color: C.textFaint, align: 'center',
    });
    const bgTex = toTexture(bg.canvas);
    bgTex.repeat.x = -1; // le cylindre est vu de l'intérieur : on remet le texte à l'endroit
    bgTex.offset.x = 1;
    const bgMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, panelH, 48, 1, true, Math.PI - theta / 2, theta),
      new THREE.MeshBasicMaterial({ map: bgTex, transparent: true, side: THREE.BackSide, depthWrite: false, toneMapped: false }),
    );
    bgMesh.material.userData.baseOpacity = 1;
    bgMesh.renderOrder = 10;
    this.content.add(bgMesh);

    // ---- bouton fermer (en haut à droite)
    const placeOnArc = (obj, x, y, r = R - 0.006) => {
      const a = x / R; // abscisse le long de l'arc -> angle
      obj.position.set(Math.sin(a) * r, y, -Math.cos(a) * r);
      obj.rotation.y = -a;
    };
    this.close = new RoundButton(interaction, { size: 0.058, icon: 'close', onPress: onClose, sound: 'close' });
    placeOnArc(this.close.group, arcLen / 2 - PAD - 0.029, top - 0.086);
    this.content.add(this.close.group);

    // ---- cartes
    cards.forEach((card, i) => {
      const x = -arcLen / 2 + PAD + CARD_W / 2 + i * (CARD_W + GAP);
      const y = top - HEADER_H - 0.012 - CARD_H / 2;
      placeOnArc(card.group, x, y, R - 0.014);
      this.content.add(card.group);
    });

    this.time = 0;
  }

  /**
   * Place le panneau face à la tête (centre de l'arc = tête).
   * @param {THREE.Vector3} headPos position monde de la tête
   * @param {number} yaw orientation horizontale du regard
   * @param {number} distance distance souhaitée (m) => échelle du groupe
   * @param {number} drop décalage vertical (m) du centre du panneau sous les yeux
   */
  placeAt(headPos, yaw, distance, drop) {
    this.root.position.copy(headPos);
    this.root.rotation.set(0, yaw, 0);
    this.root.scale.setScalar(distance / R);
    this.content.position.y = -drop / (distance / R);
  }

  show() { this.target = 1; this.root.visible = true; }
  hide() { this.target = 0; }
  get isOpen() { return this.target === 1; }

  update(dt) {
    this.time += dt;
    this.appear = approach(this.appear, this.target, dt, 9);
    if (this.target === 0 && this.appear < 0.01) { this.appear = 0; this.root.visible = false; return; }
    const e = this.appear;
    this.content.scale.setScalar(0.96 + 0.04 * e);
    this.content.position.z = (1 - e) * 0.04;
    this.close.update(this.time);
    this.cards.forEach((c) => c.update(this.time));
    setGroupOpacity(this.root, e);
  }
}

/* ============================================================== Carte */
/** Carte touchable : ombre, face dessinée sur canvas, contour au survol. Les sous-classes
 *  dessinent leur contenu dans `paint(s)` et peuvent animer des éléments dans `onHover(h)`. */
export class PanelCard {
  constructor(interaction, { onPress, sound = 'tap' }) {
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);

    this.shadow = softShadow(CARD_W, CARD_H, CARD_RADIUS, 0.02, 0.2);
    this.shadow.position.set(0, -0.006, -0.004);
    this.face = plane(CARD_W, CARD_H, null, { order: 12 });
    this.edge = outline(CARD_W + 0.004, CARD_H + 0.004, CARD_RADIUS + 0.002, C.accent, 0.0022);
    this.edge.position.z = 0.0008;
    this.inner.add(this.shadow, this.face, this.edge);

    this.it = interaction.add(new Interactable(this.group, {
      width: CARD_W, height: CARD_H, onPress, sound,
    }));
  }

  /** À surcharger : dessine la carte dans la surface `s` (CARD_W × CARD_H). */
  paint() {}

  draw() {
    const s = surface(CARD_W, CARD_H, 2400);
    this.paint(s);
    this.face.material.map?.dispose();
    this.face.material.map = toTexture(s.canvas);
    this.face.material.needsUpdate = true;
  }

  onHover() {}

  update(t) {
    const h = this.it.hover;
    const since = t - this.it.pressedAt;
    const press = since >= 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) : 0;
    this.inner.scale.setScalar(1 + h * 0.025 - press * 0.03);
    this.inner.position.z = h * 0.008 - press * 0.012;
    this.edge.userData.opacity = h * 0.9;
    this.shadow.userData.opacity = 0.75 + h * 0.5;
    this.onHover(h);
  }
}

/** Fond de carte + vignette (image en mode « cover », ou motif d'attente). Renvoie la hauteur
 *  de la vignette en px. */
export function paintCardBase(s, image, placeholderIcon = 'eye') {
  const { g, k, w } = s;
  const r = CARD_RADIUS * k;
  glassPanel(g, s.w, s.h, r, { fill: C.card, top: C.cardTop });
  const th = THUMB_H * k;
  g.save();
  g.beginPath();
  g.roundRect(0, 0, w, th, [r, r, 0, 0]);
  g.clip();
  if (image) {
    drawCover(g, image, 0, 0, w, th);
    // léger dégradé pour fondre la vignette dans la carte
    const grad = g.createLinearGradient(0, th * 0.55, 0, th);
    grad.addColorStop(0, 'rgba(253,252,249,0)');
    grad.addColorStop(1, 'rgba(253,252,249,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, th);
  } else {
    const grad = g.createLinearGradient(0, 0, w, th);
    grad.addColorStop(0, '#ECE7DE');
    grad.addColorStop(1, '#DED7CB');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, th);
    icon(g, placeholderIcon, w / 2, th / 2, 0.05 * k, C.textFaint, 0.0022 * k);
  }
  g.restore();
  return th;
}

/** Dessine une image en mode « cover » (remplit sans déformer). */
function drawCover(g, img, x, y, w, h) {
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
