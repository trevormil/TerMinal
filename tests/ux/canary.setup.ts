// The pollution canary — first half. See canary.check.ts for the assertion.
//
// It fingerprints the developer's REAL ~/.config/TerMinal before the suite and
// compares after. This is not paranoia: it is literally how three separate
// state-pollution incidents were found in one day, and how the fixes were
// verified. Making it permanent means the next regression fails a test instead
// of destroying an agent registry.

import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CANARY_STAMP } from './canary-path'
import { fingerprintRealConfigDir } from './isolation'

test('canary: record the real config dir fingerprint', async () => {
  const fp = fingerprintRealConfigDir()
  mkdirSync(dirname(CANARY_STAMP), { recursive: true })
  writeFileSync(CANARY_STAMP, fp)
  expect(fp.length).toBeGreaterThan(0)
})
