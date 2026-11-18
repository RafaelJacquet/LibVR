// Lecteur vidéo 360° : sphère vue de l'intérieur, mono ou stéréo (haut/bas, gauche/droite).
// Projections : 'equirect' (équirectangulaire classique) ou 'eac' (cubemap équi-angulaire
// YouTube : grille 3x2, faces du bas tournées).
// Un élément <video> par vidéo, avec repli automatique entre plusieurs sources.
import * as THREE from 'three';

const RADIUS = 40;
// Le centre de l'image équirectangulaire doit se retrouver devant l'utilisateur.
const BASE_YAW = -Math.PI / 2;

export class Player360 {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    const geo = new THREE.SphereGeometry(RADIUS, 96, 48);
    geo.scale(-1, 1, 1); // on regarde la sphère de l'intérieur
    // Œil gauche (et vue ordinateur) : calque 1 ; œil droit : calque 2.
    this.left = new THREE.Mesh(geo, sphereMaterial());
    this.right = new THREE.Mesh(geo, sphereMaterial());
    this.left.layers.set(1);
    this.right.layers.set(2);
    this.left.renderOrder = this.right.renderOrder = -10;
    this.root.add(this.left, this.right);

    this.entries = new Map(); // id -> { el, src, ready: Promise }
    this.current = null;
    this.onEnded = null;
  }

  /** Crée l'élément vidéo et résout la première source lisible. */
  register(video) {
    if (this.entries.has(video.id)) return this.entries.get(video.id);
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.preload = 'metadata';
    el.addEventListener('ended', () => {
      if (this.current?.video === video) this.onEnded?.(video);
    });
    const entry = { el, src: null, video, format: video };
    entry.ready = resolveSource(el, video.sources).then((source) => {
      entry.src = source.src;
      // la projection / stéréo peut être précisée par source (ex. .mp4 converti en équirect)
      entry.format = { ...video, ...source };
      return entry;
    });
    this.entries.set(video.id, entry);
    return entry;
  }

  /** Image pour la vignette : poster s'il existe, sinon image extraite de la vidéo. */
  async thumbnail(video) {
    const entry = this.register(video);
    if (video.poster) {
      const img = await loadImage(video.poster).catch(() => null);
      if (img) {
        await entry.ready.catch(() => {});
        return { image: img, duration: entry.el.duration };
      }
    }
    await entry.ready;
    const el = entry.el;
    video = entry.format; // format réel de la source retenue
    const t = (el.duration || 10) * (video.thumbnailTime ?? 0.3);
    await seek(el, t);
    // recadrage : environ 90° x 60° face à l'utilisateur (pas de déformation)
    const vw = el.videoWidth, vh = el.videoHeight;
    const halfH = video.stereo === 'top-bottom' ? vh / 2 : vh;
    const fullW = video.stereo === 'left-right' ? vw / 2 : vw;
    let cx, cy, cw, ch;
    if (video.projection === 'eac') { // face avant = case centrale de la rangée du haut
      cw = fullW / 3; ch = (halfH / 2) * (2 / 3);
      cx = fullW / 3; cy = (halfH / 2 - ch) / 2;
    } else {
      cw = fullW / 4; ch = halfH / 3;
      cx = fullW * (0.5 + (video.yawOffset || 0) / 360) - cw / 2;
      cx = ((cx % fullW) + fullW) % fullW;
      cy = halfH / 2 - ch / 2;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = Math.round(720 * (ch / cw));
    canvas.getContext('2d').drawImage(el, cx, cy, Math.min(cw, fullW - cx), ch, 0, 0, canvas.width, canvas.height);
    await seek(el, 0);
    return { image: canvas, duration: el.duration };
  }

  /** Lance une vidéo ; l'avant de la vidéo est placé dans la direction du regard (headYaw). */
  async play(video, headYaw = 0) {
    const entry = this.register(video);
    await entry.ready;
    this.stop();
    const el = entry.el;
    el.preload = 'auto';
    if (el.currentTime > 0.05) await seek(el, 0);

    const tex = new THREE.VideoTexture(el);
    this.current = { video, el, ...this.apply(tex, entry.format, headYaw) };

    try {
      await el.play();
    } catch (e) {
      // lecture avec son refusée (aucun geste utilisateur) : on tente en muet
      console.warn('Lecture avec son refusée, essai en muet', e);
      el.muted = true;
      await el.play();
    }
    await firstFrame(el);
    this.root.visible = true;
  }

  /** Applique une texture (vidéo ou image) avec la projection / stéréo de `video`. */
  apply(tex, video, headYaw = 0) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const texR = tex.clone();
    const st = stereoTransforms(video.stereo || 'mono');
    const eac = video.projection === 'eac';
    [[this.left, tex, st.l], [this.right, texR, st.r]].forEach(([mesh, t, [rx, ry, ox, oy]]) => {
      const u = mesh.material.uniforms;
      u.map.value = t;
      u.uvRect.value.set(rx, ry, ox, oy);
      u.eac.value = eac ? 1 : 0;
      u.decodeSRGB.value = t.isVideoTexture ? 1 : 0;
    });
    // équirect : le centre de l'image (u = 0,5) est devant ; EAC : la face avant est devant
    this.root.rotation.y = (eac ? 0 : BASE_YAW) + headYaw + THREE.MathUtils.degToRad(video.yawOffset || 0);
    return { tex, texR };
  }

  stop() {
    if (!this.current) return;
    const { el, tex, texR } = this.current;
    el.pause();
    tex.dispose();
    texR.dispose();
    this.left.material.uniforms.map.value = this.right.material.uniforms.map.value = null;
    this.current = null;
    this.root.visible = false;
  }

  restart() {
    if (!this.current) return;
    this.current.el.currentTime = 0;
    this.current.el.play().catch(() => {});
  }

  togglePlay() {
    const el = this.current?.el;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }

  get state() {
    const el = this.current?.el;
    return el
      ? { title: this.current.video.title, time: el.currentTime, duration: el.duration || 0, playing: !el.paused }
      : null;
  }

  /** La sphère suit la position de la tête (jamais de parallaxe sur une vidéo 360). */
  follow(headPos) {
    this.root.position.copy(headPos);
  }
}

/** Sous-rectangle de l'image pour chaque œil : [échelleU, échelleV, décalageU, décalageV] */
function stereoTransforms(mode) {
  if (mode === 'top-bottom') return { l: [1, 0.5, 0, 0.5], r: [1, 0.5, 0, 0] };
  if (mode === 'left-right') return { l: [0.5, 1, 0, 0], r: [0.5, 1, 0.5, 0] };
  return { l: [1, 1, 0, 0], r: [1, 1, 0, 0] };
}

function sphereMaterial() {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      map: { value: null },
      uvRect: { value: new THREE.Vector4(1, 1, 0, 0) },
      eac: { value: 0 },
      eacRot: { value: new THREE.Vector2(2, 2) }, // vérifié visuellement sur « Sclérose en plaques »
      decodeSRGB: { value: 0 }, // les VideoTexture arrivent non converties : décodage dans le shader
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv;
        vDir = position; // la géométrie est déjà retournée : position = direction réelle
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform vec4 uvRect;
      uniform float eac;
      uniform vec2 eacRot; // quarts de tour supplémentaires (dessus, dessous)
      uniform float decodeSRGB;
      varying vec2 vUv;
      varying vec3 vDir;
      const float K = 1.2732395; // 4 / PI

      // Cubemap équi-angulaire (YouTube) : rangée du haut = gauche, avant, droite ;
      // rangée du bas = dessous, arrière, dessus, tournées de 90°.
      vec2 eacUv(vec3 d) {
        vec3 a = abs(d);
        vec2 f; float col; float row;
        if (a.y >= a.x && a.y >= a.z) {
          row = 1.0;
          if (d.y > 0.0) { col = 2.0; f = vec2(d.x, d.z) / a.y; }   // dessus
          else           { col = 0.0; f = vec2(d.x, -d.z) / a.y; }  // dessous
        } else if (a.x >= a.z) {
          row = 0.0;
          if (d.x > 0.0) { col = 2.0; f = vec2(d.z, d.y) / a.x; }   // droite
          else           { col = 0.0; f = vec2(-d.z, d.y) / a.x; }  // gauche
        } else {
          if (d.z < 0.0) { row = 0.0; col = 1.0; f = vec2(d.x, d.y) / a.z; }   // avant
          else           { row = 1.0; col = 1.0; f = vec2(-d.x, d.y) / a.z; }  // arrière
        }
        vec2 e = 0.5 + 0.5 * K * atan(f);        // [0,1] sur la face, y vers le haut
        // rotations propres aux faces dessus / dessous (quarts de tour)
        float extra = row > 0.5 ? (col > 1.5 ? eacRot.x : (col < 0.5 ? eacRot.y : 0.0)) : 0.0;
        for (int i = 0; i < 3; i++) if (float(i) < extra) e = vec2(e.y, 1.0 - e.x);
        if (row > 0.5) e = vec2(e.y, 1.0 - e.x); // la rangée du bas est tournée de 90°
        return vec2((col + e.x) / 3.0, (1.0 - row) * 0.5 + e.y * 0.5);
      }

      void main() {
        vec2 uv = eac > 0.5 ? eacUv(normalize(vDir)) : vUv;
        vec4 c = texture2D(map, uv * uvRect.xy + uvRect.zw);
        if (decodeSRGB > 0.5) c = sRGBTransferEOTF(c);
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
  });
}

function resolveSource(el, sources) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const list = sources.map((s) => (typeof s === 'string' ? { src: s } : s));
    const next = () => {
      if (i >= list.length) { reject(new Error('Aucune source lisible : ' + list.map((s) => s.src).join(', '))); return; }
      const source = list[i++];
      const src = source.src;
      const done = (ok) => {
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('error', onErr);
        clearTimeout(timer);
        if (ok) resolve(source); else next();
      };
      const onMeta = () => done(el.videoWidth > 0);
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), 15000);
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('error', onErr);
      el.src = src;
      el.load();
    };
    next();
  });
}

function seek(el, t) {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2) { resolve(); return; }
    const timer = setTimeout(resolve, 8000);
    el.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    el.currentTime = t;
  });
}

function firstFrame(el) {
  return new Promise((resolve) => {
    if (el.readyState >= 3) { resolve(); return; }
    const timer = setTimeout(resolve, 10000);
    el.addEventListener('playing', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
