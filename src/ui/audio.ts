// Small synthesized sound set (no external assets). Every cue is triggered by a
// real event that has entered the player's past light cone.
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: OscillatorNode[] = [];
  muted = false;
  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : .5;
    const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c?.state === 'suspended') void c.resume(); this.startDrone(); }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : .5; }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, glide?: number, delay = 0) {
    const c = this.ensure(); if (!c || !this.master || this.muted) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  }
  private startDrone() {
    const c = this.ctx; if (!c || !this.master || this.drone.length) return;
    const g = c.createGain(); g.gain.value = .022; g.connect(this.master);
    for (const f of [55, 82.4, 110.3]) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 6; o.connect(g); o.start(); this.drone.push(o); }
  }
  emit() { this.tone(1320, .07, 'sine', .14); this.tone(2640, .05, 'sine', .05, undefined, .01); }
  receive() { this.tone(660, .5, 'sine', .08); this.tone(990, .6, 'sine', .04, undefined, .03); }
  score() { [784, 988, 1318].forEach((f, i) => this.tone(f, .9, 'sine', .1, undefined, i * .07)); }
  enemyScore() { this.tone(196, .7, 'triangle', .08); }
  eclipse() { this.tone(520, .9, 'sine', .12, 130); this.tone(523, .9, 'sine', .1, 128); }
  flash() { this.tone(2100, .04, 'square', .02); }
  commit() { this.tone(440, .12, 'triangle', .07, 880); }
  unfold() { this.tone(220, .45, 'sine', .05, 440); }
}
