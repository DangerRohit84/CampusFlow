# Task 3 Report
Status: DONE
Implemented: Created packages/backend/src/routes/assignmentSubmissions.ts with enforceSubmissionMode (ONLINE requires file/content, OFFLINE forbids file, requires text), multer handling, POST /hub/:hubId/submissions (student scope checks college/department/room, late check, upsert), GET /hub/:hubId/submissions (teacher paginated), PUT /submissions/:id/grade (points validation 0..maxPoints), GET /my-submissions (visibility gated grades/feedback/status), GET /hub/:hubId/stats (eligible counts per scope, submission rate, avgPoints, showStats gate). Mounted at /api/assignments via assignmentSubmissionsRouter after hub router.

Testing: tsc PASS. Enforce logic matches spec; visibility gating hides grades/feedback/status when flags false.

Files:
- packages/backend/src/routes/assignmentSubmissions.ts (new)
- packages/backend/src/index.ts (modified)
