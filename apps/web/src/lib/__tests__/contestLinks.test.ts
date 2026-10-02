// lib/__tests__/contestLinks.test.ts — contest card click UX guard.
// WHY: contest title hover showed underline + color change (unwanted) and only
// the tiny title/icon navigated. Lock: whole card navigates to the external
// platform URL (same dest as the icon, no /contests/:id route exists) with
// cursor-pointer only on title (no underline/color), card role=link + keyboard
// (Enter/Space) matching HackathonsPage pattern but window.open _blank noopener.
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

describe('contest card click UX — whole card navigates, title cursor-only (regression guard)', () => {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const contestsSrc = () =>
    readFileSync(join(thisDir, '../../pages/CodingContestsPage.tsx'), 'utf8')
  const calendarSrc = () =>
    readFileSync(join(thisDir, '../../pages/CalendarPage.tsx'), 'utf8')

  it('CodingContestsPage whole card click navigates to contest url', () => {
    const src = contestsSrc()
    // Title must resolve via the shared helper (no ad-hoc href math drifting).
    expect(src.includes('getContestHref'), 'must use getContestHref helper').toBe(true)
    // Whole-card clickable pattern (matches HackathonsPage article role=link):
    // external URL so window.open _blank noopener (no /contests/:id route exists).
    // Accepts static role="link" (Hackathons) or dynamic role={... 'link' ...}
    // (contest card is conditional on href existing — plain text when no URL).
    const hasRoleLink = src.includes('role="link"') || src.includes("role='link'") || (src.includes('role={') && (src.includes("'link'") || src.includes('"link"')))
    expect(hasRoleLink, 'card needs role=link').toBe(true)
    expect(src.includes('window.open'), 'card onClick must open external contest URL').toBe(true)
    expect(src.includes('onKeyDown'), 'card needs keyboard Enter/Space handler').toBe(true)
    expect(src.includes('onClick'), 'card needs onClick navigate').toBe(true)
    // Card affordance: pointer + keyboard-focus ring for a11y.
    expect(src.includes('cursor-pointer'), 'card/title needs cursor-pointer').toBe(true)
    expect(src.includes('focus-visible:ring'), 'must keep focus-visible ring for a11y').toBe(true)
  })

  it('CodingContestsPage title has cursor-only affordance (no underline/color)', () => {
    const src = contestsSrc()
    // WHY: hover underline + color change on contest title is unwanted —
    // cursor change only. Global check is valid: the title anchor was the
    // ONLY hover:underline in this file (grep-verified b6db23c), so any
    // remaining hover:underline means the title regressed.
    expect(src.includes('hover:underline'), 'title must NOT have hover:underline — cursor-pointer only').toBe(false)
    // Title must not change color on hover — extract the <h3> title block and
    // assert no hover:text-* inside it (other buttons elsewhere may hover:text).
    const h3Blocks = src.match(/<h3[\s\S]*?<\/h3>/g) || []
    expect(h3Blocks.length > 0, 'must have contest title h3').toBe(true)
    const titleBlock: string = h3Blocks.find((b) => b.includes('line-clamp-1')) || h3Blocks[0] || ''
    expect(titleBlock.includes('hover:text-'), 'title must NOT have hover:text-* color change').toBe(false)
    expect(titleBlock.includes('cursor-pointer'), 'title needs cursor-pointer').toBe(true)
  })

  it('CalendarPage contest chip/detail click navigates with cursor-only affordance', () => {
    const src = calendarSrc()
    expect(src.includes('getContestHref'), 'must use getContestHref helper').toBe(true)
    // WHY: same cursor-only rule — contest chip + detail were the ONLY two
    // hover:underline in this file (grep-verified b6db23c), so any remaining
    // means chip/detail regressed. No visual underline/color, pointer only.
    expect(src.includes('hover:underline'), 'chip/detail must NOT have hover:underline — cursor-pointer only').toBe(false)
    expect(src.includes('cursor-pointer'), 'chip/detail needs cursor-pointer').toBe(true)
    // Whole-card/chip click navigates external (new tab noopener).
    expect(src.includes('window.open'), 'chip/detail onClick must open external contest URL').toBe(true)
    const hasDetailRoleLink = src.includes('role="link"') || src.includes("role='link'") || (src.includes('role={') && (src.includes("'link'") || src.includes('"link"')))
    expect(hasDetailRoleLink, 'detail card needs role=link').toBe(true)
    expect(src.includes('focus-visible:ring'), 'must keep focus-visible ring for a11y').toBe(true)
  })
})
