// PlayerView: everything a team may know at coordinate time t.
// The rule is a single geometric statement: an event is known to a team iff it
// lies inside the past light cone of that team's ORIGIN at (ORIGIN, t).
// (Own command emissions happen at the ORIGIN itself, so they are immediate.)
import { C, EPS, distance, positionAt, retardedTime, tauAt, velocityAt, type Point } from './physics.ts'
import { ORIGIN, RULES, enemyOf, type Kind, type Side, type SimEvent, type Signal, type Sim, type Team } from './sim.ts'

export interface SeenUnit {
  id: string; kind: Kind; team: Side
  /** Position in the light now arriving at the ORIGIN (the retarded image). */
  pos: Point
  /** Coordinate time at which that light left the unit. */
  seenAt: number
  velocity: Point; moving: boolean
  /** Courier calibration 0..1 as visible in the arriving light. */
  readiness: number
  /** Proper time of the unit at seenAt. */
  tau: number
}
export interface SeenNexus {
  id: string; pos: Point; controller: Team | 'contested' | null; since: number; seenAt: number
  /** Last visible production emissions by team (time of emission). */
  emissions: { team: Team; t: number; dataId: string }[]
}
export interface KnownSignal extends Signal { knownAt: number }
export interface Knowledge {
  team: Team; t: number
  units: SeenUnit[]
  nexus: SeenNexus[]
  events: SimEvent[]
  signals: KnownSignal[]
  score: { own: number; enemy: number; enemyAsOf: number }
  duration: number
  /** Worldline points (t ≤ seenAt) of every mobile unit: all light already received. */
  trails: Record<string, { t: number; x: number; z: number }[]>
  /** True only for the post-match full-information reveal. */
  omniscient?: boolean
}

function trail(sim: Sim, id: string, until: number) {
  const def = sim.unitDef(id)!
  const pts = [{ t: 0, ...def.at }]
  for (const l of sim.legs(id)) {
    if (l.start >= until) break
    pts.push({ t: l.start, ...l.from })
    const e = Math.min(l.end, until)
    pts.push({ t: e, ...positionAt(def.at, sim.legs(id), e) })
  }
  const last = positionAt(def.at, sim.legs(id), until)
  pts.push({ t: until, ...last })
  return pts
}

const visibleAt = (team: Team, e: { t: number; pos: Point }) => e.t + distance(e.pos, ORIGIN[team]) / C

/**
 * Projects the truth for one team. This is the only bridge from TruthState to
 * UI/AI during a live match. `t` may be ≤ sim.t (to replay past knowledge).
 */
export function knowledge(sim: Sim, team: Team, t = sim.t): Knowledge {
  const O = ORIGIN[team]
  const at = Math.min(t, sim.t)
  const units: SeenUnit[] = []
  for (const def of sim.roster) {
    if (def.kind === 'nexus') continue
    const legs = sim.legs(def.id)
    const seenAt = def.kind === 'origin' && def.team === team ? at : retardedTime(O, at, def.at, legs)
    const v = velocityAt(legs, seenAt)
    units.push({ id: def.id, kind: def.kind, team: def.team, pos: positionAt(def.at, legs, seenAt), seenAt,
      velocity: v, moving: Math.hypot(v.x, v.z) > EPS, readiness: sim.readinessAt(def.id, seenAt), tau: tauAt(legs, seenAt) })
  }
  const events = sim.log.filter(e => visibleAt(team, e) <= at + EPS)
  const nexus: SeenNexus[] = sim.roster.filter(u => u.kind === 'nexus').map(def => {
    const ctrl = [...events].reverse().find(e => e.kind === 'control' && e.nexusId === def.id)
    const emissions = events.filter(e => e.kind === 'data-emit' && e.nexusId === def.id)
      .map(e => ({ team: e.team as Team, t: e.t, dataId: e.dataId! }))
    return { id: def.id, pos: { ...def.at }, controller: (ctrl?.info?.controller as SeenNexus['controller']) ?? null,
      since: ctrl?.t ?? 0, seenAt: at - distance(def.at, O) / C, emissions }
  })
  const signals: KnownSignal[] = sim.signals
    .map(s => ({ ...s, knownAt: s.emit + distance(s.from, O) / C }))
    .filter(s => s.knownAt <= at + EPS)
    // the content (target) of enemy commands is not observable, only the flash
    .map(s => (s.kind === 'command' && s.team !== team ? { ...s, unitId: undefined, packetId: undefined } : s))
  const trails: Knowledge['trails'] = {}
  for (const u of units) if (u.kind !== 'origin') trails[u.id] = trail(sim, u.id, u.seenAt)
  const enemy = enemyOf(team)
  const enemyScores = events.filter(e => e.kind === 'score' && e.team === enemy)
  return {
    team, t: at, units, nexus, events, signals, duration: sim.def.duration, trails,
    score: { own: events.filter(e => e.kind === 'score' && e.team === team).length, enemy: enemyScores.length,
      enemyAsOf: at - distance(ORIGIN[enemy], O) / C },
  }
}

const VMAX = Math.max(...RULES.speeds)

/** Guaranteed lower bound (theorem, not estimate) on when one seen enemy courier can stand calibrated on `node`. */
export function earliestContest(u: SeenUnit, node: Point): number {
  const d = distance(u.pos, node)
  if (d < 1e-7 && !u.moving) return u.seenAt + (1 - u.readiness) * RULES.readyProper
  const arrive = u.seenAt + d / VMAX
  // Proper time never exceeds coordinate time. A unit at rest elsewhere must start
  // a new move (calibration resets); a moving unit needs at least its remaining calibration.
  const calibrate = u.moving ? u.seenAt + (1 - u.readiness) * RULES.readyProper : u.seenAt + RULES.readyProper
  return Math.max(arrive, calibrate)
}

/** CAUSAL LOCK for a node: no enemy courier can contest it before this time. */
export function causalLock(k: Knowledge, node: Point) {
  let best = Infinity, by: string | null = null
  for (const u of k.units) {
    if (u.team !== enemyOf(k.team) || u.kind !== 'courier') continue
    const t = earliestContest(u, node)
    if (t < best) { best = t; by = u.id }
  }
  return { t: best, by }
}

/** Radius of the region an enemy unit may occupy at time t (conservative outer bound). */
export const possibilityRadius = (u: SeenUnit, t: number) => Math.max(0, (t - u.seenAt) * VMAX)

/** Predicted next enemy production emissions at a nexus, assuming the observed rhythm continues. */
export function extrapolateProduction(n: SeenNexus, team: Team, until: number) {
  const own = n.emissions.filter(e => e.team === team)
  const last = own.at(-1)
  if (!last || n.controller !== team) return []
  const out: number[] = []
  for (let t = last.t + RULES.produce; t <= until; t += RULES.produce) out.push(t)
  return out
}

/** Post-match full information (both sides' truth), shaped like Knowledge for the renderer. */
export function omniscient(sim: Sim, t = sim.t): Knowledge {
  const at = Math.min(t, sim.t)
  const base = knowledge(sim, 'blue', at)
  const units = base.units.map(u => {
    const legs = sim.legs(u.id), def = sim.unitDef(u.id)!
    const v = velocityAt(legs, at)
    return { ...u, pos: positionAt(def.at, legs, at), seenAt: at, velocity: v, moving: Math.hypot(v.x, v.z) > EPS,
      readiness: sim.readinessAt(u.id, at), tau: tauAt(legs, at) }
  })
  const events = sim.log.filter(e => e.t <= at + EPS)
  const trails: Knowledge['trails'] = {}
  for (const u of units) if (u.kind !== 'origin') trails[u.id] = trail(sim, u.id, at)
  const nexus = base.nexus.map(n => {
    const ctrl = [...events].reverse().find(e => e.kind === 'control' && e.nexusId === n.id)
    return { ...n, controller: (ctrl?.info?.controller as SeenNexus['controller']) ?? null, since: ctrl?.t ?? 0, seenAt: at,
      emissions: events.filter(e => e.kind === 'data-emit' && e.nexusId === n.id).map(e => ({ team: e.team as Team, t: e.t, dataId: e.dataId! })) }
  })
  return { ...base, units, events, nexus, trails, omniscient: true,
    signals: sim.signals.filter(s => s.emit <= at + EPS).map(s => ({ ...s, knownAt: s.emit })),
    score: { own: events.filter(e => e.kind === 'score' && e.team === 'blue').length, enemy: events.filter(e => e.kind === 'score' && e.team === 'red').length, enemyAsOf: at } }
}
