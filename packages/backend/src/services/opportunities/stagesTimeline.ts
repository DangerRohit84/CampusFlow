// opportunities/stagesTimeline.ts — timeline fallback (SRP extract from stages.ts).
// WHY: 70-line Timeline-range fallback was inline in enrichHackathonStaging.
// Pure helper over page text; no DB/AI. Behavior identical.
import { parseSearchDate } from '../../utils/search'
import { logger } from '../../utils/logger'

export interface TimelineFallback {
  startDate?: Date
  endDate?: Date
}

/**
 * Infer start/end from Timeline range ("25 Aug 26 - 25 Sep 26") or single dates
 * near the Timeline keyword. Returns Dates only when parseable.
 */
export function extractTimelineFallback(allContent: string, recordTitle?: string): TimelineFallback {
  const out: TimelineFallback = {}
  if (!allContent || allContent.length <= 100) return out
  try {
    const lower = allContent.toLowerCase()
    const timelineIdx = lower.indexOf('timeline')
    const windowText = timelineIdx !== -1
      ? allContent.slice(Math.max(0, timelineIdx - 200), timelineIdx + 800)
      : allContent.slice(0, 2000)
    const rangeRegex = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\s*(?:[-–]|to)\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/gi
    const rangeMatch = rangeRegex.exec(windowText)
    if (rangeMatch) {
      const startIso = parseSearchDate(rangeMatch[1])
      const endIso = parseSearchDate(rangeMatch[2])
      if (startIso) {
        const d = new Date(startIso)
        if (!isNaN(d.getTime())) {
          out.startDate = d
          if (recordTitle) logger.info(`[Enrichment] Timeline fallback startDate ${startIso} for ${recordTitle} (from Timeline range)`)
        }
      }
      if (endIso) {
        const d = new Date(endIso)
        if (!isNaN(d.getTime())) {
          out.endDate = d
          if (recordTitle) logger.info(`[Enrichment] Timeline fallback endDate ${endIso} for ${recordTitle} (from Timeline range)`)
        }
      }
      return out
    }
    const singleDateRegex = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi
    const dates: string[] = []
    let m: RegExpExecArray | null
    while ((m = singleDateRegex.exec(windowText)) !== null) {
      const iso = parseSearchDate(m[1])
      if (iso) dates.push(iso)
      if (dates.length >= 5) break
    }
    if (dates.length > 0) {
      const iso = dates[0]
      const d = new Date(iso)
      if (!isNaN(d.getTime())) {
        out.startDate = d
        if (recordTitle) logger.info(`[Enrichment] Timeline fallback single startDate ${iso} for ${recordTitle} (near Timeline)`)
      }
    }
    if (dates.length > 1) {
      const iso = dates[dates.length - 1]
      const d = new Date(iso)
      if (!isNaN(d.getTime())) {
        out.endDate = d
        if (recordTitle) logger.info(`[Enrichment] Timeline fallback single endDate ${iso} for ${recordTitle} (near Timeline)`)
      }
    }
  } catch (err) {
    logger.debug({ err }, '[enrich] extractTimelineFallback failed (treated as empty)')
  }
  return out
}
