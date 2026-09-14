import { useQuery, keepPreviousData } from '@tanstack/react-query'
import api from '../lib/api'
import { qk } from '../lib/queryKeys'

export interface FetchSettingRow {
  platform: string
  type: string
  enabled?: boolean
  fetchLimit?: number
}

/**
 * Shared fetch-settings reference-data hook (prod burst fix).
 *
 * WHY: every PlatformCard (10 per FetchPage) + OtherSourcesCards ran its own
 * uncached `api.get('/fetch/settings/all')` in a mount `useEffect` — 12
 * identical GETs per visit (×2 under StrictMode dev), each a
 * PlatformSettings.findMany round-trip. Settings change only via explicit
 * SUPER_ADMIN limit PUTs, so one shared RQ key with 60s staleTime (mirroring
 * the backend 60s settings cache) serves all cards from a single trip.
 * Simultaneous same-key mounts dedupe to 1 GET (see Layout badge pattern).
 *
 * Behavior identical: same `{ settings }` rows; cards keep local limit state
 * (PUT responses update it immediately), so the 60s staleness never shows
 * stale UI after the user's own edit.
 */
export function useFetchSettings(options?: { enabled?: boolean }) {
  return useQuery<{ settings: FetchSettingRow[] }>({
    queryKey: qk.fetchSettings(),
    queryFn: ({ signal }) => api.get('/fetch/settings/all', { signal }).then((r) => r.data as { settings: FetchSettingRow[] }),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? true,
  })
}

/** Find one platform+type row in a settings payload (same match as before). */
export function findFetchSetting(
  settings: FetchSettingRow[] | undefined,
  platform: string,
  type: 'hackathons' | 'internships',
): FetchSettingRow | undefined {
  if (!Array.isArray(settings)) return undefined
  const want = type === 'hackathons' ? 'HACKATHON' : 'INTERNSHIP'
  return settings.find((s) => s.platform === platform && s.type === want)
}
