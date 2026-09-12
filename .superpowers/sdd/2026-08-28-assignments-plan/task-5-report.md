# Task 5 Report
Status: DONE
Implemented: Created apps/web/src/types/assignmentHub.ts with AssignmentScope, SubmissionMode, AssignmentHub, AssignmentSubmission interfaces. Extended apps/web/src/lib/api.ts with assignmentHubAPI containing 8 methods: getHubs (with pagination fallback), getHub, create (FormData detection), update, delete, submit (multipart), listSubmissions, grade, mySubmissions, stats. Follows existing api axios instance pattern with baseURL /api and JWT.

Testing: tsc apps/web PASS.

Files:
- apps/web/src/types/assignmentHub.ts (new)
- apps/web/src/lib/api.ts (modified)
