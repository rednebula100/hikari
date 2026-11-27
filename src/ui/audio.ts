// All sounds are synthesized at runtime (no audio files). Every cue follows a real event.
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private hum: { o: OscillatorNode; g: GainNode }[] = [];
  muted = false;
  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext; if (!AC) return null;
    this.ctx = new AC();
    this.out = this.ctx.createGain(); this.out.gain.value = this.muted ? 0 : .55;
    const comp = this.ctx.createDynamicsCompressor(); this.out.connect(comp); comp.connect(this.ctx.destination);
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c?.state === 'suspended') void c.resume(); }
  setMuted(m: boolean) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : .55; }
  private tone(f: number, dur: number, type: OscillatorType, vol: number, o: { glide?: number; delay?: number; attack?: number } = {}) {
    const c = this.ensure(); if (!c || !this.out || this.muted) return;
    const t = c.currentTime + (o.delay ?? 0), osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t); if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack ?? .004)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    osc.connect(g); g.connect(this.out); osc.start(t); osc.stop(t + dur + .05);
  }
  private noise(dur: number, vol: number, o: { from?: number; to?: number; q?: number; delay?: number; attack?: number } = {}) {
    const c = this.ensure(); if (!c || !this.out || this.muted) return;
    const t = c.currentTime + (o.delay ?? 0), n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = o.q ?? 1.2;
    bp.frequency.setValueAtTime(o.from ?? 800, t); bp.frequency.exponentialRampToValueAtTime(o.to ?? o.from ?? 800, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack ?? .01)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.out); src.start(t); src.stop(t + dur);
  }
  /** Lamp hum + distant clock: the only "music". */
  ambience(on: boolean) {
    const c = this.ensure(); if (!c || !this.out) return;
    if (on && !this.hum.length) for (const [f, v] of [[60, .018], [120, .01], [180, .004]] as const) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(this.out); o.start(); this.hum.push({ o, g });
    }
    if (!on) { this.hum.forEach(h => h.o.stop()); this.hum = []; }
  }
  switchOn() { this.noise(.05, .5, { from: 3000, q: 4 }); this.tone(90, .25, 'square', .03, { delay: .02 }); }
  chalk(ms = 400) { this.noise(ms / 1000, .06, { from: 2600, to: 3400, q: .9, attack: .03 }); }
  slide(speedFrac: number, ms: number) { this.noise(ms / 1000, .03 + .06 * speedFrac, { from: 500 + 900 * speedFrac, to: 300, q: .7, attack: .05 }); }
  /** Ivory clack: pitch falls with total mass, loudness grows with impulse; chains climb a scale. */
  clack(massSum: number, impulse: number, chain = 1) {
    const f = 2600 / Math.sqrt(massSum) * Math.pow(1.122, chain - 1), v = Math.min(.5, .12 + impulse * .03);
    this.tone(f, .16, 'triangle', v); this.tone(f * 2.76, .06, 'sine', v * .5); this.noise(.04, v * .8, { from: f * 1.5, q: 2 });
  }
  strobe() { this.tone(5200, .012, 'square', .012); }
  fall() { this.noise(.7, .07, { from: 1200, to: 200, q: .6, attack: .1 }); this.tone(70, .5, 'sine', .12, { delay: 1.25 }); this.noise(.12, .05, { from: 300, delay: 1.25 }); }
  whistle() { this.tone(1800, .45, 'sine', .04, { glide: 600 }); }
  stomp(mass: number) { this.tone(70 + 40 / mass, .35, 'sine', .35, { glide: 40 }); this.noise(.25, .25, { from: 400, to: 120 }); }
  sizzle() { this.noise(1.4, .05, { from: 5000, to: 3000, q: .5, attack: .02 }); }
  settle() { this.tone(240, .05, 'triangle', .04); }
  /** A blind move that found nothing: a hollow knock. */
  miss() { this.tone(180, .35, 'sine', .08, { glide: 110 }); this.noise(.2, .03, { from: 400 }); }
  check() { this.tone(98, .22, 'sine', .14); this.tone(92, .22, 'sine', .12, { delay: .28 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.2, 'sine', .08, { delay: i * .1 })); }
  lose() { this.tone(60, 2.2, 'sine', .15, { glide: 40 }); }
  /** The pyramid opens: a rising tone. */
  unfold() { this.tone(220, .5, 'sine', .05, { glide: 520 }); }
  tick() { this.tone(1500, .03, 'sine', .03); }
}
