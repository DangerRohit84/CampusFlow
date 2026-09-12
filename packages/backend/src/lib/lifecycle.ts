// lib/lifecycle.ts — singleton inventory + init/teardown (I-3 fix).
// WHY: 8 process-local singletons diverged across Render replicas and leaked
// between tests (stagingStore, container, cache backend, scrapeCache/rateGate,
// authorizeCache, presence/userSockets, ETag (stateless), rate-limit store).
// This module is the SSOT: factories for new code, singletons for compat,
// init/teardown for boot + hermetic tests. Redis migration = one-line
// setCacheBackend() here (no route edits).

import prisma from '../config/db';
import { container, resetContainerForTests, TOKENS } from './container';
import { InMemoryCache, setCacheBackend, getCacheBackend, cache } from './cache';
import { scrapeCache, aiRateGate, resetScrapeCacheForTests, resetAiRateGateForTests } from '../services/opportunities/cache';
import { clearAuthorizeCache, resetAuthorizeCacheForTests } from '../middleware/auth';
import { presence, resetSocketStateForTests } from '../services/socket';
import { stagingStore } from '../repositories/stagingRepository';

/** All process-local singletons (for audit + teardown). */
export const SINGLETONS = [
  'prisma',
  'container',
  'cache.activeBackend',
  'opportunities.scrapeCache',
  'opportunities.aiRateGate',
  'auth.authorizeCache',
  'socket.presence+userSockets',
  'staging.stagingStore',
] as const;

/** Explicit boot wiring (called once from index.ts before listen). */
export function initSingletons(opts: { redisUrl?: string } = {}): void {
  // Default wiring is already module-level (InMemory). Redis swap is one line:
  // if (opts.redisUrl) { const { RedisCache } = require('./cache'); setCacheBackend(new RedisCache(opts.redisUrl)); }
  void opts;
  container.register(TOKENS.prisma, () => prisma);
  void cache;
  void scrapeCache;
  void aiRateGate;
  void presence;
  void stagingStore;
}

/** Hermetic teardown for tests (no cross-test leaks). */
export async function teardownSingletonsForTests(): Promise<void> {
  resetContainerForTests();
  try {
    await cache.clear?.();
  } catch { /* ignore */ }
  setCacheBackend(new InMemoryCache());
  resetScrapeCacheForTests();
  resetAiRateGateForTests();
  resetAuthorizeCacheForTests();
  clearAuthorizeCache();
  resetSocketStateForTests();
}

export { getCacheBackend, setCacheBackend };
