Status: DONE
Commits: pending (will commit after report)
Test summary: 
- POST /forms: Added isCR check that allows STUDENTs who are CRs of rooms in roomIds to create forms
- PUT /forms/:id: Replaced ownership check with combined isOwner || isAdmin || isCRofLinkedRoom check
- DELETE /forms/:id: Replaced ownership check with combined isOwner || isAdmin || isCRofLinkedRoom check
- PUT /forms/:id/fields: Replaced ownership check with combined isOwner || isAdmin || isCRofLinkedRoom check
- Added null checks for user in PUT and fields routes
- TypeScript check shows no new errors (only pre-existing errors in codebase)
Concerns: None - all changes follow the brief exactly
