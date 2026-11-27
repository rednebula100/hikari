// Local persistence (versioned keys under chung:*). Every access survives private mode / quota errors.
import type { Quality } from '../render/stage'

const get = (k: string) => { try { return localStorage.getItem('chung:' + k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem('chung:' + k, v) } catch { /* private mode or full */ } }
function json<T>(k: string, fallback: T): T { try { const v = get(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback } catch { return fallback } }

export const store = { get, set, del(k: string) { try { localStorage.removeItem('chung:' + k) } catch { /* */ } } }

// ── settings ─────────────────────────────────────────────────────────────
export interface Settings { quality: Quality; fps: boolean; muted: boolean; volume: number; aim: boolean; intro: 'always' | 'first' }
const DEFAULTS: Settings = { quality: 'auto', fps: false, muted: false, volume: .8, aim: true, intro: 'always' }
export function loadSettings(): Settings {
  const s = json<Settings>('v1:settings', DEFAULTS)
  // carry over v0.4 keys
  if (get('muted') === '1' && !get('v1:settings')) s.muted = true
  if (get('aim') === '0' && !get('v1:settings')) s.aim = false
  if (new URLSearchParams(location.search).has('perf')) s.fps = true
  return s
}
export const saveSettings = (s: Settings) => set('v1:settings', JSON.stringify(s))

// ── problem book progress ────────────────────────────────────────────────
export interface PRec { solved?: number; tries: number; first?: boolean; img?: string; torn?: string }
export type Progress = Record<number, PRec>
export const loadBook = (): Progress => json<Progress>('v1:book', {})
export const saveBook = (p: Progress) => set('v1:book', JSON.stringify(p))

// ── codex ────────────────────────────────────────────────────────────────
export interface CRec { t: number; n: number; img?: string; where?: string }
export type CodexState = Record<string, CRec>
export const loadCodex = (): CodexState => json<CodexState>('v1:codex', {})
export function saveCodex(c: CodexState) {
  try { localStorage.setItem('chung:v1:codex', JSON.stringify(c)) }
  catch { // out of space: drop the oldest photographs first
    const ids = Object.keys(c).filter(k => c[k].img).sort((a, b) => c[a].t - c[b].t)
    for (const id of ids.slice(0, Math.ceil(ids.length / 3))) delete c[id].img
    set('v1:codex', JSON.stringify(c))
  }
}
export const today = () => new Date().toISOString().slice(0, 10)
