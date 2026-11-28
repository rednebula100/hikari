import { test } from 'node:test'
import assert from 'node:assert/strict'
import { update, NEW_PLAYER } from '../src/glicko2.ts'

test("Glickman's worked example: 1500/200 vs 1400/30 (W), 1550/100 (L), 1700/300 (L)", () => {
  const r = update({ rating: 1500, rd: 200, vol: 0.06 }, [
    { opp: { rating: 1400, rd: 30, vol: .06 }, score: 1 },
    { opp: { rating: 1550, rd: 100, vol: .06 }, score: 0 },
    { opp: { rating: 1700, rd: 300, vol: .06 }, score: 0 },
  ])
  assert.ok(Math.abs(r.rating - 1464.06) < 0.1, String(r.rating))
  assert.ok(Math.abs(r.rd - 151.52) < 0.1, String(r.rd))
  assert.ok(Math.abs(r.vol - 0.05999) < 0.0001, String(r.vol))
})

test('two new players: winner gains what loser loses (symmetric), deviation shrinks', () => {
  const w = update(NEW_PLAYER, [{ opp: NEW_PLAYER, score: 1 }]), l = update(NEW_PLAYER, [{ opp: NEW_PLAYER, score: 0 }])
  assert.ok(w.rating > 1500 && l.rating < 1500)
  assert.ok(Math.abs((w.rating - 1500) + (l.rating - 1500)) < 1e-6)
  assert.ok(w.rd < 350)
  const d = update(NEW_PLAYER, [{ opp: NEW_PLAYER, score: .5 }])
  assert.ok(Math.abs(d.rating - 1500) < 1e-6)
})
