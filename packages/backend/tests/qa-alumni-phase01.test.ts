/**
 * QA verification for Alumni Phase 0+1 (hermetic, no DB).
 * Covers: masking, SLA/expiry math, counters, queue sort, cron toggle,
 * guards constants, zod schemas, pre-migration 503 shape (static).
 */
import { describe, it, expect } from 'vitest'
import {
  maskAlumniProfile,
  maskEmailLocal,
  slaDatesForNewRequest,
  startOfUtcDay,
  calcResponseRate,
  foldResponseCounters,
  isVerificationOverdue,
  sortVerificationQueue,
  isSlaBreached,
  isExpirable,
  isAlumniCronEnabled,
  isMissingTable,
  canCollegeAdminAccess,
  runAlumniSlaJob,
  runAlumniExpireJob,
  MENTORSHIP_DAILY_LIMIT,
  RESPONSE_SLA_DAYS,
  AUTO_EXPIRE_DAYS,
  VERIFICATION_SLA_HOURS,
  mentorshipRequestSchema,
  mentorshipRespondSchema,
  alumniProfileSchema,
} from '../src/services/alumniService'

describe('QA alumni constants', () => {
  it('daily limit is 5', () => expect(MENTORSHIP_DAILY_LIMIT).toBe(5))
  it('SLA 3d + expire 14d + verify 24h', () => {
    expect(RESPONSE_SLA_DAYS).toBe(3)
    expect(AUTO_EXPIRE_DAYS).toBe(14)
    expect(VERIFICATION_SLA_HOURS).toBe(24)
  })
})

describe('QA masking (no email/phone leak until ACCEPTED)', () => {
  it('masks email+phone when canSeeContact=false', () => {
    const row = { userId: 'u1', contactEmail: 'jane.doe@example.com', contactPhone: '+91-99999' }
    const out = maskAlumniProfile(row, { canSeeContact: false })
    expect(out.contactEmail).not.toBe('jane.doe@example.com')
    expect(String(out.contactEmail)).toContain('***@')
    expect(out.contactPhone).toBe('•••')
  })
  it('preserves contact when canSeeContact=true', () => {
    const row = { userId: 'u1', contactEmail: 'jane@example.com', contactPhone: '123' }
    const out = maskAlumniProfile(row, { canSeeContact: true })
    expect(out.contactEmail).toBe('jane@example.com')
    expect(out.contactPhone).toBe('123')
  })
  it('never mutates input + null-safe', () => {
    const row = { userId: 'u1', contactEmail: 'a@b.com', contactPhone: 'p' }
    const snap = { ...row }
    maskAlumniProfile(row, { canSeeContact: false })
    expect(row).toEqual(snap)
    const nul = maskAlumniProfile({ userId: 'u2' } as never, { canSeeContact: false }) as unknown as Record<string, unknown>
    expect(nul.contactEmail).toBeNull()
    expect(nul.contactPhone).toBeNull()
  })
  it('maskEmailLocal parity (j***@domain)', () => {
    expect(maskEmailLocal('jane.doe@example.com')).toBe('j***@example.com')
    expect(maskEmailLocal('not-an-email')).toBeNull()
    expect(maskEmailLocal(null)).toBeNull()
  })
})

describe('QA SLA/expiry math', () => {
  it('slaDates = +3d / +14d', () => {
    const base = new Date('2026-09-29T00:00:00.000Z')
    const { slaDueAt, expiresAt } = slaDatesForNewRequest(base)
    expect(slaDueAt.getTime() - base.getTime()).toBe(3 * 86_400_000)
    expect(expiresAt.getTime() - base.getTime()).toBe(14 * 86_400_000)
  })
  it('startOfUtcDay buckets quota day', () => {
    const d = new Date('2026-09-29T15:30:00.000Z')
    const s = startOfUtcDay(d)
    expect(s.toISOString()).toBe('2026-09-29T00:00:00.000Z')
  })
  it('isSlaBreached only PENDING past due', () => {
    const now = new Date('2026-10-05T00:00:00Z')
    expect(isSlaBreached({ status: 'PENDING', slaDueAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(true)
    expect(isSlaBreached({ status: 'ACCEPTED', slaDueAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(false)
    expect(isSlaBreached({ status: 'PENDING', slaDueAt: new Date('2026-10-10T00:00:00Z') }, now)).toBe(false)
  })
  it('isExpirable only PENDING past expiresAt', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    expect(isExpirable({ status: 'PENDING', expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(true)
    expect(isExpirable({ status: 'EXPIRED', expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(false)
  })
})

describe('QA counters + queue', () => {
  it('calcResponseRate null on zero, capped at 1', () => {
    expect(calcResponseRate({ totalRequests: 0, respondedRequests: 0 })).toBeNull()
    expect(calcResponseRate({ totalRequests: 4, respondedRequests: 2 })).toBe(0.5)
    expect(calcResponseRate({ totalRequests: 2, respondedRequests: 5 })).toBe(1)
  })
  it('foldResponseCounters bumps accepted only on ACCEPT', () => {
    const a = foldResponseCounters({ acceptedRequests: 1, respondedRequests: 2, avgResponseHours: 10 }, { accepted: true, responseHours: 20 })
    expect(a).toMatchObject({ acceptedRequests: 2, respondedRequests: 3 })
    const d = foldResponseCounters({ acceptedRequests: 1, respondedRequests: 2, avgResponseHours: 10 }, { accepted: false, responseHours: 5 })
    expect(d.acceptedRequests).toBe(1)
    expect(d.respondedRequests).toBe(3)
  })
  it('verification overdue + queue puts overdue first then oldest', () => {
    const now = new Date('2026-09-30T00:00:00Z')
    const old = { userId: 'a', isVerified: false, createdAt: new Date('2026-09-28T00:00:00Z') }
    const fresh = { userId: 'b', isVerified: false, createdAt: new Date('2026-09-29T23:00:00Z') }
    expect(isVerificationOverdue(old, now)).toBe(true)
    expect(isVerificationOverdue(fresh, now)).toBe(false)
    const sorted = sortVerificationQueue([fresh, old], now)
    expect(sorted[0]).toMatchObject({ userId: 'a' })
  })
})

describe('QA zod schemas (guard inputs)', () => {
  it('mentorship message min 10 chars', () => {
    expect(mentorshipRequestSchema.safeParse({ alumniUserId: 'u2', message: 'short' }).success).toBe(false)
    expect(mentorshipRequestSchema.safeParse({ alumniUserId: 'u2', message: 'Hello, please mentor me on DSA prep!' }).success).toBe(true)
  })
  it('respond actions only ACCEPT/DECLINE/CANCEL', () => {
    expect(mentorshipRespondSchema.safeParse({ action: 'ACCEPT' }).success).toBe(true)
    expect(mentorshipRespondSchema.safeParse({ action: 'MAYBE' }).success).toBe(false)
  })
  it('profile schema tolerates empty + caps skills 30', () => {
    const ok = alumniProfileSchema.safeParse({ graduationYear: 2015, skills: [] })
    expect(ok.success).toBe(true)
    const tooMany = alumniProfileSchema.safeParse({ skills: Array.from({ length: 31 }, (_, i) => `s${i}`) })
    expect(tooMany.success).toBe(false)
  })
})

describe('QA cron dormant by default', () => {
  it('disabled unless ALUMNI_CRON_ENABLED=true', () => {
    expect(isAlumniCronEnabled({} as never)).toBe(false)
    expect(isAlumniCronEnabled({ ALUMNI_CRON_ENABLED: 'false' } as never)).toBe(false)
    expect(isAlumniCronEnabled({ ALUMNI_CRON_ENABLED: 'true' } as never)).toBe(true)
  })
  it('SLA job no-ops when disabled (no DB touch)', async () => {
    const r = await runAlumniSlaJob({ enabled: () => false })
    expect(r).toEqual({ checked: 0, nudged: 0, skipped: true })
  })
  it('expire job no-ops when disabled', async () => {
    const r = await runAlumniExpireJob({ enabled: () => false })
    expect(r).toEqual({ checked: 0, expired: 0, skipped: true })
  })
  it('SLA job nudges via injected deps when enabled', async () => {
    let notified = 0
    const r = await runAlumniSlaJob({
      enabled: () => true,
      now: new Date(),
      listSlaBreached: async () => [{ id: 'r1', alumniUserId: 'a1', requesterId: 's1' }],
      notify: async () => { notified++ },
    })
    expect(r).toEqual({ checked: 1, nudged: 1, skipped: false })
    expect(notified).toBe(1)
  })
  it('expire job flips via injected deps when enabled', async () => {
    let marked = 0
    let notified = 0
    const r = await runAlumniExpireJob({
      enabled: () => true,
      now: new Date(),
      listExpirable: async () => [{ id: 'r1', requesterId: 's1', alumniUserId: 'a1' }],
      markExpired: async () => { marked++ },
      notify: async () => { notified++ },
    })
    expect(r).toEqual({ checked: 1, expired: 1, skipped: false })
    expect(marked).toBe(1)
    expect(notified).toBe(1)
  })
})

describe('QA regression lock M1/M2/S2/S1 (fix-loop guards)', () => {
  it('M1 college scoping matrix (respond/verify symmetry)', () => {
    // Own-college COLLEGE_ADMIN allowed.
    expect(canCollegeAdminAccess({ role: 'COLLEGE_ADMIN', collegeId: 'c1' }, 'c1')).toBe(true)
    // Cross-college denied.
    expect(canCollegeAdminAccess({ role: 'COLLEGE_ADMIN', collegeId: 'c1' }, 'c2')).toBe(false)
    // Null denies fail-closed (either side).
    expect(canCollegeAdminAccess({ role: 'COLLEGE_ADMIN', collegeId: null }, 'c1')).toBe(false)
    expect(canCollegeAdminAccess({ role: 'COLLEGE_ADMIN', collegeId: 'c1' }, null)).toBe(false)
    // SUPER_ADMIN global.
    expect(canCollegeAdminAccess({ role: 'SUPER_ADMIN', collegeId: null }, 'c9')).toBe(true)
    expect(canCollegeAdminAccess({ role: 'SUPER_ADMIN', collegeId: 'c1' }, null)).toBe(true)
    // Non-admin never via this helper (party checks handle them).
    expect(canCollegeAdminAccess({ role: 'STUDENT', collegeId: 'c1' }, 'c1')).toBe(false)
  })
  it('M2 isMissingTable maps P2021/P2022 to 503 (never 500)', () => {
    expect(isMissingTable({ code: 'P2021' })).toBe(true)
    expect(isMissingTable({ code: 'P2022' })).toBe(true)
    expect(isMissingTable({ code: 'P2002' })).toBe(false)
    expect(isMissingTable({})).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
  it('S2 maskEmailLocal keeps full domain on multi-@ (no leak)', () => {
    expect(maskEmailLocal('a@b@c')).toBe('a***@b@c')
    expect(maskEmailLocal('jane.doe@example.com')).toBe('j***@example.com')
    expect(maskEmailLocal('not-an-email')).toBeNull()
  })
  it('S1 ext-link allowlist rejects javascript:/data:, allows https', () => {
    expect(alumniProfileSchema.safeParse({ linkedinUrl: 'https://linkedin.com/in/x' }).success).toBe(true)
    expect(alumniProfileSchema.safeParse({ linkedinUrl: 'http://example.com/p' }).success).toBe(true)
    expect(alumniProfileSchema.safeParse({ linkedinUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(alumniProfileSchema.safeParse({ githubUrl: 'data:text/html,hi' }).success).toBe(false)
    expect(alumniProfileSchema.safeParse({ portfolioUrl: '' }).success).toBe(true)
  })
})
