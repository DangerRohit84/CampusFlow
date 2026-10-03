/**
 * Paste-links source (superadmin) — TDD RED.
 * Covers: multiline/bulk parse, dedup, type split, SSRF block, max cap, staging separate.
 * Hermetic: pure fns only, no network/DB (SSRF private-IP paths need no DNS).
 */
import { describe, it, expect } from 'vitest';
import {
  PASTE_LINK_HACKATHON_SOURCE,
  PASTE_LINK_INTERNSHIP_SOURCE,
  PASTE_LINKS_MAX_URLS,
  parsePasteLinksInput,
  normalizePasteUrlForDedup,
  dedupPasteUrls,
  validatePasteLinksPayload,
  buildPasteLinkOpportunity,
} from '../src/services/opportunities/sources/pasteLinks';
import { validatePublicUrl } from '../src/utils/secureUrl';

describe('paste-links parse (single + bulk)', () => {
  it('parses single URL', () => {
    expect(parsePasteLinksInput('https://example.com/hack')).toEqual(['https://example.com/hack']);
  });

  it('splits multiline + comma + space, trims, drops empties', () => {
    const raw = `https://a.com/x, https://b.com/y
https://c.com/z   https://d.com/w,,

https://e.com/v`;
    expect(parsePasteLinksInput(raw)).toEqual([
      'https://a.com/x',
      'https://b.com/y',
      'https://c.com/z',
      'https://d.com/w',
      'https://e.com/v',
    ]);
  });

  it('accepts string[] array input too', () => {
    expect(parsePasteLinksInput(['https://a.com/1', ' https://b.com/2 ', ''])).toEqual([
      'https://a.com/1',
      'https://b.com/2',
    ]);
  });

  it('dedups case-insensitive + trailing slash', () => {
    const out = parsePasteLinksInput('https://A.com/X/\nhttps://a.com/x\nhttps://a.com/x/');
    expect(out).toEqual(['https://A.com/X/']);
  });
});

describe('paste-links normalize/dedup', () => {
  it('normalize lowercases host + strips trailing slash + fragment', () => {
    expect(normalizePasteUrlForDedup('https://Example.COM/Path/')).toBe('https://example.com/path');
    expect(normalizePasteUrlForDedup('https://example.com/path#section')).toBe(
      'https://example.com/path',
    );
  });

  it('dedupPasteUrls keeps first-seen order', () => {
    expect(dedupPasteUrls(['https://a.com/1', 'https://a.com/1/', 'https://b.com/2'])).toEqual([
      'https://a.com/1',
      'https://b.com/2',
    ]);
  });
});

describe('paste-links payload validation (max cap + type split)', () => {
  it('accepts hackathon type aliases', () => {
    const r = validatePasteLinksPayload({ type: 'hackathons', urls: ['https://a.com/1'] });
    expect(r.type).toBe('HACKATHON');
    expect(r.urls).toEqual(['https://a.com/1']);
  });

  it('accepts internship type aliases', () => {
    const r = validatePasteLinksPayload({ type: 'INTERNSHIP', urls: ['https://a.com/1'] });
    expect(r.type).toBe('INTERNSHIP');
  });

  it('rejects unknown type', () => {
    expect(() => validatePasteLinksPayload({ type: 'nope', urls: ['https://a.com/1'] })).toThrow(
      /type must be/i,
    );
  });

  it('rejects empty after parse', () => {
    expect(() => validatePasteLinksPayload({ type: 'HACKATHON', urls: [] })).toThrow(/urls/i);
    expect(() => validatePasteLinksPayload({ type: 'HACKATHON', raw: '   \n, ' })).toThrow(/urls/i);
  });

  it('parses raw multiline + enforces max cap', () => {
    expect(PASTE_LINKS_MAX_URLS).toBe(20);
    const many = Array.from({ length: 21 }, (_, i) => `https://a.com/${i}`);
    expect(() => validatePasteLinksPayload({ type: 'HACKATHON', urls: many })).toThrow(/max 20/i);
  });

  it('raw string input is parsed the same as urls[]', () => {
    const r = validatePasteLinksPayload({
      type: 'INTERNSHIP',
      raw: 'https://a.com/1, https://b.com/2\nhttps://a.com/1/',
    });
    expect(r.urls).toEqual(['https://a.com/1', 'https://b.com/2']);
  });
});

describe('paste-links staging separate (type-aware sources)', () => {
  it('uses distinct sources per type', () => {
    expect(PASTE_LINK_HACKATHON_SOURCE).toBe('PASTE_LINK_HACKATHON');
    expect(PASTE_LINK_INTERNSHIP_SOURCE).toBe('PASTE_LINK_INTERNSHIP');
    expect(PASTE_LINK_HACKATHON_SOURCE).not.toBe(PASTE_LINK_INTERNSHIP_SOURCE);
  });

  it('hackathon item normalizes to HACKATHON + hackathon source', () => {
    const opp = buildPasteLinkOpportunity(
      'https://example.com/hack',
      'Example Hackathon 2026 prizes last date 30 Sep 2026 India',
      'HACKATHON',
      { title: 'Example Hackathon', description: 'Cool hack' },
    );
    expect(opp.type).toBe('HACKATHON');
    expect(opp.source).toBe(PASTE_LINK_HACKATHON_SOURCE);
    expect(opp.title.length).toBeGreaterThan(2);
    expect(opp.url).toBe('https://example.com/hack');
  });

  it('internship item normalizes to INTERNSHIP + internship source', () => {
    const opp = buildPasteLinkOpportunity('https://example.com/job', 'SDE Intern remote stipend', 'INTERNSHIP', {
      title: 'SDE Intern at Acme',
    });
    expect(opp.type).toBe('INTERNSHIP');
    expect(opp.source).toBe(PASTE_LINK_INTERNSHIP_SOURCE);
    expect(opp.company.length).toBeGreaterThan(0);
  });

  it('falls back to slug title when no title in page', () => {
    const opp = buildPasteLinkOpportunity('https://example.com/super-cool-hackathon', '', 'HACKATHON');
    expect(opp.title.toLowerCase()).toContain('super');
  });
});

describe('paste-links SSRF (fail-closed per URL, no allowlist)', () => {
  it('blocks private IP literals', async () => {
    await expect(validatePublicUrl('http://127.0.0.1/x')).rejects.toThrow(/private/i);
    await expect(validatePublicUrl('http://10.0.0.5/x')).rejects.toThrow(/private/i);
    await expect(validatePublicUrl('http://169.254.169.254/')).rejects.toThrow(/private/i);
  });

  it('blocks metadata hosts + credentials + non-http', async () => {
    await expect(validatePublicUrl('http://localhost/x')).rejects.toThrow(/private/i);
    await expect(validatePublicUrl('https://user:pass@example.com/')).rejects.toThrow(/credential/i);
    await expect(validatePublicUrl('ftp://example.com/x')).rejects.toThrow(/http/i);
  });

  it('does NOT enforce platform allowlist (arbitrary public host passes literal checks)', async () => {
    // example.invalid never resolves — the point is it must NOT throw allowlist error.
    // It may throw resolve error (DNS) but never "not in allowlist".
    try {
      await validatePublicUrl('https://some-arbitrary-public-site-12345.com/some/path');
    } catch (e: any) {
      expect(String(e?.message || e)).not.toMatch(/allowlist/i);
    }
  });
});
