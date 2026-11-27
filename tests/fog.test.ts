import test from 'node:test'
import assert from 'node:assert/strict'
import { fromFen, name, parse, cheb, kingSq, START, type Pos, type Outcome } from '../src/engine/rules.ts'
import { sightings, belief, intentions, resolve, apply } from '../src/engine/fog.ts'
import { choose, rng } from '../src/engine/ai.ts'

function play(fen: string, moves: string[]) {
  const hist: Pos[] = [fromFen(fen)], outs: (Outcome | null)[] = []
  for (const mv of moves) {
    const p = hist.at(-1)!
    const bel = belief(p, sightings(hist, outs, p.turn), p.turn)
    const intent = intentions(bel).find(m => name(m.from) + name(m.to) === mv)
    assert.ok(intent, 'intent ' + mv)
    const r = apply(p, resolve(p, intent!))
    hist.push(r.pos); outs.push(r.out)
  }
  return { hist, outs }
}

test('光: a far piece is seen late (d-1 plies), an adjacent one live', () => {
  const { hist, outs } = play('4k3/r7/8/8/8/8/8/4K3 w - - 0 1', ['e1d1', 'a7b7'])
  const s = sightings(hist, outs, 'w').find(x => x.piece.kind === 'r')!
  assert.equal(name(s.sq), 'a7'); assert.equal(s.age, 1)
})

test('光: a slider fired into the fog stops at the real piece (collision), unseen', () => {
  const { hist, outs } = play('k7/8/8/2n5/8/8/8/R6K b - - 0 1', ['c5a4'])
  const p = hist.at(-1)!
  const bel = belief(p, sightings(hist, outs, 'w'), 'w')
  assert.equal(bel.board[parse('a4')], null, 'white does not see the knight yet')
  const shot = intentions(bel).find(m => name(m.from) === 'a1' && name(m.to) === 'a8')!
  const r = resolve(p, shot)
  assert.equal(r.kind, 'move'); assert.equal(r.kind === 'move' && name(r.move.to), 'a4')
})

test('光: blind pawn diagonal misses; the turn is spent', () => {
  const p = fromFen('4k3/8/8/8/8/8/1P6/4K3 w - - 0 1')
  const r = resolve(p, { from: parse('b2'), to: parse('c3'), kind: 'p', flag: 'c' })
  assert.equal(r.kind, 'miss')
  assert.equal(apply(p, r).pos.turn, 'b')
})

test('光: sightings never come from outside the light cone (random AI game)', () => {
  const hist: Pos[] = [fromFen(START)], outs: (Outcome | null)[] = [], rnd = rng(3)
  for (let i = 0; i < 70; i++) {
    const p = hist.at(-1)!
    if (kingSq(p, 'w') < 0 || kingSq(p, 'b') < 0) break
    const bel = belief(p, sightings(hist, outs, p.turn), p.turn)
    const m = choose(bel, 'clash', 1, rnd)
    if (!m) break
    const r = apply(p, resolve(p, m)); hist.push(r.pos); outs.push(r.out)
  }
  for (const side of ['w', 'b'] as const) for (const s of sightings(hist, outs, side)) {
    if (s.seenAt === 0) continue
    const ok = hist.some((h, n) => n >= s.seenAt && kingSq(h, side) >= 0 && n + 1 - s.seenAt >= cheb(s.sq, kingSq(h, side)))
      || outs.some((o, i) => o && i + 1 === s.seenAt)
    assert.ok(ok, side + ' saw ' + s.piece.id + ' too early')
  }
})
