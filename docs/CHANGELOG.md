# Changelog

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
