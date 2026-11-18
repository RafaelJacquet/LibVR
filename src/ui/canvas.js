// Outils de dessin 2D (canvas) -> textures Three.js pour l'interface.
import * as THREE from 'three';
import { PX_PER_M, C } from './theme.js';

let maxAniso = 4;
export function setMaxAnisotropy(v) { maxAniso = v; }

/** Crée un canvas dimensionné en mètres. Le contexte travaille en "unités" = px. */
export function surface(wM, hM, density = PX_PER_M) {
  const w = Math.max(2, Math.round(wM * density));
  const h = Math.max(2, Math.round(hM * density));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  return { canvas, g, w, h, k: density }; // k : px par mètre
}

export function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

export function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Fond de panneau : verre fumé + liseré fin. */
export function glassPanel(g, w, h, r, { border = C.hairline, fill = C.panel, top = C.panelTop } = {}) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, fill);
  rrect(g, 1, 1, w - 2, h - 2, r);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = Math.max(1.5, w / 600);
  g.strokeStyle = border;
  g.stroke();
}

/** Texte sur une ligne, tronqué avec « … » si trop long. */
export function text(g, str, x, y, { font, color = C.text, align = 'left', base = 'alphabetic', maxW = Infinity, spacing = 0 }) {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  let s = str;
  if (g.measureText(s).width > maxW) {
    while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    s = s.trimEnd() + '…';
  }
  g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

/** Texte multiligne (retour à la ligne automatique), renvoie le nombre de lignes. */
export function paragraph(g, str, x, y, { font, color = C.textDim, maxW, lineH, maxLines = 3, align = 'left' }) {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  const words = str.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  lines.forEach((l, i) => g.fillText(l, x, y + i * lineH));
  return lines.length;
}

/** Étiquette en pastille (fond lin, liseré fin), centrée dans le canvas. */
export function pill(s, str, { font, color = C.text, padX = 0.35 }) {
  const { g, w, h } = s;
  g.font = font;
  const tw = g.measureText(str).width;
  const pw = Math.min(w - 4, tw + h * padX * 2 + h * 0.4);
  const x = (w - pw) / 2;
  rrect(g, x, 2, pw, h - 4, (h - 4) / 2);
  g.fillStyle = C.panelTop;
  g.fill();
  g.lineWidth = Math.max(1.5, h * 0.03);
  g.strokeStyle = C.hairline;
  g.stroke();
  text(g, str, w / 2, h * 0.66, { font, color, align: 'center' });
}

/* ------------------------------------------------------------------ icônes */
// Toutes les icônes sont dessinées en traits fins, centrées en (cx, cy), taille s.
export function icon(g, name, cx, cy, s, color = C.text, lw = s * 0.075) {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const h = s / 2;
  switch (name) {
    case 'library': { // 3 vignettes empilées
      const cw = s * 0.26, ch = s * 0.34, gap = s * 0.07;
      for (let i = -1; i <= 1; i++) {
        rrect(g, i * (cw + gap) - cw / 2, -ch / 2, cw, ch, s * 0.04);
        g.stroke();
      }
      break;
    }
    case 'close':
      g.beginPath();
      g.moveTo(-h * 0.55, -h * 0.55); g.lineTo(h * 0.55, h * 0.55);
      g.moveTo(h * 0.55, -h * 0.55); g.lineTo(-h * 0.55, h * 0.55);
      g.stroke();
      break;
    case 'play':
      g.beginPath();
      g.moveTo(-h * 0.38, -h * 0.6); g.lineTo(h * 0.62, 0); g.lineTo(-h * 0.38, h * 0.6);
      g.closePath();
      g.fill();
      break;
    case 'pause':
      g.fillRect(-h * 0.45, -h * 0.58, h * 0.28, h * 1.16);
      g.fillRect(h * 0.17, -h * 0.58, h * 0.28, h * 1.16);
      break;
    case 'restart': {
      g.beginPath();
      g.arc(0, 0, h * 0.62, -Math.PI * 0.5, Math.PI * 1.25);
      g.stroke();
      // pointe de flèche
      const a = -Math.PI * 0.5, r = h * 0.62;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      g.beginPath();
      g.moveTo(px - h * 0.05, py - h * 0.28);
      g.lineTo(px + h * 0.26, py);
      g.lineTo(px - h * 0.05, py + h * 0.28);
      g.stroke();
      break;
    }
    case 'back': // flèche retour
      g.beginPath();
      g.moveTo(h * 0.6, 0); g.lineTo(-h * 0.55, 0);
      g.moveTo(-h * 0.15, -h * 0.42); g.lineTo(-h * 0.58, 0); g.lineTo(-h * 0.15, h * 0.42);
      g.stroke();
      break;
    case 'menu':
      for (const y of [-0.36, 0, 0.36]) {
        g.beginPath(); g.moveTo(-h * 0.55, y * h); g.lineTo(h * 0.55, y * h); g.stroke();
      }
      break;
    case 'places': { // repère de lieu (épingle)
      const r = h * 0.42, cy0 = -h * 0.2;
      g.beginPath();
      g.arc(0, cy0, r, Math.PI * 0.82, Math.PI * 2.18);
      g.lineTo(0, h * 0.72);
      g.closePath();
      g.stroke();
      g.beginPath(); g.arc(0, cy0, r * 0.38, 0, Math.PI * 2); g.stroke();
      break;
    }
    case 'eye': {
      g.beginPath();
      g.moveTo(-h * 0.75, 0);
      g.quadraticCurveTo(0, -h * 0.75, h * 0.75, 0);
      g.quadraticCurveTo(0, h * 0.75, -h * 0.75, 0);
      g.stroke();
      g.beginPath(); g.arc(0, 0, h * 0.2, 0, Math.PI * 2); g.fill();
      break;
    }
  }
  g.restore();
}

/** Durée en « 2 min 06 » */
export function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m} min ${String(s).padStart(2, '0')}` : `${s} s`;
}
/** Horloge en « 1:05 » */
export function fmtClock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
