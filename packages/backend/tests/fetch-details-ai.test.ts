/**
 * Regression tests for teacher paste-a-link AI fetch hardening (fix-fetch-details-ai).
 * TDD RED: these fail before shared fetchDetails.ts helper exists, pass after.
 *
 * Covers:
 *  - hallucinated prize/date stripped by validation gate (never-₹0, grounded-deadline)
 *  - deterministic fallback when AI key missing/fails (details.ts extractors, no null)
 *  - SPA path grounded (no invented dates when content short)
 *  - prompt alignment (shared builder, full-desc, never-₹0, TIMELINE/ROUNDS independent, INFER fix)
 *  - shape consistency (same envelope for hackathon + internship)
 *
 * Hermetic: no network, no DB, no AI calls. Pure helpers only.
 */
import { describe, it, expect } from 'vitest';

describe('fetch-details-ai guard (RED: helper missing)', () => {
  // Hardened for parallel-load flakiness (cold import of fetchDetails + heavy details/* chain):
  // 30s timeout + 2 retries, pure helpers (no network/DB) so retry is safe/idempotent.
  it('strips hallucinated ₹0 prize and ungrounded dates, keeps grounded', { timeout: 30_000, retry: 2 }, async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const content =
      'Smart India Hackathon. Registrations end 15 Sep 2026. Campus Winner ₹5,000. Venue MAIT Campus Delhi.';
    const raw = {
      title: 'Smart India Hackathon',
      description: 'Full desc with venue and judging',
      prizePool: 'Winner: ₹0',
      prizeTiers: ['Winner: ₹0', 'Campus Winner: ₹5,000'],
      deadline: '2099-01-01',
      startDate: '2026-09-15',
      rounds: [{ roundNumber: 1, title: 'Round 1', description: 'quiz', date: '2099-02-02', resultDate: null }],
    };
    const out = mod.sanitizeFetchDetailsAI('hackathon', raw, content);
    const data = (out as any).data ?? out;
    expect(data.prizePool).toBeNull();
    expect(JSON.stringify(data.prizeTiers)).toContain('5,000');
    expect(JSON.stringify(data.prizeTiers)).not.toContain('₹0');
    expect(data.deadline).toBeNull();
    // 2026-09-15 IS grounded ("15 Sep 2026" in content) → kept
    expect(data.startDate).toBe('2026-09-15');
    const rounds = (data as any).rounds;
    if (Array.isArray(rounds) && rounds.length) {
      expect(rounds[0].date).toBeNull();
    }
  });

  it('keeps grounded future deadline and real prizes', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const content = 'Hackathon. Registrations end 15 Sep 2026. Winner takes ₹50,000.';
    const raw = {
      title: 'Test Hack',
      prizePool: 'Winner: ₹50,000',
      deadline: '2026-09-15',
    };
    const out: any = mod.sanitizeFetchDetailsAI('hackathon', raw, content);
    const data = out.data ?? out;
    expect(data.prizePool).toContain('50,000');
    expect(data.deadline).toBe('2026-09-15');
  });

  it('omits generic fallback description instead of inventing', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const out: any = mod.sanitizeFetchDetailsAI(
      'hackathon',
      { title: 'X', description: 'Short Hackathon from Devfolio: X' },
      'some content here with enough length for grounding checks....................',
    );
    const data = out.data ?? out;
    expect(data.description === null || data.description === '' || data.description === undefined).toBe(true);
  });

  it('hackathon deterministic fallback uses details.ts extractors (never-₹0/full-desc/stages/judging)', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const content = [
      'WebCMD - MAIT Campus Hackathon. Organized by MAIT.',
      'Prizes: Campus Winner ₹5,000, National Winner ₹20,000. Perks: Goodies, Certificates.',
      'Dates: Registrations end 15 Sep 2026, Hackathon 20 Sep 2026 - 21 Sep 2026.',
      'Stages: Stage 1 Campus Round (online quiz), Stage 2 National Finale (offline build).',
      'Team: Individual participation.',
      'Eligibility: Open to all undergraduate students; CSE, IT eligible.',
      'Venue: MAIT Campus, Delhi. Nearest metro Rithala. Mode: Offline.',
      'Judging: 100 points total - Innovation 30, Implementation 40, Presentation 30.',
      'Schedule: Day 1 opening + hacking, Day 2 judging + results.',
    ].join('\n');
    const fb = mod.buildHackathonDeterministicFallback(content, 'https://unstop.com/o/webcmd-123');
    expect(fb.description.length).toBeGreaterThan(100);
    expect(fb.description).toContain('Rithala');
    expect(fb.prizePool).toContain('5,000');
    expect(fb.prizePool).toContain('20,000');
    expect(fb.prizePool).not.toContain('₹0');
    expect(Array.isArray(fb.stages) && fb.stages.length >= 2).toBe(true);
    expect(fb.judging).toMatch(/100/);
    expect(fb.teamSize).toBe(1);
    expect(fb.venue).toMatch(/Rithala|MAIT/);
  });

  it('internship deterministic fallback works on 8k strip without AI', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const content =
      'Software Developer Intern at Acme. Stipend ₹15,000/month. Duration 3 months. Mode Remote. Apply by 20 Oct 2026. Open to CSE students.';
    const fb = mod.buildInternshipDeterministicFallback(content, 'https://internshala.com/internship/123');
    expect(fb.title.length).toBeGreaterThan(3);
    expect(fb.description.length).toBeGreaterThan(20);
    expect(fb.stipend).toContain('15,000');
    expect(fb.stipend).not.toContain('₹0');
    expect(fb.url).toBe('https://internshala.com/internship/123');
  });

  it('shared prompt builder: full-desc + never-₹0 + TIMELINE/ROUNDS independent for both, internship INFER fix', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const hack = mod.buildFetchDetailsPrompt('hackathon', {
      url: 'https://example.com/hack',
      contentSection: 'Page content:\nhello',
      searchSection: '',
    });
    const intern = mod.buildFetchDetailsPrompt('internship', {
      url: 'https://example.com/intern',
      contentSection: 'Page content:\nhello',
      searchSection: '',
    });
    for (const p of [hack, intern]) {
      expect(p).toMatch(/never ₹0/i);
      expect(p).toMatch(/do not truncate/i);
      expect(p).toMatch(/TIMELINE and ROUNDS are INDEPENDENT/i);
      expect(p).toMatch(/Return ONLY the JSON object/);
    }
    expect(intern).not.toMatch(/brief description \(2-3 sentences\)/i);
    expect(intern).toMatch(/full description/i);
    expect(intern).toMatch(/INFER from.*role/i);
    expect(intern).not.toMatch(/ONLY if explicitly mentioned, otherwise \[\]/);
  });

  it('shape consistency: both envelopes expose same {details} contract', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const h = mod.toFetchDetailsEnvelope({ title: 'H' }, undefined);
    const i = mod.toFetchDetailsEnvelope({ title: 'I', company: 'C' }, undefined);
    expect(h).toHaveProperty('details');
    expect(i).toHaveProperty('details');
    expect((h as any).details.title).toBe('H');
    expect((i as any).details.title).toBe('I');
    const empty = mod.toFetchDetailsEnvelope(null, 'Could not fetch details. Please fill manually.');
    expect((empty as any).details).toBeNull();
    expect((empty as any).message).toMatch(/fill manually/);
  });

  it('isEnded helper flags past deadlines without dropping grounded data', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const content = 'Old Hack. Registrations end 01 Jan 2020. Prize ₹10,000.';
    const raw = { title: 'Old Hack 2020', deadline: '2020-01-01', prizePool: 'Winner: ₹10,000' };
    const out: any = mod.sanitizeFetchDetailsAI('hackathon', raw, content);
    expect(out.isEnded === true || (out.data && out.data.deadline === '2020-01-01')).toBe(true);
  });

  it('SPA path grounded: short content drops invented dates (omit-not-invent)', async () => {
    const mod = await import('../src/services/opportunities/fetchDetails');
    const shortContent = 'JS app';
    const raw = { title: 'SPA Hack', deadline: '2026-12-01', startDate: '2026-11-01', prizePool: 'Winner: ₹20,000' };
    const out: any = mod.sanitizeFetchDetailsAI('hackathon', raw, shortContent);
    const data = out.data ?? out;
    expect(data.deadline).toBeNull();
    expect(data.startDate).toBeNull();
    // Real prize without grounding requirement stays (prize grounding is fake-check only)
    expect(data.prizePool).toContain('20,000');
  });
});
