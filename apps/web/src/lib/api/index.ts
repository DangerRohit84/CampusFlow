// lib/api/index.ts — barrel (SSOT export map for API domain).
// New code imports from here (`../lib/api/index` resolves via `../lib/api`).
// lib/api.ts (sibling file) re-exports this barrel for backward compat so all
// 47 existing pages keep working without import churn.
// Export map:
//   client: api, API_BASE, API_URL, API_TIMEOUTS,
//     getSuperAdminOverrideCollegeId, resetAuthExpiredForTests
//   auth: authAPI
//   groq: getUserGroqKey, setUserGroqKey, clearUserGroqKey, groqHeader
//   resources/opportunities: hackathonAPI, internshipAPI, codingContestAPI,
//     DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
//   resources/admin: adminAPI, superAdminAPI, collegeAPI, userAPI,
//     departmentAPI, AdminUserQuery
//   resources/rooms: roomAPI, notificationAPI, chatAPI + socket SSOT
//   resources/assignments: assignmentAPI, assignmentHubAPI, gradesAPI,
//     attendanceAPI
//   resources/planner: scheduleAPI, taskAPI, timetableAPI, formAPI,
//     announcementsAPI
//   resources/profile: dashboardAPI, aiAPI, searchAPI,
//     matchAICodesToDepartments, publicProfileAPI, codingProfileAPI,
//     resumeAPI, reportAPI, waitForCodingSync

export * from './client'
export * from './auth'
export * from './groq'
export * from './resources/opportunities'
export * from './resources/admin'
export * from './resources/rooms'
export * from './resources/assignments'
export * from './resources/planner'
export * from './resources/profile'
export * from './resources/alumni'
