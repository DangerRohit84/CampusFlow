/**
 * Systematic-debugging Phase 4 — failing reproduction for:
 *  1. Deadline status bug: past-deadline opps stay pending/visible instead of completed/expired.
 *  2. Prize currency bug: "$400" renders as "₹400" (hardcoded INR).
 * No fix yet — these imports do not exist, so this test MUST fail (red).
 */
import { describe, it, expect } from 'vitest';
import { isExpiredByDeadline, getHackathonDisplayStatus } from '../src/services/opportunities/expiry';
import { formatPrizeDisplay } from '../src/services/opportunities/prizeCurrency';

describe('deadline expiry (bug 1 repro)', () => {
  it('past deadline counts as expired', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isExpiredByDeadline(yesterday)).toBe(true);
  });

  it('hackathon with past deadline maps to completed, not ongoing', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(getHackathonDisplayStatus({ status: 'PUBLISHED', deadline: yesterday } as any)).toBe('completed');
  });
});

describe('prize currency preservation (bug 2 repro)', () => {
  it('preserves $ instead of rewriting to ₹', () => {
    expect(formatPrizeDisplay('Prize: $400')).toContain('$');
    expect(formatPrizeDisplay('Prize: $400')).not.toContain('₹');
  });

  it('preserves $800 total pool', () => {
    const out = formatPrizeDisplay('Grand Prize: $800');
    expect(out).toContain('$800');
  });
});
