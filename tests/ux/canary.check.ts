// The pollution canary — second half. Runs as the `canary` project's teardown,
// i.e. after every UX test has finished. See canary.setup.ts.
//
// Strictness is environment-dependent, and deliberately so:
//
//   • On CI the real ~/.config/TerMinal does not exist and nothing else is
//     running, so ANY difference is the suite's fault. Hard failure, no
//     tolerance. This is the gate that matters — it catches exactly the failure
//     mode that bit three times: a code path that resolves the real path
//     instead of going through the config-dir seam.
//
//   • Locally, TerMinal is the developer's daily driver and is *running while
//     the suite runs* — the activity feed, statusline and ai-runs collectors
//     write to that directory continuously. A strict diff there is a guaranteed
//     false positive, and a canary that cries wolf gets deleted. So locally it
//     reports the delta and passes, unless TERMINAL_UX_STRICT_CANARY=1.
//
// The mechanism-level guarantee (every launch is sandboxed) is asserted
// separately and unconditionally by sandbox.spec.ts, which does not depend on
// the state of the developer's machine at all.

import { test, expect } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { CANARY_STAMP } from './canary-path'
import { fingerprintRealConfigDir, realConfigDir } from './isolation'

test('canary: the real config dir is untouched', async () => {
  let before = ''
  try {
    before = readFileSync(CANARY_STAMP, 'utf8').trim()
  } catch {
    throw new Error(`canary stamp missing at ${CANARY_STAMP} — the setup project did not run`)
  }
  rmSync(CANARY_STAMP, { force: true })
  const after = fingerprintRealConfigDir()
  if (after === before) return

  const message =
    `The UX suite may have modified ${realConfigDir()} (fingerprint moved ` +
    `${before.slice(0, 12)} → ${after.slice(0, 12)}). Something bypassed the ` +
    `sandbox (HOME / CFFIXED_USER_HOME / TERMINAL_CONFIG_DIR). Do not weaken ` +
    `this assertion — find the write.`

  const strict = !!process.env.CI || process.env.TERMINAL_UX_STRICT_CANARY === '1'
  if (strict) expect(after, message).toBe(before)
  else
    console.warn(
      `[ux canary] ${message}\n[ux canary] ` +
        'Non-strict locally: a running TerMinal writes there continuously. Re-run with TERMINAL_UX_STRICT_CANARY=1 with the app quit to check for real.',
    )
})
