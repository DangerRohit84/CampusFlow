# Task 10 Report
Status: DONE
Implemented: Added demo AssignmentHub seed (ALL/DEPARTMENT/ROOM) in prisma/seed.ts with checks for department/room existence, using upsert id seed-title. Verified indexes (7 on AssignmentHub, 4 on Submission) and Cache-Control header on GET /api/assignments/hub. Ran tsc backend & frontend PASS, built backend (tsc) and frontend (vite) successfully. Drift noted but migration file is additive and does not require DB reset in prod (prisma migrate deploy).

Testing: tsc BE 0, FE 0, vite build 2155 modules, 22s, no errors.

Files:
- packages/backend/prisma/seed.ts (modified)
