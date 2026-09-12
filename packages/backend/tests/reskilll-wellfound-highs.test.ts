/**
 * Regression tests for Reskilll + Wellfound HIGH warts (2026-09-10 fetcher_test parity).
 * Hermetic: no DB, no live network (fetch + validateExternalUrl mocked; recorded fixtures).
 *
 * HIGH R1 — Reskilll listing 404 (reskilll.ts:19):
 *   `/hackathons` returns 404 body ("Popular pages: All Hacks /allhacks").
 *   Correct path `/allhacks` carries 178 cards (live 2026-09-10: "Discover and join
 *   178 hackathons"). Fix: listing URL → `/allhacks`.
 * HIGH R2 — Reskilll link regex miss (reskilll.ts:37):
 *   `/hackathon` anchor regex matches 4 vs 161 `/hack/` links (miss 97%).
 *   Live cards: `<a class="allhackname ..." href="https://reskilll.com/hack/stepone">`,
 *   `/hack/agenticindore`, `/hack/aiopendata`, ... Fix: link predicate → live `/hack/` shape
 *   (legacy `/hackathon/` kept for compat; bare list URLs dropped).
 *
 * HIGH W1 — Wellfound intern path dead (wellfound.ts:21):
 *   `/role/r/intern` serves generic `/remote` ("Remote Tech & Startup Jobs",
 *   11564 results, pagination `/remote?page=2`, 0 intern hits; all 4 variants 0-1).
 *   Probes 2026-09-10: `/role/intern` → 404; `/role/r/internship` → generic remote;
 *   `/jobs?query=intern` → generic landing (trending jobs, 1 intern among many).
 *   No stable intern listing exists via simple GET today.
 *   Fix: fallback chain + explicit generic-remote guard → honestly return [] with
 *   logged reason instead of generic-remote pollution (never mix non-intern jobs
 *   as internships). Strict intern-word filter preserved for when the path recovers.
 *
 * MEDIUMs/LOWs + search* DDG flake left as listed (NOT fixed here).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hermetic: bypass DNS/allowlist (real validateExternalUrl does dns.lookup → live net).
vi.mock('../src/utils/secureUrl', () => ({
  validateExternalUrl: vi.fn(async (u: string) => new URL(u)),
}));

import {
  fetchReskilllPage,
  buildReskilllListingUrl,
  isReskilllHackUrl,
} from '../src/services/opportunities/sources/reskilll';
import {
  fetchWellfoundPage,
  buildWellfoundPageUrls,
  isGenericWellfoundRemotePage,
  isWellfoundInternTitle,
} from '../src/services/opportunities/sources/wellfound';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Reskilll: /allhacks fixture (trimmed live shape, 2026-09-10) ───
// Live card: <div class="... hackathonCard"><a class="allhackname eventName" href="...">Title</a>
// + Registration Start/End dates nearby. Internal links use /hack/<slug>; legacy /hackathon/<slug> kept.
const RESKILLL_ALLHACKS_HTML = [
  '<html><head><title>Hackathons - Find & Join Online Hackathons in India | Reskilll</title></head><body>',
  '<p>Discover and join 178 hackathons</p>',
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName text-decoration-none" href="https://reskilll.com/hack/stepone" target="_blank">StepOne AI Engine Buildathon</a>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2027-04-20</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2027-05-02</div>',
  '</div>',
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName text-decoration-none" href="/hack/agenticindore" target="_blank">Agentic AI Hackathon</a>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2027-04-09</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2027-04-22</div>',
  '</div>',
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName text-decoration-none" href="https://reskilll.com/hack/aiopendata" target="_blank">AI for All Challenge</a>',
  '<div class="hackregisterdatehead">Registration Start:</div><div class="hackresgiterdate">2027-01-05</div>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2027-01-23</div>',
  '</div>',
  // Legacy shape (kept for compat — old regex matched only these).
  '<div class="col-12 col-lg-3 col-md-6 py-3 hackathonCard">',
  '<a class="allhackname eventName text-decoration-none" href="https://reskilll.com/hackathon/legacy-event" target="_blank">Legacy Hackathon Classic</a>',
  '<div class="hackregisterdatehead">Registration End:</div><div class="hackresgiterdate">2027-06-01</div>',
  '</div>',
  // Nav noise (must never become items).
  '<a href="/blogs">Blogs</a><a href="/login">Sign in</a>',
  '</body></html>',
].join('\n');

describe('HIGH R1 — Reskilll listing URL is /allhacks (never /hackathons 404)', () => {
  it('builds page-1 and paged URLs on /allhacks', () => {
    expect(buildReskilllListingUrl(1)).toBe('https://reskilll.com/allhacks');
    expect(buildReskilllListingUrl(2)).toBe('https://reskilll.com/allhacks?page=2');
    for (const p of [1, 2, 3]) {
      expect(buildReskilllListingUrl(p)).not.toContain('/hackathons');
      expect(buildReskilllListingUrl(p)).toContain('/allhacks');
    }
  });

  it('fetchReskilllPage hits /allhacks (mocked fetch asserts URL)', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        seenUrls.push(String(url));
        return { ok: true, text: async () => RESKILLL_ALLHACKS_HTML } as any;
      }),
    );
    const out = await fetchReskilllPage(1, new Set<string>());
    expect(out.length).toBeGreaterThan(0);
    expect(seenUrls.length).toBeGreaterThan(0);
    for (const u of seenUrls) {
      if (u.includes('reskilll.com') && !u.includes('fetchPage6k')) {
        expect(u).toContain('/allhacks');
        expect(u).not.toContain('/hackathons');
      }
    }
  });
});

describe('HIGH R2 — Reskilll link predicate matches live /hack/ shape', () => {
  it('accepts live /hack/<slug> links', () => {
    expect(isReskilllHackUrl('https://reskilll.com/hack/stepone')).toBe(true);
    expect(isReskilllHackUrl('/hack/agenticindore')).toBe(true);
    expect(isReskilllHackUrl('https://reskilll.com/hack/aiopendata')).toBe(true);
  });

  it('keeps legacy /hackathon/<slug> working (backward compat)', () => {
    expect(isReskilllHackUrl('https://reskilll.com/hackathon/legacy-event')).toBe(true);
  });

  it('drops bare list URLs, nav, and garbage (never emit)', () => {
    expect(isReskilllHackUrl('https://reskilll.com/allhacks')).toBe(false);
    expect(isReskilllHackUrl('https://reskilll.com/hackathons')).toBe(false);
    expect(isReskilllHackUrl('https://reskilll.com/hack/')).toBe(false);
    expect(isReskilllHackUrl('https://reskilll.com/blogs')).toBe(false);
    expect(isReskilllHackUrl('')).toBe(false);
    expect(isReskilllHackUrl(null as any)).toBe(false);
  });

  it('proves the old /hackathon-only regex missed live /hack/ links (documents the bug)', () => {
    const oldRe = /\/hackathon/;
    for (const u of ['https://reskilll.com/hack/stepone', '/hack/agenticindore', 'https://reskilll.com/hack/aiopendata']) {
      expect(oldRe.test(u)).toBe(false); // old predicate — always false live (97% miss)
      expect(isReskilllHackUrl(u)).toBe(true); // new predicate — true live
    }
  });

  it('fetchReskilllPage parses /allhacks fixture (live /hack/ cards become items)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        // Listing fetch → fixture. Per-item fetchPage6k probes → short (no extra deadline).
        if (u.includes('reskilll.com/hack/') || u.includes('reskilll.com/hackathon/')) {
          return { ok: true, text: async () => 'short' } as any;
        }
        return { ok: true, text: async () => RESKILLL_ALLHACKS_HTML } as any;
      }),
    );
    const out = await fetchReskilllPage(1, new Set<string>());
    const urls = out.map((o) => o.url);
    // All three live /hack/ cards + legacy compat = 4 items (nav dropped).
    expect(out).toHaveLength(4);
    expect(urls).toContain('https://reskilll.com/hack/stepone');
    expect(urls).toContain('https://reskilll.com/hack/agenticindore');
    expect(urls).toContain('https://reskilll.com/hack/aiopendata');
    for (const o of out) {
      expect(o.source).toBe('OTHER_HACKATHON');
      expect(o.organizer).toBe('Reskilll');
      expect(o.type).toBe('HACKATHON');
    }
  });
});

// ─── Wellfound fixtures ───

// Recorded generic-remote shape (live /role/r/intern 2026-09-10):
// title "Remote Tech & Startup Jobs", "11564 results total", pagination /remote?page=2,
// job anchors WITHOUT intern in title/slug.
const WELLFOUND_GENERIC_REMOTE_HTML = [
  '<html><head><title>Remote Tech & Startup Jobs | Wellfound</title></head><body>',
  '<h1>Remote Tech & Startup Jobs</h1><h4>11564 results total</h4>',
  '<a href="/jobs/3938944-design-engineer-site">Design Engineer, Site</a><span>Full-time $100k - $180k Remote only</span>',
  '<a href="/jobs/3325019-full-stack-engineer">Full Stack Engineer</a><span>Full-time $100k - $180k Onsite or remote</span>',
  '<a href="/remote?page=2">2</a><a href="/remote?page=3">3</a>',
  '</body></html>',
].join('\n');

// Recorded intern shape (hermetic stand-in for a recovered intern listing):
// __NEXT_DATA__ apolloState with 2 intern JobListings + matching /jobs/ anchors.
const WELLFOUND_INTERN_HTML = [
  '<html><head><title>Internships | Wellfound</title></head><body>',
  '<script id="__NEXT_DATA__" type="application/json">',
  JSON.stringify({
    props: {
      pageProps: {
        apolloState: {
          data: {
            'JobListingSearchResult:1': { title: 'Software Engineer Intern', slug: 'software-engineer-intern-at-acme-123', compensation: '$30 - $40 per hour', startup: { __ref: 'Startup:1' } },
            'JobListingSearchResult:2': { title: 'Product Design Intern', slug: 'product-design-intern-at-beta-456', compensation: '$25 per hour', startup: { __ref: 'Startup:2' } },
            'Startup:1': { name: 'Acme' },
            'Startup:2': { name: 'Beta Labs' },
          },
        },
      },
    },
  }),
  '</script>',
  '<a href="/jobs/111-software-engineer-intern-at-acme-123">Software Engineer Intern at Acme</a>',
  '<a href="/jobs/222-product-design-intern-at-beta-456">Product Design Intern at Beta Labs</a>',
  '</body></html>',
].join('\n');

describe('HIGH W1 — Wellfound fallback chain + generic-remote guard', () => {
  it('exposes a fallback chain (never a single dead URL)', () => {
    const urls = buildWellfoundPageUrls(1);
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) {
      expect(u).toContain('wellfound.com');
    }
    // Primary stays the canonical intern path (recovery-ready); chain never leads with bare /remote.
    expect(urls[0]).toContain('intern');
    expect(urls[0]).not.toBe('https://wellfound.com/remote');
  });

  it('detects generic-remote pollution pages (live /role/r/intern shape)', () => {
    expect(isGenericWellfoundRemotePage(WELLFOUND_GENERIC_REMOTE_HTML)).toBe(true);
    expect(isGenericWellfoundRemotePage(WELLFOUND_INTERN_HTML)).toBe(false);
    expect(isGenericWellfoundRemotePage('')).toBe(false);
    expect(isGenericWellfoundRemotePage(null as any)).toBe(false);
  });

  it('strict intern-word check never confuses senior/full-time roles for internships', () => {
    expect(isWellfoundInternTitle('Software Engineer Intern')).toBe(true);
    expect(isWellfoundInternTitle('Product Design Intern at Beta Labs')).toBe(true);
    expect(isWellfoundInternTitle('software-engineer-intern-at-acme-123')).toBe(true);
    expect(isWellfoundInternTitle('Design Engineer, Site')).toBe(false);
    expect(isWellfoundInternTitle('Full Stack Engineer')).toBe(false);
    expect(isWellfoundInternTitle('International Sales Manager')).toBe(false);
    expect(isWellfoundInternTitle('')).toBe(false);
  });

  it('honestly returns [] for generic-remote pages (never mixes non-intern jobs)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => WELLFOUND_GENERIC_REMOTE_HTML }) as any),
    );
    const out = await fetchWellfoundPage(1, new Set<string>());
    expect(out).toEqual([]);
    // No pollution: even though the page carries 2 /jobs/ anchors, none leak as internships.
    expect(out).toHaveLength(0);
  });

  it('yields real internships when the listing carries intern evidence (mocked recovery)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => WELLFOUND_INTERN_HTML }) as any),
    );
    const out = await fetchWellfoundPage(1, new Set<string>());
    expect(out).toHaveLength(2);
    for (const o of out) {
      expect(o.source).toBe('WELLFOUND');
      expect(o.type).toBe('INTERNSHIP');
      expect(`${o.title} ${o.url}`.toLowerCase()).toContain('intern');
    }
    const titles = out.map((o) => o.title);
    expect(titles.join(' | ')).toMatch(/Software Engineer Intern/);
    expect(titles.join(' | ')).toMatch(/Product Design Intern/);
  });
});
