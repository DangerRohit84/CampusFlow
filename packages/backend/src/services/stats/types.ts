// services/stats/types.ts — ISP split for PlatformStat (fat-interface fix).
// WHY: 18-optional PlatformStat forced every fetcher to set 3 fields and
// callers to guess required vs optional. Discriminated unions + narrow
// per-platform shapes; PlatformStat kept as compat alias.

export interface BaseStat {
  platform: string
  handle: string
  valid: boolean
}

export interface LeetCodeStat extends BaseStat {
  platform: 'leetcode'
  problemsSolved?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  rankTitle?: string | null
  globalRank?: number | null
}

export interface CodeforcesStat extends BaseStat {
  platform: 'codeforces'
  rating?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  contestCount?: number | null
}

export interface GenericStat extends BaseStat {
  platform: string
  problemsSolved?: number | null
  rating?: number | null
  score?: number | null
  stars?: number | null
  division?: string | null
  badges?: number | null
  contestCount?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
}

/** Compat flat type (existing imports keep working). */
export interface PlatformStat extends BaseStat {
  platform: string
  handle: string
  valid: boolean
  problemsSolved?: number | null
  easySolved?: number | null
  mediumSolved?: number | null
  hardSolved?: number | null
  totalProblems?: number | null
  rating?: number | null
  maxRating?: number | null
  rankTitle?: string | null
  maxRankTitle?: string | null
  globalRank?: number | null
  countryRank?: number | null
  stars?: number | null
  division?: string | null
  score?: number | null
  badges?: number | null
  contestCount?: number | null
}

export type AnyPlatformStat = LeetCodeStat | CodeforcesStat | GenericStat | PlatformStat
