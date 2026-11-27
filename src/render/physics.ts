// Pieces that leave the board become rigid bodies (Rapier, WASM): they go over the brass frame, drop onto the
// walnut table, tumble and roll, and stay there until the board is reset. The rules never see this — the engine
// already decided the piece is gone; this is only how a real wooden piece would leave a real table.
import * as T from 'three';
import type RapierNS from '@dimforge/rapier3d-compat';

type R = typeof RapierNS;
interface Thrown { obj: T.Object3D; body: RapierNS.RigidBody; v: T.Vector3; born: number; mass: number }

/** Gravity in squares/s². Real scale (1 square = 6.25 cm) would be 157; a slower world reads as weight on screen. */
const G = 34;
const MAX = 14;

export class Debris {
  private R: R | null = null;
  private world: RapierNS.World | null = null;
  private live: Thrown[] = [];
  private loading: Promise<void> | null = null;
  onImpact: (mass: number, speed: number) => void = () => {};

  /** Load the engine lazily (after the lab is lit) and build the static room: table, board slab, frame, rulers. */
  init(box: T.Box3, surface: number) {
    this.loading ??= (async () => {
      const mod = await import('@dimforge/rapier3d-compat');
      const R = (mod as unknown as { default: R }).default ?? (mod as unknown as R);
      await R.init();
      this.R = R;
      const w = new R.World({ x: 0, y: -G, z: 0 });
      const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = .6) =>
        w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(.25));
      const bottom = box.min.y, top = box.max.y, edge = box.max.x;
      fixed(40, .5, 40, 0, bottom - .5, 0, .7);                                   // the walnut table
      fixed(4, (surface - bottom) / 2, 4, 0, (surface + bottom) / 2, 0);            // playing surface
      const rim = (edge - 4) / 2, rimY = (top + bottom) / 2, rimH = (top - bottom) / 2;
      fixed(rim, rimH, edge, 4 + rim, rimY, 0); fixed(rim, rimH, edge, -4 - rim, rimY, 0);   // raised frame
      fixed(4, rimH, rim, 0, rimY, 4 + rim); fixed(4, rimH, rim, 0, rimY, -4 - rim);
      const half = edge + .18, rl = half * 2 + .3;                                   // brass rulers
      for (const [x, z, alongX] of [[0, -half, true], [0, half, true], [-half, 0, false], [half, 0, false]] as const)
        fixed(alongX ? rl / 2 : .11, .025, alongX ? .11 : rl / 2, x, bottom + .025, z, .35);
      this.world = w;
    })().catch(() => { this.world = null; });
    return this.loading;
  }
  get ready() { return !!this.world; }
  get active() { return this.live.some(t => !t.body.isSleeping()); }

  /** Hand a piece to the physics world with a velocity (world units/s) and a little spin. */
  throw(obj: T.Object3D, hull: Float32Array, vel: T.Vector3, mass: number) {
    const R = this.R, w = this.world; if (!R || !w) return false;
    const q = obj.quaternion;
    const body = w.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(obj.position.x, obj.position.y + .01, obj.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinvel(vel.x, vel.y, vel.z)
      .setAngvel({ x: vel.z * 1.6 + (Math.random() - .5), y: (Math.random() - .5) * 3, z: -vel.x * 1.6 + (Math.random() - .5) })
      .setLinearDamping(.12).setAngularDamping(.4).setCcdEnabled(true).setCanSleep(true));
    const shape = R.ColliderDesc.convexHull(hull) ?? R.ColliderDesc.cylinder(.3, .25);
    w.createCollider(shape.setDensity(1 + mass * .15).setFriction(.55).setRestitution(.28), body);
    this.live.push({ obj, body, v: vel.clone(), born: performance.now(), mass });
    while (this.live.length > MAX) this.drop(this.live[0]);
    return true;
  }

  step(dtMs: number) {
    const w = this.world; if (!w || !this.live.length) return false;
    let n = Math.min(4, Math.ceil(dtMs / 16.7));
    w.timestep = Math.min(dtMs / 1000, .05) / n;
    while (n--) w.step();
    let moving = false;
    for (const t of this.live) {
      const p = t.body.translation(), r = t.body.rotation(), v = t.body.linvel();
      t.obj.position.set(p.x, p.y, p.z); t.obj.quaternion.set(r.x, r.y, r.z, r.w);
      const dv = Math.hypot(v.x - t.v.x, v.y - t.v.y, v.z - t.v.z);
      if (dv > 2.2) this.onImpact(t.mass, dv);
      t.v.set(v.x, v.y, v.z);
      if (!t.body.isSleeping()) moving = true;
      if (p.y < -30) this.drop(t);
    }
    return moving;
  }

  private drop(t: Thrown) {
    this.world?.removeRigidBody(t.body);
    t.obj.parent?.remove(t.obj);
    this.live = this.live.filter(x => x !== t);
  }
  /** A new board: sweep the table. */
  clear() { for (const t of [...this.live]) this.drop(t); }
}
