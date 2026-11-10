// Procedural synth sound effects with the Web Audio API (no audio files)

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.vibrate = true;
    this.master = null;
    this._noise = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      // a short feedback delay gives everything a little synthwave space
      const delay = this.ctx.createDelay(0.5);
      delay.delayTime.value = 0.16;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.22;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.25;
      this.master.connect(comp);
      this.master.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  buzz(pattern) {
    if (this.vibrate && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005, detune = 0 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseHit({ dur = 0.06, vol = 0.3, freq = 2500, q = 1.2, delay = 0, type = 'bandpass' }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  // each player gets their own chord colour when placing a mark
  place(seat = 0) {
    const base = [523.25, 392, 659.25, 440][seat % 4];
    this._tone({ freq: base * 2, to: base, type: 'square', dur: 0.09, vol: 0.06 });
    this._tone({ freq: base, type: 'sawtooth', dur: 0.22, vol: 0.07, detune: 8, delay: 0.01 });
    this._tone({ freq: base * 1.5, type: 'triangle', dur: 0.28, vol: 0.08, delay: 0.02 });
    this._noiseHit({ dur: 0.05, vol: 0.12, freq: 5000, q: 0.8 });
    this.buzz(12);
  }

  // ballpoint scratching across paper
  scribble(dur = 0.4) {
    if (!this.ok) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600;
    f.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    // wobbling pressure as the pen moves
    for (let t = 0; t < dur; t += 0.035) {
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.13, t0 + t + 0.02);
      f.frequency.setValueAtTime(2000 + Math.random() * 1600, t0 + t);
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.03);
    src.connect(f).connect(hp).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.05);
    this.buzz(8);
  }

  // notebook page turning over
  flip() {
    if (!this.ok) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(600, t0);
    f.frequency.exponentialRampToValueAtTime(3800, t0 + 0.35);
    f.frequency.exponentialRampToValueAtTime(900, t0 + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.2);
    src.stop(t0 + 0.8);
    this._tone({ freq: 140, to: 70, type: 'sine', dur: 0.12, vol: 0.12, delay: 0.72 }); // page lands
  }

  hover() { this._tone({ freq: 1800, type: 'sine', dur: 0.03, vol: 0.025 }); }
  click() { this._tone({ freq: 1200, to: 800, type: 'square', dur: 0.04, vol: 0.05 }); }
  error() { this._tone({ freq: 200, to: 140, type: 'square', dur: 0.16, vol: 0.07 }); this.buzz([20, 40, 20]); }
  turn() { this._tone({ freq: 880, type: 'sine', dur: 0.1, vol: 0.06 }); this._tone({ freq: 1320, type: 'sine', dur: 0.12, vol: 0.05, delay: 0.07 }); }
  pop() { this._tone({ freq: 500, to: 1200, type: 'sine', dur: 0.12, vol: 0.12 }); }

  sweep() { // board clearing whoosh
    this._noiseHit({ dur: 0.45, vol: 0.12, freq: 900, q: 0.6, type: 'lowpass' });
    this._tone({ freq: 220, to: 880, type: 'sawtooth', dur: 0.4, vol: 0.05 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._tone({ freq: f, type: 'sawtooth', dur: 0.35, vol: 0.08, delay: i * 0.1, detune: -7 });
      this._tone({ freq: f, type: 'square', dur: 0.3, vol: 0.05, delay: i * 0.1, detune: 7 });
    });
    this._tone({ freq: 1046.5, type: 'triangle', dur: 1.1, vol: 0.14, delay: 0.42 });
    this._tone({ freq: 1318.5, type: 'triangle', dur: 1.1, vol: 0.1, delay: 0.42 });
    this.buzz([40, 60, 40, 60, 120]);
  }

  lose() {
    [392, 349.23, 311.13, 261.63].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.32, vol: 0.07, delay: i * 0.16 }));
    this.buzz(80);
  }

  draw() {
    this._tone({ freq: 440, type: 'triangle', dur: 0.3, vol: 0.1 });
    this._tone({ freq: 415.3, type: 'triangle', dur: 0.45, vol: 0.1, delay: 0.22 });
  }

  zap() { // win line striking through
    this._tone({ freq: 200, to: 2400, type: 'sawtooth', dur: 0.35, vol: 0.07 });
    this._noiseHit({ dur: 0.3, vol: 0.12, freq: 3000, q: 0.7 });
  }

  firework(power = 1) {
    this._noiseHit({ dur: 0.25 + power * 0.2, vol: 0.14 * power, freq: 600, q: 0.5, type: 'lowpass' });
    for (let i = 0; i < 5; i++) this._noiseHit({ dur: 0.03, vol: 0.05, freq: 5000 + Math.random() * 3000, q: 2, delay: 0.15 + Math.random() * 0.4 });
  }
}

export const sfx = new Sfx();
