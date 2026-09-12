/**
 * Regression tests for Fetch-All parsers (fix-fetch-all-parsers).
 * TDD RED: these fail before shared details.ts + parser fixes, pass after.
 *
 * Reference standard: Unstop WebCMD-MAIT example —
 *  ₹5k campus + ₹20k national + perks; 3 dates; 2 stages;
 *  Individual (teamSize 1); eligibility list; venue + Rithala metro;
 *  100pt judging; schedule.
 *
 * Rules under test (shared):
 *  - never invent ₹0 / $0 / 0-rounds / 0-participants as real data (omit absent)
 *  - capture multi-tier prizes + perks
 *  - capture multi-dates + stages, team size, eligibility, venue/mode, judging, full description
 *  - JSON schema backward-compatible (new fields optional)
 */
import { describe, it, expect } from 'vitest';
import { fetchDevfolioFromHTML } from '../src/services/opportunities/sources/devfolio';
import { parseDevpostDate } from '../src/services/opportunities/sources/devpost';
import {
  cleanDescription,
  formatUnstopPrizes,
  extractTeamSize,
  extractExplicitTeamSize,
  resolveUnstopTeamSize,
  cleanTierLabel,
  extractEligibility,
  extractVenueMode,
  extractJudging,
  extractScheduleText,
  extractStages,
  extractPrizeTiers,
  hasFakePrizeDefault,
  isGenericFallbackDescription,
} from '../src/services/opportunities/sources/details';

// ─── Unstop WebCMD-MAIT fixture (mimics search-result API item) ───
const WEBCMD_DETAILS = `
WebCMD - MAIT Campus Hackathon. Organized by MAIT.
Prizes: Campus Winner ₹5,000, National Winner ₹20,000. Perks: Goodies, Internship interviews, Certificates.
Dates: Registrations open 01 Sep 2026, Registrations end 15 Sep 2026, Hackathon 20 Sep 2026 - 21 Sep 2026.
Stages: Stage 1 Campus Round (online quiz), Stage 2 National Finale (offline build).
Team: Individual participation.
Eligibility: Open to all undergraduate students; 1st-4th year; CSE, IT, ECE eligible; MAIT + other colleges allowed.
Venue: MAIT Campus, Delhi. Nearest metro Rithala. Mode: Offline.
Judging: 100 points total - Innovation 30, Implementation 40, Presentation 30.
Schedule: Day 1 opening + hacking, Day 2 judging + results.
`.trim();

const WEBCMD_API_ITEM = {
  title: 'WebCMD - MAIT',
  details: WEBCMD_DETAILS,
  public_url: 'o/webcmd-mait-123',
  prizes: [
    { rank: 'Campus Winner', cash: 5000 },
    { rank: 'National Winner', cash: 20000 },
    { rank: 'Perks', cash: 0 },
  ],
  regnRequirements: { end_regn_dt: '2026-09-15', work_location_type: 'offline' },
  address_with_country_logo: { city: 'Delhi' },
  organisation: { name: 'MAIT' },
  participants_count: 150,
};

describe('Unstop WebCMD-MAIT reference standard', () => {
  it('formats multi-tier prizes without ₹0 and keeps perks', () => {
    const prizePool = formatUnstopPrizes(WEBCMD_API_ITEM.prizes as any);
    expect(prizePool).toContain('5,000');
    expect(prizePool).toContain('20,000');
    expect(prizePool.toLowerCase()).toContain('perks');
    expect(hasFakePrizeDefault(prizePool)).toBe(false);
    // Must mention both tiers
    expect(prizePool).toMatch(/Campus/i);
    expect(prizePool).toMatch(/National/i);
  });

  it('never invents ₹0 for missing/zero cash', () => {
    expect(formatUnstopPrizes([{ rank: 'Winner', cash: 0 }] as any)).not.toContain('₹0');
    expect(formatUnstopPrizes([] as any)).toBe('');
    expect(formatUnstopPrizes(null as any)).toBe('');
    expect(formatUnstopPrizes('' as any)).toBe('');
  });

  it('keeps full description (not truncated to 400/tagline-only)', () => {
    const desc = cleanDescription(WEBCMD_DETAILS, { title: 'WebCMD - MAIT', source: 'UNSTOP' });
    expect(desc.length).toBeGreaterThan(400);
    expect(desc).toContain('Rithala');
    expect(desc).toContain('₹5,000');
    expect(isGenericFallbackDescription(desc)).toBe(false);
  });

  it('extracts team size Individual -> 1', () => {
    expect(extractTeamSize(WEBCMD_DETAILS)).toBe(1);
    expect(extractTeamSize('Team size: 2-4 members')).toBe(4);
    expect(extractTeamSize('no team info here')).toBeNull();
  });

  it('extracts eligibility list', () => {
    const elig = extractEligibility(WEBCMD_DETAILS);
    expect(elig.length).toBeGreaterThan(20);
    expect(elig).toMatch(/undergraduate|1st|CSE/i);
  });

  it('extracts venue + Rithala metro + offline mode', () => {
    const { venue, location, mode } = extractVenueMode(WEBCMD_DETAILS, { city: 'Delhi' });
    expect(`${venue} ${location}`).toMatch(/Rithala|MAIT/i);
    expect(mode).toBe('OFFLINE');
  });

  it('extracts 100pt judging', () => {
    const judging = extractJudging(WEBCMD_DETAILS);
    expect(judging).toMatch(/100/);
    expect(judging.toLowerCase()).toMatch(/innovation|implementation|presentation/);
  });

  it('extracts schedule', () => {
    const sched = extractScheduleText(WEBCMD_DETAILS);
    expect(sched.toLowerCase()).toMatch(/day 1|opening|hacking/);
  });

  it('extracts 2 stages', () => {
    const stages = extractStages(WEBCMD_DETAILS);
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const joined = stages.map((s) => s.title).join(' ').toLowerCase();
    expect(joined).toContain('campus');
    expect(joined).toContain('national');
  });

  it('extracts multi-tier prizes + perks from text', () => {
    const { prizePool, tiers, perks } = extractPrizeTiers(WEBCMD_DETAILS);
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(prizePool).toContain('5,000');
    expect(prizePool).toContain('20,000');
    expect(hasFakePrizeDefault(prizePool)).toBe(false);
    expect(perks.join(' ').toLowerCase()).toMatch(/goodies|internship|certificate/);
  });
});

describe('no-fake-defaults across parsers', () => {
  it('devfolio HTML fallback never returns generic empty descriptions as real data', () => {
    const html = `<a href="https://test.devfolio.co/"><h3>Smart India Hackathon</h3><span>Online</span></a>`;
    const out = fetchDevfolioFromHTML(html);
    expect(out.length).toBeGreaterThan(0);
    // After fix: description must be omitted ('') not generic, participantsCount 0 means unknown (omit)
    // The helper flags generic fallbacks so callers can omit
    expect(isGenericFallbackDescription('Short Hackathon from Devfolio: X')).toBe(true);
    expect(isGenericFallbackDescription(out[0].description)).toBe(false);
    expect(out[0].description).toBe('');
  });

  it('parseDevpostDate never fabricates year-bumped dates', () => {
    // "May 19" without year should stay current-year, not invented future
    const v = parseDevpostDate('May 19');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cleanDescription omits absent instead of generic fallback', () => {
    expect(cleanDescription('', { title: 'X', source: 'MLH' })).toBe('');
    expect(cleanDescription('   ', { title: 'X', source: 'DORAHACKS' })).toBe('');
    expect(isGenericFallbackDescription('Hackathon from HackerEarth: Foo')).toBe(true);
    expect(isGenericFallbackDescription('Internship opportunity at Unknown')).toBe(true);
    expect(isGenericFallbackDescription('Short Hackathon from Hack2Skill: Foo')).toBe(true);
  });

  it('hasFakePrizeDefault catches ₹0 / $0 fabrications', () => {
    expect(hasFakePrizeDefault('Winner: ₹0')).toBe(true);
    expect(hasFakePrizeDefault('Prize: $0')).toBe(true);
    expect(hasFakePrizeDefault('Campus Winner: ₹5,000, National: ₹20,000')).toBe(false);
    expect(hasFakePrizeDefault('')).toBe(false);
  });

  it('extractors omit absent (null/empty) instead of inventing', () => {
    expect(extractTeamSize('')).toBeNull();
    expect(extractEligibility('')).toBe('');
    expect(extractJudging('')).toBe('');
    expect(extractScheduleText('')).toBe('');
    expect(extractStages('')).toEqual([]);
    expect(extractPrizeTiers('no prizes here').prizePool).toBe('');
  });
});

describe('parser warts — tier-label bleed + team-size conflict (2026-09-09 parity)', () => {
  it('strips tier bleed to rank phrase only (HackCelestial Jamming Sessions case)', () => {
    const text =
      'Mentor Guidance Jamming Sessions Exciting Goodies Prize Pool: ₹1,50,000 Top 3 teams will receive cash prizes.';
    const { tiers } = extractPrizeTiers(text);
    expect(tiers.length).toBeGreaterThan(0);
    const joined = tiers.join(' | ');
    expect(joined).not.toMatch(/Jamming|Goodies|idance/i);
    // Label is clean tier phrase, amount real
    expect(joined).toMatch(/₹1,50,000/);
    expect(Math.max(...tiers.map((t) => t.length))).toBeLessThan(40);
  });

  it('keeps ordinals intact (1st/2nd/3rd) instead of st/nd/rd fragments', () => {
    const text = 'Prize Pool ₹1,00,000: 1st Prize: ₹50,000 2nd Prize: ₹30,000 3rd Prize: ₹20,000';
    const { tiers } = extractPrizeTiers(text);
    const joined = tiers.join(' | ');
    expect(joined).toMatch(/1st Prize: ₹50,000/);
    expect(joined).toMatch(/2nd Prize: ₹30,000/);
    expect(joined).toMatch(/3rd Prize: ₹20,000/);
    expect(joined).not.toMatch(/(?:^|\s)st Prize|(?:^|\s)nd Prize|(?:^|\s)rd Prize/);
  });

  it('falls back to clean Prize: ₹X when no rank found', () => {
    const text = 'Compete for a total prize pool of ₹1,00,000! Results prize announcement Prize: ₹1,00,000';
    const { tiers } = extractPrizeTiers(text);
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) {
      expect(t).toMatch(/^.+?: ₹[\d,]+$/);
      expect(t).not.toMatch(/Compete for|announcement/i);
    }
    // At least one clean fallback Prize entry for the amount
    expect(tiers.join(' | ')).toMatch(/Prize: ₹1,00,000/);
  });

  it('dedupes same amount to one clean entry per amount', () => {
    const text = '1st Prize: ₹50,000 st Prize: ₹50,000 1st Place: ₹50,000 2nd Prize: ₹30,000';
    const { tiers } = extractPrizeTiers(text);
    const amounts = tiers.map((t) => (t.match(/₹([\d,]+)/) || [])[1]);
    expect(new Set(amounts).size).toBe(amounts.length);
    expect(tiers.join(' | ')).toMatch(/1st Prize: ₹50,000/);
  });

  it('cleanTierLabel strips bleed, keeps rank+prize window', () => {
    expect(cleanTierLabel('idance Jamming Sessions Exciting Goodies Prize')).toBe('Prize');
    expect(cleanTierLabel('Results prize announcement Prize')).toBe('Prize');
    expect(cleanTierLabel('First Place')).toBe('First Place');
    expect(cleanTierLabel('Consolation Prize')).toBe('Consolation Prize');
    expect(cleanTierLabel('Best UI UX')).toBe('Best UI UX');
  });

  it('prefers explicit Team Size field over body-text mining (HackMatrix 3 vs 4)', () => {
    // API explicit min=3 max=4 (range) beats mined "team 3" first-match → max 4
    expect(resolveUnstopTeamSize({ min_team_size: 3, max_team_size: 4 }, 'per team 3 4 members')).toBe(4);
    expect(resolveUnstopTeamSize({ min_team_size: 1, max_team_size: 5 }, 'Teams must consist of 1 to 5 members')).toBe(5);
    expect(resolveUnstopTeamSize({ min_team_size: 2, max_team_size: 2 }, 'anything')).toBe(2);
  });

  it('omits on conflicting explicit team-size values (honest-omit, never guess)', () => {
    // Invalid range (min > max) → omit
    expect(resolveUnstopTeamSize({ min_team_size: 5, max_team_size: 3 }, 'Team Size: 5 Team Size: 3')).toBeNull();
    // Two different explicit Team Size labels in body → omit
    expect(extractExplicitTeamSize('Team Size: 3 members. Team Size: 4 members.')).toBeNull();
    // Single explicit label → prefer it
    expect(extractExplicitTeamSize('Team Size: 3 members.')).toBe(3);
  });

  it('handles HTML entities in team ranges (&ndash; dash lost)', () => {
    expect(extractTeamSize('3&ndash;4 members per team')).toBe(4);
    expect(extractTeamSize('1&ndash;5 per team')).toBe(5);
  });
});
