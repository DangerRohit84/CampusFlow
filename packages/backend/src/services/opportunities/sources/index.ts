// opportunities/sources/index.ts — barrel for platform fetchers (Track 4 C-3 split).
// WHY: one import site for orchestrators; new platform = new file + one line
// here + one registerPlatform() in opportunityAgent.ts. Explicit named exports only
// (no `export *`: searchFetch keeps verbatim local decodeDuckDuckGoHref/slugify
// copies that would collide with text.ts under star-export).
// Canonical homes after search split: searchFetch (discovery), searchExtract (AI),
// searchOther (orchestration); './search' barrel re-exports all three for compat.

export { fetchDevfolio, fetchDevfolioPage, fetchDevfolioFromHTML } from './devfolio'
export { fetchInternshala, fetchInternshalaPage, fetchInternshalaDetail } from './internshala'
export { fetchDevpost, fetchDevpostPage, parseDevpostDate } from './devpost'
export { fetchMLH, resolveMLHEventUrl, isMLHTestEvent } from './mlh'
export { fetchUnstop, fetchUnstopInternships, isGenericUnstopTotalTier, cleanUnstopPerks } from './unstop'
export {
  fetchHack2Skill,
  fetchHack2SkillApiPage,
  fetchHack2SkillRegistrationEnd,
  fetchHack2SkillEventMode,
  mapHack2SkillModeValue,
  deriveHack2SkillModeFromDetails,
  extractHack2SkillTimeline,
  fetchHack2SkillTimeline,
  extractHack2SkillPrizes,
  extractHack2SkillDescription,
  extractHack2SkillTeamSize,
  extractHack2SkillOrganizer,
  extractHack2SkillTitleValue,
  extractHack2SkillSlug,
  fetchHack2SkillRichFields,
} from './hack2skill'
export { fetchDoraHacks, fetchDoraHacksPage, parseDoraHacksTimeline, extractDoraHacksOrganizer } from './dorahacks'
export { fetchHackerEarth, fetchHackerEarthPage, isHackerEarthEventUrl } from './hackerearth'
export { fetchWellfoundInternships, fetchWellfoundPage, buildWellfoundPageUrls, isGenericWellfoundRemotePage, isWellfoundInternTitle } from './wellfound'
export { fetchReskilllPage, buildReskilllListingUrl, isReskilllHackUrl, RESKILLL_LISTING_BASE } from './reskilll'
export {
  fetchPage6k,
  fetchGenericViaSearch,
  fetchDuckDuckGoHumanUrls,
  decodeDuckDuckGoHref,
  slugify,
  aiExtractSingleHackathon,
  aiExplodeAggregatedHackathons,
  aiExtractSingleInternship,
  fetchOtherHackathons,
  fetchOtherInternships,
} from './search'
export { isDuckDuckGoAnomalyPage } from './searchFetch'
export { UA, MAX_PAGES, PER_PAGE, GROQ_PLACEHOLDERS } from './context'
export {
  cleanDescription,
  formatUnstopPrizes,
  extractTeamSize,
  extractExplicitTeamSize,
  resolveUnstopTeamSize,
  cleanTierLabel,
  extractEligibility,
  extractVenueMode,
  extractJudging,
  extractScheduleText,
  extractStages,
  extractPrizeTiers,
  hasFakePrizeDefault,
  isGenericFallbackDescription,
  extractISORegistrationEnd,
  hasReskilllClosedBadge,
} from './details'
