// Palette « lin & chêne » — claire, chaleureuse, accordée au bureau loft (sans néon).
export const C = {
  panel: 'rgba(246, 243, 237, 0.95)',     // fond des panneaux (lin)
  panelTop: 'rgba(252, 250, 246, 0.97)',
  card: 'rgba(253, 252, 249, 1)',          // cartes
  cardTop: 'rgba(255, 255, 253, 1)',
  text: '#2A2826',                         // graphite
  textDim: 'rgba(42, 40, 38, 0.64)',
  textFaint: 'rgba(42, 40, 38, 0.42)',
  accent: '#9A683D',                       // chêne / bronze
  accentDim: 'rgba(154, 104, 61, 0.42)',
  hairline: 'rgba(42, 40, 38, 0.13)',
  ink: '#2A2826',                          // boutons pleins
  paper: '#F7F4EE',                        // texte sur fond sombre
  hand: '#8E867B',                         // mains (lisibles sur fond clair comme sombre)
};

export const F = {
  serif: '"Cormorant Garamond", Georgia, serif',
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
};

// Densité des textures d'interface : pixels par mètre.
export const PX_PER_M = 2600;

export async function loadFonts() {
  const faces = [
    ['Cormorant Garamond', 'cormorant-garamond-latin-500-normal.woff2', '500', 'normal'],
    ['Cormorant Garamond', 'cormorant-garamond-latin-600-normal.woff2', '600', 'normal'],
    ['Cormorant Garamond', 'cormorant-garamond-latin-500-italic.woff2', '500', 'italic'],
    ['Inter', 'inter-latin-400-normal.woff2', '400', 'normal'],
    ['Inter', 'inter-latin-500-normal.woff2', '500', 'normal'],
    ['Inter', 'inter-latin-600-normal.woff2', '600', 'normal'],
  ];
  await Promise.all(faces.map(async ([family, file, weight, style]) => {
    try {
      const face = new FontFace(family, `url(assets/fonts/${file})`, { weight, style });
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      console.warn('Police non chargée', file, e);
    }
  }));
}
