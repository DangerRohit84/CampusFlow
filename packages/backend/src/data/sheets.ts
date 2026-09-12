// packages/backend/src/data/sheets.ts
// DSA Sheets browser — plan §3 (static ordered tracks, manual progress) +
// A2OJ ladders + auto-mark (§4).
//
// WHY: the Problems tab answered "what next?" for LeetCode/CF live data, but
// interview prep follows curated sheets (Striver A2Z / SDE, NeetCode 150 +
// A2OJ Codeforces ladders). This module is the read-only static seed behind
// GET /coding-problems/sheets: titles + links ONLY (no statements/editorials
// — licensing-safe), every row links out via a real https URL, credit line
// per track header.
//
// No-fake contract (binding): every LeetCode per-row sourceUrl is a verified
// https://leetcode.com/problems/<slug>/ link whose slug ALSO exists in
// CURATED_PROBLEMS (locked by tests/coding-problems-sheets.test.ts — a sheet
// row can never point at an invented problem). Every Codeforces ladder row is
// a verified https://codeforces.com/problemset/problem/{contestId}/{index}/
// link whose contestId/index passes buildCodeforcesUrl() (same builder the
// auto-mark join uses — probe-verified 1:1 in
// .ai/reports/submission-api-probe.md). Track-level sourceUrl/credit point at
// the original sheet/archive; the browser holds a curated ordered SUBSET for
// Striver/NeetCode (counts shown honestly) and the FULL 100-problem ladders
// for A2OJ (originalCount 100 each). No DB writes, no migration, no secrets,
// no upstream calls (static import).
//
// A2OJ SEED PROVENANCE (one-time live fetch, then checked in — no runtime
// scrape, no scraper to maintain):
// - Ladder11 (<1300, beginners): fetched 2026-09-11 from the A2OJ archive
//   mirror https://earthshakira.github.io/a2oj-clientside/server/Ladder11.html
//   (original http://a2oj.com/Ladder11.html, now offline; canonical index also
//   at https://a2oj.netlify.app/ladder11). 100 rows: title + CF problemset
//   link + numeric difficulty 1-4. Ladder header: "11 - Codeforces Rating <
//   1300 · For beginners, unrated users or users with Codeforces Rating <
//   1300 · Difficulty Level 2".
// - Ladder4 (Div.2 A, beginners): fetched 2026-09-11 from
//   https://github.com/rishabhdeepsingh/A2OJ-Ladder/blob/master/ladders/04.%20Codeforces%20Div.%202%2C%20A/README.md
//   (mirror of original http://a2oj.com/Ladder.jsp?ID=4, cf.
//   https://codeforces.com/blog/entry/16443; also mirrored at
//   https://earthshakira.github.io/a2oj-clientside/server/Ladder4.html).
//   100 rows: title + CF problemset link + numeric difficulty 1-8. Ladder
//   header: "4 - Codeforces Div. 2, A · List of random Codeforces problems,
//   all of them are Div. 2 A problems · Difficulty Level 2".
// - All http://codeforces.com/problemset/problem/{id}/{idx} links upgraded to
//   https:// (same path, TLS only). Titles transcribed verbatim (including
//   "Football" ×2 in Ladder11 = 43/A + 96/A, "IQ test" 25/A vs "IQ Test"
//   287/A, "Cinema" 200/A vs "Drinks" 200/B).
// - Numeric → Easy/Medium/Hard mapping (documented, locked by tests):
//     1-2 → Easy (fundamentals), 3-5 → Medium (core), 6+ → Hard (stretch).
//   Rationale: Ladder11 (<1300) is Easy-heavy (59 Easy / 41 Medium / 0 Hard —
//   honest, no invented Hard); Ladder4 (Div.2 A) is 68 Easy / 30 Medium / 2
//   Hard (99 = 397/A level 6, 100 = 200/A level 8). Original numeric kept per
//   row as a2ojDifficulty for transparency.

import { CURATED_PROBLEMS, buildCodeforcesUrl } from '../services/codingProblems'

export type SheetDifficulty = 'Easy' | 'Medium' | 'Hard'

export interface SheetItem {
  /** 1-based position inside its step (sequential, locked by tests). */
  order: number
  title: string
  sourceUrl: string
  topic: string
  difficulty: SheetDifficulty
  /**
   * Codeforces join key `${contestId}-${index}` (ladder rows only).
   * Matches the auto-mark join (`problem.contestId-problem.index`, probe §4)
   * and buildCodeforcesUrl() 1:1. Absent on LeetCode rows.
   */
  cfKey?: string
  /** Original A2OJ numeric difficulty 1-8 (ladder rows only, transparency). */
  a2ojDifficulty?: number
}

export interface SheetStep {
  id: string
  title: string
  /** 1-based position inside its track (sequential, locked by tests). */
  order: number
  items: SheetItem[]
}

export interface SheetTrack {
  id: string
  name: string
  /** Original sheet this order is inspired by (credit line). */
  sourceName: string
  sourceUrl: string
  credit: string
  /** Full problem count on the ORIGINAL sheet (context only). */
  originalCount: number
  steps: SheetStep[]
}

/** HTTP/server cache: static seed moves only on deploy; 24h client cache. */
export const SHEETS_CACHE_KEY = 'coding-problems:sheets:v2'
export const SHEETS_TTL_MS = 24 * 60 * 60 * 1000

/** Verified slug → { title, difficulty, topic } (SSOT = CURATED_PROBLEMS). */
const VERIFIED = new Map(
  CURATED_PROBLEMS.map((p) => [p.titleSlug, { title: p.title, difficulty: p.difficulty, topic: p.topics[0] ?? 'general' }]),
)

function row(order: number, slug: string, topicOverride?: string): SheetItem {
  const v = VERIFIED.get(slug)
  if (!v) throw new Error(`[sheets] unverified slug in seed: ${slug}`)
  return {
    order,
    title: v.title,
    sourceUrl: `https://leetcode.com/problems/${slug}/`,
    topic: topicOverride ?? v.topic,
    difficulty: v.difficulty,
  }
}

function step(id: string, title: string, order: number, items: SheetItem[]): SheetStep {
  return { id, title, order, items }
}

// --- A2OJ ladder helpers (pure, tested) --------------------------------------
// Numeric → band mapping (see provenance note above). Pure + exported for
// tests so the mapping can never drift silently.

export function mapA2ojDifficulty(level: number): SheetDifficulty {
  if (!Number.isFinite(level) || level <= 2) return 'Easy'
  if (level <= 5) return 'Medium'
  return 'Hard'
}

/** Extract `${contestId}-${index}` from a CF problemset URL (null when not CF). */
export function cfKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^https:\/\/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z][0-9]?)\/?$/.exec(url.trim())
  if (!m) return null
  const cid = parseInt(m[1], 10)
  if (!Number.isInteger(cid) || cid <= 0) return null
  return `${cid}-${m[2]}`
}

function cfRow(order: number, contestId: number, index: string, title: string, a2ojLevel: number): SheetItem {
  const url = buildCodeforcesUrl(contestId, index)
  if (!url) throw new Error(`[sheets] invalid CF ladder row: ${contestId}/${index} (${title})`)
  if (!title || !title.trim()) throw new Error(`[sheets] empty title in ladder row: ${contestId}/${index}`)
  if (!Number.isInteger(a2ojLevel) || a2ojLevel < 1 || a2ojLevel > 10) {
    throw new Error(`[sheets] invalid a2ojDifficulty in ladder row: ${title} (${a2ojLevel})`)
  }
  return {
    order,
    title: title.trim().slice(0, 200),
    sourceUrl: url,
    topic: 'codeforces',
    difficulty: mapA2ojDifficulty(a2ojLevel),
    cfKey: `${contestId}-${index}`,
    a2ojDifficulty: a2ojLevel,
  }
}

export const SHEETS: ReadonlyArray<SheetTrack> = [
  {
    id: 'striver-a2z',
    name: 'Striver A2Z',
    sourceName: "Striver's A2Z DSA Course (takeUforward)",
    sourceUrl: 'https://takeuforward.org/strivers-a2z-dsa-course-sheet-2/',
    credit:
      "Order inspired by Striver's A2Z DSA Course (takeUforward) — titles + links only. The full 474-problem sheet lives on the original site.",
    originalCount: 474,
    steps: [
      step('a2z-basics', 'Step 1 · Learn the Basics', 1, [
        row(1, 'climbing-stairs'),
        row(2, 'valid-parentheses'),
        row(3, 'valid-anagram'),
        row(4, 'maximum-depth-of-binary-tree'),
      ]),
      step('a2z-arrays', 'Step 2 · Arrays & Sorting', 2, [
        row(1, 'two-sum'),
        row(2, 'maximum-subarray'),
        row(3, 'best-time-to-buy-and-sell-stock'),
        row(4, 'binary-search'),
      ]),
      step('a2z-strings', 'Step 3 · Strings & Two Pointers', 3, [
        row(1, 'longest-substring-without-repeating-characters'),
        row(2, 'container-with-most-water'),
        row(3, '3sum'),
        row(4, 'group-anagrams'),
      ]),
      step('a2z-linked', 'Step 4 · Linked List & Stack', 4, [
        row(1, 'merge-two-sorted-lists'),
        row(2, 'reverse-linked-list'),
        row(3, 'lru-cache'),
        row(4, 'merge-k-sorted-lists'),
      ]),
      step('a2z-search', 'Step 5 · Binary Search & Intervals', 5, [
        row(1, 'search-in-rotated-sorted-array'),
        row(2, 'merge-intervals'),
        row(3, 'median-of-two-sorted-arrays'),
        row(4, 'minimum-window-substring'),
      ]),
      step('a2z-dp', 'Step 6 · DP, Graphs & Hashing', 6, [
        row(1, 'house-robber'),
        row(2, 'coin-change'),
        row(3, 'number-of-islands'),
        row(4, 'course-schedule'),
        row(5, 'top-k-frequent-elements'),
        row(6, 'product-of-array-except-self'),
        row(7, 'combination-sum'),
        row(8, 'implement-trie-prefix-tree'),
        row(9, 'trapping-rain-water'),
        row(10, 'binary-tree-maximum-path-sum'),
      ]),
    ],
  },
  {
    id: 'striver-sde',
    name: 'Striver SDE Sheet',
    sourceName: "Striver's SDE Sheet (takeUforward)",
    sourceUrl: 'https://takeuforward.org/interviews/strivers-sde-sheet-top-coding-interview-problems/',
    credit:
      "Order inspired by Striver's SDE Sheet (takeUforward) — titles + links only. The full 179-problem sheet lives on the original site.",
    originalCount: 179,
    steps: [
      step('sde-arrays', 'Day 1–5 · Arrays & Hashing', 1, [
        row(1, 'two-sum'),
        row(2, 'best-time-to-buy-and-sell-stock'),
        row(3, 'maximum-subarray'),
        row(4, 'merge-intervals'),
        row(5, 'product-of-array-except-self'),
        row(6, 'top-k-frequent-elements'),
      ]),
      step('sde-linked', 'Day 6–10 · Linked List', 2, [
        row(1, 'merge-two-sorted-lists'),
        row(2, 'reverse-linked-list'),
        row(3, 'merge-k-sorted-lists'),
      ]),
      step('sde-recursion', 'Day 11–15 · Recursion, Backtracking & Trie', 3, [
        row(1, 'combination-sum'),
        row(2, 'implement-trie-prefix-tree'),
        row(3, 'climbing-stairs'),
      ]),
      step('sde-dp', 'Day 16–20 · Dynamic Programming', 4, [
        row(1, 'climbing-stairs'),
        row(2, 'house-robber'),
        row(3, 'coin-change'),
        row(4, 'maximum-subarray'),
      ]),
      step('sde-graphs', 'Day 21–27 · Graphs, Trees & Design', 5, [
        row(1, 'number-of-islands'),
        row(2, 'course-schedule'),
        row(3, 'maximum-depth-of-binary-tree'),
        row(4, 'binary-tree-maximum-path-sum'),
        row(5, 'lru-cache'),
      ]),
      step('sde-search', 'Binary Search, Two Pointers & Strings', 6, [
        row(1, 'binary-search'),
        row(2, 'search-in-rotated-sorted-array'),
        row(3, 'container-with-most-water'),
        row(4, '3sum'),
        row(5, 'group-anagrams'),
        row(6, 'longest-substring-without-repeating-characters'),
        row(7, 'trapping-rain-water'),
        row(8, 'median-of-two-sorted-arrays'),
        row(9, 'minimum-window-substring'),
        row(10, 'valid-parentheses'),
        row(11, 'valid-anagram'),
      ]),
    ],
  },
  {
    id: 'neetcode-150',
    name: 'NeetCode 150',
    sourceName: 'NeetCode 150 (neetcode.io)',
    sourceUrl: 'https://neetcode.io/practice',
    credit:
      'Order inspired by NeetCode 150 (neetcode.io) — titles + links only. The full 150-problem list with patterns and video explanations lives on the original site.',
    originalCount: 150,
    steps: [
      step('nc-arrays', 'Arrays & Hashing', 1, [
        row(1, 'two-sum'),
        row(2, 'valid-anagram'),
        row(3, 'group-anagrams'),
        row(4, 'top-k-frequent-elements'),
        row(5, 'product-of-array-except-self'),
        row(6, 'best-time-to-buy-and-sell-stock'),
      ]),
      step('nc-pointers', 'Two Pointers & Sliding Window', 2, [
        row(1, 'container-with-most-water'),
        row(2, '3sum'),
        row(3, 'trapping-rain-water'),
        row(4, 'longest-substring-without-repeating-characters'),
        row(5, 'minimum-window-substring'),
        row(6, 'maximum-subarray'),
      ]),
      step('nc-search', 'Binary Search & Intervals', 3, [
        row(1, 'binary-search'),
        row(2, 'search-in-rotated-sorted-array'),
        row(3, 'merge-intervals'),
        row(4, 'median-of-two-sorted-arrays'),
      ]),
      step('nc-linked', 'Linked List & Stack', 4, [
        row(1, 'merge-two-sorted-lists'),
        row(2, 'reverse-linked-list'),
        row(3, 'merge-k-sorted-lists'),
        row(4, 'valid-parentheses'),
      ]),
      step('nc-trees', 'Trees, Graphs & Trie', 5, [
        row(1, 'maximum-depth-of-binary-tree'),
        row(2, 'binary-tree-maximum-path-sum'),
        row(3, 'number-of-islands'),
        row(4, 'course-schedule'),
        row(5, 'implement-trie-prefix-tree'),
      ]),
      step('nc-dp', 'DP, Backtracking & Design', 6, [
        row(1, 'climbing-stairs'),
        row(2, 'house-robber'),
        row(3, 'coin-change'),
        row(4, 'combination-sum'),
        row(5, 'lru-cache'),
      ]),
    ],
  },
  {
    id: 'a2oj-ladder11',
    name: 'A2OJ Ladder 11 · <1300',
    sourceName: 'A2OJ Ladder 11 — Codeforces Rating < 1300 (a2oj archive)',
    sourceUrl: 'https://earthshakira.github.io/a2oj-clientside/server/Ladder11.html',
    credit:
      'Order from the A2OJ Ladder 11 archive (<1300, beginners) — titles + links only. The full 100-problem ladder with original difficulty levels lives on the A2OJ archive (original a2oj.com, mirror 2026-09-11).',
    originalCount: 100,
    steps: [
      step('l11-p1', 'Part 1 · Problems 1–25', 1, [
        cfRow(1, 69, 'A', 'Young Physicist', 1),
        cfRow(2, 263, 'A', 'Beautiful Matrix', 1),
        cfRow(3, 266, 'B', 'Queue at the School', 1),
        cfRow(4, 32, 'B', 'Borze', 1),
        cfRow(5, 271, 'A', 'Beautiful Year', 1),
        cfRow(6, 275, 'A', 'Lights Out', 1),
        cfRow(7, 59, 'A', 'Word', 1),
        cfRow(8, 281, 'A', 'Word Capitalization', 1),
        cfRow(9, 110, 'A', 'Nearly Lucky Number', 1),
        cfRow(10, 266, 'A', 'Stones on the Table', 1),
        cfRow(11, 80, 'A', "Panoramix's Prediction", 1),
        cfRow(12, 61, 'A', 'Ultra-Fast Mathematician', 1),
        cfRow(13, 233, 'A', 'Perfect Permutation', 1),
        cfRow(14, 144, 'A', 'Arrival of the General', 1),
        cfRow(15, 200, 'B', 'Drinks', 1),
        cfRow(16, 148, 'A', 'Insomnia cure', 1),
        cfRow(17, 248, 'A', 'Cupboards', 1),
        cfRow(18, 155, 'A', 'I_love_%username%', 1),
        cfRow(19, 116, 'A', 'Tram', 1),
        cfRow(20, 339, 'A', 'Helpful Maths', 1),
        cfRow(21, 228, 'A', 'Is your horseshoe on the other hoof?', 1),
        cfRow(22, 71, 'A', 'Way Too Long Words', 1),
        cfRow(23, 236, 'A', 'Boy or Girl', 1),
        cfRow(24, 141, 'A', 'Amusing Joke', 1),
        cfRow(25, 151, 'A', 'Soft Drinking', 1),
      ]),
      step('l11-p2', 'Part 2 · Problems 26–50', 2, [
        cfRow(1, 133, 'A', 'HQ9+', 1),
        cfRow(2, 112, 'A', 'Petya and Strings', 1),
        cfRow(3, 231, 'A', 'Team', 1),
        cfRow(4, 282, 'A', 'Bit++', 1),
        cfRow(5, 227, 'B', 'Effective Approach', 2),
        cfRow(6, 272, 'A', 'Dima and Friends', 2),
        cfRow(7, 450, 'A', 'Jzzhu and Children', 2),
        cfRow(8, 165, 'A', 'Supercentral Point', 2),
        cfRow(9, 139, 'A', 'Petr and Book', 2),
        cfRow(10, 224, 'A', 'Parallelepiped', 2),
        cfRow(11, 34, 'A', 'Reconnaissance 2', 2),
        cfRow(12, 318, 'A', 'Even Odds', 2),
        cfRow(13, 205, 'A', 'Little Elephant and Rozdil', 2),
        cfRow(14, 199, 'A', "Hexadecimal's theorem", 2),
        cfRow(15, 352, 'A', 'Jeff and Digits', 2),
        cfRow(16, 339, 'B', 'Xenia and Ringroad', 2),
        cfRow(17, 320, 'A', 'Magic Numbers', 2),
        cfRow(18, 41, 'A', 'Translation', 2),
        cfRow(19, 43, 'A', 'Football', 2),
        cfRow(20, 215, 'A', 'Bicycle Chain', 2),
        cfRow(21, 34, 'B', 'Sale', 2),
        cfRow(22, 214, 'A', 'System of Equations', 2),
        cfRow(23, 149, 'A', 'Business trip', 2),
        cfRow(24, 208, 'A', 'Dubstep', 2),
        cfRow(25, 219, 'A', 'k-String', 2),
      ]),
      step('l11-p3', 'Part 3 · Problems 51–75', 3, [
        cfRow(1, 124, 'A', 'The number of positions', 2),
        cfRow(2, 96, 'A', 'Football', 2),
        cfRow(3, 118, 'A', 'String Task', 2),
        cfRow(4, 221, 'A', 'Little Elephant and Function', 2),
        cfRow(5, 118, 'B', 'Present from Lena', 2),
        cfRow(6, 230, 'A', 'Dragons', 2),
        cfRow(7, 337, 'A', 'Puzzles', 2),
        cfRow(8, 58, 'A', 'Chat room', 2),
        cfRow(9, 218, 'B', 'Airport', 2),
        cfRow(10, 445, 'A', 'DZY Loves Chessboard', 3),
        cfRow(11, 459, 'B', 'Pashmak and Flowers', 3),
        cfRow(12, 352, 'B', 'Jeff and Periods', 3),
        cfRow(13, 276, 'B', 'Little Girl and Game', 3),
        cfRow(14, 298, 'B', 'Sail', 3),
        cfRow(15, 431, 'B', 'Shower Line', 3),
        cfRow(16, 222, 'A', 'Shooshuns and Sequence', 3),
        cfRow(17, 342, 'A', 'Xenia and Divisors', 3),
        cfRow(18, 43, 'B', 'Letter', 3),
        cfRow(19, 433, 'A', "Kitahara Haruki's Gift", 3),
        cfRow(20, 186, 'A', 'Comparing Strings', 3),
        cfRow(21, 327, 'B', 'Hungry Sequence', 3),
        cfRow(22, 242, 'B', 'Big Segment', 3),
        cfRow(23, 258, 'A', 'Little Elephant and Bits', 3),
        cfRow(24, 296, 'A', 'Yaroslav and Permutations', 3),
        cfRow(25, 363, 'B', 'Fence', 3),
      ]),
      step('l11-p4', 'Part 4 · Problems 76–100', 4, [
        cfRow(1, 350, 'A', 'TL', 3),
        cfRow(2, 246, 'B', 'Increase and Decrease', 3),
        cfRow(3, 239, 'A', 'Two Bags of Potatoes', 3),
        cfRow(4, 160, 'B', 'Unlucky Ticket', 3),
        cfRow(5, 253, 'A', 'Boys and Girls', 3),
        cfRow(6, 236, 'B', 'Easy Number Challenge', 3),
        cfRow(7, 304, 'A', 'Pythagorean Theorem II', 3),
        cfRow(8, 254, 'A', 'Cards with Numbers', 3),
        cfRow(9, 353, 'A', 'Domino', 3),
        cfRow(10, 349, 'A', 'Cinema Line', 3),
        cfRow(11, 166, 'A', 'Rank List', 3),
        cfRow(12, 189, 'A', 'Cut Ribbon', 3),
        cfRow(13, 287, 'A', 'IQ Test', 3),
        cfRow(14, 285, 'C', 'Building Permutation', 3),
        cfRow(15, 433, 'B', "Kuriyama Mirai's Stones", 3),
        cfRow(16, 230, 'B', 'T-primes', 3),
        cfRow(17, 368, 'B', 'Sereja and Suffixes', 3),
        cfRow(18, 327, 'A', 'Flipping Game', 3),
        cfRow(19, 237, 'A', 'Free Cash', 3),
        cfRow(20, 289, 'B', 'Polo the Penguin and Matrix', 4),
        cfRow(21, 450, 'B', 'Jzzhu and Sequences', 4),
        cfRow(22, 462, 'B', 'Appleman and Card Game', 4),
        cfRow(23, 451, 'B', 'Sort the Array', 4),
        cfRow(24, 315, 'A', 'Sereja and Bottles', 4),
        cfRow(25, 260, 'A', 'Adding Digits', 4),
      ]),
    ],
  },
  {
    id: 'a2oj-ladder4',
    name: 'A2OJ Ladder 4 · Div.2 A',
    sourceName: 'A2OJ Ladder 4 — Codeforces Div. 2, A (a2oj archive)',
    sourceUrl: 'https://earthshakira.github.io/a2oj-clientside/server/Ladder4.html',
    credit:
      'Order from the A2OJ Ladder 4 archive (Div. 2 A, beginners) — titles + links only. The full 100-problem ladder with original difficulty levels lives on the A2OJ archive (original a2oj.com, mirror 2026-09-11).',
    originalCount: 100,
    steps: [
      step('l4-p1', 'Part 1 · Problems 1–25', 1, [
        cfRow(1, 4, 'A', 'Watermelon', 1),
        cfRow(2, 71, 'A', 'Way Too Long Words', 1),
        cfRow(3, 118, 'A', 'String Task', 2),
        cfRow(4, 112, 'A', 'Petya and Strings', 1),
        cfRow(5, 339, 'A', 'Helpful Maths', 1),
        cfRow(6, 160, 'A', 'Twins', 2),
        cfRow(7, 58, 'A', 'Chat room', 2),
        cfRow(8, 122, 'A', 'Lucky Division', 2),
        cfRow(9, 136, 'A', 'Presents', 1),
        cfRow(10, 263, 'A', 'Beautiful Matrix', 1),
        cfRow(11, 144, 'A', 'Arrival of the General', 1),
        cfRow(12, 451, 'A', 'Game With Sticks', 2),
        cfRow(13, 268, 'A', 'Games', 1),
        cfRow(14, 208, 'A', 'Dubstep', 2),
        cfRow(15, 69, 'A', 'Young Physicist', 1),
        cfRow(16, 337, 'A', 'Puzzles', 2),
        cfRow(17, 479, 'A', 'Expression', 2),
        cfRow(18, 443, 'A', 'Anton and Letters', 1),
        cfRow(19, 469, 'A', 'I Wanna Be the Guy', 2),
        cfRow(20, 318, 'A', 'Even Odds', 2),
        cfRow(21, 466, 'A', 'Cheap Travel', 3),
        cfRow(22, 313, 'A', 'Ilya and Bank Account', 2),
        cfRow(23, 459, 'A', 'Pashmak and Garden', 3),
        cfRow(24, 230, 'A', 'Dragons', 2),
        cfRow(25, 476, 'A', 'Dreamoon and Stairs', 2),
      ]),
      step('l4-p2', 'Part 2 · Problems 26–50', 2, [
        cfRow(1, 490, 'A', 'Team Olympiad', 1),
        cfRow(2, 439, 'A', 'Devu, the Singer and Churu, the Joker', 2),
        cfRow(3, 510, 'A', 'Fox And Snake', 1),
        cfRow(4, 25, 'A', 'IQ test', 1),
        cfRow(5, 432, 'A', 'Choosing Teams', 1),
        cfRow(6, 330, 'A', 'Cakeminator', 1),
        cfRow(7, 441, 'A', 'Valera and Antique Items', 2),
        cfRow(8, 462, 'A', 'Appleman and Easy Task', 2),
        cfRow(9, 385, 'A', 'Bear and Raspberry', 2),
        cfRow(10, 276, 'A', 'Lunch Rush', 1),
        cfRow(11, 456, 'A', 'Laptops', 3),
        cfRow(12, 151, 'A', 'Soft Drinking', 1),
        cfRow(13, 378, 'A', 'Playing with Dice', 1),
        cfRow(14, 496, 'A', 'Minimum Difficulty', 2),
        cfRow(15, 255, 'A', "Greg's Workout", 1),
        cfRow(16, 483, 'A', 'Counterexample', 3),
        cfRow(17, 404, 'A', 'Valera and X', 2),
        cfRow(18, 233, 'A', 'Perfect Permutation', 1),
        cfRow(19, 499, 'A', 'Watching a movie', 2),
        cfRow(20, 165, 'A', 'Supercentral Point', 2),
        cfRow(21, 262, 'A', 'Roma and Lucky Numbers', 1),
        cfRow(22, 501, 'A', 'Contest', 2),
        cfRow(23, 189, 'A', 'Cut Ribbon', 3),
        cfRow(24, 350, 'A', 'TL', 3),
        cfRow(25, 152, 'A', 'Marks', 2),
      ]),
      step('l4-p3', 'Part 3 · Problems 51–75', 3, [
        cfRow(1, 265, 'A', 'Colorful Stones (Simplified Edition)', 1),
        cfRow(2, 353, 'A', 'Domino', 3),
        cfRow(3, 114, 'A', 'Cifera', 3),
        cfRow(4, 300, 'A', 'Array', 2),
        cfRow(5, 389, 'A', 'Fox and Number Game', 3),
        cfRow(6, 488, 'A', 'Giga Tower', 3),
        cfRow(7, 224, 'A', 'Parallelepiped', 2),
        cfRow(8, 445, 'A', 'DZY Loves Chessboard', 3),
        cfRow(9, 43, 'A', 'Football', 2),
        cfRow(10, 75, 'A', 'Life Without Zeros', 2),
        cfRow(11, 296, 'A', 'Yaroslav and Permutations', 3),
        cfRow(12, 373, 'A', 'Collecting Beats is Fun', 2),
        cfRow(13, 361, 'A', 'Levko and Table', 1),
        cfRow(14, 355, 'A', 'Vasya and Digital Root', 2),
        cfRow(15, 239, 'A', 'Two Bags of Potatoes', 3),
        cfRow(16, 437, 'A', 'The Child and Homework', 3),
        cfRow(17, 363, 'A', 'Soroban', 1),
        cfRow(18, 408, 'A', 'Line to Cashier', 1),
        cfRow(19, 376, 'A', 'Lever', 2),
        cfRow(20, 359, 'A', 'Table', 2),
        cfRow(21, 302, 'A', 'Eugeny and Array', 2),
        cfRow(22, 358, 'A', 'Dima and Continuous Line', 4),
        cfRow(23, 34, 'A', 'Reconnaissance 2', 2),
        cfRow(24, 143, 'A', 'Help Vasilisa the Wise 2', 2),
        cfRow(25, 186, 'A', 'Comparing Strings', 3),
      ]),
      step('l4-p4', 'Part 4 · Problems 76–100', 4, [
        cfRow(1, 108, 'A', 'Palindromic Times', 2),
        cfRow(2, 416, 'A', 'Guess a number!', 4),
        cfRow(3, 194, 'A', 'Exams', 2),
        cfRow(4, 106, 'A', 'Card Game', 2),
        cfRow(5, 257, 'A', 'Sockets', 3),
        cfRow(6, 298, 'A', 'Snow Footprints', 3),
        cfRow(7, 279, 'A', 'Point on Spiral', 4),
        cfRow(8, 27, 'A', 'Next Test', 3),
        cfRow(9, 370, 'A', 'Rook, Bishop and King', 3),
        cfRow(10, 49, 'A', 'Sleuth', 1),
        cfRow(11, 284, 'A', 'Cows and Primitive Roots', 4),
        cfRow(12, 192, 'A', 'Funky Numbers', 4),
        cfRow(13, 56, 'A', 'Bar', 3),
        cfRow(14, 234, 'A', 'Lefthanders and Righthanders', 4),
        cfRow(15, 31, 'A', 'Worms Evolution', 2),
        cfRow(16, 305, 'A', 'Strange Addition', 4),
        cfRow(17, 197, 'A', 'Plate Game', 4),
        cfRow(18, 35, 'A', 'Shell Game', 2),
        cfRow(19, 88, 'A', 'Chord', 3),
        cfRow(20, 18, 'A', 'Triangle', 4),
        cfRow(21, 374, 'A', 'Inna and Pink Pony', 5),
        cfRow(22, 393, 'A', 'Nineteen', 4),
        cfRow(23, 390, 'A', 'Inna and Alarm Clock', 5),
        cfRow(24, 397, 'A', "On Segment's Own Points", 6),
        cfRow(25, 200, 'A', 'Cinema', 8),
      ]),
    ],
  },
]

export interface SheetsSnapshot {
  tracks: ReadonlyArray<SheetTrack>
  totalTracks: number
  totalProblems: number
  source: 'static'
  cachedAt: string
}

/** Pure snapshot over the static import (no I/O — route adds HTTP caching). */
export function getSheetsSnapshot(now: () => number = Date.now): SheetsSnapshot {
  let totalProblems = 0
  for (const t of SHEETS) for (const s of t.steps) totalProblems += s.items.length
  return {
    tracks: SHEETS,
    totalTracks: SHEETS.length,
    totalProblems,
    source: 'static',
    cachedAt: new Date(now()).toISOString(),
  }
}
