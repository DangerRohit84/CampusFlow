import { QueryClient } from '@tanstack/react-query'

// 429-aware retry: never retry rate-limited requests (retrying a 429
// hammers the limiter further — the exact storm behind "Too many requests").
// All other errors keep 1 retry (transient blips). Pages with explicit
// `retry: 1` (AdminOpportunitiesPage) should use retryUnlessRateLimited too.
export function retryUnlessRateLimited(failureCount: number, error: unknown): boolean {
  const status = (error as any)?.response?.status ?? (error as any)?.status
  if (status === 429) return false
  return failureCount < 1
}

// High-scale: Vercel/Notion SWR + keepPreviousData pattern — stale-while-revalidate on client mirrors CDN SWR on server
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000, // 3 min — like Vercel ISR revalidate window
      gcTime: 10 * 60 * 1000,
      retry: retryUnlessRateLimited,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // keepPreviousData avoids flash-of-loading when paginating (Shopify/GitHub style instant nav)
      // individual queries can override with `placeholderData: keepPreviousData`
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
    },
  },
})
