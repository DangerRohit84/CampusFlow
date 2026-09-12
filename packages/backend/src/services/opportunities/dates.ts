// opportunities/dates.ts — date helpers SSOT (SRP).
// WHY: extractPastYearFromTitle/isTitlePastYear/inferDeadlineFromTitle/isEnded
// were duplicated between opportunityAgent.ts and routes/hackathons.ts
// (isStagingEnded). Single source here; both import it.

export function extractPastYearFromTitle(title?: string | null): number | null {
  if (!title) return null
  const m = String(title).match(/\b(20\d{2})\b/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  if (Number.isNaN(y)) return null
  if (y < 1900 || y > 2100) return null
  return y
}

export function isTitlePastYear(title?: string | null): boolean {
  const y = extractPastYearFromTitle(title)
  if (y === null) return false
  return y < new Date().getFullYear()
}

export function inferDeadlineFromTitle(title: string, fallbackUrl?: string): string {
  let y = extractPastYearFromTitle(title)
  if (y === null && fallbackUrl) {
    const m = String(fallbackUrl).match(/\b(20\d{2})\b/)
    if (m) {
      const yy = parseInt(m[1], 10)
      if (!Number.isNaN(yy) && yy >= 2020 && yy <= 2030) y = yy
    }
  }
  if (y !== null && y < new Date().getFullYear()) {
    return `${y}-12-31`
  }
  return ''
}

export function isEnded(deadlineStr?: string | null, title?: string | null): boolean {
  if (deadlineStr) {
    try {
      const d = new Date(deadlineStr)
      if (!Number.isNaN(d.getTime())) {
        if (d.getTime() < Date.now()) return true
        return false
      }
    } catch { /* fall through to title inference */ }
  }
  if (isTitlePastYear(title)) return true
  return false
}

/**
 * ADMIN STAGING predicate (compat with routes/hackathons.ts isStagingEnded).
 * Never hides on deadline — admin must review recently-expired pending
 * (e.g. Cognition 2026-08-22). Only stale null-deadline past-year titles hide.
 */
export function isStagingEnded(_deadline: Date | null | undefined, title?: string | null): boolean {
  if (isTitlePastYear(title)) return true
  if (title && title.toLowerCase().includes('netscout') && title.includes('2025')) return true
  return false
}

export function formatLocalDate(d: Date): string {
  try {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return ''
  }
}

/**
 * DB-side past-year exclusion for staging list (C-6 fix without migration).
 * Prisma cannot regex-extract year from title, but it CAN exclude known past
 * years via `NOT contains`. For current year Y, exclude Y-6..Y-1 titles.
 * Keeps recently-expired (same-year) rows visible for admin review.
 */
export function pastYearExclusionWhere(currentYear = new Date().getFullYear()): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = []
  for (let y = currentYear - 6; y < currentYear; y++) {
    clauses.push({ title: { contains: String(y) } })
  }
  if (clauses.length === 0) return []
  // Caller spreads as: AND: [{ NOT: { OR: [...] } }]
  return clauses
}

/** Build `NOT past-year` Prisma fragment: { NOT: { OR: [{title:{contains:'2025'}}, ...] } } */
export function notPastYearWhere(currentYear = new Date().getFullYear()): Record<string, unknown> | null {
  const ors = pastYearExclusionWhere(currentYear)
  if (ors.length === 0) return null
  return { NOT: { OR: ors } }
}
