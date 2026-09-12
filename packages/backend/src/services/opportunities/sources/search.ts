// opportunities/sources/search.ts — compat barrel (SRP split).
// WHY: was a 1086-line god (DDG discovery + AI extract/explode + Other
// orchestrators in one file). Split:
//   searchFetch.ts   — decode/slugify/DDG/generic discovery
//   searchExtract.ts — aiExtractSingle*/aiExplode* (AI + fallback)
//   searchOther.ts   — fetchOtherHackathons/fetchOtherInternships (orchestration)
// This barrel preserves all legacy imports (`from './search'` / `'../search'`).
// New code SHOULD import from the focused file directly. AbortSignal preserved.
//
// NO-CYCLE RULE (M-5): platform fetchers MUST import from './context' or
// './searchFetch' (leaves), NEVER from this barrel — otherwise
// searchFetch -> hack2skill -> search(barrel) -> searchFetch cycles.
// stages.ts SHOULD import AI helpers from './searchExtract' directly.

export { fetchPage6k } from './context'
export {
  decodeDuckDuckGoHref,
  slugify,
  fetchGenericViaSearch,
  fetchDuckDuckGoHumanUrls,
} from './searchFetch'
export {
  aiExtractSingleHackathon,
  aiExplodeAggregatedHackathons,
  aiExtractSingleInternship,
} from './searchExtract'
export { fetchOtherHackathons, fetchOtherInternships } from './searchOther'
