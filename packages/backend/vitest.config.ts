import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // P0 harness only: no coverage gates yet (target 80% critical / 60% overall per compendium §10).
    // Run: npm run test -w @campusflow/backend
    testTimeout: 10_000,
  },
})
