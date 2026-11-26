import { standardUnits, type Packet, type ScenarioDef, type Team, type UnitDef } from './sim.ts'
import type { Knowledge } from './knowledge.ts'
import type { Sim } from './sim.ts'

export interface Trial {
  id: string
  index: string
  title: string
  subtitle: string
  brief: string[]
  goal: string
  def: ScenarioDef
  /** Coordinate time at which the player first gets control. */
  start: number
  /** Red's fixed orders (public rules: red does not adapt in trials). */
  redScript: Packet[]
  /** Judged on the final truth after the trial ends. */
  judge: (sim: Sim) => { ok: boolean; line: string }
  /** Optional live progress line from the player's own knowledge. */
  progress?: (k: Knowledge) => string
}

const pick = (ids: string[], extra: UnitDef[] = []) => [...standardUnits().filter(u => ids.includes(u.id)), ...extra]
const nexusIds = ['nexus-i', 'nexus-ii', 'nexus-iii']
const red = (unitId: string, emit: number, actions: Packet['actions'], seq = 1): Packet => ({ id: 'script-' + unitId + '-' + emit, team: 'red', unitId, emit, seq, actions })

export const SKIRMISH: ScenarioDef = { id: 'skirmish', duration: 48, units: standardUnits() }

export const TRIALS: Trial[] = [
  {
    id: 'first-light', index: 'I', title: '첫 빛', subtitle: 'FIRST LIGHT',
    brief: [
      '명령은 빛의 속도로 날아갑니다. 지금 보낸 명령은 미래에 도착합니다.',
      '쿠리어를 넥서스에 세우면, 센서 보정(고유시간 5초) 후 3초마다 데이터를 만들어 코어로 보냅니다.',
      '데이터가 코어에 도착해야 점수입니다.',
    ],
    goal: 'T=20 전에 데이터 1개 수신',
    def: { id: 'first-light', duration: 20, units: pick(['blue-origin', 'blue-courier-a', 'blue-courier-b', ...nexusIds]) },
    start: 0, redScript: [],
    judge: s => ({ ok: s.score.blue >= 1, line: '수신 ' + s.score.blue + ' / 1' }),
  },
  {
    id: 'two-clocks', index: 'II', title: '두 개의 시계', subtitle: 'TWO CLOCKS',
    brief: [
      '빠르게 움직이는 기물의 시계는 느리게 갑니다 — 보정은 기물 자신의 고유시간으로 진행됩니다.',
      '가장 빨리 도착하는 속도가 가장 빨리 준비되는 속도는 아닙니다.',
      '오차는 0.1초도 허용되지 않습니다.',
    ],
    goal: 'T=16 전에 데이터 1개 수신',
    def: { id: 'two-clocks', duration: 16, units: pick(['blue-origin', 'blue-courier-a', 'blue-courier-b', ...nexusIds]) },
    start: 0, redScript: [],
    judge: s => ({ ok: s.score.blue >= 1, line: '수신 ' + s.score.blue + ' / 1' }),
  },
  {
    id: 'majority', index: 'III', title: '과반', subtitle: 'MAJORITY',
    brief: [
      '적 쿠리어가 중앙 넥서스를 점유하고 생산 중입니다.',
      '같은 넥서스에서 준비된 쿠리어가 더 많은 진영이 통제합니다. 같으면 분쟁 — 아무도 생산하지 못합니다.',
      '적 증원이 오고 있을 수 있습니다. 섬광(적 명령 발신)을 주시하세요.',
    ],
    goal: 'T=28 종료 시 적보다 높은 점수',
    def: { id: 'majority', duration: 28, units: pick(['blue-origin', 'blue-courier-a', 'blue-courier-b', 'red-origin', ...nexusIds],
      [{ id: 'red-courier-a', kind: 'courier', team: 'red', at: { x: 4, z: 4 } }, { id: 'red-courier-b', kind: 'courier', team: 'red', at: { x: 7, z: 6 } }]) },
    start: 0,
    redScript: [red('red-courier-b', 10, [{ type: 'move', to: { x: 4, z: 4 }, speed: 0.8 }])],
    judge: s => ({ ok: s.score.blue > s.score.red, line: '청 ' + s.score.blue + ' : 적 ' + s.score.red }),
  },
  {
    id: 'silent-receiver', index: 'IV', title: '침묵하는 수신기', subtitle: 'THE SILENT RECEIVER',
    brief: [
      '적은 중앙 넥서스에서 정확히 3.0초마다 데이터를 적 코어(8,4)로 직접 보냅니다.',
      '당신의 페이저는 (5,6)에 있습니다. 위상이 반대인 펄스를 정확한 시각에 수신기에 겹치면 데이터가 소멸합니다.',
      '진폭·위상·발신 시각, 셋 다 맞아야 합니다. 쿨다운은 고유시간 3초.',
    ],
    goal: 'T=26까지 적 점수 4 이하',
    def: { id: 'silent-receiver', duration: 26, units: pick(['blue-origin', 'red-origin', ...nexusIds],
      [{ id: 'red-courier-a', kind: 'courier', team: 'red', at: { x: 4, z: 4 } }, { id: 'blue-phaser', kind: 'phaser', team: 'blue', at: { x: 5, z: 6 } }]) },
    start: 8, redScript: [],
    judge: s => ({ ok: s.score.red <= 4, line: '적 수신 ' + s.score.red + ' (목표 ≤ 4)' }),
  },
]

export function trialById(id: string) { return TRIALS.find(t => t.id === id) }
export const teams: Team[] = ['blue', 'red']
