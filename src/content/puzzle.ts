// 당구 문제 — the problem book. Shared by the game, the generator and the tests.
//
// Two families:
//  • target problems: no kings, Black's pieces are frozen targets, White moves `depth` times in a row (billiards).
//  • mate problems:   real 衝 rules with kings; Black answers with the best defence.
import { fromFen, kingSq, kingThreatened, legal, make, name, parse, pseudo, type Move, type Outcome, type Pos } from '../engine/rules.ts'

export type Seal = '半' | '速' | '盲' | '二' | '宣' | '敵' | '三' | '一'
export type Goal =
  | { type: 'drop'; n: number; keep?: boolean }
  | { type: 'target'; squares: number[]; keep?: boolean }
  | { type: 'mate' }

export interface Puzzle {
  id: number          // 1..100, book order
  tier: number        // 1..10 stars
  fen: string
  depth: number       // White moves (target) or mate-in-N
  goal: Goal
  solution: string[]  // one solution, UCI-ish "e2e4" (+ promo letter); mate: White's moves only
  total: number       // number of move sequences an exhaustive search had to consider
  solutions: number   // how many of them solve it (mate: forcing first moves)
  score: number       // difficulty score used for ordering
  newton?: boolean    // the classical prediction gets this one wrong (★4)
  chain?: number      // contacts in the stored solution
  seals: Seal[]
}

/** Seals in force at each tier (cumulative where they can combine). */
export function sealsFor(tier: number, depth: number, mate: boolean): Seal[] {
  const s: Seal[] = []
  if (tier === 3) s.push('半')
  if (tier === 4) s.push('速')
  if (tier >= 5) s.push('盲')
  if (depth >= 2 && !mate) s.push(depth >= 3 ? '三' : '二')
  if (tier >= 7 && !mate && depth >= 2) s.push('宣')
  if (mate) s.push('敵')
  if (mate && depth >= 2) s.push('三')
  if (tier >= 10) s.push('一')
  return [...new Set(s)]
}

export const uci = (m: Move) => name(m.from) + name(m.to) + (m.promo ?? '')

// ── target problems ──────────────────────────────────────────────────────
/** White's moves in a target problem (no legality beyond movement: there are no kings). */
export function targetMoves(p: Pos): Move[] {
  return pseudo(p).filter(m => !m.promo || m.promo === 'q')
}
/** One White move; Black never moves, so the turn returns to White. */
export function targetStep(p: Pos, m: Move, newton = false): { pos: Pos; out: Outcome } {
  const r = make(p, m, 'clash', { newton })
  r.pos.turn = 'w'; r.pos.ep = -1
  return r
}
export interface Tally { blackLost: number; whiteLost: number; gone: Set<string> }
export const emptyTally = (): Tally => ({ blackLost: 0, whiteLost: 0, gone: new Set() })
export function addTally(t: Tally, out: Outcome): Tally {
  const n: Tally = { blackLost: t.blackLost, whiteLost: t.whiteLost, gone: new Set(t.gone) }
  for (const x of out.removed) { if (x.side === 'b') n.blackLost++; else n.whiteLost++; n.gone.add(x.id) }
  return n
}
/** Ids of the pieces a target goal names (they keep their FEN ids: side+kind+square). */
export function targetIds(start: Pos, g: Goal): string[] {
  return g.type === 'target' ? g.squares.map(s => start.board[s]!.id) : []
}
export function achieved(start: Pos, g: Goal, t: Tally): boolean {
  if (g.type === 'mate') return false
  if (g.keep && t.whiteLost) return false
  if (g.type === 'drop') return t.blackLost >= g.n
  return targetIds(start, g).every(id => t.gone.has(id))
}

/** Exhaustive search of a target problem: every sequence of `depth` White moves. */
export function solveTarget(fen: string, depth: number, g: Goal, newton = false) {
  const start = fromFen(fen)
  let total = 0, solutions = 0, first: string[] | null = null, shorter = false
  const walk = (p: Pos, d: number, t: Tally, path: string[]) => {
    for (const m of targetMoves(p)) {
      const r = targetStep(p, m, newton), t2 = addTally(t, r.out), path2 = [...path, uci(m)]
      if (d === 1) { total++; if (achieved(start, g, t2)) { solutions++; first ??= path2 } }
      else {
        if (achieved(start, g, t2)) shorter = true
        walk(r.pos, d - 1, t2, path2)
      }
    }
  }
  walk(start, depth, emptyTally(), [])
  return { total, solutions, solution: first, shorter }
}

/** Play a list of UCI moves in a target problem and judge it. */
export function playTarget(fen: string, g: Goal, moves: string[]): { ok: boolean; legal: boolean; outs: Outcome[] } {
  const start = fromFen(fen)
  let p = start, t = emptyTally(); const outs: Outcome[] = []
  for (const u of moves) {
    const m = findMove(targetMoves(p), u)
    if (!m) return { ok: false, legal: false, outs }
    const r = targetStep(p, m); p = r.pos; t = addTally(t, r.out); outs.push(r.out)
  }
  return { ok: achieved(start, g, t), legal: true, outs }
}
export function findMove(ms: Move[], u: string): Move | undefined {
  const from = parse(u.slice(0, 2)), to = parse(u.slice(2, 4)), promo = u[4]
  return ms.find(m => m.from === from && m.to === to && (!m.promo || m.promo === (promo ?? 'q')))
}

// ── mate problems ────────────────────────────────────────────────────────
/** Black has just been mated (or lost its king). */
export function mated(p: Pos): boolean {
  if (kingSq(p, 'b') < 0) return true
  if (p.turn !== 'b' || !kingThreatened(p, 'b', 'clash')) return false
  return legal(p, 'clash').length === 0
}
export function mateIn1(p: Pos): Move[] {
  return legal(p, 'clash').filter(m => mated(make(p, m, 'clash').pos))
}
/** Black's reply in a mate-in-2: refute if possible, else make White's last move as rare as possible. */
export function defend(p: Pos): Move | null {
  const ms = legal(p, 'clash')
  if (!ms.length) return null
  let best: Move | null = null, bestN = Infinity
  for (const m of ms) {
    const n = mateIn1(make(p, m, 'clash').pos).length
    if (n < bestN) { bestN = n; best = m }
    if (n === 0) break
  }
  return best
}
/** First moves that force mate in 2 against every defence. */
export function mateIn2Keys(p: Pos, limit = Infinity): { keys: Move[]; total: number } {
  const keys: Move[] = []; let total = 0
  for (const m of legal(p, 'clash')) {
    const q = make(p, m, 'clash').pos
    if (mated(q)) continue // a mate in 1 is not a key to a mate in 2
    const replies = legal(q, 'clash')
    if (!replies.length) continue // stalemate
    let forced = true
    for (const b of replies) {
      const r = make(q, b, 'clash').pos
      const wm = legal(r, 'clash'); total += wm.length
      if (!wm.some(w => mated(make(r, w, 'clash').pos))) { forced = false; break }
    }
    if (forced) { keys.push(m); if (keys.length >= limit) break }
  }
  return { keys, total }
}
