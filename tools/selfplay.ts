import { Sim, RULES } from '../src/game/sim.ts'
import { knowledge } from '../src/game/knowledge.ts'
import { aiRound, newAI } from '../src/game/ai.ts'
import { SKIRMISH } from '../src/game/scenarios.ts'
for (const [lb, lr] of [[1,1],[2,1],[1,2],[2,2],[3,2],[2,3],[3,3],[1,3]] as const) {
  const s = new Sim(SKIRMISH), b = newAI("blue", lb, 7), r = newAI("red", lr, 11)
  for (let t = 0; t < 48; t += RULES.round) {
    for (const p of [...aiRound(SKIRMISH, knowledge(s,'blue'), b), ...aiRound(SKIRMISH, knowledge(s,'red'), r)]) s.submit(p)
    s.advanceTo(t + RULES.round)
  }
  const c = (k: string, team: string) => s.log.filter(e => e.kind === k && e.team === team).length
  console.log(`B${lb} vs R${lr}: ${s.score.blue}-${s.score.red}  pulses ${c('pulse','blue')}/${c('pulse','red')} eclipsed ${c('data-fail','blue')}/${c('data-fail','red')} contests ${s.log.filter(e=>e.kind==='control'&&e.info?.controller==='contested').length} moves ${c('move','blue')}/${c('move','red')}`)
}
