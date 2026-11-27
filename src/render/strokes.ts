import * as T from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

type Point = { x: number; z: number };

export type V3 = readonly [number, number, number];
const TAU = Math.PI * 2;
const palette = new Map<number, T.Color>();
export function color(hex: number) { let c = palette.get(hex); if (!c) { c = new T.Color(hex); palette.set(hex, c); } return c; }

/** One reusable dynamic line buffer for every thin line in the scene. */
export class Strokes extends T.LineSegments {
  private positions: Float32Array; private colors: Float32Array; private count = 0;
  constructor(capacity = 160000, order = 3) {
    super(new T.BufferGeometry(), new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    this.positions = new Float32Array(capacity * 3); this.colors = new Float32Array(capacity * 4);
    this.geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('color', new T.BufferAttribute(this.colors, 4).setUsage(T.DynamicDrawUsage));
    this.frustumCulled = false; this.renderOrder = order; this.finish();
  }
  reset() { this.count = 0; }
  segment(a: V3, b: V3, hex: number, opacity: number, dash = 0) {
    if (dash > 0) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(length / dash));
      for (let i = 0; i < n; i++) {
        const u = i / n, v = Math.min(1, (i + .55) / n);
        this.segment([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
          [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v, a[2] + (b[2] - a[2]) * v], hex, opacity);
      }
      return;
    }
    if (this.count + 2 > this.positions.length / 3) return;
    const c = color(hex);
    for (const p of [a, b]) { this.positions.set(p, 3 * this.count); this.colors.set([c.r, c.g, c.b, opacity], 4 * this.count); this.count++; }
  }
  /** Horizontal circle (optionally an arc, dashed, clipped to the board square). */
  ring(p: Point, y: number, r: number, hex: number, alpha: number, opts: { clip?: boolean; dash?: number; from?: number; to?: number; n?: number } = {}) {
    if (r <= 1e-4) return;
    const from = opts.from ?? 0, to = opts.to ?? TAU;
    const n = opts.n ?? Math.max(24, Math.min(160, Math.ceil(r * 22 * (to - from) / TAU)));
    for (let i = 0; i < n; i++) {
      if (opts.dash && i % 2) continue;
      const a = from + (to - from) * i / n, b = from + (to - from) * (i + 1) / n;
      const u: V3 = [p.x + r * Math.cos(a), y, p.z + r * Math.sin(a)], v: V3 = [p.x + r * Math.cos(b), y, p.z + r * Math.sin(b)];
      if (opts.clip && (out(u) || out(v))) continue;
      this.segment(u, v, hex, alpha);
    }
  }
  finish() {
    this.geometry.setDrawRange(0, this.count);
    for (const name of ['position', 'color']) {
      const a = this.geometry.getAttribute(name) as T.BufferAttribute; a.clearUpdateRanges();
      if (this.count) a.addUpdateRange(0, a.itemSize * this.count); a.needsUpdate = true;
    }
  }
}
const out = (v: V3) => v[0] < -.02 || v[0] > 8.02 || v[2] < -.02 || v[2] > 8.02;

/** Instanced octahedral markers for events. */
export class Marks extends T.InstancedMesh {
  private n = 0; private readonly o = new T.Object3D();
  constructor(capacity = 1024) {
    super(new T.OctahedronGeometry(1), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true }), capacity);
    this.frustumCulled = false; this.count = 0; this.renderOrder = 4;
  }
  reset() { this.n = 0; }
  mark(x: number, y: number, z: number, size: number, hex: number, squash = 1) {
    if (this.n >= this.instanceMatrix.count) return;
    this.o.position.set(x, y, z); this.o.scale.set(size, size * squash, size); this.o.updateMatrix();
    this.setMatrixAt(this.n, this.o.matrix); this.setColorAt(this.n, color(hex)); this.n++;
  }
  finish() { this.count = this.n; this.instanceMatrix.needsUpdate = true; if (this.instanceColor) this.instanceColor.needsUpdate = true; }
}


/** Screen-space fat lines, additively blended (opacity is folded into colour: light adds). */
export class Bold extends LineSegments2 {
  private pos: number[] = []; private col: number[] = [];
  constructor(width = 2.4) {
    super(new LineSegmentsGeometry(), new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false, worldUnits: false }));
    this.frustumCulled = false; this.renderOrder = 6;
  }
  reset() { this.pos.length = 0; this.col.length = 0; }
  segment(a: V3, b: V3, hex: number, opacity: number, dash = 0) {
    if (dash > 0) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(length / dash));
      for (let i = 0; i < n; i++) {
        const u = i / n, v = Math.min(1, (i + .5) / n);
        this.segment([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v, a[2] + (b[2] - a[2]) * v], hex, opacity);
      }
      return;
    }
    const c = color(hex);
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.col.push(c.r * opacity, c.g * opacity, c.b * opacity, c.r * opacity, c.g * opacity, c.b * opacity);
  }
  finish() {
    if (!this.pos.length) { this.visible = false; return; }
    this.visible = true;
    this.geometry.dispose();
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(this.pos); this.geometry.setColors(this.col);
  }
  setResolution(w: number, h: number) { (this.material as LineMaterial).resolution.set(w, h); }
}
