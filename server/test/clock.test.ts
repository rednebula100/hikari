import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChessClock } from '../src/clock.ts'

test('Fischer clock: running side loses time, increment after the move, turn passes', () => {
  const c = new ChessClock(60_000, 2_000)
  c.start(0)
  assert.equal(c.remaining('w', 10_000), 50_000)
  assert.equal(c.remaining('b', 10_000), 60_000)
  assert.ok(c.press('w', 10_000))
  assert.equal(c.remaining('w', 10_000), 52_000)
  assert.equal(c.snapshot(10_000).turn, 'b')
  assert.ok(!c.press('w', 11_000), 'only the side to move may press')
  assert.ok(c.press('b', 15_000))
  assert.equal(c.remaining('b', 15_000), 57_000)
})

test('flag fall is detected and freezes the clock', () => {
  const c = new ChessClock(5_000)
  c.start(0)
  assert.equal(c.tick(4_999), null)
  assert.equal(c.tick(5_000), 'w')
  assert.ok(!c.press('w', 5_001))
  assert.equal(c.snapshot(9_000).w, 0)
  assert.equal(c.snapshot(9_000).running, false)
})

test('pause stops both clocks; resume continues from the stored time', () => {
  const c = new ChessClock(30_000)
  c.start(0); c.pause(10_000)
  assert.equal(c.remaining('w', 50_000), 20_000)
  c.start(50_000)
  assert.equal(c.remaining('w', 55_000), 15_000)
})
