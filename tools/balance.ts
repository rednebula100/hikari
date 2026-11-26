// Seeded AI-vs-AI balance harness. Bots are not humans: these numbers find
// degenerate rules and dead mechanics; they do not measure fun.
import { Sim, RULES, withRules, type Team } from '../src/game/sim.ts'
import { knowledge } from '../src/game/knowledge.ts'
import { aiRound, newAI, type AILevel } from '../src/game/ai.ts'
import { SKIRMISH } from '../src/game/scenarios.ts'

export function play(lb: AILevel, lr: AILevel, seed: number) {
  const s = new Sim(SKIRMISH), b = newAI('blue', lb, seed * 2 + 1), r = newAI('red', lr, seed * 2 + 2)
  for (let t = 0; t < SKIRMISH.duration; t += RULES.round) {
    for (const p of [...aiRound(SKIRMISH, knowledge(s, 'blue'), b), ...aiRound(SKIRMISH, knowledge(s, 'red'), r)]) s.submit(p)
    s.advanceTo(t + RULES.round)
  }
  return s
}
export function metrics(s: Sim) {
  const c = (k: string, team: Team) => s.log.filter(e => e.kind === k && e.team === team).length
  const speeds: Record<string, number> = {}
  for (const e of s.log) if (e.kind === 'move' && e.unitId?.includes('courier')) speeds[String(e.info!.speed)] = (speeds[String(e.info!.speed)] ?? 0) + 1
  // seconds each control state held, summed over nexus
  const held = { blue: 0, red: 0, contested: 0, none: 0 }
  for (const id of ['nexus-i', 'nexus-ii', 'nexus-iii']) {
    const ev = s.log.filter(e => e.kind === 'control' && e.nexusId === id)
    let last = 0, state = 'none'
    for (const e of ev) { held[state as keyof typeof held] += e.t - last; last = e.t; state = String(e.info!.controller ?? 'none') }
    held[state as keyof typeof held] += s.def.duration - last
  }
  return { blue: s.score.blue, red: s.score.red, pulses: [c('pulse', 'blue'), c('pulse', 'red')], eclipsed: [c('data-fail', 'red'), c('data-fail', 'blue')],
    routes: c('route', 'blue') + c('route', 'red'), speeds, held, firstScore: s.log.find(e => e.kind === 'score')?.t ?? NaN }
}
export function matrix(seeds = 30, label = '') {
  const L: AILevel[] = [1, 2, 3]
  const out: string[] = [label]
  const agg = { speeds: {} as Record<string, number>, held: { blue: 0, red: 0, contested: 0, none: 0 }, pulses: 0, hits: 0, draws: 0, games: 0, margin: 0 }
  for (const lb of L) for (const lr of L) {
    let bw = 0, rw = 0, d = 0, sb = 0, sr = 0
    for (let i = 1; i <= seeds; i++) {
      const m = metrics(play(lb, lr, i))
      sb += m.blue; sr += m.red; if (m.blue > m.red) bw++; else if (m.red > m.blue) rw++; else d++
      for (const [k, v] of Object.entries(m.speeds)) agg.speeds[k] = (agg.speeds[k] ?? 0) + v
      for (const k of Object.keys(agg.held) as (keyof typeof agg.held)[]) agg.held[k] += m.held[k]
      agg.pulses += m.pulses[0] + m.pulses[1]; agg.hits += m.eclipsed[0] + m.eclipsed[1]; agg.games++; agg.margin += Math.abs(m.blue - m.red)
    }
    agg.draws += d
    out.push(`B${lb} vs R${lr}: blue ${bw} / red ${rw} / draw ${d}   avg ${(sb / seeds).toFixed(1)}-${(sr / seeds).toFixed(1)}`)
  }
  const H = agg.held, tot = H.blue + H.red + H.contested + H.none
  out.push(`speeds ${JSON.stringify(agg.speeds)}  nexus time: excl ${(100 * (H.blue + H.red) / tot).toFixed(0)}% shared ${(100 * H.contested / tot).toFixed(0)}% empty ${(100 * H.none / tot).toFixed(0)}%`)
  out.push(`pulses ${agg.pulses}, eclipses ${agg.hits} (${(agg.hits / Math.max(1, agg.pulses)).toFixed(2)}/pulse), draws ${agg.draws}/${agg.games}, avg |margin| ${(agg.margin / agg.games).toFixed(2)}`)
  return out.join('\n')
}
if (process.argv[1]?.endsWith('balance.ts') && process.argv[2] !== 'sweep' && process.argv[2] !== 'ties') {
  const seeds = Number(process.argv[2] ?? 20)
  console.log(matrix(seeds, '== baseline =='))
  void withRules
}

export function duel(pairs: [AILevel, AILevel][], seeds: number) {
  const rows: string[] = []
  let pulses = 0, hits = 0, draws = 0, games = 0, skews = 0
  for (const [lb, lr] of pairs) {
    let bw = 0, rw = 0, d = 0, sb = 0, sr = 0
    for (let i = 1; i <= seeds; i++) {
      const s = play(lb, lr, i), m = metrics(s)
      sb += m.blue; sr += m.red; if (m.blue > m.red) bw++; else if (m.red > m.blue) rw++; else d++
      pulses += m.pulses[0] + m.pulses[1]; hits += m.eclipsed[0] + m.eclipsed[1]; games++
      skews += s.log.filter(e => e.kind === 'skew').length
    }
    draws += d
    rows.push(`  B${lb}vR${lr}: ${bw}/${rw}/${d}  ${(sb / seeds).toFixed(1)}-${(sr / seeds).toFixed(1)}`)
  }
  rows.push(`  eclipse/pulse ${(hits / Math.max(1, pulses)).toFixed(2)}  pulses/game ${(pulses / games).toFixed(1)}  skews/game ${(skews / games).toFixed(1)}  draws ${draws}/${games}`)
  return rows.join('\n')
}
if (process.argv[2] === 'sweep') {
  const pairs: [AILevel, AILevel][] = [[2, 1], [3, 2], [2, 3], [3, 3]]
  for (const cooldown of [3, 4, 5]) console.log('cooldown ' + cooldown + '\n' + withRules({ cooldown }, () => duel(pairs, 10)))
}
if (process.argv[2] === 'ties') {
  let ties = 0, broken = 0, games = 0
  for (const [lb, lr] of [[2, 2], [3, 3], [3, 2], [2, 3]] as [AILevel, AILevel][]) for (let i = 1; i <= 10; i++) {
    const s = play(lb, lr, i); games++
    if (s.score.blue !== s.score.red) continue
    ties++
    const last = (t: Team) => s.log.filter(e => e.kind === 'score' && e.team === t).at(-1)?.t ?? 0
    if (Math.abs(last('blue') - last('red')) > 1e-6) broken++
  }
  console.log(`ties ${ties}/${games}, broken by first-to-final-score ${broken}`)
  console.log(duel([[2, 1], [3, 2], [2, 3], [3, 3]], 10))
}
