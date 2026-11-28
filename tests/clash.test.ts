import test from 'node:test'
import assert from 'node:assert/strict'
import { C, collide, simulateLine, momentum, energy } from '../src/engine/collide.ts'
import { fromFen, legal, make, inCheck, kingSq, name, parse, status, perft, START, type Pos, type Move } from '../src/engine/rules.ts'

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, a + ' != ' + b)
const find = (p: Pos, from: string, to: string): Move => {
  const m = legal(p, 'clash').find(x => name(x.from) === from && name(x.to) === to)
  assert.ok(m, 'no legal ' + from + to); return m!
}

test('collide: classical limit, conservation, and the speed of light', () => {
  const [a, b] = collide(5, 0.001, 1, 0)
  const [na, nb] = collide(5, 0.001, 1, 0, C, true)
  near(a, na, 1e-9); near(b, nb, 1e-9)
  for (const [m1, m2, v] of [[9, 1, 3.5], [1, 9, 3.5], [3, 3, 2.5], [10, 5, 3.9]]) {
    const [u1, u2] = collide(m1, v, m2, 0)
    near(momentum(m1, v) , momentum(m1, u1) + momentum(m2, u2), 1e-9)
    near(energy(m1, v) + energy(m2, 0), energy(m1, u1) + energy(m2, u2), 1e-6)
    assert.ok(Math.abs(u1) < C && Math.abs(u2) < C)
  }
  // equal masses swap velocities exactly (Newton's cradle)
  const [e1, e2] = collide(3, 2, 3, 0); near(e1, 0, 1e-12); near(e2, 2, 1e-12)
})

test('line simulation: Newton cradle passes momentum to the far end; totals conserved', () => {
  const r = simulateLine([{ id: 'a', mass: 1, s: 0, v: 2 }, { id: 'b', mass: 1, s: 1, v: 0 }, { id: 'c', mass: 1, s: 2, v: 0 }, { id: 'd', mass: 1, s: 3, v: 0 }], 8)
  assert.deepEqual([...r.final.entries()], [['a', 0], ['b', 1], ['c', 2], ['d', 5]])
  near(r.p0, r.p1, 1e-9); near(r.e0, r.e1, 1e-6)
  // a body leaving the board keeps its momentum in the books
  const out = simulateLine([{ id: 'q', mass: 9, s: 4, v: 3.5 }, { id: 'p', mass: 1, s: 5, v: 0 }], 8)
  assert.equal(out.final.get('p'), null)
  near(out.p0, out.p1, 1e-9)
})

test('衝: rook rams a pawn off the board and follows through; a queen at full run overshoots', () => {
  const p = fromFen('4k3/8/p7/8/8/8/8/R3K3 w - - 0 1')
  const { pos, out } = make(p, find(p, 'a1', 'a6'), 'clash')
  assert.deepEqual(out.removed.map(x => x.kind), ['p'])
  const rook = pos.board.findIndex(x => x?.kind === 'r')
  assert.ok(rook > parse('a5'), 'rook followed through to ' + name(rook))
  const q = fromFen('p3k3/8/8/8/8/8/8/Q3K3 w - - 0 1')
  assert.deepEqual(make(q, find(q, 'a1', 'a8'), 'clash').out.removed.map(x => x.kind).sort(), ['p', 'q'])
})

test('衝: light piece bounces off a heavy one', () => {
  const p = fromFen('4k3/8/8/8/8/2q5/1P6/7K w - - 0 1')
  const { pos, out } = make(p, find(p, 'b2', 'c3'), 'clash')
  assert.equal(out.removed.length, 0)
  assert.equal(pos.board[parse('c3')]?.kind, 'q', 'queen barely moves')
  assert.equal(pos.board[parse('a1')]?.kind, 'p', 'pawn bounced back down the diagonal')
})

test('衝: knight stomps (classic removal); a chain can knock your own piece off', () => {
  const p = fromFen('4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1')
  const { pos, out } = make(p, find(p, 'e3', 'd5'), 'clash')
  assert.equal(out.stomp?.victim.kind, 'p'); assert.equal(pos.board[parse('d5')]?.kind, 'n')
  const q = fromFen('4k3/8/8/8/8/8/K7/R4rR1 w - - 0 1')
  const r = make(q, find(q, 'a1', 'f1'), 'clash')
  assert.ok(r.out.removed.some(x => x.id === 'wrg1'), 'own rook flew off the far end: ' + r.out.removed.map(x => x.id))
  assert.equal(r.pos.board[parse('f1')]?.id, 'brf1', 'equal masses: the struck rook stops')
})

test('衝 check is physical: a corner king facing a long queen run is in check; a centre king shoved 2 squares is not', () => {
  const corner = fromFen('k7/8/8/8/8/8/8/K6q w - - 0 1')
  assert.ok(inCheck(corner, 'clash'))
  assert.ok(legal(corner, 'clash').every(m => kingSq(make(corner, m, 'clash').pos, 'w') >= 0))
  const centre = fromFen('4k3/8/8/8/8/8/8/R3K2r w - - 0 1')
  assert.ok(!inCheck(centre, 'clash'), 'rook(5) at speed 3 only shoves a king(10) two squares')
})

test('衝 fuzz: random games keep invariants (kings on board, one piece per square, ends cleanly)', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let removed = 0, clashes = 0
  for (let g = 0; g < 12; g++) {
    let p = fromFen(START)
    const hist: string[] = []
    for (let ply = 0; ply < 160; ply++) {
      const st = status(p, 'clash', hist)
      if (st.over) break
      const ms = legal(p, 'clash')
      const m = ms[Math.floor(rnd() * ms.length)]
      const r = make(p, m, 'clash')
      if (r.out.clash) clashes++
      removed += r.out.removed.length
      p = r.pos
      if (kingSq(p, 'w') < 0 || kingSq(p, 'b') < 0) { assert.equal(status(p, 'clash', hist).over, true); break } // a king fell with the collapsing ring
      const ids = p.board.filter(Boolean).map(x => x!.id)
      assert.equal(new Set(ids).size, ids.length)
    }
  }
  assert.ok(clashes > 10 && removed > 5, 'clashes ' + clashes + ' removed ' + removed)
})

test('衝 move counts match chess for the first two plies', () => {
  const p = fromFen(START)
  assert.equal(perft(p, 2, 'clash'), 400)
})
