// Pure special-relativity and wave helpers shared by the authoritative
// simulation, the knowledge projection, the AI and the renderer.
// Units: c = 1 GU/s. Space is 2D (x, z); time is coordinate time of the
// common rest frame of both ORIGIN cores.

export interface Point { x: number; z: number }
export interface TimedPoint extends Point { t: number }
/** Constant-velocity worldline segment. Rest is implicit between legs. */
export interface Leg { start: number; end: number; from: Point; to: Point }

export const C = 1
export const EPS = 1e-9
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
export const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.z - b.z) < 1e-7
export const timeKey = (time: number) => Math.round(time * 1e6)
export const properDuration = (dt: number, speed: number) => dt * Math.sqrt(1 - (speed / C) ** 2)
export const causal = (a: TimedPoint, b: TimedPoint) => b.t >= a.t && distance(a, b) <= C * (b.t - a.t) + 1e-10
export const interval2 = (a: TimedPoint, b: TimedPoint) => C * C * (b.t - a.t) ** 2 - distance(a, b) ** 2

export function positionAt(initial: Point, legs: readonly Leg[], time: number): Point {
  let position = initial
  for (const leg of legs) {
    if (time <= leg.start) break
    if (time < leg.end) {
      const u = (time - leg.start) / (leg.end - leg.start)
      return { x: leg.from.x + (leg.to.x - leg.from.x) * u, z: leg.from.z + (leg.to.z - leg.from.z) * u }
    }
    position = leg.to
  }
  return { x: position.x, z: position.z }
}

export function velocityAt(legs: readonly Leg[], time: number): Point {
  for (const leg of legs) {
    if (time >= leg.start && time < leg.end) {
      const dt = leg.end - leg.start
      return { x: (leg.to.x - leg.from.x) / dt, z: (leg.to.z - leg.from.z) / dt }
    }
  }
  return { x: 0, z: 0 }
}

/** Proper time accumulated since t=0 (every unit starts with τ=0 at t=0). */
export function tauAt(legs: readonly Leg[], time: number): number {
  let tau = time
  for (const leg of legs) {
    const duration = Math.min(time, leg.end) - leg.start
    if (duration <= 0) break
    const speed = distance(leg.from, leg.to) / (leg.end - leg.start)
    tau += properDuration(duration, speed) - duration
  }
  return tau
}

// Over a subluminal worldline the unsquared residual is strictly decreasing.
// Each moving segment contributes at most one future null intersection.
/** Earliest time a light signal emitted at (source, emit) meets the worldline. */
export function intercept(source: Point, emit: number, initial: Point, legs: readonly Leg[]): number {
  let cursor = emit
  for (const leg of legs) {
    if (leg.end <= cursor) continue
    if (leg.start >= cursor) {
      const atRest = emit + distance(source, leg.from) / C
      if (atRest <= leg.start) return atRest
      cursor = leg.start
    }
    const here = positionAt(initial, legs, cursor)
    const vx = (leg.to.x - leg.from.x) / (leg.end - leg.start)
    const vz = (leg.to.z - leg.from.z) / (leg.end - leg.start)
    const qx = here.x - source.x, qz = here.z - source.z, age = cursor - emit
    const a = C * C - vx * vx - vz * vz
    const b = C * C * age - qx * vx - qz * vz
    const c = C * C * age * age - qx * qx - qz * qz
    const root = Math.sqrt(Math.max(0, b * b - a * c))
    const dt = b > 0 ? -c / (root + b) : (root - b) / a
    if (dt >= -1e-10 && cursor + dt <= leg.end + 1e-10) return Math.min(leg.end, cursor + Math.max(0, dt))
    cursor = leg.end
  }
  return emit + distance(source, legs.at(-1)?.to ?? initial) / C
}

/**
 * Retarded time: the emission time s of the light from this worldline that
 * reaches `observer` exactly at time t, i.e. s + |r(s) - observer| / c = t.
 * Returns 0 when no light emitted after t=0 has arrived yet (the initial
 * deployment is public common knowledge).
 */
export function retardedTime(observer: Point, t: number, initial: Point, legs: readonly Leg[]): number {
  const f = (s: number) => s + distance(positionAt(initial, legs, s), observer) / C
  if (t <= f(0)) return 0
  let lo = 0, hi = t
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) <= t) lo = mid
    else hi = mid
  }
  return lo
}

// ── Waves ────────────────────────────────────────────────────────────────
export interface Pulse { position: Point; emit: number; duration: number; amplitude: number; phase: number }
export const OMEGA = 2 * Math.PI
export const attenuation = (d: number) => 1 / (1 + d / 2)

export function waveAt(p: Point, t: number, pulses: readonly Pulse[]): number {
  let sum = 0
  for (const pulse of pulses) {
    const d = distance(p, pulse.position)
    const q = t - pulse.emit - d / C
    if (q >= 0 && q < pulse.duration) sum += pulse.amplitude * attenuation(d) * Math.cos(OMEGA * q + pulse.phase)
  }
  return sum
}

/** Complex amplitude of a pulse at a stationary receiver on the common carrier e^{iωt}. */
export function phasor(p: Point, pulse: Pulse) {
  const d = distance(p, pulse.position)
  const start = pulse.emit + d / C
  const angle = pulse.phase - OMEGA * start
  const amplitude = pulse.amplitude * attenuation(d)
  return { start, end: start + pulse.duration, amplitude, angle, re: amplitude * Math.cos(angle), im: amplitude * Math.sin(angle) }
}

// First pulse is the desired pilot. Callers supply only same-channel,
// same-receiver interfering pulses. Rectangle envelopes admit exact integration.
export function pilotRatio(p: Point, pulses: readonly Pulse[]): number {
  const received = pulses.map(pulse => phasor(p, pulse))
  const desired = received[0]
  if (!desired || desired.amplitude <= 0 || desired.end <= desired.start) throw new RangeError('Missing data pilot')
  const bounds = [...new Set(received.flatMap(v => [v.start, v.end]).filter(t => t >= desired.start && t <= desired.end))].sort((a, b) => a - b)
  let integral = 0
  for (let i = 1; i < bounds.length; i++) {
    let re = 0, im = 0
    for (const pulse of received) {
      if (pulse.start <= bounds[i - 1] && bounds[i - 1] < pulse.end) { re += pulse.re; im += pulse.im }
    }
    integral += Math.hypot(re, im) * (bounds[i] - bounds[i - 1])
  }
  return integral / ((desired.end - desired.start) * desired.amplitude)
}

// LAB demo pulses kept for the physics regression tests (spec §12.8).
export const WAVE_RECEIVER = Object.freeze({ x: 4, z: 4 })
export function wavePulses(phaseDegrees: number): Pulse[] {
  return [
    { position: { x: 0, z: 4 }, emit: 0, duration: 0.5, amplitude: 1, phase: 0 },
    { position: { x: 6, z: 4 }, emit: 2, duration: 1, amplitude: 2 / 3, phase: phaseDegrees * Math.PI / 180 },
  ]
}
