// The lobby: presence, latency and the ranked matchmaking queue.
// Players present a Firebase ID token; the server verifies it and reads the rating itself.
import { Room, matchMaker, type Client } from '@colyseus/core'
import { randomBytes } from 'node:crypto'
import { TIME_CONTROLS } from './clock.ts'
import { DEV_RANKED, playerFrom, type Player } from './firebase.ts'

export const VERSION = '0.9.0'

/** Allowed rating gap after waiting `ms` (both players must be inside each other's window). */
export const window_ = (ms: number) => (ms >= 45_000 ? Infinity : 150 + 75 * Math.floor(ms / 5_000))

interface Ticket { client: Client; player: Player; tc: string; since: number }

/** Pure pairing step (tested): returns pairs to start, oldest tickets first. */
export function pairUp<T extends { player: { uid: string | null; rating: number }; tc: string; since: number }>(queue: T[], now: number): [T, T][] {
  const left = [...queue].sort((a, b) => a.since - b.since), out: [T, T][] = []
  while (left.length) {
    const a = left.shift()!
    let best = -1, gap = Infinity
    left.forEach((b, i) => {
      if (b.tc !== a.tc || (a.player.uid && b.player.uid === a.player.uid)) return
      const d = Math.abs(a.player.rating - b.player.rating)
      if (d <= window_(now - a.since) && d <= window_(now - b.since) && d < gap) { best = i; gap = d }
    })
    if (best >= 0) out.push([a, left.splice(best, 1)[0]])
  }
  return out
}

export class LobbyRoom extends Room {
  maxClients = 1000
  autoDispose = false
  private players = new Map<string, Player>()
  private queue = new Map<string, Ticket>() // by sessionId

  async onAuth(_client: Client, options: { token?: string; dev?: string }) {
    return playerFrom(options?.token, options?.dev)
  }

  onCreate() {
    this.onMessage('ping', (client: Client, t: number) => client.send('pong', { t, server: Date.now() }))
    this.onMessage('queue', (client: Client, msg: { tc?: string }) => this.enqueue(client, String(msg?.tc ?? '')))
    this.onMessage('unqueue', (client: Client) => { this.queue.delete(client.sessionId); client.send('queue', { state: 'idle' }); this.announce() })
    this.setSimulationInterval(() => void this.matchmake(), 1000)
  }

  onJoin(client: Client, _options?: unknown, player?: Player) {
    const p = player ?? (client.auth as Player)
    this.players.set(client.sessionId, p)
    client.send('welcome', { version: VERSION, server: Date.now(), ranked: true, you: this.publicOf(p), dev: DEV_RANKED })
    this.announce()
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId); this.queue.delete(client.sessionId)
    this.announce()
  }

  private publicOf(p: Player) { return { uid: p.uid, name: p.name, guest: p.guest, rating: Math.round(p.rating), provisional: p.rd > 110, games: p.games } }

  private enqueue(client: Client, tc: string) {
    const p = this.players.get(client.sessionId)
    if (!p?.uid) return client.send('queue', { state: 'error', reason: 'login' })
    if (!TIME_CONTROLS.some(t => t.id === tc)) return client.send('queue', { state: 'error', reason: 'tc' })
    for (const [sid, t] of this.queue) if (t.player.uid === p.uid && sid !== client.sessionId) return client.send('queue', { state: 'error', reason: 'twice' })
    this.queue.set(client.sessionId, { client, player: p, tc, since: Date.now() })
    client.send('queue', { state: 'searching', tc, since: Date.now() })
    this.announce()
  }

  private async matchmake() {
    if (this.queue.size < 1) return
    const now = Date.now()
    // tell each waiting player how wide the search is now
    for (const t of this.queue.values()) t.client.send('queue', { state: 'searching', tc: t.tc, since: t.since, range: window_(now - t.since) === Infinity ? null : window_(now - t.since) })
    for (const [a, b] of pairUp([...this.queue.values()], now)) {
      this.queue.delete(a.client.sessionId); this.queue.delete(b.client.sessionId)
      const [white, black] = Math.random() < .5 ? [a, b] : [b, a]
      const seats = { w: randomBytes(12).toString('hex'), b: randomBytes(12).toString('hex') }
      try {
        const room = await matchMaker.createRoom('match', { tc: a.tc, white: white.player, black: black.player, seats })
        const [rw, rb] = await Promise.all([
          matchMaker.reserveSeatFor(room, { seat: seats.w }, white.player),
          matchMaker.reserveSeatFor(room, { seat: seats.b }, black.player),
        ])
        const card = (p: Player) => this.publicOf(p)
        white.client.send('matched', { reservation: rw, seat: seats.w, color: 'w', tc: a.tc, opponent: card(black.player) })
        black.client.send('matched', { reservation: rb, seat: seats.b, color: 'b', tc: a.tc, opponent: card(white.player) })
      } catch (e) {
        console.error('match creation failed', e)
        for (const t of [a, b]) t.client.send('queue', { state: 'error', reason: 'server' })
      }
    }
    this.announce()
  }

  private announce() {
    const signed = [...this.players.values()].filter(p => p.uid && !p.guest).length
    const searching = Object.fromEntries(TIME_CONTROLS.map(t => [t.id, [...this.queue.values()].filter(q => q.tc === t.id).length]))
    this.broadcast('presence', { online: this.clients.length, signed, searching })
  }
}
