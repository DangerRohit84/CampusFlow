# Task 2 Report
Status: DONE
Implemented: Created packages/backend/src/utils/assignmentVisibility.ts with isAssignmentVisibleToUser, buildHubListWhere, filterHubForStudentVisibility; Created packages/backend/src/routes/assignmentHub.ts with POST/GET list/GET id/PUT/DELETE, Zod schemas, scope validation (DEPARTMENT requires departmentId, ROOM requires roomId, ALL forbids both), department/room college checks, visibility filtering for STUDENT (ALL true, DEPARTMENT matches departmentId, ROOM checks roomMember), teacher list scoping, Cache-Control headers, pagination, ETag via existing middleware. Mounted router at /api/assignments/hub in index.ts.

Testing: npx tsc --noEmit -p packages/backend/tsconfig.json PASS (0 errors). Manual curl not run (requires server), but code compiles and handles Zod validation, auth, and visibility.

Files:
- packages/backend/src/utils/assignmentVisibility.ts (new)
- packages/backend/src/routes/assignmentHub.ts (new)
- packages/backend/src/index.ts (modified)

Self-review: Addresses all spec interfaces, uses authenticate middleware, respects roles, handles scope edge cases, pagination limits, ETag headers.
