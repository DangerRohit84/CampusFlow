/**
 * Regression tests for three evidenced timeline gaps (fix-stages-timeline).
 * Hermetic: no DB, no live network (fetch mocked where needed).
 *
 * 1. Unstop extractStages (details.ts:380-393 old):
 *    Missed `Phase N` (no phase keyword) and `Round N (` shapes (required letter
 *    right after number, so "(" failed). Evidence: Quant-A-Maze A.json:177
 *    (20260909-221715) description carries Round 1 (Online PPT...)/Round 2
 *    (36-Hour On-Campus) + Important Dates Phase 1 Online/Results + Phase 2
 *    Offline + Final Results — yet fetcher emitted stages None.
 *    Fix: Stage/Round/Phase N with optional parenthetical + Important-Dates
 *    lines as dated stages (END of range).
 *
 * 2. DoraHacks detail milestones (REPORT-dorahacks.md wart 1 MEDIUM):
 *    Detail pages carry 3-4 milestone timelines but fetcher emitted deadline ''
 *    + duration ''. Evidence: B.webfetch-detail-event-contracts.md (Extended
 *    2026/09/11) + B.webfetch-detail-buidl-ctc.md (Extended 2026/09/14).
 *    Fix: parseDoraHacksTimeline → stages[]+dates[] + authoritative Extended/last deadline.
 *
 * 3. Hack2Skill 5-phase Timeline (REPORT-hack2skill.md):
 *    event-details JSON already downloaded per item has 5-phase Timeline but only
 *    registrationEnd emitted. Evidence: B.webfetch-event-details-impactx26.json
 *    (Registration/Team Formation/Payment/Problem Statement/FINALE).
 *    Fix: extractHack2SkillTimeline → all entries to stages[]+dates[]
 *    (+ submissionStart/Finale via dates[] labels) + fetcher wiring.
 *
 * Rules: schema compatible (optional fields only), no fake (omit absent), no DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractStages } from '../src/services/opportunities/sources/details';
import { parseDoraHacksTimeline, fetchDoraHacksPage } from '../src/services/opportunities/sources/dorahacks';
import {
  extractHack2SkillTimeline,
  fetchHack2SkillTimeline,
  fetchHack2SkillApiPage,
} from '../src/services/opportunities/sources/hack2skill';
import { resetScrapeCacheForTests } from '../src/services/opportunities/cache';

beforeEach(() => {
  resetScrapeCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── 1. Unstop — Quant-A-Maze A.json:177 shapes ───

// Trimmed verbatim from A.json Quant-A-Maze description (20260909-221715:174,
// len 2000 cap preserved). Contains the exact evidenced shapes.
const QUANT_DESC = [
  'Quant-A-Maze 3.0: 36-Hour National-Level Hackathon organized by Q-Bits.',
  'Registration Fee Details: Round 1 (Online PPT Submission): Free registration.',
  'Round 2 (36-Hour On-Campus): Shortlisted candidates will need to pay 800 per team.',
  'Important Dates: Registration: 7th September to 28th September 2026',
  'Phase 1 Online Round: 7th September to 28th September 2026',
  'Phase 1 Results: 3rd October 2026',
  'Phase 2 Offline Round: 28th to 30th October 2026',
  'Final Results: 30th October 2026',
  'Eligibility: Open to all undergraduate students.',
].join(' ');

describe('Unstop extractStages — Phase + Round N ( shapes (Quant-A-Maze A.json:177)', () => {
  it('captures Round N parenthetical titles (old regex missed "(" after number)', () => {
    const stages = extractStages(QUANT_DESC);
    const joined = stages.map((s) => s.title).join(' | ');
    expect(joined).toMatch(/Round 1 \(Online PPT Submission\)/);
    expect(joined).toMatch(/Round 2 \(36-Hour On-Campus\)/);
  });

  it('matches Phase N keyword (old regex had no phase)', () => {
    const stages = extractStages(QUANT_DESC);
    const joined = stages.map((s) => s.title).join(' | ').toLowerCase();
    expect(joined).toContain('phase 1 online round');
    expect(joined).toContain('phase 2 offline round');
    expect(joined).toContain('phase 1 results');
  });

  it('emits Important-Dates lines as dated stages (END of range, no fake)', () => {
    const stages = extractStages(QUANT_DESC);
    const byTitle = new Map(stages.map((s) => [s.title.toLowerCase(), s]));
    // Phase 1 Online Round: 7th Sep to 28th Sep 2026 → END 2026-09-28
    expect(byTitle.get('phase 1 online round')?.date).toBe('2026-09-28');
    // Phase 1 Results: 3rd October 2026 → 2026-10-03
    expect(byTitle.get('phase 1 results')?.date).toBe('2026-10-03');
    // Phase 2 Offline Round: 28th to 30th October 2026 → END 2026-10-30
    expect(byTitle.get('phase 2 offline round')?.date).toBe('2026-10-30');
    // Final Results: 30th October 2026 → 2026-10-30
    expect(byTitle.get('final results')?.date).toBe('2026-10-30');
    // Rounds have no dates in source → omit (never invent)
    const r1 = byTitle.get('round 1 (online ppt submission)');
    expect(r1).toBeDefined();
    expect(r1?.date).toBeUndefined();
  });

  it('returns >=5 stages for Quant (2 Rounds + 3 Phases + Final)', () => {
    const stages = extractStages(QUANT_DESC);
    expect(stages.length).toBeGreaterThanOrEqual(5);
  });

  it('still extracts WEBCMD 2-stage reference (no regression)', () => {
    const webcmd = 'Stages: Stage 1 Campus Round (online quiz), Stage 2 National Finale (offline build).';
    const stages = extractStages(webcmd);
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const joined = stages.map((s) => s.title).join(' ').toLowerCase();
    expect(joined).toContain('campus');
    expect(joined).toContain('national');
  });

  it('omits absent (never invents)', () => {
    expect(extractStages('')).toEqual([]);
    expect(extractStages('no stages here, just a hackathon')).toEqual([]);
    // Bare fee line without keyword number is not a stage
    expect(extractStages('Registration Fees: 1500 per team')).toEqual([]);
  });
});

// ─── 2. DoraHacks — Event Contracts + BUIDL CTC fixtures ───

// Verbatim timeline region from B.webfetch-detail-event-contracts.md
// (dates bumped 2026→2027 + pinned clock below so isEnded never filters).
const EVENT_CONTRACTS_DETAIL = [
  '# Event Contracts Hackathon',
  'Prize Pool 5,000 USD',
  'event timeline Submission deadline extended Upcoming',
  'Pre-registration',
  '2027/08/18 00:00',
  'Submission',
  '2027/08/25 00:00',
  'Deadline',
  '2027/09/08 18:00',
  'Extended',
  '2027/09/11 18:00',
  'Virtual Hackathon Tags DeFi',
].join('\n');

// Verbatim timeline region from B.webfetch-detail-buidl-ctc.md
// (dates bumped 2026→2027 for same reason).
const BUIDL_CTC_DETAIL = [
  '# BUIDL CTC 2026 Fall - BUIDL For The Real World',
  'Prize Pool 15,000 USD',
  'event timeline Submission deadline extended Upcoming',
  'Submission',
  '2027/08/13 05:00',
  'Deadline',
  '2027/09/06 04:59',
  'Extended',
  '2027/09/14 03:59',
  'Virtual Hackathon Tags Web3',
].join('\n');

describe('DoraHacks parseDoraHacksTimeline — detail milestones', () => {
  it('parses Event Contracts 4 milestones + Extended authoritative deadline', () => {
    const tl = parseDoraHacksTimeline(EVENT_CONTRACTS_DETAIL);
    expect(tl.stages).toHaveLength(4);
    expect(tl.dates).toHaveLength(4);
    const byLabel = new Map(tl.dates.map((d) => [d.label, d.date]));
    expect(byLabel.get('pre_registration')).toBe('2027-08-18');
    expect(byLabel.get('submission')).toBe('2027-08-25');
    expect(byLabel.get('deadline')).toBe('2027-09-08');
    expect(byLabel.get('extended')).toBe('2027-09-11');
    // Authoritative = Extended, not Deadline (old fetcher emitted '')
    expect(tl.deadline).toBe('2027-09-11');
    const titles = tl.stages.map((s) => s.title).join(' | ');
    expect(titles).toMatch(/Pre-registration/);
    expect(titles).toMatch(/Submission/);
    expect(titles).toMatch(/Deadline/);
    expect(titles).toMatch(/Extended/);
  });

  it('parses BUIDL CTC 3 milestones + Extended 2027-09-14', () => {
    const tl = parseDoraHacksTimeline(BUIDL_CTC_DETAIL);
    expect(tl.stages).toHaveLength(3);
    const byLabel = new Map(tl.dates.map((d) => [d.label, d.date]));
    expect(byLabel.get('submission')).toBe('2027-08-13');
    expect(byLabel.get('deadline')).toBe('2027-09-06');
    expect(byLabel.get('extended')).toBe('2027-09-14');
    expect(tl.deadline).toBe('2027-09-14');
  });

  it('handles fetchPage6k single-line stripped form (collapsed whitespace)', () => {
    const stripped =
      'Event Contracts Hackathon Prize Pool 5,000 USD event timeline Submission deadline extended Upcoming Pre-registration 2027/08/18 00:00 Submission 2027/08/25 00:00 Deadline 2027/09/08 18:00 Extended 2027/09/11 18:00 Virtual';
    const tl = parseDoraHacksTimeline(stripped);
    expect(tl.stages).toHaveLength(4);
    expect(tl.deadline).toBe('2027-09-11');
  });

  it('falls back to last date when Extended absent (never invents)', () => {
    const noExt = 'Submission 2027/08/25 00:00 Deadline 2027/09/08 18:00';
    const tl = parseDoraHacksTimeline(noExt);
    expect(tl.stages).toHaveLength(2);
    expect(tl.deadline).toBe('2027-09-08');
  });

  it('omits absent (never invents)', () => {
    expect(parseDoraHacksTimeline('')).toEqual({ stages: [], dates: [], deadline: '' });
    expect(parseDoraHacksTimeline('no timeline here')).toEqual({ stages: [], dates: [], deadline: '' });
    expect(parseDoraHacksTimeline(null as any)).toEqual({ stages: [], dates: [], deadline: '' });
  });
});

describe('DoraHacks fetcher — anchor path enriches deadline+stages (mocked)', () => {
  const LISTING_HTML = [
    '<html><body>',
    '<a href="/hackathon/event-contracts/">Event Contracts Hackathon</a>',
    '</body></html>',
  ].join('');
  const DETAIL_STRIPPED =
    'Event Contracts Hackathon Prize Pool event timeline Pre-registration 2027/08/18 00:00 Submission 2027/08/25 00:00 Deadline 2027/09/08 18:00 Extended 2027/09/11 18:00 Virtual';

  function mockListingPlusDetail() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u === 'https://dorahacks.io/hackathon') {
          return { ok: true, text: async () => LISTING_HTML } as any;
        }
        if (u.includes('/hackathon/event-contracts')) {
          return { ok: true, text: async () => `<html><body>${DETAIL_STRIPPED}</body></html>` } as any;
        }
        return { ok: false, text: async () => '' } as any;
      }),
    );
  }

  it('sets authoritative Extended deadline + stages/dates (was "" + no stages)', async () => {
    // WHY: isEnded(Date.now) filtered Extended 2026/09/11 once wall-clock passed
    // it (expected 0 > 0). Pin clock before 2027 fixture so it never expires.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2027-08-01T00:00:00.000Z'));
      mockListingPlusDetail();
      const out = await fetchDoraHacksPage(1, new Set<string>());
      expect(out.length).toBeGreaterThan(0);
      const item = out.find((o) => o.url.includes('event-contracts'))!;
      expect(item).toBeDefined();
      expect(item.deadline).toBe('2027-09-11');
      expect(item.stages?.length).toBeGreaterThanOrEqual(4);
      expect(item.dates?.length).toBeGreaterThanOrEqual(4);
      const labels = (item.dates || []).map((d) => d.label);
      expect(labels).toContain('extended');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── 3. Hack2Skill — 5-phase Timeline fixture ───

// Trimmed live shape from B.webfetch-event-details-impactx26.json (20260909-232017):
// 5 Timeline items with starts/ends + top-level registration/submission cues.
const IMPACTX26_TIMELINE_DETAILS = {
  title: "ImpactX'26",
  registrationStart: '2026-09-04T04:30:00.000Z',
  registrationEnd: '2026-10-02T18:29:00.000Z',
  submissionStart: '2026-09-11T18:30:00.000Z',
  submissionEnd: null,
  tags: {
    mode: { value: 'IN_PERSON' },
    finale: { value: 'IN_PERSON' },
  },
  sections: [
    {
      title: 'Timeline',
      type: 'TIMELINE',
      category: [
        {
          title: 'CUSTOM',
          data: [
            { title: 'Registration', type: 'REGISTRATION', start: '2026-09-04T04:30:00.000Z', end: '2026-10-02T18:29:00.000Z' },
            { title: 'Team Formation', type: 'TEAM_FORMATION', start: '2026-09-08T04:30:00.000Z', end: '2026-10-02T18:29:00.000Z' },
            { title: 'Payment Link', type: 'FORM', start: '2026-09-08T04:30:00.000Z', end: '2026-10-02T18:29:00.000Z' },
            { title: 'Problem Statement', type: 'PROJECT_SUBMISSION', start: '2026-09-11T18:30:00.000Z', end: '2026-10-02T18:29:00.000Z' },
            { title: 'Finale', type: 'FINALE', start: '2026-10-08T02:30:00.000Z', end: '2026-10-09T12:30:00.000Z' },
          ],
        },
      ],
    },
  ],
};

describe('Hack2Skill extractHack2SkillTimeline — 5-phase mapping', () => {
  it('maps all 5 Timeline entries to stages[]', () => {
    const { stages } = extractHack2SkillTimeline(IMPACTX26_TIMELINE_DETAILS);
    expect(stages).toHaveLength(5);
    const titles = stages.map((s) => s.title);
    expect(titles).toContain('Registration');
    expect(titles).toContain('Team Formation');
    expect(titles).toContain('Payment Link');
    expect(titles).toContain('Problem Statement');
    expect(titles).toContain('Finale');
  });

  it('maps starts/ends to dates[] incl submissionStart + Finale dates', () => {
    const { dates } = extractHack2SkillTimeline(IMPACTX26_TIMELINE_DETAILS);
    const byLabel = new Map(dates.map((d) => [d.label, d.date]));
    expect(byLabel.get('registration_start')).toBe('2026-09-04T04:30:00.000Z');
    expect(byLabel.get('registration_end')).toBe('2026-10-02T18:29:00.000Z');
    expect(byLabel.get('team_formation_start')).toBe('2026-09-08T04:30:00.000Z');
    // submissionStart (Problem Statement start == top submissionStart)
    expect(byLabel.get('problem_statement_start')).toBe('2026-09-11T18:30:00.000Z');
    // Finale dates (offline Oct 8-9)
    expect(byLabel.get('finale_start')).toBe('2026-10-08T02:30:00.000Z');
    expect(byLabel.get('finale_end')).toBe('2026-10-09T12:30:00.000Z');
    expect(dates.length).toBeGreaterThanOrEqual(10);
  });

  it('stages carry end dates (Finale end Oct 9)', () => {
    const { stages } = extractHack2SkillTimeline(IMPACTX26_TIMELINE_DETAILS);
    const byTitle = new Map(stages.map((s) => [s.title, s.date]));
    expect(byTitle.get('Registration')).toBe('2026-10-02T18:29:00.000Z');
    expect(byTitle.get('Finale')).toBe('2026-10-09T12:30:00.000Z');
  });

  it('omits absent (never invents)', () => {
    expect(extractHack2SkillTimeline(null as any)).toEqual({ stages: [], dates: [] });
    expect(extractHack2SkillTimeline({ sections: [] })).toEqual({ stages: [], dates: [] });
    expect(extractHack2SkillTimeline({ sections: [{ title: 'About', category: [] }] })).toEqual({
      stages: [],
      dates: [],
    });
  });
});

describe('Hack2Skill fetcher — sitemap timeline wiring (mocked)', () => {
  const SITEMAP_XML = ['<url><loc>https://hack2skill.com/event/impactx26</loc></url>'].join('');

  function mockSitemapWithTimeline() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes('/innovator/public/event/list')) {
          return { ok: true, headers: { get: () => 'text/html' }, text: async () => 'Hack2skill' } as any;
        }
        if (u.includes('sitemap.xml')) {
          return { ok: true, text: async () => SITEMAP_XML } as any;
        }
        if (u.includes('/api/v1/event/')) {
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: IMPACTX26_TIMELINE_DETAILS }),
          } as any;
        }
        return { ok: true, text: async () => '<html><body>shell</body></html>' } as any;
      }),
    );
  }

  it('attaches 5 stages + dates via shared event-details (was deadline-only)', async () => {
    mockSitemapWithTimeline();
    const out = await fetchHack2SkillApiPage(1, new Set<string>());
    expect(out).toHaveLength(1);
    const item = out[0];
    expect(item.deadline).toBe('2026-10-02T18:29:00.000Z');
    expect(item.stages?.length).toBe(5);
    expect(item.dates?.length).toBeGreaterThanOrEqual(10);
    const labels = (item.dates || []).map((d) => d.label);
    expect(labels).toContain('finale_start');
    expect(labels).toContain('finale_end');
    expect(labels).toContain('problem_statement_start');
    // startDate derived from registration_start when list start empty
    expect(item.startDate).toBe('2026-09-04');
  });

  it('fetchHack2SkillTimeline hits shared cache (no extra shape)', async () => {
    mockSitemapWithTimeline();
    const tl = await fetchHack2SkillTimeline('https://hack2skill.com/event/impactx26');
    expect(tl.stages).toHaveLength(5);
    expect(tl.dates.length).toBeGreaterThanOrEqual(10);
  });
});
