// The aiming chalk-work: before a collision is committed, the engine's own
// result is sketched on the board in stroke order (run-up, contact, outcome).
import { gamma, momentum } from '../engine/collide';
import { MASS, make, type Mode, type Move, type Pos } from '../engine/rules';
import { X, Z } from './stage';
import type { Chalk } from './chalk';

type P = [number, number];
const KO: Record<string, string> = { p: '폰', n: '나이트', b: '비숍', r: '룩', q: '퀸', k: '킹' };

/**
 * o.half — 半 seal: only the run-up and the first contact are sketched.
 * o.classical — 速 seal: the whole sketch is computed with Newtonian mechanics (and says so).
 */
export function sketch(chalk: Chalk, pos: Pos, m: Move, mode: Mode, o: { newton?: boolean; numbers?: boolean; half?: boolean; classical?: boolean } = {}) {
  chalk.clearNow();
  chalk.tempo = 2.4;
  try { draw(chalk, pos, m, mode, o); } finally { chalk.tempo = 1; }
}
function draw(chalk: Chalk, pos: Pos, m: Move, mode: Mode, o: { newton?: boolean; numbers?: boolean; half?: boolean; classical?: boolean }) {
  const w = (s: number): P => [X(s), Z(s)];
  const r = make(pos, m, mode, { newton: o.classical });
  if (!r.out.clash && !r.out.stomp) { // ordinary move: a quiet dotted path
    chalk.path([w(m.from), w(m.to)], { dash: .12, alpha: .55, dur: 140 });
    chalk.circle(w(m.to), .2, { alpha: .7, delay: 120, dur: 120 });
    return
  }
  if (r.out.stomp) {
    const t = w(m.to);
    chalk.path([w(m.from), [(t[0] + w(m.from)[0]) / 2, (t[1] + w(m.from)[1]) / 2 - .01], t], { dash: .1, alpha: .6, dur: 160 });
    chalk.circle(t, .42, { delay: 150, dur: 160 }); chalk.cross(t, .2, { delay: 300, dur: 90 });
    chalk.text('낙하 — 그 자리에서 부서진다', [t[0], t[1] + .8], { size: .34, delay: 380 });
    return
  }
  const cl = r.out.clash!
  const line = cl.line
  const at = (s: number): P => { const a = w(line[0]), b = w(line[1] ?? line[0]); return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s] }
  const att = cl.sim.tracks.find(t => t.id === cl.attacker)!
  // ① run-up
  chalk.arrow(w(m.from), at(att.keys[0].s), { dash: .14, dur: 200, alpha: .8 })
  const g = gamma(cl.speed)
  chalk.text(`v ${cl.speed.toFixed(2)}${g > 1.15 ? '  γ' + g.toFixed(2) : ''}`, [(w(m.from)[0] + at(att.keys[0].s)[0]) / 2 + .55, (w(m.from)[1] + at(att.keys[0].s)[1]) / 2], { size: .36, delay: 160 })
  if (o.classical) chalk.text('뉴턴의 계산', [w(m.from)[0], w(m.from)[1] - .75], { size: .3, color: '#c9d7ff', alpha: .8 })
  if (o.half) {
    const k = cl.sim.contacts[0]
    if (k) { chalk.circle(at(k.s), .3, { delay: 260, dur: 140 }); chalk.text('?', [at(k.s)[0], at(k.s)[1] + .62], { size: .5, delay: 380 }) }
    return
  }
  // ② outcome of every body that moves
  let delay = 300
  for (const tr of cl.sim.tracks) {
    const s0 = tr.keys[0].s, s1 = tr.exit ? null : tr.keys.at(-1)!.s
    const piece = r.out.removed.find(x => x.id === tr.id) ?? pos.board.find(x => x?.id === tr.id) ?? pos.board[m.from]!
    if (s1 !== null && Math.abs(Math.round(s1) - Math.round(s0)) < 1 && tr.id !== cl.attacker) continue
    if (tr.exit) {
      const edge = tr.exit.side > 0 ? line.length - .5 : -.5
      const beyond = at(edge + tr.exit.side * .55)
      chalk.arrow(at(s0), beyond, { dur: 180, delay, color: '#ffb8a8' })
      chalk.cross(beyond, .2, { delay: delay + 200, color: '#ffb8a8' })
      chalk.text(`${KO[piece.kind]} 낙하`, [beyond[0], beyond[1] + .55], { size: .32, delay: delay + 260, color: '#ffb8a8' })
    } else if (Math.round(s1!) !== Math.round(s0)) {
      chalk.arrow(at(s0), at(Math.round(s1!)), { dur: 170, delay })
      chalk.circle(at(Math.round(s1!)), .36, { delay: delay + 150, dur: 140, alpha: .7 })
    }
    delay += 160
  }
  // ③ conservation in the margin
  if (o.numbers !== false) {
    const m0 = MASS[pos.board[m.from]!.kind]
    chalk.text(`Σp  ${momentum(m0, cl.speed).toFixed(1)} → ${cl.sim.p1.toFixed(1)}`, [0, -4.75], { size: .4, delay, alpha: .8 })
  }
  // ④ the classical (wrong) answer, faint
  if (o.newton) {
    const n = make(pos, m, mode, { newton: true }).out.clash!
    for (const tr of n.sim.tracks) {
      if (!tr.exit || cl.sim.tracks.find(x => x.id === tr.id)?.exit) continue
      const beyond = at((tr.exit.side > 0 ? line.length - .5 : -.5) + tr.exit.side * .55)
      chalk.cross(beyond, .2, { delay: delay + 200, alpha: .35 })
      chalk.text('뉴턴이었다면 떨어졌다', [beyond[0], beyond[1] - .5], { size: .3, delay: delay + 300, alpha: .45 })
    }
  }
}
