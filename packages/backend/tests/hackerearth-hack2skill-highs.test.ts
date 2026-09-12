/**
 * Regression tests for two HIGH warts (2026-09-09 parity).
 * Hermetic: no DB, no live network (fetch mocked where needed).
 *
 * HIGH 1 — HackerEarth items 4-6 non-event artifacts (hackerearth.ts:101-310):
 *   `fetchHackerEarth(6)` returned 3 real API hackathons + 3 fallback artifacts:
 *   bare list URL with deadline '' (never expires), sprint/amplified subdomains.
 *   Fix: require canonical event URL shape (www.hackerearth.com + /challenges/.../<slug>)
 *   + non-empty deadline in DDG/HTML fallback (honest-omit, never emit).
 *
 * HIGH 2 — Hack2Skill mode hardcoded ONLINE vs IN_PERSON offline finale (hack2skill.ts:207-208):
 *   Item 1 Impactx26 event-details proves tags.mode IN_PERSON + finale IN_PERSON +
 *   About "24-hour offline hackathon at RNSIT Bengaluru", yet fetcher hardcoded ONLINE.
 *   Fix: derive mode from event data (tags.mode/finale/About cues), honest-omit '' when
 *   no evidence (ONLINE only when evidenced).
 *
 * MEDIUMs/LOWs left as notes (NOT fixed here):
 *   HE: teamSize drop (max_team_size 1/1), prize '' vs detail ₹85k cue, description '' vs detail copy.
 *   H2S: prize '' vs Rs.75000, description '' vs About multi-KB, teamSize min2/max4 drop,
 *   organizer constant vs IEEE-RNSIT, slug-casing title vs data.title.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  fetchHackerEarthPage,
  isHackerEarthEventUrl,
} from '../src/services/opportunities/sources/hackerearth';
import {
  fetchHack2SkillApiPage,
  fetchHack2SkillEventMode,
  fetchHack2SkillRegistrationEnd,
  mapHack2SkillModeValue,
  deriveHack2SkillModeFromDetails,
} from '../src/services/opportunities/sources/hack2skill';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── HIGH 1 — HackerEarth event-URL guard ───

describe('HIGH 1 — isHackerEarthEventUrl drops non-event artifacts', () => {
  it('accepts canonical event URLs (evidence items 1-3)', () => {
    expect(
      isHackerEarthEventUrl('https://www.hackerearth.com/challenges/hackathon/github-repo-value-check/'),
    ).toBe(true);
    expect(
      isHackerEarthEventUrl('https://www.hackerearth.com/challenges/hackathon/yuva-yodha-energy-tech-hackathon/'),
    ).toBe(true);
    expect(isHackerEarthEventUrl('https://www.hackerearth.com/challenges/hackathon/code-kitchen/')).toBe(
      true,
    );
  });

  it('drops bare list URL (evidence item 4: deadline empty, never expires)', () => {
    expect(isHackerEarthEventUrl('https://www.hackerearth.com/challenges/hackathon/')).toBe(false);
    expect(isHackerEarthEventUrl('https://www.hackerearth.com/challenges/hackathon')).toBe(false);
    expect(isHackerEarthEventUrl('https://www.hackerearth.com/challenges/')).toBe(false);
  });

  it('drops sprint/amplified subdomains (evidence items 5-6: promo hubs, not events)', () => {
    expect(isHackerEarthEventUrl('https://sprint.hackerearth.com/challenges/hackathon/')).toBe(false);
    expect(isHackerEarthEventUrl('https://amplified.hackerearth.com/')).toBe(false);
    expect(isHackerEarthEventUrl('https://hackcbs4.hackerearth.com/')).toBe(false);
  });

  it('drops non-hackerearth hosts and garbage', () => {
    expect(isHackerEarthEventUrl('https://example.com/challenges/hackathon/foo/')).toBe(false);
    expect(isHackerEarthEventUrl('not-a-url')).toBe(false);
    expect(isHackerEarthEventUrl('')).toBe(false);
    expect(isHackerEarthEventUrl(null as any)).toBe(false);
  });
});

describe('HIGH 1 — fetchHackerEarthPage DDG fallback filters artifacts (mocked)', () => {
  const GOOD_URL = 'https://www.hackerearth.com/challenges/hackathon/code-kitchen/';
  const BARE_URL = 'https://www.hackerearth.com/challenges/hackathon/';
  const SPRINT_URL = 'https://sprint.hackerearth.com/challenges/hackathon/';
  const AMPLIFIED_URL = 'https://amplified.hackerearth.com/';
  const NODATE_URL = 'https://www.hackerearth.com/challenges/hackathon/riverfront-build-challenge/';

  // DDG HTML in the shape the fallback parses (result__a links + result__snippet texts).
  // Good item carries a deadline cue; all four artifacts carry none (fetchPage6k also '' below).
  const DDG_HTML = [
    `<a class="result__a" href="${GOOD_URL}">Code Kitchen Hackathon</a>`,
    `<span class="result__snippet">Registration ends Sep 15, 2026 hackathon challenge coding contest</a>`,
    `<a class="result__a" href="${BARE_URL}">Compete - HackerEarth</a>`,
    `<span class="result__snippet">Test your skills with real challenges from top companies hackathon</a>`,
    `<a class="result__a" href="${SPRINT_URL}">Compete | HackerEarth</a>`,
    `<span class="result__snippet">Status Live Reset For organizations Host your own hackathon challenge</a>`,
    `<a class="result__a" href="${AMPLIFIED_URL}">AMPlified The AI Challenge</a>`,
    `<span class="result__snippet">Compete across 70 colleges Earn Tokens climb tiers challenge contest</a>`,
    `<a class="result__a" href="${NODATE_URL}">Riverfront Build Challenge</a>`,
    `<span class="result__snippet">Join this hackathon challenge contest with friends and build something</a>`,
  ].join('\n');

  function mockFetchForDDG() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('html.duckduckgo.com')) {
          return { ok: true, text: async () => DDG_HTML } as any;
        }
        // fetchPage6k detail probes: short text (<100 after strip) → no deadline evidence.
        return { ok: true, text: async () => 'short' } as any;
      }),
    );
  }

  it('keeps the dated event, drops bare/subdomain/dateless artifacts', async () => {
    mockFetchForDDG();
    // Page 2 skips the JSON API and exercises the DDG fallback (the leaking path).
    const out = await fetchHackerEarthPage(2, new Set<string>());
    const urls = out.map((o) => o.url);
    expect(urls).toContain(GOOD_URL);
    expect(urls).not.toContain(BARE_URL);
    expect(urls).not.toContain(SPRINT_URL);
    expect(urls).not.toContain(AMPLIFIED_URL);
    expect(urls).not.toContain(NODATE_URL);
    expect(out).toHaveLength(1);
    expect(out[0].title.toLowerCase()).toContain('code kitchen');
    expect(out[0].deadline).not.toBe('');
  });

  it('proves the old code would have leaked the bare URL (documents the bug)', () => {
    // Old predicate accepted any hackerearth.com href; new guard rejects bare/subdomain.
    for (const u of [BARE_URL, SPRINT_URL, AMPLIFIED_URL]) {
      expect(u.includes('hackerearth.com')).toBe(true); // old check — passes (leaks)
      expect(isHackerEarthEventUrl(u)).toBe(false); // new guard — drops
    }
  });
});

// ─── HIGH 2 — Hack2Skill mode derivation ───

describe('HIGH 2 — mapHack2SkillModeValue normalizes honestly', () => {
  it('maps IN_PERSON/offline variants to OFFLINE', () => {
    expect(mapHack2SkillModeValue('IN_PERSON')).toBe('OFFLINE');
    expect(mapHack2SkillModeValue('in_person')).toBe('OFFLINE');
    expect(mapHack2SkillModeValue('IN-PERSON')).toBe('OFFLINE');
    expect(mapHack2SkillModeValue('OFFLINE')).toBe('OFFLINE');
    expect(mapHack2SkillModeValue('onsite')).toBe('OFFLINE');
  });

  it('maps HYBRID/ONLINE and honest-omits unknown', () => {
    expect(mapHack2SkillModeValue('HYBRID')).toBe('OFFLINE'.replace('OFFLINE', 'HYBRID'));
    expect(mapHack2SkillModeValue('ONLINE')).toBe('ONLINE');
    expect(mapHack2SkillModeValue('virtual')).toBe('ONLINE');
    expect(mapHack2SkillModeValue('')).toBe('');
    expect(mapHack2SkillModeValue(null as any)).toBe('');
    expect(mapHack2SkillModeValue(undefined as any)).toBe('');
    expect(mapHack2SkillModeValue('SOMETHING_ELSE')).toBe('');
  });
});

describe('HIGH 2 — deriveHack2SkillModeFromDetails prefers evidence, omits when absent', () => {
  it('reads tags.mode IN_PERSON as OFFLINE (Impactx26 evidence)', () => {
    expect(
      deriveHack2SkillModeFromDetails({
        tags: { mode: { value: 'IN_PERSON' }, finale: { value: 'IN_PERSON' } },
        sections: [],
      }),
    ).toBe('OFFLINE');
  });

  it('reads ONLINE/HYBRID tags verbatim', () => {
    expect(deriveHack2SkillModeFromDetails({ tags: { mode: { value: 'ONLINE' } } })).toBe('ONLINE');
    expect(deriveHack2SkillModeFromDetails({ tags: { mode: { value: 'HYBRID' } } })).toBe('HYBRID');
  });

  it('falls back to finale IN_PERSON when mode tag missing', () => {
    expect(deriveHack2SkillModeFromDetails({ tags: { finale: { value: 'IN_PERSON' } } })).toBe(
      'OFFLINE',
    );
  });

  it('falls back to About offline text cues (RNSIT Bengaluru evidence)', () => {
    const details = {
      tags: {},
      sections: [
        {
          title: 'About',
          category: [
            {
              data: [
                {
                  description:
                    "<p>ImpactX'26 is a 24-hour national-level offline hackathon at RNS Institute of Technology, Bengaluru.</p>",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(deriveHack2SkillModeFromDetails(details)).toBe('OFFLINE');
  });

  it('honest-omits when no mode evidence (never hardcoded ONLINE)', () => {
    expect(deriveHack2SkillModeFromDetails({ tags: {}, sections: [] })).toBe('');
    expect(deriveHack2SkillModeFromDetails(null as any)).toBe('');
    expect(deriveHack2SkillModeFromDetails(undefined as any)).toBe('');
  });
});

// Trimmed live shape from B.webfetch-event-details-impactx26.json (20260909-232017):
// tags.mode IN_PERSON + finale IN_PERSON + About offline @ RNSIT Bengaluru.
const IMPACTX26_DETAILS = {
  title: "ImpactX'26",
  registrationEnd: '2026-10-02T18:29:00.000Z',
  tags: {
    mode: { value: 'IN_PERSON', isHidden: false },
    finale: { value: 'IN_PERSON', isHidden: true },
    teamSize: { min: 2, max: 4, isHidden: false },
  },
  sections: [
    {
      title: 'About',
      type: 'ABOUT',
      category: [
        {
          data: [
            {
              description:
                "<p>ImpactX'26 is a 24-hour national-level offline hackathon at RNS Institute of Technology, Bengaluru.</p>",
            },
          ],
        },
      ],
    },
  ],
};

describe('HIGH 2 — fetchHack2SkillEventMode hits event-details, never hardcodes (mocked)', () => {
  function mockEventDetails(map: Record<string, any>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/v1/event/')) {
          const slug = u.split('/api/v1/event/')[1]?.split('/')[0] || '';
          const data = map[slug];
          if (!data) return { ok: false, headers: { get: () => '' } } as any;
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data }),
          } as any;
        }
        return { ok: true, text: async () => 'shell' } as any;
      }),
    );
  }

  it('returns OFFLINE for Impactx26 IN_PERSON (was hardcoded ONLINE)', async () => {
    mockEventDetails({ impactx26: IMPACTX26_DETAILS });
    const mode = await fetchHack2SkillEventMode('https://hack2skill.com/event/impactx26');
    expect(mode).toBe('OFFLINE');
    expect(mode).not.toBe('ONLINE');
  });

  it('honest-omits when event-details missing (never ONLINE by default)', async () => {
    mockEventDetails({});
    const mode = await fetchHack2SkillEventMode('https://hack2skill.com/event/unknown-slug-xyz');
    expect(mode).toBe('');
  });

  it('deadline path still authoritative after shared-cache refactor (fit_fest fix holds)', async () => {
    mockEventDetails({ impactx26: IMPACTX26_DETAILS });
    const deadline = await fetchHack2SkillRegistrationEnd('https://hack2skill.com/event/impactx26');
    expect(deadline).toBe('2026-10-02T18:29:00.000Z');
  });
});

describe('HIGH 2 — fetchHack2SkillApiPage sitemap derives mode per event (mocked)', () => {
  const SITEMAP_XML = [
    '<url><loc>https://hack2skill.com/event/impactx26</loc></url>',
    '<url><loc>https://hack2skill.com/event/online-summit-event</loc></url>',
    '<url><loc>https://hack2skill.com/event/no-mode-event</loc></url>',
  ].join('');

  function mockSitemapRun() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, _opts?: any) => {
        const u = String(url);
        if (u.includes('/innovator/public/event/list')) {
          // List API is a SPA shell tonight (API-empty) → forces sitemap fallback.
          return { ok: true, headers: { get: () => 'text/html' }, text: async () => 'Hack2skill' } as any;
        }
        if (u.includes('sitemap.xml')) {
          return { ok: true, text: async () => SITEMAP_XML } as any;
        }
        if (u.includes('/api/v1/event/')) {
          const slug = u.split('/api/v1/event/')[1]?.split('/')[0] || '';
          if (slug === 'impactx26') {
            return {
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ success: true, data: IMPACTX26_DETAILS }),
            } as any;
          }
          if (slug === 'online-summit-event') {
            return {
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({
                success: true,
                data: {
                  title: 'Online Summit',
                  registrationEnd: '2026-11-01T00:00:00.000Z',
                  tags: { mode: { value: 'ONLINE' } },
                  sections: [],
                },
              }),
            } as any;
          }
          if (slug === 'no-mode-event') {
            return {
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({
                success: true,
                data: {
                  title: 'No Mode',
                  registrationEnd: '2026-12-01T00:00:00.000Z',
                  tags: {},
                  sections: [],
                },
              }),
            } as any;
          }
          return { ok: false, headers: { get: () => '' } } as any;
        }
        // fetchPage6k detail shells: no date cues (deadline comes from event-details API).
        return { ok: true, text: async () => '<html><body>Hack2skill event shell</body></html>' } as any;
      }),
    );
  }

  it('maps IN_PERSON→OFFLINE, keeps ONLINE when evidenced, omits when absent', async () => {
    mockSitemapRun();
    const out = await fetchHack2SkillApiPage(1, new Set<string>());
    expect(out).toHaveLength(3);
    const byUrl = new Map(out.map((o) => [o.url, o]));
    const impact = byUrl.get('https://hack2skill.com/event/impactx26')!;
    const online = byUrl.get('https://hack2skill.com/event/online-summit-event')!;
    const nomode = byUrl.get('https://hack2skill.com/event/no-mode-event')!;
    expect(impact).toBeDefined();
    expect(online).toBeDefined();
    expect(nomode).toBeDefined();
    // HIGH assertion: offline finale is OFFLINE, not hardcoded ONLINE.
    expect(impact.mode).toBe('OFFLINE');
    expect(impact.deadline).toBe('2026-10-02T18:29:00.000Z');
    // ONLINE only when evidenced.
    expect(online.mode).toBe('ONLINE');
    // Honest-omit when no evidence (never hardcoded ONLINE).
    expect(nomode.mode).toBe('');
    for (const o of out) {
      expect(o.source).toBe('HACK2SKILL');
      expect(o.deadline).not.toBe('');
    }
  });
});
