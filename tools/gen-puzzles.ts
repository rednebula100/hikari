// Mines the problem book: random billiard layouts + random endgames, each solved exhaustively by the engine.
// Usage: npx tsx tools/gen-puzzles.ts [seed]  → src/content/puzzles.json
import { writeFileSync } from 'node:fs'
import { fromFen, toFen, legal, make, kingSq, kingThreatened, MASS, name, file, rank, sq, type Kind, type Pos, type Move, type Piece } from '../src/engine/rules.ts'
import { rng } from '../src/engine/ai.ts'
import { gamma } from '../src/engine/collide.ts'
import { targetMoves, targetStep, emptyTally, addTally, achieved, uci, mateIn1, mateIn2Keys, mated, sealsFor, solveTarget, type Goal, type Puzzle, type Tally } from '../src/content/puzzle.ts'

const R = rng(Number(process.argv[2] ?? 1905))
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(R() * xs.length)]
const t0 = Date.now()
const log = (...a: unknown[]) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a)

function fenOf(board: (Piece | null)[]): string {
  const p: Pos = { board, turn: 'w', castling: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1 }
  return toFen(p)
}
const place = (b: (Piece | null)[], s: number, side: 'w' | 'b', kind: Kind) => { b[s] = { id: side + kind + name(s), side, kind } }
const pawnOk = (s: number) => rank(s) >= 1 && rank(s) <= 6

// ── billiard layouts: black targets strung along lines, white cues around them ──
function layout(nW: number, nB: number): string | null {
  const b: (Piece | null)[] = Array(64).fill(null)
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]
  let placed = 0, tries = 0
  while (placed < nB && tries++ < 60) {
    const [df, dr] = pick(DIRS)
    let f = Math.floor(R() * 8), r = Math.floor(R() * 8)
    const run = 2 + Math.floor(R() * 3)
    for (let i = 0; i < run && placed < nB; i++) {
      if (f < 0 || f > 7 || r < 0 || r > 7) break
      const s = sq(f, r), kind = pick(['p', 'p', 'p', 'n', 'b', 'r', 'q'] as Kind[])
      if (!b[s] && (kind !== 'p' || pawnOk(s))) { place(b, s, 'b', kind); placed++ }
      const gap = R() < .7 ? 1 : 2; f += df * gap; r += dr * gap
    }
  }
  if (placed < nB) return null
  for (let i = 0; i < nW; i++) {
    for (let k = 0; k < 40; k++) {
      const s = Math.floor(R() * 64), kind = pick(['r', 'r', 'q', 'b', 'b', 'n', 'p'] as Kind[])
      if (!b[s] && (kind !== 'p' || pawnOk(s))) { place(b, s, 'w', kind); break }
    }
  }
  return fenOf(b)
}

// ── exhaustive enumeration with goal selection ──
interface Leaf { t: Tally; path: string[]; contacts: number; bounce: boolean; ability: boolean }
function enumerate(fen: string, depth: number) {
  const start = fromFen(fen)
  const levels: Leaf[][] = Array.from({ length: depth }, () => [])
  const walk = (p: Pos, d: number, t: Tally, path: string[], contacts: number, bounce: boolean, ability: boolean) => {
    for (const m of targetMoves(p)) {
      const r = targetStep(p, m)
      const c = r.out.clash, leaf: Leaf = { t: addTally(t, r.out), path: [...path, uci(m)], contacts: contacts + (c?.sim.contacts.length ?? 0),
        bounce: bounce || !!c?.sim.tracks.find(x => x.id === c.attacker)?.keys.some(k => k.v < -1e-9),
        ability: ability || !!r.out.shock?.length || m.via !== undefined || !!c?.phalanx.length }
      levels[path.length].push(leaf)
      if (path.length + 1 < depth) walk(r.pos, d - 1, leaf.t, leaf.path, leaf.contacts, leaf.bounce, leaf.ability)
    }
  }
  walk(start, depth, emptyTally(), [], 0, false, false)
  return { start, levels }
}

function goalsFor(start: Pos): Goal[] {
  const blacks = start.board.map((x, s) => (x?.side === 'b' ? s : -1)).filter(s => s >= 0)
  const gs: Goal[] = []
  for (let n = 1; n <= blacks.length; n++) { gs.push({ type: 'drop', n }); gs.push({ type: 'drop', n, keep: true }) }
  for (const s of blacks) if (start.board[s]!.kind !== 'p') { gs.push({ type: 'target', squares: [s] }); gs.push({ type: 'target', squares: [s], keep: true }) }
  // two named targets
  for (let i = 0; i < blacks.length; i++) for (let j = i + 1; j < blacks.length; j++) gs.push({ type: 'target', squares: [blacks[i], blacks[j]] })
  return gs
}
const goalWeight = (g: Goal) => (g.type === 'drop' ? g.n * 1.0 : g.type === 'target' ? g.squares.length * 1.1 : 0) + (g.type !== 'mate' && g.keep ? .6 : 0)

/** Momentum of every collision move from the start (for the "the hardest hit is not the answer" bonus). */
function hitMomentum(p: Pos, m: Move): number {
  if (m.flag !== 'c' || m.kind === 'n') return 0
  const r = make(p, m, 'clash')
  const v = r.out.clash?.speed ?? 0
  return gamma(v) * MASS[m.kind] * v
}

function judgeTarget(fen: string, depth: number): Puzzle | null {
  const { start, levels } = enumerate(fen, depth)
  const leaves = levels[depth - 1]
  if (leaves.length < 6) return null
  let best: { g: Goal; sol: Leaf[]; score: number } | null = null
  for (const g of goalsFor(start)) {
    const sol = leaves.filter(l => achieved(start, g, l.t))
    if (!sol.length || sol.length > (depth === 1 ? 3 : 6)) continue
    // no shorter solution
    if (levels.slice(0, depth - 1).some(lv => lv.some(l => achieved(start, g, l.t)))) continue
    // every solution must use all moves meaningfully: the goal fails if the last move is a pass-like quiet move? (kept simple)
    const rarity = Math.log10(leaves.length / sol.length)
    const s0 = sol[0]
    const firstMoves = targetMoves(start)
    const first = firstMoves.find(m => uci(m) === s0.path[0])!
    const maxP = Math.max(...firstMoves.map(m => hitMomentum(start, m)))
    const counter = hitMomentum(start, first) < maxP - 1e-6 ? 1 : 0
    const quiet = first.flag !== 'c' ? 1.5 : 0
    const score = rarity * 1.6 + (depth - 1) * 2.5 + Math.min(6, s0.contacts) * .3 + counter * 1.2 + quiet + (s0.bounce ? .5 : 0) + (s0.ability ? 1.4 : 0) + goalWeight(g) * .5 - (sol.length - 1) * .4
    if (!best || score > best.score) best = { g, sol, score }
  }
  if (!best) return null
  // ★4 material: does the classical (Newton) calculation mislead on this problem?
  let newton = false
  if (depth === 1) {
    const nw = solveTarget(fen, 1, best.g, true)
    const real = new Set(best.sol.map(l => l.path[0]))
    const nmoves = targetMoves(start).filter(m => { const r = targetStep(start, m, true); return achieved(start, best!.g, addTally(emptyTally(), r.out)) }).map(uci)
    newton = nw.solutions !== best.sol.length || nmoves.some(u => !real.has(u))
  }
  return { id: 0, tier: 0, fen, depth, goal: best.g, solution: best.sol[0].path, total: leaves.length, solutions: best.sol.length, score: +best.score.toFixed(2), newton, chain: best.sol[0].contacts, seals: [] } as Puzzle
}

// ── mate problems: sparse random endgames, black king near a cliff ──
function endgame(nW: number, nB: number): string | null {
  const b: (Piece | null)[] = Array(64).fill(null)
  const edge = () => { const s = Math.floor(R() * 64); return Math.min(file(s), 7 - file(s), rank(s), 7 - rank(s)) <= 1 ? s : -1 }
  let bk = -1; for (let i = 0; i < 50 && bk < 0; i++) bk = edge()
  if (bk < 0) return null
  place(b, bk, 'b', 'k')
  const put = (side: 'w' | 'b', kinds: Kind[]) => { for (let k = 0; k < 60; k++) { const s = Math.floor(R() * 64), kind = pick(kinds); if (!b[s] && (kind !== 'p' || pawnOk(s))) { place(b, s, side, kind); return true } } return false }
  put('w', ['k'])
  for (let i = 0; i < nW; i++) put('w', ['q', 'r', 'r', 'b', 'n', 'p'])
  for (let i = 0; i < nB; i++) put('b', ['p', 'p', 'n', 'b', 'r', 'q'])
  const fen = fenOf(b)
  const p = fromFen(fen)
  if (kingSq(p, 'w') < 0) return null
  if (kingThreatened(p, 'b', 'clash')) return null // black must not be capturable with White to move
  if (kingThreatened(p, 'w', 'clash')) return null
  return fen
}
function judgeMate(fen: string, depth: 1 | 2): Puzzle | null {
  const p = fromFen(fen)
  const ms = legal(p, 'clash')
  if (ms.length < 8) return null
  if (depth === 1) {
    const keys = mateIn1(p)
    if (!keys.length || keys.length > 2) return null
    const k = keys[0], r = make(p, k, 'clash')
    const contacts = r.out.clash?.sim.contacts.length ?? 0
    const quiet = k.flag !== 'c' ? 2 : 0
    const score = Math.log10(ms.length / keys.length) * 1.6 + 4 + contacts * .3 + quiet - (keys.length - 1) * .5
    return { id: 0, tier: 0, fen, depth: 1, goal: { type: 'mate' }, solution: [uci(k)], total: ms.length, solutions: keys.length, score: +score.toFixed(2), seals: [] }
  }
  if (mateIn1(p).length) return null
  const { keys } = mateIn2Keys(p, 3)
  if (!keys.length || keys.length > 2) return null
  const quiet = keys[0].flag !== 'c' ? 2 : 0
  const score = Math.log10(ms.length / keys.length) * 1.6 + 8 + quiet - (keys.length - 1) * .5
  return { id: 0, tier: 0, fen, depth: 2, goal: { type: 'mate' }, solution: [uci(keys[0])], total: ms.length, solutions: keys.length, score: +score.toFixed(2), seals: [] }
}

// ── mining ──
const seen = new Set<string>()
function mine<T>(label: string, want: number, budgetMs: number, gen: () => T | null, ok: (x: T) => boolean): T[] {
  const out: T[] = [], end = Date.now() + budgetMs
  let tried = 0
  while (out.length < want && Date.now() < end) {
    tried++
    const x = gen()
    if (x && ok(x)) out.push(x)
  }
  log(label, out.length, '/', want, 'from', tried)
  return out
}
const fresh = (p: Puzzle | null) => { if (!p || seen.has(p.fen)) return false; seen.add(p.fen); return true }
const tgt = (nW: number, nB: number, d: number) => () => { const f = layout(nW, nB); return f ? judgeTarget(f, d) : null }
const rnd = (a: number, b: number) => a + Math.floor(R() * (b - a + 1))

const d1 = mine('depth-1', 2400, 240_000, () => tgt(rnd(1, 3), rnd(3, 7), 1)(), p => fresh(p))
const d2 = mine('depth-2', 500, 400_000, () => tgt(rnd(2, 3), rnd(3, 6), 2)(), p => fresh(p) && p.solutions <= 4 && p.total >= 60)
const d3 = mine('depth-3', 120, 900_000, () => tgt(rnd(2, 3), rnd(4, 7), 3)(), p => fresh(p) && p.solutions <= 3 && p.total >= 1500)
const m1 = mine('mate-1', 160, 300_000, () => { const f = endgame(rnd(1, 3), rnd(0, 3)); return f ? judgeMate(f, 1) : null }, p => fresh(p))
const m2 = mine('mate-2', 40, 1_200_000, () => { const f = endgame(rnd(1, 2), rnd(0, 2)); return f ? judgeMate(f, 2) : null }, p => fresh(p))

// ── fill the ten tiers ──
const used = new Set<string>()
const take = (pool: Puzzle[], n: number, pred: (p: Puzzle) => boolean, by: 'asc' | 'desc') => {
  const xs = pool.filter(p => !used.has(p.fen) && pred(p)).sort((a, b) => (by === 'asc' ? a.score - b.score : b.score - a.score)).slice(0, n)
  xs.forEach(p => used.add(p.fen)); return xs
}
const pieces = (p: Puzzle) => fromFen(p.fen).board.filter(Boolean).length
// ★1 — 기물 그림: pictures drawn in pieces, each with one playful goal (solved exhaustively like the rest)
const sq2 = (n: string) => (Number(n[1]) - 1) * 8 + n.charCodeAt(0) - 97
const ART: { title: string; text: string; fen: string; goal: Goal }[] = [
  { title: '웃는 얼굴', text: '나이트로 코를 짓밟아라', fen: '8/4N3/2p2p2/3p4/1p4p1/2pppp2/8/8 w - - 0 1', goal: { type: 'target', squares: [sq2('d5')] } },
  { title: '윙크', text: '한쪽 눈을 감게 하라 — 눈 하나만 떨어뜨리기', fen: '8/4N3/2p2p2/3p4/1p4p1/2pppp2/8/8 w - - 0 1', goal: { type: 'target', squares: [sq2('c6')] } },
  { title: '하트', text: '하트의 왼쪽 볼록을 날려라', fen: '8/1pp1pp2/p2p2p1/p5p1/1p3p2/2p1p3/3p4/R7 w - - 0 1', goal: { type: 'target', squares: [sq2('a6')] } },
  { title: '눈사람', text: '눈사람의 모자를 벗겨라', fen: '8/3q4/3p4/2pbp3/3r4/2prp3/8/3Q4 w - - 0 1', goal: { type: 'target', squares: [sq2('d7')] } },
  { title: '기차', text: '마지막 칸만 떼어내라', fen: '8/8/8/8/8/8/R2rrrr1/8 w - - 0 1', goal: { type: 'target', squares: [sq2('g2')] } },
  { title: '요람', text: '맨 끝의 퀸만 떨어뜨려라', fen: '8/8/8/8/Q2qqqq1/8/8/8 w - - 0 1', goal: { type: 'target', squares: [sq2('g4')] } },
  { title: '피라미드', text: '꼭대기 돌을 하늘로', fen: '8/8/4p3/3ppp2/2ppppp1/8/8/4R3 w - - 0 1', goal: { type: 'target', squares: [sq2('e6')] } },
  { title: '고양이', text: '고양이 입꼬리를 짓밟아라', fen: '8/2n2n2/2pppp2/2b2b2/3pp3/8/4N3/8 w - - 0 1', goal: { type: 'target', squares: [sq2('d4')] } },
  { title: '과녁', text: '과녁의 맨 윗고리를 맞혀라', fen: '8/8/3ppp2/3ppp2/3ppp2/8/8/4R3 w - - 0 1', goal: { type: 'target', squares: [sq2('e6')] } },
  { title: '로켓', text: '발사! 로켓 끝 두 칸을 우주로', fen: '3p4/3r4/3r4/3r4/2b1b3/8/8/3R4 w - - 0 1', goal: { type: 'drop', n: 2 } },
]
const artBook: Puzzle[] = ART.map(a => {
  const r = solveTarget(a.fen, 1, a.goal)
  if (!r.solutions) throw new Error('art puzzle unsolvable: ' + a.title)
  return { id: 0, tier: 1, fen: a.fen, depth: 1, goal: a.goal, solution: r.solution!, total: r.total, solutions: r.solutions, score: 1, seals: [], title: a.title, text: a.text }
})
const tiers: Puzzle[][] = []
tiers[1] = artBook
void take(d1, 10, p => p.solutions <= 3 && pieces(p) <= 6 && p.goal.type === 'drop' && !p.goal.keep && p.goal.n <= 2, 'asc')
tiers[2] = take(d1, 10, p => p.solutions <= 2 && p.total >= 12 && (p.goal.type === 'target' || (p.goal.type === 'drop' && p.goal.n >= 2)), 'asc')
tiers[4] = take(d1, 10, p => !!p.newton && p.solutions <= 2, 'desc')
tiers[3] = take(d1, 10, p => p.solutions <= 2 && (p.chain ?? 0) >= 2 && p.total >= 18, 'asc')
tiers[5] = take(d1, 10, p => p.solutions === 1 && p.total >= 30, 'desc')
tiers[6] = take(d2, 10, p => p.total >= 100 && p.total < 600, 'asc')
tiers[7] = take(d2, 10, p => p.solutions <= 2 && p.total >= 300, 'desc')
tiers[8] = take(m1, 10, () => true, 'desc')
tiers[9] = [...take(d3, 5, () => true, 'asc'), ...take(m2, 5, () => true, 'asc')]
tiers[10] = [...take(d3, 5, () => true, 'desc'), ...take(m2, 5, () => true, 'desc')]
// top up any short tier from the nearest pool so the book always has 100 problems
const pools = [d1, d1, d1, d1, d1, d1, d2, d2, m1, d3, d3]
for (let t = 2; t <= 10; t++) if (tiers[t].length < 10) tiers[t].push(...take(pools[t], 10 - tiers[t].length, () => true, t >= 5 ? 'desc' : 'asc'))

const book: Puzzle[] = []
for (let t = 1; t <= 10; t++) {
  if (t > 1) tiers[t].sort((a, b) => a.score - b.score)
  for (const p of tiers[t]) book.push({ ...p, id: book.length + 1, tier: t, seals: sealsFor(t, p.depth, p.goal.type === 'mate') })
}
writeFileSync(new URL('../src/content/puzzles.json', import.meta.url), JSON.stringify(book, null, 0).replace(/\},\{/g, '},\n{'))
log('book', book.length, 'tiers', tiers.slice(1).map(t => t.length).join(' '))
for (let t = 1; t <= 10; t++) log('★' + t, tiers[t].map(p => `${p.total}/${p.solutions}@${p.score}`).join(' '))
void mated
