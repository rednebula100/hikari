# 衝

> 잡지 마라. 부딪쳐라.

Chess, with one change: **captures become collisions.** Pieces have mass, a run-up gives momentum, and the
outcome is a real one-dimensional relativistic elastic collision. Whatever leaves the board is gone; knock the
enemy King off to win. Nothing moves faster than light (c = 4 squares per turn).

**Play:** https://rednebula100.github.io/hikari/ (desktop, mouse & keyboard)

## Rules in 30 seconds

1. Pieces move exactly like chess — castling, en passant, promotion, check, mate, stalemate (FIDE, verified against chess.js).
2. Instead of capturing, you **collide**. Heavy hits light → light flies; equal masses → the struck one takes all the speed (Newton's cradle); light hits heavy → bounces back. Masses: pawn 1, knight 3, bishop 3, rook 5, queen 9, king 10.
3. **Off the board = removed.** Check means your King could be knocked off next move. The knight alone stomps from above (inelastic — the square glows with heat).

Hover a target before you commit: the engine's exact result is sketched in chalk on the board.

## Modes
- **衝** — collision chess vs AI (easy / normal / hard)
- **光** (advanced) — 衝 + light-delayed sight: you see from your King, light moves one square per move, distant enemies are afterimages; moves resolve on the real board
- **클래식** — orthodox chess
- **실험 노트** — 7-experiment predict–observe–explain tutorial (forced on first run)

## Direction
A night physics lab: one incandescent lamp, chalk on the board, a stroboscope that photographs every collision,
a blackboard that writes up the match. See `HIKARI-MASTER-SPEC.md` Part II.

## Develop
```
npm install
npm run dev
npm test        # perft + chess.js oracle, collision conservation laws, 衝/光 rules, tutorial answers
npm run build
npx tsx tools/clash-stats.ts 4   # bot health check
```

Credits: chess set "A Beautiful Game" © 2020 ASWF (MaterialX Project), glTF © 2022 Ed Mackey — CC BY 4.0
(KhronosGroup/glTF-Sample-Assets). See `docs/ASSET-LICENSES.md`.
