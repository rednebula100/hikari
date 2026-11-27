import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromFen, make, legal, parse, type Pos } from '../src/engine/rules.ts'
import { detect, newTally, ENTRIES } from '../src/content/codex.ts'

const run = (fen: string, from: string, to: string) => {
  const p: Pos = fromFen(fen)
  const m = legal(p, 'clash').find(x => x.from === parse(from) && x.to === parse(to))!
  assert.ok(m, from + to)
  return detect(p, make(p, m, 'clash').out, p.turn, newTally())
}

test('53 entries with unique ids and numbers', () => {
  assert.equal(ENTRIES.length, 53)
  assert.equal(new Set(ENTRIES.map(e => e.id)).size, 53)
})
test('Newton cradle: rook into two rooks', () => {
  const h = run('7k/8/8/8/8/8/7K/R4rr1 w - - 0 1', 'a1', 'f1')
  for (const id of ['first', 'cradle', 'exchange', 'runup']) assert.ok(h.includes(id), id + ' in ' + h)
})
test('bounce: pawn into queen', () => {
  const h = run('7k/8/8/8/8/2q5/1P6/7K w - - 0 1', 'b2', 'c3')
  assert.ok(h.includes('bounce') && h.includes('pawnhit') && h.includes('wall'), String(h))
})
test('knight stomp', () => {
  const h = run('7k/8/8/3b4/8/4N3/8/7K w - - 0 1', 'e3', 'd5')
  assert.ok(h.includes('stomp'), String(h))
})
test('Newton was wrong (tutorial experiment 7)', () => {
  const h = run('k7/8/8/8/8/8/K7/2Q1p3 w - - 0 1', 'c1', 'e1')
  assert.ok(h.includes('newton'), String(h))
})
test('abilities: shockwave, cushion, phalanx', () => {
  const s = run('7k/8/8/r7/8/2N5/8/7K w - - 0 1', 'c3', 'b5'); assert.ok(s.includes('shock') && s.includes('shockout'), String(s))
  const c = run('7k/2p5/8/8/8/8/8/4B2K w - - 0 1', 'e1', 'c7'); assert.ok(c.includes('cushion'), String(c))
  const f = run('7k/8/8/8/2ppp3/8/8/2R4K w - - 0 1', 'c1', 'c4'); assert.ok(f.includes('phalanx'), String(f))
})
