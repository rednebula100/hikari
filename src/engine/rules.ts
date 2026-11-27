// FIDE chess rules with a pluggable capture model.
//   'classic' — orthodox chess (verified against chess.js by perft/oracle tests)
//   'clash'   — 衝: captures become relativistic 1D collisions; knights stomp; off-board = removed.
import { runSpeed, runSpeedNewton, simulateLine, type LineResult } from './collide.ts'

export type Side = 'w' | 'b'
export type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type Mode = 'classic' | 'clash'
export interface Piece { id: string; side: Side; kind: Kind }
export interface Castling { K: boolean; Q: boolean; k: boolean; q: boolean }
export interface Pos {
  board: (Piece | null)[]
  turn: Side
  castling: Castling
  ep: number // en-passant target square or -1
  half: number
  full: number
}
export type Flag = 'n' | 'c' | 'e' | 'k' | 'q' | 'd'
/** `via`: the edge square where a bishop's cushion shot reflects (衝 only). */
export interface Move { from: number; to: number; kind: Kind; flag: Flag; promo?: Kind; via?: number }
export interface Clash {
  line: number[] // board squares along the collision axis, in axis order
  attacker: string
  speed: number
  run: number
  sim: LineResult
  /** pawns that stood firmer thanks to a neighbour beside them (phalanx) */
  phalanx: string[]
  /** piece id → [from square, final square or null if it left the board] */
  moved: Map<string, [number, number | null]>
}
export interface Outcome {
  move: Move
  removed: Piece[]
  stomp?: { square: number; victim: Piece }
  /** a knight's landing shockwave: who was pushed where (null = off the board) */
  shock?: { id: string; from: number; to: number | null }[]
  clash?: Clash
  promoted?: Kind
}

export const MASS: Record<Kind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 10 }
/** 衝 abilities: the heaviest piece a knight can crush, and the heaviest its landing shock can shift. */
export const STOMP_MAX = 3, SHOCK_MAX = 5
/** Direction of travel at the target (after a cushion reflection if any). */
export function moveDir(m: Move): [number, number] {
  const a = m.via ?? m.from
  return [Math.sign(file(m.to) - file(a)), Math.sign(rank(m.to) - rank(a))]
}
export const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')
export const file = (sq: number) => sq & 7
export const rank = (sq: number) => sq >> 3
export const sq = (f: number, r: number) => r * 8 + f
export const on = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8
export const cheb = (a: number, b: number) => Math.max(Math.abs(file(a) - file(b)), Math.abs(rank(a) - rank(b)))
export const name = (s: number) => 'abcdefgh'[file(s)] + (rank(s) + 1)
export const parse = (s: string) => sq(s.charCodeAt(0) - 97, Number(s[1]) - 1)
export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const N_STEPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
const K_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const R_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const B_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

// ── FEN ──────────────────────────────────────────────────────────────────
export function fromFen(fen: string): Pos {
  const [placement, turn, cast, ep, half, full] = fen.trim().split(/\s+/)
  const board: (Piece | null)[] = Array(64).fill(null)
  placement.split('/').forEach((row, i) => {
    let f = 0
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue }
      const side: Side = ch === ch.toUpperCase() ? 'w' : 'b'
      const kind = ch.toLowerCase() as Kind
      const s = sq(f, 7 - i)
      board[s] = { id: side + kind + name(s), side, kind }
      f++
    }
  })
  const c = cast ?? '-'
  return { board, turn: (turn ?? 'w') as Side, castling: { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') },
    ep: ep && ep !== '-' ? parse(ep) : -1, half: Number(half ?? 0), full: Number(full ?? 1) }
}
export function toFen(p: Pos, counters = true): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0
    for (let f = 0; f < 8; f++) {
      const x = p.board[sq(f, r)]
      if (!x) { empty++; continue }
      if (empty) { row += empty; empty = 0 }
      row += x.side === 'w' ? x.kind.toUpperCase() : x.kind
    }
    rows.push(row + (empty || ''))
  }
  const c = (p.castling.K ? 'K' : '') + (p.castling.Q ? 'Q' : '') + (p.castling.k ? 'k' : '') + (p.castling.q ? 'q' : '') || '-'
  // like chess.js / FEN practice: print the e.p. square only when an e.p. capture is legal
  const epOk = p.ep >= 0 && legal(p, 'classic').some(m => m.flag === 'e')
  const base = rows.join('/') + ' ' + p.turn + ' ' + c + ' ' + (epOk ? name(p.ep) : '-')
  return counters ? base + ' ' + p.half + ' ' + p.full : base
}
export const clone = (p: Pos): Pos => ({ ...p, board: p.board.slice(), castling: { ...p.castling } })
export const kingSq = (p: Pos, s: Side) => p.board.findIndex(x => x?.side === s && x.kind === 'k')

// ── attacks (orthodox geometry) ──────────────────────────────────────────
export function attacked(p: Pos, target: number, by: Side): boolean {
  const f = file(target), r = rank(target), b = p.board
  const pr = by === 'w' ? r - 1 : r + 1
  for (const df of [-1, 1]) if (on(f + df, pr)) { const x = b[sq(f + df, pr)]; if (x?.side === by && x.kind === 'p') return true }
  for (const [a, c] of N_STEPS) if (on(f + a, r + c)) { const x = b[sq(f + a, r + c)]; if (x?.side === by && x.kind === 'n') return true }
  for (const [a, c] of K_STEPS) if (on(f + a, r + c)) { const x = b[sq(f + a, r + c)]; if (x?.side === by && x.kind === 'k') return true }
  for (const [dirs, kinds] of [[R_DIRS, 'rq'], [B_DIRS, 'bq']] as const) {
    for (const [a, c] of dirs) {
      for (let x = f + a, y = r + c; on(x, y); x += a, y += c) {
        const q = b[sq(x, y)]
        if (!q) continue
        if (q.side === by && kinds.includes(q.kind)) return true
        break
      }
    }
  }
  return false
}

// ── pseudo-legal moves (orthodox patterns) ───────────────────────────────
export function pseudo(p: Pos, mode: Mode = 'classic'): Move[] {
  const clash = mode === 'clash'
  const out: Move[] = [], b = p.board, me = p.turn
  for (let s = 0; s < 64; s++) {
    const x = b[s]; if (!x || x.side !== me) continue
    const f = file(s), r = rank(s)
    const add = (to: number, flag: Flag) => {
      if (x.kind === 'p' && (rank(to) === 7 || rank(to) === 0)) for (const promo of ['q', 'r', 'b', 'n'] as Kind[]) out.push({ from: s, to, kind: 'p', flag, promo })
      else out.push({ from: s, to, kind: x.kind, flag })
    }
    if (x.kind === 'p') {
      const dr = me === 'w' ? 1 : -1, start = me === 'w' ? 1 : 6
      if (on(f, r + dr) && !b[sq(f, r + dr)]) {
        add(sq(f, r + dr), 'n')
        if (r === start && !b[sq(f, r + 2 * dr)]) out.push({ from: s, to: sq(f, r + 2 * dr), kind: 'p', flag: 'd' })
      }
      for (const df of [-1, 1]) {
        if (!on(f + df, r + dr)) continue
        const t = sq(f + df, r + dr), y = b[t]
        if (y && y.side !== me) add(t, 'c')
        else if (t === p.ep) out.push({ from: s, to: t, kind: 'p', flag: 'e' })
      }
    } else if (x.kind === 'n' || x.kind === 'k') {
      for (const [a, c] of x.kind === 'n' ? N_STEPS : K_STEPS) {
        if (!on(f + a, r + c)) continue
        const t = sq(f + a, r + c), y = b[t]
        if (!y) add(t, 'n'); else if (y.side !== me && !(clash && x.kind === 'n' && MASS[y.kind] > STOMP_MAX)) add(t, 'c')
      }
      if (x.kind === 'k') {
        const home = me === 'w' ? 4 : 60, opp = other(me)
        if (s === home) {
          const [kk, qq] = me === 'w' ? [p.castling.K, p.castling.Q] : [p.castling.k, p.castling.q]
          const rook = (t: number) => b[t]?.side === me && b[t]?.kind === 'r'
          if (kk && !b[home + 1] && !b[home + 2] && rook(home + 3) && !attacked(p, home, opp) && !attacked(p, home + 1, opp) && !attacked(p, home + 2, opp))
            out.push({ from: s, to: home + 2, kind: 'k', flag: 'k' })
          if (qq && !b[home - 1] && !b[home - 2] && !b[home - 3] && rook(home - 4) && !attacked(p, home, opp) && !attacked(p, home - 1, opp) && !attacked(p, home - 2, opp))
            out.push({ from: s, to: home - 2, kind: 'k', flag: 'q' })
        }
      }
    } else {
      const dirs = x.kind === 'r' ? R_DIRS : x.kind === 'b' ? B_DIRS : K_STEPS
      const direct = new Set<number>(), edges: [number, number, number][] = []
      for (const [a, c] of dirs) {
        let last = -1, open = true
        for (let u = f + a, w = r + c; on(u, w); u += a, w += c) {
          const t = sq(u, w), y = b[t]
          if (!y) { add(t, 'n'); direct.add(t); last = t; continue }
          if (y.side !== me) { add(t, 'c'); direct.add(t) }
          open = false; break
        }
        if (clash && x.kind === 'b' && open && last >= 0) edges.push([last, a, c])
      }
      // 衝 cushion: a bishop that reaches the rim along an open diagonal may reflect once (never in a corner)
      for (const [via, a0, c0] of edges) {
        const fu = file(via) + a0, rw = rank(via) + c0, offF = fu < 0 || fu > 7, offR = rw < 0 || rw > 7
        if (offF && offR) continue
        const a = offF ? -a0 : a0, c = offR ? -c0 : c0
        for (let u = file(via) + a, w = rank(via) + c; on(u, w); u += a, w += c) {
          const t = sq(u, w), y = b[t]
          if (t === s) break
          if (!y) { if (!direct.has(t)) out.push({ from: s, to: t, kind: 'b', flag: 'n', via }); continue }
          if (y.side !== me && !direct.has(t)) out.push({ from: s, to: t, kind: 'b', flag: 'c', via })
          break
        }
      }
    }
  }
  return out
}

// ── making moves ─────────────────────────────────────────────────────────
const CORNER: Record<number, keyof Castling> = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' }
function revoke(p: Pos, square: number, piece: Piece | null) {
  if (piece?.kind === 'k') { if (piece.side === 'w') { p.castling.K = p.castling.Q = false } else { p.castling.k = p.castling.q = false } }
  const c = CORNER[square]; if (c) p.castling[c] = false
}

/** The board squares of the full line through `to` along the step (df, dr). */
export function lineThrough(to: number, df: number, dr: number): number[] {
  let f = file(to), r = rank(to)
  while (on(f - df, r - dr)) { f -= df; r -= dr }
  const out: number[] = []
  for (; on(f, r); f += df, r += dr) out.push(sq(f, r))
  return out
}

export function make(p0: Pos, m: Move, mode: Mode, opts: { newton?: boolean } = {}): { pos: Pos; out: Outcome } {
  const p = clone(p0), b = p.board, me = p.turn
  const mover = b[m.from]!
  const out: Outcome = { move: m, removed: [] }
  p.ep = -1
  let reset = mover.kind === 'p'
  revoke(p, m.from, mover)
  if (m.flag === 'k' || m.flag === 'q') {
    const rf = m.flag === 'k' ? m.from + 3 : m.from - 4, rt = m.flag === 'k' ? m.from + 1 : m.from - 1
    b[m.to] = mover; b[m.from] = null; b[rt] = b[rf]; b[rf] = null
  } else if (m.flag === 'e') {
    const victimSq = m.to + (me === 'w' ? -8 : 8)
    out.removed.push(b[victimSq]!); b[victimSq] = null
    b[m.to] = mover; b[m.from] = null
  } else if (m.flag === 'c' && (mode === 'classic' || mover.kind === 'n')) {
    const victim = b[m.to]!
    out.removed.push(victim); revoke(p, m.to, victim)
    if (mode === 'clash') out.stomp = { square: m.to, victim }
    b[m.to] = mover; b[m.from] = null
    reset = true
  } else if (m.flag === 'c') {
    // 衝: relativistic collision along the move's line
    const [df, dr] = moveDir(m)
    const line = lineThrough(m.to, df, dr)
    const idx = (s: number) => line.indexOf(s)
    const run = m.via !== undefined ? cheb(m.from, m.via) + cheb(m.via, m.to) : cheb(m.from, m.to), speed = opts.newton ? runSpeedNewton(run) : runSpeed(run)
    b[m.from] = null
    // phalanx: a struck pawn with own pawns right beside it (across the line) is that much heavier (max +2)
    const phalanx: string[] = []
    const massOf = (s: number) => {
      const x = b[s]!; if (x.kind !== 'p') return MASS[x.kind]
      let n = 0
      for (const [u, w] of [[-dr, df], [dr, -df]]) { const f2 = file(s) + u, r2 = rank(s) + w; if (on(f2, r2)) { const y = b[sq(f2, r2)]; if (y && y.kind === 'p' && y.side === x.side) n++ } }
      if (n) phalanx.push(x.id)
      return 1 + Math.min(2, n)
    }
    const bodies = line.filter(s => b[s]).map(s => ({ id: b[s]!.id, mass: massOf(s), s: idx(s), v: 0 }))
    bodies.push({ id: mover.id, mass: MASS[mover.kind], s: idx(m.to) - 1, v: speed })
    const sim = simulateLine(bodies, line.length, 1, { newton: opts.newton })
    const pieces = new Map<string, Piece>([[mover.id, mover]])
    const origin = new Map<string, number>([[mover.id, m.from]])
    for (const s of line) if (b[s]) { pieces.set(b[s]!.id, b[s]!); origin.set(b[s]!.id, s); b[s] = null }
    const moved = new Map<string, [number, number | null]>()
    for (const [id, f] of sim.final) {
      const piece = pieces.get(id)!, from = origin.get(id)!
      const dest = f === null ? null : line[f]
      moved.set(id, [from, dest])
      if (dest === null) { out.removed.push(piece); revoke(p, from, piece); reset = true }
      else { b[dest] = piece; if (dest !== from) revoke(p, from, piece) }
    }
    out.clash = { line, attacker: mover.id, speed, run, sim, moved, phalanx }
  } else {
    b[m.to] = mover; b[m.from] = null
    if (m.flag === 'd') p.ep = (m.from + m.to) / 2
  }
  if (m.promo && mover.kind === 'p' && b[m.to] === mover) { b[m.to] = { ...mover, kind: m.promo }; out.promoted = m.promo }
  // 衝 knight: wherever it lands, a shockwave shoves adjacent enemy pieces (mass ≤ SHOCK_MAX) one square away
  if (mode === 'clash' && mover.kind === 'n' && b[m.to] === mover) {
    const shock: { id: string; from: number; to: number | null }[] = []
    for (const [u, w] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const f1 = file(m.to) + u, r1 = rank(m.to) + w
      if (!on(f1, r1)) continue
      const s1 = sq(f1, r1), y = b[s1]
      if (!y || y.side === me || MASS[y.kind] > SHOCK_MAX) continue
      const f2 = f1 + u, r2 = r1 + w
      if (!on(f2, r2)) { b[s1] = null; out.removed.push(y); revoke(p, s1, y); shock.push({ id: y.id, from: s1, to: null }); reset = true; continue }
      const s2 = sq(f2, r2)
      if (b[s2]) continue
      b[s2] = y; b[s1] = null; revoke(p, s1, y); shock.push({ id: y.id, from: s1, to: s2 })
    }
    if (shock.length) out.shock = shock
  }
  p.half = reset ? 0 : p.half + 1
  if (me === 'b') p.full++
  p.turn = other(me)
  return { pos: p, out }
}

// ── check, legality, game status ─────────────────────────────────────────
/** Can `by` remove/attack the king of `side` with one move from position p (ignoring whose turn it is)? */
export function kingThreatened(p: Pos, side: Side, mode: Mode): boolean {
  const k = kingSq(p, side)
  if (k < 0) return true
  const by = other(side)
  if (mode === 'classic') return attacked(p, k, by)
  const q = clone(p); q.turn = by; q.ep = -1
  for (const m of pseudo(q, mode)) {
    if (m.flag !== 'c' || (m.promo && m.promo !== 'q')) continue
    if (m.kind === 'n') { if (m.to === k) return true; continue }
    // only collisions whose line passes through the king can move it
    const [df, dr] = moveDir(m)
    if (!lineThrough(m.to, df, dr).includes(k)) continue
    const r = make(q, m, mode)
    if (kingSq(r.pos, side) < 0) return true
  }
  return false
}
export function legal(p: Pos, mode: Mode): Move[] {
  // in 衝 a pawn collision never reaches the last rank: one move, no promotion choice
  const ms = mode === 'clash' ? pseudo(p, mode).filter(m => !(m.flag === 'c' && m.promo && m.promo !== 'q')) : pseudo(p)
  return ms.filter(m => {
    const { pos } = make(p, m, mode)
    if (kingSq(pos, p.turn) < 0) return false
    return !kingThreatened(pos, p.turn, mode)
  })
}
export const inCheck = (p: Pos, mode: Mode) => kingThreatened(p, p.turn, mode)

export type Status = { over: false } | { over: true; result: '1-0' | '0-1' | '1/2-1/2'; reason: 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' }
export function status(p: Pos, mode: Mode, history: readonly string[] = []): Status {
  if (!legal(p, mode).length) {
    if (inCheck(p, mode)) return { over: true, result: p.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' }
    return { over: true, result: '1/2-1/2', reason: 'stalemate' }
  }
  if (p.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty' }
  const key = toFen(p, false)
  if (history.filter(h => h === key).length >= 2) return { over: true, result: '1/2-1/2', reason: 'repetition' }
  if (mode === 'classic') {
    const rest = p.board.filter(x => x && x.kind !== 'k') as Piece[]
    if (!rest.length || (rest.length === 1 && (rest[0].kind === 'n' || rest[0].kind === 'b'))) return { over: true, result: '1/2-1/2', reason: 'material' }
  } else if (p.board.filter(x => x).length === 2) return { over: true, result: '1/2-1/2', reason: 'material' }
  return { over: false }
}

export function perft(p: Pos, depth: number, mode: Mode = 'classic'): number {
  if (depth === 0) return 1
  const ms = legal(p, mode)
  if (depth === 1) return ms.length
  let n = 0
  for (const m of ms) n += perft(make(p, m, mode).pos, depth - 1, mode)
  return n
}
