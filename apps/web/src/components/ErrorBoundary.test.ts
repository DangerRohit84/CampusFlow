// components/ErrorBoundary.test.ts — locks "Try again truly recovers" (PROD 500).
// WHY: user reported Try again only changed Request ID, same error persisted.
// Root cause: handleRetry cleared hasError flag but did NOT remount children
// (no key bump) nor clear query error cache, so a deterministic render throw
// re-fired synchronously via getDerivedStateFromError with a NEW requestId.
// Top-level boundary also trapped Back home / Contact support navigation while
// hasError stayed true, and support link dropped the requestId.
// TDD RED: these tests FAIL on the old implementation (no resetKey/retryCount,
// no query reset, no onHome/hard-reload, no contact href helper).
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ErrorBoundary from './ErrorBoundary'
import { queryClient } from '../lib/queryClient'

function makeInstance(state: Record<string, unknown>) {
  const inst = new (ErrorBoundary as unknown as new (p: { children: null }) => Record<string, unknown> & {
    state: Record<string, unknown>
    setState: (u: unknown) => void
    handleRetry: () => void
  })({ children: null })
  inst.state = { ...state }
  inst.setState = (updater: unknown) => {
    const next =
      typeof updater === 'function'
        ? (updater as (s: Record<string, unknown>) => Record<string, unknown>)(inst.state)
        : (updater as Record<string, unknown>)
    inst.state = { ...inst.state, ...next }
  }
  return inst
}

describe('ErrorBoundary requestId stability', () => {
  it('generates a non-empty requestId per error instance (not per render)', () => {
    const s1 = ErrorBoundary.getDerivedStateFromError(new Error('boom')) as Record<string, unknown>
    const s2 = ErrorBoundary.getDerivedStateFromError(new Error('boom')) as Record<string, unknown>
    expect(s1.hasError).toBe(true)
    expect(typeof s1.requestId).toBe('string')
    expect((s1.requestId as string).length).toBeGreaterThan(0)
    // Each error instance gets its own ID (retry churn is visible) — but the
    // ID must come from getDerivedState, never regenerated per render.
    expect(s1.requestId).not.toBe(s2.requestId)
  })
})

describe('ErrorBoundary Try again truly resets', () => {
  it('clears error AND bumps remount key + retryCount so children re-mount', () => {
    const inst = makeInstance({
      hasError: true,
      error: new Error('boom'),
      requestId: 'req-old',
      resetKey: 0,
      retryCount: 0,
    })
    ;(inst as unknown as { handleRetry: () => void }).handleRetry()
    expect(inst.state.hasError).toBe(false)
    expect(inst.state.error).toBeNull()
    // Old code had no resetKey/retryCount — same throwing child re-threw
    // immediately with only a new requestId. These two lines are the RED.
    expect(inst.state.resetKey).toBe(1)
    expect(inst.state.retryCount).toBe(1)
  })

  it('clears the query error cache so a bad cached query cannot re-throw', () => {
    const spy = vi.spyOn(queryClient, 'resetQueries')
    try {
      const inst = makeInstance({
        hasError: true,
        error: new Error('boom'),
        requestId: 'req-old',
        resetKey: 0,
        retryCount: 0,
      })
      ;(inst as unknown as { handleRetry: () => void }).handleRetry()
      // Old handleRetry never touched the query cache — RED.
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('Back home clears error state (top-level boundary must not trap navigation)', () => {
    const inst = makeInstance({
      hasError: true,
      error: new Error('boom'),
      requestId: 'req-old',
      resetKey: 0,
      retryCount: 1,
    }) as unknown as { handleHome?: () => void; state: Record<string, unknown> }
    // Old code had no handleHome — Link to="/" changed URL but the boundary
    // still rendered ErrorPage because hasError stayed true. RED.
    expect(typeof inst.handleHome).toBe('function')
    inst.handleHome?.()
    expect(inst.state.hasError).toBe(false)
  })

  it('exposes hard-reload fallback after repeated failures', () => {
    const inst = makeInstance({
      hasError: true,
      error: new Error('boom'),
      requestId: 'req-old',
      resetKey: 2,
      retryCount: 2,
    }) as unknown as { handleHardReload?: () => void; needsHardReload?: () => boolean }
    // Old code had no reload escape hatch — RED.
    const hasHelper =
      typeof inst.handleHardReload === 'function' || typeof inst.needsHardReload === 'function'
    expect(hasHelper).toBe(true)
  })
})

describe('ErrorPage support correlation', () => {
  it('contact link carries the requestId for support triage', async () => {
    // Helper lives beside ErrorPage so the link cannot drift from the ID.
    // Old ErrorPage linked to bare "/contact" — this import fails pre-fix (RED).
    const mod = (await import('../pages/ErrorPage')) as unknown as {
      contactHref?: (id: string) => string
    }
    expect(typeof mod.contactHref).toBe('function')
    const href = mod.contactHref?.('req-abc-123') ?? ''
    expect(href).toContain('/contact')
    expect(href).toContain(encodeURIComponent('req-abc-123'))
  })

  it('contact support Link clears error state (top-level must not trap support nav)', async () => {
    // WHY M1 trap: top-level boundary wraps <Routes>, so a bare Link to
    // /contact?requestId=... changed URL while hasError still rendered
    // ErrorPage. Home had onClick={onHome}; contact missed same pattern.
    // This test FAILS pre-fix (only 1 onClick={onHome} in ErrorPage).
    const inst = makeInstance({
      hasError: true,
      error: new Error('boom'),
      requestId: 'req-old',
      resetKey: 0,
      retryCount: 1,
    }) as unknown as { handleHome?: () => void; state: Record<string, unknown> }
    expect(typeof inst.handleHome).toBe('function')
    inst.handleHome?.()
    expect(inst.state.hasError).toBe(false)
    expect(inst.state.resetKey).toBe(1)
    expect(inst.state.retryCount).toBe(0)
    // Structural: contact Link must reuse onHome clear + keep ID in href.
    const pagePath = path.resolve(__dirname, '../pages/ErrorPage.tsx')
    const src = fs.readFileSync(pagePath, 'utf8')
    expect(src).toContain('to={contactHref(id)}')
    expect(src).toContain('onClick={onHome}')
    const clearCount = (src.match(/onClick=\{onHome\}/g) || []).length
    expect(clearCount).toBeGreaterThanOrEqual(2)
    const mod = (await import('../pages/ErrorPage')) as unknown as {
      contactHref?: (id: string) => string
    }
    const href = mod.contactHref?.('req-abc-123') ?? ''
    expect(href).toContain('/contact')
    expect(href).toContain(encodeURIComponent('req-abc-123'))
  })
})
