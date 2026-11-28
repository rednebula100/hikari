// Firebase Admin: verifies players' ID tokens and writes ratings/matches to Firestore, bypassing client rules.
// Configure with FIREBASE_SERVICE_ACCOUNT = the service-account JSON (Render secret env var, one line).
// Without it the server still runs: tokens are not checked (everyone is a guest) and ratings live in memory
// (RANKED_DEV=1 additionally lets such guests play ranked, for local testing).
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { NEW_PLAYER, PROVISIONAL_RD, update, type Rating } from './glicko2.ts'

function boot() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    const app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId: sa.project_id })
    return { auth: getAuth(app), db: getFirestore(app), projectId: sa.project_id as string }
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT is set but unusable:', e instanceof Error ? e.message : e)
    return null
  }
}
export const firebase = boot()
export const DEV_RANKED = !firebase && process.env.RANKED_DEV === '1'

export interface Player extends Rating { uid: string | null; name: string; guest: boolean; games: number }
const guestPlayer = (): Player => ({ uid: null, name: '손님', guest: true, games: 0, ...NEW_PLAYER })
const memory = new Map<string, Rating & { games: number }>() // dev ratings when Firestore is not configured

/** Turns a client's ID token into a player. Missing/invalid token → anonymous guest (never throws). */
export async function playerFrom(token: unknown, devName?: string): Promise<Player> {
  if (!firebase) {
    if (!DEV_RANKED || typeof devName !== 'string' || !devName) return guestPlayer()
    const uid = 'dev-' + devName.replace(/[^\w가-힣]/g, '').slice(0, 12), r = memory.get(uid) ?? { ...NEW_PLAYER, games: 0 }
    return { uid, name: devName.slice(0, 16), guest: false, ...r }
  }
  if (typeof token !== 'string' || !token) return guestPlayer()
  try {
    const t = await firebase.auth.verifyIdToken(token)
    const snap = await firebase.db.doc('users/' + t.uid).get()
    const d = snap.data() ?? {}
    return {
      uid: t.uid, name: (d.name as string | undefined) ?? '이름 없음', guest: t.firebase.sign_in_provider === 'anonymous',
      rating: d.rating ?? NEW_PLAYER.rating, rd: d.rd ?? NEW_PLAYER.rd, vol: d.vol ?? NEW_PLAYER.vol, games: d.games ?? 0,
    }
  } catch {
    return guestPlayer()
  }
}

export type Result = '1-0' | '0-1' | '1/2-1/2'
export interface MatchRecord {
  id: string; tc: string; result: Result; reason: string; moves: string[]; startedAt: number; endedAt: number
  white: Player; black: Player
}
export interface RatingChange { before: number; after: number; delta: number; provisional: boolean }

/** Applies a finished game: Glicko-2 for both, the match record, per-player tallies. Atomic in Firestore. */
export async function recordGame(m: MatchRecord): Promise<{ w: RatingChange; b: RatingChange }> {
  const sw = m.result === '1-0' ? 1 : m.result === '0-1' ? 0 : .5
  const compute = (me: Rating, opp: Rating, score: number) => update(me, [{ opp, score }])
  const change = (a: Rating, b: Rating): RatingChange => ({ before: Math.round(a.rating), after: Math.round(b.rating), delta: Math.round(b.rating) - Math.round(a.rating), provisional: b.rd > PROVISIONAL_RD })
  const tally = (score: number) => ({ wins: score === 1 ? 1 : 0, losses: score === 0 ? 1 : 0, draws: score === .5 ? 1 : 0 })

  if (!firebase) {
    const rw = memory.get(m.white.uid ?? '') ?? m.white, rb = memory.get(m.black.uid ?? '') ?? m.black
    const nw = compute(rw, rb, sw), nb = compute(rb, rw, 1 - sw)
    if (m.white.uid) memory.set(m.white.uid, { ...nw, games: (m.white.games ?? 0) + 1 })
    if (m.black.uid) memory.set(m.black.uid, { ...nb, games: (m.black.games ?? 0) + 1 })
    return { w: change(rw, nw), b: change(rb, nb) }
  }

  const db = firebase.db, wRef = db.doc('users/' + m.white.uid), bRef = db.doc('users/' + m.black.uid)
  return db.runTransaction(async tx => {
    const [ws, bs] = await Promise.all([tx.get(wRef), tx.get(bRef)])
    const cur = (d: FirebaseFirestore.DocumentData | undefined): Rating => ({ rating: d?.rating ?? NEW_PLAYER.rating, rd: d?.rd ?? NEW_PLAYER.rd, vol: d?.vol ?? NEW_PLAYER.vol })
    const rw = cur(ws.data()), rb = cur(bs.data()), nw = compute(rw, rb, sw), nb = compute(rb, rw, 1 - sw)
    const res = { w: change(rw, nw), b: change(rb, nb) }
    const write = (ref: FirebaseFirestore.DocumentReference, p: Player, n: Rating, score: number) => {
      const t = tally(score)
      tx.set(ref, {
        rating: n.rating, rd: n.rd, vol: n.vol, guest: p.guest, games: FieldValue.increment(1),
        wins: FieldValue.increment(t.wins), losses: FieldValue.increment(t.losses), draws: FieldValue.increment(t.draws),
        lastGame: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    write(wRef, m.white, nw, sw); write(bRef, m.black, nb, 1 - sw)
    const side = (p: Player, c: RatingChange) => ({ uid: p.uid, name: p.name, guest: p.guest, before: c.before, after: c.after })
    tx.set(db.doc('matches/' + m.id), {
      tc: m.tc, result: m.result, reason: m.reason, moves: m.moves, plies: m.moves.length,
      white: side(m.white, res.w), black: side(m.black, res.b), players: [m.white.uid, m.black.uid],
      startedAt: new Date(m.startedAt), endedAt: new Date(m.endedAt),
    })
    return res
  })
}

/** Aborted games leave a short record (no rating change) so abuse can be spotted later. */
export async function recordAbort(m: Omit<MatchRecord, 'result'>) {
  if (!firebase) return
  await firebase.db.doc('matches/' + m.id).set({
    tc: m.tc, result: 'aborted', reason: m.reason, moves: m.moves, plies: m.moves.length,
    white: { uid: m.white.uid, name: m.white.name }, black: { uid: m.black.uid, name: m.black.name }, players: [m.white.uid, m.black.uid],
    startedAt: new Date(m.startedAt), endedAt: new Date(m.endedAt),
  }).catch(() => {})
}
