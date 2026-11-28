import test from 'node:test'
import assert from 'node:assert/strict'
import { fromFen, legal, make, inCheck, name, parse } from '../src/engine/rules.ts'
import { EXPERIMENTS } from '../src/engine/lessons.ts'

const run = (id: string, newton = false) => {
  const e = EXPERIMENTS.find(x => x.id === id)!
  const p = fromFen(e.fen)
  const m = legal(p, 'clash').find(x => name(x.from) === e.move[0] && name(x.to) === e.move[1])
  assert.ok(m, id + ': intended move is legal')
  return { p, ...make(p, m!, 'clash', { newton }) }
}

test('every experiment move is legal and the stated answer is what the engine does', () => {
  run('move')
  assert.deepEqual(run('heavy').out.removed.map(x => x.kind), ['p'])
  const c = run('cradle')
  assert.deepEqual(c.out.removed.map(x => name(parse('g1')) && x.id), ['brg1'])
  assert.equal(c.pos.board[parse('f1')]?.id, 'brf1')
  const b = run('bounce')
  assert.equal(b.pos.board[parse('c3')]?.kind, 'q'); assert.equal(b.pos.board[parse('a1')]?.kind, 'p')
  assert.equal(run('stomp').out.stomp?.victim.kind, 'b')
  assert.deepEqual(run('shock').out.shock, [{ id: 'bra5', from: parse('a5'), to: null }])
  assert.equal(run('phalanx').out.removed.length, 0, 'the neighbour holds the pawn on the board')
  const co = run('collapse'); assert.deepEqual(co.out.collapse?.[0].gone.map(g => g.id), ['bph7']); assert.equal(co.pos.fallen, 1)
    const cu = run('cushion'); assert.equal(cu.out.clash?.run, 6); assert.deepEqual(cu.out.removed.map(x => x.kind), ['p'])
  assert.ok(inCheck(fromFen(EXPERIMENTS.find(x => x.id === 'cliff')!.fen), 'clash'))
  assert.equal(run('light').out.removed.length, 0, 'relativity keeps the pawn on the board')
  assert.deepEqual(run('light', true).out.removed.map(x => x.kind), ['p'], 'Newton would have knocked it off')
})
