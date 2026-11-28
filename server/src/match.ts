// A ranked 衝 game. The server owns the position, the clock and the result; clients only propose moves.
// Both seats are reserved by the lobby's matchmaker; a client proves its seat with the secret `seat` key.
import { Room, type Client } from '@colyseus/core'
import { START, fromFen, legal, make, status, toFen, type Move, type Pos, type Side } from '../../src/engine/rules.ts'
import { ChessClock, TIME_CONTROLS } from './clock.ts'
import { recordAbort, recordGame, type Player, type RatingChange, type Result } from './firebase.ts'

export const FIRST_MOVE_MS = 25_000
export const RECONNECT_S = 40
const MAX_LAG_COMP = 300
/** The opponent's clock waits while the move is animated on both screens. */
export const graceFor = (busy: boolean) => (busy ? 2_200 : 700)

export interface MatchOptions { tc: string; white: Player; black: Player; seats: { w: string; b: string } }
type Wire = { from: number; to: number; promo?: string; via?: number }
const uci = (m: Move) => m.from + '-' + m.to + (m.promo ?? '') + (m.via !== undefined ? '@' + m.via : '')

export class MatchRoom extends Room {
  maxClients = 2
  autoDispose = true
  private o!: MatchOptions
  private pos: Pos = fromFen(START)
  private history: string[] = []
  private moves: string[] = []
  private chess!: ChessClock
  private seatOf = new Map<string, Side>()      // sessionId → colour
  private sessionOf: Partial<Record<Side, string>> = {}
  private rtt: Record<Side, number> = { w: 0, b: 0 }
  private drawOffer: Side | null = null
  private over = false
  private startedAt = Date.now()
  private firstMoveTimer: { clear(): void } | null = null
  private away: Partial<Record<Side, number>> = {}

  onCreate(o: MatchOptions) {
    this.o = o
    const tc = TIME_CONTROLS.find(t => t.id === o.tc) ?? TIME_CONTROLS[1]
    this.chess = new ChessClock(tc.baseMs, tc.incMs)
    this.setMetadata({ tc: tc.id, white: o.white.name, black: o.black.name })
    void this.setPrivate(true)

    this.onMessage('move', (c: Client, w: Wire) => this.onMove(c, w))
    this.onMessage('resign', (c: Client) => { const s = this.seatOf.get(c.sessionId); if (s) this.end(s === 'w' ? '0-1' : '1-0', 'resign') })
    this.onMessage('abort', (c: Client) => { if (this.seatOf.get(c.sessionId) && this.abortable()) this.abort('abort') })
    this.onMessage('draw', (c: Client, accept?: boolean) => this.onDraw(c, !!accept))
    this.onMessage('ping', (c: Client, t: number) => c.send('pong', { t, server: Date.now() }))
    // clients attach their handlers after joining, so they ask for the state once ready
    this.onMessage('hello', (c: Client) => { const s = this.seatOf.get(c.sessionId); if (s) c.send('sync', this.syncState(s)) })
    this.onMessage('rtt', (c: Client, ms: number) => { const s = this.seatOf.get(c.sessionId); if (s && Number.isFinite(ms)) this.rtt[s] = Math.max(0, Math.min(2000, ms)) })

    // the flag can fall between messages: check four times a second
    this.setSimulationInterval(() => this.checkFlag(), 250)
    // nobody shows up → abort
    this.firstMoveTimer = this.clock_(FIRST_MOVE_MS + 15_000, () => { if (!this.moves.length) this.abort('noshow') })
  }

  /** Colyseus room clock wrapper (keeps timers bound to the room lifetime). */
  private clock_(ms: number, f: () => void) { return this.clock.setTimeout(f, ms) }

  onJoin(client: Client, options: { seat?: string }) {
    const side: Side | null = options?.seat === this.o.seats.w ? 'w' : options?.seat === this.o.seats.b ? 'b' : null
    if (!side || this.sessionOf[side]) throw new Error('no seat')
    this.seatOf.set(client.sessionId, side); this.sessionOf[side] = client.sessionId
    client.send('sync', this.syncState(side))
    if (this.sessionOf.w && this.sessionOf.b && !this.moves.length) {
      // both arrived: White has FIRST_MOVE_MS for the first move
      this.firstMoveTimer?.clear()
      this.firstMoveTimer = this.clock_(FIRST_MOVE_MS, () => { if (this.moves.length === 0) this.abort('firstmove') })
      this.broadcast('start', { firstMoveMs: FIRST_MOVE_MS, server: Date.now() })
    }
  }

  onDrop(client: Client) {
    const side = this.seatOf.get(client.sessionId)
    if (!side || this.over) return
    this.away[side] = Date.now() + RECONNECT_S * 1000
    this.broadcast('away', { side, until: this.away[side], seconds: RECONNECT_S }, { except: client })
    this.allowReconnection(client, RECONNECT_S)
  }

  onReconnect(client: Client) {
    const side = this.seatOf.get(client.sessionId)
    if (!side) return
    delete this.away[side]
    this.broadcast('back', { side }, { except: client })
    client.send('sync', this.syncState(side))
  }

  onLeave(client: Client) {
    const side = this.seatOf.get(client.sessionId)
    if (!side || this.over) return
    // gone for good (timed-out reconnection, closed tab or "leave"): before both first moves it's an abort
    if (this.abortable()) this.abort('left')
    else this.end(side === 'w' ? '0-1' : '1-0', this.away[side] ? 'abandon' : 'left')
  }

  // ── play ──
  private abortable() { return this.moves.length < 2 }

  private onMove(client: Client, w: Wire) {
    const side = this.seatOf.get(client.sessionId)
    if (this.over || !side || side !== this.pos.turn) return client.send('reject', { reason: 'turn', sync: this.syncState(side ?? 'w') })
    const m = legal(this.pos, 'clash').find(x => x.from === w.from && x.to === w.to && (x.promo ?? undefined) === (w.promo ?? undefined) && (x.via ?? undefined) === (w.via ?? undefined))
    if (!m) return client.send('reject', { reason: 'illegal', sync: this.syncState(side) })
    const now = Date.now()
    // lag compensation: give back half the measured round trip (capped)
    const credited = Math.min(MAX_LAG_COMP, this.rtt[side] / 2)
    if (this.chess.running) {
      if (!this.chess.press(side, now - credited)) return this.checkFlag()
    } else this.chess.press(side, now) // before the clocks start: just pass the turn (and add the increment)
    this.chess.hold()

    const before = this.pos, r = make(before, m, 'clash')
    this.history.push(toFen(before, false))
    this.pos = r.pos
    this.moves.push(uci(m))
    if (this.drawOffer && this.drawOffer !== side) this.drawOffer = null // moving declines a pending offer
    const busy = !!(r.out.clash || r.out.stomp || r.out.removed.length || r.out.collapse?.length || r.out.shock)
    const grace = graceFor(busy)

    // clocks start once both sides have made their first move
    if (this.moves.length === 1) {
      this.firstMoveTimer?.clear()
      this.firstMoveTimer = this.clock_(FIRST_MOVE_MS + grace, () => { if (this.moves.length === 1) this.abort('firstmove') })
    } else {
      if (this.moves.length === 2) this.firstMoveTimer?.clear()
      this.chess.start(now + grace)
    }
    this.broadcast('moved', { ply: this.moves.length, by: side, move: { from: m.from, to: m.to, promo: m.promo, via: m.via }, clock: this.chess.snapshot(now), grace, server: now, drawOffer: this.drawOffer })

    const st = status(this.pos, 'clash', this.history)
    if (st.over) this.clock_(grace, () => this.end(st.result as Result, st.reason))
  }

  private onDraw(client: Client, accept: boolean) {
    const side = this.seatOf.get(client.sessionId)
    if (!side || this.over || this.abortable()) return
    if (accept && this.drawOffer && this.drawOffer !== side) return this.end('1/2-1/2', 'agreement')
    if (!accept && this.drawOffer && this.drawOffer !== side) { this.drawOffer = null; this.broadcast('draw', { offer: null, declined: side }); return }
    if (!this.drawOffer) { this.drawOffer = side; this.broadcast('draw', { offer: side }) }
  }

  private checkFlag() {
    if (this.over) return
    const flagged = this.chess.tick(Date.now())
    if (flagged) this.end(flagged === 'w' ? '0-1' : '1-0', 'time')
  }

  // ── endings ──
  private async abort(reason: string) {
    if (this.over) return
    this.over = true; this.chess.hold(); this.firstMoveTimer?.clear()
    this.broadcast('end', { result: 'aborted', reason })
    await recordAbort({ id: this.roomId, tc: this.o.tc, reason, moves: this.moves, startedAt: this.startedAt, endedAt: Date.now(), white: this.o.white, black: this.o.black })
    this.clock_(5_000, () => this.disconnect())
  }

  private async end(result: Result, reason: string) {
    if (this.over) return
    this.over = true; this.chess.pause(Date.now()); this.firstMoveTimer?.clear()
    let ratings: { w: RatingChange; b: RatingChange } | null = null
    try {
      ratings = await recordGame({ id: this.roomId, tc: this.o.tc, result, reason, moves: this.moves, startedAt: this.startedAt, endedAt: Date.now(), white: this.o.white, black: this.o.black })
    } catch (e) { console.error('recordGame failed', e) }
    this.broadcast('end', { result, reason, ratings, clock: this.chess.snapshot(Date.now()) })
    this.clock_(30_000, () => this.disconnect())
  }

  private syncState(you: Side) {
    const now = Date.now(), p = (x: Player) => ({ name: x.name, rating: Math.round(x.rating), provisional: x.rd > 110, guest: x.guest })
    return {
      you, tc: this.o.tc, white: p(this.o.white), black: p(this.o.black), moves: this.moves, clock: this.chess.snapshot(now),
      server: now, drawOffer: this.drawOffer, over: this.over, away: this.away,
    }
  }
}
