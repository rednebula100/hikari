// End-to-end smoke test against a running server started with RANKED_DEV=1:
//   PORT=2599 RANKED_DEV=1 npm start   then   npx tsx test/e2e.ts http://127.0.0.1:2599
// Two clients queue, get matched, play a few moves, one offers a draw that is declined, then resigns.
import { Client } from '../../node_modules/@colyseus/sdk/build/index.mjs'
import { START, fromFen, legal, make, type Side } from '../../src/engine/rules.ts'

const url = process.argv[2] ?? 'http://127.0.0.1:2599'
const log = (...a: unknown[]) => console.log(...a)
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function player(name: string) {
  const client = new Client(url)
  const lobby = await client.joinOrCreate('lobby', { dev: name })
  const matched = new Promise<any>(res => lobby.onMessage('matched', res))
  lobby.onMessage('queue', () => {}); lobby.onMessage('presence', () => {}); lobby.onMessage('welcome', () => {}); lobby.onMessage('pong', () => {})
  lobby.send('queue', { tc: '3+2' })
  const m = await matched
  const room = await client.consumeSeatReservation(m.reservation)
  return { name, client, lobby, room, color: m.color as Side, opponent: m.opponent }
}

const [a, b] = await Promise.all([player('알파'), player('베타')])
log('matched:', a.name, a.color, 'vs', b.name, b.color, '| opponent card', JSON.stringify(a.opponent))
const byColor = { [a.color]: a, [b.color]: b } as Record<Side, typeof a>
let pos = fromFen(START)
const ends: any[] = []
for (const p of [a, b]) {
  p.room.onMessage('sync', () => {}); p.room.onMessage('start', () => {}); p.room.onMessage('pong', () => {})
  p.room.onMessage('away', () => {}); p.room.onMessage('back', () => {})
  p.room.onMessage('reject', (r: any) => log(p.name, 'REJECT', r.reason))
  p.room.onMessage('draw', (d: any) => log(p.name, 'draw msg', JSON.stringify(d)))
  p.room.onMessage('end', (e: any) => ends.push({ who: p.name, ...e }))
}
let moved = 0
for (const p of [a, b]) p.room.onMessage('moved', () => { moved++ })

// six plies of real moves chosen by the shared engine
for (let ply = 0; ply < 6; ply++) {
  const side = pos.turn, mover = byColor[side]
  const m = legal(pos, 'clash')[ply % 3]
  mover.room.send('move', { from: m.from, to: m.to, promo: m.promo, via: m.via })
  pos = make(pos, m, 'clash').pos
  await wait(400)
}
// an illegal move is rejected
byColor[pos.turn].room.send('move', { from: 0, to: 63 })
await wait(300)
// draw offered and declined
byColor[pos.turn].room.send('draw', false); await wait(200)
byColor[pos.turn === 'w' ? 'b' : 'w'].room.send('draw', false); await wait(200)
// resign
byColor.w.room.send('resign')
await wait(1500)
log('moved broadcasts:', moved, '(expect 12 = 6 plies × 2 clients)')
log('end:', JSON.stringify(ends[0]))
const ok = moved === 12 && ends.length === 2 && ends[0].result === '0-1' && ends[0].reason === 'resign' && ends[0].ratings?.b.delta > 0
log(ok ? 'E2E OK' : 'E2E FAILED')
process.exit(ok ? 0 : 1)
