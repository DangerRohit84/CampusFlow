# Task 1: Prisma Schema + Migration - Report

## What I Implemented

Added three new models to the Prisma schema (`packages/backend/prisma/schema.prisma`):

1. **Internship** - Represents internship opportunities with fields for company, role, stipend, duration, mode, eligibility targeting, and status tracking.
2. **InternshipRegistration** - Junction table tracking user registrations for internships, with unique constraint on [internshipId, userId].
3. **CodingContest** - Represents coding contests with platform, timing, duration, contest type, solutions, and auto-fetch tracking.

Added corresponding relation fields to existing models:
- **User**: `internships`, `internshipRegistrations`, `codingContests`
- **College**: `internships`, `codingContests`

All relations are properly defined with foreign keys and references. The schema is SQLite-compatible with no PostgreSQL-specific features used.

## What I Tested and Test Results

1. **`npx prisma db push`** - Successfully applied schema changes to SQLite database. Output: "The database is now in sync with your Prisma schema."
2. **`npx prisma generate`** - Successfully generated Prisma Client (after resolving Windows file-locking issue). Output: "Generated Prisma Client (v6.19.3)"
3. **Schema validation** - No errors after adding all required relations, including the `codingContests` reverse relation on User that was initially missing.

## Files Changed

- `packages/backend/prisma/schema.prisma` - Added 3 new models + 5 new relation fields across User and College models (60 lines added)

## Self-Review Findings

- Initially missed adding `codingContests CodingContest[]` to the User model, causing a validation error: "The relation field `creator` on model `CodingContest` is missing an opposite relation field on the model `User`." This was corrected before committing.
- The `CodingContest` model uses optional `creator` and `college` fields (nullable foreign keys), which is appropriate for auto-fetched contests that may not have an associated user or college.
- All JSON fields use string storage with `"[]"` or `"{}"` defaults as required for SQLite compatibility.
- The `InternshipRegistration` model uses `@@unique([internshipId, userId])` to prevent duplicate registrations, matching the pattern used in `HackathonRegistration`.

## Issues or Concerns

None. All tasks completed successfully.

## Commits

- `80dc100` - `feat(schema): add Internship, InternshipRegistration, CodingContest models`
