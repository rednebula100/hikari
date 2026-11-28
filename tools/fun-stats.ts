// Design probe: how do bot games actually unfold under the current rules? (Bots are not fun — this only shows
// which mechanics happen, how often, and how games end.)  npx tsx tools/fun-stats.ts [games] [levelW] [levelB]
import { fromFen, make, status, toFen, START, MASS } from '../src/engine/rules.ts'
if (process.env.KMASS) (MASS as Record<string, number>).k = Number(process.env.KMASS)
import { choose, rng, type Level } from '../src/engine/ai.ts'

const N = Number(process.argv[2] ?? 8), lw = Number(process.argv[3] ?? 2) as Level, lb = Number(process.argv[4] ?? 2) as Level
const c = { w: 0, b: 0, d: 0, plies: 0, clash: 0, push: 0, removed: 0, stomp: 0, shock: 0, shockOut: 0, cushion: 0, phalanx: 0, quiet: 0, firstRemoval: 0, games: 0 }
const reasons = new Map<string, number>()
for (let g = 1; g <= N; g++) {
  let p = fromFen(START); const r = rng(g * 7919), hist: string[] = []; let first = -1
  for (let ply = 0; ply < 300; ply++) {
    const st = status(p, 'clash', hist)
    if (st.over) { st.result === '1-0' ? c.w++ : st.result === '0-1' ? c.b++ : c.d++; reasons.set(st.reason, (reasons.get(st.reason) ?? 0) + 1); break }
    if (ply === 299) { c.d++; reasons.set('cap', (reasons.get('cap') ?? 0) + 1) }
    const m = choose(p, 'clash', p.turn === 'w' ? lw : lb, r, hist)!
    const res = make(p, m, 'clash'), o = res.out
    if (o.clash) { c.clash++; if (!o.removed.length) c.push++; if (o.clash.phalanx.length) c.phalanx++ } else if (!o.stomp && o.move.flag !== 'e') c.quiet++
    if (o.stomp) c.stomp++
    if (o.shock?.length) { c.shock++; c.shockOut += o.shock.filter(x => x.to === null).length }
    if (m.via !== undefined) c.cushion++
    c.removed += o.removed.length
    if (o.removed.length && first < 0) first = ply
    hist.push(toFen(p, false)); p = res.pos; c.plies++
  }
  c.firstRemoval += first < 0 ? 300 : first; c.games++
}
const per = (x: number) => (x / c.games).toFixed(1)
console.log(`W${lw} vs B${lb} × ${c.games}: +${c.w} -${c.b} =${c.d}  reasons ${JSON.stringify([...reasons])}`)
console.log(`plies/game ${per(c.plies)} · first removal at ply ${per(c.firstRemoval)} · removed/game ${per(c.removed)}`)
console.log(`clashes/game ${per(c.clash)} (push-only ${(100 * c.push / Math.max(1, c.clash)).toFixed(0)}%) · stomps ${per(c.stomp)} · shocks ${per(c.shock)} (ring-outs ${per(c.shockOut)}) · cushions ${per(c.cushion)} · phalanx ${per(c.phalanx)}`)
