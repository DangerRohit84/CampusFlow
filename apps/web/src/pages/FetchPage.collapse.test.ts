// FetchPage collapse test — locks Automatic Fetch expand/collapse behavior.
// WHY: panel must be collapsed by default with badge visible, header button
// keyboard-accessible (aria-expanded, 44px), state persisted in localStorage.
// No behavior change to toggles/targets.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function src(): string {
  return readFileSync(join(ROOT, 'src', 'pages', 'FetchPage.tsx'), 'utf-8')
}

// Minimal localStorage stub for node env (vitest environment: node).
function installStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  const stub = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    _store: store,
  }
  // @ts-expect-error — node has no localStorage; stub it for helper tests.
  globalThis.localStorage = stub
  return stub
}

describe('auto-fetch collapse helpers', () => {
  beforeEach(() => {
    installStorage()
  })

  it('getInitialAutoFetchExpanded_collapsedByDefault_returnsFalse', async () => {
    const mod = await import('./FetchPage')
    expect(typeof mod.getInitialAutoFetchExpanded).toBe('function')
    expect(mod.getInitialAutoFetchExpanded()).toBe(false)
  })

  it('getInitialAutoFetchExpanded_storedExpanded_returnsTrue', async () => {
    installStorage({ 'campusflow:fetch:autoFetchExpanded': '1' })
    const mod = await import('./FetchPage')
    expect(mod.getInitialAutoFetchExpanded()).toBe(true)
  })

  it('persistAutoFetchExpanded_roundTrip_survivesReload', async () => {
    const stub = installStorage()
    const mod = await import('./FetchPage')
    expect(typeof mod.persistAutoFetchExpanded).toBe('function')
    mod.persistAutoFetchExpanded(true)
    expect(stub._store['campusflow:fetch:autoFetchExpanded']).toBe('1')
    expect(mod.getInitialAutoFetchExpanded()).toBe(true)
    mod.persistAutoFetchExpanded(false)
    expect(mod.getInitialAutoFetchExpanded()).toBe(false)
  })
})

describe('auto-fetch panel markup', () => {
  it('headerIsAccessibleButton_withBadgeSummaryVisible', () => {
    const s = src()
    // Expand/collapse control: native button with aria-expanded + controls.
    expect(s).toContain('aria-expanded')
    expect(s).toContain('aria-controls="auto-fetch-panel-body"')
    // 44px touch target on header button.
    expect(s).toMatch(/min-h-\[44px\]/)
    // Badge summary stays in header (visible when collapsed).
    expect(s).toContain('Cron will run')
    expect(s).toContain('Cron will skip')
    // Chevron affordance.
    expect(s).toMatch(/ChevronDown|chevron/i)
    // Persisted preference.
    expect(s).toContain('campusflow:fetch:autoFetchExpanded')
    expect(s).toContain('localStorage')
    // Collapsible body has stable id.
    expect(s).toContain('id="auto-fetch-panel-body"')
  })

  it('toggleAndTargets_unchanged_stillPresent', () => {
    const s = src()
    // Master toggle (role=switch) + per-platform targets must remain.
    expect(s).toContain('role="switch"')
    expect(s).toContain('aria-label="Toggle automatic fetch"')
    expect(s).toContain('handleAutoToggle')
    expect(s).toContain('handleSaveTargets')
    expect(s).toContain('Save Targets')
  })
})
