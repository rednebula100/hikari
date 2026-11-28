// shou (衝) online server (groundwork). Runs on Render's free web service:
//   GET /healthz  → 200 {ok, version, uptime, online}  (Render health check + client wake-up probe)
//   GET /         → redirects to the game (GAME_URL); the server itself has no page
//   ws  /         → Colyseus: room "lobby"
// Environment: PORT (Render sets it), ALLOWED_ORIGINS (comma list; empty = allow all, for local dev).
import { Server, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { LobbyRoom, VERSION } from './lobby.ts'
import { firebase } from './firebase.ts'
// the rules engine is shared with the client — ranked games will be validated with exactly this code
import { fromFen, legal, START } from '../../src/engine/rules.ts'

const PORT = Number(process.env.PORT ?? 2567)
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const allow = (origin: string | null) => !ALLOWED.length || (!!origin && ALLOWED.includes(origin))
const started = Date.now()
const GAME_URL = process.env.GAME_URL ?? 'https://rednebula100.github.io/hikari/'

// matchmaking requests: only our own pages may create or join rooms
matchMaker.controller.getCorsHeaders = (headers: Headers) => {
  const origin = headers.get('origin')
  return { 'Access-Control-Allow-Origin': allow(origin) ? origin || '*' : 'null', Vary: 'Origin' }
}

// sanity check that the shared engine loads (fails fast at boot instead of mid-match)
const openingMoves = legal(fromFen(START), 'clash').length

const server = new Server({
  greet: false,
  transport: new WebSocketTransport({ pingInterval: 15_000, pingMaxRetries: 2 }),
  express: app => {
    app.use((req, res, next) => {
      const origin = req.headers.origin ?? null
      if (origin && allow(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
      next()
    })
    app.get('/healthz', async (_req, res) => {
      const rooms = await matchMaker.query({ name: 'lobby' })
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ok: true, version: VERSION, uptime: Math.round((Date.now() - started) / 1000), online: rooms.reduce((n, r) => n + r.clients, 0), engine: openingMoves, firebase: firebase ? firebase.projectId : false })
    })
    // people open the service URL in a browser expecting the game: send them there
    app.get('/', (_req, res) => { res.redirect(302, GAME_URL) })
  },
})

server.define('lobby', LobbyRoom)
await server.listen(PORT, '0.0.0.0')
console.log(`shou server ${VERSION} listening on :${PORT} (engine ok: ${openingMoves} opening moves; origins: ${ALLOWED.join(' ') || 'any'}; firebase: ${firebase ? firebase.projectId : 'off'})`)
