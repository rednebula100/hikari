// Live match controller: WEGO rounds, AI/script for red, knowledge for blue.
import { Sim, RULES, type Packet, type ScenarioDef, type Team } from './sim.ts'
import { knowledge, type Knowledge } from './knowledge.ts'
import { aiRound, newAI, type AILevel, type AIState } from './ai.ts'
import { planSim } from './plan.ts'
import type { Trial } from './scenarios.ts'

export type Phase = 'planning' | 'resolving' | 'finished'

export class Match {
  readonly def: ScenarioDef
  readonly trial?: Trial
  readonly #sim: Sim
  readonly #ai?: AIState
  readonly history: Packet[] = []
  phase: Phase = 'planning'
  roundStart: number
  #seq = 0

  readonly seed: number

  constructor(def: ScenarioDef, opts: { ai?: AILevel; trial?: Trial; seed?: number } = {}) {
    this.seed = opts.seed ?? 1
    this.def = def
    this.trial = opts.trial
    this.#sim = new Sim(def)
    for (const p of opts.trial?.redScript ?? []) this.#sim.submit(p)
    if (opts.ai) this.#ai = newAI('red', opts.ai, this.seed)
    const start = opts.trial?.start ?? 0
    if (start > 0) this.#sim.advanceTo(start)
    this.roundStart = start
  }

  get now() { return this.#sim.t }
  get roundEnd() { return Math.min(this.def.duration, this.roundStart + RULES.round) }
  get round() { return Math.round(this.roundStart / RULES.round) + 1 }
  get rounds() { return Math.ceil(this.def.duration / RULES.round) }
  get aiLevel() { return this.#ai?.level }
  nextSeq() { return ++this.#seq }

  /** Blue's legal information at time t ≤ now. */
  view(t = this.now): Knowledge { return knowledge(this.#sim, 'blue', t) }

  /** Own-plan preview including drafted (uncommitted) packets. */
  preview(drafts: readonly Packet[] = []) {
    return planSim(this.def, 'blue', [...this.history, ...drafts], this.def.duration)
  }

  validate(p: Packet) {
    if (p.emit < this.roundStart - 1e-9 || p.emit >= this.roundEnd - 1e-9) return 'emit'
    return this.#sim.validate(p)
  }

  commit(blue: Packet[]) {
    if (this.phase !== 'planning') throw new Error('Not planning')
    if (blue.length > RULES.packetsPerRound) throw new RangeError('Too many packets')
    for (const p of blue) { const why = this.validate(p); if (why) throw new RangeError('Invalid packet: ' + why) }
    const red = this.#ai ? aiRound(this.def, knowledge(this.#sim, 'red'), this.#ai) : []
    for (const p of [...blue, ...red]) this.#sim.submit(p)
    this.history.push(...blue.map(p => structuredClone(p)))
    this.phase = 'resolving'
  }

  /** Advance during the resolving animation; returns true when the round is over. */
  resolveTo(t: number): boolean {
    if (this.phase !== 'resolving') return true
    const target = Math.max(this.#sim.t, Math.min(t, this.roundEnd))
    this.#sim.advanceTo(target)
    if (this.#sim.t >= this.roundEnd - 1e-9) {
      if (this.#sim.finished) this.phase = 'finished'
      else { this.phase = 'planning'; this.roundStart = this.roundEnd }
      return true
    }
    return false
  }

  /** Only after the match ends: the full truth for the reveal / replay. */
  reveal(): Sim | null { return this.phase === 'finished' ? this.#sim : null }
  verdict() {
    const sim = this.reveal()
    if (!sim) return null
    if (this.trial) return this.trial.judge(sim)
    const { blue, red } = sim.score
    return { ok: blue > red, line: 'ORIGIN I ' + blue + ' : ' + red + ' ORIGIN II', blue, red }
  }
  /** Post-match only: the opponent's orders, for logs and replays. */
  redOrders(): Packet[] { return this.phase === 'finished' ? structuredClone(this.#ai?.history ?? this.trial?.redScript ?? []) : [] }
  static teamColor(team: Team) { return team === 'blue' ? 'var(--blue)' : 'var(--red)' }
}
