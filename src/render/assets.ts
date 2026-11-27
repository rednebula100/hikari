import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Kind, Side } from '../engine/rules';

// "A Beautiful Game" — © 2020 ASWF (MaterialX Project), glTF conversion © 2022 Ed Mackey.
// CC-BY-4.0, via KhronosGroup/glTF-Sample-Assets. One square = 0.0625 m; we scale ×16 → 1 unit.
export const SCALE = 16;
const NODE: Record<Kind, string> = { k: 'King_', q: 'Queen_', r: 'Castle_', b: 'Bishop_', n: 'Knight_', p: 'Pawn_Body_' };

export interface ChessSet {
  board: T.Object3D
  /** World y of the playing surface (piece seat). */
  surface: number
  make(kind: Kind, side: Side): T.Object3D
}

export async function loadSet(renderer: T.WebGLRenderer, onProgress?: (f: number) => void): Promise<ChessSet> {
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader().setDecoderPath(base + 'decoders/draco/');
  const ktx2 = new KTX2Loader().setTranscoderPath(base + 'decoders/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
  const gltf = await loader.loadAsync(base + 'assets/ABeautifulGame.glb', e => { if (e.total) onProgress?.(e.loaded / e.total); });
  draco.dispose(); ktx2.dispose();
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const board = root.getObjectByName('Chessboard')!;
  const templates = new Map<string, T.Object3D>();
  const seats = new Map<string, number>();
  let seat = 0;
  for (const side of ['W', 'B'] as const) for (const k of Object.keys(NODE) as Kind[]) {
    const node = root.children.find(o => o.name.startsWith(NODE[k] + side))!;
    const t = node.clone(true);
    seat = Math.max(seat, node.position.y);
    seats.set(k + side, node.position.y * SCALE);
    t.position.set(0, 0, 0);
    t.traverse(o => { if ((o as T.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    templates.set(k + side, t);
  }
  const boardObj = board.clone(true);
  boardObj.scale.setScalar(SCALE);
  boardObj.traverse(o => { if ((o as T.Mesh).isMesh) { o.receiveShadow = true; o.castShadow = true; } });
  return {
    board: boardObj,
    surface: seat * SCALE,
    make(kind, side) {
      const g = new T.Group();
      const key = kind + (side === 'w' ? 'W' : 'B');
      const inner = templates.get(key)!.clone(true);
      inner.scale.setScalar(SCALE);
      inner.position.y = seats.get(key)! - seat * SCALE; // each model's own seat, relative to the playing surface
      g.add(inner);
      g.userData.kind = kind; g.userData.side = side;
      return g;
    },
  };
}
