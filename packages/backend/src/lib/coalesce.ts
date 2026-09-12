// lib/coalesce.ts — generic coalescing-cache factory (I-6 SSOT).
// WHY: platformFetchers.fetchInflight + platformStats.statsCache + aiRateGate
// each hand-rolled the same TTL + in-flight dedup. One factory, injectable,
// with explicit `clear()` for tests and no cross-replica claims.

export interface Coalesced<T> {
  promise: Promise<T>
  expiry: number
}

export class CoalescingCache<T> {
  private inflight = new Map<string, Coalesced<T>>()
  constructor(private ttlMs = 60_000) {}

  get(key: string): Promise<T> | null {
    const e = this.inflight.get(key)
    if (!e) return null
    if (Date.now() < e.expiry) return e.promise
    this.inflight.delete(key)
    return null
  }

  set(key: string, promise: Promise<T>): void {
    this.inflight.set(key, { promise, expiry: Date.now() + this.ttlMs })
    promise.finally(() => {
      setTimeout(() => {
        const cur = this.inflight.get(key)
        if (cur && cur.promise === promise && Date.now() >= cur.expiry) this.inflight.delete(key)
      }, this.ttlMs).unref?.()
    }).catch(() => { /* cache must never throw */ })
  }

  clear(): void {
    this.inflight.clear()
  }

  get size(): number {
    return this.inflight.size
  }
}

export function cacheKey(platform: string, handle: string): string {
  return `${String(platform || '').toLowerCase()}:${String(handle || '').trim().toLowerCase()}`
}
