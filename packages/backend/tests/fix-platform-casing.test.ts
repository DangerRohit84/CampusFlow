/**
 * LIVE bug regression: Prisma `platform` is now a NATIVE enum (Order 4,
 * values UPPERCASE like CODECHEF) but code sent lowercase "codechef".
 * The `as any` cast at syncEngine.ts:311-313 lied to tsc — runtime rejects.
 *
 * Contract:
 * - ONE choke point: toPlatformEnum() (upper-case + validate against the REAL
 *   Prisma `Platform` enum, throw on unknown) used at EVERY Prisma call
 *   (findMany in-filter, createMany data, updateMany where, deleteMany,
 *   groupBy, fallback). No lying `as any` casts for platform.
 * - API shape stable: frontend sends/keys lowercase ('codechef',
 *   PlatformLogo/history filter/platformColors) — routes accept lowercase and
 *   map DB UPPERCASE back to lowercase in JSON (Prisma boundary only).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Platform } from '@prisma/client'
import {
  toPlatformEnum,
  tryToPlatformEnum,
  toApiPlatform,
  toApiParticipations,
} from '../src/lib/platform'

const BACKEND_SRC = path.resolve(__dirname, '../src')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
}

describe('platform casing: lowercase input maps to REAL Prisma enum', () => {
  it('every lowercase fetcher/query string maps to a valid Platform member', () => {
    const valid = new Set<string>(Object.values(Platform) as string[])
    // Lowercase inputs from fetchers (platformFetchers.ts) + query params
    // (frontend sends lowercase ids) + handle keys.
    const lowercaseInputs = [
      'leetcode',
      'codeforces',
      'codechef',
      'hackerrank',
      'gfg',
      'atcoder',
      'other',
    ]
    for (const input of lowercaseInputs) {
      const mapped = toPlatformEnum(input)
      expect(
        valid.has(mapped),
        `"${input}" must map to a REAL Platform enum member (got "${mapped}")`
      ).toBe(true)
      expect(Object.values(Platform)).toContain(mapped)
    }
  })

  it('mixed-case + whitespace variants also normalize (case-insensitive boundary)', () => {
    expect(toPlatformEnum('CodeChef')).toBe(Platform.CODECHEF)
    expect(toPlatformEnum('  leetcode  ')).toBe(Platform.LEETCODE)
    expect(toPlatformEnum('CodeForces')).toBe(Platform.CODEFORCES)
    expect(toPlatformEnum('HACKERRANK')).toBe(Platform.HACKERRANK)
    expect(toPlatformEnum('Gfg')).toBe(Platform.GFG)
    expect(toPlatformEnum('AtCoder')).toBe(Platform.ATCODER)
    expect(toPlatformEnum('other')).toBe(Platform.OTHER)
  })

  it('unknown platforms fail closed (throw / null), never pass through as strings', () => {
    expect(() => toPlatformEnum('nosuchplatform')).toThrow(/Invalid platform/)
    expect(() => toPlatformEnum('')).toThrow(/Invalid platform/)
    expect(() => toPlatformEnum(null)).toThrow(/Invalid platform/)
    expect(() => toPlatformEnum(undefined)).toThrow(/Invalid platform/)
    expect(tryToPlatformEnum('nosuchplatform')).toBeNull()
    expect(tryToPlatformEnum('')).toBeNull()
  })

  it('API shape stable: DB UPPERCASE maps back to lowercase for the client', () => {
    expect(toApiPlatform('CODECHEF')).toBe('codechef')
    expect(toApiPlatform('LEETCODE')).toBe('leetcode')
    expect(toApiPlatform(Platform.GFG)).toBe('gfg')
    const rows = toApiParticipations([
      { platform: 'CODECHEF', contestName: 'A' },
      { platform: 'LEETCODE', contestName: 'B' },
    ] as any)
    expect(rows[0].platform).toBe('codechef')
    expect(rows[1].platform).toBe('leetcode')
  })
})

describe('platform casing: Prisma boundary uses the choke point (no lying casts)', () => {
  it('syncEngine normalizes via tryToPlatformEnum at every Prisma call', () => {
    const src = readSrc('services/syncEngine.ts')
    expect(src).toContain('tryToPlatformEnum')
    // No `as any` on platform Prisma args (the lie that hid the live bug).
    expect(src).not.toMatch(/platform:\s*.*as\s+any/)
    expect(src).not.toMatch(/platformMap/)
    // Typed enum: PreparedParticipation.platform is the native enum.
    expect(src).toMatch(/platform:\s*Platform\b/)
    // createMany / findMany / update without casts.
    expect(src).toContain('platform: { in: platformsIn }')
    expect(src).toContain('platform: p.platform')
    expect(src).toContain('platform: dbPlatform')
  })

  it('codingProfile routes normalize query/handle/fallback via toPlatformEnum', () => {
    const src = readSrc('routes/codingProfile.ts')
    expect(src).toContain('toPlatformEnum')
    expect(src).toContain('toApiParticipations')
    // No lowercase passthrough to Prisma.
    expect(src).not.toMatch(/where\.platform\s*=\s*String\(platform\)\.toLowerCase\(\)/)
    expect(src).not.toMatch(/platform:\s*contest\.platform\.toLowerCase\(\)/)
    expect(src).not.toMatch(/platform:\s*\{\s*in:\s*changed\s+as\s+any/)
  })

  it('publicProfile maps DB enum back to lowercase API shape', () => {
    const src = readSrc('routes/publicProfile.ts')
    expect(src).toContain('toApiPlatform')
  })

  it('lib/platform validates against the REAL Prisma enum (not a copy)', () => {
    const src = readSrc('lib/platform.ts')
    expect(src).toContain(`from '@prisma/client'`)
    expect(src).toContain('Object.values(Platform)')
  })
})
