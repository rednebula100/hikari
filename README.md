# 光 — 빛의 체스

> 체스의 규칙은 그대로. 단 하나 — 빛은 한 수에 한 칸만 간다.

**Play:** https://rednebula100.github.io/hikari/ (desktop, mouse & keyboard)

## Rules in 30 seconds

1. It is chess. Same pieces, same moves. **Capture the enemy King to win** (there is no check — you may not see it coming).
2. **You see from your King, and light travels one square per move.** An enemy piece far away is shown as it was a few moves ago (the small number = how many enemy moves old).
3. You choose moves on the board you *see*; they resolve on the board that *is*. A rook fired into the fog stops at the first real piece — sometimes capturing something you never saw. A pawn attacking an empty square misses.

## What's new about it

- **King = eye.** Advance your King to see clearly; it also walks into danger.
- **Shooting into the past.** Long moves are blind shots that detect and capture hidden pieces.
- **Afterimage (`E`).** The enemy sees *your* past. See what they currently believe, and bluff with it.
- **Light pyramid (`Space`).** The board sinks into time around your King: the farther a square, the deeper in the past you see it.

First launch runs a 6-step interactive tutorial.

## Develop

```
npm install
npm run dev
npm test                       # rules, light-cone visibility, blind shots, afterimage, AI, tutorial solvability
npx tsx tools/stats.ts 10      # bot-vs-bot health check
npm run build
```

- `src/chess/game.ts` — authoritative engine + per-side `view()` (the only thing UI/AI see)
- `src/chess/ai.ts` — opponent searching its own belief board (3 levels)
- `src/chess/tutorial.ts` — lessons
- `src/render/` — Three.js board, procedural pieces, light pyramid
- `src/lab/physics.ts` — the v0.1 continuous relativity model, kept for research

Design: `HIKARI-MASTER-SPEC.md` (v0.3), decisions in `docs/DESIGN-DECISIONS.md`.
