# Design decisions

## v0.4 — 衝 (2026-11-27)

### K1. Captures become collisions
Research (docs/PLAN-v0.4.md) found push-off variants (Dynamo, Falling Off) proven fun but none with real
mass/momentum physics. 衝 resolves every capture as an exact 1D collision along the move's line (all pieces on
that line take part), simulated event-by-event for one turn, then snapped to squares.

### K2. c = 4 squares/turn and a hyperbolic run-up
With c = 8 relativity changed almost no outcome on an 8×8 board (largest difference 7.44 vs 7.60 squares).
At c = 4 with constant proper acceleration (γ = 1 + aL/c², a = 1.46) speed saturates below c while momentum keeps
growing; e.g. queen 7-square run → pawn: Newton 8.1 squares, relativistic 3.8. Relativity now decides outcomes.

### K3. Knights stomp
The only orthodox capture left: a vertical, perfectly inelastic impact (kinetic energy → heat, shown as glow).

### K4. Physical check
Check = the opponent has a move that removes your King. Legality, mate and stalemate follow FIDE with that
definition; castling transit squares use orthodox attack geometry.

### K5. 光 stays as an advanced mode
v0.3's light-delayed sight is layered on 衝: intentions are chosen on the believed board, resolved on the true
one; no check rules there (check may be invisible); King removal wins.

### K6. Direction
Night physics lab (strobe photography × chalk × air-track). Every animation replays the engine's event list.

---

## v0.3 — Relativistic Chess (2026-11-27, user direction)

### C1. Chess first
The user wanted a chess game and found v0.2 hard to understand. v0.3 keeps standard
chess (8×8 squares, standard moves, auto-queen promotion; no castling / en passant yet)
and adds exactly one physical rule. Win = capture the King (check cannot be announced
because it may be invisible).

### C2. One rule: light moves one square (Chebyshev) per ply, observed at the King
Discrete light cone as in cellular automata (Game of Life, c = 1 cell/generation).
Adjacent squares are live; a square d away is seen d−1 plies late. Computed exactly over
the King's whole worldline (`observe()` in `src/chess/game.ts`), tested against the cone.

### C3. Own army is linked; contact reveals
Own piece positions/losses are known instantly (command link) — a deliberate abstraction
so players never lose track of their own army. Pieces that touch yours (captures, a pawn
blocked by a hidden piece) are seen at that instant.

### C4. Choose on belief, resolve on truth
Moves are legal if legal on your own view (own pieces block). Sliders stop at the first
real piece and capture it ("intercept"); blind pawn diagonals can miss; pawn pushes can
be blocked. This turns long moves into probes — the main tactical novelty.

### C5. Afterimage
Your opponent sees your past. The `E` view computes their knowledge of you from the
enemy King trajectory you have seen (frozen after its last sighting) — honest, and the
basis for bluffing.

### C6. UI
Indie-game minimal: title with two buttons (시작 / 튜토리얼; 시작 routes to the tutorial
until it is completed), one status pill, three icon tools, capture trays. No panels.

### C7. Removed from v0.2
NEXUS scoring, Courier/Relay/Phaser, phase interference, simultaneous turns, 9×9 vertices.
The continuous physics module remains in `src/lab/` for the research track (spec Part IV/VI).

---

# v0.2 decisions (archived)


Changes against `HIKARI-MASTER-SPEC.md` v0.1.x, with reasons. Every rule below is
implemented in `src/game/` and covered by `tests/`.

## D1. Observation = the past light cone (replaces 1 s telemetry sampling, §9.1–9.2)

A team knows an event **iff** it lies inside the past light cone of its ORIGIN:
`t_e + |r_e − O| / c ≤ t`. Unit images are the retarded positions
(`s + |r(s) − O| = t`, solved exactly by bisection on a strictly monotone function).

*Why:* one geometric rule replaces telemetry periods, ACK messages and sensor radii.
It is physically honest (the ORIGIN literally sees light), it is visible (in the
TIME view every solid piece sits on the cone surface), and the information
boundary is enforced in exactly one function (`knowledge()`), which the UI and AI
are the only consumers of. Own-unit ACKs fall out for free: you see your courier
start moving when that light reaches you.

Enemy command flashes are visible (you see that ORIGIN II transmitted) but their
contents (target unit/actions) are stripped.

## D2. Tie at a NEXUS = SHARED, not frozen (resolves the §15.1 deadlock risk)

Majority of calibrated couriers controls. With equal non-zero counts the NEXUS is
**shared**: it keeps producing and sends one copy to each ORIGIN.

*Why:* AI self-play showed the spec's "contested = nothing" rule makes the symmetric
opening a permanent 0:0 standoff (moving away costs ~10 s of travel + calibration,
so staying is rational for both). Shared production removes the freeze while keeping
contesting meaningful (it denies the opponent's *relative* gain), and it moves the
duel into the wave layer: shared packets are perfectly predictable targets for a
PHASE ambush. An incumbency rule was tried first and rejected (same deadlock).

## D3. PULSE takes an absolute fire time (`at`), phase in 15° steps

The PHASER holds until `at`, fires if calibrated (cooldown 3 s proper) and the order
arrived in time; otherwise logs `pulse-fail (late|cooldown)`.

*Why:* data arrival times are continuous (calibration runs on proper time), so 45°
steps (spec §10.3) leave up to 22.5° unavoidable error, which at realistic amplitude
ratios makes eclipses fail for reasons the player cannot control. 15° keeps the
puzzle exact-but-fair. Absolute `at` makes the timing reasoning legible.

## D4. Majority rule replaces "support units cannot contest"

Only calibrated, resting couriers count. Relays and phasers never affect control.

## D5. Route policy captured at order time

`ROUTE(relay|redundant)` carries `via` — the relay's node in the player's own plan
at order time (the NEXUS never queries the relay's hidden current position, §10.2).
A relay that is not resting there for the whole window ⇒ `data-fail (relay-absent)`.

## D6. CAUSAL LOCK is a theorem, shown everywhere

`earliestContest(u, node) = max(seenAt + d/0.8c, calibration bound)` where the
calibration bound uses the visible readiness and `τ ≤ t`. It is a true lower bound
on every possible enemy order (tested against all speed tiers). The HUD shows
`LOCK +x` on each NEXUS; production finished before the lock cannot be shared.

## D7. AI

Same `Knowledge` as the player plus a replay of its own orders (own motion is
deterministic). Levels: 1 nexus-greedy; 2 marginal score-difference valuation +
CAUSAL LOCK + phase ambush on observed production rhythm; 3 adds redundant relay
routing after it observes its own eclipsed packets and reads enemy trajectories.
Seeded temperament (mulberry32) prevents identical matches; same seed ⇒ same game.

## D8. Visual

The board dissolves into a precise frame in the TIME view so the past cone below
the present is visible. Worldlines, null lines and packets are screen-space fat
lines with additive blending (light adds). Own plan = gold translucent ghosts.

## D9. SKEW — rhythm counterplay (0.2.1)

A courier on a producing NEXUS may delay its next packet by 0.5/1/1.5 s. Bot data
showed a PHASER reading a perfectly periodic stream was near-unanswerable (0.65
eclipses/pulse; the redundant route costs 33 % production). SKEW is cheap, costs
real production time, and turns jamming into an information duel: the change is
only visible to the jammer after the light delay. See `docs/PLAYTEST-LOG.md`.

## Open

- Balance numbers (5 s calibration, 3 s production, amplitude set) are hypotheses
  validated only by bot self-play (`tools/selfplay.ts`), not by human playtests.
- Conditional orders (§7.3), LAB mode, replay export and Lorentz inspector are not
  implemented yet.
