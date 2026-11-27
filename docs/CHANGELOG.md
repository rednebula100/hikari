# Changelog

## 0.6.0 — worlds, nocturne UI (2026-11-27)
- **Worlds** (`src/render/worlds.ts`): the problem tiers move the board — ★1–2 night lab, ★3–4 a little boat on the
  sunset sea (three.js Sky + own ocean shader), ★5–6 a marble plinth above a moonlit cloud sea, ★7–8 an ice slab under
  the aurora, ★9 orbit above a blue planet, ★10 under the pinwheel of WR 104. Matches pick a world at random; tutorial
  and title stay in the lab. Transition: fade to dark, swap, an establishing shot from the horizon down onto the board,
  and a name card. Hand-written shaders, no reflection passes.
- **UI v4 「야상곡」**: night glass panels with one brass hairline and a slowly drifting chess lattice; a slim brass bar
  slides along menus; square vermilion seals and the v2 problem cells are back. Notebook tutorial unchanged.
- **Board chalk**: hovering a target grows its dot into a ring (nothing else redraws); the click preview grows out of
  the selection and target rings. Fixed instant chalk strokes drawing only part of a circle (divide by zero).

## 0.5.1 — the lamp's UI, real tumbling, click-to-preview (2026-11-27)
- **UI v3 「램프 아래의 실험대」** (replaces v2): derived from the scene's own materials — walnut cases with brass inlay and
  corner guards, engraved brass nameplates, an ivory optical-bench ruler with a brass **rider** that glides to the item
  (lists, tiers, segmented settings), wax seals, chalk formulas on slate, a graph-paper lab notebook for the tutorial,
  glass microscope slides for problems, matted photographs for the codex. Warm = matter, cool strobe white = measured values.
  Hahmlet is the one typeface (Nanum Pen for chalk/ink). No mono, no all-caps labels, no fake numbering.
- **Loading**: six lathe-profile silhouettes are pushed onto a brass rail as the set loads, then a cradle ripple.
- **Physics**: pieces leaving the board become Rapier rigid bodies (convex hulls of the real meshes) — over the frame,
  onto the table, tumbling and rolling, wood-on-wood thuds; they stay until the next game. On the board: inertial lean
  and impact rocking (damped spring), friction settle to the rounded square, push-shaped slides.
- **Moves**: click a piece, click a target to preview (sketch 2.4× faster, no hover lag), click again to play.
- Tutorial Esc menu cannot leave the notebook (unless it was finished before).
- 衝 spin: mashing spins faster; every ten turns toggles the gradient; nothing persists.

## 0.5.0 — problem book, codex, UI v2 (2026-11-27)
- **당구 문제** — 100 problems in ten tiers (★1 프록시마 M … ★10 WR 104), mined by `tools/gen-puzzles.ts` from random
  billiard layouts and endgames and solved exhaustively by the engine (★10 up to 77,256 sequences, one answer).
  Seals accumulate with difficulty: 半 first-contact sketch · 速 Newtonian (lying) sketch · 盲 no sketch · 二/三 several
  moves · 宣 declare the whole sequence first, then run it · 敵 Black defends (mate in 1/2) · 一 one try, failure tears the
  sheet until tomorrow. The lamp colour temperature and the hum pitch rise with the tier. Solving shows the honest rarity.
  `tests/puzzles.test.ts` re-verifies every problem (solution, counts, no shorter solution, Newton traps, mate defence).
- **현상 도감** — 48 phenomena in six groups detected by a pure function (`src/content/codex.ts`, tested); each discovery
  is photographed from the live view, with formula, explanation, first sighting and count.
- **UI v2 「실험 기록지」** — after researching Zachtronics, Into the Breach, Balatro and Obra Dinn: square corners,
  hairlines and crop marks, IBM Plex Sans KR / Plex Mono / Noto Serif KR, one vermilion seal colour, numbered index menus
  with instant inversion, GSAP motion (short, firm; only seals slam). Chalk stays on the 3D board.
- Red Nebula studio intro (skippable; settings: every launch / first only).
- Settings: quality presets 자동(default)/최고/높음/중간/낮음, FPS line (off by default), sound, volume, aim, intro, reset.
- Tutorial step 00 「조작」: live checklist (click, drag, wheel, right-click) and the key map.
- Easter egg: click 衝 — it turns over in 3D; ten turns and it burns with a flowing gradient.

## 0.4.2 — performance pass (2026-11-27)
Measured at 1024×768 on the dev machine (synchronous render + GPU flush, 30-frame average):
idle 40 ms → 24 ms (and rendered at half rate while nothing moves), moving 40+ ms → 30 ms; triangles/frame 3M+ → 0.97M.
- Chess set geometry simplified offline to ~30 % (normal maps keep the detail; `?hipoly` loads the original).
- Shadow map re-rendered only when pieces move (the lamp is fixed).
- Glass pawn tops: transmission pass at half resolution (visually identical — it samples a roughness-blurred copy).
- Idle pacing: half frame rate when nothing moves and there is no input.
- Chalk: static tiled grain texture instead of a full-canvas erosion pass per redraw; redraw capped ~45 Hz.
- AI search moved to a Web Worker (hard AI no longer freezes the main thread for ~185 ms).
- Quality governor (last resort): only if frames stay above 33 ms while active — steps dpr 1.5 → glass ¼ → dpr 1.25 → shadow 1024 → dpr 1.
- `?perf` overlay: fps, frame time, draw calls, triangles, governor level.

## 0.4.1 — 光 pyramid (2026-11-27)
- 光 mode: Space / triangle button opens the light pyramid — the board dissolves into glass tiles that sink by
  their light delay from the King; enemy afterimages hang at the depth their light left them, with stalks to the present.

## 0.4.0 — 衝 (2026-11-27)
- Collision chess: captures replaced by exact 1D relativistic elastic collisions (c = 4 squares/turn,
  hyperbolic run-up), ring-outs, Newton's-cradle chains, knight stomp, physical check/mate.
- Full FIDE rules engine (castling, en passant, promotion, check, mate, stalemate, 50-move, threefold),
  verified by perft and a chess.js oracle.
- Khronos "A Beautiful Game" PBR set; night physics lab direction: lamp + dust cone, chalk aiming sketches,
  stroboscopic multi-exposure, rail camera slow motion, pitched clacks, heat glow, blackboard match log.
- Title sequence, POE "실험 노트" tutorial (7 engine-verified experiments), 光 advanced mode (light-delayed sight).

## 0.3.0 — 빛의 체스 (2026-11-27)
- Redesign as relativistic chess: standard chess + light at one square per move seen from the King.
- Blind shots (sliders stop at the first real piece), pawn miss/blocked, contact sightings, King capture wins.
- Afterimage view (what the enemy sees of you) and the light pyramid (board sinks into time).
- Fog-aware AI (3 levels) on its own belief board.
- New minimal UI, procedural chess pieces, 6-step forced tutorial.
- Master spec rewritten to v0.3; v0.2 game code removed (in git history).

## 0.2.1 — balance pass (2026-11-27)
- New courier action SKEW (rhythm delay) as counterplay to phase ambushes.
- AI L3: reactive + pre-emptive skews, ambush re-planning when the rhythm changes.
- Random per-match AI seed; in-game playtest log export (JSON) on the result screen.
- `tools/balance.ts` seeded harness; findings in `docs/PLAYTEST-LOG.md`.

## 0.2.0 — CAUSAL MATCH (2026-11-27)
- Playable 48 s / 24-round WEGO skirmish vs three AI levels; four engine-verified Causal Trials.
- Deterministic event engine: null intercepts on moving worldlines, proper-time calibration,
  majority/shared NEXUS, direct/relay/redundant routes, phase-pulse pilot interference.
- Fog = past light cone of the ORIGIN (one rule, one function, tested).
- Temporal prism with light-cone surface, worldlines, null lines, 0.8c possibility cones,
  CAUSAL LOCK markers; wave field for all observed pulses; post-match truth reveal.
- PHASE ECLIPSE designer with live phasor and predicted pilot ratio.
- Synthesized audio cues tied to events entering the light cone.

## 0.1.0 — M0 visual slice (previous session)
- Single arrival scenario, board/pieces sculpture, wave demo.
