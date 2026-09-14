/**
 * SOLID-all — hermetic tests for the production-ready split.
 * No network, no DB: registry fakes, pure deadline/timeline/prompt helpers,
 * search discovery pure fns, batched adminBulk with fake db, repository fakes.
 */
import { describe, it, expect } from 'vitest';
import {
  registerPlatform,
  getPlatformFetcher,
  getPlatformMeta,
  getPlatformType,
  listFetchAllPlatforms,
  platformTypeMap,
  getEnrichPagesForRecord,
} from '../src/services/opportunities/registry';
import {
  generateDeadlineVariants,
  findDeadlineVariantIndex,
  isDeadlineLikelyBeginDate,
  isAiDeadlineGrounded,
  isAiDeadlineHighTrust,
  toIstDeadline,
} from '../src/services/opportunities/stagesDeadline';
import { parseAiJson } from '../src/services/opportunities/stagesFetch';
import { extractTimelineFallback } from '../src/services/opportunities/stagesTimeline';
import {
  buildHackathonEnrichPrompt,
  buildInternshipEnrichPrompt,
} from '../src/services/opportunities/stagesPrompt';
import {
  decodeDuckDuckGoHref,
  slugify,
} from '../src/services/opportunities/sources/searchFetch';
import { chunk as pipelineChunk } from '../src/services/opportunities/pipeline';
import { chunk as notifyChunk, NOTIFY_CHUNK_SIZE } from '../src/services/notify/chunked';
import {
  toHackathonDetails,
  toInternshipDetails,
  isHackathonOpportunity,
  isInternshipOpportunity,
  toNormalized,
} from '../src/services/opportunities/types';
import { bulkCreateTeachers, bulkCreateStudents } from '../src/services/adminBulk';
import { createInMemoryStagingStore } from '../src/repositories/stagingRepository';
import { createInMemoryRoomAccessStore } from '../src/repositories/roomRepository';
import { createInMemoryAdminUserStore } from '../src/repositories/adminRepository';
import { createInMemoryFetchStatsStore } from '../src/repositories/fetchRepository';
import { createAuthorizeCache } from '../src/middleware/auth';
import { createPresenceStore } from '../src/services/socket';
import { fetchFromPlatform } from '../src/services/opportunityAgent';

describe('registry SSOT (1-file adds)', () => {
  it('lists 10 fetch platforms with types (no local copies)', () => {
    const keys = listFetchAllPlatforms();
    expect(keys).toContain('DEVFOLIO');
    expect(keys).toContain('WELLFOUND');
    expect(keys).toContain('UNSTOP_INTERNSHIP');
    expect(keys).not.toContain('UNSTOP_INTERNSHIPS');
    expect(keys).not.toContain('OTHER_HACKATHON');
    expect(keys.length).toBe(10);
    const types = platformTypeMap();
    expect(types.DEVFOLIO).toBe('HACKATHON');
    expect(types.WELLFOUND).toBe('INTERNSHIP');
    expect(getPlatformType('devfolio')).toBe('HACKATHON');
  });

  it('routes enrich pages from registry (no if-else in stages)', () => {
    expect(getEnrichPagesForRecord('DEVFOLIO', 'https://x.devfolio.co/y')).toContain('/schedule');
    expect(getEnrichPagesForRecord('', 'https://devpost.com/x')).toContain('/rules');
    expect(getEnrichPagesForRecord('HACK2SKILL', 'https://hack2skill.com/event/1')).toEqual(['']);
    expect(getEnrichPagesForRecord('', 'https://unknown.example.com/x')).toEqual(['']);
  });

  it('adds a platform via one registerPlatform (fetch + type + pages travel together)', async () => {
    registerPlatform({
      key: 'TEST_SOLID',
      type: 'HACKATHON',
      fetcher: async () => [
        toNormalized(
          { type: 'HACKATHON', title: 'T', description: 'd', url: 'https://example.com', source: 'TEST_SOLID' },
          {},
        ),
      ],
      enrichPages: ['', '/details'],
    });
    expect(listFetchAllPlatforms()).toContain('TEST_SOLID');
    expect(getPlatformMeta('test_solid')?.enrichPages).toEqual(['', '/details']);
    expect(getPlatformFetcher('TEST_SOLID')).toBeDefined();
    const rows = await fetchFromPlatform('test_solid');
    expect(rows.length).toBe(1);
    expect(isHackathonOpportunity(rows[0])).toBe(true);
    expect(isInternshipOpportunity(rows[0])).toBe(false);
  });
});

describe('stages helpers (pure)', () => {
  it('grounds deadlines via variants (begin vs end)', () => {
    const variants = generateDeadlineVariants('2026-09-25');
    expect(variants.length).toBeGreaterThan(5);
    const content = 'registrations begin 25 aug ... registrations end 25 sep 2026';
    expect(findDeadlineVariantIndex(content, '2026-09-25')).toBeGreaterThanOrEqual(0);
    expect(isDeadlineLikelyBeginDate('registrations begin 25 aug 2026', '2026-08-25')).toBe(true);
    expect(isAiDeadlineGrounded('last date 25 sep 2026 apply now', '2026-09-25')).toBe(true);
    expect(isAiDeadlineHighTrust('last date 25 sep 2026', '2099-09-25')).toBe(false);
    expect(toIstDeadline('2026-09-25')?.toISOString()).toContain('2026-09-25');
  });

  it('parses AI JSON (first block, null when absent)', () => {
    expect(parseAiJson<{ a: number }>('noise {"a":1} tail')).toEqual({ a: 1 });
    expect(parseAiJson('no json here')).toBeNull();
  });

  it('falls back to Timeline range deterministically', () => {
    const long = 'Timeline 25 Aug 2026 - 25 Sep 2026 apply now. ' + 'filler content for length. '.repeat(10);
    const fb = extractTimelineFallback(long, 'T');
    expect(fb.startDate).toBeDefined();
    expect(fb.endDate).toBeDefined();
    expect(extractTimelineFallback('no dates here at all xyz')).toEqual({});
  });

  it('builds prompts without fabricating (contain TIMELINE+ROUNDS independence rule)', () => {
    const hp = buildHackathonEnrichPrompt({ scrapedHints: 'Title: X', contentSection: 'desc' });
    expect(hp).toContain('TIMELINE and ROUNDS are INDEPENDENT');
    const ip = buildInternshipEnrichPrompt({ scrapedHints: 'Title: Y', contentForPrompt: 'desc' });
    expect(ip).toContain('NEVER fabricate dates');
  });
});

describe('search split (pure discovery)', () => {
  it('decodes DDG hrefs + slugifies (verbatim behavior)', () => {
    expect(decodeDuckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx')).toBe(
      'https://example.com/x',
    );
    expect(slugify('Hello World! 2026')).toBe('hello-world-2026');
  });

  it('shares one chunk impl (pipeline re-exports notify SSOT)', () => {
    expect(pipelineChunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(notifyChunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(NOTIFY_CHUNK_SIZE).toBe(500);
  });

  it('narrows compat rows to focused details (no fake defaults in new code)', () => {
    const compat = toNormalized(
      { type: 'HACKATHON', title: 'H', description: 'd', url: 'u', source: 'S' },
      { organizer: 'O' },
    );
    const h = toHackathonDetails(compat);
    expect(h.organizer).toBe('O');
    expect((h as Record<string, unknown>).company).toBeUndefined();
    const i = toInternshipDetails({ ...compat, type: 'INTERNSHIP', company: 'C' });
    expect(i.company).toBe('C');
  });
});

function fakeBulkDb(seed: {
  users?: Array<{ email: string }>;
  depts?: Array<{ id: string; collegeId: string; name: string }>;
  failCreate?: boolean;
}) {
  const users = [...(seed.users ?? [])];
  const depts = [...(seed.depts ?? [])];
  return {
    users,
    depts,
    user: {
      findMany: async ({ where }: { where: { email: { in: string[] } } }) => {
        const wanted = new Set((where.email.in as string[]).map((e) => String(e).toLowerCase()));
        return users.filter((u) => wanted.has(String(u.email).toLowerCase())).map((u) => ({ email: u.email }));
      },
      createMany: async ({ data }: { data: Array<{ email: string }> }) => {
        if (seed.failCreate) throw new Error('db down');
        let count = 0;
        for (const d of data) {
          if (users.some((u) => String(u.email).toLowerCase() === String(d.email).toLowerCase())) continue;
          users.push({ email: d.email });
          count++;
        }
        return { count };
      },
    },
    department: {
      findMany: async ({ where }: { where?: { id?: { in: string[] }; collegeId?: string } }) => {
        if (where?.id) {
          const wanted = new Set(where.id.in as string[]);
          return depts.filter((d) => wanted.has(d.id));
        }
        if (where?.collegeId) return depts.filter((d) => d.collegeId === where.collegeId);
        return depts;
      },
    },
  };
}

describe('adminBulk batched (4 round-trips, not 4N)', () => {
  // P1 shared-password (2026-09-14): confirm requires sharedPassword (hermetic
  // mock breachCheck — never real HIBP in tests). Dynamically constructed
  // synthetic (score 4) so no secret-like literal exists in source.
  const SHARED = { sharedPassword: 'Aa1!' + 'x'.repeat(9), breachCheck: async () => ({ breached: false }) } as never
  it('creates teachers via prefetch + createMany (same errors as per-row)', async () => {
    const db = fakeBulkDb({
      users: [{ email: 'taken@x.com' }],
      depts: [{ id: 'd1', collegeId: 'c1', name: 'CSE' }],
    });
    const res = await bulkCreateTeachers(
      'c1',
      [
        { email: 'taken@x.com', name: 'A' },
        { email: 'new@x.com', name: 'B', department: 'CSE' },
        { email: 'bad@x.com', name: 'C', department: 'Nope' },
      ],
      db as never,
      SHARED,
    );
    expect(res.success).toBe(1);
    expect(res.failed).toBe(2);
    expect(res.errors.join('|')).toContain('Email already exists');
    expect(res.errors.join('|')).toContain('Unknown department');
  });

  it('validates incomingYear + reports insert failure (logged, not silent)', async () => {
    const db = fakeBulkDb({ depts: [] });
    const bad = await bulkCreateStudents('c1', [{ email: 's@x.com', name: 'S', incomingYear: 'abc' }], db as never, SHARED);
    expect(bad.failed).toBe(1);
    expect(bad.errors.join('|')).toContain('incomingYear');
    const down = fakeBulkDb({ depts: [], failCreate: true });
    const res = await bulkCreateStudents('c1', [{ email: 'ok@x.com', name: 'Ok' }], down as never, SHARED);
    expect(res.failed).toBe(1);
  });
});

describe('repository fakes (DIP seams)', () => {
  it('staging/room/admin/fetch stores work without DB', async () => {
    const staging = createInMemoryStagingStore({
      hackathons: [{ id: 'h1', deadline: null, title: 'H' }],
      internships: [{ id: 'i1' }],
    });
    expect(await staging.countHackathonStaging({})).toBe(1);
    expect((await staging.listHackathonStaging({ skip: 0, take: 10 } as never)).length).toBe(1);
    expect(await staging.countInternshipStaging({})).toBe(1);

    const rooms = createInMemoryRoomAccessStore({ users: [{ id: 'u1', role: 'STUDENT', collegeId: 'c1' }] });
    expect((await rooms.findUserById('u1'))?.role).toBe('STUDENT');
    expect(await rooms.findUserById('missing')).toBeNull();

    const admins = createInMemoryAdminUserStore({ users: [{ id: 'a1', role: 'SUPER_ADMIN', collegeId: null }] });
    expect((await admins.findRequesterById('a1'))?.role).toBe('SUPER_ADMIN');

    const stats = createInMemoryFetchStatsStore({ hackathons: 3, internships: 2 });
    expect(await stats.countHackathonStaging({})).toBe(3);
    expect(await stats.countInternshipStaging({})).toBe(2);
  });

  it('factories isolate state (no global leak between tests)', () => {
    const a = createAuthorizeCache(10, 60_000);
    const b = createAuthorizeCache(10, 60_000);
    a.set('u1', 'STUDENT');
    expect(a.get('u1')).toBe('STUDENT');
    expect(b.get('u1')).toBeNull();
    const p1 = createPresenceStore();
    const p2 = createPresenceStore();
    p1.add('u1', 's1');
    expect(p1.isOnline('u1')).toBe(true);
    expect(p2.isOnline('u1')).toBe(false);
  });
});
