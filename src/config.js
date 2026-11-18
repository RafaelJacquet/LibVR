// ============================================================================
//  CONFIGURATION — tout ce qu'on modifie couramment est ici.
// ============================================================================

export const VIDEOS = [
  {
    id: 'autisme',
    title: 'Autism TMI',
    subtitle: 'La surcharge sensorielle vécue de l’intérieur',
    // Sources essayées dans l'ordre : la 1re lisible par le navigateur est utilisée.
    // (les .mkv sont lus directement : VP9 ou H.264, aucune conversion nécessaire)
    // Une source peut préciser son propre format : { src, projection, stereo }.
    sources: ['videos/autism-tmi.mkv'],
    // Vignette optionnelle (jpg/png). Sinon elle est extraite de la vidéo.
    poster: 'videos/autism-tmi.jpg',
    thumbnailTime: 0.3, // position (0..1) de l'image extraite si pas de poster
    projection: 'equirect', // 'equirect' (classique) | 'eac' (cubemap YouTube, grille 3x2)
    stereo: 'mono',     // 'mono' | 'top-bottom' | 'left-right'
    yawOffset: 0,       // rotation (degrés) pour recadrer l'avant de la vidéo
  },
  {
    id: 'retinopathie',
    title: 'Rétinopathie diabétique',
    subtitle: 'Voir le monde à travers une vision altérée',
    // NB : ce « .mkv » est en réalité un MP4 H.264 — le navigateur le lit tel quel.
    sources: ['videos/retinopathie-diabetique.mkv'],
    thumbnailTime: 0.3,
    projection: 'eac', // format YouTube « Equi-Angular Cubemap » (grille 3x2), comme Sclérose
    stereo: 'mono',
    yawOffset: 0,
  },
  {
    id: 'sclerose',
    title: 'Sclérose en plaques',
    subtitle: 'Ressentir les symptômes du quotidien',
    sources: ['videos/sclerose-en-plaques.mkv'],
    thumbnailTime: 0.3,
    projection: 'eac', // format YouTube « Equi-Angular Cubemap » (grille 3x2)
    stereo: 'mono',
    yawOffset: 0,
  },
];

export const LIBRARY = {
  title: 'Bibliothèque',
  kicker: 'Expériences immersives',
};

// Lieux (maps) proposés par le bouton « Lieux » du poignet. Le 1er est celui du démarrage.
//   glb     : décor exporté (un objet vide « Spawn » dans le .glb = point d'apparition)
//   preview : aperçu affiché sur la carte (jpg/png)
// Astuce : ?scene=scenes/mon-decor.glb dans l'adresse ouvre un autre décor au démarrage.
export const MAPS = [
  {
    id: 'bureau1',
    title: 'Bureau 1',
    subtitle: 'Mobilier intégré',
    glb: 'scenes/bureau/bureau.glb',
    preview: 'scenes/bureau/bureau.jpg',
  },
  {
    id: 'bureau2',
    title: 'Bureau 2',
    subtitle: 'Mobilier indépendant (Moda)',
    glb: 'scenes/bureau/bureau_nofurn-map_rendu.glb',
    preview: 'scenes/bureau/bureau_nofurn-map_rendu.jpg',
  },
];

export const INTERACTION = {
  wristHand: 'left',        // main qui porte le bouton du poignet
  gazeDwell: 1.5,           // secondes de fixation pour le bouton « regard »
  handsLostDelay: 1.5,      // secondes sans mains avant d'afficher le bouton « regard »
  libraryDistanceXR: 0.48,  // distance du panneau en VR (à portée de bras), en m
  libraryDistanceDesktop: 0.95,
  controlsAutoHide: 8,      // secondes avant de masquer la barre vidéo (lecture en cours)
};
