// 「실험 노트」 — Predict, Observe, Explain. Each experiment is one real move.
export interface Experiment {
  id: string
  title: string
  fen: string
  /** What to do (shown after the prediction). */
  task: string
  /** The intended move (glows as a hint; other legal moves are allowed). */
  move: [string, string]
  /** Cushion shots bend at this square (hint arrow and move matching). */
  via?: string
  predict?: { q: string; options: string[]; answer: number }
  explain: string
  newton?: boolean
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'move', title: '실험 1 · 체스처럼', fen: '7k/8/8/8/8/8/4P3/6K1 w - - 0 1', move: ['e2', 'e4'],
    task: '기물은 체스와 똑같이 움직입니다. 폰을 두 칸 앞으로.',
    explain: '여기까지는 체스입니다. 이제 "잡기"를 물리로 바꿉니다.',
  },
  {
    id: 'heavy', title: '실험 2 · 무거운 것과 가벼운 것', fen: '7k/8/p7/8/8/8/8/R6K w - - 0 1', move: ['a1', 'a6'],
    predict: { q: '룩(질량 5)이 다섯 칸을 달려와 폰(질량 1)에 부딪치면, 폰은?', options: ['거의 안 움직인다', '한 칸 밀린다', '판 밖으로 날아간다'], answer: 2 },
    task: '룩으로 폰에 부딪쳐 보세요.',
    explain: '무거운 것이 가벼운 것을 치면, 가벼운 것은 더 빠르게 튕겨 나갑니다. 룩도 멈추지 않고 따라갑니다. 운동량은 그대로입니다.',
  },
  {
    id: 'cradle', title: '실험 3 · 같은 질량', fen: '7k/8/8/8/8/8/7K/R4rr1 w - - 0 1', move: ['a1', 'f1'],
    predict: { q: '룩이 f1의 룩을 칩니다. 바로 뒤 g1에도 룩이 붙어 있습니다. 날아가는 것은?', options: ['맞은 f1 룩', '뒤의 g1 룩', '둘 다'], answer: 1 },
    task: 'a1의 룩으로 f1을 치세요.',
    explain: '같은 질량끼리는 속도를 통째로 넘겨주고 멈춥니다 — 뉴턴의 요람. 일렬로 선 기물은 벽이 아니라 도화선입니다.',
  },
  {
    id: 'bounce', title: '실험 4 · 가벼운 것과 무거운 것', fen: '7k/8/8/8/8/2q5/1P6/7K w - - 0 1', move: ['b2', 'c3'],
    predict: { q: '폰(질량 1)이 퀸(질량 9)에 부딪치면?', options: ['퀸이 날아간다', '폰이 튕겨 나온다', '둘 다 그 자리에 멈춘다'], answer: 1 },
    task: '폰으로 퀸을 쳐 보세요.',
    explain: '가벼운 것은 무거운 것에 튕겨 나옵니다. 폰은 뒤로 밀려났고 퀸은 거의 움직이지 않았습니다.',
  },
  {
    id: 'stomp', title: '실험 5 · 나이트의 낙하', fen: '7k/8/8/3b4/8/4N3/8/7K w - - 0 1', move: ['e3', 'd5'],
    predict: { q: '나이트가 비숍 위로 떨어집니다. 비숍은?', options: ['옆으로 밀려난다', '그 자리에서 짓밟힌다', '나이트를 튕겨 낸다'], answer: 1 },
    task: '나이트로 비숍 위에 떨어지세요.',
    explain: '나이트는 위에서 수직으로 떨어져 짓밟습니다 — 완전 비탄성, 운동에너지는 열이 됩니다. 단 질량 3 이하(폰·나이트·비숍)만. 룩·퀸·킹은 너무 커서 올라설 수 없습니다.',
  },
  {
    id: 'shock', title: '실험 6 · 착지 충격파', fen: '7k/8/8/r7/8/2N5/8/7K w - - 0 1', move: ['c3', 'b5'],
    predict: { q: '나이트가 빈 칸 b5에 내려앉습니다. 바로 옆 a5의 룩은?', options: ['그대로 있다', '한 칸 밀려 판 밖으로 떨어진다', '나이트를 밀어낸다'], answer: 1 },
    task: '나이트를 b5에 내려앉히세요.',
    explain: '나이트가 내려앉는 곳마다 충격파가 퍼집니다. 상하좌우로 붙어 있는 적 기물(질량 5 이하)은 한 칸 밀려나고, 그곳이 낭떠러지면 떨어집니다. 퀸과 킹은 버팁니다.',
  },
  {
    id: 'cushion', title: '실험 7 · 비숍의 쿠션', fen: '7k/2p5/8/8/8/8/8/4B2K w - - 0 1', move: ['e1', 'c7'], via: 'a5',
    predict: { q: '비숍이 a5에서 판 가장자리에 튕겨 c7의 폰을 칩니다. 여섯 칸을 달린 비숍에 맞은 폰은?', options: ['꿈쩍 않는다', '한 칸 밀린다', '판 밖으로 날아간다'], answer: 2 },
    task: '비숍으로 벽을 맞고 c7을 치세요 — 당구의 쿠션처럼.',
    explain: '비숍은 가장자리에서 한 번 튕길 수 있습니다(모서리는 안 됩니다). 꺾인 길도 도움닫기 거리에 모두 들어가서, 돌아갈수록 빨라집니다.',
  },
  {
    id: 'cliff', title: '실험 8 · 낭떠러지', fen: '7k/8/8/8/8/8/8/K6q w - - 0 1', move: ['a1', 'b2'],
    predict: { q: '흑 퀸이 일곱 칸을 달려와 구석의 킹(질량 10)을 치면?', options: ['킹은 무거워서 버틴다', '킹이 판 밖으로 날아간다'], answer: 1 },
    task: '체크입니다 — 킹이 떨어질 위기. 킹을 가장자리에서 구하세요.',
    explain: '체크란 "다음 수에 킹이 판 밖으로 날아갈 수 있는 상태"입니다. 가장자리는 낭떠러지, 중앙이 안전합니다.',
  },
  {
    id: 'light', title: '실험 9 · 빛보다 빠를 수 없다', fen: 'k7/8/8/8/8/8/K7/2Q1p3 w - - 0 1', move: ['c1', 'e1'],
    predict: { q: '뉴턴 역학으로 계산하면 이 폰은 판 밖으로 날아갑니다. 이 세계에서는?', options: ['역시 판 밖으로', '판 끝에 멈춘다'], answer: 1 },
    task: '퀸으로 폰을 치세요. 흐린 분필이 뉴턴의 답입니다.',
    explain: '이 세계의 빛은 한 턴에 4칸. 속도는 빛을 넘지 못하고, 운동량 p = γmv만 커집니다. 뉴턴이 틀리는 순간입니다.',
    newton: true,
  },
]
