// opportunities/fetchDetails.ts — teacher paste-a-link fetch hardening SSOT.
// WHY: routes/hackathons.ts fetchHackathonDetails + routes/internships.ts
// fetch-details duplicated prompts, had no post-AI validation gate, returned
// null when AI key missing (instead of deterministic fallback), and internship
// was URL-only-to-LLM (no SPA search-top3). Single import home so platform #11
// needs no edits in routes. Pure helpers (no DB), search helper never throws.
// Reuses: details.ts extractors (never-₹0/full-desc/stages/judging),
// stagesDeadline.ts grounded arbitration, dates.ts isEnded.

import { logger } from '../../utils/logger';
import { validateExternalUrl } from '../../utils/secureUrl';
import { extractDeadlineFromContent, parseSearchDate } from '../../utils/search';
import {
  hasFakePrizeDefault,
  isGenericFallbackDescription,
  cleanDescription,
  extractPrizeTiers,
  extractTeamSize,
  extractEligibility,
  extractVenueMode,
  extractJudging,
  extractScheduleText,
  extractStages,
  extractISORegistrationEnd,
} from './sources/details';
import { isAiDeadlineGrounded } from './stagesDeadline';
import { isEnded } from './dates';
import { extractTimelineFallback } from './stagesTimeline';

export type FetchDetailsKind = 'hackathon' | 'internship';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NOT_CONFIGURED_MARKERS = ['AI provider not configured', 'Not configured'];

/** True when an AI response is the NOT_CONFIGURED sentinel (no usable key). */
export function isAiNotConfiguredResponse(text: unknown): boolean {
  const s = String(text ?? '');
  if (!s) return true;
  return NOT_CONFIGURED_MARKERS.some((m) => s.includes(m));
}

/** Strip HTML to collapsed text, capped (shared by routes + fallback). */
export function stripHtmlToText(html: string, cap: number): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, cap);
}

/**
 * Shared DDG search-top3 fetch (mirrors hackathons.ts:210-232).
 * Searches DuckDuckGo HTML, extracts snippets + result URLs, fetches top 3
 * non-SPA pages (SSRF-validated, manual redirect, 8s timeout, 4k cap each),
 * returns combined dump for LLM grounding + deterministic fallback.
 * Never throws ('' on failure).
 */
export async function searchOpportunityDetails(query: string): Promise<string> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await resp.text();
    const snippets: string[] = [];
    const urls: string[] = [];
    let match: RegExpExecArray | null;

    const snippetRegex = /class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = snippetRegex.exec(html)) !== null) {
      const text = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 20) snippets.push(text);
    }

    const urlRegex = /class="result__url"[^>]*href="[^"]*uddg=([^&"]+)/gi;
    while ((match = urlRegex.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(match[1]);
        if (decoded && !decoded.includes('duckduckgo.com')) urls.push(decoded);
      } catch {
        /* ignore bad encoding */
      }
    }

    logger.info(`Web search found ${snippets.length} snippets, ${urls.length} URLs for: ${query.substring(0, 60)}`);

    const spaDomains = ['unstop.com', 'youtube.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com'];
    const pagesToFetch = urls.filter((u) => !spaDomains.some((d) => u.includes(d))).slice(0, 3);

    const fetchedPages: string[] = [];
    for (const pageUrl of pagesToFetch) {
      try {
        try {
          await validateExternalUrl(pageUrl);
        } catch {
          continue;
        }
        const pageResp = await fetch(pageUrl, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(8000),
          redirect: 'manual' as any,
        } as any);
        if (pageResp.status >= 300 && pageResp.status < 400) continue;
        const pageHtml = await pageResp.text();
        const pageText = stripHtmlToText(pageHtml, 4000);
        if (pageText.length > 100) {
          fetchedPages.push(`[Source: ${pageUrl}]\n${pageText}`);
          logger.info(`Fetched ${pageUrl} (${pageText.length} chars)`);
        }
      } catch {
        logger.info(`Failed to fetch ${pageUrl}`);
      }
    }

    const allContent = ['Search snippets:', ...snippets.map((s, i) => `[${i + 1}] ${s}`), '', ...fetchedPages].join('\n');
    return allContent;
  } catch (err) {
    logger.info({ err }, 'Web search fallback failed:');
    return '';
  }
}

// ─── Shared prompt builder (import, not duplicate) ───

const SHARED_CRITICAL_RULES = `CRITICAL RULES:
1. NEVER fabricate or guess dates. Only use dates that are EXPLICITLY written in the content. If no dates are found, set them to null. Do NOT infer dates from "Day 1", "Day 2" — those are not dates. Do NOT make up dates unless you see that exact date text in the content.
2. NEVER invent information not present in the provided content. NEVER invent ₹0/$0 prizes/stipends or 0-rounds — omit absent fields as null. NEVER output brief placeholder descriptions — preserve full description (venue, eligibility, judging, schedule details; do not truncate).
3. Extract rounds/phases/stages/qualifiers from the selection process flow. Capture multi-tier prizes + perks, multi-dates + stages, team size, eligibility, venue/mode, judging, full description.
4. Extract ALL available information including prize pool/stipend, eligibility criteria, event schedule, bootcamps, and highlights.
5. For eligibility, extract as free text (not structured JSON) to preserve all details.
6. For rounds, only set date/resultDate if a specific calendar date is mentioned next to that round.
7. For targetDepartments: ANALYZE the title, description, and themes/role to INFER which departments have relevant skills. Department categories: SOFTWARE (CSE, IT, AIDS, CSBS, CYS, DS, MCA), ELECTRICAL (ECE, EEE, INSTRUMENTATION), MECHANICAL (MECH, AUTO, IE, CIVIL, ARCH), LIFE SCIENCES (CHEM, BT, PHARMA, BIO), BUSINESS (MBA). If topic is software/AI/ML → CSE, IT, AIDS, CSBS, CYS, DS, MCA. If electronics/IoT → ECE, EEE. If mechanical/robotics → MECH, AUTO, IE, CIVIL. If open to all → ["ALL"]. If nothing specific → [].
8. For targetYears: INFER from context. "beginner friendly" → [1,2]. "final year" → [4]. "pre-final" → [3]. "all years" → [1,2,3,4]. "fresher" → [1]. No info → [].
9. TIMELINE and ROUNDS are INDEPENDENT — handle them separately: If the source (e.g., Unstop) lists rounds/phases, extract "rounds" AND separately analyse timeline fields (startDate/endDate/deadline/duration) from the timeline/schedule content — do not leave timeline null just because rounds exist. Conversely, if the source has timeline dates but no explicit rounds, keep timeline and preserve/analyse rounds separately. Both must be preserved independently.
10. Return ONLY the JSON object, no other text:`;

const HACKATHON_FIELDS = `{
  "title": "hackathon name",
  "description": "full description (preserve venue, eligibility, judging, schedule details; do not truncate)",
  "organizer": "who is organizing",
  "registrationUrl": "registration link (full URL, only if explicitly found on the page)",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "deadline": "registration deadline YYYY-MM-DD or null",
  "teamSize": number or null,
  "themes": ["theme1", "theme2"],
  "location": "venue, city, or college name",
  "venue": "venue + metro (e.g. MAIT Campus, Delhi, nearest metro Rithala) or null",
  "mode": "ONLINE or OFFLINE or HYBRID",
  "eligibility": "free text describing who can participate (departments, years, gender, etc.) or null",
  "prizePool": "multi-tier prizes joined (e.g. Campus Winner: ₹5,000, National Winner: ₹20,000) or null — never ₹0",
  "prizeTiers": ["Campus Winner: ₹5,000"] or null,
  "perks": ["Goodies", "Internship"] or null,
  "duration": "hackathon duration or null",
  "targetDepartments": ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL"] - INFER from title/description/themes, [] if nothing specific,
  "targetYears": [1, 2, 3, 4] - INFER from context, [] if no info,
  "rounds": [
    {
      "roundNumber": 1,
      "title": "round name",
      "description": "round description including what it evaluates",
      "date": "YYYY-MM-DD or null",
      "resultDate": "YYYY-MM-DD or null"
    }
  ],
  "stages": [{"title": "Stage 1 Campus Round"}] or null,
  "schedule": "event schedule summary or null",
  "judging": "judging criteria/points or null",
  "bootcamps": ["bootcamp1 info", "bootcamp2 info"] or null,
  "highlights": ["highlight1", "highlight2"] or null
}`;

const INTERNSHIP_FIELDS = `{
  "title": "internship title",
  "company": "company name",
  "role": "specific role/designation",
  "description": "full description (preserve responsibilities, eligibility, stipend, schedule details; do not truncate)",
  "stipend": "stipend like ₹15,000/month or Unpaid or null — never ₹0",
  "duration": "like 3 months, 6 months or null",
  "mode": "REMOTE, ONSITE, or HYBRID",
  "deadline": "application deadline YYYY-MM-DD or null",
  "startDate": "start date YYYY-MM-DD or null",
  "url": "application URL (the original URL provided)",
  "targetDepartments": ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL"] - INFER from role/description, [] if nothing specific,
  "targetYears": [1, 2, 3, 4] - INFER from context, [] if no info
}`;

/**
 * Single shared prompt builder for teacher paste-a-link fetch.
 * Full field set + never-₹0 + full-desc + TIMELINE/ROUNDS independent for both.
 * Fixes internship brief-desc regression + INFER contradiction (schema lines now
 * say INFER, matching rules — no more "ONLY if explicitly mentioned").
 */
export function buildFetchDetailsPrompt(
  kind: FetchDetailsKind,
  opts: { url: string; contentSection: string; searchSection: string },
): string {
  const { url, contentSection, searchSection } = opts;
  const fields = kind === 'hackathon' ? HACKATHON_FIELDS : INTERNSHIP_FIELDS;
  const label = kind === 'hackathon' ? 'hackathon' : 'internship';
  return `Extract ${label} details from the following sources. URL: ${url}\n\n${contentSection}${searchSection}\n\nReturn ONLY a valid JSON object with these fields:\n${fields}\n\n${SHARED_CRITICAL_RULES}`;
}

// ─── Post-AI validation gate ───

export interface SanitizeResult {
  data: Record<string, unknown>;
  dropped: string[];
  isEnded: boolean;
}

function toIsoDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  const iso = m ? m[0] : s.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    try {
      const parsed = parseSearchDate(s);
      if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed;
    } catch {
      /* fall through */
    }
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    if (d.toISOString().slice(0, 10) !== iso) return null;
  } catch {
    return null;
  }
  const y = d.getFullYear();
  if (y < 2000 || y > 2100) return null;
  return iso;
}

function sanitizeDateField(value: unknown, content: string, fieldName: string, dropped: string[]): string | null {
  const iso = toIsoDateOrNull(value);
  if (!iso) {
    if (value !== null && value !== undefined && String(value).trim() && String(value).toLowerCase() !== 'null') {
      dropped.push(`${fieldName}:invalid:${String(value).slice(0, 40)}`);
    }
    return null;
  }
  if (!content || content.length < 10) {
    dropped.push(`${fieldName}:ungrounded:empty-content:${iso}`);
    return null;
  }
  if (!isAiDeadlineGrounded(content, iso)) {
    dropped.push(`${fieldName}:ungrounded:${iso}`);
    return null;
  }
  return iso;
}

function sanitizePrizeField(value: unknown, fieldName: string, dropped: string[]): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  if (hasFakePrizeDefault(s)) {
    dropped.push(`${fieldName}:fake-₹0:${s.slice(0, 60)}`);
    return null;
  }
  return s;
}

function sanitizeTierArray(value: unknown, fieldName: string, dropped: string[]): string[] | null {
  if (!Array.isArray(value)) return null;
  const kept = (value as unknown[])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .filter((t) => {
      if (hasFakePrizeDefault(t)) {
        dropped.push(`${fieldName}:fake-₹0:${t.slice(0, 60)}`);
        return false;
      }
      return true;
    })
    .map((t) => t.slice(0, 120));
  if (!kept.length) return null;
  return kept;
}

/**
 * Shared post-AI validation gate: reject/strip fake prizes, drop ungrounded
 * dates, omit-not-invent enforcement, isEnded check. Apply to BOTH endpoints
 * on AI output before res.json. Never throws (returns sanitized + dropped list).
 */
export function sanitizeFetchDetailsAI(
  kind: FetchDetailsKind,
  raw: unknown,
  content: string,
): SanitizeResult {
  const dropped: string[] = [];
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const groundedContent = String(content ?? '');

  const copyString = (key: string, cap = 2000): void => {
    const v = src[key];
    if (v === null || v === undefined) {
      out[key] = null;
      return;
    }
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null') {
      out[key] = null;
      return;
    }
    out[key] = s.slice(0, cap);
  };

  // Title: keep as-is (fallback handles missing), but cap.
  if (typeof src['title'] === 'string' && (src['title'] as string).trim()) {
    out['title'] = String(src['title']).trim().slice(0, 150);
  } else if (src['title'] !== undefined) {
    out['title'] = src['title'];
  }

  // Description: omit-not-invent (generic fallback → null).
  const rawDesc = src['description'];
  if (typeof rawDesc === 'string' && rawDesc.trim()) {
    const t = rawDesc.trim();
    if (isGenericFallbackDescription(t)) {
      dropped.push('description:generic-fallback');
      out['description'] = null;
    } else {
      out['description'] = t.slice(0, 2000);
    }
  } else if (rawDesc === null || rawDesc === undefined) {
    out['description'] = null;
  } else {
    out['description'] = null;
  }

  // Prizes / stipend: never-₹0.
  if (kind === 'hackathon' || src['prizePool'] !== undefined) {
    const p = sanitizePrizeField(src['prizePool'], 'prizePool', dropped);
    out['prizePool'] = p;
  }
  if (src['prizeTiers'] !== undefined) {
    out['prizeTiers'] = sanitizeTierArray(src['prizeTiers'], 'prizeTiers', dropped);
  }
  if (kind === 'internship' || src['stipend'] !== undefined) {
    const s = sanitizePrizeField(src['stipend'], 'stipend', dropped);
    if (kind === 'internship' || src['stipend'] !== undefined) out['stipend'] = s;
  }
  if (src['perks'] !== undefined) {
    if (Array.isArray(src['perks'])) {
      const perks = (src['perks'] as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean).map((t) => t.slice(0, 60));
      out['perks'] = perks.length ? perks : null;
    } else if (src['perks'] === null) {
      out['perks'] = null;
    }
  }

  // Dates: grounded only.
  for (const key of ['deadline', 'startDate', 'endDate']) {
    if (src[key] !== undefined || kind === 'hackathon' || (kind === 'internship' && (key === 'deadline' || key === 'startDate'))) {
      (out as Record<string, unknown>)[key] = sanitizeDateField(src[key], groundedContent, key, dropped);
    }
  }

  // Rounds: per-round date grounding.
  if (Array.isArray(src['rounds'])) {
    const rounds = (src['rounds'] as unknown[]).slice(0, 10).map((r, idx) => {
      const ro = (r ?? {}) as Record<string, unknown>;
      const num = Number((ro as Record<string, unknown>)['roundNumber']);
      return {
        roundNumber: Number.isFinite(num) && num > 0 ? num : idx + 1,
        title: String((ro as Record<string, unknown>)['title'] ?? `Round ${idx + 1}`).slice(0, 120),
        description: String((ro as Record<string, unknown>)['description'] ?? '').slice(0, 800),
        date: sanitizeDateField((ro as Record<string, unknown>)['date'], groundedContent, `rounds[${idx}].date`, dropped),
        resultDate: sanitizeDateField((ro as Record<string, unknown>)['resultDate'], groundedContent, `rounds[${idx}].resultDate`, dropped),
      };
    });
    out['rounds'] = rounds.length ? rounds : null;
  } else if (src['rounds'] !== undefined) {
    out['rounds'] = null;
  }

  // Stages: title list (dates if present must be grounded).
  if (Array.isArray(src['stages'])) {
    const stages = (src['stages'] as unknown[]).slice(0, 10).map((s) => {
      if (typeof s === 'string') return { title: s.slice(0, 120) };
      const so = (s ?? {}) as Record<string, unknown>;
      const title = String(so['title'] ?? so).slice(0, 120);
      const outStage: Record<string, unknown> = { title };
      if (so['date'] !== undefined) {
        const d = sanitizeDateField(so['date'], groundedContent, 'stages.date', dropped);
        if (d) outStage['date'] = d;
      }
      return outStage;
    }).filter((s) => (s as Record<string, unknown>)['title']);
    out['stages'] = stages.length ? stages : null;
  } else if (src['stages'] !== undefined) {
    out['stages'] = null;
  }

  // Passthrough scalars (capped, omit empty as null where appropriate).
  for (const [key, cap] of [
    ['organizer', 200],
    ['company', 200],
    ['role', 200],
    ['location', 200],
    ['venue', 200],
    ['mode', 20],
    ['eligibility', 800],
    ['duration', 100],
    ['schedule', 800],
    ['judging', 800],
    ['url', 500],
    ['registrationUrl', 500],
  ] as Array<[string, number]>) {
    if (src[key] !== undefined) copyString(key, cap);
  }
  for (const key of ['themes', 'targetDepartments', 'targetYears', 'bootcamps', 'highlights']) {
    if (src[key] !== undefined) {
      const v = src[key];
      if (Array.isArray(v)) out[key] = (v as unknown[]).slice(0, 20);
      else if (v === null) out[key] = null;
      else out[key] = v;
    }
  }
  if (src['teamSize'] !== undefined) {
    const n = Number(src['teamSize']);
    out['teamSize'] = Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
    if (out['teamSize'] === null && src['teamSize'] !== null) dropped.push('teamSize:invalid');
  }

  // isEnded check (grounded past stays, hallucinated future already dropped).
  let ended = false;
  try {
    const dl = typeof out['deadline'] === 'string' ? (out['deadline'] as string) : null;
    const title = typeof out['title'] === 'string' ? (out['title'] as string) : undefined;
    ended = isEnded(dl, title);
  } catch {
    ended = false;
  }

  return { data: out, dropped, isEnded: ended };
}

/**
 * Alias for task/API symmetry: validateFetchDetails(ai, pageText).
 * Same gate as sanitizeFetchDetailsAI — strips fake prizes/dates not grounded
 * in page text, drops invented fields to null/omit. Never throws.
 */
export function validateFetchDetails(
  kind: FetchDetailsKind,
  raw: unknown,
  pageText: string,
): SanitizeResult {
  return sanitizeFetchDetailsAI(kind, raw, pageText);
}

// ─── Deterministic fallbacks (AI key missing/fails) ───

function titleFromUrlSlug(url: string): string {
  try {
    const u = new URL(url);
    const slug = (u.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]/g, ' ').replace(/\d{5,}/g, '').replace(/\s+/g, ' ').trim();
    if (slug.length > 5) return slug.slice(0, 120);
    return '';
  } catch {
    return '';
  }
}

/**
 * Hackathon fallback on fetched pages + search dump.
 * Uses details.ts extractors (never-₹0/full-desc/stages/judging). Grounded only.
 */
export function buildHackathonDeterministicFallback(combinedContent: string, url: string): Record<string, unknown> {
  const content = String(combinedContent ?? '');
  const slugTitle = titleFromUrlSlug(url);
  let title = slugTitle;
  const hackMatch = content.match(/([A-Z][^.!?\n]{10,90}hackathon[^.!?\n]{0,40})/i);
  if (hackMatch) {
    const cand = hackMatch[0].trim().replace(/\s+/g, ' ').slice(0, 120);
    if (cand.length > title.length && cand.length < 150) title = cand;
  }
  if (!title) {
    const firstLine = content.slice(0, 120).trim().split('\n')[0]?.slice(0, 120) || '';
    title = firstLine || 'Hackathon';
  }

  const description = cleanDescription(content.slice(0, 2000), { title, source: 'FETCH_DETAILS_FALLBACK' });
  const prizes = extractPrizeTiers(content);
  const teamSize = extractTeamSize(content);
  const eligibility = extractEligibility(content);
  const venueMode = extractVenueMode(content, {});
  const judging = extractJudging(content);
  const schedule = extractScheduleText(content);
  const stages = extractStages(content);

  let deadline: string | null = null;
  try {
    deadline = extractDeadlineFromContent(content) || extractISORegistrationEnd(content) || '';
    if (!deadline) deadline = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) deadline = parseSearchDate(deadline) || null;
  } catch {
    deadline = null;
  }

  let startIso: string | null = null;
  let endIso: string | null = null;
  try {
    const fb = extractTimelineFallback(content, title);
    if (fb.startDate && !Number.isNaN(fb.startDate.getTime())) startIso = fb.startDate.toISOString().slice(0, 10);
    if (fb.endDate && !Number.isNaN(fb.endDate.getTime())) endIso = fb.endDate.toISOString().slice(0, 10);
  } catch {
    /* omit */
  }

  const rounds =
    stages.length > 0
      ? stages.slice(0, 10).map((s, i) => ({
          roundNumber: i + 1,
          title: s.title,
          description: '',
          date: (s as { date?: string }).date ?? null,
          resultDate: null,
        }))
      : null;

  return {
    title: title.slice(0, 150),
    description,
    organizer: null,
    registrationUrl: url,
    startDate: startIso,
    endDate: endIso,
    deadline,
    teamSize,
    themes: [],
    location: venueMode.location || (/india/i.test(content) ? 'India' : 'Online'),
    venue: venueMode.venue || null,
    mode: venueMode.venue ? venueMode.mode : 'ONLINE',
    eligibility: eligibility || null,
    prizePool: prizes.prizePool || null,
    prizeTiers: prizes.tiers.length ? prizes.tiers : null,
    perks: prizes.perks.length ? prizes.perks : null,
    duration: null,
    targetDepartments: [],
    targetYears: [],
    rounds,
    stages: stages.length ? stages : null,
    schedule: schedule || null,
    judging: judging || null,
    bootcamps: null,
    highlights: null,
  };
}

/** Extract ₹ stipend without inventing ₹0 ('' when absent). */
function extractStipendDeterministic(content: string): string {
  const s = String(content ?? '');
  if (!s.trim()) return '';
  if (/unpaid/i.test(s)) {
    const m = s.match(/unpaid[^.;]{0,20}/i);
    if (m) return m[0].trim().slice(0, 60);
    return 'Unpaid';
  }
  const m = s.match(/₹\s*[\d,]+\s*(?:\/\s*month|\/\s*mo|per\s*month|monthly)?/i);
  if (m) {
    const cand = m[0].trim().slice(0, 60);
    if (hasFakePrizeDefault(cand)) return '';
    return cand;
  }
  return '';
}

function extractDurationDeterministic(content: string): string {
  const s = String(content ?? '');
  const m = s.match(/(\d+\s*(?:months?|weeks?|days?))/i);
  if (m) return m[1].trim().slice(0, 60);
  return '';
}

function extractInternshipMode(content: string): string {
  const s = String(content ?? '');
  if (/hybrid/i.test(s)) return 'HYBRID';
  if (/onsite|on-site|in-person|office/i.test(s)) return 'ONSITE';
  return 'REMOTE';
}

/**
 * Internship fallback on 8k strip (+ search dump when SPA).
 * Grounded only, never-₹0, full-desc.
 */
export function buildInternshipDeterministicFallback(pageContent: string, url: string): Record<string, unknown> {
  const content = String(pageContent ?? '');
  let title = content.slice(0, 120).trim().split('\n')[0] || '';
  const mIntern = content.match(/([A-Z][^.!?\n]{10,80}intern(?:ship)?[^.!?\n]{0,40})/i);
  if (mIntern) {
    const cand = mIntern[0].trim().replace(/\s+/g, ' ').slice(0, 120);
    if (cand.length >= 10) title = cand;
  }
  const slug = titleFromUrlSlug(url);
  if ((!title || title.length < 10) && slug) title = slug;
  if (!title) title = 'Internship';

  let company = 'Unknown';
  if (title.includes(' at ')) {
    const after = title.split(' at ').pop()?.split('.')[0]?.trim() || '';
    if (after.length >= 2) company = after.slice(0, 100);
  } else {
    const cm = content.match(/(?:at|with|by)\s+([A-Z][A-Za-z0-9 &]{2,40})/);
    if (cm) company = cm[1].trim().slice(0, 100);
  }

  const description = cleanDescription(content.slice(0, 2000), { title, source: 'FETCH_DETAILS_FALLBACK' });
  const stipend = extractStipendDeterministic(content);
  const duration = extractDurationDeterministic(content);
  const mode = extractInternshipMode(content);
  let deadline: string | null = null;
  try {
    deadline = extractDeadlineFromContent(content) || '';
    if (!deadline) deadline = null;
  } catch {
    deadline = null;
  }

  return {
    title: title.slice(0, 150),
    company,
    role: title.split('.')[0].trim().slice(0, 120) || title.slice(0, 120),
    description,
    stipend: stipend || null,
    duration: duration || null,
    mode,
    deadline,
    startDate: null,
    url,
    targetDepartments: [],
    targetYears: [],
  };
}

// ─── Shape consistency ───

/**
 * Same envelope for BOTH fetch-details endpoints (backward-compatible spread).
 * Old hackathon clients read r.data.title (direct); old internship clients read
 * r.data.details.title (wrapped). New envelope exposes BOTH: {...fields, details}
 * on success, {details:null, message} on failure — so either accessor works.
 * Frontend migration (trivially safe, NOT done here — backend-only scope):
 *   hackathonAPI.fetchDetails = (url) => api.post('/hackathons/fetch-details', {url}).then(r => r.data.details ?? r.data)
 * Until then both shapes keep working.
 */
export function toFetchDetailsEnvelope(details: Record<string, unknown> | null, message?: string): Record<string, unknown> {
  if (details && typeof details === 'object') {
    const out: Record<string, unknown> = { ...(details as Record<string, unknown>), details };
    if (message) out['message'] = message;
    return out;
  }
  const out: Record<string, unknown> = { details: null };
  out['message'] = message || 'Could not fetch details. Please fill manually.';
  return out;
}
