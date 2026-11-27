// Engine micro-benchmarks (ms). Run: npx tsx tools/bench.ts
import { fromFen, legal, status, toFen, inCheck, START } from '../src/engine/rules.ts'
import { choose, rng } from '../src/engine/ai.ts'
const POS = {
  start: START,
  middle: 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9',
  open: '2r2rk1/1b3ppp/p3pn2/1p6/3q4/P2B1N2/1P1Q1PPP/2R2RK1 w - - 0 20',
}
const time = (f: () => unknown, n = 20) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n }
for (const [k, fen] of Object.entries(POS)) {
  const p = fromFen(fen)
  console.log(k.padEnd(7),
    'legal(clash)', time(() => legal(p, 'clash')).toFixed(2),
    '| legal(classic)', time(() => legal(p, 'classic')).toFixed(2),
    '| status', time(() => status(p, 'clash')).toFixed(2),
    '| inCheck', time(() => inCheck(p, 'clash')).toFixed(3),
    '| toFen', time(() => toFen(p, false)).toFixed(3),
    '| AI L2', time(() => choose(p, 'clash', 2, rng(1)), 3).toFixed(1),
    '| AI L3', time(() => choose(p, 'clash', 3, rng(1)), 2).toFixed(1))
}
