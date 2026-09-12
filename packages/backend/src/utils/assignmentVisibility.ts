import { AssignmentScope } from '@prisma/client'
import { tryToAssignmentScopeEnum, tryToSubmissionModeEnum } from '../lib/enums'

export type AssignmentHubRow = {
  id: string
  collegeId: string | null
  scope: AssignmentScope
  departmentId: string | null
  roomId: string | null
}

export type UserRow = {
  id: string
  role: string
  collegeId: string | null
  departmentId: string | null
}

export function isAssignmentVisibleToUser(assignment: AssignmentHubRow, user: UserRow): boolean {
  if (user.role === 'SUPER_ADMIN') return true
  if (!assignment.collegeId || !user.collegeId) {
    if (assignment.scope === AssignmentScope.ALL && !assignment.collegeId) return true
    return assignment.collegeId === user.collegeId
  }
  if (assignment.collegeId !== user.collegeId) return false
  if (assignment.scope === AssignmentScope.ALL) return true
  if (assignment.scope === AssignmentScope.DEPARTMENT) {
    return !!assignment.departmentId && assignment.departmentId === user.departmentId
  }
  if (assignment.scope === AssignmentScope.ROOM) {
    return !!assignment.roomId
  }
  return false
}

export type AssignmentStatusFilter = 'all' | 'active' | 'completed'

export function normalizeStatusParam(raw: unknown): AssignmentStatusFilter {
  if (typeof raw !== 'string' || !raw.trim()) return 'all'
  const s = raw.trim().toLowerCase()
  if (s === 'active' || s === 'completed' || s === 'all') return s
  return 'all'
}

export type AssignmentStatusHubLike = {
  dueDate?: string | Date | null
  mySubmission?: { status?: string | null } | null
  submissionMode?: string | null
  allowLateSubmission?: boolean | null
  [k: string]: unknown
}

export function getAssignmentStatus(hub: AssignmentStatusHubLike): 'active' | 'completed' {
  const sub = (hub as any)?.mySubmission
  // WHY: RETURNED means teacher sent back for resubmit → still actionable (Active).
  // Null status (hidden via showSubmissionStatus) with existing row still means submitted → Completed.
  const hasValidSubmission = !!sub && (sub as any).status !== 'RETURNED'
  if (hasValidSubmission) return 'completed'
  const dueRaw = (hub as any)?.dueDate
  // WHY: OFFLINE/HYBRID legacy rows may lack dueDate → Active unless graded (graded handled above).
  if (!dueRaw) return 'active'
  const due = new Date(dueRaw as any).getTime()
  if (Number.isNaN(due)) return 'active'
  if (due >= Date.now()) return 'active'
  // Overdue without submission: still Active when late allowed (submittable),
  // otherwise Completed as missed/closed so Active+Completed partition All.
  if ((hub as any)?.allowLateSubmission) return 'active'
  return 'completed'
}

export function buildHubListWhere(user: UserRow, filters: { search?: string; scope?: string; submissionMode?: string; collegeId?: string; status?: string }) {
  const where: any = {}
  if (user.role === 'SUPER_ADMIN') {
    if (filters.collegeId) where.collegeId = filters.collegeId
    // else no college filter — global view
  } else if (user.collegeId) {
    where.collegeId = user.collegeId
  }
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' }
  // Order 4: scope/submissionMode are native enums (UPPERCASE). Normalize
  // case-insensitively at the boundary; ghosts are ignored (no filter) so a
  // lowercase '?scope=all' never 500s and never silently mis-filters.
  const normalizedScope = tryToAssignmentScopeEnum(filters.scope)
  if (normalizedScope) where.scope = normalizedScope
  const normalizedMode = tryToSubmissionModeEnum(filters.submissionMode)
  if (normalizedMode) where.submissionMode = normalizedMode
  const status = normalizeStatusParam((filters as any)?.status)
  // WHY: ?status is optional — missing/unknown means all (backward compat, no extra filter).
  if (status !== 'all') {
    const now = new Date()
    if (user.role === 'STUDENT') {
      const valid = ['SUBMITTED', 'LATE', 'GRADED']
      if (status === 'active') {
        // Active = dueDate>=now AND not submitted (+ overdue with late allowed still actionable,
        // OFFLINE/HYBRID no dueDate → Active unless graded which is covered by none-filter).
        // RETURNED excluded from valid → correctly stays Active (needs resubmit).
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { submissions: { none: { studentId: user.id, status: { in: valid } } } },
          { OR: [{ dueDate: { gte: now } }, { allowLateSubmission: true }] },
        ]
      } else {
        // Completed = submitted OR graded OR past-due-with-submission (+ overdue missed without
        // submission when late not allowed, so Active+Completed partition All).
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          {
            OR: [
              { submissions: { some: { studentId: user.id, status: { in: valid } } } },
              {
                AND: [
                  { dueDate: { lt: now } },
                  { allowLateSubmission: false },
                  { submissions: { none: { studentId: user.id, status: { in: valid } } } },
                ],
              },
            ],
          },
        ]
      }
    } else {
      // Teacher/admin view has no mySubmission — filter by dueDate only (keep cursor 50 pagination).
      if (status === 'active') where.dueDate = { gte: now }
      else where.dueDate = { lt: now }
    }
  }
  return where
}

export function filterHubForStudentVisibility(hub: any, user: UserRow) {
  const base = { ...hub }
  return base
}

export function filterSubmissionForStudentVisibility(hub: { showGrades: boolean; showFeedback: boolean; showSubmissionStatus: boolean }, submission: any) {
  const out: any = { ...submission }
  if (!hub.showGrades) { out.grade = null; out.points = null }
  if (!hub.showFeedback) out.feedback = null
  if (!hub.showSubmissionStatus) out.status = null
  return out
}
