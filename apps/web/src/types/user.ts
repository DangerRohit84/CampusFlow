// types/user.ts — user identity (ISP split from api.ts).
// WHY: api.ts forced every client to depend on 15 interfaces (User+College+
// Hackathon+Form+Room+AI in one file). Focused files let list pages depend
// only on what they render. Shapes verbatim; api.ts re-exports for compat.
import type { College, Department } from './college'

export interface User {
  id: string
  name: string
  username?: string | null
  email: string
  role: 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN'
  departmentId?: string
  departmentName?: string
  department?: Department
  collegeId?: string
  college?: College
  incomingYear?: number
  outgoingYear?: number
  empNumber?: string
  studentId?: string
  avatarUrl?: string
  avatar?: string | null
  portfolioUrl?: string | null
  // P1 shared-password import + bulk-password nudge (§10): nudge-only flags
  // (no login block). FE shows a dismissible banner when either is true.
  mustChangePassword?: boolean
  passwordNudge?: boolean
  // Username setup flow (2026-10-04, additive): provisional auto-set vs
  // user-chosen + max-3 change budget (STUDENT/TEACHER/COLLEGE_ADMIN;
  // SUPER_ADMIN exempt with remainingChanges=null). needsSetup/
  // needsUsernameSetup drive the first-login UsernameSetupModal (true when
  // username missing OR provisional auto-set not yet confirmed).
  usernameSetByUser?: boolean
  usernameChangeCount?: number
  remainingChanges?: number | null
  maxChanges?: number
  needsSetup?: boolean
  needsUsernameSetup?: boolean
}
