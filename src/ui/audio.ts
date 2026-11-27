// Synthesized cues only (no audio files). Every cue follows a real game event.
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  muted = false;
  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext; if (!AC) return null;
    this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = this.muted ? 0 : .5; this.out.connect(this.ctx.destination);
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c?.state === 'suspended') void c.resume(); }
  setMuted(m: boolean) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : .5; }
  private tone(f: number, dur: number, type: OscillatorType, vol: number, glide?: number, delay = 0) {
    const c = this.ensure(); if (!c || !this.out || this.muted) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + .05);
  }
  move() { this.tone(180, .09, 'triangle', .18, 120); this.tone(900, .03, 'sine', .04); }
  enemy() { this.tone(140, .1, 'triangle', .1, 100); }
  capture() { [1046, 1568].forEach((f, i) => this.tone(f, .7, 'sine', .1, undefined, i * .03)); this.tone(220, .12, 'triangle', .15, 110); }
  loss() { this.tone(160, .6, 'sine', .14, 80); }
  miss() { this.tone(320, .4, 'sine', .08, 160); }
  unfold() { this.tone(220, .5, 'sine', .06, 520); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.1, 'sine', .09, undefined, i * .09)); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, .9, 'sine', .09, undefined, i * .12)); }
  tick() { this.tone(1400, .03, 'sine', .03); }
}
