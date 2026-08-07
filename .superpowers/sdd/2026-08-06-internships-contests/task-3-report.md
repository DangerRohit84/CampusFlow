# Task 3: Coding Contests Routes — Report

## What I Implemented

Created `packages/backend/src/routes/contests.ts` — a full Express router for the `CodingContest` model, and registered it in `packages/backend/src/index.ts`.

### Routes Implemented

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST /` | Create contest | Teacher/Admin | Create a new coding contest |
| `GET /` | List contests | All roles (filtered) | List contests filtered by role, optional `status` and `platform` query params |
| `GET /:id` | Get contest | All roles | Get single contest with creator info |
| `PUT /:id` | Update contest | Owner/Admin | Update contest fields |
| `DELETE /:id` | Delete contest | Owner/Admin | Delete a contest |
| `POST /:id/solutions` | Add solution | Teacher/Admin | Add a solution link to a contest |
| `DELETE /:id/solutions/:solutionIndex` | Remove solution | Owner/Admin | Remove a solution by index |
| `POST /fetch-auto` | Auto-fetch | Teacher/Admin | Fetch upcoming contests from Codeforces + CodeChef APIs, dedup by URL, save to DB |

### Role-Based Access Control

- **SUPER_ADMIN**: Sees all contests
- **COLLEGE_ADMIN**: Sees/creates contests for their college
- **TEACHER**: Sees/creates their own contests + college contests
- **STUDENT**: Sees contests from their college

### Auto-Fetch Feature

- Fetches from Codeforces API (`/api/contest.list`) — top 10 contests
- Fetches from CodeChef API (`/api/contests`) — present + future contests
- Deduplicates by URL before saving
- Saves with `isAutoFetched: true` and `creatorId` of the teacher who triggered it

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/src/routes/contests.ts` | **NEW** — Full contest routes |
| `packages/backend/src/index.ts` | Added import + route registration for `/api/contests` |

## Testing

- TypeScript compilation: All errors are pre-existing `req.params.id` type issues present across ALL existing route files (hackathons.ts, forms.ts, tasks.ts, etc.) — not introduced by this task
- The project uses `tsx watch` for dev (transpile-only, no type checking), so these TS errors don't affect runtime
- Route follows identical patterns to existing `hackathons.ts` and `forms.ts`

## Self-Review Findings

- No new TS errors introduced — all errors match existing codebase patterns
- Solutions stored as JSON string per schema convention (`"[]"` default)
- All routes use `authenticate` middleware consistently
- Follows the same role-check pattern as hackathons/forms routes

## Concerns

None.
