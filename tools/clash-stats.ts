// Bot health check for 衝 (and classic) — not a fun metric.
import { fromFen, make, status, toFen, START, type Mode } from '../src/engine/rules.ts'
import { choose, rng, type Level } from '../src/engine/ai.ts'
const mode = (process.argv[3] ?? 'clash') as Mode
for (const [lw, lb] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2]] as [Level, Level][]) {
  const reasons: string[] = []; let w = 0, b = 0, d = 0, plies = 0, ms = 0, moves = 0, chains = 0, offs = 0
  const N = Number(process.argv[2] ?? 6)
  for (let s = 1; s <= N; s++) {
    let p = fromFen(START); const r = rng(s * 977), hist: string[] = []
    for (let ply = 0; ply < 300; ply++) {
      const st = status(p, mode, hist)
      if (st.over) { st.result === '1-0' ? w++ : st.result === '0-1' ? b++ : (d++, reasons.push(st.reason)); break }
      if (ply === 299) d++
      const t0 = performance.now(); const m = choose(p, mode, p.turn === 'w' ? lw : lb, r, hist)!; ms += performance.now() - t0; moves++
      const res = make(p, m, mode)
      if (res.out.clash && res.out.clash.sim.contacts.length > 1) chains++
      offs += res.out.clash ? res.out.removed.length : 0
      hist.push(toFen(p, false)); p = res.pos; plies++
    }
  }
  console.log(`${mode} W${lw} vs B${lb}: ${w}/${b}/${d} avg plies ${(plies / N).toFixed(0)} chains/game ${(chains / N).toFixed(1)} ring-outs/game ${(offs / N).toFixed(1)} ${(ms / moves).toFixed(0)}ms/move ${reasons.join(',')}`)
}
