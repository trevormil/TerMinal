// The isolation guarantee, asserted at the mechanism rather than the symptom.
//
// The before/after canary (canary.setup.ts + canary.check.ts) samples for
// damage. This proves the property that makes damage impossible: the launched
// app's own idea of "home" and "the config dir" is a temp directory. If these
// hold, no code path — including the ~52 that still bake `homedir()` in rather
// than going through src/main/config-dir.ts (ticket 108) — can reach real user
// state. Unlike the canary, this is unaffected by whatever else is running on
// the developer's machine, so it is strict everywhere.

import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { test, expect } from './app'
import { realConfigDir } from './isolation'

test('the launched app is fully sandboxed away from real user state', async ({ ux }) => {
  const seen = await ux.electronApp.evaluate(({ app }) => {
    return {
      // app.getPath('home') is Electron's own resolution of the user's home —
      // the same value os.homedir() returns, reachable without a dynamic import
      // (the main bundle is ESM and evaluate() has no import callback).
      home: app.getPath('home'),
      envHome: process.env.HOME || '',
      cfFixed: process.env.CFFIXED_USER_HOME || '',
      configDir: process.env.TERMINAL_CONFIG_DIR || '',
      userData: app.getPath('userData'),
      appData: app.getPath('appData'),
    }
  })

  const tmp = realpathSync(tmpdir())
  const under = (p: string) => realpathSync(p).startsWith(tmp)

  expect(seen.envHome, 'HOME').toBe(ux.sandbox.home)
  expect(seen.cfFixed, 'CFFIXED_USER_HOME').toBe(ux.sandbox.home)
  expect(seen.configDir, 'TERMINAL_CONFIG_DIR').toBe(ux.sandbox.configDir)
  // os.homedir() is what the un-seamed code paths use — the one that actually
  // matters, and the one CFFIXED_USER_HOME exists to pin on macOS.
  expect(under(seen.home), `app.getPath('home') = ${seen.home}`).toBe(true)
  expect(under(seen.userData), `userData = ${seen.userData}`).toBe(true)
  expect(under(seen.appData), `appData = ${seen.appData}`).toBe(true)
  expect(seen.home.startsWith(realConfigDir().replace(/\/\.config\/TerMinal$/, ''))).toBe(false)
})

test('no session can spawn a real agent CLI', async ({ ux }) => {
  // Twenty real `claude -p` invocations per suite run against a paid
  // subscription is the incident this prevents. Every engine binary in the
  // sandbox's settings.json points at a stub script, and the terminal proves it
  // by echoing its own marker.
  await ux.openTab('terminal')
  await expect(ux.page.getByText('[ux-suite stub engine]').first()).toBeVisible({ timeout: 20_000 })
})
