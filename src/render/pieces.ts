import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Kind } from '../chess/game';

// Procedural chess silhouettes: lathe-turned bodies plus a few cut details.
const V = (x: number, y: number) => new T.Vector2(x, y);
const base = [V(0, 0), V(.37, 0), V(.37, .05), V(.34, .08), V(.3, .1), V(.3, .13), V(.25, .16)];
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 10) {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return V(Math.max(0, cx + r * Math.cos(a)), cy + r * Math.sin(a)); });
}
const PROFILE: Record<Exclude<Kind, 'N'>, T.Vector2[]> = {
  P: [...base, V(.17, .22), V(.12, .36), V(.17, .4), V(.17, .42), V(.11, .45), ...arc(0, .54, .13, -Math.PI / 2 + .55, Math.PI / 2)],
  R: [...base, V(.22, .2), V(.19, .5), V(.25, .54), V(.26, .7), V(.2, .7), V(.2, .63), V(0, .63)],
  B: [...base, V(.19, .2), V(.12, .5), V(.2, .54), V(.2, .56), V(.12, .58), ...arc(0, .74, .15, -Math.PI / 2 + .3, Math.PI / 2 - .15), V(.05, .9), ...arc(0, .94, .045, -Math.PI / 2, Math.PI / 2, 6)],
  Q: [...base, V(.21, .2), V(.13, .58), V(.22, .63), V(.22, .65), V(.14, .68), V(.26, .9), V(.22, .92), V(.16, .88), ...arc(0, .97, .06, -Math.PI / 2, Math.PI / 2, 6)],
  K: [...base, V(.22, .2), V(.14, .62), V(.23, .67), V(.23, .69), V(.15, .72), V(.24, .9), V(.2, .93), V(0, .95)],
};
const HEIGHT: Record<Kind, number> = { P: .67, R: .7, B: .99, N: .86, Q: 1.03, K: 1.2 };
export const pieceHeight = (k: Kind) => HEIGHT[k];

function knightHead() {
  const s = new T.Shape();
  const pts = [[-.2, .14], [.2, .14], [.15, .3], [.06, .42], [.2, .47], [.31, .55], [.32, .63], [.24, .68], [.13, .71], [.07, .8], [.02, .93], [-.04, .85], [-.09, .92], [-.13, .82], [-.2, .7], [-.24, .52], [-.23, .34]];
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: .2, bevelEnabled: true, bevelThickness: .05, bevelSize: .03, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -.1);
  return g;
}
const cache = new Map<Kind, T.BufferGeometry>();
export function pieceGeometry(k: Kind): T.BufferGeometry {
  let g = cache.get(k);
  if (g) return g;
  if (k === 'N') {
    const foot = new T.LatheGeometry([...base, V(.22, .2), V(0, .2)], 40);
    const head = knightHead().toNonIndexed(); head.deleteAttribute('uv');
    const f = foot.toNonIndexed(); f.deleteAttribute('uv');
    g = mergeGeometries([f, head])!;
  } else {
    const parts: T.BufferGeometry[] = [new T.LatheGeometry(PROFILE[k], 48)];
    if (k === 'R') for (let i = 0; i < 4; i++) {
      const b = new T.BoxGeometry(.11, .09, .1); b.translate(0, .745, .2); b.rotateY(i * Math.PI / 2 + Math.PI / 4); parts.push(b);
    }
    if (k === 'K') { const a = new T.BoxGeometry(.06, .22, .06); a.translate(0, 1.06, 0); const c = new T.BoxGeometry(.18, .06, .06); c.translate(0, 1.09, 0); parts.push(a, c); }
    const flat = parts.map(p => { const n = p.index ? p.toNonIndexed() : p; n.deleteAttribute('uv'); return n; });
    g = mergeGeometries(flat)!;
  }
  g.computeVertexNormals();
  cache.set(k, g);
  return g;
}

export const MAT = {
  white: new T.MeshPhysicalMaterial({ color: 0xe8e2d4, roughness: .38, metalness: 0, clearcoat: .7, clearcoatRoughness: .25, sheen: .3 }),
  black: new T.MeshPhysicalMaterial({ color: 0x1b1f29, roughness: .22, metalness: .35, clearcoat: 1, clearcoatRoughness: .12 }),
  ghost: new T.MeshStandardMaterial({ color: 0xff7f95, emissive: 0x7a1a2c, emissiveIntensity: .6, transparent: true, opacity: .3, depthWrite: false, roughness: .2 }),
  ghostEdge: new T.LineBasicMaterial({ color: 0xff9fb0, transparent: true, opacity: .55, toneMapped: false }),
  echo: new T.MeshStandardMaterial({ color: 0xf2d59b, emissive: 0x8a6a2a, emissiveIntensity: .7, transparent: true, opacity: .32, depthWrite: false }),
  echoEdge: new T.LineBasicMaterial({ color: 0xf2d59b, transparent: true, opacity: .7, toneMapped: false }),
  glowW: new T.MeshBasicMaterial({ color: 0x56d4f2, toneMapped: false }),
  glowB: new T.MeshBasicMaterial({ color: 0xff637e, toneMapped: false }),
};
const edgeCache = new Map<Kind, T.EdgesGeometry>();
const ring = new T.TorusGeometry(.31, .012, 6, 48); ring.rotateX(Math.PI / 2); ring.translate(0, .115, 0);

/** A solid piece (own, or enemy seen live). */
export function solidPiece(k: Kind, side: 'w' | 'b') {
  const g = new T.Group();
  const m = new T.Mesh(pieceGeometry(k), side === 'w' ? MAT.white : MAT.black); m.castShadow = m.receiveShadow = true;
  if (k === 'N') m.rotation.y = side === 'w' ? 0 : Math.PI;
  g.add(m, new T.Mesh(ring, side === 'w' ? MAT.glowW : MAT.glowB));
  return g;
}
/** A translucent image of a piece (stale enemy sighting or own afterimage). */
export function imagePiece(k: Kind, side: 'w' | 'b', kind: 'ghost' | 'echo') {
  const g = new T.Group();
  const m = new T.Mesh(pieceGeometry(k), kind === 'ghost' ? MAT.ghost : MAT.echo);
  if (k === 'N') m.rotation.y = side === 'w' ? 0 : Math.PI;
  let e = edgeCache.get(k); if (!e) { e = new T.EdgesGeometry(pieceGeometry(k), 28); edgeCache.set(k, e); }
  const lines = new T.LineSegments(e, kind === 'ghost' ? MAT.ghostEdge : MAT.echoEdge); lines.rotation.copy(m.rotation);
  m.renderOrder = lines.renderOrder = 5;
  g.add(m, lines);
  return g;
}
