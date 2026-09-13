# ADR: Scale 10k — Shard 500 + Redis-Shared Gates (Track D)

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** senior-dev (Track D), CTO audit
- **Scope:** `packages/backend` only — socket fan-out (`services/socket.ts`), CF gate (`services/codeforcesGate.ts`), GitHub throttle (`routes/codingProfile.ts`), AI quota (`middleware/aiQuota.ts`), shared Redis (`lib/redis.ts`, `lib/cache.ts`), config flag (`config/index.ts`), rate limits unchanged (`middleware/rateLimits.ts`). Track A college-scoped emits extended, not reverted. Track C CORS/origins untouched.
- **Inputs:** `.ai/reports/scale-10k-audit.md` (P0-1 socket, P1-1 CF gate, P1-2 AI quota/github), `.ai/reports/fix-trackA-backend.md` (emitToCollege scoping), `.ai/reports/fix-trackC-deploy.md` (origins SSOT).

## Context

10k concurrent/active needs bounded hourly cron + shared emit + global upstream gates:

- Demand 10k/hour = 2.78 users/s for full freshness. Batch-5 throughput avg 1.25/s (4500/h), worst 0.625/s (2250/h), all-CF worst 0.167/s (600/h). Full hourly freshness at 10k impossible without more workers + CF allowlist.
- Single `starter` API cannot hold 10k sockets + burst (practical ~2–4k/instance). `render.yaml` was 1× starter, no adapter — presence shared, delivery not.
- Global `safeEmit` fan-out woke every socket (10k × 2–5 events per mutation).
- Three limiters process-local: CF 2s gate (N× burst), `aiQuota` Maps, `githubThrottle` Map.
- Rate limits already 1000/15m per (IP+user) with shared Redis store — must keep, no queries-per-request increase.

## Decision

**Shard 500 + 45min budget + Redis-shared everything + 1 scoped event/mutation + bounded staleness.**

### 1. Sync sharding (unchanged, locked)

- `SYNC_SHARD_SIZE=500` (env, max 5000), `SYNC_TIME_BUDGET_MS=45min`, `SYNC_PAGE_SIZE=200`. Remainder stays stale → next hourly run picks oldest first (rotation, no cursor).
- Math: shard 500 avg 400s (7min), worst 800s (13min), all-CF worst 3000s (50min) ≈ budget. 10k/500 = 20 runs ≈ 20h full cycle worst-case all-stale; steady-state 1–5h staleness. ≤2k users ≈ full freshness hourly.
- Do NOT raise shard without (a) global CF gate (landed here) + (b) raising time budget + (c) staging `TEST_JWT --auth` proof.

### 2. Socket fan-out (P0-1, landed)

- Dep: `@socket.io/redis-adapter@^8.3.0` (uses existing `ioredis`, no new `redis` client dep).
- `attachSocketAdapter(io)` in `services/socket.ts`: Redis adapter when `REDIS_URL` set, fail-open to memory otherwise (dev works, single-replica prod works). Never throws, never blocks `initSocket`. Mode via `getSocketAdapterMode()` respecting `SOCKET_ADAPTER=redis|memory|auto` (config SSOT `config.socketAdapter`).
- Sticky sessions (Render): with adapter, emits correct WITHOUT stickiness (+1 RTT on re-poll); WITH affinity, upgrade faster. Render: API `numInstances>=2` + session affinity when available. See §5.
- Scoping: all broadcasts via `emitToCollege`/`scopedEmit` (Track A preserved). Collapsed to **1 scoped event per mutation** (was 3–5×):
  - `assignment:mutated`, `form:mutated`, `announcement:mutated`, `room:mutated`, `internship:mutated`, `hackathon:mutated`, `contest:mutated`, `schedule:mutated`, `attendance:mutated`, `grade:mutated`, `task:mutated` (single each).
  - Cross-entity max 2 (within 1–2 budget): `broadcastCodingProfileMutation` (profile+contest for leaderboard direct-socket), `broadcastCollegeMutation`/`broadcastUserMutation` (college+user/announcement for admin).
  - Callers fixed to single broadcast per mutation (`forms.ts` 2–3× → 1×, `codingProfile.ts` sync 2 broadcasts → 1).
  - Frontend safe: `entitySync.ts` prefix mapping + `RELATED_PREFIXES` bust dashboard/contests/schedules on single `*:mutated`; `SOCKET_EVENTS` direct-socket lists include cross-prefix (`task:mutated` in schedule, `contest:mutated` in coding-profile).

### 3. CF gate globalization (P1-1, landed)

- `cf:gate` SET NX PX 2000 (first starter wins globally, losers sleep PTTL+5ms, 10 attempts max ≈20s then memory fallback so wedged key never hangs cron).
- Memory chain preserved as fast-path + fallback (identical single-instance, N× degraded multi-instance until `REDIS_URL`). Contracts unchanged (`acquireCodeforcesSlot({now,sleep})`, retry helpers, 2s gap, 1 retry).
- Only CF paths import gate (LC/CodeChef/HR/GFG bypass).

### 4. AI quota + GitHub throttle to Redis (P1-2, landed)

- AI quota keys `ai:quota:user:{uid}:{day}` / `ai:quota:college:{cid}:{day}` (INCR/INCRBY + EXPIRE until next UTC midnight+1h) + `ai:breaker:{feature}` PX 60s. L1 memory fast-path + L2 shared (no N× over-admit when `REDIS_URL`). Contracts unchanged (100/day user, 10k tokens/day college, 8000 chars 413, breaker 429+Retry-After, persistent `AiQuota`/`AiUsage` caps authoritative).
- GitHub throttle `gh:{scope}:{id}` SET PX 60s (4× 15s window) advisory (never 429s, upstream has 10m cache). L1 Map + L2 shared.
- New primitive `redisIncrBy` (native INCRBY when available, GET+SET fallback for mocks).

### 5. Render / regions (config only, no code)

- API `plan: standard`, `numInstances>=2` + autoscale (CPU 70%/p95), Key Value `standard`, Neon compute above free-tier for 10k, keep `singapore` for API+cache+crons+Neon (immutable, recreate if drifted).
- Sticky: enable session affinity when Render offers it; without it, correctness holds via adapter (perf note only).

### 6. Non-goals (explicit)

- No queries-per-request increase (all new layers Redis/memory only; `emitPerUserScoped` still 1 narrow `user.findUnique` only when `collegeId` absent).
- Rate limits unchanged (1000/15m per IP+user, auth 10/15m, cron 10/h, college-register 5/h, coding-problems 20/10s).
- No `render.yaml`/`apps/web`/`vercel.json` edits here (Track C owns origins; Track A owns visibility).

## Consequences

### Easier

- N replicas share one CF 0.5 req/s budget (no `Call limit exceeded` N×), one AI budget (no Groq 429 flaps per-replica), one GitHub throttle, one socket fan-out.
- One admin mutation = ~college size wake-ups × 1 event (was 10k × 3–5). 10k thundering herd gone.
- Dev/CI zero-infra (all fail-open to memory, warn-once). Staging proofs via `SOCKET_ADAPTER` flag.

### Harder / trade-offs

- Redis becomes P0 infra (prod requires `REDIS_URL`; without it budgets inflate N×, delivery drops cross-instance — boot logs warn, never 500).
- `cf:gate` adds ~1 Redis RTT per CF call (P50 <5ms SG, negligible vs 2s gap). 10-loss fallback to memory over-admits by 1 (availability over strictness).
- Single `*:mutated` drops secondary event names (older clients listening only to `form:updated` must also handle `form:mutated` — frontend `SOCKET_EVENTS` already includes both, Layout bridges all; no break).

## Validation

- `npx tsc --noEmit` clean (backend).
- `vitest run` related: `scale10k-redis`, `scale10k-shard-load`, `sync-upgrades` (CF gate contracts), `prod-harden` (aiQuota), `state-sync` (bridge coverage), `rate-limits`, `db-*` (no query increase).
- New Track D tests: `tests/scale-trackD.test.ts` (adapter mode fail-open, CF `cf:gate` shared, AI quota shared + contracts, github `gh:` shared, single-emit static asserts).
- No secrets in logs (never log `REDIS_URL` value, only presence). No live-DB proof here (staging gate per audit P0-2 still required).

## Revisit triggers

- `truncated:true` rate >10%/day (shard too small) → raise `SYNC_SHARD_SIZE`/`SYNC_TIME_BUDGET_MS` via env (CF gate now global, safe to raise).
- CF `Call limit exceeded` >1%/sync (gate losing) → check `cf:gate` PTTL contention, add workers, or lengthen skip window.
- `[db:metrics] maxConcurrent` >40 sustained or `slow>500ms` ratio climbing → Neon compute sizing, `(lastSyncedAt,userId)` composite, read replicas.
- `maxConcurrent` vs pool 50, p95 per-query SG ~5ms assumed — re-measure with `TEST_JWT --auth` 200×6 staging (expect p95 <500ms, 0 5xx).
- 2-replica socket test (A emits, B receives) + 2-replica NAT burst (50 users × bundle, one IP; per-user buckets, single sync claim, single cron run) before prod raise.
