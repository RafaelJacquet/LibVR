// Contrôles ordinateur : glisser pour regarder, clic pour toucher, clavier.
import * as THREE from 'three';

export class DesktopControls {
  constructor({ renderer, camera, interaction, onMenu, onPlaces, onBack, onGesture }) {
    this.renderer = renderer;
    this.camera = camera;
    this.interaction = interaction;
    this.enabled = true;
    this.yaw = 0;
    this.pitch = -0.08;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(0, 0);
    this.hasPointer = false;

    const el = renderer.domElement;
    let down = null;

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      onGesture?.();
      down = { x: e.clientX, y: e.clientY, moved: 0 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      this.hasPointer = true;
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (!down || !this.enabled) return;
      down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (down.moved > 4) {
        el.classList.add('dragging');
        this.yaw += e.movementX * 0.0032;
        this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0032, -1.35, 1.35);
      }
    });
    el.addEventListener('pointerup', (e) => {
      el.classList.remove('dragging');
      if (down && down.moved <= 4 && this.enabled && e.button === 0) interaction.click();
      down = null;
    });
    el.addEventListener('pointerleave', () => { this.hasPointer = false; });

    addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat) return;
      onGesture?.();
      if (e.code === 'Space' || e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'm') { e.preventDefault(); onMenu(); }
      if (e.key.toLowerCase() === 'l') onPlaces?.();
      if (e.key === 'Escape') onBack();
    });
  }

  update() {
    if (!this.enabled) { this.interaction.pointerRay = null; return; }
    this.camera.rotation.set(-this.pitch, -this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    if (this.hasPointer) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      this.interaction.pointerRay = this.raycaster.ray;
    } else this.interaction.pointerRay = null;
    this.renderer.domElement.classList.toggle('hovering', !!this.interaction.pointerHit);
  }
}
