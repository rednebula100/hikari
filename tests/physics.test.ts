import test from 'node:test'
import assert from 'node:assert/strict'
import { intercept, positionAt, properDuration, tauAt, causal, waveAt, wavePulses, WAVE_RECEIVER, pilotRatio, distance, retardedTime } from '../src/lab/physics.ts'
import type { Point, Leg } from '../src/lab/physics.ts'

const p = (x: number, z = 0): Point => ({ x, z })
const leg = (start: number, end: number, from: Point, to: Point): Leg => ({ start, end, from, to })
const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' != ' + expected)

test('PHY-01..04 and 14: static, receding, approaching, diagonal, collocated', () => {
  near(intercept(p(0), 0, p(3), []), 3)
  near(intercept(p(0), 0, p(2), [leg(0, 10, p(2), p(7))]), 4)
  near(intercept(p(0), 0, p(2), [leg(0, 4, p(2), p(0))]), 4 / 3)
  near(intercept(p(0), 1, p(3, 4), []), 6)
  near(intercept(p(0), 1, p(0), []), 1)
  near(intercept(p(0), 0, p(0), [leg(0, 4, p(0), p(2))]), 0)
})
test('PHY-05/06: proper time accumulates through waits and direction changes', () => {
  near(properDuration(10, .8), 6)
  near(tauAt([leg(0, 5, p(0), p(3))], 7), 6)
})
test('PHY-07..11: finite causal pulses and window-integrated pilot', () => {
  const same = wavePulses(0), opposite = wavePulses(180)
  near(waveAt(WAVE_RECEIVER, 3.999999, same), 0)
  near(waveAt(WAVE_RECEIVER, 4, same), 2 / 3)
  near(waveAt(WAVE_RECEIVER, 4, opposite), 0)
  near(waveAt(WAVE_RECEIVER, 5, same), 0)
  near(pilotRatio(WAVE_RECEIVER, same), 2)
  near(pilotRatio(WAVE_RECEIVER, opposite), 0)
  const shifted = [...opposite]
  shifted[1] = { ...shifted[1], emit: 3 }
  near(pilotRatio(WAVE_RECEIVER, shifted), 1)
  shifted[1] = { ...shifted[1], emit: 2.25, phase: Math.PI * 1.5 }
  near(pilotRatio(WAVE_RECEIVER, shifted), .5)
  assert.notEqual(waveAt(p(0, 0), 4, opposite), 0)
})
test('PHY-12/13/15: null bounds, path changes, spacelike events', () => {
  const source = p(0), receiver = p(6), relay = p(2, 2)
  const relayTime = intercept(source, 0, relay, []) + .25
  assert.ok(intercept(relay, relayTime, receiver, []) >= distance(source, receiver))
  const legs = [leg(0, 1, p(2), p(2.5)), leg(1, 5, p(2.5), p(.5))]
  near(intercept(source, 0, p(2), legs), 2)
  near(positionAt(p(2), legs, 2).x, 2)
  assert.equal(causal({ ...source, t: 1 }, { ...receiver, t: 4 }), false)
  assert.equal(causal({ ...source, t: 1 }, { ...receiver, t: 7 }), true)
})
test('coincident emission on a moving leg start, interior and reversing boundary', () => {
  const legs = [leg(2, 4, p(2), p(3)), leg(4, 6, p(3), p(2))]
  for (const t of [2, 3, 4, 5, 6]) near(intercept(positionAt(p(2), legs, t), t, p(2), legs), t)
})
test('retarded time is the past-light-cone intersection of the worldline', () => {
  const legs = [leg(1, 6, p(2), p(6))] // 0.8c away from the observer at x=0
  for (const t of [0.5, 3, 5, 9, 14]) {
    const s = retardedTime(p(0), t, p(2), legs)
    near(s + distance(positionAt(p(2), legs, s), p(0)), Math.max(t, 2), 1e-9)
  }
  near(retardedTime(p(0), 1, p(2), legs), 0) // before any light: public initial state
})
