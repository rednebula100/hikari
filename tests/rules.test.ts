import test from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { fromFen, toFen, legal, make, perft, status, START, name, type Pos } from '../src/engine/rules.ts'

const uci = (p: Pos) => legal(p, 'classic').map(m => name(m.from) + name(m.to) + (m.promo ?? '')).sort()

test('perft: start position depth 1-4 matches FIDE reference', () => {
  const p = fromFen(START)
  assert.deepEqual([1, 2, 3, 4].map(d => perft(p, d)), [20, 400, 8902, 197281])
})

test('perft: Kiwipete and endgame reference positions (castling, en passant, promotion, pins)', () => {
  assert.deepEqual([1, 2, 3].map(d => perft(fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), d)), [48, 2039, 97862])
  assert.deepEqual([1, 2, 3, 4].map(d => perft(fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), d)), [14, 191, 2812, 43238])
  assert.deepEqual([1, 2, 3].map(d => perft(fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), d)), [6, 264, 9467])
})

test('oracle: legal moves equal chess.js across 1500 random positions', () => {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let checked = 0
  for (let g = 0; g < 30; g++) {
    const ref = new Chess()
    for (let ply = 0; ply < 120 && !ref.isGameOver(); ply++) {
      const p = fromFen(ref.fen())
      const expected = ref.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? '')).sort()
      assert.deepEqual(uci(p), expected, ref.fen())
      assert.equal(toFen(p), ref.fen())
      const st = status(p, 'classic')
      if (ref.isCheckmate()) assert.equal(st.over && st.reason, 'checkmate')
      if (ref.isStalemate()) assert.equal(st.over && st.reason, 'stalemate')
      const ms = ref.moves({ verbose: true })
      const m = ms[Math.floor(rnd() * ms.length)]
      ref.move(m)
      const mine = legal(p, 'classic').find(x => name(x.from) + name(x.to) + (x.promo ?? '') === m.from + m.to + (m.promotion ?? ''))!
      assert.equal(toFen(make(p, mine, 'classic').pos), ref.fen())
      checked++
    }
  }
  assert.ok(checked > 1500)
})
