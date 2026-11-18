// Panneau « Lieux » : une carte par map (aperçu, nom, description), la map actuelle est marquée.
import { text, paragraph } from './canvas.js';
import { C, F } from './theme.js';
import { ArcPanel, PanelCard, paintCardBase } from './ArcPanel.js';

export class Places extends ArcPanel {
  /**
   * @param {object} o
   * @param {import('../input/Interaction.js').InteractionSystem} o.interaction
   * @param {Array<{id, title, subtitle, preview}>} o.maps
   * @param {(map) => void} o.onSelect
   * @param {() => void} o.onClose
   */
  constructor({ interaction, maps, onSelect, onClose }) {
    super({
      interaction,
      kicker: 'Changer de lieu',
      title: 'Lieux',
      count: `${maps.length} lieux`,
      footer: 'Touchez un lieu pour vous y rendre',
      cards: maps.map((m) => new PlaceCard(interaction, m, () => onSelect(m))),
      onClose,
    });
    this.currentId = null;
    // aperçus (images fixes livrées avec les maps)
    for (const card of this.cards) {
      if (!card.map.preview) continue;
      const img = new Image();
      img.onload = () => { card.image = img; card.draw(); };
      img.src = card.map.preview;
    }
  }

  /** Marque la map où se trouve le joueur. */
  setCurrent(id) {
    this.currentId = id;
    for (const c of this.cards) {
      const cur = c.map.id === id;
      if (cur !== c.current) { c.current = cur; c.draw(); }
    }
  }
}

class PlaceCard extends PanelCard {
  constructor(interaction, map, onPress) {
    super(interaction, { onPress, sound: 'open' });
    this.map = map;
    this.image = null;
    this.current = false;
    this.draw();
  }

  paint(s) {
    const { g, k, w } = s;
    const th = paintCardBase(s, this.image, 'places');

    const pad = 0.02 * k;
    const maxW = w - pad * 2;
    const titleLines = paragraph(g, this.map.title, pad, th + 0.048 * k, {
      font: `600 ${0.031 * k}px ${F.serif}`, color: C.text, maxW, lineH: 0.032 * k, maxLines: 2,
    });
    paragraph(g, this.map.subtitle || '', pad, th + (0.08 + (titleLines - 1) * 0.032) * k, {
      font: `400 ${0.0158 * k}px ${F.sans}`, color: C.textDim, maxW, lineH: 0.022 * k, maxLines: titleLines > 1 ? 2 : 3,
    });

    // pied de carte : « Vous êtes ici » (pastille) ou « Y aller »
    g.fillStyle = C.hairline;
    g.fillRect(pad, s.h - 0.05 * k, maxW, Math.max(1.5, 0.001 * k));
    const y = s.h - 0.021 * k;
    if (this.current) {
      g.beginPath();
      g.arc(pad + 0.005 * k, y - 0.0048 * k, 0.0045 * k, 0, Math.PI * 2);
      g.fillStyle = C.accent;
      g.fill();
      text(g, 'Vous êtes ici', pad + 0.016 * k, y, {
        font: `600 ${0.0148 * k}px ${F.sans}`, color: C.accent, spacing: 0.0004 * k,
      });
    } else {
      text(g, 'Y aller', w - pad, y, {
        font: `600 ${0.0148 * k}px ${F.sans}`, color: C.accent, align: 'right', spacing: 0.0008 * k,
      });
    }
  }
}
