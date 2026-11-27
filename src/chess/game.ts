// 光 — relativistic chess. Authoritative engine (truth) + per-side views.
// The only new physics: light travels one square (Chebyshev) per ply and is
// observed at the King. Everything the UI/AI sees comes from `view()`.

export type Side = 'w' | 'b'
export type Kind = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'
export interface PieceState { id: string; side: Side; kind: Kind; sq: number; alive: boolean }
export type Outcome = 'move' | 'capture' | 'intercept' | 'blocked' | 'miss'
export interface MoveRecord {
  ply: number            // 1-based ply produced by this move (state snaps[ply])
  side: Side; id: string; kind: Kind
  from: number; to: number; landed: number
  outcome: Outcome
  captured?: { id: string; kind: Kind; sq: number }
  /** The enemy piece touched by a blocked pawn (contact sighting). */
  blocker?: string
  promoted?: boolean
}
export interface SeenPiece extends PieceState {
  /** State index (ply) whose light we are seeing. */
  seenAt: number
  /** Enemy moves made since that state. */
  age: number
  via: 'light' | 'contact' | 'setup'
}
export interface View {
  side: Side; ply: number; toMove: Side
  own: PieceState[]
  enemy: SeenPiece[]
  king: number
  /** Own moves so far (own results are known instantly — command link). */
  history: MoveRecord[]
  capturedByMe: Kind[]; capturedFromMe: Kind[]
  winner: Side | 'draw' | null
}

export const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')
export const file = (sq: number) => sq & 7
export const rank = (sq: number) => sq >> 3
export const sqOf = (f: number, r: number) => r * 8 + f
export const dist = (a: number, b: number) => Math.max(Math.abs(file(a) - file(b)), Math.abs(rank(a) - rank(b)))
export const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8
export const sqName = (sq: number) => 'abcdefgh'[file(sq)] + (rank(sq) + 1)
export const parseSq = (s: string) => sqOf(s.charCodeAt(0) - 97, Number(s[1]) - 1)
export const VALUE: Record<Kind, number> = { P: 1, N: 3, B: 3.2, R: 5, Q: 9, K: 100 }
export const MAX_PLY = 200

const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
const KING = [...ROOK, ...BISHOP]
export const rays = (k: Kind) => (k === 'R' ? ROOK : k === 'B' ? BISHOP : k === 'Q' ? KING : [])
export const forward = (s: Side) => (s === 'w' ? 1 : -1)

export function standardSetup(): PieceState[] {
  const back: Kind[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
  const out: PieceState[] = []
  for (const side of ['w', 'b'] as Side[]) {
    const r0 = side === 'w' ? 0 : 7, r1 = side === 'w' ? 1 : 6
    back.forEach((k, f) => out.push({ id: side + k + 'abcdefgh'[f], side, kind: k, sq: sqOf(f, r0), alive: true }))
    for (let f = 0; f < 8; f++) out.push({ id: side + 'P' + 'abcdefgh'[f], side, kind: 'P', sq: sqOf(f, r1), alive: true })
  }
  return out
}
/** Compact setup: "wKe1 wRa1 bKh8 bPa4". Ids are unique per side+kind+square. */
export function setupFrom(spec: string): PieceState[] {
  return spec.trim().split(/\s+/).map(t => ({ id: t[0] + t[1] + t.slice(2), side: t[0] as Side, kind: t[1] as Kind, sq: parseSq(t.slice(2)), alive: true }))
}

/** Board occupancy for a list of states (alive only). */
export function occupancy(pieces: readonly PieceState[]) {
  const b: (PieceState | null)[] = Array(64).fill(null)
  for (const p of pieces) if (p.alive) b[p.sq] = p
  return b
}

/**
 * Candidate destinations for `p` judged on a belief board in which only
 * own pieces block selection. Sliders may aim past seen enemies (the truth decides).
 */
export function targets(p: PieceState, belief: (PieceState | null)[]): number[] {
  const out: number[] = []
  const f0 = file(p.sq), r0 = rank(p.sq)
  const own = (sq: number) => belief[sq]?.side === p.side
  if (p.kind === 'N' || p.kind === 'K') {
    for (const [df, dr] of p.kind === 'N' ? KNIGHT : KING) {
      const f = f0 + df, r = r0 + dr
      if (onBoard(f, r) && !own(sqOf(f, r))) out.push(sqOf(f, r))
    }
  } else if (p.kind === 'P') {
    const dr = forward(p.side), start = p.side === 'w' ? 1 : 6
    if (onBoard(f0, r0 + dr) && !own(sqOf(f0, r0 + dr))) {
      out.push(sqOf(f0, r0 + dr))
      if (r0 === start && !own(sqOf(f0, r0 + 2 * dr))) out.push(sqOf(f0, r0 + 2 * dr))
    }
    for (const df of [-1, 1]) if (onBoard(f0 + df, r0 + dr) && !own(sqOf(f0 + df, r0 + dr))) out.push(sqOf(f0 + df, r0 + dr))
  } else {
    for (const [df, dr] of rays(p.kind)) {
      for (let f = f0 + df, r = r0 + dr; onBoard(f, r); f += df, r += dr) {
        if (own(sqOf(f, r))) break
        out.push(sqOf(f, r))
      }
    }
  }
  return out
}

export class Game {
  readonly snaps: PieceState[][]
  readonly moves: MoveRecord[] = []
  readonly first: Side
  winner: Side | 'draw' | null = null
  #cache = new Map<string, View>()

  constructor(setup: PieceState[] = standardSetup(), first: Side = 'w') {
    this.snaps = [setup.map(p => ({ ...p }))]
    this.first = first
  }
  get ply() { return this.moves.length }
  get toMove(): Side { return this.ply % 2 === 0 ? this.first : other(this.first) }
  get state(): readonly PieceState[] { return this.snaps[this.ply] }
  sideOfPly(p: number): Side { return (p - 1) % 2 === 0 ? this.first : other(this.first) } // p = 1-based ply

  /** Play a move chosen on `side`'s own view. Throws if illegal from that view. */
  play(side: Side, from: number, to: number): MoveRecord {
    if (this.winner) throw new Error('game over')
    if (side !== this.toMove) throw new Error('not your turn')
    const v = this.view(side)
    const piece = v.own.find(p => p.sq === from)
    if (!piece) throw new Error('no own piece on ' + sqName(from))
    if (!targets(piece, beliefBoard(v)).includes(to)) throw new Error('illegal target ' + sqName(to))
    const next = this.state.map(p => ({ ...p }))
    const at = (sq: number) => next.find(p => p.alive && p.sq === sq)
    const me = next.find(p => p.id === piece.id)!
    const rec: MoveRecord = { ply: this.ply + 1, side, id: me.id, kind: me.kind, from, to, landed: from, outcome: 'move' }
    const capture = (victim: PieceState, sq: number, intercept: boolean) => {
      victim.alive = false
      me.sq = sq; rec.landed = sq; rec.outcome = intercept ? 'intercept' : 'capture'
      rec.captured = { id: victim.id, kind: victim.kind, sq }
    }
    if (me.kind === 'P') {
      const dr = forward(side)
      if (file(to) === file(from)) {
        const steps = Math.abs(rank(to) - rank(from))
        let blocker: PieceState | undefined
        for (let i = 1; i <= steps && !blocker; i++) blocker = at(from + 8 * dr * i)
        if (blocker) { rec.outcome = 'blocked'; if (blocker.side !== side) rec.blocker = blocker.id }
        else { me.sq = to; rec.landed = to }
      } else {
        const victim = at(to)
        if (victim && victim.side !== side) capture(victim, to, false)
        else rec.outcome = 'miss'
      }
    } else if (me.kind === 'N' || me.kind === 'K') {
      const victim = at(to)
      if (victim) capture(victim, to, false)
      else { me.sq = to; rec.landed = to }
    } else {
      const df = Math.sign(file(to) - file(from)), dr = Math.sign(rank(to) - rank(from))
      let sq = from, done = false
      while (sq !== to) {
        sq = sqOf(file(sq) + df, rank(sq) + dr)
        const occ = at(sq)
        if (occ) { capture(occ, sq, sq !== to); done = true; break }
      }
      if (!done) { me.sq = to; rec.landed = to }
    }
    if (me.kind === 'P' && rank(me.sq) === (side === 'w' ? 7 : 0)) { me.kind = 'Q'; rec.promoted = true }
    this.snaps.push(next)
    this.moves.push(rec)
    this.#cache.clear()
    if (rec.captured?.kind === 'K') this.winner = side
    else if (this.ply >= MAX_PLY || next.filter(p => p.alive).every(p => p.kind === 'K')) this.winner = 'draw'
    return rec
  }

  /** Light + contact knowledge of `side` after the current ply (or at an earlier ply `T`). */
  view(side: Side, T = this.ply): View {
    const key = side + T
    const hit = this.#cache.get(key)
    if (hit) return hit
    const kingPath = this.snaps.slice(0, T + 1).map(s => s.find(p => p.side === side && p.kind === 'K')!.sq)
    const v = observe(this, side, T, kingPath)
    this.#cache.set(key, v)
    return v
  }

  /** What `side`'s enemy most likely sees of `side` now, using the enemy King trail `side` knows. */
  afterimage(side: Side, T = this.ply): SeenPiece[] {
    const mine = this.view(side, T)
    const enemy = other(side)
    // Enemy King trajectory as far as `side` knows it: true up to its last sighting, then frozen.
    const k = mine.enemy.find(p => p.kind === 'K')
    const trail: number[] = []
    for (let n = 0; n <= T; n++) {
      const s = n <= (k?.seenAt ?? 0) ? this.snaps[n].find(p => p.side === enemy && p.kind === 'K')!.sq : (k?.sq ?? 0)
      trail.push(s)
    }
    return observe(this, enemy, T, trail).enemy
  }
}

export function beliefBoard(v: View) {
  return occupancy([...v.own, ...v.enemy.filter(p => p.alive)])
}

function observe(g: Game, side: Side, T: number, kingPath: number[]): View {
  const enemy = other(side)
  const state = g.snaps[T]
  const own = state.filter(p => p.side === side && p.alive).map(p => ({ ...p }))
  const posAt = (id: string, t: number) => g.snaps[t].find(p => p.id === id)!
  const lastSeen = new Map<string, { t: number; via: SeenPiece['via'] }>()
  for (const p of g.snaps[0]) if (p.side === enemy) lastSeen.set(p.id, { t: 0, via: 'setup' })
  // light: observation at time n+1 from the King's square during ply interval n
  for (let n = 0; n <= T; n++) {
    const k = kingPath[n]
    for (const [id, cur] of lastSeen) {
      for (let t = n; t >= Math.max(0, n - 8); t--) {
        if (t <= cur.t && cur.via !== 'setup') break
        const s = posAt(id, t)
        if (n + 1 - t >= dist(s.sq, k)) { if (t > cur.t || cur.via === 'setup') lastSeen.set(id, { t, via: 'light' }); break }
      }
    }
  }
  // contact: pieces that touched ours are seen at that instant
  for (const m of g.moves.slice(0, T)) {
    const touch = (id: string) => { const c = lastSeen.get(id); if (c && m.ply >= c.t) lastSeen.set(id, { t: m.ply, via: 'contact' }) }
    if (m.side === side) { if (m.captured) touch(m.captured.id); if (m.blocker) touch(m.blocker) }
    else if (m.captured) touch(m.id)
  }
  const enemyPlies = (t: number) => { let n = 0; for (let p = t + 1; p <= T; p++) if (g.sideOfPly(p) === enemy) n++; return n }
  const seen: SeenPiece[] = [...lastSeen].map(([id, s]) => ({ ...posAt(id, s.t), seenAt: s.t, age: enemyPlies(s.t), via: s.via }))
  const mine = g.moves.slice(0, T).filter(m => m.side === side)
  return {
    side, ply: T, toMove: T % 2 === 0 ? g.first : other(g.first), own, enemy: seen,
    king: kingPath[T], history: mine,
    capturedByMe: mine.flatMap(m => (m.captured ? [m.captured.kind] : [])),
    capturedFromMe: g.moves.slice(0, T).filter(m => m.side === enemy && m.captured).map(m => m.captured!.kind),
    winner: T === g.ply ? g.winner : null,
  }
}
