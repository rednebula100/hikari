// Online: wake the Render server, join the lobby, measure latency/clock offset, queue for ranked games and hand
// the reserved seat to a match session. The Colyseus SDK is loaded lazily (offline players never download it).
// The server URL comes from VITE_SERVER_URL at build time (GitHub Actions variable SERVER_URL).
import { idToken } from './account'
import type { Side } from '../engine/rules'

export const SERVER_URL = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/+$/, '')
export const configured = () => !!SERVER_URL

export interface PlayerCard { uid: string | null; name: string; guest: boolean; rating: number; provisional: boolean; games: number }
export type NetState =
  | { s: 'off' }                                   // no server configured in this build
  | { s: 'waking'; tries: number; since: number } // free Render instances sleep after 15 idle minutes
  | { s: 'joining' }
  | { s: 'online'; online: number; signed: number; searching: Record<string, number>; ping: number; offset: number; version: string; you: PlayerCard }
  | { s: 'error'; message: string }
export type QueueState =
  | { state: 'idle' }
  | { state: 'searching'; tc: string; since: number; range?: number | null }
  | { state: 'error'; reason: 'login' | 'tc' | 'twice' | 'server' | string }

type Listener<T> = (v: T) => void
function signal<T>(init: T) {
  let v = init
  const ls = new Set<Listener<T>>()
  return {
    get: () => v,
    set: (n: T) => { v = n; ls.forEach(f => f(n)) },
    on: (f: Listener<T>) => { ls.add(f); f(v); return () => { ls.delete(f) } },
  }
}
const net = signal<NetState>({ s: 'off' })
const queueSig = signal<QueueState>({ state: 'idle' })
export const netState = net.get
export const onNet = net.on
export const queueState = queueSig.get
export const onQueue = queueSig.on

type SdkRoom = {
  leave(c?: boolean): Promise<number>; send(t: string, p?: unknown): void
  onMessage(t: string, f: (m: any) => void): () => void; onLeave(f: (code: number) => void): void
  reconnection?: { enabled: boolean; maxRetries: number }
  reconnectionToken?: string
}
type SdkClient = { joinOrCreate(n: string, o?: object): Promise<SdkRoom>; consumeSeatReservation(r: unknown): Promise<SdkRoom>; reconnect(token: string): Promise<SdkRoom> }
let client: SdkClient | null = null
let room: SdkRoom | null = null
let pingTimer = 0, busy = false
/** Server time ≈ Date.now() + offset (NTP-style estimate from lobby pings). */
let offset = 0, lastRtt = 0
export const serverNow = () => Date.now() + offset

/** Polls /healthz until the instance answers (a cold start takes up to about a minute). */
async function wake(): Promise<{ version: string }> {
  const since = performance.now()
  for (let tries = 1; tries <= 40; tries++) {
    net.set({ s: 'waking', tries, since })
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

// ── matches ──
export interface MatchSync {
  you: Side; tc: string; white: Omit<PlayerCard, 'uid' | 'games'>; black: Omit<PlayerCard, 'uid' | 'games'>
  moves: string[]; clock: ClockSnap; server: number; drawOffer: Side | null; over: boolean; away: Partial<Record<Side, number>>
}
export interface ClockSnap { w: number; b: number; turn: Side; running: boolean; flagged: Side | null }
export interface Moved { ply: number; by: Side; move: { from: number; to: number; promo?: string; via?: number }; clock: ClockSnap; grace: number; server: number; drawOffer: Side | null }
export interface RatingChange { before: number; after: number; delta: number; provisional: boolean }
export interface MatchEnd { result: '1-0' | '0-1' | '1/2-1/2' | 'aborted'; reason: string; ratings?: { w: RatingChange; b: RatingChange } | null }
export interface MatchEvents {
  sync(s: MatchSync): void
  start(s: { firstMoveMs: number; server: number }): void
  moved(m: Moved): void
  reject(r: { reason: string; sync: MatchSync }): void
  draw(d: { offer: Side | null; declined?: Side }): void
  away(a: { side: Side; until: number; seconds: number }): void
  back(b: { side: Side }): void
  end(e: MatchEnd): void
  lost(): void
}
export interface Match {
  color: Side; tc: string; opponent: PlayerCard
  move(m: { from: number; to: number; promo?: string; via?: number }): void
  resign(): void; abort(): void; draw(accept?: boolean): void
  leave(): Promise<void>
}
let matchedHandler: ((m: { color: Side; tc: string; opponent: PlayerCard; open(ev: MatchEvents): Promise<Match> }) => void) | null = null
/** The app registers what happens when the matchmaker finds an opponent. */
export function onMatched(f: typeof matchedHandler) { matchedHandler = f }

// a refresh mid-game rejoins the same seat (the server holds it for 40 s)
const RESUME = 'shou:match'
type Resume = { token: string; color: Side; tc: string; opponent: PlayerCard; at: number }
export function resumable(): Resume | null {
  try { const r = JSON.parse(sessionStorage.getItem(RESUME) ?? 'null') as Resume | null; return r && Date.now() - r.at < 40_000 ? r : null } catch { return null }
}
const forget = () => { try { sessionStorage.removeItem(RESUME) } catch { /* */ } }
/** Rejoins a game this tab was playing before a refresh. */
export async function resume(ev: MatchEvents): Promise<Match | null> {
  const r0 = resumable(); if (!r0 || !configured()) return null
  try {
    const { Client } = await import('@colyseus/sdk')
    client ??= new Client(SERVER_URL) as unknown as SdkClient
    const r = await client.reconnect(r0.token)
    return wrap(r, r0.color, r0.tc, r0.opponent, ev)
  } catch { forget(); return null }
}

async function openMatch(reservation: unknown, color: Side, tc: string, opponent: PlayerCard, ev: MatchEvents): Promise<Match> {
  if (!client) throw new Error('no client')
  return wrap(await client.consumeSeatReservation(reservation), color, tc, opponent, ev)
}
function wrap(r: SdkRoom, color: Side, tc: string, opponent: PlayerCard, ev: MatchEvents): Match {
  const remember = () => { try { if (r.reconnectionToken) sessionStorage.setItem(RESUME, JSON.stringify({ token: r.reconnectionToken, color, tc, opponent, at: Date.now() })) } catch { /* */ } }
  remember(); const keep = window.setInterval(remember, 5000)
  const on = <K extends keyof MatchEvents>(k: K) => r.onMessage(k, (m: Parameters<MatchEvents[K]>[0]) => (ev[k] as (x: unknown) => void)(m))
  ;(['sync', 'start', 'moved', 'reject', 'draw', 'away', 'back', 'end'] as const).forEach(k => on(k))
  r.onMessage('pong', () => {})
  r.send('hello')
  let ended = false
  r.onMessage('end', () => { ended = true; clearInterval(keep); forget() })
  r.onLeave(() => { clearInterval(rttTimer); clearInterval(keep); if (!ended) ev.lost() })
  // tell the server our measured round trip so it can credit network lag on our clock
  const rttTimer = window.setInterval(() => r.send('rtt', lastRtt), 5000); r.send('rtt', lastRtt)
  return {
    color, tc, opponent,
    move: m => r.send('move', m),
    resign: () => r.send('resign'),
    abort: () => r.send('abort'),
    draw: (accept = false) => r.send('draw', accept),
    leave: async () => { clearInterval(rttTimer); clearInterval(keep); forget(); ended = true; await r.leave(true).catch(() => 0) },
  }
}

/** Connects (idempotent). Resolves when the lobby is joined or the attempt failed. */
export async function connect() {
  if (!configured()) { net.set({ s: 'off' }); return }
  if (room || busy) return
  busy = true
  try {
    const health = await wake()
    net.set({ s: 'joining' })
    const { Client } = await import('@colyseus/sdk')
    client = new Client(SERVER_URL) as unknown as SdkClient
    // the server verifies the Firebase ID token itself; without one we join as a guest
    // dev builds against a RANKED_DEV server (no Firebase) identify by a per-tab name
    const dev = import.meta.env.DEV ? (sessionStorage.getItem('devname') ?? (sessionStorage.setItem('devname', '개발' + Math.floor(Math.random() * 900 + 100)), sessionStorage.getItem('devname'))) : undefined
    const r = await client.joinOrCreate('lobby', { token: await idToken().catch(() => null), dev })
    room = r
    let online = 0, signed = 0, ping = 0, searching: Record<string, number> = {}
    let you: PlayerCard = { uid: null, name: '손님', guest: true, rating: 1500, provisional: true, games: 0 }
    const show = () => net.set({ s: 'online', online, signed, searching, ping, offset, version: health.version, you })
    r.onMessage('presence', (m: { online: number; signed?: number; searching?: Record<string, number> }) => { online = m.online; signed = m.signed ?? 0; searching = m.searching ?? {}; show() })
    r.onMessage('welcome', (m: { you?: PlayerCard }) => { if (m.you) you = m.you; show() })
    r.onMessage('queue', (q: QueueState) => queueSig.set(q))
    r.onMessage('matched', (m: { reservation: unknown; color: Side; tc: string; opponent: PlayerCard }) => {
      queueSig.set({ state: 'idle' })
      matchedHandler?.({ color: m.color, tc: m.tc, opponent: m.opponent, open: ev => openMatch(m.reservation, m.color, m.tc, m.opponent, ev) })
    })
    r.onMessage('pong', (m: { t: number; server: number }) => {
      const now = performance.now(), rtt = now - m.t
      ping = Math.round(rtt); lastRtt = rtt
      // NTP-style: the server stamped its clock half a round trip ago
      offset = Math.round(m.server + rtt / 2 - (performance.timeOrigin + now))
      show()
    })
    r.onLeave(() => { room = null; clearInterval(pingTimer); queueSig.set({ state: 'idle' }); if (net.get().s === 'online') net.set({ s: 'error', message: '연결이 끊어졌습니다' }) })
    const ping1 = () => r.send('ping', performance.now())
    ping1(); pingTimer = window.setInterval(ping1, 4000)
    show()
  } catch (e) {
    net.set({ s: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally { busy = false }
}

export function queue(tc: string) { room?.send('queue', { tc }) }
export function unqueue() { room?.send('unqueue'); queueSig.set({ state: 'idle' }) }

export async function disconnect() {
  clearInterval(pingTimer)
  const r = room; room = null
  queueSig.set({ state: 'idle' })
  if (r) await r.leave(true).catch(() => 0)
  net.set(configured() ? { s: 'error', message: '연결 안 됨' } : { s: 'off' })
}
