// opportunities/stages.ts — enrich pipeline stages (thin orchestrator + compat barrel).
// WHY: was a 865-line god (deadline grounding + multi-page fetch + AI prompts +
// timeline fallback + hackathon/internship enrich in one file). SRP split:
//   stagesDeadline.ts — pure deadline grounding (generate/find/is*)
//   stagesFetch.ts    — shared fetchPagesForEnrich + parseAiJson (deduped)
//   stagesPrompt.ts   — AI prompt builders (pure)
//   stagesTimeline.ts — Timeline-range fallback (pure)
// This file keeps ONLY the two enrich orchestrators (DB + AI wiring) plus
// compat re-exports so existing imports keep working. AbortSignal/withRetry
// preserved; enrich page routing via registry SSOT (1-file adds).
import prisma from '../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../utils/search'
import { isAiRateLimitError, toAiIssueMessage } from '../../ai/client'
import { validateExternalUrl } from '../../utils/secureUrl'
import { logger } from '../../utils/logger'
import { scrapeCache } from './cache'
import { contentHash, getEnrichContentHash, setEnrichContentHash, shouldSkipEnrichForContent } from './fetchState'
import { enrichmentCompletion } from '../aiCache'
import type { NormalizedOpportunity } from './types'
import { hasValue } from './types'
import { stripHtml, isGenericTitle } from './text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from './dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from './reputation'
import { AiRateLimitError, isRateLimitError, buildAiIssue, isGroqKeySet, isEnrichmentAIDisabled } from './errors'
import { aiExtractSingleHackathon, aiExtractSingleInternship } from './sources/searchExtract'
import { fetchPage6k } from './sources/context'
import { UA } from './sources/context'
import { fetchHack2SkillRegistrationEnd } from './sources/hack2skill'
import {
  generateDeadlineVariants,
  findDeadlineVariantIndex,
  findAllDeadlineIndices,
  isDeadlineLikelyBeginDate,
  isAiDeadlineGrounded,
  isAiDeadlineHighTrust,
  toIstDeadline,
} from './stagesDeadline'
import { fetchPagesForEnrich, fetchSinglePageForEnrich, parseAiJson } from './stagesFetch'
import { buildHackathonEnrichPrompt, buildInternshipEnrichPrompt } from './stagesPrompt'
import { extractTimelineFallback } from './stagesTimeline'

// Compat re-exports: existing deep importers (`from './stages'`) keep working.
// New code SHOULD import from the focused module directly.
export {
  generateDeadlineVariants,
  findDeadlineVariantIndex,
  findAllDeadlineIndices,
  isDeadlineLikelyBeginDate,
  isAiDeadlineGrounded,
  isAiDeadlineHighTrust,
  toIstDeadline,
} from './stagesDeadline'
export { fetchPagesForEnrich, fetchSinglePageForEnrich, parseAiJson, fetchPage6k as fetchPage6kShared } from './stagesFetch'
export { buildHackathonEnrichPrompt, buildInternshipEnrichPrompt } from './stagesPrompt'
export { extractTimelineFallback } from './stagesTimeline'
export type { TimelineFallback } from './stagesTimeline'

// Deadline grounding lives in ./stagesDeadline.ts (SRP split).
// Re-exported above for compat; new code imports from there directly.

export async function enrichHackathonStaging(id: string): Promise<{ cached: boolean }> {
  try {
    const record = await prisma.hackathonStaging.findUnique({ where: { id } })
    if (!record) return { cached: false }

    // ─── Fetch multiple pages from the hackathon site for complete data ───
    // CRITICAL: Always fetch link page for deadline extraction (LAST DATE TO REGISTER), even when AI disabled.
    // Shared helper (stagesFetch.ts) — registry SSOT decides pages per platform (1-file adds).
    let allContent = ''
    if (record.url) {
      allContent = await fetchPagesForEnrich(record.url, record.source || '', record.title)
    }

    // ─── Deterministic deadline extraction from link page (LAST DATE TO REGISTER) ───
    // Cognition fix: registrations begin 22 Aug 18:00 vs registrations end 11 Sep 23:59 — must pick 11 Sep (end), not 22 Aug (begin)
    // Time is set to 23:59 IST (end of day) for deadline, matching "11 Sep 2026 (Fri) 11:59 PM Registrations end"
    // toIstDeadline lives in ./stagesDeadline.ts (shared, tested).
    let pageDeadlineStr = ''
    let pageDeadlineDate: Date | null = null
    if (allContent && allContent.length > 50) {
      const extracted = extractDeadlineFromContent(allContent)
      if (extracted) {
        pageDeadlineStr = extracted
        pageDeadlineDate = toIstDeadline(extracted)
        logger.info(`[Enrichment] Page deadline for ${record.title}: ${extracted} -> ${pageDeadlineDate?.toISOString()} (via LAST DATE TO REGISTER, 23:59 IST)`)
      } else if (hasRegistrationClosedIndicator(allContent)) {
        logger.info(`[Enrichment] Registration Closed detected for ${record.title} (no explicit date in extracted)`)
      }
    }
    // Fallback if multi-page fetch was short but url exists — direct page fetch for deadline
    if (!pageDeadlineStr && record.url && (!allContent || allContent.length < 300)) {
      try {
        const stripped = await fetchPage6k(record.url)
        const ext = extractDeadlineFromContent(stripped)
        if (ext) {
          pageDeadlineStr = ext
          pageDeadlineDate = toIstDeadline(ext)
          logger.info(`[Enrichment] Fallback page deadline for ${record.title}: ${ext} -> ${pageDeadlineDate?.toISOString()}`)
          if (!allContent || allContent.length < 300) allContent = stripped
        } else if (stripped && hasRegistrationClosedIndicator(stripped)) {
          if (!allContent) allContent = stripped
        }
      } catch {}
    }

    // ─── Hack2Skill authoritative API overrides page extraction (SPA has no LAST DATE in HTML; fit_fest must be 2026-09-25 19:59 IST) ───
    // Previous bug: page extraction picked 25 Aug (begin) -> stored 2026-08-25, but correct is 25 Sep 07:59 PM IST (2026-09-25T14:29Z)
    let hack2skillApiDeadlineStr = ''
    let hack2skillApiDeadlineDate: Date | null = null
    if (record.url && record.url.toLowerCase().includes('hack2skill.com/event/')) {
      try {
        const apiRaw = await fetchHack2SkillRegistrationEnd(record.url)
        if (apiRaw) {
          const dt = new Date(apiRaw)
          if (!isNaN(dt.getTime())) {
            hack2skillApiDeadlineDate = dt
            hack2skillApiDeadlineStr = dt.toISOString().split('T')[0]
            logger.info(`[Enrichment] Hack2Skill API deadline for ${record.title}: ${apiRaw} -> ${dt.toISOString()} (authoritative, 19:59 IST)`)
            if (!pageDeadlineStr || pageDeadlineStr !== hack2skillApiDeadlineStr) {
              pageDeadlineStr = hack2skillApiDeadlineStr
              pageDeadlineDate = hack2skillApiDeadlineDate
            }
          }
        }
      } catch {}
    }

    if (await isEnrichmentAIDisabled()) {
      if (pageDeadlineDate) {
        try {
          await prisma.hackathonStaging.update({
            where: { id },
            data: { deadline: pageDeadlineDate } as any,
          })
          logger.info(`[Enrichment] AI disabled — updated deadline from link page for ${record.title}: ${pageDeadlineStr}`)
        } catch (e) { logger.warn({ err: (e as any)?.message || e }, `[Enrichment] AI disabled deadline update failed for ${record.title}:`) }
      }
      return { cached: false }
    }

    const scrapedHints = [
      record.title ? `Title: ${record.title}` : '',
      // Order 3: themes is canonical Json array (legacy String accepted).
      Array.isArray(record.themes) && record.themes.length > 0 ? `Themes: ${JSON.stringify(record.themes)}` : (typeof record.themes === 'string' && record.themes && record.themes !== '[]' ? `Themes: ${record.themes}` : ''),
      record.organizer ? `Organizer: ${record.organizer}` : '',
      record.mode ? `Mode: ${record.mode}` : '',
      record.prizePool ? `Prize: ${record.prizePool}` : '',
      record.url ? `URL: ${record.url}` : '',
      record.location ? `Location: ${record.location}` : '',
      record.duration ? `Duration: ${record.duration}` : '',
      // Deterministic page deadline hint for AI (authoritative LAST DATE TO REGISTER)
      pageDeadlineStr ? `Extracted Deadline (from page LAST DATE TO REGISTER): ${pageDeadlineStr}` : '',
      // Registration status indicator
      hasRegistrationClosedIndicator(allContent) ? `Page shows: Registration Closed` : '',
    ].filter(Boolean).join('\n')

    // If content is empty (SPA), try DuckDuckGo search fallback
    if (allContent.length < 300 && record.title) {
      logger.info(`[Enrichment] Content too short for ${record.title}, trying search fallback...`)
      const searchQuery = `${record.title} hackathon details rounds prizes eligibility schedule`
      const searchResults = await searchDetails(searchQuery)
      if (searchResults && searchResults.length > 50) {
        allContent = `\n--- SEARCH RESULTS ---\n${searchResults}`
        logger.info(`[Enrichment] Search fallback found ${searchResults.length} chars for ${record.title}`)
      }
    }

    const contentSection = allContent.length > 300
      ? `\nPage content from ${record.url} (multiple pages scraped):\n${allContent}`
      : record.description
        ? `\nDescription:\n${record.description}`
        : '\n(No description available)'

    // Prompt lives in ./stagesPrompt.ts (pure, tested). Behavior identical.
    const prompt = buildHackathonEnrichPrompt({ scrapedHints, contentSection })

    // P1-3 content-hash gate + P1-5 response cache (fail-open to full Groq):
    // identical enrich input (same pages + same hints) re-enriches 0 tokens.
    // Deterministic page-deadline extraction above already ran (cheap, local)
    // and a prior enrich already stored its results — nothing left to do.
    const enrichInputHash = contentHash(prompt)
    try {
      const stored = await getEnrichContentHash(id)
      if (shouldSkipEnrichForContent(enrichInputHash, stored)) {
        logger.info(`[Enrichment] Content unchanged for ${record.title} — skipping Groq (hash dedup)`)
        return { cached: true }
      }
    } catch {}

    let responseText = ''
    let servedFromCache = false
    try {
      const completion = await enrichmentCompletion(prompt, { temperature: 0.1, max_tokens: 4000 })
      responseText = completion.text
      servedFromCache = completion.cached
      if (completion.killed) {
        // Kill-switch: deterministic deadline path (same as AI-disabled).
        if (pageDeadlineDate) {
          try {
            await prisma.hackathonStaging.update({
              where: { id },
              data: { deadline: pageDeadlineDate } as any,
            })
            logger.info(`[Enrichment] Kill-switch — updated deadline from link page for ${record.title}: ${pageDeadlineStr}`)
          } catch (e) { logger.warn({ err: (e as any)?.message || e }, `[Enrichment] Kill-switch deadline update failed for ${record.title}:`) }
        }
        return { cached: false }
      }
    } catch (aiErr: any) {
      if (isRateLimitError(aiErr)) {
        const msg = buildAiIssue(aiErr)
        logger.warn(`[Enrich] AI rate limit (hackathon ${id}): ${msg} — ${aiErr?.message || aiErr}`)
        throw new AiRateLimitError(msg)
      }
      logger.info({ err: aiErr }, 'AI Manager enrichment failed for hackathon staging:')
    }

    if (!responseText) return { cached: servedFromCache }

    // Shared parser (stagesFetch.ts) — first {...} block, null when absent/invalid.
    const details: any = parseAiJson(responseText)
    if (!details) return { cached: servedFromCache }

    const updateData: any = {}
    if (details.description) updateData.description = stripHtml(details.description)
    // Order 3: canonical Json arrays (were JSON-stringified Strings).
    if (details.targetDepartments) updateData.targetDepartments = (Array.isArray(details.targetDepartments) ? details.targetDepartments : []) as any
    if (details.targetYears) updateData.targetYears = (Array.isArray(details.targetYears) ? details.targetYears : []) as any
    if (details.eligibility) updateData.eligibility = JSON.stringify(details.eligibility)
    // Validate dates — skip Invalid Date to avoid Prisma validation error that would turn success into 500 and frontend "Enrich failed"
    if (details.startDate) {
      const d = new Date(details.startDate)
      if (!isNaN(d.getTime())) updateData.startDate = d
    }
    if (details.endDate) {
      const d = new Date(details.endDate)
      if (!isNaN(d.getTime())) updateData.endDate = d
    }
    if (details.deadline) {
      // AI often returns YYYY-MM-DD; interpret as 23:59 IST (registrations end = end of day)
      const raw = String(details.deadline).trim()
      let d: Date | null = null
      if (/T/.test(raw)) d = new Date(raw)
      else d = new Date(`${raw}T23:59:00+05:30`)
      if (d && !isNaN(d.getTime())) updateData.deadline = d
      else {
        const d2 = new Date(raw)
        if (!isNaN(d2.getTime())) updateData.deadline = d2
      }
    }
    // ─── Deadline resolution: allow AI to correct wrong deterministic begin date (FIT-FEST 2026-08-25 -> 2026-09-25) ───
    // Authoritative Hack2Skill API (19:59 IST) always wins over AI (registrations end = 25 Sep 07:59 PM IST).
    // For HTML-extracted deadlines, if AI returns valid future grounded date and page deadline looks like begin date
    // (window contains "Registrations begin" without end), keep AI instead of overriding with wrong begin.
    if (hack2skillApiDeadlineDate) {
      const aiDeadlineStr = updateData.deadline ? (updateData.deadline as Date).toISOString().split('T')[0] : ''
      if (!aiDeadlineStr || aiDeadlineStr !== pageDeadlineStr) {
        updateData.deadline = hack2skillApiDeadlineDate
        logger.info(`[Enrichment] Overriding AI deadline ${aiDeadlineStr || 'null'} with Hack2Skill API deadline ${pageDeadlineStr} (19:59 IST) for ${record.title}`)
      }
    } else if (pageDeadlineDate) {
      const aiDate = updateData.deadline as Date | undefined
      const aiDeadlineStr = aiDate ? aiDate.toISOString().split('T')[0] : ''
      if (!aiDeadlineStr) {
        // AI missed deadline — use deterministic page deadline
        updateData.deadline = pageDeadlineDate
        logger.info(`[Enrichment] Using page deadline ${pageDeadlineStr} (AI missed) for ${record.title}`)
      } else if (aiDeadlineStr !== pageDeadlineStr) {
        const aiIsHighTrust = isAiDeadlineHighTrust(allContent, aiDeadlineStr, record.title)
        const pageIsBegin = isDeadlineLikelyBeginDate(allContent, pageDeadlineStr)
        const aiIsFuture = aiDate!.getTime() > Date.now()
        const aiNotEnded = !isEnded(aiDeadlineStr, record.title)
        const aiGrounded = isAiDeadlineGrounded(allContent, aiDeadlineStr)
        // Build mode fix: allow AI HIGH trust future not-ended deadline to override wrong page begin date even if pageDeadline exists
        // Deterministic extractor often picks begin/start (e.g., 25 Aug 2026 begin) instead of end (25 Sep 2026 end); prioritize AI end date when HIGH trust
        // Task: after AI returns deadline, allow AI deadline to override pageDeadline if trust HIGH && future && not isEnded, even if pageDeadline exists
        const keepAi = aiIsHighTrust && aiIsFuture && aiNotEnded
        // Also prioritize AI when deterministic was begin date not end (FIT-FEST: 25 Aug begin vs 25 Sep end) — covered by keepAi but log begin signal
        if (keepAi) {
          logger.info(`[Enrichment] Keeping AI deadline ${aiDeadlineStr} over page deadline ${pageDeadlineStr} (AI HIGH trust future not ended${pageIsBegin ? ', page likely begin' : ''}, grounded=${aiGrounded}) for ${record.title}`)
          // keep updateData.deadline as AI — Build mode prioritizes AI when deterministic was begin not end
        } else {
          // AI not HIGH trust / not future / isEnded / not grounded -> prefer deterministic page (LAST DATE TO REGISTER)
          updateData.deadline = pageDeadlineDate
          logger.info(`[Enrichment] Overriding AI deadline ${aiDeadlineStr} with page deadline ${pageDeadlineStr} (23:59 IST) for ${record.title}`)
        }
      }
      // if equal, keep AI (already same as page)
    } else if (!updateData.deadline && record.deadline && !isNaN(new Date(String(record.deadline)).getTime())) {
      // Keep existing record deadline if neither AI nor page provided new one
    }
    // ─── Timeline fallback: if AI missed startDate/endDate but page has Timeline range, extract deterministically ───
    // Do not let timeline stay null when rounds exist — analyse content separately for timeline (vice versa for rounds)
    // Helper lives in ./stagesTimeline.ts (pure, tested). Duration inference preserved below.
    if ((!updateData.startDate || !updateData.endDate) && allContent && allContent.length > 100) {
      const fb = extractTimelineFallback(allContent, record.title)
      if (!updateData.startDate && fb.startDate) updateData.startDate = fb.startDate
      if (!updateData.endDate && fb.endDate) updateData.endDate = fb.endDate
      if (!updateData.duration && updateData.startDate && updateData.endDate) {
        const s = (updateData.startDate as Date).getTime()
        const e = (updateData.endDate as Date).getTime()
        const days = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1)
        if (!record.duration && days > 0 && days < 60) {
          logger.info(`[Enrichment] Inferred timeline duration ~${days} days for ${record.title} (start ${(updateData.startDate as Date).toISOString().split('T')[0]} to ${(updateData.endDate as Date).toISOString().split('T')[0]})`)
        }
      }
    }
    if (details.teamSize) updateData.teamSize = details.teamSize
    // Order 3: canonical Json array (was JSON-stringified String).
    if (details.themes) updateData.themes = (Array.isArray(details.themes) ? details.themes : []) as any
    if (details.venue) updateData.location = details.venue
    else if (details.location) updateData.location = details.location
    if (details.mode) updateData.mode = details.mode
    // Rich prize fields (backward-compatible): tiers/perks fold into prizePool when AI provides them.
    if (details.prizePool) updateData.prizePool = details.prizePool
    if (!updateData.prizePool && Array.isArray(details.prizeTiers) && details.prizeTiers.length) {
      updateData.prizePool = details.prizeTiers.join(', ')
    } else if (Array.isArray(details.prizeTiers) && details.prizeTiers.length && updateData.prizePool) {
      const extra = details.prizeTiers.filter((t: string) => !String(updateData.prizePool).includes(t))
      if (extra.length) updateData.prizePool = `${updateData.prizePool}, ${extra.join(', ')}`
    }
    if (Array.isArray(details.perks) && details.perks.length) {
      const perkStr = `Perks: ${details.perks.join(', ')}`
      updateData.prizePool = updateData.prizePool ? `${updateData.prizePool} | ${perkStr}` : perkStr
    }
    // Judging folds into highlights (no migration): preserve existing highlights when AI adds judging.
    if (details.judging) {
      try {
        const existing = record.highlights && record.highlights !== '[]' ? JSON.parse(record.highlights) : []
        const arr = Array.isArray(existing) ? existing : []
        if (!arr.includes(details.judging)) arr.push(`Judging: ${details.judging}`.slice(0, 500))
        updateData.highlights = JSON.stringify(arr.slice(0, 10))
      } catch {
        updateData.highlights = JSON.stringify([`Judging: ${String(details.judging).slice(0, 500)}`])
      }
    }
    // ─── Separate handling: Timeline fields (duration) independent from Rounds/Schedule ───
    // Timeline (startDate/endDate/deadline/duration) and rounds are updated separately.
    // If AI returns rounds but no timeline, keep rounds and let AI analyse timeline from content;
    // if AI returns timeline but no rounds, keep timeline and preserve/analyse rounds separately.
    // For fit-fest: 1 rounds + Live pipeline + 27/9/2026 must both be preserved — do not overwrite one when the other updates.
    if (details.duration) updateData.duration = details.duration
    // Preserve existing duration if AI missed it but record had one (don't clear timeline when only rounds returned)
    // (duration left absent in updateData keeps existing DB value)
    if (details.bootcamps) updateData.bootcamps = JSON.stringify(details.bootcamps)
    if (details.highlights && !details.judging) updateData.highlights = JSON.stringify(details.highlights)
    else if (details.highlights && details.judging) {
      try {
        const arr = Array.isArray(details.highlights) ? [...details.highlights] : []
        // updateData.highlights already holds judging array from above — merge without dupes.
        const judged = JSON.parse(updateData.highlights)
        for (const h of arr) if (!judged.includes(h)) judged.push(h)
        updateData.highlights = JSON.stringify(judged.slice(0, 10))
      } catch {
        updateData.highlights = JSON.stringify(details.highlights)
      }
    }
    // ─── Rounds / Schedule: separate from timeline, preserve existing if AI gives neither ───
    const hasValidRounds = Array.isArray(details.rounds) && details.rounds.length > 0 && (details.rounds[0] as any)?.roundNumber != null
    const hasValidSchedule = typeof details.schedule === 'string' && details.schedule.trim().length > 10
    const hasValidStages = Array.isArray((details as any).stages) && (details as any).stages.length > 0
    if (hasValidRounds) {
      updateData.schedule = JSON.stringify(details.rounds)
      logger.info(`[Enrichment] Updating rounds (${(details.rounds as any[]).length} rounds) separately from timeline for ${record.title}`)
    } else if (hasValidSchedule) {
      updateData.schedule = (details.schedule as string).trim()
      logger.info(`[Enrichment] Updating textual schedule separately from rounds for ${record.title}`)
    } else if (hasValidStages) {
      updateData.schedule = JSON.stringify((details as any).stages)
      logger.info(`[Enrichment] Updating stages (${((details as any).stages as any[]).length} stages) separately from timeline for ${record.title}`)
    } else {
      // Neither rounds nor textual schedule from AI — preserve existing record.schedule (don't overwrite timeline)
      if (record.schedule) logger.info(`[Enrichment] AI returned no rounds/schedule — preserving existing schedule for ${record.title}`)
    }
    // ─── Timeline preservation: ensure startDate/endDate/deadline not cleared when only rounds updated ───
    // startDate/endDate/deadline are already handled above (only set if AI returned valid). If AI missed them but record
    // had existing values, we keep existing by not touching updateData (Prisma preserves). Additionally, if AI missed
    // timeline but returned rounds, log preservation for audit.
    if (hasValidRounds && !updateData.startDate && !updateData.endDate && !updateData.deadline) {
      if (record.startDate || record.endDate || record.deadline) {
        logger.info(`[Enrichment] Preserving existing timeline (start/end/deadline) for ${record.title} while updating rounds`)
      } else {
        // No existing timeline either — AI was expected to analyse from content; hint present in allContent/pages
        logger.info(`[Enrichment] No timeline from AI nor existing record for ${record.title} — timeline to be analysed from page content on next enrich`)
      }
    }
    if ((updateData.startDate || updateData.endDate || updateData.deadline || updateData.duration) && !hasValidRounds && !hasValidSchedule) {
      if (record.schedule) logger.info(`[Enrichment] Preserving existing rounds/schedule for ${record.title} while updating timeline`)
    }

    try {
      await prisma.hackathonStaging.update({
        where: { id },
        data: updateData,
      })
    } catch (dbErr: any) {
      // Never throw to caller — log and return so enrich endpoint still returns success:true with count. Prevents frontend "Enrich failed" when DB update had transient field issue.
      logger.warn({ err: dbErr?.message || dbErr }, `[Enrichment] Hackathon staging ${id} DB update failed (non-fatal):`)
      return { cached: servedFromCache }
    }
    // P1-3: record the enrich input hash AFTER a successful enrich so
    // reject→refetch cycles with identical content skip Groq next run.
    // (Not stored on empty/failed parses — those must retry, fail-open.)
    await setEnrichContentHash(id, enrichInputHash)
    logger.info(`[Enrichment] Hackathon staging ${id} enriched — ${Object.keys(updateData).length} fields updated`)
    return { cached: servedFromCache }
  } catch (error: any) {
    if (error instanceof AiRateLimitError) throw error
    if (isRateLimitError(error)) throw new AiRateLimitError(buildAiIssue(error))
    logger.error({ err: error }, `[Enrichment] Error enriching hackathon staging ${id}:`)
    return { cached: false }
  }
}


export async function enrichInternshipStaging(id: string): Promise<{ cached: boolean }> {
  try {
    const record = await prisma.internshipStaging.findUnique({ where: { id } })
    if (!record) return { cached: false }

    // Early exit when AI disabled — skip page fetch before AI call
    if (await isEnrichmentAIDisabled()) {
      return { cached: false }
    }

    // Fetch internship page content (shared helper — cache + AbortSignal preserved).
    let allContent = ''
    if (record.url) {
      allContent = await fetchSinglePageForEnrich(record.url)
    }

    // Fallback: stripped description
    const rawContent = record.description || ''
    const strippedDescription = rawContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!allContent || allContent.length < 300) {
      // Use description as fallback content
      allContent = allContent + '\n' + strippedDescription
    }

    // If still short, try search fallback
    if (allContent.length < 300 && record.title) {
      logger.info(`[Enrichment] Content too short for internship ${record.title}, trying search fallback...`)
      const searchQuery = `${record.title} ${record.company || ''} internship stipend duration eligibility`
      const searchResults = await searchDetails(searchQuery)
      if (searchResults && searchResults.length > 50) {
        allContent = allContent + '\n--- SEARCH RESULTS ---\n' + searchResults
        logger.info(`[Enrichment] Search fallback found ${searchResults.length} chars for internship ${record.title}`)
      }
    }

    const scrapedHints = [
      record.title ? `Title: ${record.title}` : '',
      record.company ? `Company: ${record.company}` : '',
      record.role ? `Role: ${record.role}` : '',
      record.mode ? `Mode: ${record.mode}` : '',
      record.stipend ? `Stipend: ${record.stipend}` : '',
      record.duration ? `Duration: ${record.duration}` : '',
      record.url ? `URL: ${record.url}` : '',
    ].filter(Boolean).join('\n')

    const contentForPrompt = allContent.length > 300 ? allContent : strippedDescription

    // Prompt lives in ./stagesPrompt.ts (pure, tested). Behavior identical.
    const prompt = buildInternshipEnrichPrompt({ scrapedHints, contentForPrompt })

    // P1-3 content-hash gate + P1-5 response cache (same contract as hackathon).
    const enrichInputHash = contentHash(prompt)
    try {
      const stored = await getEnrichContentHash(id)
      if (shouldSkipEnrichForContent(enrichInputHash, stored)) {
        logger.info(`[Enrichment] Content unchanged for internship ${record.title} — skipping Groq (hash dedup)`)
        return { cached: true }
      }
    } catch {}

    let responseText = ''
    let servedFromCache = false
    try {
      const completion = await enrichmentCompletion(prompt, { temperature: 0.1, max_tokens: 1000 })
      responseText = completion.text
      servedFromCache = completion.cached
      // Kill-switch: internship enrich has no deterministic fallback beyond
      // the stored description — return early (fail-open, retried next run).
      if (completion.killed) return { cached: false }
    } catch (aiErr: any) {
      if (isRateLimitError(aiErr)) {
        const msg = buildAiIssue(aiErr)
        logger.warn(`[Enrich] AI rate limit (internship ${id}): ${msg} — ${aiErr?.message || aiErr}`)
        throw new AiRateLimitError(msg)
      }
      logger.info({ err: aiErr }, 'AI Manager enrichment failed for internship staging:')
    }

    if (!responseText) return { cached: servedFromCache }

    // Shared parser (stagesFetch.ts) — first {...} block, null when absent/invalid.
    const details: any = parseAiJson(responseText)
    if (!details) return { cached: servedFromCache }

    const updateData: any = {}
    if (details.description) updateData.description = stripHtml(details.description)
    // Order 3: canonical Json arrays (were JSON-stringified Strings).
    if (details.targetDepartments) updateData.targetDepartments = (Array.isArray(details.targetDepartments) ? details.targetDepartments : []) as any
    if (details.targetYears) updateData.targetYears = (Array.isArray(details.targetYears) ? details.targetYears : []) as any
    if (details.stipend && !record.stipend) updateData.stipend = details.stipend
    if (details.duration && !record.duration) updateData.duration = details.duration
    if (details.mode && record.mode === 'REMOTE') updateData.mode = details.mode
    if (details.deadline && !record.deadline) updateData.deadline = String(details.deadline)
    if (details.startDate && !record.startDate) updateData.startDate = String(details.startDate)

    try {
      await prisma.internshipStaging.update({
        where: { id },
        data: updateData,
      })
    } catch (dbErr: any) {
      logger.warn({ err: dbErr?.message || dbErr }, `[Enrichment] Internship staging ${id} DB update failed (non-fatal):`)
      return { cached: servedFromCache }
    }
    // P1-3: record the enrich input hash AFTER a successful enrich (same as hackathon).
    await setEnrichContentHash(id, enrichInputHash)
    logger.info(`[Enrichment] Internship staging ${id} enriched — ${Object.keys(updateData).length} fields updated`)
    return { cached: servedFromCache }
  } catch (error: any) {
    if (error instanceof AiRateLimitError) throw error
    if (isRateLimitError(error)) throw new AiRateLimitError(buildAiIssue(error))
    logger.error({ err: error }, `[Enrichment] Error enriching internship staging ${id}:`)
    return { cached: false }
  }
}


export function normalizeMode(mode: string, location: string): string {
  if (!mode || mode.trim() === '') {
    return location && location.trim() !== '' ? 'OFFLINE' : 'ONLINE'
  }
  return mode
}

// BUILD MODE (best output): Now 10 fetchers total — DEVFOLIO, DEVPOST, MLH, UNSTOP (hackathons), HACK2SKILL, DORAHACKS, HACKEREARTH (hackathons), INTERNSHALA, UNSTOP_INTERNSHIP, WELLFOUND (internships).
// Other Sources (OTHER_HACKATHON / OTHER_INTERNSHIP) remain DETACHED manual-only via POST /fetch/other/* per user request.
// New high-signal sources: DoraHacks (global Web3/AI), HackerEarth (India college/corporate), Wellfound (startup internships with salary).
// OPERATIONAL MODE BUILD: Fetch All tick/target persisted via PlatformSettings (enabled/fetchLimit). When limits map is provided and non-empty, only platforms present in the map are fetched (missing = disabled/tick-off → skipped). When limits is undefined or empty, all 10 are fetched (legacy default).
