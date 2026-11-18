// Briques réutilisables pour les éléments d'interface 3D.
import * as THREE from 'three';
import { surface, toTexture, rrect } from './canvas.js';
import { C } from './theme.js';

export function uiMaterial(map, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  m.userData.baseOpacity = opacity;
  return m;
}

export function plane(w, h, map, { opacity = 1, order = 10 } = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), uiMaterial(map, opacity));
  mesh.renderOrder = order;
  return mesh;
}

/** Ombre douce (rectangle flou) à placer derrière un panneau. */
export function softShadow(w, h, radius, blur = 0.02, strength = 0.55) {
  const pad = blur * 2.2;
  const s = surface(w + pad * 2, h + pad * 2, 900);
  s.g.filter = `blur(${blur * s.k * 0.6}px)`;
  s.g.fillStyle = `rgba(0,0,0,${strength})`;
  rrect(s.g, pad * s.k, pad * s.k, w * s.k, h * s.k, radius * s.k);
  s.g.fill();
  return plane(w + pad * 2, h + pad * 2, toTexture(s.canvas), { order: 9 });
}

/** Contour arrondi (pour l'état survolé). */
export function outline(w, h, radius, color = C.accent, lineM = 0.0012) {
  const s = surface(w, h);
  const lw = lineM * s.k;
  s.g.strokeStyle = color;
  s.g.lineWidth = lw;
  rrect(s.g, lw / 2, lw / 2, s.w - lw, s.h - lw, radius * s.k);
  s.g.stroke();
  return plane(w, h, toTexture(s.canvas), { opacity: 0, order: 14 });
}

/** Applique un facteur d'opacité global à toute une hiérarchie (fondus). */
export function setGroupOpacity(root, k) {
  root.traverse((o) => {
    const m = o.material;
    if (!m || m.userData.baseOpacity === undefined) return;
    m.opacity = m.userData.baseOpacity * k * (o.userData.opacity ?? 1);
  });
}

/** Petit ressort amorti pour animer une valeur vers une cible. */
export function approach(cur, target, dt, speed = 10) {
  return cur + (target - cur) * (1 - Math.exp(-dt * speed));
}
