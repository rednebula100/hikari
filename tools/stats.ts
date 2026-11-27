// Bot-vs-bot health check for the relativistic chess rules (not a fun metric).
import { Game, type Side } from '../src/chess/game.ts'
import { chooseMove, rng, type Level } from '../src/chess/ai.ts'
const pairs: [Level, Level][] = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3]]
for (const [lw, lb] of pairs) {
  let w = 0, b = 0, d = 0, plies = 0, inter = 0, miss = 0, blocked = 0
  const N = Number(process.argv[2] ?? 12)
  const t0 = Date.now()
  for (let s = 1; s <= N; s++) {
    const g = new Game(), r = rng(s * 7919)
    while (!g.winner) { const side: Side = g.toMove; const m = chooseMove(g.view(side), side === 'w' ? lw : lb, r)!; g.play(side, m.from, m.to) }
    g.winner === 'w' ? w++ : g.winner === 'b' ? b++ : d++
    plies += g.ply
    for (const m of g.moves) { if (m.outcome === 'intercept') inter++; if (m.outcome === 'miss') miss++; if (m.outcome === 'blocked') blocked++ }
  }
  console.log(`W${lw} vs B${lb}: ${w}/${b}/${d}  avg plies ${(plies / N).toFixed(0)}  intercepts ${(inter / N).toFixed(1)} misses ${(miss / N).toFixed(1)} blocked ${(blocked / N).toFixed(1)} /game  ${((Date.now() - t0) / N).toFixed(0)}ms/game`)
}
