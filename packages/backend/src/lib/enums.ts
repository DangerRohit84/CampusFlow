/**
 * Central enum boundary — choke-point helpers for EVERY native Prisma enum.
 *
 * Pattern extends lib/platform.ts (toPlatformEnum): trim + upper-case +
 * validate against the REAL Prisma enum (not a hardcoded copy), throw on
 * unknown (fail closed) or return null (try-variant for best-effort filters).
 *
 * Rule: convert at the Prisma boundary ONLY.
 * - Inbound (req.query/body, fetcher output, handle keys → Prisma): use
 *   `toXEnum()` (throw → caller 400s) or `tryToXEnum()` (null → caller
 *   ignores filter / skips row + warns). Never pass raw strings to Prisma.
 * - Outbound: DB enums are already UPPERCASE strings at runtime; API shapes
 *   stay stable (no lowercasing except Platform which keeps lowercase
 *   frontend contract via lib/platform.ts).
 *
 * SSOT: Prisma enums are authoritative. Zod enums in validators.ts mirror
 * them for request validation; this module validates against Prisma
 * directly so drift fails closed. Regression: tests/fix-enum-sweep.test.ts
 * asserts every family maps lowercase → REAL member and ghosts throw.
 */
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

function makeEnumHelpers<T extends string>(enumObj: Record<string, T>, label: string) {
  const valid = new Set<string>(Object.values(enumObj) as string[])
  function toEnum(input: unknown): T {
    const normalized = String(input ?? '').trim().toUpperCase()
    if (!normalized || !valid.has(normalized)) {
      throw new Error(
        `Invalid ${label}: ${JSON.stringify(String(input ?? ''))}. ` +
          `Allowed: ${[...valid].join(', ')}`
      )
    }
    return normalized as T
  }
  function tryToEnum(input: unknown): T | null {
    try {
      return toEnum(input)
    } catch {
      return null
    }
  }
  return { toEnum, tryToEnum, valid }
}

// --- Per-family helpers (each validates against the REAL Prisma enum) ---

const _role = makeEnumHelpers(UserRole, 'role')
export const toRoleEnum = _role.toEnum
export const tryToRoleEnum = _role.tryToEnum

const _stagingDecision = makeEnumHelpers(StagingDecision, 'decision')
export const toStagingDecisionEnum = _stagingDecision.toEnum
export const tryToStagingDecisionEnum = _stagingDecision.tryToEnum

const _stagingStatus = makeEnumHelpers(StagingStatus, 'staging status')
export const toStagingStatusEnum = _stagingStatus.toEnum
export const tryToStagingStatusEnum = _stagingStatus.tryToEnum

const _hackathonStatus = makeEnumHelpers(HackathonStatus, 'hackathon status')
export const toHackathonStatusEnum = _hackathonStatus.toEnum
export const tryToHackathonStatusEnum = _hackathonStatus.tryToEnum

const _internshipStatus = makeEnumHelpers(InternshipStatus, 'internship status')
export const toInternshipStatusEnum = _internshipStatus.toEnum
export const tryToInternshipStatusEnum = _internshipStatus.tryToEnum

const _contestStatus = makeEnumHelpers(ContestStatus, 'contest status')
export const toContestStatusEnum = _contestStatus.toEnum
export const tryToContestStatusEnum = _contestStatus.tryToEnum

const _collegeStatus = makeEnumHelpers(CollegeStatus, 'college status')
export const toCollegeStatusEnum = _collegeStatus.toEnum
export const tryToCollegeStatusEnum = _collegeStatus.tryToEnum

const _formStatus = makeEnumHelpers(FormStatus, 'form status')
export const toFormStatusEnum = _formStatus.toEnum
export const tryToFormStatusEnum = _formStatus.tryToEnum

const _reportStatus = makeEnumHelpers(ReportStatus, 'report status')
export const toReportStatusEnum = _reportStatus.toEnum
export const tryToReportStatusEnum = _reportStatus.tryToEnum

const _reportScope = makeEnumHelpers(ReportScope, 'report scope')
export const toReportScopeEnum = _reportScope.toEnum
export const tryToReportScopeEnum = _reportScope.tryToEnum

const _reportIssueType = makeEnumHelpers(ReportIssueType, 'report issueType')
export const toReportIssueTypeEnum = _reportIssueType.toEnum
export const tryToReportIssueTypeEnum = _reportIssueType.tryToEnum

const _priority = makeEnumHelpers(Priority, 'priority')
export const toPriorityEnum = _priority.toEnum
export const tryToPriorityEnum = _priority.tryToEnum

const _taskStatus = makeEnumHelpers(TaskStatus, 'task status')
export const toTaskStatusEnum = _taskStatus.toEnum
export const tryToTaskStatusEnum = _taskStatus.tryToEnum

const _assignmentStatus = makeEnumHelpers(AssignmentStatus, 'assignment status')
export const toAssignmentStatusEnum = _assignmentStatus.toEnum
export const tryToAssignmentStatusEnum = _assignmentStatus.tryToEnum

const _submissionStatus = makeEnumHelpers(SubmissionStatus, 'submission status')
export const toSubmissionStatusEnum = _submissionStatus.toEnum
export const tryToSubmissionStatusEnum = _submissionStatus.tryToEnum

const _registrationStatus = makeEnumHelpers(RegistrationStatus, 'registration status')
export const toRegistrationStatusEnum = _registrationStatus.toEnum
export const tryToRegistrationStatusEnum = _registrationStatus.tryToEnum

const _sourceHealth = makeEnumHelpers(SourceHealthStatus, 'source health status')
export const toSourceHealthStatusEnum = _sourceHealth.toEnum
export const tryToSourceHealthStatusEnum = _sourceHealth.tryToEnum

const _scheduleType = makeEnumHelpers(ScheduleType, 'schedule type')
export const toScheduleTypeEnum = _scheduleType.toEnum
export const tryToScheduleTypeEnum = _scheduleType.tryToEnum

const _chatRole = makeEnumHelpers(ChatMessageRole, 'chat role')
export const toChatMessageRoleEnum = _chatRole.toEnum
export const tryToChatMessageRoleEnum = _chatRole.tryToEnum

const _gradeSource = makeEnumHelpers(GradeSource, 'grade source')
export const toGradeSourceEnum = _gradeSource.toEnum
export const tryToGradeSourceEnum = _gradeSource.tryToEnum

const _attendanceStatus = makeEnumHelpers(AttendanceStatus, 'attendance status')
export const toAttendanceStatusEnum = _attendanceStatus.toEnum
export const tryToAttendanceStatusEnum = _attendanceStatus.tryToEnum

const _announcementTarget = makeEnumHelpers(AnnouncementTarget, 'announcement target')
export const toAnnouncementTargetEnum = _announcementTarget.toEnum
export const tryToAnnouncementTargetEnum = _announcementTarget.tryToEnum

const _announcementScope = makeEnumHelpers(AnnouncementTargetScope, 'announcement targetScope')
export const toAnnouncementTargetScopeEnum = _announcementScope.toEnum
export const tryToAnnouncementTargetScopeEnum = _announcementScope.tryToEnum

const _assignmentScope = makeEnumHelpers(AssignmentScope, 'assignment scope')
export const toAssignmentScopeEnum = _assignmentScope.toEnum
export const tryToAssignmentScopeEnum = _assignmentScope.tryToEnum

const _submissionMode = makeEnumHelpers(SubmissionMode, 'submission mode')
export const toSubmissionModeEnum = _submissionMode.toEnum
export const tryToSubmissionModeEnum = _submissionMode.tryToEnum

// Platform re-exported here for single-import convenience (canonical impl
// stays in lib/platform.ts to avoid changing existing imports).
const _platform = makeEnumHelpers(Platform, 'platform')
export const toPlatformEnumStrict = _platform.toEnum
export const tryToPlatformEnumStrict = _platform.tryToEnum
