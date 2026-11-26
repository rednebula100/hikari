// Authoritative, deterministic, event-driven simulation (TruthState).
// Never hand an instance of this class to the renderer, the HUD or the AI
// during a live match: they receive only `Knowledge` (see knowledge.ts).
import {
  C, EPS, distance, intercept, pilotRatio, positionAt, samePoint, tauAt, timeKey,
  type Leg, type Point, type Pulse,
} from './physics.ts'

export type Team = 'blue' | 'red'
export type Side = Team | 'neutral'
export type Kind = 'origin' | 'courier' | 'relay' | 'phaser' | 'nexus'
export type Speed = 0.4 | 0.6 | 0.8
export type RoutePolicy = 'direct' | 'relay' | 'redundant'
export const enemyOf = (team: Team): Team => (team === 'blue' ? 'red' : 'blue')

export const RULES = Object.freeze({
  readyProper: 5,          // courier sensor calibration after a move starts (proper s)
  produce: 3,              // NEXUS production period (s)
  produceRedundant: 4.5,   // period when duplicating over the relay
  dataLength: 0.5,         // DATA pulse length (s)
  pulseLength: 1,          // PHASE pulse length (s)
  cooldown: 3,             // PHASER cooldown (proper s)
  relayDelay: 0.25,        // relay processing time after a complete window
  threshold: 0.4,          // pilot ratio below which a DATA reception fails
  round: 2,                // coordinate seconds per WEGO round
  packetsPerRound: 2,
  actionsPerPacket: 3,
  emitStep: 0.25,
  speeds: [0.4, 0.6, 0.8] as readonly Speed[],
  amplitudes: [0.5, 1, 2] as readonly number[],
  phaseStep: 15,           // degrees
})

export const ORIGIN: Readonly<Record<Team, Point>> = Object.freeze({ blue: { x: 0, z: 4 }, red: { x: 8, z: 4 } })

export interface UnitDef { id: string; kind: Kind; team: Side; at: Point }

export type Action =
  | { type: 'move'; to: Point; speed: Speed }
  | { type: 'wait'; seconds: number }
  | { type: 'route'; policy: RoutePolicy; via?: Point }
  | { type: 'pulse'; at: number; target: Point; channel: Team; phase: number; amplitude: number }

export interface Packet { id: string; team: Team; unitId: string; emit: number; seq: number; actions: Action[] }

export type EventKind =
  | 'cmd-emit' | 'cmd-recv' | 'cmd-stale' | 'move' | 'arrive' | 'ready' | 'wait' | 'invalid'
  | 'route' | 'pulse' | 'pulse-fail' | 'control' | 'data-emit' | 'data-recv' | 'data-fail'
  | 'relay-emit' | 'score'

export interface SimEvent {
  id: string; t: number; kind: EventKind; pos: Point; team: Side
  unitId?: string; packetId?: string; dataId?: string; nexusId?: string; signalId?: string
  /** Free-form, kind-specific facts that are physically carried by this event's light. */
  info?: Record<string, number | string | boolean | null>
}

/** A signal on the board: commands, data and phase pulses all travel at c. */
export interface Signal {
  id: string; kind: 'command' | 'data' | 'phase'; team: Team; from: Point; emit: number
  /** Present for data/phase: the fixed receiving node of the directed link. */
  to?: Point; duration: number; phase?: number; amplitude?: number; channel?: Team
  dataId?: string; packetId?: string; unitId?: string
}

interface UnitState {
  def: UnitDef; legs: Leg[]; atRest: boolean; queue: Action[]; programKey: [number, number] | null
  waitUntil: number | null; moveStartTau: number; readyFlag: boolean; cooldownTau: number
}
interface NexusState {
  def: UnitDef; controller: Team | 'contested' | null; since: number
  policy: Record<Team, { mode: RoutePolicy; via?: Point }>
}
interface CommandFlight { packet: Packet; emitted: boolean; delivered: boolean }
interface DataFlight {
  signal: Signal; receiver: 'origin' | 'relay'; arrive: number; started: boolean; ended: boolean
  relayOk: boolean; hop: number
}

export interface ScenarioDef {
  id: string
  duration: number
  units: UnitDef[]
  /** Initial NEXUS route policy per team (defaults to direct). */
  policies?: Partial<Record<string, Partial<Record<Team, { mode: RoutePolicy; via?: Point }>>>>
  /** Units that begin the match already moving or holding (setup history). */
  preset?: Packet[]
}

export function standardUnits(): UnitDef[] {
  const roster: UnitDef[] = []
  for (const team of ['blue', 'red'] as const) {
    const layout: [string, Kind, number, number][] = [
      ['origin', 'origin', 0, 4], ['courier-a', 'courier', 1, 2], ['courier-b', 'courier', 1, 6],
      ['relay', 'relay', 1, 4], ['phaser', 'phaser', 0, 5],
    ]
    for (const [name, kind, x, z] of layout)
      roster.push({ id: team + '-' + name, kind, team, at: { x: team === 'blue' ? x : 8 - x, z } })
  }
  for (const [n, z] of [['i', 1], ['ii', 4], ['iii', 7]] as const)
    roster.push({ id: 'nexus-' + n, kind: 'nexus', team: 'neutral', at: { x: 4, z } })
  return roster
}

const isNode = (p: Point) => [p.x, p.z].every(n => Number.isInteger(n) && n >= 0 && n <= 8)

export class Sim {
  readonly def: ScenarioDef
  readonly roster: UnitDef[]
  t = 0
  readonly score: Record<Team, number> = { blue: 0, red: 0 }
  readonly log: SimEvent[] = []
  readonly signals: Signal[] = []
  readonly #units = new Map<string, UnitState>()
  readonly #nexus = new Map<string, NexusState>()
  readonly #commands: CommandFlight[] = []
  readonly #data: DataFlight[] = []
  readonly #reemit: { t: number; data: DataFlight; done: boolean }[] = []
  readonly #scored = new Set<string>()
  #eventSeq = 0
  #dataSeq = 0
  #signalSeq = 0

  constructor(def: ScenarioDef, teams: readonly Side[] = ['blue', 'red', 'neutral']) {
    this.def = def
    this.roster = def.units.filter(u => teams.includes(u.team))
    for (const u of this.roster) {
      if (u.kind === 'nexus') {
        const pol = def.policies?.[u.id] ?? {}
        this.#nexus.set(u.id, { def: u, controller: null, since: 0, policy: {
          blue: pol.blue ?? { mode: 'direct' }, red: pol.red ?? { mode: 'direct' } } })
      } else {
        this.#units.set(u.id, { def: u, legs: [], atRest: true, queue: [], programKey: null, waitUntil: null,
          moveStartTau: -Infinity, readyFlag: true, cooldownTau: 0 })
      }
    }
    for (const p of def.preset ?? []) if (this.#units.has(p.unitId)) this.#commands.push({ packet: p, emitted: true, delivered: false })
    this.#evaluateNexus(0)
  }

  // ── Public queries (truth; for replay / tests / plan sims only) ─────────
  legs(unitId: string): readonly Leg[] { return this.#units.get(unitId)?.legs ?? [] }
  unitDef(id: string) { return this.roster.find(u => u.id === id) }
  positionAt(unitId: string, t: number): Point {
    const u = this.#units.get(unitId)
    if (u) return positionAt(u.def.at, u.legs, t)
    const n = this.#nexus.get(unitId)
    return { ...(n?.def.at ?? { x: 0, z: 0 }) }
  }
  tauAt(unitId: string, t: number) { const u = this.#units.get(unitId); return u ? tauAt(u.legs, t) : t }
  /** Courier calibration state at time t (≤ now). */
  readinessAt(unitId: string, t: number): number {
    const u = this.#units.get(unitId)
    if (!u || u.def.kind !== 'courier') return 1
    const started = [...u.legs].reverse().find(l => l.start <= t)
    if (!started) return u.moveStartTau === -Infinity ? 1 : 0
    const elapsed = tauAt(u.legs, t) - tauAt(u.legs, started.start)
    return Math.max(0, Math.min(1, elapsed / RULES.readyProper))
  }
  cooldownReadyTau(unitId: string) { return this.#units.get(unitId)?.cooldownTau ?? 0 }
  nexusState(id: string) { const n = this.#nexus.get(id); return n ? { controller: n.controller, since: n.since, policy: n.policy } : undefined }
  pendingQueue(unitId: string) { return [...(this.#units.get(unitId)?.queue ?? [])] }
  get packets(): readonly Packet[] { return this.#commands.map(c => c.packet) }

  // ── Orders ─────────────────────────────────────────────────────────────
  validate(packet: Packet): string | null {
    const unit = this.#units.get(packet.unitId)
    if (!unit || unit.def.team !== packet.team || unit.def.kind === 'origin') return 'unit'
    if (!(packet.emit >= this.t - EPS) || Math.abs(packet.emit / RULES.emitStep - Math.round(packet.emit / RULES.emitStep)) > 1e-6) return 'emit'
    if (packet.actions.length < 1 || packet.actions.length > RULES.actionsPerPacket) return 'actions'
    for (const a of packet.actions) {
      if (a.type === 'move' && (!isNode(a.to) || !RULES.speeds.includes(a.speed))) return 'move'
      if (a.type === 'wait' && !(a.seconds > 0 && a.seconds <= 48)) return 'wait'
      if (a.type === 'route' && (unit.def.kind !== 'courier' || (a.policy !== 'direct' && !(a.via && isNode(a.via))))) return 'route'
      if (a.type === 'pulse' && (unit.def.kind !== 'phaser' || !isNode(a.target) || !RULES.amplitudes.includes(a.amplitude)
        || !Number.isFinite(a.at) || !Number.isFinite(a.phase))) return 'pulse'
    }
    return null
  }
  submit(packet: Packet) {
    const why = this.validate(packet)
    if (why) throw new RangeError('Invalid packet: ' + why)
    this.#commands.push({ packet: structuredClone(packet), emitted: false, delivered: false })
    this.#commands.sort((a, b) => timeKey(a.packet.emit) - timeKey(b.packet.emit) || a.packet.team.localeCompare(b.packet.team) || a.packet.seq - b.packet.seq)
  }

  // ── Time evolution ─────────────────────────────────────────────────────
  advanceTo(T: number) {
    if (!(T >= this.t - EPS)) throw new RangeError('Coordinate time must advance')
    const end = Math.min(T, this.def.duration)
    for (let guard = 0; guard < 200000; guard++) {
      const next = this.#nextTime()
      if (next === null || timeKey(next) > timeKey(end)) break
      this.t = Math.max(this.t, next)
      this.#step(this.t)
    }
    this.t = Math.max(this.t, end)
  }
  get finished() { return this.t >= this.def.duration - EPS }

  #nextTime(): number | null {
    let best = Infinity
    const consider = (t: number) => { if (t < best) best = t }
    for (const u of this.#units.values()) {
      if (!u.atRest) consider(u.legs.at(-1)!.end)
      if (u.waitUntil !== null) consider(u.waitUntil)
      if (u.atRest && u.waitUntil === null && u.queue.length) consider(this.t)
      if (u.def.kind === 'courier' && u.atRest && !u.readyFlag) consider(this.#readyTime(u))
    }
    for (const c of this.#commands) {
      if (!c.emitted) consider(c.packet.emit)
      else if (!c.delivered) consider(this.#commandArrival(c))
    }
    for (const d of this.#data) {
      if (!d.started) consider(d.arrive)
      else if (!d.ended) consider(d.arrive + d.signal.duration)
    }
    for (const r of this.#reemit) if (!r.done) consider(r.t)
    for (const n of this.#nexus.values()) {
      if (n.controller) consider(n.since + this.#period(n, n.controller))
    }
    return best === Infinity ? null : Math.max(best, this.t)
  }
  #readyTime(u: UnitState) {
    const last = u.legs.at(-1)
    const restStart = last ? last.end : 0
    const tauRest = tauAt(u.legs, restStart)
    return restStart + Math.max(0, u.moveStartTau + RULES.readyProper - tauRest)
  }
  #commandArrival(c: CommandFlight) {
    const u = this.#units.get(c.packet.unitId)!
    return intercept(ORIGIN[c.packet.team], c.packet.emit, u.def.at, u.legs)
  }
  #period(n: NexusState, ctrl: Team | 'contested') {
    const teams: Team[] = ctrl === 'contested' ? ['blue', 'red'] : [ctrl]
    return teams.some(t => n.policy[t].mode === 'redundant') ? RULES.produceRedundant : RULES.produce
  }
  #at(t: number, x: number) { return timeKey(t) === timeKey(x) }
  #emit(e: Omit<SimEvent, 'id'>) { const ev = { ...e, id: 'e' + (++this.#eventSeq), pos: { ...e.pos } }; this.log.push(ev); return ev }
  #signal(s: Omit<Signal, 'id'>) { const sig = { ...s, id: 's' + (++this.#signalSeq) }; this.signals.push(sig); return sig }

  #step(t: number) {
    // 0. command emissions (light leaves the ORIGIN)
    for (const c of this.#commands) {
      if (!c.emitted && this.#at(c.packet.emit, t)) {
        c.emitted = true
        const sig = this.#signal({ kind: 'command', team: c.packet.team, from: ORIGIN[c.packet.team], emit: t, duration: 0, packetId: c.packet.id, unitId: c.packet.unitId })
        this.#emit({ t, kind: 'cmd-emit', pos: ORIGIN[c.packet.team], team: c.packet.team, packetId: c.packet.id, unitId: c.packet.unitId, signalId: sig.id })
      }
    }
    // A. leg ends
    for (const u of this.#units.values()) {
      const last = u.legs.at(-1)
      if (!u.atRest && last && this.#at(last.end, t)) {
        u.atRest = true
        this.#emit({ t, kind: 'arrive', pos: last.to, team: u.def.team, unitId: u.def.id })
      }
    }
    // B. calibration complete
    for (const u of this.#units.values()) {
      if (u.def.kind === 'courier' && u.atRest && !u.readyFlag && timeKey(this.#readyTime(u)) <= timeKey(t)) {
        u.readyFlag = true
        this.#emit({ t, kind: 'ready', pos: positionAt(u.def.at, u.legs, t), team: u.def.team, unitId: u.def.id })
      }
    }
    // C. command arrivals; the newest emitted program wins
    for (const c of this.#commands) {
      if (!c.emitted || c.delivered) continue
      if (timeKey(this.#commandArrival(c)) > timeKey(t)) continue
      c.delivered = true
      const u = this.#units.get(c.packet.unitId)!
      const key: [number, number] = [timeKey(c.packet.emit), c.packet.seq]
      const pos = positionAt(u.def.at, u.legs, t)
      const newer = !u.programKey || key[0] > u.programKey[0] || (key[0] === u.programKey[0] && key[1] > u.programKey[1])
      if (newer) {
        u.programKey = key; u.queue = structuredClone(c.packet.actions); u.waitUntil = null
        this.#emit({ t, kind: 'cmd-recv', pos, team: u.def.team, unitId: u.def.id, packetId: c.packet.id, info: { moving: !u.atRest } })
      } else {
        this.#emit({ t, kind: 'cmd-stale', pos, team: u.def.team, unitId: u.def.id, packetId: c.packet.id })
      }
    }
    // D. waits end
    for (const u of this.#units.values()) if (u.waitUntil !== null && timeKey(u.waitUntil) <= timeKey(t)) u.waitUntil = null
    // E. local programs
    for (const u of this.#units.values()) this.#runQueue(u, t)
    // F. data windows
    this.#dataWindows(t)
    // G. NEXUS control / production
    this.#evaluateNexus(t)
  }

  #runQueue(u: UnitState, t: number) {
    while (u.atRest && u.waitUntil === null && u.queue.length) {
      const a = u.queue[0]
      const pos = positionAt(u.def.at, u.legs, t)
      if (a.type === 'move') {
        u.queue.shift()
        if (samePoint(pos, a.to)) { this.#emit({ t, kind: 'invalid', pos, team: u.def.team, unitId: u.def.id, info: { reason: 'same-node' } }); continue }
        const end = t + distance(pos, a.to) / a.speed
        u.legs.push({ start: t, end, from: pos, to: { ...a.to } })
        u.atRest = false
        if (u.def.kind === 'courier') { u.moveStartTau = tauAt(u.legs, t); u.readyFlag = false }
        this.#emit({ t, kind: 'move', pos, team: u.def.team, unitId: u.def.id, info: { toX: a.to.x, toZ: a.to.z, speed: a.speed, end } })
        // vacating a NEXUS is evaluated in G with the new state
        return
      }
      if (a.type === 'wait') {
        u.queue.shift(); u.waitUntil = t + a.seconds
        this.#emit({ t, kind: 'wait', pos, team: u.def.team, unitId: u.def.id, info: { until: u.waitUntil } })
        return
      }
      if (a.type === 'route') {
        u.queue.shift()
        const nexus = [...this.#nexus.values()].find(n => samePoint(n.def.at, pos))
        const team = u.def.team as Team
        if (!nexus) { this.#emit({ t, kind: 'invalid', pos, team, unitId: u.def.id, info: { reason: 'not-on-nexus' } }); continue }
        nexus.policy[team] = { mode: a.policy, ...(a.via ? { via: { ...a.via } } : {}) }
        if (nexus.controller === team || nexus.controller === 'contested') nexus.since = t
        this.#emit({ t, kind: 'route', pos, team, unitId: u.def.id, nexusId: nexus.def.id, info: { policy: a.policy } })
        continue
      }
      // pulse
      if (timeKey(a.at) > timeKey(t)) { u.waitUntil = a.at; return }
      u.queue.shift()
      const team = u.def.team as Team
      if (timeKey(a.at) < timeKey(t)) { this.#emit({ t, kind: 'pulse-fail', pos, team, unitId: u.def.id, info: { reason: 'late', at: a.at } }); continue }
      const tau = tauAt(u.legs, t)
      if (tau < u.cooldownTau - EPS) { this.#emit({ t, kind: 'pulse-fail', pos, team, unitId: u.def.id, info: { reason: 'cooldown' } }); continue }
      u.cooldownTau = tau + RULES.cooldown
      const sig = this.#signal({ kind: 'phase', team, from: pos, emit: t, to: { ...a.target }, duration: RULES.pulseLength,
        phase: a.phase * Math.PI / 180, amplitude: a.amplitude, channel: a.channel, unitId: u.def.id })
      this.#emit({ t, kind: 'pulse', pos, team, unitId: u.def.id, signalId: sig.id,
        info: { phase: a.phase, amplitude: a.amplitude, targetX: a.target.x, targetZ: a.target.z, channel: a.channel } })
    }
  }

  #relayAt(team: Team, node: Point, t: number) {
    for (const u of this.#units.values()) {
      if (u.def.kind === 'relay' && u.def.team === team && u.atRest && samePoint(positionAt(u.def.at, u.legs, t), node)) return u
    }
    return undefined
  }

  #dataWindows(t: number) {
    for (const r of this.#reemit) {
      if (r.done || !this.#at(r.t, t)) continue
      r.done = true
      const src = r.data.signal
      this.#sendData(src.team, src.to!, t, ORIGIN[src.team], 'origin', src.dataId!, r.data.hop + 1)
      this.#emit({ t, kind: 'relay-emit', pos: src.to!, team: src.team, dataId: src.dataId })
    }
    for (const d of this.#data) {
      if (d.started && !d.ended && this.#at(d.arrive + d.signal.duration, t)) {
        d.ended = true
        const s = d.signal, team = s.team
        let ok = true, reason = ''
        if (d.receiver === 'relay') {
          const relay = this.#relayAt(team, s.to!, t)
          const rested = relay && relay.legs.every(l => l.end <= d.arrive + EPS || l.start >= t - EPS)
          if (!d.relayOk || !relay || !rested) { ok = false; reason = 'relay-absent' }
        }
        const jammers: Pulse[] = this.signals
          .filter(x => x.kind === 'phase' && x.channel === team && x.to && samePoint(x.to, s.to!))
          .map(x => ({ position: x.from, emit: x.emit, duration: x.duration, amplitude: x.amplitude!, phase: x.phase! }))
        const pilot: Pulse = { position: s.from, emit: s.emit, duration: s.duration, amplitude: 1, phase: 0 }
        const R = pilotRatio(s.to!, [pilot, ...jammers])
        if (ok && R < RULES.threshold) { ok = false; reason = 'eclipsed' }
        this.#emit({ t, kind: ok ? 'data-recv' : 'data-fail', pos: s.to!, team, dataId: s.dataId, signalId: s.id,
          info: { R, receiver: d.receiver, reason } })
        if (ok && d.receiver === 'origin' && !this.#scored.has(s.dataId!) && t <= this.def.duration + EPS) {
          this.#scored.add(s.dataId!); this.score[team]++
          this.#emit({ t, kind: 'score', pos: s.to!, team, dataId: s.dataId, info: { total: this.score[team] } })
        }
        if (ok && d.receiver === 'relay' && d.hop < 2) this.#reemit.push({ t: t + RULES.relayDelay, data: d, done: false })
      }
    }
    for (const d of this.#data) {
      if (!d.started && this.#at(d.arrive, t)) {
        d.started = true
        d.relayOk = d.receiver === 'origin' || !!this.#relayAt(d.signal.team, d.signal.to!, t)
      }
    }
  }

  #sendData(team: Team, from: Point, t: number, to: Point, receiver: 'origin' | 'relay', dataId: string, hop: number) {
    const signal = this.#signal({ kind: 'data', team, from: { ...from }, emit: t, to: { ...to }, duration: RULES.dataLength, dataId, channel: team })
    this.#data.push({ signal, receiver, arrive: t + distance(from, to) / C, started: false, ended: false, relayOk: false, hop })
    return signal
  }

  #evaluateNexus(t: number) {
    for (const n of this.#nexus.values()) {
      const count = { blue: 0, red: 0 }
      for (const u of this.#units.values()) {
        if (u.def.kind !== 'courier' || !u.atRest || !u.readyFlag) continue
        if (samePoint(positionAt(u.def.at, u.legs, t), n.def.at)) count[u.def.team as Team]++
      }
      // Majority controls. A tie (≥1 each) makes the NEXUS SHARED: it keeps producing
      // and transmits one copy to each ORIGIN — the duel moves to the wave layer.
      const ctrl: NexusState['controller'] =
        count.blue > count.red ? 'blue' : count.red > count.blue ? 'red' : count.blue > 0 ? 'contested' : null
      if (ctrl !== n.controller) {
        n.controller = ctrl; n.since = t
        this.#emit({ t, kind: 'control', pos: n.def.at, team: ctrl === 'blue' || ctrl === 'red' ? ctrl : 'neutral', nexusId: n.def.id,
          info: { controller: ctrl, blue: count.blue, red: count.red } })
        continue
      }
      if (!ctrl || timeKey(n.since + this.#period(n, ctrl)) > timeKey(t) || t >= this.def.duration - EPS) continue
      n.since = t
      for (const team of ctrl === 'contested' ? (['blue', 'red'] as const) : [ctrl]) {
        const dataId = 'd' + (++this.#dataSeq) + '-' + team
        const pol = n.policy[team]
        const routes: string[] = []
        if (pol.mode !== 'relay') { this.#sendData(team, n.def.at, t, ORIGIN[team], 'origin', dataId, 0); routes.push('direct') }
        if (pol.mode !== 'direct' && pol.via) { this.#sendData(team, n.def.at, t, pol.via, 'relay', dataId, 1); routes.push('relay') }
        this.#emit({ t, kind: 'data-emit', pos: n.def.at, team, nexusId: n.def.id, dataId,
          info: { policy: pol.mode, routes: routes.join('+'), shared: ctrl === 'contested' } })
      }
    }
  }
}
