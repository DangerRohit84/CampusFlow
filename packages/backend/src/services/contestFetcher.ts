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
    const response = await fetch('https://leetcode.com/api/contests/', {
      headers: { 'User-Agent': 'CampusFlow/1.0' },
    });
    if (!response.ok) throw new Error(`LeetCode API error: ${response.status}`);
    const data = await response.json();

    const contests: NormalizedContest[] = [];
    const allContests = [...(data.upcoming || []), ...(data.recent || [])];

    for (const c of allContests.slice(0, 20)) {
      contests.push({
        title: c.title,
        platform: 'LEETCODE',
        url: `https://leetcode.com/contest/${c.title_slug}/`,
        startTime: new Date(c.start_time * 1000).toISOString(),
        duration: c.duration ? c.duration / 60 : null, // seconds to minutes
        contestType: c.title?.includes('Weekly') ? 'WEEKLY' : c.title?.includes('Biweekly') ? 'BIWEEKLY' : 'OTHER',
      });
    }
    return contests;
  } catch (error) {
    console.error('LeetCode fetch error:', error);
    return [];
  }
}

// Fetch from CodeChef
async function fetchCodeChef(): Promise<NormalizedContest[]> {
  try {
    const response = await fetch('https://www.codechef.com/api/contests', {
      headers: { 'User-Agent': 'CampusFlow/1.0' },
    });
    if (!response.ok) throw new Error(`CodeChef API error: ${response.status}`);
    const data = await response.json();

    const contests: NormalizedContest[] = [];
    const allContests = [...(data.present || []), ...(data.future || [])];

    for (const c of allContests.slice(0, 20)) {
      contests.push({
        title: c.name,
        platform: 'CODECHEF',
        url: `https://www.codechef.com/contests/${c.code}`,
        startTime: new Date(c.start_time).toISOString(),
        duration: c.duration ? parseInt(c.duration) : null,
        contestType: c.name?.includes('Long Challenge') ? 'WEEKLY' : 'OTHER',
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
    const data = await response.json();

    if (data.status !== 'OK') throw new Error('Codeforces API returned error');

    const contests: NormalizedContest[] = [];
    for (const c of data.result.slice(0, 20)) {
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

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      title: item.snippet.title,
      url: `https://youtube.com/watch?v=${item.id.videoId}`,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
    }));
  } catch (error) {
    console.error('YouTube fetch error:', error);
    return [];
  }
}

// Main fetch function — called by cron and manual trigger
export async function fetchAndStoreContests(): Promise<{ fetched: number; updated: number }> {
  console.log('[ContestFetcher] Starting fetch...');

  const [leetcode, codechef, codeforces] = await Promise.all([
    fetchLeetCode(),
    fetchCodeChef(),
    fetchCodeforces(),
  ]);

  const allContests = [...leetcode, ...codechef, ...codeforces];
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
        // Determine initial status
        const initialStatus = new Date(contest.startTime) > new Date() ? 'UPCOMING' : 'ENDED';

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
