# AssignmentHub

- Added AssignmentHub/AssignmentSubmission with scope (ALL/DEPARTMENT/ROOM) and submissionMode (ONLINE/OFFLINE/HYBRID)
- Teacher visibility toggles (showGrades/showFeedback/showSubmissionStatus/showStats) gate student view
- Backend routes: `/api/assignments/hub` CRUD, `/hub/:id/submissions` (mode-enforced), `/submissions/:id/grade`, `/my-submissions`, `/hub/:id/stats`
- Frontend: AssignmentHubPage role-aware (teacher/student), ScopeSelector, SubmissionModeToggle, VisibilityToggles, CreateAssignmentModal, AssignmentHubCard, SubmissionPanel, StatsPanel, GradeModal
- Legacy Assignment retained for backward compat (deprecated)
- Pagination + ETag caching, file attachments via storage layer, dark mode support
- Migration `20260828000000_assignment_hub` additive, no downtime; rollback via `prisma migrate resolve --rolled-back`
