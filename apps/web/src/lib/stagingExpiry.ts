// stagingExpiry.ts — client-side mirror of backend expiry for staging queue.
// WHY: staging rows are never swept (admin must review recently-expired pending),
// so AdminOpportunitiesPage needs the same isExpiredByDeadline semantics without
// a backend change. Mirrors packages/backend/src/services/opportunities/expiry.ts:
// date-only YYYY-MM-DD = 23:59 IST end-of-day, null/invalid = not expired (fail-open).
// Pure helpers only — easily unit-testable, no DB/network.

function toIstDeadlineMs(dateStr: string): number | null {
  const s = dateStr.trim()
  if (!s) return null
  try {
    if (/T/.test(s)) {
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? null : d.getTime()
    }
    const d = new Date(`${s}T23:59:00+05:30`)
    if (!Number.isNaN(d.getTime())) return d.getTime()
    const fallback = new Date(s)
    return Number.isNaN(fallback.getTime()) ? null : fallback.getTime()
  } catch {
    return null
  }
}

function toExpiryMs(deadline: unknown): number | null {
  if (!deadline) return null
  try {
    if (deadline instanceof Date) {
      return Number.isNaN(deadline.getTime()) ? null : deadline.getTime()
    }
    const s = String(deadline).trim()
    if (!s) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return toIstDeadlineMs(s)
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  } catch {
    return null
  }
}

export function isStagingExpired(
  deadline: Date | string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const expiry = toExpiryMs(deadline)
  if (expiry === null) return false
  return expiry < nowMs
}

export function getExpiredDaysAgo(
  deadline: Date | string | null | undefined,
  nowMs: number = Date.now(),
): number {
  const expiry = toExpiryMs(deadline)
  if (expiry === null || expiry >= nowMs) return 0
  return Math.floor((nowMs - expiry) / (24 * 60 * 60 * 1000))
}

export function formatExpiredLabel(
  deadline: Date | string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!isStagingExpired(deadline, nowMs)) return ''
  const days = getExpiredDaysAgo(deadline, nowMs)
  if (days <= 0) return 'Expired today'
  return `Expired ${days}d ago`
}

export function sortStagingWithExpiredBottom<
  T extends { deadline?: unknown },
>(items: T[], nowMs: number = Date.now()): T[] {
  const fresh: T[] = []
  const expired: Array<{ item: T; expiry: number; index: number }> = []
  items.forEach((item, index) => {
    if (isStagingExpired(item.deadline as Date | string | null | undefined, nowMs)) {
      expired.push({ item, expiry: toExpiryMs(item.deadline) ?? 0, index })
    } else {
      fresh.push(item)
    }
  })
  // Expired bottom sorted deadline desc (newest expired first); stable on ties.
  expired.sort((a, b) => b.expiry - a.expiry || a.index - b.index)
  return [...fresh, ...expired.map((e) => e.item)]
}

// Fresh tabs (pending/all/approved): exclude expired rows.
// WHY: expired has its own Expired tab; pending must NOT show expired.
// Rejected keeps expired (reject keep in reject filter) + expired tab.
// Fast path uses precomputed _isExpired stamp; recompute from deadline when
// stamp is missing/stale (pagination keepPreviousData, mapping gaps).
// Fail-open: null/invalid deadline = fresh (never blank queue).
export function filterStagingFreshOnly<
  T extends { _isExpired?: boolean; deadline?: unknown },
>(items: T[], nowMs: number = Date.now()): T[] {
  return items.filter((item) => {
    if (item._isExpired === true) return false
    if (item._isExpired === false) return true
    if (item.deadline === undefined || item.deadline === null) return true
    try {
      return !isStagingExpired(
        item.deadline as Date | string | null | undefined,
        nowMs,
      )
    } catch {
      // Fail-open: treat as fresh on helper throw (never blank queue).
      return true
    }
  })
}

// Expired tab: only expired rows, newest expired first (deadline desc).
// WHY: pending/all/approved exclude expired; rejected keeps expired AND
// expired tab shows only expired. Rejected expired appears in both rejected
// and expired.
// Fast path uses precomputed _isExpired stamp; recompute from deadline when
// stamp is missing/stale (pagination keepPreviousData, mapping gaps).
export function filterStagingExpiredOnly<
  T extends { _isExpired?: boolean; deadline?: unknown },
>(items: T[], nowMs: number = Date.now()): T[] {
  const expired: Array<{ item: T; expiry: number; index: number }> = []
  items.forEach((item, index) => {
    let isExpired = item._isExpired === true
    if (!isExpired && item.deadline !== undefined) {
      try {
        isExpired = isStagingExpired(
          item.deadline as Date | string | null | undefined,
          nowMs,
        )
      } catch {
        // Fail-open: treat as fresh on helper throw (never blank queue).
        isExpired = false
      }
    }
    if (isExpired) {
      expired.push({ item, expiry: toExpiryMs(item.deadline) ?? 0, index })
    }
  })
  expired.sort((a, b) => b.expiry - a.expiry || a.index - b.index)
  return expired.map((e) => e.item)
}

// Expired rows show only View Details (no Approve/Reject) in every tab.
// WHY: cross-deadline rows are view-only; admin can still see details + badge.
export function canModerateStagingItem(
  item: { _isExpired?: boolean; deadline?: unknown },
  nowMs: number = Date.now(),
): boolean {
  if (item._isExpired === true) return false
  if (item.deadline !== undefined) {
    try {
      if (
        isStagingExpired(
          item.deadline as Date | string | null | undefined,
          nowMs,
        )
      )
        return false
    } catch {
      // Fail-open: allow moderation on helper throw.
    }
  }
  return true
}

function formatDeadlineShort(deadline: unknown): string {
  try {
    const s = deadline instanceof Date ? deadline.toISOString() : String(deadline ?? '').trim()
    if (!s) return 'unknown date'
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      // Noon IST avoids TZ-boundary shifts when formatting in any local TZ.
      const d = new Date(`${s}T12:00:00+05:30`)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      }
      return s
    }
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch {
    return String(deadline ?? 'unknown date')
  }
}

export function buildApproveExpiredMessage(deadline: unknown): string {
  return `Deadline passed (${formatDeadlineShort(deadline)}). Approve anyway?`
}
