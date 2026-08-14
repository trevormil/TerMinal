// Activity-feed, environment and alert-channel IPC (ticket 0122 index.ts
// decomposition). The feed itself, the env probe the Settings pane runs, the
// per-channel "send a test alert" buttons, and the automation-listener toggle.
// None of these are session-scoped, so the module has no deps.

import { handle } from '../typed-ipc'
import { readActivity, clearActivity, testDesktopAlert } from '../events'
import { detectEnv, installGtNotify } from '../env'
import { testTelegram } from '../telegram'
import { testSlack } from '../slack-mirror'
import { testWebhook } from '../notify-channels'
import { readSettings } from '../settings'
import { readListenerStatus } from '../listeners'

export function registerActivityIpc(): void {
  handle('activity:list', () => readActivity())
  // Count-only badge endpoints — the tab badges poll ~1/s while a terminal
  // streams; shipping the full lists over IPC just to count them was ~1MB/s of
  // renderer-side JSON deserialization.
  handle('activity:unseen-count', (_e, since: number, kinds: string[]) => {
    const hi = new Set(kinds)
    return readActivity().filter((ev) => ev.ts > since && hi.has(ev.kind)).length
  })
  handle('activity:clear', () => clearActivity())
  handle('env:detect', () => detectEnv())
  handle('env:install-gt-notify', () => installGtNotify())
  handle('telegram:test', () => testTelegram())
  handle('slack:test', () => testSlack())
  // One "send test alert" entry point per outbound channel (Settings → Alerts).
  // `webhookId` picks one destination out of the list; the renderer only holds a
  // mask of the URL, so it names the entry instead of sending the value back.
  handle('alerts:test', (_e, channel: 'telegram' | 'desktop' | 'webhook', webhookId?: string) => {
    if (channel === 'telegram') return testTelegram()
    if (channel === 'desktop') return testDesktopAlert()
    if (channel === 'webhook') {
      const hook = readSettings().alerts.webhooks.find((w) => w.id === webhookId)
      if (!hook) return { ok: false, error: 'Save the webhook before testing it.' }
      return testWebhook(hook.url)
    }
    return { ok: false, error: `unknown alert channel: ${channel}` }
  })
  // Read-only: the Runs tab shows listener status. Nothing in the UI toggles the
  // inbox — it is enabled by editing the listener settings file — so ticket 0124
  // removed the `listeners:toggle` channel and its writer.
  handle('listeners:status', () => readListenerStatus())
}
