// Deterministic opponent. It receives only its own Knowledge (past light cone)
// and replays its own orders; it never reads the truth sim.
import { attenuation, distance, OMEGA, positionAt, samePoint, type Point } from './physics.ts'
import { ORIGIN, RULES, enemyOf, type Packet, type ScenarioDef, type Speed, type Team } from './sim.ts'
import { causalLock, type Knowledge } from './knowledge.ts'
import { planSim, readyAfterMove } from './plan.ts'

export type AILevel = 1 | 2 | 3
export const AI_NAMES: Record<AILevel, string> = { 1: '관측자', 2: '계산자', 3: '예언자' }

export interface AIState { team: Team; level: AILevel; history: Packet[]; seq: number; rng: number
  /** Enemy emission each ambush was planned from, per NEXUS (rhythm anchor). */
  anchors: Record<string, number>; skewed: Record<string, number> }
export const newAI = (team: Team, level: AILevel, seed = 1): AIState => ({ team, level, history: [], seq: 0, rng: (seed * 2654435761) >>> 0, anchors: {}, skewed: {} })
/** mulberry32: deterministic per-match temperament (recorded seed ⇒ reproducible). */
function rand(st: AIState) {
  st.rng = (st.rng + 0x6D2B79F5) >>> 0
  let t = st.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const quantize = (x: number, step: number) => Math.round(x / step) * step
const wrapDeg = (d: number) => ((d % 360) + 360) % 360

export function aiRound(def: ScenarioDef, k: Knowledge, st: AIState): Packet[] {
  const team = st.team, enemy = enemyOf(team), O = ORIGIN[team], now = k.t
  const plan = planSim(def, team, st.history, def.duration)
  const out: Packet[] = []
  const packet = (unitId: string, actions: Packet['actions'], emit = now): Packet => ({ id: team + '-ai-' + (++st.seq), team, unitId, emit, seq: st.seq, actions })
  const nexus = k.nexus
  const couriers = def.units.filter(u => u.team === team && u.kind === 'courier').map(u => u.id)

  // Where will each courier settle according to our own plan?
  const settle = new Map<string, { node: Point; at: number }>()
  for (const id of couriers) {
    const legs = plan.legs(id), last = legs.at(-1)
    settle.set(id, { node: last ? last.to : plan.unitDef(id)!.at, at: last ? last.end : 0 })
  }
  const pendingOrders = (id: string) => st.history.some(p => p.unitId === id && p.emit >= now - 8)

  // ── 1. Couriers: assign nexus targets ─────────────────────────────────
  const claimed = new Map<string, number>()
  for (const id of couriers) {
    const s = settle.get(id)!
    const n = nexus.find(n => samePoint(n.pos, s.node))
    if (n) claimed.set(n.id, (claimed.get(n.id) ?? 0) + 1)
  }
  // Enemy couriers seen holding a node; level 2+ also reads seen trajectories.
  const enemyAt = (pos: Point) => k.units.filter(u => {
    if (u.team !== enemy || u.kind !== 'courier') return false
    if (!u.moving) return samePoint(u.pos, pos)
    if (st.level < 2) return false
    const d = distance(u.pos, pos), sp = Math.hypot(u.velocity.x, u.velocity.z)
    const toward = ((pos.x - u.pos.x) * u.velocity.x + (pos.z - u.pos.z) * u.velocity.z) / (d * sp || 1)
    return d > 0 && toward > 0.999 // heading exactly at it
  }).length
  /** Score-difference per production period that our side gets at a node with m of ours vs c of theirs. */
  const diff = (m: number, c: number) => (m > c ? 1 : m < c ? -1 : 0) * (m + c > 0 ? 1 : 0)
  const periods = (from: number, pos: Point) => Math.max(0, def.duration - (from + RULES.produce + distance(pos, O))) / RULES.produce
  for (const id of couriers) {
    if (out.length >= RULES.packetsPerRound) break
    if (pendingOrders(id)) continue
    const s = settle.get(id)!
    if (s.at > now + 0.01) continue // still travelling under previous orders
    const here = nexus.find(n => samePoint(n.pos, s.node))
    const arrive = now + distance(O, s.node)
    // value of staying = what leaving would cost
    let stay = 0
    if (here) {
      const m = claimed.get(here.id) ?? 0, c = enemyAt(here.pos)
      stay = (diff(m, c) - diff(m - 1, c)) * periods(now, here.pos)
    }
    let best: { id: string; node: Point; speed: Speed; value: number } | null = null
    for (const n of nexus) {
      if (here?.id === n.id) continue
      const m = claimed.get(n.id) ?? 0, c = enemyAt(n.pos)
      let bestSpeed: Speed = 0.6, ready = Infinity
      for (const sp of (st.level === 1 ? [0.6] as Speed[] : RULES.speeds)) {
        const r = readyAfterMove(arrive, s.node, n.pos, sp)
        if (r < ready - 1e-9) { ready = r; bestSpeed = sp }
      }
      let gain = (diff(m + 1, c) - diff(m, c)) * periods(ready, n.pos)
      if (st.level >= 2 && c === 0 && m === 0) {
        const lock = causalLock(k, n.pos).t
        if (lock < ready + RULES.produce) gain *= 0.8 // the enemy could still share it first
      }
      // temperament: seeded jitter, so no two matches unfold identically
      gain *= 1 + (rand(st) - 0.5) * (st.level === 1 ? 0.5 : st.level === 2 ? 0.3 : 0.2)
      const value = gain - stay - 0.4 // moving has friction (risk, lost flexibility)
      if (value > 0 && (!best || value > best.value + 1e-9)) best = { id: n.id, node: n.pos, speed: bestSpeed, value }
    }
    if (!best) continue
    claimed.set(best.id, (claimed.get(best.id) ?? 0) + 1)
    if (here) claimed.set(here.id, (claimed.get(here.id) ?? 1) - 1)
    out.push(packet(id, [{ type: 'move', to: best.node, speed: best.speed }]))
  }

  // ── 2. Level 3: break a predictable rhythm once it gets eclipsed ──────
  if (st.level >= 3 && out.length < RULES.packetsPerRound) {
    // a failure at our own ORIGIN is known instantly; its NEXUS emission is visible by then too
    const fails = k.events.filter(e => e.kind === 'data-fail' && e.team === team && e.info?.reason === 'eclipsed' && e.t > now - 6)
    const targets = fails.map(f => k.events.find(e => e.kind === 'data-emit' && e.dataId === f.dataId)?.nexusId)
    // pre-emptive: an enemy pulse aimed at our core was seen → shake the rhythm of a producing NEXUS
    const ambush = k.events.some(e => e.kind === 'pulse' && e.team === enemy && e.t > now - 8 && e.info?.targetX === O.x && e.info?.targetZ === O.z)
    if (ambush) for (const n of nexus) if (n.controller === team || n.controller === 'contested') targets.push(n.id)
    for (const id of targets) {
      if (out.length >= RULES.packetsPerRound) break
      const n = nexus.find(x => x.id === id)
      if (!n || (st.skewed[n.id] ?? -99) > now - 5) continue
      const holder = couriers.find(id => samePoint(settle.get(id)!.node, n.pos) && settle.get(id)!.at <= now)
      if (!holder || pendingOrders(holder)) continue
      st.skewed[n.id] = now
      const seconds = [0.5, 1, 1.5][Math.floor(rand(st) * 3)]
      out.push(packet(holder, [{ type: 'skew', seconds }]))
    }
  }

  // ── 3. Levels 2+: phase ambush on the enemy's observed rhythm ──────────
  const phaserId = team + '-phaser'
  if (st.level >= 2 && plan.unitDef(phaserId) && out.length < RULES.packetsPerRound && !pendingOrders(phaserId)) {
    const target = ORIGIN[enemy]
    const legs = plan.legs(phaserId), def0 = plan.unitDef(phaserId)!
    const restAt = legs.at(-1)?.end ?? 0
    const pos = positionAt(def0.at, legs, def.duration)
    const futurePulses = st.history.some(p => p.unitId === phaserId && p.actions.some(a => a.type === 'pulse' && a.at > now))
    // level 3 notices when the observed rhythm no longer matches its ambush and re-plans
    const rhythmBroken = () => nexus.some(n => {
      const last = n.emissions.filter(e => e.team === enemy).at(-1), anchor = st.anchors[n.id]
      if (!last || anchor === undefined || last.t <= anchor) return false
      const r = ((last.t - anchor) % RULES.produce + RULES.produce) % RULES.produce
      return r > 0.05 && r < RULES.produce - 0.05
    })
    // Data amplitude at the enemy core from the central and flank nexus (~0.29–0.33).
    // Data amplitude at the enemy core: centre NEXUS att(4)=0.333, flanks att(5)=0.286.
    const good = (node: Point) => RULES.amplitudes.some(A => { const j = A * attenuation(distance(node, target)); return j > 0.8 * attenuation(4) && j < 1.25 * attenuation(5) })
    if (!good(pos)) {
      // stage near the enemy core, on our side of the line
      let stage: Point | null = null, cost = Infinity
      for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) {
        const node = { x, z }
        if (!good(node) || nexus.some(n => samePoint(n.pos, node))) continue
        const c = distance(node, pos) + distance(node, target) * 0.5
        if (c < cost) { cost = c; stage = node }
      }
      if (stage) out.push(packet(phaserId, [{ type: 'move', to: stage, speed: 0.6 }]))
    } else if (!futurePulses || (st.level >= 3 && rhythmBroken())) {
      const arriveCmd = Math.max(now + distance(O, pos), restAt)
      const dS = distance(pos, target)
      const predictions: { aD: number; amp: number }[] = []
      for (const n of nexus) {
        if (n.controller !== enemy && n.controller !== 'contested') continue
        const em = n.emissions.filter(e => e.team === enemy)
        const last = em.at(-1)
        if (!last) continue
        const gaps = em.slice(-3).map((e, i, xs) => (i ? e.t - xs[i - 1].t : 0)).slice(1)
        const period = gaps.length >= 2 && gaps.every(g => Math.abs(g - RULES.produceRedundant) < .05) ? RULES.produceRedundant : RULES.produce
        st.anchors[n.id] = last.t
        for (let e = last.t + period; e < def.duration; e += period) predictions.push({ aD: e + distance(n.pos, target), amp: attenuation(distance(n.pos, target)) })
      }
      predictions.sort((a, b) => a.aD - b.aD)
      const actions: Packet['actions'] = []
      let nextFree = arriveCmd
      for (const p of predictions) {
        if (actions.length >= RULES.actionsPerPacket) break
        const at = Math.floor((p.aD - dS) / RULES.emitStep) * RULES.emitStep
        if (at + dS < p.aD - 0.5 + 1e-9 || at < nextFree + 1e-9) continue
        const aJ = at + dS
        const phase = wrapDeg(quantize(180 + 360 * (aJ - p.aD) * OMEGA / (2 * Math.PI), RULES.phaseStep))
        const A = RULES.amplitudes.reduce((b, a) => Math.abs(a * attenuation(dS) / p.amp - 1) < Math.abs(b * attenuation(dS) / p.amp - 1) ? a : b)
        actions.push({ type: 'pulse', at, target, channel: enemy, phase, amplitude: A })
        nextFree = at + RULES.cooldown
      }
      if (actions.length) out.push(packet(phaserId, actions))
    }
  }

  st.history.push(...out)
  return out
}
