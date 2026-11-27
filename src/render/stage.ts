import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadSet, type ChessSet } from './assets';
import { Chalk } from './chalk';
import { Debris } from './physics';
import { buildWorld, type Built, type WorldId } from './worlds';
import { C, gamma } from '../engine/collide';
import { MASS, cheb, file, rank, type Outcome, type Pos, type Piece, type Kind, type Side } from '../engine/rules';
import type { Sound } from '../ui/audio';

export const X = (s: number) => -(file(s) - 3.5);
export const Z = (s: number) => rank(s) - 3.5;
const ease = (u: number) => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Anim { update(now: number): boolean } // return false when finished

export type Quality = 'auto' | 'ultra' | 'high' | 'mid' | 'low';
/** Tungsten-to-blue colour of a black body (approximation after Tanner Helland), linear-ish sRGB 0..1. */
export function kelvin(k: number): T.Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return new T.Color().setRGB(c(r), c(g), c(b), T.SRGBColorSpace);
}

export class Stage {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(34, 1, .05, 900);
  set!: ChessSet;
  chalk!: Chalk;
  surface = 0.28;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pieces = new Map<string, T.Object3D>();
  private ghosts = new T.Group();
  private heat = new Map<number, { mesh: T.Mesh; level: number }>();
  private anims: Anim[] = [];
  private flashLight = new T.PointLight(0xfff4e0, 0, 6, 2);
  private spot!: T.SpotLight;
  private dust!: T.Points;
  private board!: T.Object3D;
  /** The table and its brass rulers: they step aside when the pyramid opens below the board. */
  private floor = new T.Group();
  /** Everything that belongs to the night lab only (lamp, table, rulers, blackboard). */
  private lab = new T.Group();
  private rim!: T.DirectionalLight; private fill!: T.HemisphereLight;
  private worlds = new Map<WorldId, Built>();
  world: WorldId = 'lab';
  private ground: T.Object3D = this.floor;
  private keyI = 220;
  private boardChalk!: { canvas: HTMLCanvasElement; tex: T.CanvasTexture; lines: string[] };
  private last = performance.now();
  private size = { w: 1, h: 1 };
  // camera
  private yaw = 0; private pitch = .9; private dist = 21.5;
  private camOverride: { pos: T.Vector3; look: T.Vector3; k: number } | null = null;
  private look = new T.Vector3(0, 0, -.9);
  /** Where the seat camera aims (moves toward White when the notebook covers the bottom of the screen). */
  aimZ = -1.4;
  /** Sideways offset of the aim (the title menu sits on the left). Eased. */
  aimX = 0; private aimXNow = 0;
  private drag?: { x: number; y: number; moved: boolean; button: number };
  private hoverSq = -1;
  // ── performance state ─────────────────────────────────────────────────
  private dprCap = 1;
  private shadowDirty = true;
  private lastInput = 0;
  private frame = 0;
  private settled = false;
  /** Frame-time statistics for the quality governor and the ?perf overlay. */
  readonly perf = { fps: 60, ms: 16, level: 0, steps: [] as string[] };
  private perfWindow: number[] = [];
  private perfEl: HTMLElement | null = null;
  /** Quality preset. 'auto' = full quality with the governor as a last resort; the others are fixed. */
  quality: Quality = 'auto';
  private cone!: T.Mesh<T.ConeGeometry, T.ShaderMaterial>;
  private lampOn = true; private lampColor = new T.Color(0xffc98a);
  /** Pieces thrown off the board (rigid bodies). */
  private debris = new Debris();
  private hulls = new Map<string, Float32Array>();
  /** Secondary motion: every piece leans with inertia and rocks on its base (damped spring per piece). */
  private wob = new Map<string, { px: number; pz: number; vx: number; vz: number; tx: number; tz: number; wx: number; wz: number }>();
  /** Time-scale for secondary motion (slow-motion replays rock slowly too). */
  private warp = 1;
  private tmpA = new T.Vector3(); private tmpB = new T.Vector3(); private tmpC = new T.Vector3();
  private hoverMesh = new T.Mesh(new T.PlaneGeometry(.96, .96), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .06, depthWrite: false }));
  onSquare: (sq: number, button: number) => void = () => {};
  onHover: (sq: number) => void = () => {};

  constructor(private host: HTMLElement, private sound: Sound) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // the lamp never moves: re-render shadows only when pieces do
    this.dprCap = Math.min(devicePixelRatio || 1, 2);
    // the glass pawn tops sample a roughness-blurred copy of the scene: half resolution is visually identical
    this.renderer.transmissionResolutionScale = .5;
    this.renderer.setClearColor(0x05060a);
    host.append(this.renderer.domElement);
    this.renderer.domElement.className = 'stage-canvas';
    this.scene.fog = new T.FogExp2(0x05060a, .012);
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    this.bindInput();
    requestAnimationFrame(t => this.loop(t));
  }

  async load(onProgress?: (f: number) => void, hipoly = false) {
    const pm = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; this.scene.environmentIntensity = .22; pm.dispose();
    this.set = await loadSet(this.renderer, onProgress, hipoly);
    this.setQuality(this.quality);
    this.surface = this.set.surface;
    this.board = this.set.board; this.scene.add(this.board);
    const box = new T.Box3().setFromObject(this.board);
    this.buildRoom(box);
    this.chalk = new Chalk(box.max.y - .002); // above the raised frame so margin notes stay visible
    this.scene.add(this.chalk.mesh, this.ghosts, this.flashLight);
    this.hoverMesh.rotation.x = -Math.PI / 2; this.hoverMesh.visible = false; this.scene.add(this.hoverMesh);
    this.buildTiles();
    this.debris.onImpact = (m, v) => this.sound.thud(m, v);
    setTimeout(() => void this.debris.init(box, this.surface), 400); // after first paint: the WASM engine loads lazily
  }

  // ── the night physics lab ──────────────────────────────────────────────
  private buildRoom(box: T.Box3) {
    const bulbPos = new T.Vector3(0, 9.2, .4);
    // incandescent lamp: warm spot, cone of light, dust
    this.spot = new T.SpotLight(0xffc98a, 220, 30, .62, .75, 1.6);
    this.spot.position.copy(bulbPos); this.spot.target.position.set(0, 0, 0);
    this.spot.castShadow = true; this.spot.shadow.mapSize.set(2048, 2048); this.spot.shadow.bias = -.00015; this.spot.shadow.radius = 4;
    const rim = this.rim = new T.DirectionalLight(0x8fb6ff, .55); rim.position.set(-6, 3.5, 9);
    const fill = this.fill = new T.HemisphereLight(0x2a3550, 0x0b0806, .25);
    this.scene.add(this.spot, this.spot.target, rim, fill, this.lab);
    const bulb = new T.Mesh(new T.SphereGeometry(.18, 24, 16), new T.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false }));
    bulb.position.copy(bulbPos);
    const shade = new T.Mesh(new T.ConeGeometry(.75, .55, 40, 1, true), new T.MeshStandardMaterial({ color: 0x1c1d20, metalness: .8, roughness: .35, side: T.DoubleSide }));
    shade.position.copy(bulbPos).add(new T.Vector3(0, .12, 0));
    const cord = new T.Mesh(new T.CylinderGeometry(.015, .015, 6, 6), new T.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.copy(bulbPos).add(new T.Vector3(0, 3.3, 0));
    const cone = this.cone = new T.Mesh(new T.ConeGeometry(6.2, bulbPos.y, 64, 1, true), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.FrontSide, // invisible from inside, like real light shafts
      uniforms: { tint: { value: new T.Color(0xffc98a) } },
      vertexShader: 'varying float h; varying vec3 n; varying vec3 vw; void main(){ h = uv.y; n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vw = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 tint; varying float h; varying vec3 n; varying vec3 vw; void main(){ float rim = pow(1.-abs(dot(n,vw)), 1.5); float a = .045*(1.-rim)*smoothstep(0.,.35,h)*(0.35+0.65*h); gl_FragColor = vec4(tint*a, 1.); }',
    }));
    cone.position.set(bulbPos.x, bulbPos.y / 2, bulbPos.z);
    const dustGeo = new T.BufferGeometry(), N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const h = Math.random(), r = Math.sqrt(Math.random()) * 6 * (1 - h); const a = Math.random() * Math.PI * 2; pos.set([Math.cos(a) * r, h * bulbPos.y, bulbPos.z + Math.sin(a) * r], i * 3); }
    dustGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    this.dust = new T.Points(dustGeo, new T.PointsMaterial({ color: 0xffdcaa, size: .035, transparent: true, opacity: .55, depthWrite: false, blending: T.AdditiveBlending }));
    this.lab.add(bulb, shade, cord, cone, this.dust);
    // walnut lab table
    const wood = document.createElement('canvas'); wood.width = 1024; wood.height = 1024; const w = wood.getContext('2d')!;
    w.fillStyle = '#20150f'; w.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 260; i++) { w.strokeStyle = `rgba(${60 + Math.random() * 30},${38 + Math.random() * 18},${24},${.08 + Math.random() * .12})`; w.lineWidth = 1 + Math.random() * 3; w.beginPath(); const y = Math.random() * 1024; w.moveTo(0, y); for (let x = 0; x <= 1024; x += 64) w.lineTo(x, y + Math.sin(x / 140 + i) * 6); w.stroke(); }
    const wt = new T.CanvasTexture(wood); wt.wrapS = wt.wrapT = T.RepeatWrapping; wt.repeat.set(3, 3); wt.colorSpace = T.SRGBColorSpace;
    const table = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ map: wt, roughness: .55, metalness: .05 }));
    table.rotation.x = -Math.PI / 2; table.position.y = box.min.y - .002; table.receiveShadow = true;
    this.floor.add(table); this.lab.add(this.floor);
    // brass rulers along the cliff edges
    const brass = new T.MeshStandardMaterial({ color: 0xb08a4a, metalness: .95, roughness: .28 });
    const half = (box.max.x - box.min.x) / 2 + .18, rl = half * 2 + .3;
    for (const [x, z, ry] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]] as const) {
      const bar = new T.Mesh(new T.BoxGeometry(rl, .05, .22), brass); bar.position.set(x, box.min.y + .025, z); bar.rotation.y = ry; bar.castShadow = bar.receiveShadow = true; this.floor.add(bar);
    }
    // blackboard far behind Black: the match is written up as it happens
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
    const bb = new T.Mesh(new T.PlaneGeometry(18, 9), new T.MeshStandardMaterial({ map: tex, roughness: .9, color: 0x9aa59c }));
    bb.position.set(0, 5.2, 16); bb.rotation.y = Math.PI; this.lab.add(bb);
    const frame = new T.Mesh(new T.BoxGeometry(18.6, 9.6, .2), new T.MeshStandardMaterial({ color: 0x3a2a1c, roughness: .7 }));
    frame.position.set(0, 5.2, 16.12); this.lab.add(frame);
    this.boardChalk = { canvas: cv, tex, lines: [] };
    this.writeBlackboard([]);
  }

  writeBlackboard(lines: string[]) {
    const { canvas: cv, tex } = this.boardChalk, c = cv.getContext('2d')!;
    c.fillStyle = '#1c2621'; c.fillRect(0, 0, 2048, 1024);
    for (let i = 0; i < 1600; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * .025})`; c.fillRect(Math.random() * 2048, Math.random() * 1024, 40 + Math.random() * 200, 2 + Math.random() * 6); }
    c.fillStyle = 'rgba(240,236,224,.85)'; c.font = "64px 'Nanum Pen Script', cursive";
    c.fillText('p = γmv     γ = 1/√(1 − v²/c²)     c = 4 칸/턴', 90, 120);
    c.font = "52px 'Nanum Pen Script', cursive";
    lines.slice(-12).forEach((l, i) => c.fillText(l, 90, 230 + i * 64));
    tex.needsUpdate = true;
  }

  // ── pieces ─────────────────────────────────────────────────────────────
  private model(p: Piece) {
    let m = this.pieces.get(p.id);
    if (m && m.userData.kind !== p.kind) { this.scene.remove(m); m = undefined; }
    if (!m) { m = this.set.make(p.kind, p.side); m.userData.id = p.id; this.pieces.set(p.id, m); this.scene.add(m); }
    return m;
  }
  /** Bumped whenever the board is replaced; stale playbacks must not write back. */
  private epoch = 0;
  /** Snap every model to the position (no animation). */
  sync(pos: Pos, bump = true) {
    this.shadowDirty = true;
    if (bump) { this.epoch++; this.railLight(false, []); this.camOverride = null; this.debris.clear(); }
    const live = new Set<string>();
    pos.board.forEach((p, s) => {
      if (!p) return;
      const m = this.model(p); live.add(p.id);
      m.position.set(X(s), this.surface, Z(s)); m.rotation.set(0, 0, 0); m.scale.setScalar(1); m.visible = true;
      const w = this.wob.get(p.id); if (w) { w.px = m.position.x; w.pz = m.position.z; w.vx = w.vz = 0; if (bump) w.tx = w.tz = w.wx = w.wz = 0; }
    });
    for (const [id, m] of this.pieces) if (!live.has(id)) { this.scene.remove(m); this.pieces.delete(id); }
  }
  pieceObject(id: string) { return this.pieces.get(id); }

  // ── 光: the light pyramid ─────────────────────────────────────────────
  // The board dissolves into 64 glass tiles that sink by their light delay from
  // the King (a square d away is seen d-1 plies late). Enemy afterimages hang at the
  // depth of the instant their light left them.
  private pyr = { on: false, eye: 4, depth: new Map<string, number>(), u: 0, was: false, lastU: -1, dirty: true };
  private tiles?: T.InstancedMesh;
  private pyrLines = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
  setPyramid(on: boolean, eye: number, depth: Map<string, number>) { this.pyr.on = on; this.pyr.eye = eye; this.pyr.depth = depth; this.pyr.dirty = true; }
  get pyramidOpen() { return this.pyr.u > .02; }
  private buildTiles() {
    const geo = new T.BoxGeometry(.97, .06, .97); geo.translate(0, -.03, 0);
    this.tiles = new T.InstancedMesh(geo, new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: .22, metalness: .05, clearcoat: 1, transparent: true, opacity: .9 }), 64);
    const light = new T.Color(0xd8cbb5), dark = new T.Color(0x23302b);
    for (let s2 = 0; s2 < 64; s2++) this.tiles.setColorAt(s2, (file(s2) + rank(s2)) % 2 ? light : dark);
    this.tiles.visible = false; this.tiles.receiveShadow = true; this.tiles.castShadow = true;
    this.pyrLines.frustumCulled = false; this.pyrLines.renderOrder = 6;
    this.scene.add(this.tiles, this.pyrLines);
  }
  private updatePyramid(u: number) {
    const H = .5, top = this.surface, eye = this.pyr.eye;
    this.board.visible = u < .25;
    this.ground.visible = u < .2;
    this.chalk.mesh.visible = u < .05;
    if (u > .05) this.hoverMesh.visible = false;
    const t = this.tiles!; t.visible = u > .003;
    (t.material as T.MeshPhysicalMaterial).opacity = Math.min(.9, u * 3);
    const o = new T.Object3D();
    for (let s2 = 0; s2 < 64; s2++) { o.position.set(X(s2), top - u * H * Math.max(0, cheb(s2, eye) - 1), Z(s2)); o.updateMatrix(); t.setMatrixAt(s2, o.matrix); }
    t.instanceMatrix.needsUpdate = true;
    // afterimages sink to the moment their light left them
    for (const [id, d] of this.pyr.depth) { const m = this.pieces.get(id); if (m) m.position.y = top - u * H * Math.min(d, 14); }
    // stepped light-cone edges + stalks from the present down to each afterimage
    const pos: number[] = [], col: number[] = [];
    const seg = (a: number[], b: number[], c: [number, number, number], k: number) => { pos.push(...a, ...b); col.push(c[0] * k, c[1] * k, c[2] * k, c[0] * k, c[1] * k, c[2] * k); };
    const cyan: [number, number, number] = [.62, .89, 1], rose: [number, number, number] = [1, .55, .62], gold: [number, number, number] = [1, .83, .55];
    const ex = X(eye), ez = Z(eye), clip = (v: number) => Math.max(-4, Math.min(4, v));
    for (let d = 1; d <= 8; d++) {
      const y = top + .01 - u * H * (d - 1), yn = top + .01 - u * H * d, h = d + .5;
      const X0 = ex - h, X1 = ex + h, Z0 = ez - h, Z1 = ez + h, x0 = clip(X0), x1 = clip(X1), z0 = clip(Z0), z1 = clip(Z1);
      if (x0 >= x1 || z0 >= z1) continue;
      const k = .75 * u * (1 - d / 11);
      const side = (a: number[], b: number[]) => { seg(a, b, cyan, k); seg([a[0], yn, a[2]], [b[0], yn, b[2]], cyan, k * .45); };
      if (Z0 > -4) side([x0, y, Z0], [x1, y, Z0]);
      if (Z1 < 4) side([x0, y, Z1], [x1, y, Z1]);
      if (X0 > -4) side([X0, y, z0], [X0, y, z1]);
      if (X1 < 4) side([X1, y, z0], [X1, y, z1]);
      for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]]) if (Math.abs(cx) < 4 && Math.abs(cz) < 4) seg([cx, y, cz], [cx, yn, cz], cyan, k * .8);
    }
    const P = [[-4, top + .02, -4], [4, top + .02, -4], [4, top + .02, 4], [-4, top + .02, 4]];
    P.forEach((a, i) => seg(a, P[(i + 1) % 4], gold, .6 * u)); // the present
    for (const [id] of this.pyr.depth) {
      const m = this.pieces.get(id); if (!m) continue;
      for (let y = top; y > m.position.y + .05; y -= .3) seg([m.position.x, y, m.position.z], [m.position.x, Math.max(m.position.y, y - .16), m.position.z], rose, .7 * u);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    this.pyrLines.geometry.dispose(); this.pyrLines.geometry = g; this.pyrLines.visible = u > .003;
  }
  private stale = new Map<string, { age: number; label: HTMLElement }>();
  /** 光 mode: enemy pieces shown where their light left them — translucent, with an age in moves. */
  showStale(ages: Map<string, number>) {
    for (const [id, st] of this.stale) if (!ages.has(id) || !this.pieces.has(id)) { st.label.remove(); this.stale.delete(id); this.restore(id); }
    for (const [id, age] of ages) {
      const m = this.pieces.get(id); if (!m) continue;
      let st = this.stale.get(id);
      if (!st) { const label = document.createElement('span'); label.className = 'age'; this.host.append(label); st = { age, label }; this.stale.set(id, st); }
      st.age = age; st.label.textContent = age + '수 전';
      m.traverse(o => { const x = o as T.Mesh; if (x.isMesh) { if (!x.userData.mat) x.userData.mat = x.material; x.material = STALE; x.castShadow = false; } });
    }
  }
  private restore(id: string) {
    this.pieces.get(id)?.traverse(o => { const x = o as T.Mesh; if (x.isMesh && x.userData.mat) { x.material = x.userData.mat; x.castShadow = true; } });
  }

  // ── choreography: replay the engine's outcome ──────────────────────────
  clearStrobe() { this.ghosts.clear(); }
  async play(before: Pos, out: Outcome, after: Pos): Promise<void> {
    const epoch = this.epoch;
    this.clearStrobe();
    this.cool();
    const m = out.move, mover = before.board[m.from]!;
    const obj = this.model(mover);
    if (out.clash) await this.playClash(before, out);
    else if (out.stomp) await this.playStomp(obj, m.from, m.to, out.stomp.victim);
    else if (m.flag === 'k' || m.flag === 'q') {
      await this.slide(obj, m.from, m.to);
      const rf = m.flag === 'k' ? m.from + 3 : m.from - 4, rt = m.flag === 'k' ? m.from + 1 : m.from - 1;
      const rook = before.board[rf]; if (rook) await this.slide(this.model(rook), rf, rt);
    } else if (m.kind === 'n') await this.hop(obj, m.from, m.to);
    else {
      await this.slide(obj, m.from, m.to);
      for (const v of out.removed) { const vo = this.pieces.get(v.id); if (vo) { this.sound.clack(MASS[v.kind] + MASS[m.kind], 1); await this.sink(vo); } }
    }
    if (epoch !== this.epoch) return; // the board was replaced meanwhile (e.g. title demo skipped)
    this.sound.settle();
    this.sync(after, false);
  }

  private slide(obj: T.Object3D, from: number, to: number) {
    const d = Math.max(Math.abs(file(to) - file(from)), Math.abs(rank(to) - rank(from)));
    const dur = this.reduced ? 120 : 240 + 70 * d, a = new T.Vector3(X(from), this.surface, Z(from)), b = new T.Vector3(X(to), this.surface, Z(to));
    this.sound.slide(d / 4, dur);
    // pushed: quick start, long friction stop (the lean/rock comes from the inertia spring)
    return this.tween(dur * 1.15, u => { obj.position.lerpVectors(a, b, 1 - (1 - Math.min(1, u * 1.04)) ** 2.6); });
  }
  private hop(obj: T.Object3D, from: number, to: number, apexHold = 0, height = 1.1) {
    const a = new T.Vector3(X(from), this.surface, Z(from)), b = new T.Vector3(X(to), this.surface, Z(to));
    const dur = this.reduced ? 160 : 460 + apexHold;
    return this.tween(dur, u => {
      // hang at the apex: remap time around 0.5
      const h = apexHold / dur, k = u < .5 - h / 2 ? u / (1 - h) : u > .5 + h / 2 ? (u - h) / (1 - h) : .5;
      obj.position.lerpVectors(a, b, k);
      obj.position.y = this.surface + height * 4 * k * (1 - k);
    });
  }
  private sink(obj: T.Object3D) {
    const y0 = obj.position.y;
    return this.tween(this.reduced ? 100 : 520, u => { obj.position.y = y0 - u * .9; obj.scale.setScalar(1 - u * .35); obj.rotation.z = u * .25; });
  }
  private async playStomp(obj: T.Object3D, from: number, to: number, victim: Piece) {
    this.sound.whistle();
    await this.hop(obj, from, to, this.reduced ? 0 : 260, 2.2);
    this.sound.stomp(MASS[victim.kind]);
    this.flash(new T.Vector3(X(to), this.surface + .3, Z(to)), 7);
    this.chalk.circle([X(to), Z(to)], .55, { dur: 160 }); this.chalk.circle([X(to), Z(to)], .85, { dur: 220, delay: 60, alpha: .5 });
    this.heatUp(to, 1);
    const vo = this.pieces.get(victim.id);
    if (vo) { await this.sink(vo); this.scene.remove(vo); this.pieces.delete(victim.id); }
    this.sound.sizzle();
    setTimeout(() => this.chalk.erase(500), 900);
  }

  private async playClash(before: Pos, out: Outcome) {
    const cl = out.clash!, line = cl.line;
    const step = new T.Vector3(X(line[1] ?? line[0]) - X(line[0]), 0, Z(line[1] ?? line[0]) - Z(line[0]));
    const origin = new T.Vector3(X(line[0]), this.surface, Z(line[0]));
    const at = (s: number) => origin.clone().addScaledVector(step, s);
    const attacker = this.pieces.get(cl.attacker)!;
    const contact = cl.sim.contacts[0];
    // 1. run-up (accelerating) to the contact square
    const startTrack = cl.sim.tracks.find(t => t.id === cl.attacker)!;
    const from = new T.Vector3(X(out.move.from), this.surface, Z(out.move.from)), touch = at(startTrack.keys[0].s);
    this.railLight(true, line);
    this.sound.slide(cl.speed / C, 160 + cl.run * 80);
    await this.tween(this.reduced ? 120 : 160 + cl.run * 80, u => attacker.position.lerpVectors(from, touch, u * u));
    // 2. camera on the rail, time slows
    const mid = contact ? at(contact.s) : touch;
    if (!this.reduced) this.railCam(mid, step);
    this.flashScreen();
    // 3. replay one turn of the simulation with a slow-motion time warp
    const P = this.reduced ? 500 : 1700, strobeDt = 1 / 12;
    let nextStrobe = 0, contactIx = 0;
    const exited = new Set<string>();
    const lastExposure = new Map<string, T.Vector3>();
    const pos = (id: string, t: number) => {
      const tr = cl.sim.tracks.find(x => x.id === id)!;
      const keys = tr.keys; let k = keys[0];
      for (const x of keys) { if (x.t <= t) k = x; else break; }
      return { s: k.s + k.v * (Math.min(t, tr.exit?.t ?? 1) - k.t), v: k.v };
    };
    await this.tween(P, u => {
      const t = this.reduced ? u : u < .3 ? .05 * (u / .3) : .05 + .95 * ((u - .3) / .7) ** 1.25;
      this.warp = this.reduced || u >= .3 ? 1 : .3;
      for (const tr of cl.sim.tracks) {
        const o = this.pieces.get(tr.id); if (!o || exited.has(tr.id)) continue;
        const { s, v } = pos(tr.id, t);
        o.position.copy(at(s));
        // relativistic visualisation: contraction along an orthogonal axis
        const beta = Math.abs(v) / C, sx = Math.abs(step.x) > .5 && Math.abs(step.z) < .5, sz = Math.abs(step.z) > .5 && Math.abs(step.x) < .5;
        const k = beta > .55 ? 1 / gamma(v) : 1;
        o.scale.set(sx ? k : 1, 1, sz ? k : 1);
        if (tr.exit && t >= tr.exit.t) { exited.add(tr.id); this.fall(o, step.clone().multiplyScalar(Math.sign(tr.exit.v)), Math.abs(tr.exit.v)); }
      }
      while (contactIx < cl.sim.contacts.length && cl.sim.contacts[contactIx].t <= t) {
        const c = cl.sim.contacts[contactIx++];
        const ma = MASS[(before.board.find(p => p?.id === c.a) ?? before.board[out.move.from])!.kind as Kind] ?? 1;
        const mb = MASS[(before.board.find(p => p?.id === c.b))?.kind ?? 'p'];
        this.sound.clack(ma + mb, Math.abs(c.before[0] - c.after[0]) * ma, contactIx);
        this.flash(at(c.s).setY(this.surface + .4), contactIx === 1 ? 9 : 4);
        this.kick(c.a, step, c.after[0] - c.before[0], ma); this.kick(c.b, step, c.after[1] - c.before[1], mb);
      }
      while (t >= nextStrobe && nextStrobe <= 1) {
        for (const tr of cl.sim.tracks) {
          if (exited.has(tr.id)) continue;
          const o = this.pieces.get(tr.id); if (!o) continue;
          // a strobe photo only shows separate exposures where the piece actually moved
          const lastS = lastExposure.get(tr.id);
          if (lastS === undefined || o.position.distanceTo(lastS) > .32) { this.ghost(o); lastExposure.set(tr.id, o.position.clone()); }
        }
        if (nextStrobe > 0) this.sound.strobe();
        nextStrobe += strobeDt;
      }
    });
    for (const o of this.pieces.values()) o.scale.set(1, 1, 1);
    this.warp = 1;
    // 4. friction: survivors keep their last velocity and slide to rest on their square (the engine rounds; we decelerate)
    const settle: [T.Object3D, number, number, number][] = [];
    for (const tr of cl.sim.tracks) {
      if (exited.has(tr.id) || tr.exit) continue;
      const o = this.pieces.get(tr.id); if (!o) continue;
      const k = tr.keys[tr.keys.length - 1], s1 = k.s, r = Math.min(line.length - 1, Math.max(0, Math.round(s1)));
      if (Math.abs(s1 - r) > 1e-3 || Math.abs(k.v) > 1e-3) settle.push([o, s1, r, k.v * .8]);
    }
    if (settle.length && !this.reduced) {
      const D = .34;
      await this.tween(D * 1000, u => {
        for (const [o, s1, r, v] of settle) {
          const m0 = Math.max(-1.2, Math.min(1.2, v * D)), h = s1 * (2 * u ** 3 - 3 * u ** 2 + 1) + m0 * (u ** 3 - 2 * u ** 2 + u) + r * (-2 * u ** 3 + 3 * u ** 2);
          o.position.copy(at(h));
        }
      });
    }
    this.camOverride = null;
    this.railLight(false, line);
    await wait(this.reduced ? 0 : 160);
  }

  private ghost(o: T.Object3D) {
    const g = o.clone(true);
    g.traverse(x => { const m = x as T.Mesh; if (m.isMesh) { m.material = GHOST; m.castShadow = false; m.receiveShadow = false; } });
    g.position.copy(o.position); this.ghosts.add(g);
  }
  private fall(o: T.Object3D, dir: T.Vector3, speed: number) {
    const id = o.userData.id as string, kind = o.userData.kind as Kind;
    if (this.debris.ready && !this.reduced) {
      const d = dir.clone().setY(0).normalize(), top = new T.Box3().setFromObject(this.board).max.y;
      o.position.y = Math.max(o.position.y, top) + .02; o.scale.set(1, 1, 1);
      const sp = 2 + speed * 1.15;
      if (this.debris.throw(o, this.hull(o), new T.Vector3(d.x * sp, 1.6 + speed * .35, d.z * sp), MASS[kind] ?? 1)) {
        this.pieces.delete(id); this.wob.delete(id);
        this.sound.whistle();
        return;
      }
    }
    o.userData.noWobble = true;
    const v0 = dir.clone().normalize().multiplyScalar(1.2 + speed * 1.1), p0 = o.position.clone(), spin = (Math.random() - .5) * 6;
    const t0 = performance.now();
    this.sound.fall();
    this.anims.push({ update: now => {
      const t = (now - t0) / 1000;
      o.position.copy(p0).addScaledVector(v0, t); o.position.y = p0.y - 9 * t * t;
      o.rotation.x += dir.z * .06; o.rotation.z -= dir.x * .06; o.rotation.y += spin * .01;
      if (t > 1.6) { o.visible = false; return false; }
      return true;
    } });
  }
  private heatUp(sq: number, level: number) {
    let h = this.heat.get(sq);
    if (!h) {
      const mesh = new T.Mesh(new T.CircleGeometry(.48, 40), new T.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(sq), this.surface - .005, Z(sq)); this.scene.add(mesh);
      h = { mesh, level: 0 }; this.heat.set(sq, h);
    }
    h.level = Math.min(1.2, h.level + level);
  }
  /** Heat dissipates a little every move (kinetic energy → heat → room). */
  private cool() { for (const [s, h] of this.heat) { h.level *= .6; if (h.level < .05) { this.scene.remove(h.mesh); this.heat.delete(s); } } }

  private flash(p: T.Vector3, power: number) {
    this.flashLight.position.copy(p); this.flashLight.intensity = power * 6;
    const t0 = performance.now();
    this.anims.push({ update: now => { const k = (now - t0) / 260; this.flashLight.intensity = power * 6 * Math.max(0, 1 - k); return k < 1; } });
  }
  private flashScreen() {
    if (this.reduced) return;
    const f = document.getElementById('flash'); if (!f) return;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }
  private railLight(on: boolean, line: number[]) {
    this.scene.remove(...this.scene.children.filter(o => o.userData.rail));
    if (!on) return;
    for (const s of line) {
      const m = new T.Mesh(new T.PlaneGeometry(.9, .9), new T.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: .13, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(X(s), this.surface + .004, Z(s)); m.userData.rail = true; this.scene.add(m);
      const hole = new T.Mesh(new T.CircleGeometry(.05, 12), new T.MeshBasicMaterial({ color: 0xd8f0ff, toneMapped: false }));
      hole.rotation.x = -Math.PI / 2; hole.position.set(X(s), this.surface + .006, Z(s)); hole.userData.rail = true; this.scene.add(hole);
    }
  }
  private railCam(at: T.Vector3, step: T.Vector3) {
    const axis = step.clone().setY(0).normalize();
    let side = new T.Vector3(-axis.z, 0, axis.x);
    if (side.dot(this.camera.position.clone().sub(at)) < 0) side.negate();
    this.camOverride = { pos: at.clone().addScaledVector(side, 9).add(new T.Vector3(0, 3.2, 0)), look: at.clone().setY(this.surface + .8), k: 0 };
  }

  /** Convex hull points of a piece model in its own frame (cached per kind/side). */
  private hull(o: T.Object3D): Float32Array {
    const key = o.userData.kind + o.userData.side;
    let h = this.hulls.get(key);
    if (h) return h;
    const probe = this.set.make(o.userData.kind, o.userData.side); probe.updateMatrixWorld(true);
    const pts: number[] = [], v = new T.Vector3();
    probe.traverse(x => {
      const m = x as T.Mesh; if (!m.isMesh) return;
      const a = m.geometry.getAttribute('position'), stride = Math.max(1, Math.floor(a.count / 220));
      for (let i = 0; i < a.count; i += stride) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); pts.push(v.x, v.y, v.z); }
    });
    h = new Float32Array(pts); this.hulls.set(key, h); return h;
  }
  /** An impulse on a piece's lean: Δv along the line (squares/turn) → the top lags behind. */
  private kick(id: string, dir: T.Vector3, dv: number, mass: number) {
    const w = this.wobState(id); if (!w) return;
    const d = dir.clone().setY(0).normalize(), k = -dv * .55 * 3 / (mass + 2);
    w.wx += d.x * k; w.wz += d.z * k;
  }
  private wobState(id: string) {
    const o = this.pieces.get(id); if (!o) return null;
    let w = this.wob.get(id);
    if (!w) { w = { px: o.position.x, pz: o.position.z, vx: 0, vz: 0, tx: 0, tz: 0, wx: 0, wz: 0 }; this.wob.set(id, w); }
    return w;
  }
  private wobble(dtMs: number) {
    if (this.pyr.u > .01) return false;
    const dt = Math.min(.05, dtMs / 1000), ds = dt * this.warp;
    let live = false;
    for (const [id, o] of this.pieces) {
      if (o.userData.noWobble) continue;
      const w = this.wobState(id)!;
      const vx = (o.position.x - w.px) / dt, vz = (o.position.z - w.pz) / dt;
      w.px = o.position.x; w.pz = o.position.z;
      const m = MASS[o.userData.kind as Kind] ?? 3, g = .11 * 3 / (m + 2) / Math.max(.3, this.warp);
      w.wx -= Math.max(-6, Math.min(6, (vx - w.vx) * g)); w.wz -= Math.max(-6, Math.min(6, (vz - w.vz) * g));
      w.vx = vx; w.vz = vz;
      // damped spring about the base (≈2 Hz, ζ≈.18)
      w.wx += (-160 * w.tx - 4.6 * w.wx) * ds; w.wz += (-160 * w.tz - 4.6 * w.wz) * ds;
      w.tx = Math.max(-.2, Math.min(.2, w.tx + w.wx * ds)); w.tz = Math.max(-.2, Math.min(.2, w.tz + w.wz * ds));
      o.rotation.x = w.tz; o.rotation.z = -w.tx;
      if (Math.abs(w.tx) + Math.abs(w.tz) + Math.abs(w.wx) + Math.abs(w.wz) > 2e-3) live = true;
      else { w.tx = w.tz = w.wx = w.wz = 0; }
    }
    return live;
  }

  private tween(ms: number, f: (u: number) => void) {
    return new Promise<void>(res => {
      const t0 = performance.now();
      this.anims.push({ update: now => { const u = Math.min(1, (now - t0) / Math.max(1, ms)); f(u); if (u >= 1) { res(); return false; } return true; } });
    });
  }

  // ── input & camera ─────────────────────────────────────────────────────
  private bindInput() {
    const c = this.renderer.domElement;
    c.addEventListener('contextmenu', e => e.preventDefault());
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(ev, () => { this.lastInput = performance.now(); }, { passive: true });
    c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      const d = this.drag;
      if (d && (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5)) { d.moved = true; this.yaw -= e.movementX * .005; this.pitch = Math.min(1.35, Math.max(.22, this.pitch + e.movementY * .004)); return; }
      const s = this.pick(e.clientX, e.clientY);
      if (s !== this.hoverSq) { this.hoverSq = s; this.onHover(s); }
    });
    c.addEventListener('pointerup', e => { const d = this.drag; this.drag = undefined; if (!d || d.moved) return; this.onSquare(this.pick(e.clientX, e.clientY), d.button); });
    c.addEventListener('pointerleave', () => { this.hoverSq = -1; this.onHover(-1); });
    c.addEventListener('wheel', e => { e.preventDefault(); this.dist = Math.min(32, Math.max(11, this.dist * Math.exp(Math.sign(e.deltaY) * .07))); }, { passive: false });
  }
  resetCamera() { this.yaw = 0; this.pitch = .9; this.dist = 21.5; }
  pick(cx: number, cy: number) {
    if (this.pyr.u > .02) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    const p = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -this.surface), new T.Vector3());
    if (!p) return -1;
    const f = Math.round(3.5 - p.x), rk = Math.round(p.z + 3.5);
    return f >= 0 && f < 8 && rk >= 0 && rk < 8 && Math.abs(p.x) < 4 && Math.abs(p.z) < 4 ? rk * 8 + f : -1;
  }
  project(sq: number) {
    const v = new T.Vector3(X(sq), this.surface, Z(sq)).project(this.camera), r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }
  setHover(sq: number) { this.hoverMesh.visible = sq >= 0; if (sq >= 0) this.hoverMesh.position.set(X(sq), this.surface + .003, Z(sq)); }
  private resize() {
    this.size = { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) };
    this.renderer.setPixelRatio(this.dprCap);
    this.renderer.setSize(this.size.w, this.size.h, false); this.camera.aspect = this.size.w / this.size.h; this.camera.updateProjectionMatrix();
  }
  lampFlicker(on: boolean) { this.lampOn = on; if (this.spot) this.spot.intensity = on ? this.keyI : 0; }
  private boardTop = 0;
  /** Move the board to another place. The swap itself is instant; the UI covers it with a fade. */
  setWorld(id: WorldId) {
    if (!this.spot || id === this.world) return;
    const box = new T.Box3().setFromObject(this.board); this.boardTop = box.min.y;
    for (const [k, w] of this.worlds) w.group.visible = k === id;
    this.lab.visible = id === 'lab';
    this.world = id;
    if (id === 'lab') {
      this.ground = this.floor;
      this.spot.position.set(0, 9.2, .4); this.spot.angle = .62; this.spot.penumbra = .75; this.spot.color.copy(this.lampColor);
      this.keyI = 220; this.rim.color.set(0x8fb6ff); this.rim.intensity = .55; this.rim.position.set(-6, 3.5, 9);
      this.fill.color.set(0x2a3550); this.fill.groundColor.set(0x0b0806); this.fill.intensity = .25;
      this.scene.fog = new T.FogExp2(0x05060a, .012); this.renderer.toneMappingExposure = 1; this.renderer.setClearColor(0x05060a);
      this.scene.environmentIntensity = .22;
    } else {
      let w = this.worlds.get(id);
      if (!w) { w = buildWorld(id, this.boardTop); this.worlds.set(id, w); this.scene.add(w.group); }
      w.group.visible = true; this.ground = w.ground;
      const L = w.light;
      this.spot.position.set(...L.keyPos); this.spot.angle = L.keyAngle; this.spot.penumbra = L.penumbra; this.spot.color.set(L.key); this.keyI = L.keyI;
      this.rim.color.set(L.rim); this.rim.intensity = L.rimI; this.rim.position.set(...L.rimPos);
      this.fill.color.set(L.sky); this.fill.groundColor.set(L.gnd); this.fill.intensity = L.hemiI;
      this.scene.fog = L.fogD > 0 ? new T.FogExp2(L.fog, L.fogD) : null; this.renderer.toneMappingExposure = L.exposure; this.renderer.setClearColor(L.bg);
      this.scene.environmentIntensity = L.env;
    }
    this.spot.intensity = this.lampOn ? this.keyI : 0;
    this.shadowDirty = true;
  }
  /** Establishing shot: start level with the horizon (the sky of the new place), then tilt down onto the board. */
  establish(ms = 2600) {
    if (this.reduced) return;
    const p1 = .9, d1 = 21.5;
    this.pitch = .02; this.dist = 30; this.yaw = 0;
    this.camera.position.set(0, this.surface + 2, -30); this.look.set(0, 2, 20);
    void this.tween(ms, u => { const k = u < .25 ? 0 : (u - .25) / .75, e = k * k * (3 - 2 * k); this.pitch = .02 + (p1 - .02) * e; this.dist = 30 + (d1 - 30) * e; });
  }
  /** Colour temperature of the lamp (the problem book cools the room as difficulty rises). */
  setLamp(k: number) {
    this.lampColor = k <= 2800 ? new T.Color(0xffc98a) : kelvin(k);
    if (!this.spot || this.world !== 'lab') return;
    this.spot.color.copy(this.lampColor);
    this.cone.material.uniforms.tint.value.copy(this.lampColor);
    (this.dust.material as T.PointsMaterial).color.copy(this.lampColor).lerp(new T.Color(0xffffff), .25);
    this.shadowDirty = true;
  }
  /** Apply a quality preset. 'ultra' additionally needs the high-poly set (loaded at boot). */
  setQuality(q: Quality) {
    this.quality = q;
    const dev = Math.min(devicePixelRatio || 1, 2);
    const cfg = { auto: [dev, .5, 2048], ultra: [dev, .5, 2048], high: [dev, .5, 2048], mid: [Math.min(dev, 1.25), .25, 1024], low: [1, .25, 1024] }[q];
    this.dprCap = cfg[0]; this.renderer.transmissionResolutionScale = cfg[1];
    if (this.spot && this.spot.shadow.mapSize.x !== cfg[2]) { this.spot.shadow.mapSize.set(cfg[2], cfg[2]); this.spot.shadow.map?.dispose(); this.spot.shadow.map = null; }
    this.perf.level = 0; this.perf.steps = []; this.perfWindow.length = 0; this.shadowDirty = true;
    document.body.classList.toggle('q-low', q === 'low');
    this.resize();
  }
  /** Capture the current view as a small JPEG data URL (codex plates, problem thumbnails). */
  snapshot(w = 320, h = 180): string {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const sw = src.width, sh = src.height, k = Math.max(w / sw, h / sh), dw = w / k, dh = h / k;
    cv.getContext('2d')!.drawImage(src, (sw - dw) / 2, (sh - dh) / 2, dw, dh, 0, 0, w, h);
    try { return cv.toDataURL('image/jpeg', .72); } catch { return ''; }
  }

  private loop(now: number) {
    requestAnimationFrame(t => this.loop(t));
    const dt = Math.min(60, now - this.last); this.last = now;
    this.anims = this.anims.filter(a => a.update(now));
    const physics = this.debris.step(dt), rocking = this.wobble(dt);
    if (this.world !== 'lab') this.worlds.get(this.world)?.update(now / 1000);
    if (physics || rocking) this.shadowDirty = true;
    // camera: player seat with slow breathing, or the collision rail
    const goal = this.pyr.on ? 1 : 0;
    this.pyr.u = this.reduced ? goal : T.MathUtils.damp(this.pyr.u, goal, 5, dt / 1000);
    if (Math.abs(this.pyr.u - goal) < .002) this.pyr.u = goal;
    const u = this.pyr.u;
    if (this.tiles && (u > 0 || this.pyr.was) && (u !== this.pyr.lastU || this.pyr.dirty)) {
      this.updatePyramid(u); this.pyr.was = u > 0; this.pyr.lastU = u; this.pyr.dirty = false; this.shadowDirty = true;
    }
    const breathe = this.reduced ? 0 : Math.sin(now / 4200) * .004;
    const yaw = this.yaw + breathe + .62 * u, pitch = this.pitch - .45 * u, dist = this.dist * (1 + .1 * u);
    const seat = this.tmpA.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    this.aimXNow += (this.aimX - this.aimXNow) * Math.min(1, dt / 220);
    const aim = this.tmpB.set(this.aimXNow * (1 - u), -1.5 * u, this.aimZ * (1 - u) + .2 * u);
    if (this.camOverride) {
      this.camOverride.k = Math.min(1, this.camOverride.k + dt / 380);
      const k = ease(this.camOverride.k);
      this.camera.position.lerpVectors(seat, this.camOverride.pos, k);
      this.look.lerpVectors(aim, this.camOverride.look, k);
    } else {
      this.camera.position.lerp(seat, this.reduced ? 1 : .12);
      this.look.lerp(aim, this.reduced ? 1 : .08);
    }
    this.camera.lookAt(this.look);
    // dust drifts in the lamp light; heat glows and fades
    if (this.dust) { this.dust.rotation.y += dt * .00003; (this.dust.material as T.PointsMaterial).opacity = .45 + .1 * Math.sin(now / 900); }
    for (const h of this.heat.values()) (h.mesh.material as T.MeshBasicMaterial).opacity = h.level * (.55 + .08 * Math.sin(now / 120));
    for (const g of this.ghosts.children) g.visible = true;
    this.chalk?.update(dt);
    for (const [id, st] of this.stale) {
      const m = this.pieces.get(id); if (!m) continue;
      const v = this.tmpC.copy(m.position).add(LABEL_OFFSET).project(this.camera); // at the front edge of the base
      st.label.style.transform = `translate(${(v.x + 1) / 2 * this.size.w}px,${(1 - v.y) / 2 * this.size.h}px)`;
      st.label.style.opacity = String(Math.max(0, 1 - this.pyr.u * 3)); // depth says it in the pyramid
    }
    // ── pacing: full rate while anything moves, half rate when the room is still ──
    const moving = this.anims.length > 0 || physics || rocking || this.camOverride !== null || this.chalk?.busy || u !== goal
      || this.camera.position.distanceToSquared(seat) > 1e-4 || now - this.lastInput < 1500;
    this.frame++;
    if (this.shadowDirty || this.anims.length) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    if (!moving && this.settled && this.frame % 2) return;
    this.settled = !moving;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.govern(now, performance.now() - t0, moving);
  }

  /**
   * Quality governor — the last resort. It does nothing while frames are fast enough.
   * Only when the frame interval stays above ~33 ms (below 30 fps) for 3 s of active
   * rendering does it step quality down, cheapest visual loss first.
   */
  private govern(now: number, cpuMs: number, moving: boolean) {
    const w = this.perfWindow;
    w.push(now);
    while (w.length && now - w[0] > 3000) w.shift();
    if (w.length > 2) { const span = (w[w.length - 1] - w[0]) / (w.length - 1); this.perf.ms = span; this.perf.fps = 1000 / span; }
    if (this.perfEl) this.perfEl.textContent = `${this.perf.fps.toFixed(0)} fps · ${this.perf.ms.toFixed(1)} ms/frame · render ${cpuMs.toFixed(1)} ms cpu · `
      + `${this.renderer.info.render.calls} calls · ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k tris · dpr ${this.renderer.getPixelRatio()} · level ${this.perf.level}${this.perf.steps.length ? ' (' + this.perf.steps.join(', ') + ')' : ''}`;
    // ≥30 frames in the window: a genuinely slow machine (≥10 fps), not a throttled background tab
    if (this.quality !== 'auto' || !moving || w.length < 30 || this.perf.ms < 33 || document.hidden) return;
    const steps: [string, () => void][] = [
      ['dpr 1.5', () => { this.dprCap = Math.min(this.dprCap, 1.5); this.resize(); }],
      ['glass ¼', () => { this.renderer.transmissionResolutionScale = .25; }],
      ['dpr 1.25', () => { this.dprCap = Math.min(this.dprCap, 1.25); this.resize(); }],
      ['shadow 1024', () => { this.spot.shadow.mapSize.set(1024, 1024); this.spot.shadow.map?.dispose(); this.spot.shadow.map = null; this.shadowDirty = true; }],
      ['dpr 1', () => { this.dprCap = 1; this.resize(); }],
    ];
    if (this.perf.level >= steps.length) return;
    const [name, apply] = steps[this.perf.level++];
    apply(); this.perf.steps.push(name); w.length = 0;
  }
  /** ?perf overlay. */
  /** FPS line at the bottom of the screen (settings → FPS 표시). */
  showPerf(on = true) {
    if (on && !this.perfEl) { this.perfEl = document.createElement('div'); this.perfEl.className = 'perf'; document.body.append(this.perfEl); }
    else if (!on && this.perfEl) { this.perfEl.remove(); this.perfEl = null; }
  }
}
const LABEL_OFFSET = new T.Vector3(0, .05, -.62);
const STALE = new T.MeshStandardMaterial({ color: 0xffa0ae, emissive: 0x401018, transparent: true, opacity: .34, depthWrite: false, roughness: .3 });
const GHOST = new T.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: .11, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
export type { Side };
