// Filing out of the daemon, always through terminal-cli — which already owns
// severity handling and the Telegram/Slack fan-out. The daemon deliberately
// re-implements none of it.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { CLI } from './paths'
import type { Severity } from './types'

export function fileInbox(title: string, action: string, severity: Severity): void {
  const cli = CLI()
  if (!existsSync(cli)) return
  try {
    execFileSync(cli, ['hitl', title, action, `--severity=${severity}`], {
      stdio: 'ignore',
      timeout: 15000,
      env: { ...process.env, TERMINAL_REPO: '' },
    })
  } catch {
    /* a monitor cycle must not fail because the CLI did */
  }
}

/**
 * The Activity feed, NOT the Inbox. A local outage is something the operator
 * already knows about — their wifi is down, they are looking at it. Pausing is
 * worth a line in the feed and nothing more; a notification for it would be
 * exactly the spam this feature removes.
 */
export function emitActivity(kind: string, title: string, detail: string): void {
  const cli = CLI()
  if (!existsSync(cli)) return
  try {
    execFileSync(cli, ['activity', kind, title, detail], {
      stdio: 'ignore',
      timeout: 15000,
      env: { ...process.env, TERMINAL_REPO: '' },
    })
  } catch {
    /* a monitor cycle must not fail because the CLI did */
  }
}
