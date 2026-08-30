import prisma from '../config/db';

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
    });
    if (!response.ok) throw new Error(`LeetCode API error: ${response.status}`);
    const data = await response.json() as any;

    const contests: NormalizedContest[] = [];
    const allContests = data?.data?.allContests || [];

    // Do NOT slice(0,20) — LeetCode returns past+future interleaved; slicing can hide tomorrow's contest
    // Iterate all and keep every contest with a valid startTime; fetchAndStoreContests will upsert/status them
    for (const c of allContests) {
      if (!c.title || !c.startTime) continue
      contests.push({
        title: c.title,
        platform: 'LEETCODE',
        url: `https://leetcode.com/contest/${c.titleSlug}/`,
        startTime: new Date(c.startTime * 1000).toISOString(),
        duration: c.duration ? c.duration / 60 : null,
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
    });
    if (!response.ok) throw new Error(`CodeChef API error: ${response.status}`);
    const data = await response.json() as any;
    if (!data.ok) throw new Error('CodeChef API returned error');

    const contests: NormalizedContest[] = [];
    for (const c of data.data || []) {
      contests.push({
        title: c.title,
        platform: 'CODECHEF',
        url: c.url,
        startTime: c.startTime,
        duration: c.duration ? c.duration / 60 : null,
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
    });
    if (!response.ok) throw new Error(`Codeforces API error: ${response.status}`);
    const data = await response.json() as any;

    if (data.status !== 'OK') throw new Error('Codeforces API returned error');

    const contests: NormalizedContest[] = [];
    // Keep up to 30 to avoid hiding an UPCOMING contest that is beyond the first 20 (rare) but still bounded
    for (const c of data.result.slice(0, 30)) {
      if (c.phase === 'BEFORE' || c.phase === 'CODING' || c.phase === 'FINISHED') {
        contests.push({
          title: c.name,
          platform: 'CODEFORCES',
          url: `https://codeforces.com/contest/${c.id}`,
          startTime: new Date(c.startTimeSeconds * 1000).toISOString(),
          duration: c.durationSeconds ? c.durationSeconds / 60 : null,
          contestType: c.name?.includes('Div. 1') ? 'WEEKLY' : 'OTHER',
        });
      }
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

// Main fetch function — called by cron and manual trigger
export async function fetchAndStoreContests(): Promise<{ fetched: number; updated: number }> {
  console.log('[ContestFetcher] Starting fetch...');

  const [leetcode, codeforces, codechef] = await Promise.all([
    fetchLeetCode(),
    fetchCodeforces(),
    fetchCodeChef(),
  ]);

  const allContests = [...leetcode, ...codeforces, ...codechef];
  let fetched = 0;
  let updated = 0;

  for (const contest of allContests) {
    try {
      const existing = await prisma.codingContest.findFirst({
        where: { platform: contest.platform, url: contest.url },
      });

      if (existing) {
        // Update status if changed
        const newStatus = new Date(contest.startTime) > new Date() ? 'UPCOMING' :
          new Date(new Date(contest.startTime).getTime() + (contest.duration || 180) * 60000) > new Date() ? 'ONGOING' : 'ENDED';

        if (existing.status !== newStatus) {
          await prisma.codingContest.update({
            where: { id: existing.id },
            data: { status: newStatus },
          });
          updated++;

          // Auto-fetch YouTube solutions when contest ends
          if (newStatus === 'ENDED' && JSON.parse(existing.solutions).length === 0) {
            const solutions = await fetchYouTubeSolutions(contest.title, contest.platform);
            if (solutions.length > 0) {
              await prisma.codingContest.update({
                where: { id: existing.id },
                data: { solutions: JSON.stringify(solutions) },
              });
            }
          }
        }
      } else {
        // Determine initial status — include ONGOING window so tomorrow's UPCOMING never stored as ENDED
        const start = new Date(contest.startTime)
        const end = new Date(start.getTime() + (contest.duration || 180) * 60000)
        const now = new Date()
        const initialStatus = start > now ? 'UPCOMING' : end > now ? 'ONGOING' : 'ENDED'

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
      }
    } catch (error) {
      console.error(`Error processing contest ${contest.title}:`, error);
    }
  }

  console.log(`[ContestFetcher] Done. Fetched: ${fetched}, Updated: ${updated}`);
  return { fetched, updated };
}
