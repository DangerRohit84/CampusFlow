// opportunities/sources/context.ts — shared source constants (Track 4 C-3 split).
// WHY: UA/MAX_PAGES/PER_PAGE/GROQ_PLACEHOLDERS were module-globals in the
// 4.6k-line opportunityAgent.ts. One home, imported by every source fetcher.
// No behavior change: values are byte-identical to the originals.

import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import {
  conditionalHeaders,
  contentHash,
  getPageFetchState,
  setPageFetchState,
  validatorsFromHeaders,
} from '../fetchState'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const MAX_PAGES = 10
export const PER_PAGE = 18 // for Unstop

export const GROQ_PLACEHOLDERS = new Set([
  'your-groq-api-key-here',
  'your_groq_api_key_here',
  'placeholder',
])

/**
 * Fetch a page and return the first 6000 chars of stripped text (verbatim move
 * from opportunityAgent.ts). Shared by search extractors, reskilll, dorahacks,
 * hackerearth, hack2skill fallbacks and enrich stages. AbortSignal timeout
 * preserved; failures return '' (callers treat as no-content, never throw).
 *
 * MEDIUM 2026-09-10 search-entities fix (safe parts only): decode dash/rupee
 * entities before stripping (old `.replace(/&[a-z]+;/gi,' ')` lost `&ndash;`
 * ranges and `&#8377;` rupee, same vector as text.ts stripHtml). `&amp;` stays
 * space (existing `stripHtml('<h3>Hi</h3>  &amp; bye') === 'Hi bye'` contract —
 * changing to `&` breaks opportunity-pure.test.ts, so NOT done as unsafe).
 * 6k window cap unchanged (expanding globally risks cache bloat + mining-behavior
 * change — documented skip in fix-parser-mediums report).
 */
export async function fetchPage6k(url: string): Promise<string> {
  const cacheKey = `page6k:${url}`
  const cached = scrapeCache.get<string>(cacheKey)
  if (cached) return cached
  try {
    await validateExternalUrl(url)
  } catch {
    return ''
  }
  // P1-3 conditional fetch (Layer A): send stored validators so unchanged
  // pages cost a 304 (0 bytes) instead of a full HTML download. Fail-open at
  // every step (validator errors → unconditional fetch, old behavior).
  let cond: Record<string, string> = {}
  try {
    cond = conditionalHeaders(await getPageFetchState(url))
  } catch {}
  const doFetch = async (extra: Record<string, string>): Promise<Response> => {
    return fetch(url, { headers: { 'User-Agent': UA, ...extra }, signal: AbortSignal.timeout(15000) })
  }
  const strip6k = (html: string): string => {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/&#8377;|&#x20B9;|&#X20B9;/g, '₹')
      .replace(/&#8211;|&#8212;|&#45;/g, '-')
      .replace(/&(ndash|mdash|minus|hyphen);/gi, '-')
      .replace(/&(rupee|Rs);/gi, '₹')
      .replace(/&#x27;|&#39;|&apos;/gi, "'")
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 6000)
  }
  const recordState = async (headers: Headers | null, stripped: string): Promise<void> => {
    try {
      const v = validatorsFromHeaders(headers as unknown as { get?: (name: string) => string | null })
      await setPageFetchState(url, { etag: v.etag, lastModified: v.lastModified, contentHash: contentHash(stripped), at: Date.now() })
    } catch {}
  }
  try {
    const res = await doFetch(cond)
    // 304 with a warm local entry: serve it (0 bytes over the wire). Cold
    // cache on 304 → unconditional refetch below (fail-open, never empty).
    if (res.status === 304) {
      const warm = scrapeCache.get<string>(cacheKey)
      if (warm) return warm
      const res2 = await doFetch({})
      if (!res2.ok) return ''
      const html2 = await res2.text()
      const stripped2 = strip6k(html2)
      if (stripped2.length > 100) scrapeCache.set(cacheKey, stripped2)
      await recordState(res2.headers ?? null, stripped2)
      return stripped2
    }
    if (!res.ok) return ''
    const html = await res.text()
    const stripped = strip6k(html)
    if (stripped.length > 100) scrapeCache.set(cacheKey, stripped)
    await recordState(res.headers ?? null, stripped)
    return stripped
  } catch (err) {
    logger.debug({ err, url }, '[sources] fetchPage6k failed (treated as empty)')
    return ''
  }
}
