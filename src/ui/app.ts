import './style.css';
import { ChessScene, type DisplayPiece, type Mark } from '../render/scene';
import { Game, beliefBoard, targets, type Kind, type MoveRecord, type Side } from '../chess/game';
import { chooseMove, rng, LEVEL_NAME, type Level } from '../chess/ai';
import { LESSONS, lessonGame, parseMove, type Lesson } from '../chess/tutorial';
import { Sound } from './audio';

const $ = (id: string) => document.getElementById(id)!;
const store = {
  get(k: string) { try { return localStorage.getItem('hikari3:' + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem('hikari3:' + k, v); } catch { /* private mode */ } },
};
const GLYPH: Record<Side, Record<Kind, string>> = {
  w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
  b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' },
};
const NAME: Record<Kind, string> = { K: '킹', Q: '퀸', R: '룩', B: '비숍', N: '나이트', P: '폰' };
const OBJ: Record<Kind, string> = { K: '킹을', Q: '퀸을', R: '룩을', B: '비숍을', N: '나이트를', P: '폰을' };
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z M17 9l5 6 M22 9l-5 6"/></svg>';

// ── state ────────────────────────────────────────────────────────────────
type Mode = 'title' | 'play' | 'lesson' | 'over';
let mode: Mode = 'title';
let game = new Game();
let level: Level = (Number(store.get('level')) || 2) as Level;
let random = rng(1);
let selected = -1, timeView = false, eyeView = false, busy = false;
let lastOwn: MoveRecord | null = null;
let lessonIx = 0, lessonCounter = 0, lessonDone = false;
let revealPly: number | null = null;
let toastTimer = 0;
const sound = new Sound(); sound.setMuted(store.get('muted') === '1');
const tutorialDone = () => store.get('tutorial') === '1';

const scene = new ChessScene($('stage'), onSquare, () => {});

// ── view → scene ─────────────────────────────────────────────────────────
function lesson(): Lesson | null { return mode === 'lesson' ? LESSONS[lessonIx] : null; }

function render() {
  const pieces: DisplayPiece[] = [];
  const marks: Mark[] = [];
  let eye = game.view('w').king;
  if (revealPly !== null) {
    for (const p of game.snaps[revealPly]) if (p.alive) pieces.push({ key: p.id, kind: p.kind, side: p.side, sq: p.sq, look: 'solid', depth: 0 });
    const m = game.moves[revealPly - 1]; if (m) marks.push({ sq: m.from, kind: 'last' }, { sq: m.landed, kind: 'last' });
    eye = game.snaps[revealPly].find(p => p.side === 'w' && p.kind === 'K')?.sq ?? eye;
  } else {
    const v = game.view('w');
    for (const p of v.own) pieces.push({ key: p.id, kind: p.kind, side: p.side, sq: p.sq, look: 'solid', depth: 0 });
    for (const e of v.enemy) if (e.alive) {
      const depth = v.ply - e.seenAt;
      pieces.push({ key: e.id, kind: e.kind, side: e.side, sq: e.sq, look: e.age === 0 ? 'solid' : 'ghost', depth, age: e.age });
    }
    if (eyeView) for (const a of game.afterimage('w')) {
      const real = v.own.find(p => p.id === a.id);
      if (a.alive && (!real || real.sq !== a.sq)) pieces.push({ key: 'echo-' + a.id, kind: a.kind, side: a.side, sq: a.sq, look: 'echo', depth: 0 });
    }
    if (lastOwn) marks.push({ sq: lastOwn.from, kind: 'last' }, { sq: lastOwn.landed, kind: 'last' });
    const sel = v.own.find(p => p.sq === selected);
    if (sel) {
      marks.push({ sq: sel.sq, kind: 'select' });
      const b = beliefBoard(v);
      for (const t of targets(sel, b)) marks.push({ sq: t, kind: b[t] && b[t]!.side !== 'w' ? 'capture' : 'move' });
    }
    const l = lesson();
    if (l?.hint && !lessonDone) for (const h of l.hint) { const { from } = parseMove(h + 'a1'); marks.push({ sq: from, kind: 'hint' }); }
  }
  scene.update({ pieces, marks, eye, timeView, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
  document.body.classList.toggle('teaching', mode === 'lesson');
  // HUD
  const st = $('status');
  st.className = busy ? 'wait' : '';
  st.innerHTML = '<i></i>' + (revealPly !== null ? '진실 — ' + revealPly + '수' : game.winner ? '경기 종료' : busy ? '상대가 생각 중…' : '당신의 차례');
  $('btn-time').classList.toggle('on', timeView);
  $('btn-eye').classList.toggle('on', eyeView);
  const v = game.view('w');
  $('tray-me').textContent = v.capturedByMe.map(k => GLYPH.b[k]).join('');
  $('tray-them').textContent = v.capturedFromMe.map(k => GLYPH.w[k]).join('');
}

function toast(msg: string, tone: 'good' | 'bad' | '' = '') {
  const t = $('toast'); t.textContent = msg; t.className = tone; t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.hidden = true), 2600);
}

// ── input ────────────────────────────────────────────────────────────────
function onSquare(sq: number, button: number) {
  sound.unlock();
  if ((mode !== 'play' && mode !== 'lesson') || revealPly !== null) return;
  if (button === 2 || sq < 0) { selected = -1; return render(); }
  if (busy || game.winner || game.toMove !== 'w' || lessonDone) return;
  const v = game.view('w');
  const own = v.own.find(p => p.sq === sq);
  if (own) { selected = own.sq; sound.tick(); return render(); }
  const sel = v.own.find(p => p.sq === selected);
  if (!sel) return;
  if (!targets(sel, beliefBoard(v)).includes(sq)) { selected = -1; return render(); }
  playerMove(sel.sq, sq);
}

function describe(r: MoveRecord, mine: boolean) {
  if (!mine) return null;
  const vic = r.captured ? NAME[r.captured.kind] : '';
  if (r.outcome === 'intercept') return ['보이지 않던 ' + OBJ[r.captured!.kind] + ' 잡았다', 'good'] as const;
  if (r.outcome === 'capture') return [vic + ' 포획', 'good'] as const;
  if (r.outcome === 'miss') return ['빗나감 — 그곳엔 이미 아무도 없었다', 'bad'] as const;
  if (r.outcome === 'blocked') return ['막힘 — 보이지 않던 기물이 앞을 막고 있다', 'bad'] as const;
  return null;
}

function playerMove(from: number, to: number) {
  const r = game.play('w', from, to);
  lastOwn = r; selected = -1;
  const d = describe(r, true);
  if (r.captured) { sound.capture(); scene.flash(r.landed, 0xf2d59b); } else if (r.outcome === 'miss' || r.outcome === 'blocked') { sound.miss(); scene.flash(r.from, 0xff637e); } else sound.move();
  if (d) toast(d[0], d[1]);
  render();
  if (checkLesson(r)) return;
  if (finish()) return;
  enemyTurn();
}

function enemyTurn() {
  busy = true; render();
  setTimeout(() => {
    const l = lesson();
    let r: MoveRecord | null = null;
    if (l && !l.ai) {
      const s = l.script ?? [];
      for (let i = 0; i < s.length && !r; i++) {
        const { from, to } = parseMove(s[(lessonCounter + i) % s.length]);
        try { r = game.play('b', from, to); lessonCounter += i + 1; } catch { /* not possible now */ }
      }
      if (!r) { const m = chooseMove(game.view('b'), 1, random); if (m) r = game.play('b', m.from, m.to); }
    } else {
      const m = chooseMove(game.view('b'), l?.ai ?? level, random);
      if (m) r = game.play('b', m.from, m.to);
    }
    busy = false;
    if (r?.captured) { sound.loss(); toast(OBJ[r.captured.kind] + ' 잃었다 — ' + 'abcdefgh'[r.landed & 7] + ((r.landed >> 3) + 1), 'bad'); scene.flash(r.landed, 0xff637e); }
    else sound.enemy();
    render();
    if (r) checkLesson(null);
    finish();
  }, 420 + Math.random() * 280);
}

function finish() {
  if (!game.winner) return false;
  if (mode === 'lesson') { checkLesson(null); if (!lessonDone && game.winner !== 'w') { toast('다시 해봅시다', 'bad'); setTimeout(() => startLesson(lessonIx), 1400); } return true; }
  mode = 'over';
  setTimeout(showResult, 900);
  return true;
}

// ── tutorial ─────────────────────────────────────────────────────────────
function startLesson(i: number) {
  const prev = game;
  lessonIx = i; lessonDone = false; lessonCounter = 0; selected = -1; lastOwn = null; revealPly = null;
  const l = LESSONS[i];
  game = lessonGame(l, l.carry ? prev : undefined);
  if (!l.carry) { timeView = false; eyeView = false; }
  random = rng(1000 + i);
  mode = 'lesson'; showHud(true); $('screen').innerHTML = '';
  scene.resetCamera();
  lessonCard();
  render();
  if (game.toMove === 'b') enemyTurn();
}
function lessonCard() {
  const l = LESSONS[lessonIx], c = $('lesson');
  c.hidden = false;
  c.innerHTML = '<div class="step">' + LESSONS.map((_, i) => '<i class="' + (i <= lessonIx ? 'on' : '') + '"></i>').join('') + '</div>'
    + '<h3>' + l.title + '</h3>'
    + '<p class="' + (lessonDone ? 'done' : '') + '">' + fmt(lessonDone ? l.done : l.say) + '</p>'
    + '<div class="row">' + (lessonDone ? '<button class="pill" id="l-next">' + (lessonIx === LESSONS.length - 1 ? '완료' : '다음') + '</button>' : '')
    + '<button class="pill ghost" id="l-retry">다시</button>'
    + (tutorialDone() ? '<button class="skip" id="l-skip">튜토리얼 나가기</button>' : '') + '</div>';
  const n = document.getElementById('l-next'); if (n) n.onclick = nextLesson;
  $('l-retry').onclick = () => startLesson(lessonIx);
  const s = document.getElementById('l-skip'); if (s) s.onclick = showTitle;
}
const fmt = (s: string) => s.replace(/Space/g, '<kbd>Space</kbd>').replace(/\bE를/g, '<kbd>E</kbd>를');
function checkLesson(last: MoveRecord | null) {
  const l = lesson(); if (!l || lessonDone) return false;
  if (l.goal({ game, last: last ?? lastOwn, timeView, eyeView })) {
    lessonDone = true; sound.win(); lessonCard(); render(); return true;
  }
  return false;
}
function nextLesson() {
  if (lessonIx < LESSONS.length - 1) return startLesson(lessonIx + 1);
  store.set('tutorial', '1');
  $('lesson').hidden = true; showHud(false);
  mode = 'title';
  $('screen').innerHTML = '<div class="panel"><div class="big win">光</div><h2>튜토리얼 완료</h2><div class="sub">이제 진짜 상대가 기다립니다.</div><div class="stack"><button class="btn main" id="go">시작</button><button class="btn" id="home">처음으로</button></div></div>';
  $('go').onclick = startGame; $('home').onclick = showTitle;
}

// ── screens ──────────────────────────────────────────────────────────────
function showHud(on: boolean) { $('hud').hidden = !on; if (!on) $('lesson').hidden = true; }
function startGame() {
  game = new Game(); random = rng((Math.random() * 2 ** 31) >>> 0);
  mode = 'play'; selected = -1; lastOwn = null; timeView = false; eyeView = false; revealPly = null; busy = false;
  $('screen').innerHTML = ''; $('lesson').hidden = true; $('reveal').hidden = true; showHud(true); scene.resetCamera(); render();
}
function showTitle() {
  mode = 'title'; showHud(false); $('reveal').hidden = true; revealPly = null;
  game = new Game(); timeView = false; eyeView = false; render();
  $('screen').innerHTML = '<div class="title"><h1>光</h1><div class="tag">빛 의 체 스</div><div class="buttons">'
    + '<button class="btn main" id="t-start">시작</button><button class="btn" id="t-tut">튜토리얼</button></div></div>'
    + '<div class="corner l">v0.3</div><div class="corner r"><button id="t-sound" title="소리">' + (sound.muted ? ICON_SOUND_OFF : ICON_SOUND_ON) + '</button></div>';
  $('t-start').onclick = () => { sound.unlock(); if (tutorialDone()) startGame(); else { startLesson(0); toast('처음이시군요 — 빛의 규칙부터 배워봅시다'); } };
  $('t-tut').onclick = () => { sound.unlock(); startLesson(0); };
  $('t-sound').onclick = () => { sound.setMuted(!sound.muted); store.set('muted', sound.muted ? '1' : '0'); showTitle(); };
}
function showMenu() {
  if (mode === 'title') return;
  $('screen').innerHTML = '<div class="panel"><h2>일시정지</h2><div class="sub">' + (mode === 'lesson' ? '튜토리얼' : '상대: ' + LEVEL_NAME[level]) + '</div><div class="stack">'
    + '<button class="btn main" id="m-back">계속</button>'
    + (mode !== 'lesson' ? '<div class="seg">' + ([1, 2, 3] as Level[]).map(l => '<button data-l="' + l + '" class="' + (l === level ? 'on' : '') + '">' + LEVEL_NAME[l] + '</button>').join('') + '</div>' : '')
    + '<button class="btn" id="m-new">' + (mode === 'lesson' ? '이 단계 다시' : '새 게임') + '</button>'
    + '<button class="btn" id="m-tut">튜토리얼</button>'
    + '<button class="btn" id="m-sound">' + (sound.muted ? '소리 켜기' : '소리 끄기') + '</button>'
    + '<button class="btn" id="m-home">처음으로</button></div></div>';
  $('m-back').onclick = () => ($('screen').innerHTML = '');
  $('m-new').onclick = () => (mode === 'lesson' ? startLesson(lessonIx) : startGame());
  $('m-tut').onclick = () => startLesson(0);
  $('m-sound').onclick = () => { sound.setMuted(!sound.muted); store.set('muted', sound.muted ? '1' : '0'); showMenu(); };
  $('m-home').onclick = showTitle;
  document.querySelectorAll<HTMLButtonElement>('[data-l]').forEach(b => b.onclick = () => { level = Number(b.dataset.l) as Level; store.set('level', String(level)); startGame(); });
}
function showResult() {
  const w = game.winner;
  const win = w === 'w', draw = w === 'draw';
  win ? sound.win() : draw ? sound.tick() : sound.lose();
  const v = game.view('w');
  $('screen').innerHTML = '<div class="panel"><div class="big ' + (win ? 'win' : draw ? '' : 'lose') + '">' + (win ? '승리' : draw ? '무승부' : '패배') + '</div>'
    + '<div class="sub">' + Math.ceil(game.ply / 2) + '수 · 잡은 기물 ' + (v.capturedByMe.map(k => GLYPH.b[k]).join('') || '없음') + '</div><div class="stack">'
    + '<button class="btn main" id="r-truth">진실 보기</button><button class="btn" id="r-again">다시</button><button class="btn" id="r-home">처음으로</button></div></div>';
  $('r-truth').onclick = () => { $('screen').innerHTML = ''; openReveal(); };
  $('r-again').onclick = startGame; $('r-home').onclick = showTitle;
}
function openReveal() {
  revealPly = game.ply; timeView = false; eyeView = false;
  const r = $('reveal'), range = $('reveal-range') as HTMLInputElement;
  r.hidden = false; range.max = String(game.ply); range.value = String(game.ply);
  const upd = () => { revealPly = Number(range.value); $('reveal-ply').textContent = revealPly + ' / ' + game.ply; render(); };
  range.oninput = upd; upd();
  $('reveal-exit').onclick = () => { r.hidden = true; revealPly = null; showResult(); render(); };
}

// ── controls ─────────────────────────────────────────────────────────────
function toggleTime() { if (mode === 'title') return; timeView = !timeView; if (timeView) sound.unfold(); render(); checkLesson(null); }
function toggleEye() { if (mode === 'title') return; eyeView = !eyeView; render(); checkLesson(null); }
$('btn-time').onclick = toggleTime; $('btn-eye').onclick = toggleEye; $('btn-menu').onclick = showMenu;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('screen').innerHTML && mode !== 'title' && mode !== 'over') $('screen').innerHTML = ''; else if (selected >= 0) { selected = -1; render(); } else showMenu(); return; }
  if ($('screen').innerHTML) return;
  if (e.key === ' ') { e.preventDefault(); toggleTime(); }
  else if (e.key.toLowerCase() === 'e') toggleEye();
  else if (e.key.toLowerCase() === 'r') scene.resetCamera();
});

showTitle();
if (!tutorialDone()) { /* first visit: 시작 leads into the tutorial */ }

if (import.meta.env.DEV) Object.assign(window, { hikari: {
  get game() { return game; }, scene, startLesson, startGame, showTitle, onSquare,
  click: (a: string) => { const { from } = parseMove(a + 'a1'); onSquare(from, 0); },
} });
