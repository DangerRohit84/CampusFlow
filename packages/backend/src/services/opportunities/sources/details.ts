// opportunities/sources/details.ts — shared deterministic rich-field extractors.
// WHY: every list parser filled missing rich fields with fake defaults
// (prize "₹0", generic "Short Hackathon from X: title", 400-char truncation,
// hardcoded ONLINE/India, participantsCount 0 as real) and missed multi-tier
// prizes/perks, multi-dates/stages, team size, eligibility, venue, judging,
// schedule. Single SSOT so all 10 platforms share rules; new fields optional
// (backward-compatible NormalizedOpportunity).
// Pure, no network/DB — hermetic unit-testable.

import { stripHtml } from '../text';
import { parseSearchDate } from '../../../utils/search';

export interface VenueMode {
  venue: string;
  location: string;
  mode: string;
}

export interface StageInfo {
  title: string;
  date?: string;
}

/** True when prize string fabricates a zero amount (never invent ₹0/$0). */
export function hasFakePrizeDefault(prizePool: unknown): boolean {
  if (typeof prizePool !== 'string') return false;
  return /₹\s*0(?!\d)|\$\s*0(?!\d)/.test(prizePool);
}

/** True when description is a manufactured generic fallback (omit absent instead). */
export function isGenericFallbackDescription(desc: unknown): boolean {
  if (typeof desc !== 'string') return false;
  const t = desc.trim();
  if (!t) return false;
  return /^(short hackathon from|hackathon from|internship opportunity at|internship from|hackathon:\s|hackathon from aggregation)/i.test(t);
}

/**
 * Full description, never generic, never 400-char truncation.
 * Strips HTML, collapses whitespace, caps at 2000 (not 400) to preserve
 * venue/judging/schedule context. Returns '' when absent (omit, don't invent).
 */
export function cleanDescription(
  raw: unknown,
  _opts?: { title?: string; source?: string },
): string {
  if (raw === null || raw === undefined) return '';
  const text = stripHtml(String(raw)).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Never return a generic fallback as real data — caller must omit instead.
  if (isGenericFallbackDescription(text)) return '';
  return text.slice(0, 2000);
}

function formatINR(n: number): string {
  try {
    return n.toLocaleString('en-IN');
  } catch {
    return String(n);
  }
}

const PERKS_RANK_RE = /perk|goodie|swag|certificate|internship|coupon|goodies/i;

/**
 * Format Unstop-style prizes array without inventing ₹0.
 * - array [{rank, cash}] → "Campus Winner: ₹5,000, National Winner: ₹20,000 | Perks: Goodies, ..."
 * - zero/missing cash with non-perk rank is omitted (not "₹0")
 * - zero cash with perk-like rank is kept as perks text (no amount)
 * - string passthrough (trimmed), null/undefined/'' → ''
 */
export function formatUnstopPrizes(prizes: unknown): string {
  if (prizes === null || prizes === undefined) return '';
  if (typeof prizes === 'string') return prizes.trim();
  if (!Array.isArray(prizes)) return '';
  const tiers: string[] = [];
  const perks: string[] = [];
  for (const p of prizes as any[]) {
    const rank = String(p?.rank ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const cashNum = Number(p?.cash);
    const hasCash = Number.isFinite(cashNum) && cashNum > 0;
    if (hasCash) {
      const label = rank || 'Prize';
      tiers.push(`${label}: ₹${formatINR(cashNum)}`);
    } else if (rank && PERKS_RANK_RE.test(rank)) {
      // Perk-like rank with no amount (e.g. "Perks") — keep text, never "₹0".
      // Avoid "Perks: Perks" duplication: if rank already is "Perks", keep as-is.
      if (/^perks?$/i.test(rank)) {
        if (!perks.some((x) => /^perks?$/i.test(x))) perks.push(rank);
      } else {
        perks.push(rank);
      }
    }
    // else: zero/missing cash with ordinary rank → omit (never "₹0")
  }
  // Also harvest explicit perk text from rank fields like "Perks: Goodies" if present
  const parts = [...tiers];
  if (perks.length) parts.push(`Perks: ${perks.join(', ')}`);
  return parts.join(', ');
}

/**
 * Reskilll listing ISO deadline (YYYY-MM-DD) — shared date helper.
 * WHY (2026-09-10 QA re-run): Reskilll cards carry Registration Start/End as
 * ISO (`2025-04-24` → `2025-04-27`, `2024-12-01` → `2024-12-22`) but the
 * generic `extractDeadlineFromContent` never matches YYYY-MM-DD (its DATE_NUM
 * requires 1-2 digit first part, month-name patterns require month words).
 * ISO dates were invisible → deadline fell through to detail-page bare
 * month-day fragments (`December 14` without year → chrono current-year
 * default → `2026-12-14` future) — year-bump fabrication that kept 6 past
 * events alive with fake futures. This helper finds explicit ISO dates first,
 * prefers Registration-End/Last-date context, else latest explicit ISO.
 * Returns '' when absent (omit, never invent). Pure, no network/DB.
 */
export function extractISORegistrationEnd(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const isoRe = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
  const all: Array<{ iso: string; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(s)) !== null) {
    const iso = m[0];
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    try {
      if (d.toISOString().slice(0, 10) !== iso) continue;
    } catch {
      continue;
    }
    all.push({ iso, idx: m.index });
    if (all.length > 20) break;
  }
  if (!all.length) return '';
  const scored = all.map((a) => {
    const winStart = Math.max(0, a.idx - 60);
    const winEnd = Math.min(s.length, a.idx + a.iso.length + 60);
    const win = s.slice(winStart, winEnd).toLowerCase();
    let score = 0;
    if (
      /(registration\s+ends?|registrations?\s+end|registration\s+closes?|last\s+date|deadline|closes?\s+on|ends?\s+on)/.test(
        win,
      )
    )
      score = 2;
    else if (/regist/.test(win)) score = 1;
    if (
      /(registrations?\s+begin|registrations?\s+start|registrations?\s+open|registration\s+starts?|registration\s+begins?)/.test(
        win,
      )
    )
      score = Math.min(score, 0);
    return { ...a, score, ts: new Date(a.iso).getTime() };
  });
  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);
  const topScore = scored[0].score;
  const bucket = scored.filter((x) => x.score === topScore);
  bucket.sort((a, b) => b.ts - a.ts);
  return bucket[0].iso;
}

/**
 * True when text explicitly marks registration as closed (past Reskilll events).
 * Live listing + /hack/ detail both carry a `Registration Closed` badge for
 * ended events (live iQOO/Health-a-thon carry none). Case-insensitive.
 * Callers must drop closed events immediately — never extract a deadline for
 * them (prevents bare month-day year-bump fabrication). Pure, hermetic.
 */
export function hasReskilllClosedBadge(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  return /registration\s+closed/i.test(text);
}

/** Strip tier bleed to rank phrase only; fallback to clean `Prize` when no rank found. */
export function cleanTierLabel(raw: unknown): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/[:\-–—]+$/g, '').trim();
  if (!t) return 'Prize';
  // Rank keywords (nearest rank + prize window). Prize/Place/Pool alone are NOT rank —
  // they trigger fallback unless paired with a real rank (Winner/First/1st/Best/...).
  const RANK_RE =
    /(winner|first|second|third|1st|2nd|3rd|runner[\s-]*up|champion|gold|silver|bronze|best|consolation|top|overall|grand|campus|national)/i;
  if (!RANK_RE.test(t)) return 'Prize';
  const words = t.split(' ').filter(Boolean);
  // Find last rank position (nearest to amount)
  let rankIdx = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (RANK_RE.test(words[i].replace(/[^A-Za-z0-9-]/g, ''))) {
      // Runner-Up may be split as "Runner" + "Up" — treat pair as one
      rankIdx = i;
      break;
    }
  }
  if (rankIdx === -1) return 'Prize';
  // Handle "Runner Up" split across two words
  let rankEnd = rankIdx;
  if (/^runner$/i.test(words[rankIdx].replace(/[^A-Za-z]/g, '')) && words[rankIdx + 1] && /^up$/i.test(words[rankIdx + 1].replace(/[^A-Za-z]/g, ''))) {
    rankEnd = rankIdx + 1;
  }
  // Qualifier before rank (e.g. Campus/National/1st before Winner/Runner-Up), max 1 word
  let start = rankIdx;
  if (rankIdx > 0) {
    const prev = words[rankIdx - 1].replace(/[^A-Za-z0-9-]/g, '');
    if (/^(campus|national|1st|2nd|3rd|first|second|third|grand|overall|top)$/i.test(prev)) start = rankIdx - 1;
  }
  // Prize window after rank: up to 2 words, stop after Prize/Place/Pool/Winner/Prizes
  const PRIZE_RE = /^(prizes?|places?|pools?|winners?)$/i;
  let end = rankEnd;
  for (let i = rankEnd + 1; i < words.length && i <= rankEnd + 2; i++) {
    const w = words[i].replace(/[^A-Za-z0-9-]/g, '');
    if (!w) break;
    // Keep UI/UX style tokens after Best (e.g. Best UI UX)
    if (/^(ui|ux|design)$/i.test(w) && /^best$/i.test(words[rankIdx].replace(/[^A-Za-z]/g, ''))) {
      end = i;
      continue;
    }
    if (PRIZE_RE.test(w)) {
      end = i;
      break;
    }
    // Stop at sentence verbs / filler (for/total/announcement/etc.)
    if (/^(for|total|announcement|announcements|results?|compete|worth)$/i.test(w)) break;
    // Otherwise stop — don't absorb bleed nouns (Jamming/Sessions/Goodies)
    break;
  }
  const phrase = words.slice(start, end + 1).join(' ').replace(/\s+/g, ' ').trim();
  if (!phrase || phrase.length > 40) return 'Prize';
  // Must contain rank (guard against returning pure bleed like "Goodies")
  if (!RANK_RE.test(phrase)) return 'Prize';
  // Title-case normalize? Keep original casing for ordinals (1st) + capitalize first letter
  return phrase.length >= 2 ? phrase : 'Prize';
}

/** Decode dash entities before mining (stripHtml flattens &ndash; to space, losing ranges). */
function decodeTeamEntities(s: string): string {
  return String(s ?? '')
    .replace(/&(ndash|mdash|minus|hyphen|#8211|#8212|#45);/gi, '-')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ');
}

function validTeam(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 20;
}

/** Explicit Team Size labels only (Team Size: X / Members Count: X / Team of X). Null when absent. Null on conflict (omit, never guess). */
export function extractExplicitTeamSize(text: unknown): number | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  const s = decodeTeamEntities(raw);
  const found: number[] = [];
  const explicitRes = [
    /team\s*size\s*[:\-]?\s*(\d+)\s*(?:[-–—to]+\s*(\d+))?/gi,
    /members?\s*count\s*[:\-]?\s*(\d+)\s*(?:[-–—to]+\s*(\d+))?/gi,
    /team\s*of\s*(\d+)/gi,
  ];
  for (const re of explicitRes) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      for (const g of [m[1], m[2]]) {
        if (g === undefined) continue;
        const n = Number(g);
        if (validTeam(n) && !found.includes(n)) found.push(n);
      }
      if (found.length > 4) break;
    }
  }
  if (!found.length) return null;
  if (found.length === 1) return found[0];
  // Single range like 2-4 (two numbers forming a range) → max (convention, not guess)
  // Two separate explicit labels with different numbers → conflict → omit
  // Heuristic: if exactly 2 numbers and raw contains an explicit range dash/to between them, treat as range → max.
  // Otherwise distinct singles → omit.
  if (found.length === 2) {
    const rangeHint = /team\s*size\s*[:\-]?\s*\d+\s*[-–—to]+\s*\d+|members?\s*count\s*[:\-]?\s*\d+\s*[-–—to]+\s*\d+/i.test(s);
    if (rangeHint) return Math.max(...found);
    return null;
  }
  return null;
}

/**
 * Resolve Unstop team size: prefer explicit structured min/max over body mining.
 * - min==max → single explicit (authoritative)
 * - min<max → range max (explicit max beats mined first-match; convention, matches raw "4 members" for 3-4)
 * - min>max → invalid → null (omit, never guess)
 * - one side only → that side (prefer explicit)
 * - none → explicit labels in text (single wins, conflict omits) else mining fallback
 */
export function resolveUnstopTeamSize(
  regnReqs: unknown,
  detailsText: unknown,
): number | null {
  const r = (regnReqs ?? {}) as Record<string, unknown>;
  const min = Number((r as any).min_team_size);
  const max = Number((r as any).max_team_size);
  const minOk = validTeam(min);
  const maxOk = validTeam(max);
  if (minOk && maxOk) {
    if (min === max) return min;
    if (min < max) return max;
    return null;
  }
  if (minOk && !maxOk) return min;
  if (!minOk && maxOk) return max;
  const explicit = extractExplicitTeamSize(detailsText);
  // extractExplicit returns null for both absent AND conflict. Distinguish: if conflict, don't fall back to mining (honest-omit).
  // Detect conflict: two+ distinct explicit numbers present.
  const s = decodeTeamEntities(String(detailsText ?? ''));
  const explicitNums: number[] = [];
  for (const re of [/team\s*size\s*[:\-]?\s*(\d+)/gi, /members?\s*count\s*[:\-]?\s*(\d+)/gi]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const n = Number(m[1]);
      if (validTeam(n) && !explicitNums.includes(n)) explicitNums.push(n);
    }
  }
  if (explicitNums.length >= 2) return null;
  if (explicit !== null) return explicit;
  return extractTeamSize(detailsText);
}

/** Individual → 1, "team size 2-4" → 4 (max), "team of 3" → 3, else null (omit). */
export function extractTeamSize(text: unknown): number | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  const lower = raw.toLowerCase();
  if (/\bindividual\b/.test(lower)) return 1;
  const s = decodeTeamEntities(raw);
  const candidates: number[] = [];
  const push = (v: unknown) => {
    const n = Number(v);
    if (validTeam(n)) candidates.push(n);
  };
  // Ranges first (max wins): "3-4 members", "1 to 5 members", "1-5 per team", "2-4"
  const rangeRes = [
    /(\d+)\s*[-–—]\s*(\d+)\s*members?/gi,
    /(\d+)\s+to\s+(\d+)\s*members?/gi,
    /(\d+)\s*[-–—]\s*(\d+)\s*per\s*team/gi,
    /(\d+)\s+to\s+(\d+)\s*per\s*team/gi,
    /team\s*size\s*[:\-]?\s*(\d+)\s*[-–—to]+\s*(\d+)/gi,
    /(\d+)\s*[-–—]\s*(\d+)\s*members?\s*per\s*team/gi,
  ];
  for (const re of rangeRes) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      push(m[1]);
      push(m[2]);
    }
  }
  if (candidates.length) return Math.max(...candidates);
  // Singles (max wins, not first-match): fixes "per team 3 4 members" → 4 not 3
  const singleRes = [
    /team\s*of\s*(\d+)/gi,
    /up\s*to\s*(\d+)\s*members?/gi,
    /(\d+)\s*members?\s*per\s*team/gi,
    /(\d+)\s*members?/gi,
    /(\d+)\s*per\s*team/gi,
    /team\s*[:\-]?\s*(\d+)/gi,
  ];
  for (const re of singleRes) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) push(m[1]);
  }
  if (candidates.length) return Math.max(...candidates);
  return null;
}

/** Eligibility section → free text (omit '' when absent). */
export function extractEligibility(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const m = s.match(/eligibility\s*[:\-]?\s*(.+?)(?=\n\s*(?:venue|mode|judging|schedule|prizes?|dates?|stages?|team)\s*[:\-]?|$)/is);
  if (m) {
    const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
    if (v.length >= 10) return v;
  }
  // Fallback: sentence containing eligibility keywords
  const sentences = s.split(/(?<=[.;])\s+/);
  const hits = sentences.filter((x) => /eligible|eligibility|open to|undergraduate|year|CSE|IT|ECE|college|students?/i.test(x));
  if (hits.length) return hits.join(' ').replace(/\s+/g, ' ').trim().slice(0, 800);
  return '';
}

/** Venue + metro + mode. Mode from explicit "Mode:" else offline cues else ONLINE fallback. */
export function extractVenueMode(text: unknown, fallback?: { city?: string }): VenueMode {
  const s = String(text ?? '');
  let venue = '';
  const vm = s.match(/venue\s*[:\-]?\s*(.+?)(?=\s*(?:mode|judging|schedule|eligibility|prizes?|dates?|stages?|team)\s*[:\-]?|\.\s*(?:[A-Z]|$)|$)/is);
  if (vm) venue = vm[1].replace(/\s+/g, ' ').trim().slice(0, 200);
  // Metro hint belongs to venue (e.g. "Nearest metro Rithala")
  const metro = s.match(/(?:nearest\s+metro|metro(?: station)?)\s*[:\-]?\s*([A-Za-z ]{2,40})/i);
  if (metro && venue && !venue.toLowerCase().includes('metro')) {
    venue = `${venue} (Metro: ${metro[1].trim()})`.slice(0, 200);
  } else if (metro && !venue) {
    venue = `Metro: ${metro[1].trim()}`.slice(0, 200);
  }
  // Campus hint when no explicit Venue: label
  if (!venue) {
    const campus = s.match(/([A-Z][A-Za-z. ]{1,40}Campus[^.;]{0,60})/);
    if (campus) venue = campus[1].trim().slice(0, 200);
  }
  const city = String(fallback?.city ?? '').trim();
  const location = venue || city;
  let mode = 'ONLINE';
  const modeExplicit = s.match(/mode\s*[:\-]?\s*(online|offline|hybrid|remote|onsite|on-site|in-person)/i);
  if (modeExplicit) {
    const v = modeExplicit[1].toLowerCase();
    if (v === 'offline' || v === 'onsite' || v === 'on-site' || v === 'in-person') mode = 'OFFLINE';
    else if (v === 'hybrid') mode = 'HYBRID';
    else mode = v === 'remote' ? 'REMOTE' : 'ONLINE';
  } else if (/offline|in-person|on-site|onsite|venue:|campus|metro/i.test(s)) {
    mode = 'OFFLINE';
  } else if (/hybrid/i.test(s)) {
    mode = 'HYBRID';
  } else if (/remote/i.test(s)) {
    mode = 'REMOTE';
  }
  return { venue, location, mode };
}

/** Judging section (e.g. "100 points ..."). Omit '' when absent. */
export function extractJudging(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const m = s.match(/judging\s*[:\-]?\s*(.+?)(?=\s*(?:schedule|stages?|venue|mode|eligibility|prizes?|dates?|team)\s*[:\-]?|$)/is);
  if (m) {
    const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
    if (v.length >= 5) return v;
  }
  return '';
}

/** Schedule summary. Omit '' when absent. */
export function extractScheduleText(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const m = s.match(/schedule\s*[:\-]?\s*(.+?)(?=\s*(?:judging|stages?|venue|mode|eligibility|prizes?|dates?|team)\s*[:\-]?|$)/is);
  if (m) {
    const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
    if (v.length >= 5) return v;
  }
  // Fallback: Day 1 / Day 2 lines
  const dayLines = s.match(/day\s*\d+[^.;]{5,120}/gi);
  if (dayLines && dayLines.length) return dayLines.join('; ').slice(0, 800);
  return '';
}

/** Parse a stage date fragment to YYYY-MM-DD, preferring the END of ranges.
 * Finds all date-like pieces ("7th September", "28th September 2026") and returns
 * the LAST parseable (end of "7th Sep to 28th Sep 2026" → 2026-09-28).
 * Returns '' when absent (omit, never invent). */
function parseStageDateISO(fragment: unknown): string {
  const s = String(fragment ?? '');
  if (!s.trim()) return '';
  const candRe =
    /\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*(?:,?\s*\d{2,4})?/gi;
  const isos: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = candRe.exec(s)) !== null) {
    try {
      const iso = parseSearchDate(m[0]);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) isos.push(iso);
    } catch {}
    if (isos.length > 5) break;
  }
  if (!isos.length) {
    try {
      const iso = parseSearchDate(s);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    } catch {}
    return '';
  }
  return isos[isos.length - 1];
}

/** Stages/rounds/phases (Stage/Round/Phase N + optional parenthetical + Important-Dates).
 * Covers evidenced Unstop shapes (Quant-A-Maze A.json:177):
 * - `Round 1 (Online PPT Submission)` / `Round 2 (36-Hour On-Campus)` (parens directly
 *   after number — old regex required a letter and missed these)
 * - `Phase 1 Online Round` / `Phase 2 Offline Round` (old regex had no `phase` keyword)
 * - Important-Dates lines `Phase 1 Results: 3rd October 2026` / `Final Results: 30th Oct`
 *   as dated stages (date = END of range, e.g. "7th Sep to 28th Sep 2026" → 2026-09-28).
 * Omit [] when absent; omit date when unparseable (never invent). */
export function extractStages(text: unknown): StageInfo[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  const out: StageInfo[] = [];
  const seen = new Set<string>();
  const push = (titleRaw: string, dateRaw?: string) => {
    let title = String(titleRaw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*[;,.]+$/g, '')
      .trim()
      .slice(0, 120);
    if (!title) return;
    // Only keyword shapes + Final Results (avoid noise like "stages:" headers).
    if (!/\b(stage|round|phase)\s*\d+/i.test(title) && !/\bfinal\s+results?/i.test(title)) return;
    if (title.length < 6) return;
    const key = title.toLowerCase();
    const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;
    if (seen.has(key)) {
      if (date) {
        const ex = out.find((x) => x.title.toLowerCase() === key);
        if (ex && !ex.date) ex.date = date;
      }
      return;
    }
    if (out.length >= 10) return;
    seen.add(key);
    if (date) out.push({ title, date });
    else out.push({ title });
  };
  const cap = (w: string): string => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
  // Pass A: keyword N with optional (paren) directly after N, optional trailing title,
  // optional trailing (paren). Non-greedy trailing + delimiter lookahead stops before
  // next keyword-WITH-NUMBER/colon/paren/comma (bare "Round" in "Online Round" must NOT
  // split — old lookahead used bare stage|round|phase and truncated "Phase 1 Online Round"
  // to "Phase 1 Online").
  const kwRe =
    /\b(stage|round|phase)\s*0*(\d{1,2})\s*(?:\(\s*([^()]{2,80}?)\s*\))?(?:\s+([A-Za-z][A-Za-z0-9 \-–—&]{1,60}?))?(?:\s*\(\s*([^()]{2,80}?)\s*\))?(?=\s*(?:\(|:|-|,|\.|;|\bstage\s*\d+|\bround\s*\d+|\bphase\s*\d+|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = kwRe.exec(s)) !== null && out.length < 10) {
    const kw = cap(m[1]);
    const num = String(parseInt(m[2], 10));
    const preParen = (m[3] || '').replace(/\s+/g, ' ').trim();
    const trailing = (m[4] || '').replace(/\s+/g, ' ').trim();
    const postParen = (m[5] || '').replace(/\s+/g, ' ').trim();
    // Skip bare keyword fragments that are actually fee boilerplate without a real title?
    // No — bare "Phase 1"/"Round 1" still counts (task: match Stage/Round/Phase N).
    // But skip when ALL optional parts empty AND match is a false positive like "stages:"?
    // Keyword+number guard above already ensures real shape; bare is allowed.
    let title = `${kw} ${num}`;
    if (preParen) title += ` (${preParen})`;
    if (trailing) {
      // Guard: trailing must not be a date fragment ("7th September") or fee filler.
      // Date fragments start with digits — our trailing requires leading letter, so safe.
      // Drop trailing that is just "and"/"or"/"to" filler.
      if (!/^(and|or|to|of|the)$/i.test(trailing)) title += ` ${trailing}`;
    }
    if (postParen) title += ` (${postParen})`;
    title = title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (title.length < 6) continue;
    // Look ahead ~100 chars for a colon+date (e.g. "Phase 1 Results: 3rd October 2026")
    // so Pass-A titles get dated when the date follows on the same Important-Dates line.
    // Fragment is bounded before the NEXT Phase/Final/Rules (avoids bleeding into
    // "Phase 1 Results: 3rd Oct" when parsing "Phase 1 Online Round: 7th Sep to 28th Sep").
    let dateForTitle = '';
    try {
      const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 140);
      const colonFrag = after.match(
        /^\s*:\s*([^;.\n]*?\d[^;.\n]*?)(?=\s*(?:phase\s*\d+|final\s+results?|rules?\b|eligibility|team\s*size|$|;|\.|\n))/i,
      );
      if (colonFrag) dateForTitle = parseStageDateISO(colonFrag[1]);
    } catch {}
    push(title, dateForTitle || undefined);
    if (m[0].length === 0) kwRe.lastIndex++;
  }
  // Pass B: dated Important-Dates lines for Phase N <words> / Final Results.
  // Catches lines Pass-A saw without dates and upgrades them (push() merges by title).
  // Fragment is bounded before the NEXT Phase/Final/Rules (no bleed: "Phase 1 Online
  // Round: 7th Sep to 28th Sep 2026 Phase 1 Results: ..." must parse 2026-09-28, not 2026-10-30).
  const datedRe =
    /(phase\s*\d+(?:\s+[A-Za-z][A-Za-z ]{0,40})?|final\s+results?)\s*:\s*([^;.\n]*?\d[^;.\n]*?)(?=\s*(?:phase\s*\d+|final\s+results?|rules?\b|eligibility|team\s*size|$|;|\.|\n))/gi;
  while ((m = datedRe.exec(s)) !== null && out.length < 10) {
    const rawTitle = (m[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const frag = m[2] || '';
    // Require a date-like cue in fragment (avoid "Free registration" false dated).
    if (!/\d/.test(frag)) continue;
    if (!/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}[\/\-]\d{1,2})/i.test(frag)) continue;
    const iso = parseStageDateISO(frag);
    if (!iso) continue;
    // Normalize "phase 1 online round" → "Phase 1 Online Round" (keep words, Title-Case first only? Keep as-is but cap keyword).
    // Preserve original casing for trailing words (they are already Title-Case in source).
    const normTitle = rawTitle
      .replace(/^\s*phase/i, 'Phase')
      .replace(/^\s*final/i, 'Final')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    // Skip bare "Registration:" (not a stage — it belongs in dates[], not stages[]).
    if (/^registration/i.test(normTitle)) continue;
    push(normTitle, iso);
    if (m[0].length === 0) datedRe.lastIndex++;
  }
  return out;
}

/** True when a $ prize string fabricates a zero amount (never invent $0). */
export function hasFakeUSDPrizeDefault(prizePool: unknown): boolean {
  if (typeof prizePool !== 'string') return false;
  return /\$\s*0(?!\d)/.test(prizePool);
}

/**
 * Multi-tier USD prizes from free text. Mirrors extractPrizeTiers (₹) for $.
 * - rank/prize-anchored `$740,000` → "Prize: $740,000" (label cleaned via cleanTierLabel)
 * - never `$0`; dedupes by amount digits; fee-guarded; caps 10 tiers.
 * - perks mined with the same shared perks pattern (swag/goodies survive).
 * Omit absent ('' / []), never invent.
 */
export function extractUSDPrizeTiers(text: unknown): { prizePool: string; tiers: string[]; perks: string[] } {
  const s = String(text ?? '');
  if (!s.trim()) return { prizePool: '', tiers: [], perks: [] };
  const tiers: string[] = [];
  const seenAmounts = new Set<string>();
  const pushTier = (rawLabel: string, amtRaw: string) => {
    const amt = String(amtRaw ?? '').trim();
    if (!amt || /^0+$/.test(amt.replace(/,/g, ''))) return; // never $0
    const digits = amt.replace(/,/g, '');
    if (!/^\d{2,}$/.test(digits)) return; // ignore dust (single digits); $500 (3 digits) is real
    if (Number(digits) < 10) return;
    if (seenAmounts.has(digits)) return; // dedupe by amount
    const label = cleanTierLabel(rawLabel);
    const entry = `${label}: $${amt}`;
    tiers.push(entry);
    seenAmounts.add(digits);
  };
  // Primary: rank/prize-anchored amounts, ordinal-safe (leading digits allowed).
  const tierRe =
    /([A-Za-z0-9][A-Za-z0-9 \-–—]{0,38}?(?:Winners?|Prizes?|Places?|Pools?|1st|2nd|3rd|First|Second|Third|Runner[\s-]*Up?s?|Champion|Best|Consolation|Top|Overall|Grand|Campus|National))[^\n₹$]{0,20}\$\s*([\d,]+)/gi;
  let m: RegExpExecArray | null;
  tierRe.lastIndex = 0;
  while ((m = tierRe.exec(s)) !== null && tiers.length < 10) {
    const rawLabel = m[1].trim().replace(/\s+/g, ' ');
    const amt = m[2].trim();
    const ctxStart = Math.max(0, (m.index ?? 0) - 40);
    const ctx = s.slice(ctxStart, (m.index ?? 0) + rawLabel.length);
    if (/fee|fees|registration\s*fee|participation\s*fee/i.test(ctx)) {
      if (!/(winner|first|second|third|1st|2nd|3rd|runner|champion|best|consolation)/i.test(rawLabel)) continue;
    }
    pushTier(rawLabel, amt);
  }
  // Amount-first shape: "$500+ Prize Pool" / "$740,000 in cash" (label AFTER amount).
  // Only when primary found nothing (avoids dupes); label falls back to clean "Prize".
  if (!tiers.length) {
    const amtFirst =
      /\$\s*([\d,]{2,})(?:\s*\+)?\s*(?:in\s+cash|prize\s*pools?|prizes?|cash\s*prizes?|total)?/gi;
    amtFirst.lastIndex = 0;
    while ((m = amtFirst.exec(s)) !== null && tiers.length < 10) {
      const amt = (m[1] || '').trim();
      if (!amt || /^0+$/.test(amt.replace(/,/g, ''))) continue;
      const ctxStart = Math.max(0, (m.index ?? 0) - 40);
      const ctx = s.slice(ctxStart, (m.index ?? 0) + m[0].length);
      if (/fee|fees|registration|participation\s*fee/i.test(ctx)) continue;
      // Require a prize cue nearby (prize/pool/cash/worth/compete) — never first-$-on-page.
      const winStart = Math.max(0, (m.index ?? 0) - 60);
      const winEnd = Math.min(s.length, (m.index ?? 0) + m[0].length + 60);
      const win = s.slice(winStart, winEnd);
      if (!/(prize|pool|cash|worth|compete|win|reward)/i.test(win)) continue;
      pushTier('Prize', amt);
    }
  }
  // Generic fallback (only when nothing found): short labels + 3+ digit $ amounts, fee-guarded.
  if (!tiers.length) {
    const generic = /([A-Za-z][A-Za-z0-9 &\-]{1,29})\$\s*([\d,]{3,})/g;
    generic.lastIndex = 0;
    while ((m = generic.exec(s)) !== null && tiers.length < 10) {
      const rawLabel = m[1].trim().replace(/\s+/g, ' ');
      const amt = m[2].trim();
      if (/^0+$/.test(amt.replace(/,/g, ''))) continue;
      const ctxStart = Math.max(0, (m.index ?? 0) - 40);
      const ctx = s.slice(ctxStart, (m.index ?? 0) + rawLabel.length);
      if (/fee|fees|registration|participation\s*fee|per\s*team/i.test(ctx)) continue;
      pushTier(rawLabel, amt);
    }
  }
  const perks: string[] = [];
  const pm = s.match(/perks?\s*[:\-]?\s*(.+?)(?=\s*(?:dates?|stages?|team|eligibility|venue|mode|judging|schedule|rules?|guidelines?|requirements?|rounds?)\s*[:\-]?|\.\s*(?:[A-Z]|$)|$)/is);
  if (pm) {
    const raw = pm[1].replace(/\s+/g, ' ').trim().slice(0, 300);
    for (const part of raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      if (part.length >= 3 && perks.length < 10) perks.push(part.slice(0, 60));
    }
  }
  const parts = [...tiers];
  if (perks.length) parts.push(`Perks: ${perks.join(', ')}`);
  return { prizePool: parts.join(', '), tiers, perks };
}

/**
 * Sponsor-challenge tiers for MLH-style /prizes pages (no cash amounts).
 * Evidence (mlh B.webfetch-detail.md:10-18, B.raw.md Detail):
 *   "Prizes at Jon Test Event ... Best Use of Gemini API / Google Swag Kits ...
 *    Best Use of MongoDB Atlas / M5Stack IoT Kit"
 * Each "Best ..." heading + following prize phrase (Kit/Swag/Gear/Prize/Credit/...)
 * becomes "Best Use of Gemini API: Google Swag Kits". Omit [] when absent.
 */
export function extractSponsorChallengeTiers(text: unknown): { prizePool: string; tiers: string[] } {
  const raw = String(text ?? '');
  if (!raw.trim()) return { prizePool: '', tiers: [] };
  const tiers: string[] = [];
  const seen = new Set<string>();
  const pushTier = (challenge: string, prize: string) => {
    const ch = String(challenge ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!ch || ch.length < 8 || /^best\s+(use\s+of\s+)?$/i.test(ch)) return;
    const key = ch.toLowerCase();
    if (seen.has(key) || tiers.length >= 10) return;
    seen.add(key);
    const pz = String(prize ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (pz && pz.length >= 3) tiers.push(`${ch}: ${pz}`);
    else tiers.push(ch);
  };
  // Pass A: HTML heading pairs (<h3>Best ...</h3><h4>Prize</h4>) — most precise when raw HTML survives.
  try {
    const pairRe =
      /<h[1-4][^>]*>\s*(Best\s+[^<]{2,80}?)\s*<\/h[1-4]>\s*<h[1-4][^>]*>\s*([^<]{2,80}?)\s*<\/h[1-4]>/gi;
    let pm: RegExpExecArray | null;
    pairRe.lastIndex = 0;
    while ((pm = pairRe.exec(raw)) !== null && tiers.length < 10) {
      const ch = pm[1].replace(/\s+/g, ' ').trim();
      const pz = pm[2].replace(/\s+/g, ' ').trim();
      // Prize must look like a prize (Kit/Swag/Gear/...), not description bleed.
      if (!/(swag|kits?\b|gear|prizes?\b|bundle|credits?\b|passes?\b|subscription|membership|device|hardware|scholarship|internship|interview|cash|₹\s*[\d,]+|\$\s*[\d,]+)/i.test(pz)) {
        // Still keep challenge alone (honest) when prize heading is not prize-like.
        pushTier(ch, '');
      } else {
        pushTier(ch, pz);
      }
      if (pm[0].length === 0) pairRe.lastIndex++;
    }
    if (tiers.length >= 2) return { prizePool: tiers.join(', '), tiers };
  } catch {}
  // Pass B: stripped-text chunking on "Best " boundaries (fetchPage6k strips tags).
  // Each chunk = "Best ..." up to next "Best " (or 300 chars). Challenge = words before
  // the prize cue; prize = sponsor words ending at the cue (Swag/Kit/Gear/...).
  try {
    const s = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const PRIZE_CUE_RE = /(swag|kits?\b|gear|prizes?\b|bundle|credits?\b|passes?\b|subscription|membership|device|hardware|scholarship|internship|interview|cash|₹\s*[\d,]+|\$\s*[\d,]+)/i;
    const parts = s.split(/(?=\bBest\s+)/g).filter((p) => /^\s*Best\s+/i.test(p));
    for (const part of parts) {
      if (tiers.length >= 10) break;
      const chunk = part.slice(0, 300).replace(/\s+/g, ' ').trim();
      // Challenge: "Best Use of <Tech 1-3 Title words>" preferred (Gemini API, MongoDB Atlas),
      // else "Best <1-4 Title words>".
      let challenge = '';
      const useOf = chunk.match(/^\s*(Best\s+Use\s+of\s+[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*)/);
      if (useOf) {
        // Trim sponsor bleed: keep at most "Best Use of W1 W2" (Tech = 2 words max).
        const words = useOf[1].split(/\s+/).filter(Boolean);
        // words: [Best, Use, of, W1, W2, W3?, ...] — keep through W2.
        challenge = words.slice(0, 5).join(' ');
      } else {
        const generic = chunk.match(/^\s*(Best\s+[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})/);
        if (generic) challenge = generic[1];
      }
      if (!challenge || challenge.length < 8) continue;
      // Prize: sponsor phrase ending at the first prize cue after the challenge.
      const after = chunk.slice(challenge.length, challenge.length + 150);
      const cue = after.match(
        /^\s*[:\-–—]?\s*([A-Z][A-Za-z0-9 \-\/&'()]{0,40}?(?:Swag(?:\s+Kits?)?|M5Stack\s+IoT\s+Kit|IoT\s+Kit|Kits?\b|Gear|Bundle|Pass(?:es)?|Prize(?:s)?))/,
      );
      let prize = '';
      if (cue) {
        prize = cue[1].replace(/\s+/g, ' ').trim();
        prize = prize.split(/\s+(?:It’s|It's|It is|Build|Get|Check|Think|Along)\b/)[0].trim();
      } else if (PRIZE_CUE_RE.test(after.slice(0, 120))) {
        const words = after.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 8);
        const cueIdx = words.findIndex((w) => PRIZE_CUE_RE.test(w));
        if (cueIdx >= 0) {
          const start = Math.max(0, cueIdx - 3);
          prize = words.slice(start, Math.min(words.length, cueIdx + 2)).join(' ');
        }
      }
      // Guard: challenge must not already contain the prize (avoid "Best ... Google Swag Kits: Google Swag Kits").
      if (prize && challenge.toLowerCase().includes(prize.toLowerCase().slice(0, 10))) prize = '';
      pushTier(challenge, prize);
    }
    if (tiers.length) return { prizePool: tiers.join(', '), tiers };
  } catch {}
  return { prizePool: tiers.join(', '), tiers };
}

/**
 * Devpost "Who can participate" eligibility (B.webfetch-detail.md:32-37).
 * "Who can participate - Ages 13 to 99 only - Specific countries/territories excluded [View full rules](/rules)"
 * Returns "Ages 13 to 99 only; Specific countries/territories excluded" or '' when absent.
 */
export function extractWhoCanParticipate(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  const m = s.match(/who\s+can\s+participate\s*[:\-–—]?\s*(.+?)(?=\s*(?:view\s+full\s+rules|full\s+rules|\[view|rules?\b|prizes?\b|judging|schedule|submission|deadline)\s*[:\-–—]?|$)/is);
  if (m) {
    const v = m[1]
      .replace(/\[.*?\]\(.*?\)/g, ' ')
      .replace(/view\s+full\s+rules/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-–—•\s]+/, '')
      .replace(/\s*[-–—•]\s*/g, '; ')
      .replace(/;{2,}/g, ';')
      .trim()
      .slice(0, 800);
    if (v.length >= 5) return v;
  }
  // Fallback: Ages-range sentence ("Ages 13 to 99 only") — Devpost's canonical eligibility cue.
  const age = s.match(/ages?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^.;]{0,80}/i);
  if (age) return age[0].replace(/\s+/g, ' ').trim().slice(0, 800);
  return '';
}

/**
 * Judges list for HackerEarth-style /judges tabs (no dedicated schema field —
 * callers fold into `judging` with a "Judges:" prefix).
 * Returns '' when absent (omit, never invent).
 */
export function extractJudgesList(text: unknown): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  // Require an explicit colon/dash after Judges (section heading) — bare "no judges here"
  // (no colon) is passing mention, not a judges section (honest-omit).
  const m = s.match(/judges?\s*[:\-–—]\s*(.+?)(?=\s*(?:teams?|submissions?|sponsors?|webinars?|resources?|discussion|rules?|prizes?|evaluation|overview|themes?)\s*[:\-–—]?|$)/is);
  if (m) {
    const v = m[1].replace(/\s+/g, ' ').trim().slice(0, 800);
    if (v.length >= 5) return v;
  }
  return '';
}

/**
 * HackerEarth list-level team size from structured API min/max (B.webfetch-API-head.md).
 * API carries `max_team_size`/`min_team_size` (e.g. 1/1) but the fetcher dropped them (wart 2).
 * - both valid + min<=max → max (explicit max wins; 1/1 → 1)
 * - one side valid → that side; invalid (min>max, out of 1-20) → null (omit, never guess)
 * - none → text fallback via extractExplicitTeamSize → extractTeamSize, else null.
 */
export function resolveHackerEarthTeamSize(
  maxRaw: unknown,
  minRaw: unknown,
  detailsText?: unknown,
): number | null {
  const max = Number(maxRaw);
  const min = Number(minRaw);
  const ok = (n: number): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 20;
  const maxOk = ok(max);
  const minOk = ok(min);
  if (maxOk && minOk) {
    if (min === max) return min;
    if (min < max) return max;
    return null;
  }
  if (maxOk && !minOk) return max;
  if (!maxOk && minOk) return min;
  try {
    const explicit = extractExplicitTeamSize(detailsText);
    if (explicit !== null) return explicit;
  } catch {}
  try {
    return extractTeamSize(detailsText);
  } catch {
    return null;
  }
}

/** Multi-tier prizes + perks from free text. Never returns ₹0. Labels cleaned to rank phrase only. */
export function extractPrizeTiers(text: unknown): { prizePool: string; tiers: string[]; perks: string[] } {
  const s = String(text ?? '');
  if (!s.trim()) return { prizePool: '', tiers: [], perks: [] };
  const tiers: string[] = [];
  const seenAmounts = new Set<string>();
  const pushTier = (rawLabel: string, amtRaw: string) => {
    const amt = String(amtRaw ?? '').trim();
    if (!amt || /^0+$/.test(amt.replace(/,/g, ''))) return; // never ₹0
    const digits = amt.replace(/,/g, '');
    if (!/^\d{3,}$/.test(digits)) return; // ignore dust (fees fragments, single digits)
    if (seenAmounts.has(digits)) return; // dedupe by amount: one clean entry per amount
    const label = cleanTierLabel(rawLabel);
    const entry = `${label}: ₹${amt}`;
    tiers.push(entry);
    seenAmounts.add(digits);
  };
  // Primary: rank/prize-anchored amounts, ordinal-safe (leading digits allowed).
  // Label window: up to 40 chars ending with rank/prize keyword, then 0-20 sep chars, then ₹ amount.
  const tierRe =
    /([A-Za-z0-9][A-Za-z0-9 \-–—]{0,38}?(?:Winners?|Prizes?|Places?|Pools?|1st|2nd|3rd|First|Second|Third|Runner[\s-]*Up?s?|Champion|Best|Consolation|Top|Overall|Grand|Campus|National))[^\n₹$]{0,20}₹\s*([\d,]+)/gi;
  let m: RegExpExecArray | null;
  tierRe.lastIndex = 0;
  while ((m = tierRe.exec(s)) !== null && tiers.length < 10) {
    const rawLabel = m[1].trim().replace(/\s+/g, ' ');
    const amt = m[2].trim();
    // Fee guard: never treat registration/participation fees as prizes
    const ctxStart = Math.max(0, (m.index ?? 0) - 40);
    const ctx = s.slice(ctxStart, (m.index ?? 0) + rawLabel.length);
    if (/fee|fees|registration\s*fee|participation\s*fee/i.test(ctx)) {
      // Allow only if label itself is a strong prize tier (Winner/Place/Prize + rank)
      if (!/(winner|first|second|third|1st|2nd|3rd|runner|champion|best|consolation)/i.test(rawLabel)) continue;
    }
    pushTier(rawLabel, amt);
  }
  // Generic fallback (only when nothing found): short Title-Case labels + 4+ digit amounts, fee-guarded.
  if (!tiers.length) {
    const generic = /([A-Za-z][A-Za-z0-9 &\-]{1,29})₹\s*([\d,]{4,})/g;
    generic.lastIndex = 0;
    while ((m = generic.exec(s)) !== null && tiers.length < 10) {
      const rawLabel = m[1].trim().replace(/\s+/g, ' ');
      const amt = m[2].trim();
      if (/^0+$/.test(amt.replace(/,/g, ''))) continue;
      const ctxStart = Math.max(0, (m.index ?? 0) - 40);
      const ctx = s.slice(ctxStart, (m.index ?? 0) + rawLabel.length);
      if (/fee|fees|registration|participation\s*fee|per\s*team/i.test(ctx)) continue;
      pushTier(rawLabel, amt);
    }
  }
  const perks: string[] = [];
  const pm = s.match(/perks?\s*[:\-]?\s*(.+?)(?=\s*(?:dates?|stages?|team|eligibility|venue|mode|judging|schedule|rules?|guidelines?|requirements?|rounds?)\s*[:\-]?|\.\s*(?:[A-Z]|$)|$)/is);
  if (pm) {
    const raw = pm[1].replace(/\s+/g, ' ').trim().slice(0, 300);
    for (const part of raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      if (part.length >= 3 && perks.length < 10) perks.push(part.slice(0, 60));
    }
  }
  const parts = [...tiers];
  if (perks.length) parts.push(`Perks: ${perks.join(', ')}`);
  return { prizePool: parts.join(', '), tiers, perks };
}
