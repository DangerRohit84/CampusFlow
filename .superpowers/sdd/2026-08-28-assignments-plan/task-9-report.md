# Task 9 Report
Status: DONE
Implemented: Created AssignmentHubPage with role-aware views: teacher (stats, submissions table, GradeModal) and student (SubmissionPanel), filters (scope/mode/search), pagination, detail drawer via Modal, create/edit via CreateAssignmentModal. Wrapped AssignmentsPage to delegate to hub. Fixed EmptyState icon and Pagination props to match existing shared components.

Testing: tsc apps/web PASS.

Files:
- apps/web/src/pages/AssignmentHubPage.tsx (new)
- apps/web/src/pages/AssignmentsPage.tsx (modified wrapper)
