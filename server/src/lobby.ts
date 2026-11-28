// The lobby: everyone who opens the online panel joins it. It reports presence and answers pings so the
// client can show latency and estimate the server clock offset (needed later for chess clocks).
import { Room, type Client } from '@colyseus/core'

export const VERSION = '0.8.0'

export class LobbyRoom extends Room {
  maxClients = 500
  autoDispose = false
  private names = new Map<string, string>()

  onCreate() {
    this.onMessage('ping', (client: Client, t: number) => client.send('pong', { t, server: Date.now() }))
    this.onMessage('hello', (client: Client, msg: { name?: string }) => {
      const name = String(msg?.name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 16)
      if (name) this.names.set(client.sessionId, name)
      this.announce()
    })
  }

  onJoin(client: Client) {
    client.send('welcome', { version: VERSION, server: Date.now(), ranked: 'soon' })
    this.announce()
  }

  onLeave(client: Client) {
    this.names.delete(client.sessionId)
    this.announce()
  }

  private announce() {
    this.broadcast('presence', { online: this.clients.length })
  }
}
