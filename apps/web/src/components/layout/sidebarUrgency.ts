/**
 * Sidebar urgency helper — single source of truth for deadline badges.
 *
 * WHY this exists (plan-sidebar-deadlines F4/F5/F6):
 * - Contests badge read `cc.startDate` but canonical field is `startTime`
 *   (CalendarPage + CodingContestsPage both use `startTime`).
 * - Forms badge read `expiresAt` only; FormsPage uses `expiresAt || deadline`.
 * - Internships badge checked `status === 'ACTIVE'`; no other entity did —
 *   now every entity has one explicit `isBadgeable` predicate.
 *
 * RULES (§7 final spec):
 * - Single red pill only, 0 = hidden, cap 99+. No overdue split, no weeks.
 * - Assignments = overdue + due ≤3d (students minus submitted).
 * - Hackathons = deadline in (0,3d]; Forms = expiresAt||deadline in (0,3d].
 * - Internships = ACTIVE + deadline in (0,3d]; Contests = LIVE NOW.
 * - Rooms = unread (not a deadline, kept for tooltip consistency).
 * - No new network calls — Layout reuses existing qk.* cache.
 */

export const NEAR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

export const DEFAULT_CONTEST_DURATION_MIN = 180

export type SidebarUrgencyEntity =
  | 'hackathon'
  | 'form'
  | 'internship'
  | 'contest'
  | 'assignment'

/** Resolve the canonical date field per entity (F4/F5 fix). */
export function resolveDate(
  entity: SidebarUrgencyEntity,
  item: any,
): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  switch (entity) {
    case 'hackathon':
      return item.deadline ?? undefined
    case 'form':
      return item.expiresAt || item.deadline || undefined
    case 'internship':
      return item.deadline ?? undefined
    case 'contest':
      return item.startTime || item.startDate || undefined
    case 'assignment':
      return item.dueDate ?? undefined
    default:
      return undefined
  }
}

/** Whether the item can ever earn a badge (F6 fix — one predicate per entity). */
export function isBadgeable(
  entity: SidebarUrgencyEntity,
  item: any,
): boolean {
  if (!item || typeof item !== 'object') return false
  const date = resolveDate(entity, item)
  if (!date) return false
  if (entity === 'internship') return item.status === 'ACTIVE'
  return true
}

/** Due soon: strictly future and within the 3-day window. Overdue excluded. */
export function isNear(
  dateStr: string | undefined | null,
  nowMs: number = Date.now(),
): boolean {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  const diff = t - nowMs
  return diff > 0 && diff <= NEAR_WINDOW_MS
}

/** Live-now check for contests (F4 fix — startTime||startDate, separate from isNear). */
export function isLiveContest(item: any, nowMs: number = Date.now()): boolean {
  const raw = resolveDate('contest', item)
  if (!raw) return false
  const start = new Date(raw).getTime()
  if (Number.isNaN(start)) return false
  const durationMin =
    typeof item?.duration === 'number' && Number.isFinite(item.duration)
      ? item.duration
      : DEFAULT_CONTEST_DURATION_MIN
  const end = start + durationMin * 60000
  return nowMs >= start && nowMs <= end
}

/** Count due-soon items for hackathons/forms/internships. */
export function countNearDeadline(
  list: unknown,
  entity: Exclude<SidebarUrgencyEntity, 'contest' | 'assignment'>,
  nowMs: number = Date.now(),
): number {
  if (!Array.isArray(list)) return 0
  let n = 0
  for (const item of list) {
    if (!isBadgeable(entity, item)) continue
    if (isNear(resolveDate(entity, item), nowMs)) n++
  }
  return n
}

/** Count live-now contests. */
export function countLiveContests(
  list: unknown,
  nowMs: number = Date.now(),
): number {
  if (!Array.isArray(list)) return 0
  let n = 0
  for (const item of list as any[]) {
    if (isLiveContest(item, nowMs)) n++
  }
  return n
}

export type AssignmentUrgency = { count: number; hasOverdue: boolean }

/**
 * Assignments urgency: overdue + due ≤3d.
 * WHY students skip submitted: mySubmission present means no action needed,
 * so the badge never nags for done work.
 */
export function countAssignmentUrgent(
  hubs: unknown,
  opts: { isStudent?: boolean; nowMs?: number } = {},
): AssignmentUrgency {
  if (!Array.isArray(hubs)) return { count: 0, hasOverdue: false }
  const now = opts.nowMs ?? Date.now()
  let overdue = 0
  let dueSoon = 0
  for (const h of hubs as any[]) {
    const raw = resolveDate('assignment', h)
    if (!raw) continue
    const due = new Date(raw).getTime()
    if (Number.isNaN(due)) continue
    const diff = due - now
    const isOverdue = diff < 0
    const isDueSoon = diff >= 0 && diff <= NEAR_WINDOW_MS
    if (!isOverdue && !isDueSoon) continue
    if (opts.isStudent && (h as any)?.mySubmission) continue
    if (isOverdue) overdue++
    else dueSoon++
  }
  return { count: overdue + dueSoon, hasOverdue: overdue > 0 }
}

/** Cap badge text at 99+ (single red pill rule). */
export function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

const BASE_LABELS: Record<string, string> = {
  '/assignments': 'Assignments',
  '/hackathons': 'Hackathons',
  '/contests': 'Contests',
  '/internships': 'Internships',
  '/forms': 'Forms',
  '/rooms': 'Rooms',
}

/**
 * Tooltip + aria-label strings for all 6 pills (§7).
 * WHY one function: title and aria-label must never drift apart (F9 fix).
 * Returns the plain section label when count is 0 (badge hidden).
 */
export function getSidebarBadgeLabel(path: string, count: number): string {
  const base = BASE_LABELS[path] ?? path
  if (!count || count <= 0) return base
  switch (path) {
    case '/assignments':
      return `Assignments \u2014 ${count} due soon or overdue`
    case '/hackathons':
      return `Hackathons \u2014 ${count} closing within 3 days`
    case '/contests':
      return `Contests \u2014 ${count} live now`
    case '/internships':
      return `Internships \u2014 ${count} closing within 3 days`
    case '/forms':
      return `Forms \u2014 ${count} closing within 3 days`
    case '/rooms':
      return `Rooms \u2014 ${count} unread`
    default:
      return base
  }
}

/**
 * Per-role flat path order — deadlines first within kept sections (§7).
 * WHY flat paths (not JSX): tests lock order without importing React.
 * Layout.tsx navByRole MUST flatten to these arrays in order.
 */
export const SIDEBAR_PATH_ORDER: Record<string, string[]> = {
  STUDENT: [
    '/dashboard',
    '/assignments',
    '/tasks',
    '/schedule',
    '/attendance',
    '/grades',
    '/hackathons',
    '/contests',
    '/internships',
    '/coding-profile',
    '/forms',
    '/rooms',
    '/calendar',
    '/resume-studio',
    '/portfolio-studio',
  ],
  TEACHER: [
    '/dashboard',
    '/assignments',
    '/tasks',
    '/schedule',
    '/calendar',
    '/hackathons',
    '/contests',
    '/internships',
    '/forms',
    '/rooms',
    '/teacher/opportunities',
    '/contests/leaderboard',
    '/resume-studio',
    '/portfolio-studio',
    '/admin',
  ],
  COLLEGE_ADMIN: [
    '/dashboard',
    '/assignments',
    '/tasks',
    '/schedule',
    '/calendar',
    '/hackathons',
    '/contests',
    '/internships',
    '/forms',
    '/rooms',
    '/admin/opportunities',
    '/contests/leaderboard',
    '/resume-studio',
    '/portfolio-studio',
    '/admin',
    '/reports',
  ],
  SUPER_ADMIN_SCOPED: [
    '/dashboard',
    '/assignments',
    '/tasks',
    '/schedule',
    '/calendar',
    '/hackathons',
    '/contests',
    '/internships',
    '/forms',
    '/rooms',
    '/admin/opportunities',
    '/contests/leaderboard',
    '/resume-studio',
    '/portfolio-studio',
    '/admin',
    '/reports',
  ],
  SUPER_ADMIN: [
    '/superadmin',
    '/superadmin/colleges',
    '/superadmin/reports',
    '/admin/fetch',
    '/admin/ai-manager',
  ],
}
