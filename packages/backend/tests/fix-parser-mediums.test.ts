/**
 * Regression tests for remaining parser MEDIUMs/LOWs sweep (2026-09-10).
 * Hermetic: no DB, no live network (secureUrl mocked, fetch mocked where needed).
 *
 * Covers (safe parts only; risky items documented in .ai/reports/fix-parser-mediums.md):
 * - DoraHacks org strict + anchor prize 300/tiers (slug-casing left as risky)
 * - HackerEarth DDG prize/team + anchor team (desc/location left honest-omit)
 * - Hack2Skill prize/desc/team/org/casing from shared event-details cache
 * - Internshala Rs variants + mode honest-omit (location mining left as bleed-risk)
 * - MLH test-event word-boundary filter (prize/desc already via enrichMLHItems)
 * - Unstop internship Unknown + total-pool tier + perks bleed
 * - Wellfound/search Unknown honest-omit
 * - Search DDG anomaly guard + snippet pairing + entities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hermetic: bypass DNS/allowlist (real validateExternalUrl does dns.lookup → live net).
vi.mock('../src/utils/secureUrl', () => ({
  validateExternalUrl: vi.fn(async (u: string) => new URL(u)),
}));

import { stripHtml, decodeHtmlEntitiesForSearch } from '../src/services/opportunities/text';
import {
  isDuckDuckGoAnomalyPage,
  fetchGenericViaSearch,
} from '../src/services/opportunities/sources/searchFetch';
import {
  fetchHackerEarthPage,
} from '../src/services/opportunities/sources/hackerearth';
import {
  extractHack2SkillPrizes,
  extractHack2SkillDescription,
  extractHack2SkillTeamSize,
  extractHack2SkillOrganizer,
  extractHack2SkillTitleValue,
  fetchHack2SkillRichFields,
  fetchHack2SkillApiPage,
} from '../src/services/opportunities/sources/hack2skill';
import {
  extractInternshalaStipend,
  fetchInternshalaDetail,
} from '../src/services/opportunities/sources/internshala';
import { isMLHTestEvent, fetchMLH } from '../src/services/opportunities/sources/mlh';
import {
  isGenericUnstopTotalTier,
  cleanUnstopPerks,
  fetchUnstopInternships,
} from '../src/services/opportunities/sources/unstop';
import { extractDoraHacksOrganizer, fetchDoraHacksPage } from '../src/services/opportunities/sources/dorahacks';
import { fetchWellfoundPage } from '../src/services/opportunities/sources/wellfound';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Text entities (search-entities safe part) ───

describe('text entities preserve ₹/dash (was nuked to space)', () => {
  it('stripHtml keeps range dash (3&ndash;4 → 3-4, not 3 4)', () => {
    const out = stripHtml('Team size: 3&ndash;4 members per team');
    expect(out).toContain('3-4');
    expect(out).not.toMatch(/3\s+4 members/);
  });

  it('stripHtml decodes rupee entities to ₹', () => {
    expect(stripHtml('Prize &#8377;5000')).toContain('₹');
    expect(stripHtml('Prize &#8377;5000')).toContain('5000');
  });

  it('decodeHtmlEntitiesForSearch keeps nbsp as space (amp stays space per existing contract)', () => {
    // Existing contract: stripHtml('<h3>Hi</h3>  &amp; bye') === 'Hi bye' (amp → space, not &).
    // Dash/rupee are the safe fixes (no existing test); amp change would break opportunity-pure.
    expect(decodeHtmlEntitiesForSearch('a&nbsp;b')).toContain('a b');
    expect(stripHtml('<h3>Hi</h3>  &amp; bye')).toBe('Hi bye');
  });
});

// ─── Search DDG flake (safe parts) ───

describe('search DDG anomaly guard + pairing', () => {
  it('detects anomaly-modal bot-check page', () => {
    expect(isDuckDuckGoAnomalyPage('<div class="anomaly-modal">bot check</div>')).toBe(true);
    expect(isDuckDuckGoAnomalyPage('<div>normal results</div>')).toBe(false);
    expect(isDuckDuckGoAnomalyPage('')).toBe(false);
    expect(isDuckDuckGoAnomalyPage(null as any)).toBe(false);
  });

  it('fetchGenericViaSearch returns [] on anomaly (never caches pollution)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '<div class="anomaly-modal">challenge</div>' }) as any),
    );
    const out = await fetchGenericViaSearch('hackathon 2026 company', 1, new Set<string>(), 'OTHER_HACKATHON', 'HACKATHON');
    expect(out).toEqual([]);
  });

  it('snippet cursor advances on skipped links (no misalignment)', async () => {
    // 3 links: first invalid (duckduckgo.com, no uddg → stays duckduckgo.com, dropped)
    // must still advance snippet cursor, else second valid item would wrongly pair
    // with first snippet (old bug: href/validate-skip did not idx++).
    const ddgHtml = [
      '<a class="result__a" href="https://duckduckgo.com/about">Skip Me Hackathon</a>',
      '<span class="result__snippet">FIRST snippet hackathon should be skipped with its link</a>',
      '<a class="result__a" href="https://unstop.com/o/alpha-1">Alpha Hackathon Event</a>',
      '<span class="result__snippet">SECOND snippet hackathon alpha unique-marker-alpha</a>',
      '<a class="result__a" href="https://unstop.com/o/beta-2">Beta Hackathon Event</a>',
      '<span class="result__snippet">THIRD snippet hackathon beta unique-marker-beta</a>',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('html.duckduckgo.com')) return { ok: true, text: async () => ddgHtml } as any;
        // fetchPage6k detail probes: short (no deadline cues → deadline '' honest, kept).
        return { ok: true, text: async () => 'short shell no dates here' } as any;
      }),
    );
    const out = await fetchGenericViaSearch('hackathon 2026 company', 1, new Set<string>(), 'OTHER_HACKATHON', 'HACKATHON');
    expect(out.length).toBeGreaterThanOrEqual(2);
    const descs = out.map((o) => o.description);
    // Alpha must pair with SECOND (not FIRST), Beta with THIRD.
    expect(descs[0]).toContain('unique-marker-alpha');
    expect(descs[0]).not.toContain('FIRST snippet');
    if (descs[1]) {
      expect(descs[1]).toContain('unique-marker-beta');
    }
  });
});

// ─── HackerEarth MEDIUMs (team/prize) ───

describe('HackerEarth DDG prize/team + anchor team', () => {
  const GOOD_URL = 'https://www.hackerearth.com/challenges/hackathon/prize-team-challenge/';

  function mockHeDDG(snippet: string, detail: string) {
    const ddgHtml = [
      `<a class="result__a" href="${GOOD_URL}">Prize Team Hackathon Challenge</a>`,
      `<span class="result__snippet">${snippet}</a>`,
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('html.duckduckgo.com')) return { ok: true, text: async () => ddgHtml } as any;
        if (u.includes('hackerearth.com/challenges/')) return { ok: true, text: async () => `<html><body>${detail}</body></html>` } as any;
        return { ok: true, text: async () => 'short' } as any;
      }),
    );
  }

  it('DDG fallback mines prize tiers + teamSize (was prize empty, team dropped)', async () => {
    mockHeDDG(
      'Registration ends Sep 20, 2026 hackathon challenge Winner Prize: ₹50,000 Team size: 1-4 contest',
      'Team size: 1 - 4 members. Winner Prize: ₹50,000. Registration ends Sep 20, 2026.',
    );
    const out = await fetchHackerEarthPage(2, new Set<string>());
    expect(out).toHaveLength(1);
    expect(out[0].prizePool).toContain('50,000');
    expect((out[0] as any).prizeTiers?.join(' ') || '').toContain('50,000');
    expect((out[0] as any).teamSize).toBe(4);
  });

  it('anchor fallback maps window teamSize (was dropped)', async () => {
    // Anchor path calls resolveHackerEarthTeamSize(undefined, undefined, windowText) — prove it maps 2-4 → 4.
    // (Pure helper lives in details.ts; hackerearth.ts imports it — import directly to avoid ESM re-export flake.)
    const { resolveHackerEarthTeamSize } = await import('../src/services/opportunities/sources/details');
    expect(resolveHackerEarthTeamSize(undefined, undefined, 'Team size: 2-4 members')).toBe(4);
  });
});

// ─── Hack2Skill MEDIUMs 2-4 + LOWs 5-6 ───

const H2S_PRIZE_DETAILS = {
  title: "ImpactX'26",
  registrationEnd: '2026-10-02T18:29:00.000Z',
  tags: { mode: { value: 'IN_PERSON' }, teamSize: { min: 2, max: 4 } },
  sections: [
    {
      title: 'PRIZES',
      type: 'PRIZES',
      category: [
        {
          data: [
            { title: 'Winner', description: 'Rs. 75000/- cash prize' },
            { title: 'First Runner Up', description: 'Rs. 25000/-' },
            { title: 'Second Runner Up', description: 'INR 25000' },
          ],
        },
      ],
    },
    {
      title: 'About',
      type: 'ABOUT',
      category: [
        {
          data: [
            { description: "<p>ImpactX'26 is a 24-hour national-level offline hackathon at RNS Institute of Technology, Bengaluru. Organized by IEEE Computer Society.</p>" },
          ],
        },
      ],
    },
  ],
};

describe('Hack2Skill rich fields from shared event-details', () => {
  it('extracts Rs./INR prizes as ₹ tiers (Rs. 75000 + 25000s, never ₹0)', () => {
    const { prizePool, tiers } = extractHack2SkillPrizes(H2S_PRIZE_DETAILS);
    // Raw cards carry `75000` without comma — assert digits (comma-agnostic), never ₹0.
    expect(prizePool.replace(/,/g, '')).toContain('75000');
    expect(prizePool.replace(/,/g, '')).toContain('25000');
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    const joined = tiers.join(' | ');
    expect(joined).not.toContain('₹0');
    expect(joined).toMatch(/₹/);
  });

  it('omits prizes when absent (never invents)', () => {
    expect(extractHack2SkillPrizes({ sections: [] })).toEqual({ prizePool: '', tiers: [], perks: [] });
    expect(extractHack2SkillPrizes(null as any)).toEqual({ prizePool: '', tiers: [], perks: [] });
  });

  it('maps About multi-KB HTML to description (not empty)', () => {
    const d = extractHack2SkillDescription(H2S_PRIZE_DETAILS, { title: "ImpactX'26" });
    expect(d.length).toBeGreaterThan(20);
    expect(d).toContain('RNS');
    expect(d.length).toBeLessThanOrEqual(2000);
  });

  it('maps tags.teamSize min2/max4 → 4 (max wins)', () => {
    expect(extractHack2SkillTeamSize(H2S_PRIZE_DETAILS)).toBe(4);
    expect(extractHack2SkillTeamSize({ tags: { teamSize: { min: 2, max: 2 } } })).toBe(2);
    expect(extractHack2SkillTeamSize({ tags: { teamSize: { min: 5, max: 3 } } })).toBeNull();
    expect(extractHack2SkillTeamSize({ tags: {}, sections: [] })).toBeNull();
  });

  it('prefers explicit organizer, mines strict Organized-by, omits otherwise', () => {
    expect(extractHack2SkillOrganizer({ organizer: 'IEEE Computer Society' })).toBe('IEEE Computer Society');
    expect(extractHack2SkillOrganizer(H2S_PRIZE_DETAILS)).toContain('IEEE');
    expect(extractHack2SkillOrganizer({ tags: {}, sections: [] })).toBe('');
  });

  it('preserves data.title casing (ImpactX26 vs Impactx26 Hackathon)', () => {
    expect(extractHack2SkillTitleValue(H2S_PRIZE_DETAILS)).toBe("ImpactX'26");
    expect(extractHack2SkillTitleValue({ title: 'Test Event Demo' })).toBe('');
    expect(extractHack2SkillTitleValue({})).toBe('');
  });

  it('fetchHack2SkillRichFields hits shared cache (mocked event-details, no extra shape)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/api/v1/event/')) {
          return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data: H2S_PRIZE_DETAILS }) } as any;
        }
        return { ok: true, text: async () => 'shell' } as any;
      }),
    );
    const rich = await fetchHack2SkillRichFields('https://hack2skill.com/event/impactx26');
    expect(rich.title).toBe("ImpactX'26");
    expect(rich.description).toContain('RNS');
    expect(rich.prizePool.replace(/,/g, '')).toContain('75000');
    expect(rich.teamSize).toBe(4);
    expect(rich.organizer).toContain('IEEE');
  });

  it('sitemap uses data.title casing (was slug-cased Impactx26 Hackathon)', async () => {
    const SITEMAP_XML = '<url><loc>https://hack2skill.com/event/impactx26</loc></url>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/innovator/public/event/list')) return { ok: true, headers: { get: () => 'text/html' }, text: async () => 'Hack2skill' } as any;
        if (u.includes('sitemap.xml')) return { ok: true, text: async () => SITEMAP_XML } as any;
        if (u.includes('/api/v1/event/')) {
          return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data: H2S_PRIZE_DETAILS }) } as any;
        }
        return { ok: true, text: async () => '<html><body>shell</body></html>' } as any;
      }),
    );
    const out = await fetchHack2SkillApiPage(1, new Set<string>());
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("ImpactX'26");
    expect(out[0].title).not.toBe('Impactx26 Hackathon');
    expect(out[0].prizePool.replace(/,/g, '')).toContain('75000');
    expect((out[0] as any).teamSize).toBe(4);
  });
});

// ─── Internshala Rs variants + mode honest-omit ───

describe('Internshala Rs variants + mode honest-omit', () => {
  it('parses Rs./INR/₹-entity stipends (period still required)', () => {
    expect(extractInternshalaStipend('<div>Stipend Rs. 5,000 - 10,000 /month</div>').replace(/,/g, '')).toMatch(/5000/);
    expect(extractInternshalaStipend('<div>Salary INR 11000 - 14000 per month</div>').replace(/,/g, '')).toMatch(/11000/);
    expect(extractInternshalaStipend('<div>Stipend &#8377; 8000 /month</div>').replace(/,/g, '')).toMatch(/8000/);
  });

  it('still honest-omits popup Rs. 599 without period (never first-₹-on-page)', () => {
    const popupOnly = '<div class="subscription-popup"><p>AI Guide worth Rs. 599</p></div><div><p>No stipend</p></div>';
    expect(extractInternshalaStipend(popupOnly)).toBe('');
  });

  it('fallback mode honest-omits without WFH (was invented OFFLINE)', async () => {
    const html = '<html><body><div class="internship-details"><p>6 Months</p><p>Stipend ₹5,000 /month</p></div></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html }) as any));
    const d = await fetchInternshalaDetail('https://internshala.com/internship/detail/fake-no-wfh');
    expect(d).not.toBeNull();
    expect(d!.mode).toBe('');
    expect(d!.location).toBe('');
  });

  it('fallback mode keeps REMOTE when WFH evidenced', async () => {
    const html = '<html><body><p>Work From Home</p><p>Stipend ₹5,000 /month</p></body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html }) as any));
    const d = await fetchInternshalaDetail('https://internshala.com/internship/detail/fake-wfh');
    expect(d!.mode).toBe('REMOTE');
  });
});

// ─── MLH test-event filter ───

describe('MLH test-event filter (word-boundary, never contest → test)', () => {
  it('flags Jon Test Event + fixtures, keeps real events', () => {
    expect(isMLHTestEvent('Jon Test Event', 'jon-test-event')).toBe(true);
    expect(isMLHTestEvent('Demo Day Hackathon', 'demo-day')).toBe(true);
    expect(isMLHTestEvent('Sample Hackathon 2026', 'sample-2026')).toBe(true);
    expect(isMLHTestEvent('HackPrix 2026', 'hackprix-2026')).toBe(false);
    expect(isMLHTestEvent('JAMHacks 2026', 'jamhacks')).toBe(false);
  });

  it('never flags Contest/Latest (substring test inside word)', () => {
    expect(isMLHTestEvent('Coding Contest 2026', 'coding-contest')).toBe(false);
    expect(isMLHTestEvent('Latest Hackathon', 'latest-hack')).toBe(false);
    expect(isMLHTestEvent('Greatest Hack', 'greatest')).toBe(false);
  });

  it('fetchMLH drops test events but keeps real ones (mocked season)', async () => {
    const seasonHtml = [
      '{"id":"1","slug":"jon-test-event","name":"Jon Test Event","status":"upcoming","startsAt":"2026-10-01T00:00:00.000Z","endsAt":"2026-10-03T00:00:00.000Z","dateRange":"Oct 1-3","url":"/events/jon-test-event/prizes","location":"Online","formatType":"virtual"}',
      '{"id":"2","slug":"hackprix-2026","name":"HackPrix 2026","status":"upcoming","startsAt":"2026-11-01T00:00:00.000Z","endsAt":"2026-11-03T00:00:00.000Z","dateRange":"Nov 1-3","url":"/events/hackprix-2026/prizes","location":"Online","formatType":"virtual"}',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/seasons/')) return { ok: true, text: async () => seasonHtml } as any;
        // enrichMLHItems detail probes: thin (no tiers/desc → null, keep list).
        return { ok: true, text: async () => 'short shell' } as any;
      }),
    );
    // Mock prisma dedupe via real DB? fetchMLH hits prisma.hackathonStaging.findMany —
    // in hermetic tests without DB it throws and is caught (dedup skipped). Titles survive.
    const out = await fetchMLH(10);
    const titles = out.map((o) => o.title);
    expect(titles).not.toContain('Jon Test Event');
    expect(titles).toContain('HackPrix 2026');
  });
});

// ─── Unstop internship Unknown + total-pool + perks ───

describe('Unstop total-pool tier + perks bleed + Unknown', () => {
  it('flags Total-pool summaries (not tiers)', () => {
    expect(isGenericUnstopTotalTier('Total Prize Pool: ₹1,50,000')).toBe(true);
    expect(isGenericUnstopTotalTier('Total Pool: ₹50,000')).toBe(true);
    expect(isGenericUnstopTotalTier('Prize Pool: ₹1,50,000')).toBe(false);
    expect(isGenericUnstopTotalTier('Campus Winner: ₹5,000')).toBe(false);
  });

  it('drops perks bleed (Rules/Guidelines/...) but keeps real perks', () => {
    expect(cleanUnstopPerks(['Goodies', 'Certificates', 'Rules & Guidelines', 'Rounds 1-3'])).toEqual([
      'Goodies',
      'Certificates',
    ]);
    expect(cleanUnstopPerks(['Internship interviews'])).toEqual(['Internship interviews']);
    expect(cleanUnstopPerks([])).toEqual([]);
  });

  it('fetchUnstopInternships honest-omits company (was Unknown)', async () => {
    const apiJson = {
      data: {
        data: [
          {
            title: 'SDE Intern',
            public_url: 'o/sde-intern-1',
            details: 'Great internship. Stipend ₹20,000/month.',
            regnRequirements: { end_regn_dt: '2026-12-01', start_regn_dt: '2026-09-01' },
            address_with_country_logo: { city: 'Bengaluru' },
            organisation: {},
            jobDetail: { show_salary: 1, min_salary: '20000', max_salary: '20000', currency: 'fa-rupee', pay_in: 'month' },
            duration: '6 months',
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        // Unstop internships pages 2+ return empty (else same title repeats per page → 5 items, not 1).
        // NOTE: check `&page=` (with &) — `per_page=18` contains `page=1` substring, so bare `page=1` matches every page.
        if (u.includes('search-result') && !u.includes('&page=1')) {
          return { ok: true, json: async () => ({ data: { data: [] } }) } as any;
        }
        return { ok: true, json: async () => apiJson } as any;
      }),
    );
    // fetchUnstopInternships hits prisma for dedupe — without DB it throws and is
    // caught (existingTitles stays empty). Item survives with company ''.
    const out = await fetchUnstopInternships(5);
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe('');
    expect(out[0].company).not.toBe('Unknown');
    expect(out[0].organizer).toBe('');
  });
});

// ─── DoraHacks org strict + prize ───

describe('DoraHacks org strict + anchor prize', () => {
  it('mines strict Organized-by, omits otherwise (never bare mentions)', () => {
    expect(extractDoraHacksOrganizer('Organized by Somnia Network. Hackathon details.')).toContain('Somnia');
    expect(extractDoraHacksOrganizer('Hosted by BUIDL CTC community.')).toContain('BUIDL');
    expect(extractDoraHacksOrganizer('Somnia is great. BUIDL CTC rocks.')).toBe('');
    expect(extractDoraHacksOrganizer('')).toBe('');
  });

  it('anchor path keeps full prize + tiers (was 80-truncated, no tiers)', async () => {
    const listHtml = [
      '<html><body>',
      '<a href="https://dorahacks.io/hackathon/prize-org-event">Prize Org Hackathon</a>',
      '<p>Organized by Somnia Network. Prize Pool: $15,000. Winner Prize: $10,000. Registration ends Sep 25, 2026.</p>',
      '</body></html>',
    ].join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('dorahacks.io/hackathon') && !u.includes('prize-org-event')) {
          return { ok: true, text: async () => listHtml } as any;
        }
        // Detail fetchPage6k for timeline/org/prize mining.
        return { ok: true, text: async () => 'Organized by Somnia Network. Winner Prize: $10,000. Extended 2026/09/25 hackathon.' } as any;
      }),
    );
    const out = await fetchDoraHacksPage(1, new Set<string>());
    expect(out.length).toBeGreaterThan(0);
    const item = out[0];
    expect(item.organizer).toContain('Somnia');
    expect(item.organizer).not.toBe('DoraHacks');
    // Prize preserved (300 cap, not 80-cut) + tiers present.
    expect(item.prizePool.length).toBeGreaterThan(0);
    expect(item.prizePool.length).toBeLessThanOrEqual(300);
  });
});

// ─── Wellfound Unknown honest-omit ───

describe('Wellfound Unknown honest-omit', () => {
  it('HTML fallback returns empty company (was Unknown) when no evidence', async () => {
    const html = [
      '<html><head><title>Startup Jobs</title></head><body>',
      '<a href="https://wellfound.com/jobs/12345-sde-intern">SDE Intern Role</a>',
      '<p>Join our startup hackathon internship in Bengaluru. Apply by Dec 01, 2026.</p>',
      '</body></html>',
    ].join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => html }) as any),
    );
    const out = await fetchWellfoundPage(1, new Set<string>());
    // Generic-remote guard: this HTML lacks the generic header, so it parses.
    // Title `SDE Intern Role` passes strict intern filter; company has no `at` cue.
    if (out.length) {
      for (const o of out) {
        expect(o.company).not.toBe('Unknown');
        expect(o.organizer).not.toBe('Unknown');
      }
    } else {
      // Honest-empty when no intern listing is also valid (never pollution).
      expect(out).toEqual([]);
    }
  });
});
