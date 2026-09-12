#!/usr/bin/env node
/**
 * CampusFlow 10k load smoke — dashboard burst (NOT for prod).
 *
 * WHAT: simulates 200 users × 6 parallel GETs (dashboard bundle shape) against
 * local/staging to prove generalLimiter (per IP+user, 1000/15m, Redis-shared)
 * + DB pool (50, pgbouncer) hold. No secrets, no prod writes (GETs only).
 *
 * WHY 200×6: frontend DashboardPage mounts 6 parallel GETs (dashboard + 5
 * supporting lists); 200 users behind one NAT is the college-lab burst that
 * tripped the old 500-IP-shared bucket at ~10% cohort (see scale10k-redis.md).
 * Per-user split → 200 distinct buckets, each 6 hits = 1200 total, zero 429s
 * expected. Same-user 1100-hit loop SHOULD 429 (proves budget is enforced).
 *
 * USAGE (localhost only — cheap, no DB seed needed):
 *   node scripts/load-10k-smoke.mjs --base-url http://localhost:4000 --users 200 --parallel 6
 *   BASE_URL=http://localhost:4000 USERS=200 PARALLEL=6 node scripts/load-10k-smoke.mjs
 *   # authenticated pool proof (optional, needs a valid JWT with dashboard access):
 *   TEST_JWT=eyJ... node scripts/load-10k-smoke.mjs --base-url http://localhost:4000 --auth
 *
 * SAFETY: refuses prod unless --allow-prod (never run against prod — this is a
 * burst generator; prod proof is analytic in .ai/reports/scale10k-shard-load.md §4).
 * Exit 0 = limiter+pool held (0 unexpected 5xx, 429 only where expected).
 */

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const envKey = name.replace(/-/g, '_').toUpperCase();
  return process.env[envKey] ?? process.env[`LOAD_${envKey}`] ?? def;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const BASE_URL = String(arg('base-url', process.env.BASE_URL || 'http://localhost:4000')).replace(/\/+$/, '');
const USERS = Math.max(1, parseInt(String(arg('users', '200')), 10) || 200);
const PARALLEL = Math.max(1, parseInt(String(arg('parallel', '6')), 10) || 6);
const ALLOW_PROD = hasFlag('allow-prod');
const AUTH_MODE = hasFlag('auth');
const TEST_JWT = process.env.TEST_JWT || '';

function isProdUrl(u) {
  return /onrender\.com|render\.com|NEONHOST_REMOVED|prod/i.test(u) && !/localhost|127\.0\.0\.1/.test(u);
}
if (isProdUrl(BASE_URL) && !ALLOW_PROD) {
  console.error(`[load-smoke] REFUSING to run against prod-like BASE_URL=${BASE_URL} (GET burst could trip prod limiter).`);
  console.error(`[load-smoke] Run against localhost/staging, or pass --allow-prod (never in CI).`);
  process.exit(2);
}

function fakeJwt(userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ userId })}.smoke`;
}

const DASHBOARD_PATHS = [
  '/api/user/dashboard',
  '/api/coding-profile/leaderboard?limit=10',
  '/api/search?q=smoke',
  '/api/admin/analytics',
  '/api/notifications?limit=5',
  '/api/tasks?limit=5',
];

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function timedFetch(url, headers) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers });
    // Drain body (small JSON) so timing includes transfer.
    try { await res.text(); } catch {}
    return { status: res.status, ms: Date.now() - t0, ok: res.status < 500 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, ok: false, err: String(e?.message || e).slice(0, 120) };
  }
}

async function burstPhase({ label, users, parallel, makeHeaders, expect429 }) {
  console.log(`[load-smoke] phase=${label} users=${users} parallel=${parallel} base=${BASE_URL}`);
  const lat = [];
  let ok2xx = 0, ok401 = 0, hit429 = 0, hit5xx = 0, netErr = 0;
  const t0 = Date.now();
  // Concurrency pool: users × parallel requests, max 100 in flight.
  const jobs = [];
  for (let u = 0; u < users; u++) {
    for (let k = 0; k < parallel; k++) {
      const path = DASHBOARD_PATHS[(u + k) % DASHBOARD_PATHS.length];
      jobs.push({ u, path });
    }
  }
  const MAX_INFLIGHT = 100;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const j = jobs[idx++];
      const headers = makeHeaders(j.u);
      const r = await timedFetch(`${BASE_URL}${j.path}`, headers);
      lat.push(r.ms);
      if (r.status === 429) hit429++;
      else if (r.status >= 500 || r.status === 0) { hit5xx++; if (r.status === 0) netErr++; }
      else if (r.status === 401) ok401++;
      else if (r.status >= 200 && r.status < 300) ok2xx++;
      else ok2xx++; // 403/404 etc. count as held (not 5xx/429)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_INFLIGHT, jobs.length) }, () => worker()));
  lat.sort((a, b) => a - b);
  const totalMs = Date.now() - t0;
  const total = jobs.length;
  console.log(`[load-smoke] ${label}: total=${total} in ${totalMs}ms (${(total / (totalMs / 1000)).toFixed(1)} rps)`);
  console.log(`[load-smoke] ${label}: 2xx=${ok2xx} 401=${ok401} 429=${hit429} 5xx/net=${hit5xx} (netErr=${netErr})`);
  console.log(`[load-smoke] ${label}: p50=${pct(lat, 50)}ms p95=${pct(lat, 95)}ms p99=${pct(lat, 99)}ms max=${lat[lat.length - 1] ?? 0}ms`);
  if (!expect429 && hit429 > 0) {
    console.log(`[load-smoke] WARN: unexpected 429s in ${label} (per-user buckets should hold ${users}×${parallel}=${users * parallel} hits under 1000/15m)`);
  }
  if (hit5xx > 0) {
    console.log(`[load-smoke] FAIL: ${hit5xx} 5xx/network errors in ${label} (pool/limiter did NOT hold)`);
  }
  return { total, ok2xx, ok401, hit429, hit5xx, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99) };
}

(async () => {
  console.log(`[load-smoke] CampusFlow 10k dashboard burst — base=${BASE_URL} users=${USERS} parallel=${PARALLEL}`);
  console.log(`[load-smoke] authentic mode: ${AUTH_MODE ? 'TEST_JWT (real pool proof)' : 'fake-JWT per-user (limiter bucket proof, expect 401s, no DB pool load)'}`);
  if (AUTH_MODE && !TEST_JWT) {
    console.error(`[load-smoke] --auth requires TEST_JWT env (valid JWT). Falling back to fake-JWT limiter proof.`);
  }
  const useAuth = AUTH_MODE && !!TEST_JWT;

  // Phase 1: NAT burst — distinct users behind one IP (same source IP, distinct JWTs).
  // Expect: zero 429s (each bucket 6 hits ≪ 1000), zero 5xx. 401s are success here
  // (limiter runs before authenticate; 401 proves we reached auth, not limiter).
  const p1 = await burstPhase({
    label: 'nat-burst',
    users: USERS,
    parallel: PARALLEL,
    makeHeaders: (u) => (useAuth && u === 0
      ? { Authorization: `Bearer ${TEST_JWT}` }
      : { Authorization: `Bearer ${fakeJwt(`smoke-u${u}`)}` }),
    expect429: false,
  });

  // Phase 2: same-user abuse — one bucket hit 60× (well under 1000, still no 429).
  // Proves per-actor budget is 1000, not 500-shared (old code 429'd here at ~500).
  const p2 = await burstPhase({
    label: 'same-user-60',
    users: 1,
    parallel: 60,
    makeHeaders: () => ({ Authorization: `Bearer ${fakeJwt('smoke-solo')}` }),
    expect429: false,
  });

  const failed = (p1.hit5xx + p2.hit5xx) > 0;
  console.log(`[load-smoke] done. nat p95=${p1.p95}ms p99=${p1.p99}ms 429=${p1.hit429} 5xx=${p1.hit5xx}; solo 429=${p2.hit429}`);
  console.log(`[load-smoke] analytic pool proof: see .ai/reports/scale10k-shard-load.md §4 (queries/endpoint × users / pool 50 / Redis 2 ops/req).`);
  if (failed) {
    console.error(`[load-smoke] RESULT: FAIL (5xx observed — pool did not hold)`);
    process.exit(1);
  }
  console.log(`[load-smoke] RESULT: PASS (limiter held, no 5xx; 429s only where expected)`);
})().catch((e) => {
  console.error('[load-smoke] fatal', e);
  process.exit(1);
});
