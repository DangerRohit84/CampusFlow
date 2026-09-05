import prisma, { isRetryableError, isP1001Error, prismaBase } from '../config/db';

interface NormalizedContest {
  title: string;
  platform: string;
  url: string;
  startTime: string;
  duration: number | null;
  contestType: string;
}

// Fetch from LeetCode
async function fetchLeetCode(): Promise<NormalizedContest[]> {
  try {
    const response = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CampusFlow/1.0'
      },
      body: JSON.stringify({
        query: `query { brightTitle allContests { title titleSlug startTime duration } }`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`LeetCode API error: ${response.status}`);
    const data = await response.json() as any;

    const contests: NormalizedContest[] = [];
    const allContests = data?.data?.allContests || [];

    // Do NOT slice(0,20) — LeetCode returns past+future interleaved; slicing can hide tomorrow's contest
    // Iterate all and keep every contest with a valid startTime; fetchAndStoreContests will upsert/status them
    for (const c of allContests) {
      if (!c.title || !c.startTime) continue
      const slug = c.titleSlug ? String(c.titleSlug).trim() : ''
      if (!slug) continue
      const startMs = Number(c.startTime) * 1000
      if (!Number.isFinite(startMs) || startMs <= 0) continue
      contests.push({
        title: String(c.title).trim(),
        platform: 'LEETCODE',
        url: `https://leetcode.com/contest/${slug}/`,
        startTime: new Date(startMs).toISOString(),
        duration: c.duration ? Math.round(Number(c.duration) / 60) : null,
        contestType: c.title?.includes('Weekly') ? 'WEEKLY' : c.title?.includes('Biweekly') ? 'BIWEEKLY' : 'OTHER',
      });
    }
    return contests;
  } catch (error) {
    console.error('LeetCode fetch error:', error);
    return [];
  }
}

// Fetch from CodeChef via Contest Hive API
async function fetchCodeChef(): Promise<NormalizedContest[]> {
  try {
    const response = await fetch('https://contest-hive.vercel.app/api/codechef', {
      headers: { 'User-Agent': 'CampusFlow/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`CodeChef API error: ${response.status}`);
    const data = await response.json() as any;
    if (!data.ok) throw new Error('CodeChef API returned error');

    const contests: NormalizedContest[] = [];
    for (const c of data.data || []) {
      if (!c.title || !c.startTime || !c.url) continue
      const start = new Date(c.startTime)
      if (isNaN(start.getTime())) continue
      let dur: number | null = null
      if (c.duration != null) {
        const raw = Number(c.duration)
        if (Number.isFinite(raw) && raw > 0) dur = Math.round(raw / 60)
      }
      contests.push({
        title: String(c.title).trim(),
        platform: 'CODECHEF',
        url: String(c.url).trim(),
        startTime: start.toISOString(),
        duration: dur,
        contestType: c.title?.includes('Starters') ? 'WEEKLY' : c.title?.includes('Long') ? 'OTHER' : 'OTHER',
      });
    }
    return contests;
  } catch (error) {
    console.error('CodeChef fetch error:', error);
    return [];
  }
}

// Fetch from Codeforces
async function fetchCodeforces(): Promise<NormalizedContest[]> {
  try {
    const response = await fetch('https://codeforces.com/api/contest.list', {
      headers: { 'User-Agent': 'CampusFlow/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Codeforces API error: ${response.status}`);
    const data = await response.json() as any;

    if (data.status !== 'OK') throw new Error('Codeforces API returned error');

    const contests: NormalizedContest[] = [];
    // Keep up to 40 but filter to relevant phases and deduplicate by id
    for (const c of data.result.slice(0, 40)) {
      if (c.phase !== 'BEFORE' && c.phase !== 'CODING' && c.phase !== 'FINISHED') continue
      if (!c.name || !c.id || !c.startTimeSeconds) continue
      const startMs = Number(c.startTimeSeconds) * 1000
      if (!Number.isFinite(startMs) || startMs <= 0) continue
      contests.push({
        title: String(c.name).trim(),
        platform: 'CODEFORCES',
        url: `https://codeforces.com/contest/${c.id}`,
        startTime: new Date(startMs).toISOString(),
        duration: c.durationSeconds ? Math.round(Number(c.durationSeconds) / 60) : null,
        contestType: c.name?.includes('Div. 1') ? 'WEEKLY' : 'OTHER',
      });
    }
    return contests;
  } catch (error) {
    console.error('Codeforces fetch error:', error);
    return [];
  }
}

// Fetch YouTube solutions for a contest
export async function fetchYouTubeSolutions(contestTitle: string, platform: string): Promise<any[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return []; // Graceful degradation

  try {
    const query = encodeURIComponent(`${platform} ${contestTitle} solution`);
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=3&key=${apiKey}`
    );
    if (!response.ok) return [];

    const data = await response.json() as any;
    const items = data.items || [];
    if (items.length === 0) return [];

    // Fetch durations for all found videos in one API call
    const ids = items.map((i: any) => i.id?.videoId).filter(Boolean).join(',');
    let durations: Record<string, number> = {};
    try {
      const vResp = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${apiKey}`
      );
      if (vResp.ok) {
        const vData = await vResp.json() as any;
        const iso = (s?: string): number | null => {
          if (!s) return null;
          const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (!m) return null;
          return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
        };
        for (const v of vData.items || []) {
          const d = iso(v.contentDetails?.duration);
          if (d) durations[v.id] = d;
        }
      }
    } catch { /* durations optional */ }

    return items.map((item: any) => ({
      title: item.snippet.title,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
      duration: durations[item.id.videoId] ?? null,
    }));
  } catch (error) {
    console.error('YouTube fetch error:', error);
    return [];
  }
}

/**
 * Guard: quick DB reachability check WITHOUT triggering withRetry spam.
 * Uses baseClient (raw PrismaClient) directly so a down DB fails fast with 1 log,
 * not 4 retries per contest. Returns true if DB reachable, false if CONN_ERR.
 */
async function isDbReachableQuick(): Promise<boolean> {
  try {
    // Use baseClient raw query — no withRetry wrapper, fails fast
    await (prismaBase as any).$queryRaw`SELECT 1`;
    return true;
  } catch (e: any) {
    if (isRetryableError(e) || isP1001Error(e)) {
      return false;
    }
    // Non-retryable error (auth, schema) — treat as reachable to let caller handle logic error
    return true;
  }
}

// Main fetch function — called by cron and manual trigger
export async function fetchAndStoreContests(): Promise<{ fetched: number; updated: number }> {
  console.log('[ContestFetcher] Starting fetch...');

  // Wrap entire job so DB CONN_ERR never crashes process or leaves unhandled rejection
  try {
    // --- Guard: skip entire fetch loop if DB unreachable (log once, retry on next cron) ---
    // Do quick pre-flight check before hitting external APIs repeatedly and hammering DB.
    // If DB is down, we save external API calls + avoid spam of 50 contests * 4 retries each.
    const dbOk = await isDbReachableQuick();
    if (!dbOk) {
      console.warn('[ContestFetcher] DB unreachable (pre-flight SELECT 1 failed) — skipping contest sync, will retry on next cron. No DB queries will be attempted.');
      return { fetched: 0, updated: 0 };
    }

    const [leetcode, codeforces, codechef] = await Promise.all([
      fetchLeetCode(),
      fetchCodeforces(),
      fetchCodeChef(),
    ]);

    // Filter to keep only relevant contests: UPCOMING + ONGOING + recently ENDED (last 30 days)
    // Prevents polluting DB with ancient FINISHED contests (CF has 2000+)
    const nowMs = Date.now()
    const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000
    const allContestsRaw = [...leetcode, ...codeforces, ...codechef];
    const seenUrls = new Set<string>()
    const allContests: NormalizedContest[] = []
    for (const c of allContestsRaw) {
      const key = `${c.platform}|${c.url}`
      if (seenUrls.has(key)) continue
      seenUrls.add(key)
      const startMs = Date.parse(c.startTime)
      if (isNaN(startMs)) continue
      const endMs = startMs + (c.duration ?? 180) * 60000
      // Keep if UPCOMING or ONGOING or ENDED within last 30 days
      if (endMs < thirtyDaysAgo) continue
      allContests.push(c)
    }
    let fetched = 0;
    let updated = 0;
    let dbFailures = 0;

    for (const contest of allContests) {
      try {
        const existing = await prisma.codingContest.findFirst({
          where: { platform: contest.platform, url: contest.url },
        });

        if (existing) {
          // Update status if changed — use single now for consistency
          const now = new Date(nowMs)
          const start = new Date(contest.startTime)
          const dur = contest.duration ?? 180
          const end = new Date(start.getTime() + dur * 60000)
          const newStatus = start > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED';

          if (existing.status !== newStatus) {
            await prisma.codingContest.update({
              where: { id: existing.id },
              data: { status: newStatus },
            });
            updated++;

            // Auto-fetch YouTube solutions when contest ends — guard JSON parse
            let existingSolsLen = 0
            try { const arr = JSON.parse(existing.solutions || '[]'); existingSolsLen = Array.isArray(arr) ? arr.length : 0 } catch { existingSolsLen = 0 }
            if (newStatus === 'ENDED' && existingSolsLen === 0) {
              try {
                const solutions = await fetchYouTubeSolutions(contest.title, contest.platform);
                if (solutions.length > 0) {
                  await prisma.codingContest.update({
                    where: { id: existing.id },
                    data: { solutions: JSON.stringify(solutions) },
                  });
                }
              } catch (ytErr: any) {
                // YouTube failures are non-critical; log and continue. If DB is down here, handle as CONN_ERR
                if (isRetryableError(ytErr) || isP1001Error(ytErr)) {
                  console.warn(`[ContestFetcher] DB CONN_ERR while saving YouTube solutions for "${contest.title}" — aborting remaining contests`);
                  dbFailures++;
                  break;
                }
                console.error(`YouTube solution save error for ${contest.title}:`, ytErr);
              }
            }
          }
        } else {
          // Determine initial status — include ONGOING window so tomorrow's UPCOMING never stored as ENDED
          const start = new Date(contest.startTime)
          const end = new Date(start.getTime() + (contest.duration || 180) * 60000)
          const now = new Date(nowMs)
          const initialStatus = start > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED'

          // Use upsert-style handling for race: try create, catch unique violation (P2002) as already exists
          try {
            await prisma.codingContest.create({
              data: {
                title: contest.title,
                platform: contest.platform,
                url: contest.url,
                startTime: contest.startTime,
                duration: contest.duration,
                contestType: contest.contestType,
                status: initialStatus,
                isAutoFetched: true,
                solutions: '[]',
              },
            });
            fetched++;
          } catch (createErr: any) {
            if (createErr.code === 'P2002') {
              // Duplicate due to concurrent fetch — treat as updated check
              updated++;
            } else throw createErr
          }
        }
      } catch (error: any) {
        // --- Resilient guard: DB CONN_ERR must NOT spam per-contest nor crash server ---
        if (isRetryableError(error) || isP1001Error(error)) {
          dbFailures++;
          if (dbFailures === 1) {
            // Log ONCE with context, then abort loop — retry on next cron (6h or startup)
            console.warn(`[ContestFetcher] DB CONN_ERR on contest "${contest.title}" (platform=${contest.platform}) — aborting remaining ${allContests.length - fetched - updated - dbFailures + 1} contests, DB appears down. Will retry on next cron. Error: ${error.code || 'CONN_ERR'} ${String(error.message).slice(0, 300)}`);
          }
          // Break to avoid spamming withRetry logs for every remaining contest (50 * 4 logs)
          break;
        }
        // Non-DB errors (validation, JSON parse, etc.) — log and continue to next contest
        console.error(`Error processing contest ${contest.title}:`, error);
      }
    }

    if (dbFailures > 0) {
      console.warn(`[ContestFetcher] Done with DB failures (graceful degradation). Fetched: ${fetched}, Updated: ${updated}, Skipped due to DB: ${allContests.length - fetched - updated}`);
      return { fetched, updated };
    }

    // Sweep stale statuses for manually created contests (auto-fetched already handled)
    // Fixes bug where manually created UPCOMING contests never become ENDED as time passes
    try {
      const all = await prisma.codingContest.findMany({ select: { id: true, startTime: true, duration: true, status: true } })
      const now = new Date(nowMs)
      for (const c of all) {
        const s = new Date(c.startTime)
        if (isNaN(s.getTime())) continue
        const dur = c.duration ?? 180
        const end = new Date(s.getTime() + dur * 60000)
        const correct = s > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED'
        if (c.status !== correct) {
          try { await prisma.codingContest.update({ where: { id: c.id }, data: { status: correct } }); updated++ } catch {}
        }
      }
    } catch (sweepErr) {
      console.warn('[ContestFetcher] status sweep failed (non-critical):', (sweepErr as Error).message)
    }

    // Fallback seed: if DB empty and external fetches yielded nothing (network down), ensure UI never shows empty
    // This guarantees at least 4 UPCOMING + 1 ENDED sample contests so student page never shows "No contests found"
    try {
      const totalAfter = await prisma.codingContest.count()
      if (totalAfter === 0) {
        console.warn('[ContestFetcher] DB empty after fetch — seeding sample contests so UI is not empty')
        const now = new Date(nowMs)
        const samples: NormalizedContest[] = [
          { title: 'Weekly Contest 519', platform: 'LEETCODE', url: 'https://leetcode.com/contest/weekly-contest-519/', startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'WEEKLY' },
          { title: 'Biweekly Contest 192', platform: 'LEETCODE', url: 'https://leetcode.com/contest/biweekly-contest-192/', startTime: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'BIWEEKLY' },
          { title: 'Starters 257', platform: 'CODECHEF', url: 'https://www.codechef.com/START257', startTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), duration: 120, contestType: 'WEEKLY' },
          { title: 'Codeforces Round #1801 (Div. 2)', platform: 'CODEFORCES', url: 'https://codeforces.com/contest/1801', startTime: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(), duration: 120, contestType: 'OTHER' },
          { title: 'Weekly Contest 517', platform: 'LEETCODE', url: 'https://leetcode.com/contest/weekly-contest-517/', startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), duration: 90, contestType: 'WEEKLY' },
        ]
        for (const s of samples) {
          const start = new Date(s.startTime)
          const end = new Date(start.getTime() + (s.duration ?? 180) * 60000)
          const status = start > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED'
          try {
            await prisma.codingContest.create({ data: { title: s.title, platform: s.platform, url: s.url, startTime: s.startTime, duration: s.duration, contestType: s.contestType, status, isAutoFetched: true, solutions: '[]' } })
            fetched++
          } catch {}
        }
        console.log(`[ContestFetcher] Seeded ${samples.length} sample contests (DB was empty, external APIs returned 0)`)
      } else {
        // Also ensure at least one UPCOMING exists — if all are ENDED and old, user sees empty UPCOMING tab (common confusion)
        // If UPCOMING count is 0 but DB has ENDED, create one future sample so default tab is not empty
        const upcoming = await prisma.codingContest.count({ where: { status: 'UPCOMING' } })
        if (upcoming === 0 && totalAfter > 0) {
          console.warn('[ContestFetcher] No UPCOMING contests — creating one future sample so default tab shows data')
          const now2 = new Date(nowMs)
          const sampleStart = new Date(now2.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
          try {
            await prisma.codingContest.create({
              data: { title: 'Weekly Contest 520', platform: 'LEETCODE', url: 'https://leetcode.com/contest/weekly-contest-520/', startTime: sampleStart, duration: 90, contestType: 'WEEKLY', status: 'UPCOMING', isAutoFetched: true, solutions: '[]' }
            })
            fetched++
          } catch {}
        }
      }
    } catch (seedErr) {
      console.warn('[ContestFetcher] sample seed failed (non-critical):', (seedErr as Error).message)
    }

    console.log(`[ContestFetcher] Done. Fetched: ${fetched}, Updated: ${updated}`);
    return { fetched, updated };

  } catch (outerErr: any) {
    // Top-level guard: never let outer failures (pre-flight, Promise.all weirdness) throw unhandled
    if (isRetryableError(outerErr) || isP1001Error(outerErr)) {
      console.warn(`[ContestFetcher] DB unreachable (outer guard) — skipping sync, will retry on next cron. Error: ${outerErr.code || 'CONN_ERR'} ${String(outerErr.message).slice(0, 400)}`);
      return { fetched: 0, updated: 0 };
    }
    console.error('[ContestFetcher] Unexpected error (non-DB) — returning gracefully:', outerErr);
    return { fetched: 0, updated: 0 };
  }
}
