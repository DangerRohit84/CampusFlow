/**
 * Regression test for Devpost HIGH wart (2026-09-09 parity REPORT-devpost.md).
 * Hermetic: no DB, no live network (fetch mocked where needed).
 *
 * WART — organizer/company always '' (devpost.ts:65,73 before):
 *   `h.organizer_name` never matches live `organization_name` →
 *   proven empty for RevenueCat / Google / Amazon.
 *   Fix: live `organization_name` + legacy `organizer_name` fallback,
 *   honest-omit ('') when absent.
 * MEDIUMs (left as note, NOT fixed here):
 *   - date-midnight drop, description (tagline-only), MLH prize/desc/test-event
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractDevpostOrganizer,
  fetchDevpostPage,
} from '../src/services/opportunities/sources/devpost';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Live-API fixture: exact shapes from https://devpost.com/api/hackathons?page=1 ───
// Verified 2026-09-09: `organization_name` present, `organizer_name` absent.
const LIVE_HACKATHONS = [
  {
    id: 29969,
    title: 'RevenueCat Shipaton 2026',
    displayed_location: { icon: 'globe', location: 'Online' },
    url: 'https://revenuecat-shipaton-2026.devpost.com/',
    time_left_to_submission: '22 days left',
    submission_period_dates: 'Jul 31 - Oct 01, 2026',
    themes: [{ id: 18, name: 'Design' }],
    prize_amount: '$<span data-currency-value>740,000</span>',
    registrations_count: 24745,
    organization_name: 'RevenueCat',
    invite_only: false,
  },
  {
    id: 30721,
    title: 'Agentic Cinema: The Blockbuster Hackathon',
    displayed_location: { icon: 'globe', location: 'Online' },
    url: 'https://agentic-cinema.devpost.com/',
    time_left_to_submission: 'about 3 hours left',
    submission_period_dates: 'Jul 27 - Sep 09, 2026',
    themes: [{ id: 6, name: 'Machine Learning/AI' }],
    prize_amount: '$<span data-currency-value>75,000</span>',
    registrations_count: 10093,
    organization_name: 'Google',
    invite_only: false,
  },
  {
    id: 30317,
    title: 'Agents for Humans Hackathon',
    displayed_location: { icon: 'globe', location: 'Online' },
    url: 'https://agentsforhumans.devpost.com/',
    time_left_to_submission: '5 days left',
    submission_period_dates: 'Aug 10 - Sep 14, 2026',
    themes: [{ id: 23, name: 'Beginner Friendly' }],
    prize_amount: '$<span data-currency-value>40,000</span>',
    registrations_count: 8824,
    organization_name: 'Amazon',
    invite_only: false,
  },
];

describe('HIGH — live `organization_name` vs dead `organizer_name`', () => {
  it('parses all 3 live organizers (never empty)', () => {
    const got = LIVE_HACKATHONS.map((h) => extractDevpostOrganizer(h));
    expect(got).toEqual(['RevenueCat', 'Google', 'Amazon']);
    for (const c of got) {
      expect(c).not.toBe('');
      expect(c.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('proves the old `organizer_name` read was empty for live items (documents the bug)', () => {
    for (const h of LIVE_HACKATHONS) {
      expect((h as any).organizer_name).toBeUndefined(); // old field — always absent live
      expect((h as any).organization_name).toBeTruthy(); // new field — present live
      // Old expression evaluated to '':
      expect((h as any).organizer_name || '').toBe('');
    }
  });

  it('prefers `organization_name`, falls back to legacy `organizer_name`, honest-omits when absent', () => {
    // Both present → organization_name wins.
    expect(
      extractDevpostOrganizer({ organization_name: 'Acme', organizer_name: 'Legacy' }),
    ).toBe('Acme');
    // Legacy-only → still works (backward compat).
    expect(extractDevpostOrganizer({ organizer_name: 'Legacy Co' })).toBe('Legacy Co');
    // Honest-omit: neither → '' (never undefined/null).
    expect(extractDevpostOrganizer({})).toBe('');
    expect(extractDevpostOrganizer({ organization_name: '', organizer_name: '' })).toBe('');
    expect(extractDevpostOrganizer(null as any)).toBe('');
    expect(extractDevpostOrganizer(undefined as any)).toBe('');
    expect(extractDevpostOrganizer('RevenueCat' as any)).toBe('');
    // Non-string coerces to omit (API is string; numbers/objects are dust).
    expect(extractDevpostOrganizer({ organization_name: 123 as any })).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(extractDevpostOrganizer({ organization_name: '  Google  ' })).toBe('Google');
    expect(extractDevpostOrganizer({ organizer_name: '\tAmazon\n' })).toBe('Amazon');
  });

  it('fetchDevpostPage maps live API JSON to real organizer/company (mocked fetch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ hackathons: LIVE_HACKATHONS }),
      }) as any),
    );
    const out = await fetchDevpostPage(1, new Set<string>());
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.organizer)).toEqual(['RevenueCat', 'Google', 'Amazon']);
    expect(out.map((o) => o.company)).toEqual(['RevenueCat', 'Google', 'Amazon']);
    for (const o of out) {
      expect(o.organizer).not.toBe('');
      expect(o.company).not.toBe('');
      expect(o.source).toBe('DEVPOST');
    }
    expect(out[0].title).toBe('RevenueCat Shipaton 2026');
    expect(out[0].url).toBe('https://revenuecat-shipaton-2026.devpost.com/');
  });

  it('fetchDevpostPage honest-omits organizer/company when API carries neither (mocked)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ hackathons: [{ title: 'No Org Hack', url: 'https://x.devpost.com/' }] }),
      }) as any),
    );
    const out = await fetchDevpostPage(1, new Set<string>());
    expect(out).toHaveLength(1);
    expect(out[0].organizer).toBe('');
    expect(out[0].company).toBe('');
  });
});
