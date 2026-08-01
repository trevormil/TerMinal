// The Playwright fixture wrapper around launchApp(). Specs import `test` and
// `expect` from here; the launch mechanics live in launch-app.ts so the tier-2
// taste script can reuse them without pulling in the test runner.

import { test as base } from '@playwright/test'
import { launchApp, type UxApp } from './launch-app'

export { launchApp, repoRootDir } from './launch-app'
export type { UxApp, Failures } from './launch-app'

export const test = base.extend<{ ux: UxApp }>({
  ux: async ({}, use) => {
    const { app, dispose } = await launchApp()
    try {
      await use(app)
    } finally {
      await dispose()
    }
  },
})

export { expect } from '@playwright/test'
