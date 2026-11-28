// Firebase Admin: verifies players' ID tokens and (later) writes ratings to Firestore, bypassing client rules.
// Configure with FIREBASE_SERVICE_ACCOUNT = the service-account JSON (Render secret env var, one line).
// Without it the server still runs; everyone is a guest.
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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

export interface Player { uid: string | null; name: string; guest: boolean }

/** Turns a client's ID token into a player. Missing/invalid token → anonymous guest (never throws). */
export async function playerFrom(token: unknown): Promise<Player> {
  if (!firebase || typeof token !== 'string' || !token) return { uid: null, name: '손님', guest: true }
  try {
    const t = await firebase.auth.verifyIdToken(token)
    const snap = await firebase.db.doc('users/' + t.uid).get()
    return { uid: t.uid, name: (snap.get('name') as string | undefined) ?? '이름 없음', guest: t.firebase.sign_in_provider === 'anonymous' }
  } catch {
    return { uid: null, name: '손님', guest: true }
  }
}
