// ============================================================================
//  Bibliothèque VR — point d'entrée
//  Scène -> le joueur fait apparaître la bibliothèque -> choisit une vidéo 360°.
//  Un 2e bouton au poignet ouvre le panneau « Lieux » pour changer de map.
//  Fonctionne en VR (suivi des mains, sans manettes) et sur ordinateur (aperçu).
// ============================================================================
import * as THREE from 'three';
import { VIDEOS, MAPS, INTERACTION } from './config.js';
import { loadFonts, C } from './ui/theme.js';
import { setMaxAnisotropy } from './ui/canvas.js';
import { Sounds } from './core/Sounds.js';
import { InteractionSystem } from './input/Interaction.js';
import { Hands } from './input/Hands.js';
import { DesktopControls } from './input/Desktop.js';
import { Environment } from './world/Environment.js';
import { Library } from './ui/Library.js';
import { Places } from './ui/Places.js';
import { WristButton } from './ui/WristButton.js';
import { GazeButton } from './ui/GazeButton.js';
import { VideoControls } from './ui/VideoControls.js';
import { Fader } from './ui/Fader.js';
import { Hint } from './ui/Hint.js';
import { Player360 } from './video/Player360.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------ rendu */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.5);
$('stage').appendChild(renderer.domElement);
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.02, 200);
camera.layers.enable(1); // vue ordinateur : voit la vidéo « œil gauche »
const player = new THREE.Group(); // « rig » du joueur : on le place au point d'apparition
player.add(camera);
scene.add(player);
const EYE_HEIGHT = 1.6;
camera.position.y = EYE_HEIGHT;

/* ------------------------------------------------------------ systèmes */
const sounds = new Sounds();
const interaction = new InteractionSystem({ audio: sounds });
const hands = new Hands(renderer, player);
const env = new Environment(scene);
const player360 = new Player360(scene);
const fader = new Fader(camera);
fader.value = 1; // on démarre dans le noir, fondu à l'ouverture
const hint = new Hint();
scene.add(hint.root);

const library = new Library({
  interaction,
  videos: VIDEOS,
  onSelect: (v) => launch(v),
  onClose: () => closeLibrary(),
});
scene.add(library.root);

const places = new Places({
  interaction,
  maps: MAPS,
  onSelect: (m) => goTo(m),
  onClose: () => places.hide(),
});
scene.add(places.root);

const controls = new VideoControls(interaction, {
  onRestart: () => { player360.restart(); controlsIdle = 0; },
  onTogglePlay: () => { player360.togglePlay(); controlsIdle = 0; },
  onQuit: () => exitVideo(),
});
scene.add(controls.root);

const wrist = new WristButton(interaction, hands, { onMenu: () => onMenu(), onPlaces: () => onPlaces() });
scene.add(wrist.root);
const gaze = new GazeButton(interaction, () => onMenu(), sounds);
scene.add(gaze.root);

// réticule (point de regard) — n'apparaît qu'à proximité du bouton « regard »
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.006, 0.009, 32),
  new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
);
const reticleHalo = new THREE.Mesh(
  new THREE.RingGeometry(0.009, 0.0115, 32),
  new THREE.MeshBasicMaterial({ color: C.paper, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
);
reticleHalo.renderOrder = 998;
reticle.add(reticleHalo);
reticle.position.z = -0.9;
reticle.renderOrder = 999;
camera.add(reticle);

// doigts : chaque index peut toucher l'interface
hands.list.forEach((hand, i) => {
  const cursor = new THREE.Mesh(
    new THREE.RingGeometry(0.0045, 0.0065, 32),
    new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }),
  );
  cursor.renderOrder = 60;
  cursor.visible = false;
  scene.add(cursor);
  const tip = new THREE.Vector3();
  interaction.addPoker({
    id: 'hand' + i,
    getTip: () => (hand.tracked ? hand.world('index-finger-tip', tip) : null),
    // les boutons du poignet ne se déclenchent pas avec les doigts de la même main
    exclude: { has: (it) => wrist.owns(it) && hand.handedness === INTERACTION.wristHand },
    cursor,
  });
});

const desktop = new DesktopControls({
  renderer, camera, interaction,
  onMenu: () => onMenu(),
  onPlaces: () => onPlaces(),
  onBack: () => onBack(),
  onGesture: () => sounds.unlock(),
});

/* ------------------------------------------------------------ état */
let mode = 'scene'; // 'scene' | 'busy' | 'video'
let currentMap = null; // entrée de MAPS affichée (null : décor de secours ou ?scene=)
let controlsIdle = 0;
let hintDone = false;
const head = new THREE.Vector3();
const headQ = new THREE.Quaternion();
const fwd = new THREE.Vector3();
const xr = () => renderer.xr.isPresenting;

function headYaw() {
  fwd.set(0, 0, -1).applyQuaternion(headQ);
  return Math.atan2(-fwd.x, -fwd.z);
}

function onMenu() {
  if (mode === 'scene') library.isOpen ? closeLibrary() : openLibrary();
  else if (mode === 'video') controls.isOpen ? controls.hide() : openControls();
}

function onPlaces() {
  if (mode !== 'scene') return; // pas de changement de lieu pendant une vidéo
  places.isOpen ? places.hide() : openPanel(places);
}

function onBack() {
  if (mode === 'scene' && places.isOpen) places.hide();
  else if (mode === 'scene' && library.isOpen) closeLibrary();
  else if (mode === 'video') controls.isOpen ? controls.hide() : openControls();
}

/** Ouvre la bibliothèque ou le panneau Lieux face au joueur (un seul panneau à la fois). */
function openPanel(panel) {
  for (const p of [library, places]) if (p !== panel) p.hide();
  if (xr()) panel.placeAt(head, headYaw(), INTERACTION.libraryDistanceXR, 0.12);
  else panel.placeAt(head, headYaw(), INTERACTION.libraryDistanceDesktop, 0.06);
  panel.show();
  hint.hide();
  hintDone = true;
}

function openLibrary() { openPanel(library); }

function closeLibrary() { library.hide(); }

function openControls() {
  if (xr()) controls.placeAt(head, headYaw(), 0.42, 0.2);
  else controls.placeAt(head, headYaw(), 0.85, 0.22);
  controls.show();
  controlsIdle = 0;
}

async function launch(video) {
  if (mode !== 'scene') return;
  mode = 'busy';
  library.hide();
  await fader.out(0.7, 'Chargement…');
  try {
    await player360.play(video, headYaw());
    env.visible = false;
    mode = 'video';
    wrist.setMode('menu');
    gaze.setMode('menu');
    await fader.in(0.9);
  } catch (e) {
    console.error(e);
    fader.setMessage('Cette vidéo ne peut pas être lue ici');
    await wait(2600);
    player360.stop();
    mode = 'scene';
    await fader.in(0.6);
    openLibrary();
  }
}

async function exitVideo() {
  if (mode !== 'video') return;
  mode = 'busy';
  controls.hide();
  await fader.out(0.6);
  player360.stop();
  env.visible = true;
  wrist.setMode('library');
  gaze.setMode('library');
  mode = 'scene';
  await fader.in(0.7);
  openLibrary();
}
player360.onEnded = () => exitVideo();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ lieux */
/** Place le joueur au point d'apparition de la map (ou à l'origine). */
function placePlayer(spawn) {
  player.position.copy(spawn?.position ?? new THREE.Vector3());
  player.rotation.set(0, spawn?.yaw ?? 0, 0);
  desktop.yaw = 0;
  desktop.pitch = -0.08;
}

/**
 * Changement de lieu : fondu au noir avec le nom du lieu, bascule de décor dans le noir
 * (chargement à la première visite ; textures envoyées au GPU pendant le noir), fondu d'ouverture.
 */
async function goTo(map) {
  if (mode !== 'scene') return;
  if (map.id === currentMap?.id) { places.hide(); return; }
  mode = 'busy';
  places.hide();
  library.hide();
  hint.hide();
  hintDone = true;
  await fader.out(0.6, map.title);
  const black = performance.now();
  const shown = await env.show(map.glb);
  if (!shown) {
    fader.setMessage('Ce lieu n’a pas pu être chargé');
    await wait(2400);
    mode = 'scene';
    await fader.in(0.6);
    return;
  }
  placePlayer(shown.spawn);
  currentMap = map;
  places.setCurrent(map.id);
  // le nom du lieu reste lisible un instant (et le décor finit de s'afficher dans le noir)
  await wait(Math.max(0, 1200 - (performance.now() - black)));
  mode = 'scene';
  await fader.in(0.9);
}

/* ------------------------------------------------------------ VR */
async function enterVR() {
  sounds.unlock();
  const session = await navigator.xr.requestSession('immersive-vr', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'bounded-floor'],
  });
  await renderer.xr.setSession(session);
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  desktop.enabled = false;
  camera.layers.disable(1); // en VR, chaque œil a son propre calque vidéo
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  library.hide();
  places.hide();
  controls.hide();
  hint.setVariant('xr');
  if (!hintDone) hint.show();
  hint.yaw = null;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  desktop.enabled = true;
  camera.layers.enable(1);
  camera.position.set(0, EYE_HEIGHT, 0);
  hint.setVariant('desktop');
  library.hide();
  places.hide();
  controls.hide();
});

/* ------------------------------------------------------------ boucle */
const clock = new THREE.Clock();
let time = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;

  desktop.update();
  // en VR, Three.js recopie la pose du casque dans `camera` (image précédente : suffisant pour l'interface)
  camera.getWorldPosition(head);
  camera.getWorldQuaternion(headQ);

  hands.update(dt);
  wrist.update(dt, time, head, headQ);

  // bouton « regard » : toujours sur ordinateur ; en VR seulement si les mains sont perdues
  gaze.drop = xr() ? 0.5 : 0.42;
  gaze.active = mode !== 'busy' && (!xr() || hands.sinceSeen() > INTERACTION.handsLostDelay)
    && !(mode === 'scene' && (library.isOpen || places.isOpen)) && !(mode === 'video' && controls.isOpen);
  const looking = gaze.update(dt, time, head, headQ);
  reticle.material.opacity += ((gaze.active && (looking || gaze.dwell > 0) ? 0.9 : 0) - reticle.material.opacity) * Math.min(1, dt * 10);
  reticle.visible = reticle.material.opacity > 0.01;
  reticleHalo.material.opacity = reticle.material.opacity * 0.7;

  interaction.update(dt);
  library.update(dt);
  places.update(dt);

  // barre vidéo
  const st = player360.state;
  if (st) {
    controls.setInfo(st.title, st.time, st.duration, st.playing);
    player360.follow(head);
  }
  if (controls.isOpen && st?.playing && !controls.hovered) {
    controlsIdle += dt;
    if (controlsIdle > INTERACTION.controlsAutoHide) controls.hide();
  } else controlsIdle = 0;
  controls.update(dt);

  hint.update(dt, head, headYaw());
  fader.update(dt, time);
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------------------------------------ démarrage */
async function start() {
  await loadFonts();
  // re-dessine les textures maintenant que les polices sont là
  library.cards.forEach((c) => c.draw());
  places.cards.forEach((c) => c.draw());
  hint.setVariant('desktop');

  // 1er lieu (ou décor imposé par ?scene=…) ; à défaut, le pavillon de secours reste affiché
  const forced = new URLSearchParams(location.search).get('scene');
  let shown = forced ? await env.show(forced) : null;
  if (!shown) {
    shown = await env.show(MAPS[0].glb);
    if (shown) currentMap = MAPS[0];
  }
  if (shown) placePlayer(shown.spawn);
  places.setCurrent(currentMap?.id);

  $('loader').classList.add('done');
  fader.in(1.4);
  hint.show();

  // vignettes + durées (en arrière-plan)
  for (const v of VIDEOS) {
    player360.thumbnail(v)
      .then(({ image, duration }) => library.setThumbnail(v.id, image, duration))
      .catch((e) => console.warn(`Vignette indisponible pour « ${v.title} »`, e));
  }

  // bouton VR
  const btn = $('enter-vr');
  if (navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) {
    btn.hidden = false;
    btn.addEventListener('click', () => enterVR().catch((e) => {
      console.error(e);
      $('vr-note').textContent = 'Impossible de démarrer la VR : ' + e.message;
    }));
    $('vr-note').textContent = 'Casque détecté';
  } else {
    $('vr-note').textContent = 'Aperçu ordinateur — aucun casque VR détecté';
  }
}
start();

// accès console pour le débogage
window.app = { scene, camera, desktop, library, places, wrist, gaze, fader, controls, player360, env, interaction, hands, hint, onMenu, onPlaces, launch, exitVideo, goTo, get mode() { return mode; } };
