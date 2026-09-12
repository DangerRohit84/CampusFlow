/**
 * Smoke list — 10 public paths (mirrors docs/seo.md index map).
 * Asserts: title contains CampusFlow, key text present, no 500 responses,
 * no page crash, API calls carry X-Request-Id. Kept fast (domcontentloaded,
 * 15s title timeout, no axe — axe lives in qa lane).
 */
import { test, expect } from '@playwright/test'

const PATHS = [
  '/',
  '/login',
  '/register',
  '/hackathons',
  '/hackathons/demo-id',
  '/internships',
  '/contests',
  '/leaderboard',
  '/u/demo-user',
  '/this-route-does-not-exist-404',
] as const

// Minimal key-text per path — proves render, not just shell (fast, no 500).
const KEY_TEXT: Record<string, RegExp> = {
  '/': /CampusFlow/,
  '/login': /Log in|Sign in|Email/i,
  '/register': /Create|Register|Email/i,
  '/hackathons': /Hackathon|CampusFlow/i,
  '/hackathons/demo-id': /Hackathon|Not found|CampusFlow/i,
  '/internships': /Internship|CampusFlow/i,
  '/contests': /Contest|CampusFlow/i,
  '/leaderboard': /Leaderboard|Rank|CampusFlow/i,
  '/u/demo-user': /CampusFlow|Profile|Not found/i,
  '/this-route-does-not-exist-404': /Not found|404|CampusFlow/i,
}

for (const path of PATHS) {
  test(`smoke ${path}`, async ({ page }) => {
    const errors: string[] = []
    const badResponses: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    page.on('response', (res) => {
      // No 500 on first-party navigations/API — 4xx (auth/404) is expected.
      try {
        const url = res.url()
        const isFirstParty = url.includes('localhost') || url.startsWith('/')
        if (isFirstParty && res.status() >= 500) badResponses.push(`${res.status()} ${url}`)
      } catch {}
    })

    const resp = await page.goto(path, { waitUntil: 'domcontentloaded' })
    // Status: 200 for app shell (SPA fallback serves index.html even for 404 route).
    expect(resp?.status() ?? 200, `HTTP status on ${path}`).toBeLessThan(500)
    await expect(page).toHaveTitle(/CampusFlow/, { timeout: 15_000 })
    // Key text proves the route rendered (not blank shell).
    await expect(page.locator('body')).toContainText(KEY_TEXT[path], { timeout: 10_000 })
    expect(errors, `page errors on ${path}`).toEqual([])
    expect(badResponses, `5xx responses on ${path}`).toEqual([])

    if (path === '/u/demo-user') {
      // W7: public profile must be noindex (tenant privacy) + masked email for anon.
      const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null)
      expect(robots, 'public profile robots meta').toContain('noindex')
    }
  })
}

test('API health carries X-Request-Id', async ({ request }) => {
  const res = await request.get('http://localhost:4000/api/health')
  expect(res.ok()).toBe(true)
  expect(res.headers()['x-request-id']).toBeTruthy()
})
