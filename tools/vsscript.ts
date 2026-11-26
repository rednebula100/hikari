import { Match } from '../src/game/match.ts'
import { SKIRMISH } from '../src/game/scenarios.ts'
const strategies: Record<string, any[]> = {
  idle: [],
  flanks: [{unitId:'blue-courier-a',a:[{type:'move',to:{x:4,z:1},speed:0.6}]},{unitId:'blue-courier-b',a:[{type:'move',to:{x:4,z:7},speed:0.6}]}],
  center2: [{unitId:'blue-courier-a',a:[{type:'move',to:{x:4,z:4},speed:0.6}]},{unitId:'blue-courier-b',a:[{type:'move',to:{x:4,z:4},speed:0.6}]}],
  centerFlank: [{unitId:'blue-courier-a',a:[{type:'move',to:{x:4,z:1},speed:0.6}]},{unitId:'blue-courier-b',a:[{type:'move',to:{x:4,z:4},speed:0.6}]}],
}
for (const lvl of [1,2,3] as const) for (const [name, orders] of Object.entries(strategies)) {
  const m = new Match(SKIRMISH, { ai: lvl })
  let i = 0
  while (m.phase !== 'finished') {
    m.commit(m.roundStart === 0 ? orders.map(o => ({ id: 'b' + (++i), team: 'blue', unitId: o.unitId, emit: 0, seq: i, actions: o.a })) : [])
    m.resolveTo(m.roundEnd)
  }
  const s = m.reveal()!
  console.log('AI' + lvl, name.padEnd(12), s.score.blue + '-' + s.score.red, 'redPulses', s.log.filter(e=>e.kind==='pulse'&&e.team==='red').length, 'blueEclipsed', s.log.filter(e=>e.kind==='data-fail'&&e.team==='blue').length)
}
