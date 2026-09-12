// lib/lifecycle.ts — frontend singleton inventory + teardown (I-3 fix).
// WHY: queryClient + socket + authStore-persist + caches diverged between tabs
// and leaked between tests. Factories for new code, singletons for compat,
// explicit teardown for tests. No behavior change.

import { QueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { getSocket, disconnectSocket } from './socket';
import { logger } from './logger';

export const SINGLETONS = ['queryClient', 'socket', 'authStore.persist', 'scrapeCaches'] as const;

/** Factory for isolated QueryClients (tests, micro-frontends). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 3 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        networkMode: 'offlineFirst',
      },
      mutations: { retry: 0 },
    },
  });
}

/** Teardown for tests (clear RQ cache + disconnect socket). */
export function teardownSingletonsForTests(): void {
  try {
    queryClient.clear();
  } catch (err) {
    logger.debug('queryClient clear failed (non-fatal)', { err });
  }
  try {
    const s = getSocket();
    if (s) disconnectSocket();
  } catch (err) {
    logger.debug('socket teardown failed (non-fatal)', { err });
  }
}
