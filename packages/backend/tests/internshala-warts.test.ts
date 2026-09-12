/**
 * Regression tests for Internshala HIGH warts (2026-09-09 parity REPORT-internshala.md).
 * Hermetic: no DB, no live network (fetch mocked where needed).
 *
 * WART 1 — company always `Unknown` (internshala.ts:44-46):
 *   `includes('/at-')` never matches live `-at-` slugs → proven false + split→undefined.
 *   Fix: live `-at-` slug parse + explicit org-field fallback, honest-omit ('') when absent.
 * WART 2 — stipend `₹599` popup bleed (internshala.ts:189):
 *   fallback `html.match(/₹.../)` grabbed FIRST ₹ on page (AI Career Guide popup).
 *   Fix: salary-block scoping + modal/popup ignore + honest-omit.
 * MEDIUMs (low-risk parts, same pass):
 *   - multi-location `jobLocation[]` join (was [0]-only)
 *   - detail JD → description via cleanDescription
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractCompanyFromInternshalaUrl,
  extractInternshalaCompany,
  extractInternshalaStipend,
  extractInternshalaLocations,
  fetchInternshalaPage,
  fetchInternshalaDetail,
} from '../src/services/opportunities/sources/internshala';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Live-slug fixture: exact 5 detail URLs from evidence A.json (20260909-222002) ───
const LIVE_URLS = [
  'https://internshala.com/internship/detail/corporate-sales-internship-in-mumbai-at-scalar-tech-media1788759455',
  'https://internshala.com/internship/detail/content-and-social-media-marketing-internship-in-multiple-locations-at-tgb-collective1788319697',
  'https://internshala.com/internship/detail/sales-and-marketing-internship-in-delhi-at-maximyz-cloud1786620767',
  'https://internshala.com/internship/detail/business-development-sales-female-internship-in-mumbai-at-online-eduversity1788407951',
  'https://internshala.com/internship/detail/human-resources-hr-internship-in-multiple-locations-at-absolute-people-screen-private-limited1788935703',
];

describe('WART 1 — live `-at-` slug company parsing', () => {
  it('parses all 5 live slugs (never Unknown)', () => {
    const got = LIVE_URLS.map((u) => extractCompanyFromInternshalaUrl(u));
    for (const c of got) {
      expect(c).not.toBe('Unknown');
      expect(c).not.toBe('');
      expect(c.length).toBeGreaterThanOrEqual(3);
    }
    // Exact expectations (Title-Case; TGB acronym normalizes to Tgb — still identified).
    expect(got[0]).toBe('Scalar Tech Media');
    expect(got[1].toLowerCase()).toBe('tgb collective');
    expect(got[2]).toBe('Maximyz Cloud');
    expect(got[3]).toBe('Online Eduversity');
    expect(got[4]).toBe('Absolute People Screen Private Limited');
  });

  it('proves the old `/at-` check was false for live URLs (documents the bug)', () => {
    for (const u of LIVE_URLS) {
      expect(u.includes('/at-')).toBe(false); // old predicate — always false live
      expect(u.split('/at-')[1]).toBeUndefined(); // old split — always undefined live
      expect(u.includes('-at-')).toBe(true); // new predicate — true live
    }
  });

  it('prefers explicit org fields over slug, honest-omits when truly absent', () => {
    // Explicit hiringOrganization wins (even if slug differs).
    expect(
      extractInternshalaCompany(
        { name: 'X - Internship', url: LIVE_URLS[0], hiringOrganization: { name: 'Acme Corp' } },
        LIVE_URLS[0],
      ),
    ).toBe('Acme Corp');
    expect(
      extractInternshalaCompany({ name: 'X', company: 'Beta Labs' }, LIVE_URLS[0]),
    ).toBe('Beta Labs');
    // Unwraps ListItem { item: {...} } shapes.
    expect(
      extractInternshalaCompany(
        { item: { name: 'X - Internship', url: LIVE_URLS[2] } },
        '',
      ),
    ).toBe('Maximyz Cloud');
    // Honest-omit: no org field, no -at- slug → '' (never 'Unknown').
    expect(extractInternshalaCompany({ name: 'Solo Role - Internship' }, 'https://internshala.com/internship/detail/no-company-here')).toBe('');
    expect(extractInternshalaCompany({ name: '' }, '')).toBe('');
    expect(extractCompanyFromInternshalaUrl('https://example.com/internship/detail/no-company-here')).toBe('');
    expect(extractCompanyFromInternshalaUrl('')).toBe('');
    expect(extractCompanyFromInternshalaUrl(null as any)).toBe('');
  });

  it('keeps legacy `/at-` shape working (backward compat)', () => {
    expect(extractCompanyFromInternshalaUrl('https://internshala.com/internships/at-acme-corp123')).toBe(
      'Acme Corp',
    );
  });

  it('fetchInternshalaPage maps live ItemList to real companies (mocked fetch)', async () => {
    const itemList = {
      '@type': 'ItemList',
      itemListElement: LIVE_URLS.map((url, i) => ({ name: `Role ${i} - Internship`, url })),
    };
    const html = `<script type="application/ld+json">${JSON.stringify(itemList)}</script>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => html }) as any),
    );
    const out = await fetchInternshalaPage(1, new Set<string>());
    expect(out).toHaveLength(5);
    for (const o of out) {
      expect(o.company).not.toBe('Unknown');
      expect(o.organizer).not.toBe('Unknown');
      expect(o.company).not.toBe('');
    }
    expect(out[0].company).toBe('Scalar Tech Media');
    expect(out[0].role).toBe('Role 0');
  });
});

// ─── Modal-bleed fixture: popup ₹599 precedes the real salary block ───
const MODAL_BLEED_HTML = `
<html><head><title>Content and Social Media Marketing Internship</title>
<script type="application/ld+json">{"@type":"WebPage"}</script>
<style>.subscription-popup{display:block}</style>
</head><body>
<div class="subscription-popup modal-overlay">
  <p>Sign up now to unlock</p>
  <p>FREE AI Career Guide worth \u20B9599</p>
  <button>Sign up with Google</button>
  <a>Sign up with Email</a>
</div>
<div class="internship-details">
  <div class="stipend-container"><span>Stipend</span><span>\u20B9 5,000 - 10,000 /month</span></div>
  <div class="duration">6 Months</div>
</div>
</body></html>
`.trim();

const POPUP_ONLY_HTML = `
<html><body>
<div class="subscription-popup modal"><p>Sign up now to unlock FREE AI Career Guide worth \u20B9599</p></div>
<div class="internship-details"><p>No stipend listed here</p></div>
</body></html>
`.trim();

describe('WART 2 — stipend modal/popup bleed', () => {
  it('returns the salary-block stipend, not the \u20B9599 popup (live bleed shape)', () => {
    // Old code: html.match(/\u20B9\\s*[\\d,]+.../) → "\u20B9599" (first ₹ on page). Prove it:
    const oldFirstRupee = MODAL_BLEED_HTML.match(/\u20B9\s*[\d,]+(?:\s*-\s*\u20B9?\s*[\d,]+)?/)?.[0];
    expect(oldFirstRupee).toBe('\u20B9599');
    // New code scopes to the salary block:
    const fixed = extractInternshalaStipend(MODAL_BLEED_HTML);
    expect(fixed).not.toBe('\u20B9599');
    expect(fixed).toMatch(/\u20B9/);
    expect(fixed.replace(/,/g, '')).toMatch(/5000/);
    expect(fixed.replace(/,/g, '')).toMatch(/10000/);
    expect(fixed.toLowerCase()).toMatch(/month/);
  });

  it('honest-omits when only the popup exists (never first-\u20B9-on-page)', () => {
    expect(extractInternshalaStipend(POPUP_ONLY_HTML)).toBe('');
    expect(extractInternshalaStipend('')).toBe('');
    expect(extractInternshalaStipend(null as any)).toBe('');
  });

  it('ignores \u20B9 inside script/style tags', () => {
    const html = `<script>var price="\u20B9599";</script><style>.x:after{content:"\u20B91"}</style><div><span>Salary</span> \u20B9 11,000 - 14,000 /month</div>`;
    const got = extractInternshalaStipend(html);
    expect(got.replace(/,/g, '')).toMatch(/11000/);
  });

  it('fetchInternshalaDetail fallback never returns \u20B9599 (mocked detail without JobPosting)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => MODAL_BLEED_HTML }) as any),
    );
    const d = await fetchInternshalaDetail('https://internshala.com/internship/detail/fake-no-jobposting');
    expect(d).not.toBeNull();
    expect(d!.stipend).not.toBe('\u20B9599');
    expect(d!.stipend.toLowerCase()).toMatch(/month/);
  });

  it('fetchInternshalaDetail fallback honest-omits popup-only pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => POPUP_ONLY_HTML }) as any),
    );
    const d = await fetchInternshalaDetail('https://internshala.com/internship/detail/fake-popup-only');
    expect(d).not.toBeNull();
    expect(d!.stipend).toBe('');
  });
});

describe('MEDIUMs — multi-location join + JD description (low-risk parts)', () => {
  it('joins all jobLocation[] (single-entry stays "Locality, Region")', () => {
    expect(
      extractInternshalaLocations([
        { address: { addressLocality: 'Mumbai', addressRegion: 'Maharashtra' } },
      ]),
    ).toBe('Mumbai, Maharashtra');
    const multi = extractInternshalaLocations([
      { address: { addressLocality: 'Chandigarh', addressRegion: '' } },
      { address: { addressLocality: 'Mohali', addressRegion: '' } },
      { address: { addressLocality: 'Zirakpur', addressRegion: '' } },
      { address: { addressLocality: 'Panchkula', addressRegion: '' } },
    ]);
    for (const city of ['Chandigarh', 'Mohali', 'Zirakpur', 'Panchkula']) {
      expect(multi).toContain(city);
    }
    // Single-object (non-array) shape + dedupe + empty → ''.
    expect(
      extractInternshalaLocations({ address: { addressLocality: 'Delhi', addressRegion: 'Delhi' } }),
    ).toBe('Delhi, Delhi');
    expect(extractInternshalaLocations([])).toBe('');
    expect(extractInternshalaLocations(null as any)).toBe('');
  });

  it('fetchInternshalaDetail maps JobPosting description + multi-location (mocked)', async () => {
    const jobPosting = {
      '@type': 'JobPosting',
      title: 'Content and Social Media Marketing',
      validThrough: '2026-10-07 23:59:59',
      datePosted: '2026-09-07',
      baseSalary: { value: { minValue: 5000, maxValue: 10000, unitText: 'MONTH' } },
      jobLocation: [
        { address: { addressLocality: 'Chandigarh', addressRegion: '' } },
        { address: { addressLocality: 'Mohali', addressRegion: '' } },
      ],
      description:
        '<p>1. Manage brand social media accounts 2. Create Reels, posts, stories and campaigns</p>',
    };
    const html = `<script type="application/ld+json">${JSON.stringify(jobPosting)}</script><div>6 Months</div>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => html }) as any),
    );
    const d = await fetchInternshalaDetail('https://internshala.com/internship/detail/fake-jd');
    expect(d).not.toBeNull();
    expect(d!.location).toContain('Chandigarh');
    expect(d!.location).toContain('Mohali');
    expect(d!.description.length).toBeGreaterThan(20);
    expect(d!.description).toContain('Reels');
    expect(d!.description.length).toBeLessThanOrEqual(2000);
  });
});
