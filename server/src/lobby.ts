// The lobby: everyone who opens the online panel joins it. It reports presence and answers pings so the
// client can show latency and estimate the server clock offset (needed later for chess clocks).
// Players may present a Firebase ID token; the server verifies it (never trusts names sent by clients).
import { Room, type Client } from '@colyseus/core'
import { playerFrom, type Player } from './firebase.ts'

export const VERSION = '0.8.1'

export class LobbyRoom extends Room {
  maxClients = 500
  autoDispose = false
  private players = new Map<string, Player>()

  async onAuth(_client: Client, options: { token?: string }) {
    return playerFrom(options?.token)
  }

  onCreate() {
    this.onMessage('ping', (client: Client, t: number) => client.send('pong', { t, server: Date.now() }))
  }

  onJoin(client: Client, _options?: unknown, player?: Player) {
    const p = player ?? { uid: null, name: '손님', guest: true }
    this.players.set(client.sessionId, p)
    client.send('welcome', { version: VERSION, server: Date.now(), ranked: 'soon', you: p })
    this.announce()
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId)
    this.announce()
  }

  private announce() {
    const signed = [...this.players.values()].filter(p => p.uid && !p.guest).length
    this.broadcast('presence', { online: this.clients.length, signed })
  }
}
