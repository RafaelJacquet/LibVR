// Sons d'interface discrets, synthétisés (aucun fichier audio).
export class Sounds {
  constructor() {
    this.ctx = null;
    this.volume = 0.22;
  }

  /** À appeler lors d'un geste utilisateur (clic) pour autoriser l'audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, start, dur, gain, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain * this.volume, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'tap':
        this.tone(1180, t, 0.07, 0.5);
        this.tone(590, t, 0.11, 0.35, 'triangle');
        break;
      case 'open':
        this.tone(660, t, 0.22, 0.35);
        this.tone(990, t + 0.07, 0.3, 0.3);
        break;
      case 'close':
        this.tone(880, t, 0.18, 0.3);
        this.tone(587, t + 0.06, 0.25, 0.3);
        break;
      case 'launch':
        this.tone(523, t, 0.5, 0.25);
        this.tone(784, t + 0.08, 0.6, 0.22);
        this.tone(1046, t + 0.16, 0.7, 0.16);
        break;
    }
  }
}
