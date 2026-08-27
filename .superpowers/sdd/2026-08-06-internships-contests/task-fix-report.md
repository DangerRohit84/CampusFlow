# Contest Bug Fixes Report

**Date:** 2026-08-07
**Commit:** `2c943d4` - fix(backend): fix calendar date filter, LeetCode GraphQL API, and CodeChef API URL

## Bug 1: Calendar Prisma Error (contests.ts)

**File:** `packages/backend/src/routes/contests.ts` (line 122-125)

**Issue:** The `startTime` field in `CodingContest` is a `String` type in the Prisma schema. The calendar route was wrapping query params in `new Date()`, creating DateTime objects, but Prisma expects a String for String field comparison.

**Fix:** Changed to pass raw string values directly:
```typescript
where.startTime = {
  gte: start as string,
  lte: end as string,
}
```

ISO 8601 strings compare lexicographically, so string comparison works correctly for date ranges.

## Bug 2: LeetCode API URL (contestFetcher.ts)

**File:** `packages/backend/src/services/contestFetcher.ts` (line 15)

**Issue:** The URL `https://leetcode.com/api/contests/` returns 404. LeetCode changed their API.

**Fix:** Replaced with GraphQL API endpoint:
```typescript
const response = await fetch('https://leetcode.com/graphql/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'CampusFlow/1.0'
  },
  body: JSON.stringify({
    query: `query { brightTitle allContests { title titleSlug startTime duration } }`,
  }),
});
```

Also added `as any` type assertion to fix TypeScript errors.

## Bug 3: CodeChef API URL (contestFetcher.ts)

**File:** `packages/backend/src/services/contestFetcher.ts` (line 51)

**Issue:** The URL `https://www.codechef.com/api/contests` returns 404.

**Fix:** Changed to `https://www.codechef.com/api/contests/all` and added robust parsing:
- Handles both old structure (`present`/`future` arrays) and potential new structure (array)
- Returns empty array with console warning if structure is unexpected
- Added `as any` type assertion to fix TypeScript errors

## Files Changed

1. `packages/backend/src/routes/contests.ts` - Fixed calendar date filter
2. `packages/backend/src/services/contestFetcher.ts` - Fixed LeetCode GraphQL API and CodeChef API URL

## Status

All three bugs fixed and committed. Server should now correctly:
- Filter contests by date range in calendar view
- Fetch LeetCode contests via GraphQL API
- Fetch CodeChef contests from updated endpoint
