// Bibliothèque : panneau incurvé avec une carte par vidéo 360°.
import { surface, toTexture, text, paragraph, rrect, icon, fmtDuration } from './canvas.js';
import { plane } from './kit.js';
import { C, F } from './theme.js';
import { ArcPanel, PanelCard, paintCardBase, CARD_H, THUMB_H } from './ArcPanel.js';
import { LIBRARY } from '../config.js';

export class Library extends ArcPanel {
  /**
   * @param {object} o
   * @param {import('../input/Interaction.js').InteractionSystem} o.interaction
   * @param {Array} o.videos
   * @param {(video) => void} o.onSelect
   * @param {() => void} o.onClose
   */
  constructor({ interaction, videos, onSelect, onClose }) {
    super({
      interaction,
      kicker: LIBRARY.kicker,
      title: LIBRARY.title,
      count: `${videos.length} expériences · vidéo 360°`,
      footer: 'Touchez une vignette pour lancer l’expérience',
      cards: videos.map((v) => new VideoCard(interaction, v, () => onSelect(v))),
      onClose,
    });
  }

  setThumbnail(id, image, duration) {
    this.cards.find((c) => c.video.id === id)?.setThumbnail(image, duration);
  }
}

class VideoCard extends PanelCard {
  constructor(interaction, video, onPress) {
    super(interaction, { onPress, sound: 'launch' });
    this.video = video;
    this.play = plane(0.07, 0.07, playBadge(), { order: 13 });
    this.play.position.set(0, CARD_H / 2 - THUMB_H / 2, 0.001);
    this.play.userData.opacity = 0;
    this.inner.add(this.play);
    this.image = null;
    this.duration = 0;
    this.draw();
  }

  setThumbnail(image, duration) {
    this.image = image;
    this.duration = duration || 0;
    this.draw();
  }

  paint(s) {
    const { g, k, w } = s;
    const th = paintCardBase(s, this.image);

    // étiquette 360°
    const tagW = 0.052 * k, tagH = 0.024 * k, tx = 0.016 * k, ty = 0.016 * k;
    rrect(g, tx, ty, tagW, tagH, tagH / 2);
    g.fillStyle = 'rgba(42, 40, 38, 0.72)';
    g.fill();
    text(g, '360°', tx + tagW / 2, ty + tagH * 0.69, { font: `600 ${0.0135 * k}px ${F.sans}`, color: C.paper, align: 'center', spacing: 0.0006 * k });

    // textes
    const pad = 0.02 * k;
    const maxW = w - pad * 2;
    const titleLines = paragraph(g, this.video.title, pad, th + 0.048 * k, {
      font: `600 ${0.031 * k}px ${F.serif}`, color: C.text, maxW, lineH: 0.032 * k, maxLines: 2,
    });
    paragraph(g, this.video.subtitle || '', pad, th + (0.08 + (titleLines - 1) * 0.032) * k, {
      font: `400 ${0.0158 * k}px ${F.sans}`, color: C.textDim, maxW, lineH: 0.022 * k, maxLines: titleLines > 1 ? 2 : 3,
    });

    // pied de carte : durée
    g.fillStyle = C.hairline;
    g.fillRect(pad, s.h - 0.05 * k, maxW, Math.max(1.5, 0.001 * k));
    text(g, this.duration ? fmtDuration(this.duration) : 'Vidéo 360°', pad, s.h - 0.021 * k, {
      font: `500 ${0.0148 * k}px ${F.sans}`, color: C.textDim, spacing: 0.0004 * k,
    });
    text(g, 'Lancer', w - pad, s.h - 0.021 * k, {
      font: `600 ${0.0148 * k}px ${F.sans}`, color: C.accent, align: 'right', spacing: 0.0008 * k,
    });
  }

  onHover(h) { this.play.userData.opacity = h; }
}

let _play = null;
function playBadge() {
  if (_play) return _play;
  const s = surface(1, 1, 256);
  s.g.beginPath();
  s.g.arc(128, 128, 120, 0, Math.PI * 2);
  s.g.fillStyle = 'rgba(42, 40, 38, 0.88)';
  s.g.fill();
  icon(s.g, 'play', 136, 128, 110, C.paper);
  _play = toTexture(s.canvas);
  return _play;
}
