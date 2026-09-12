# Local dev DB performance — why 1300-6100ms on Neon us-east-2, <50ms locally

## TL;DR
- `SELECT 1` at 4177ms proves geography, not a missing index (no table, no index involved).
- IST → `us-east-2` is ~250-300ms RTT per round-trip + TLS handshake + pgbouncer queue.
  One logical request fans out to 10-100 queries → seconds.
- Fix for dev: run Postgres locally (`docker compose up db`), skip boot contest fetch,
  keep `SLOW_QUERY_MS=500` everywhere. Use an `ap-south-1` Neon branch only if you must use cloud in dev.

## Timing note (what numbers mean)
| Where | Typical per-query | Example from logs |
|---|---|---|
| Local Postgres (`localhost:5432`, no TLS) | 2-50ms | target after fix |
| IST → Neon `us-east-2` pooled, warm | 1300-3700ms | `User.findUnique 6113ms`, `AssignmentHub 1800-3200ms`, dashboard 100+ queries each 1300-3700ms |
| IST → Neon `us-east-2`, idle wake | 4000-6100ms+ | `SELECT 1 4177ms`, first `CodingContest.findFirst ~1500ms x30` on boot |
| IST → Neon `ap-south-1` (Mumbai branch) | 20-80ms warm | use for cloud dev if local is impossible |

Rule: if `SELECT 1` is slow, stop tuning indexes — fix locality first.

## Why EVERY query is slow (5 causes)
1. **Round-trip + TLS + pgbouncer** — each Prisma op = TCP + TLS (`sslmode=require`) + pgbouncer checkout over ~13,000km. `connection_limit=50` + `pool_timeout=30` + `connect_timeout=30` (see `src/config/db.ts` sanitize) keeps prod alive under burst but cannot beat physics.
2. **Neon idle wake ~4s** — free-tier compute sleeps; first query wakes it (`SELECT 1 4177ms`). `checkConnectivity()` + `withRetry(..., retries:2, baseDelayMs:600)` + `/api/health` degraded path exist for this; `tsx watch` reboot re-triggers it.
3. **N+1 dashboard fan-out** — super dashboard + assignment hub previously did per-college / per-hub loops. Current code uses `GROUP BY` aggregations (admin `super/dashboard`: 8 global `groupBy` + 2 submission `groupBy`, mapped in memory; assignmentHub student path: 2 batched queries — `groupBy` counts + `findMany` mySubs — instead of `2*N`). No per-row fallback scan: `groupBy(...).catch(() => [])` degrades to empty counts, never to an N+1 loop.
4. **Pool 50** — `connection_limit=50` (was 20) gives burst headroom (~500 rps) without `P2024`, but 100+ concurrent dashboard queries still queue behind the same 50 pgbouncer slots over a slow link.
5. **`tsx watch` + contest fetch on boot** — `npm run dev` = `tsx watch src/index.ts`; every save re-runs `runContestsJob()` (3 external APIs + `~30x CodingContest.findFirst` + status sweep + seed). On `us-east-2` that is 30-60s of boot pressure. Gated now by `SKIP_CONTEST_BOOT_FETCH=true` (see `src/index.ts`).

## Fast-local setup (docker-compose, <50ms)
```bash
# 1) Start local Postgres only (backend + frontend stay local, DB is local)
docker compose up db -d
docker compose ps  # db healthy (pg_isready)

# 2) Point backend at local DB
copy packages\backend\.env.local.example packages\backend\.env
# (fills: DATABASE_URL/DIRECT_URL=localhost:5432, SKIP_CONTEST_BOOT_FETCH=true, SLOW_QUERY_MS=500)

# 3) Migrate + generate (DIRECT_URL = direct, no pgbouncer)
cd packages/backend
npx prisma migrate deploy
npx prisma generate

# 4) Run backend (no boot contest fetch, no wake)
npm run dev
# expect: [db] pooled connectivity OK (SELECT 1 <50ms)
# expect: [Cron] Skipping initial contest fetch (SKIP_CONTEST_BOOT_FETCH=true)

# 5) Manual contest refresh only when needed
# POST /api/contests/fetch-now  (teacher/admin, 3/min throttle)
# POST /internal/cron/contests  (x-cron-secret header)
```

`docker-compose.yml` already wires this: `db` (postgres:16-alpine, `127.0.0.1:5432:5432`, healthcheck) + `backend.DATABASE_URL=postgresql://campusflow:campusflow@db:5432/campusflow`. Local `.env` uses `localhost:5432` for host-run backend; compose-run backend uses `db:5432`.

## ap-south-1 branch guidance (cloud dev only)
- Neon dashboard → project → Branches → New branch → Region `ap-south-1`, copy pooled (`-pooler` + `pgbouncer=true&connection_limit=50&pool_timeout=30`) into `DATABASE_URL`, direct (no `-pooler`, no pgbouncer) into `DIRECT_URL`. Keep `channel_binding=prefer&connect_timeout=30&sslmode=require`.
- Never commit live URLs (`.env` is gitignored; `.env.example` / `.env.local.example` keep placeholders only). `src/config/db.ts` sanitize logs `host + params` only, never passwords.
- Even on `ap-south-1`, keep `SKIP_CONTEST_BOOT_FETCH=true` in dev.

## Verified paths (no code change needed, confirmed by review)
- **Authorize 60s cache HIT** — `src/middleware/auth.ts`: `AUTHORIZE_TTL_MS=60_000`, LRU 1000 keys, `select { id, role }` only; `clearAuthorizeCache()` called on role update (`admin PUT /users/:id`, `DELETE /users/:id`) + logout/password-change. Second request within 60s = zero DB hit (avoids repeat `User.findUnique` 6113ms).
- **GROUP BY, no fallback scan** — `admin.ts super/dashboard` (college/user/hub/form/internship/hackathon/department `groupBy` + 2 submission `groupBy`), `assignmentHub.ts` student list (`groupBy` counts + single `findMany`). Fallback is empty-array degrade, never N+1.
- **Socket auth minimal** — `src/services/socket.ts auth:join` now `select { id: true }` (was full row). JWT already verified; existence check only.
- **SLOW 500 kept** — `SLOW_QUERY_MS` default `500` in `db.ts` + `.env.example` + `.env.local.example`. Do not raise to hide geography; slow logs + `[db:metrics]` stay on for capacity planning.

## EXPLAIN guidance (use only on LOCAL — cloud timings lie)
```sql
-- 1) Find the slow op from [db:slow] line, e.g. AssignmentHub.findMany 1800ms
-- 2) In psql on LOCAL DB:
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM "AssignmentHub" WHERE "collegeId" = 'xxx' ORDER BY "dueDate" ASC LIMIT 20;
-- 3) Read: Seq Scan + high Buffers + Filter Rows Removed >> Returned = missing index.
--    Index Only / Bitmap + low Buffers = healthy; slowness was RTT, not plan.
-- 4) Compare against schema.prisma @@index list (User[collegeId,role], AssignmentHub[collegeId,scope/dueDate], CodingContest[collegeId,status/platform/startTime]).
-- 5) Dashboard rule: one GROUP BY per dimension (see admin.ts), never per-college/per-hub loop.
--    AssignmentHub student path: 2 queries for page (counts groupBy + mySubs findMany), not 2*N.
```
Never `EXPLAIN` on `us-east-2` from IST to decide indexes — RTT dominates `Execution Time`. Reproduce on local Postgres first.

## Secrets hygiene
- No live `DATABASE_URL` / `JWT_SECRET` / `CRON_SECRET` in logs, reports, or examples. `db.ts` sanitize redacts passwords; `logger.ts` redacts `password/token/authorization/cookie/email`.
