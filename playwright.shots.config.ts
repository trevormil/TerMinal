import { defineConfig } from '@playwright/test'

// README screenshot capture (ticket 98) — see scripts/capture-readme-shots.ts.
//
// Its own config, like the taste pass, so a bare `playwright test` can never
// fire it. Capturing is slow, writes into the working tree, and should only
// happen when someone deliberately asks to regenerate the README images.
export default defineConfig({
  testDir: './tests/ux',
  testMatch: /readme-capture\.ts/,
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
})
