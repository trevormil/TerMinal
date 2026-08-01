import { defineConfig } from '@playwright/test'

// Tier 2 (the AI taste pass) capture phase — see docs/ux-testing.md.
//
// A separate config, not a project in playwright.config.ts, so a bare
// `playwright test` can never run it. Tier 2 is non-deterministic and costs
// money; it must only ever run when someone asks for it, via
// `bun run ux:taste`.
export default defineConfig({
  testDir: './tests/ux',
  testMatch: /taste-capture\.ts/,
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
