// Alpha-beta opponent for classic chess and 衝. Internally it searches
// pseudo-legal moves and treats "own King removed" as a loss (king-capture search),
// which is equivalent to legality for search purposes and much cheaper.
import { MASS, file, kingSq, legal, make, other, pseudo, rank, toFen, type Mode, type Move, type Pos, type Side } from './rules.ts'

export type Level = 1 | 2 | 3
export const LEVEL_NAME: Record<Level, string> = { 1: '쉬움', 2: '보통', 3: '어려움' }
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 }
const WIN = 10000

export function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const centre = (s: number) => 3.5 - Math.max(Math.abs(file(s) - 3.5), Math.abs(rank(s) - 3.5)) // 0 edge … 3 centre
function evaluate(p: Pos, side: Side, mode: Mode): number {
  let v = 0
  for (let s = 0; s < 64; s++) {
    const x = p.board[s]; if (!x) continue
    let w = VALUE[x.kind]
    if (x.kind === 'n' || x.kind === 'b') w += 0.07 * centre(s)
    if (x.kind === 'p') w += 0.05 * (x.side === 'w' ? rank(s) - 1 : 6 - rank(s))
    if (x.kind === 'k') w += mode === 'clash' ? 0.25 * centre(s) - (centre(s) === 0 ? 0.6 : 0) : -0.04 * centre(s)
    if (mode === 'clash' && x.kind !== 'k' && centre(s) === 0) w -= 0.04 * MASS[x.kind] // edges are cliffs
    v += x.side === side ? w : -w
  }
  return v
}

function order(p: Pos, ms: Move[]) {
  const score = (m: Move) => (m.flag === 'c' ? 10 + VALUE[p.board[m.to]?.kind ?? 'p'] - VALUE[m.kind] / 10 : 0) + (m.promo === 'q' ? 8 : 0)
  return ms.sort((a, b) => score(b) - score(a))
}

function search(p: Pos, depth: number, alpha: number, beta: number, mode: Mode): number {
  const me = p.turn
  if (depth === 0) return evaluate(p, me, mode)
  const ms = order(p, pseudo(p, mode).filter(m => !(mode === 'clash' && m.flag === 'c' && m.promo && m.promo !== 'q')))
  let best = -Infinity, any = false
  for (const m of ms) {
    const r = make(p, m, mode)
    if (kingSq(r.pos, me) < 0) continue // illegal (or suicidal chain)
    any = true
    const v = kingSq(r.pos, other(me)) < 0 ? WIN + depth : -search(r.pos, depth - 1, -beta, -alpha, mode)
    if (v > best) best = v
    if (v > alpha) alpha = v
    if (alpha >= beta) break
  }
  if (!any) return -WIN / 2 // no move keeps the king: treat as lost
  return best
}

export function choose(p: Pos, mode: Mode, level: Level, random: () => number, history: readonly string[] = []): Move | null {
  const ms = legal(p, mode)
  if (!ms.length) return null
  const depth = level === 1 ? 1 : level === 2 ? 2 : 3
  const noise = level === 1 ? 1.2 : level === 2 ? 0.15 : 0.04
  let best: Move | null = null, bestV = -Infinity
  for (const m of order(p, ms)) {
    const r = make(p, m, mode)
    let v = (kingSq(r.pos, other(p.turn)) < 0 ? WIN : -search(r.pos, depth - 1, -Infinity, Infinity, mode)) + (random() - 0.5) * noise
    // when not losing, steer away from repeating positions (and from the 50-move wall)
    const seen = history.filter(h => h === toFen(r.pos, false)).length
    if (seen && v > -0.5) v -= 0.6 * seen
    if (r.pos.half > 60 && v > 1) v -= (r.pos.half - 60) * 0.02
    if (v > bestV) { bestV = v; best = m }
  }
  return best
}
