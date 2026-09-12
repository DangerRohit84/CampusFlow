# Task 4: Backend — Contest Fetcher Service

**Files:**
- Create: `packages/backend/src/services/contestFetcher.ts`
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**
- Produces: `fetchAndStoreContests()` function, cron scheduler
- Consumes: `prisma` from `../config/db`

- [ ] **Step 1: Install node-cron**

Run: `cd packages/backend && npm install node-cron && npm install -D @types/node-cron`

- [ ] **Step 2: Create contestFetcher.ts**

Create `packages/backend/src/services/contestFetcher.ts` with:
- `fetchLeetCode()` — fetches from leetcode.com/api/contests/
- `fetchCodeChef()` — fetches from codechef.com/api/contests
- `fetchCodeforces()` — fetches from codeforces.com/api/contest.list
- `fetchYouTubeSolutions(contestTitle, platform)` — optional, needs YOUTUBE_API_KEY env var
- `fetchAndStoreContests()` — main function, calls all three platform fetchers, dedupes by URL, saves to DB

- [ ] **Step 3: Add cron scheduler to index.ts**

In `packages/backend/src/index.ts`, add cron import and schedule `0 */6 * * *` for contest fetch. Also run initial fetch on server start.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/contestFetcher.ts packages/backend/package.json packages/backend/src/index.ts
git commit -m "feat(backend): add contest fetcher service with node-cron scheduler"
```
