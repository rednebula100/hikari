// Online groundwork: wake the Render server, join the lobby, measure latency and the server-clock offset.
// The Colyseus SDK is loaded lazily, so offline players never download it.
// The server URL comes from VITE_SERVER_URL at build time (GitHub Actions variable SERVER_URL).
import { idToken } from './account'

export const SERVER_URL = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/+$/, '')
export const configured = () => !!SERVER_URL

export type NetState =
  | { s: 'off' }                                   // no server configured in this build
  | { s: 'waking'; tries: number; since: number } // free Render instances sleep after 15 idle minutes
  | { s: 'joining' }
  | { s: 'online'; online: number; signed: number; ping: number; offset: number; version: string; you: { name: string; guest: boolean; uid: string | null } }
  | { s: 'error'; message: string }

type Listener = (st: NetState) => void
let state: NetState = { s: 'off' }
const listeners = new Set<Listener>()
const emit = (st: NetState) => { state = st; listeners.forEach(f => f(st)) }
export const netState = () => state
export function onNet(f: Listener) { listeners.add(f); f(state); return () => { listeners.delete(f) } }

let room: { leave(c?: boolean): Promise<number>; send(t: string, p?: unknown): void } | null = null
let pingTimer = 0, busy = false

/** Polls /healthz until the instance answers (a cold start takes up to about a minute). */
async function wake(): Promise<{ version: string }> {
  const since = performance.now()
  for (let tries = 1; tries <= 40; tries++) {
    emit({ s: 'waking', tries, since })
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000)
      const r = await fetch(SERVER_URL + '/healthz', { signal: ctl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (r.ok) return await r.json()
    } catch { /* still asleep */ }
    await new Promise(r => setTimeout(r, 2500))
  }
  throw new Error('서버가 깨어나지 않았습니다')
}

/** Connects (idempotent). Resolves when the lobby is joined or the attempt failed. */
export async function connect() {
  if (!configured()) { emit({ s: 'off' }); return }
  if (room || busy) return
  busy = true
  try {
    const health = await wake()
    emit({ s: 'joining' })
    const { Client } = await import('@colyseus/sdk')
    const client = new Client(SERVER_URL)
    // the server verifies the Firebase ID token itself; without one we join as a guest
    const r = await client.joinOrCreate('lobby', { token: await idToken().catch(() => null) })
    room = r
    let online = 0, signed = 0, ping = 0, offset = 0, you = { name: '손님', guest: true, uid: null as string | null }
    const show = () => emit({ s: 'online', online, signed, ping, offset, version: health.version, you })
    r.onMessage('presence', (m: { online: number; signed?: number }) => { online = m.online; signed = m.signed ?? 0; show() })
    r.onMessage('welcome', (m: { you?: typeof you }) => { if (m.you) you = m.you; show() })
    r.onMessage('pong', (m: { t: number; server: number }) => {
      const now = performance.now(), rtt = now - m.t
      ping = Math.round(rtt)
      // NTP-style: the server stamped its clock half a round trip ago
      offset = Math.round(m.server + rtt / 2 - (performance.timeOrigin + now))
      show()
    })
    r.onLeave(() => { room = null; clearInterval(pingTimer); if (state.s === 'online') emit({ s: 'error', message: '연결이 끊어졌습니다' }) })
    const ping1 = () => r.send('ping', performance.now())
    ping1(); pingTimer = window.setInterval(ping1, 4000)
    show()
  } catch (e) {
    emit({ s: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally { busy = false }
}

export async function disconnect() {
  clearInterval(pingTimer)
  const r = room; room = null
  if (r) await r.leave(true).catch(() => 0)
  emit(configured() ? { s: 'error', message: '연결 안 됨' } : { s: 'off' })
}
