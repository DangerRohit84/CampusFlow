/**
 * Track 4 — hermetic unit tests for the opportunity split (pure fns only).
 * No network, no DB: every store is an in-memory fake.
 */
import { describe, it, expect } from 'vitest';
import {
  extractPastYearFromTitle,
  isTitlePastYear,
  inferDeadlineFromTitle,
  isEnded,
  isStagingEnded,
  formatLocalDate,
  notPastYearWhere,
} from '../src/services/opportunities/dates';
import {
  stripHtml,
  isGenericTitle,
  normalizeTitleKey,
} from '../src/services/opportunities/text';
import { toNormalized, hasValue } from '../src/services/opportunities/types';
import {
  buildTitleSet,
  filterNewByTitleSource,
  dedupInMemory,
  prismaDedupStore,
} from '../src/services/opportunities/dedup';
import { inMemoryDedupStore, prismaOpportunityDedupStore } from '../src/lib/repository';
import { fanOut, filterActiveUnique, chunk } from '../src/services/opportunities/pipeline';
import { RateLimitGate } from '../src/services/opportunities/cache';

function opp(over: Record<string, unknown> = {}) {
  return {
    type: 'HACKATHON',
    title: 'Test Hack',
    description: '',
    url: 'https://example.com/x',
    source: 'DEVFOLIO',
    organizer: '',
    deadline: '',
    startDate: '',
    duration: '',
    location: '',
    mode: '',
    prizePool: '',
    stipend: '',
    company: '',
    role: '',
    themes: [],
    website: '',
    discord: '',
    participantsCount: 0,
    inviteOnly: false,
    ...over,
  } as Parameters<typeof dedupInMemory>[0][number];
}

describe('dates SSOT', () => {
  it('extractPastYearFromTitle finds 4-digit years', () => {
    expect(extractPastYearFromTitle('Netscout Hackathon 2025')).toBe(2025);
    expect(extractPastYearFromTitle('No year here')).toBeNull();
    expect(extractPastYearFromTitle(null)).toBeNull();
  });

  it('isTitlePastYear flags only strictly-past years', () => {
    const y = new Date().getFullYear();
    expect(isTitlePastYear(`Hack ${y - 1}`)).toBe(true);
    expect(isTitlePastYear(`Hack ${y}`)).toBe(false);
    expect(isTitlePastYear('Hack with no year')).toBe(false);
  });

  it('inferDeadlineFromTitle maps past-year titles to Dec 31', () => {
    const y = new Date().getFullYear();
    expect(inferDeadlineFromTitle(`Foo ${y - 1}`)).toBe(`${y - 1}-12-31`);
    expect(inferDeadlineFromTitle('Foo with no year')).toBe('');
  });

  it('isEnded respects deadline first, title inference second', () => {
    expect(isEnded('2000-01-01', 'Future Hack 2099')).toBe(true);
    expect(isEnded('2099-01-01', 'Old Hack 2001')).toBe(false);
    expect(isEnded('', `Old Hack ${new Date().getFullYear() - 1}`)).toBe(true);
    expect(isEnded('', 'Timeless Hack')).toBe(false);
  });

  it('isStagingEnded never hides on deadline (Cognition rule)', () => {
    expect(isStagingEnded(new Date('2026-08-22'), 'Cognition 2026')).toBe(false);
    expect(isStagingEnded(null, 'Netscout 2025')).toBe(true);
    expect(isStagingEnded(null, 'Fresh Hack')).toBe(false);
  });

  it('formatLocalDate pads month/day', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('notPastYearWhere builds NOT/OR contains fragment', () => {
    const w = notPastYearWhere(2026) as { NOT: { OR: Array<{ title: { contains: string } }> } };
    expect(w.NOT.OR.map((c) => c.title.contains)).toContain('2025');
    expect(w.NOT.OR.map((c) => c.title.contains)).not.toContain('2026');
  });
});

describe('text SSOT', () => {
  it('stripHtml removes tags/entities and collapses space', () => {
    expect(stripHtml('<h3>Hi</h3>  &amp; bye')).toBe('Hi bye');
  });

  it('isGenericTitle rejects junk', () => {
    expect(isGenericTitle('test')).toBe(true);
    expect(isGenericTitle('lorem ipsum event')).toBe(true);
    expect(isGenericTitle('Smart India Hackathon')).toBe(false);
  });

  it('normalizeTitleKey is case/punct-insensitive', () => {
    expect(normalizeTitleKey('Hello-World!')).toBe(normalizeTitleKey('hello world'));
  });
});

describe('types SSOT', () => {
  it('toNormalized fills defaults, keeps base', () => {
    const n = toNormalized(
      { type: 'hackathon', title: 'T', description: 'D', url: 'U', source: 'S' },
      { organizer: 'Org' },
    );
    expect(n.title).toBe('T');
    expect(n.organizer).toBe('Org');
    expect(n.stipend).toBe('');
    expect(n.themes).toEqual([]);
    expect(n.participantsCount).toBe(0);
    expect(n.inviteOnly).toBe(false);
  });

  it('hasValue treats manufactured empties as empty', () => {
    expect(hasValue('')).toBe(false);
    expect(hasValue('[]')).toBe(false);
    expect(hasValue('unknown')).toBe(false);
    expect(hasValue('  ')).toBe(false);
    expect(hasValue('Real')).toBe(true);
    expect(hasValue([])).toBe(false);
    expect(hasValue(['x'])).toBe(true);
  });
});

describe('dedup SSOT', () => {
  it('buildTitleSet dedupes + drops blanks', () => {
    expect(buildTitleSet([opp({ title: 'A' }), opp({ title: 'A' }), opp({ title: '' })])).toEqual([
      'A',
    ]);
  });

  it('dedupInMemory keys on source+normalized title+url', () => {
    const rows = [
      opp({ title: 'Hello World!' }),
      opp({ title: 'hello  world' }),
      opp({ title: 'Other' }),
    ];
    expect(dedupInMemory(rows).map((r) => r.title)).toEqual(['Hello World!', 'Other']);
  });

  it('filterNewByTitleSource drops DB-known titles via injected store', async () => {
    const store = inMemoryDedupStore([{ title: 'Known' }]);
    const rows = [opp({ title: 'Known' }), opp({ title: 'Fresh' })];
    const kept = await filterNewByTitleSource(rows, 'DEVFOLIO', store);
    expect(kept.map((r) => r.title)).toEqual(['Fresh']);
  });

  it('prismaDedupStore issues one title-in query (DIP seam)', async () => {
    const seen: unknown[] = [];
    const fakeModel = {
      findMany: async (args: unknown) => {
        seen.push(args);
        return [{ title: 'Known' }];
      },
    };
    const store = prismaDedupStore(fakeModel);
    const kept = await filterNewByTitleSource([opp({ title: 'Known' }), opp({ title: 'New' })], 'X', store);
    expect(kept.map((r) => r.title)).toEqual(['New']);
    expect(seen).toHaveLength(1);
  });

  it('lib/repository fakes mirror the dedup contract', async () => {
    const mem = inMemoryDedupStore([{ title: 'A' }]);
    expect(await mem.findExistingByTitles(['A', 'B'], 'S')).toEqual(new Set(['A']));
    const calls: unknown[] = [];
    const prismaStore = prismaOpportunityDedupStore({
      findMany: async (args: unknown) => {
        calls.push(args);
        return [{ title: 'A' }];
      },
    });
    expect(await prismaStore.findExistingByTitles(['A'], 'S')).toEqual(new Set(['A']));
    expect(calls).toHaveLength(1);
  });
});

describe('pipeline stages', () => {
  it('fanOut bounds concurrency and isolates failures', async () => {
    let live = 0;
    let maxLive = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      live++;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      if (i === 3) throw new Error('boom');
      return [i];
    });
    const out = await fanOut(tasks, 3);
    expect(maxLive).toBeLessThanOrEqual(3);
    expect(out.sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  });

  it('filterActiveUnique drops ended + dupes', () => {
    const rows = [
      opp({ title: 'Ended Hack', deadline: '2000-01-01' }),
      opp({ title: 'Live Hack', deadline: '' }),
      opp({ title: 'Live Hack', deadline: '' }),
    ];
    expect(filterActiveUnique(rows).map((r) => r.title)).toEqual(['Live Hack']);
  });

  it('chunk splits for bounded writes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('RateLimitGate', () => {
  it('limits until cooldown passes, resets on demand', () => {
    const g = new RateLimitGate(1000);
    expect(g.isLimited()).toBe(false);
    g.markLimited();
    expect(g.isLimited()).toBe(true);
    expect(g.retryAfterMs).toBeGreaterThan(0);
    g.reset();
    expect(g.isLimited()).toBe(false);
  });
});
