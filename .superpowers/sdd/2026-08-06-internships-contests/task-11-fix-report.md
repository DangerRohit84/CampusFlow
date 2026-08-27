# Task 11: Fix QA Bugs in Contests Backend Routes

**Date:** 2026-08-07
**Commit:** `c479858` — fix: align contest backend routes with frontend API client

---

## Bugs Fixed

### Bug 1: Route mismatch for fetch-now (CRITICAL)
- **Frontend call:** `codingContestAPI.fetchNow()` → `POST /contests/fetch-now`
- **Backend had:** `POST /contests/fetch-auto`
- **Fix:** Renamed route from `/fetch-auto` to `/fetch-now` (line 401)

### Bug 2: Missing /contests/calendar route (CRITICAL)
- **Frontend call:** `codingContestAPI.getCalendar()` → `GET /contests/calendar?start=...&end=...`
- **Backend had:** No such route
- **Fix:** Added `GET /calendar` route (lines 96-155) that:
  - Accepts `start` and `end` query params (ISO date strings)
  - Filters contests by `startTime` within the date range
  - Respects role-based college filtering
  - Returns `solutionsCount` per contest as a registrations proxy
  - Placed before `/:id` to avoid route conflict

### Bug 3: Missing /contests/by-date/:date route (dead code)
- **Frontend call:** `codingContestAPI.getByDate()` → `GET /contests/by-date/:date`
- **Backend had:** No such route
- **Fix:** Added stub route (lines 157-172) that returns empty array `[]`
  - Marked as dead code placeholder

### Bug 4: Missing PUT /:id/solutions route (dead code)
- **Frontend call:** `codingContestAPI.updateSolutions()` → `PUT /contests/:id/solutions` (bulk replace)
- **Backend had:** Only `POST /:id/solutions` (append) and `DELETE /:id/solutions/:index`
- **Fix:** Added `PUT /:id/solutions` route (lines 239-275) that:
  - Accepts `{ solutions: [...] }` body
  - Replaces the entire solutions array
  - Requires teacher/admin/owner permissions

### Bug 5: No CodingContestSolution model (design choice - no change)
- Schema uses embedded JSON in `CodingContest.solutions` field
- Decision: Keep as-is per original plan — "embedded JSON is fine for simplicity"

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/backend/src/routes/contests.ts` | Renamed fetch-auto→fetch-now, added 3 new routes |

## TypeScript Status

Ran `npx tsc --noEmit --project packages/backend/tsconfig.json`. All errors are pre-existing Express 5 `string | string[]` type issues across all route files — **no new errors introduced** by these changes.

## Route Order (after fix)

```
POST   /                    — Create contest
GET    /                    — List contests
GET    /calendar            — Calendar view (date range)  [NEW]
GET    /by-date/:date       — By date (stub)              [NEW]
GET    /:id                 — Get single contest
PUT    /:id                 — Update contest
PUT    /:id/solutions       — Bulk replace solutions       [NEW]
DELETE /:id                 — Delete contest
POST   /:id/solutions       — Add solution
DELETE /:id/solutions/:idx  — Remove solution
POST   /fetch-now           — Auto-fetch from platforms    [RENAMED]
```
