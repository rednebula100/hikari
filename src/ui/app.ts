import './style.css';
import { Battlefield, type ViewMode, HEX } from '../render/battlefield';
import { Match } from '../game/match';
import { SKIRMISH, TRIALS, type Trial } from '../game/scenarios';
import { ORIGIN, RULES, enemyOf, type Action, type Packet, type RoutePolicy, type Sim, type Speed } from '../game/sim';
import { attenuation, distance, intercept, OMEGA, phasor, pilotRatio, positionAt, samePoint, type Point, type Pulse } from '../game/physics';
import { causalLock, extrapolateProduction, omniscient, possibilityRadius, type Knowledge, type SeenUnit } from '../game/knowledge';
import { readyAfterMove } from '../game/plan';
import { AI_NAMES, type AILevel } from '../game/ai';
import { Sound } from './audio';

// ── helpers ──────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const pad = (n: number) => f2(n).padStart(5, '0');
const xy = (p: Point) => '(' + [p.x, p.z].map(v => +v.toFixed(2)).join(', ') + ')';
const NAMES: Record<string, string> = {
  'blue-origin': 'ORIGIN I', 'red-origin': 'ORIGIN II', 'blue-courier-a': 'Courier A', 'blue-courier-b': 'Courier B',
  'red-courier-a': 'Courier A', 'red-courier-b': 'Courier B', 'blue-relay': 'Relay', 'red-relay': 'Relay',
  'blue-phaser': 'Phaser', 'red-phaser': 'Phaser', 'nexus-i': 'Nexus I', 'nexus-ii': 'Nexus II', 'nexus-iii': 'Nexus III',
};
const KR: Record<string, string> = { origin: '지휘 코어', courier: '쿠리어', relay: '중계기', phaser: '페이저', nexus: '넥서스' };
const name = (id: string) => NAMES[id] ?? id;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const store = {
  get(k: string) { try { return localStorage.getItem('hikari:' + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem('hikari:' + k, v); } catch { /* private mode */ } },
};

interface Draft { unitId: string; emit: number; actions: Action[] }
interface PulseForm { at: number; target: Point; phase: number; amplitude: number; hyp: number; picking: boolean }

// ── state ────────────────────────────────────────────────────────────────
let match: Match | null = null;
let k: Knowledge;
let plan: Sim | null = null;
let drafts: Draft[] = [];
let undo: string[] = [], redo: string[] = [];
let selectedId: string | null = null;
let mode: ViewMode = 'space';
let cursor = 0;
let resolving = false, rate = 1, reveal = false;
let speed: Speed = 0.6;
let hover: Point | null = null;
let pulse: PulseForm = { at: 0, target: ORIGIN.red, phase: 0, amplitude: 1, hyp: 0, picking: false };
let seenEvents = new Set<string>();
let toastTimer = 0;
let firstUnfold = true;
const sound = new Sound();
sound.setMuted(store.get('muted') === '1');

const field = $('field');
let bf: Battlefield;
try { bf = new Battlefield(field, onPick, p => { hover = p; if (selectedId) renderInspector(); }); }
catch (e) { field.innerHTML = '<p style="text-align:center;margin-top:20%;color:#ff9fb0">WebGL2를 사용할 수 없습니다. 하드웨어 가속을 확인하세요.</p>'; throw e; }

function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
}

// ── match lifecycle ──────────────────────────────────────────────────────
function start(opts: { ai?: AILevel; trial?: Trial }) {
  match = new Match(opts.trial?.def ?? SKIRMISH, opts);
  drafts = []; undo = []; redo = []; reveal = false; resolving = false;
  selectedId = opts.trial?.def.units.find(u => u.team === 'blue' && u.kind !== 'origin')?.id ?? 'blue-courier-a';
  cursor = match.now; mode = 'space'; speed = 0.6;
  pulse = { at: 0, target: ORIGIN.red, phase: 0, amplitude: 1, hyp: 0, picking: false };
  seenEvents = new Set(match.view().events.map(e => e.id));
  bf.resetCamera();
  $('overlay').hidden = true;
  recompute();
}
const packetsOf = (ds: Draft[]): Packet[] => ds.map((d, i) => ({ id: 'blue-' + (match!.history.length + i + 1) + '-' + d.unitId + '-' + d.emit, team: 'blue', unitId: d.unitId, emit: d.emit, seq: (match!.history.length + i + 1), actions: structuredClone(d.actions) }));
function recompute() {
  if (!match) return;
  plan = match.preview(packetsOf(drafts.filter(d => d.actions.length)));
  refresh();
}
function snapshot() { undo.push(JSON.stringify(drafts)); if (undo.length > 80) undo.shift(); redo = []; }
function commit() {
  if (!match || resolving) return;
  if (match.phase === 'finished') return showResult();
  if (cursor !== match.now) cursor = match.now;
  const ps = packetsOf(drafts.filter(d => d.actions.length));
  try { match.commit(ps); }
  catch (e) { toast('송신 불가: ' + String((e as Error).message)); return; }
  sound.unlock(); if (ps.length) sound.commit();
  drafts = []; undo = []; redo = [];
  resolving = true; lastTick = performance.now();
  refresh();
}
let lastTick = performance.now();
function tick(now: number) {
  const dt = Math.min(.1, (now - lastTick) / 1000); lastTick = now;
  if (match && resolving) {
    const done = match.resolveTo(match.now + dt * rate);
    cursor = match.now;
    if (done) {
      resolving = false;
      if (match.phase === 'finished') { recompute(); setTimeout(showResult, 900); }
      else recompute();
    } else refresh(false);
    playCues();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function playCues() {
  if (!match) return;
  const v = match.view();
  for (const e of v.events) {
    if (seenEvents.has(e.id)) continue;
    seenEvents.add(e.id);
    if (e.kind === 'cmd-emit' && e.team === 'blue') sound.emit();
    else if (e.kind === 'cmd-emit' && e.team === 'red') { sound.flash(); }
    else if (e.kind === 'score') e.team === 'blue' ? sound.score() : sound.enemyScore();
    else if (e.kind === 'data-fail') { sound.eclipse(); toast(e.team === 'blue' ? '우리 데이터가 소멸했습니다 — 위상 간섭 (R=' + f2(e.info?.R as number) + ')' : '적 데이터 소멸 — 일식 성공 (R=' + f2(e.info?.R as number) + ')'); }
    else if (e.kind === 'cmd-recv' && e.team === 'blue') sound.receive();
  }
}

// ── picking ──────────────────────────────────────────────────────────────
function onPick(p: Point, unitId?: string, button = 0) {
  if (!match) return;
  sound.unlock();
  if (button === 2) { // cancel / pop
    if (pulse.picking) { pulse.picking = false; return refresh(); }
    const d = drafts.find(x => x.unitId === selectedId);
    if (d && d.actions.length) { snapshot(); d.actions.pop(); if (!d.actions.length) drafts = drafts.filter(x => x !== d); return recompute(); }
    selectedId = null; return refresh();
  }
  if (pulse.picking && selectedId?.endsWith('phaser')) { pulse.target = p; pulse.picking = false; return refresh(); }
  const own = selectedId && selectedId.startsWith('blue-') && !selectedId.endsWith('origin') && !reveal && match.phase === 'planning' && !resolving;
  const clickedOwnUnit = unitId && unitId.startsWith('blue-');
  if (own && !clickedOwnUnit) return addAction(selectedId!, { type: 'move', to: p, speed });
  if (own && unitId === selectedId) return;
  if (unitId) { selectedId = unitId; return refresh(); }
  // a node with nothing: select nexus if any
  const nx = k.nexus.find(n => samePoint(n.pos, p)); selectedId = nx ? nx.id : null; refresh();
}

function draftFor(unitId: string, create = true): Draft | null {
  let d = drafts.find(x => x.unitId === unitId);
  if (d || !create) return d ?? null;
  if (drafts.length >= RULES.packetsPerRound) { toast('이번 라운드 송신 슬롯(2)을 모두 사용했습니다'); return null; }
  d = { unitId, emit: match!.roundStart, actions: [] }; drafts.push(d); return d;
}
function addAction(unitId: string, a: Action) {
  if (!match || match.phase !== 'planning' || resolving) return;
  const d0 = drafts.find(x => x.unitId === unitId);
  if (d0 && d0.actions.length >= RULES.actionsPerPacket) return toast('한 패킷에는 행동을 최대 3개까지 담을 수 있습니다');
  snapshot();
  const d = draftFor(unitId); if (!d) { undo.pop(); return; }
  d.actions.push(a);
  if (a.type === 'move') toast(name(unitId) + ' → ' + xy(a.to) + ' · ' + a.speed + 'c');
  recompute();
}

// ── rendering of DOM ─────────────────────────────────────────────────────
function viewKnowledge(): Knowledge {
  const m = match!;
  if (reveal) { const sim = m.reveal()!; return omniscient(sim, Math.min(cursor, sim.t)); }
  return m.view(Math.min(cursor, m.now));
}
function refresh(full = true) {
  if (!match) return;
  k = viewKnowledge();
  const wavePulses = waveScene();
  bf.update({ mode, t: cursor, now: match.now, k, plan: reveal ? null : plan, selectedId,
    drafts: drafts.flatMap(d => d.actions.flatMap(a => (a.type === 'move' ? [{ unitId: d.unitId, to: a.to }] : []))),
    wavePulses: wavePulses.pulses, receivers: wavePulses.receivers,
    showCones: true, showLock: !reveal, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
  renderHud();
  renderTimeline();
  if (full || resolving) { renderOrders(); renderInspector(); renderObjective(); }
}

function renderHud() {
  const m = match!;
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('mode-name').textContent = reveal ? 'REVEAL · 전체 진실' : mode === 'space' ? 'SPATIAL' : mode === 'time' ? 'TEMPORAL PRISM' : 'PHASE FIELD';
  $('round').textContent = String(Math.min(m.round, m.rounds)).padStart(2, '0') + '/' + String(m.rounds).padStart(2, '0');
  $('clock').textContent = pad(cursor);
  const sc = reveal ? m.reveal()!.score : null;
  const own = sc ? sc.blue : k.score.own, en = sc ? sc.red : k.score.enemy;
  $('score').innerHTML = '<i class="b">' + own + '</i><em>:</em><i class="r">' + (sc ? '' : '≥') + en + '</i>';
  $('score-note').textContent = sc ? '최종 확정' : '적 점수는 T' + f2(k.score.enemyAsOf) + ' 기준 (8초 전 빛)';
  const c = $('commit'); c.classList.toggle('running', resolving);
  c.querySelector('span')!.textContent = m.phase === 'finished' ? '결과 보기' : resolving ? '전개 중…' : drafts.some(d => d.actions.length) ? '송신 · 진행' : '대기 · 진행';
  (c as HTMLButtonElement).disabled = resolving;
  $('rate').textContent = rate + '×';
  $('legend').innerHTML = mode === 'wave'
    ? '<span><i style="border-color:#f9cc75"></i>ψ &gt; 0</span><span><i style="border-color:#7a6cf2"></i>ψ &lt; 0</span><span>파동장은 이미 관측한 발신 사건으로부터 계산한 값입니다</span>'
    : mode === 'time'
      ? '<span><i style="border-color:var(--blue)"></i>관측된 세계선</span><span><i class="dash" style="border-color:var(--gold)"></i>계획</span><span><i class="dash" style="border-color:var(--red)"></i>적 가능 영역 (0.8c)</span><span><i style="border-color:#56d4f288"></i>과거 빛원뿔</span>'
      : '<span><i style="border-color:var(--ivory)"></i>실체 = 지금 도착한 빛</span><span><i style="border-color:var(--gold);opacity:.6"></i>금빛 유령 = 계획</span><span><i class="dash" style="border-color:var(--red)"></i>적 가능 반경</span>';
}

function renderTimeline() {
  const m = match!, D = m.def.duration;
  const pct = (t: number) => (100 * t / D) + '%';
  const rounds = $('rounds');
  if (rounds.childElementCount !== m.rounds) {
    rounds.innerHTML = Array.from({ length: m.rounds }, (_, i) => '<span data-t="' + (i * RULES.round) + '" class="' + (i % 4 === 0 ? 'lbl' : '') + '"></span>').join('');
  }
  [...rounds.children].forEach((s, i) => s.classList.toggle('cur', i === m.round - 1 && m.phase !== 'finished'));
  $('now-line').style.left = pct(m.now);
  $('cursor').style.left = pct(cursor);
  const fs = $('future-shade'); fs.style.left = pct(m.now);
  const tl = $<HTMLInputElement>('timeline'); tl.max = String(D); if (document.activeElement !== tl) tl.value = String(cursor);
  const pins: string[] = [];
  for (const e of k.events) {
    if (e.kind === 'score') pins.push('<i class="' + e.team + '" style="left:' + pct(e.t) + '" title="' + (e.team === 'blue' ? '득점' : '적 득점') + ' T' + f2(e.t) + '"></i>');
    else if (e.kind === 'data-fail') pins.push('<i class="fail" style="left:' + pct(e.t) + '" title="소멸 T' + f2(e.t) + '"></i>');
  }
  if (plan && !reveal) for (const e of plan.log) if (e.t > m.now && (e.kind === 'cmd-recv' || e.kind === 'data-emit' || e.kind === 'score')) pins.push('<i class="plan" style="left:' + pct(e.t) + '" title="계획 ' + e.kind + ' T' + f2(e.t) + '"></i>');
  $('pins').innerHTML = pins.join('');
  const state = reveal ? 'REVEAL — 양측의 실제 세계선' : Math.abs(cursor - m.now) < 1e-6 ? (resolving ? '전개 중 — 빛이 도착하는 대로 표시됩니다' : '현재 · 계획 단계  (라운드 ' + m.round + ' · T' + f2(m.roundStart) + '–' + f2(m.roundEnd) + ')') : cursor < m.now ? '과거 — T' + f2(cursor) + '에 당신이 알던 것' : '미래 — 계획과 적 가능 영역 (가설)';
  $('rail-state').textContent = state;
}

function renderObjective() {
  const m = match!, o = $('objective');
  if (!m.trial) {
    o.hidden = false; o.className = 'panel';
    o.innerHTML = '<div class="eyebrow">SKIRMISH · ' + AI_NAMES[m.aiLevel ?? 2] + '</div><h2>미래를 배달하라</h2><div class="goal">T=' + m.def.duration + '까지 더 많은 데이터를 코어로.</div><div class="prog">넥서스에 쿠리어 → 데이터 생성 → 빛의 속도로 코어</div>';
    return;
  }
  o.hidden = false; o.className = 'panel';
  o.innerHTML = '<div class="eyebrow">CAUSAL TRIAL ' + m.trial.index + '</div><h2>' + esc(m.trial.title) + '</h2><div class="goal">' + esc(m.trial.goal) + '</div>';
}

function renderOrders() {
  const m = match!;
  const used = drafts.filter(d => d.actions.length).length;
  $('budget').innerHTML = Array.from({ length: RULES.packetsPerRound }, (_, i) => '<i class="' + (i < RULES.packetsPerRound - used ? 'on' : '') + '"></i>').join('');
  const list = $('draft-list');
  if (reveal || m.phase === 'finished') { list.innerHTML = ''; $('order-hint').innerHTML = '경기가 끝났습니다. 타임라인을 움직여 양측의 실제 역사를 살펴보세요.'; return; }
  list.innerHTML = drafts.map((d, i) => '<div class="draft"><div class="draft-head"><b>' + name(d.unitId) + '</b><span class="emit">발신 T<output>' + f2(d.emit) + '</output><button data-emit="' + i + ':-1" title="0.25초 앞당기기">−</button><button data-emit="' + i + ':1" title="0.25초 늦추기">+</button><button data-drop="' + i + '" title="패킷 삭제">×</button></span></div>'
    + d.actions.map((a, j) => '<div class="act"><span>' + actionText(a) + '</span><button data-del="' + i + ':' + j + '" title="행동 삭제">×</button></div>').join('') + '</div>').join('');
  const unit = selectedId ? k.units.find(u => u.id === selectedId) : undefined;
  let hint = '';
  if (resolving) hint = '명령은 이미 떠났습니다. 빛보다 빨리 되돌릴 수 없습니다.';
  else if (!unit || unit.team !== 'blue' || unit.kind === 'origin') hint = '아군 기물을 클릭해 선택하고, 꼭짓점을 클릭해 이동 명령을 추가하세요. <kbd>↵</kbd> 송신·진행.';
  else if (unit.kind === 'phaser') hint = '오른쪽 패널에서 펄스를 설계하세요. 이동은 꼭짓점 클릭.';
  else hint = '꼭짓점 클릭 = 이동 추가 (' + speed + 'c). 우클릭 = 마지막 행동 취소. <kbd>2</kbd> 로 시공간을 펼쳐 도착을 확인하세요.';
  $('order-hint').innerHTML = hint;
  list.querySelectorAll<HTMLButtonElement>('[data-emit]').forEach(b => b.onclick = () => {
    const [i, s] = b.dataset.emit!.split(':').map(Number); const d = drafts[i];
    const next = d.emit + s * RULES.emitStep;
    if (next < m.roundStart - 1e-9 || next >= m.roundEnd - 1e-9) return toast('발신 시각은 이번 라운드 [' + f2(m.roundStart) + ', ' + f2(m.roundEnd) + ') 안이어야 합니다');
    snapshot(); d.emit = next; recompute();
  });
  list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach(b => b.onclick = () => {
    const [i, j] = b.dataset.del!.split(':').map(Number); snapshot(); drafts[i].actions.splice(j, 1); if (!drafts[i].actions.length) drafts.splice(i, 1); recompute();
  });
  list.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach(b => b.onclick = () => { snapshot(); drafts.splice(Number(b.dataset.drop), 1); recompute(); });
}
function actionText(a: Action) {
  if (a.type === 'move') return '이동 ' + xy(a.to) + ' · ' + a.speed + 'c';
  if (a.type === 'wait') return '대기 ' + a.seconds + 's (고유시간)';
  if (a.type === 'route') return '경로 ' + ({ direct: '직행', relay: '중계', redundant: '이중' }[a.policy]) + (a.via ? ' via ' + xy(a.via) : '');
  return '펄스 T' + f2(a.at) + ' → ' + xy(a.target) + ' · ' + a.phase + '° · A' + a.amplitude;
}

// ── inspector ────────────────────────────────────────────────────────────
function rows(r: [string, string, string?][]) { return '<div class="rows">' + r.map(([a, b, c]) => '<div><span>' + a + '</span><strong class="' + (c ?? '') + '">' + b + '</strong></div>').join('') + '</div>'; }
function renderInspector() {
  const el = $('inspector');
  if (!match || !selectedId) { el.innerHTML = ''; el.className = ''; return; }
  el.className = 'panel';
  const nx = k.nexus.find(n => n.id === selectedId);
  if (nx) return (el.innerHTML = nexusPanel(nx), bindInspector());
  const u = k.units.find(x => x.id === selectedId);
  if (!u) { el.innerHTML = ''; el.className = ''; return; }
  el.innerHTML = u.team === 'blue' && !reveal ? ownPanel(u) : enemyPanel(u);
  bindInspector();
}
function nexusPanel(n: Knowledge['nexus'][number]) {
  const lock = causalLock(k, n.pos);
  const ctrl = n.controller === 'blue' ? 'ORIGIN I 통제' : n.controller === 'red' ? 'ORIGIN II 통제' : n.controller === 'contested' ? '분할 (양측 송신)' : '비어 있음';
  const em = n.emissions.slice(-3).map(e => (e.team === 'blue' ? '청' : '적') + ' T' + f2(e.t)).join(' · ') || '—';
  let s = '<div class="eyebrow">NEXUS</div><h3>' + name(n.id) + '</h3><div class="sub gold">' + xy(n.pos) + ' · 빛 지연 ' + f2(distance(n.pos, ORIGIN.blue)) + 's</div>';
  s += rows([['관측 상태', ctrl], ['상태 시작', 'T' + f2(n.since)], ['관측 시점', 'T' + f2(n.seenAt)], ['최근 송신', em]]);
  if (!reveal) {
    s += '<div class="sect">CAUSAL LOCK</div>';
    s += lock.t === Infinity ? '<p class="note">이 넥서스에 도달할 수 있는 적 쿠리어가 없습니다.</p>'
      : '<p class="note">적 쿠리어는 <b>T' + f2(lock.t) + '</b> 이전에 이 넥서스에서 보정을 마칠 수 <b>없습니다</b> (증명: 최대 속도 0.8c, 고유시간 ≤ 좌표시간, ' + name(lock.by!) + ' 기준). 그 전에 끝나는 생산은 분할될 수 없습니다.</p>'
        + rows([['안전 마진', lock.t > cursor ? '+' + f2(lock.t - cursor) + 's' : '열림', lock.t > cursor ? 'gold' : 'bad']]);
    const own = plan?.log.find(e => e.kind === 'data-emit' && e.nexusId === n.id && e.t > match!.now);
    if (own) s += rows([['우리 다음 생산 (가설)', 'T' + f2(own.t), own.t < lock.t ? 'ok' : 'bad']]);
  }
  return s;
}
function enemyPanel(u: SeenUnit) {
  const age = cursor - u.seenAt, r = possibilityRadius(u, cursor);
  let s = '<div class="eyebrow">' + (reveal ? 'TRUTH' : 'LAST LIGHT') + '</div><h3>' + name(u.id) + '</h3><div class="sub ' + (u.team === 'blue' ? 'blue' : 'red') + '">' + (u.team === 'blue' ? 'ORIGIN I' : 'ORIGIN II') + ' · ' + KR[u.kind] + '</div>';
  const sp = Math.hypot(u.velocity.x, u.velocity.z);
  s += rows([['보이는 위치', xy(u.pos)], ['빛이 떠난 시각', 'T' + f2(u.seenAt)], ['정보 나이', f2(age) + 's', age > 4 ? 'bad' : ''], ['보이는 속도', sp > 0 ? sp.toFixed(2) + 'c' : '정지'], ...(u.kind === 'courier' ? [['보정 (보이는)', Math.round(u.readiness * 100) + '%'] as [string, string]] : []), ['고유시간 τ', f2(u.tau) + 's']]);
  if (!reveal && u.kind !== 'origin') s += '<p class="note">이 기물은 <b>지금</b> 보이는 곳에서 반경 <b>' + f2(r) + '</b> 안 어디에든 있을 수 있습니다. 당신이 보는 것은 ' + f2(age) + '초 전의 빛입니다.</p>';
  if (u.kind === 'origin' && u.team === 'red' && !reveal) s += '<p class="note">적 코어의 점수 변화는 8초 뒤에야 보입니다. 섬광은 적이 명령을 보냈다는 뜻 — 내용은 알 수 없습니다.</p>';
  return s;
}
function ownPanel(u: SeenUnit) {
  const m = match!; const planning = m.phase === 'planning' && !resolving;
  const p = plan!; const pos = p.positionAt(u.id, cursor);
  let s = '<div class="eyebrow">' + KR[u.kind].toUpperCase() + ' · ORIGIN I</div><h3>' + name(u.id) + '</h3><div class="sub blue">' + KR[u.kind] + ' · 보이는 빛 T' + f2(u.seenAt) + '</div>';
  if (u.kind === 'origin') {
    return s + rows([['점수 (확정)', String(k.score.own)], ['라운드', m.round + ' / ' + m.rounds]]) + '<p class="note">코어는 모든 명령의 출발점이자 모든 정보의 도착점입니다. 코어는 움직이지 않습니다.</p>';
  }
  const ready = u.kind === 'courier' ? p.readinessAt(u.id, Math.max(cursor, m.now)) : 1;
  s += rows([['보이는 위치', xy(u.pos)], ['계획 위치 @T' + f2(cursor), xy(pos), 'gold'], ['계획 고유시간 τ', f2(p.tauAt(u.id, cursor)) + 's'], ...(u.kind === 'courier' ? [['보정 (계획)', Math.round(ready * 100) + '%']] as [string, string][] : [])]);
  // upcoming plan events for this unit
  const evs = p.log.filter(e => e.t > m.now - 1e-9 && (e.unitId === u.id) && ['cmd-recv', 'move', 'arrive', 'ready', 'pulse', 'pulse-fail', 'invalid', 'route'].includes(e.kind)).slice(0, 7);
  const KIND: Record<string, string> = { 'cmd-recv': '명령 도달', move: '이동 시작', arrive: '도착', ready: '보정 완료', pulse: '펄스 발신', 'pulse-fail': '펄스 실패', invalid: '무효 행동', route: '경로 설정' };
  if (evs.length) s += '<div class="sect">계획된 미래 <span>PLAN</span></div>' + rows(evs.map(e => [KIND[e.kind] + (e.kind === 'pulse-fail' ? ' (' + e.info?.reason + ')' : ''), 'T' + f2(e.t), e.kind.includes('fail') || e.kind === 'invalid' ? 'bad' : '']));
  if (u.kind === 'courier') {
    const end = p.legs(u.id).at(-1)?.to ?? p.unitDef(u.id)!.at;
    const nx = k.nexus.find(n => samePoint(n.pos, end));
    const prod = nx && p.log.find(e => e.kind === 'data-emit' && e.nexusId === nx.id && e.t > m.now);
    if (prod) { const sc = p.log.find(e => e.kind === 'score' && e.dataId === prod.dataId); s += rows([['다음 데이터 생성 (가설)', 'T' + f2(prod.t), 'gold'], ['코어 수신 (가설)', sc ? 'T' + f2(sc.t) : '마감 이후', sc ? 'ok' : 'bad']]); }
  }
  if (!planning) return s;
  // editor
  s += '<div class="sect">이동 속도 <span class="kbd">꼭짓점 클릭</span></div><div class="chips">' + RULES.speeds.map(v => '<button data-speed="' + v + '" class="' + (v === speed ? 'on' : '') + '">' + v + 'c</button>').join('') + '</div>';
  if (hover && u.kind === 'courier') {
    const d = drafts.find(x => x.unitId === u.id), emit = d?.emit ?? m.roundStart;
    const from = p.legs(u.id).filter(l => l.start <= m.now).at(-1)?.to ?? u.pos;
    const arrive = intercept(ORIGIN.blue, emit, p.unitDef(u.id)!.at, p.legs(u.id).filter(l => l.start <= m.now + 1e-9));
    s += '<div class="sect">두 개의 시계 → ' + xy(hover) + '</div>' + rows(RULES.speeds.map(v => {
      const dd = distance(from, hover!); const tr = dd / v;
      return [v + 'c · 도착 T' + f2(arrive + tr), '보정 T' + f2(readyAfterMove(arrive, from, hover!, v)), v === speed ? 'gold' : ''];
    }));
  }
  s += '<div class="sect">행동 추가</div><div class="btnrow"><button class="btn" data-wait="1">+ 대기 1s</button><button class="btn" data-wait="2">+ 대기 2s</button>';
  if (u.kind === 'courier') s += '</div><div class="sect">데이터 경로 (넥서스 위에서)</div><div class="btnrow">' + (['direct', 'relay', 'redundant'] as RoutePolicy[]).map(r => '<button class="btn" data-route="' + r + '">' + { direct: '직행', relay: '중계', redundant: '이중 (4.5s)' }[r] + '</button>').join('');
  s += '</div>';
  if (u.kind === 'phaser') s += pulsePanel(u);
  return s;
}

// ── PHASE ECLIPSE designer ───────────────────────────────────────────────
interface Hyp { label: string; source: Point; emit: number; arrive: number; amp: number }
function hypotheses(target: Point): Hyp[] {
  const out: Hyp[] = []; const enemy = enemyOf('blue');
  for (const n of k.nexus) {
    if (n.controller !== enemy && n.controller !== 'contested') continue;
    for (const e of extrapolateProduction({ ...n, controller: enemy }, enemy, k.duration)) {
      const d = distance(n.pos, target);
      out.push({ label: name(n.id) + ' 송신 T' + f2(e) + ' (추정) → 도달 T' + f2(e + d), source: n.pos, emit: e, arrive: e + d, amp: attenuation(d) });
    }
  }
  for (const sg of k.signals) if (sg.kind === 'data' && sg.team === enemy && sg.to && samePoint(sg.to, target) && sg.emit + distance(sg.from, target) > match!.now) {
    const d = distance(sg.from, target);
    out.push({ label: '비행 중 패킷 T' + f2(sg.emit) + ' → 도달 T' + f2(sg.emit + d), source: sg.from, emit: sg.emit, arrive: sg.emit + d, amp: attenuation(d) });
  }
  out.sort((a, b) => a.arrive - b.arrive);
  return out.filter((h, i) => i === 0 || Math.abs(h.arrive - out[i - 1].arrive) > 1e-6 || !samePoint(h.source, out[i - 1].source)).slice(0, 14);
}
function pulsePanel(u: SeenUnit) {
  const m = match!, p = plan!;
  const d = drafts.find(x => x.unitId === u.id), emit = d?.emit ?? m.roundStart;
  const legsNow = p.legs(u.id).filter(l => l.start <= m.now + 1e-9);
  const cmdArrive = intercept(ORIGIN.blue, emit, p.unitDef(u.id)!.at, legsNow);
  const minAt = Math.ceil((cmdArrive - 1e-9) / RULES.emitStep) * RULES.emitStep;
  if (pulse.at < minAt) pulse.at = minAt;
  const pos = positionAt(p.unitDef(u.id)!.at, p.legs(u.id), pulse.at);
  const hyps = hypotheses(pulse.target);
  const h = hyps[Math.min(pulse.hyp, hyps.length - 1)];
  const dS = distance(pos, pulse.target), aJ = pulse.at + dS;
  let s = '<div class="sect">PHASE ECLIPSE · 펄스 설계</div>';
  s += '<div class="btnrow"><button class="btn" data-ptarget="core">표적: 적 코어</button><button class="btn" data-ptarget="pick">' + (pulse.picking ? '꼭짓점을 클릭…' : '표적 직접 지정') + '</button></div>';
  s += rows([['표적 수신기', xy(pulse.target), 'gold'], ['명령 도달 (최소 발신)', 'T' + f2(cmdArrive)], ['페이저 위치 @발신', xy(pos)], ['펄스 도달 구간', '[' + f2(aJ) + ', ' + f2(aJ + 1) + ')']]);
  s += '<div class="sect">발신 시각</div><div class="stepper"><button data-pat="-1">−</button><output>T' + f2(pulse.at) + '</output><button data-pat="1">+</button><button data-pat="-4">−1s</button><button data-pat="4">+1s</button></div>';
  s += '<div class="sect">진폭</div><div class="chips">' + RULES.amplitudes.map(a => '<button data-amp="' + a + '" class="' + (a === pulse.amplitude ? 'on' : '') + '">A ' + a + '</button>').join('') + '</div>';
  s += '<div class="sect">위상 <output>' + pulse.phase + '°</output></div><input class="dial" type="range" id="phase-dial" min="0" max="345" step="15" value="' + pulse.phase + '">';
  s += '<div class="sect">가설 — 노릴 적 패킷</div>';
  if (!hyps.length) s += '<p class="note">아직 적의 생산 리듬을 관측하지 못했습니다. 적 넥서스의 송신 섬광이 빛으로 도착할 때까지 기다리거나, 표적을 바꾸세요.</p>';
  else {
    s += '<select id="hyp">' + hyps.map((x, i) => '<option value="' + i + '"' + (x === h ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>';
    const data: Pulse = { position: h.source, emit: h.emit, duration: RULES.dataLength, amplitude: 1, phase: 0 };
    const jam: Pulse = { position: pos, emit: pulse.at, duration: RULES.pulseLength, amplitude: pulse.amplitude, phase: pulse.phase * Math.PI / 180 };
    const R = pilotRatio(pulse.target, [data, jam]);
    const zD = phasor(pulse.target, data), zJ = phasor(pulse.target, jam);
    const overlap = Math.max(0, Math.min(zD.end, zJ.end) - Math.max(zD.start, zJ.start)) / RULES.dataLength;
    s += phasorSvg(zD, zJ, overlap > 0);
    s += rows([['데이터 수신 창', '[' + f2(zD.start) + ', ' + f2(zD.end) + ')'], ['겹침', Math.round(overlap * 100) + '%', overlap >= 1 ? 'ok' : 'bad'], ['진폭비 |zJ|/|zD|', (zJ.amplitude / zD.amplitude).toFixed(2), Math.abs(zJ.amplitude / zD.amplitude - 1) < .4 ? 'ok' : 'bad'], ['위상차', (((((zJ.angle - zD.angle) * 180 / Math.PI) % 360) + 540) % 360 - 180).toFixed(1) + '°']]);
    s += '<div class="verdict ' + (R < RULES.threshold ? 'ok' : 'bad') + '">예상 R = ' + R.toFixed(3) + ' → ' + (R < RULES.threshold ? '일식: 수신 실패 (가설)' : '수신 성공 — 일식 실패') + '</div>';
    void OMEGA;
  }
  const ok = pulse.at >= cmdArrive - 1e-9;
  s += '<button class="btn primary" id="add-pulse"' + (ok ? '' : ' disabled') + '>펄스 추가 → 패킷</button>';
  s += '<p class="note">가설은 관측된 리듬이 계속된다는 가정입니다. 적이 경로나 위치를 바꾸면 펄스는 허공을 가릅니다. 쿨다운: 고유시간 3초.</p>';
  return s;
}
function phasorSvg(zD: ReturnType<typeof phasor>, zJ: ReturnType<typeof phasor>, overlap: boolean) {
  const sc = 120 / Math.max(zD.amplitude, zJ.amplitude, .001) * .45;
  const ax = zD.re * sc, ay = -zD.im * sc, bx = zJ.re * sc, by = -zJ.im * sc;
  const line = (x1: number, y1: number, x2: number, y2: number, c: string, w = 2) => '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round"/><circle cx="' + x2 + '" cy="' + y2 + '" r="2.5" fill="' + c + '"/>';
  return '<svg class="phasor" viewBox="-80 -60 160 120" aria-label="수신점의 위상 벡터"><circle r="54" fill="none" stroke="#ffffff14"/><path d="M-76 0H76M0 -56V56" stroke="#ffffff12"/>'
    + line(0, 0, ax, ay, '#56d4f2') + (overlap ? line(ax, ay, ax + bx, ay + by, '#b79cff') + line(0, 0, ax + bx, ay + by, '#f2d59b', 2.6) : line(0, 0, bx, by, '#b79cff88', 1.4))
    + '<text x="-74" y="-48" fill="#8190a4" font-size="8" font-family="IBM Plex Mono">zD 데이터 · zJ 펄스 · Σ 합</text></svg>';
}

function bindInspector() {
  const el = $('inspector');
  el.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.onclick = () => { speed = Number(b.dataset.speed) as Speed; refresh(); });
  el.querySelectorAll<HTMLButtonElement>('[data-wait]').forEach(b => b.onclick = () => addAction(selectedId!, { type: 'wait', seconds: Number(b.dataset.wait) }));
  el.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(b => b.onclick = () => {
    const policy = b.dataset.route as RoutePolicy;
    const relay = plan?.unitDef('blue-relay');
    if (policy !== 'direct' && !relay) return toast('이 시나리오에는 중계기가 없습니다');
    const via = relay ? positionAt(relay.at, plan!.legs('blue-relay'), match!.def.duration) : undefined;
    addAction(selectedId!, { type: 'route', policy, ...(policy !== 'direct' && via ? { via: { x: Math.round(via.x), z: Math.round(via.z) } } : {}) });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-ptarget]').forEach(b => b.onclick = () => { if (b.dataset.ptarget === 'core') { pulse.target = ORIGIN.red; pulse.picking = false; } else pulse.picking = true; refresh(); });
  el.querySelectorAll<HTMLButtonElement>('[data-pat]').forEach(b => b.onclick = () => { pulse.at = Math.max(0, pulse.at + Number(b.dataset.pat) * RULES.emitStep); refresh(); });
  el.querySelectorAll<HTMLButtonElement>('[data-amp]').forEach(b => b.onclick = () => { pulse.amplitude = Number(b.dataset.amp); refresh(); });
  const dial = el.querySelector<HTMLInputElement>('#phase-dial'); if (dial) dial.oninput = () => { pulse.phase = Number(dial.value); renderInspector(); el.querySelector<HTMLInputElement>('#phase-dial')?.focus(); };
  const hyp = el.querySelector<HTMLSelectElement>('#hyp'); if (hyp) hyp.onchange = () => { pulse.hyp = Number(hyp.value); const hs = hypotheses(pulse.target)[pulse.hyp]; if (hs) pulse.at = Math.max(pulse.at, Math.floor((hs.arrive - distance(plan!.positionAt('blue-phaser', pulse.at), pulse.target)) / .25) * .25); refresh(); };
  const add = el.querySelector<HTMLButtonElement>('#add-pulse'); if (add) add.onclick = () => addAction(selectedId!, { type: 'pulse', at: pulse.at, target: { ...pulse.target }, channel: 'red', phase: pulse.phase, amplitude: pulse.amplitude });
}

// ── wave scene ───────────────────────────────────────────────────────────
function waveScene() {
  const pulses: Pulse[] = []; const receivers: Point[] = [];
  if (!match || mode !== 'wave') return { pulses, receivers };
  for (const s of k.signals) if ((s.kind === 'data' || s.kind === 'phase') && cursor - s.emit < 14 && s.emit <= cursor) {
    pulses.push({ position: s.from, emit: s.emit, duration: s.duration, amplitude: s.amplitude ?? 1, phase: s.phase ?? 0 });
    if (s.to && !receivers.some(r => samePoint(r, s.to!))) receivers.push(s.to);
  }
  // own planned pulses (exact: they are our own orders)
  if (plan && !reveal) for (const s of plan.signals) if (s.kind === 'phase' && !pulses.some(p => p.emit === s.emit && samePoint(p.position, s.from)) && cursor - s.emit < 14) {
    pulses.push({ position: s.from, emit: s.emit, duration: s.duration, amplitude: s.amplitude!, phase: s.phase! });
    if (s.to && !receivers.some(r => samePoint(r, s.to!))) receivers.push(s.to);
  }
  return { pulses: pulses.slice(-16), receivers };
}

// ── overlays ─────────────────────────────────────────────────────────────
function showTitle() {
  resolving = false;
  const done = new Set((store.get('trials') ?? '').split(',').filter(Boolean));
  const o = $('overlay'); o.hidden = false;
  o.innerHTML = '<div class="screen"><div class="hero"><h1>光</h1><p>당신이 보는 모든 것은 <em>과거</em>이고,<br>당신의 명령은 <em>미래</em>에 도착한다.<br>빛의 속도가 유일한 규칙인 전장에서<br>상대보다 더 정확한 미래를 설계하라.</p></div>'
    + '<div class="menu"><h4>CAUSAL TRIALS · 인과 시련</h4>'
    + TRIALS.map(t => '<button class="mi" data-trial="' + t.id + '"><span class="ix">' + t.index + '</span><span><b>' + esc(t.title) + '</b><small>' + esc(t.goal) + '</small></span>' + (done.has(t.id) ? '<span class="done">CLEARED</span>' : '') + '</button>').join('')
    + '<h4>SKIRMISH · 실전 (48초, 24라운드)</h4><div class="levels">' + ([1, 2, 3] as AILevel[]).map(l => '<button class="mi" data-ai="' + l + '"><b>' + AI_NAMES[l] + '</b><small>' + ['넥서스만 노림', '위상 매복 · 인과 잠금', '경로 방어 · 궤적 판독'][l - 1] + '</small></button>').join('') + '</div>'
    + '<h4>—</h4><div class="btnrow"><button class="btn" id="how">조작과 규칙</button><button class="btn" id="mute">' + (sound.muted ? '소리 켜기' : '소리 끄기') + '</button>' + (match && match.phase !== 'finished' ? '<button class="btn" id="resume">계속하기</button>' : '') + '</div></div></div>';
  o.querySelectorAll<HTMLButtonElement>('[data-trial]').forEach(b => b.onclick = () => { sound.unlock(); showBriefing(TRIALS.find(t => t.id === b.dataset.trial)!); });
  o.querySelectorAll<HTMLButtonElement>('[data-ai]').forEach(b => b.onclick = () => { sound.unlock(); start({ ai: Number(b.dataset.ai) as AILevel }); toast('ORIGIN I 지휘 시작. 쿠리어를 넥서스로 보내세요.'); });
  $('how').onclick = showHelp;
  $('mute').onclick = () => { sound.setMuted(!sound.muted); store.set('muted', sound.muted ? '1' : '0'); showTitle(); };
  const r = document.getElementById('resume'); if (r) r.onclick = () => { o.hidden = true; };
}
function showBriefing(t: Trial) {
  const o = $('overlay'); o.hidden = false;
  o.innerHTML = '<div class="card"><div class="eyebrow">CAUSAL TRIAL ' + t.index + '</div><h2>' + esc(t.title) + '</h2><div class="en">' + t.subtitle + '</div><ul>' + t.brief.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul><div class="goalbox">목표 — ' + esc(t.goal) + '</div>'
    + '<div class="row"><button class="btn primary" id="go">시작</button><button class="btn" id="back">돌아가기</button></div></div>';
  $('go').onclick = () => start({ trial: t }); $('back').onclick = showTitle;
}
function showHelp() {
  const o = $('overlay'); o.hidden = false;
  o.innerHTML = '<div class="card"><div class="eyebrow">FIELD MANUAL</div><h2>빛의 규칙</h2><ul>'
    + '<li><b>c = 1 칸/초.</b> 명령·데이터·관측 — 모든 정보가 빛의 속도로 움직입니다.</li>'
    + '<li><b>보이는 것은 과거입니다.</b> 화면의 실체는 지금 코어에 도착한 빛 — 멀수록 오래된 모습입니다. 금빛 유령은 당신의 계획입니다.</li>'
    + '<li><b>쿠리어</b>가 넥서스에서 보정(고유시간 5초)을 마치면 3초마다 데이터를 만듭니다. 데이터가 코어에 도착해야 득점.</li>'
    + '<li><b>과반이 통제합니다.</b> 동수면 넥서스는 분할되어 양쪽 모두에게 송신합니다 — 승부는 파동으로.</li>'
    + '<li><b>페이저</b>는 반대 위상의 펄스로 적 수신기의 데이터를 소멸시킵니다. 시각·진폭·위상이 모두 맞아야 합니다.</li>'
    + '<li><b>CAUSAL LOCK</b>: 적이 결코 그보다 먼저 넥서스에 설 수 없는 시각 — 추정이 아니라 증명입니다.</li>'
    + '<li>매 라운드(2초) 패킷 2개, 패킷당 행동 3개. 양측은 동시에 계획하고 동시에 진행합니다.</li></ul>'
    + '<div class="keys"><kbd>클릭</kbd><span>기물 선택 / 꼭짓점 = 이동 추가</span><kbd>우클릭</kbd><span>마지막 행동 취소</span><kbd>드래그</kbd><span>회전 (Shift = 이동)</span><kbd>1 2 3</kbd><span>공간 · 시공간 · 파동</span><kbd>Space</kbd><span>시공간 펼치기</span><kbd>↵</kbd><span>송신·진행</span><kbd>Q / E</kbd><span>시간 탐색 ±1초</span><kbd>Ctrl Z / Y</kbd><span>계획 취소·재실행</span><kbd>Esc</kbd><span>메뉴</span></div>'
    + '<div class="row"><button class="btn primary" id="back">확인</button></div></div>';
  $('back').onclick = () => (match ? (o.hidden = true) : showTitle());
}
function showResult() {
  const m = match!; const v = m.verdict()!; const sim = m.reveal()!;
  const o = $('overlay'); o.hidden = false;
  const c = (kind: string, team: string) => sim.log.filter(e => e.kind === kind && e.team === team).length;
  if (m.trial && v.ok) { const done = new Set((store.get('trials') ?? '').split(',').filter(Boolean)); done.add(m.trial.id); store.set('trials', [...done].join(',')); }
  const win = m.trial ? v.ok : sim.score.blue > sim.score.red, draw = !m.trial && sim.score.blue === sim.score.red;
  o.innerHTML = '<div class="card"><div class="eyebrow">' + (m.trial ? 'CAUSAL TRIAL ' + m.trial.index : 'SKIRMISH · ' + AI_NAMES[m.aiLevel ?? 2]) + '</div>'
    + '<div class="result-big ' + (win ? 'win' : draw ? '' : 'lose') + '">' + (m.trial ? (v.ok ? '해결' : '실패') : win ? '승리' : draw ? '무승부' : '패배') + '</div>'
    + '<div class="en">' + esc(v.line) + '</div>'
    + '<table><tr><td>수신 데이터 (청 / 적)</td><td>' + sim.score.blue + ' / ' + sim.score.red + '</td></tr><tr><td>생성 데이터</td><td>' + c('data-emit', 'blue') + ' / ' + c('data-emit', 'red') + '</td></tr><tr><td>소멸 (일식)</td><td>' + c('data-fail', 'blue') + ' / ' + c('data-fail', 'red') + '</td></tr><tr><td>펄스 발신</td><td>' + c('pulse', 'blue') + ' / ' + c('pulse', 'red') + '</td></tr><tr><td>송신한 명령</td><td>' + c('cmd-emit', 'blue') + ' / ' + c('cmd-emit', 'red') + '</td></tr></table>'
    + '<p class="note">이제 처음으로 양측의 실제 세계선을 볼 수 있습니다. 당신이 몰랐던 것을 확인하세요.</p>'
    + '<div class="row"><button class="btn primary" id="reveal">진실 공개 (시공간)</button><button class="btn" id="again">다시</button><button class="btn" id="menu">메뉴</button></div></div>';
  $('reveal').onclick = () => { reveal = true; mode = 'time'; cursor = sim.t; o.hidden = true; refresh(); };
  $('again').onclick = () => (m.trial ? showBriefing(m.trial) : start({ ai: m.aiLevel }));
  $('menu').onclick = showTitle;
}

// ── controls ─────────────────────────────────────────────────────────────
function setMode(next: ViewMode) {
  if (next === 'time' && mode !== 'time') { sound.unfold(); if (firstUnfold) { firstUnfold = false; toast('세로축은 시간입니다. 모든 실체는 당신의 과거 빛원뿔 위에 있습니다.'); } }
  mode = next; refresh();
}
document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode as ViewMode));
$('commit').onclick = commit;
$('rate').onclick = () => { rate = rate >= 4 ? 0.5 : rate * 2; refresh(false); };
$('to-now').onclick = () => { if (match) { cursor = match.now; refresh(); } };
$('menu-btn').onclick = showTitle;
$('cam-top').onclick = () => bf.topView(); $('cam-reset').onclick = () => bf.resetCamera();
$('zoom-in').onclick = () => bf.zoom(1.18); $('zoom-out').onclick = () => bf.zoom(1 / 1.18);
const tl = $<HTMLInputElement>('timeline');
tl.oninput = () => { if (!match || resolving) return; cursor = Math.max(0, Math.min(match.def.duration, Number(tl.value))); if (!reveal && cursor > match.now) { /* future: plan + possibility */ } refresh(); };
document.addEventListener('keydown', e => {
  if (!match || !$('overlay').hidden) { if (e.key === 'Escape' && match && !$('overlay').hidden && match.phase !== 'finished') $('overlay').hidden = true; return; }
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'SELECT' || (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range')) return;
  if (e.key === '1') setMode('space'); else if (e.key === '2') setMode('time'); else if (e.key === '3') setMode('wave');
  else if (e.key === ' ') { e.preventDefault(); setMode(mode === 'time' ? 'space' : 'time'); }
  else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key.toLowerCase() === 'r' && !e.ctrlKey) bf.resetCamera();
  else if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') { if (!resolving) { cursor = Math.max(0, Math.min(match.def.duration, cursor + (e.key.toLowerCase() === 'q' ? -1 : 1))); refresh(); } }
  else if (e.key === 'Escape') { if (pulse.picking) { pulse.picking = false; refresh(); } else if (selectedId) { selectedId = null; refresh(); } else showTitle(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); const u = undo.pop(); if (u) { redo.push(JSON.stringify(drafts)); drafts = JSON.parse(u); recompute(); } }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); const r = redo.pop(); if (r) { undo.push(JSON.stringify(drafts)); drafts = JSON.parse(r); recompute(); } }
  else if (e.key === 'Tab') { e.preventDefault(); const own = k.units.filter(u => u.team === 'blue' && u.kind !== 'origin').map(u => u.id); const i = own.indexOf(selectedId ?? ''); selectedId = own[(i + 1) % own.length] ?? null; refresh(); }
});
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); });

// demo backdrop behind the title: a quiet skirmish board
start({ ai: 2 });
showTitle();
void HEX;

if (import.meta.env.DEV) Object.assign(window, { hikari: { get match() { return match; }, get k() { return k; }, get drafts() { return drafts; }, project: (p: Point) => bf.projectNode(p), start, commit, setMode } });
