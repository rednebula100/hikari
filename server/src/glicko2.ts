// Glicko-2 (Mark Glickman, "Example of the Glicko-2 system", 2013). One rating period = one game.
export interface Rating { rating: number; rd: number; vol: number }
export const NEW_PLAYER: Rating = { rating: 1500, rd: 350, vol: 0.06 }
export const PROVISIONAL_RD = 110

const SCALE = 173.7178, TAU = 0.5, EPS = 1e-6

/**
 * @param me the player's rating before the period
 * @param games opponents' ratings and the scores against them (1 win, .5 draw, 0 loss)
 */
export function update(me: Rating, games: { opp: Rating; score: number }[]): Rating {
  const mu = (me.rating - 1500) / SCALE, phi = me.rd / SCALE, sigma = me.vol
  if (!games.length) {
    // no games: only the deviation grows
    const phiStar = Math.sqrt(phi * phi + sigma * sigma)
    return { rating: me.rating, rd: Math.min(350, phiStar * SCALE), vol: sigma }
  }
  const g = (p: number) => 1 / Math.sqrt(1 + 3 * p * p / (Math.PI * Math.PI))
  const E = (m: number, mj: number, pj: number) => 1 / (1 + Math.exp(-g(pj) * (m - mj)))
  let vInv = 0, deltaSum = 0
  for (const { opp, score } of games) {
    const mj = (opp.rating - 1500) / SCALE, pj = opp.rd / SCALE, e = E(mu, mj, pj), gj = g(pj)
    vInv += gj * gj * e * (1 - e)
    deltaSum += gj * (score - e)
  }
  const v = 1 / vInv, delta = v * deltaSum
  // new volatility: Illinois algorithm on f(x)
  const a = Math.log(sigma * sigma)
  const f = (x: number) => {
    const ex = Math.exp(x)
    return ex * (delta * delta - phi * phi - v - ex) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU)
  }
  let A = a, B: number
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v)
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU }
  let fA = f(A), fB = f(B)
  while (Math.abs(B - A) > EPS) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C)
    if (fC * fB <= 0) { A = B; fA = fB } else fA /= 2
    B = C; fB = fC
  }
  const sigmaNew = Math.exp(A / 2)
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew)
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const muNew = mu + phiNew * phiNew * deltaSum
  return { rating: muNew * SCALE + 1500, rd: Math.max(30, Math.min(350, phiNew * SCALE)), vol: sigmaNew }
}
