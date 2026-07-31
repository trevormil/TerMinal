// The UX suite's Playwright fixture: launch TerMinal under an isolated HOME,
// get past the first-run gates, land on a session with a repo attached, and
// collect every renderer-level failure signal for the test to assert on.
//
// Read tests/ux/isolation.ts first — the isolation contract is the reason this
// file exists in the shape it does.

import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixtureRepo } from './fixture-repo'
import { makeSandbox, type Sandbox } from './isolation'

const here = join(fileURLToPath(new URL('.', import.meta.url)))
export const repoRootDir = join(here, '..', '..')

/** Renderer failure signals, collected from the moment the page exists. */
export type Failures = {
  /** console.error / console.warn text. */
  console: string[]
  /** Uncaught exceptions in the renderer. */
  pageErrors: string[]
  /** Unhandled promise rejections (installed via an init script). */
  rejections: () => Promise<string[]>
}

// Console noise that is a fact about the harness, not a defect. Keep this list
// SHORT and justified — every entry is a defect the suite can no longer see.
const IGNORED_CONSOLE = [
  // The app checks for updates on load; the sandbox has no network/remote.
  /update check/i,
  // Electron's own devtools/autofill chatter on some macOS + Chromium builds.
  /Autofill\.(enable|setAddresses)/,
  /Request Autofill/,
  // Chromium's cache dir is inside the throwaway HOME and gets torn down.
  /Unable to move the cache|gpu_disk_cache/i,
  // Chromium's blanket warning about <webview>, which the Browser and Panels
  // tabs use by design. Not something a test run can change.
  /iframe which has both allow-scripts and allow-same-origin/,
]

const isIgnorable = (text: string) => IGNORED_CONSOLE.some((re) => re.test(text))

// Installed before the app's own scripts run. `pageerror` does not surface
// unhandled rejections, and an unhandled rejection is precisely the failure mode
// a half-wired tab produces (a badge polling an IPC channel nobody handles).
const REJECTION_HOOK = `
  window.__uxRejections = [];
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    window.__uxRejections.push(String((r && (r.stack || r.message)) || r));
  });
`

export type UxApp = {
  electronApp: ElectronApplication
  page: Page
  sandbox: Sandbox
  failures: Failures
  /** Ids of every tab currently in the tab bar, in render order. */
  tabIds: () => Promise<string[]>
  /** Click a tab by id and wait for the bar to mark it current. */
  openTab: (id: string) => Promise<void>
}

export async function launchApp(): Promise<{ app: UxApp; dispose: () => Promise<void> }> {
  const sandbox = makeSandbox()
  buildFixtureRepo(sandbox.repo)

  const electronApp = await _electron.launch({
    args: [join(repoRootDir, 'out', 'main', 'index.js')],
    cwd: repoRootDir,
    env: { ...process.env, ...sandbox.env } as Record<string, string>,
  })

  const consoleMsgs: string[] = []
  const pageErrors: string[] = []

  // Register on the context so the hook survives the reload below, which is the
  // load that actually runs the app we assert on.
  await electronApp.context().addInitScript(REJECTION_HOOK)

  let page = await electronApp.firstWindow()
  const attach = (p: Page) => {
    p.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      const text = m.text()
      if (!isIgnorable(text)) consoleMsgs.push(`[${m.type()}] ${text}`)
    })
    p.on('pageerror', (e) => pageErrors.push(e.stack || e.message))
  }
  attach(page)

  // Seed an already-open session and reload. `restored` is read from
  // localStorage at module scope in App.tsx, so this has to happen before the
  // load we test — and it is far more stable than driving the EntryScreen,
  // whose markup is under active change.
  //
  // engine 'claude' rather than 'local' because App drops local sessions when
  // restoring; the binary is the stub from makeSandbox(), so nothing real runs.
  await page.evaluate(
    ([repo]) => {
      localStorage.setItem(
        'gt.openSessions',
        JSON.stringify([
          {
            key: 'ux-suite',
            sessionId: '00000000-0000-4000-8000-000000000001',
            cwd: repo,
            name: 'ux-suite',
            engine: 'claude',
            mode: 'resume',
          },
        ]),
      )
      // Seven tabs (docs, help, notes, reports, sessions, workflow, activity)
      // ship hidden by default. The suite un-hides everything on purpose: a tab
      // the user can turn on is a tab that must open without exploding, and the
      // one that shipped broken this run was exactly such a tab.
      localStorage.setItem('gt.tabs.hidden', '[]')
      localStorage.setItem('gt.tabs.hidden.version', '99')
    },
    [sandbox.repo],
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  // The tab bar is empty while the repo context is still resolving; SessionView
  // says so explicitly. Wait for a real tab rather than a fixed sleep.
  await page.locator('[data-tab-id="terminal"]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-tab-id="tickets"]').waitFor({ state: 'visible', timeout: 30_000 })

  const app: UxApp = {
    electronApp,
    page,
    sandbox,
    failures: {
      console: consoleMsgs,
      pageErrors,
      rejections: () =>
        page.evaluate(() => (window as unknown as { __uxRejections: string[] }).__uxRejections),
    },
    tabIds: () =>
      page.locator('[data-tab-id]').evaluateAll((els) =>
        els
          .map((e) => e.getAttribute('data-tab-id') || '')
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i),
      ),
    openTab: async (id: string) => {
      const pill = page.locator(`[data-tab-id="${id}"]`).first()
      await pill.click()
      await pill.and(page.locator('[aria-current="page"]')).waitFor({ timeout: 10_000 })
    },
  }

  const dispose = async () => {
    await electronApp.close().catch(() => {})
    rmSync(sandbox.home, { recursive: true, force: true })
    rmSync(sandbox.configDir, { recursive: true, force: true })
  }
  return { app, dispose }
}
