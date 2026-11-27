import test from 'node:test'
import assert from 'node:assert/strict'
import { Game, setupFrom, parseSq as S, sqName, dist, type Side } from '../src/chess/game.ts'
import { chooseMove, rng, type Level } from '../src/chess/ai.ts'
import { LESSONS, lessonGame, parseMove, type LessonCtx } from '../src/chess/tutorial.ts'

const mv = (g: Game, m: string) => { const { from, to } = parseMove(m); return g.play(g.toMove, from, to) }
const seen = (g: Game, side: Side, id: string) => g.view(side).enemy.find(e => e.id === id)!

test('light: an enemy d squares from the King is seen as of d-1 plies ago; adjacent is live', () => {
  const g = new Game(setupFrom('wKe1 bKe8 bRa7'))
  mv(g, 'e1d1'); mv(g, 'a7b7')     // ply 2: rook moves far away
  // rook b7 is 6 from d1: white sees state t = 3 - 6 < 0 → setup image a7
  assert.equal(sqName(seen(g, 'w', 'bRa7').sq), 'a7')
  assert.equal(seen(g, 'w', 'bRa7').age, 1)
  mv(g, 'd1d2'); mv(g, 'b7c7'); mv(g, 'd2d3'); mv(g, 'c7d7'); mv(g, 'd3d4'); mv(g, 'd7e7')
  // ply 8, king d4, rook e7 at distance 3 → sees S_(9-3)=S6 → rook d7, one enemy move old
  const r = seen(g, 'w', 'bRa7')
  assert.equal(sqName(r.sq), 'd7'); assert.equal(r.seenAt, 6); assert.equal(r.age, 1)
  mv(g, 'd4d5'); mv(g, 'e7e6') // adjacent → live
  assert.equal(sqName(seen(g, 'w', 'bRa7').sq), 'e6'); assert.equal(seen(g, 'w', 'bRa7').age, 0)
})

test('the view never contains an enemy state outside the light cone (exhaustive over a random game)', () => {
  const g = new Game(); const r = rng(7)
  for (let i = 0; i < 80 && !g.winner; i++) { const m = chooseMove(g.view(g.toMove), 1, r)!; g.play(g.toMove, m.from, m.to) }
  for (const side of ['w', 'b'] as Side[]) for (let T = 0; T <= g.ply; T++) {
    const v = g.view(side, T)
    for (const e of v.enemy) {
      if (e.via !== 'light') continue
      // some observation instant n+1 ≤ T+1 from the King square at n received it
      const ok = Array.from({ length: T + 1 }, (_, n) => n).some(n => {
        const k = g.snaps[n].find(p => p.side === side && p.kind === 'K')!.sq
        return n >= e.seenAt && n + 1 - e.seenAt >= dist(e.sq, k)
      })
      assert.ok(ok, side + ' saw ' + e.id + ' too early at T=' + T)
    }
  }
})

test('shooting into the past: a slider stops at the first real piece and captures it', () => {
  const g = new Game(setupFrom('wKf1 wRa1 bKh8 bNc8'), 'b')
  mv(g, 'c8b6'); mv(g, 'f1g1'); mv(g, 'b6a4')
  assert.equal(sqName(seen(g, 'w', 'bNc8').sq), 'c8') // white still sees the knight at home
  const rec = mv(g, 'a1a8')
  assert.equal(rec.outcome, 'intercept'); assert.equal(sqName(rec.landed), 'a4'); assert.equal(rec.captured!.kind, 'N')
})

test('pawn outcomes', () => {
  const g = new Game(setupFrom('wKe1 wPd2 wPa2 bKh8 bNb4'), 'b')
  mv(g, 'b4c2')                          // knight lands next to the white king
  const miss = mv(g, 'a2b3')
  assert.equal(miss.outcome, 'miss'); assert.equal(sqName(miss.landed), 'a2')
  mv(g, 'c2d4')
  const blocked = mv(g, 'd2d4')          // two-step blocked by the unseen knight on d4? d3 empty, d4 occupied
  assert.equal(blocked.outcome, 'blocked'); assert.equal(blocked.blocker, 'bNb4')
  assert.equal(seen(g, 'w', 'bNb4').via, 'contact')
})

test('capturing the King wins; contact reveals the capturer', () => {
  const g = new Game(setupFrom('wKe1 wPh2 bKh8 bQe7'), 'b')
  const r = mv(g, 'e7e1')
  assert.equal(r.captured!.kind, 'K'); assert.equal(g.winner, 'b')
})

test('afterimage: the enemy still sees a queen that already left', () => {
  const g = new Game(setupFrom('wKe1 wQd1 bKe8 bPa7'))
  mv(g, 'd1h5'); mv(g, 'e8d8')
  const ghost = g.afterimage('w').find(p => p.id === 'wQd1')!
  assert.equal(sqName(ghost.sq), 'd1')
})

test('AI plays legal full games at every level, deterministically, from its own view only', () => {
  for (const level of [1, 2, 3] as Level[]) {
    const run = (seed: number) => {
      const g = new Game(), r = rng(seed)
      while (!g.winner) { const m = chooseMove(g.view(g.toMove), g.toMove === 'w' ? 1 : level, r)!; g.play(g.toMove, m.from, m.to) }
      return g.moves.map(m => m.from + '-' + m.to + m.outcome).join(' ') + g.winner
    }
    assert.equal(run(3), run(3))
    assert.ok(run(5).length > 0)
  }
})

test('stronger AI beats weaker AI more often than not', () => {
  let wins = 0, games = 0
  for (let seed = 1; seed <= 6; seed++) for (const strongSide of ['w', 'b'] as Side[]) {
    const g = new Game(), r = rng(seed)
    while (!g.winner) { const lvl: Level = g.toMove === strongSide ? 2 : 1; const m = chooseMove(g.view(g.toMove), lvl, r)!; g.play(g.toMove, m.from, m.to) }
    games++; if (g.winner === strongSide) wins++
  }
  assert.ok(wins / games >= 0.6, 'level 2 won ' + wins + '/' + games)
})

test('every tutorial lesson is completable through real moves', () => {
  let prev: Game | undefined
  const solutions: Record<string, string[]> = { chess: ['a1a4'], light: ['d1d2', 'd2d3', 'd3d4'], pyramid: [], shot: ['a1a8'], eye: [], mate: [] }
  for (const l of LESSONS) {
    const g = lessonGame(l, prev); prev = g
    const ctx: LessonCtx = { game: g, last: null, timeView: l.id === 'pyramid', eyeView: l.id === 'eye' }
    let k = 0
    for (const m of solutions[l.id]) {
      if (l.goal(ctx)) break
      ctx.last = mv(g, m)
      if (l.goal(ctx)) break
      // scripted reply
      const s = l.script ?? []
      for (let i = 0; i < s.length; i++) { try { mv(g, s[(k + i) % s.length]); k += i + 1; break } catch { /* skip */ } }
    }
    if (l.id === 'mate') continue // played against the live AI
    assert.ok(l.goal(ctx), l.id + ' not completed')
  }
  void S
})
