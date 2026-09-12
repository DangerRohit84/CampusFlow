/**
 * TDD RED: assignment status filter (All/Active/Completed).
 * Spec:
 * - Active = dueDate>=now AND not submitted (OFFLINE/HYBRID no dueDate → Active unless graded)
 * - Completed = submitted OR graded OR past-due-with-submission
 * - All = everything
 * - Backend ?status param with Prisma where, backward compat no param = all
 */
import { describe, it, expect } from 'vitest'
import { getAssignmentStatus, normalizeStatusParam } from '../src/utils/assignmentVisibility'

const now = new Date()
const future = new Date(now.getTime() + 86400000).toISOString()
const past = new Date(now.getTime() - 86400000).toISOString()

describe('normalizeStatusParam (backward compat)', () => {
  it('defaults missing/empty to all', () => {
    expect(normalizeStatusParam(undefined)).toBe('all')
    expect(normalizeStatusParam('')).toBe('all')
    // @ts-expect-error - null compat
    expect(normalizeStatusParam(null)).toBe('all')
  })
  it('accepts all/active/completed case-insensitive', () => {
    expect(normalizeStatusParam('ACTIVE')).toBe('active')
    expect(normalizeStatusParam('Completed')).toBe('completed')
    expect(normalizeStatusParam('all')).toBe('all')
  })
  it('falls back unknown to all (backward compat)', () => {
    expect(normalizeStatusParam('bogus')).toBe('all')
  })
})

describe('getAssignmentStatus student (mySubmission present)', () => {
  it('active_when_upcoming_and_not_submitted', () => {
    expect(getAssignmentStatus({ dueDate: future, mySubmission: null } as any)).toBe('active')
  })
  it('completed_when_submitted', () => {
    expect(
      getAssignmentStatus({ dueDate: future, mySubmission: { status: 'SUBMITTED' } } as any)
    ).toBe('completed')
  })
  it('completed_when_graded', () => {
    expect(
      getAssignmentStatus({ dueDate: future, mySubmission: { status: 'GRADED', points: 90 } } as any)
    ).toBe('completed')
  })
  it('completed_when_past_due_with_submission', () => {
    expect(
      getAssignmentStatus({ dueDate: past, mySubmission: { status: 'LATE' } } as any)
    ).toBe('completed')
  })
  it('active_when_offline_hybrid_no_dueDate_unless_graded', () => {
    expect(
      getAssignmentStatus({ dueDate: null, submissionMode: 'OFFLINE', mySubmission: null } as any)
    ).toBe('active')
    expect(
      getAssignmentStatus({ dueDate: null, submissionMode: 'HYBRID', mySubmission: null } as any)
    ).toBe('active')
    expect(
      getAssignmentStatus(
        { dueDate: null, submissionMode: 'OFFLINE', mySubmission: { status: 'GRADED' } } as any
      )
    ).toBe('completed')
  })
  it('active_when_returned_needs_resubmit', () => {
    expect(
      getAssignmentStatus({ dueDate: future, mySubmission: { status: 'RETURNED' } } as any)
    ).toBe('active')
  })
})

describe('getAssignmentStatus teacher (no mySubmission field)', () => {
  it('active_when_dueDate_future', () => {
    expect(getAssignmentStatus({ dueDate: future } as any)).toBe('active')
  })
  it('completed_when_dueDate_past', () => {
    expect(getAssignmentStatus({ dueDate: past } as any)).toBe('completed')
  })
  it('active_when_no_dueDate', () => {
    expect(getAssignmentStatus({ dueDate: null, submissionMode: 'OFFLINE' } as any)).toBe('active')
  })
})
