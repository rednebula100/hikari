// The opponent thinks off the main thread so the lab never stutters while it calculates.
import { choose, rng, type Level } from './ai'
import type { Mode, Pos } from './rules'

self.onmessage = (e: MessageEvent<{ id: number; pos: Pos; mode: Mode; level: Level; seed: number; history: string[] }>) => {
  const { id, pos, mode, level, seed, history } = e.data
  const move = choose(pos, mode, level, rng(seed), history)
  ;(self as unknown as Worker).postMessage({ id, move })
}
