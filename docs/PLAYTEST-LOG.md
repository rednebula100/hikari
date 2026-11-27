# Playtest & balance log

## 2026-11-27 — v0.3 bot health check (`npx tsx tools/stats.ts 10`)
| White vs Black AI | W/B/D | avg plies | intercepts/game |
|---|---|---|---|
| L1 vs L1 | 4/3/3 | 78 | 0.3 |
| L2 vs L1 | 8/1/1 | 93 | 0.4 |
| L1 vs L2 | 1/9/0 | 68 | 0.4 |
| L2 vs L2 | 0/0/10 | 200 (limit) | 0.0 |
| L3 vs L2 | 2/0/8 | 174 | 0.1 |
| L3 vs L3 | 3/1/6 | 146 | 0.1 |

Levels separate; equal AIs play cautiously into the 200-ply draw. Bots rarely use blind
shots (they search their belief board), so fog tactics are mostly a human edge — to be
watched in human playtests. Sections below concern the archived v0.2 design.


Bot results are **not** evidence of fun; they find degenerate rules and dead
mechanics. Human sessions are recorded with the in-game **기록 저장** button on the
result screen (JSON: rules, build, seed, both sides' orders, events, per-round
planning time, time spent in the TEMPORAL / WAVE views, undo count). Nothing leaves
the browser unless you send the file.

## 2026-11-27 — bot harness (`npx tsx tools/balance.ts [seeds|sweep|ties]`)

Environment: Windows 11, Node 22.19, build 0.2.0 → 0.2.1. Seeded AI-vs-AI, 48 s skirmish.

### Baseline (0.2.0, 20 seeds × 9 pairings = 180 games)
| Finding | Data |
|---|---|
| Side fairness | mirrored pairings symmetric (e.g. B2vR1 20/0, B1vR2 0/20) |
| Speed tiers | analytic optimum by distance: ≤2 GU → 0.4c, 2.5–4 → 0.6c, ≥4.5 → 0.8c (each tier has a niche) |
| Phaser dominance | 0.65 eclipses per pulse; one phaser could cancel a whole 3 s stream |
| Counterplay | redundant route (4.5 s period) cost more than it saved: L3 ≈ L2 |
| NEXUS time | exclusive 30 %, shared 39 %, empty 30 % |
| Draws | 59/180, almost all mirror pairings |

### Changes (0.2.1)
- **SKEW** action (courier on a producing NEXUS delays the next packet 0.5/1/1.5 s).
  The jammer only learns of it after the light delay, so it buys ~2 packets of safety.
- AI L3 skews after an eclipse or after seeing an enemy pulse aimed at its core, and
  re-plans its own ambush when the observed rhythm stops matching.
- Per-match random AI seed (recorded in the log).

### After (10 seeds per pairing)
| Pairing | W/L/D | Avg score |
|---|---|---|
| L2 vs L1 | 10/0/0 | 21.5–16.5 |
| L3 vs L2 | 3/0/7 | 18.9–18.4 |
| L2 vs L3 | 0/2/8 | 18.4–18.9 |
| L3 vs L3 | 2/1/7 | 18.1–18.0 |

Eclipses per pulse 0.57 → 0.45. Cooldown sweep 3/4/5 s changed results by <1 point
once SKEW existed, so the spec value (3 s) is kept (Trial IV depends on it).
A "first to reach the final score" tie-break would have split only 3/28 mirror
draws, so no tie-break was added (spec §6.3).

### Open questions for human sessions
- Is the eclipse designer too easy now that it auto-aligns the fire time? (watch
  planning time on pulse rounds)
- Does anyone use 0.4c or relay routes outside trials?
- Is the TEMPORAL view used during planning (telemetry `timeViewMs`)?
- Round count: are 24 planning phases too many? (watch `planMs` per round)
