// components/layout/sidebarUrgency.test.ts — locks §7 final spec:
// shared urgency helper (F4/F5/F6) + per-role order maps + tooltip strings.
import { describe, it, expect } from 'vitest'
import {
  NEAR_WINDOW_MS,
  resolveDate,
  isBadgeable,
  isNear,
  isLiveContest,
  countNearDeadline,
  countLiveContests,
  countAssignmentUrgent,
  formatBadgeCount,
  getSidebarBadgeLabel,
  SIDEBAR_PATH_ORDER,
} from './sidebarUrgency'

const NOW = new Date('2026-09-11T10:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

describe('resolveDate', () => {
  it('hackathon uses deadline', () => {
    expect(resolveDate('hackathon', { deadline: '2026-09-12' })).toBe('2026-09-12')
  })
  it('form prefers expiresAt then falls back to deadline', () => {
    expect(resolveDate('form', { expiresAt: 'A', deadline: 'B' })).toBe('A')
    expect(resolveDate('form', { deadline: 'B' })).toBe('B')
    expect(resolveDate('form', {})).toBeUndefined()
  })
  it('internship uses deadline', () => {
    expect(resolveDate('internship', { deadline: '2026-09-12' })).toBe('2026-09-12')
  })
  it('contest prefers startTime then falls back to startDate', () => {
    expect(resolveDate('contest', { startTime: 'A', startDate: 'B' })).toBe('A')
    expect(resolveDate('contest', { startDate: 'B' })).toBe('B')
    expect(resolveDate('contest', {})).toBeUndefined()
  })
  it('assignment uses dueDate', () => {
    expect(resolveDate('assignment', { dueDate: '2026-09-12' })).toBe('2026-09-12')
  })
  it('returns undefined for junk input', () => {
    expect(resolveDate('form', null)).toBeUndefined()
    expect(resolveDate('form', undefined)).toBeUndefined()
    expect(resolveDate('form', 'nope')).toBeUndefined()
  })
})

describe('isBadgeable', () => {
  it('hackathon/form/contest need only a date', () => {
    expect(isBadgeable('hackathon', { deadline: iso(NOW + DAY) })).toBe(true)
    expect(isBadgeable('form', { expiresAt: iso(NOW + DAY) })).toBe(true)
    expect(isBadgeable('form', { deadline: iso(NOW + DAY) })).toBe(true)
    expect(isBadgeable('contest', { startTime: iso(NOW) })).toBe(true)
    expect(isBadgeable('contest', { startDate: iso(NOW) })).toBe(true)
  })
  it('internship requires ACTIVE status', () => {
    expect(isBadgeable('internship', { status: 'ACTIVE', deadline: iso(NOW + DAY) })).toBe(true)
    expect(isBadgeable('internship', { status: 'CLOSED', deadline: iso(NOW + DAY) })).toBe(false)
    expect(isBadgeable('internship', { deadline: iso(NOW + DAY) })).toBe(false)
  })
  it('rejects missing dates and junk', () => {
    expect(isBadgeable('hackathon', {})).toBe(false)
    expect(isBadgeable('form', {})).toBe(false)
    expect(isBadgeable('internship', { status: 'ACTIVE' })).toBe(false)
    expect(isBadgeable('contest', {})).toBe(false)
    expect(isBadgeable('assignment', {})).toBe(false)
    expect(isBadgeable('hackathon', null)).toBe(false)
  })
})

describe('isNear', () => {
  it('accepts future dates within 3 days', () => {
    expect(isNear(iso(NOW + DAY), NOW)).toBe(true)
    expect(isNear(iso(NOW + 2 * DAY), NOW)).toBe(true)
  })
  it('accepts the exact 3-day boundary', () => {
    expect(isNear(iso(NOW + NEAR_WINDOW_MS), NOW)).toBe(true)
  })
  it('rejects overdue and out-of-window dates', () => {
    expect(isNear(iso(NOW - 1000), NOW)).toBe(false)
    expect(isNear(iso(NOW), NOW)).toBe(false)
    expect(isNear(iso(NOW + NEAR_WINDOW_MS + 1), NOW)).toBe(false)
    expect(isNear(iso(NOW + 10 * DAY), NOW)).toBe(false)
  })
  it('rejects empty and invalid dates', () => {
    expect(isNear(undefined, NOW)).toBe(false)
    expect(isNear(null, NOW)).toBe(false)
    expect(isNear('', NOW)).toBe(false)
    expect(isNear('not-a-date', NOW)).toBe(false)
  })
})

describe('isLiveContest', () => {
  it('detects live via startTime + duration', () => {
    const live = { startTime: iso(NOW - 60 * 60000), duration: 180 }
    expect(isLiveContest(live, NOW)).toBe(true)
  })
  it('falls back to startDate with default 180min duration', () => {
    const live = { startDate: iso(NOW - 10 * 60000) }
    expect(isLiveContest(live, NOW)).toBe(true)
  })
  it('rejects upcoming and ended contests', () => {
    expect(isLiveContest({ startTime: iso(NOW + DAY), duration: 180 }, NOW)).toBe(false)
    expect(isLiveContest({ startTime: iso(NOW - 10 * DAY), duration: 60 }, NOW)).toBe(false)
  })
  it('rejects missing and invalid starts', () => {
    expect(isLiveContest({}, NOW)).toBe(false)
    expect(isLiveContest({ startTime: 'junk' }, NOW)).toBe(false)
    expect(isLiveContest(null, NOW)).toBe(false)
  })
})

describe('countNearDeadline', () => {
  it('counts only badgeable + near items', () => {
    const list = [
      { deadline: iso(NOW + DAY) },
      { deadline: iso(NOW - DAY) },
      { deadline: iso(NOW + 10 * DAY) },
      {},
    ]
    expect(countNearDeadline(list, 'hackathon', NOW)).toBe(1)
  })
  it('forms use expiresAt||deadline fallback', () => {
    const list = [{ deadline: iso(NOW + DAY) }, { expiresAt: iso(NOW + DAY) }]
    expect(countNearDeadline(list, 'form', NOW)).toBe(2)
  })
  it('internships skip non-ACTIVE', () => {
    const list = [
      { status: 'ACTIVE', deadline: iso(NOW + DAY) },
      { status: 'CLOSED', deadline: iso(NOW + DAY) },
    ]
    expect(countNearDeadline(list, 'internship', NOW)).toBe(1)
  })
  it('returns 0 for non-arrays', () => {
    expect(countNearDeadline(null, 'hackathon', NOW)).toBe(0)
    expect(countNearDeadline(undefined, 'form', NOW)).toBe(0)
  })
})

describe('countLiveContests', () => {
  it('counts live only, via startTime||startDate', () => {
    const list = [
      { startTime: iso(NOW - 30 * 60000), duration: 180 },
      { startDate: iso(NOW - 30 * 60000) },
      { startTime: iso(NOW + DAY), duration: 180 },
      { startTime: iso(NOW - 10 * DAY), duration: 60 },
    ]
    expect(countLiveContests(list, NOW)).toBe(2)
  })
  it('returns 0 for non-arrays', () => {
    expect(countLiveContests(null, NOW)).toBe(0)
  })
})

describe('countAssignmentUrgent', () => {
  it('counts overdue + due-soon together', () => {
    const hubs = [
      { dueDate: iso(NOW - DAY) },
      { dueDate: iso(NOW + DAY) },
      { dueDate: iso(NOW + 10 * DAY) },
      {},
    ]
    expect(countAssignmentUrgent(hubs, { nowMs: NOW })).toEqual({ count: 2, hasOverdue: true })
  })
  it('students skip submitted work', () => {
    const hubs = [
      { dueDate: iso(NOW - DAY), mySubmission: { id: 's1' } },
      { dueDate: iso(NOW + DAY), mySubmission: { id: 's2' } },
      { dueDate: iso(NOW + DAY) },
    ]
    expect(countAssignmentUrgent(hubs, { isStudent: true, nowMs: NOW })).toEqual({
      count: 1,
      hasOverdue: false,
    })
  })
  it('staff still see submitted items as needing review', () => {
    const hubs = [{ dueDate: iso(NOW + DAY), mySubmission: { id: 's1' } }]
    expect(countAssignmentUrgent(hubs, { isStudent: false, nowMs: NOW })).toEqual({
      count: 1,
      hasOverdue: false,
    })
  })
  it('returns empty urgency for non-arrays', () => {
    expect(countAssignmentUrgent(null)).toEqual({ count: 0, hasOverdue: false })
  })
})

describe('formatBadgeCount', () => {
  it('caps at 99+', () => {
    expect(formatBadgeCount(3)).toBe('3')
    expect(formatBadgeCount(99)).toBe('99')
    expect(formatBadgeCount(100)).toBe('99+')
  })
})

describe('getSidebarBadgeLabel', () => {
  it('returns §7 tooltip strings for all 6 pills', () => {
    expect(getSidebarBadgeLabel('/assignments', 3)).toBe('Assignments \u2014 3 due soon or overdue')
    expect(getSidebarBadgeLabel('/hackathons', 2)).toBe('Hackathons \u2014 2 closing within 3 days')
    expect(getSidebarBadgeLabel('/contests', 1)).toBe('Contests \u2014 1 live now')
    expect(getSidebarBadgeLabel('/internships', 2)).toBe('Internships \u2014 2 closing within 3 days')
    expect(getSidebarBadgeLabel('/forms', 2)).toBe('Forms \u2014 2 closing within 3 days')
    expect(getSidebarBadgeLabel('/rooms', 5)).toBe('Rooms \u2014 5 unread')
  })
  it('returns the plain label when the badge is hidden', () => {
    expect(getSidebarBadgeLabel('/hackathons', 0)).toBe('Hackathons')
    expect(getSidebarBadgeLabel('/rooms', 0)).toBe('Rooms')
  })
})

describe('SIDEBAR_PATH_ORDER', () => {
  it('locks the STUDENT deadlines-first order', () => {
    expect(SIDEBAR_PATH_ORDER.STUDENT).toEqual([
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
    ])
  })
  it('keeps deadlines first for staff roles', () => {
    for (const role of ['TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN_SCOPED']) {
      const order = SIDEBAR_PATH_ORDER[role]
      const idx = (p: string) => order.indexOf(p)
      expect(idx('/assignments')).toBeLessThan(idx('/tasks'))
      expect(idx('/hackathons')).toBeLessThan(idx('/contests'))
      expect(idx('/contests')).toBeLessThan(idx('/internships'))
      expect(idx('/internships')).toBeLessThan(idx('/forms'))
      expect(idx('/forms')).toBeLessThan(idx('/rooms'))
    }
  })
  it('leaves SUPER_ADMIN global untouched', () => {
    expect(SIDEBAR_PATH_ORDER.SUPER_ADMIN).toEqual([
      '/superadmin',
      '/superadmin/colleges',
      '/superadmin/reports',
      '/admin/fetch',
      '/admin/ai-manager',
    ])
  })
})
