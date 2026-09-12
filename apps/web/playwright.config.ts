import { defineConfig, devices } from '@playwright/test'

// Smoke-only config (10 paths, docs/seo.md). Browsers install via `npx playwright install`.
// Run: npm run test:e2e -w @campusflow/web (requires `npm run dev -w @campusflow/web` on :3000
// and API on :4000, or set BASE_URL).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
