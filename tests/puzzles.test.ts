import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromFen, make } from '../src/engine/rules.ts'
import { playTarget, solveTarget, mated, defend, findMove, mateIn1, mateIn2Keys, type Puzzle } from '../src/content/puzzle.ts'
import BOOK from '../src/content/puzzles.json' with { type: 'json' }
import { legal } from '../src/engine/rules.ts'

const book = BOOK as Puzzle[]

test('the book has 100 problems, ten per tier, in order', () => {
  assert.equal(book.length, 100)
  for (let t = 1; t <= 10; t++) assert.equal(book.filter(p => p.tier === t).length, 10)
  book.forEach((p, i) => assert.equal(p.id, i + 1))
})

test('every target problem: stored solution solves it, counts match an exhaustive re-search, nothing shorter works', () => {
  for (const p of book.filter(p => p.goal.type !== 'mate')) {
    const r = playTarget(p.fen, p.goal, p.solution)
    assert.ok(r.legal && r.ok, `No. ${p.id} stored solution fails`)
    const s = solveTarget(p.fen, p.depth, p.goal)
    assert.equal(s.total, p.total, `No. ${p.id} total`)
    assert.equal(s.solutions, p.solutions, `No. ${p.id} solutions`)
    assert.ok(!s.shorter, `No. ${p.id} has a shorter solution`)
  }
})

test('mate problems: the key mates against the engine defence', () => {
  for (const p of book.filter(p => p.goal.type === 'mate')) {
    let pos = fromFen(p.fen)
    const key = findMove(legal(pos, 'clash'), p.solution[0])!
    assert.ok(key, `No. ${p.id} key illegal`)
    pos = make(pos, key, 'clash').pos
    if (p.depth === 1) { assert.ok(mated(pos), `No. ${p.id} not mate`); assert.equal(mateIn1(fromFen(p.fen)).length, p.solutions); continue }
    assert.ok(!mated(pos), `No. ${p.id} mates in 1`)
    const b = defend(pos)!
    pos = make(pos, b, 'clash').pos
    assert.ok(mateIn1(pos).length > 0, `No. ${p.id} defence ${JSON.stringify(b)} escapes`)
    assert.ok(mateIn2Keys(fromFen(p.fen), 1).keys.length === 1)
  }
})

test('★4 problems really are Newton traps', () => {
  for (const p of book.filter(p => p.tier === 4)) assert.ok(p.newton, `No. ${p.id}`)
})
