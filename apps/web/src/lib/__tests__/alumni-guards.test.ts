/**
 * lib/__tests__/alumni-guards.test.ts — Alumni Phase 2 frontend guards.
 * Hermetic pure tests (no DOM, no network): masking can never leak PII,
 * response-rate labels, 24h verify SLA + 3d response SLA, message/topic caps,
 * chat deep links, college scoping, and inbox permissions.
 * Mirrors packages/backend tests/qa-alumni-phase01.test.ts (masking + guards).
 */
import { describe, it, expect } from 'vitest'
import {
  MENTORSHIP_TOPIC_CHIPS,
  canSeeContact,
  canViewAlumniProfile,
  decodeRouteId,
  formatResponseRate,
  getAlumniChatLink,
  isContactMasked,
  isMaskedEmail,
  isMaskedPhone,
  isSafeExternalUrl,
  isSlaBreachedClient,
  isVerificationOverdueClient,
  mentorshipPermissions,
  responseRateVariant,
  safeExternalHref,
  validateMentorshipMessage,
  validateMentorshipTopic,
} from '../alumniGuards'

describe('masking guards (no PII leak)', () => {
  it('detects_masked_email_and_phone', () => {
    expect(isMaskedEmail('j***@example.com')).toBe(true)
    expect(isMaskedEmail('jane@example.com')).toBe(false)
    expect(isMaskedEmail(null)).toBe(false)
    expect(isMaskedPhone('•••')).toBe(true)
    expect(isMaskedPhone('+91 98765')).toBe(false)
    expect(isMaskedPhone(null)).toBe(false)
  })
  it('flags_masked_cards_and_never_unmasks', () => {
    const masked = { contactEmail: 'j***@example.com', contactPhone: '•••' }
    expect(isContactMasked(masked)).toBe(true)
    expect(canSeeContact(masked)).toBe(false)
    const unlocked = { contactEmail: 'jane@example.com', contactPhone: '+91 99999' }
    expect(isContactMasked(unlocked)).toBe(false)
    expect(canSeeContact(unlocked)).toBe(true)
  })
  it('empty_contact_is_not_visible', () => {
    expect(canSeeContact({ contactEmail: null, contactPhone: null })).toBe(false)
  })
  it('partial_mask_stays_locked', () => {
    expect(canSeeContact({ contactEmail: 'j***@x.com', contactPhone: null })).toBe(false)
    expect(canSeeContact({ contactEmail: null, contactPhone: '•••' })).toBe(false)
  })
})

describe('response rate badge', () => {
  it('null_renders_New_neutral', () => {
    expect(formatResponseRate(null)).toBe('New')
    expect(formatResponseRate(undefined)).toBe('New')
    expect(responseRateVariant(null)).toBe('neutral')
  })
  it('formats_percent_and_variants', () => {
    expect(formatResponseRate(0.857)).toBe('86%')
    expect(formatResponseRate(0)).toBe('0%')
    expect(formatResponseRate(1)).toBe('100%')
    expect(responseRateVariant(0.9)).toBe('success')
    expect(responseRateVariant(0.5)).toBe('warning')
    expect(responseRateVariant(0.1)).toBe('danger')
  })
  it('clamps_out_of_range', () => {
    expect(formatResponseRate(2)).toBe('100%')
    expect(formatResponseRate(-1)).toBe('0%')
  })
})

describe('verification overdue (24h SLA)', () => {
  const now = new Date('2026-09-23T12:00:00Z')
  it('overdue_when_unverified_older_than_24h', () => {
    expect(isVerificationOverdueClient({ isVerified: false, createdAt: '2026-09-22T10:00:00Z' }, now)).toBe(true)
  })
  it('not_overdue_inside_24h', () => {
    expect(isVerificationOverdueClient({ isVerified: false, createdAt: '2026-09-23T00:00:00Z' }, now)).toBe(false)
  })
  it('never_overdue_when_verified', () => {
    expect(isVerificationOverdueClient({ isVerified: true, createdAt: '2026-09-01T00:00:00Z' }, now)).toBe(false)
  })
  it('fail_closed_on_bad_date', () => {
    expect(isVerificationOverdueClient({ isVerified: false, createdAt: 'garbage' }, now)).toBe(false)
    expect(isVerificationOverdueClient({ isVerified: false, createdAt: null }, now)).toBe(false)
  })
})

describe('SLA breach (3d response)', () => {
  const now = new Date('2026-09-23T12:00:00Z')
  it('breached_when_PENDING_past_due', () => {
    expect(isSlaBreachedClient({ status: 'PENDING', slaDueAt: '2026-09-20T00:00:00Z' }, now)).toBe(true)
  })
  it('not_breached_before_due_or_non_pending', () => {
    expect(isSlaBreachedClient({ status: 'PENDING', slaDueAt: '2026-09-25T00:00:00Z' }, now)).toBe(false)
    expect(isSlaBreachedClient({ status: 'ACCEPTED', slaDueAt: '2026-09-20T00:00:00Z' }, now)).toBe(false)
    expect(isSlaBreachedClient({ status: 'PENDING', slaDueAt: null }, now)).toBe(false)
  })
})

describe('message + topic validation', () => {
  it('rejects_short_and_empty_messages', () => {
    expect(validateMentorshipMessage('')).not.toBeNull()
    expect(validateMentorshipMessage('hi')).not.toBeNull()
    expect(validateMentorshipMessage('123456789')).not.toBeNull()
  })
  it('accepts_min_10_and_rejects_over_2000', () => {
    expect(validateMentorshipMessage('1234567890')).toBeNull()
    expect(validateMentorshipMessage('a'.repeat(2000))).toBeNull()
    expect(validateMentorshipMessage('a'.repeat(2001))).not.toBeNull()
  })
  it('topic_optional_but_capped', () => {
    expect(validateMentorshipTopic(null)).toBeNull()
    expect(validateMentorshipTopic('')).toBeNull()
    expect(validateMentorshipTopic('Career guidance')).toBeNull()
    expect(validateMentorshipTopic('a'.repeat(201))).not.toBeNull()
  })
  it('topic_chips_fit_server_cap', () => {
    for (const chip of MENTORSHIP_TOPIC_CHIPS) {
      expect(chip.length).toBeLessThanOrEqual(200)
      expect(validateMentorshipTopic(chip)).toBeNull()
    }
  })
})

describe('chat deep link', () => {
  it('builds_encoded_session_link', () => {
    expect(getAlumniChatLink('abc-123')).toBe('/chat?session=abc-123')
  })
  it('null_on_missing', () => {
    expect(getAlumniChatLink(null)).toBeNull()
    expect(getAlumniChatLink('')).toBeNull()
    expect(getAlumniChatLink('   ')).toBeNull()
    expect(getAlumniChatLink(undefined)).toBeNull()
  })
})

describe('college scoping (client mirror, server authoritative)', () => {
  it('super_admin_sees_all', () => {
    expect(canViewAlumniProfile({ id: 'u1', role: 'SUPER_ADMIN', collegeId: null }, { userId: 'u2', collegeId: 'c9' })).toBe(true)
  })
  it('owner_always_allowed', () => {
    expect(canViewAlumniProfile({ id: 'u1', role: 'STUDENT', collegeId: 'c1' }, { userId: 'u1', collegeId: 'c2' })).toBe(true)
  })
  it('same_college_allowed_cross_denied', () => {
    expect(canViewAlumniProfile({ id: 'u1', role: 'STUDENT', collegeId: 'c1' }, { userId: 'u2', collegeId: 'c1' })).toBe(true)
    expect(canViewAlumniProfile({ id: 'u1', role: 'STUDENT', collegeId: 'c1' }, { userId: 'u2', collegeId: 'c2' })).toBe(false)
  })
  it('null_college_fail_closed', () => {
    expect(canViewAlumniProfile({ id: 'u1', role: 'STUDENT', collegeId: null }, { userId: 'u2', collegeId: 'c1' })).toBe(false)
    expect(canViewAlumniProfile({ id: 'u1', role: 'STUDENT', collegeId: 'c1' }, { userId: 'u2', collegeId: null })).toBe(false)
    expect(canViewAlumniProfile({ id: '', role: 'STUDENT', collegeId: 'c1' }, { userId: 'u2', collegeId: 'c1' })).toBe(false)
  })
})

describe('inbox permissions', () => {
  it('alumni_side_can_accept_requester_can_cancel', () => {
    const p = mentorshipPermissions('alumni1', { requesterId: 'stu1', alumniUserId: 'alumni1' }, 'STUDENT')
    expect(p.canAcceptDecline).toBe(true)
    expect(p.canCancel).toBe(false)
    const q = mentorshipPermissions('stu1', { requesterId: 'stu1', alumniUserId: 'alumni1' }, 'STUDENT')
    expect(q.canAcceptDecline).toBe(false)
    expect(q.canCancel).toBe(true)
  })
  it('admin_can_both', () => {
    const p = mentorshipPermissions('admin1', { requesterId: 'stu1', alumniUserId: 'alumni1' }, 'COLLEGE_ADMIN')
    expect(p.canAcceptDecline).toBe(true)
    expect(p.canCancel).toBe(true)
  })
  it('stranger_can_neither', () => {
    const p = mentorshipPermissions('other', { requesterId: 'stu1', alumniUserId: 'alumni1' }, 'STUDENT')
    expect(p.canAcceptDecline).toBe(false)
    expect(p.canCancel).toBe(false)
  })
})

describe('ext-link allowlist S1 (no javascript:/data: href)', () => {
  it('allows_https_and_http', () => {
    expect(isSafeExternalUrl('https://linkedin.com/in/x')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/p')).toBe(true)
    expect(safeExternalHref('https://github.com/x')).toBe('https://github.com/x')
  })
  it('rejects_javascript_data_and_blank', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('JaVaScRiPt:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,hi')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(safeExternalHref('javascript:alert(1)')).toBeUndefined()
  })
})

describe('route-id decode S2 (no throw on malformed %)', () => {
  it('decodes_normal_and_falls_back_on_malformed', () => {
    expect(decodeRouteId('abc%20123')).toBe('abc 123')
    expect(decodeRouteId('%%%')).toBe('%%%')
    expect(decodeRouteId('')).toBe('')
    expect(decodeRouteId(null)).toBe('')
  })
})
