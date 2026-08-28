import { QueryClient } from '@tanstack/react-query'

// High-scale: Vercel/Notion SWR + keepPreviousData pattern — stale-while-revalidate on client mirrors CDN SWR on server
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000, // 3 min — like Vercel ISR revalidate window
      gcTime: 10 * 60 * 1000,
      retry: 1,
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
