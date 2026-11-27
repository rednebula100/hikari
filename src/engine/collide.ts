// One-dimensional relativistic elastic collisions on a line of squares,
// simulated exactly (event-driven) for one turn. c is in squares per turn.

export const C = 8

export interface Body { id: string; mass: number; s: number; v: number }
export interface Track { id: string; keys: { t: number; s: number; v: number }[]; exit?: { t: number; side: -1 | 1; v: number } }
export interface Contact { t: number; s: number; a: string; b: string; before: [number, number]; after: [number, number] }
export interface LineResult {
  tracks: Track[]
  contacts: Contact[]
  final: Map<string, number | null> // rounded square index on the line, or null if it left the board
  /** Totals for conservation checks (relativistic momentum / energy, c = C). */
  p0: number; p1: number; e0: number; e1: number
}

export const gamma = (v: number, c = C) => 1 / Math.sqrt(1 - (v / c) ** 2)
export const momentum = (m: number, v: number, c = C) => gamma(v, c) * m * v
export const energy = (m: number, v: number, c = C) => gamma(v, c) * m * c * c

/** Exact 1D elastic collision. Relativistic by default; `newton` for the classical limit. */
export function collide(m1: number, v1: number, m2: number, v2: number, c = C, newton = false): [number, number] {
  if (newton) {
    return [((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2), ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2)]
  }
  const E = energy(m1, v1, c) + energy(m2, v2, c), p = momentum(m1, v1, c) + momentum(m2, v2, c)
  const u = p * c * c / E // centre-of-momentum frame velocity
  const to = (x: number) => (x - u) / (1 - x * u / (c * c)), back = (w: number) => (w + u) / (1 + w * u / (c * c))
  return [back(-to(v1)), back(-to(v2))]
}

/**
 * Simulate unit-length bodies on squares 0..n-1 (edges at -0.5 and n-0.5) for `T` turns.
 * Bodies never overlap; contact = centres one square apart and approaching.
 */
export function simulateLine(bodies: Body[], n: number, T = 1, opts: { c?: number; newton?: boolean } = {}): LineResult {
  const c = opts.c ?? C
  const live = bodies.map(b => ({ ...b })).sort((a, b) => a.s - b.s)
  const tracks = new Map<string, Track>(live.map(b => [b.id, { id: b.id, keys: [{ t: 0, s: b.s, v: b.v }] }]))
  const contacts: Contact[] = []
  const tot = (xs: Body[]) => xs.reduce((a, b) => ({ p: a.p + momentum(b.mass, b.v, c), e: a.e + energy(b.mass, b.v, c) }), { p: 0, e: 0 })
  const start = tot(live)
  let t = 0
  for (let guard = 0; guard < 2000; guard++) {
    let best = T - t, kind: 'contact' | 'exit' | null = null, idx = -1
    for (let i = 0; i + 1 < live.length; i++) {
      const a = live[i], b = live[i + 1], dv = a.v - b.v
      if (dv <= 1e-12) continue
      const dt = Math.max(0, (b.s - a.s - 1) / dv)
      if (dt < best - 1e-12 || (kind === null && dt <= best)) { best = dt; kind = 'contact'; idx = i }
    }
    for (let i = 0; i < live.length; i++) {
      const b = live[i]
      const dt = b.v > 1e-12 ? (n - 0.5 - b.s) / b.v : b.v < -1e-12 ? (b.s + 0.5) / -b.v : Infinity
      if (dt < best - 1e-12) { best = Math.max(0, dt); kind = 'exit'; idx = i }
    }
    for (const b of live) b.s += b.v * best
    t += best
    if (!kind) break
    if (kind === 'contact') {
      const a = live[idx], b = live[idx + 1]
      b.s = a.s + 1 // exact contact (kill float drift)
      const before: [number, number] = [a.v, b.v]
      const [va, vb] = collide(a.mass, a.v, b.mass, b.v, c, opts.newton)
      a.v = va; b.v = vb
      contacts.push({ t, s: a.s + 0.5, a: a.id, b: b.id, before, after: [va, vb] })
      tracks.get(a.id)!.keys.push({ t, s: a.s, v: va })
      tracks.get(b.id)!.keys.push({ t, s: b.s, v: vb })
    } else {
      const b = live[idx]
      const tr = tracks.get(b.id)!
      tr.keys.push({ t, s: b.s, v: b.v })
      tr.exit = { t, side: b.v > 0 ? 1 : -1, v: b.v }
      live.splice(idx, 1)
    }
  }
  const final = new Map<string, number | null>()
  for (const b of bodies) final.set(b.id, null)
  for (const b of live) { tracks.get(b.id)!.keys.push({ t: T, s: b.s, v: b.v }); final.set(b.id, Math.min(n - 1, Math.max(0, Math.round(b.s)))) }
  const end = tot(live)
  const exited = [...tracks.values()].filter(tr => tr.exit).map(tr => ({ m: bodies.find(b => b.id === tr.id)!.mass, v: tr.exit!.v }))
  const p1 = end.p + exited.reduce((a, x) => a + momentum(x.m, x.v, c), 0)
  const e1 = end.e + exited.reduce((a, x) => a + energy(x.m, x.v, c), 0)
  return { tracks: [...tracks.values()], contacts, final, p0: start.p, p1, e0: start.e, e1 }
}
