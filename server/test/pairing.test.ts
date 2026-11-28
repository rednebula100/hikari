import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairUp, window_ } from '../src/lobby.ts'

const t = (uid: string, rating: number, tc: string, since: number) => ({ player: { uid, rating }, tc, since })

test('pairs only within the same time control and the rating window', () => {
  const q = [t('a', 1500, '5+3', 0), t('b', 1600, '5+3', 0), t('c', 1520, '3+2', 0)]
  const p = pairUp(q, 1000)
  assert.equal(p.length, 1)
  assert.deepEqual(p[0].map(x => x.player.uid).sort(), ['a', 'b'])
})

test('a wide gap waits, then pairs once both windows have grown', () => {
  const q = [t('a', 1500, '5+3', 0), t('b', 1900, '5+3', 0)]
  assert.equal(pairUp(q, 1000).length, 0)
  assert.equal(window_(20_000), 450)
  assert.equal(pairUp(q, 20_000).length, 1)
})

test('never pairs a uid with itself; prefers the closest rating', () => {
  const q = [t('a', 1500, '5+3', 0), t('a', 1500, '5+3', 1), t('b', 1640, '5+3', 2), t('c', 1530, '5+3', 3)]
  const p = pairUp(q, 4000)
  const first = p.find(x => x[0].player.uid === 'a')!
  assert.equal(first[1].player.uid, 'c')
})
