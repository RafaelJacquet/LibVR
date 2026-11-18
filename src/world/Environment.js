// Décors : les maps (.glb, une seule affichée à la fois, gardées en mémoire une fois chargées).
// Secours si aucune map ne charge : un pavillon minéral généré en code, sous un ciel de crépuscule.
// Volontairement léger (peu de polygones, pas d'ombres temps réel) pour le Quest.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const SKY_TOP = new THREE.Color('#0d0f12');
const SKY_HORIZON = new THREE.Color('#3a332c');
const FOG = new THREE.Color('#1c1a18');

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.maps = new Map();   // url -> Promise<{ group, spawn, baked } | null>
    this.current = null;     // map affichée

    this.lights = new THREE.Group();
    const hemi = new THREE.HemisphereLight(0xf3e6d2, 0x17140f, 1.25);
    const key = new THREE.DirectionalLight(0xffe2bd, 1.4);
    key.position.set(-6, 9, 4);
    const fill = new THREE.DirectionalLight(0xb9c3d6, 0.35);
    fill.position.set(5, 4, -6);
    this.lights.add(hemi, key, fill);
    scene.add(this.lights);

    this.defaultDecor = buildDecor();
    this.root.add(this.defaultDecor);
    this.sky = buildSky();
    this.root.add(this.sky);
    this.defaultFog = new THREE.Fog(FOG, 9, 34);
    this.applyLook(false);
  }

  set visible(v) {
    this.root.visible = v;
    this.lights.visible = v && !this.lightsOff;
  }

  /** Décor précalculé : il apporte sa propre lumière et son ciel. Sinon : ciel, lumières, brume. */
  applyLook(baked) {
    this.sky.visible = !baked;
    this.lightsOff = baked;
    this.lights.visible = this.root.visible && !baked;
    this.scene.fog = baked ? null : this.defaultFog;
    this.scene.background = baked ? new THREE.Color('#d9d6d0') : FOG.clone();
  }

  /** Charge un .glb (une seule fois : les maps déjà chargées restent en mémoire). */
  load(url) {
    if (!this.maps.has(url)) this.maps.set(url, this.loadGLB(url));
    return this.maps.get(url);
  }

  /**
   * Affiche la map `url` (et masque les autres). Renvoie { spawn } ou null si elle n'a pas
   * pu être chargée — dans ce cas l'affichage n'est pas modifié.
   */
  async show(url) {
    const map = await this.load(url);
    if (!map) return null;
    for (const p of this.maps.values()) {
      const m = await p;
      if (m) m.group.visible = m === map;
    }
    this.defaultDecor.visible = false;
    this.applyLook(map.baked);
    this.current = map;
    return map;
  }

  async loadGLB(url) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) return null;
    } catch {
      return null;
    }
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('vendor/three/addons/libs/draco/gltf/');
    loader.setDRACOLoader(draco);
    try {
      const gltf = await loader.loadAsync(url);
      const group = gltf.scene;
      group.visible = false;
      const baked = bakeMaterials(group);
      this.root.add(group);
      let spawn = null;
      const sp = group.getObjectByName('Spawn');
      if (sp) {
        group.updateMatrixWorld(true);
        spawn = { position: sp.getWorldPosition(new THREE.Vector3()), yaw: worldYaw(sp) };
      }
      return { group, spawn, baked };
    } catch (e) {
      console.warn('Scène GLB non chargée :', url, e);
      return null;
    } finally {
      draco.dispose();
    }
  }
}

/**
 * Convertit les matériaux d'un décor précalculé (voir tools/scene-bureau/build_scene.py)
 * en matériaux non éclairés très légers pour le Quest :
 *   LM_*    couleur × lightmap (canal émissif, 2e jeu d'UV)
 *   VC_*    couleur × éclairage par sommet
 *   GLASS_* vitrage transparent      UNLIT_* sans éclairage (ciel, voilages, lumière)
 *   suffixe _MASK : découpe alpha (feuillages)
 * Renvoie true si le décor contient de tels matériaux.
 */
function bakeMaterials(root) {
  const k = root.userData?.lightmapIntensity ?? 1;
  const cache = new Map();
  let found = false;

  const convert = (m) => {
    if (cache.has(m)) return cache.get(m);
    const name = m.name || '';
    const mask = name.endsWith('_MASK');
    let out = null;
    if (name.startsWith('LM_')) {
      out = new THREE.MeshBasicMaterial({
        map: m.map, color: m.color, lightMap: m.emissiveMap, lightMapIntensity: Math.PI * k,
        alphaTest: mask ? 0.5 : 0, side: mask ? THREE.DoubleSide : THREE.FrontSide,
      });
    } else if (name.startsWith('VC_')) {
      out = new THREE.MeshBasicMaterial({
        map: m.map, color: m.color.clone().multiplyScalar(k), vertexColors: true,
        alphaTest: mask ? 0.5 : 0, side: THREE.DoubleSide,
      });
    } else if (name.startsWith('GLASS_')) {
      out = new THREE.MeshBasicMaterial({
        color: m.color, transparent: true, opacity: Math.max(0.03, m.opacity), depthWrite: false,
      });
    } else if (name.startsWith('UNLIT_')) {
      const light = name.includes('Light');
      out = new THREE.MeshBasicMaterial({
        map: m.map,
        color: light ? new THREE.Color('#fff4e6') : m.color,
        transparent: m.transparent || m.opacity < 1,
        opacity: m.opacity,
        depthWrite: !(m.transparent || m.opacity < 1),
        side: name.includes('Sky') ? THREE.FrontSide : THREE.DoubleSide,
      });
    }
    if (out) {
      found = true;
      out.name = name;
      out.fog = false;
      if (out.lightMap) out.lightMap.colorSpace = THREE.SRGBColorSpace;
      m.dispose();
    }
    cache.set(m, out || m);
    return out || m;
  };

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    const names = [].concat(o.material).map((x) => x.name);
    if (names.some((n) => n.startsWith('UNLIT_Sky'))) { o.renderOrder = -100; o.frustumCulled = false; }
    if (names.some((n) => n.startsWith('GLASS_') || n.startsWith('UNLIT_Curtain'))) o.renderOrder = 5;
  });
  return found;
}

function worldYaw(obj) {
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(-d.x, -d.z);
}

/* --------------------------------------------------------------- ciel */
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY_TOP },
      horizon: { value: SKY_HORIZON },
      ground: { value: FOG },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.7)) : mix(horizon, ground, smoothstep(0.0, 0.08, -h));
        // halo chaud et diffus à l'horizon, côté « soleil couchant »
        float sun = pow(max(dot(normalize(vec3(-0.55, 0.05, 0.83)), vDir), 0.0), 6.0);
        c += vec3(0.23, 0.15, 0.08) * sun * (1.0 - smoothstep(0.0, 0.5, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), mat);
  sky.renderOrder = -100;
  return sky;
}

/* ------------------------------------------------------------- pavillon */
function buildDecor() {
  const g = new THREE.Group();

  // Sol : pierre sombre avec un halo de lumière doux sous l'utilisateur
  const floorTex = radialTexture(['#3b3731', '#2a2723', '#1c1a18'], [0, 0.35, 1]);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshLambertMaterial({ map: floorTex }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const stone = new THREE.MeshLambertMaterial({ color: 0xbdb2a1 });
  const stoneDark = new THREE.MeshLambertMaterial({ color: 0x5c564d });

  // Estrade circulaire où se tient l'utilisateur
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.75, 0.04, 64), stoneDark);
  dais.position.y = 0.02;
  g.add(dais);
  const inlay = new THREE.Mesh(
    new THREE.RingGeometry(1.52, 1.54, 96),
    new THREE.MeshBasicMaterial({ color: 0xa8916b, transparent: true, opacity: 0.55 }),
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.041;
  g.add(inlay);

  // Colonnade
  const N = 14, RAD = 7.5, H = 5.2;
  const colGeo = new THREE.CylinderGeometry(0.16, 0.18, H, 20);
  const baseGeo = new THREE.BoxGeometry(0.5, 0.16, 0.5);
  const cols = new THREE.InstancedMesh(colGeo, stone, N);
  const bases = new THREE.InstancedMesh(baseGeo, stoneDark, N);
  const caps = new THREE.InstancedMesh(baseGeo, stone, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    const x = Math.sin(a) * RAD, z = Math.cos(a) * RAD;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    cols.setMatrixAt(i, m.compose(new THREE.Vector3(x, H / 2 + 0.16, z), q, s));
    bases.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.08, z), q, s));
    caps.setMatrixAt(i, m.compose(new THREE.Vector3(x, H + 0.24, z), q, s));
  }
  g.add(cols, bases, caps);

  // Anneau architectural au sommet
  const lintel = new THREE.Mesh(new THREE.TorusGeometry(RAD, 0.2, 10, 96), stone);
  lintel.rotation.x = Math.PI / 2;
  lintel.position.y = H + 0.46;
  lintel.scale.z = 0.7;
  g.add(lintel);

  // Bassin d'eau sombre et immobile entre l'estrade et la colonnade
  const water = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 5.6, 96),
    new THREE.MeshLambertMaterial({ color: 0x15171a, emissive: 0x0b0c0e }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.012;
  g.add(water);
  const rim = new THREE.MeshLambertMaterial({ color: 0x8f877a });
  for (const r of [3.4, 5.6]) {
    const edge = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 128), rim);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.03;
    edge.scale.z = 0.5;
    g.add(edge);
  }

  // Quelques monolithes lointains pour la profondeur
  const mono = new THREE.MeshLambertMaterial({ color: 0x4a453e });
  [[-14, 6.5, -18, 0.3], [17, 9, -11, -0.5], [-19, 4.5, 9, 0.9], [11, 7.5, 19, 0.2]].forEach(([x, h, z, r]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), mono);
    b.position.set(x, h / 2, z);
    b.rotation.y = r;
    g.add(b);
  });

  return g;
}

function radialTexture(colors, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  colors.forEach((col, i) => grad.addColorStop(stops[i], col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
