# 光

> 당신이 보는 모든 것은 과거이고, 당신의 명령은 미래에 도착한다.

A simultaneous-turn strategy game where the speed of light is the only rule.
Two command cores fight over three NEXUS nodes on an 8×8 board where every order,
every sighting and every data packet travels at **c = 1 square/second**.

**Play:** https://rednebula100.github.io/hikari/ (desktop, mouse & keyboard)

## What makes it different

- **You only ever see your past light cone.** Pieces are drawn where their light
  left them; the farther away, the older. Your plans are gold ghosts.
- **TEMPORAL PRISM** (`2` / `Space`): the board unfolds along a time axis. Every
  solid piece sits on the cone of light arriving at your core; worldlines, orders
  and packets are light-like lines; enemy possibility regions are 0.8c cones.
- **Proper time matters.** Couriers calibrate on their own clock — the fastest
  arrival is not the fastest *ready* time.
- **Phase eclipse.** A PHASER can annihilate an enemy data packet at its receiver
  with an anti-phase pulse — if amplitude, timing and phase are all right.
- **CAUSAL LOCK.** A proven (not estimated) bound on when the enemy can possibly
  contest each NEXUS.

## Modes

- **Causal Trials I–IV** — engine-verified puzzles (first light, two clocks, majority, the silent receiver).
- **Skirmish** — 48 s / 24 rounds vs. three AI levels that see exactly what you see.

## Controls

Click a unit, click a node to add a MOVE · right-click undo · `1 2 3` views ·
`Space` unfold time · `Enter` transmit & run · `Q/E` scrub · `Ctrl+Z/Y` · `Tab` next unit.

## Develop

```
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # physics, engine, information isolation, trial solutions, AI determinism
npm run build
npx tsx tools/selfplay.ts   # AI-vs-AI diagnostics
```

Architecture: `src/game` is a headless deterministic event engine (truth),
`knowledge.ts` is the only bridge to UI/AI (past-light-cone filter),
`src/render` draws only that knowledge. See `HIKARI-MASTER-SPEC.md` and
`docs/DESIGN-DECISIONS.md`.
