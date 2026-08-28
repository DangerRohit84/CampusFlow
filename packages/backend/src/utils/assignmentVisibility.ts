import { AssignmentScope } from '@prisma/client'

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

export function buildHubListWhere(user: UserRow, filters: { search?: string; scope?: string; submissionMode?: string }) {
  const where: any = {}
  if (user.role !== 'SUPER_ADMIN' && user.collegeId) {
    where.collegeId = user.collegeId
  }
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' }
  if (filters.scope && ['ALL','DEPARTMENT','ROOM'].includes(filters.scope)) where.scope = filters.scope
  if (filters.submissionMode && ['ONLINE','OFFLINE','HYBRID'].includes(filters.submissionMode)) where.submissionMode = filters.submissionMode
  return where
}

export function filterHubForStudentVisibility(hub: any, user: UserRow) {
  const base = { ...hub }
  return base
}
