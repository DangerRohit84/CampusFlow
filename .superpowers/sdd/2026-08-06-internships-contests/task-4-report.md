# Task 4 Report: Contest Fetcher Service

## Summary
Implemented the backend contest fetcher service that automatically fetches coding contests from LeetCode, CodeChef, and Codeforces APIs, normalizes the data, and stores it in the database. Added a cron scheduler (every 6 hours) and runs an initial fetch on server start.

## Files Changed
- **Created:** `packages/backend/src/services/contestFetcher.ts` — Contest fetcher service with platform-specific fetchers, deduplication, status tracking, and YouTube solution fetching
- **Modified:** `packages/backend/package.json` — Added `node-cron` dependency and `@types/node-cron` dev dependency
- **Modified:** `packages/backend/src/index.ts` — Added cron scheduler import, scheduled fetch every 6 hours, and initial fetch on startup

## Implementation Details
- Three platform fetchers: `fetchLeetCode()`, `fetchCodeChef()`, `fetchCodeforces()` — each normalizes API responses to a common `NormalizedContest` interface
- `fetchAndStoreContests()` — main function that calls all three fetchers in parallel, deduplicates by platform+URL, creates new contests or updates status changes
- Status auto-calculation: UPCOMING → ONGOING → ENDED based on start time and duration
- YouTube solution auto-fetch when a contest transitions to ENDED
- `fetchYouTubeSolutions()` — optional, requires `YOUTUBE_API_KEY` env var, gracefully degrades if missing
- Cron schedule: `0 */6 * * *` (every 6 hours)
- Initial fetch runs on server startup

## Commit
- `4d9c4f6` — feat(backend): add contest fetcher service with node-cron scheduler

## Test Summary
- Service created with correct imports and exports matching the plan specification
- Cron scheduler added to index.ts with proper error handling

## Concerns
None
