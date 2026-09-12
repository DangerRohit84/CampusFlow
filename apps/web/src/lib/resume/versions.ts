// lib/resume/versions.ts — localStorage-versioned resume snapshots.
// DECISION (documented): snapshots live in localStorage, NOT the backend.
// - No ResumeVersion model exists in prisma schema; adding one needs a
//   migration + auth scoping + retention policy (out of task scope, risky).
// - The studio is already offline-first (saveResume/loadResume in localStorage
//   with 800ms debounce); versions ride the same store, work without API.
// - Quota-safe: originalAsset.dataUrl is stripped when >500KB (same rule as
//   resumeStorage.saveResume) so 20 snapshots never blow the 5MB budget.
// - Cap 20 newest-first; each entry is a full ResumeData clone (restore = set).
// Pure + tested via injectable StorageLike (node tests use memory store).

import type { ResumeData } from '../../types/resume'

export type ResumeVersion = {
  id: string
  label: string
  createdAt: string
  data: ResumeData
}

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const MAX_VERSIONS = 20

function versionsKey(userId: string): string {
  return `campusflow:resume:versions:${userId || 'default'}`
}

function defaultStore(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage as StorageLike
  } catch { /* non-browser */ }
  return null
}

function safeParse(raw: string | null): ResumeVersion[] {
  if (!raw) return []
  try {
    const j = JSON.parse(raw)
    if (!Array.isArray(j)) return []
    return j.filter((v: any) => v && typeof v.id === 'string' && v.data && typeof v.data === 'object')
  } catch {
    return []
  }
}

/** Strip heavy originalAsset dataUrl so snapshots stay quota-safe. */
export function stripHeavyAsset(data: ResumeData): ResumeData {
  const url = (data as any)?.originalAsset?.dataUrl
  if (typeof url === 'string' && url.length > 500_000) {
    return { ...data, originalAsset: { ...(data as any).originalAsset, dataUrl: '', storedInDB: true } }
  }
  return data
}

export function listVersions(userId: string, store?: StorageLike | null): ResumeVersion[] {
  const s = store === undefined ? defaultStore() : store
  if (!s) return []
  try {
    return safeParse(s.getItem(versionsKey(userId)))
  } catch {
    return []
  }
}

export function saveVersion(userId: string, data: ResumeData, label?: string, store?: StorageLike | null): ResumeVersion {
  const s = store === undefined ? defaultStore() : store
  const version: ResumeVersion = {
    id: `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: String(label || '').trim() || `Snapshot ${new Date().toLocaleString()}`,
    createdAt: new Date().toISOString(),
    data: JSON.parse(JSON.stringify(stripHeavyAsset(data))),
  }
  if (!s) return version
  try {
    const existing = safeParse(s.getItem(versionsKey(userId)))
    const next = [version, ...existing].slice(0, MAX_VERSIONS)
    s.setItem(versionsKey(userId), JSON.stringify(next))
  } catch { /* quota/denied — version still returned for session use */ }
  return version
}

/** Returns the snapshot's ResumeData clone, or null when missing. */
export function restoreVersion(userId: string, versionId: string, store?: StorageLike | null): ResumeData | null {
  const found = listVersions(userId, store).find((v) => v.id === versionId)
  if (!found) return null
  return JSON.parse(JSON.stringify(found.data)) as ResumeData
}

export function deleteVersion(userId: string, versionId: string, store?: StorageLike | null): ResumeVersion[] {
  const s = store === undefined ? defaultStore() : store
  if (!s) return []
  const next = listVersions(userId, s).filter((v) => v.id !== versionId)
  try {
    s.setItem(versionsKey(userId), JSON.stringify(next))
  } catch { /* ignore */ }
  return next
}

export function clearVersions(userId: string, store?: StorageLike | null): void {
  const s = store === undefined ? defaultStore() : store
  try {
    s?.removeItem(versionsKey(userId))
  } catch { /* ignore */ }
}

/** In-memory store for tests / SSR. */
export function createMemoryStore(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    dump: () => Object.fromEntries(map.entries()),
  }
}
