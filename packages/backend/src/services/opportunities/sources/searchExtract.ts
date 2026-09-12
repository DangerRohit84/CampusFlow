// opportunities/sources/searchExtract.ts — AI extract/explode (SRP extract from search.ts).
// WHY: AI prompts + JSON parsing + aggregation explode were inline with fetch orchestration.
// Pure-ish extractors (AI + deterministic fallback); AbortSignal via fetchPage6k/context.
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
import { slugify } from './searchFetch'
import { cleanDescription, extractPrizeTiers, extractTeamSize, extractEligibility, extractVenueMode, extractJudging, extractScheduleText, extractStages } from './details'

export async function aiExtractSingleHackathon(stripped6k: string, url: string): Promise<{ opp: NormalizedOpportunity | null; isAggregation: boolean; rawTitle: string; themes: string[] }> {
  if (!stripped6k || stripped6k.length < 80) return { opp: null, isAggregation: false, rawTitle: '', themes: [] }
  const lowerStripped = stripped6k.slice(0, 2000).toLowerCase()
  const lowerUrl = url.toLowerCase()
  const urlIsAggBlog = lowerUrl.includes('blogs.reskilll.com') || lowerUrl.includes('placementpreps.in/hackathons-2026') || (lowerUrl.includes('placementpreps.in') && lowerStripped.includes('complete list'))
  if (await isEnrichmentAIDisabled()) {
    let title = ''
    try {
      const u = new URL(url)
      const pathPart = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname).replace(/[-_]/g, ' ').slice(0, 120).trim()
      title = pathPart.length >= 5 ? pathPart : stripped6k.slice(0, 100).trim().split('\n')[0]?.slice(0, 100) || pathPart
    } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)'); title = stripped6k.slice(0, 100).trim().split('\n')[0] || 'Hackathon' }
    const hackTitleMatch = stripped6k.match(/([A-Z][^.!?\n]{10,90}hackathon[^.!?\n]{0,40})/i)
    if (hackTitleMatch) {
      const cand = hackTitleMatch[0].trim().replace(/\s+/g, ' ').slice(0, 120)
      if (cand.length > title.length && cand.length < 150) title = cand
    }
    if (!title || isGenericTitle(title)) return { opp: null, isAggregation: false, rawTitle: title, themes: [] }
    let deadline = extractDeadlineFromContent(stripped6k) || ''
    if (!deadline) {
      const deadlineMatch = stripped6k.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
      if (deadlineMatch) deadline = parseSearchDate(deadlineMatch[0]) || ''
    }
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, url)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) return { opp: null, isAggregation: false, rawTitle: title, themes: [] }
    const isAgg = /complete list/i.test(title) || /complete list/i.test(stripped6k.slice(0, 1000)) || urlIsAggBlog
    const windowPrizes = extractPrizeTiers(stripped6k)
    const teamSize = extractTeamSize(stripped6k)
    const eligibility = extractEligibility(stripped6k)
    const venueMode = extractVenueMode(stripped6k, {})
    const judging = extractJudging(stripped6k)
    const schedule = extractScheduleText(stripped6k)
    const stages = extractStages(stripped6k)
    const opp: NormalizedOpportunity = {
      type: 'HACKATHON',
      title: title.slice(0, 150),
      description: cleanDescription(stripped6k.slice(0, 2000), { title, source: 'OTHER_HACKATHON' }),
      url,
      source: 'OTHER_HACKATHON',
      organizer: '',
      deadline,
      startDate: '',
      duration: '',
      location: venueMode.venue || (/india/i.test(stripped6k) ? 'India' : 'Online'),
      mode: venueMode.venue ? venueMode.mode : 'ONLINE',
      prizePool: windowPrizes.prizePool || '',
      stipend: '',
      company: '',
      role: '',
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
      ...(windowPrizes.tiers.length ? { prizeTiers: windowPrizes.tiers } : {}),
      ...(windowPrizes.perks.length ? { perks: windowPrizes.perks } : {}),
      ...(teamSize !== null ? { teamSize } : {}),
      ...(eligibility ? { eligibility } : {}),
      ...(venueMode.venue ? { venue: venueMode.venue } : {}),
      ...(judging ? { judging } : {}),
      ...(schedule ? { schedule } : {}),
      ...(stages.length ? { stages } : {}),
    }
    
    return { opp, isAggregation: isAgg, rawTitle: title, themes: [] }
  }
  const prompt = `Extract ONE hackathon from this page. If the page lists MULTIPLE hackathons (aggregation blog like "Complete List"), still return a SINGLE summary object with title containing "Complete List" and themes array containing all listed themes (so caller can detect aggregation via themes.length >8). Else return the single hackathon.

URL: ${url}
Page content (6k stripped):
${stripped6k.substring(0, 5000)}

Return ONLY JSON with:
{
  "title": "hackathon title or aggregation title",
  "description": "full description (preserve venue, eligibility, judging, schedule details; do not truncate to 2 sentences when more is available)",
  "organizer": "organizer or null",
  "deadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null",
  "prizePool": "multi-tier prizes joined (e.g. Campus Winner: ₹5,000, National Winner: ₹20,000) or null — never ₹0",
  "prizeTiers": ["Campus Winner: ₹5,000"] or null,
  "perks": ["Goodies", "Internship"] or null,
  "teamSize": 1 for Individual else number or null,
  "eligibility": "free text or null",
  "venue": "venue + metro or null",
  "location": "Online or India or city",
  "mode": "ONLINE|OFFLINE|HYBRID",
  "judging": "criteria/points or null",
  "schedule": "schedule summary or null",
  "stages": [{"title": "Stage 1 Campus Round"}] or null,
  "themes": ["theme1", ...]
}
Rules:
- Never fabricate dates or ₹0 prizes. Use only explicit dates/amounts. If none, null (omit, don't invent).
- Capture multi-tier prizes + perks, multi-dates + stages, team size, eligibility, venue/mode, judging, full description.
- If aggregation, title should be original page title containing "Complete List" and themes should be ALL themes from listed hackathons (aim 12+).
- If not a hackathon, set title to null.
- Return ONLY JSON.`
  let responseText = ''
  try {
    responseText = await chatCompletion('enrichment', [{ role: 'user', content: prompt }], { temperature: 0.1, max_tokens: 1500 })
  } catch (e: any) {
    if (isRateLimitError(e)) {
      const msg = buildAiIssue(e)
      logger.warn(`[AI] Rate limit in aiExtractSingleHackathon (${url}): ${msg}`)
      throw new AiRateLimitError(msg)
    }
    return { opp: null, isAggregation: false, rawTitle: '', themes: [] }
  }
  if (!responseText || responseText.includes('AI provider not configured') || responseText.includes('Not configured')) {
    return { opp: null, isAggregation: false, rawTitle: '', themes: [] }
  }
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { opp: null, isAggregation: false, rawTitle: '', themes: [] }
  let data: any
  try { data = JSON.parse(jsonMatch[0]) } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)'); return { opp: null, isAggregation: false, rawTitle: '', themes: [] } }
  const titleRaw = (data.title || '').toString().trim().slice(0, 150)
  if (!titleRaw || titleRaw.toLowerCase() === 'null') return { opp: null, isAggregation: false, rawTitle: '', themes: [] }
  if (isGenericTitle(titleRaw) && !/complete list/i.test(titleRaw)) return { opp: null, isAggregation: false, rawTitle: titleRaw, themes: Array.isArray(data.themes) ? data.themes : [] }
  const themes = Array.isArray(data.themes) ? data.themes : []
  const isAgg = /complete list/i.test(titleRaw) || themes.length > 8 || /complete list/i.test(stripped6k.slice(0, 2000)) || urlIsAggBlog
  let deadline = ''
  if (data.deadline) {
    const d = new Date(data.deadline)
    if (!isNaN(d.getTime())) deadline = d.toISOString().split('T')[0]
    else deadline = parseSearchDate(String(data.deadline)) || ''
  }
  if (isEnded(deadline, titleRaw)) return { opp: null, isAggregation: false, rawTitle: titleRaw, themes }
  const opp: NormalizedOpportunity = {
    type: 'HACKATHON',
    title: titleRaw,
    description: cleanDescription(data.description || stripped6k.slice(0, 2000), { title: titleRaw, source: 'OTHER_HACKATHON' }),
    url,
    source: 'OTHER_HACKATHON',
    organizer: (data.organizer || '').toString(),
    deadline,
    startDate: data.startDate ? String(data.startDate).split('T')[0] : '',
    duration: '',
    location: data.venue || data.location || (/india/i.test(stripped6k) ? 'India' : 'Online'),
    mode: data.mode || 'ONLINE',
    prizePool: data.prizePool || '',
    stipend: '',
    company: '',
    role: '',
    themes,
    website: '',
    discord: '',
    participantsCount: 0,
    inviteOnly: false,
    ...(Array.isArray(data.prizeTiers) && data.prizeTiers.length ? { prizeTiers: data.prizeTiers.map((x: any) => String(x).slice(0, 120)) } : {}),
    ...(Array.isArray(data.perks) && data.perks.length ? { perks: data.perks.map((x: any) => String(x).slice(0, 60)) } : {}),
    ...(data.teamSize !== undefined && data.teamSize !== null && Number.isFinite(Number(data.teamSize)) ? { teamSize: Number(data.teamSize) } : {}),
    ...(data.eligibility ? { eligibility: String(data.eligibility).slice(0, 800) } : {}),
    ...(data.venue ? { venue: String(data.venue).slice(0, 200) } : {}),
    ...(data.judging ? { judging: String(data.judging).slice(0, 800) } : {}),
    ...(data.schedule ? { schedule: String(data.schedule).slice(0, 800) } : {}),
    ...(Array.isArray(data.stages) && data.stages.length ? { stages: data.stages.slice(0, 10).map((s: any) => ({ title: String(s.title || s).slice(0, 120) })) } : {}),
  }

  return { opp, isAggregation: isAgg, rawTitle: titleRaw, themes }
}


export async function aiExplodeAggregatedHackathons(stripped6k: string, baseUrl: string): Promise<NormalizedOpportunity[]> {
  if (!stripped6k || stripped6k.length < 80) return []
  if (await isEnrichmentAIDisabled()) {
    const headings: string[] = []
    const seen = new Set<string>()
    const regex = /([A-Z][a-zA-Z0-9\s\-&:'\",]{5,90}Hackathon[A-Za-z0-9\s\-&:'\",]{0,30})/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(stripped6k)) !== null && headings.length < 25) {
      const t = m[1].trim().replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '').slice(0, 120)
      if (t.length < 10 || isGenericTitle(t) || seen.has(t.toLowerCase())) continue
      if (/complete list/i.test(t) && t.length < 60) continue
      seen.add(t.toLowerCase())
      headings.push(t)
    }
    if (headings.length < 5) {
      const numRegex = /\d+\.\s+([A-Z][^.\n]{10,100})/g
      while ((m = numRegex.exec(stripped6k)) !== null && headings.length < 25) {
        const t = m[1].trim().replace(/\s+/g, ' ').slice(0, 120)
        if (t.length < 10 || isGenericTitle(t) || seen.has(t.toLowerCase())) continue
        if (!t.toLowerCase().includes('hackathon') && !t.toLowerCase().includes('hack ')) continue
        seen.add(t.toLowerCase())
        headings.push(t)
      }
    }
    const results: NormalizedOpportunity[] = []
    for (const title of headings.slice(0, 25)) {
      const idx = stripped6k.toLowerCase().indexOf(title.toLowerCase().slice(0, 20).toLowerCase())
      const window = idx >= 0 ? stripped6k.substring(Math.max(0, idx - 400), Math.min(stripped6k.length, idx + 700)) : ''
      let deadline = extractDeadlineFromContent(window) || ''
      if (!deadline) {
        const dm = window.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
        if (dm) deadline = parseSearchDate(dm[0]) || ''
      }
      if (!deadline) {
        const inferred = inferDeadlineFromTitle(title, baseUrl)
        if (inferred) deadline = inferred
      }
      if (isEnded(deadline, title)) continue
      const slug = slugify(title)
      const windowPrizes = extractPrizeTiers(window)
      const opp: NormalizedOpportunity = {
        type: 'HACKATHON',
        title,
        description: cleanDescription(window.slice(0, 1000), { title, source: 'OTHER_HACKATHON' }),
        url: `${baseUrl}#${slug}`,
        source: 'OTHER_HACKATHON',
        organizer: '',
        deadline,
        startDate: '',
        duration: '',
        location: 'India',
        mode: 'ONLINE',
        prizePool: windowPrizes.prizePool || '',
        stipend: '',
        company: '',
        role: '',
        themes: [],
        website: '',
        discord: '',
        participantsCount: 0,
        inviteOnly: false,
        ...(windowPrizes.tiers.length ? { prizeTiers: windowPrizes.tiers } : {}),
        ...(windowPrizes.perks.length ? { perks: windowPrizes.perks } : {}),
      }
      
      results.push(opp)
    }
    return results
  }
  const prompt = `This page is an aggregation blog listing MULTIPLE hackathons (e.g. "Complete List of Hackathons 2026" with 16-18 entries). Extract EACH individual hackathon.

Base URL: ${baseUrl}
Page content (6k stripped):
${stripped6k.substring(0, 5000)}

Return ONLY JSON in this exact shape:
{
  "hackathons": [
    {
      "title": "specific hackathon name",
      "description": "1-2 sentence description",
      "organizer": "organizer or null",
      "deadline": "YYYY-MM-DD or null",
      "startDate": "YYYY-MM-DD or null",
      "prizePool": "prize or null",
      "themes": ["theme1"],
      "location": "Online|India|city",
      "mode": "ONLINE|OFFLINE|HYBRID"
    }
  ]
}
Rules:
- Extract ALL hackathons listed (aim 16 + 18 for those two blogs, but extract whatever present, max 25, min 5).
- Each title must be unique, specific, not generic, not "Complete List".
- Never fabricate deadline. Use only explicit dates. If none, null.
- If prize mentions like "₹1 lakh", keep as string.
- Return ONLY JSON.`
  let responseText = ''
  try {
    responseText = await chatCompletion('enrichment', [{ role: 'user', content: prompt }], { temperature: 0.1, max_tokens: 4000 })
  } catch (e: any) {
    if (isRateLimitError(e)) {
      const msg = buildAiIssue(e)
      logger.warn(`[AI] Rate limit in aiExplodeAggregatedHackathons (${baseUrl}): ${msg}`)
      throw new AiRateLimitError(msg)
    }
    return []
  }
  if (!responseText || responseText.includes('AI provider not configured')) return []
  let jsonStr = responseText.trim()
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  let data: any = null
  if (jsonMatch) {
    try { data = JSON.parse(jsonMatch[0]) } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)');
      const arrMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (arrMatch) try { data = { hackathons: JSON.parse(arrMatch[0]) } } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)');}
    }
  } else {
    const arrMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (arrMatch) try { data = { hackathons: JSON.parse(arrMatch[0]) } } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)');}
  }
  if (!data) return []
  const list = Array.isArray(data) ? data : (Array.isArray(data.hackathons) ? data.hackathons : Array.isArray((data as any).items) ? (data as any).items : [])
  const results: NormalizedOpportunity[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const title = (item.title || '').toString().trim().slice(0, 150)
    if (!title || isGenericTitle(title) || seen.has(title.toLowerCase())) continue
    if (/complete list/i.test(title) && title.length < 80) continue
    seen.add(title.toLowerCase())
    let deadline = ''
    if (item.deadline) {
      const d = new Date(item.deadline)
      if (!isNaN(d.getTime())) deadline = d.toISOString().split('T')[0]
      else deadline = parseSearchDate(String(item.deadline)) || ''
    }
    if (isEnded(deadline, title)) continue
    let startDate = ''
    if (item.startDate) {
      const sd = new Date(item.startDate)
      if (!isNaN(sd.getTime())) startDate = sd.toISOString().split('T')[0]
    }
    const themes = Array.isArray(item.themes) ? item.themes : []
    const slug = slugify(title)
    const opp: NormalizedOpportunity = {
      type: 'HACKATHON',
      title,
      description: cleanDescription(item.description || '', { title, source: 'OTHER_HACKATHON' }),
      url: `${baseUrl}#${slug}`,
      source: 'OTHER_HACKATHON',
      organizer: (item.organizer || '').toString(),
      deadline,
      startDate,
      duration: '',
      location: item.location || 'India',
      mode: item.mode || 'ONLINE',
      prizePool: item.prizePool || '',
      stipend: '',
      company: '',
      role: '',
      themes,
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
    }

    results.push(opp)
    if (results.length >= 25) break
  }
  return results
}


export async function aiExtractSingleInternship(stripped6k: string, url: string): Promise<NormalizedOpportunity | null> {
  if (!stripped6k || stripped6k.length < 80) return null
  if (await isEnrichmentAIDisabled()) {
    let title = stripped6k.slice(0, 120).trim().split('\n')[0] || url.split('/').pop() || 'Internship'
    const m = stripped6k.match(/([A-Z][^.!?\n]{10,80}internship[^.!?\n]{0,40})/i)
    if (m) title = m[0].trim().replace(/\s+/g, ' ').slice(0, 120)
    if (!title || isGenericTitle(title)) return null
    // MEDIUM 2026-09-10 Unknown fix: honest-omit '' (matches Unstop/Wellfound/Internshala).
    let company = ''
    if (title.includes(' at ')) company = title.split(' at ').pop()?.trim() || ''
    let deadline = extractDeadlineFromContent(stripped6k) || ''
    if (!deadline) {
      const dm = stripped6k.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
      if (dm) deadline = parseSearchDate(dm[0]) || ''
    }
    if (!deadline) {
      const inferred = inferDeadlineFromTitle(title, url)
      if (inferred) deadline = inferred
    }
    if (isEnded(deadline, title)) return null
    const opp: NormalizedOpportunity = {
      type: 'INTERNSHIP',
      title,
      description: cleanDescription(stripped6k.slice(0, 2000), { title, source: 'OTHER_INTERNSHIP' }),
      url,
      source: 'OTHER_INTERNSHIP',
      organizer: company,
      deadline,
      startDate: '',
      duration: '',
      location: /india/i.test(stripped6k) ? 'India' : '',
      mode: /remote/i.test(stripped6k) ? 'REMOTE' : 'REMOTE',
      prizePool: '',
      stipend: '',
      company,
      role: title,
      themes: [],
      website: '',
      discord: '',
      participantsCount: 0,
      inviteOnly: false,
    }
    
    return opp
  }
  const prompt = `Extract ONE internship from this page.

URL: ${url}
Page content (6k stripped):
${stripped6k.substring(0, 5000)}

Return ONLY JSON:
{
  "title": "internship title",
  "description": "2-3 sentences",
  "company": "company name",
  "role": "role",
  "deadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null",
  "stipend": "₹X/month or null",
  "duration": "3 months or null",
  "location": "city/India",
  "mode": "REMOTE|ONSITE|HYBRID"
}
Rules: Never fabricate dates. If not internship, title null. Return ONLY JSON.`
  let responseText = ''
  try { responseText = await chatCompletion('enrichment', [{ role: 'user', content: prompt }], { temperature: 0.1, max_tokens: 1200 }) } catch (e: any) {
    if (isRateLimitError(e)) {
      const msg = buildAiIssue(e)
      logger.warn(`[AI] Rate limit in aiExtractSingleInternship (${url}): ${msg}`)
      throw new AiRateLimitError(msg)
    }
    return null
  }
  if (!responseText || responseText.includes('AI provider not configured')) return null
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  let data: any
  try { data = JSON.parse(jsonMatch[0]) } catch (err) { logger.debug({ err }, '[searchExtract] non-fatal (treated as empty/skip)'); return null }
  const title = (data.title || '').toString().trim().slice(0, 150)
  if (!title || isGenericTitle(title)) return null
  let deadline = ''
  if (data.deadline) {
    const d = new Date(data.deadline)
    if (!isNaN(d.getTime())) deadline = d.toISOString().split('T')[0]
    else deadline = parseSearchDate(String(data.deadline)) || ''
  }
  if (isEnded(deadline, title)) return null
  const company = (data.company || '').toString() || ''
  const opp: NormalizedOpportunity = {
    type: 'INTERNSHIP',
    title,
    description: cleanDescription(data.description || stripped6k.slice(0, 2000), { title, source: 'OTHER_INTERNSHIP' }),
    url,
    source: 'OTHER_INTERNSHIP',
    organizer: company,
    deadline,
    startDate: data.startDate ? String(data.startDate).split('T')[0] : '',
    duration: data.duration || '',
    location: data.location || '',
    mode: data.mode || 'REMOTE',
    prizePool: '',
    stipend: data.stipend || '',
    company,
    role: (data.role || title).toString(),
    themes: [],
    website: '',
    discord: '',
    participantsCount: 0,
    inviteOnly: false,
  }

  return opp
}

