/**
 * Regression tests for detail/tab fetching (fix-detail-tabs).
 * Hermetic pure-parser tests (no network) + mocked-HTML network tests (no DB, no live fetch).
 *
 * Evidence anchors (fetcher_test/, do NOT touch):
 * - Devfolio B.raw.md:42 tabs ("Overview Prizes Schedule" x4, WebCraft24 detail:
 *   Runs Sep 25-26 2026, Greater Noida, Team Size 2-4, $500+ Prize Pool,
 *   Registration Deadline Sep 1 2026, Rules Follow Code of Conduct)
 * - Devpost B.raw.md:54 (nav Overview/Resources/Rules/...) + B.webfetch-detail.md:17,32-37
 *   (RevenueCat Shipaton 2026, $740,000 in cash, 24744 participants,
 *   Who can participate: Ages 13-99, View full rules /rules)
 * - MLH B.webfetch-detail.md:3,10-18 prizes (jon-test-event/prizes:
 *   Best Use of Gemini API / Google Swag Kits, Best Use of MongoDB Atlas / M5Stack IoT Kit)
 * - HackerEarth B.raw.md:24 tab bar (Overview Themes Prizes Evaluation Criteria Rules
 *   Judges Teams Submissions Sponsors ... + Team size 1-4, Online · Team 1–4)
 *
 * Rules under test:
 * - bounded detail fetch per item, cached (fetchPage6k scrapeCache), small timeouts
 * - failures never break list items (try/catch -> keep list data)
 * - no fake defaults (never ₹0/$0, never generic description, omit absent)
 * - schema-compatible optional fields (prizeTiers/perks/teamSize/eligibility/judging/schedule/stages)
 * - registry: MLH enrichPages includes '/prizes'; HACKEREARTH '/details' replaced by real tabs
 * - HackerEarth list-level max/min_team_size mapping (1/1 -> 1)
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  parseDevfolioDetail,
  extractDevfolioRules,
  fetchDevfolioDetail,
  enrichDevfolioItems,
} from '../src/services/opportunities/sources/devfolio';
import {
  parseDevpostDetail,
  fetchDevpostDetail,
  enrichDevpostItems,
} from '../src/services/opportunities/sources/devpost';
import {
  parseMLHPrizes,
  fetchMLHDetail,
  enrichMLHItems,
} from '../src/services/opportunities/sources/mlh';
import {
  parseHackerEarthDetail,
  fetchHackerEarthDetail,
  enrichHackerEarthItems,
  HACKEREARTH_DETAIL_TABS,
  fetchHackerEarthPage,
} from '../src/services/opportunities/sources/hackerearth';
import {
  extractUSDPrizeTiers,
  extractSponsorChallengeTiers,
  extractWhoCanParticipate,
  extractJudgesList,
  resolveHackerEarthTeamSize,
  hasFakeUSDPrizeDefault,
  hasFakePrizeDefault,
  isGenericFallbackDescription,
} from '../src/services/opportunities/sources/details';
import { getPlatformMeta } from '../src/services/opportunities/registry';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';
import type { NormalizedOpportunity } from '../src/services/opportunities/types';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function opp(over: Partial<NormalizedOpportunity> = {}): NormalizedOpportunity {
  return {
    type: 'HACKATHON',
    title: 'Test Hack',
    description: '',
    url: 'https://example.com/x',
    source: 'DEVFOLIO',
    organizer: '',
    deadline: '',
    startDate: '',
    duration: '',
    location: '',
    mode: '',
    prizePool: '',
    stipend: '',
    company: '',
    role: '',
    themes: [],
    website: '',
    discord: '',
    participantsCount: 0,
    inviteOnly: false,
    ...over,
  };
}

// ─── Fixtures (verbatim evidence shapes, trimmed) ───

const DEVFOLIO_DETAIL_HTML = `
<html><head><title>WebCraft24 | Devfolio</title></head><body>
<nav>WebCraft24 Overview Prizes Schedule Overview Prizes Schedule Overview Prizes Schedule Overview Prizes Schedule</nav>
<h1>WebCraft24</h1>
<p>Runs from Sep 25 - 26, 2026</p>
<p>Happening Greater Noida, India</p>
<p>Fueled by Chaos. Powered by Code. Ready to Code, Create, and Conquer? Step into the ultimate test of human logic at GLB HACKATHON 5.0 - Webcraft 24! Organized by the Department of Bachelor of Computer Applications and the Tech Visor Club at GL Bajaj Institute of Management, this is an epic 24-hour non-stop battlefield of pure creativity, collaboration, and code.</p>
<p>The Stakes: Compete for a massive $500+ Prize Pool loaded with cash prizes, exclusive domains, and cool swags.</p>
<p>Open to passionate student innovators from all colleges and streams — because true innovation knows no boundaries.</p>
<p>Date: Friday, September 25th, 2026 Venue: Knowledge Park III, Gate No-3, Greater Noida Team Size: 2 to 4 members Cost: Absolutely FREE Registration Deadline: September 1st, 2026</p>
<h2>Schedule</h2><p>Schedule: Day 1 opening + hacking, Day 2 judging + results.</p>
<h2>Prizes</h2><p>Prizes: Winner $500 in cash, Runner-Up $200 in cash. Perks: domains, swags, certificates.</p>
<h2>Rules</h2><p>Rules Follow the Code of Conduct .</p>
</body></html>
`.trim();

const DEVPOST_OVERVIEW_HTML = `
<html><head><title>RevenueCat Shipaton 2026: Ship apps and start making money. - Devpost</title></head><body>
<nav>Overview My projects Participants (24744) Resources Rules Project gallery Updates Discussions</nav>
<h1>RevenueCat Shipaton 2026</h1>
<h2>Ship apps and start making money.</h2>
<p>This August and September, we're inviting builders from all corners of the globe to ship new apps and compete for over $700,000 in cash prizes and truly unique rewards — over $1 million worth of prizes in total.</p>
<p>Online Public <a>$740,000 in cash</a> <span>24744 participants</span> <a>RevenueCat</a></p>
<h6>Who can participate</h6>
<ul><li>Ages 13 to 99 only</li><li>Specific countries/territories excluded</li></ul>
<a href="/rules">View full rules</a>
<h2>Prizes</h2><p>1st Prize: $300,000 2nd Prize: $200,000 3rd Prize: $100,000 Best Design: $50,000</p>
</body></html>
`.trim();

const DEVPOST_RULES_HTML = `
<html><head><title>Rules | RevenueCat Shipaton 2026 - Devpost</title></head><body>
<h1>Rules</h1>
<h2>Who can participate</h2><p>Ages 13 to 99 only. Specific countries/territories excluded. Employees of RevenueCat are eligible.</p>
<h2>Prizes</h2><p>Grand Prize: $300,000 Second Place: $200,000 Third Place: $100,000</p>
<h2>Schedule</h2><p>Submissions close Sep 30, 2026 @ 11:45pm PDT. Winners announced Oct 15, 2026.</p>
</body></html>
`.trim();

const MLH_PRIZES_HTML = `
<html><head><title>Prizes at Jon Test Event | Major League Hacking</title></head><body>
<h1>Prizes at Jon Test Event</h1>
<p>Win awesome prizes, hacker gear, &amp; swag by competing in one of these challenges and using new APIs.</p>
<h3>Best Use of Gemini API</h3><h4>Google Swag Kits</h4>
<p>It’s time to push the boundaries of what's possible with AI using Google Gemini. Check out the Gemini API to build AI-powered apps that make your friends say WHOA.</p>
<h3>Best Use of MongoDB Atlas</h3><h4>M5Stack IoT Kit</h4>
<p>MongoDB Atlas takes the leading modern database and makes it accessible in the cloud! Get started with a $50 credit for students. Build a hack using MongoDB Atlas for a chance to win a M5Stack IoT Kit for you and each member of your group.</p>
</body></html>
`.trim();

const HACKEREARTH_OVERVIEW_HTML = `
<html><head><title>hackCBS 4.0 - HackerEarth</title></head><body>
<nav>Overview Themes Prizes Evaluation Criteria Rules Judges Teams Submissions Sponsors Webinars Submission Guideline Resources Discussion</nav>
<h1>hackCBS 4.0</h1>
<p>Hosted By - hackCBS 4.0 Oct 29, 2021 – Oct 31, 2021 Online Team size: 1 - 4 2.5K registrations Online · Team: 1–4 · 2.5K registrations</p>
<p>Join India's largest student hackathon. Build innovative solutions with your team of up to 4 members.</p>
</body></html>
`.trim();

const HACKEREARTH_PRIZES_HTML = `
<html><body>
<h1>Prizes</h1>
<p>Your private GitHub repo might be worth up to ₹85,000. Find out in 2 minutes. Payment of up to ₹85,000 per repository is made within 30 days of a signed agreement. First Prize: ₹85,000 Runner-Up: ₹40,000</p>
<p>Perks: certificates, swag, internship interviews</p>
</body></html>
`.trim();

const HACKEREARTH_RULES_HTML = `
<html><body>
<h1>Rules</h1><p>Rules: Teams of 1-4 members. Code must be written during the hackathon. Open to college students across India.</p>
<h2>Evaluation Criteria</h2><p>Evaluation Criteria: Innovation 40 points, Implementation 40 points, Presentation 20 points. Total 100 points.</p>
</body></html>
`.trim();

const HACKEREARTH_JUDGES_HTML = `
<html><body>
<h1>Judges</h1><p>Judges: Ayush Chhabra, Priya Sharma, Rahul Verma — industry experts from top tech companies.</p>
<h2>Teams</h2><p>Teams: Team size 1 - 4 members per team. Individual participation allowed.</p>
</body></html>
`.trim();

// ─── Shared $ / sponsor / eligibility / judges helpers ───

describe('shared detail helpers (details.ts)', () => {
  it('extractUSDPrizeTiers mines $ tiers beyond headline, never $0', () => {
    const { prizePool, tiers } = extractUSDPrizeTiers('$740,000 in cash');
    expect(tiers.length).toBeGreaterThan(0);
    expect(prizePool).toContain('$740,000');
    expect(hasFakeUSDPrizeDefault(prizePool)).toBe(false);
    expect(hasFakePrizeDefault(prizePool)).toBe(false);
  });

  it('extractUSDPrizeTiers keeps ordinals + dedupes by amount', () => {
    const { tiers } = extractUSDPrizeTiers('1st Prize: $300,000 2nd Prize: $200,000 3rd Prize: $100,000 1st Prize: $300,000');
    expect(tiers.join(' | ')).toMatch(/1st Prize: \$300,000/);
    expect(tiers.join(' | ')).toMatch(/2nd Prize: \$200,000/);
    const amounts = tiers.map((t) => (t.match(/\$([\d,]+)/) || [])[1]);
    expect(new Set(amounts).size).toBe(amounts.length);
  });

  it('extractUSDPrizeTiers handles $500+ Prize Pool + never first-$-on-page', () => {
    const { tiers } = extractUSDPrizeTiers('Compete for a massive $500+ Prize Pool loaded with cash prizes');
    expect(tiers.join(' | ')).toMatch(/\$500/);
    expect(extractUSDPrizeTiers('no money here').tiers).toEqual([]);
    expect(extractUSDPrizeTiers('Winner: $0').prizePool).not.toContain('$0');
    expect(extractUSDPrizeTiers('').prizePool).toBe('');
  });

  it('extractSponsorChallengeTiers mines MLH Best-Use challenges (no cash amounts)', () => {
    const { prizePool, tiers } = extractSponsorChallengeTiers(
      'Prizes at Jon Test Event Win awesome prizes Best Use of Gemini API Google Swag Kits Best Use of MongoDB Atlas M5Stack IoT Kit',
    );
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(prizePool).toMatch(/Gemini/i);
    expect(prizePool).toMatch(/MongoDB/i);
    expect(tiers.join(' | ')).toMatch(/Best Use of Gemini API/);
    expect(tiers.join(' | ')).toMatch(/Best Use of MongoDB Atlas/);
    expect(extractSponsorChallengeTiers('no challenges here').tiers).toEqual([]);
    expect(extractSponsorChallengeTiers('').prizePool).toBe('');
  });

  it('extractWhoCanParticipate mines Devpost Ages 13-99 + rules link stripped', () => {
    const elig = extractWhoCanParticipate(
      'Who can participate - Ages 13 to 99 only - Specific countries/territories excluded [View full rules](/rules)',
    );
    expect(elig).toMatch(/Ages 13 to 99/);
    expect(elig).not.toMatch(/View full rules/);
    expect(extractWhoCanParticipate('no eligibility here at all xyz')).toBe('');
    expect(extractWhoCanParticipate('')).toBe('');
  });

  it('extractJudgesList mines HackerEarth judges, omits absent', () => {
    const judges = extractJudgesList('Judges: Ayush Chhabra, Priya Sharma, Rahul Verma — industry experts.');
    expect(judges).toMatch(/Ayush Chhabra/);
    expect(extractJudgesList('no judges here xyz')).toBe('');
    expect(extractJudgesList('')).toBe('');
  });

  it('resolveHackerEarthTeamSize maps API max/min, omits invalid', () => {
    expect(resolveHackerEarthTeamSize(1, 1, '')).toBe(1); // upcoming items 1/1 (B.webfetch-API-head.md)
    expect(resolveHackerEarthTeamSize(4, 1, '')).toBe(4); // range max wins
    expect(resolveHackerEarthTeamSize(3, 5, '')).toBeNull(); // min>max invalid → omit
    expect(resolveHackerEarthTeamSize(undefined, undefined, 'Team size: 1 - 4')).toBe(4); // text fallback
    expect(resolveHackerEarthTeamSize(undefined, undefined, '')).toBeNull();
  });
});

// ─── Devfolio detail/tabs ───

describe('Devfolio detail/tabs (B.raw.md:42)', () => {
  it('parseDevfolioDetail mines $500+ pool, Team 2-4, rules, eligibility, schedule', () => {
    const parsed = parseDevfolioDetail(DEVFOLIO_DETAIL_HTML, { title: 'WebCraft24' });
    expect(parsed.prizePool).toMatch(/\$500/);
    expect(parsed.prizeTiers.length).toBeGreaterThan(0);
    expect(hasFakeUSDPrizeDefault(parsed.prizePool)).toBe(false);
    expect(hasFakePrizeDefault(parsed.prizePool)).toBe(false);
    expect(parsed.teamSize).toBe(4); // "Team Size: 2 to 4 members" → max
    expect(parsed.eligibility).toMatch(/college|student/i);
    expect(parsed.judging).toMatch(/Code of Conduct/);
    expect(parsed.description).toMatch(/Fueled by Chaos/);
    expect(isGenericFallbackDescription(parsed.description)).toBe(false);
    expect(parsed.schedule.toLowerCase()).toMatch(/day 1/);
  });

  it('extractDevfolioRules mines Rules section, omits absent', () => {
    expect(extractDevfolioRules('Rules Follow the Code of Conduct . Schedule Day 1')).toMatch(/Code of Conduct/);
    expect(extractDevfolioRules('no rules here xyz')).toBe('');
    expect(extractDevfolioRules('')).toBe('');
  });

  it('parseDevfolioDetail omits absent (never fakes)', () => {
    const empty = parseDevfolioDetail('');
    expect(empty).toEqual({
      description: '',
      prizePool: '',
      prizeTiers: [],
      perks: [],
      teamSize: null,
      eligibility: '',
      judging: '',
      schedule: '',
      stages: [],
    });
    const thin = parseDevfolioDetail('<html><body>hello world</body></html>');
    expect(thin.prizePool).toBe('');
    expect(thin.teamSize).toBeNull();
    expect(hasFakeUSDPrizeDefault(thin.prizePool)).toBe(false);
  });

  it('fetchDevfolioDetail fetches base + /schedule + /prizes (mocked), cached', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        seen.push(u);
        if (u.endsWith('/schedule')) return { ok: true, text: async () => '<html><body>Schedule: Day 1 opening + hacking, Day 2 judging + results. Team Size: 2 to 4 members</body></html>' } as any;
        if (u.endsWith('/prizes')) return { ok: true, text: async () => '<html><body>Prizes: Winner $500 in cash. Perks: domains, swags</body></html>' } as any;
        return { ok: true, text: async () => DEVFOLIO_DETAIL_HTML } as any;
      }),
    );
    const out = await fetchDevfolioDetail('https://webcraft24.devfolio.co/');
    expect(out).not.toBeNull();
    expect(out!.prizePool).toMatch(/\$500/);
    expect(out!.teamSize).toBe(4);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.some((u) => u.endsWith('/schedule'))).toBe(true);
    expect(seen.some((u) => u.endsWith('/prizes'))).toBe(true);
    // Cached: second call hits scrapeCache (no new fetches for same URLs).
    seen.length = 0;
    const out2 = await fetchDevfolioDetail('https://webcraft24.devfolio.co/');
    expect(out2).not.toBeNull();
  });

  it('fetchDevfolioDetail never throws (rejects to null) + enrich keeps list on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const out = await fetchDevfolioDetail('https://webcraft24.devfolio.co/');
    expect(out).toBeNull();
    const item = opp({ title: 'WebCraft24', url: 'https://webcraft24.devfolio.co/', description: '', prizePool: '' });
    await enrichDevfolioItems([item]);
    expect(item.title).toBe('WebCraft24');
    expect(item.description).toBe('');
    expect(item.prizePool).toBe('');
  });

  it('enrichDevfolioItems fills absent, never overwrites list data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.endsWith('/schedule')) return { ok: true, text: async () => '<html><body>Schedule Day 1 hacking</body></html>' } as any;
        if (u.endsWith('/prizes')) return { ok: true, text: async () => '<html><body>Winner $500 in cash prizes</body></html>' } as any;
        return { ok: true, text: async () => DEVFOLIO_DETAIL_HTML } as any;
      }),
    );
    const item = opp({ title: 'WebCraft24', url: 'https://webcraft24.devfolio.co/', description: '', prizePool: '' });
    await enrichDevfolioItems([item]);
    expect(item.description).toMatch(/Fueled by Chaos/);
    expect(item.prizePool).toMatch(/\$500/);
    expect(item.teamSize).toBe(4);
    // Never overwrites existing list data.
    const keep = opp({ title: 'Keep', url: 'https://webcraft24.devfolio.co/', description: 'List desc', prizePool: '$100' });
    await enrichDevfolioItems([keep]);
    expect(keep.description).toBe('List desc');
    expect(keep.prizePool).toBe('$100');
  });
});

// ─── Devpost detail/rules ───

describe('Devpost detail/rules (B.raw.md:54 + B.webfetch-detail.md:17,32-37)', () => {
  it('parseDevpostDetail mines full description, Ages 13-99, $ tiers', () => {
    const parsed = parseDevpostDetail(`${DEVPOST_OVERVIEW_HTML}\n${DEVPOST_RULES_HTML}`, {
      title: 'RevenueCat Shipaton 2026',
    });
    expect(parsed.description).toMatch(/Ship apps and start making money/);
    expect(parsed.description.length).toBeGreaterThan(200);
    expect(isGenericFallbackDescription(parsed.description)).toBe(false);
    expect(parsed.eligibility).toMatch(/Ages 13 to 99/);
    expect(parsed.prizeTiers.length).toBeGreaterThan(0);
    expect(parsed.prizePool).toMatch(/\$300,000|\$740,000/);
    expect(hasFakeUSDPrizeDefault(parsed.prizePool)).toBe(false);
  });

  it('parseDevpostDetail omits absent (never fakes)', () => {
    const empty = parseDevpostDetail('');
    expect(empty).toEqual({ description: '', eligibility: '', prizePool: '', prizeTiers: [], schedule: '', stages: [] });
    const thin = parseDevpostDetail('<html><body>hello world</body></html>');
    expect(thin.eligibility).toBe('');
    expect(thin.prizePool).toBe('');
  });

  it('fetchDevpostDetail fetches base + /rules (mocked)', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        seen.push(u);
        if (u.endsWith('/rules')) return { ok: true, text: async () => DEVPOST_RULES_HTML } as any;
        return { ok: true, text: async () => DEVPOST_OVERVIEW_HTML } as any;
      }),
    );
    const out = await fetchDevpostDetail('https://revenuecat-shipaton-2026.devpost.com/');
    expect(out).not.toBeNull();
    expect(out!.description).toMatch(/Ship apps/);
    expect(out!.eligibility).toMatch(/Ages 13 to 99/);
    expect(out!.prizeTiers!.length).toBeGreaterThan(0);
    expect(seen.some((u) => u.endsWith('/rules'))).toBe(true);
  });

  it('fetchDevpostDetail never throws + enrich keeps headline prizePool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await fetchDevpostDetail('https://revenuecat-shipaton-2026.devpost.com/')).toBeNull();
    const item = opp({
      title: 'RevenueCat Shipaton 2026',
      url: 'https://revenuecat-shipaton-2026.devpost.com/',
      source: 'DEVPOST',
      description: '',
      prizePool: '$740,000',
    });
    // Detail fails → list headline preserved.
    await enrichDevpostItems([item]);
    expect(item.prizePool).toBe('$740,000');
    expect(item.description).toBe('');
  });

  it('enrichDevpostItems fills description/eligibility, preserves headline + appends new tiers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.endsWith('/rules')) return { ok: true, text: async () => DEVPOST_RULES_HTML } as any;
        return { ok: true, text: async () => DEVPOST_OVERVIEW_HTML } as any;
      }),
    );
    const item = opp({
      title: 'RevenueCat Shipaton 2026',
      url: 'https://revenuecat-shipaton-2026.devpost.com/',
      source: 'DEVPOST',
      description: '',
      prizePool: '$740,000',
    });
    await enrichDevpostItems([item]);
    expect(item.description).toMatch(/Ship apps/);
    expect((item as any).eligibility).toMatch(/Ages 13 to 99/);
    expect((item as any).prizeTiers?.length).toBeGreaterThan(0);
    // Headline preserved (not clobbered by detail pool).
    expect(item.prizePool).toMatch(/\$740,000/);
  });
});

// ─── MLH /prizes ───

describe('MLH /prizes (B.webfetch-detail.md:3,10-18)', () => {
  it('parseMLHPrizes mines Gemini + MongoDB sponsor tiers', () => {
    const parsed = parseMLHPrizes(MLH_PRIZES_HTML);
    expect(parsed.prizeTiers.length).toBeGreaterThanOrEqual(2);
    expect(parsed.prizePool).toMatch(/Gemini/);
    expect(parsed.prizePool).toMatch(/MongoDB/);
    expect(parsed.prizeTiers.join(' | ')).toMatch(/Best Use of Gemini API/);
    expect(parsed.prizeTiers.join(' | ')).toMatch(/Best Use of MongoDB Atlas/);
    expect(hasFakePrizeDefault(parsed.prizePool)).toBe(false);
    expect(hasFakeUSDPrizeDefault(parsed.prizePool)).toBe(false);
  });

  it('parseMLHPrizes omits absent (never fakes)', () => {
    expect(parseMLHPrizes('')).toEqual({ prizePool: '', prizeTiers: [], description: '' });
    expect(parseMLHPrizes('<html><body>hello</body></html>').prizeTiers).toEqual([]);
  });

  it('fetchMLHDetail fetches the resolver /prizes URL as-is (mocked)', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        seen.push(String(url));
        return { ok: true, text: async () => MLH_PRIZES_HTML } as any;
      }),
    );
    const out = await fetchMLHDetail('https://mlh.io/events/jon-test-event/prizes');
    expect(out).not.toBeNull();
    expect(out!.prizePool).toMatch(/Gemini/);
    expect((out as any).prizeTiers.length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain('https://mlh.io/events/jon-test-event/prizes');
  });

  it('fetchMLHDetail rejects non-mlh hosts + never throws', async () => {
    expect(await fetchMLHDetail('https://example.com/x')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await fetchMLHDetail('https://mlh.io/events/jon-test-event/prizes')).toBeNull();
  });

  it('enrichMLHItems fills absent prizePool/tiers, preserves list data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => MLH_PRIZES_HTML }) as any),
    );
    const item = opp({ title: 'Jon Test Event', url: 'https://mlh.io/events/jon-test-event/prizes', source: 'MLH', prizePool: '' });
    await enrichMLHItems([item]);
    expect(item.prizePool).toMatch(/Gemini/);
    expect((item as any).prizeTiers.length).toBeGreaterThanOrEqual(2);
    const keep = opp({ title: 'Keep', url: 'https://mlh.io/events/jon-test-event/prizes', source: 'MLH', prizePool: 'Swag' });
    await enrichMLHItems([keep]);
    expect(keep.prizePool).toBe('Swag');
  });

  it("registry: MLH enrichPages includes '/prizes' (was omitted)", async () => {
    await import('../src/services/opportunityAgent');
    const meta = getPlatformMeta('MLH');
    expect(meta).toBeDefined();
    expect(meta!.enrichPages).toContain('/prizes');
    expect(meta!.enrichPages).toContain('');
  });
});

// ─── HackerEarth tabs + list teamSize ───

describe('HackerEarth tabs (B.raw.md:24) + list teamSize', () => {
  it('HACKEREARTH_DETAIL_TABS lists real slugs (no wrong /details)', () => {
    expect([...HACKEREARTH_DETAIL_TABS]).toEqual(['/prizes', '/rules', '/judges', '/teams']);
    expect([...HACKEREARTH_DETAIL_TABS]).not.toContain('/details' as any);
  });

  it("registry: HACKEREARTH enrichPages fixed ('/details' wrong slug replaced)", async () => {
    await import('../src/services/opportunityAgent');
    const meta = getPlatformMeta('HACKEREARTH');
    expect(meta).toBeDefined();
    expect(meta!.enrichPages).toContain('/prizes');
    expect(meta!.enrichPages).toContain('/rules');
    expect(meta!.enrichPages).toContain('/judges');
    expect(meta!.enrichPages).toContain('/teams');
    expect(meta!.enrichPages).not.toContain('/details');
  });

  it('parseHackerEarthDetail mines ₹85k, Team 1-4, evaluation + judges', () => {
    const combined = [HACKEREARTH_OVERVIEW_HTML, HACKEREARTH_PRIZES_HTML, HACKEREARTH_RULES_HTML, HACKEREARTH_JUDGES_HTML].join('\n');
    const parsed = parseHackerEarthDetail(combined, { title: 'Code Kitchen' });
    expect(parsed.prizePool).toMatch(/₹85,000/);
    expect(parsed.prizeTiers.length).toBeGreaterThan(0);
    expect(hasFakePrizeDefault(parsed.prizePool)).toBe(false);
    expect(parsed.teamSize).toBe(4); // "Team size: 1 - 4" → max
    expect(parsed.judging).toMatch(/Innovation|100 points/i);
    expect(parsed.judging).toMatch(/Judges:/);
    expect(parsed.judging).toMatch(/Ayush Chhabra/);
  });

  it('parseHackerEarthDetail omits absent (never fakes)', () => {
    const empty = parseHackerEarthDetail('');
    expect(empty.teamSize).toBeNull();
    expect(empty.prizePool).toBe('');
    expect(empty.judging).toBe('');
    expect(hasFakePrizeDefault(empty.prizePool)).toBe(false);
  });

  it('fetchHackerEarthDetail fetches canonical tabs (mocked), microsite base-only', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        seen.push(u);
        if (u.endsWith('/prizes')) return { ok: true, text: async () => HACKEREARTH_PRIZES_HTML } as any;
        if (u.endsWith('/rules')) return { ok: true, text: async () => HACKEREARTH_RULES_HTML } as any;
        if (u.endsWith('/judges')) return { ok: true, text: async () => HACKEREARTH_JUDGES_HTML } as any;
        if (u.endsWith('/teams')) return { ok: true, text: async () => '<html><body>Teams: Team size 1 - 4 members</body></html>' } as any;
        return { ok: true, text: async () => HACKEREARTH_OVERVIEW_HTML } as any;
      }),
    );
    const out = await fetchHackerEarthDetail('https://www.hackerearth.com/challenges/hackathon/code-kitchen/');
    expect(out).not.toBeNull();
    expect(out!.prizePool).toMatch(/₹85,000/);
    expect((out as any).teamSize).toBe(4);
    expect((out as any).judging).toMatch(/Ayush Chhabra/);
    for (const tab of ['/prizes', '/rules', '/judges', '/teams']) {
      expect(seen.some((u) => u.endsWith(tab))).toBe(true);
    }
    // Microsite (subdomain.hackerearth.com): base only, no tab fan-out.
    seen.length = 0;
    const micro = await fetchHackerEarthDetail('https://hackcbs4.hackerearth.com/');
    expect(micro).not.toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe('https://hackcbs4.hackerearth.com');
  });

  it('fetchHackerEarthDetail never throws + enrich keeps list on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await fetchHackerEarthDetail('https://www.hackerearth.com/challenges/hackathon/code-kitchen/')).toBeNull();
    const item = opp({
      title: 'Code Kitchen',
      url: 'https://www.hackerearth.com/challenges/hackathon/code-kitchen/',
      source: 'HACKEREARTH',
      prizePool: '',
    });
    await enrichHackerEarthItems([item]);
    expect(item.title).toBe('Code Kitchen');
    expect(item.prizePool).toBe('');
  });

  it('fetchHackerEarthPage maps API max/min_team_size at list level (1/1 -> 1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/community/challenges/compete/')) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                data: [
                  {
                    title: 'Code Kitchen',
                    slug: 'code-kitchen',
                    type: 'Hackathon',
                    start: '2026-08-24T18:30:00',
                    end: '2026-09-15T18:29:00',
                    url: 'https://www.hackerearth.com/challenges/hackathon/code-kitchen/',
                    company_name: 'AIM',
                    max_team_size: 1,
                    min_team_size: 1,
                    subscription_count: 4,
                  },
                ],
              }),
          } as any;
        }
        // Detail enrichment probes (fetchPage6k): thin shell → no rich fields, keep list teamSize.
        return { ok: true, text: async () => '<html><body>short shell</body></html>' } as any;
      }),
    );
    const out = await fetchHackerEarthPage(1, new Set<string>());
    // API path returns before DDG fallback; list teamSize mapped even when detail thin.
    const kitchen = out.find((o) => o.title === 'Code Kitchen');
    expect(kitchen).toBeDefined();
    expect((kitchen as any).teamSize).toBe(1);
    expect(kitchen!.organizer).toBe('AIM');
  });
});
