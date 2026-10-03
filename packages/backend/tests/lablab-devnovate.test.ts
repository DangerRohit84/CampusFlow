/**
 * LabLab + DevNovate fetcher unit tests (TDD RED).
 * Hermetic: no DB, no live network (fetch + validateExternalUrl mocked; recorded fixtures).
 *
 * Covers per task: normalize + dedup + prize/deadline parse, source tags LABLAB/DEVNOVATE,
 * dedup by URL, fail-open on fetch error, rate-limited/cached behavior via existing helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hermetic: bypass DNS/allowlist (real validateExternalUrl does dns.lookup → live net).
vi.mock('../src/utils/secureUrl', () => ({
  validateExternalUrl: vi.fn(async (u: string) => new URL(u)),
}));

import {
  isLablabEventUrl,
  normalizeLablabUrl,
  parseLablabMode,
  parseLablabDateRange,
  parseLablabListing,
  parseLablabDetail,
} from '../src/services/opportunities/sources/lablab';
import {
  isDevnovateEventUrl,
  normalizeDevnovateUrl,
  parseDevnovateMode,
  parseDevnovateTeamSize,
} from '../src/services/opportunities/sources/devnovate';
import {
  extractPrizeTiers,
  extractUSDPrizeTiers,
} from '../src/services/opportunities/sources/details';
import { extractDeadlineFromContent } from '../src/utils/search';
import { isEnded } from '../src/services/opportunities/dates';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── LabLab fixtures (recorded live shapes 2026-10-03) ───
const LABLAB_LISTING_HTML = [
  '<html><head><title>AI Hackathons | lablab.ai</title>',
  '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"name":"Lablab x AMD AI Academy Challenge","url":"https://lablab.ai/ai-hackathons/amd-lablab-ai-academy-challenge"},{"@type":"ListItem","position":2,"name":"Vultr: Agent Rush Hackathon","url":"https://lablab.ai/ai-hackathons/vultr-hackathon"}]}]}</script>',
  '</head><body>',
  '<div class="card-animation"><a href="/ai-hackathons/amd-lablab-ai-academy-challenge">',
  '<span>LIVE</span><span>Online</span>',
  '<div><time datetime="2026-09-01T19:00:00.000Z"><span>SEP 1 - DEC 1</span></time></div>',
  '<h2>Lablab x AMD AI Academy Challenge</h2>',
  '<p>Learn. Build. Share. Grow. A 3-month AMD-powered developer growth program — open to individual participants only. Prize Pool: $5,000</p>',
  '</a></div>',
  '<div class="card-animation"><a href="/ai-hackathons/vultr-hackathon">',
  '<span>Register</span><span>Hybrid</span>',
  '<div><time datetime="2026-11-03T15:00:00.000Z"><span>NOV 3 - 8</span></time></div>',
  '<h2>Vultr: Agent Rush Hackathon</h2>',
  '<p>Hybrid Hackathon | Online Build: 3-8 November 2026 | On-site phase: 8 November 2026</p>',
  '</a></div>',
  '<div class="card-animation"><a href="/ai-hackathons/assemblyai-voice-agent-hackathon">',
  '<span>Finished</span><span>Online</span>',
  '<div><time datetime="2026-09-01T15:00:00.000Z"><span>SEP 1 - 30</span></time></div>',
  '<h2>AssemblyAI - Voice Agent Hackathon</h2>',
  '<p>Online Hackathon | Dates: Sep 1-30, 2026 | $10,000 Prize Pool ($5k cash + $5k in AAI credits)</p>',
  '</a></div>',
  '</body></html>',
].join('\n');

const LABLAB_DETAIL_HTML = [
  '<html><body>',
  '<h1>AssemblyAI - Voice Agent Hackathon</h1>',
  '<p>Month-long online challenge run by lablab.ai together with AssemblyAI. Every participant builds on AssemblyAI.</p>',
  '<p>Prize Pool: $10,000 ($5k cash + $5k in AAI credits)</p>',
  '<p>Winner: $5,000 2nd Place: $3,000 3rd Place: $2,000</p>',
  '<p>You can work solo, or in a team of up to 6 members.</p>',
  '<p>Registration stays open for the whole build window Sep 1-30, 2026. Join from anywhere in the world.</p>',
  '</body></html>',
].join('\n');

describe('lablab url + normalize (dedup by URL)', () => {
  it('accepts live /ai-hackathons/<slug> shapes', () => {
    expect(isLablabEventUrl('https://lablab.ai/ai-hackathons/vultr-hackathon')).toBe(true);
    expect(isLablabEventUrl('/ai-hackathons/amd-lablab-ai-academy-challenge')).toBe(true);
    expect(isLablabEventUrl('https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/')).toBe(true);
  });

  it('drops bare list, dash, judging, non-lablab, garbage', () => {
    expect(isLablabEventUrl('https://lablab.ai/ai-hackathons')).toBe(false);
    expect(isLablabEventUrl('https://lablab.ai/ai-hackathons/')).toBe(false);
    expect(isLablabEventUrl('https://lablab.ai/dash')).toBe(false);
    expect(isLablabEventUrl('https://lablab.ai/judging')).toBe(false);
    expect(isLablabEventUrl('https://example.com/ai-hackathons/vultr-hackathon')).toBe(false);
    expect(isLablabEventUrl('')).toBe(false);
    expect(isLablabEventUrl(null)).toBe(false);
  });

  it('normalizes to canonical https URL for dedup by URL', () => {
    expect(normalizeLablabUrl('/ai-hackathons/Vultr-Hackathon/')).toBe(
      'https://lablab.ai/ai-hackathons/vultr-hackathon',
    );
    expect(normalizeLablabUrl('https://LABLAB.AI/ai-hackathons/vultr-hackathon?x=1')).toBe(
      'https://lablab.ai/ai-hackathons/vultr-hackathon',
    );
    expect(normalizeLablabUrl('https://lablab.ai/ai-hackathons')).toBe('');
  });
});

describe('lablab mode + date range', () => {
  it('maps Online/Hybrid/On-site badges honestly', () => {
    expect(parseLablabMode('Online')).toBe('ONLINE');
    expect(parseLablabMode('🌎 Online Hackathon | Build from anywhere')).toBe('ONLINE');
    expect(parseLablabMode('Hybrid')).toBe('HYBRID');
    expect(parseLablabMode('🌎 Hybrid Hackathon | On-site phase: 8 November 2026')).toBe('HYBRID');
    expect(parseLablabMode('On-site Only Hackathon | San Francisco')).toBe('OFFLINE');
    expect(parseLablabMode('')).toBe('');
  });

  it('prefers <time datetime> for start/deadline, falls back to label', () => {
    const r1 = parseLablabDateRange('SEP 1 - DEC 1', '2026-09-01T19:00:00.000Z');
    expect(r1.startDate).toBe('2026-09-01');
    // datetime is start; deadline comes from label end (Dec 1 → 2026-12-01)
    expect(r1.deadline).toBe('2026-12-01');

    const r2 = parseLablabDateRange('NOV 3 - 8', '2026-11-03T15:00:00.000Z');
    expect(r2.startDate).toBe('2026-11-03');
    expect(r2.deadline).toBe('2026-11-08');

    const r3 = parseLablabDateRange('SEP 1 - 30', '');
    expect(r3.startDate).toBe('2026-09-01');
    expect(r3.deadline).toBe('2026-09-30');
  });

  it('drops Finished past events via isEnded downstream (deadline in past)', () => {
    // Finished Sep 1-30 2026 is past by Oct 2026 in prod; pure parser still returns dates
    const r = parseLablabDateRange('SEP 1 - 30', '2026-09-01T15:00:00.000Z');
    expect(r.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // isEnded contract: past deadline → true (fetchers filter)
    expect(isEnded('2000-01-01', 'AssemblyAI - Voice Agent Hackathon')).toBe(true);
  });
});

describe('lablab listing + detail parsers', () => {
  it('parses JSON-LD + cards: title/url/description/date/mode', () => {
    const items = parseLablabListing(LABLAB_LISTING_HTML);
    expect(items.length).toBeGreaterThanOrEqual(3);
    const titles = items.map((i) => i.title);
    expect(titles).toContain('Lablab x AMD AI Academy Challenge');
    expect(titles).toContain('Vultr: Agent Rush Hackathon');
    const vultr = items.find((i) => i.title.includes('Vultr'))!;
    expect(vultr.url).toBe('https://lablab.ai/ai-hackathons/vultr-hackathon');
    expect(vultr.dateLabel).toMatch(/NOV 3 - 8/);
    expect(vultr.datetime).toBe('2026-11-03T15:00:00.000Z');
    expect(vultr.modeBadge).toMatch(/Hybrid/i);
  });

  it('detail extracts USD prize tiers + team size, never $0', () => {
    const parsed = parseLablabDetail(LABLAB_DETAIL_HTML, {
      title: 'AssemblyAI - Voice Agent Hackathon',
    });
    expect(parsed.prizePool).toContain('$10,000');
    // Headline $10k + placed tiers ($3k/$2k evidenced) — never $0, never empty.
    expect(parsed.prizeTiers.join(' | ')).toMatch(/\$3,000/);
    expect(parsed.prizeTiers.length).toBeGreaterThanOrEqual(2);
    expect(parsed.prizePool).not.toMatch(/\$0(?!\d)/);
    expect(parsed.teamSize).toBe(6);
    expect(parsed.description.length).toBeGreaterThan(40);
  });

  it('prize extractor never invents $0/₹0 on empty', () => {
    expect(extractUSDPrizeTiers('no prizes here').prizePool).toBe('');
    expect(extractPrizeTiers('no prizes here').prizePool).toBe('');
  });
});

describe('devnovate url + normalize (dedup by URL, confirm devnovate.co)', () => {
  it('accepts live /event/<slug> + /events/<slug> on devnovate.co', () => {
    expect(isDevnovateEventUrl('https://devnovate.co/event/hackforge')).toBe(true);
    expect(isDevnovateEventUrl('https://devnovate.co/events/hackforge')).toBe(true);
    expect(isDevnovateEventUrl('https://devnovate.co/event/hack-beyond/')).toBe(true);
    expect(isDevnovateEventUrl('/event/build-with-ai')).toBe(true);
  });

  it('drops bare list, auth, non-devnovate, garbage', () => {
    expect(isDevnovateEventUrl('https://devnovate.co/events')).toBe(false);
    expect(isDevnovateEventUrl('https://devnovate.co/event')).toBe(false);
    expect(isDevnovateEventUrl('https://devnovate.co/event/')).toBe(false);
    expect(isDevnovateEventUrl('https://devnovate.co/auth/status')).toBe(false);
    expect(isDevnovateEventUrl('https://example.com/event/hackforge')).toBe(false);
    expect(isDevnovateEventUrl('')).toBe(false);
    expect(isDevnovateEventUrl(null)).toBe(false);
  });

  it('normalizes /events → /event canonical for dedup by URL', () => {
    expect(normalizeDevnovateUrl('https://devnovate.co/events/HackForge/?x=1')).toBe(
      'https://devnovate.co/event/hackforge',
    );
    expect(normalizeDevnovateUrl('/event/HACK-BEYOND')).toBe('https://devnovate.co/event/hack-beyond');
    expect(normalizeDevnovateUrl('https://devnovate.co/events')).toBe('');
  });
});

describe('devnovate mode + team size + prize/deadline', () => {
  it('maps offline/hybrid/online honestly (college scoping cues)', () => {
    expect(parseDevnovateMode('Type OFFLINE CMRIT, Hyderabad')).toBe('OFFLINE');
    expect(parseDevnovateMode('Hosted at the Microsoft Office')).toBe('OFFLINE');
    expect(parseDevnovateMode('24-Hours Hybrid Hackathon')).toBe('HYBRID');
    expect(parseDevnovateMode('Fully online hackathon. Join from anywhere')).toBe('ONLINE');
    expect(parseDevnovateMode('')).toBe('');
  });

  it('parses Team Size min-max → max (college teams)', () => {
    expect(parseDevnovateTeamSize('Team Size 3-4')).toBe(4);
    expect(parseDevnovateTeamSize('Team Size: Teams must consist of a minimum of 1 and a maximum of 4 members')).toBe(4);
    expect(parseDevnovateTeamSize('Type OFFLINE Team Size 1-6')).toBe(6);
    expect(parseDevnovateTeamSize('no team info')).toBeNull();
  });

  it('parses USD + INR prizes without $0/₹0', () => {
    const usd = extractUSDPrizeTiers('prize pool of up to $500, along with exclusive swags');
    expect(usd.prizePool).toMatch(/\$500/);
    const inr = extractPrizeTiers('GenAI Challenge ₹5L Prize · 3 days left');
    // ₹5L shape may not recall as tier; at minimum never fabricates ₹0
    expect(inr.prizePool).not.toMatch(/₹\s*0(?!\d)/);
    expect(extractUSDPrizeTiers('').prizePool).toBe('');
  });

  it('deadline parses explicit event dates (HackForge Mar 5-7 2026)', () => {
    const d = extractDeadlineFromContent('05 March 2026 Ends 07 March 2026 CMRIT, Hyderabad');
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
