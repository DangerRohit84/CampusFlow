// packages/backend/src/routes/codingProblems.ts
// GET /coding-problems/daily — LeetCode daily challenge (20h server cache,
// stale-served with stale:true on upstream failure).
// GET /coding-problems/list  — curated pool (default, in-memory filter) or
// live problemsetQuestionList passthrough (?live=true, 24h param-keyed cache).
// GET /coding-problems/codeforces — official CF problemset.problems proxy
// (12h full-catalog server cache, ?tags=&minRating=&maxRating=&sort=&order=
// &limit=&skip=, in-memory filter+sort, 1req/2s upstream guard, stale+retry).
// GET /coding-problems/sheets — static DSA tracks (Striver A2Z / SDE,
// NeetCode 150 + A2OJ Ladder11/Ladder4, titles+links only, no statements).
// Static import, HTTP-cached (24h), no DB, no upstream, no SourceHealth.
// GET /coding-problems/automark — solved feeds for sheet auto-mark (CF full
// history via user.status + LC recent-20 via recentSubmissionList, both
// 10min per-handle cached, CF through the shared 2s gate). Reads the
// caller's linked handles server-side (no handle params — no spoofing).
// Best-effort 200 always (stale:true or honest error fields — never 500 for
// an upstream blip); CC/HR/GFG honestly omitted (no scrapers, manual only).
//
// Authenticated (authenticate) like /coding-profile: avoids public scrape +
// keeps the per-(IP+user) 20req/10s route limiter meaningful. No DB writes,
// no migration. Every row carries a real link (titleSlug for LeetCode,
// contestId/index for CF, sourceUrl for sheets); bad rows are dropped
// service-side (no-fake).
import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import {
  CURATED_PROBLEMS,
  buildCodeforcesParams,
  buildProblemsetVariables,
  curatedTopics,
  filterCuratedProblems,
  loadCodeforcesProblems,
  loadDailyProblem,
  loadLiveProblemList,
  normalizeDifficulty,
} from '../services/codingProblems'
import { loadAutomarkForHandles } from '../services/sheetAutomark'
import prisma from '../config/db'
import { logger } from '../utils/logger'
import { getSheetsSnapshot } from '../data/sheets'

const router = Router()

router.get('/daily', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await loadDailyProblem()
    if (!result.problem) {
      res.status(502).json({ error: result.error || 'Daily challenge unavailable', code: 'UPSTREAM_UNAVAILABLE', stale: false, cachedAt: null, problem: null, source: 'leetcode' })
      return
    }
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600')
    res.json({ problem: result.problem, stale: result.stale, cachedAt: result.cachedAt, source: 'leetcode' })
  } catch (error) {
    logger.error({ err: error }, 'coding-problems daily error')
    res.status(500).json({ error: 'Failed to fetch daily challenge', code: 'INTERNAL', problem: null, stale: false, cachedAt: null, source: 'leetcode' })
  }
})

router.get('/list', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const live = String(req.query.live ?? '').toLowerCase() === 'true' || req.query.live === '1'
    const difficultyRaw = req.query.difficulty != null ? String(req.query.difficulty) : null
    let difficulty: ReturnType<typeof normalizeDifficulty> = null
    if (difficultyRaw && difficultyRaw.trim().toLowerCase() !== 'all') {
      difficulty = normalizeDifficulty(difficultyRaw)
      if (!difficulty) {
        res.status(400).json({ error: 'Invalid difficulty. Allowed: Easy, Medium, Hard' })
        return
      }
    }
    const topicRaw = req.query.topic != null ? String(req.query.topic).trim().toLowerCase() : ''
    const topic = topicRaw && topicRaw !== 'all' ? topicRaw : null
    if (topic && !/^[a-z0-9-]+$/.test(topic)) {
      res.status(400).json({ error: 'Invalid topic slug' })
      return
    }
    const searchRaw = req.query.search != null ? String(req.query.search).trim().slice(0, 100) : ''
    const search = searchRaw || null

    if (!live) {
      // Curated static pool — filtered in-memory, no upstream call.
      const items = filterCuratedProblems(CURATED_PROBLEMS, { topic, difficulty, search })
      res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600')
      res.json({ source: 'curated', items, total: items.length, stale: false, cachedAt: null, topics: curatedTopics() })
      return
    }

    // Live passthrough — one upstream call, 24h param-keyed server cache.
    const vars = buildProblemsetVariables({ limit: req.query.limit, skip: req.query.skip, topic, difficulty: difficultyRaw, search })
    const result = await loadLiveProblemList(vars)
    if (result.error && result.items.length === 0) {
      res.status(502).json({ error: result.error, code: 'UPSTREAM_UNAVAILABLE', source: 'live', items: [], total: 0, stale: false, cachedAt: null })
      return
    }
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600')
    res.json({ source: 'live', items: result.items, total: result.total, stale: result.stale, cachedAt: result.cachedAt })
  } catch (error) {
    logger.error({ err: error }, 'coding-problems list error')
    res.status(500).json({ error: 'Failed to fetch problems', code: 'INTERNAL', source: 'curated', items: [], total: 0, stale: false, cachedAt: null })
  }
})

router.get('/codeforces', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    let params
    try {
      params = buildCodeforcesParams({
        tags: req.query.tags ?? req.query.tag,
        minRating: req.query.minRating,
        maxRating: req.query.maxRating,
        sort: req.query.sort,
        order: req.query.order,
        limit: req.query.limit,
        skip: req.query.skip,
      })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || 'Invalid Codeforces query'), code: 'BAD_REQUEST', source: 'codeforces', items: [], total: 0, stale: false, cachedAt: null })
      return
    }
    const result = await loadCodeforcesProblems(params)
    if (result.rateLimited && result.items.length === 0) {
      res.set('Retry-After', '2')
      res.status(429).json({ error: result.error || 'Codeforces is rate-limiting — retry shortly.', code: 'RATE_LIMITED', retryAfterSec: 2, source: 'codeforces', items: [], total: 0, stale: false, cachedAt: null })
      return
    }
    if (result.error && result.items.length === 0) {
      res.status(502).json({ error: result.error, code: 'UPSTREAM_UNAVAILABLE', source: 'codeforces', items: [], total: 0, stale: false, cachedAt: null })
      return
    }
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600')
    res.json({ source: 'codeforces', items: result.items, total: result.total, stale: result.stale, cachedAt: result.cachedAt })
  } catch (error) {
    logger.error({ err: error }, 'coding-problems codeforces error')
    res.status(500).json({ error: 'Failed to fetch Codeforces problems', code: 'INTERNAL', source: 'codeforces', items: [], total: 0, stale: false, cachedAt: null })
  }
})

router.get('/sheets', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    // Static import — no upstream, no DB. 24h HTTP cache (moves only on deploy).
    const snap = getSheetsSnapshot()
    res.set('Cache-Control', 'private, max-age=86400, stale-while-revalidate=3600')
    res.json(snap)
  } catch (error) {
    logger.error({ err: error }, 'coding-problems sheets error')
    res.status(500).json({ error: 'Failed to load sheets', code: 'INTERNAL', source: 'static', tracks: [], totalTracks: 0, totalProblems: 0, cachedAt: null })
  }
})

router.get('/automark', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Linked handles only (no query params — avoids handle spoofing + keeps
    // the per-(IP+user) limiter meaningful). Missing profile/handles yield
    // empty solved (null handles), never 404 — the tab renders manual-only.
    let cfHandle: string | null = null
    let lcHandle: string | null = null
    try {
      const profile = await (prisma as any).codingProfile.findUnique({ where: { userId: req.userId! } })
      cfHandle = (profile as any)?.codeforcesHandle ?? null
      lcHandle = (profile as any)?.leetcodeHandle ?? null
    } catch {
      // Pre-migration / DB blip — fall through with null handles (manual-only).
      cfHandle = null
      lcHandle = null
    }
    const snap = await loadAutomarkForHandles({ cfHandle, lcHandle })
    if (snap.cf.rateLimited) res.set('Retry-After', '2')
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
    res.json({
      cf: snap.cf,
      lc: snap.lc,
      omitted: ['codechef', 'hackerrank', 'gfg'],
      omittedReason: 'No public solved API — CodeChef/HackerRank/GFG sheets stay manual-only (no scrapers).',
    })
  } catch (error) {
    logger.error({ err: error }, 'coding-problems automark error')
    res.status(500).json({ error: 'Failed to load auto-marks', code: 'INTERNAL', cf: { handle: null, solvedKeys: [], stale: false, cachedAt: null }, lc: { handle: null, solved: [], stale: false, cachedAt: null }, omitted: ['codechef', 'hackerrank', 'gfg'] })
  }
})

export default router
