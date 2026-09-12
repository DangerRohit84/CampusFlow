// opportunities/types.ts — ISP split for NormalizedOpportunity (Track 4).
// WHY: 19-field flat interface forced every fetcher to fabricate ''/0/false
// (stipend:'', participantsCount:0...). Split into focused interfaces with
// optional fields; NormalizedOpportunity kept as compat alias (deprecated).
// New code should use BaseOpportunity + HackathonDetails | InternshipDetails.

export interface BaseOpportunity {
  type: string
  title: string
  description: string
  url: string
  source: string
}

export interface HackathonDetails {
  organizer?: string
  deadline?: string
  startDate?: string
  duration?: string
  location?: string
  mode?: string
  prizePool?: string
  themes?: string[]
  website?: string
  discord?: string
  participantsCount?: number
  inviteOnly?: boolean
  // Rich detail fields (fix-fetch-all-parsers): all optional, omit when absent
  // (never invent ₹0 / 0-rounds). Backward-compatible: existing callers omit.
  prizeTiers?: string[]
  perks?: string[]
  teamSize?: number | null
  eligibility?: string
  venue?: string
  judging?: string
  schedule?: string
  stages?: Array<{ title: string; date?: string }>
  dates?: Array<{ label: string; date: string }>
}

export interface InternshipDetails {
  company?: string
  role?: string
  stipend?: string
  location?: string
  mode?: string
  duration?: string
  deadline?: string
  startDate?: string
  website?: string
}

/** Focused hackathon opportunity (preferred for new code). */
export type HackathonOpportunity = BaseOpportunity & HackathonDetails & { type: 'hackathon' | string }
/** Focused internship opportunity (preferred for new code). */
export type InternshipOpportunity = BaseOpportunity & InternshipDetails & { type: 'internship' | string }

/**
 * Compat flat type — preserved so existing fetchers/routes keep compiling.
 * Rich fields are OPTIONAL (fix-fetch-all-parsers): omit when absent,
 * never fake ₹0/0-rounds. Existing required fields unchanged.
 * @deprecated Use BaseOpportunity + HackathonDetails/InternshipDetails.
 */
export interface NormalizedOpportunity {
  type: string
  title: string
  description: string
  url: string
  source: string
  organizer: string
  deadline: string
  startDate: string
  duration: string
  location: string
  mode: string
  prizePool: string
  stipend: string
  company: string
  role: string
  themes: string[]
  website: string
  discord: string
  participantsCount: number
  inviteOnly: boolean
  prizeTiers?: string[]
  perks?: string[]
  teamSize?: number | null
  eligibility?: string
  venue?: string
  judging?: string
  schedule?: string
  stages?: Array<{ title: string; date?: string }>
  dates?: Array<{ label: string; date: string }>
}

/** Build a compat NormalizedOpportunity from focused parts (fills defaults). */
export function toNormalized(base: BaseOpportunity, details: HackathonDetails & InternshipDetails = {}): NormalizedOpportunity {
  const out: NormalizedOpportunity = {
    type: base.type,
    title: base.title,
    description: base.description,
    url: base.url,
    source: base.source,
    organizer: details.organizer ?? '',
    deadline: details.deadline ?? '',
    startDate: details.startDate ?? '',
    duration: details.duration ?? '',
    location: details.location ?? '',
    mode: details.mode ?? '',
    prizePool: details.prizePool ?? '',
    stipend: details.stipend ?? '',
    company: details.company ?? '',
    role: details.role ?? '',
    themes: details.themes ?? [],
    website: details.website ?? '',
    discord: details.discord ?? '',
    participantsCount: details.participantsCount ?? 0,
    inviteOnly: details.inviteOnly ?? false,
  }
  // Rich optional fields: only set when present (omit absent, never fake).
  const rich = details as HackathonDetails
  if (rich.prizeTiers?.length) out.prizeTiers = rich.prizeTiers
  if (rich.perks?.length) out.perks = rich.perks
  if (rich.teamSize !== undefined && rich.teamSize !== null) out.teamSize = rich.teamSize
  if (rich.eligibility) out.eligibility = rich.eligibility
  if (rich.venue) out.venue = rich.venue
  if (rich.judging) out.judging = rich.judging
  if (rich.schedule) out.schedule = rich.schedule
  if (rich.stages?.length) out.stages = rich.stages
  if (rich.dates?.length) out.dates = rich.dates
  return out
}

/** True when a value is meaningfully present (not ''/'[]'/'unknown'). */
export function hasValue(val: unknown): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string') {
    const t = val.trim()
    return t.length > 0 && t !== '[]' && t.toLowerCase() !== 'unknown'
  }
  if (Array.isArray(val)) return val.length > 0
  return !!val
}

// ─── Narrow guards + mappers (I-4: migrate fetchers off compat fat type) ───
// New fetchers SHOULD return HackathonOpportunity | InternshipOpportunity.
// Existing fetchers still return NormalizedOpportunity (compat); these helpers
// bridge without fake defaults leaking into new code.

export function isHackathonOpportunity(o: BaseOpportunity): o is HackathonOpportunity {
  return String((o as { type?: unknown }).type || '').toUpperCase() === 'HACKATHON'
}

export function isInternshipOpportunity(o: BaseOpportunity): o is InternshipOpportunity {
  return String((o as { type?: unknown }).type || '').toUpperCase() === 'INTERNSHIP'
}

/** Narrow a compat record to hackathon details (drops internship-only fields). */
export function toHackathonDetails(n: NormalizedOpportunity): HackathonOpportunity {
  const out: HackathonOpportunity = {
    type: n.type,
    title: n.title,
    description: n.description,
    url: n.url,
    source: n.source,
    organizer: n.organizer || undefined,
    deadline: n.deadline || undefined,
    startDate: n.startDate || undefined,
    duration: n.duration || undefined,
    location: n.location || undefined,
    mode: n.mode || undefined,
    prizePool: n.prizePool || undefined,
    themes: n.themes,
    website: n.website || undefined,
    discord: n.discord || undefined,
    participantsCount: n.participantsCount,
    inviteOnly: n.inviteOnly,
  }
  if (n.prizeTiers?.length) out.prizeTiers = n.prizeTiers
  if (n.perks?.length) out.perks = n.perks
  if (n.teamSize !== undefined && n.teamSize !== null) out.teamSize = n.teamSize
  if (n.eligibility) out.eligibility = n.eligibility
  if (n.venue) out.venue = n.venue
  if (n.judging) out.judging = n.judging
  if (n.schedule) out.schedule = n.schedule
  if (n.stages?.length) out.stages = n.stages
  if (n.dates?.length) out.dates = n.dates
  return out
}

/** Narrow a compat record to internship details (drops hackathon-only fields). */
export function toInternshipDetails(n: NormalizedOpportunity): InternshipOpportunity {
  return {
    type: n.type,
    title: n.title,
    description: n.description,
    url: n.url,
    source: n.source,
    company: n.company || undefined,
    role: n.role || undefined,
    stipend: n.stipend || undefined,
    location: n.location || undefined,
    mode: n.mode || undefined,
    duration: n.duration || undefined,
    deadline: n.deadline || undefined,
    startDate: n.startDate || undefined,
    website: n.website || undefined,
  }
}
