/**
 * DSA Sheets browser — plan §3 (static ordered tracks, manual progress) +
 * A2OJ ladders + auto-mark (§4).
 *
 * Hermetic: static import only — no DB/network. Locks the no-fake contract:
 * every row has title+sourceUrl+topic, order is sane per step/track;
 * LeetCode rows resolve to a slug verified in CURATED_PROBLEMS; Codeforces
 * ladder rows resolve to contestId/index via buildCodeforcesUrl (same join
 * the auto-mark uses) with numeric a2ojDifficulty mapped to Easy/Med/Hard.
 */
import { describe, it, expect } from 'vitest'
import {
  SHEETS,
  SHEETS_CACHE_KEY,
  SHEETS_TTL_MS,
  cfKeyFromUrl,
  getSheetsSnapshot,
  mapA2ojDifficulty,
} from '../src/data/sheets'
import { CURATED_PROBLEMS, buildCodeforcesUrl, isValidSlug } from '../src/services/codingProblems'

const VERIFIED_SLUGS = new Set(CURATED_PROBLEMS.map((p) => p.titleSlug))
const LC_PREFIX = 'https://leetcode.com/problems/'
const SLUG_FROM_URL = /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/$/
const CF_PREFIX = 'https://codeforces.com/problemset/problem/'
const LC_TRACKS = new Set(['striver-a2z', 'striver-sde', 'neetcode-150'])
const LADDER_TRACKS = new Set(['a2oj-ladder11', 'a2oj-ladder4'])

describe('sheets seed shape (5 static tracks)', () => {
  it('exposes Striver A2Z + SDE + NeetCode 150 + A2OJ Ladder11 + Ladder4 with unique ids', () => {
    expect(SHEETS.map((t) => t.id).sort()).toEqual([
      'a2oj-ladder11',
      'a2oj-ladder4',
      'neetcode-150',
      'striver-a2z',
      'striver-sde',
    ])
    for (const t of SHEETS) {
      expect(t.name.trim().length).toBeGreaterThan(0)
      if (LADDER_TRACKS.has(t.id)) expect(t.steps.length).toBe(4)
      else expect(t.steps.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('carries a credit line + https source link + original count per track', () => {
    for (const t of SHEETS) {
      expect(t.credit.trim().length).toBeGreaterThan(20)
      expect(t.credit).toMatch(/titles \+ links only/i)
      expect(t.sourceName.trim().length).toBeGreaterThan(0)
      expect(t.sourceUrl.startsWith('https://')).toBe(true)
      expect(t.originalCount).toBeGreaterThanOrEqual(t.steps.reduce((n, s) => n + s.items.length, 0))
    }
  })

  it('ladder tracks credit the A2OJ archive (not Striver/NeetCode)', () => {
    for (const t of SHEETS) {
      if (!LADDER_TRACKS.has(t.id)) continue
      expect(t.credit).toMatch(/A2OJ/i)
      expect(t.sourceUrl.startsWith('https://')).toBe(true)
    }
    const l11 = SHEETS.find((t) => t.id === 'a2oj-ladder11')!
    const l4 = SHEETS.find((t) => t.id === 'a2oj-ladder4')!
    expect(l11.name).toMatch(/1300/)
    expect(l11.originalCount).toBe(100)
    expect(l4.name).toMatch(/Div\.2 A/)
    expect(l4.originalCount).toBe(100)
  })

  it('holds a useful browser seed (LC subset + full 100-problem ladders)', () => {
    const snap = getSheetsSnapshot(() => 1_000_000)
    expect(snap.totalTracks).toBe(5)
    expect(snap.source).toBe('static')
    expect(snap.totalProblems).toBe(292)
    for (const t of SHEETS) {
      const n = t.steps.reduce((acc, s) => acc + s.items.length, 0)
      if (LADDER_TRACKS.has(t.id)) expect(n).toBe(100)
      else expect(n).toBeGreaterThanOrEqual(15)
    }
  })

  it('chunks each ladder into 4 steps of 25 (Part 1–4)', () => {
    for (const t of SHEETS) {
      if (!LADDER_TRACKS.has(t.id)) continue
      expect(t.steps.map((s) => s.items.length)).toEqual([25, 25, 25, 25])
      expect(t.steps.map((s) => s.order)).toEqual([1, 2, 3, 4])
    }
  })

  it('publishes a 24h static cache contract (v2 — ladder payload)', () => {
    expect(SHEETS_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(SHEETS_CACHE_KEY).toContain('sheets')
    expect(SHEETS_CACHE_KEY).toBe('coding-problems:sheets:v2')
  })
})

describe('sheets seed integrity (every row: title + sourceUrl + topic)', () => {
  it('every row has a non-empty title, topic slug and Easy/Medium/Hard difficulty', () => {
    for (const t of SHEETS) {
      for (const s of t.steps) {
        for (const r of s.items) {
          expect(r.title.trim().length).toBeGreaterThan(0)
          expect(r.topic.trim().length).toBeGreaterThan(0)
          expect(/^[a-z0-9-]+$/.test(r.topic)).toBe(true)
          expect(['Easy', 'Medium', 'Hard']).toContain(r.difficulty)
        }
      }
    }
  })

  it('every LeetCode sourceUrl is a VERIFIED slug link (no invented problems)', () => {
    for (const t of SHEETS) {
      if (!LC_TRACKS.has(t.id)) continue
      for (const s of t.steps) {
        for (const r of s.items) {
          expect(r.sourceUrl.startsWith(LC_PREFIX)).toBe(true)
          const m = r.sourceUrl.match(SLUG_FROM_URL)
          expect(m).not.toBeNull()
          const slug = m![1]
          expect(isValidSlug(slug)).toBe(true)
          expect(VERIFIED_SLUGS.has(slug)).toBe(true)
          expect(r.cfKey).toBeUndefined()
          expect(r.a2ojDifficulty).toBeUndefined()
        }
      }
    }
  })

  it('every ladder sourceUrl is a real CF problemset link matching its cfKey (no invented problems)', () => {
    for (const t of SHEETS) {
      if (!LADDER_TRACKS.has(t.id)) continue
      for (const s of t.steps) {
        for (const r of s.items) {
          expect(r.sourceUrl.startsWith(CF_PREFIX)).toBe(true)
          expect(r.sourceUrl.startsWith('https://')).toBe(true)
          // cfKey ↔ URL ↔ builder all agree (same join the auto-mark uses).
          const key = cfKeyFromUrl(r.sourceUrl)
          expect(key).not.toBeNull()
          expect(key).toBe(r.cfKey)
          const [cidRaw, idx] = r.cfKey!.split('-')
          expect(buildCodeforcesUrl(parseInt(cidRaw, 10), idx)).toBe(r.sourceUrl)
          // Original numeric kept + mapped band honestly.
          expect(Number.isInteger(r.a2ojDifficulty)).toBe(true)
          expect(r.a2ojDifficulty!).toBeGreaterThanOrEqual(1)
          expect(r.a2ojDifficulty!).toBeLessThanOrEqual(8)
          expect(r.difficulty).toBe(mapA2ojDifficulty(r.a2ojDifficulty!))
          expect(r.topic).toBe('codeforces')
        }
      }
    }
  })

  it('ladder cfKeys are unique within each track (cross-track overlap is expected)', () => {
    for (const t of SHEETS) {
      if (!LADDER_TRACKS.has(t.id)) continue
      const keys = new Set<string>()
      for (const s of t.steps) {
        for (const r of s.items) {
          expect(keys.has(r.cfKey!)).toBe(false)
          keys.add(r.cfKey!)
        }
      }
      expect(keys.size).toBe(100)
    }
  })

  it('locks the numeric → Easy/Medium/Hard mapping (1-2 Easy, 3-5 Medium, 6+ Hard)', () => {
    expect(mapA2ojDifficulty(1)).toBe('Easy')
    expect(mapA2ojDifficulty(2)).toBe('Easy')
    expect(mapA2ojDifficulty(3)).toBe('Medium')
    expect(mapA2ojDifficulty(4)).toBe('Medium')
    expect(mapA2ojDifficulty(5)).toBe('Medium')
    expect(mapA2ojDifficulty(6)).toBe('Hard')
    expect(mapA2ojDifficulty(8)).toBe('Hard')
    // Ladder11 (<1300) is honestly Easy-heavy with zero invented Hard.
    const l11 = SHEETS.find((t) => t.id === 'a2oj-ladder11')!
    const bands = { Easy: 0, Medium: 0, Hard: 0 }
    for (const s of l11.steps) for (const r of s.items) bands[r.difficulty]++
    expect(bands).toEqual({ Easy: 59, Medium: 41, Hard: 0 })
    const l4 = SHEETS.find((t) => t.id === 'a2oj-ladder4')!
    const b4 = { Easy: 0, Medium: 0, Hard: 0 }
    for (const s of l4.steps) for (const r of s.items) b4[r.difficulty]++
    expect(b4).toEqual({ Easy: 65, Medium: 33, Hard: 2 })
  })

  it('cfKeyFromUrl extracts contestId-index only from real CF URLs', () => {
    expect(cfKeyFromUrl('https://codeforces.com/problemset/problem/4/A')).toBe('4-A')
    expect(cfKeyFromUrl('https://codeforces.com/problemset/problem/484/E/')).toBe('484-E')
    expect(cfKeyFromUrl('https://leetcode.com/problems/two-sum/')).toBeNull()
    expect(cfKeyFromUrl('http://codeforces.com/problemset/problem/4/A')).toBeNull()
    expect(cfKeyFromUrl('not a url')).toBeNull()
    expect(cfKeyFromUrl(null)).toBeNull()
  })

  it('row titles match the verified catalog title for their slug (LC tracks)', () => {
    const titleBySlug = new Map(CURATED_PROBLEMS.map((p) => [p.titleSlug, p.title]))
    for (const t of SHEETS) {
      if (!LC_TRACKS.has(t.id)) continue
      for (const s of t.steps) {
        for (const r of s.items) {
          const slug = r.sourceUrl.match(SLUG_FROM_URL)![1]
          expect(r.title).toBe(titleBySlug.get(slug))
        }
      }
    }
  })
})

describe('sheets order sanity (steps 1..N, rows 1..M, unique keys)', () => {
  it('steps are sequential 1..N per track with unique step ids', () => {
    for (const t of SHEETS) {
      const ids = new Set<string>()
      t.steps.forEach((s, i) => {
        expect(s.order).toBe(i + 1)
        expect(s.title.trim().length).toBeGreaterThan(0)
        expect(ids.has(s.id)).toBe(false)
        ids.add(s.id)
      })
    }
  })

  it('rows are sequential 1..M per step with no duplicate keys', () => {
    const seen = new Set<string>()
    for (const t of SHEETS) {
      for (const s of t.steps) {
        s.items.forEach((r, i) => {
          expect(r.order).toBe(i + 1)
          const key = `${t.id}/${s.id}/${r.order}`
          expect(seen.has(key)).toBe(false)
          seen.add(key)
        })
      }
    }
  })
})
