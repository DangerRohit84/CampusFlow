// lib/__tests__/contestLinks.test.ts — contest title → contest navigation guard.
// WHY: CodingContestsPage <h3> title + CalendarPage contest <p>/chip titles were
// static text (no <a>, no onClick) — hover/click on the name did nothing while
// the tiny external-icon did navigate. Lock: helper resolves the contest URL
// (external platform link, same dest as the icon) and both pages render the
// name as a keyboard-accessible anchor with pointer + underline affordance.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getContestHref } from '../contestLinks'

describe('getContestHref', () => {
  it('contestTitle_click_navigatesToContestUrl', () => {
    expect(getContestHref({ url: 'https://codeforces.com/contests/123' })).toBe(
      'https://codeforces.com/contests/123',
    )
  })

  it('trims surrounding whitespace', () => {
    expect(getContestHref({ url: '  https://leetcode.com/contest/  ' })).toBe(
      'https://leetcode.com/contest/',
    )
  })

  it('returns null when url is missing/empty (renders plain text, no broken link)', () => {
    expect(getContestHref({} as any)).toBeNull()
    expect(getContestHref({ url: '' })).toBeNull()
    expect(getContestHref({ url: '   ' })).toBeNull()
    expect(getContestHref(null as any)).toBeNull()
    expect(getContestHref(undefined as any)).toBeNull()
  })

  it('rejects non-http(s) hrefs (no javascript:/data: navigation)', () => {
    expect(getContestHref({ url: 'javascript:alert(1)' })).toBeNull()
    expect(getContestHref({ url: 'data:text/html,hi' })).toBeNull()
    expect(getContestHref({ url: '/contests/abc' })).toBeNull()
  })
})

describe('contest name renders as navigable anchor (regression guard)', () => {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const contestsSrc = () =>
    readFileSync(join(thisDir, '../../pages/CodingContestsPage.tsx'), 'utf8')
  const calendarSrc = () =>
    readFileSync(join(thisDir, '../../pages/CalendarPage.tsx'), 'utf8')

  it('CodingContestsPage title links to the contest url', () => {
    const src = contestsSrc()
    // Title must resolve via the shared helper (no ad-hoc href math drifting).
    expect(src.includes('getContestHref'), 'must use getContestHref helper').toBe(true)
    // Anchor affordance: pointer + underline + keyboard-focusable <a>.
    expect(src.includes('hover:underline'), 'title anchor needs hover:underline').toBe(true)
    expect(src.includes('cursor-pointer'), 'title anchor needs cursor-pointer').toBe(true)
  })

  it('CalendarPage contest event name links to the contest url', () => {
    const src = calendarSrc()
    expect(src.includes('getContestHref'), 'must use getContestHref helper').toBe(true)
    expect(src.includes('hover:underline'), 'event name needs hover:underline').toBe(true)
  })
})
