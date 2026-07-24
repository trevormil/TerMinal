// Channel-agnostic OUTBOUND alert layer (ticket 0019). Activity events that
// warrant a ping are mapped to a NotifyKind and fanned out by dispatchAlert to
// every enabled NotifyChannel, with per-channel failure isolation (one channel
// throwing/rejecting never blocks the others or the caller). Concrete channels:
// Telegram (the pre-existing path, unchanged), macOS desktop notification, and
// a generic outbound webhook (covers Slack/Discord incoming webhooks — payload
// shape documented in docs/alert-channels.md). Inbound replies (AFK control)
// remain Telegram-only in telegram.ts. No electron imports here — the desktop
// channel takes an injected `show` so this module stays unit-testable.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Settings } from './settings'
import { sendUrl } from './telegram-api'

// The channel-agnostic event kinds — same vocabulary as the notify skill.
// In-app activity events map to done/blocked/info (notifyKindFor); 'question'
// is accepted for parity with skill-originated pings.
export type NotifyKind = 'done' | 'blocked' | 'question' | 'info'
export type NotifyRefs = {
  ticket?: number
  pr?: number
  runId?: string
  hitlId?: string
  repo?: string
}
export type NotifyChannelId = 'telegram' | 'desktop' | 'webhook' | 'push'
export type NotifyChannel = {
  id: NotifyChannelId
  enabled(): boolean
  send(
    kind: NotifyKind,
    title: string,
    detail: string | undefined,
    refs: NotifyRefs,
  ): void | Promise<void>
}

const KIND_EMOJI: Record<NotifyKind, string> = {
  done: '✅',
  blocked: '⛔',
  question: '❓',
  info: 'ℹ️',
}

// Structural view of an ActivityEvent (events.ts) — kept structural so events.ts
// can import this module without a cycle.
export type AlertSource = {
  kind: string
  title: string
  detail?: string
  repo?: string
  ref?: { ticket?: number; pr?: number }
  runId?: string
  hitlId?: string
  suppressTelegram?: boolean
}

/** Map an activity kind (+ title, for agent-run) to the channel-agnostic kind. */
export function notifyKindFor(ev: Pick<AlertSource, 'kind' | 'title'>): NotifyKind {
  if (ev.kind === 'error' || ev.kind === 'tests-fail' || ev.kind === 'blocked') return 'blocked'
  if (ev.kind === 'task-complete' || ev.kind === 'tests-pass' || ev.kind === 'pr-merged')
    return 'done'
  if (ev.kind === 'agent-run')
    return /failed|interrupted/i.test(ev.title)
      ? 'blocked'
      : /done/i.test(ev.title)
        ? 'done'
        : 'info'
  return 'info'
}

const message = (title: string, detail?: string) => (detail ? `${title} — ${detail}` : title)

/**
 * Fan one alert out to every enabled channel. Failure isolation is the
 * contract: enabled() probes and send() calls are individually guarded, sync
 * throws are caught, async rejections handled — a broken channel logs and the
 * rest still deliver. `suppressTelegram` (producers that already pinged
 * Telegram directly) skips only that channel.
 */
export function dispatchAlert(channels: NotifyChannel[], ev: AlertSource): void {
  const kind = notifyKindFor(ev)
  const refs: NotifyRefs = {
    ticket: ev.ref?.ticket,
    pr: ev.ref?.pr,
    runId: ev.runId,
    hitlId: ev.hitlId,
    repo: ev.repo,
  }
  for (const ch of channels) {
    if (ch.id === 'telegram' && ev.suppressTelegram) continue
    try {
      if (!ch.enabled()) continue
      Promise.resolve(ch.send(kind, ev.title, ev.detail, refs)).catch((e) =>
        console.error(`[gt] alert channel ${ch.id} failed:`, (e as Error).message),
      )
    } catch (e) {
      console.error(`[gt] alert channel ${ch.id} failed:`, (e as Error).message)
    }
  }
}

// --- telegram ----------------------------------------------------------------

const TG_SCRIPT = join(homedir(), '.claude', 'bin', 'telegram-notify.sh')

// Inline-keyboard for HITL filings: [Resolve] and, when a runId is known,
// [Tail run]. Everything else plays back as a plain notification.
function telegramButtons(kind: NotifyKind, refs: NotifyRefs): unknown[][] | null {
  if (kind !== 'blocked' || !refs.hitlId) return null
  const row: { text: string; callback_data: string }[] = [
    { text: '✅ Resolve', callback_data: `hitl:resolve:${refs.hitlId}` },
  ]
  if (refs.runId) row.push({ text: '🪵 Tail run', callback_data: `run:tail:${refs.runId}` })
  return [row]
}

/** sendMessage body for one alert (pure — unit-testable). */
export function telegramSendBody(
  chatId: string,
  kind: NotifyKind,
  title: string,
  detail: string | undefined,
  refs: NotifyRefs,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: `${KIND_EMOJI[kind]} ${message(title, detail)}`,
  }
  const buttons = telegramButtons(kind, refs)
  if (buttons) body.reply_markup = { inline_keyboard: buttons }
  return body
}

/** The pre-existing Telegram notify path as a NotifyChannel: native Bot API
 *  when token+chat are configured, else the project-template script fallback. */
export function createTelegramChannel(
  getSettings: () => Settings,
  deps: { fetchFn?: typeof fetch; spawnFn?: typeof spawn; scriptPath?: string } = {},
): NotifyChannel {
  const { fetchFn = fetch, spawnFn = spawn, scriptPath = TG_SCRIPT } = deps
  return {
    id: 'telegram',
    enabled: () => getSettings().telegram.notify, // opt-in, off by default
    send(kind, title, detail, refs) {
      const { telegram } = getSettings()
      if (telegram.botToken && telegram.chatId) {
        return fetchFn(sendUrl(telegram.botToken), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(telegramSendBody(telegram.chatId, kind, title, detail, refs)),
          signal: AbortSignal.timeout(8000),
        }).then(() => undefined)
      }
      if (!existsSync(scriptPath)) return // no native config + no script → skip silently
      spawnFn(scriptPath, [`--kind=${kind}`, message(title, detail)], { stdio: 'ignore' }).unref()
    },
  }
}

// --- desktop -----------------------------------------------------------------

/** Desktop notification channel. `show` is the Electron Notification shim,
 *  injected by events.ts so this module stays electron-free. */
export function createDesktopChannel(
  getSettings: () => Settings,
  show: (title: string, body: string) => void,
): NotifyChannel {
  return {
    id: 'desktop',
    enabled: () => getSettings().alerts.desktop.enabled,
    send(_kind, title, detail) {
      show(title, detail || '')
    },
  }
}

// --- push (TerMinal Remote for iOS) ------------------------------------------

/**
 * The phone is another alert channel, not a parallel notification path: every
 * alert Telegram would get, a paired iPhone gets too. `threadKey` lets the
 * notification deep-link into the session it is about.
 */
export function createPushChannel(
  isConfigured: () => boolean,
  send: (input: {
    title: string
    body: string
    threadKey?: string
    badge?: number
  }) => void | Promise<void>,
  openHitlCount: () => number,
): NotifyChannel {
  return {
    id: 'push',
    enabled: isConfigured,
    send(kind, title, detail, refs) {
      return send({
        title: `${KIND_EMOJI[kind]} ${title}`,
        // Never an empty body: iOS renders a body-less alert as the generic
        // "Notification" placeholder in stacked/summary surfaces.
        body: detail || title,
        // A run id doubles as the session key for session-sourced alerts, which
        // is what the app routes on.
        threadKey: refs.runId,
        badge: openHitlCount(),
      })
    },
  }
}

// --- webhook -----------------------------------------------------------------

export function isWebhookUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  try {
    const proto = new URL(url).protocol
    return proto === 'http:' || proto === 'https:'
  } catch {
    return false
  }
}

/** The JSON body POSTed by the webhook channel. `text` renders in Slack
 *  incoming webhooks, `content` in Discord; custom receivers consume the
 *  structured fields. Documented in docs/alert-channels.md — keep in sync. */
export function webhookPayload(
  kind: NotifyKind,
  title: string,
  detail: string | undefined,
  refs: NotifyRefs,
): Record<string, unknown> {
  const line = `${KIND_EMOJI[kind]} ${message(title, detail)}`
  return {
    source: 'terminal',
    kind,
    title,
    detail: detail || '',
    refs,
    ts: Date.now(),
    text: line,
    content: line,
  }
}

export function createWebhookChannel(
  getSettings: () => Settings,
  fetchFn: typeof fetch = fetch,
): NotifyChannel {
  return {
    id: 'webhook',
    enabled: () => {
      const w = getSettings().alerts.webhook
      return w.enabled && isWebhookUrl(w.url)
    },
    send(kind, title, detail, refs) {
      return fetchFn(getSettings().alerts.webhook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(webhookPayload(kind, title, detail, refs)),
        signal: AbortSignal.timeout(8000),
      }).then(() => undefined)
    },
  }
}

/** Settings "Test" button for the webhook channel: one POST, errors surfaced. */
export async function testWebhook(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!isWebhookUrl(url)) return { ok: false, error: 'Set a valid http(s) webhook URL first.' }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        webhookPayload('info', 'TerMinal test alert', 'Webhook channel is working.', {}),
      ),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Webhook ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
