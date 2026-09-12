// opportunities/reputation.ts — organizer trust scoring (SRP extract).
// WHY: reputation heuristics were inline in the god module; pure here.

import { isGenericTitle } from './text'
import type { NormalizedOpportunity } from './types'

export const DYNAMIC_COMPANY_COLLEGE_INDICATORS = [
  'pvt ltd', 'private limited', 'pvt.', 'pvt', 'inc', 'inc.', 'incorporated',
  'llp', 'ltd', 'limited', 'corp', 'corporation', 'technologies', 'technology',
  'tech', 'systems', 'solutions', 'labs', 'innovations', 'startup', 'ventures',
  'university', 'college', 'institute', 'institution', 'school', 'academy',
  'foundation', 'iit', 'nit', 'iiit', 'bits', 'vit', 'srm', 'manipal',
  'amity', 'christ', 'anna university', 'jntu',
]

export function isCompanyStartupCollegeOrganizer(opts: {
  title?: string
  url?: string
  organizer?: string
  prizePool?: string
}): boolean {
  const organizer = (opts.organizer || '').toLowerCase().trim()
  const title = (opts.title || '').toLowerCase()
  const prize = (opts.prizePool || '').toLowerCase()
  const lowerUrl = (opts.url || '').toLowerCase()

  if (organizer && organizer.length >= 2 && organizer !== 'unknown') {
    for (const ind of DYNAMIC_COMPANY_COLLEGE_INDICATORS) {
      if (organizer.includes(ind)) return true
    }
    if (prize && prize.length > 0 && !isGenericTitle(organizer)) return true
    try {
      const host = new URL(opts.url || 'https://example.com').hostname.toLowerCase()
      const hostToken = host.replace('www.', '').split('.')[0]
      if (hostToken.length > 3 && organizer.includes(hostToken)) return true
    } catch { /* ignore URL parse */ }
  }

  for (const ind of DYNAMIC_COMPANY_COLLEGE_INDICATORS) {
    if (title.includes(ind)) return true
  }

  if (lowerUrl.includes('.edu') || lowerUrl.includes('.ac.in') || lowerUrl.includes('university') || lowerUrl.includes('college')) {
    if (title.includes('hackathon') || title.includes('hack')) return true
  }

  if (prize && /(₹|\$|prize|cash|award|lakh|crore|usd|inr)/i.test(prize) && prize.length > 2) {
    if (organizer.length > 2 || title.includes('hackathon')) return true
  }

  const isBlogAggregator =
    lowerUrl.includes('hackindia.org') ||
    lowerUrl.includes('placementpreps') ||
    lowerUrl.includes('medium.com') ||
    lowerUrl.includes('listchallenges')
  if (!isBlogAggregator && lowerUrl) {
    const knownAggregators = ['devfolio.co', 'unstop.com', 'devpost.com', 'mlh.io', 'internshala.com']
    const isKnownAggregator = knownAggregators.some((d) => lowerUrl.includes(d))
    if (!isKnownAggregator && organizer.length > 2 && !isGenericTitle(organizer)) {
      return true
    }
  }

  return false
}

export function isHighValueHackathon(opts: { title?: string; url?: string; organizer?: string; prizePool?: string }): boolean {
  return isCompanyStartupCollegeOrganizer(opts)
}

export function getHackathonReputationScore(opts: {
  title?: string
  url?: string
  organizer?: string
  prizePool?: string
}): number {
  let score = 0
  const combined = `${opts.title || ''} ${opts.organizer || ''}`.toLowerCase()
  const lowerUrl = (opts.url || '').toLowerCase()
  const prize = (opts.prizePool || '').toLowerCase()
  for (const ind of DYNAMIC_COMPANY_COLLEGE_INDICATORS) {
    if (combined.includes(ind)) score += 10
    if (lowerUrl.includes(ind.replace(/\s+/g, '').replace('.', ''))) score += 6
  }
  if (prize && /(prize|cash|₹|\$|lakh|crore)/i.test(prize)) score += 15
  if (lowerUrl.includes('.edu') || lowerUrl.includes('.ac.in')) score += 12
  if (combined.includes('hackathon')) score += 2
  if (opts.organizer && opts.organizer.trim().length > 2 && !isGenericTitle(opts.organizer)) score += 5
  return score
}

export function applyHighOrganizerTrustBoost(opp: NormalizedOpportunity, _stripped?: string): void {
  const isHigh = isCompanyStartupCollegeOrganizer({
    title: opp.title,
    url: opp.url,
    organizer: opp.organizer,
    prizePool: opp.prizePool,
  })
  if (!isHigh) return
  if (!opp.organizer || opp.organizer.trim().length < 2 || opp.organizer.toLowerCase() === 'unknown') {
    try {
      const host = new URL(opp.url).hostname.replace('www.', '')
      const base = host.split('.')[0]
      const genericHosts = ['duckduckgo', 'google', 'bing', 'devfolio', 'unstop', 'devpost', 'mlh', 'internshala', 'medium', 'placementpreps', 'hackindia']
      if (base && base.length > 2 && !genericHosts.some((g) => host.includes(g))) {
        opp.organizer = base.charAt(0).toUpperCase() + base.slice(1)
      }
    } catch { /* ignore */ }
    if ((!opp.organizer || opp.organizer.trim().length < 2) && opp.title.toLowerCase().includes(' by ')) {
      const byPart = opp.title.split(/ by /i).pop()?.trim().split(' ').slice(0, 4).join(' ') || ''
      if (byPart.length > 2 && byPart.length < 40 && !isGenericTitle(byPart)) opp.organizer = byPart
    }
  }
}
