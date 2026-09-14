// opportunities/stagesPrompt.ts — AI prompt builders (SRP extract from stages.ts).
// WHY: 60-line hackathon prompt + 40-line internship prompt were inline in enrich
// orchestration. Pure builders, unit-testable, no DB/network/AI calls.
//
// P1-5 prompt-cache structuring: Groq auto prefix-caching requires an EXACT
// static prefix (128+ tokens help, exact bytes required, 2h expiry). The
// frozen `ENRICH_SYSTEM_PREFIX_V1` below is byte-stable across deploys (bump
// the version — never edit in place — to invalidate deliberately) and both
// builders emit it FIRST with the varying query last, so repeat enrichments
// share the cacheable prefix (typical 40–80% input bill cut at 60%+ hits).
// Stable field order below is load-bearing for the same reason (no per-row
// hint reordering — hints are appended in a FIXED order by the caller).

/** Frozen enrich prompt version (bump to invalidate response cache + prefix). */
export const ENRICH_PROMPT_VERSION = 'v1'

/**
 * Frozen system prefix for enrichment (EXACT bytes — keep this string
 * literal stable; see module header for why).
 */
export const ENRICH_SYSTEM_PREFIX_V1 =
  'CampusFlow enrichment v1. Extract only explicitly stated facts. Never fabricate dates. Return ONLY the JSON object.\n'

export function buildHackathonEnrichPrompt(opts: {
  scrapedHints: string
  contentSection: string
}): string {
  const { scrapedHints, contentSection } = opts
  // P1-5 order: STATIC instruction block first (exact bytes across rows →
  // Groq prefix-cache hit), VARYING query last. All instruction text below
  // is verbatim (field parity with the pre-P1 prompt — only the position of
  // the varying Known-info/content moved to the end).
  return `${ENRICH_SYSTEM_PREFIX_V1}Enrich this hackathon with full details. Extract ALL available information from the scraped pages.

Extract and return a JSON object with ALL of these fields:

{
  "description": "full description (preserve venue, eligibility, judging, schedule details; do not truncate)",
  "targetDepartments": ["CSE", "IT", ...],
  "targetYears": [1, 2, 3, 4],
  "eligibility": "free text eligibility criteria",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "deadline": "YYYY-MM-DD or null",
  "teamSize": number or null,
  "themes": ["theme1", "theme2"],
  "location": "venue or city or null",
  "venue": "venue + metro (e.g. MAIT Campus, Delhi, nearest metro Rithala) or null",
  "mode": "ONLINE or OFFLINE or HYBRID",
  "prizePool": "multi-tier prizes joined (e.g. Campus Winner: ₹5,000, National Winner: ₹20,000) or null — never ₹0",
  "prizeTiers": ["Campus Winner: ₹5,000", "National Winner: ₹20,000"] or null,
  "perks": ["Goodies", "Internship"] or null,
  "duration": "duration text or null",
  "schedule": "event schedule summary or null",
  "judging": "judging criteria/points (e.g. 100 points: Innovation 30, Implementation 40) or null",
  "bootcamps": ["bootcamp1", "bootcamp2"] or null,
  "highlights": ["highlight1", "highlight2"] or null,
  "rounds": [
    {
      "roundNumber": 1,
      "title": "round name",
      "description": "what this round evaluates",
      "date": "YYYY-MM-DD or null",
      "resultDate": "YYYY-MM-DD or null"
    }
  ],
  "stages": [{"title": "Stage 1 Campus Round"}] or null
}

DEPARTMENT ANALYSIS (INFER from the topic — do NOT just extract explicit text):
- Software/Developer/Web/App/Cloud/Blockchain → CSE, IT, AIDS, CSBS, CYS, DS, MCA
- AI/ML/Data/Deep Learning/NLP/Computer Vision → CSE, IT, AIDS, AIML, DS
- Cybersecurity/Security/Ethical Hacking → CSE, IT, CYS
- IoT/Embedded/Edge Computing → CSE, IT, ECE, EEE
- Electronics/VLSI/Signal/Communication → ECE, EEE
- Mechanical/CAD/Robotics/Automotive → MECH, AUTO, IE
- Civil/Structural/Construction/Architecture → CIVIL, ARCH
- Chemistry/Biology/Biotech/Pharma → CHEM, BT, PHARMA, BIO
- Business/Marketing/Finance/Management → MBA
- If "open to all" or "all branches" → ["ALL"]
- If nothing specific → []

YEAR ANALYSIS (INFER from context):
- "beginner friendly" / "freshmen" / "no experience needed" → [1, 2]
- "final year" / "4th year" / "capstone" → [4]
- "pre-final year" / "3rd year" → [3]
- "2nd year" / "sophomore" → [2]
- "all years" / "open to all" → [1, 2, 3, 4]
- No info → []

CRITICAL RULES:
1. NEVER fabricate dates. Only use dates EXPLICITLY found. If none, set to null.
2. Extract rounds/phases/stages from the SCHEDULE page if available.
3. Extract prize breakdown from the PRIZES page if available.
4. Analyze the TOPIC to infer departments, not just extract text.
5. TIMELINE and ROUNDS are INDEPENDENT — handle them separately: If the source (e.g., Unstop) lists rounds/phases, extract "rounds" AND separately analyse timeline fields (startDate/endDate/deadline/duration) from the timeline/schedule content — do not leave timeline null just because rounds exist. Conversely, if the source has timeline dates but no explicit rounds, infer rounds from phase/schedule descriptions and keep timeline. Both must be preserved independently (fit-fest example: 1 rounds + Live pipeline + 27/9/2026 must all appear).
6. Return ONLY the JSON object, no other text.

VARYING QUERY (per opportunity — cache prefix ends above):
${scrapedHints ? `Known info:\n${scrapedHints}\n` : ''}${contentSection}`
}

export function buildInternshipEnrichPrompt(opts: {
  scrapedHints: string
  contentForPrompt: string
}): string {
  const { scrapedHints, contentForPrompt } = opts
  // P1-5 order: STATIC instruction block first (exact bytes across rows →
  // Groq prefix-cache hit), VARYING query last (same guarantee as hackathon).
  return `${ENRICH_SYSTEM_PREFIX_V1}Enrich this internship with full details. Extract ALL available information.

Extract and return a JSON object with ALL of these fields:

{
  "description": "enhanced brief description (2-3 sentences)",
  "targetDepartments": ["CSE", "IT", ...],
  "targetYears": [1, 2, 3, 4],
  "stipend": "stipend like ₹15,000/month or Unpaid or null",
  "duration": "like 3 months, 6 months or null",
  "mode": "REMOTE, ONSITE, or HYBRID",
  "deadline": "YYYY-MM-DD or null",
  "startDate": "YYYY-MM-DD or null"
}

DEPARTMENT ANALYSIS (INFER from the role and topic — do NOT just extract explicit text):
- Software/Developer/Engineer/Cloud → CSE, IT, AIDS, CSBS, CYS, DS, MCA
- AI/ML/Data/Deep Learning/NLP/Computer Vision → CSE, IT, AIDS, AIML, DS
- Cybersecurity/Security/Ethical Hacking → CSE, IT, CYS
- IoT/Embedded/Edge Computing → CSE, IT, ECE, EEE
- Hardware/Electronics/VLSI/Communication → ECE, EEE
- Mechanical/Design/Manufacturing → MECH, AUTO, IE
- Civil/Structural/Construction → CIVIL
- Marketing/Sales/Business/Management → MBA
- If "open to all" → ["ALL"]
- If nothing specific → []

YEAR ANALYSIS (INFER from context):
- "fresher" / "freshman" → [1]
- "2nd year" / "sophomore" → [2]
- "pre-final year" / "3rd year" → [3]
- "final year" / "4th year" → [4]
- "all years" / "open to all" → [1, 2, 3, 4]
- No info → []

CRITICAL RULES:
1. NEVER fabricate dates. Only use dates EXPLICITLY found. If none, set to null.
2. Analyze the ROLE/TOPIC to infer departments, not just extract text.
3. Return ONLY the JSON object, no other text.

VARYING QUERY (per opportunity — cache prefix ends above):
${scrapedHints ? `Known info:\n${scrapedHints}\n` : ''}${contentForPrompt ? `\nDescription / Page Content:\n${contentForPrompt.substring(0, 4000)}\n` : '\n(No description available)\n'}`
}
