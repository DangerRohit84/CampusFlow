/**
 * P1 structural — design-proof tests (TDD GREEN for plan-cost-speed-stability P1).
 *
 * Covers (all additive / fail-open contracts):
 *  1. syncWatermark: fingerprint stability, skip allow-list (miss/dirty/
 *     invalid/expired → full), contest hash order-insensitivity, status
 *     grouping, store round-trip + fail-open.
 *  2. fetchState: opportunity hash dedup correctness, conditional headers,
 *     validator parsing, platform-save gate + every-4th-full rotation,
 *     enrich content gate, store round-trips.
 *  3. aiCache: model routing (20b extraction / 120b chat / qwen vision),
 *     prompt-hash stability, key sanitization, kill-switch, batch ×10 with
 *     cache-aware gaps, response-cache hit (mocked Groq, 0 network).
 *  4. singleflight: key bounds, in-process coalescing (N concurrent → 1
 *     load), no long memo, error propagation, Redis lock path (FakeRedis).
 *  5. stream: topic allow-list, SSE wire format, headers, payload hash,
 *     router mount (static).
 *  6. platformStats memo: generational isolation, validity-tiered memo.
 *  7. Watermark-gated syncUserContests (hermetic: mocked DB + fetchers):
 *     HIT = 0 external calls; MISS/dirty/manual = full volume.
 *  8. Kill-switch in isEnrichmentAIDisabled.
 *
 * Hermetic: no network, no DB. Follows db-batch-writes mock pattern
 * (mock consts BEFORE the static imports that trigger them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ---- Fakes (must precede the static imports that trigger mock factories) ----
const mockProfileFindUnique = vi.fn()
const mockProfileUpdate = vi.fn()
const mockContestFindMany = vi.fn()
const mockPartFindMany = vi.fn()
const mockPartCreateMany = vi.fn()
const mockPartUpdate = vi.fn()
const mockQueryRaw = vi.fn(async () => [{ acquired: true }])
const mockFetchAll = vi.fn()
const mockFetchStats = vi.fn()
const mockCodingDaily = vi.fn()
const mockGithubDaily = vi.fn()
const mockSaveActivity = vi.fn()
const mockChatCompletion = vi.fn()

vi.mock('../src/config/db', () => ({
  __esModule: true,
  default: {
    get codingProfile() {
      return { findUnique: mockProfileFindUnique, update: mockProfileUpdate }
    },
    get codingContest() {
      return { findMany: mockContestFindMany }
    },
    get contestParticipation() {
      return { findMany: mockPartFindMany, createMany: mockPartCreateMany, update: mockPartUpdate }
    },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
}))

vi.mock('../src/services/platformFetchers', () => ({
  fetchAllPlatforms: (...args: any[]) => mockFetchAll(...args),
}))

vi.mock('../src/services/platformStats', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/services/platformStats')>()
  return { ...orig, fetchAllPlatformStats: (...args: any[]) => mockFetchStats(...args) }
})

vi.mock('../src/services/codingActivity', () => ({
  fetchCodingDailyForProfile: (...args: any[]) => mockCodingDaily(...args),
  fetchGithubDailyBestEffort: (...args: any[]) => mockGithubDaily(...args),
  saveCodingActivity: (...args: any[]) => mockSaveActivity(...args),
  ACTIVITY_WINDOW_DAYS: 365,
}))

vi.mock('../src/ai/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/ai/client')>()
  return { ...orig, chatCompletion: (...args: any[]) => mockChatCompletion(...args) }
})

vi.mock('../src/services/ai-manager', () => ({
  getProvidersForFeature: async () => [],
}))

import { __resetCacheForTests, cache } from '../src/lib/cache'
import { __resetRedisForTests, __setRedisClientForTests, type RedisLike } from '../src/lib/redis'
import { __resetSyncEngineForTests, syncUserContests } from '../src/services/syncEngine'
import {
  handlesFingerprint,
  statsPayloadHash,
  hasValidStats,
  syncWatermarkKey,
  contestListWatermarkKey,
  getSyncWatermark,
  setSyncWatermark,
  shouldSkipProfileSync,
  contestListHash,
  getContestListWatermark,
  setContestListWatermark,
  shouldSkipContestLoop,
  groupContestStatuses,
  VALID_STATS_RECHECK_MS,
  type SyncWatermark,
} from '../src/services/syncWatermark'
import {
  platformFetchStateKey,
  pageFetchStateKey,
  enrichContentKey,
  hashOpportunities,
  contentHash,
  conditionalHeaders,
  validatorsFromHeaders,
  getPlatformFetchState,
  setPlatformFetchState,
  shouldSkipPlatformSave,
  isFullFetchRun,
  nextOppRunIndex,
  getEnrichContentHash,
  setEnrichContentHash,
  shouldSkipEnrichForContent,
  OPP_FULL_FETCH_EVERY_N_RUNS,
} from '../src/services/opportunities/fetchState'
import {
  modelForFeature,
  enrichPromptHash,
  enrichResponseKey,
  isAiKillSwitchOn,
  getCachedEnrichResponse,
  setCachedEnrichResponse,
  enrichmentCompletion,
  processEnrichBatch,
  ENRICHMENT_MODEL_20B,
  CHAT_MODEL_120B,
  VISION_MODEL_QWEN,
  ENRICH_PROMPT_VERSION,
  ENRICH_SYSTEM_PREFIX_V1,
} from '../src/services/aiCache'
import {
  singleflight,
  memoizedSingleflight,
  singleflightLockKey,
  singleflightResultKey,
  __resetExternalSingleflightForTests,
} from '../src/lib/singleflight'
import {
  isAllowedStreamTopic,
  formatSseEvent,
  sseHeaders,
  streamPayloadHash,
  STREAM_TOPICS,
} from '../src/routes/stream'
import { statsMemoKey, __clearStatsCacheForTests } from '../src/services/platformStats'
import { isEnrichmentAIDisabled } from '../src/services/opportunities/errors'
import { buildHackathonEnrichPrompt, buildInternshipEnrichPrompt } from '../src/services/opportunities/stagesPrompt'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

let savedKillSwitch: string | undefined
let savedRedisUrl: string | undefined
let savedGroqKey: string | undefined
beforeEach(() => {
  savedKillSwitch = process.env.AI_KILL_SWITCH
  savedRedisUrl = process.env.REDIS_URL
  savedGroqKey = process.env.GROQ_API_KEY
  delete process.env.AI_KILL_SWITCH
  __resetRedisForTests()
  __resetCacheForTests()
  __resetExternalSingleflightForTests()
  __resetSyncEngineForTests()
  __clearStatsCacheForTests()
  vi.clearAllMocks()
  mockProfileFindUnique.mockResolvedValue(null)
  mockProfileUpdate.mockResolvedValue({})
  mockContestFindMany.mockResolvedValue([])
  mockPartFindMany.mockResolvedValue([])
  mockPartCreateMany.mockResolvedValue({ count: 0 })
  mockPartUpdate.mockResolvedValue({})
  mockQueryRaw.mockResolvedValue([{ acquired: true }])
  mockFetchAll.mockResolvedValue([])
  mockFetchStats.mockResolvedValue([])
  mockCodingDaily.mockResolvedValue({})
  mockGithubDaily.mockResolvedValue([])
  mockSaveActivity.mockResolvedValue(undefined)
  mockChatCompletion.mockResolvedValue('{"description":"mocked"}')
})
afterEach(() => {
  if (savedKillSwitch === undefined) delete process.env.AI_KILL_SWITCH
  else process.env.AI_KILL_SWITCH = savedKillSwitch
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = savedRedisUrl
  if (savedGroqKey === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = savedGroqKey
  __resetRedisForTests()
  __resetCacheForTests()
  __resetExternalSingleflightForTests()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 1. syncWatermark
// ---------------------------------------------------------------------------

describe('P1 syncWatermark — handles fingerprint', () => {
  it('is stable for identical profiles (case/whitespace-insensitive)', () => {
    const a = { leetcodeHandle: 'Tourist', codeforcesHandle: '  BENQ ', githubUsername: null }
    const b = { leetcodeHandle: 'tourist', codeforcesHandle: 'benq', githubUsername: null }
    expect(handlesFingerprint(a)).toBe(handlesFingerprint(b))
  })

  it('changes on any handle set/cleared/edited (per-handle dirty bit)', () => {
    const base = { leetcodeHandle: 'a', codeforcesHandle: 'b', codechefHandle: null, hackerrankHandle: null, gfgHandle: null, githubUsername: null }
    const h0 = handlesFingerprint(base)
    expect(handlesFingerprint({ ...base, leetcodeHandle: 'a2' })).not.toBe(h0)
    expect(handlesFingerprint({ ...base, codeforcesHandle: null })).not.toBe(h0)
    expect(handlesFingerprint({ ...base, githubUsername: 'new' })).not.toBe(h0)
  })

  it('never throws on null/garbage (fail-open fingerprint)', () => {
    expect(() => handlesFingerprint(null)).not.toThrow()
    expect(() => handlesFingerprint(undefined)).not.toThrow()
    expect(typeof handlesFingerprint(null)).toBe('string')
  })
})

describe('P1 syncWatermark — skip allow-list (fallback full on miss)', () => {
  const profile = { leetcodeHandle: 'tourist', codeforcesHandle: null, codechefHandle: null, hackerrankHandle: null, gfgHandle: null, githubUsername: null }
  const freshValid = (): SyncWatermark => ({
    handlesHash: handlesFingerprint(profile),
    valid: true,
    statsHash: 'abc',
    at: Date.now(),
  })

  it('HIT: same handles + valid + fresh → skip', () => {
    expect(shouldSkipProfileSync(profile, freshValid(), Date.now())).toBe(true)
  })

  it('MISS (null/corrupt) → full (never skips)', () => {
    expect(shouldSkipProfileSync(profile, null, Date.now())).toBe(false)
    expect(shouldSkipProfileSync(profile, undefined, Date.now())).toBe(false)
    expect(shouldSkipProfileSync(profile, { valid: true, at: Date.now() } as any, Date.now())).toBe(false)
  })

  it('dirty handles → full', () => {
    const wm = freshValid()
    expect(shouldSkipProfileSync({ ...profile, leetcodeHandle: 'other' }, wm, Date.now())).toBe(false)
  })

  it('prior invalid → full (invalid needs retry, not skip)', () => {
    expect(shouldSkipProfileSync(profile, { ...freshValid(), valid: false }, Date.now())).toBe(false)
  })

  it('expired (>6h) → full; future-dated → full', () => {
    expect(shouldSkipProfileSync(profile, { ...freshValid(), at: Date.now() - VALID_STATS_RECHECK_MS - 1000 }, Date.now())).toBe(false)
    expect(shouldSkipProfileSync(profile, { ...freshValid(), at: Date.now() + 60_000 }, Date.now() + 1000)).toBe(false)
  })

  it('store round-trip + corrupt entry → null (fallback full)', async () => {
    await setSyncWatermark('u-wm-1', freshValid())
    const hit = await getSyncWatermark('u-wm-1')
    expect(hit?.valid).toBe(true)
    expect(await getSyncWatermark('u-wm-missing')).toBeNull()
    await cache.set(syncWatermarkKey('u-wm-bad'), 'not-an-object' as any)
    expect(await getSyncWatermark('u-wm-bad')).toBeNull()
  })

  it('hasValidStats + statsPayloadHash behave (validity signal)', () => {
    expect(hasValidStats([{ valid: false }, { valid: true }])).toBe(true)
    expect(hasValidStats([{ valid: false }])).toBe(false)
    expect(hasValidStats([])).toBe(false)
    expect(hasValidStats(null)).toBe(false)
    expect(statsPayloadHash([{ a: 1 }])).toBe(statsPayloadHash([{ a: 1 }]))
    expect(statsPayloadHash([{ a: 1 }])).not.toBe(statsPayloadHash([{ a: 2 }]))
  })
})

describe('P1 syncWatermark — contest list gate + batched sweep', () => {
  const rows = [
    { platform: 'LEETCODE', url: 'https://leetcode.com/contest/1/', startTime: '2026-09-20T10:00:00.000Z', title: 'Weekly 1' },
    { platform: 'CODEFORCES', url: 'https://codeforces.com/contest/2', startTime: '2026-09-21T10:00:00.000Z', title: 'Round 2' },
  ]

  it('contestListHash is order-insensitive (field parity: same rows any order → same hash)', () => {
    expect(contestListHash(rows)).toBe(contestListHash([...rows].reverse()))
    expect(contestListHash(rows)).not.toBe(contestListHash([...rows, { platform: 'LEETCODE', url: 'https://x/', startTime: '2026-01-01T00:00:00.000Z', title: 'New' }]))
    expect(typeof contestListHash([])).toBe('string')
  })

  it('shouldSkipContestLoop: match+fresh → true; miss/mismatch/expired/error-hash → false', () => {
    const h = contestListHash(rows)
    const now = Date.now()
    expect(shouldSkipContestLoop(h, { listHash: h, at: now }, now)).toBe(true)
    expect(shouldSkipContestLoop(h, null, now)).toBe(false)
    expect(shouldSkipContestLoop(h, { listHash: 'other', at: now }, now)).toBe(false)
    expect(shouldSkipContestLoop(h, { listHash: h, at: now - 6 * 60 * 60 * 1000 - 1 }, now)).toBe(false)
    expect(shouldSkipContestLoop('error', { listHash: 'error', at: now }, now)).toBe(false)
  })

  it('contest watermark store round-trip (miss → null = full loop)', async () => {
    expect(await getContestListWatermark()).toBeNull()
    await setContestListWatermark({ listHash: 'h1', at: Date.now(), fetched: 1, updated: 2 })
    expect((await getContestListWatermark())?.listHash).toBe('h1')
    expect(contestListWatermarkKey()).toBe('sync:contest-list:wm')
  })

  it('groupContestStatuses buckets by time-correct status and skips already-correct + unparseable', () => {
    const now = new Date('2026-09-14T12:00:00.000Z').getTime()
    const groups = groupContestStatuses(
      [
        { id: 'up', startTime: '2026-09-20T10:00:00.000Z', duration: 120, status: 'ENDED' }, // wrong → UPCOMING
        { id: 'on', startTime: '2026-09-14T11:00:00.000Z', duration: 120, status: 'UPCOMING' }, // wrong → ONGOING
        { id: 'end', startTime: '2026-09-01T10:00:00.000Z', duration: 60, status: 'UPCOMING' }, // wrong → ENDED
        { id: 'ok', startTime: '2026-09-20T10:00:00.000Z', duration: 120, status: 'UPCOMING' }, // already correct → excluded
        { id: 'bad', startTime: 'not-a-date', duration: 60, status: 'UPCOMING' }, // unparseable
      ],
      now,
    )
    expect(groups.UPCOMING).toEqual(['up'])
    expect(groups.ONGOING).toEqual(['on'])
    expect(groups.ENDED).toEqual(['end'])
    expect(groups.unparseable).toEqual(['bad'])
  })
})

// ---------------------------------------------------------------------------
// 2. fetchState
// ---------------------------------------------------------------------------

describe('P1 fetchState — opportunity hash dedup correctness', () => {
  const items = [
    { title: 'Hack Night', url: 'https://a.example.com/1', deadline: '2026-10-01' },
    { title: ' Code Sprint ', url: 'HTTPS://B.EXAMPLE.COM/2', deadline: '' },
  ]

  it('order/case/whitespace-insensitive; any real change flips the hash', () => {
    expect(hashOpportunities(items)).toBe(hashOpportunities([...items].reverse()))
    expect(hashOpportunities(items)).toBe(hashOpportunities(items.map((o) => ({ ...o, title: o.title.toLowerCase().trim() }))))
    expect(hashOpportunities(items)).not.toBe(hashOpportunities([...items, { title: 'New', url: 'https://c/', deadline: '' }]))
    expect(hashOpportunities(items)).not.toBe(hashOpportunities(items.map((o, i) => (i === 0 ? { ...o, url: 'https://other/' } : o))))
  })

  it('contentHash deterministic; keys tenant-free and hashed (no raw URLs)', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
    expect(pageFetchStateKey('https://example.com/some-long-path?q=1')).not.toContain('example.com')
    expect(platformFetchStateKey('devfolio')).toBe('opp:fetch:DEVFOLIO')
    expect(enrichContentKey('id-1')).toBe('enrich:content:id-1')
  })

  it('conditionalHeaders sends stored validators only (fail-open {})', () => {
    expect(conditionalHeaders({ etag: '"v1"', lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT', at: 1 })).toEqual({
      'If-None-Match': '"v1"',
      'If-Modified-Since': 'Wed, 01 Jan 2026 00:00:00 GMT',
    })
    expect(conditionalHeaders(null)).toEqual({})
    expect(conditionalHeaders({ at: 1 })).toEqual({})
  })

  it('validatorsFromHeaders parses Headers-like + record + null (never throws)', () => {
    expect(validatorsFromHeaders({ get: (n: string) => (n === 'etag' ? '"a"' : n === 'last-modified' ? 'Wed' : null) })).toEqual({ etag: '"a"', lastModified: 'Wed' })
    expect(validatorsFromHeaders({ ETag: '"b"', 'Last-Modified': 'Thu' })).toEqual({ etag: '"b"', lastModified: 'Thu' })
    expect(validatorsFromHeaders(null)).toEqual({ etag: null, lastModified: null })
    expect(validatorsFromHeaders({ get: () => { throw new Error('x') } })).toEqual({ etag: null, lastModified: null })
  })
})

describe('P1 fetchState — gates + rotation + stores', () => {
  it('shouldSkipPlatformSave: match → true; miss/mismatch/forceFull/error → false (fallback full)', () => {
    expect(shouldSkipPlatformSave('h', { hash: 'h', at: 1 }, false)).toBe(true)
    expect(shouldSkipPlatformSave('h', null, false)).toBe(false)
    expect(shouldSkipPlatformSave('h', { hash: 'other', at: 1 }, false)).toBe(false)
    expect(shouldSkipPlatformSave('h', { hash: 'h', at: 1 }, true)).toBe(false)
    expect(shouldSkipPlatformSave('error', { hash: 'error', at: 1 }, false)).toBe(false)
  })

  it(`every-4th run forces full (rotation = ${OPP_FULL_FETCH_EVERY_N_RUNS})`, () => {
    expect(OPP_FULL_FETCH_EVERY_N_RUNS).toBe(4)
    expect(isFullFetchRun(3)).toBe(true)
    expect(isFullFetchRun(7)).toBe(true)
    expect(isFullFetchRun(0)).toBe(false)
    expect(isFullFetchRun(1)).toBe(false)
    expect(isFullFetchRun(4)).toBe(false)
    expect(isFullFetchRun(NaN)).toBe(true) // fail-open full
  })

  it('nextOppRunIndex increments (fail-open number)', async () => {
    const a = await nextOppRunIndex()
    const b = await nextOppRunIndex()
    expect(a).toBeGreaterThanOrEqual(1)
    expect(b).toBe(a + 1)
  })

  it('platform state round-trip + miss → null', async () => {
    expect(await getPlatformFetchState('DEVFOLIO')).toBeNull()
    await setPlatformFetchState('DEVFOLIO', { hash: 'h', at: Date.now(), count: 3 })
    expect((await getPlatformFetchState('DEVFOLIO'))?.hash).toBe('h')
  })

  it('shouldSkipEnrichForContent: match → true; miss/mismatch/error → false (enrich)', () => {
    expect(shouldSkipEnrichForContent('h', 'h')).toBe(true)
    expect(shouldSkipEnrichForContent('h', null)).toBe(false)
    expect(shouldSkipEnrichForContent('h', 'other')).toBe(false)
    expect(shouldSkipEnrichForContent('error', 'error')).toBe(false)
  })

  it('enrich content hash round-trip', async () => {
    expect(await getEnrichContentHash('staging-1')).toBeNull()
    await setEnrichContentHash('staging-1', 'ch')
    expect(await getEnrichContentHash('staging-1')).toBe('ch')
  })
})

// ---------------------------------------------------------------------------
// 3. aiCache
// ---------------------------------------------------------------------------

describe('P1 aiCache — model routing (20b extraction, 120b chat, qwen vision)', () => {
  it('routes extraction to 20b, chat to 120b, vision to qwen (never throws)', () => {
    expect(modelForFeature('enrichment')).toBe(ENRICHMENT_MODEL_20B)
    expect(modelForFeature('ats-score')).toBe(ENRICHMENT_MODEL_20B)
    expect(modelForFeature('enrichment:hackathon')).toBe(ENRICHMENT_MODEL_20B)
    expect(modelForFeature('chat')).toBe(CHAT_MODEL_120B)
    expect(modelForFeature('study-plan')).toBe(CHAT_MODEL_120B)
    expect(modelForFeature('resume-vision')).toBe(VISION_MODEL_QWEN)
    expect(modelForFeature('vision-parse')).toBe(VISION_MODEL_QWEN)
    expect(modelForFeature('')).toBe(CHAT_MODEL_120B)
    expect(modelForFeature(null as any)).toBe(CHAT_MODEL_120B)
  })
})

describe('P1 aiCache — prompt hash + response key', () => {
  it('enrichPromptHash stable per prompt, distinct per content, versioned input', () => {
    expect(enrichPromptHash('a')).toBe(enrichPromptHash('a'))
    expect(enrichPromptHash('a')).not.toBe(enrichPromptHash('b'))
    expect(ENRICH_PROMPT_VERSION).toBe('v1')
    expect(ENRICH_SYSTEM_PREFIX_V1.length).toBeGreaterThan(0)
  })

  it('enrichResponseKey sanitizes model slashes (valid Redis key)', () => {
    const k = enrichResponseKey('openai/gpt-oss-20b', 'abc123')
    expect(k).not.toContain('/')
    expect(k).toContain('abc123')
    expect(k.startsWith('enrich:response:')).toBe(true)
  })

  it('frozen prefix is byte-first in both enrich prompts (prefix-cache hits)', () => {
    const hp = buildHackathonEnrichPrompt({ scrapedHints: 'Title: X', contentSection: 'desc' })
    const ip = buildInternshipEnrichPrompt({ scrapedHints: 'Title: Y', contentForPrompt: 'desc' })
    expect(hp.startsWith(ENRICH_SYSTEM_PREFIX_V1)).toBe(true)
    expect(ip.startsWith(ENRICH_SYSTEM_PREFIX_V1)).toBe(true)
    // Field parity after reorder (solid-all substring contracts hold).
    expect(hp).toContain('TIMELINE and ROUNDS are INDEPENDENT')
    expect(ip).toContain('NEVER fabricate dates')
    expect(hp).toContain('Title: X')
    expect(ip).toContain('Title: Y')
  })
})

describe('P1 aiCache — kill-switch (preserved breaker path when OFF)', () => {
  it('OFF by default → not killed; ON → killed without touching Groq', async () => {
    expect(isAiKillSwitchOn()).toBe(false)
    const ok = await enrichmentCompletion('prompt-a', { temperature: 0.1, max_tokens: 10 })
    expect(ok.killed).toBe(false)
    expect(typeof ok.text).toBe('string')
    process.env.AI_KILL_SWITCH = 'true'
    expect(isAiKillSwitchOn()).toBe(true)
    const killed = await enrichmentCompletion('prompt-a', { temperature: 0.1, max_tokens: 10 })
    expect(killed).toMatchObject({ text: '', cached: false, killed: true })
    expect(await isEnrichmentAIDisabled()).toBe(true) // enrich keeps deterministic path
  })
})

describe('P1 aiCache — 24h response cache + 20b routing (mocked Groq)', () => {
  it('MISS calls Groq once with the 20b model; repeat HIT calls 0 (same prompt+model)', async () => {
    const first = await enrichmentCompletion('unique-prompt-1', { temperature: 0.1, max_tokens: 10 })
    expect(first.cached).toBe(false)
    expect(first.killed).toBe(false)
    expect(first.model).toBe(ENRICHMENT_MODEL_20B)
    expect(mockChatCompletion).toHaveBeenCalledTimes(1)
    expect((mockChatCompletion.mock.calls[0][2] as any)?.model).toBe(ENRICHMENT_MODEL_20B)
    const second = await enrichmentCompletion('unique-prompt-1', { temperature: 0.1, max_tokens: 10 })
    expect(second.cached).toBe(true)
    expect(second.text).toBe(first.text)
    expect(mockChatCompletion).toHaveBeenCalledTimes(1)
  })

  it('different prompt → different cache entry (no cross-talk)', async () => {
    await enrichmentCompletion('unique-prompt-2', { temperature: 0.1, max_tokens: 10 })
    expect(mockChatCompletion).toHaveBeenCalledTimes(1)
    expect(await getCachedEnrichResponse(ENRICHMENT_MODEL_20B, enrichPromptHash('unique-prompt-2'))).toBe('{"description":"mocked"}')
  })

  it('empty Groq text is never cached (outage must retry, fail-open)', async () => {
    mockChatCompletion.mockResolvedValueOnce('')
    const r = await enrichmentCompletion('unique-prompt-3', { temperature: 0.1, max_tokens: 10 })
    expect(r.text).toBe('')
    expect(r.cached).toBe(false)
    expect(await getCachedEnrichResponse(r.model, enrichPromptHash('unique-prompt-3'))).toBeNull()
  })
})

describe('P1 aiCache — batch ×10 with cache-aware gaps', () => {
  it('empty input → zeros (never throws)', async () => {
    expect(await processEnrichBatch([], async () => {})).toEqual({ enriched: 0, cached: 0, failed: 0 })
    expect(await processEnrichBatch(null as any, async () => {})).toEqual({ enriched: 0, cached: 0, failed: 0 })
  })

  it('windows ×10 in order; gaps only after misses (cached skip the 12s)', async () => {
    const order: string[] = []
    const sleeps: number[] = []
    const kinds: Record<string, 'hit' | 'miss' | 'fail'> = { a: 'miss', b: 'miss', c: 'hit', d: 'miss' }
    const res = await processEnrichBatch(['a', 'b', 'c', 'd'], async (id) => {
      order.push(id)
      const k = kinds[id]
      if (k === 'fail') throw new Error('boom')
      return k === 'hit' ? { cached: true } : { cached: false }
    }, { batchSize: 10, delayMs: 12_000, sleep: async (ms) => { sleeps.push(ms) } })
    expect(order).toEqual(['a', 'b', 'c', 'd'])
    expect(res).toEqual({ enriched: 4, cached: 1, failed: 0 })
    expect(sleeps).toEqual([12_000, 12_000]) // after a, b (misses); c cached skips; d last skips
  })

  it('failures counted, batch continues, never throws', async () => {
    const res = await processEnrichBatch(['x', 'bad', 'y'], async (id) => {
      if (id === 'bad') throw new Error('nope')
      return { cached: false }
    }, { batchSize: 10, delayMs: 0 })
    expect(res).toEqual({ enriched: 2, cached: 0, failed: 1 })
  })

  it('set/get response cache round-trip (24h TTL entry)', async () => {
    expect(await getCachedEnrichResponse('m', 'h-missing')).toBeNull()
    await setCachedEnrichResponse('m', 'h1', '{"a":1}')
    expect(await getCachedEnrichResponse('m', 'h1')).toBe('{"a":1}')
  })
})

// ---------------------------------------------------------------------------
// 4. singleflight
// ---------------------------------------------------------------------------

/** Minimal in-memory RedisLike (SET NX/PX, GET, DEL, PTTL, Lua compare-del). */
class MiniFakeRedis implements RedisLike {
  store = new Map<string, { val: string; exp: number | null }>()
  private read(key: string): string | null {
    const e = this.store.get(key)
    if (!e) return null
    if (e.exp !== null && Date.now() > e.exp) {
      this.store.delete(key)
      return null
    }
    return e.val
  }
  async get(key: string): Promise<string | null> {
    return this.read(key)
  }
  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    let nx = false
    let px: number | null = null
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'NX') nx = true
      if (args[i] === 'PX' && typeof args[i + 1] === 'number') {
        px = args[i + 1] as number
        i++
      }
    }
    if (nx && this.read(key) !== null) return null
    this.store.set(key, { val: value, exp: px !== null ? Date.now() + (px as number) : null })
    return 'OK'
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) if (this.store.delete(k)) n++
    return n
  }
  async incr(key: string): Promise<number> {
    const cur = parseInt(this.read(key) ?? '0', 10) || 0
    const next = cur + 1
    const e = this.store.get(key)
    this.store.set(key, { val: String(next), exp: e?.exp ?? null })
    return next
  }
  async pexpire(key: string, ms: number): Promise<number> {
    const e = this.store.get(key)
    if (!e) return 0
    e.exp = Date.now() + ms
    return 1
  }
  async pttl(key: string): Promise<number> {
    const e = this.store.get(key)
    if (!e) return -2
    if (e.exp === null) return -1
    return Math.max(0, e.exp - Date.now())
  }
  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const key = String(args[0])
    const token = String(args[1])
    if (this.read(key) === token) {
      this.store.delete(key)
      return 1
    }
    return 0
  }
}

describe('P1 singleflight — keys + in-process coalescing', () => {
  it('lock/result keys bounded (truncate pathological keys)', () => {
    const long = 'k'.repeat(500)
    expect(singleflightLockKey(long).length).toBeLessThanOrEqual('lock:sf:'.length + 200)
    expect(singleflightResultKey(long).length).toBeLessThanOrEqual('sf:result:'.length + 200)
    expect(singleflightLockKey('a')).toBe('lock:sf:a')
  })

  it('N concurrent same-key → 1 loader call, all share the value (0 Redis)', async () => {
    let calls = 0
    const loader = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return { v: 42 }
    }
    const results = await Promise.all(Array.from({ length: 10 }, () => singleflight('p1-sf-a', loader)))
    expect(calls).toBe(1)
    for (const r of results) expect(r).toEqual({ v: 42 })
  })

  it('sequential calls reload (no long memo — use memoizedSingleflight for that)', async () => {
    let calls = 0
    await singleflight('p1-sf-b', async () => ++calls)
    await singleflight('p1-sf-b', async () => ++calls)
    expect(calls).toBe(2)
  })

  it('loader errors propagate (never poison; next call retries)', async () => {
    let calls = 0
    await expect(singleflight('p1-sf-c', async () => {
      calls++
      throw new Error('ext down')
    })).rejects.toThrow('ext down')
    await expect(singleflight('p1-sf-c', async () => {
      calls++
      return 'recovered'
    })).resolves.toBe('recovered')
    expect(calls).toBe(2)
  })

  it('memoizedSingleflight caches across sequential calls (fail-open loader on blip)', async () => {
    let calls = 0
    const first = await memoizedSingleflight('p1-sf-memo', 60_000, async () => ++calls)
    const second = await memoizedSingleflight('p1-sf-memo', 60_000, async () => ++calls)
    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(calls).toBe(1)
  })
})

describe('P1 singleflight — Redis lock path (cross-replica logic)', () => {
  it('concurrent same-key with Redis → 1 loader call (loser shares winner result)', async () => {
    __setRedisClientForTests(new MiniFakeRedis())
    let calls = 0
    const loader = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 60))
      return { shared: true }
    }
    const results = await Promise.all([
      singleflight('p1-sf-redis', loader),
      singleflight('p1-sf-redis', loader),
      singleflight('p1-sf-redis', loader),
    ])
    expect(calls).toBe(1)
    for (const r of results) expect(r).toEqual({ shared: true })
    __resetRedisForTests()
  })

  it('waiter timeout → fail-open own load (never blocks past waitMs)', async () => {
    __setRedisClientForTests(new MiniFakeRedis())
    let calls = 0
    const slow = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 400))
      return 'slow'
    }
    // Cross-replica simulation: the second caller lives on ANOTHER replica
    // (fresh in-process map) while the first still holds the Redis lock —
    // loser polls, times out, then fail-open loads (never blocks past waitMs).
    const first = singleflight('p1-sf-w1', slow, { waitMs: 5000, lockTtlMs: 5000 })
    await new Promise((r) => setTimeout(r, 10))
    __resetExternalSingleflightForTests()
    const second = singleflight('p1-sf-w1', slow, { waitMs: 120, pollMs: 20, lockTtlMs: 5000 })
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe('slow')
    expect(b).toBe('slow')
    expect(calls).toBe(2) // loser timed out waiting → own load (fail-open)
    __resetRedisForTests()
  })
})

// ---------------------------------------------------------------------------
// 5. stream (SSE)
// ---------------------------------------------------------------------------

describe('P1 stream — SSE fallback contract', () => {
  it('allow-lists exactly the one-way topics (unknown → 404 downstream)', () => {
    expect(isAllowedStreamTopic('profile-sync')).toBe(true)
    expect(isAllowedStreamTopic('staging-counts')).toBe(true)
    expect(isAllowedStreamTopic('notifications')).toBe(true)
    expect(isAllowedStreamTopic('chat')).toBe(false)
    expect(isAllowedStreamTopic('')).toBe(false)
    expect(isAllowedStreamTopic(null)).toBe(false)
    expect(STREAM_TOPICS).toHaveLength(3)
  })

  it('formats SSE wire events (named event + id + multi-line data)', () => {
    expect(formatSseEvent('profile-sync:done', { status: 'completed' }, 7)).toBe(
      'event: profile-sync:done\nid: 7\ndata: {"status":"completed"}\n\n',
    )
    expect(formatSseEvent('x\ny', 'a\nb')).toBe('event: xy\ndata: a\ndata: b\n\n')
  })

  it('sets non-buffered event-stream headers', () => {
    const h = sseHeaders()
    expect(h['Content-Type']).toBe('text/event-stream')
    expect(h['Cache-Control']).toContain('no-cache')
    expect(h['X-Accel-Buffering']).toBe('no')
  })

  it('payload hash is order-stable and change-sensitive (dirty-flag correctness)', () => {
    expect(streamPayloadHash({ a: 1, b: 2 })).toBe(streamPayloadHash({ b: 2, a: 1 }))
    expect(streamPayloadHash({ a: 1 })).not.toBe(streamPayloadHash({ a: 2 }))
  })

  it('router mounted with auth + rate-limit (static, additive mount)', () => {
    const src = readSrc('index.ts')
    expect(src).toContain("'/api/stream'")
    expect(src).toContain('streamRoutes')
    const stream = readSrc('routes/stream.ts')
    expect(stream).toContain('authenticate')
    expect(stream).toContain('profile-sync:done')
    expect(stream).toContain('staging:counts:updated')
  })
})

// ---------------------------------------------------------------------------
// 6. platformStats memo
// ---------------------------------------------------------------------------

describe('P1 platformStats — generational memo isolation', () => {
  it('memo key carries a generation bumped by the test seam (hermetic)', () => {
    const k1 = statsMemoKey('leetcode', 'Tourist')
    expect(k1).toContain('leetcode:tourist')
    __clearStatsCacheForTests()
    const k2 = statsMemoKey('leetcode', 'Tourist')
    expect(k2).not.toBe(k1)
  })

  it('stats TTL promoted to 5m with validity-tiered memo (static)', () => {
    const src = readSrc('services/platformStats.ts')
    expect(src).toContain('5 * 60_000')
    expect(src).toContain('statsWithSharedMemo')
    expect(src).toContain('memoizedSingleflight')
  })
})

// ---------------------------------------------------------------------------
// 7. Watermark-gated syncUserContests (hermetic behavioral)
// ---------------------------------------------------------------------------

describe('P1 watermark-gated syncUserContests (hermetic)', () => {
  const profileOf = (userId: string, leetcodeHandle: string | null) => ({
    userId,
    leetcodeHandle,
    codeforcesHandle: null,
    codechefHandle: null,
    hackerrankHandle: null,
    gfgHandle: null,
    githubUsername: null,
    lastSyncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  })

  beforeEach(() => {
    mockProfileFindUnique.mockImplementation(async (args: any) => {
      const id = args?.where?.userId
      if (id === 'wmu1') return profileOf('wmu1', 'tourist')
      if (id === 'wmu2') return profileOf('wmu2', 'tourist')
      if (id === 'wmu3') return profileOf('wmu3', 'tourist')
      return null
    })
  })

  it('HIT (seeded valid fresh watermark, same handles) → 0 external calls', async () => {
    const p = profileOf('wmu1', 'tourist')
    await setSyncWatermark('wmu1', {
      handlesHash: handlesFingerprint(p),
      valid: true,
      statsHash: 's',
      at: Date.now(),
    })
    const res = await syncUserContests('wmu1', { useWatermark: true })
    expect(res).toEqual({ synced: 0, platforms: [] })
    expect(mockFetchAll).not.toHaveBeenCalled()
    expect(mockFetchStats).not.toHaveBeenCalled()
    expect(mockCodingDaily).not.toHaveBeenCalled()
    expect(mockGithubDaily).not.toHaveBeenCalled()
  })

  it('MISS (no watermark) → full volume + seeds a valid watermark', async () => {
    mockFetchStats.mockResolvedValue([{ platform: 'leetcode', handle: 'tourist', valid: true }])
    const res = await syncUserContests('wmu2', { useWatermark: true })
    expect(res.synced).toBe(0)
    expect(mockFetchAll).toHaveBeenCalled()
    expect(mockFetchStats).toHaveBeenCalled()
    const wm = await getSyncWatermark('wmu2')
    expect(wm?.valid).toBe(true)
    expect(wm?.handlesHash).toBe(handlesFingerprint(profileOf('wmu2', 'tourist')))
  })

  it('DIRTY (handle changed after seed) → full volume (fallback full)', async () => {
    await setSyncWatermark('wmu3', {
      handlesHash: handlesFingerprint(profileOf('wmu3', 'tourist')),
      valid: true,
      statsHash: 's',
      at: Date.now(),
    })
    mockProfileFindUnique.mockResolvedValueOnce(profileOf('wmu3', 'brand-new-handle'))
    await syncUserContests('wmu3', { useWatermark: true })
    expect(mockFetchAll).toHaveBeenCalled()
    expect(mockFetchStats).toHaveBeenCalled()
  })

  it('manual sync (no flag) with seeded watermark → still full (on-demand freshness)', async () => {
    const p = profileOf('wmu1', 'tourist')
    await setSyncWatermark('wmu1', {
      handlesHash: handlesFingerprint(p),
      valid: true,
      statsHash: 's',
      at: Date.now(),
    })
    await syncUserContests('wmu1')
    expect(mockFetchAll).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 8. errors kill-switch
// ---------------------------------------------------------------------------

describe('P1 errors — kill-switch disables enrichment (deterministic path)', () => {
  it('AI_KILL_SWITCH=true forces disabled even with keys configured', async () => {
    process.env.AI_KILL_SWITCH = 'true'
    process.env.GROQ_API_KEY = 'gsk_test_key_1234567890'
    expect(await isEnrichmentAIDisabled()).toBe(true)
  })
})
