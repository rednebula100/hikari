// Server-authoritative chess clock (Fischer increment). Pure and deterministic: the caller passes `now`,
// so the same class runs in rooms, in tests and in replays. Ranked play will own one per match.
export type Side = 'w' | 'b'
export interface ClockState { w: number; b: number; turn: Side; running: boolean; flagged: Side | null }

export class ChessClock {
  private left: Record<Side, number>
  private turn: Side = 'w'
  private since: number | null = null
  private flagged: Side | null = null

  /** @param baseMs starting time per side  @param incMs added after each completed move */
  constructor(readonly baseMs: number, readonly incMs = 0) {
    this.left = { w: baseMs, b: baseMs }
  }

  /** Starts (or resumes) the side to move's clock at `at` (may be in the future: a grace period before it runs). */
  start(at: number) { if (this.since === null && !this.flagged) this.since = at }
  /** Stops without charging anything more (the move was already settled by press). */
  hold() { this.since = null }
  get running() { return this.since !== null && !this.flagged }
  get toMove() { return this.turn }
  /** Stops both clocks (disconnect grace, adjudication). */
  pause(now: number) { this.settle(now); this.since = null }

  /** The side to move finished a move at `now`. Returns false if it had already flagged. */
  press(side: Side, now: number): boolean {
    if (side !== this.turn || this.flagged) return false
    this.settle(now)
    if (this.flagged) return false
    this.left[side] += this.incMs
    this.turn = side === 'w' ? 'b' : 'w'
    if (this.since !== null) this.since = now
    return true
  }

  /** Remaining time at `now` (does not mutate). */
  remaining(side: Side, now: number): number {
    const run = this.since !== null && side === this.turn && !this.flagged ? Math.max(0, now - this.since) : 0
    return Math.max(0, this.left[side] - run)
  }

  /** Checks for a flag fall at `now`; returns the side that ran out, if any. */
  tick(now: number): Side | null { this.settle(now); return this.flagged }

  snapshot(now: number): ClockState {
    return { w: this.remaining('w', now), b: this.remaining('b', now), turn: this.turn, running: this.since !== null && !this.flagged, flagged: this.flagged }
  }

  private settle(now: number) {
    if (this.since === null || this.flagged) return
    const side = this.turn, spent = Math.max(0, now - this.since)
    this.left[side] -= spent; this.since = Math.max(now, this.since)
    if (this.left[side] <= 0) { this.left[side] = 0; this.flagged = side; this.since = null }
  }
}

/** Time controls offered for ranked play (minutes + increment seconds). */
export const TIME_CONTROLS = [
  { id: '3+2', baseMs: 3 * 60_000, incMs: 2_000 },
  { id: '5+3', baseMs: 5 * 60_000, incMs: 3_000 },
  { id: '10+5', baseMs: 10 * 60_000, incMs: 5_000 },
] as const
