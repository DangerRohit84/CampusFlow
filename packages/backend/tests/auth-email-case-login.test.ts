/**
 * Auth email case-insensitive login — LEGACY ROW regression.
 * Phase 4 failing-test-first (systematic-debugging):
 * - Reproduces prod bug: `Demo@gmail.com` registered pre-normalization stays
 *   mixed-case in Postgres (case-sensitive B-tree @unique). Normalized
 *   `findUnique where email=demo@gmail.com` MISSES it → login 401.
 * - Proves fix: shared `findUserByEmailInsensitive()` (normalizeEmail SSOT +
 *   Prisma `mode:insensitive`) HITS the same legacy row for
 *   demo@gmail.com / DEMO@GMAIL.COM / ' demo@gmail.com '.
 * Hermetic, no DB: fake delegates mimic Postgres exact vs insensitive semantics.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  emailInsensitiveFilter,
  findUserByEmailInsensitive,
  buildBulkEmailInsensitiveWhere,
  emailsMatchInsensitive,
} from '../src/utils/authHardening'

// --- Fake Postgres semantics -------------------------------------------
// Real PG: `User.email @unique` is a case-sensitive B-tree. findUnique is an
// exact match; findFirst with mode:insensitive lowers both sides.
type FakeUser = { id: string; email: string; name: string }

function makeLegacyStore(): FakeUser[] {
  // Legacy row written BEFORE normalizeEmail SSOT (mixed-case preserved).
  return [{ id: 'u-legacy-1', email: 'Demo@gmail.com', name: 'Demo' }]
}

// Exact semantics: what `prisma.user.findUnique({ where: { email } })` does.
function fakeFindUnique(store: FakeUser[], email: string): FakeUser | null {
  return store.find((u) => u.email === email) ?? null
}

// Insensitive semantics: what `findFirst({ where: { email: { equals, mode: insensitive }}})` does.
function fakeFindFirstInsensitive(store: FakeUser[], filter: { equals: string; mode: string }): FakeUser | null {
  if (filter.mode !== 'insensitive') return fakeFindUnique(store, filter.equals)
  const want = filter.equals.toLowerCase()
  return store.find((u) => u.email.toLowerCase() === want) ?? null
}

// Minimal fake prisma delegate exposing both paths (mirrors real call sites).
function makeFakePrisma(store: FakeUser[]) {
  return {
    user: {
      findUnique: async ({ where }: any) => fakeFindUnique(store, where.email),
      findFirst: async ({ where }: any) => {
        const cond = (where as any)?.email
        if (cond && typeof cond === 'object' && 'equals' in cond) {
          return fakeFindFirstInsensitive(store, cond)
        }
        // Fallback OR-shape used by bulk prefetch (array of insensitive equals).
        const or = (where as any)?.OR as Array<{ email: { equals: string; mode?: string } }> | undefined
        if (Array.isArray(or)) {
          for (const branch of or) {
            const hit = fakeFindFirstInsensitive(store, {
              equals: branch.email.equals,
              mode: branch.email.mode ?? 'insensitive',
            })
            if (hit) return hit
          }
          return null
        }
        return null
      },
      findMany: async ({ where }: any) => {
        // Bulk path: WHERE email IN (...) is exact in PG; OR-insensitive hits legacy.
        if ((where as any)?.email?.in) {
          const list = (where as any).email.in as string[]
          const mode = (where as any).email.mode
          if (mode === 'insensitive') {
            const lowered = new Set(list.map((e) => String(e).toLowerCase()))
            return store.filter((u) => lowered.has(u.email.toLowerCase()))
          }
          return store.filter((u) => list.includes(u.email))
        }
        const or = (where as any)?.OR as Array<{ email: { equals: string; mode?: string } }> | undefined
        if (Array.isArray(or)) {
          const out: FakeUser[] = []
          for (const u of store) {
            if (
              or.some((b) => {
                const want = String(b.email.equals).toLowerCase()
                return u.email.toLowerCase() === want
              })
            ) {
              out.push(u)
            }
          }
          return out
        }
        return []
      },
    },
  }
}

describe('LEGACY BUG REPRO: exact findUnique misses Demo@gmail.com', () => {
  it('normalized exact lookup MISSES legacy mixed-case row (the prod 401)', () => {
    const store = makeLegacyStore()
    const loginKey = normalizeEmail('demo@gmail.com')
    expect(loginKey).toBe('demo@gmail.com')
    // This is what the OLD code did — exact findUnique on the normalized key.
    expect(fakeFindUnique(store, loginKey)).toBeNull()
    // Legacy row is still there under its original case.
    expect(fakeFindUnique(store, 'Demo@gmail.com')).not.toBeNull()
  })

  it('Demo@gmail.com registers, demo / DEMO / padded all login via insensitive helper', async () => {
    const store = makeLegacyStore()
    const db = makeFakePrisma(store) as any
    for (const variant of ['demo@gmail.com', 'DEMO@GMAIL.COM', ' demo@gmail.com ', 'Demo@Gmail.Com']) {
      const hit = await findUserByEmailInsensitive(db, variant, { select: { id: true } })
      expect(hit?.id).toBe('u-legacy-1')
    }
  })

  it('register duplicate check hits legacy row case-insensitively (no duplicate accounts)', async () => {
    const store = makeLegacyStore()
    const db = makeFakePrisma(store) as any
    // New registration `DEMO@gmail.com` must collide with legacy `Demo@gmail.com`.
    const dup = await findUserByEmailInsensitive(db, 'DEMO@gmail.com', { select: { id: true } })
    expect(dup).not.toBeNull()
  })

  it('emailInsensitiveFilter shares normalizeEmail SSOT (trim+lower + mode)', () => {
    expect(emailInsensitiveFilter('  Demo@Gmail.COM ')).toEqual({
      equals: 'demo@gmail.com',
      mode: 'insensitive',
    })
    expect(emailInsensitiveFilter('DEMO@GMAIL.COM')).toEqual({
      equals: 'demo@gmail.com',
      mode: 'insensitive',
    })
  })

  it('emailsMatchInsensitive covers College.adminEmail legacy compare', () => {
    // Stored legacy College.adminEmail `Admin@College.edu` vs register `admin@college.EDU `.
    expect(emailsMatchInsensitive('Admin@College.edu', 'admin@college.EDU ')).toBe(true)
    expect(emailsMatchInsensitive('Admin@College.edu', 'other@college.edu')).toBe(false)
    expect(emailsMatchInsensitive(null, 'a@x.edu')).toBe(false)
  })

  it('bulk prefetch where hits legacy mixed-case rows (exact IN would miss)', async () => {
    const store: FakeUser[] = [
      { id: 'u1', email: 'Demo@gmail.com', name: 'Demo' },
      { id: 'u2', email: 'teacher@college.edu', name: 'T' },
    ]
    const db = makeFakePrisma(store) as any
    const incoming = ['demo@gmail.com', 'teacher@college.edu', 'new@college.edu']
    // Exact IN (old bulk code) hits the exact-case row but MISSES the legacy-cased row.
    const exact = await db.user.findMany({ where: { email: { in: incoming } } })
    expect(exact.map((u: FakeUser) => u.id).sort()).toEqual(['u2'])
    // Insensitive OR where (new helper) hits both stored rows.
    const where = buildBulkEmailInsensitiveWhere(incoming)
    const insensitive = await db.user.findMany({ where })
    expect(insensitive.map((u: FakeUser) => u.id).sort()).toEqual(['u1', 'u2'])
  })
})
