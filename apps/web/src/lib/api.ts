// lib/api.ts — compat barrel (Track 4 SRP split).
// WHY: this was a 56KB god module (axios instance + 2 interceptors +
// getSuperAdminOverrideCollegeId + matchAICodesToDepartments + 15 API objects
// + Groq key scan + socket re-exports in one file; changing hackathon paging
// risked breaking auth retry — SRP violation). Single sources now live in
// lib/api/* (client/auth/groq/resources/*); this file re-exports them so all
// 47 existing pages keep working without import churn. New code should import
// from './api/index' (or './api/client', './api/resources/...') directly.
// Behavior identical: single `api` axios instance from client.ts (timeouts,
// no-cache, null-guard, auth, superadmin scoping, 304/401 handling);
// AbortSignal threading preserved on every queryFn via resources/*.
// DELETED (now canonical elsewhere, no duplication):
//   client transport -> lib/api/client.ts (api, API_BASE, API_URL,
//     API_TIMEOUTS, getSuperAdminOverrideCollegeId, resetAuthExpiredForTests)
//   auth domain -> lib/api/auth.ts (authAPI)
//   Groq key (no scan, session-first) -> lib/api/groq.ts
//   opportunities (clamped limits) -> lib/api/resources/opportunities.ts
//   admin/college/user -> lib/api/resources/admin.ts (union getUsers,
//     single GROUP BY getRoleCounts)
//   rooms/chat/notify/socket -> lib/api/resources/rooms.ts
//   assignments/grades/attendance -> lib/api/resources/assignments.ts
//   planner/forms/announcements -> lib/api/resources/planner.ts
//   dashboard/AI/profile/resume -> lib/api/resources/profile.ts

export * from './api/client'
export * from './api/auth'
export * from './api/groq'
export * from './api/resources/opportunities'
export * from './api/resources/admin'
export * from './api/resources/rooms'
export * from './api/resources/assignments'
export * from './api/resources/planner'
export * from './api/resources/profile'

// Default-import compat: `import api from '../lib/api'` (legacy) resolves to
// the single client.ts instance (no forked axios).
export { default } from './api/client'
