// 「실험 노트」 — Predict, Observe, Explain. Each experiment is one real move.
export interface Experiment {
  id: string
  title: string
  fen: string
  /** What to do (shown after the prediction). */
  task: string
  /** The intended move (glows as a hint; other legal moves are allowed). */
  move: [string, string]
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
    id: 'stomp', title: '실험 5 · 나이트의 낙하', fen: '7k/8/8/3r4/8/4N3/8/7K w - - 0 1', move: ['e3', 'd5'],
    predict: { q: '나이트가 룩 위로 떨어집니다. 룩은?', options: ['옆으로 밀려난다', '그 자리에서 부서진다', '나이트를 튕겨 낸다'], answer: 1 },
    task: '나이트로 룩 위에 떨어지세요.',
    explain: '나이트만은 위에서 수직으로 떨어집니다. 완전 비탄성 충돌 — 운동에너지는 열이 되어 그 칸이 달아오릅니다.',
  },
  {
    id: 'cliff', title: '실험 6 · 낭떠러지', fen: '7k/8/8/8/8/8/8/K6q w - - 0 1', move: ['a1', 'b2'],
    predict: { q: '흑 퀸이 일곱 칸을 달려와 구석의 킹(질량 10)을 치면?', options: ['킹은 무거워서 버틴다', '킹이 판 밖으로 날아간다'], answer: 1 },
    task: '체크입니다 — 킹이 떨어질 위기. 킹을 가장자리에서 구하세요.',
    explain: '체크란 "다음 수에 킹이 판 밖으로 날아갈 수 있는 상태"입니다. 가장자리는 낭떠러지, 중앙이 안전합니다.',
  },
  {
    id: 'light', title: '실험 7 · 빛보다 빠를 수 없다', fen: 'k7/8/8/8/8/8/K7/2Q1p3 w - - 0 1', move: ['c1', 'e1'],
    predict: { q: '뉴턴 역학으로 계산하면 이 폰은 판 밖으로 날아갑니다. 이 세계에서는?', options: ['역시 판 밖으로', '판 끝에 멈춘다'], answer: 1 },
    task: '퀸으로 폰을 치세요. 흐린 분필이 뉴턴의 답입니다.',
    explain: '이 세계의 빛은 한 턴에 4칸. 속도는 빛을 넘지 못하고, 운동량 p = γmv만 커집니다. 뉴턴이 틀리는 순간입니다.',
    newton: true,
  },
]
