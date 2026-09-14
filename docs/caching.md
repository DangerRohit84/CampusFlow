# CampusFlow Caching — TTL Table (P0-B Central Doc)

**Date:** 2026-09-14 (UTC)
**Scope:** `packages/backend` shared cache (`lib/cache.ts` getOrSet) + `services/listCache.ts` + `services/stagingCounts.ts` + `services/fetch/settingsCache.ts`
**Rules:** (1) every `SET` has TTL; (2) every shared key is tenant-segmented (`:{college}` / `:{userId}` / `:global`) — never cross-tenant; (3) every cache documents fresh vs stale; (4) `no-store` only for mutating-adjacent + PII-narrow reads; lists use `private,max-age + SWR`; (5) all paths fail-open (Redis dead = loader, never 500).

## 1. TTL table (fresh / stale / store / bust)

| Key / layer | Server TTL (getOrSet) | Browser (Cache-Control) | Store | Fresh (serve without revalidate) | Stale (SWR / TTL backstop) | Bust events |
|---|---|---|---|---|---|---|
| `authorize:{uid}` role+college | 60s | — (middleware, no list header) | Redis + L1 Map | 60s | TTL expiry | role/college update, bulk ops (`clearAuthorizeCache`) |
| `ai:quota:user:{uid}:{day}` / `college:{cid}:{day}` | to midnight+1h | — | Redis + L1 | day bucket | natural expiry | natural expiry only |
| `ai:breaker:{feature}` | 60s PX | — | Redis + L1 | 60s | natural expiry | natural expiry only |
| `presence:{uid}` | 24h | — | Redis | 24h | DEL on clean leave | `redisDel` on leave/disconnect |
| `rl:*` (rate-limit windows) | window (15m/60m/10s) | — (+ `Retry-After` on 429) | Redis Lua + memory fallback | window | natural expiry | natural expiry only (never lengthen to save ops — cut req instead) |
| `super-dashboard:{college}:{from}:{to}` | 60s | `private,max-age=15,SWR=30` (existing) | getOrSet (Redis+L1) | 60s server / 15s browser | SWR 30s browser, TTL server | time only (manual bust on admin write = future) |
| `contests:list:{scope}:u:{userId}:v{gen}:{platform}:{status}:{searchHash}:p{page}:l{limit}` (P0-B NEW) | **5m** (`CONTESTS_LIST_TTL_MS`) + jitter 0-10% | `private,max-age=60,SWR=30` + `X-Cache: HIT/MISS` | getOrSet (Redis+L1) + in-process + Redis singleflight | 5m server / 60s browser | SWR 30s browser, TTL 5m server | `bustContestsList(scope)` + `bustContestsList('global')` on create/update/delete/solution add-remove/fetch-now (fire-and-forget, TTL backstop) |
| `hackathons:list:{scope}:u:{userId}:v{gen}:{status}:{mine}:{searchHash}:p{page}:l{limit}` (P0-B NEW) | **5m** (`HACKATHONS_LIST_TTL_MS`) + jitter | `private,max-age=60,SWR=30` + `X-Cache` | getOrSet + singleflight | 5m / 60s | SWR 30s, TTL 5m | `bustHackathonsList(scope)` + global on created/deleted/approved/register/unregister (staging-only mutations bust counts only) |
| `internships:list:{scope}:u:{userId}:v{gen}:{mine}:{searchHash}:p{page}:l{limit}` (P0-B NEW) | **5m** (`INTERNSHIPS_LIST_TTL_MS`) + jitter | `private,max-age=60,SWR=30` + `X-Cache` | getOrSet + singleflight | 5m / 60s | SWR 30s, TTL 5m | `bustInternshipsList(scope)` + global on created/deleted/approved/register/unregister |
| `fetch:platform-settings` | 60s (`PLATFORM_SETTINGS_CACHE_TTL_MS`) | — (SUPER_ADMIN JSON, no browser cache) | getOrSet | 60s | TTL expiry | `invalidatePlatformSettingsCache()` on PUT `/:platform/limit`, PUT `/settings`, PUT `/config` |
| `staging-counts:{hack\|int}:{scope}` (P0-A) | 60s (`STAGING_COUNTS_CACHE_TTL_MS`) | `private,max-age=60,SWR=30` + `ETag: W/"hash"` + 304 | getOrSet | 60s server / 60s browser | SWR 30s, 304 saves bytes | `bustStagingCounts(kind,scope)` on approve/reject/staging:updated/deleted/fetched>0 (dirty-flag `staging:counts:updated` pushes 0-GET updates) |
| `fetch:stats:counts` | 60s | — | getOrSet | 60s | TTL | time only (health outside cache stays fresh) |
| `coding-problems:daily` | 20h | existing | existing | 20h | TTL | time only (already optimal) |
| `coding-problems:sheets` | 24h | `public,s-maxage=86400` (P1-7 edge) | HTTP edge | 24h | edge SWR | deploy |
| `coding-problems:automark:{handle}` | 10min | existing | existing | 10min | TTL | time only |
| `github:{user}:{days}` | 10min | existing | existing | 10min | TTL | time only (enforce server-side) |
| `stats:{platform}:{handle}` | 60s → **5m** (P1-2) | — | Memory → **Redis singleflight** (P1-1) | 60s today | TTL | time only |
| `scrape:{url-hash}` | 6h → **12h** (P0-5 done) | — | NodeCache → Redis/DB persist (P1) | 12h | TTL | time only (align to 12h cron) |
| `enrich:response:{model}:{prompt-hash}` (P1-5 NEW) | 24h | — | Redis (+DB?) | 24h | manual (prompt version bump) | prompt version bump |
| `fetch-settings` | 60s | — | existing | 60s | `PUT /fetch/*` bust | PUT bust |
| `departments:{college}` | 10min | RQ client | RQ client | 10min | `department:mutated` bust | mutation bust |
| FE RQ defaults | 3m stale / 10m gc (client) | — | Client | 3m | `notifyEntityMutated` + socket bridge | socket/event invalidate; slow lists 5m (P0-A), profile 5m, config 5m |

**Fresh vs stale vocabulary (Next.js `cacheLife` shape):**
- `fresh` = serve without revalidation (browser `max-age`, server TTL hit → `X-Cache: HIT`, 0 DB).
- `stale` = serve stale while revalidating async (browser `stale-while-revalidate`, server singleflight winner loads while losers wait ≤5s then fail-open).
- `expire` = TTL end → next read is a miss (loader + jittered SET).

## 2. Singleflight (hot-miss coalescing)

Location: `lib/cache.ts` `getOrSet` (all callers inherit automatically).

- **In-process:** `Map<key, Promise>` — N concurrent misses on one replica share one `loader()` (0 extra Redis ops). Cleared in `finally` (errors never cached, next call retries).
- **Cross-replica:** `lock:coalesce:{key}` `SET NX PX 10s` (`acquireRedisLock`):
  - Winner: double-checked `GET` (another replica may have SET already) → `loader()` → `SET` with jittered TTL → `release()` (Lua compare-del).
  - Loser (`acquired:false`): poll `GET` 100ms×50 (5s) for winner's `SET` → return it (0 DB). Timeout → fail-open own `loader()` + best-effort `SET` (duplicate work once per 5s window, never blocks).
  - `lock:null` (Redis down): fail-open direct `loader()` + `SET` (memory path still coalesces locally).
- **Double-checked GET:** before *and* after lock acquisition (thundering herd → 1 DB fetch per key per TTL, not N).
- **Fail-open:** every `await` in try/catch; `Command timed out` → loader value, never 500. `isRedisError` + `ensureRedisRejectionGuard` (process net) preserved.

## 3. Jittered TTL (stampede guard)

`withJitter(ttlMs, ratio=0.1)` → `ttlMs + uniform(0, ttlMs*0.1)` (only upward, never shortens freshness). All `getOrSet` SETs use it, so 5m list keys expire over a 30s window (5m–5m30s), not simultaneously. Pure + never throws (NaN/negative → base).

## 4. Versioned bust (no KEYS scan)

Published lists have unbounded pagination (`page/limit`) × users (`userId`), so exact-key `DEL` cannot enumerate. Instead:

- `*:list:gen:{scope}` (number, via `cache.incr`, fail-open, TTL-less — small int per scope).
- List key embeds `v{gen}`. `bust*List(scope)` = `incr(gen)` → all old keys orphaned (expire via 5m TTL), new reads use `v+1` (immediate freshness, <2s post-mutation with socket `broadcast*Mutation`).
- Bust both caller scope + `global` on global-visible writes (contests/hacks/internships global rows visible to every college). Staging-only mutations bust counts only (published list unaffected).
- TTL is correctness backstop: missed bust → stale ≤5m (documented trade-off; deadline-passage `computedStatus` may lag ≤5m — no write to bust it).

## 5. Key hygiene (tenant isolation)

- Scope: `listScopeForUser(user, overrideCollegeId)` — `SUPER_ADMIN` → `global` (or `college:{override}` when `?collegeId=` scoped), else `college:{collegeId ?? 'none'}`. Mirrors the route `where` clause.
- `userId` always in published-list keys (TEACHER `creatorId OR` + STUDENT `?mine=true` + eligibility make where per-user; sharing across users would leak).
- `search` never raw in keys — `md5(lower(search)).slice(0,12)` (`none` when empty). No tokens/PII raw; lock keys truncated to 200 chars.
- `page/limit` bounded (`page≤1000`, `limit≤50`), `platform/status/mine` upper-cased + truncated.

## 6. Acceptance (P0-B)

- List DB reads −70–80% (30s→5m = 10× fewer misses; socket bust keeps post-mutation <2s).
- Concurrent burst (same key, same 50ms) = 1 loader call (singleflight unit test).
- Jittered SET TTL ∈ `[ttl, 1.1×ttl]` (capturing-backend test).
- Fail-open: throwing backend → loader value (existing `redis-crash-guard` still green).
- `X-Cache: HIT/MISS` on all three lists; `Cache-Control: private,max-age=60,SWR=30` (never `public/s-maxage` on authed JSON — F11).
- 0 new 429s; p95 list latency −30–50% under 2× load; stale never >5m + immediate bust verified.

## 7. P1 structural keys (incremental sync + conditional fetch + AI cache + singleflight + SSE)
| Key / layer | TTL | Store | Invalidation | Notes |
|-------------|-----|-------|--------------|-------|
| sync:wm:{userId} profile watermark | 7d | shared cache | Overwritten per cron success; miss/corrupt = full sync | Cron path only (useWatermark:true); manual syncs always full. Skip needs handles-match + valid + <6h. |
| sync:contest-list:wm contest list watermark | 6h | shared cache | Per clean full loop; never on skip/failure | Skips only the upsert loop; status sweep still runs (batched updateMany x3 + per-row fallback). |
| stats:memo:v{gen}:{platform}:{handle} | 5m valid / evicted invalid | shared cache + L1 Map | Time + gen bump in __clearStatsCacheForTests | P1-4 cross-replica singleflight; invalid stats evict (no stuck verify-handle loop). |
| sf:result:{key} singleflight burst result | 30s | shared cache | Natural expiry | Concurrent-only coalescing; lock:sf:{key} 30s claim. |
| opp:fetch:{PLATFORM} platform hash | 14d | shared cache | Per clean save; every-4th run forces full | Layer B: unchanged hash skips DB save + enrich (folds into Skipped). |
| opp:page:{urlHash} page validators | 7d | shared cache | Per fetch (ETag/Last-Modified + content hash) | Layer A: conditional GET; 304 warm = 0 bytes, 304 cold = unconditional refetch. |
| enrich:content:{stagingId} enrich input hash | 7d | shared cache | After successful enrich | Layer C: identical prompt input skips Groq (reject-refetch = 0 tokens). |
| enrich:response:{model}:{promptSha} AI response | 24h | shared cache (+ singleflight) | Prompt-version bump | Same prompt+model = same JSON; empty Groq text never cached. |
| Frozen prefix ENRICH_SYSTEM_PREFIX_V1 | stable bytes | code (stagesPrompt.ts) | Version bump only | Static instruction block first, varying query last (Groq prefix-cache hits). |
| Extraction model routing | n/a | code (aiCache.modelForFeature) | n/a | enrich/ats-score to 20b on synthetic fallback only; managed AI-Manager models never overridden. |
| AI_KILL_SWITCH | env | n/a | n/a | ON gives quota 503 + enrich deterministic fallback; breaker/quotas preserved when OFF. |
| SSE streams /api/stream/:topic | 15s poll / 25s heartbeat | per-connection | req close | Change-only pushes (dirty-flag/baseline); socket alive = 0 SSE traffic. |

Rules carried over from 4.1: every shared key has a tenant segment or is global-public by design; every SET has TTL; fail-open everywhere (miss = old behavior).
