// opportunities/sources/unstop.ts — Unstop hackathon + internship fetchers (Track 4 C-3 split).
// WHY: search-result API + sitemap paging, one home.
// Moved verbatim from opportunityAgent.ts; AbortSignal timeouts preserved.
import prisma from '../../../config/db'
import { searchDetails, parseSearchDate, extractDeadlineFromContent, hasRegistrationClosedIndicator } from '../../../utils/search'
import { validateExternalUrl } from '../../../utils/secureUrl'
import { logger } from '../../../utils/logger'
import { scrapeCache } from '../cache'
import type { NormalizedOpportunity } from '../types'
import { hasValue } from '../types'
import { stripHtml, isGenericTitle } from '../text'
import { extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle, isEnded } from '../dates'
import { isCompanyStartupCollegeOrganizer, getHackathonReputationScore, applyHighOrganizerTrustBoost, DYNAMIC_COMPANY_COLLEGE_INDICATORS } from '../reputation'
import { UA, MAX_PAGES, PER_PAGE } from './context'
import {
  cleanDescription,
  formatUnstopPrizes,
  extractEligibility,
  extractVenueMode,
  extractJudging,
  extractScheduleText,
  extractStages,
  extractPrizeTiers,
  resolveUnstopTeamSize,
} from './details'

// ─── Unstop MEDIUMs (2026-09-10 generic total-pool + perks-bleed, safe parts) ───
// Pure, no network/DB. Total-pool summary is not a tier (keep amount in prizePool,
// drop from tiers); perks bleed (Rules/Guidelines/...) never real perks.
export function isGenericUnstopTotalTier(tier: unknown): boolean {
  if (typeof tier !== 'string') return false
  return /^\s*total\b/i.test(tier.trim())
}
export function cleanUnstopPerks(perks: unknown): string[] {
  if (!Array.isArray(perks)) return []
  return (perks as unknown[])
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length >= 3)
    .filter((p) => !/\b(rules?|guidelines?|requirements?|rounds?)\b/i.test(p))
    .map((p) => p.slice(0, 60))
    .slice(0, 10)
}

// ─── Unstop: JSON API for hackathons ──────────────────────────────
export async function fetchUnstop(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const newItems: NormalizedOpportunity[] = []
  try {
    for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
      const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=${PER_PAGE}&oppstatus=open&page=${page}`
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) break
      const data = await response.json() as any
      const items = data.data?.data || []
      if (items.length === 0) break

      const pageOpps: NormalizedOpportunity[] = []
      for (const h of items) {
        const link = `https://unstop.com/${h.public_url || ''}`
        const regnReqs = h.regnRequirements || {}
        const address = h.address_with_country_logo || {}
        const org = h.organisation || {}

        // Shared rich-field rules (fix-fetch-all-parsers): full description,
        // multi-tier prizes without ₹0, team/eligibility/venue/judging/schedule/stages.
        const rawDetails: string = typeof h.details === 'string' ? h.details : ''
        const titleStr: string = (h.title || '').toString().trim()
        const description = cleanDescription(rawDetails, { title: titleStr, source: 'UNSTOP' })
        const detailsText = stripHtml(rawDetails).replace(/\s+/g, ' ').trim()
        const prizePool = formatUnstopPrizes(h.prizes)
        // Team size: prefer explicit min/max over body mining; conflict omits (honest-omit).
        const teamSize = resolveUnstopTeamSize(regnReqs, detailsText)
        const eligibility = extractEligibility(detailsText)
        const venueMode = extractVenueMode(detailsText, { city: address.city || '' })
        const judging = extractJudging(detailsText)
        const schedule = extractScheduleText(detailsText)
        const stages = extractStages(detailsText)
        const textPrizes = extractPrizeTiers(detailsText)
        // Prefer API prizes; supplement tiers/perks from text when API omits them.
        // Dedupe by amount digits (clean labels may differ for same amount — e.g. API "Prize Pool" vs text "Prize").
        // MEDIUM 2026-09-10 generic total-pool fix (safe part): `Total Prize Pool /
        // Total Pool` is a summary, not a tier — drop it from tiers (prizePool string
        // keeps the amount via formatUnstopPrizes/textPrizes.prizePool). Keeps at
        // least one tier when all are total-only (never omit all).
        const prizeTiers = (() => {
          const fromApi = Array.isArray(h.prizes)
            ? (h.prizes as any[]).filter((p: any) => Number(p?.cash) > 0).map((p: any) => `${String(p.rank || 'Prize').trim()}: ₹${Number(p.cash).toLocaleString('en-IN')}`)
            : []
          const seen = new Set(fromApi.map((t) => (t.match(/₹([\d,]+)/) || [])[1]?.replace(/,/g, '')).filter(Boolean));
          const merged = [...fromApi]
          for (const t of textPrizes.tiers) {
            const amt = (t.match(/₹([\d,]+)/) || [])[1]?.replace(/,/g, '');
            if (amt && seen.has(amt)) continue; // same amount already covered by API — skip dirty dup
            if (!merged.includes(t)) {
              merged.push(t);
              if (amt) seen.add(amt);
            }
          }
          // Perks bleed guard (safe part): drop perk fragments that are section
          // bleed (`Rules`, `Guidelines`, `Requirements`, `Rounds` absorbed when
          // the terminator missed a header variant). Real perks (Goodies,
          // Certificates, Internship) never contain those words.
          const cleanPerksSource = cleanUnstopPerks(textPrizes.perks || [])
          // Filter generic total-pool tiers (keep amount in prizePool, not tiers).
          const filtered = merged.filter((t) => !isGenericUnstopTotalTier(t))
          const finalTiers = filtered.length ? filtered : merged
          return { tiers: finalTiers.length ? finalTiers : undefined, perksSource: cleanPerksSource }
        })()
        const perks = prizeTiers.perksSource.length ? prizeTiers.perksSource : undefined
        const finalTiers = prizeTiers.tiers
        const finalPrizePool = prizePool || textPrizes.prizePool || ''
        const apiMode = regnReqs.work_location_type === 'online' ? 'ONLINE'
          : (address.city ? 'OFFLINE' : 'ONLINE')
        // Venue refines location/mode only when details carry explicit venue cues.
        const location = venueMode.venue || address.city || ''
        const mode = venueMode.venue ? venueMode.mode : apiMode
        const startDate = regnReqs.start_regn_dt
          ? String(regnReqs.start_regn_dt).split('T')[0]
          : (h.start_date ? String(h.start_date).split('T')[0] : '')
        const deadline = regnReqs.end_regn_dt || ''
        const dates = (() => {
          const d: Array<{ label: string; date: string }> = []
          if (startDate) d.push({ label: 'registration_start', date: startDate })
          if (deadline) d.push({ label: 'registration_end', date: String(deadline).split('T')[0] })
          return d.length ? d : undefined
        })()

        const opp: NormalizedOpportunity = {
          type: 'HACKATHON',
          title: titleStr,
          description,
          url: link,
          source: 'UNSTOP',
          organizer: org.name || '',
          deadline,
          startDate,
          duration: regnReqs.remainingDaysArray?.text || '',
          location,
          mode,
          prizePool: finalPrizePool,
          stipend: '',
          company: org.name || '',
          role: '',
          themes: [],
          website: '',
          discord: '',
          participantsCount: h.participants_count || 0,
          inviteOnly: false,
        }
        if (finalTiers) opp.prizeTiers = finalTiers
        if (perks) opp.perks = perks
        if (teamSize !== null) opp.teamSize = teamSize
        if (eligibility) opp.eligibility = eligibility
        if (venueMode.venue) opp.venue = venueMode.venue
        if (judging) opp.judging = judging
        if (schedule) opp.schedule = schedule
        if (stages.length) opp.stages = stages
        if (dates) opp.dates = dates
        pageOpps.push(opp)
      }

      // Batch dedup via DB for this page
      const titles = pageOpps.map(p => p.title).filter(Boolean)
      let existingTitles = new Set<string>()
      if (titles.length) {
        try {
          const existing = await prisma.hackathonStaging.findMany({
            where: { title: { in: titles }, source: 'UNSTOP' },
            select: { title: true },
          })
          existing.forEach(e => existingTitles.add(e.title))
        } catch {}
      }

      for (const opp of pageOpps) {
        if (newItems.length >= target) break
        if (!opp.title) continue
        if (existingTitles.has(opp.title)) continue
        if (isEnded(opp.deadline, opp.title)) continue
        newItems.push(opp)
      }
      if (newItems.length >= target) break
    }
    const sliced = target === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, target)
    logger.info(`[Unstop] Fetched ${sliced.length} hackathons (target ${limit || 'all'}) capped at ${MAX_PAGES} pages per_page ${PER_PAGE}`)
    return sliced
  } catch (error) {
    logger.error({ err: error }, 'Unstop fetch error:')
    return newItems.slice(0, target === Number.MAX_SAFE_INTEGER ? undefined : target)
  }
}

// --- Unstop Internships: Fixed platform for internships (Unstop internships API) ---
export async function fetchUnstopInternships(limit?: number): Promise<NormalizedOpportunity[]> {
  const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER
  const newItems: NormalizedOpportunity[] = []
  try {
    for (let page = 1; page <= MAX_PAGES && newItems.length < target; page++) {
      const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=internships&per_page=${PER_PAGE}&oppstatus=open&page=${page}`
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) break
      const data = (await response.json()) as any
      const items: any[] = data.data?.data || []
      if (items.length === 0) break
      const pageOpps: NormalizedOpportunity[] = []
      for (const h of items) {
        const link = `https://unstop.com/${h.public_url || ''}`
        const regnReqs: any = h.regnRequirements || {}
        const address: any = h.address_with_country_logo || {}
        const org: any = h.organisation || {}
        const jobDetail: any = h.jobDetail || {}
        const title: string = (h.title || '').toString().trim()
        if (!title) continue
        let stipend = ''
        if (jobDetail && jobDetail.show_salary !== 0 && (jobDetail.min_salary || jobDetail.max_salary)) {
          const cur = jobDetail.currency === 'fa-rupee' ? '₹' : jobDetail.currency === 'fa-dollar' ? '$' : jobDetail.currency === '₹' || jobDetail.currency === '$' ? jobDetail.currency : '₹'
          const min = jobDetail.min_salary ? String(jobDetail.min_salary) : ''
          const max = jobDetail.max_salary ? String(jobDetail.max_salary) : ''
          const payIn = jobDetail.pay_in ? `/${jobDetail.pay_in}` : '/month'
          if (min && max && min !== max) stipend = `${cur}${min}-${cur}${max}${payIn}`
          else if (max) stipend = `${cur}${max}${payIn}`
          else if (min) stipend = `${cur}${min}${payIn}`
          if (jobDetail.not_disclosed) stipend = 'Not disclosed'
          else if (jobDetail.paid_unpaid === 'unpaid') stipend = 'Unpaid'
        }
        let duration = ''
        if (h.duration) duration = String(h.duration)
        else if (typeof h.details === 'string') {
          const dm = h.details.match(/(\d+\s*(?:months?|weeks?|days?))/i)
          if (dm) duration = dm[0]
        }
        let location = ''
        if (address.city) location = address.city
        else if (address.state) location = address.state
        else if (h.region) location = String(h.region)
        else if (Array.isArray(jobDetail.locations) && jobDetail.locations.length) location = jobDetail.locations.join(', ')
        let mode = 'REMOTE'
        const wlt = String(regnReqs.work_location_type || jobDetail.type || '').toLowerCase()
        if (wlt === 'wfh' || wlt === 'remote' || wlt === 'online' || wlt === 'pan_india' || !location) mode = 'REMOTE'
        else if (wlt === 'city' || wlt === 'offline' || location) mode = 'OFFLINE'
        if (mode === 'OFFLINE' && (!location || location.trim() === '')) mode = 'REMOTE'
        const deadline: string = regnReqs.end_regn_dt || h.end_date || ''
        const startDate: string = regnReqs.start_regn_dt || h.start_date || ''
        // MEDIUM 2026-09-10 Unknown fix (safe part): honest-omit '' when no org
        // (old `'Unknown'` leaked as real company; hasValue already treats
        // `unknown` as empty, `''` is cleaner + matches Internshala fix).
        const company: string = org.name || h.company || ''
        const role: string = title.split(' - ')[0]?.trim() || title
        const themes: string[] = Array.isArray(h.workfunction) ? h.workfunction.map((w: any) => w.name).filter(Boolean) : []
        // Full description (not 400-truncated); omit absent instead of generic fallback.
        const fullDesc = cleanDescription(h.details || '', { title, source: 'UNSTOP_INTERNSHIP' })
        const opp: NormalizedOpportunity = {
          type: 'INTERNSHIP',
          title,
          description: fullDesc,
          url: link,
          source: 'UNSTOP_INTERNSHIP',
          organizer: company,
          deadline,
          startDate: startDate ? String(startDate).split('T')[0] : '',
          duration,
          location,
          mode,
          prizePool: '',
          stipend,
          company,
          role,
          themes,
          website: '',
          discord: '',
          participantsCount: h.registerCount || h.participants_count || 0,
          inviteOnly: false,
        }
        pageOpps.push(opp)
      }
      const titles = pageOpps.map(p => p.title).filter(Boolean)
      let existingTitles = new Set<string>()
      if (titles.length) {
        try {
          const existing = await prisma.internshipStaging.findMany({
            where: { title: { in: titles }, source: 'UNSTOP_INTERNSHIP' },
            select: { title: true },
          })
          existing.forEach(e => existingTitles.add(e.title))
        } catch {}
      }
      for (const opp of pageOpps) {
        if (newItems.length >= target) break
        if (!opp.title || isGenericTitle(opp.title)) continue
        if (existingTitles.has(opp.title)) continue
        if (isEnded(opp.deadline, opp.title)) continue
        newItems.push(opp)
      }
      if (newItems.length >= target) break
    }
    const sliced = target === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, target)
    logger.info(`[Unstop-Internships] Fetched ${sliced.length} internships (target ${limit || 'all'}) capped at ${MAX_PAGES} pages per_page ${PER_PAGE}`)
    return sliced
  } catch (error) {
    logger.error({ err: error }, 'Unstop internships fetch error:')
    return newItems.slice(0, target === Number.MAX_SAFE_INTEGER ? undefined : target)
  }
}
