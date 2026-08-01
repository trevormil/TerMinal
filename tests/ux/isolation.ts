// Isolation primitives for the UX suite.
//
// Test pollution of real user state happened three separate times in one day:
// a test overwrote the developer's global agent registry (twice), and another
// shelled out to the real `claude` CLI twenty times per run against a paid
// subscription. Nothing about those tests looked dangerous — they just booted
// code that resolves `~/.config/TerMinal` and `claude` by default.
//
// So the suite never trusts a default. Every launch gets:
//   - a throwaway HOME *and* CFFIXED_USER_HOME (CoreFoundation's
//     NSHomeDirectory() ignores $HOME, so Electron's userData would otherwise
//     still land in the real home — see scripts/ci/smoke-packaged-app.sh),
//   - a throwaway TERMINAL_CONFIG_DIR (src/main/config-dir.ts),
//   - every engine binary pointed at a stub script, so no session can ever
//     spawn a real agent CLI,
// and the whole run is bracketed by a fingerprint of the real config dir
// (see `fingerprintRealConfigDir`) that fails the suite on any difference.

import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'

export const realConfigDir = (): string => join(homedir(), '.config', 'TerMinal')

/**
 * A content-independent fingerprint of the real ~/.config/TerMinal: every file's
 * path, size and mtime. Cheap (no reads) but sensitive enough to catch a write,
 * a truncation, or a new junk file — which is exactly how the three real
 * incidents presented.
 */
export function fingerprintRealConfigDir(): string {
  return fingerprintDir(realConfigDir())
}

/** Exported separately so the mechanism can be exercised against a scratch
 *  directory without touching (or trusting the state of) the real one. */
export function fingerprintDir(root: string): string {
  if (!existsSync(root)) return 'absent'
  const lines: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return // unreadable dir — record nothing, both sides see the same
    }
    for (const name of entries) {
      const abs = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(abs)
      else lines.push(`${relative(root, abs)}\t${st.size}\t${st.mtimeMs}`)
    }
  }
  walk(root)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

export type Sandbox = {
  home: string
  configDir: string
  repo: string
  /** Env to hand to `_electron.launch`. */
  env: Record<string, string>
}

/** A shell script that impersonates an agent CLI: prints a marker and idles.
 *  Every engine path points here, so a session PTY can never reach the real
 *  `claude` / `codex` / `cursor-agent` binaries (or a paid API). */
const STUB_ENGINE = `#!/bin/sh
# UX-suite stub engine. Never talks to a network or a paid API.
echo "[ux-suite stub engine] argv: $*"
# Idle so the PTY stays open and the session looks alive, but die with the app.
while :; do sleep 3600; done
`

/**
 * Build a throwaway HOME + config dir + git fixture repo. Everything the app
 * could persist lands under here, and the caller deletes it afterwards.
 */
/** Markdown that renders VISIBLY differently from its raw source, so the detail
 *  view can be proven to render markdown rather than just echo the string. */
export const FIXTURE_ACTIVITY_HEADING = 'Fixture activity heading'
export const FIXTURE_ACTIVITY_DETAIL = [
  `## ${FIXTURE_ACTIVITY_HEADING}`,
  '',
  'A paragraph of detail that is far longer than the two lines the feed row',
  'clamps to, which is the whole reason this view exists.',
  '',
  '- first bullet',
  '- second bullet',
].join('\n')

export function makeSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), 'terminal-ux-home-'))
  const configDir = mkdtempSync(join(tmpdir(), 'terminal-ux-config-'))
  const binDir = join(home, 'bin')
  mkdirSync(binDir, { recursive: true })
  const stub = join(binDir, 'stub-engine')
  writeFileSync(stub, STUB_ENGINE)
  chmodSync(stub, 0o755)

  const repo = join(home, 'fixture-repo')
  mkdirSync(repo, { recursive: true })

  // Settings: already onboarded (the Onboarding + Orientation screens gate the
  // whole app otherwise), and every engine pinned to the stub.
  const engines = Object.fromEntries(
    ['claude', 'codex', 'cursor', 'local', 'hermes', 'opencode', 'openrouter', 'openai-compat'].map(
      (id) => [id, { path: stub, defaultModel: '' }],
    ),
  )
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify(
      {
        onboarded: true,
        projectsDir: join(home, 'projects'),
        worktreesDir: join(home, 'worktrees'),
        defaultEngine: 'claude',
        engines,
        // The Panels tab hides itself until a panel is configured, so without
        // this the suite's "open every tab" test would silently skip it.
        // about:blank keeps the embedded webview off the network.
        pinnedPanels: [{ id: 'ux-fixture-panel', title: 'Fixture panel', url: 'about:blank' }],
      },
      null,
      2,
    ),
  )

  // One activity event with a real markdown body, so the feed has something to
  // open and the detail view has something to render. Without it the drill-in
  // test would pass against an empty feed and prove nothing.
  writeFileSync(
    join(configDir, 'activity.jsonl'),
    `${JSON.stringify({
      id: 'ux-fixture-activity',
      ts: Date.now(),
      kind: 'info',
      title: 'Fixture activity event',
      detail: FIXTURE_ACTIVITY_DETAIL,
      repo: 'ux-fixture',
    })}\n`,
  )

  return {
    home,
    configDir,
    repo,
    env: {
      HOME: home,
      CFFIXED_USER_HOME: home,
      TERMINAL_CONFIG_DIR: configDir,
      // Belt-and-braces: even if a code path bypasses the config-dir seam
      // (ticket 108 tracks the sites that still do), it lands in the sandbox.
      XDG_CONFIG_HOME: join(home, '.config'),
      TERMINAL_UX_SUITE: '1',
      // Hidden-but-rendering (BrowserWindow `show: false`). The renderer is
      // fully live and screenshots still work; the window just never appears or
      // steals focus — which matters because TerMinal is the developer's daily
      // driver and the suite runs while they are working. HEADED=1 to watch it.
      TERMINAL_HEADLESS: process.env.HEADED === '1' ? '0' : '1',
    },
  }
}
