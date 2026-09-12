// opportunities/cache.ts — explicit cache + rate-gate factories (I-6 fix).
// WHY: module-global `scrapeCache` + `aiRateLimitedUntil` diverged across
// replicas and polluted tests. Factories allow explicit init/teardown + DI;
// default singletons preserved for compat (import { scrapeCache }).

import NodeCache from 'node-cache'

export class RateLimitGate {
  private until = 0
  constructor(private cooldownMs = 60_000) {}
  isLimited(now = Date.now()): boolean {
    return now < this.until
  }
  markLimited(now = Date.now()): void {
    this.until = now + this.cooldownMs
  }
  reset(): void {
    this.until = 0
  }
  get retryAfterMs(): number {
    return Math.max(0, this.until - Date.now())
  }
}

export function createScrapeCache(stdTTL = 6 * 60 * 60): NodeCache {
  return new NodeCache({ stdTTL })
}

/** Default process-local singletons (compat). Prefer DI in new code. */
export const scrapeCache = createScrapeCache()
export const aiRateGate = new RateLimitGate(60_000)

export function isAiGloballyRateLimited(): boolean {
  return aiRateGate.isLimited()
}
export function markAiRateLimited(): void {
  aiRateGate.markLimited()
}
export function resetAiRateGateForTests(): void {
  aiRateGate.reset()
}
export function resetScrapeCacheForTests(): void {
  try {
    scrapeCache.flushAll()
  } catch { /* ignore */ }
}
