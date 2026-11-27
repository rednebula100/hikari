// Six hands-on lessons. Each lesson is a real game with a fixed setup; the
// enemy follows a fixed script (or the easy AI in the last lesson).
import { Game, parseSq, setupFrom, type MoveRecord, type Side } from './game.ts'
import type { Level } from './ai.ts'

export interface LessonCtx { game: Game; last: MoveRecord | null; timeView: boolean; eyeView: boolean }
export interface Lesson {
  id: string
  title: string
  /** One short instruction line (shown while playing). */
  say: string
  /** Shown after success. */
  done: string
  setup: string
  first: Side
  /** Moves already played before the player gets control ("e2e4" notation, alternating from `first`). */
  pre?: string[]
  /** Enemy replies, cycled; an impossible move is skipped. */
  script?: string[]
  ai?: Level
  /** Squares to glow as a suggestion (not enforced). */
  hint?: string[]
  /** Continue from the previous lesson's game instead of a fresh setup. */
  carry?: boolean
  goal: (c: LessonCtx) => boolean
}

const age = (c: LessonCtx, kind: string) => c.game.view('w').enemy.find(e => e.kind === kind && e.alive)?.age ?? 99

export const LESSONS: Lesson[] = [
  {
    id: 'chess', title: '체스 그대로',
    say: '기물은 체스와 똑같이 움직입니다. 룩으로 폰을 잡으세요.',
    done: '좋습니다. 이제 체스에 단 하나의 규칙을 더합니다.',
    setup: 'wKc3 wRa1 bKh8 bPa4', first: 'w', script: ['h8g8', 'g8h8'], hint: ['a1', 'a4'],
    goal: c => c.last?.side === 'w' && !!c.last.captured,
  },
  {
    id: 'light', title: '빛은 한 칸에 한 수',
    say: '멀리 있는 적은 과거의 모습입니다. 숫자는 몇 수 전 모습인지를 뜻합니다. 킹을 앞으로 움직여 룩을 더 선명하게 보세요.',
    done: '킹이 가까울수록 현재에 가깝게 보입니다. 킹이 당신의 눈입니다 — 하지만 가까울수록 위험하죠.',
    setup: 'wKe1 bKh8 bRc7', first: 'w', pre: ['e1d1', 'c7f7', 'd1e1', 'f7c7', 'e1d1', 'c7f7'], script: ['f7c7', 'c7f7'], hint: ['d1', 'd2'],
    goal: c => age(c, 'R') <= 1 && c.game.ply >= 8,
  },
  {
    id: 'pyramid', title: '빛 피라미드', carry: true,
    say: 'Space를 눌러 시간을 펼쳐 보세요. 위가 현재, 아래로 갈수록 과거입니다.',
    done: '멀리 있는 것일수록 깊은 과거에 떠 있습니다. 이 피라미드가 당신이 볼 수 있는 전부입니다. (Space로 닫기)',
    setup: '', first: 'w', script: ['f7c7', 'c7f7'],
    goal: c => c.timeView,
  },
  {
    id: 'shot', title: '과거를 향해 쏘기',
    say: 'a줄은 비어 보입니다. 정말 그럴까요? 룩을 a8까지 쏘아 보세요.',
    done: '룩은 실제로 있는 첫 기물에서 멈춥니다. 나이트는 이미 두 수 전에 와 있었습니다.',
    setup: 'wKf1 wRa1 bKh8 bNc8', first: 'b', pre: ['c8b6', 'f1g1', 'b6a4'], script: ['h8g8', 'g8h8'], hint: ['a1', 'a8'],
    goal: c => c.last?.side === 'w' && !!c.last.captured,
  },
  {
    id: 'eye', title: '적도 당신의 과거를 본다',
    say: '방금 퀸을 h5로 옮겼습니다. E를 눌러 적이 지금 보고 있는 당신을 확인하세요.',
    done: '적의 눈에는 퀸이 아직 d1에 있습니다. 당신의 잔상은 미끼가 됩니다.',
    setup: 'wKe1 wQd1 bKe8 bPa7', first: 'w', pre: ['d1h5', 'e8d8'], script: ['a7a6', 'a6a5', 'd8e8', 'e8d8'],
    goal: c => c.eyeView,
  },
  {
    id: 'mate', title: '킹을 잡아라',
    say: '상대 킹을 잡으면 승리합니다. 체크는 선언되지 않습니다 — 보이지 않는 곳에서 끝내세요.',
    done: '튜토리얼 완료. 이제 진짜 상대가 기다립니다.',
    setup: 'wKc1 wQd1 wRa1 bKe8 bPf7 bPg7 bPh7', first: 'w', ai: 1,
    goal: c => c.game.winner === 'w',
  },
]

export const parseMove = (m: string) => ({ from: parseSq(m.slice(0, 2)), to: parseSq(m.slice(2, 4)) })

export function lessonGame(l: Lesson, prev?: Game): Game {
  if (l.carry && prev) return prev
  const g = new Game(setupFrom(l.setup), l.first)
  for (const m of l.pre ?? []) { const { from, to } = parseMove(m); g.play(g.toMove, from, to) }
  return g
}

/** Next scripted enemy move for the side to move, skipping moves that are impossible now. */
export function scripted(l: Lesson, g: Game, counter: number): { from: number; to: number } | null {
  const script = l.script ?? []
  for (let i = 0; i < script.length; i++) {
    const { from, to } = parseMove(script[(counter + i) % script.length])
    const side = g.toMove
    const v = g.view(side)
    if (v.own.some(p => p.sq === from)) {
      try { return (void g, { from, to }) } catch { /* try next */ }
    }
  }
  return null
}
