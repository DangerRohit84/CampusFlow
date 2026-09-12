// lib/practiceLinks.ts — curated CodeChef/HackerRank/GFG/AtCoder links (plan §4).
// WHY: these platforms have no official public practice catalog API
// (CodeChef restricted, HackerRank hiring-only, GFG profile-scoped only,
// AtCoder community snapshot only) so the Problems tab links out instead of
// inventing rows. Static data only — no fetch, no backend, no secrets.
export interface PracticeLink {
  id: 'codechef' | 'hackerrank' | 'gfg' | 'atcoder'
  name: string
  tagline: string
  browseUrl: string
  browseLabel: string
  whyNoCatalog: string
}

export const PRACTICE_LINKS_NOTICE =
  'No live catalog here — these platforms expose no official public practice API, so we link out instead of guessing. Browse there, track manually.'

export const PRACTICE_LINKS: ReadonlyArray<PracticeLink> = [
  {
    id: 'codechef',
    name: 'CodeChef',
    tagline: 'Practice tracks + contests (Starters/Cook-Off style).',
    browseUrl: 'https://www.codechef.com/practice',
    browseLabel: 'Browse CodeChef Practice',
    whyNoCatalog: 'No official public practice API (api.codechef.com is restricted).',
  },
  {
    id: 'hackerrank',
    name: 'HackerRank',
    tagline: 'Algorithms / data-structures domains + interview kits.',
    browseUrl: 'https://www.hackerrank.com/domains/algorithms',
    browseLabel: 'Browse HackerRank Algorithms',
    whyNoCatalog: 'Official API is hiring-only (paid) — no public practice API.',
  },
  {
    id: 'gfg',
    name: 'GeeksforGeeks',
    tagline: 'Explore DSA tracks + company-wise practice sets.',
    browseUrl: 'https://www.geeksforgeeks.org/explore',
    browseLabel: 'Browse GFG Explore',
    whyNoCatalog: 'No official list/search API (profile stats are profile-scoped only).',
  },
  {
    id: 'atcoder',
    name: 'AtCoder',
    tagline: 'ABC/ARC contests + library-assisted C++ practice.',
    browseUrl: 'https://atcoder.jp/contests/',
    browseLabel: 'Browse AtCoder Contests',
    whyNoCatalog: 'No official problems API — community snapshot only (see below).',
  },
]

// AtCoder extras (plan §4): snapshot credit + Library note (C++ lib, not a problems API).
export const ATCODER_SNAPSHOT_URL = 'https://kenkoooo.com/atcoder/#/table/'
export const ATCODER_SNAPSHOT_RAW_URL = 'https://kenkoooo.com/atcoder/resources/merged-problems.json'
export const ATCODER_LIBRARY_URL = 'https://atcoder.github.io/ac-library/production/document_en/'
