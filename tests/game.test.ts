import test from 'node:test'
import assert from 'node:assert/strict'
import { Sim, RULES, ORIGIN, type Packet, type Speed, type Action } from '../src/game/sim.ts'
import { knowledge, causalLock } from '../src/game/knowledge.ts'
import { Match } from '../src/game/match.ts'
import { SKIRMISH, TRIALS, trialById } from '../src/game/scenarios.ts'
import { distance, attenuation, OMEGA } from '../src/game/physics.ts'

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, a + ' != ' + b)
let seq = 0
const pk = (unitId: string, emit: number, actions: Action[], team: 'blue' | 'red' = 'blue'): Packet => ({ id: 'p' + (++seq), team, unitId, emit, seq, actions })
const move = (x: number, z: number, speed: Speed = 0.6): Action => ({ type: 'move', to: { x, z }, speed })

function runTrial(id: string, rounds: Record<number, Packet[]>) {
  const trial = trialById(id)!
  const m = new Match(trial.def, { trial })
  while (m.phase !== 'finished') {
    m.commit(rounds[m.roundStart] ?? [])
    m.resolveTo(m.roundEnd)
  }
  return m.verdict()!
}

test('command delay: nothing moves before the light arrives; then the courier calibrates in proper time', () => {
  const s = new Sim(SKIRMISH)
  s.submit(pk('blue-courier-a', 0, [move(4, 4, 0.6)]))
  s.advanceTo(2.2)
  assert.deepEqual(s.positionAt('blue-courier-a', 2.2), { x: 1, z: 2 })
  s.advanceTo(20)
  const recv = s.log.find(e => e.kind === 'cmd-recv' && e.unitId === 'blue-courier-a')!
  near(recv.t, Math.sqrt(5))
  const ready = s.log.find(e => e.kind === 'ready' && e.unitId === 'blue-courier-a')!
  const travel = Math.sqrt(13) / 0.6
  near(ready.t, Math.sqrt(5) + travel + (5 - travel * 0.8))
  const firstData = s.log.find(e => e.kind === 'data-emit' && e.team === 'blue')!
  near(firstData.t, ready.t + 3)
  const score = s.log.find(e => e.kind === 'score' && e.team === 'blue')!
  near(score.t, firstData.t + 4 + 0.5)
})

test('newest program wins regardless of arrival order; MOVE is never interrupted mid-leg', () => {
  const s = new Sim(SKIRMISH)
  s.submit(pk('blue-courier-a', 0, [move(5, 2, 0.4)]))
  s.submit(pk('blue-courier-a', 1, [move(1, 0, 0.8)]))
  s.advanceTo(30)
  const legs = s.legs('blue-courier-a')
  assert.equal(legs.length, 2)
  assert.deepEqual(legs[0].to, { x: 5, z: 2 })
  assert.deepEqual(legs[1].to, { x: 1, z: 0 })
  near(legs[1].start, legs[0].end)
})

test('majority control: 1v1 contested halts production, 2v1 wins it', () => {
  const s = new Sim({ ...SKIRMISH, id: 'x' })
  s.submit(pk('blue-courier-a', 0, [move(4, 4)]))
  s.submit(pk('blue-courier-b', 0, [move(4, 4)]))
  s.submit(pk('red-courier-a', 0, [move(4, 4)], 'red'))
  s.advanceTo(48)
  const ctrl = s.log.filter(e => e.kind === 'control' && e.nexusId === 'nexus-ii').map(e => e.info!.controller)
  assert.equal(ctrl.at(-1), 'blue')
  assert.ok(s.log.filter(e => e.kind === 'data-emit' && e.team === 'red').length === 0)
  assert.ok(s.score.blue > 5)
})

test('information isolation: enemy state is only the retarded image; enemy command contents are hidden', () => {
  const s = new Sim(SKIRMISH)
  s.submit(pk('red-courier-a', 0, [move(4, 1, 0.8)], 'red'))
  s.advanceTo(9)
  const k = knowledge(s, 'blue')
  const seen = k.units.find(u => u.id === 'red-courier-a')!
  near(seen.seenAt + distance(seen.pos, ORIGIN.blue), 9, 1e-7)
  assert.ok(seen.seenAt < 9)
  for (const e of k.events) assert.ok(e.t + distance(e.pos, ORIGIN.blue) <= 9 + 1e-9)
  const flash = k.signals.find(x => x.kind === 'command' && x.team === 'red')!
  assert.equal(flash.unitId, undefined)
  // a red event outside the past cone is absent
  const late = s.log.filter(e => e.team === 'red' && e.t + distance(e.pos, ORIGIN.blue) > 9)
  assert.ok(late.length > 0 && late.every(e => !k.events.some(x => x.id === e.id)))
})

test('causal lock is a true lower bound against every courier order', () => {
  const s = new Sim(SKIRMISH)
  s.advanceTo(6)
  const k = knowledge(s, 'blue')
  for (const node of [{ x: 4, z: 1 }, { x: 4, z: 4 }, { x: 4, z: 7 }]) {
    const lock = causalLock(k, node).t
    for (const sp of RULES.speeds) for (const unit of ['red-courier-a', 'red-courier-b']) {
      const t = new Sim(SKIRMISH)
      t.submit(pk(unit, 0, [{ type: 'move', to: node, speed: sp }], 'red'))
      t.advanceTo(40)
      const r = t.log.find(e => e.kind === 'ready' && e.unitId === unit)!
      assert.ok(r.t >= lock - 1e-9, unit + ' ' + sp + ' ready ' + r.t + ' < lock ' + lock)
    }
  }
})

test('phase eclipse in the engine: an exact anti-phase pulse destroys a packet; a mistimed one does not', () => {
  const trial = trialById('silent-receiver')!
  const aD = 19, dS = Math.hypot(3, 2), at = 15
  const phase = (((180 + 360 * (at + dS - aD)) % 360) + 360) % 360
  const q = Math.round(phase / 15) * 15
  const run = (ph: number) => {
    const s = new Sim(trial.def)
    s.advanceTo(8)
    s.submit(pk('blue-phaser', 8, [{ type: 'pulse', at, target: { x: 8, z: 4 }, channel: 'red', phase: ph, amplitude: 1 }]))
    s.advanceTo(26)
    return s.log.filter(e => e.kind === 'data-fail' && e.team === 'red')
  }
  const hit = run(q)
  assert.equal(hit.length, 1)
  assert.ok((hit[0].info!.R as number) < 0.4)
  assert.equal(run((q + 180) % 360).length, 0)
  near(attenuation(dS), 1 / (1 + dS / 2))
  assert.ok(OMEGA > 0)
})

test('trial solutions verified by the engine', () => {
  assert.equal(TRIALS.length, 4)
  // I — any single order works
  assert.ok(runTrial('first-light', { 0: [pk('blue-courier-a', 0, [move(4, 1)])] }).ok)
  // II — only 0.6c to the centre is fast enough in calibrated time
  assert.ok(runTrial('two-clocks', { 0: [pk('blue-courier-a', 0, [move(4, 4, 0.6)])] }).ok)
  assert.ok(!runTrial('two-clocks', { 0: [pk('blue-courier-a', 0, [move(4, 4, 0.8)])] }).ok)
  assert.ok(!runTrial('two-clocks', { 0: [pk('blue-courier-a', 0, [move(4, 1, 0.6)])] }).ok)
  // III — both couriers for majority; one alone only contests
  assert.ok(runTrial('majority', { 0: [pk('blue-courier-a', 0, [move(4, 4)]), pk('blue-courier-b', 0, [move(4, 4)])] }).ok)
  assert.ok(!runTrial('majority', { 0: [pk('blue-courier-a', 0, [move(4, 4)])] }).ok)
  assert.ok(!runTrial('majority', { 0: [pk('blue-courier-a', 0, [move(4, 4, 0.4)]), pk('blue-courier-b', 0, [move(4, 4, 0.4)])] }).ok)
  // IV — three timed eclipses in one transmission
  const dS = Math.hypot(3, 2)
  const pulses: Action[] = [[15, 19], [18, 22], [21, 25]].map(([at, aD]) => ({
    type: 'pulse', at, target: { x: 8, z: 4 }, channel: 'red', amplitude: 1,
    phase: Math.round((((180 + 360 * (at + dS - aD)) % 360 + 360) % 360) / 15) * 15 % 360,
  }))
  assert.ok(runTrial('silent-receiver', { 8: [pk('blue-phaser', 8, pulses)] }).ok)
  assert.ok(!runTrial('silent-receiver', { 8: [pk('blue-phaser', 8, pulses.slice(0, 2))] }).ok)
})

test('II has a unique speed/target answer among all single orders', () => {
  const wins: string[] = []
  for (const unit of ['blue-courier-a', 'blue-courier-b']) for (const sp of RULES.speeds) for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) {
    if (!runTrial('two-clocks', { 0: [pk(unit, 0, [move(x, z, sp)])] }).ok) continue
    wins.push(unit + ' ' + x + ',' + z + ' ' + sp)
  }
  assert.deepEqual(wins, ['blue-courier-a 4,4 0.6', 'blue-courier-b 4,4 0.6'])
})

test('AI skirmish: deterministic, legal, and stronger levels beat an idle opponent', () => {
  const play = (level: 1 | 2 | 3) => {
    const m = new Match(SKIRMISH, { ai: level })
    while (m.phase !== 'finished') { m.commit([]); m.resolveTo(m.roundEnd) }
    return m.reveal()!
  }
  for (const level of [1, 2, 3] as const) {
    const a = play(level), b = play(level)
    assert.deepEqual(a.score, b.score)
    assert.deepEqual(a.log.map(e => e.kind + e.t), b.log.map(e => e.kind + e.t))
    assert.ok(a.score.red >= 6, 'level ' + level + ' scored ' + a.score.red)
  }
})

test('mirror symmetry: mirrored orders give mirrored scores', () => {
  const s = new Sim(SKIRMISH)
  s.submit(pk('blue-courier-a', 0, [move(4, 1)]))
  s.submit(pk('red-courier-a', 0, [move(4, 1)], 'red'))
  s.submit(pk('blue-courier-b', 0.5, [move(4, 7, 0.8)]))
  s.submit(pk('red-courier-b', 0.5, [move(4, 7, 0.8)], 'red'))
  s.advanceTo(48)
  assert.equal(s.score.blue, s.score.red)
})

test('SKEW delays the next packet of a producing NEXUS and is invalid elsewhere', () => {
  const run = (skew: boolean) => {
    const s = new Sim(SKIRMISH)
    s.submit(pk('blue-courier-a', 0, [move(4, 4, 0.6)]))
    if (skew) s.submit(pk('blue-courier-a', 10, [{ type: 'skew', seconds: 1.5 }]))
    s.advanceTo(20)
    return s.log.filter(e => e.kind === 'data-emit' && e.team === 'blue').map(e => e.t)
  }
  const plain = run(false), skewed = run(true)
  // the order (emitted T10) reaches the courier at T14: the first packet is untouched
  near(skewed[0], plain[0])
  near(skewed[1], plain[1] + 1.5)
  near(skewed[2] - skewed[1], 3)
  const s = new Sim(SKIRMISH)
  s.submit(pk('blue-courier-a', 0, [{ type: 'skew', seconds: 1 }]))
  s.advanceTo(5)
  assert.ok(s.log.some(e => e.kind === 'invalid' && e.info?.reason === 'not-producing'))
})
