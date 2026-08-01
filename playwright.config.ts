import { defineConfig } from '@playwright/test'

// Tier 1 of the UX suite: deterministic Playwright driving the real Electron
// app. See docs/ux-testing.md.
//
// This config is NOT for browsers — Playwright is used purely for its Electron
// driver (`_electron.launch`), so no browser binaries are downloaded and there
// is no `playwright install` step in CI.
// Tier 2's capture phase deliberately lives in its OWN config
// (playwright.taste.config.ts): a project listed here would run on a bare
// `playwright test`, and tier 2 must never ride along with a per-PR run.
export default defineConfig({
  testDir: './tests/ux',
  // Each test boots a full Electron app (~5s) and drives a real UI. Generous,
  // but a test that needs more than this is hanging, not slow.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Serial. Every worker launches an Electron app under its own throwaway HOME;
  // running them in parallel on a 2-core CI runner makes launch timing — the
  // one thing the suite asserts on — the flakiest part of the suite.
  workers: 1,
  fullyParallel: false,
  // No retries: a UX test that only passes on the second attempt is a UX test
  // nobody will trust. Fix it or delete it.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  projects: [
    // The pollution canary brackets the whole run: `canary` records the real
    // config dir's fingerprint, `ux` runs, then `canary`'s teardown re-checks.
    {
      name: 'canary',
      testMatch: /canary\.setup\.ts/,
      teardown: 'canary-check',
    },
    {
      name: 'canary-check',
      testMatch: /canary\.check\.ts/,
    },
    {
      name: 'ux',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['canary'],
    },
  ],
})
