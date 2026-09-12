// opportunities/index.ts — barrel (SSOT export map for opportunity domain).
// Import from here in new code; opportunityAgent.ts re-exports for compat.
// Export map:
//   types: BaseOpportunity, HackathonDetails, InternshipDetails,
//          HackathonOpportunity, InternshipOpportunity,
//          NormalizedOpportunity (compat), toNormalized, hasValue
//   text: stripHtml, isGenericTitle, slugify, normalizeTitleKey, decodeDuckDuckGoHref
//   dates: extractPastYearFromTitle, isTitlePastYear, inferDeadlineFromTitle,
//          isEnded, isStagingEnded, formatLocalDate, notPastYearWhere
//   reputation: isCompanyStartupCollegeOrganizer, isHighValueHackathon,
//          getHackathonReputationScore, applyHighOrganizerTrustBoost
//   cache: RateLimitGate, createScrapeCache, scrapeCache, aiRateGate,
//          isAiGloballyRateLimited, markAiRateLimited
//   dedup: filterNewByTitleSource, dedupInMemory, prismaDedupStore (+ types)
//   registry: PlatformFetcher, registerPlatformFetcher, getPlatformFetcher,
//          listPlatforms, platformFetcherMap
//   pipeline: fanOut, filterActiveUnique, chunk

export * from './types'
export * from './text'
export * from './dates'
export * from './reputation'
export * from './cache'
export * from './dedup'
export * from './registry'
export * from './pipeline'
export * from './errors'
export * from './stages'
export * from './staging'
export {
  fetchDevfolio,
  fetchInternshala,
  fetchDevpost,
  fetchMLH,
  fetchUnstop,
  fetchUnstopInternships,
  fetchHack2Skill,
  fetchHack2SkillRegistrationEnd,
  fetchDoraHacks,
  fetchHackerEarth,
  fetchWellfoundInternships,
  fetchReskilllPage,
  fetchOtherHackathons,
  fetchOtherInternships,
} from './sources/index'
