// 꾸미기 — procedural looks: lathe-turned piece sets, table finishes and board themes.
// Everything is generated (no downloaded assets): clean licensing, zero bytes, and shapes that match the
// loading silhouettes, the physics hulls and the shadows.
import * as T from 'three';
import { LATHE, KNIGHT } from './profiles';
import type { Kind, Side } from '../engine/rules';

export type PieceStyle = 'abg' | 'glass' | 'brass' | 'porcelain';
export type TableStyle = 'walnut' | 'felt' | 'marble' | 'maple';
export type BoardStyle = 'marble' | 'wood' | 'obsidian' | 'jade';
/** Parts the detail editor can retune: colour (multiplies any texture), opacity and the PBR knobs. */
export type Part = 'wp' | 'bp' | 'light' | 'dark' | 'frame' | 'table';
export interface MatSpec { color: string; alpha: number; rough: number; metal: number; glass: number; coat: number }
export interface Look { pieces: PieceStyle; table: TableStyle; board: BoardStyle; custom?: Partial<Record<Part, MatSpec>> }
export const PART_NAMES: Record<Part, string> = { wp: '백 기물', bp: '흑 기물', light: '밝은 칸', dark: '어두운 칸', frame: '테두리', table: '테이블' };
/** Ready-made looks shown before the player's own presets. */
export const FACTORY: { name: string; look: Look }[] = [
  { name: '청자와 흑유', look: { pieces: 'porcelain', board: 'jade', table: 'walnut', custom: { wp: { color: '#9fc9b4', alpha: 1, rough: .14, metal: 0, glass: 0, coat: 1 } } } },
  { name: '붉은 유리', look: { pieces: 'glass', board: 'obsidian', table: 'marble', custom: { bp: { color: '#d0303a', alpha: 1, rough: .06, metal: 0, glass: .9, coat: 1 } } } },
  { name: '은과 묵', look: { pieces: 'brass', board: 'wood', table: 'felt', custom: { wp: { color: '#dfe3ea', alpha: 1, rough: .18, metal: 1, glass: 0, coat: 0 } } } },
];
/** A physical copy of `from` (keeps its textures) with the spec applied. */
export function tuned(from: T.Material, spec: MatSpec): T.MeshPhysicalMaterial {
  const o = from as T.MeshPhysicalMaterial;
  const m = new T.MeshPhysicalMaterial({ map: o.map ?? null, normalMap: o.normalMap ?? null, roughnessMap: o.roughnessMap ?? null, metalnessMap: o.metalnessMap ?? null, aoMap: o.aoMap ?? null, ior: 1.5, thickness: .8, clearcoatRoughness: .08, side: o.side });
  if (o.normalScale) m.normalScale.copy(o.normalScale);
  applySpec(m, spec);
  return m;
}
export function applySpec(m: T.MeshPhysicalMaterial, s: MatSpec) {
  m.color.set(s.color); m.roughness = s.rough; m.metalness = s.metal; m.transmission = s.glass; m.clearcoat = s.coat;
  const see = s.alpha < .999;
  if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
  m.opacity = s.alpha;
}
/** What a material looks like now, as a spec (the editor's starting point). */
export function specOf(from: T.Material | undefined): MatSpec {
  const o = (from ?? {}) as Partial<T.MeshPhysicalMaterial>;
  const clamp = (v: number | undefined, d: number) => Math.max(0, Math.min(1, v ?? d));
  return { color: '#' + (o.color ? o.color.getHexString() : 'ffffff'), alpha: clamp(o.opacity, 1), rough: clamp(o.roughness, .5), metal: clamp(o.metalness, 0), glass: clamp(o.transmission, 0), coat: clamp(o.clearcoat, 0) };
}
export const DEFAULT_LOOK: Look = { pieces: 'abg', table: 'walnut', board: 'marble' };
export const NAMES = {
  pieces: { abg: 'A Beautiful Game', glass: '유리', brass: '황동과 흑단', porcelain: '백자와 흑유' },
  table: { walnut: '호두나무', felt: '초록 펠트', marble: '흑대리석', maple: '단풍나무' },
  board: { marble: '대리석 (원본)', wood: '원목', obsidian: '흑요석과 금', jade: '비취와 상아' },
} as const;

// ── piece sets ─────────────────────────────────────────────────────────────
function materials(style: Exclude<PieceStyle, 'abg'>, side: Side): T.Material {
  if (style === 'glass') return side === 'w'
    ? new T.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: .05, ior: 1.5, thickness: .9, clearcoat: 1, attenuationColor: new T.Color(0xe8f4ff), attenuationDistance: 2.5 })
    : new T.MeshPhysicalMaterial({ color: 0x9fb0c4, transmission: .92, roughness: .08, ior: 1.5, thickness: .9, clearcoat: 1, attenuationColor: new T.Color(0x3a4656), attenuationDistance: 1.6 });
  if (style === 'brass') return side === 'w'
    ? new T.MeshStandardMaterial({ color: 0xd8ab5c, metalness: 1, roughness: .24 })
    : new T.MeshPhysicalMaterial({ color: 0x1b1510, roughness: .38, clearcoat: .8, clearcoatRoughness: .2 });
  return side === 'w'
    ? new T.MeshPhysicalMaterial({ color: 0xf3efe6, roughness: .18, clearcoat: 1, clearcoatRoughness: .05, sheen: .3, sheenColor: new T.Color(0xdfe8ff) })
    : new T.MeshPhysicalMaterial({ color: 0x0e0d0c, roughness: .12, clearcoat: 1, clearcoatRoughness: .04 });
}
function knightGeometry(scale: number): T.BufferGeometry {
  const nums = KNIGHT.match(/-?\d+(\.\d+)?/g)!.map(Number), shape = new T.Shape();
  for (let i = 0; i < nums.length; i += 2) { const x = nums[i] * scale, y = (90 - nums[i + 1]) * scale; i ? shape.lineTo(x, y) : shape.moveTo(x, y); }
  const g = new T.ExtrudeGeometry(shape, { depth: 13 * scale, bevelEnabled: true, bevelSize: 1.6 * scale, bevelThickness: 1.6 * scale, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -6.5 * scale);
  return g;
}
/** A lathe-turned Staunton set scaled so its king matches the height `kingHeight`. */
export function latheSet(style: Exclude<PieceStyle, 'abg'>, kingHeight: number) {
  const top = LATHE.k[LATHE.k.length - 1][1], s = kingHeight / top;
  const geos = new Map<Kind, T.BufferGeometry>();
  for (const k of ['p', 'r', 'b', 'q', 'k'] as Kind[]) geos.set(k, new T.LatheGeometry([new T.Vector2(0, 0), ...LATHE[k].map(([x, y]) => new T.Vector2(x * s, y * s))], 56));
  const base = new T.LatheGeometry([new T.Vector2(0, 0), ...LATHE.p.slice(0, 6).map(([x, y]) => new T.Vector2(x * s, y * s)), new T.Vector2(0, 14 * s)], 56);
  const knight = knightGeometry(s);
  const mats = { w: materials(style, 'w'), b: materials(style, 'b') };
  return (kind: Kind, side: Side) => {
    const g = new T.Group(), inner = new T.Group();
    if (kind === 'n') {
      inner.add(new T.Mesh(base, mats[side]));
      const head = new T.Mesh(knight, mats[side]); head.rotation.y = side === 'w' ? Math.PI / 2 : -Math.PI / 2; inner.add(head);
    } else inner.add(new T.Mesh(geos.get(kind)!, mats[side]));
    inner.traverse(o => { if ((o as T.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(inner); g.userData.kind = kind; g.userData.side = side;
    return g;
  };
}

// ── tables ─────────────────────────────────────────────────────────────────
function canvas(size: number, draw: (g: CanvasRenderingContext2D, n: number) => void, repeat: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; draw(cv.getContext('2d')!, size);
  const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const grain = (base: string, line: (i: number) => string, waves = 6) => (g: CanvasRenderingContext2D, n: number) => {
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 260; i++) { g.strokeStyle = line(i); g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * n; g.moveTo(0, y); for (let x = 0; x <= n; x += 64) g.lineTo(x, y + Math.sin(x / 140 + i) * waves); g.stroke(); }
};
const veins = (base: string, vein: string) => (g: CanvasRenderingContext2D, n: number) => {
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 46; i++) {
    g.strokeStyle = vein; g.globalAlpha = .05 + Math.random() * .2; g.lineWidth = .6 + Math.random() * 2.4; g.beginPath();
    let x = Math.random() * n, y = Math.random() * n; g.moveTo(x, y);
    for (let k = 0; k < 30; k++) { x += (Math.random() - .3) * 40; y += (Math.random() - .5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
};
export function tableMaterial(style: TableStyle): T.MeshStandardMaterial {
  if (style === 'felt') return new T.MeshStandardMaterial({
    color: 0xffffff, roughness: .95, map: canvas(512, (g, n) => { g.fillStyle = '#1f4a33'; g.fillRect(0, 0, n, n); const d = g.getImageData(0, 0, n, n); for (let i = 0; i < d.data.length; i += 4) { const v = (Math.random() - .5) * 22; d.data[i] += v; d.data[i + 1] += v; d.data[i + 2] += v; } g.putImageData(d, 0, 0); }, 8),
  });
  if (style === 'marble') return new T.MeshStandardMaterial({ map: canvas(1024, veins('#141417', '#c8c6c0'), 3), roughness: .18, metalness: .05 });
  if (style === 'maple') return new T.MeshStandardMaterial({ map: canvas(1024, grain('#b98d5c', i => `rgba(${120 + (i % 30)},${80 + (i % 20)},45,${.06 + Math.random() * .1})`), 3), roughness: .5 });
  return new T.MeshStandardMaterial({ map: canvas(1024, grain('#20150f', () => `rgba(${60 + Math.random() * 30},${38 + Math.random() * 18},24,${.08 + Math.random() * .12})`), 3), roughness: .55, metalness: .05 });
}

// ── board themes (on the 64 tiles; the frame is tinted) ───────────────────
export function boardTheme(style: BoardStyle): { light: T.Material; dark: T.Material; frameTint: number } | null {
  if (style === 'marble') return null;
  if (style === 'wood') return {
    light: new T.MeshStandardMaterial({ map: canvas(256, grain('#d9b27c', () => `rgba(150,100,55,${.05 + Math.random() * .1})`, 3), 1), roughness: .45 }),
    dark: new T.MeshStandardMaterial({ map: canvas(256, grain('#5a3520', () => `rgba(30,15,8,${.08 + Math.random() * .12})`, 3), 1), roughness: .45 }),
    frameTint: 0x8a5a36,
  };
  if (style === 'obsidian') return {
    light: new T.MeshStandardMaterial({ color: 0xc9a35a, metalness: .95, roughness: .3 }),
    dark: new T.MeshPhysicalMaterial({ color: 0x08080b, roughness: .06, clearcoat: 1, metalness: .1 }),
    frameTint: 0x3a3836,
  };
  return {
    light: new T.MeshPhysicalMaterial({ color: 0xe6dcc4, roughness: .26, clearcoat: .7, sheen: .2 }),
    dark: new T.MeshPhysicalMaterial({ map: canvas(256, veins('#2f5c4e', '#9ccbb6'), 1), roughness: .2, clearcoat: 1 }),
    frameTint: 0x6f8f80,
  };
}
