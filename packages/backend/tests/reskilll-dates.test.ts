/**
 * Regression tests for Reskilll year-bump fabrication (QA re-run 2026-09-10).
 * Hermetic: no DB, no live network (fetch + validateExternalUrl mocked).
 *
 * QA finding: all 6 emitted items were PAST events with fake future deadlines
 * (hackaryaverse true 2025-04-27 shown as 2026-09-11, codeher true 2024-12-22
 * shown as 2026-12-14). Root causes:
 *  1) Listing Registration End is ISO YYYY-MM-DD (invisible to the generic
 *     month-name extractor) → deadline fell through to detail bare month-day
 *     fragments (`December 14` without year → chrono current-year default →
 *     2026-12-14 future) — year-bump fabrication.
 *  2) `hasRegistrationClosedIndicator` was imported but never checked — past
 *     cards/badges (`Registration Closed`) were never dropped.
 *  3) Subdomain microsites (`*.reskilll.com` roots — the only 2 truly-live:
 *     iQOO 2026-09-27, Health-a-thon 2026-09-28) were missed (no /hack/ path).
 *
 * Fix under test (reskilll.ts + shared details.ts helpers):
 *  - ISO-first (`extractISORegistrationEnd`): keep TRUE parsed date, never roll
 *    past into future; past ISO → isEnded drops.
 *  - Closed-badge guard (`hasReskilllClosedBadge`, tight own-card window):
 *    drop past immediately, never fabricate.
 *  - Subdomain predicate + broadened anchor regex: cover live microsites.
 *
 * Live shapes (trimmed, 2026-09-10 webfetch):
 *  - Listing cards: title link + Registration Start/End ISO + optional
 *    `Registration Closed` badge.
 *  - Detail /hack/<slug>: `Last date to Register Sun Apr 27 2025` /
 *    `Sun Dec 22 2024` + `Registration Closed` + trap `Grand Finale on
 *    December 14` (bare month-day, no year — must never become 2026-12-14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hermetic: bypass DNS/allowlist (real validateExternalUrl does dns.lookup → live net).
vi.mock('../src/utils/secureUrl', () => ({
  validateExternalUrl: vi.fn(async (u: string) => new URL(u)),
}));

import {
  fetchReskilllPage,
  isReskilllHackUrl,
} from '../src/services/opportunities/sources/reskilll';
import {
  extractISORegistrationEnd,
  hasReskilllClosedBadge,
} from '../src/services/opportunities/sources/details';
import { inferDeadlineFromTitle, isEnded } from '../src/services/opportunities/dates';
import { parseSearchDate } from '../src/utils/search';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Listing fixture: 2 past (closed, past ISO) + 2 live microsites (future ISO, no badge) ───
const LISTING_PAST_PLUS_LIVE_HTML = [
  '<html><head><title>Hackathons | Reskilll</title></head><body>',
  '<p>Discover and join 178 hackathons</p>',
  // Live microsite 1 (no Closed badge — must be kept).
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName" href="https://iqoo.reskilll.com/" target="_blank">iQOO Hackathon 2026 - City Battles</a>',
  '<p>Four battlegrounds. One national title</p>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2026-08-29</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2026-09-27</div>',
  '<a href="https://iqoo.reskilll.com/">Register Now</a>',
  '</div>',
  // Live microsite 2 (no Closed badge — must be kept).
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName" href="https://healthathon.reskilll.com/" target="_blank">Health-a-thon 2026</a>',
  '<p>Doctors & Technologists Co-creating AI Solutions</p>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2026-08-01</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2026-09-28</div>',
  '<a href="https://healthathon.reskilll.com/">Register Now</a>',
  '</div>',
  // Past 1: HACK ARYA VERSE (true 2025-04-27, closed — must be dropped, never 2026-09-11).
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName" href="https://reskilll.com/hack/hackaryaverse" target="_blank">HACK ARYA VERSE</a>',
  '<p>Join forces with elite agents</p>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2025-04-24</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2025-04-27</div>',
  'Registration Closed',
  '</div>',
  // Past 2: Code; Without Barriers (true 2024-12-22, closed — must be dropped, never 2026-12-14).
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName" href="https://reskilll.com/hack/codeher" target="_blank">Code; Without Barriers Hackathon</a>',
  '<p>Virtual all-girls hackathon</p>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2024-12-01</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2024-12-22</div>',
  'Registration Closed',
  '</div>',
  '<a href="/blogs">Blogs</a><a href="/login">Sign in</a>',
  '</body></html>',
].join('\n');

// ─── Detail fixtures (authoritative past dates + closed badge + bare-date trap) ───
const DETAIL_HACKARYAVERSE = [
  'HACK ARYA VERSE Last date to Register Sun Apr 27 2025 Registration Closed',
  'Arya College of Engineering offline Hackathon 1 - 4 Team Members',
  'Schedule 24 Apr 2025 Registrations Open Sat Apr 26 2025 Hackathon Begin',
  'Sun Apr 27 2025 Hackathon Close Sun Apr 27 2025 Registrations Close',
  'Full Schedule 1-June 2020 Registration Opens 2020 Copyright Reskilll',
].join(' ');

const DETAIL_CODEHER = [
  'Code Without Barriers Hackathon Last date to Register Sun Dec 22 2024 Registration Closed',
  'Top 10 ideas will advance to the Grand Finale on December 14 where finalists pitch',
  'Schedule 1 Dec 2024 Registrations Open Sun Dec 22 2024 Idea Submission Close',
  'Sun Dec 22 2024 Registrations Close Tue Dec 24 2024 Final Pitch Round',
].join(' ');

describe('shared ISO helper keeps TRUE past dates (never rolls into future)', () => {
  it('extracts past Registration End ISO verbatim (hackaryaverse 2025-04-27)', () => {
    const win =
      'Registration Start: 2025-04-24 Registration End: 2025-04-27 Registration Closed';
    expect(extractISORegistrationEnd(win)).toBe('2025-04-27');
  });

  it('extracts past Registration End ISO verbatim (codeher 2024-12-22)', () => {
    const win =
      'Registration Start: 2024-12-01 Registration End: 2024-12-22 Registration Closed';
    expect(extractISORegistrationEnd(win)).toBe('2024-12-22');
  });

  it('extracts future live ISO verbatim (iQOO 2026-09-27, Health-a-thon 2026-09-28)', () => {
    expect(
      extractISORegistrationEnd(
        'Registration Start: 2026-08-29 Registration End: 2026-09-27',
      ),
    ).toBe('2026-09-27');
    expect(
      extractISORegistrationEnd(
        'Registration Start: 2026-08-01 Registration End: 2026-09-28',
      ),
    ).toBe('2026-09-28');
  });

  it('prefers Registration End over Begin (Cognition rule for ISO)', () => {
    // Month-name without ISO → '' (this helper is ISO-only, never invents).
    expect(extractISORegistrationEnd('Registrations begin 22 Aug Registrations end 11 Sep')).toBe('');
    // ISO pair → End wins (latest + End context).
    expect(
      extractISORegistrationEnd(
        'Registration Start: 2025-04-24 Registration End: 2025-04-27',
      ),
    ).toBe('2025-04-27');
    expect(
      extractISORegistrationEnd(
        'Registrations begin 2026-08-22 Registrations end 2026-09-11',
      ),
    ).toBe('2026-09-11');
  });

  it('omits absent (never invents)', () => {
    expect(extractISORegistrationEnd('')).toBe('');
    expect(extractISORegistrationEnd('no dates here')).toBe('');
    expect(extractISORegistrationEnd(null as any)).toBe('');
  });
});

describe('closed-badge guard marks past (never future)', () => {
  it('detects Registration Closed (case-insensitive)', () => {
    expect(hasReskilllClosedBadge('Registration Closed')).toBe(true);
    expect(hasReskilllClosedBadge('registration closed')).toBe(true);
    expect(hasReskilllClosedBadge(DETAIL_HACKARYAVERSE)).toBe(true);
    expect(hasReskilllClosedBadge(DETAIL_CODEHER)).toBe(true);
  });

  it('is false for live cards/details (no badge)', () => {
    expect(
      hasReskilllClosedBadge(
        'Registration Start: 2026-08-29 Registration End: 2026-09-27 Register Now',
      ),
    ).toBe(false);
    expect(hasReskilllClosedBadge('')).toBe(false);
    expect(hasReskilllClosedBadge(null as any)).toBe(false);
  });
});

describe('year-bump vectors stay locked (documents the bug, guards the fix)', () => {
  it('bare month-day without year defaults to current year (the fabrication vector)', () => {
    // `December 14` (codeher finale, no year) → current-year future.
    // This is WHY detail fallback fabricated 2026-12-14: chrono/date-fns fill
    // missing year with current year. Our reskilll path never uses bare dates
    // for closed past events (ISO + closed guard first).
    const y = new Date().getFullYear();
    expect(parseSearchDate('December 14')).toBe(`${y}-12-14`);
  });

  it('inferDeadlineFromTitle never returns future (past → Dec-31 past, else omit)', () => {
    const y = new Date().getFullYear();
    // Past-year title → past Dec-31 (filtered by isEnded below, never live).
    expect(inferDeadlineFromTitle(`Foo ${y - 1}`)).toBe(`${y - 1}-12-31`);
    expect(isEnded(`${y - 1}-12-31`, `Foo ${y - 1}`)).toBe(true);
    // No year → honest-omit (never invented future).
    expect(inferDeadlineFromTitle('HACK ARYA VERSE')).toBe('');
    expect(inferDeadlineFromTitle('Code; Without Barriers Hackathon')).toBe('');
  });

  it('true past ISO dates are ended (dropped, never future)', () => {
    expect(isEnded('2025-04-27', 'HACK ARYA VERSE')).toBe(true);
    expect(isEnded('2024-12-22', 'Code; Without Barriers Hackathon')).toBe(true);
    // Live futures are not ended.
    expect(isEnded('2026-09-27', 'iQOO Hackathon 2026 - City Battles')).toBe(false);
    expect(isEnded('2026-09-28', 'Health-a-thon 2026')).toBe(false);
  });
});

describe('subdomain microsites are covered (the 2 truly-live)', () => {
  it('accepts *.reskilll.com event roots (iqoo, healthathon, console/events)', () => {
    expect(isReskilllHackUrl('https://iqoo.reskilll.com/')).toBe(true);
    expect(isReskilllHackUrl('https://healthathon.reskilll.com/')).toBe(true);
    expect(
      isReskilllHackUrl('https://console.reskilll.com/events/the-build-camp'),
    ).toBe(true);
  });

  it('keeps main-site /hack/ + legacy compat, drops bare/nav', () => {
    expect(isReskilllHackUrl('https://reskilll.com/hack/stepone')).toBe(true);
    expect(
      isReskilllHackUrl('https://reskilll.com/hackathon/legacy-event'),
    ).toBe(true);
    expect(isReskilllHackUrl('https://reskilll.com/allhacks')).toBe(false);
    expect(isReskilllHackUrl('https://reskilll.com/hack/')).toBe(false);
  });
});

describe('fetchReskilllPage drops past fixtures, keeps live microsites', () => {
  function stubFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/hack/hackaryaverse'))
          return { ok: true, text: async () => DETAIL_HACKARYAVERSE } as any;
        if (u.includes('/hack/codeher'))
          return { ok: true, text: async () => DETAIL_CODEHER } as any;
        if (u.includes('iqoo.reskilll.com') || u.includes('healthathon.reskilll.com'))
          return {
            ok: true,
            text: async () =>
              'Microsite Register Now Registration Start: 2026-08-01 Registration End: 2026-09-28',
          } as any;
        return { ok: true, text: async () => LISTING_PAST_PLUS_LIVE_HTML } as any;
      }),
    );
  }

  it('emits ONLY the 2 live microsites with TRUE future deadlines (never fake)', async () => {
    stubFetch();
    const out = await fetchReskilllPage(1, new Set<string>());
    const urls = out.map((o) => o.url);
    // Past fixtures excluded (true past dates, never future-fabricated).
    expect(urls).not.toContain('https://reskilll.com/hack/hackaryaverse');
    expect(urls).not.toContain('https://reskilll.com/hack/codeher');
    // Live microsites kept.
    expect(urls).toContain('https://iqoo.reskilll.com/');
    expect(urls).toContain('https://healthathon.reskilll.com/');
    expect(out).toHaveLength(2);
    const byUrl = new Map(out.map((o) => [o.url, o]));
    expect(byUrl.get('https://iqoo.reskilll.com/')?.deadline).toBe('2026-09-27');
    expect(byUrl.get('https://healthathon.reskilll.com/')?.deadline).toBe(
      '2026-09-28',
    );
    // Never the QA fake futures.
    for (const o of out) {
      expect(o.deadline).not.toBe('2026-09-11');
      expect(o.deadline).not.toBe('2026-12-14');
    }
    for (const o of out) {
      expect(o.source).toBe('OTHER_HACKATHON');
      expect(o.organizer).toBe('Reskilll');
    }
  });

  it('past-only listing yields [] honestly (never emits ended as live)', async () => {
    const pastOnly = [
      '<html><body>',
      '<div class="hackathonCard">',
      '<a href="https://reskilll.com/hack/hackaryaverse">HACK ARYA VERSE</a>',
      'Registration Start: 2025-04-24 Registration End: 2025-04-27 Registration Closed',
      '</div>',
      '<div class="hackathonCard">',
      '<a href="https://reskilll.com/hack/codeher">Code; Without Barriers Hackathon</a>',
      'Registration Start: 2024-12-01 Registration End: 2024-12-22 Registration Closed',
      '</div>',
      '</body></html>',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/hack/hackaryaverse'))
          return { ok: true, text: async () => DETAIL_HACKARYAVERSE } as any;
        if (u.includes('/hack/codeher'))
          return { ok: true, text: async () => DETAIL_CODEHER } as any;
        return { ok: true, text: async () => pastOnly } as any;
      }),
    );
    const out = await fetchReskilllPage(1, new Set<string>());
    expect(out).toEqual([]);
  });
});
