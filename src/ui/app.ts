import './style.css';
import { Stage, X, Z, type Quality } from '../render/stage';
import { sketch } from '../render/aim';
import { fromFen, toFen, legal, make, status, inCheck, kingSq, pseudo, other, name, parse, START, file, rank, type Pos, type Move, type Mode, type Kind, type Side, type Outcome } from '../engine/rules';
import { choose, rng, LEVEL_NAME, type Level } from '../engine/ai';
import { EXPERIMENTS } from '../engine/lessons';
import { sightings, belief, intentions, resolve, apply } from '../engine/fog';
import { gamma } from '../engine/collide';
import { Sound } from './audio';
import { store, loadSettings, saveSettings, loadBook, saveBook, loadCodex, saveCodex, today, type Progress, type CodexState } from './store';
import { gsap, toast, reveal, openPanel, stamp, discovery, scramble } from './fx';
import { intro } from './intro';
import { ENTRIES, GROUPS, RARITY, byId, detect, newTally, type GameTally } from '../content/codex';
import { targetMoves, targetStep, emptyTally, addTally, achieved, findMove, mated, defend, uci, type Puzzle, type Seal, type Tally } from '../content/puzzle';
import BOOK from '../content/puzzles.json';

const PUZZLES = BOOK as Puzzle[];
const $ = (id: string) => document.getElementById(id)!;
const GLYPH: Record<Side, Record<Kind, string>> = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
const KO: Record<Kind, string> = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

// ── stars: each tier is a real star, hotter as the problems get harder ───
export const TIERS = [
  { star: '프록시마', cls: 'M', k: 3000, color: '#ff5a3c', lamp: 2700 },
  { star: '아크투루스', cls: 'K', k: 4300, color: '#ff7f3a', lamp: 3100 },
  { star: '태양', cls: 'G', k: 5800, color: '#ffa748', lamp: 3600 },
  { star: '프로키온', cls: 'F', k: 6500, color: '#ffcf6a', lamp: 4200 },
  { star: '베가', cls: 'A', k: 9600, color: '#fff0b8', lamp: 4900 },
  { star: '레굴루스', cls: 'B', k: 12000, color: '#f4f1ff', lamp: 5600 },
  { star: '스피카', cls: 'B', k: 25000, color: '#d4e2ff', lamp: 6400 },
  { star: '민타카', cls: 'O', k: 29000, color: '#acc4ff', lamp: 7300 },
  { star: '나오스', cls: 'O', k: 40000, color: '#8aa6ff', lamp: 8300 },
  { star: 'WR 104', cls: 'WR', k: 104000, color: '#c79bff', lamp: 9500 },
];
const SEAL_TEXT: Record<Seal, string> = {
  '半': '반판서 — 판서가 첫 충돌까지만 보인다',
  '速': '뉴턴의 판서 — 판서가 고전역학으로 계산된다. 이 단계의 판서는 틀린다',
  '盲': '무판서 — 분필이 떨어졌다. 판서 없이 계산하라',
  '二': '두 수 — 백이 연달아 두 번 둔다',
  '宣': '선언 — 수를 전부 미리 적고 한 번에 실행한다',
  '敵': '적 — 흑이 최선으로 막는다',
  '三': '세 수 — 세 번, 또는 두 수 메이트',
  '一': '단 한 번 — 실패하면 문제지가 찢어지고 내일 다시 열린다',
};
const stars = (t: number) => '<span class="stars" style="--tc:' + TIERS[t - 1].color + '">' + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < t ? 'on' : '') + '">★</i>').join('') + '</span>';

// ── the opponent thinks in a Web Worker (falls back to the main thread) ──
let worker: Worker | null = null, jobId = 0;
const jobs = new Map<number, (m: Move | null) => void>();
try {
  worker = new Worker(new URL('../engine/ai.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; move: Move | null }>) => { jobs.get(e.data.id)?.(e.data.move); jobs.delete(e.data.id); };
  worker.onerror = () => { worker = null; };
} catch { worker = null; }
function think(p: Pos, m: Mode, lvl: Level, hist: string[]): Promise<Move | null> {
  const seed = Math.floor(random() * 2 ** 31);
  if (!worker) return Promise.resolve(choose(p, m, lvl, rng(seed), hist));
  return new Promise(res => { const id = ++jobId; jobs.set(id, res); worker!.postMessage({ id, pos: p, mode: m, level: lvl, seed, history: hist }); });
}

// ── state ────────────────────────────────────────────────────────────────
const settings = loadSettings();
const sound = new Sound(); sound.setVolume(settings.volume); sound.setMuted(settings.muted);
const stage = new Stage($('stage'), sound);
stage.quality = settings.quality;
type Screen = 'boot' | 'title' | 'play' | 'lesson' | 'puzzle' | 'over';
let screen: Screen = 'boot';
type Variant = 'clash' | 'light' | 'classic';
let variant: Variant = (store.get('variant') as Variant) || 'clash';
let mode: Mode = variant === 'classic' ? 'classic' : 'clash';
let truth: Pos = fromFen(START);
let hist: Pos[] = [];
let outs: (Outcome | null)[] = [];
let variantBeforeLesson: Variant | undefined;
let level: Level = (Number(store.get('level')) || 2) as Level;
let pos: Pos = fromFen(START);
let history: string[] = [];
let busy = false, selected = -1, aimOn = settings.aim, moveNo = 0;
let board: string[] = [];
let random = rng(1);
let exp = 0, expPhase: 'controls' | 'predict' | 'do' | 'explain' = 'predict', guess = -1;
let book: Progress = loadBook();
let codex: CodexState = loadCodex();
let tally: GameTally = newTally();
let lastOut: Outcome | null = null;
const tutorialDone = () => store.get('tutorial') === '1';

function setStatus(text: string, danger = false, label = '') {
  $('status-t').textContent = text; $('status-l').textContent = label; $('status').classList.toggle('danger', danger);
}
function clearScreen() { $('screen').innerHTML = ''; $('screen').className = ''; }
function hudFor(s: Screen) {
  const p = s === 'puzzle';
  $('pcard').hidden = !p; $('btn-reset').hidden = !p; $('tape').hidden = true;
  $('case-me').hidden = $('case-them').hidden = p || s === 'lesson';
}

// ── codex: the engine witnesses, the camera photographs ─────────────────
function register(id: string, where = '') {
  const e = byId.get(id); if (!e) return;
  const rec = codex[id];
  if (rec) { rec.n++; saveCodex(codex); return; }
  codex[id] = { t: Date.now(), n: 1, img: stage.set ? stage.snapshot(320, 180) : '', where };
  saveCodex(codex);
  discovery(e.no, e.name, () => sound.found());
}
function witness(before: Pos, out: Outcome, mover: Side) {
  const where = screen === 'puzzle' && puz ? '문제 ' + pad(puz.id) : screen === 'lesson' ? '실험 노트' : (variant === 'light' ? '光 ' : '대국 ') + moveNo + '수';
  for (const id of detect(before, out, mover, tally)) register(id, where);
}

// ── boot ────────────────────────────────────────────────────────────────
async function boot() {
  clearScreen();
  $('screen').innerHTML = '<div class="loading"><span class="lbl">실험실 준비 중</span><div class="bar"><i id="bar"></i></div></div>';
  stage.lampFlicker(false);
  stage.showPerf(settings.fps);
  const loading = stage.load(f => { const b = document.getElementById('bar'); if (b) b.style.width = Math.round(f * 100) + '%'; }, settings.quality === 'ultra');
  const first = !store.get('v1:seenIntro');
  if (settings.intro === 'always' || first) { await intro(); store.set('v1:seenIntro', '1'); }
  try { await loading; }
  catch (e) { $('screen').innerHTML = '<div class="loading"><span class="lbl">3D 체스 세트를 불러오지 못했습니다</span><p class="sub">' + String(e) + '</p></div>'; throw e; }
  await document.fonts?.ready;
  stage.sync(pos);
  title(false);
}

// ── title sequence: switch, flicker, Newton's cradle ────────────────────
let titleToken = 0;
async function title(instant: boolean) {
  screen = 'title'; busy = false; selected = -1;
  const token = ++titleToken;
  $('hud').hidden = true; $('note').hidden = true; stage.chalk.clearNow(); stage.clearStrobe();
  stage.writeBlackboard([]); board = []; stage.setLamp(2700); sound.setPitch(0);
  const demo = fromFen('8/8/8/8/Q2qqqq1/8/8/8 w - - 0 1');
  stage.sync(demo); stage.resetCamera(); stage.aimZ = -.6; stage.aimX = innerWidth > innerHeight * 1.1 ? 2.4 : 0;
  clearScreen();
  const skip = () => { if (token === titleToken) { titleToken++; showTitleMenu(true); stage.lampFlicker(true); } };
  $('screen').onclick = skip;
  if (instant || stage.reduced) { stage.lampFlicker(true); showTitleMenu(true); return; }
  stage.lampFlicker(false); await wait(400); if (token !== titleToken) return;
  sound.unlock(); sound.switchOn();
  for (const [on, ms] of [[true, 70], [false, 90], [true, 60], [false, 160], [true, 0]] as const) { stage.lampFlicker(on); await wait(ms); }
  if (token !== titleToken) return;
  sound.ambience(true);
  showTitleMenu(false);
  await wait(500); if (token !== titleToken) return;
  const m = pseudo(demo).find(x => name(x.from) === 'a4' && name(x.to) === 'd4')!; // demo has no kings: pseudo-legal
  const r = make(demo, m, 'clash');
  await stage.play(demo, r.out, r.pos);
}
function solvedCount() { return Object.values(book).filter(r => r.solved).length; }
function showTitleMenu(instant: boolean) {
  screen = 'title';
  $('screen').onclick = null;
  $('screen').className = '';
  const found = Object.keys(codex).length;
  $('screen').innerHTML = '<div class="title2"><div class="eyebrow"><span class="lbl">COLLISION CHESS</span><span class="lbl">v0.5</span></div>'
    + '<div class="mark' + (spins() >= 10 ? ' grad' : '') + '" id="t-mark">衝</div>'
    + '<div class="motto">잡지 마라. 부딪쳐라.</div><div class="idx" id="t-idx" style="margin-top:34px">'
    + row('t-start', '01', '대국', ({ clash: '衝', light: '光', classic: '클래식' }[variant]) + ' · ' + LEVEL_NAME[level], 'main')
    + row('t-book', '02', '당구 문제', solvedCount() + ' / ' + PUZZLES.length)
    + row('t-codex', '03', '현상 도감', found + ' / ' + ENTRIES.length)
    + row('t-tut', '04', '실험 노트', tutorialDone() ? '완료' : '튜토리얼')
    + row('t-set', '05', '설정', '')
    + '</div></div>'
    + '<div class="foot l"><span class="lbl">© RED NEBULA</span></div><div class="foot r"><button id="t-sound">' + (sound.muted ? '소리 켜기' : '소리 끄기') + '</button><button id="t-credits">크레딧</button></div>';
  $('t-start').onclick = () => { sound.unlock(); if (tutorialDone()) matchSetup(); else { toast('처음이군요 — 실험 노트부터 펼칩니다'); controls(); } };
  $('t-book').onclick = () => { sound.unlock(); openBook(); };
  $('t-codex').onclick = () => { sound.unlock(); openCodex(); };
  $('t-tut').onclick = () => { sound.unlock(); controls(); };
  $('t-set').onclick = () => openSettings(() => showTitleMenu(true));
  $('t-sound').onclick = () => { settings.muted = !settings.muted; sound.setMuted(settings.muted); saveSettings(settings); showTitleMenu(true); };
  $('t-credits').onclick = credits;
  $('t-mark').onclick = e => { e.stopPropagation(); spin($('t-mark'), $('t-mark')); };
  wireRows($('screen'));
  if (!instant) { reveal($('screen')); gsap.fromTo('#t-mark', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .6, ease: 'expo.out' }); }
}
function row(id: string, n: string, t: string, m: string, cls = '') {
  return '<button class="row ' + cls + '" id="' + id + '"><span class="n">' + n + '</span><span class="t">' + t + '</span><span class="m">' + m + '</span></button>';
}
/** Rows answer the mouse with a tick and the keyboard with ↑↓. */
function wireRows(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('.row').forEach(b => b.addEventListener('pointerenter', () => sound.hover()));
}
function credits() {
  const back = screen === 'title' ? () => showTitleMenu(true) : clearScreen;
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="panel dlg"><div class="ph"><span class="lbl">크레딧</span><span class="lbl">DOC. 00</span></div><div class="pb"><div class="credits">'
    + '<p><b>제작</b> — Red Nebula</p>'
    + '<p><b>체스 세트</b> — "A Beautiful Game", © 2020 ASWF (MaterialX Project), glTF 변환 © 2022 Ed Mackey. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, <a href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noopener">Khronos glTF Sample Assets</a>.</p>'
    + '<p><b>서체</b> — IBM Plex Sans KR · IBM Plex Mono · Noto Serif KR · Nanum Pen Script (SIL OFL 1.1).</p>'
    + '<p><b>라이브러리</b> — three.js (MIT), GSAP (GreenSock 표준 라이선스, 무료), Draco & Basis Universal 디코더 (Apache-2.0). 규칙 검증 — chess.js (BSD-2).</p>'
    + '<p><b>소리</b> — 전부 실시간 합성.</p></div><div class="idx">' + row('c-back', '←', '돌아가기', 'ESC') + '</div></div></div>';
  openPanel($('screen').firstElementChild!);
  $('c-back').onclick = back;
}

// ── easter egg: 衝 turns over in 3D; ten turns and it burns ─────────────
const spins = () => Number(store.get('v1:spins') || 0);
function buildLogo() {
  const s = $('logo-spin');
  s.innerHTML = Array.from({ length: 7 }, (_, i) => '<div class="face' + (i ? ' d' : '') + '" style="transform:translateZ(' + (-i) + 'px)">衝</div>').join('');
  $('logo').classList.toggle('grad', spins() >= 10);
}
let spinAngle = 0;
function spin(target: HTMLElement, gradHost: HTMLElement) {
  sound.unlock(); sound.whoosh();
  spinAngle += 360;
  gsap.to(target, { rotationY: spinAngle, duration: .9, ease: 'power3.inOut', transformPerspective: 500 });
  const n = spins() + 1; store.set('v1:spins', String(n));
  if (n === 10) {
    setTimeout(() => {
      $('flash').classList.remove('on'); void $('flash').offsetWidth; $('flash').classList.add('on');
      gradHost.classList.add('grad'); $('logo').classList.add('grad');
      void stamp('十', '十回轉 — 衝이 달아올랐다', () => sound.stamp());
    }, 850);
  }
}
$('logo').onclick = () => spin($('logo-spin'), $('logo'));

// ── a game ───────────────────────────────────────────────────────────────
function resetBoard(fen: string) {
  titleToken++;
  pos = fromFen(fen); truth = pos; hist = [pos]; outs = []; tally = newTally();
  stage.showStale(new Map()); history = []; moveNo = 0; selected = -1; busy = false;
  stage.chalk.clearNow(); stage.clearStrobe(); stage.sync(pos);
  $('case-me').innerHTML = ''; $('case-them').innerHTML = '';
  board = []; stage.writeBlackboard(board);
}
function matchSetup() {
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="panel dlg"><div class="ph"><span class="lbl">대국</span><span class="lbl">DOC. 01</span></div><div class="pb">'
    + '<h2>대국 조건</h2><p class="sub">흑은 AI. 백은 당신.</p>'
    + '<div class="set" style="width:auto;margin-top:12px"><div class="line"><span class="lbl">규칙</span>' + segVariant() + '</div><div class="line"><span class="lbl">상대</span>' + segLevel() + '</div></div>'
    + '<div class="idx">' + row('g-go', '▶', '시작', 'ENTER', 'main') + row('g-back', '←', '돌아가기', 'ESC') + '</div></div></div>';
  openPanel($('screen').firstElementChild!); wireRows($('screen'));
  wireSegs(() => matchSetup());
  $('g-go').onclick = newGame; $('g-back').onclick = () => showTitleMenu(true);
  $('g-go').focus();
}
function segVariant() { return '<div class="seg">' + (['clash', 'light', 'classic'] as Variant[]).map(x => '<button data-m="' + x + '" class="' + (x === variant ? 'on' : '') + '">' + ({ clash: '衝 충돌', light: '光 지연 시야', classic: '클래식' }[x]) + '</button>').join('') + '</div>'; }
function segLevel() { return '<div class="seg">' + ([1, 2, 3] as Level[]).map(l => '<button data-l="' + l + '" class="' + (l === level ? 'on' : '') + '">' + LEVEL_NAME[l] + '</button>').join('') + '</div>'; }
function wireSegs(after: () => void) {
  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => { variant = b.dataset.m as Variant; variantBeforeLesson = undefined; mode = variant === 'classic' ? 'classic' : 'clash'; store.set('variant', variant); sound.tick(); after(); });
  document.querySelectorAll<HTMLButtonElement>('[data-l]').forEach(b => b.onclick = () => { level = Number(b.dataset.l) as Level; store.set('level', String(level)); sound.tick(); after(); });
}
function newGame() {
  if (variantBeforeLesson) { variant = variantBeforeLesson; variantBeforeLesson = undefined; }
  mode = variant === 'classic' ? 'classic' : 'clash';
  screen = 'play'; random = rng((Math.random() * 2 ** 31) >>> 0); puz = null;
  resetBoard(START);
  clearScreen(); $('note').hidden = true; $('hud').hidden = false; hudFor('play');
  stage.resetCamera(); stage.aimZ = -.7; stage.aimX = 0; stage.lampFlicker(true); stage.setLamp(2700); sound.setPitch(0); sound.ambience(true);
  pyramid = false; $('btn-pyr').hidden = variant !== 'light'; $('btn-pyr').classList.remove('on'); stage.setPyramid(false, 0, new Map());
  if (variant === 'light') refreshLight();
  setStatus(variant === 'light' ? '멀리 있는 것은 과거다' : '백의 차례', false, variant === 'light' ? '光 · 백' : variant === 'clash' ? '衝 · ' + LEVEL_NAME[level] : '클래식');
}

function targetsOf(from: number): Move[] {
  if (screen === 'puzzle' && puz) return (puz.goal.type === 'mate' ? legal(pos, 'clash') : targetMoves(pos)).filter(m => m.from === from);
  return (variant === 'light' && screen === 'play' ? intentions(pos) : legal(pos, mode)).filter(m => m.from === from);
}
/** Persistent chalk marks: targets of a problem, declared moves. */
function drawMarks() {
  if (screen !== 'puzzle' || !puz) return;
  const c = stage.chalk;
  if (puz.goal.type === 'target' && pz.moves.length === 0) for (const s of puz.goal.squares) c.circle([X(s), Z(s)], .46, { color: '#ff8f7a', dur: 0, alpha: .85 });
  pz.declared.forEach((u, i) => {
    const a = parse(u.slice(0, 2)), b = parse(u.slice(2, 4));
    c.arrow([X(a), Z(a)], [X(b), Z(b)], { color: '#ffd59a', dur: 0, alpha: .9 });
    c.text('①②③'[i], [(X(a) + X(b)) / 2 + .3, (Z(a) + Z(b)) / 2], { size: .42, color: '#ffd59a', dur: 0 });
  });
  if (pz.from >= 0) c.circle([X(pz.from), Z(pz.from)], .44, { color: '#ffd59a', dur: 0 });
}
function drawSelection() {
  const c = stage.chalk; c.clearNow(); drawMarks();
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
  if (busy || selected < 0 || (screen !== 'play' && screen !== 'lesson' && screen !== 'puzzle')) return;
  const m = targetsOf(selected).find(x => x.to === sq && (!x.promo || x.promo === 'q'));
  if (m && aimOn) {
    if (screen === 'puzzle' && puz) {
      const s = puz.seals;
      if (s.includes('盲') || s.includes('宣')) { drawSelection(); return; }
      sketch(stage.chalk, pos, m, 'clash', { half: s.includes('半'), classical: s.includes('速') }); drawMarks();
      return;
    }
    sketch(stage.chalk, pos, m, mode, { newton: screen === 'lesson' && EXPERIMENTS[exp].newton });
  } else drawSelection();
  if (screen === 'lesson' && expPhase === 'do') hint();
}
async function onSquare(sq: number, button: number) {
  sound.unlock();
  if (pyramid) { togglePyramid(false); return; }
  if (screen === 'lesson' && expPhase === 'controls') { if (button === 2) checkCtl('cancel'); else if (pos.board[sq]?.side === 'w') checkCtl('select'); }
  if (screen === 'puzzle' && puz && declaring()) return declareClick(sq, button);
  if (busy || (screen !== 'play' && screen !== 'lesson' && screen !== 'puzzle') || pos.turn !== 'w') return;
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
  if (!m) return;
  if (screen === 'puzzle') return puzzleMove(m);
  await commit(m);
}
function promotion(ms: Move[]): Promise<Move | null> {
  return new Promise(res => {
    $('screen').className = 'dim';
    $('screen').innerHTML = '<div class="panel dlg"><div class="ph"><span class="lbl">승진</span></div><div class="pb"><h2>무엇이 될까</h2><div class="promo">' + (['q', 'r', 'b', 'n'] as Kind[]).map(k => '<button data-k="' + k + '">' + GLYPH.w[k] + '</button>').join('') + '</div></div></div>';
    document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach(b => b.onclick = () => { clearScreen(); res(ms.find(m => m.promo === b.dataset.k) ?? null); });
  });
}

function specimen(side: Side, kind: Kind, label: string) {
  const el = document.createElement('div'); el.className = 'spec';
  el.innerHTML = '<b>' + GLYPH[side][kind] + '</b><small>' + label + '</small>';
  $(side === 'b' ? 'case-me' : 'case-them').append(el);
  gsap.from(el, { y: -18, opacity: 0, duration: .35, ease: 'expo.out' });
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
      specimen(p.side, p.kind, (tr?.exit ? Math.abs(tr.exit.v).toFixed(2) + 'c/4 · ' : '') + moveNo);
    }
  } else if (out.removed.length) {
    board.push(tag + (out.stomp ? '   낙하 공격 · 열' : '   잡음'));
    for (const p of out.removed) specimen(p.side, p.kind, (out.stomp ? '낙하 · ' : '') + moveNo);
  }
  stage.writeBlackboard(board);
}

async function commit(m: Move) {
  busy = true; selected = -1;
  stage.chalk.erase(200); sound.chalk(180);
  if (variant === 'light' && screen === 'play') return lightTurn(m);
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
  record(before, r.out); lastOut = r.out;
  if (mode === 'clash') witness(before, r.out, before.turn);
}
// ── 光: choose on what you see, resolve on what is ───────────────────────
function refreshLight() {
  const seen = sightings(hist, outs, 'w');
  pos = belief(truth, seen, 'w');
  stage.sync(pos, false);
  const shown = seen.filter(x => x.alive && pos.board[x.sq]?.id === x.piece.id);
  stage.showStale(new Map(shown.filter(x => x.age > 0).map(x => [x.piece.id, x.age])));
  lightDepth = new Map(shown.map(x => [x.piece.id, hist.length - 1 - x.seenAt]));
  stage.setPyramid(pyramid, kingSq(pos, 'w'), lightDepth);
}
let pyramid = false, lightDepth = new Map<string, number>(), pyramidTaught = false;
function togglePyramid(force?: boolean) {
  const can = variant === 'light' && screen === 'play';
  pyramid = can && (force ?? !pyramid);
  $('btn-pyr').classList.toggle('on', pyramid);
  if (can) stage.setPyramid(pyramid, kingSq(pos, 'w'), lightDepth); else stage.setPyramid(false, 0, new Map());
  if (pyramid) {
    sound.unfold(); stage.chalk.clearNow(); selected = -1; register('pyramid', '光');
    if (!pyramidTaught) { pyramidTaught = true; toast('위가 지금. 멀리 있는 칸일수록 깊은 과거 — 빛이 거기서 오는 데 걸린 시간', 4200); }
  }
}
async function lightStep(intent: Move, side: Side) {
  const before = truth, res = resolve(before, intent), r = apply(before, res);
  if (side === 'w') moveNo++;
  hist.push(r.pos); outs.push(r.out);
  const mine = (id: string) => before.board.find(p => p?.id === id)?.side === 'w';
  const touched = !!r.out && (before.board[r.out.move.from]?.side === 'w' || (!!r.out.clash && [...r.out.clash.moved.keys()].some(mine)) || r.out.stomp?.victim.side === 'w');
  if (r.out && touched) {
    await stage.play(before, r.out, r.pos); record(before, r.out); witness(before, r.out, side);
    if (side === 'w' && r.out.removed.some(x => x.side === 'b' && (lightDepth.get(x.id) ?? 0) > 0)) register('unseen', '光');
  } else if (side === 'w') {
    if (res.kind === 'miss') { sound.miss(); toast('빗나감 — 거기엔 이미 아무도 없었다'); register('miss', '光'); }
    else if (res.kind === 'blocked') { sound.miss(); toast('막힘 — 보이지 않던 기물이 앞을 막고 있다'); register('blocked', '光'); }
  }
  truth = r.pos;
  refreshLight();
}
async function lightTurn(m: Move) {
  togglePyramid(false);
  await lightStep(m, 'w');
  if (await lightOver()) return;
  setStatus('흑이 움직인다 — 보이지 않는다', false, '光 · 흑');
  await wait(420);
  const bel = belief(truth, sightings(hist, outs, 'b'), 'b');
  const am = await think(bel, 'clash', level, []);
  if (am) await lightStep(am, 'b');
  if (await lightOver()) return;
  busy = false;
  setStatus('멀리 있는 것은 과거다', false, '光 · 백');
}
function resultPanel(win: boolean, draw: boolean, sub: string) {
  win ? sound.win() : draw ? sound.tick() : sound.lose();
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="panel dlg result"><div class="ph"><span class="lbl">경기 기록</span><span class="lbl">' + moveNo + '수</span></div><div class="pb">'
    + '<div class="big ' + (win ? 'win' : draw ? '' : 'lose') + '">' + (win ? '승리' : draw ? '무승부' : '패배') + '</div><p class="sub">' + sub + '</p>'
    + '<div class="idx">' + row('r-again', '01', '다시', '', 'main') + row('r-home', '02', '처음으로', '') + '</div></div></div>';
  openPanel($('screen').firstElementChild!); wireRows($('screen')); reveal($('screen'));
  $('r-again').onclick = newGame; $('r-home').onclick = () => title(true);
}
async function lightOver(): Promise<boolean> {
  const wk = kingSq(truth, 'w') >= 0, bk = kingSq(truth, 'b') >= 0;
  if (wk && bk && hist.length <= 200) return false;
  screen = 'over'; busy = true;
  stage.showStale(new Map()); stage.sync(truth); // the truth, at last
  await wait(900);
  const win = !bk, draw = wk && bk;
  if (win) register('lightwin', '光'); else if (!draw) register('pastloss', '光');
  resultPanel(win, draw, '光 · ' + (draw ? '200수' : win ? '흑 킹이 떨어졌다' : '백 킹이 떨어졌다 — 보지 못한 곳에서'));
  return true;
}

async function aiTurn() {
  setStatus('흑이 계산 중…', false, '衝 · ' + LEVEL_NAME[level]);
  await wait(380);
  const m = await think(pos, mode, level, history);
  if (!m) { busy = false; return; }
  await play(m);
  if (await finished()) return;
  busy = false;
  if (inCheck(pos, mode)) { sound.check(); setStatus('체크 — 킹이 떨어질 위기', true, '경고'); cracks(); }
  else setStatus('백의 차례', false, mode === 'clash' ? '衝 · ' + LEVEL_NAME[level] : '클래식');
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
  if (mode === 'clash') {
    if (st.reason === 'checkmate') { register('cliffmate'); if (lastOut?.stomp) register('knightmate'); }
    if (st.reason === 'stalemate') register('stalemate');
    if (st.reason === 'repetition') register('repetition');
  }
  if (st.reason === 'checkmate' && mode === 'clash') await finale();
  else await wait(600);
  const win = st.result === '1-0', draw = st.result === '1/2-1/2';
  const why = { checkmate: '체크메이트', stalemate: '스테일메이트', fifty: '50수 규칙', repetition: '3회 반복', material: '기물 부족' }[st.reason];
  resultPanel(win, draw, why);
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
    pos = r.pos; register('ringout');
  }
  await wait(900);
  for (const [on, ms] of [[false, 80], [true, 60], [false, 400]] as const) { stage.lampFlicker(on); await wait(ms); }
  sound.ambience(false);
}

// ── tutorial: 0. controls, then 실험 노트 (predict → observe → explain) ───
const ctl = { select: false, rotate: false, zoom: false, cancel: false };
function checkCtl(k: keyof typeof ctl) {
  if (screen !== 'lesson' || expPhase !== 'controls' || ctl[k]) return;
  ctl[k] = true; sound.tick(); note();
  if (Object.values(ctl).every(Boolean)) setTimeout(() => { if (expPhase === 'controls') experiment(0); }, 900);
}
{
  const cv = $('stage'); let down: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 30) checkCtl('rotate'); });
  window.addEventListener('pointerup', () => { down = null; });
  cv.addEventListener('wheel', () => checkCtl('zoom'), { passive: true });
  cv.addEventListener('contextmenu', () => checkCtl('cancel'));
}
function controls() {
  experiment(0, true);
}
function experiment(i: number, withControls = false) {
  pyramid = false; $('btn-pyr').hidden = true; stage.setPyramid(false, 0, new Map());
  if (variantBeforeLesson === undefined) variantBeforeLesson = variant;
  variant = 'clash'; mode = 'clash'; puz = null;
  screen = 'lesson'; exp = i; guess = -1;
  const e = EXPERIMENTS[i];
  resetBoard(e.fen);
  clearScreen(); $('hud').hidden = false; hudFor('lesson');
  stage.resetCamera(); stage.aimZ = -3.3; stage.aimX = 0; stage.lampFlicker(true); stage.setLamp(2700); sound.setPitch(0); sound.ambience(true);
  if (withControls) { Object.assign(ctl, { select: false, rotate: false, zoom: false, cancel: false }); expPhase = 'controls'; setStatus('조작', false, '실험 노트 · 00'); note(); openPanel($('note')); return; }
  setStatus(e.title.replace(/^실험 \d+ · /, ''), false, '실험 노트 · ' + pad(i + 1, 2));
  expPhase = e.predict ? 'predict' : 'do';
  note(); openPanel($('note'));
  if (expPhase === 'do') hint();
}
function prog() { return '<div class="prog">' + EXPERIMENTS.map((_, i) => '<i class="' + (i <= exp && expPhase !== 'controls' ? 'on' : '') + '"></i>').join('') + '</div>'; }
function note() {
  const e = EXPERIMENTS[exp], n = $('note'); n.hidden = false;
  const skip = tutorialDone() || expPhase === 'controls' ? '<button class="skip" id="n-skip">' + (expPhase === 'controls' ? '넘어가기 →' : '노트 덮기') + '</button>' : '';
  const head = '<div class="ph"><span class="lbl">실험 노트 · ' + (expPhase === 'controls' ? '00 조작' : pad(exp + 1, 2) + ' / ' + pad(EXPERIMENTS.length, 2)) + '</span>' + prog() + '</div><div class="pb">';
  if (expPhase === 'controls') {
    const c = (k: keyof typeof ctl, key: string, t: string) => '<div class="' + (ctl[k] ? 'ok' : '') + '"><b>' + (ctl[k] ? '✓ ' : '') + key + '</b>' + t + '</div>';
    n.innerHTML = head + '<h3>먼저, 손에 익히기</h3><p>아래 네 가지를 직접 해 보세요. 하나씩 체크됩니다.</p>'
      + '<div class="check">' + c('select', '클릭', '흰 기물 선택') + c('rotate', '드래그', '시점 회전') + c('zoom', '휠', '확대·축소') + c('cancel', '우클릭', '선택 취소') + '</div>'
      + '<div class="keys"><span class="cap">A</span><span>조준 판서 — 결과를 미리 그린다</span>'
      + '<span class="cap">R</span><span>시점 초기화</span><span class="cap">SPACE</span><span>빛 피라미드 (光)</span><span class="cap">⌫</span><span>문제: 처음 배치로</span><span class="cap">ESC</span><span>메뉴 · 선택 취소</span><span class="cap">↑↓</span><span>메뉴 이동</span></div>'
      + '<div class="acts">' + skip + '</div></div>';
  } else if (expPhase === 'predict') {
    n.innerHTML = head + '<h3>' + e.title + '</h3><p><b>예측</b> — ' + e.predict!.q + '</p><div class="opts">'
      + e.predict!.options.map((o, i) => '<button class="row" data-o="' + i + '"><span class="n">' + 'ABC'[i] + '</span><span class="t">' + o + '</span><span class="m"></span></button>').join('') + '</div><div class="acts">' + skip + '</div></div>';
    n.querySelectorAll<HTMLButtonElement>('[data-o]').forEach(b => b.onclick = () => { guess = Number(b.dataset.o); expPhase = 'do'; sound.tick(); note(); hint(); });
    wireRows(n); reveal(n);
  } else if (expPhase === 'do') {
    n.innerHTML = head + '<h3>' + e.title + '</h3>' + (guess >= 0 ? '<p>내 예측 — ' + e.predict!.options[guess] + '</p>' : '') + '<p><b>관찰</b> — ' + e.task + '</p><div class="acts">' + skip + '</div></div>';
  } else {
    const right = e.predict ? guess === e.predict.answer : true;
    n.innerHTML = head + '<h3>' + e.title + '</h3>' + (e.predict ? '<p class="verdict' + (right ? '' : ' miss') + '">' + (right ? '예측 적중.' : '예측과 달랐다 — 정답: ' + e.predict.options[e.predict.answer]) + '</p>' : '')
      + '<p><b>설명</b> — ' + e.explain + '</p><div class="acts"><button class="btn main" id="n-next">' + (exp === EXPERIMENTS.length - 1 ? '노트 덮고 실전으로' : '다음 실험') + ' <span class="k">ENTER</span></button><button class="btn" id="n-again">다시</button>' + skip + '</div></div>';
    $('n-next').onclick = () => { if (exp < EXPERIMENTS.length - 1) experiment(exp + 1); else { store.set('tutorial', '1'); $('note').hidden = true; newGame(); toast('실전 — 흑은 ' + LEVEL_NAME[level] + ' AI'); } };
    $('n-again').onclick = () => experiment(exp);
  }
  const s = document.getElementById('n-skip');
  if (s) s.onclick = () => { if (expPhase === 'controls') experiment(0); else { $('note').hidden = true; title(true); } };
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

// ── 당구 문제 ────────────────────────────────────────────────────────────
let puz: Puzzle | null = null;
const pz = { start: fromFen(START), tally: emptyTally() as Tally, moves: [] as string[], declared: [] as string[], from: -1 };
const rec = (id: number) => (book[id] ??= { tries: 0 });
const isTorn = (id: number) => book[id]?.torn === today();
function tierSolved(t: number) { return PUZZLES.filter(p => p.tier === t && book[p.id]?.solved).length; }
function tierOpen(t: number) { return t === 1 || tierSolved(t - 1) >= 7 || store.get('v1:allopen') === '1'; }
function goalText(p: Puzzle): string {
  const n = ['', '한 수로', '두 수로', '세 수로'][p.depth];
  if (p.goal.type === 'mate') return (p.depth === 1 ? '한 수' : '두 수') + ' 안에 메이트';
  const keep = p.goal.keep ? ' — 백은 하나도 잃지 말 것' : '';
  if (p.goal.type === 'drop') return n + ' 흑 기물 ' + p.goal.n + '개를 떨어뜨려라' + keep;
  const st = fromFen(p.fen);
  return n + ' 표시한 ' + p.goal.squares.map(s => '흑 ' + KO[st.board[s]!.kind]).join('과 ') + '을 떨어뜨려라' + keep;
}
function stepText() {
  if (!puz) return '';
  if (puz.seals.includes('宣')) return '수를 ' + puz.depth + '개 선언하고 실행';
  return puz.depth === 1 ? '한 수' : '수 ' + (pz.moves.length + 1) + ' / ' + puz.depth;
}
const declaring = () => !!puz && puz.seals.includes('宣') && !busy;
let seenSeals: string[] = (() => { try { return JSON.parse(store.get('v1:seals') || '[]'); } catch { return []; } })();

async function openPuzzle(p: Puzzle) {
  if (isTorn(p.id)) { toast('찢어진 문제지 — 내일 다시 열린다'); return; }
  puz = p; screen = 'puzzle'; variant = variantBeforeLesson ?? variant; variantBeforeLesson = undefined; mode = 'clash';
  clearScreen(); $('note').hidden = true; $('hud').hidden = false; hudFor('puzzle');
  pyramid = false; $('btn-pyr').hidden = true; stage.setPyramid(false, 0, new Map());
  stage.resetCamera(); stage.aimZ = -1.1; stage.aimX = innerWidth > innerHeight * 1.1 ? 1.3 : 0; stage.lampFlicker(true); stage.setLamp(TIERS[p.tier - 1].lamp); sound.setPitch(p.tier - 1); sound.ambience(true);
  resetPuzzle();
  renderCard(); openPanel($('pcard'));
  const fresh = p.seals.filter(s => !seenSeals.includes(s));
  if (fresh.length) {
    busy = true;
    for (const s of fresh) {
      seenSeals.push(s); store.set('v1:seals', JSON.stringify(seenSeals));
      await stamp(s, SEAL_TEXT[s], () => sound.stamp());
      if (puz !== p) return;
    }
    busy = false;
  }
}
function resetPuzzle() {
  if (!puz) return;
  resetBoard(puz.fen);
  pz.start = pos; pz.tally = emptyTally(); pz.moves = []; pz.declared = []; pz.from = -1;
  setStatus(stepText(), false, 'No. ' + pad(puz.id));
  renderTape(); drawSelection();
}
function renderCard() {
  if (!puz) return;
  const p = puz, r = book[p.id];
  $('pcard').innerHTML = '<div class="ph"><span class="lbl">No. ' + pad(p.id) + '</span>' + stars(p.tier) + '</div><div class="pb">'
    + '<div class="goal">' + goalText(p) + '</div>'
    + '<div class="seals">' + (p.seals.length ? p.seals.map(s => '<span class="seal" title="' + SEAL_TEXT[s] + '">' + s + '</span>').join('') : '<span class="lbl">제약 없음</span>') + '</div>'
    + '<div class="meta"><span class="lbl">' + TIERS[p.tier - 1].star + ' · ' + TIERS[p.tier - 1].cls + '</span><span class="lbl">시도 ' + (r?.tries ?? 0) + (r?.solved ? ' · 解' : '') + '</span></div></div>';
}
function renderTape() {
  const t = $('tape');
  if (!puz || !puz.seals.includes('宣')) { t.hidden = true; return; }
  t.hidden = false;
  t.innerHTML = '<button class="clr" id="tp-clr" title="지우기">⌫</button>' + Array.from({ length: puz.depth }, (_, i) => {
    const u = pz.declared[i];
    return '<div class="slot' + (i === pz.declared.length ? ' cur' : '') + '"><span class="lbl">선언 ' + (i + 1) + '</span><b>' + (u ? u.slice(0, 2) + '→' + u.slice(2, 4) : '—') + '</b></div>';
  }).join('') + '<button class="go" id="tp-go"' + (pz.declared.length < puz.depth ? ' disabled' : '') + '>실행 ▶</button>';
  $('tp-clr').onclick = () => { pz.declared.pop(); pz.from = -1; renderTape(); drawSelection(); };
  $('tp-go').onclick = () => void runDeclared();
}
function declareClick(sq: number, button: number) {
  if (!puz || busy) return;
  if (button === 2 || sq < 0) { if (pz.from >= 0) pz.from = -1; else pz.declared.pop(); renderTape(); drawSelection(); return; }
  if (pz.declared.length >= puz.depth) return;
  if (pz.from < 0) { pz.from = sq; sound.tick(); drawSelection(); return; }
  if (sq === pz.from) { pz.from = -1; drawSelection(); return; }
  pz.declared.push(name(pz.from) + name(sq)); pz.from = -1; sound.chalk(160);
  renderTape(); drawSelection();
}
async function runDeclared() {
  if (!puz || busy || pz.declared.length < puz.depth) return;
  busy = true; $('tape').hidden = true; stage.chalk.erase(220);
  for (let i = 0; i < pz.declared.length; i++) {
    const m = findMove(targetMoves(pos), pz.declared[i]);
    if (!m) { toast(['첫', '두', '세'][i] + ' 번째 수를 실행할 수 없다 — ' + pz.declared[i].slice(0, 2) + '에 움직일 수 있는 백 기물이 없거나 길이 막혔다', 3200); return failPuzzle(); }
    const done = await stepPuzzle(m);
    if (done) return;
  }
}
async function puzzleMove(m: Move) {
  busy = true; selected = -1; stage.chalk.erase(200); sound.chalk(180);
  const done = await stepPuzzle(m);
  if (!done) { busy = false; drawSelection(); }
}
/** Play one White move of the problem (and Black's defence). Returns true if the problem ended. */
async function stepPuzzle(m: Move): Promise<boolean> {
  const p = puz!, before = pos;
  moveNo++;
  const r = p.goal.type === 'mate' ? make(before, m, 'clash') : targetStep(before, m);
  await stage.play(before, r.out, r.pos);
  pos = r.pos; pz.moves.push(uci(m)); pz.tally = addTally(pz.tally, r.out);
  record(before, r.out); witness(before, r.out, 'w');
  if (p.goal.type === 'mate') {
    if (mated(pos)) { if (kingSq(pos, 'b') >= 0) register('cliffmate', '문제'); await solvedPuzzle(); return true; }
    if (pz.moves.length >= p.depth) { await failPuzzle(); return true; }
    setStatus('흑이 막는다…', false, 'No. ' + pad(p.id)); await wait(300);
    const b = defend(pos);
    if (!b) { await failPuzzle(); return true; }
    const b0 = pos, rb = make(b0, b, 'clash');
    await stage.play(b0, rb.out, rb.pos); pos = rb.pos; record(b0, rb.out); witness(b0, rb.out, 'b');
    setStatus('마지막 수', true, 'No. ' + pad(p.id));
    return false;
  }
  if (achieved(pz.start, p.goal, pz.tally)) { await solvedPuzzle(); return true; }
  if (pz.moves.length >= p.depth) { await failPuzzle(); return true; }
  setStatus(stepText(), false, 'No. ' + pad(p.id));
  return false;
}
async function failPuzzle() {
  const p = puz!, r = rec(p.id); r.tries++;
  sound.fail();
  if (p.seals.includes('一')) {
    r.torn = today(); saveBook(book);
    sound.tear(); await stamp('破', '실패 — 문제지가 찢어졌다. 내일 다시 열린다', () => sound.stamp());
    if (puz === p) openBook(p.tier, p.id);
    return;
  }
  saveBook(book); renderCard();
  setStatus('실패 — 다시', true, 'No. ' + pad(p.id));
  await wait(1100);
  if (puz === p && screen === 'puzzle') { resetPuzzle(); busy = false; }
}
async function solvedPuzzle() {
  const p = puz!, r = rec(p.id);
  const firstTry = r.tries === 0 && !r.solved;
  r.tries++;
  await wait(500);
  if (puz !== p) return;
  if (!r.solved) { r.solved = Date.now(); r.first = firstTry; r.img = stage.snapshot(320, 200); }
  saveBook(book); renderCard();
  sound.win();
  register('solve1', '문제 ' + pad(p.id));
  if (p.tier >= 5) register('solve5', '문제 ' + pad(p.id));
  if (p.tier >= 10) register('solve10', '문제 ' + pad(p.id));
  await stamp('解', '', () => sound.stamp());
  if (puz !== p || screen !== 'puzzle') return;
  const next = PUZZLES.find(q => q.id > p.id && !book[q.id]?.solved && tierOpen(q.tier) && !isTorn(q.id));
  const mate = p.goal.type === 'mate';
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="panel dlg result"><div class="ph"><span class="lbl">No. ' + pad(p.id) + ' · 解</span>' + stars(p.tier) + '</div><div class="pb">'
    + '<div class="big win">풀었다</div><p class="sub">' + goalText(p) + '</p>'
    + '<div class="detail" style="grid-template-columns:1fr;border:0;padding:0"><div class="facts">'
    + '<div><span class="lbl">' + (mate ? '첫 수 후보' : '탐색한 수순') + '</span><b id="sv-total">0</b></div>'
    + '<div><span class="lbl">' + (mate ? '강제 메이트' : '해답') + '</span><b id="sv-sol">0</b></div>'
    + '<div><span class="lbl">시도</span><b>' + r.tries + (firstTry ? ' · 一發' : '') + '</b></div></div>'
    + '<p class="sub" id="sv-rare" style="opacity:0">엔진이 ' + p.total.toLocaleString() + '가지를 전부 계산했다. 그중 답은 ' + p.solutions + '가지 — ' + (p.total / p.solutions >= 100 ? '상위 ' + (100 * p.solutions / p.total).toFixed(p.total / p.solutions >= 10000 ? 3 : 2) + '%의 수를 찾았다.' : '맞는 수를 골라냈다.') + '</p></div>'
    + '<div class="idx">' + (next ? row('s-next', '01', '다음 문제', 'No. ' + pad(next.id), 'main') : '') + row('s-again', next ? '02' : '01', '다시 보기', '') + row('s-book', next ? '03' : '02', '문제집', '') + '</div></div></div>';
  openPanel($('screen').firstElementChild!); wireRows($('screen')); reveal($('screen'));
  scramble($('sv-total'), p.total.toLocaleString(), 1.1); scramble($('sv-sol'), String(p.solutions), .6);
  gsap.to('#sv-rare', { opacity: 1, delay: 1.2, duration: .4 });
  if (next) $('s-next').onclick = () => void openPuzzle(next);
  $('s-again').onclick = () => { clearScreen(); resetPuzzle(); busy = false; };
  $('s-book').onclick = () => openBook(p.tier, p.id);
}

let bookTier = 1, bookSel = 0;
function openBook(tier?: number, sel?: number) {
  screen = 'title'; puz = null; busy = false; titleToken++;
  $('hud').hidden = true; $('note').hidden = true; hudFor('title');
  stage.chalk.clearNow();
  if (tier) bookTier = tier; else { for (let t = 10; t >= 1; t--) if (tierOpen(t)) { bookTier = t; break; } }
  bookSel = sel ?? PUZZLES.find(p => p.tier === bookTier && !book[p.id]?.solved)?.id ?? PUZZLES.find(p => p.tier === bookTier)!.id;
  renderBook(true);
}
function renderBook(anim = false) {
  stage.setLamp(TIERS[bookTier - 1].lamp); sound.setPitch(bookTier - 1);
  const total = solvedCount();
  const tiers = TIERS.map((T, i) => {
    const t = i + 1, open = tierOpen(t);
    return '<button class="tier' + (t === bookTier ? ' sel' : '') + (open ? '' : ' locked') + '" data-t="' + t + '" style="--tc:' + T.color + '"><span class="sw"></span><span class="nm">★' + t + ' ' + T.star + '<small>' + T.cls + ' · ' + T.k.toLocaleString() + 'K</small></span><span class="pr">' + (open ? tierSolved(t) + '/10' : '잠김') + '</span></button>';
  }).join('');
  const ps = PUZZLES.filter(p => p.tier === bookTier), open = tierOpen(bookTier);
  const cells = ps.map(p => {
    const r = book[p.id], torn = isTorn(p.id);
    return '<button class="cell' + (r?.solved ? ' done' : '') + (torn ? ' torn' : '') + (p.id === bookSel ? ' sel' : '') + (open ? '' : ' locked') + '" data-p="' + p.id + '"' + (r?.img ? ' style="background-image:url(' + r.img + ')"' : '') + '><span class="no">No. ' + pad(p.id) + '</span>'
      + '<span class="st">' + (r?.solved ? '<span class="seal">解</span>' : torn ? '<span class="seal">破</span>' : '') + '</span></button>';
  }).join('');
  const sp = PUZZLES.find(p => p.id === bookSel)!, r = book[sp.id];
  const seals = sp.seals.length ? sp.seals.map(s => '<span class="seal">' + s + '</span>').join('') : '<span class="lbl">제약 없음</span>';
  const introSeals = [...new Set(ps.flatMap(p => p.seals))];
  $('screen').className = 'dim left';
  $('screen').innerHTML = '<div class="panel shell"><div class="ph"><span class="lbl">당구 문제 · 문제집</span><span class="lbl">解 ' + total + ' / ' + PUZZLES.length + '</span></div><div class="pb">'
    + '<div class="tiers">' + tiers + '</div><div class="grid">'
    + '<div style="display:flex;justify-content:space-between;align-items:end"><div><span class="lbl">★' + bookTier + ' · ' + TIERS[bookTier - 1].star + '</span><h2 style="margin-top:6px">' + stars(bookTier) + '</h2></div>'
    + '<div class="sealkey">' + (introSeals.length ? introSeals.map(s => '<span class="seal">' + s + '</span><span>' + SEAL_TEXT[s] + '</span>').join('') : '<span></span><span>조준 판서가 결과를 전부 보여 준다</span>') + '</div></div>'
    + (open ? '' : '<p class="sub">앞 단계에서 7문제를 풀면 열린다.</p>')
    + '<div class="cells">' + cells + '</div>'
    + '<div class="detail"><div><span class="lbl">No. ' + pad(sp.id) + '</span><div class="goal" style="margin-top:6px">' + goalText(sp) + '</div><div class="seals">' + seals + '</div>'
    + '<div class="facts"><div><span class="lbl">' + (sp.goal.type === 'mate' ? '첫 수 후보' : '가능한 수순') + '</span><b>' + sp.total.toLocaleString() + '</b></div><div><span class="lbl">' + (sp.goal.type === 'mate' ? '강제 메이트' : '해답') + '</span><b>' + (r?.solved ? sp.solutions : '?') + '</b></div><div><span class="lbl">시도</span><b>' + (r?.tries ?? 0) + '</b></div><div><span class="lbl">난도</span><b>' + sp.score.toFixed(1) + '</b></div></div></div>'
    + '<div class="go" style="display:flex;flex-direction:column;gap:8px"><button class="btn main" id="b-go"' + (open && !isTorn(sp.id) ? '' : ' disabled') + '>' + (isTorn(sp.id) ? '내일 다시' : r?.solved ? '다시 풀기' : '풀기') + ' <span class="k">ENTER</span></button><button class="btn" id="b-back">돌아가기 <span class="k">ESC</span></button></div></div>'
    + '</div></div></div>';
  if (anim) { openPanel($('screen').firstElementChild!); gsap.fromTo('.cell', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .25, stagger: .02, ease: 'expo.out', clearProps: 'transform' }); }
  document.querySelectorAll<HTMLButtonElement>('[data-t]').forEach(b => b.onclick = () => { bookTier = Number(b.dataset.t); bookSel = PUZZLES.find(p => p.tier === bookTier && !book[p.id]?.solved)?.id ?? PUZZLES.find(p => p.tier === bookTier)!.id; sound.tick(); renderBook(true); });
  document.querySelectorAll<HTMLButtonElement>('[data-p]').forEach(b => {
    b.onclick = () => { const id = Number(b.dataset.p); if (id === bookSel && tierOpen(bookTier)) void openPuzzle(PUZZLES.find(p => p.id === id)!); else { bookSel = id; sound.tick(); renderBook(); } };
    b.onpointerenter = () => sound.hover();
  });
  $('b-go').onclick = () => void openPuzzle(sp);
  $('b-back').onclick = () => title(true);
}

// ── 현상 도감 ────────────────────────────────────────────────────────────
let codexGroup = -1, codexSel = '';
function openCodex() {
  screen = 'title'; titleToken++; $('hud').hidden = true; $('note').hidden = true;
  codexSel = codexSel || ENTRIES[0].id;
  renderCodex(true);
}
function renderCodex(anim = false) {
  const found = Object.keys(codex).length;
  const list = ENTRIES.filter(e => codexGroup < 0 || e.group === codexGroup);
  const pips = (r: number) => '<span class="pips">' + [1, 2, 3, 4].map(i => '<i class="' + (i <= r ? 'on' : '') + '">◆</i>').join('') + '</span>';
  const plates = list.map(e => {
    const c = codex[e.id];
    return '<button class="plate' + (c ? '' : ' unk') + (e.id === codexSel ? ' sel' : '') + '" data-c="' + e.id + '"><div class="img"' + (c?.img ? ' style="background-image:url(' + c.img + ')"' : '') + '>' + (c ? '' : '?') + '</div>'
      + '<div class="cap2"><span class="lbl"><span>No. ' + pad(e.no) + '</span>' + pips(e.rarity) + '</span><b>' + (c ? e.name : '미발견') + '</b></div></button>';
  }).join('');
  const e = byId.get(codexSel)!, c = codex[e.id];
  const d = c ? new Date(c.t) : null, two = (n: number) => String(n).padStart(2, '0');
  const date = d ? d.getFullYear() + '.' + two(d.getMonth() + 1) + '.' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) : '—';
  $('screen').className = 'dim left';
  $('screen').innerHTML = '<div class="panel shell"><div class="ph"><span class="lbl">현상 도감</span><span class="lbl">' + found + ' / ' + ENTRIES.length + ' 발견</span></div>'
    + '<div class="groups"><button data-g="-1" class="' + (codexGroup < 0 ? 'on' : '') + '">전체</button>' + GROUPS.map((g, i) => '<button data-g="' + i + '" class="' + (i === codexGroup ? 'on' : '') + '">' + g + ' <span class="lbl">' + ENTRIES.filter(x => x.group === i && codex[x.id]).length + '/' + ENTRIES.filter(x => x.group === i).length + '</span></button>').join('') + '</div>'
    + '<div class="pb"><div class="plates">' + plates + '</div><div class="aside"><div class="img"' + (c?.img ? ' style="background-image:url(' + c.img + ')"' : ' style="background:repeating-linear-gradient(45deg,rgba(236,230,214,.05) 0 1px,transparent 1px 8px),var(--ink2)"') + '></div><div class="in">'
    + '<span class="lbl">No. ' + pad(e.no) + ' · ' + GROUPS[e.group] + ' · ' + RARITY[e.rarity] + '</span><h3>' + (c ? e.name : '??? ') + '</h3>'
    + (c ? '<div class="f">' + e.formula + '</div><p>' + e.text + '</p>' : '<p>단서 — ' + e.hint + '</p>')
    + '<div class="facts"><div><span class="lbl">첫 관측</span><b>' + date + '</b></div><div><span class="lbl">관측 횟수</span><b>' + (c?.n ?? 0) + '</b></div><div><span class="lbl">장소</span><b>' + (c?.where || '—') + '</b></div></div>'
    + '<div style="margin-top:16px"><span class="lbl">도감 완성도 ' + Math.round(100 * found / ENTRIES.length) + '%</span><div class="meter"><i style="width:' + (100 * found / ENTRIES.length) + '%"></i></div></div>'
    + '<div style="margin-top:16px"><button class="btn" id="cx-back">돌아가기 <span class="k">ESC</span></button></div></div></div></div></div>';
  if (anim) { openPanel($('screen').firstElementChild!); gsap.fromTo('.plate', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .25, stagger: .012, ease: 'expo.out', clearProps: 'transform' }); }
  document.querySelectorAll<HTMLButtonElement>('[data-g]').forEach(b => b.onclick = () => { codexGroup = Number(b.dataset.g); sound.tick(); renderCodex(true); });
  document.querySelectorAll<HTMLButtonElement>('[data-c]').forEach(b => { b.onclick = () => { codexSel = b.dataset.c!; sound.tick(); renderCodex(); }; b.onpointerenter = () => sound.hover(); });
  $('cx-back').onclick = () => title(true);
}

// ── settings ─────────────────────────────────────────────────────────────
const Q_NAME: Record<Quality, string> = { auto: '자동', ultra: '최고', high: '높음', mid: '중간', low: '낮음' };
const Q_HINT: Record<Quality, string> = {
  auto: '기본 화질. 30fps 아래로 떨어질 때만 단계적으로 낮춘다.',
  ultra: '원본 고해상도 체스 세트 · 고정 화질. 새로고침 후 적용된다.',
  high: '기본 화질 고정 — 자동으로 낮추지 않는다.',
  mid: '해상도 1.25배 · 유리 ¼ · 그림자 1024.',
  low: '해상도 1배 · 유리 ¼ · 그림자 1024 · 필름 그레인 끔.',
};
function openSettings(back: () => void, anim = true) {
  const seg = (key: string, opts: [string, string][], cur: string) => '<div class="seg">' + opts.map(([v, t]) => '<button data-s="' + key + '" data-v="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + t + '</button>').join('') + '</div>';
  $('screen').className = 'dim';
  $('screen').innerHTML = '<div class="panel set"><div class="ph"><span class="lbl">설정</span><span class="lbl">DOC. 05</span></div><div class="pb">'
    + '<div class="line"><span class="lbl">화질</span>' + seg('quality', (Object.keys(Q_NAME) as Quality[]).map(q => [q, Q_NAME[q]]), settings.quality) + '<span class="hint">' + Q_HINT[settings.quality] + '</span></div>'
    + '<div class="line"><span class="lbl">FPS 표시</span>' + seg('fps', [['0', '끔'], ['1', '켬']], settings.fps ? '1' : '0') + '</div>'
    + '<div class="line"><span class="lbl">소리</span>' + seg('muted', [['0', '켬'], ['1', '끔']], settings.muted ? '1' : '0') + '</div>'
    + '<div class="line"><span class="lbl">음량</span><input type="range" id="s-vol" min="0" max="100" value="' + Math.round(settings.volume * 100) + '"></div>'
    + '<div class="line"><span class="lbl">조준 판서</span>' + seg('aim', [['1', '켬'], ['0', '끔']], settings.aim ? '1' : '0') + '<span class="hint">대국과 낮은 단계 문제에서 결과를 미리 그린다 (A).</span></div>'
    + '<div class="line"><span class="lbl">인트로</span>' + seg('intro', [['always', '매번'], ['first', '첫 실행만']], settings.intro) + '</div>'
    + '<div class="line"><span class="lbl">기록</span><div><button class="btn" id="s-wipe">진행 기록 지우기</button></div><span class="hint">문제집·도감·튜토리얼 기록을 모두 지운다. 되돌릴 수 없다.</span></div>'
    + '<div class="idx" style="margin-top:8px">' + row('s-back', '←', '돌아가기', 'ESC') + '</div></div></div>';
  if (anim) openPanel($('screen').firstElementChild!);
  document.querySelectorAll<HTMLButtonElement>('[data-s]').forEach(b => b.onclick = () => {
    const k = b.dataset.s!, v = b.dataset.v!;
    sound.tick();
    if (k === 'quality') { const was = settings.quality; settings.quality = v as Quality; stage.setQuality(settings.quality); if ((was === 'ultra') !== (v === 'ultra')) toast('최고 화질 체스 세트는 새로고침 후 바뀐다', 3000); }
    if (k === 'fps') { settings.fps = v === '1'; stage.showPerf(settings.fps); }
    if (k === 'muted') { settings.muted = v === '1'; sound.setMuted(settings.muted); }
    if (k === 'aim') { aimOn = settings.aim = v === '1'; $('btn-aim').classList.toggle('on', aimOn); }
    if (k === 'intro') settings.intro = v as 'always' | 'first';
    saveSettings(settings); openSettings(back, false);
  });
  ($('s-vol') as HTMLInputElement).oninput = e => { settings.volume = Number((e.target as HTMLInputElement).value) / 100; sound.setVolume(settings.volume); saveSettings(settings); };
  ($('s-vol') as HTMLInputElement).onchange = () => sound.tick();
  $('s-wipe').onclick = () => {
    if (!confirm('문제집·도감·튜토리얼 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
    for (const k of ['v1:book', 'v1:codex', 'v1:seals', 'tutorial', 'v1:spins']) store.del(k);
    book = {}; codex = {}; seenSeals = []; buildLogo(); toast('기록을 지웠다');
  };
  $('s-back').onclick = back;
  settingsBack = back;
}
let settingsBack: (() => void) | null = null;

// ── menu & keys ──────────────────────────────────────────────────────────
function menu() {
  if (screen === 'title' || screen === 'boot') return;
  $('screen').className = 'dim';
  const inPuzzle = screen === 'puzzle';
  $('screen').innerHTML = '<div class="panel dlg"><div class="ph"><span class="lbl">일시 정지</span><span class="lbl">ESC</span></div><div class="pb">'
    + (inPuzzle ? '<h2>No. ' + pad(puz!.id) + '</h2>' : '<h2>쉬는 시간</h2>')
    + (inPuzzle ? '' : '<div class="set" style="width:auto;margin-top:10px"><div class="line"><span class="lbl">규칙</span>' + segVariant() + '</div><div class="line"><span class="lbl">상대</span>' + segLevel() + '</div></div>')
    + '<div class="idx">' + row('m-back', '01', '계속', '', 'main')
    + (inPuzzle ? row('m-reset', '02', '처음 배치로', '⌫') + row('m-book', '03', '문제집', '') : row('m-new', '02', '새 판', '') + row('m-tut', '03', '실험 노트', ''))
    + row('m-set', '04', '설정', '') + row('m-home', '05', '처음으로', '') + '</div></div></div>';
  openPanel($('screen').firstElementChild!); wireRows($('screen'));
  $('m-back').onclick = clearScreen;
  if (inPuzzle) { $('m-reset').onclick = () => { clearScreen(); if (!busy) resetPuzzle(); }; $('m-book').onclick = () => openBook(puz!.tier, puz!.id); }
  else { $('m-new').onclick = newGame; $('m-tut').onclick = controls; wireSegs(newGame); }
  $('m-set').onclick = () => openSettings(menu);
  $('m-home').onclick = () => title(true);
}
$('btn-menu').onclick = menu;
$('btn-pyr').onclick = () => togglePyramid();
$('btn-reset').onclick = () => { if (!busy && screen === 'puzzle') resetPuzzle(); };
$('btn-aim').onclick = () => { aimOn = !aimOn; settings.aim = aimOn; saveSettings(settings); $('btn-aim').classList.toggle('on', aimOn); drawSelection(); };
$('btn-aim').classList.toggle('on', aimOn);
document.addEventListener('keydown', e => {
  if (document.getElementById('intro')) return;
  const overlay = !!$('screen').innerHTML;
  if (e.key === 'Escape') {
    if (document.querySelector('.shell') || (overlay && document.getElementById('s-back') && settingsBack)) {
      const back = document.getElementById('b-back') ?? document.getElementById('cx-back') ?? document.getElementById('s-back');
      back?.click(); return;
    }
    if (document.getElementById('g-back')) { $('g-back').click(); return; }
    if (document.getElementById('c-back')) { $('c-back').click(); return; }
    if (overlay && screen !== 'title' && screen !== 'over') { clearScreen(); return; }
    if (screen === 'puzzle' && pz.from >= 0) { pz.from = -1; drawSelection(); return; }
    if (selected >= 0) { selected = -1; drawSelection(); } else menu();
  } else if (e.key === 'Enter') {
    const b = document.getElementById('b-go') ?? document.getElementById('g-go') ?? document.getElementById('n-next') ?? document.getElementById('s-next');
    if (b && !(b as HTMLButtonElement).disabled && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); b.click(); }
    else if (screen === 'puzzle' && puz?.seals.includes('宣') && !overlay) void runDeclared();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...document.querySelectorAll<HTMLButtonElement>('#screen .row, #note .row')];
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus(); sound.hover();
  } else if (overlay) return;
  else if (e.key === ' ') { e.preventDefault(); togglePyramid(); }
  else if (e.key === 'Backspace') { e.preventDefault(); if (screen === 'puzzle' && !busy) { if (puz?.seals.includes('宣') && pz.declared.length) { pz.declared.pop(); renderTape(); drawSelection(); } else resetPuzzle(); } }
  else if (e.key.toLowerCase() === 'a') $('btn-aim').click();
  else if (e.key.toLowerCase() === 'r') stage.resetCamera();
});
stage.onSquare = (s, b) => { void onSquare(s, b); };
stage.onHover = onHover;
buildLogo();
void boot();

if (import.meta.env.DEV) Object.assign(window, { chung: {
  stage, get pos() { return pos; }, newGame, experiment, controls, title, commit, onSquare, openBook, openCodex, openPuzzle, PUZZLES, register,
  click: (s: string) => onSquare(parse(s), 0), hover: (s: string) => onHover(parse(s)),
  pick: (o: number) => (document.querySelector('[data-o="' + o + '"]') as HTMLButtonElement)?.click(),
  setMode: (m: Mode) => { mode = m; }, legal: () => legal(pos, mode), unlockAll: () => store.set('v1:allopen', '1'),
  get book() { return book; }, get codex() { return codex; },
} });
