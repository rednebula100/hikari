import * as T from 'three';

// Chalk drawn directly onto the board surface (a diegetic canvas decal).
// Strokes are revealed in drawing order, jitter slightly, and are erased by rubbing.
type P = [number, number]; // world (x, z)
interface Stroke {
  kind: 'path' | 'text'
  pts: P[]; text?: string; size?: number
  color: string; width: number; dash?: number; alpha: number
  t0: number; dur: number; seed: number
}
const EXTENT = 12; // canvas covers a 12×12 world square centred on the board

export class Chalk {
  readonly mesh: T.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: T.CanvasTexture;
  private strokes: Stroke[] = [];
  private eraseStart = -1;
  private dirty = true;
  private grain: CanvasPattern | null = null;
  private get clock() { return performance.now(); }

  constructor(y: number) {
    this.canvas.width = this.canvas.height = 2048;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new T.CanvasTexture(this.canvas);
    this.tex.colorSpace = T.SRGBColorSpace; this.tex.anisotropy = 8;
    // chalk grain: a static, tiled alpha texture (no per-redraw erosion pass)
    const gc = document.createElement('canvas'); gc.width = gc.height = 256; const gx = gc.getContext('2d')!;
    const img = gx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random(); const a = v > .72 ? 70 : v > .5 ? 185 : 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = a; img.data[i + 3] = 255; }
    gx.putImageData(img, 0, 0);
    const grain = new T.CanvasTexture(gc); grain.wrapS = grain.wrapT = T.RepeatWrapping; grain.repeat.set(16, 16);
    const mat = new T.MeshBasicMaterial({ map: this.tex, alphaMap: grain, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new T.Mesh(new T.PlaneGeometry(EXTENT, EXTENT), mat);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = y + 0.006; this.mesh.renderOrder = 4;
  }
  private px([x, z]: P): P { return [(x + EXTENT / 2) / EXTENT * 2048, (z + EXTENT / 2) / EXTENT * 2048]; }
  get busy() { return this.dirty || this.strokes.some(s => this.clock < s.t0 + s.dur) || this.eraseStart >= 0; }

  /** Rub everything out over `ms`. */
  erase(ms = 260) { if (this.strokes.length) { this.eraseStart = this.clock; this.eraseDur = ms; } }
  private eraseDur = 260;
  clearNow() { this.strokes = []; this.eraseStart = -1; this.dirty = true; }

  path(pts: P[], o: { color?: string; width?: number; dash?: number; delay?: number; dur?: number; alpha?: number } = {}) {
    this.strokes.push({ kind: 'path', pts, color: o.color ?? '#f3efe2', width: o.width ?? 0.07, dash: o.dash, alpha: o.alpha ?? 0.92,
      t0: this.clock + (o.delay ?? 0), dur: o.dur ?? 220, seed: Math.random() * 1000 });
    this.dirty = true;
  }
  arrow(a: P, b: P, o: Parameters<Chalk['path']>[1] & { head?: number } = {}) {
    this.path([a, b], o);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = o.head ?? 0.28;
    const l: P = [b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)];
    const r: P = [b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)];
    this.path([l, b, r], { ...o, dash: undefined, delay: (o.delay ?? 0) + (o.dur ?? 220) * 0.9, dur: 90 });
  }
  circle(c: P, r: number, o: Parameters<Chalk['path']>[1] = {}) {
    const pts: P[] = [];
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2.08 + 0.3; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    this.path(pts, o);
  }
  cross(c: P, s: number, o: Parameters<Chalk['path']>[1] = {}) {
    this.path([[c[0] - s, c[1] - s], [c[0] + s, c[1] + s]], o);
    this.path([[c[0] + s, c[1] - s], [c[0] - s, c[1] + s]], { ...o, delay: (o.delay ?? 0) + 90 });
  }
  text(text: string, at: P, o: { size?: number; color?: string; delay?: number; dur?: number; alpha?: number } = {}) {
    this.strokes.push({ kind: 'text', pts: [at], text, size: o.size ?? 0.42, color: o.color ?? '#f3efe2', width: 0, alpha: o.alpha ?? 0.95,
      t0: this.clock + (o.delay ?? 0), dur: o.dur ?? 32 * text.length + 120, seed: 0 });
    this.dirty = true;
  }

  private lastDraw = 0;
  update(_dtMs: number) {
    if (!this.dirty && this.clock - this.lastDraw < 22) return;
    this.lastDraw = this.clock;
    if (!this.busy) return;
    const c = this.ctx;
    c.clearRect(0, 0, 2048, 2048);
    let fade = 1;
    if (this.eraseStart >= 0) {
      fade = 1 - (this.clock - this.eraseStart) / this.eraseDur;
      if (fade <= 0) { this.strokes = []; this.eraseStart = -1; fade = 0; }
    }
    const k = 2048 / EXTENT;
    for (const s of this.strokes) {
      const prog = Math.min(1, Math.max(0, (this.clock - s.t0) / s.dur));
      if (prog <= 0) continue;
      c.globalAlpha = s.alpha * fade;
      c.strokeStyle = c.fillStyle = s.color;
      if (s.kind === 'text') {
        const [x, y] = this.px(s.pts[0]);
        c.save(); c.translate(x, y); c.rotate(Math.PI); // readable from White's seat
        c.font = `${Math.round(s.size! * k)}px 'Nanum Pen Script', 'Gaegu', cursive`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const w = c.measureText(s.text!).width;
        c.beginPath(); c.rect(-w / 2 - 4, -s.size! * k, (w + 8) * prog, s.size! * k * 2); c.clip();
        // dark halo keeps chalk legible on pale marble
        c.save(); c.globalAlpha = .55 * fade; c.strokeStyle = 'rgba(8,10,14,1)'; c.lineWidth = s.size! * k * .16; c.lineJoin = 'round'; c.strokeText(s.text!, 0, 0); c.restore();
        c.fillText(s.text!, 0, 0); c.restore();
        continue;
      }
      // total length → partial reveal
      const pts = s.pts.map(p => this.px(p));
      let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      let left = total * prog;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const pass of [-1, 0, 1, 2]) {
        const j = pass <= 0 ? 0 : (pass === 1 ? 1 : -1) * s.width * k * 0.22;
        c.lineWidth = s.width * k * (pass === -1 ? 2.6 : pass === 0 ? 1 : 0.45);
        c.globalAlpha = s.alpha * fade * (pass === -1 ? 0.45 : pass === 0 ? 0.9 : 0.4);
        c.strokeStyle = pass === -1 ? 'rgba(8,10,14,1)' : s.color;
        c.setLineDash(s.dash ? [s.dash * k, s.dash * k * 0.8] : []);
        c.beginPath(); c.moveTo(pts[0][0] + j, pts[0][1] - j);
        let rem = left;
        for (let i = 1; i < pts.length && rem > 0; i++) {
          const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], L = Math.hypot(dx, dy);
          const f = Math.min(1, rem / (L || 1)); rem -= L;
          const wob = Math.sin((i + s.seed) * 2.3) * s.width * k * 0.08;
          c.lineTo(pts[i - 1][0] + dx * f + j + wob, pts[i - 1][1] + dy * f - j);
        }
        c.stroke();
      }
      left = 0;
    }
    c.setLineDash([]);
    c.globalAlpha = 1;
    this.tex.needsUpdate = true;
    this.dirty = false;
  }
}
