// Own-team plan preview. Own units' motion depends only on own orders, so this
// replays the team's own packet history in a sim that contains no enemy.
// Production and reception results are hypotheses (no enemy interference).
import { Sim, type Packet, type ScenarioDef, type Team, RULES, ORIGIN } from './sim.ts'
import { distance, intercept, type Point } from './physics.ts'

export function planSim(def: ScenarioDef, team: Team, packets: readonly Packet[], horizon: number) {
  const sim = new Sim(def, [team, 'neutral'])
  for (const p of packets) if (p.team === team) sim.submit(p)
  sim.advanceTo(Math.min(def.duration, horizon))
  return sim
}

/** Courier calibration-complete time for a single MOVE ordered now. */
export function readyAfterMove(commandArrive: number, from: Point, to: Point, speed: number) {
  const d = distance(from, to)
  if (d === 0) return commandArrive
  const travel = d / speed
  const proper = travel * Math.sqrt(1 - speed * speed)
  return commandArrive + travel + Math.max(0, RULES.readyProper - proper)
}

/** When does a packet emitted at `emit` reach the unit, given the plan sim? */
export function commandArrival(plan: Sim, team: Team, unitId: string, emit: number) {
  const def = plan.unitDef(unitId)
  if (!def) return Infinity
  return intercept(ORIGIN[team], emit, def.at, plan.legs(unitId))
}
