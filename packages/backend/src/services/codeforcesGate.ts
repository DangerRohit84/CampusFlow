// packages/backend/src/services/codeforcesGate.ts
// Upgrade 1 — shared Codeforces rate gate + single jittered retry.
//
// WHY: Codeforces official API allows max 1 req / 2s globally per process.
// Over that → `FAILED, Call limit exceeded` (+ 429/503 under load).
// Our syncAllUsers batch-5 × 2 parallel fetches (contests + stats, each up
// to 2 CF calls) can burst well over that — the only production-outage risk
// in the sync path. Other platforms (LC ~20/10s, scrapes) are unaffected.
//
// WHAT:
// - Single process-wide gate: min 2s between CF call STARTS (not ends, so
//   fetch latency doesn't inflate the gap). Serialized via promise chain so
//   concurrent batch-5 callers queue instead of bursting.
// - One retry only: on HTTP 429/503 OR 200+FAILED/Call-limit body, wait
//   Retry-After (seconds or HTTP-date) else 2s, + 0-999ms jitter, then retry
//   once. Persistent limit → give up (return last result, no throw) so
//   syncEngine can record lastSyncError instead of masking.
// - No other platform is slowed: only CF fetch paths import this module.
//
// LIMITS (documented):
// - Process-local: N replicas each hold their own gate (2s per process, not
//   globally). Full global gate needs Redis/token-bucket — explicitly NOT
//   added at pilot scale (see sync-comparison.md §4).
// - pgbouncer/Neon pooled: gate is in-process, unaffected by DB pooler.

export const CODEFORCES_MIN_GAP_MS = 2000
export const CODEFORCES_MAX_RETRIES = 1
/** Jitter ceiling for the single retry (0..999ms added to base delay). */
export const CODEFORCES_RETRY_JITTER_MS = 1000
/** Cap Retry-After honoring so a malicious/huge header can't stall cron. */
export const CODEFORCES_RETRY_AFTER_CAP_MS = 10_000

// --- process-wide gate state (module singleton) ---
// Start far enough in the past that the very first acquire never waits.
let lastStartMs = -CODEFORCES_MIN_GAP_MS
let tail: Promise<void> = Promise.resolve()

/** Test-only: reset gate clock + queue. */
export function __resetCodeforcesGateForTests(): void {
  lastStartMs = -CODEFORCES_MIN_GAP_MS
  tail = Promise.resolve()
}

/** Test-only: inspect last start (ms epoch per injected clock). */
export function __getLastStartForTests(): number {
  return lastStartMs
}

export interface GateDeps {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

/**
 * Acquire a Codeforces slot: ensures >= CODEFORCES_MIN_GAP_MS since the
 * previous slot START. Concurrent callers serialize via promise chain.
 * The slot timestamp is recorded at START (before fetch) so fetch latency
 * doesn't inflate the 2s gap.
 */
export async function acquireCodeforcesSlot(deps: GateDeps = {}): Promise<void> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  let release!: () => void
  const prev = tail
  tail = new Promise<void>((r) => {
    release = r
  })
  await prev
  try {
    const elapsed = now() - lastStartMs
    const wait = CODEFORCES_MIN_GAP_MS - elapsed
    if (wait > 0) await sleep(wait)
    lastStartMs = now()
  } finally {
    release()
  }
}

// --- retry helpers (pure, unit-testable) ---

/** HTTP statuses that mean "back off and retry once". */
export function isRateLimitedStatus(status: number): boolean {
  return status === 429 || status === 503
}

/** CF FAILED body with call-limit comment (case-insensitive). */
export function isCallLimitExceededMessage(comment: unknown): boolean {
  if (typeof comment !== 'string') return false
  return /call limit exceeded/i.test(comment)
}

/**
 * Parse Retry-After header value (seconds or HTTP-date) → ms.
 * Accepts Headers instance or plain record. Returns null when missing/invalid.
 * Caps at CODEFORCES_RETRY_AFTER_CAP_MS.
 */
export function parseRetryAfterMs(
  headers: Headers | Record<string, string | null | undefined> | undefined | null
): number | null {
  if (!headers) return null
  let raw: string | null | undefined
  if (typeof (headers as Headers).get === 'function') {
    try {
      raw = (headers as Headers).get('retry-after')
    } catch {
      return null
    }
  } else {
    const rec = headers as Record<string, string | null | undefined>
    raw =
      rec['retry-after'] ??
      rec['Retry-After'] ??
      rec['RETRY-AFTER'] ??
      null
  }
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  // Seconds form: "2", "120"
  if (/^\d+$/.test(s)) {
    const ms = parseInt(s, 10) * 1000
    if (!Number.isFinite(ms) || ms < 0) return null
    return Math.min(ms, CODEFORCES_RETRY_AFTER_CAP_MS)
  }
  // HTTP-date form
  const t = Date.parse(s)
  if (Number.isFinite(t)) {
    const ms = t - Date.now()
    if (ms <= 0) return 0
    return Math.min(ms, CODEFORCES_RETRY_AFTER_CAP_MS)
  }
  return null
}

/** Extract retry hint from a CF FAILED comment like "... retry after 2 sec". */
export function parseRetryAfterFromComment(comment: unknown): number | null {
  if (typeof comment !== 'string') return null
  const m = comment.match(/retry\s+after\s+(\d+)\s*(ms|millis|s|sec|second)?/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 0) return null
  const unit = (m[2] || 's').toLowerCase()
  const ms = unit.startsWith('ms') || unit.startsWith('millis') ? n : n * 1000
  return Math.min(ms, CODEFORCES_RETRY_AFTER_CAP_MS)
}

/**
 * Single-retry delay: Retry-After (or 2s default) + 0..999ms jitter.
 * `rand` injectable for deterministic tests (default Math.random).
 */
export function getCodeforcesRetryDelayMs(
  retryAfterMs: number | null,
  rand: () => number = Math.random
): number {
  const base = retryAfterMs ?? CODEFORCES_MIN_GAP_MS
  let jitter = 0
  try {
    const r = rand()
    if (Number.isFinite(r) && r >= 0 && r < 1) jitter = Math.floor(r * CODEFORCES_RETRY_JITTER_MS)
  } catch {
    jitter = 0
  }
  return base + jitter
}

// --- gated JSON fetch (gate + single retry, shared by contests + stats) ---

export interface CodeforcesFetchDeps {
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Override gate (tests inject no-op to assert retry without 2s waits). */
  acquire?: (deps?: GateDeps) => Promise<void>
  now?: () => number
}

export interface CodeforcesJsonResult<T> {
  /** Parsed JSON body (null when unparsable / network threw — caller treats as empty). */
  data: T | null
  /** HTTP status of the FINAL attempt (0 when fetch threw). */
  status: number
  /** Final response headers (undefined when fetch threw). */
  headers?: Headers
  /** Total attempts used (1 or 2). */
  attempts: number
  /** True when a retry was performed. */
  retried: boolean
  /** True when the final result is still rate-limited (persistent limit → give up). */
  stillRateLimited: boolean
}

function buildTimeoutInit(timeoutMs: number, extra?: RequestInit): RequestInit {
  // Fresh AbortSignal per attempt: reusing a timed-out signal would abort the
  // retry immediately. Extra init (headers etc.) is preserved.
  return { ...(extra || {}), signal: AbortSignal.timeout(timeoutMs) }
}

/**
 * Fetch a Codeforces JSON endpoint through the shared 2s gate with ONE
 * jittered retry on 429/503 or FAILED/Call-limit body.
 *
 * Never throws on rate-limit: persistent limit returns { stillRateLimited:true }
 * after exactly 2 attempts. Network throws are swallowed to null (callers
 * already treat empty as skip + log) — EXCEPT the attempts count stays 1.
 */
export async function fetchCodeforcesJson<T>(
  url: string,
  opts: { timeoutMs: number; headers?: Record<string, string>; init?: RequestInit } ,
  deps: CodeforcesFetchDeps = {}
): Promise<CodeforcesJsonResult<T>> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch
  const sleep = deps.sleep ?? defaultSleep
  const random = deps.random ?? Math.random
  const acquire = deps.acquire ?? acquireCodeforcesSlot

  const doFetch = async (): Promise<{ status: number; headers?: Headers; data: T | null }> => {
    const resp = await fetchFn(url, {
      ...buildTimeoutInit(opts.timeoutMs, opts.init),
      ...(opts.headers ? { headers: opts.headers } : {}),
    } as RequestInit)
    const status = (resp as Response).status ?? 0
    const headers = (resp as Response).headers as Headers | undefined
    let data: T | null = null
    try {
      data = (await (resp as Response).json()) as T
    } catch {
      data = null
    }
    return { status, headers, data }
  }

  // --- attempt 1 (gated) ---
  await acquire()
  let first: { status: number; headers?: Headers; data: T | null }
  try {
    first = await doFetch()
  } catch {
    return { data: null, status: 0, headers: undefined, attempts: 1, retried: false, stillRateLimited: false }
  }

  const firstRateLimitedByStatus = isRateLimitedStatus(first.status)
  const firstFailedBody =
    (first.data as any)?.status === 'FAILED' &&
    isCallLimitExceededMessage((first.data as any)?.comment)
  if (!firstRateLimitedByStatus && !firstFailedBody) {
    return { ...first, attempts: 1, retried: false, stillRateLimited: false }
  }

  // --- single retry: honor Retry-After (header, else comment hint, else 2s) + jitter ---
  const headerMs = parseRetryAfterMs(first.headers)
  const commentMs =
    headerMs == null && (first.data as any)?.comment
      ? parseRetryAfterFromComment((first.data as any).comment)
      : null
  const delay = getCodeforcesRetryDelayMs(headerMs ?? commentMs, random)
  await sleep(delay)

  await acquire()
  try {
    const second = await doFetch()
    const secondRateLimitedByStatus = isRateLimitedStatus(second.status)
    const secondFailedBody =
      (second.data as any)?.status === 'FAILED' &&
      isCallLimitExceededMessage((second.data as any)?.comment)
    return {
      ...second,
      attempts: 2,
      retried: true,
      stillRateLimited: secondRateLimitedByStatus || secondFailedBody,
    }
  } catch {
    return { data: null, status: 0, headers: undefined, attempts: 2, retried: true, stillRateLimited: false }
  }
}
