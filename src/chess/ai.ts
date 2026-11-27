// Opponent that plays only from its own View: enemy pieces sit where it last
// saw them (a belief board). It never reads the truth.
import { VALUE, beliefBoard, dist, file, forward, onBoard, other, rank, rays, sqOf, targets, type Kind, type Side, type View } from './game.ts'

export type Level = 1 | 2 | 3
export const LEVEL_NAME: Record<Level, string> = { 1: '쉬움', 2: '보통', 3: '어려움' }

type Cell = { side: Side; kind: Kind } | null
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/** Perfect-information pseudo moves on a belief board (sliders stop at first piece). */
function gen(b: Cell[], side: Side): [number, number][] {
  const out: [number, number][] = []
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq]; if (!p || p.side !== side) continue
    const f0 = file(sq), r0 = rank(sq)
    const push = (f: number, r: number) => { if (onBoard(f, r) && b[sqOf(f, r)]?.side !== side) out.push([sq, sqOf(f, r)]) }
    if (p.kind === 'N') KN.forEach(([a, c]) => push(f0 + a, r0 + c))
    else if (p.kind === 'K') KG.forEach(([a, c]) => push(f0 + a, r0 + c))
    else if (p.kind === 'P') {
      const dr = forward(side)
      if (onBoard(f0, r0 + dr) && !b[sqOf(f0, r0 + dr)]) {
        out.push([sq, sqOf(f0, r0 + dr)])
        if (r0 === (side === 'w' ? 1 : 6) && !b[sqOf(f0, r0 + 2 * dr)]) out.push([sq, sqOf(f0, r0 + 2 * dr)])
      }
      for (const df of [-1, 1]) { const f = f0 + df, r = r0 + dr; if (onBoard(f, r) && b[sqOf(f, r)] && b[sqOf(f, r)]!.side !== side) out.push([sq, sqOf(f, r)]) }
    } else {
      for (const [df, dr] of rays(p.kind)) for (let f = f0 + df, r = r0 + dr; onBoard(f, r); f += df, r += dr) {
        const c = b[sqOf(f, r)]
        if (c?.side === side) break
        out.push([sq, sqOf(f, r)])
        if (c) break
      }
    }
  }
  return out
}
function apply(b: Cell[], [from, to]: [number, number]): Cell[] {
  const n = b.slice(), p = n[from]!
  n[to] = p.kind === 'P' && (rank(to) === 7 || rank(to) === 0) ? { side: p.side, kind: 'Q' } : p
  n[from] = null
  return n
}
const CENTER = (sq: number) => 3.5 - Math.max(Math.abs(file(sq) - 3.5), Math.abs(rank(sq) - 3.5))
function evaluate(b: Cell[], side: Side): number {
  let s = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq]; if (!p) continue
    let v = VALUE[p.kind]
    if (p.kind === 'N' || p.kind === 'B') v += 0.08 * CENTER(sq)
    if (p.kind === 'P') v += 0.06 * (p.side === 'w' ? rank(sq) - 1 : 6 - rank(sq))
    if (p.kind === 'K') v -= 0.05 * CENTER(sq) // kings prefer cover…
    s += p.side === side ? v : -v
  }
  return s
}
function search(b: Cell[], side: Side, depth: number, alpha: number, beta: number): number {
  const kings = b.filter(c => c?.kind === 'K')
  if (!kings.some(k => k!.side === side)) return -1000 - depth
  if (!kings.some(k => k!.side !== side)) return 1000 + depth
  if (depth === 0) return evaluate(b, side)
  const moves = gen(b, side)
  if (!moves.length) return evaluate(b, side)
  moves.sort((x, y) => (b[y[1]] ? VALUE[b[y[1]]!.kind] : 0) - (b[x[1]] ? VALUE[b[x[1]]!.kind] : 0))
  let best = -Infinity
  for (const m of moves) {
    const v = -search(apply(b, m), other(side), depth - 1, -beta, -alpha)
    if (v > best) best = v
    if (v > alpha) alpha = v
    if (alpha >= beta) break
  }
  return best
}

/** Squares attacked by the piece standing on `o` (pawns: diagonals regardless of occupancy). */
function attacks(b: Cell[], o: number): number[] {
  const p = b[o]!
  if (p.kind === 'P') return [-1, 1].map(df => [file(o) + df, rank(o) + forward(p.side)]).filter(([f, r]) => onBoard(f, r)).map(([f, r]) => sqOf(f, r))
  return gen(b, p.side).filter(([from]) => from === o).map(([, to]) => to)
}
/** Squares a stale enemy piece could attack after up to one unseen move (conservative fog risk). */
function fogThreats(v: View, b: Cell[]): Set<number> {
  const risk = new Set<number>()
  for (const e of v.enemy) {
    if (!e.alive || e.age < 1) continue
    const cell = b[e.sq]; if (!cell) continue
    const origins = [e.sq, ...gen(b, cell.side).filter(([from]) => from === e.sq).map(([, to]) => to)]
    for (const o of origins) {
      const tmp = b.slice(); tmp[e.sq] = null; tmp[o] = cell
      for (const sq of attacks(tmp, o)) risk.add(sq)
    }
  }
  return risk
}

export function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function chooseMove(v: View, level: Level, random: () => number): { from: number; to: number } | null {
  const b: Cell[] = beliefBoard(v).map(p => (p ? { side: p.side, kind: p.kind } : null))
  const moves = gen(b, v.side)
  // the real game also allows blind pawn diagonals and shots past seen pieces — keep the
  // belief-legal subset (the engine will accept them: they are a subset of View targets)
  if (!moves.length) {
    const own = v.own.find(p => targets(p, beliefBoard(v)).length)
    return own ? { from: own.sq, to: targets(own, beliefBoard(v))[0] } : null
  }
  const depth = level === 1 ? 1 : level === 2 ? 2 : 3
  const fog = level >= 2 ? fogThreats(v, b) : new Set<number>()
  const enemyKing = v.enemy.find(e => e.kind === 'K' && e.alive)
  let best: { m: [number, number]; s: number } | null = null
  for (const m of moves) {
    let s = -search(apply(b, m), other(v.side), depth - 1, -Infinity, Infinity)
    const mover = b[m[0]]!
    // a capture of a stale image is a bet: the target may have moved away
    const victim = v.enemy.find(e => e.alive && e.sq === m[1])
    if (level >= 2 && victim && victim.age > 0) {
      const gone = Math.min(.9, (victim.kind === 'K' ? .45 : .3) * victim.age)
      const empty = b.slice(); empty[m[1]] = null
      let ifGone = -search(apply(empty, m), other(v.side), depth - 1, -Infinity, Infinity)
      if (fog.has(m[1])) ifGone -= .6 * VALUE[mover.kind]
      s = (1 - gone) * s + gone * ifGone
    }
    if (fog.has(m[1]) && mover.kind !== 'K') s -= 0.35 * VALUE[mover.kind] // could be walking into an unseen attack
    if (mover.kind === 'K' && fog.has(m[1])) s -= 4
    if (level >= 3 && mover.kind === 'K' && enemyKing) {
      // king = eye: modest value for seeing more, never at the cost of safety
      const before = dist(m[0], enemyKing.sq), after = dist(m[1], enemyKing.sq)
      if (!fog.has(m[1]) && after < before && after >= 4) s += 0.15
    }
    s += (random() - 0.5) * (level === 1 ? 1.6 : level === 2 ? 0.25 : 0.08)
    if (!best || s > best.s) best = { m, s }
  }
  return { from: best!.m[0], to: best!.m[1] }
}
