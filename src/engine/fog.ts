// 光 mode: 衝 physics + light-delayed sight.
// Light travels one square (Chebyshev) per ply and is observed at the King.
// You pick moves on the board you SEE; they resolve on the board that IS.
// No check rules (check may be invisible) — removing the enemy King wins.
import { cheb, clone, file, kingSq, make, other, pseudo, rank, sq, type Move, type Outcome, type Piece, type Pos, type Side } from './rules.ts'

export interface Sighting { piece: Piece; sq: number; alive: boolean; seenAt: number; age: number }

/**
 * What `side` knows about the enemy after `history.length - 1` plies.
 * history[t] = position after t plies; outcomes[t] = outcome of ply t+1 (null for a wasted turn).
 */
export function sightings(history: readonly Pos[], outcomes: readonly (Outcome | null)[], side: Side): Sighting[] {
  const T = history.length - 1
  const enemy = other(side)
  // square of every enemy piece at every ply (last known square once it has left the board)
  const track = new Map<string, { sq: number[]; alive: boolean[]; piece: Piece[] }>()
  for (const p of history[0].board) if (p?.side === enemy) track.set(p.id, { sq: [], alive: [], piece: [] })
  history.forEach((h, t) => {
    const here = new Map<string, number>()
    h.board.forEach((p, s) => { if (p && track.has(p.id)) here.set(p.id, s) })
    for (const [id, tr] of track) {
      const s = here.get(id)
      tr.sq[t] = s ?? tr.sq[t - 1] ?? -1; tr.alive[t] = s !== undefined
      tr.piece[t] = s !== undefined ? h.board[s]! : tr.piece[t - 1]
    }
  })
  const kings = history.map(h => kingSq(h, side))
  const out: Sighting[] = []
  for (const [id, tr] of track) {
    let best = 0
    for (let n = 0; n <= T; n++) {
      const k = kings[n]; if (k < 0) continue
      for (let t = n; t >= Math.max(best, n - 8); t--) {
        if (tr.sq[t] >= 0 && n + 1 - t >= cheb(tr.sq[t], k)) { best = Math.max(best, t); break }
      }
    }
    // contact: whatever collided with our pieces (or was struck by them) is seen at that instant
    outcomes.forEach((o, i) => {
      if (!o) return
      const before = history[i].board
      const mover = before[o.move.from]
      const touched = o.clash ? [...o.clash.moved.keys()] : o.stomp ? [o.stomp.victim.id] : []
      const ours = mover?.side === side || touched.some(t => before.find(p => p?.id === t)?.side === side)
      if (ours && (touched.includes(id) || mover?.id === id)) best = Math.max(best, i + 1)
    })
    let age = 0
    for (let p = best + 1; p <= T; p++) if (history[p - 1].turn === enemy) age++
    out.push({ piece: { ...tr.piece[best] }, sq: tr.sq[best], alive: tr.alive[best], seenAt: best, age })
  }
  return out
}

/** The board as `side` believes it: own pieces true, enemies at their last sighting. */
export function belief(truth: Pos, seen: readonly Sighting[], side: Side): Pos {
  const b = clone(truth)
  b.board = truth.board.map(p => (p?.side === side ? p : null))
  for (const s of seen) if (s.alive && s.sq >= 0 && !b.board[s.sq]) b.board[s.sq] = s.piece
  b.ep = -1
  return b
}

/** Intended moves chosen on the belief board (no check filter: you cannot know). */
export function intentions(bel: Pos): Move[] {
  return pseudo(bel).filter(m => !(m.flag === 'c' && m.promo && m.promo !== 'q'))
}

export type Resolution = { kind: 'move'; move: Move } | { kind: 'blocked' | 'miss'; from: number; to: number }

/** Turn an intention into what really happens on the true board. */
export function resolve(truth: Pos, intent: Move): Resolution {
  const b = truth.board, me = truth.turn, p = b[intent.from]!
  const enemyAt = (s: number) => !!b[s] && b[s]!.side !== me
  const base = (to: number, flag: Move['flag']): Move => ({ from: intent.from, to, kind: p.kind, flag, ...(intent.promo ? { promo: intent.promo } : {}) })
  if (intent.flag === 'k' || intent.flag === 'q') {
    const step = intent.flag === 'k' ? 1 : -1
    for (let s = intent.from + step; s !== (intent.flag === 'k' ? intent.from + 3 : intent.from - 4); s += step) if (b[s]) return { kind: 'blocked', from: intent.from, to: intent.to }
    return { kind: 'move', move: intent }
  }
  if (p.kind === 'n' || p.kind === 'k') return { kind: 'move', move: base(intent.to, enemyAt(intent.to) ? 'c' : 'n') }
  if (p.kind === 'p') {
    if (file(intent.to) === file(intent.from)) {
      const dir = me === 'w' ? 8 : -8
      for (let s = intent.from + dir; ; s += dir) { if (b[s]) return { kind: 'blocked', from: intent.from, to: intent.to }; if (s === intent.to) break }
      return { kind: 'move', move: base(intent.to, Math.abs(intent.to - intent.from) === 16 ? 'd' : 'n') }
    }
    return enemyAt(intent.to) ? { kind: 'move', move: base(intent.to, 'c') } : { kind: 'miss', from: intent.from, to: intent.to }
  }
  // sliders stop at the first real piece on the path
  const df = Math.sign(file(intent.to) - file(intent.from)), dr = Math.sign(rank(intent.to) - rank(intent.from))
  for (let f = file(intent.from) + df, r = rank(intent.from) + dr; ; f += df, r += dr) {
    const s = sq(f, r)
    if (b[s]) return b[s]!.side === me ? { kind: 'move', move: base(s - (dr * 8 + df), 'n') } : { kind: 'move', move: base(s, 'c') }
    if (s === intent.to) return { kind: 'move', move: base(s, 'n') }
  }
}

/** Apply a resolution: a real move, or a wasted turn (the board only knows the clock moved). */
export function apply(truth: Pos, r: Resolution) {
  if (r.kind === 'move') {
    if (r.move.from === r.move.to) { const pos = clone(truth); pos.turn = other(truth.turn); pos.half++; if (truth.turn === 'b') pos.full++; return { pos, out: null } }
    return make(truth, r.move, 'clash')
  }
  const pos = clone(truth); pos.turn = other(truth.turn); pos.ep = -1; pos.half++; if (truth.turn === 'b') pos.full++
  return { pos, out: null }
}
