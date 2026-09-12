// services/room/search.ts — threads-lite (#8) ranked message search (pure, no DB).
// WHY: ranked search within a room must work on Postgres AND local SQLite
// dev (no pg_trgm dependency). The route fetches a bounded candidate set
// (non-deleted, unhidden, latest 200) and ranks here:
//   exact substring  >  word-prefix  >  fuzzy (subsequence / typo distance).
// Scores are deterministic + unit-tested; the route sorts desc and caps.

export interface SearchableMessage {
  id: string;
  content: string | null;
  fileName: string | null;
  isDeleted?: boolean;
  createdAt: Date | string;
}

export interface RankedHit<T> {
  message: T;
  score: number;
  kind: 'exact' | 'prefix' | 'fuzzy';
}

const EXACT_EQUALITY_SCORE = 300; // whole content equals the query
const EXACT_WORD_SCORE = 200; // query is a whole word ("assign" ~ "read the assign notes")
const PREFIX_SCORE = 150; // query prefixes a longer word ("assign" ~ "assignments")
const SUBSTRING_SCORE = 100; // query occurs mid-word ("assign" ~ "reassign")
const FUZZY_SCORE = 20;
const FUZZY_WORD_DISTANCE_BONUS = 10; // close typo on a single word

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function wordsOf(s: string): string[] {
  return s.split(' ').filter(Boolean);
}

/** True when every char of needle appears in order in haystack (e.g. "hllo" ~ "hello"). */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

/** Bounded Levenshtein (early-exit past maxDist) for typo tolerance. */
export function levenshteinWithin(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur0 = i;
    let rowMin = cur0;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const cur = Math.min(prev[j] + 1, cur0 + 1, prev[j - 1] + cost);
      prev[j - 1] = cur0;
      cur0 = cur;
      if (cur < rowMin) rowMin = cur;
    }
    prev[b.length] = cur0;
    if (rowMin > maxDist) return false;
  }
  return prev[b.length] <= maxDist;
}

/** Score one message against a normalized query (0 = no match). */
export function scoreMessage(
  message: Pick<SearchableMessage, 'content' | 'fileName'>,
  rawQuery: string,
): { score: number; kind: RankedHit<never>['kind'] } | null {
  const q = normalize(rawQuery);
  if (!q) return null;
  const haystacks = [message.content ?? '', message.fileName ?? '']
    .map((s) => normalize(s))
    .filter(Boolean);
  if (haystacks.length === 0) return null;

  // 1) exact tier: whole-content equality > whole word > bare substring.
  //    (Word-prefix is a subset of substring, so it must rank ABOVE substring
  //    to stay meaningful — the ladder is equality > word > prefix > substring.)
  for (const h of haystacks) {
    if (h === q) return { score: EXACT_EQUALITY_SCORE, kind: 'exact' };
  }
  for (const h of haystacks) {
    if (wordsOf(h).includes(q)) return { score: EXACT_WORD_SCORE, kind: 'exact' };
  }

  // 2) word-prefix ("assign" ~ "assignments are posted")
  for (const h of haystacks) {
    if (wordsOf(h).some((w) => w.length > q.length && w.startsWith(q))) {
      return { score: PREFIX_SCORE, kind: 'prefix' };
    }
  }

  // 3) bare substring ("assign" ~ "time to reassign rooms")
  let bestSubPos = -1;
  for (const h of haystacks) {
    const pos = h.indexOf(q);
    if (pos >= 0 && (bestSubPos < 0 || pos < bestSubPos)) bestSubPos = pos;
  }
  if (bestSubPos >= 0) {
    // Earlier occurrence ranks higher; clamped so substring never beats prefix.
    return { score: SUBSTRING_SCORE + Math.max(0, 20 - bestSubPos), kind: 'exact' };
  }

  // 3) fuzzy: single-word typo (levenshtein<=2 on words len>=4) or subsequence
  //    of the compacted content (ignores spaces, e.g. "hmwrk" ~ "homework").
  for (const h of haystacks) {
    const ws = wordsOf(h);
    if (ws.some((w) => w.length >= 4 && q.length >= 3 && levenshteinWithin(w, q, 2))) {
      return { score: FUZZY_SCORE + FUZZY_WORD_DISTANCE_BONUS, kind: 'fuzzy' };
    }
    if (q.length >= 3 && isSubsequence(q, h.replace(/ /g, ''))) {
      return { score: FUZZY_SCORE, kind: 'fuzzy' };
    }
  }
  return null;
}

export const SEARCH_CANDIDATE_CAP = 200;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/**
 * Rank candidates (exact > prefix > fuzzy; newer first on ties).
 * Deleted messages never match. Returns at most `limit` hits.
 */
export function rankMessages<T extends SearchableMessage>(
  candidates: T[],
  rawQuery: string,
  limit = SEARCH_DEFAULT_LIMIT,
): Array<RankedHit<T>> {
  const q = normalize(rawQuery);
  if (!q) return [];
  const cap = Math.min(Math.max(limit, 1), SEARCH_MAX_LIMIT);
  const hits: Array<RankedHit<T> & { at: number }> = [];
  for (const m of candidates) {
    if (m.isDeleted) continue;
    const s = scoreMessage(m, q);
    if (s) hits.push({ message: m, score: s.score, kind: s.kind, at: new Date(m.createdAt).getTime() });
  }
  hits.sort((a, b) => b.score - a.score || b.at - a.at);
  return hits.slice(0, cap).map(({ message, score, kind }) => ({ message, score, kind }));
}
