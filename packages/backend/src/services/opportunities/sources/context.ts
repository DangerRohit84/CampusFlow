// opportunities/sources/context.ts — shared source constants (Track 4 C-3 split).
// WHY: UA/MAX_PAGES/PER_PAGE/GROQ_PLACEHOLDERS were module-globals in the
// 4.6k-line opportunityAgent.ts. One home, imported by every source fetcher.
// No behavior change: values are byte-identical to the originals.

import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'

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
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const html = await res.text()
    const stripped = html
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
    if (stripped.length > 100) scrapeCache.set(cacheKey, stripped)
    return stripped
  } catch (err) {
    logger.debug({ err, url }, '[sources] fetchPage6k failed (treated as empty)')
    return ''
  }
}
