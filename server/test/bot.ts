// A sparring bot for manual/browser testing against a RANKED_DEV server:
//   npx tsx test/bot.ts http://127.0.0.1:2599 3+2
// Queues once, plays random legal moves after ~1.5 s, offers nothing, accepts nothing.
import { Client } from '../../node_modules/@colyseus/sdk/build/index.mjs'
import { START, fromFen, legal, make, type Side } from '../../src/engine/rules.ts'

const url = process.argv[2] ?? 'http://127.0.0.1:2599', tc = process.argv[3] ?? '3+2', delay = Number(process.argv[4] ?? 1500), name = process.argv[5] ?? '봇'
const client = new Client(url)
const lobby = await client.joinOrCreate('lobby', { dev: name })
for (const t of ['queue', 'presence', 'welcome', 'pong']) lobby.onMessage(t, () => {})
lobby.send('queue', { tc })
console.log('bot queued', tc)
const m: any = await new Promise(res => lobby.onMessage('matched', res))
const room = await client.consumeSeatReservation(m.reservation)
const me: Side = m.color
console.log('bot matched as', me, 'vs', m.opponent.name)
let pos = fromFen(START), plies = 0
const think = () => {
  if (pos.turn !== me) return
  setTimeout(() => {
    const ms = legal(pos, 'clash'); if (!ms.length) return
    const mv = ms[Math.floor(Math.random() * ms.length)]
    room.send('move', { from: mv.from, to: mv.to, promo: mv.promo, via: mv.via })
  }, delay)
}
const replay = (moves: string[]) => {
  pos = fromFen(START)
  for (const u of moves) {
    const [a, b] = u.split(/[-@qrbn]/).map(Number)
    const mv = legal(pos, 'clash').find(x => x.from === a && x.to === b)!
    pos = make(pos, mv, 'clash').pos
  }
  plies = moves.length
}
room.onMessage('sync', (s: any) => { replay(s.moves); think() })
room.onMessage('start', () => think())
room.onMessage('moved', (mv: any) => {
  if (mv.ply <= plies) return
  const x = legal(pos, 'clash').find(y => y.from === mv.move.from && y.to === mv.move.to && (y.promo ?? undefined) === (mv.move.promo ?? undefined) && (y.via ?? undefined) === (mv.move.via ?? undefined))!
  pos = make(pos, x, 'clash').pos; plies = mv.ply
  think()
})
for (const t of ['draw', 'away', 'back', 'pong', 'reject']) room.onMessage(t, (x: any) => console.log('bot', t, JSON.stringify(x)))
room.onMessage('end', (e: any) => { console.log('bot end', JSON.stringify(e)); setTimeout(() => process.exit(0), 500) })
