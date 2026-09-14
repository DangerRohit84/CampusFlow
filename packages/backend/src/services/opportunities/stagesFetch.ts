// opportunities/stagesFetch.ts — shared enrich fetch + AI-JSON parse (SRP extract).
// WHY: stages.ts duplicated multi-page fetch (223-260 vs 691-721) and JSON
// parse (468-476 vs 817-825). One home, imported by both enrich paths.
// AbortSignal timeouts + scrapeCache + withRetry semantics preserved.
// Enrich page routing comes from the registry SSOT (1-file adds).

import { logger } from '../../utils/logger'
import { scrapeCache } from './cache'
import { UA, fetchPage6k } from './sources/context'
import { getEnrichPagesForRecord } from './registry'
import {
  conditionalHeaders,
  contentHash,
  getPageFetchState,
  setPageFetchState,
  validatorsFromHeaders,
} from './fetchState'

export { fetchPage6k }

/** Parse the first {...} JSON block from an AI response (null when absent/invalid). */
export function parseAiJson<T = Record<string, unknown>>(responseText: string): T | null {
  if (!responseText) return null
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    return JSON.parse(jsonMatch[0]) as T
  } catch {
    return null
  }
}

async function fetchOnePage(url: string): Promise<string> {
  try {
    const cached = scrapeCache.get<string>(url)
    if (cached) {
      logger.info(`[Cache HIT] ${url}`)
      return cached
    }
    // P1-3 conditional fetch (Layer A, same contract as fetchPage6k):
    // stored validators → 304 serves the warm entry with 0 bytes; cold
    // cache on 304 → unconditional refetch (fail-open, never empty).
    let cond: Record<string, string> = {}
    try {
      cond = conditionalHeaders(await getPageFetchState(url))
    } catch {}
    const stripPage = (html: string): string => {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 6000)
    }
    const doFetch = async (extra: Record<string, string>): Promise<Response> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        return await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': UA, ...extra },
        })
      } finally {
        clearTimeout(timeout)
      }
    }
    const response = await doFetch(cond)
    if (response.status === 304) {
      const warm = scrapeCache.get<string>(url)
      if (warm) {
        logger.info(`[Cache HIT] ${url} (304 revalidated)`)
        return warm
      }
      const response2 = await doFetch({})
      if (!response2.ok) return ''
      const html2 = await response2.text()
      const content2 = stripPage(html2)
      if (content2.length > 100) scrapeCache.set(url, content2)
      try {
        const v2 = validatorsFromHeaders(response2.headers as unknown as { get?: (name: string) => string | null })
        await setPageFetchState(url, { etag: v2.etag, lastModified: v2.lastModified, contentHash: contentHash(content2), at: Date.now() })
      } catch {}
      return content2
    }
    if (!response.ok) return ''
    const html = await response.text()
    const content = stripPage(html)
    if (content.length > 100) scrapeCache.set(url, content)
    try {
      const v = validatorsFromHeaders(response.headers as unknown as { get?: (name: string) => string | null })
      await setPageFetchState(url, { etag: v.etag, lastModified: v.lastModified, contentHash: contentHash(content), at: Date.now() })
    } catch {}
    return content
  } catch (err) {
    logger.debug({ err, url }, '[enrich] fetchOnePage failed (treated as empty)')
    return ''
  }
}

/**
 * Fetch overview + platform sub-pages for enrich (shared by hackathon/internship).
 * Returns joined content with per-page headers. Never throws (empty on failure).
 */
export async function fetchPagesForEnrich(recordUrl: string, source: string, titleForLog?: string): Promise<string> {
  if (!recordUrl) return ''
  try {
    const baseUrl = recordUrl.replace(/\/$/, '')
    const pagesToFetch = getEnrichPagesForRecord(source, recordUrl)
    const results = await Promise.allSettled(pagesToFetch.map((p) => fetchOnePage(p ? `${baseUrl}${p}` : baseUrl)))
    const pageContents = results
      .map((r, i) => {
        if (r.status === 'fulfilled' && r.value.length > 100) {
          const pageName = pagesToFetch[i] || 'overview'
          return `\n--- ${pageName.toUpperCase()} PAGE ---\n${r.value}`
        }
        return ''
      })
      .filter(Boolean)
    const allContent = pageContents.join('\n')
    if (titleForLog) logger.info(`[Enrichment] Fetched ${pageContents.length} pages for ${titleForLog} (${allContent.length} chars)`)
    return allContent
  } catch (err) {
    logger.debug({ err, recordUrl }, '[enrich] fetchPagesForEnrich failed (treated as empty)')
    return ''
  }
}

/** Fetch a single URL for enrich (internship path). Cache-aware, never throws. */
export async function fetchSinglePageForEnrich(recordUrl: string): Promise<string> {
  if (!recordUrl) return ''
  const cached = scrapeCache.get<string>(recordUrl)
  if (cached) {
    logger.info(`[Cache HIT] ${recordUrl}`)
    return cached
  }
  const content = await fetchOnePage(recordUrl)
  return content
}
