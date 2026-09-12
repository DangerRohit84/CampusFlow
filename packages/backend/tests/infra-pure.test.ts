/**
 * Track 4 — hermetic tests for cache/coalesce + notify chunking + DI container.
 * Pure — no DB, no network, no timers beyond short TTL waits.
 */
import { describe, it, expect } from 'vitest';
import { CoalescingCache, cacheKey } from '../src/lib/coalesce';
import { chunk, uniqueIds, NOTIFY_CHUNK_SIZE } from '../src/services/notify/chunked';
import { container, TOKENS, resetContainerForTests } from '../src/lib/container';

describe('CoalescingCache (coalesce SSOT)', () => {
  it('coalesces concurrent gets to one promise', async () => {
    const c = new CoalescingCache<number>(1000);
    let calls = 0;
    const p = (async () => {
      calls++;
      return 42;
    })();
    c.set('k', p);
    expect(await c.get('k')).toBe(42);
    expect(await c.get('k')).toBe(42);
    expect(calls).toBe(1);
  });

  it('expires entries after TTL and clears on demand', async () => {
    const c = new CoalescingCache<string>(10);
    c.set('k', Promise.resolve('v'));
    expect(await c.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 25));
    expect(await c.get('k')).toBeNull();
    c.set('a', Promise.resolve('1'));
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('cacheKey normalizes platform/handle', () => {
    expect(cacheKey('LeetCode', '  User1 ')).toBe('leetcode:user1');
  });
});

describe('notify/chunked SSOT', () => {
  it('chunk defaults to 500 parity', () => {
    expect(NOTIFY_CHUNK_SIZE).toBe(500);
    const rows = Array.from({ length: 1200 }, (_, i) => i);
    const parts = chunk(rows, NOTIFY_CHUNK_SIZE);
    expect(parts.map((p) => p.length)).toEqual([500, 500, 200]);
  });

  it('uniqueIds dedupes + drops blanks', () => {
    expect(uniqueIds(['a', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('DI container', () => {
  it('registers, memoizes, resets, and throws on unknown tokens', () => {
    resetContainerForTests();
    let builds = 0;
    container.register('track4-probe', () => {
      builds++;
      return { ok: true };
    });
    expect(container.resolve<{ ok: boolean }>('track4-probe')).toEqual({ ok: true });
    expect(container.resolve<{ ok: boolean }>('track4-probe')).toEqual({ ok: true });
    expect(builds).toBe(1);
    expect(() => container.resolve('nope')).toThrow(/no provider/);
    container.reset();
    expect(TOKENS.prisma).toBe('prisma');
    resetContainerForTests();
  });
});
