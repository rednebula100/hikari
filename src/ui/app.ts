import './style.css';
import { Stage, X, Z } from '../render/stage';
import { sketch } from '../render/aim';
import { fromFen, toFen, legal, make, status, inCheck, kingSq, pseudo, other, name, parse, START, file, rank, type Pos, type Move, type Mode, type Kind, type Side, type Outcome } from '../engine/rules';
import { choose, rng, LEVEL_NAME, type Level } from '../engine/ai';
import { EXPERIMENTS } from '../engine/lessons';
import { gamma } from '../engine/collide';
import { Sound } from './audio';

const $ = (id: string) => document.getElementById(id)!;
const store = {
  get(k: string) { try { return localStorage.getItem('chung:' + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem('chung:' + k, v); } catch { /* private mode */ } },
};
const GLYPH: Record<Side, Record<Kind, string>> = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
const KO: Record<Kind, string> = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── state ────────────────────────────────────────────────────────────────
const sound = new Sound(); sound.setMuted(store.get('muted') === '1');
const stage = new Stage($('stage'), sound);
type Screen = 'boot' | 'title' | 'play' | 'lesson' | 'over';
let screen: Screen = 'boot';
let mode: Mode = (store.get('mode') as Mode) || 'clash';
let level: Level = (Number(store.get('level')) || 2) as Level;
let pos: Pos = fromFen(START);
let history: string[] = [];
let busy = false, selected = -1, aimOn = store.get('aim') !== '0', moveNo = 0;
let board: string[] = [];
let random = rng(1);
let exp = 0, expPhase: 'predict' | 'do' | 'explain' = 'predict', guess = -1;
let toastTimer = 0;
const tutorialDone = () => store.get('tutorial') === '1';

function toast(msg: string, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.hidden = false; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}
function setStatus(text: string, danger = false) { const s = $('status'); s.textContent = text; s.classList.toggle('danger', danger); }

// ── boot ────────────────────────────────────────────────────────────────
async function boot() {
  $('screen').className = '';
  $('screen').innerHTML = '<div class="loading">실험실 불을 켜는 중…<div class="bar"><i id="bar"></i></div></div>';
  stage.lampFlicker(false);
  try { await stage.load(f => { const b = document.getElementById('bar'); if (b) b.style.width = Math.round(f * 100) + '%'; }); }
  catch (e) { $('screen').innerHTML = '<div class="loading">3D 체스 세트를 불러오지 못했습니다.<br><small>' + String(e) + '</small></div>'; throw e; }
  await document.fonts?.ready;
  stage.sync(pos);
  title(false);
}

// ── title sequence: switch, flicker, Newton's cradle, chalk 衝 ───────────
let titleToken = 0;
async function title(instant: boolean) {
  screen = 'title'; busy = false; selected = -1;
  const token = ++titleToken;
  $('hud').hidden = true; $('note').hidden = true; stage.chalk.clearNow(); stage.clearStrobe();
  stage.writeBlackboard([]); board = [];
  const demo = fromFen('8/8/8/8/Q2qqqq1/8/8/8 w - - 0 1');
  stage.sync(demo); stage.resetCamera(); stage.aimZ = -.6;
  $('screen').className = ''; $('screen').innerHTML = '';
  const skip = () => { if (token === titleToken) { titleToken++; showTitleMenu(true); stage.lampFlicker(true); } };
  $('screen').onclick = skip;
  if (instant || stage.reduced) { stage.lampFlicker(true); showTitleMenu(true); return; }
  stage.lampFlicker(false); await wait(500); if (token !== titleToken) return;
  sound.unlock(); sound.switchOn();
  for (const [on, ms] of [[true, 70], [false, 90], [true, 60], [false, 160], [true, 0]] as const) { stage.lampFlicker(on); await wait(ms); }
  if (token !== titleToken) return;
  sound.ambience(true);
  await wait(700); if (token !== titleToken) return;
  const m = pseudo(demo).find(x => name(x.from) === 'a4' && name(x.to) === 'd4')!; // demo has no kings: pseudo-legal
  const r = make(demo, m, 'clash');
  await stage.play(demo, r.out, r.pos);
  if (token !== titleToken) return;
  sound.chalk(1800);
  showTitleMenu(false);
}
function showTitleMenu(instant: boolean) {
  screen = 'title';
  $('screen').onclick = null;
  $('screen').className = '';
  $('screen').innerHTML = '<div class="title' + (instant ? ' instant' : '') + '"><svg viewBox="0 0 300 300"><text x="150" y="245" text-anchor="middle">衝</text></svg>'
    + '<div class="motto">잡지 마라. 부딪쳐라.</div><div class="buttons"><button class="cbtn main" id="t-start">시작</button><button class="cbtn" id="t-tut">튜토리얼</button></div></div>'
    + '<div class="corner l">v0.4 · 밤의 물리 실험실</div><div class="corner r"><button id="t-sound">' + (sound.muted ? '소리 켜기' : '소리 끄기') + '</button> · <button id="t-credits">크레딧</button></div>';
  $('t-start').onclick = () => { sound.unlock(); if (tutorialDone()) newGame(); else { toast('처음이군요 — 실험 노트부터 펼칩니다'); experiment(0); } };
  $('t-tut').onclick = () => { sound.unlock(); experiment(0); };
  $('t-sound').onclick = () => { sound.setMuted(!sound.muted); store.set('muted', sound.muted ? '1' : '0'); showTitleMenu(true); };
  $('t-credits').onclick = credits;
}
function credits() {
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="slate panel"><h2>크레딧</h2><div class="credits">'
    + '<p><b>체스 세트</b> — "A Beautiful Game", © 2020 ASWF (MaterialX Project), glTF 변환 © 2022 Ed Mackey. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, <a href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noopener">Khronos glTF Sample Assets</a>.</p>'
    + '<p><b>서체</b> — Nanum Pen Script, Noto Sans KR, Noto Serif KR (SIL OFL 1.1).</p>'
    + '<p><b>라이브러리</b> — three.js (MIT), Draco & Basis Universal 디코더 (Apache-2.0). 규칙 검증 — chess.js (BSD-2).</p>'
    + '<p><b>소리</b> — 전부 실시간 합성.</p></div><div class="stack"><button class="cbtn" id="c-back">돌아가기</button></div></div>';
  $('c-back').onclick = () => (screen === 'title' ? showTitleMenu(true) : ($('screen').innerHTML = ''));
}

// ── a game ───────────────────────────────────────────────────────────────
function resetBoard(fen: string) {
  titleToken++;
  pos = fromFen(fen); history = []; moveNo = 0; selected = -1; busy = false;
  stage.chalk.clearNow(); stage.clearStrobe(); stage.sync(pos);
  $('case-me').innerHTML = ''; $('case-them').innerHTML = '';
  board = []; stage.writeBlackboard(board);
}
function newGame() {
  screen = 'play'; random = rng((Math.random() * 2 ** 31) >>> 0);
  resetBoard(START);
  $('screen').innerHTML = ''; $('screen').className = ''; $('note').hidden = true; $('hud').hidden = false;
  stage.resetCamera(); stage.aimZ = -.7; stage.lampFlicker(true); sound.ambience(true);
  setStatus(mode === 'clash' ? '백의 차례' : '백의 차례 · 클래식');
}

function targetsOf(from: number) { return legal(pos, mode).filter(m => m.from === from); }
function drawSelection() {
  const c = stage.chalk; c.clearNow();
  if (selected < 0) return;
  c.circle([X(selected), Z(selected)], .44, { dur: 120, alpha: .9 });
  for (const m of targetsOf(selected)) {
    if (m.promo && m.promo !== 'q') continue;
    if (m.flag === 'c') c.circle([X(m.to), Z(m.to)], .4, { dur: 100, alpha: .75, color: '#ffc98a', dash: .1 });
    else c.circle([X(m.to), Z(m.to)], .09, { dur: 60, alpha: .7 });
  }
}
function onHover(sq: number) {
  stage.setHover(sq);
  if (busy || selected < 0 || (screen !== 'play' && screen !== 'lesson')) return;
  const m = targetsOf(selected).find(x => x.to === sq && (!x.promo || x.promo === 'q'));
  if (m && aimOn) sketch(stage.chalk, pos, m, mode, { newton: screen === 'lesson' && EXPERIMENTS[exp].newton });
  else drawSelection();
  if (screen === 'lesson' && expPhase === 'do') hint();
}
async function onSquare(sq: number, button: number) {
  sound.unlock();
  if (busy || (screen !== 'play' && screen !== 'lesson') || pos.turn !== 'w') return;
  if (screen === 'lesson' && expPhase !== 'do') return;
  if (button === 2 || sq < 0) { selected = -1; drawSelection(); return; }
  const own = pos.board[sq];
  if (own?.side === 'w' && sq !== selected) { selected = sq; sound.tick(); drawSelection(); if (screen === 'lesson') hint(); return; }
  if (selected < 0) return;
  const ms = targetsOf(selected).filter(m => m.to === sq);
  if (!ms.length) { selected = -1; drawSelection(); return; }
  if (screen === 'lesson') {
    const e = EXPERIMENTS[exp];
    if (e.id !== 'move' && (name(selected) !== e.move[0] || name(sq) !== e.move[1])) { toast('이번 실험은 분필로 표시된 수로 해 보세요'); return; }
  }
  const m = ms.length > 1 ? await promotion(ms) : ms[0];
  if (m) await commit(m);
}
function promotion(ms: Move[]): Promise<Move | null> {
  return new Promise(res => {
    $('screen').className = 'dim';
    $('screen').innerHTML = '<div class="slate panel"><h2>승진</h2><div class="promo">' + (['q', 'r', 'b', 'n'] as Kind[]).map(k => '<button data-k="' + k + '">' + GLYPH.w[k] + '</button>').join('') + '</div></div>';
    document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach(b => b.onclick = () => { $('screen').innerHTML = ''; $('screen').className = ''; res(ms.find(m => m.promo === b.dataset.k) ?? null); });
  });
}

function specimen(side: Side, kind: Kind, label: string) {
  const el = document.createElement('div'); el.className = 'spec';
  el.innerHTML = '<b>' + GLYPH[side][kind] + '</b><small>' + label + '</small>';
  $(side === 'b' ? 'case-me' : 'case-them').append(el);
}
function record(before: Pos, out: Outcome) {
  const mover = before.board[out.move.from]!;
  const tag = (mover.side === 'w' ? moveNo + '. ' : moveNo + '… ') + KO[mover.kind] + ' ' + name(out.move.from) + '→' + name(out.move.to);
  if (out.clash) {
    const g = gamma(out.clash.speed);
    const fell = out.removed.map(p => KO[p.kind]).join('·');
    board.push(tag + '   v=' + out.clash.speed.toFixed(2) + (g > 1.1 ? ' (γ ' + g.toFixed(2) + ')' : '') + (fell ? '   ⇒ ' + fell + ' 낙하' : '   ⇒ 밀어냄'));
    for (const p of out.removed) {
      const tr = out.clash.sim.tracks.find(t => t.id === p.id);
      specimen(p.side, p.kind, (tr?.exit ? Math.abs(tr.exit.v).toFixed(2) + '칸/턴 · ' : '') + moveNo + '수');
    }
  } else if (out.removed.length) {
    board.push(tag + (out.stomp ? '   낙하 공격 · 열' : '   잡음'));
    for (const p of out.removed) specimen(p.side, p.kind, (out.stomp ? '낙하 · ' : '') + moveNo + '수');
  }
  stage.writeBlackboard(board);
}

async function commit(m: Move) {
  busy = true; selected = -1;
  stage.chalk.erase(200); sound.chalk(180);
  await play(m);
  if (screen === 'lesson') { busy = false; return explain(); }
  if (await finished()) return;
  await aiTurn();
}
async function play(m: Move) {
  const before = pos;
  if (before.turn === 'w') moveNo++;
  const r = make(before, m, mode);
  history.push(toFen(before, false));
  await stage.play(before, r.out, r.pos);
  pos = r.pos;
  record(before, r.out);
}
async function aiTurn() {
  setStatus('흑이 계산 중…');
  await wait(380);
  const m = choose(pos, mode, level, random, history);
  if (!m) { busy = false; return; }
  await play(m);
  if (await finished()) return;
  busy = false;
  if (inCheck(pos, mode)) { sound.check(); setStatus('체크 — 킹이 떨어질 위기', true); cracks(); }
  else setStatus('백의 차례');
}
/** Red chalk cracks between the threatened king and its nearest cliff edge. */
function cracks() {
  const k = kingSq(pos, pos.turn); if (k < 0) return;
  const f = file(k), r = rank(k), c = stage.chalk;
  const dx = f < 4 ? -1 : 1, dz = r < 4 ? -1 : 1;
  const ex = Math.min(f, 7 - f) < Math.min(r, 7 - r);
  const pts: [number, number][] = [[X(k), Z(k)]];
  for (let i = 1; i <= 5; i++) {
    const t = i / 5, base: [number, number] = ex ? [X(k) - dx * t * (Math.min(f, 7 - f) + .6), Z(k)] : [X(k), Z(k) + dz * t * (Math.min(r, 7 - r) + .6)];
    pts.push([base[0] + (ex ? 0 : (Math.random() - .5) * .35), base[1] + (ex ? (Math.random() - .5) * .35 : 0)]);
  }
  c.path(pts, { color: '#ff9f8f', width: .045, dur: 380 });
}
async function finished(): Promise<boolean> {
  const st = status(pos, mode, history);
  if (!st.over) return false;
  screen = 'over'; busy = true;
  if (st.reason === 'checkmate' && mode === 'clash') await finale();
  else await wait(600);
  const win = st.result === '1-0', draw = st.result === '1/2-1/2';
  win ? sound.win() : draw ? sound.tick() : sound.lose();
  const why = { checkmate: '체크메이트', stalemate: '스테일메이트', fifty: '50수 규칙', repetition: '3회 반복', material: '기물 부족' }[st.reason];
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="slate panel"><div class="big ' + (win ? 'win' : draw ? '' : 'lose') + '">' + (win ? '승리' : draw ? '무승부' : '패배') + '</div>'
    + '<div class="sub">' + why + ' · ' + moveNo + '수</div><div class="stack"><button class="cbtn main" id="r-again">다시</button><button class="cbtn" id="r-home">처음으로</button></div></div>';
  $('r-again').onclick = newGame; $('r-home').onclick = () => title(true);
  return true;
}
/** The mating blow is actually played: the king goes over the cliff, the lamp dies. */
async function finale() {
  const loser = pos.turn, q = { ...pos, board: pos.board.slice(), turn: other(loser), castling: { ...pos.castling } };
  const kill = pseudo(q).find(m => m.flag === 'c' && kingSq(make(q, m, 'clash').pos, loser) < 0);
  if (kill) {
    stage.reduced = false;
    const r = make(q, kill, 'clash');
    await stage.play(q, r.out, r.pos);
    pos = r.pos;
  }
  await wait(900);
  for (const [on, ms] of [[false, 80], [true, 60], [false, 400]] as const) { stage.lampFlicker(on); await wait(ms); }
  sound.ambience(false);
}

// ── tutorial: 실험 노트 (predict → observe → explain) ─────────────────────
function experiment(i: number) {
  screen = 'lesson'; exp = i; guess = -1;
  const e = EXPERIMENTS[i];
  resetBoard(e.fen);
  $('screen').innerHTML = ''; $('screen').className = ''; $('hud').hidden = false;
  stage.resetCamera(); stage.aimZ = -3.3; stage.lampFlicker(true); sound.ambience(true);
  setStatus(e.title);
  expPhase = e.predict ? 'predict' : 'do';
  note();
  if (expPhase === 'do') hint();
}
function dots() { return '<div class="dots">' + EXPERIMENTS.map((_, i) => '<i class="' + (i <= exp ? 'on' : '') + '"></i>').join('') + '</div>'; }
function note() {
  const e = EXPERIMENTS[exp], n = $('note'); n.hidden = false; n.className = 'slate';
  const skip = tutorialDone() ? '<button class="skip" id="n-skip">노트 덮기</button>' : '';
  if (expPhase === 'predict') {
    n.innerHTML = dots() + '<h3>' + e.title + '</h3><p>예측: ' + e.predict!.q + '</p><div class="opts">'
      + e.predict!.options.map((o, i) => '<button class="cbtn" data-o="' + i + '">' + o + '</button>').join('') + '</div><div class="row">' + skip + '</div>';
    n.querySelectorAll<HTMLButtonElement>('[data-o]').forEach(b => b.onclick = () => { guess = Number(b.dataset.o); expPhase = 'do'; note(); hint(); });
  } else if (expPhase === 'do') {
    n.innerHTML = dots() + '<h3>' + e.title + '</h3>' + (guess >= 0 ? '<p style="color:var(--dim)">내 예측: ' + e.predict!.options[guess] + '</p>' : '') + '<p>관찰: ' + e.task + '</p><div class="row">' + skip + '</div>';
  } else {
    const right = e.predict ? guess === e.predict.answer : true;
    n.innerHTML = dots() + '<h3>' + e.title + '</h3>' + (e.predict ? '<p class="verdict' + (right ? '' : ' miss') + '">' + (right ? '예측 적중.' : '예측과 달랐다 — 정답: ' + e.predict.options[e.predict.answer]) + '</p>' : '')
      + '<p>설명: ' + e.explain + '</p><div class="row"><button class="cbtn main" id="n-next">' + (exp === EXPERIMENTS.length - 1 ? '노트 덮고 실전으로' : '다음 실험') + '</button><button class="cbtn" id="n-again">다시</button>' + skip + '</div>';
    $('n-next').onclick = () => { if (exp < EXPERIMENTS.length - 1) experiment(exp + 1); else { store.set('tutorial', '1'); $('note').hidden = true; newGame(); toast('실전 — 흑은 ' + LEVEL_NAME[level] + ' AI'); } };
    $('n-again').onclick = () => experiment(exp);
  }
  const s = document.getElementById('n-skip'); if (s) s.onclick = () => { $('note').hidden = true; title(true); };
}
function hint() {
  const e = EXPERIMENTS[exp];
  const [a, b] = e.move.map(parse);
  stage.chalk.arrow([X(a), Z(a)], [X(b), Z(b)], { dash: .16, color: '#9fd8ff', alpha: .55, dur: 260 });
}
function explain() {
  expPhase = 'explain'; busy = false;
  const e = EXPERIMENTS[exp];
  if (e.id === 'cliff') toast('킹이 낭떠러지를 벗어났다');
  note();
}

// ── menu & keys ──────────────────────────────────────────────────────────
function menu() {
  if (screen === 'title' || screen === 'boot') return;
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="slate panel"><h2>쉬는 시간</h2><div class="stack">'
    + '<button class="cbtn main" id="m-back">계속</button>'
    + '<div class="seg" id="m-mode">' + (['clash', 'classic'] as Mode[]).map(x => '<button data-m="' + x + '" class="' + (x === mode ? 'on' : '') + '">' + (x === 'clash' ? '衝 충돌' : '클래식') + '</button>').join('') + '</div>'
    + '<div class="seg" id="m-level">' + ([1, 2, 3] as Level[]).map(l => '<button data-l="' + l + '" class="' + (l === level ? 'on' : '') + '">' + LEVEL_NAME[l] + '</button>').join('') + '</div>'
    + '<button class="cbtn" id="m-new">새 판</button><button class="cbtn" id="m-tut">실험 노트</button>'
    + '<button class="cbtn" id="m-sound">' + (sound.muted ? '소리 켜기' : '소리 끄기') + '</button><button class="cbtn" id="m-credits">크레딧</button><button class="cbtn" id="m-home">처음으로</button></div></div>';
  $('m-back').onclick = () => { $('screen').innerHTML = ''; $('screen').className = ''; };
  $('m-new').onclick = newGame; $('m-tut').onclick = () => experiment(0); $('m-home').onclick = () => title(true); $('m-credits').onclick = credits;
  $('m-sound').onclick = () => { sound.setMuted(!sound.muted); store.set('muted', sound.muted ? '1' : '0'); menu(); };
  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m as Mode; store.set('mode', mode); newGame(); });
  document.querySelectorAll<HTMLButtonElement>('[data-l]').forEach(b => b.onclick = () => { level = Number(b.dataset.l) as Level; store.set('level', String(level)); newGame(); });
}
$('btn-menu').onclick = menu;
$('btn-aim').onclick = () => { aimOn = !aimOn; store.set('aim', aimOn ? '1' : '0'); $('btn-aim').classList.toggle('on', aimOn); drawSelection(); };
$('btn-aim').classList.toggle('on', aimOn);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('screen').innerHTML && screen !== 'title' && screen !== 'over') { $('screen').innerHTML = ''; $('screen').className = ''; }
    else if (selected >= 0) { selected = -1; drawSelection(); } else menu();
  } else if (e.key.toLowerCase() === 'a') $('btn-aim').click();
  else if (e.key.toLowerCase() === 'r') stage.resetCamera();
});
stage.onSquare = (s, b) => { void onSquare(s, b); };
stage.onHover = onHover;
void boot();

if (import.meta.env.DEV) Object.assign(window, { chung: {
  stage, get pos() { return pos; }, newGame, experiment, title, commit, onSquare,
  click: (s: string) => onSquare(parse(s), 0), hover: (s: string) => onHover(parse(s)),
  pick: (o: number) => (document.querySelector('[data-o="' + o + '"]') as HTMLButtonElement)?.click(),
  setMode: (m: Mode) => { mode = m; }, legal: () => legal(pos, mode),
} });
