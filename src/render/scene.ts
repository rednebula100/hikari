import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Bold } from './strokes';
import { solidPiece, imagePiece, pieceHeight } from './pieces';
import { dist, file, rank, type Kind, type Side } from '../chess/game';

export interface DisplayPiece {
  key: string; kind: Kind; side: Side; sq: number
  look: 'solid' | 'ghost' | 'echo'
  /** Plies since the light left it (prism depth). 0 = present. */
  depth: number
  /** Enemy moves since seen (badge). */
  age?: number
}
export interface Mark { sq: number; kind: 'move' | 'capture' | 'hint' | 'last' | 'select' }
export interface SceneState {
  pieces: DisplayPiece[]
  marks: Mark[]
  /** Own King square (apex of the light pyramid). */
  eye: number
  timeView: boolean
  reduced: boolean
}

const H = .5 // world units per ply in the light pyramid
export const X = (sq: number) => file(sq) - 3.5
export const Z = (sq: number) => 3.5 - rank(sq)

export class ChessScene {
  readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(32, 1, .1, 200);
  private readonly tiles: T.InstancedMesh;
  private readonly frame: T.Group;
  private ground!: T.Mesh;
  private readonly lines = new Bold(2.2);
  private readonly markGroup = new T.Group();
  private readonly fx = new T.Group();
  private readonly objects = new Map<string, { g: T.Group; look: string; kind: Kind; pos: T.Vector3 }>();
  private readonly labels = new Map<string, HTMLElement>();
  private readonly ray = new T.Raycaster();
  private state?: SceneState;
  private unfold = 0; private yaw = 0; private pitch = .95; private zoom = 1;
  private drag?: { x: number; y: number; moved: boolean; button: number };
  private size = { w: 1, h: 1 }; private last = 0; private hover = -1;
  private flashes: { m: T.Mesh; t: number }[] = [];

  constructor(private host: HTMLElement, private onSquare: (sq: number, button: number) => void, private onHover?: (sq: number) => void) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.setClearColor(0, 0);
    const c = this.renderer.domElement; c.className = 'stage-canvas'; host.append(c);
    const pm = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; this.scene.environmentIntensity = .45; pm.dispose();
    const key = new T.DirectionalLight(0xfff1dc, 2.4); key.position.set(-4, 10, 6); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); key.shadow.bias = -.0004;
    const rim = new T.DirectionalLight(0x8fc8ff, 1.3); rim.position.set(6, 4, -7);
    this.scene.add(new T.HemisphereLight(0xdde6f2, 0x10141c, .5), key, rim);
    // board: 64 tiles that can sink into the past, a machined frame, coordinates
    const tileGeo = new T.BoxGeometry(.98, .08, .98); tileGeo.translate(0, -.04, 0);
    this.tiles = new T.InstancedMesh(tileGeo, new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: .32, metalness: .2, clearcoat: .5, transparent: true }), 64);
    this.tiles.receiveShadow = true;
    const dark = new T.Color(0x1a2030), light = new T.Color(0x39445a);
    for (let sq = 0; sq < 64; sq++) this.tiles.setColorAt(sq, (file(sq) + rank(sq)) % 2 ? light : dark);
    this.frame = new T.Group();
    const rim1 = new T.Mesh(new T.BoxGeometry(8.7, .3, 8.7), new T.MeshPhysicalMaterial({ color: 0x0d1118, roughness: .3, metalness: .6, clearcoat: .8 }));
    rim1.position.y = -.2; rim1.receiveShadow = true;
    const inlay = new T.Mesh(new T.BoxGeometry(8.24, .02, 8.24), new T.MeshStandardMaterial({ color: 0xb79a62, metalness: .9, roughness: .3 }));
    inlay.position.y = -.06;
    this.frame.add(rim1, inlay);
    const ground = new T.Mesh(new T.PlaneGeometry(80, 80), new T.ShadowMaterial({ opacity: .35, depthWrite: false })); ground.rotation.x = -Math.PI / 2; ground.position.y = -.36; ground.receiveShadow = true; this.ground = ground;
    this.scene.add(this.tiles, this.frame, ground, this.lines, this.markGroup, this.fx);
    this.coordLabels();
    // input
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      const d = this.drag;
      if (d && (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5)) {
        d.moved = true; this.yaw -= e.movementX * .005; this.pitch = Math.min(1.45, Math.max(.25, this.pitch + e.movementY * .004)); return;
      }
      const sq = this.pick(e.clientX, e.clientY);
      if (sq !== this.hover) { this.hover = sq; this.onHover?.(sq); c.style.cursor = sq >= 0 ? 'pointer' : 'grab'; }
    });
    c.addEventListener('pointerup', e => { const d = this.drag; this.drag = undefined; if (!d || d.moved) return; this.onSquare(this.pick(e.clientX, e.clientY), d.button); });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.min(1.8, Math.max(.7, this.zoom * Math.exp(Math.sign(e.deltaY) * .08))); }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    requestAnimationFrame(t => this.frameLoop(t));
  }
  private coordLabels() {
    for (let i = 0; i < 8; i++) {
      const f = document.createElement('span'); f.className = 'coord'; f.textContent = 'abcdefgh'[i]; this.host.append(f); this.labels.set('cf' + i, f);
      const r = document.createElement('span'); r.className = 'coord'; r.textContent = String(i + 1); this.host.append(r); this.labels.set('cr' + i, r);
    }
  }
  private resize() {
    this.size = { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) };
    this.renderer.setSize(this.size.w, this.size.h, false); this.camera.aspect = this.size.w / this.size.h; this.camera.updateProjectionMatrix();
    this.lines.setResolution(this.size.w, this.size.h);
  }
  update(s: SceneState) { this.state = s; }
  resetCamera() { this.yaw = 0; this.pitch = .95; this.zoom = 1; }
  flash(sq: number, color: number) {
    const m = new T.Mesh(new T.RingGeometry(.2, .26, 48), new T.MeshBasicMaterial({ color, transparent: true, toneMapped: false, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(X(sq), .03, Z(sq)); this.fx.add(m); this.flashes.push({ m, t: performance.now() });
  }
  /** Screen position of a square (tutorial pointers, QA). */
  project(sq: number, y = 0) {
    const v = new T.Vector3(X(sq), y, Z(sq)).project(this.camera);
    const r = this.host.getBoundingClientRect();
    return { x: r.left + (v.x + 1) * this.size.w / 2, y: r.top + (1 - v.y) * this.size.h / 2 };
  }
  private pick(cx: number, cy: number) {
    const r = this.host.getBoundingClientRect();
    this.ray.setFromCamera(new T.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    const p = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
    if (!p) return -1;
    const f = Math.floor(p.x + 4), rk = Math.floor(4 - p.z);
    return f >= 0 && f < 8 && rk >= 0 && rk < 8 ? rk * 8 + f : -1;
  }
  private tileDepth(sq: number) { const s = this.state!; return s.timeView || this.unfold > 0 ? Math.max(0, dist(sq, s.eye) - 1) : 0; }

  private frameLoop(t: number) {
    requestAnimationFrame(x => this.frameLoop(x));
    const s = this.state; if (!s) return;
    const dt = Math.min(.05, this.last ? (t - this.last) / 1000 : .016); this.last = t;
    const goal = s.timeView ? 1 : 0;
    this.unfold = s.reduced ? goal : T.MathUtils.damp(this.unfold, goal, 5, dt);
    if (Math.abs(this.unfold - goal) < .002) this.unfold = goal;
    const u = this.unfold;
    // camera
    const target = new T.Vector3(0, -1.9 * u, 1.35 - .1 * u);
    const pitch = this.pitch - .6 * u, r = 18.2 * this.zoom * (1 + .18 * u), yaw = this.yaw + .62 * u;
    this.camera.position.set(target.x + r * Math.sin(yaw) * Math.cos(pitch), target.y + r * Math.sin(pitch), target.z + r * Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(target);
    // tiles sink by light delay from the King
    const o = new T.Object3D();
    for (let sq = 0; sq < 64; sq++) {
      o.position.set(X(sq), -u * H * Math.max(0, dist(sq, s.eye) - 1), Z(sq)); o.updateMatrix(); this.tiles.setMatrixAt(sq, o.matrix);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    (this.tiles.material as T.MeshPhysicalMaterial).opacity = 1 - .45 * u;
    this.frame.visible = this.ground.visible = u < .25;
    // pyramid edges
    this.lines.reset();
    if (u > .01) {
      const ex = X(s.eye), ez = Z(s.eye), clip = (v: number) => Math.max(-4, Math.min(4, v));
      for (let d = 1; d <= 8; d++) {
        // boundary between the distance-d ring (seen d-1 plies ago) and the next ring
        const y = -u * H * (d - 1), yn = -u * H * d, h = d + .5;
        const X0 = ex - h, X1 = ex + h, Z0 = ez - h, Z1 = ez + h;
        const x0 = clip(X0), x1 = clip(X1), z0 = clip(Z0), z1 = clip(Z1);
        if (x0 >= x1 || z0 >= z1) continue;
        const a = .6 * u * (1 - d / 11);
        const side = (p: [number, number, number], q: [number, number, number]) => { this.lines.segment(p, q, 0x56d4f2, a); this.lines.segment([p[0], yn, p[2]], [q[0], yn, q[2]], 0x56d4f2, a * .5); };
        if (Z0 > -4) side([x0, y, Z0], [x1, y, Z0]);
        if (Z1 < 4) side([x0, y, Z1], [x1, y, Z1]);
        if (X0 > -4) side([X0, y, z0], [X0, y, z1]);
        if (X1 < 4) side([X1, y, z0], [X1, y, z1]);
        for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]]) if (Math.abs(cx) < 4 && Math.abs(cz) < 4) this.lines.segment([cx, y, cz], [cx, yn, cz], 0x56d4f2, a * .8);
      }
      // present plane
      const P: [number, number, number][] = [[-4, .02, -4], [4, .02, -4], [4, .02, 4], [-4, .02, 4]];
      P.forEach((p, i) => this.lines.segment(p, P[(i + 1) % 4], 0xf2d59b, .5 * u));
    }
    // pieces
    const seen = new Set<string>();
    for (const p of s.pieces) {
      const id = p.key + ':' + p.look;
      seen.add(id);
      let obj = this.objects.get(id);
      if (!obj || obj.kind !== p.kind) {
        if (obj) { this.scene.remove(obj.g); }
        const g = p.look === 'solid' ? solidPiece(p.kind, p.side) : imagePiece(p.kind, p.side, p.look);
        obj = { g, look: p.look, kind: p.kind, pos: new T.Vector3(X(p.sq), 0, Z(p.sq)) };
        this.objects.set(id, obj); this.scene.add(g); g.position.copy(obj.pos);
      }
      const y = p.look === 'ghost' ? -u * H * p.depth : 0;
      obj.pos.set(X(p.sq), y, Z(p.sq));
      obj.g.position.lerp(obj.pos, s.reduced ? 1 : 1 - Math.pow(.0005, dt));
      obj.g.visible = true;
      // stalk from the present board down to the sighting
      if (u > .05 && p.look === 'ghost' && p.depth > 0) this.lines.segment([X(p.sq), 0, Z(p.sq)], [X(p.sq), y + pieceHeight(p.kind), Z(p.sq)], 0xff637e, .35 * u, .12);
      const lab = this.badge(id, p);
      if (lab) {
        const v = obj.g.position.clone().setY(obj.g.position.y + pieceHeight(p.kind) + .12).project(this.camera);
        lab.style.transform = `translate(${(v.x + 1) * this.size.w / 2}px,${(1 - v.y) * this.size.h / 2}px)`;
      }
    }
    for (const [id, obj] of this.objects) if (!seen.has(id)) { this.scene.remove(obj.g); this.objects.delete(id); const l = this.labels.get(id); if (l) { l.remove(); this.labels.delete(id); } }
    this.lines.finish();
    // marks
    this.markGroup.clear();
    for (const m of s.marks) {
      const y = -u * H * this.tileDepth(m.sq) + .012;
      let mesh: T.Mesh;
      if (m.kind === 'move') mesh = new T.Mesh(DOT, MARK.move);
      else if (m.kind === 'capture') mesh = new T.Mesh(RINGG, MARK.capture);
      else if (m.kind === 'hint') { mesh = new T.Mesh(SQ, MARK.hint); (MARK.hint as T.MeshBasicMaterial).opacity = .25 + .2 * Math.sin(t / 220); }
      else if (m.kind === 'select') mesh = new T.Mesh(SQ, MARK.select);
      else mesh = new T.Mesh(SQ, MARK.last);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(X(m.sq), y, Z(m.sq)); this.markGroup.add(mesh);
    }
    if (this.hover >= 0) { const m = new T.Mesh(SQ, MARK.hover); m.rotation.x = -Math.PI / 2; m.position.set(X(this.hover), .011 - u * H * this.tileDepth(this.hover), Z(this.hover)); this.markGroup.add(m); }
    // flashes
    const now = performance.now();
    this.flashes = this.flashes.filter(f => {
      const k = (now - f.t) / 700;
      if (k >= 1) { this.fx.remove(f.m); f.m.geometry.dispose(); return false; }
      f.m.scale.setScalar(1 + k * 3); (f.m.material as T.MeshBasicMaterial).opacity = 1 - k; return true;
    });
    // coordinates around the board
    for (let i = 0; i < 8; i++) {
      const a = new T.Vector3(i - 3.5, 0, 4.55).project(this.camera), b = new T.Vector3(-4.55, 0, 3.5 - i).project(this.camera);
      const lf = this.labels.get('cf' + i)!, lr = this.labels.get('cr' + i)!;
      lf.style.opacity = lr.style.opacity = String(1 - u);
      lf.style.transform = `translate(${(a.x + 1) * this.size.w / 2}px,${(1 - a.y) * this.size.h / 2}px)`;
      lr.style.transform = `translate(${(b.x + 1) * this.size.w / 2}px,${(1 - b.y) * this.size.h / 2}px)`;
    }
    this.renderer.render(this.scene, this.camera);
  }
  private badge(id: string, p: DisplayPiece) {
    let l = this.labels.get(id);
    const show = p.look === 'ghost' && (p.age ?? 0) > 0;
    if (!show) { if (l) l.style.display = 'none'; return null; }
    if (!l) { l = document.createElement('span'); l.className = 'age'; this.host.append(l); this.labels.set(id, l); }
    l.style.display = 'block'; l.textContent = String(p.age);
    return l;
  }
}
const DOT = new T.CircleGeometry(.13, 32);
const RINGG = new T.RingGeometry(.36, .44, 48);
const SQ = new T.PlaneGeometry(.98, .98);
const MARK = {
  move: new T.MeshBasicMaterial({ color: 0xf2d59b, transparent: true, opacity: .75, toneMapped: false }),
  capture: new T.MeshBasicMaterial({ color: 0xff637e, transparent: true, opacity: .85, toneMapped: false }),
  hint: new T.MeshBasicMaterial({ color: 0x56d4f2, transparent: true, opacity: .35, toneMapped: false }),
  select: new T.MeshBasicMaterial({ color: 0xf2d59b, transparent: true, opacity: .3, toneMapped: false }),
  last: new T.MeshBasicMaterial({ color: 0x56d4f2, transparent: true, opacity: .16, toneMapped: false }),
  hover: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .08, toneMapped: false }),
};
