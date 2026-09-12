// lib/api/groq.ts — per-user Groq key (I-9 fix: no localStorage scan, env-first).
// WHY: getUserGroqKey() scanned ALL localStorage keys containing 'groq' +
// 4 hardcoded names, then sent as X-GROQ-API-KEY (XSS-exfilable, fragile).
// New contract: single explicit key name, sessionStorage-first (tab-scoped),
// backend proxy preferred (never expose third-party keys beyond one write).
// Behavior: same get/set/clear surface; scanning fallback REMOVED.

const GROQ_KEY_NAME = 'campusflow:groq-key'
const LEGACY_GROQ_KEYS = ['campusflow-groq-api-key', 'groq-api-key', 'campusflow:groq-api-key'] as const

function readEnvGroqKey(): string | null {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GROQ_API_KEY
    if (v && String(v).trim().length > 10) return String(v).trim()
  } catch { /* env unavailable */ }
  return null
}

export function getUserGroqKey(): string | null {
  // 1) Explicit session key (tab-scoped, preferred for XSS containment).
  try {
    const s = sessionStorage.getItem(GROQ_KEY_NAME)
    if (s && String(s).trim().length > 10) return String(s).trim()
  } catch { /* ignore */ }
  // 2) Explicit local key (persisted opt-in).
  try {
    const v = localStorage.getItem(GROQ_KEY_NAME)
    if (v && String(v).trim().length > 10) return String(v).trim()
  } catch { /* ignore */ }
  // 3) One-time legacy migration (no scan): check known names once, migrate.
  try {
    for (const k of LEGACY_GROQ_KEYS) {
      const v = localStorage.getItem(k)
      if (v && String(v).trim().length > 10) {
        const trimmed = String(v).trim()
        try { sessionStorage.setItem(GROQ_KEY_NAME, trimmed) } catch { /* ignore */ }
        return trimmed
      }
    }
  } catch { /* ignore */ }
  // 4) Build-time env (dev/preview only; prod uses backend proxy).
  return readEnvGroqKey()
}

export function setUserGroqKey(key: string): void {
  const trimmed = String(key || '').trim()
  if (!trimmed) { clearUserGroqKey(); return }
  try { sessionStorage.setItem(GROQ_KEY_NAME, trimmed) } catch { /* ignore */ }
  try { localStorage.setItem(GROQ_KEY_NAME, trimmed) } catch { /* ignore */ }
}

export function clearUserGroqKey(): void {
  try { sessionStorage.removeItem(GROQ_KEY_NAME) } catch { /* ignore */ }
  try {
    localStorage.removeItem(GROQ_KEY_NAME)
    for (const k of LEGACY_GROQ_KEYS) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

/** Backend-proxy header (prefer server-side Groq; client key only as fallback). */
export function groqHeader(): Record<string, string> {
  const k = getUserGroqKey()
  return k ? { 'X-GROQ-API-KEY': k } : {}
}
