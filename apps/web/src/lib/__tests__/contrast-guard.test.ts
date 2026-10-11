// src/lib/__tests__/contrast-guard.test.ts — WCAG AA contrast guards for light + dark readability.
// WHY: Hackathon Pulse card shipped dark-on-dark in light mode (PremiumHero is
// always dark #0a0a0a, but countdown/prize used text-zinc-900/500 + primary-600
// #0a7a3a on translucent white — ~1.1:1, invisible). Inputs used dark:text-zinc-500
// (#71717a on #181818, ~3.5:1, fails). Muted surface-400 (#9ca3af, 2.8:1 on white)
// failed AA on every light card. This guard locks the fixes: computed contrast
// calibration + banned bad pairs + snapshot of approved theme-aware classes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const src = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf-8')

// --- WCAG relative luminance + contrast (same math as axe) ---
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

describe('contrast-guard calibration (WCAG AA: 4.5 small / 3.0 large)', () => {
  it('white on always-dark hero passes', () => {
    expect(contrast('#ffffff', '#0a0a0a')).toBeGreaterThanOrEqual(4.5)
  })
  it('light green primary-300 (#6fd28a) on dark hero passes', () => {
    expect(contrast('#6fd28a', '#0a0a0a')).toBeGreaterThanOrEqual(4.5)
  })
  it('dark green (#0a7a3a) on white passes (light cards)', () => {
    expect(contrast('#0a7a3a', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('muted surface-500 (#6b7280) on white passes', () => {
    expect(contrast('#6b7280', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('muted night-400 (#a1a1aa) on dark #121212 passes', () => {
    expect(contrast('#a1a1aa', '#121212')).toBeGreaterThanOrEqual(4.5)
  })
  it('dark green-700 (#15803d) on white passes (calendar badge fix)', () => {
    expect(contrast('#15803d', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  it('KNOWN-BAD: zinc-900 (#121212) on hero translucent (~#0e0e0e) fails — proves guard catches dark-on-dark', () => {
    expect(contrast('#121212', '#0e0e0e')).toBeLessThan(3.0)
  })
  it('KNOWN-BAD: dark green #0a7a3a on hero #0a0a0a fails small-text AA — proves green-on-dark guard', () => {
    expect(contrast('#0a7a3a', '#0a0a0a')).toBeLessThan(4.5)
  })
  it('KNOWN-BAD: surface-400 (#9ca3af) on white fails small-text AA — proves muted guard', () => {
    expect(contrast('#9ca3af', '#ffffff')).toBeLessThan(4.5)
  })
  it('KNOWN-BAD: zinc-500 (#71717a) input text on night-800 (#181818) fails AA', () => {
    expect(contrast('#71717a', '#181818')).toBeLessThan(4.5)
  })
})

describe('contrast-guard hero translucent (always-dark PremiumHero)', () => {
  it('HackathonDetail prize uses white-aware + light-green (no dark-on-dark)', () => {
    const t = src('src', 'pages', 'HackathonDetailPage.tsx')
    expect(t).toContain('text-white/60 dark:text-white/60 leading-none">Prize Pool')
    expect(t).toContain('text-white dark:text-white truncate mt-1">{hackathon.prizePool}')
    expect(t).toContain('text-primary-300 dark:text-primary-300')
  })
  it('HackathonDetail countdown boxes use white-aware text', () => {
    const t = src('src', 'pages', 'HackathonDetailPage.tsx')
    expect(t).toContain('text-white dark:text-white">{box.value}')
    expect(t).toContain('text-white/60 dark:text-white/60 mt-1">{box.label}')
  })
  it('InternshipDetail stipend + countdown use white-aware text', () => {
    const t = src('src', 'pages', 'InternshipDetailPage.tsx')
    expect(t).toContain('text-white/60 dark:text-white/60 leading-none">Stipend Spotlight')
    expect(t).toContain('text-white dark:text-white">{box.value}')
    expect(t).toContain('text-white/60 dark:text-white/60 mt-1">{box.label}')
  })
  it('InternshipDetail white-card countdown uses green-300/green-700 (not primary-600 remap trap)', () => {
    const t = src('src', 'pages', 'InternshipDetailPage.tsx')
    expect(t).toContain('text-green-300 dark:text-green-700')
    expect(t).not.toContain('text-primary-400 dark:text-primary-600')
  })
})

describe('contrast-guard inputs (typed text must be foreground, not zinc-500)', () => {
  it('HackathonsPage search input uses foreground text', () => {
    const t = src('src', 'pages', 'HackathonsPage.tsx')
    expect(t).toContain('text-surface-900 dark:text-white')
    expect(t).not.toContain('dark:text-zinc-500"')
  })
  it('InternshipsPage search input uses foreground text', () => {
    const t = src('src', 'pages', 'InternshipsPage.tsx')
    expect(t).toContain('text-surface-900 dark:text-white')
    expect(t).not.toContain('dark:text-zinc-500" />')
  })
  it('CreateAssignmentModal inputs use foreground text', () => {
    const t = src('src', 'components', 'assignments', 'CreateAssignmentModal.tsx')
    expect(t).not.toContain('disabled:cursor-not-allowed dark:text-zinc-500')
    expect(t).toContain('disabled:cursor-not-allowed"')
  })
})

describe('contrast-guard muted text (surface-400/zinc-500 fail AA)', () => {
  it('bans text-surface-400 dark:text-zinc-500 in fixed list pages', () => {
    for (const f of [
      ['src', 'pages', 'ContestLeaderboardPage.tsx'],
      ['src', 'pages', 'AssignmentDetailPage.tsx'],
      ['src', 'pages', 'HackathonDetailPage.tsx'],
      ['src', 'pages', 'InternshipDetailPage.tsx'],
    ] as string[][]) {
      expect(src(...f)).not.toContain('text-surface-400 dark:text-zinc-500')
    }
  })
  it('bans text-surface-400 dark:text-night-400 small labels in detail heroes (use surface-500)', () => {
    for (const f of [
      ['src', 'pages', 'HackathonDetailPage.tsx'],
      ['src', 'pages', 'InternshipDetailPage.tsx'],
    ] as string[][]) {
      expect(src(...f)).not.toContain('text-surface-400 dark:text-night-400')
    }
  })
  it('ContestLeaderboard stat labels use AA-muted tokens', () => {
    const t = src('src', 'pages', 'ContestLeaderboardPage.tsx')
    expect(t).toContain('uppercase text-surface-500 dark:text-night-400">Participants')
    expect(t).toContain('uppercase text-surface-500 dark:text-night-400">Avg Contests')
  })
})

describe('contrast-guard badges + ranks (small-text green/gray)', () => {
  it('CalendarPage completed badge uses green-700 (not green-600)', () => {
    const t = src('src', 'pages', 'CalendarPage.tsx')
    expect(t).toContain('text-green-700 dark:text-green-300')
    expect(t).not.toContain('text-green-600 dark:text-green-400')
  })
  it('CalendarPage empty + recurring use AA-muted (not surface-300/night-700 or surface-400)', () => {
    const t = src('src', 'pages', 'CalendarPage.tsx')
    expect(t).not.toContain('text-surface-300 dark:text-night-700')
    expect(t).toContain('text-surface-500 dark:text-night-400 mx-auto')
  })
  it('CodingProfile rank uses gray-500 + night-400 (not bare gray-400/surface-400)', () => {
    const t = src('src', 'pages', 'CodingProfilePage.tsx')
    expect(t).toContain('text-gray-500 dark:text-gray-400')
    expect(t).toContain('text-surface-500 dark:text-night-400')
  })
})
