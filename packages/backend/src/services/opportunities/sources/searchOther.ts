// opportunities/sources/searchOther.ts — Other Sources orchestrators (SRP extract from search.ts).
// WHY: fetchOther* fan-out + heuristic fallbacks + DB dedupe were inline with extractors.
// Orchestration only; extract/fetch via sibling modules. withRetry stays at DB call sites.
import prisma from '../../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache, isAiGloballyRateLimited, markAiRateLimited } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { hasValue } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from '../dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from '../reputation'
import { UA, MAX_PAGES, PER_PAGE, fetchPage6k } from './context'
import { chatCompletion, isAiRateLimitError, toAiIssueMessage } from '../../../ai/client'
import { AiRateLimitError, isRateLimitError, buildAiIssue, isGroqKeySet, isEnrichmentAIDisabled } from '../errors'
import { fetchHack2SkillRegistrationEnd } from './hack2skill'
import { fetchDuckDuckGoHumanUrls, fetchGenericViaSearch } from './searchFetch'
import { cleanDescription } from './details'
import { aiExtractSingleHackathon, aiExplodeAggregatedHackathons, aiExtractSingleInternship } from './searchExtract'

export async function fetchOtherHackathons(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  // Dynamic search — agent discovers hackathons from companies/startups/colleges, no hardcoded inbuilt links
  const queries = [
    'hackathon 2026 company',
    'startup hackathon 2026 India',
    'college hackathon 2026',
    'hackathon organized by company 2026',
    'hackathon startup 2026 prize',
    'university hackathon 2026 India',
    'corporate hackathon 2026',
    'college hackathon 2026 registration',
    'hackathon 2026 India startup',
    'hackathon 2026 college prize',
  ]
  let rateLimitLogged = false
  // Heuristic fallback without AI — description empty, to be enriched later via Re-enrich
  // Async to allow Hack2Skill authoritative API (SPA shells have no LAST DATE in HTML; must fetch event-details)
  const buildHeuristic = async (r: { url: string; title: string; snippet: string }, stripped6k: string): Promise<NormalizedOpportunity | null> => {
    const title = r.title.trim().slice(0, 150)
    if (!title || title.length < 5 || isGenericTitle(title)) return null
    const combined = `${r.title} ${r.snippet} ${stripped6k.slice(0, 1200)}`
    // Hack2Skill authoritative before HTML extraction (fix fit_fest 25 Aug begin vs 25 Sep end)
    let apiDeadlineEarly = ''
    try { if (r.url.toLowerCase().includes('hack2skill.com/event/')) apiDeadlineEarly = await fetchHack2SkillRegistrationEnd(r.url) } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)');}
    // Priority: if API has deadline, use it directly; otherwise extract LAST DATE TO REGISTER from stripped page
    let deadline = apiDeadlineEarly || extractDeadlineFromContent(stripped6k) || extractDeadlineFromContent(combined)
    // Override HTML mis-parse with authoritative API (e.g., HTML picked 25 Aug begin, API is 25 Sep end)
    if (apiDeadlineEarly && deadline !== apiDeadlineEarly) deadline = apiDeadlineEarly
    if (!deadline) {
      const deadlineMatch = combined.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
      if (deadlineMatch) deadline = parseSearchDate(deadlineMatch[0]) || ''
      if (!deadline && apiDeadlineEarly) deadline = apiDeadlineEarly
    }
    // If still no deadline but API exists, ensure we use API (SPA shells have no date in HTML)
    if (!deadline && apiDeadlineEarly) deadline = apiDeadlineEarly
    if (deadline && apiDeadlineEarly && deadline !== apiDeadlineEarly) deadline = apiDeadlineEarly
    // Registration Closed without explicit date => completed (must filter, not save as active)
    if (!deadline && stripped6k && hasRegistrationClosedIndicator(stripped6k)) return null
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, r.url)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) return null
    if (!deadline && stripped6k && hasRegistrationClosedIndicator(stripped6k)) return null
    const opp: NormalizedOpportunity = {
      type: 'HACKATHON',
      title,
      description: '',
      url: r.url,
      source: 'OTHER_HACKATHON',
      organizer: '',
      deadline,
      startDate: '',
      duration: '',
      location: /india/i.test(combined) ? 'India' : 'Online',
      mode: 'ONLINE',
      prizePool: '',
      stipend: '',
      company: '',
      role: '',
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
    }
    
    applyHighOrganizerTrustBoost(opp, stripped6k)
    return opp
  }

  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const q = queries[(page - 1) % queries.length]
    let ddgResults: Array<{ url: string; title: string; snippet: string }> = []
    try {
      ddgResults = await fetchDuckDuckGoHumanUrls(q, page)
    } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)'); ddgResults = [] }
    if (ddgResults.length === 0) continue
    // Strictly respect limit: only process as many URLs as we still need (limit 1 → 1 URL, not 3)
    const remaining = target - newItems.length
    const urlsToProcess = ddgResults.slice(0, remaining)
    const batchOpps: NormalizedOpportunity[] = []
    // Process sequentially to avoid 3× parallel 429s and to enable global cooldown skip
    for (const r of urlsToProcess) {
      if (newItems.length + batchOpps.length >= target) break
      const stripped = await fetchPage6k(r.url)
      // If globally rate-limited, skip AI entirely and save raw heuristic
      if (isAiGloballyRateLimited()) {
        if (!rateLimitLogged) {
          logger.warn(`[OtherHackathon] AI rate limited, saving raw to staging without AI enrich`)
          rateLimitLogged = true
        }
        const raw = await buildHeuristic(r, stripped || '')
        if (raw) batchOpps.push(raw)
        continue
      }
      if (!stripped || stripped.length < 100) {
        const raw = await buildHeuristic(r, stripped || '')
        if (raw) batchOpps.push(raw)
        continue
      }
      try {
        const { opp, isAggregation, rawTitle, themes } = await aiExtractSingleHackathon(stripped, r.url)
        if (!opp) {
          const raw = await buildHeuristic(r, stripped)
          if (raw) batchOpps.push(raw)
          continue
        }
        const aggCondition = isAggregation || /complete list/i.test(rawTitle) || themes.length > 8 || r.url.includes('blogs.reskilll.com') || r.url.includes('placementpreps.in/hackathons-2026') || /complete list/i.test(stripped.slice(0, 2000))
        if (aggCondition) {
          if (isAiGloballyRateLimited()) {
            if (!rateLimitLogged) {
              logger.warn(`[OtherHackathon] AI rate limited, saving raw to staging without AI enrich`)
              rateLimitLogged = true
            }
            const rawAgg = await buildHeuristic(r, stripped)
            if (rawAgg) batchOpps.push(rawAgg)
            continue
          }
          try {
            const exploded = await aiExplodeAggregatedHackathons(stripped, r.url)
            if (exploded.length > 0) {
              const stillNeed = target - (newItems.length + batchOpps.length)
              batchOpps.push(...exploded.slice(0, stillNeed))
            } else {
              const rawAgg = await buildHeuristic(r, stripped)
              if (rawAgg) batchOpps.push(rawAgg)
            }
          } catch (e: any) {
            if (e instanceof AiRateLimitError || isRateLimitError(e)) {
              markAiRateLimited()
              if (!rateLimitLogged) {
                logger.warn(`[OtherHackathon] AI rate limited, saving raw to staging without AI enrich`)
                rateLimitLogged = true
              }
              const fallback = await buildHeuristic(r, stripped)
              if (fallback) batchOpps.push(fallback)
            } else {
              const fallback = await buildHeuristic(r, stripped)
              if (fallback) batchOpps.push(fallback)
            }
          }
          continue
        }
        applyHighOrganizerTrustBoost(opp, stripped)
        batchOpps.push(opp)
      } catch (e: any) {
        if (e instanceof AiRateLimitError || isRateLimitError(e)) {
          markAiRateLimited()
          if (!rateLimitLogged) {
            logger.warn(`[OtherHackathon] AI rate limited, saving raw to staging without AI enrich`)
            rateLimitLogged = true
          }
          const fallback = await buildHeuristic(r, stripped)
          if (fallback) batchOpps.push(fallback)
        } else {
          const fallback = await buildHeuristic(r, stripped)
          if (fallback) batchOpps.push(fallback)
        }
      }
      if (newItems.length + batchOpps.length >= target) break
    }
    if (batchOpps.length === 0) continue
    for (const o of batchOpps) applyHighOrganizerTrustBoost(o)
    const filteredBatch: NormalizedOpportunity[] = []
    for (const o of batchOpps) {
      if (!o.title || isGenericTitle(o.title)) continue
      if (seen.has(o.title)) continue
      if (isEnded(o.deadline, o.title)) continue
      seen.add(o.title)
      filteredBatch.push(o)
      if (filteredBatch.length + newItems.length >= target) break
    }
    if (filteredBatch.length === 0) continue
    filteredBatch.sort((a, b) => {
      return getHackathonReputationScore({ title: b.title, url: b.url, organizer: b.organizer }) - getHackathonReputationScore({ title: a.title, url: a.url, organizer: a.organizer })
    })
    // Batch dedup via DB
    const titles = filteredBatch.map((b) => b.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.hackathonStaging.findMany({
          where: { title: { in: titles }, source: 'OTHER_HACKATHON' },
          select: { title: true },
        })
        existing.forEach((e) => existingTitles.add(e.title))
      } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)');}
    }
    for (const item of filteredBatch) {
      if (newItems.length >= target) break
      if (existingTitles.has(item.title)) continue
      newItems.push(item)
    }
    if (newItems.length >= target) break
  }
  const sliced = newItems.slice(0, target)
  logger.info(`[OtherHackathon][Human] Fetched ${sliced.length} hackathons (target ${limit || 30}) capped at ${MAX_PAGES} pages via human search`)
  return sliced
}


export async function fetchOtherInternships(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : 30
  const seen = new Set<string>()
  const newItems: NormalizedOpportunity[] = []
  // Dynamic search � agent discovers internships from companies/startups/colleges, no hardcoded inbuilt links
  const queries = [
    'internship 2026 company',
    'startup internship 2026',
    'college internship 2026',
    'company internship 2026 stipend',
    'internship by startup 2026 India',
    'university internship 2026',
    'corporate internship 2026 India',
    'internship 2026 college students',
    'startup internship 2026 stipend India',
    'college internship 2026 application',
  ]
  let rateLimitLoggedIntern = false
  const buildInternHeuristic = (r: { url: string; title: string; snippet: string }, stripped6k: string): NormalizedOpportunity | null => {
    const title = r.title.trim().slice(0, 150)
    if (!title || title.length < 5 || isGenericTitle(title)) return null
    const combined = `${r.title} ${r.snippet} ${stripped6k.slice(0, 1200)}`
    let deadline = extractDeadlineFromContent(stripped6k) || extractDeadlineFromContent(combined)
    if (!deadline) {
      const deadlineMatch = combined.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
      if (deadlineMatch) deadline = parseSearchDate(deadlineMatch[0]) || ""
    }
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, r.url)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) return null
    const parts = title.split(" - ")
    const role = parts[0]?.trim() || title
    // MEDIUM 2026-09-10 Unknown fix: honest-omit '' (matches Unstop/Wellfound/Internshala).
    let company = ""
    if (title.includes(" at ")) company = title.split(" at ").pop()?.trim() || ""
    else if (title.includes(" @ ")) company = title.split(" @ ").pop()?.trim() || ""
    else if (parts.length > 1) company = parts[1]?.trim() || ""
    if (!company || company.length < 2) {
      try {
        const host = new URL(r.url).hostname.replace("www.", "").split(".")[0]
        if (host && host.length > 2) company = host.charAt(0).toUpperCase() + host.slice(1)
      } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)');}
    }
    const opp: NormalizedOpportunity = {
      type: "INTERNSHIP",
      title,
      description: cleanDescription(stripped6k ? stripped6k.slice(0, 2000) : (r.snippet || ''), { title, source: 'OTHER_INTERNSHIP' }),
      url: r.url,
      source: "OTHER_INTERNSHIP",
      organizer: company,
      deadline,
      startDate: "",
      duration: "",
      location: /india/i.test(combined) ? "India" : "",
      mode: /remote/i.test(combined) ? "REMOTE" : "REMOTE",
      prizePool: "",
      stipend: "",
      company,
      role,
      themes: [],
      website: "",
      discord: "",
      participantsCount: 0,
      inviteOnly: false,
    }
    
    if (isCompanyStartupCollegeOrganizer({ title: opp.title, url: opp.url, organizer: opp.company, prizePool: opp.stipend })) {
      
    }
    return opp
  }

  for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
    const q = queries[(page - 1) % queries.length]
    let ddgResults: Array<{ url: string; title: string; snippet: string }> = []
    try {
      ddgResults = await fetchDuckDuckGoHumanUrls(q, page)
    } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)'); ddgResults = [] }
    if (ddgResults.length === 0) continue
    const remaining = target - newItems.length
    const urlsToProcess = ddgResults.slice(0, remaining)
    const batchOpps: NormalizedOpportunity[] = []
    for (const r of urlsToProcess) {
      if (newItems.length + batchOpps.length >= target) break
      const combinedTest = `${r.title} ${r.snippet} ${r.url}`.toLowerCase()
      if (!combinedTest.includes("internship") && !combinedTest.includes("intern ")) continue
      const stripped = await fetchPage6k(r.url)
      if (isAiGloballyRateLimited()) {
        if (!rateLimitLoggedIntern) {
          logger.warn(`[OtherInternship] AI rate limited, saving raw to staging without AI enrich`)
          rateLimitLoggedIntern = true
        }
        const raw = buildInternHeuristic(r, stripped || "")
        if (raw) batchOpps.push(raw)
        continue
      }
      if (!stripped || stripped.length < 100) {
        const raw = buildInternHeuristic(r, stripped || "")
        if (raw) batchOpps.push(raw)
        continue
      }
      try {
        const opp = await aiExtractSingleInternship(stripped, r.url)
        if (!opp) {
          const raw = buildInternHeuristic(r, stripped)
          if (raw) batchOpps.push(raw)
          continue
        }
        batchOpps.push(opp)
      } catch (e: any) {
        if (e instanceof AiRateLimitError || isRateLimitError(e)) {
          markAiRateLimited()
          if (!rateLimitLoggedIntern) {
            logger.warn(`[OtherInternship] AI rate limited, saving raw to staging without AI enrich`)
            rateLimitLoggedIntern = true
          }
          const fallback = buildInternHeuristic(r, stripped)
          if (fallback) batchOpps.push(fallback)
        } else {
          const fallback = buildInternHeuristic(r, stripped)
          if (fallback) batchOpps.push(fallback)
        }
      }
      if (newItems.length + batchOpps.length >= target) break
    }
    if (batchOpps.length === 0) continue
    const filteredBatch: NormalizedOpportunity[] = []
    for (const o of batchOpps) {
      if (!o.title || isGenericTitle(o.title)) continue
      if (seen.has(o.title)) continue
      if (isEnded(o.deadline, o.title)) continue
      seen.add(o.title)
      filteredBatch.push(o)
      if (filteredBatch.length + newItems.length >= target) break
    }
    if (filteredBatch.length === 0) continue
    filteredBatch.sort((a, b) => {
      const aHasStipend = hasValue((a as any).stipend) ? 1 : 0
      const bHasStipend = hasValue((b as any).stipend) ? 1 : 0
      if (bHasStipend !== aHasStipend) return bHasStipend - aHasStipend
      return 0
    })
    const titles = filteredBatch.map((b) => b.title).filter(Boolean)
    let existingTitles = new Set<string>()
    if (titles.length) {
      try {
        const existing = await prisma.internshipStaging.findMany({
          where: { title: { in: titles }, source: "OTHER_INTERNSHIP" },
          select: { title: true },
        })
        existing.forEach((e) => existingTitles.add(e.title))
      } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)');}
    }
    for (const item of filteredBatch) {
      if (newItems.length >= target) break
      if (existingTitles.has(item.title)) continue
      newItems.push(item)
    }
    if (newItems.length >= target) break
  }
  // Fallback: if human search got 0 (e.g., AI disabled or DDG blocked), use generic snippet search to still meet target without AI
  if (newItems.length === 0) {
    const seen2 = new Set<string>(Array.from(seen))
    for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
      const q = queries[(page - 1) % queries.length]
      let batch: NormalizedOpportunity[] = []
      try {
        const generic = await fetchGenericViaSearch(q, page, seen2, 'OTHER_INTERNSHIP', 'INTERNSHIP')
        batch = generic
      } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)'); batch = [] }
      if (batch.length === 0) continue
      const titles = batch.map((b) => b.title).filter(Boolean)
      let existingTitles = new Set<string>()
      if (titles.length) {
        try {
          const existing = await prisma.internshipStaging.findMany({
            where: { title: { in: titles }, source: 'OTHER_INTERNSHIP' },
            select: { title: true },
          })
          existing.forEach((e) => existingTitles.add(e.title))
        } catch (err) { logger.debug({ err }, '[searchOther] non-fatal (treated as empty/skip)');}
      }
      for (const item of batch) {
        if (newItems.length >= target) break
        if (existingTitles.has(item.title)) continue
        if (isEnded(item.deadline, item.title)) continue
        if (isGenericTitle(item.title)) continue
        newItems.push(item)
      }
      if (newItems.length >= target) break
    }
  }
  const sliced = newItems.slice(0, target)
  logger.info(`[OtherInternship][Human] Fetched ${sliced.length} internships (target ${limit || 30}) capped at ${MAX_PAGES} pages via human search`)
  return sliced
}

