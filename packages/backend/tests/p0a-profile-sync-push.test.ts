/**
 * P0-A RED: profile sync socket push (kill 2s×30 poll).
 * Backend must emit room-targeted sync:done alongside legacy profile-sync.
 */
import { describe, it, expect } from 'vitest'

describe('P0-A profile sync push', () => {
  it('exposes room-targeted done events (legacy + done alias)', async () => {
    const mod = await import('../src/services/stagingCounts')
    // Additive helper lives alongside counts (single P0-A realtime module).
    expect(mod.PROFILE_SYNC_EVENTS).toContain('profile-sync')
    expect(mod.PROFILE_SYNC_EVENTS).toContain('profile-sync:done')
  })

  it('builds completed payload with completedAt ISO + status', async () => {
    const mod = await import('../src/services/stagingCounts')
    const payload = mod.buildProfileSyncPayload('u1', { synced: 3, platforms: ['CF'] })
    expect(payload.userId).toBe('u1')
    expect(payload.status).toBe('completed')
    expect(typeof payload.completedAt).toBe('string')
    expect(Number.isNaN(Date.parse(payload.completedAt))).toBe(false)
    expect(payload.synced).toBe(3)
  })

  it('codingProfile route emits done alias (backward-compat, fail-open)', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/routes/codingProfile.ts', 'utf8')
    expect(src).toContain('profile-sync:done')
    // Legacy event preserved (fail-open for old clients).
    expect(src).toContain("'profile-sync'")
  })
})
