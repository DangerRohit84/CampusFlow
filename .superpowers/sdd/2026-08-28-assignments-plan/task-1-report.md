# Task 1 Report
Status: DONE
Implemented: Added enums AssignmentScope (ALL, DEPARTMENT, ROOM) and SubmissionMode (ONLINE, OFFLINE, HYBRID); Added AssignmentHub model with 7 indexes and AssignmentSubmission with 4 indexes + unique; Added relations to User (createdAssignmentHubs, assignmentSubmissions, gradedSubmissions), College, Department, Room; Added deprecated comment for legacy Assignment; Created migration 20260828000000_assignment_hub with CREATE TYPE and CREATE TABLE + indexes + FKs; Ran prisma generate and validated tsc.

Testing: npx tsc --noEmit -p packages/backend/tsconfig.json PASS; prisma validate PASS; prisma generate PASS (v6.19.3). No DB migrate due to drift, but migration file created manually matches prisma expected output.

Files changed:
- packages/backend/prisma/schema.prisma
- packages/backend/prisma/migrations/20260828000000_assignment_hub/migration.sql (new)

Self-review: Schema preserves legacy Assignment, uses correct defaults, indexes aligned with plan, relations nullable where required, enums before models.
