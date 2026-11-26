import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { board, piece } from './sculpture';
import { Strokes, Marks, Bold, type V3 } from './strokes';
import { WaveField } from './wave-field';
import { distance, positionAt, type Point, type Pulse } from '../game/physics';
import { ORIGIN, enemyOf, type Sim, type Team } from '../game/sim';
import { causalLock, possibilityRadius, type Knowledge } from '../game/knowledge';

export type ViewMode = 'space' | 'time' | 'wave';
export interface RenderState {
  mode: ViewMode;
  /** Viewing time (timeline cursor). */
  t: number;
  /** Match present (coordinate time of the simulation). */
  now: number;
  /** What blue may know at min(t, now) — or the omniscient reveal. */
  k: Knowledge;
  /** Blue's own plan (only blue units). */
  plan: Sim | null;
  selectedId: string | null;
  drafts: { unitId: string; to: Point }[];
  wavePulses: Pulse[];
  receivers: Point[];
  showCones: boolean;
  showLock: boolean;
  reducedMotion: boolean;
}

export const HEX = { blue: 0x56d4f2, red: 0xff637e, gold: 0xf2d59b, hyp: 0xa89abc, ivory: 0xe4e9ee, muted: 0x8190a4, phase: 0xb79cff } as const;
const teamHex = (t: string) => (t === 'blue' ? HEX.blue : t === 'red' ? HEX.red : HEX.gold);
const H = 0.55; // vertical GU per second in the temporal prism
const PAST = 10, FUTURE = 8;

function contactTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96; const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48); g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(.5, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96); return new T.CanvasTexture(c);
}
function makeLabel(host: HTMLElement, cls: string) {
  const e = document.createElement('span'); e.className = 'tag ' + cls; e.setAttribute('aria-hidden', 'true'); host.append(e); return e;
}
function ghostOf(model: T.Group, hex: number) {
  const g = model.clone(true);
  const mat = new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: .16, depthWrite: false, toneMapped: false });
  const edge = new T.LineBasicMaterial({ color: hex, transparent: true, opacity: .55, toneMapped: false });
  g.traverse(o => {
    if (o instanceof T.Mesh) {
      o.material = mat; o.castShadow = o.receiveShadow = false;
      const lines = new T.LineSegments(new T.EdgesGeometry(o.geometry, 30), edge); o.add(lines);
    }
  });
  return g;
}

export class Battlefield {
  private readonly scene = new T.Scene();
  private readonly renderer: T.WebGLRenderer;
  private readonly camera = new T.OrthographicCamera(-7, 7, 5, -5, .1, 200);
  private readonly watcher: ResizeObserver;
  private readonly strokes = new Strokes();
  private readonly marks = new Marks();
  private readonly bold = new Bold(2.6);
  private readonly wave = new WaveField();
  private readonly boardGroup: T.Group;
  private readonly models = new Map<string, T.Group>();
  private readonly ghosts = new Map<string, T.Group>();
  private readonly cone: T.Mesh<T.ConeGeometry, T.ShaderMaterial>;
  private readonly contacts = contactTexture();
  private readonly labels: HTMLElement[] = [];
  private labelUse = 0;
  private readonly ray = new T.Raycaster();
  private readonly listeners = new AbortController();
  private state?: RenderState;
  private size = { w: 1, h: 1 }; private raf = 0; private last = 0; private unfold = 0; private zoomFactor = 1;
  private yaw = -.62; private elevation = .62; private pan = new T.Vector3();
  private drag?: { x: number; y: number; button: number; px: number; py: number; moved: boolean };
  private hoverNode?: Point; private dirty = true; private contextLost = false; private clock = 0;

  constructor(private readonly host: HTMLElement, private readonly onPick: (p: Point, unitId?: string, button?: number) => void,
    private readonly onHover?: (p: Point | null) => void) {
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0, 0); this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    const canvas = this.renderer.domElement; canvas.setAttribute('aria-label', '전장'); canvas.className = 'field-canvas';
    host.append(canvas);
    const env = new RoomEnvironment(), pm = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, .07).texture; this.scene.environmentIntensity = .32; env.dispose(); pm.dispose();
    const hemi = new T.HemisphereLight(0xdfe9f2, 0x1a1f2a, .55);
    const key = new T.DirectionalLight(0xffe7c8, 2.6); key.position.set(-3, 12, 6); key.target.position.set(4, 0, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .1, far: 40 });
    key.shadow.bias = -.0004; key.shadow.normalBias = .02;
    const rim = new T.DirectionalLight(0x8fbfe0, 2.2); rim.position.set(12, 5, -4); rim.target.position.set(4, 0, 4);
    this.boardGroup = board();
    this.scene.add(hemi, key, key.target, rim, rim.target, this.boardGroup, this.strokes, this.marks, this.bold, this.wave);
    const ground = new T.Mesh(new T.PlaneGeometry(120, 120), new T.ShadowMaterial({ opacity: .3 })); ground.rotation.x = -Math.PI / 2; ground.position.set(4, -2.4, 4); ground.receiveShadow = true;
    this.scene.add(ground);
    // Past light cone of the ORIGIN: the surface of everything it can currently know.
    const coneGeo = new T.ConeGeometry(1, 1, 128, 1, true); coneGeo.translate(0, -.5, 0);
    this.cone = new T.Mesh(coneGeo, new T.ShaderMaterial({
      side: T.DoubleSide, transparent: true, depthWrite: false,
      uniforms: { tint: { value: new T.Color(HEX.blue) }, now: { value: 0 } },
      vertexShader: 'varying vec3 w; varying float h; void main(){ w=(modelMatrix*vec4(position,1.)).xyz; h=-position.y; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); }',
      fragmentShader: `uniform vec3 tint; uniform float now; varying vec3 w; varying float h;
        void main(){ if(w.x<-.02||w.x>8.02||w.z<-.02||w.z>8.02) discard;
          float bands = .5+.5*cos(h*40.-now*3.);
          float a = (.05 + .05*bands) * (1.-h*.6);
          gl_FragColor = vec4(tint, a);
          #include <colorspace_fragment>
        }`,
    }));
    this.cone.renderOrder = 2; this.cone.visible = false; this.scene.add(this.cone);
    this.wave.visible = false;
    this.watcher = new ResizeObserver(() => this.resize()); this.watcher.observe(host);
    const opts = { signal: this.listeners.signal };
    canvas.addEventListener('contextmenu', e => e.preventDefault(), opts);
    canvas.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, button: e.button, px: e.clientX, py: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); }, opts);
    canvas.addEventListener('pointermove', e => {
      const d = this.drag;
      if (d && (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4)) {
        d.moved = true; canvas.style.cursor = 'grabbing';
        const dx = e.clientX - d.px, dy = e.clientY - d.py; d.px = e.clientX; d.py = e.clientY;
        if (e.shiftKey || d.button === 1) {
          const k = (this.camera.top - this.camera.bottom) / this.size.h / this.zoomFactor;
          this.pan.x -= k * (dx * Math.cos(this.yaw) - dy * Math.sin(this.yaw) * .5);
          this.pan.z += k * (dx * Math.sin(this.yaw) + dy * Math.cos(this.yaw) * .5);
        } else { this.yaw -= dx * .006; this.elevation = T.MathUtils.clamp(this.elevation + dy * .005, .12, 1.56); }
        this.setHover(undefined); this.dirty = true; return;
      }
      if (!d) { const hit = this.intersect(e.clientX, e.clientY); this.setHover(hit?.node); canvas.style.cursor = hit ? 'pointer' : 'grab'; }
    }, opts);
    canvas.addEventListener('pointerup', e => {
      const d = this.drag; this.drag = undefined; canvas.style.cursor = 'grab';
      if (!d || d.moved) return;
      const hit = this.intersect(e.clientX, e.clientY);
      if (hit) this.onPick(hit.node, hit.unit, d.button); else if (d.button === 2) this.onPick({ x: -1, z: -1 }, undefined, 2);
    }, opts);
    canvas.addEventListener('pointercancel', () => { this.drag = undefined; }, opts);
    canvas.addEventListener('pointerleave', () => this.setHover(undefined), opts);
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(-Math.sign(e.deltaY) * .1)); }, { ...opts, passive: false });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.contextLost = true; }, opts);
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.dirty = true; }, opts);
    this.resize();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  private setHover(node?: Point) {
    const same = node && this.hoverNode && node.x === this.hoverNode.x && node.z === this.hoverNode.z;
    if (same || (!node && !this.hoverNode)) return;
    this.hoverNode = node; this.dirty = true; this.onHover?.(node ?? null);
  }
  private resize() { this.size = { w: Math.max(1, this.host.clientWidth), h: Math.max(1, this.host.clientHeight) }; this.renderer.setSize(this.size.w, this.size.h, false); this.bold.setResolution(this.size.w, this.size.h); this.dirty = true; }

  update(state: RenderState) { this.state = state; this.dirty = true; }

  private model(id: string, kind: Parameters<typeof piece>[0]) {
    let m = this.models.get(id);
    if (m) return m;
    m = piece(kind); m.userData.unitId = id;
    const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: this.contacts, transparent: true, depthWrite: false, opacity: .6 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .052; shadow.userData.noPick = true; m.add(shadow);
    this.models.set(id, m); this.scene.add(m);
    if (kind.team === 'blue' && kind.kind !== 'origin' && kind.kind !== 'nexus') {
      const g = ghostOf(m, HEX.gold); g.userData.unitId = id; g.userData.ghost = true; g.children.forEach(c => { if ((c as T.Mesh).material && (c as T.Mesh).geometry?.type === 'PlaneGeometry') c.visible = false; });
      this.ghosts.set(id, g); this.scene.add(g);
    }
    return m;
  }

  private yy(time: number) { const s = this.state!; return (time - s.t) * H * this.unfold; }

  private label(text: string, p: Point, y: number, cls = '', dx = 0, dy = 0) {
    let e = this.labels[this.labelUse];
    if (!e) { e = makeLabel(this.host, ''); this.labels.push(e); }
    this.labelUse++;
    const v = new T.Vector3(p.x, y, p.z).project(this.camera);
    if (v.z > 1) { e.style.display = 'none'; return; }
    e.className = 'tag ' + cls; e.textContent = text; e.style.display = 'block';
    e.style.transform = `translate(${Math.round((v.x + 1) * this.size.w / 2 + dx)}px,${Math.round((1 - v.y) * this.size.h / 2 + dy)}px)`;
  }

  private build() {
    const s = this.state!; const k = s.k, st = this.strokes, mk = this.marks;
    const bd = this.bold;
    st.reset(); mk.reset(); bd.reset(); this.labelUse = 0;
    const temporal = this.unfold > .01, u = this.unfold;
    const yy = (time: number) => this.yy(time);
    const enemy = enemyOf(k.team), O = ORIGIN[k.team];
    const wave = s.mode === 'wave';
    this.wave.visible = wave; if (wave) this.wave.set(s.t, s.wavePulses);

    // ── models ────────────────────────────────────────────────────────────
    const seenIds = new Set<string>();
    for (const unit of k.units) {
      const m = this.model(unit.id, unit);
      seenIds.add(unit.id);
      const y = unit.kind === 'origin' ? 0 : yy(unit.seenAt);
      const lift = wave ? (unit.kind === 'origin' ? 1 : 0) : 1;
      m.visible = lift > 0;
      m.position.set(unit.pos.x, y + .01, unit.pos.z);
      const course = Math.atan2(unit.velocity.x, unit.velocity.z);
      void course;
    }
    for (const n of k.nexus) {
      const m = this.model(n.id, { kind: 'nexus', team: 'neutral' });
      m.position.set(n.pos.x, .01, n.pos.z); m.visible = true;
      m.userData.spin = n.controller ? .5 : .12;
    }
    // own plan ghosts (exact for own motion; production is hypothesis)
    for (const [id, g] of this.ghosts) {
      const seen = k.units.find(x => x.id === id);
      if (!s.plan || !seen || k.omniscient || wave) { g.visible = false; continue; }
      const p = s.plan.positionAt(id, s.t);
      const diverged = distance(p, seen.pos) > .02 || Math.abs(seen.seenAt - s.t) > .05;
      g.visible = diverged && (temporal || distance(p, seen.pos) > .02);
      g.position.set(p.x, .012, p.z);
    }

    // ── board slices / prism ─────────────────────────────────────────────
    if (temporal) {
      for (let dt = -PAST; dt <= FUTURE; dt += 2) {
        const at = Math.round((s.t + dt) / 2) * 2; if (at < 0 || at > k.duration || Math.abs(at - s.t) < .2) continue;
        const y = yy(at), fut = at > s.now + 1e-6, a = (fut ? .07 : .12) * u;
        for (let i = 1; i < 8; i++) { st.segment([i, y, 0], [i, y, 8], fut ? HEX.hyp : HEX.muted, a); st.segment([0, y, i], [8, y, i], fut ? HEX.hyp : HEX.muted, a); }
        const c: V3[] = [[0, y, 0], [8, y, 0], [8, y, 8], [0, y, 8]];
        c.forEach((v, i) => st.segment(v, c[(i + 1) % 4], fut ? HEX.hyp : HEX.ivory, (fut ? .3 : .38) * u, fut ? .14 : 0));
        if (u > .7) this.label('T ' + at.toFixed(0), { x: 8, z: 0 }, y, 'tick', 8, -6);
      }
      // the NOW slice: the solid board dissolves into a precise frame so the past cone beneath it shows
      const c: V3[] = [[-.3, 0, -.3], [8.3, 0, -.3], [8.3, 0, 8.3], [-.3, 0, 8.3]];
      c.forEach((v, i) => st.segment(v, c[(i + 1) % 4], HEX.gold, .7 * u));
      for (let i = 0; i <= 8; i++) { st.segment([i, 0, 0], [i, 0, 8], HEX.ivory, .2 * u); st.segment([0, 0, i], [8, 0, i], HEX.ivory, .2 * u); }
      if (s.now > s.t + .05 && s.now - s.t <= FUTURE) { // present marker when browsing the past
        const y = yy(s.now); const cc: V3[] = [[0, y, 0], [8, y, 0], [8, y, 8], [0, y, 8]];
        cc.forEach((v, i) => st.segment(v, cc[(i + 1) % 4], HEX.gold, .5 * u, .1));
      }
    }

    // past light cone of our ORIGIN at the viewing instant
    this.cone.visible = temporal && s.showCones && !k.omniscient && !wave;
    if (this.cone.visible) {
      const depth = Math.min(PAST, k.t);
      this.cone.position.set(O.x, yy(k.t), O.z);
      this.cone.scale.set(depth, Math.max(1e-3, depth * H * u), depth);
      this.cone.material.uniforms.now.value = this.clock;
      for (let d = 1; d <= depth; d += 1) st.ring(O, yy(k.t - d), d, HEX.blue, (d % 2 ? .1 : .22) * u, { clip: true });
      this.label('PAST LIGHT CONE', { x: O.x + depth * .5, z: O.z + depth * .62 }, yy(k.t - depth * .62), 'cone');
    }

    // ── worldlines (known history) ───────────────────────────────────────
    if (temporal && !wave) {
      for (const [id, pts] of Object.entries(k.trails)) {
        const unit = k.units.find(x => x.id === id)!; if (!unit || unit.kind === 'nexus') continue;
        const hex = id === s.selectedId ? HEX.gold : teamHex(unit.team);
        const vis = pts.filter(p => p.t >= s.t - PAST - 1);
        for (let i = 1; i < vis.length; i++) {
          const a = vis[i - 1], b = vis[i];
          bd.segment([a.x, yy(a.t), a.z], [b.x, yy(b.t), b.z], hex, id === s.selectedId ? 1 : .75);
        }
      }
      // own future plan worldlines
      if (s.plan && !k.omniscient) for (const def of s.plan.roster) {
        if (def.team !== 'blue' || def.kind === 'origin' || def.kind === 'nexus') continue;
        const legs = s.plan.legs(def.id); const seen = k.units.find(x => x.id === def.id);
        const from = seen?.seenAt ?? s.t, to = Math.min(k.duration, s.t + FUTURE);
        const times = [from, ...legs.flatMap(l => [l.start, l.end]).filter(t => t > from && t < to), to];
        const sel = def.id === s.selectedId;
        for (let i = 1; i < times.length; i++) {
          const a = positionAt(def.at, legs, times[i - 1]), b = positionAt(def.at, legs, times[i]);
          bd.segment([a.x, yy(times[i - 1]), a.z], [b.x, yy(times[i]), b.z], sel ? HEX.gold : HEX.blue, sel ? .85 : .35, .16);
        }
      }
    }

    // own plan on the board plane (space view)
    if (!temporal && !wave && s.plan && !k.omniscient) for (const def of s.plan.roster) {
      if (def.team !== 'blue' || def.kind === 'origin' || def.kind === 'nexus') continue;
      const legs = s.plan.legs(def.id).filter(l => l.end > s.t);
      const sel = def.id === s.selectedId;
      let from = s.plan.positionAt(def.id, s.t);
      for (const l of legs) {
        bd.segment([from.x, .1, from.z], [l.to.x, .1, l.to.z], sel ? HEX.gold : HEX.blue, sel ? .9 : .35, .16);
        mk.mark(l.to.x, .12, l.to.z, .055, sel ? HEX.gold : HEX.blue);
        from = l.to;
      }
    }

    // ── enemy possibility (conservative outer bound) ─────────────────────
    if (!k.omniscient && !wave) for (const unit of k.units) {
      if (unit.team !== enemy || unit.kind === 'origin') continue;
      const r = possibilityRadius(unit, s.t);
      const hex = HEX.red;
      if (temporal) {
        for (let dt = 0; dt <= FUTURE + PAST; dt += 1) {
          const at = unit.seenAt + dt; if (at > s.t + FUTURE || at > k.duration) break;
          const rr = possibilityRadius(unit, at); if (rr <= .01) continue;
          st.ring(unit.pos, yy(at), rr, hex, (at <= s.t ? .2 : .1) * u, { clip: true, dash: at > s.t ? 1 : 0 });
        }
      } else if (r > .02) {
        st.ring(unit.pos, .06, r, hex, .42, { clip: true, dash: 1 });
      }
      const age = s.t - unit.seenAt;
      if (age > .05 && !temporal) this.label('−' + age.toFixed(1) + 's', unit.pos, .9, 'age');
    }

    // ── NEXUS control & causal lock ──────────────────────────────────────
    for (const n of k.nexus) {
      const y = .07;
      const ctrl = n.controller;
      if (ctrl === 'blue' || ctrl === 'red') st.ring(n.pos, y, .52, teamHex(ctrl), .85, { n: 48 });
      else if (ctrl === 'contested') { st.ring(n.pos, y, .52, HEX.blue, .85, { n: 48, dash: 1 }); st.ring(n.pos, y, .56, HEX.red, .85, { n: 48, dash: 1 }); }
      if (ctrl) { // production progress as seen (light-delayed)
        const age = Math.max(0, n.seenAt - n.since), f = (age % 3) / 3;
        st.ring(n.pos, y, .62, HEX.gold, .9, { from: -Math.PI / 2, to: -Math.PI / 2 + f * Math.PI * 2, n: 40 });
      }
      if (s.showLock && !k.omniscient && !wave) {
        const lock = causalLock(k, n.pos);
        if (lock.t < Infinity) {
          if (temporal) {
            const top = Math.min(s.t + FUTURE, k.duration);
            bd.segment([n.pos.x, yy(Math.max(s.t - PAST, 0)), n.pos.z], [n.pos.x, yy(Math.min(lock.t, top)), n.pos.z], HEX.gold, .55 * u);
            if (lock.t < top) { st.segment([n.pos.x, yy(lock.t), n.pos.z], [n.pos.x, yy(top), n.pos.z], HEX.red, .5 * u, .1); mk.mark(n.pos.x, yy(lock.t), n.pos.z, .09, HEX.gold, .5); }
          }
          const safe = lock.t - s.t;
          this.label(safe > 0 ? 'LOCK +' + safe.toFixed(1) : 'OPEN', n.pos, temporal ? yy(Math.min(lock.t, s.t + FUTURE)) + .2 : 1.05, safe > 0 ? 'lock' : 'open');
        }
      }
    }

    // ── signals: null rings, packets, null lines ─────────────────────────
    for (const sig of k.signals) {
      const age = s.t - sig.emit; if (age < 0) continue;
      const hex = sig.kind === 'phase' ? HEX.phase : sig.kind === 'data' ? teamHex(sig.team) : teamHex(sig.team);
      const reach = sig.to ? distance(sig.from, sig.to) : 0;
      const life = sig.kind === 'command' ? 11 : reach + sig.duration + 1.5;
      if (age > life && !temporal) continue;
      if (!temporal && !wave) {
        const fade = Math.max(0, 1 - age / life);
        if (sig.kind === 'command') st.ring(sig.from, .075, age, hex, (sig.team === k.team ? .35 : .55) * fade, { clip: true });
        else {
          st.ring(sig.from, .08, age, hex, .38 * fade, { clip: true });
          if (sig.duration > 0 && age > sig.duration) st.ring(sig.from, .08, age - sig.duration, hex, .16 * fade, { clip: true });
        }
        if (sig.to && age <= reach + sig.duration) { // directed link: the packet itself
          const f0 = Math.min(1, Math.max(0, (age - sig.duration) / Math.max(reach, 1e-6))), f1 = Math.min(1, age / Math.max(reach, 1e-6));
          const a: V3 = [sig.from.x + (sig.to.x - sig.from.x) * f0, .11, sig.from.z + (sig.to.z - sig.from.z) * f0];
          const b: V3 = [sig.from.x + (sig.to.x - sig.from.x) * f1, .11, sig.from.z + (sig.to.z - sig.from.z) * f1];
          bd.segment(a, b, hex, .95);
          mk.mark(b[0], .11, b[2], sig.kind === 'data' ? .07 : .06, sig.kind === 'phase' ? HEX.phase : HEX.gold);
        }
      }
      if (temporal && !wave && sig.to && sig.emit > s.t - PAST - 2) {
        const arr = sig.emit + reach;
        bd.segment([sig.from.x, yy(sig.emit), sig.from.z], [sig.to.x, yy(arr), sig.to.z], hex, .7 * u);
        mk.mark(sig.from.x, yy(sig.emit), sig.from.z, .055, hex);
      }
      if (temporal && !wave && sig.kind === 'command' && sig.team !== k.team && sig.emit > s.t - PAST) {
        for (let d = 1; d <= 3; d++) st.ring(sig.from, yy(sig.emit + d), d, HEX.red, .25 * u * (1 - d / 4), { clip: true });
      }
    }
    // own commands as planned null lines (origin → receiving event)
    if (s.plan && !k.omniscient && !wave) for (const ev of s.plan.log) {
      if (ev.kind !== 'cmd-recv' && ev.kind !== 'cmd-stale') continue;
      const emit = s.plan.packets.find(p => p.id === ev.packetId)?.emit ?? ev.t;
      if (temporal) {
        if (ev.t < s.t - PAST || emit > s.t + FUTURE) continue;
        bd.segment([O.x, yy(emit), O.z], [ev.pos.x, yy(ev.t), ev.pos.z], HEX.gold, .75 * u, ev.t > s.now ? .14 : 0);
        mk.mark(ev.pos.x, yy(ev.t), ev.pos.z, .07, HEX.gold);
      } else if (s.t >= emit && s.t < ev.t) {
        const f = (s.t - emit) / Math.max(1e-6, ev.t - emit);
        const p: V3 = [O.x + (ev.pos.x - O.x) * f, .12, O.z + (ev.pos.z - O.z) * f];
        st.segment([O.x, .12, O.z], p, HEX.gold, .5); mk.mark(p[0], p[1], p[2], .06, HEX.gold);
        st.segment(p, [ev.pos.x, .12, ev.pos.z], HEX.gold, .25, .12);
      }
    }

    // ── visible events in the prism ──────────────────────────────────────
    if (temporal && !wave) for (const e of k.events) {
      if (e.t < s.t - PAST || e.t > s.t + FUTURE) continue;
      const y = yy(e.t);
      if (e.kind === 'score') mk.mark(e.pos.x, y, e.pos.z, .13, teamHex(e.team));
      else if (e.kind === 'data-fail') mk.mark(e.pos.x, y, e.pos.z, .12, HEX.phase, .35);
      else if (e.kind === 'data-emit') mk.mark(e.pos.x, y, e.pos.z, .075, teamHex(e.team));
      else if (e.kind === 'pulse') mk.mark(e.pos.x, y, e.pos.z, .08, HEX.phase);
      else if (e.kind === 'ready') mk.mark(e.pos.x, y, e.pos.z, .06, HEX.ivory);
    }

    // ── selection, drafts, receivers ─────────────────────────────────────
    const sel = s.selectedId ? k.units.find(x => x.id === s.selectedId) : undefined;
    if (sel && !wave) {
      const p = sel.team === 'blue' && s.plan && !k.omniscient ? s.plan.positionAt(sel.id, s.t) : sel.pos;
      st.ring(p, .09, .5, HEX.gold, .95, { n: 4 * 12, dash: 1 });
    }
    for (const d of s.drafts) {
      st.ring(d.to, .09, .34, HEX.gold, .95, { n: 32 }); st.ring(d.to, .09, .2, HEX.gold, .6, { n: 24 });
    }
    if (wave) for (const r of s.receivers) { st.ring(r, .44, .28, HEX.gold, .95, { n: 40 }); st.ring(r, .44, .36, HEX.gold, .35, { n: 40, dash: 1 }); }
    if (this.hoverNode) {
      st.ring(this.hoverNode, .085, .18, HEX.ivory, .8, { n: 24 });
      this.label(String.fromCharCode(65 + this.hoverNode.x) + (this.hoverNode.z + 1) + '  ' + this.hoverNode.x + ',' + this.hoverNode.z, this.hoverNode, .1, 'hover', 12, 4);
    }
    st.finish(); mk.finish(); bd.finish();
    for (let i = this.labelUse; i < this.labels.length; i++) this.labels[i].style.display = 'none';
  }

  private cameraUpdate() {
    const { w, h } = this.size, aspect = w / h;
    const viewH = Math.max(9.2 + this.unfold * 3.6, 13.2 / aspect) / this.zoomFactor;
    this.camera.top = viewH / 2; this.camera.bottom = -viewH / 2; this.camera.left = -viewH * aspect / 2; this.camera.right = viewH * aspect / 2;
    const aim = new T.Vector3(4, .1 + this.unfold * 1.0, 4).add(this.pan), e = this.elevation - this.unfold * .2;
    this.camera.position.copy(aim).add(new T.Vector3(40 * Math.sin(this.yaw) * Math.cos(e), 40 * Math.sin(e), 40 * Math.cos(this.yaw) * Math.cos(e)));
    this.camera.lookAt(aim); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }

  private frame(time: number) {
    this.raf = requestAnimationFrame(t => this.frame(t));
    if (this.contextLost || !this.state) return;
    const dt = Math.min(.08, this.last ? (time - this.last) / 1000 : .016); this.last = time; this.clock += dt;
    const goal = this.state.mode === 'time' ? 1 : 0, prev = this.unfold;
    this.unfold = this.state.reducedMotion ? goal : T.MathUtils.damp(prev, goal, 6.5, dt);
    if (Math.abs(goal - this.unfold) < .002) this.unfold = goal;
    // always rebuild: rings animate, nexus spins; cost is a few thousand segments
    this.boardGroup.visible = this.unfold < .35;
    for (const m of this.models.values()) if (m.userData.spin) m.rotation.y += dt * m.userData.spin;
    this.cameraUpdate();
    if (this.dirty || prev !== this.unfold) this.build();
    this.cone.material.uniforms.now.value = this.clock;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }

  private intersect(x: number, y: number) {
    const rect = this.host.getBoundingClientRect();
    this.ray.setFromCamera(new T.Vector2(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height), this.camera);
    const pickable = [...this.models.values(), ...this.ghosts.values()].filter(g => g.visible);
    const hit = this.ray.intersectObjects(pickable, true).find(h => !h.object.userData.noPick && !(h.object instanceof T.LineSegments));
    if (hit) {
      let m: T.Object3D | null = hit.object; while (m && !m.userData.unitId) m = m.parent;
      if (m) return { node: { x: Math.round(m.position.x), z: Math.round(m.position.z) }, unit: m.userData.unitId as string };
    }
    const pt = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -.045), new T.Vector3());
    if (!pt || pt.x < -.4 || pt.x > 8.4 || pt.z < -.4 || pt.z > 8.4) return;
    return { node: { x: T.MathUtils.clamp(Math.round(pt.x), 0, 8), z: T.MathUtils.clamp(Math.round(pt.z), 0, 8) }, unit: undefined };
  }
  topView() { this.yaw = 0; this.elevation = 1.56; this.pan.set(0, 0, 0); this.dirty = true; }
  resetCamera() { this.yaw = -.62; this.elevation = .62; this.pan.set(0, 0, 0); this.zoomFactor = 1; this.dirty = true; }
  zoom(f: number) { this.zoomFactor = T.MathUtils.clamp(this.zoomFactor * f, .55, 2.4); this.dirty = true; }
  /** Screen position of a node for QA / tutorials. */
  projectNode(n: Point) { const v = new T.Vector3(n.x, .05, n.z).project(this.camera); const r = this.host.getBoundingClientRect(); return { x: r.left + (v.x + 1) * this.size.w / 2, y: r.top + (1 - v.y) * this.size.h / 2 }; }
  dispose() {
    cancelAnimationFrame(this.raf); this.watcher.disconnect(); this.listeners.abort();
    this.scene.traverse(o => { if (o instanceof T.Mesh || o instanceof T.LineSegments) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: T.Material) => m.dispose()); } });
    this.renderer.dispose(); this.labels.forEach(l => l.remove()); this.renderer.domElement.remove();
  }
  get team(): Team { return 'blue'; }
}
