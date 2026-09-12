/**
 * Enum sweep regression: EVERY native Prisma enum family normalizes via a
 * REAL-enum choke point (lib/enums.ts extends lib/platform.ts pattern).
 *
 * Contract:
 * - Lowercase / mixed-case / whitespace inputs map to REAL @prisma/client
 *   members (fails if unknown — proves boundary, not hardcoded copy).
 * - Ghosts fail closed (throw) / try-variant returns null (filters skip, sync
 *   skips+warns) — never pass raw strings to Prisma (live Platform bug class).
 * - API shapes stable: conversion at Prisma boundary only (no frontend change).
 * - Static: every Prisma-touching enum write site uses the helper (no lying
 *   `as any` for enums); seed uses UPPERCASE members.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  UserRole,
  StagingDecision,
  StagingStatus,
  HackathonStatus,
  InternshipStatus,
  ContestStatus,
  CollegeStatus,
  FormStatus,
  ReportStatus,
  ReportScope,
  ReportIssueType,
  Priority,
  TaskStatus,
  AssignmentStatus,
  SubmissionStatus,
  RegistrationStatus,
  SourceHealthStatus,
  Platform,
  ScheduleType,
  ChatMessageRole,
  GradeSource,
  AttendanceStatus,
  AnnouncementTarget,
  AnnouncementTargetScope,
  AssignmentScope,
  SubmissionMode,
} from '@prisma/client'
import {
  toRoleEnum,
  tryToRoleEnum,
  toStagingDecisionEnum,
  tryToStagingDecisionEnum,
  toStagingStatusEnum,
  tryToStagingStatusEnum,
  toHackathonStatusEnum,
  tryToHackathonStatusEnum,
  toInternshipStatusEnum,
  tryToInternshipStatusEnum,
  toContestStatusEnum,
  tryToContestStatusEnum,
  toCollegeStatusEnum,
  tryToCollegeStatusEnum,
  toFormStatusEnum,
  tryToFormStatusEnum,
  toReportStatusEnum,
  tryToReportStatusEnum,
  toReportScopeEnum,
  tryToReportScopeEnum,
  toReportIssueTypeEnum,
  tryToReportIssueTypeEnum,
  toPriorityEnum,
  tryToPriorityEnum,
  toTaskStatusEnum,
  tryToTaskStatusEnum,
  toAssignmentStatusEnum,
  tryToAssignmentStatusEnum,
  toSubmissionStatusEnum,
  tryToSubmissionStatusEnum,
  toRegistrationStatusEnum,
  tryToRegistrationStatusEnum,
  toSourceHealthStatusEnum,
  tryToSourceHealthStatusEnum,
  toScheduleTypeEnum,
  tryToScheduleTypeEnum,
  toChatMessageRoleEnum,
  tryToChatMessageRoleEnum,
  toGradeSourceEnum,
  tryToGradeSourceEnum,
  toAttendanceStatusEnum,
  tryToAttendanceStatusEnum,
  toAnnouncementTargetEnum,
  tryToAnnouncementTargetEnum,
  toAnnouncementTargetScopeEnum,
  tryToAnnouncementTargetScopeEnum,
  toAssignmentScopeEnum,
  tryToAssignmentScopeEnum,
  toSubmissionModeEnum,
  tryToSubmissionModeEnum,
} from '../src/lib/enums'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

describe('enum sweep: every family maps lowercase → REAL Prisma member (fail on unknown)', () => {
  const CASES: Array<{
    label: string
    toEnum: (v: unknown) => string
    tryToEnum: (v: unknown) => string | null
    real: Record<string, string>
    lowercase: string
  }> = [
    { label: 'UserRole', toEnum: toRoleEnum as any, tryToEnum: tryToRoleEnum as any, real: UserRole as any, lowercase: 'student' },
    { label: 'StagingDecision', toEnum: toStagingDecisionEnum as any, tryToEnum: tryToStagingDecisionEnum as any, real: StagingDecision as any, lowercase: 'approved' },
    { label: 'StagingStatus', toEnum: toStagingStatusEnum as any, tryToEnum: tryToStagingStatusEnum as any, real: StagingStatus as any, lowercase: 'pending' },
    { label: 'HackathonStatus', toEnum: toHackathonStatusEnum as any, tryToEnum: tryToHackathonStatusEnum as any, real: HackathonStatus as any, lowercase: 'published' },
    { label: 'InternshipStatus', toEnum: toInternshipStatusEnum as any, tryToEnum: tryToInternshipStatusEnum as any, real: InternshipStatus as any, lowercase: 'active' },
    { label: 'ContestStatus', toEnum: toContestStatusEnum as any, tryToEnum: tryToContestStatusEnum as any, real: ContestStatus as any, lowercase: 'upcoming' },
    { label: 'CollegeStatus', toEnum: toCollegeStatusEnum as any, tryToEnum: tryToCollegeStatusEnum as any, real: CollegeStatus as any, lowercase: 'approved' },
    { label: 'FormStatus', toEnum: toFormStatusEnum as any, tryToEnum: tryToFormStatusEnum as any, real: FormStatus as any, lowercase: 'active' },
    { label: 'ReportStatus', toEnum: toReportStatusEnum as any, tryToEnum: tryToReportStatusEnum as any, real: ReportStatus as any, lowercase: 'open' },
    { label: 'ReportScope', toEnum: toReportScopeEnum as any, tryToEnum: tryToReportScopeEnum as any, real: ReportScope as any, lowercase: 'college' },
    { label: 'ReportIssueType', toEnum: toReportIssueTypeEnum as any, tryToEnum: tryToReportIssueTypeEnum as any, real: ReportIssueType as any, lowercase: 'bug' },
    { label: 'Priority', toEnum: toPriorityEnum as any, tryToEnum: tryToPriorityEnum as any, real: Priority as any, lowercase: 'high' },
    { label: 'TaskStatus', toEnum: toTaskStatusEnum as any, tryToEnum: tryToTaskStatusEnum as any, real: TaskStatus as any, lowercase: 'pending' },
    { label: 'AssignmentStatus', toEnum: toAssignmentStatusEnum as any, tryToEnum: tryToAssignmentStatusEnum as any, real: AssignmentStatus as any, lowercase: 'completed' },
    { label: 'SubmissionStatus', toEnum: toSubmissionStatusEnum as any, tryToEnum: tryToSubmissionStatusEnum as any, real: SubmissionStatus as any, lowercase: 'submitted' },
    { label: 'RegistrationStatus', toEnum: toRegistrationStatusEnum as any, tryToEnum: tryToRegistrationStatusEnum as any, real: RegistrationStatus as any, lowercase: 'registered' },
    { label: 'SourceHealthStatus', toEnum: toSourceHealthStatusEnum as any, tryToEnum: tryToSourceHealthStatusEnum as any, real: SourceHealthStatus as any, lowercase: 'ok' },
    { label: 'ScheduleType', toEnum: toScheduleTypeEnum as any, tryToEnum: tryToScheduleTypeEnum as any, real: ScheduleType as any, lowercase: 'class' },
    { label: 'ChatMessageRole', toEnum: toChatMessageRoleEnum as any, tryToEnum: tryToChatMessageRoleEnum as any, real: ChatMessageRole as any, lowercase: 'user' },
    { label: 'GradeSource', toEnum: toGradeSourceEnum as any, tryToEnum: tryToGradeSourceEnum as any, real: GradeSource as any, lowercase: 'manual' },
    { label: 'AttendanceStatus', toEnum: toAttendanceStatusEnum as any, tryToEnum: tryToAttendanceStatusEnum as any, real: AttendanceStatus as any, lowercase: 'present' },
    { label: 'AnnouncementTarget', toEnum: toAnnouncementTargetEnum as any, tryToEnum: tryToAnnouncementTargetEnum as any, real: AnnouncementTarget as any, lowercase: 'all_departments' },
    { label: 'AnnouncementTargetScope', toEnum: toAnnouncementTargetScopeEnum as any, tryToEnum: tryToAnnouncementTargetScopeEnum as any, real: AnnouncementTargetScope as any, lowercase: 'all_colleges' },
    { label: 'AssignmentScope', toEnum: toAssignmentScopeEnum as any, tryToEnum: tryToAssignmentScopeEnum as any, real: AssignmentScope as any, lowercase: 'department' },
    { label: 'SubmissionMode', toEnum: toSubmissionModeEnum as any, tryToEnum: tryToSubmissionModeEnum as any, real: SubmissionMode as any, lowercase: 'online' },
  ]

  it('lowercase input maps to a REAL member of the matching Prisma enum', () => {
    for (const c of CASES) {
      const mapped = c.toEnum(c.lowercase)
      expect(
        (Object.values(c.real) as string[]).includes(mapped),
        `${c.label}: "${c.lowercase}" must map to a REAL member (got "${mapped}")`
      ).toBe(true)
      expect(Object.values(c.real)).toContain(mapped)
    }
  })

  it('mixed-case + whitespace normalize (case-insensitive boundary)', () => {
    expect(toRoleEnum('  teacher  ')).toBe(UserRole.TEACHER)
    expect(toTaskStatusEnum('In_Progress')).toBe(TaskStatus.IN_PROGRESS)
    expect(toPriorityEnum('critical')).toBe(Priority.CRITICAL)
    expect(toReportStatusEnum('in_progress')).toBe(ReportStatus.IN_PROGRESS)
    expect(toAssignmentScopeEnum('room')).toBe(AssignmentScope.ROOM)
    expect(toSubmissionModeEnum('Hybrid')).toBe(SubmissionMode.HYBRID)
    expect(toScheduleTypeEnum('seminar')).toBe(ScheduleType.SEMINAR)
    expect(toCollegeStatusEnum('suspended')).toBe(CollegeStatus.SUSPENDED)
  })

  it('ghosts fail closed (throw) and try-variant returns null', () => {
    for (const c of CASES) {
      expect(() => c.toEnum('nosuchenum'), `${c.label} must throw on ghost`).toThrow(/Invalid/)
      expect(() => c.toEnum(''), `${c.label} must throw on empty`).toThrow(/Invalid/)
      expect(() => c.toEnum(null), `${c.label} must throw on null`).toThrow(/Invalid/)
      expect(c.tryToEnum('nosuchenum'), `${c.label} try must be null on ghost`).toBeNull()
    }
  })

  it('lib/enums validates against REAL Prisma enums (not hardcoded copies)', () => {
    const src = readSrc('lib/enums.ts')
    expect(src).toContain(`from '@prisma/client'`)
    for (const name of [
      'UserRole', 'StagingDecision', 'StagingStatus', 'HackathonStatus',
      'InternshipStatus', 'ContestStatus', 'CollegeStatus', 'FormStatus',
      'ReportStatus', 'ReportScope', 'ReportIssueType', 'Priority',
      'TaskStatus', 'AssignmentStatus', 'SubmissionStatus', 'RegistrationStatus',
      'SourceHealthStatus', 'ScheduleType', 'ChatMessageRole', 'GradeSource',
      'AttendanceStatus', 'AnnouncementTarget', 'AnnouncementTargetScope',
      'AssignmentScope', 'SubmissionMode',
    ]) {
      expect(src, `lib/enums must import REAL ${name}`).toContain(name)
    }
    expect(src).toContain('Object.values')
  })
})

describe('enum sweep: Prisma boundary uses choke points (no lying enum casts)', () => {
  it('tasks filter normalizes status (no raw passthrough 500)', () => {
    const src = readSrc('routes/tasks.ts')
    expect(src).toContain('tryToTaskStatusEnum')
    expect(src).not.toMatch(/if\s*\(status\)\s*where\.status\s*=\s*status/)
  })

  it('auth normalizes role + writes via REAL UserRole', () => {
    const src = readSrc('routes/auth.ts')
    expect(src).toContain('toRoleEnum')
    expect(src).toContain(`from '../lib/enums'`)
    expect(src).not.toMatch(/role:\s*safeRole\s+as\s+any/)
  })

  it('assignmentVisibility normalizes scope/mode (case-insensitive, no silent mis-filter)', () => {
    const src = readSrc('utils/assignmentVisibility.ts')
    expect(src).toContain('tryToAssignmentScopeEnum')
    expect(src).toContain('tryToSubmissionModeEnum')
  })

  it('staging normalizes status (lowercase pending never mis-filters)', () => {
    const src = readSrc('services/opportunities/staging.ts')
    expect(src).toMatch(/toUpperCase\(\)/)
    expect(src).not.toMatch(/const status = scope\.status;/)
  })

  it('admin staging counts use REAL StagingStatus (no as any)', () => {
    const src = readSrc('routes/admin.ts')
    expect(src).toContain('StagingStatus.APPROVED')
    expect(src).toContain('StagingStatus.REJECTED')
    expect(src).not.toMatch(/status:\s*\{\s*notIn:\s*\['APPROVED',\s*'REJECTED'\]\s*\}\s*as\s+any/)
  })

  it('contests create/seed/update use REAL Platform + ContestStatus', () => {
    const src = readSrc('routes/contests.ts')
    expect(src).toContain('toPlatformEnumStrict')
    expect(src).toContain('toContestStatusEnum')
    expect(src).not.toMatch(/platform:\s*normalizedPlatform\s+as\s+any/)
    expect(src).not.toMatch(/status:\s*computedStatus\s+as\s+any/)
    expect(src).not.toMatch(/platform:\s*s\.platform\s+as\s+any/)
  })

  it('assignmentHub writes scope/mode via REAL enums (400 on ghost)', () => {
    const src = readSrc('routes/assignmentHub.ts')
    expect(src).toContain('toAssignmentScopeEnum')
    expect(src).toContain('toSubmissionModeEnum')
    expect(src).not.toMatch(/scope:\s*body\.scope\s+as\s+any/)
    expect(src).not.toMatch(/submissionMode:\s*body\.submissionMode\s+as\s+any/)
    expect(src).not.toMatch(/data\.scope\s*=\s*body\.scope\s+as\s+any/)
  })

  it('attendance + schedules + timetable use REAL enums (no as any)', () => {
    expect(readSrc('routes/attendance.ts')).toContain('toAttendanceStatusEnum')
    expect(readSrc('routes/attendance.ts')).not.toMatch(/status:\s*r\.status\s+as\s+any/)
    expect(readSrc('routes/schedules.ts')).toContain('toScheduleTypeEnum')
    expect(readSrc('routes/timetable.ts')).toContain('toScheduleTypeEnum')
  })

  it('search platform filter uses REAL enum (no hardcoded allowlist + as any)', () => {
    const src = readSrc('routes/search.ts')
    expect(src).toContain('tryToPlatformEnumStrict')
    expect(src).not.toMatch(/platform:\s*\{\s*equals:\s*trimmed\.toUpperCase\(\)\s+as\s+any/)
  })

  it('raw SQL has no hardcoded enum strings (parameterized only)', () => {
    const fetcher = readSrc('services/contestFetcher.ts')
    // The only $queryRawUnsafe is parameterized ($1/$2) with a fixed column
    // allowlist — no enum literal smuggled into SQL text.
    expect(fetcher).toMatch(/\$queryRawUnsafe/)
    expect(fetcher).not.toMatch(/WHERE "platform" = '(CODEFORCES|CODECHEF|LEETCODE|UPCOMING|ENDED)'/)
    expect(fetcher).not.toMatch(/WHERE "status" = '(UPCOMING|ONGOING|ENDED)'/)
  })

  it('seed uses UPPERCASE enum members (no lowercase leak into native columns)', () => {
    const seed = fs.readFileSync(path.resolve(__dirname, '../prisma/seed.ts'), 'utf8')
    expect(seed).not.toMatch(/role:\s*'(student|teacher|college_admin|super_admin)'/)
    expect(seed).not.toMatch(/platform:\s*'(codeforces|codechef|leetcode|hackerrank|gfg)'/)
    expect(seed).not.toMatch(/status:\s*'(pending|active|draft|published|completed|upcoming|ongoing|ended|open|closed)'/)
    expect(seed).not.toMatch(/priority:\s*'(low|medium|high|critical)'/)
    // Spot-check REAL members present.
    for (const v of ['STUDENT', 'TEACHER', 'COLLEGE_ADMIN', 'SUPER_ADMIN', 'APPROVED', 'PUBLISHED', 'REGISTERED', 'ACTIVE', 'CLASS', 'LAB', 'SEMINAR', 'OTHER']) {
      expect(seed, `seed must contain REAL member ${v}`).toContain(v)
    }
  })
})
