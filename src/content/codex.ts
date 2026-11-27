// 현상 도감 — 48 phenomena the engine can witness. Pure detection; the app stores the photographs.
import { MASS, cheb, make, type Outcome, type Pos, type Side } from '../engine/rules.ts'
import { C, gamma } from '../engine/collide.ts'

export type Rarity = 1 | 2 | 3 | 4 // 일반 · 드묾 · 희귀 · 전설
export interface Entry { id: string; no: number; group: number; name: string; hint: string; formula: string; text: string; rarity: Rarity }
export const GROUPS = ['Ⅰ 탄성', 'Ⅱ 비탄성·충격파', 'Ⅲ 상대론', 'Ⅳ 체스', 'Ⅴ 光', 'Ⅵ 문제집·놀이']
export const RARITY = ['', '일반', '드묾', '희귀', '전설']

const E = (group: number, id: string, name: string, rarity: Rarity, hint: string, formula: string, text: string) => ({ group, id, name, rarity, hint, formula, text })
const RAW = [
  E(0, 'first', '첫 충돌', 1, '아무 기물로 상대 기물에 부딪쳐 본다', 'Σp = Σp′', '잡기 대신 충돌. 운동량은 사라지지 않고 옮겨 갈 뿐이다.'),
  E(0, 'cradle', '뉴턴의 요람', 2, '같은 질량 셋이 한 줄로 이어질 때', 'm₁ = m₂ ⇒ v₁′ = 0, v₂′ = v₁', '같은 질량끼리는 속도를 통째로 교환한다. 맨 끝 하나만 튀어 나간다.'),
  E(0, 'cradle5', '긴 요람', 4, '같은 질량 다섯 이상', 'v → v → v → v → v', '속도가 줄을 따라 전달되는 동안 중간 기물은 거의 움직이지 않는다.'),
  E(0, 'exchange', '완전 교환', 2, '부딪친 쪽이 그 자리에 멈춘다', 'v₁′ = (m₁−m₂)v₁/(m₁+m₂) = 0', '같은 질량의 정면 탄성 충돌: 공격자의 모든 운동량이 상대에게 넘어간다.'),
  E(0, 'bounce', '반동', 1, '가벼운 기물로 무거운 기물을 친다', 'm₁ < m₂ ⇒ v₁′ < 0', '가벼운 쪽이 튕겨 나온다. 가벼울수록 더 세게.'),
  E(0, 'overshoot', '오버슈트', 2, '무거운 공격자가 표적을 따라 끝까지 간다', 'm₁ > m₂ ⇒ v₁′ > 0', '무거운 공격자는 충돌 뒤에도 계속 전진한다. 판 끝이 가까우면 자신도 떨어진다.'),
  E(0, 'together', '동반 낙하', 3, '공격자와 표적이 함께 떨어진다', 'v₁′ > 0, v₂′ > v₁′', '둘 다 판 밖으로. 교환은 됐지만 대가가 컸다.'),
  E(0, 'double', '이중 낙하', 2, '한 번의 충돌로 둘', 'Σ 제거 = 2', '연쇄를 설계했다는 뜻이다.'),
  E(0, 'triple', '삼중 낙하', 3, '한 번의 충돌로 셋', 'Σ 제거 = 3', '한 줄에 늘어선 적은 한 번의 충격에 약하다.'),
  E(0, 'quad', '사중 낙하', 4, '한 번의 충돌로 넷 이상', 'Σ 제거 ≥ 4', '당구에서도 보기 힘든 장면.'),
  E(0, 'push', '밀어내기', 1, '아무것도 떨어지지 않는 충돌', 'Δx > 0, 제거 0', '떨어뜨리지 못해도 자리를 빼앗을 수 있다.'),
  E(0, 'onestep', '한 칸의 미학', 2, '표적이 정확히 한 칸만 밀린다', 'Δx = 1', '충돌의 세기를 칸 단위로 조절했다.'),
  E(0, 'david', '다윗과 골리앗', 3, '폰으로 퀸이나 킹을 떨어뜨린다', 'm₁ = 1, m₂ ≥ 9', '가장 가벼운 기물이 가장 무거운 기물을 떨어뜨렸다. 연쇄 또는 낭떠러지 덕분이다.'),
  E(0, 'wall', '철벽', 1, '훨씬 무거운 기물에 부딪쳐도 꿈쩍 않는다', 'm₂ ≫ m₁ ⇒ v₂′ ≈ 0', '무거운 표적은 움직임이 반올림되어 제자리에 남는다.'),
  E(0, 'friendly', '아군 사격', 2, '내 충돌로 내 기물이 떨어진다', '연쇄는 편을 가리지 않는다', '운동량은 피아를 구분하지 않는다.'),
  E(0, 'pingpong', '다중 반사', 3, '한 기물이 세 번 이상 부딪친다', '접촉 ≥ 3 (한 기물)', '좁은 공간에서 기물이 공처럼 왕복한다.'),
  E(0, 'chain5', '5연쇄', 3, '한 수에 접촉 다섯 번 이상', '접촉 수 ≥ 5', '사건 기반 시뮬레이션이 한 턴 안에 처리한 연쇄.'),
  E(0, 'diagonal', '대각선 충돌', 1, '비숍이나 퀸으로 대각선 충돌', '충돌선 = 대각선', '충돌은 이동한 선을 따라 1차원으로 일어난다.'),
  E(0, 'pawnhit', '폰의 일격', 1, '폰이 대각선으로 부딪친다', 'm = 1, L = 1', '가장 작은 충돌. 도움닫기는 한 칸뿐.'),
  E(0, 'enpassant', '앙파상', 2, '지나가는 폰을 잡는다', 'FIDE e.p.', '충돌 체스에서도 앙파상은 체스 그대로다.'),
  E(1, 'stomp', '낙하 공격', 1, '나이트로 상대 기물 위에 내려앉는다', 'K → Q (열)', '나이트는 뛰어올라 내려찍는다. 완전 비탄성: 운동 에너지가 열이 된다.'),
  E(1, 'heat', '열 축적', 2, '한 판에 낙하 공격 세 번', 'ΣQ = 3', '판이 달아오른다.'),
  E(1, 'overheat', '과열', 3, '같은 나이트로 세 번', 'Q₁ + Q₂ + Q₃', '한 나이트가 세 번 내려찍었다.'),
  E(1, 'shock', '충격파', 1, '나이트가 적 기물 바로 옆에 내려앉는다', 'Δx = 1 (질량 ≤ 5)', '착지의 충격이 상하좌우의 적을 한 칸씩 밀어낸다. 퀸과 킹은 버틴다.'),
  E(1, 'shockout', '충격파 낙하', 2, '충격파로 적을 판 밖으로', '가장자리 + 충격파', '나이트는 직접 닿지 않고도 기물을 떨어뜨릴 수 있다 — 위치의 무기.'),
  E(1, 'knightmate', '충격파 메이트', 3, '나이트의 수로 체크메이트', '충격파 → 메이트', '나이트는 킹을 짓밟을 수 없다. 대신 수비수를 흩어 메이트를 열었다.'),
  E(0, 'cushion', '쿠션 샷', 2, '비숍이 가장자리에서 튕겨 부딪친다', '입사각 = 반사각', '당구의 쿠션. 꺾인 길도 도움닫기에 들어간다.'),
  E(0, 'phalanx', '팔랑크스', 2, '나란히 선 폰에 부딪친다', 'm = 1 + 이웃 폰', '옆에 붙은 아군 폰이 맞은 폰을 받쳐 더 무겁게 만든다.'),
  E(2, 'runup', '도움닫기', 1, '네 칸 이상 달려와 부딪친다', 'γ = 1 + aL/c²', '먼 거리에서 출발할수록 빨라진다. 단, 빛보다 빠를 수는 없다.'),
  E(2, 'g125', 'γ 1.25', 2, '로런츠 인자 1.25 이상', 'γ = 1/√(1 − v²/c²) ≥ 1.25', '속도의 60%가 빛의 속도에 닿았다. 질량이 무거워진 것처럼 행동한다.'),
  E(2, 'g150', 'γ 1.5', 3, '로런츠 인자 1.5 이상 (6칸 이상 질주)', 'γ ≥ 1.5 ⇔ v ≥ 0.75c', '속도는 거의 늘지 않는데 운동량은 계속 늘어난다.'),
  E(2, 'sprint', '전력 질주', 3, '판 끝에서 끝까지 일곱 칸', 'L = 7, v ≈ 0.79c', '도움닫기의 최대치.'),
  E(2, 'newton', '뉴턴은 틀렸다', 3, '고전역학 계산과 결과가 다른 충돌', 'p = mv ≠ γmv', '같은 수를 뉴턴의 공식으로 계산하면 다른 기물이 떨어진다. 상대론이 판을 바꿨다.'),
  E(2, 'amplify', '속도 증폭', 2, '표적이 공격자보다 훨씬 빠르게 튀어 나간다', 'v₂′ = 2m₁v/(m₁+m₂) (고전 극한)', '무거운 공격자가 가벼운 표적을 치면 표적은 공격자보다 빨라진다 — 그래도 c는 넘지 못한다.'),
  E(2, 'c90', '0.9c', 4, '어떤 기물이 빛의 속도 90%에 이른다', 'u ⊕ v = (u+v)/(1+uv/c²)', '속도의 상대론적 덧셈: 아무리 더해도 c에 다가갈 뿐이다.'),
  E(3, 'check', '첫 체크', 1, '상대 킹을 떨어뜨릴 수 있는 위치', '킹이 위협받음', '衝의 체크: 다음 수에 킹이 판 밖으로 나갈 수 있다.'),
  E(3, 'cliffmate', '낭떠러지 메이트', 2, '체크메이트로 이긴다', '합법수 0, 체크', '어디로 피해도 떨어진다.'),
  E(3, 'ringout', '킹 링아웃', 2, '킹이 판 밖으로 날아간다', '킹 제거 = 승리', '메이트의 마지막 한 수는 실제로 둔다. 킹이 떨어지고 불이 꺼진다.'),
  E(3, 'stalemate', '스테일메이트', 3, '움직일 수 없지만 체크도 아니다', '합법수 0, 체크 아님', '이겼다고 생각한 순간의 무승부.'),
  E(3, 'kingcharge', '킹의 돌진', 2, '킹으로 부딪친다', 'm = 10', '가장 무거운 기물. 다만 한 칸밖에 달리지 못한다.'),
  E(3, 'queenfall', '퀸 낙하', 1, '퀸이 판 밖으로', 'm = 9', '가장 강한 기물도 낭떠러지 앞에서는 같다.'),
  E(3, 'promotion', '승진', 1, '폰이 끝 줄에 닿는다', 'p → Q', '가장 가벼운 기물이 두 번째로 무거운 기물이 된다.'),
  E(3, 'repetition', '3회 반복', 2, '같은 국면이 세 번', '무승부', '시간이 되감긴다.'),
  E(4, 'unseen', '보이지 않는 적중', 2, '光 모드: 잔상(과거)인 기물을 맞힌다', 'Δt = d / c', '보이는 것은 과거였지만, 계산은 맞았다.'),
  E(4, 'miss', '허공', 1, '光 모드: 이미 떠난 자리를 친다', '관측 ≠ 실재', '빛이 도착했을 때 그 기물은 이미 거기 없었다.'),
  E(4, 'blocked', '막힘', 1, '光 모드: 보이지 않던 기물에 막힌다', '정보는 c보다 빠를 수 없다', '아직 빛이 닿지 않은 곳에 무언가 있었다.'),
  E(4, 'pastloss', '과거에서 온 패배', 2, '光 모드: 보지 못한 곳에서 킹을 잃는다', '빛원뿔 밖의 사건', '아무도 그 공격을 미리 볼 수 없었다.'),
  E(4, 'pyramid', '빛 피라미드', 1, '光 모드에서 Space', '깊이 = 지연', '위가 지금. 아래로 내려갈수록 과거.'),
  E(4, 'lightwin', '光 승리', 3, '光 모드에서 이긴다', '지연 관측 하의 승리', '보이는 것이 전부가 아닐 때 이겼다.'),
  E(5, 'solve1', '첫 해답', 1, '당구 문제 하나를 푼다', '解', '문제집의 첫 장.'),
  E(5, 'solve5', '盲 돌파', 3, '★5 문제를 푼다', '판서 없이', '조준 판서 없이 결과를 계산했다.'),
  E(5, 'solve10', '울프-레이에', 4, '★10 문제를 푼다', '一', '가장 뜨거운 별.'),
  E(5, 'flick', '알까기', 3, '타이틀 화면의 기물을 손으로 튕겨 본다', 'J = Δp', '규칙 밖의 실험. 손가락의 충격량이 그대로 운동량이 된다.'),
] as const
export const ENTRIES: Entry[] = RAW.map((e, i) => ({ ...e, no: i + 1 }))
export const byId = new Map(ENTRIES.map(e => [e.id, e]))

/** Per-game counters the detector needs. */
export interface GameTally { stomps: number; byKnight: Map<string, number> }
export const newTally = (): GameTally => ({ stomps: 0, byKnight: new Map() })

/** What one move made happen. `mover` = the side that moved. */
export function detect(before: Pos, out: Outcome, mover: Side, g: GameTally): string[] {
  const hit: string[] = []
  const foe = out.removed.filter(x => x.side !== mover), mine = out.removed.filter(x => x.side === mover)
  const attackerPiece = before.board[out.move.from]
  if (out.move.flag === 'e') hit.push('enpassant')
  if (out.promoted) hit.push('promotion')
  if (out.removed.some(x => x.kind === 'q')) hit.push('queenfall')
  if (out.shock?.length) { hit.push('shock'); if (out.shock.some(x => x.to === null)) hit.push('shockout') }
  if (out.stomp) {
    hit.push('stomp'); g.stomps++
    const id = attackerPiece?.id ?? '?'; g.byKnight.set(id, (g.byKnight.get(id) ?? 0) + 1)
    if (g.stomps >= 3) hit.push('heat')
    if ((g.byKnight.get(id) ?? 0) >= 3) hit.push('overheat')
  }
  const c = out.clash
  if (!c || !attackerPiece) return hit
  hit.push('first')
  if (out.move.via !== undefined) hit.push('cushion')
  if (c.phalanx?.length) hit.push('phalanx')
  const sim = c.sim, att = sim.tracks.find(t => t.id === c.attacker)!
  const lastV = att.exit ? att.exit.v : att.keys[att.keys.length - 1].v
  const mass = new Map<string, number>()
  for (const s of c.line) { const x = before.board[s]; if (x) mass.set(x.id, MASS[x.kind]) }
  mass.set(c.attacker, MASS[attackerPiece.kind])
  // equal-mass chains
  const eq = sim.contacts.filter(k => mass.get(k.a) === mass.get(k.b))
  const eqBodies = new Set(eq.flatMap(k => [k.a, k.b]))
  if (eq.length >= 2 && eqBodies.size >= 3) hit.push('cradle')
  if (eq.length >= 4 && eqBodies.size >= 5) hit.push('cradle5')
  if (sim.contacts.length && Math.abs(lastV) < 1e-6 && !att.exit) hit.push('exchange')
  if (lastV < -1e-6) hit.push('bounce')
  if (att.exit && att.exit.v > 0 && sim.contacts.length) hit.push('overshoot')
  if (att.exit && foe.length) hit.push('together')
  if (foe.length >= 2) hit.push('double')
  if (foe.length >= 3) hit.push('triple')
  if (foe.length >= 4) hit.push('quad')
  if (!out.removed.length) hit.push('push')
  const shifted = [...c.moved].filter(([id, [f, t]]) => id !== c.attacker && t !== null && t !== f)
  if (!out.removed.length && shifted.length === 1 && cheb(shifted[0][1][0], shifted[0][1][1]!) === 1) hit.push('onestep')
  if (attackerPiece.kind === 'p' && foe.some(x => x.kind === 'q' || x.kind === 'k')) hit.push('david')
  const first = sim.contacts[0]
  if (first && first.a === c.attacker) {
    const tgt = c.moved.get(first.b)
    if (tgt && tgt[1] === tgt[0] && (mass.get(first.b) ?? 0) >= 3 * (mass.get(c.attacker) ?? 1)) hit.push('wall')
  }
  if (mine.some(x => x.id !== c.attacker)) hit.push('friendly')
  const per = new Map<string, number>(); for (const k of sim.contacts) for (const id of [k.a, k.b]) per.set(id, (per.get(id) ?? 0) + 1)
  if ([...per.values()].some(n => n >= 3)) hit.push('pingpong')
  if (sim.contacts.length >= 5) hit.push('chain5')
  const diag = Math.abs((c.line[1] ?? 0) - (c.line[0] ?? 0)) % 8 !== 0 && Math.abs((c.line[1] ?? 0) - (c.line[0] ?? 0)) !== 1
  if (diag && attackerPiece.kind !== 'p') hit.push('diagonal')
  if (attackerPiece.kind === 'p') hit.push('pawnhit')
  if (attackerPiece.kind === 'k') hit.push('kingcharge')
  // relativity
  if (c.run >= 4) hit.push('runup')
  const g0 = gamma(c.speed)
  if (g0 >= 1.25) hit.push('g125')
  if (g0 >= 1.5) hit.push('g150')
  if (c.run >= 7) hit.push('sprint')
  const vmax = Math.max(0, ...sim.contacts.flatMap(k => k.after.map(Math.abs)))
  if (vmax >= 1.6 * c.speed && sim.contacts.length) hit.push('amplify')
  if (vmax >= .9 * C) hit.push('c90')
  try {
    const nw = make(before, out.move, 'clash', { newton: true }).out
    const a = out.removed.map(x => x.id).sort().join(), b = nw.removed.map(x => x.id).sort().join()
    if (a !== b) hit.push('newton')
  } catch { /* positions without kings etc. are still fine for make; ignore anything odd */ }
  return hit
}
