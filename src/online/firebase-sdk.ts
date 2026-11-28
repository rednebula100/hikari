// The only module that imports the Firebase SDK (kept in its own lazy chunk by account.ts).
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  GoogleAuthProvider, browserLocalPersistence, getAuth, linkWithPopup, onAuthStateChanged, setPersistence,
  signInAnonymously, signInWithPopup, signOut as fbSignOut, type Auth, type User,
} from 'firebase/auth'
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import type { Profile } from './account'

let app: FirebaseApp, auth: Auth, db: Firestore

export function init(config: { apiKey: string; authDomain: string; projectId: string; appId: string }) {
  app = initializeApp(config)
  auth = getAuth(app)
  auth.languageCode = 'ko'
  void setPersistence(auth, browserLocalPersistence)
  db = getFirestore(app)
}

export const onUser = (f: (u: User | null) => void) => onAuthStateChanged(auth, f)

export async function signInGoogle() {
  const provider = new GoogleAuthProvider()
  // a guest who signs in with Google keeps the same uid (and history) by linking
  if (auth.currentUser?.isAnonymous) {
    try { await linkWithPopup(auth.currentUser, provider); await auth.currentUser.reload(); return } catch (e) {
      // the Google account already exists: switch to it (the guest record stays behind)
      if ((e as { code?: string }).code !== 'auth/credential-already-in-use') throw e
    }
  }
  await signInWithPopup(auth, provider)
}
export async function signInGuest() { await signInAnonymously(auth) }
export async function signOut() { await fbSignOut(auth) }
export async function idToken() { return auth.currentUser ? auth.currentUser.getIdToken() : null }

const cleanName = (s: string) => s.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16)

/** users/{uid}: the public profile. Rating fields are written only by the game server (see firestore.rules). */
export async function ensureProfile(u: User): Promise<Profile> {
  const ref = doc(db, 'users', u.uid), snap = await getDoc(ref)
  if (!snap.exists()) {
    const name = cleanName(u.displayName ?? '') || '손님' + u.uid.slice(0, 4)
    await setDoc(ref, { name, createdAt: serverTimestamp() })
    return { uid: u.uid, name, guest: u.isAnonymous, rating: 1500, games: 0 }
  }
  const d = snap.data()
  return { uid: u.uid, name: d.name ?? '이름 없음', guest: u.isAnonymous, rating: d.rating ?? 1500, games: d.games ?? 0 }
}

export async function rename(p: Profile, name: string): Promise<Profile> {
  const n = cleanName(name)
  if (!n) return p
  await updateDoc(doc(db, 'users', p.uid), { name: n })
  return { ...p, name: n }
}
