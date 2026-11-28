// Accounts: Firebase Auth (Google or guest) + Firestore profile. Loaded lazily — offline players never download it.
// The web config is public by design (security lives in firestore.rules and the server's token check); it comes
// from VITE_FIREBASE_* at build time (GitHub Actions variables FIREBASE_*).
import type { User } from 'firebase/auth'

const env = import.meta.env
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}
export const accountsConfigured = () => !!(config.apiKey && config.authDomain && config.projectId && config.appId)

/** What the rest of the game needs to know about the signed-in player. */
export interface Profile { uid: string; name: string; guest: boolean; rating: number; games: number; provisional: boolean }
type Listener = (p: Profile | null) => void

let sdk: Promise<typeof import('./firebase-sdk')> | null = null
const load = () => (sdk ??= import('./firebase-sdk').then(m => { m.init(config as { apiKey: string; authDomain: string; projectId: string; appId: string }); return m }))

const listeners = new Set<Listener>()
let current: Profile | null = null
let watching = false

async function watch() {
  if (watching || !accountsConfigured()) return
  watching = true
  const m = await load()
  m.onUser(async (u: User | null) => {
    current = u ? await m.ensureProfile(u) : null
    listeners.forEach(f => f(current))
  })
}

/** Subscribes to sign-in changes (starts the SDK on first use). */
export function onAccount(f: Listener) { listeners.add(f); f(current); void watch(); return () => { listeners.delete(f) } }
export const account = () => current

export async function signInGoogle() { const m = await load(); await m.signInGoogle() }
export async function signInGuest() { const m = await load(); await m.signInGuest() }
export async function signOut() { const m = await load(); await m.signOut() }
export async function rename(name: string) { const m = await load(); if (current) current = await m.rename(current, name); listeners.forEach(f => f(current)) }
export async function leaderboard() { return accountsConfigured() ? (await load()).leaderboard() : [] }
/** Re-reads the profile (after a ranked game the server has changed the rating). */
export async function refreshProfile() { const m = await load(); const u = m.currentUser(); if (u) { current = await m.ensureProfile(u); listeners.forEach(f => f(current)) } }
/** A fresh ID token for the game server (null when signed out or not configured). */
export async function idToken(): Promise<string | null> { if (!accountsConfigured() || !current) return null; return (await load()).idToken() }
