/**
 * Single source of truth for Assignments All/Active/Completed tabs.
 * Mirrors backend `getAssignmentStatus` in
 * `packages/backend/src/utils/assignmentVisibility.ts` — keep in sync.
 *
 * - Active = dueDate>=now AND not submitted (OFFLINE/HYBRID no dueDate → Active unless graded)
 * - Completed = submitted OR graded OR past-due-with-submission
 * - All = everything
 *
 * Overdue without submission: Active when late allowed (still submittable),
 * otherwise Completed as missed/closed so Active+Completed partition All.
 */

export type AssignmentStatusFilter = 'all' | 'active' | 'completed'

const STORAGE_KEY = 'assignmentHubStatus'

export function normalizeAssignmentStatus(raw: unknown): AssignmentStatusFilter {
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
  if ((hub as any)?.allowLateSubmission) return 'active'
  return 'completed'
}

export function filterAssignmentsByStatus<T extends AssignmentStatusHubLike>(
  hubs: T[],
  status: AssignmentStatusFilter
): T[] {
  if (status === 'all') return hubs
  return hubs.filter((h) => getAssignmentStatus(h) === status)
}

export function getStoredAssignmentStatus(): AssignmentStatusFilter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const norm = normalizeAssignmentStatus(raw)
    // Only return stored if it was a valid explicit value (not fallback from garbage)
    if (raw.trim().toLowerCase() === norm) return norm
    return null
  } catch {
    return null
  }
}

export function setStoredAssignmentStatus(status: AssignmentStatusFilter) {
  try {
    localStorage.setItem(STORAGE_KEY, status)
  } catch {
    // ignore (private mode)
  }
}

export const ASSIGNMENT_STATUS_STORAGE_KEY = STORAGE_KEY
