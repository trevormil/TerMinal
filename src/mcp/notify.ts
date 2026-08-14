// Telegram + Slack fan-out, plus the in-flight effect tracker the stdin-end
// handler drains.
//
// Kept separate from src/cli/notify.ts on purpose: the two differ (this one
// tracks its promises so a one-shot invocation does not cut a post off
// mid-flight, and takes the hitl file as an argument). Collapsing them would
// change one side's behaviour, which is not what a port may do.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { updateJsonListShared } from '../runner/state-io'
import { LEGACY_TG_SCRIPT, SLACK_SIDECAR, TG_SIDECAR, readSettings } from './env'

// ── slack inbox destination ──────────────────────────────────────────────
// Canonical impl + tests: src/shared/slack.ts + src/main/slack-mirror.ts —
// keep in sync. The app mirrors the decrypted bot token + channel config to a
// 0600 sidecar (slack.local.json) whenever inbox.destination posts to Slack; no
// sidecar means Slack is off and everything below is a no-op.
export type SlackCfg = {
  botToken: string
  destination?: string
  defaultChannel?: string
  channelPrefix?: string
  autoCreateChannels?: boolean
  inviteUserId?: string
}

export function slackCfg(): SlackCfg | null {
  try {
    const c = JSON.parse(readFileSync(SLACK_SIDECAR(), 'utf8'))
    return typeof c?.botToken === 'string' && c.botToken ? (c as SlackCfg) : null
  } catch {
    return null
  }
}

/** In 'slack' mode Slack is the sole nag surface — the Telegram ping goes quiet. */
export function slackQuietsTelegram(): boolean {
  return slackCfg()?.destination === 'slack'
}

function slackSlug(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[/\s]+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function slackChannelFor(category: string | undefined, cfg: SlackCfg): string {
  const fallback = slackSlug(cfg.defaultChannel).slice(0, 80) || 'terminal-inbox'
  const slug = category && category !== 'Uncategorized' ? slackSlug(category) : ''
  if (!slug) return fallback
  const prefix = slackSlug(cfg.channelPrefix)
  return (prefix ? `${prefix}-${slug}` : slug).slice(0, 80)
}

export function slackApi(token: string, method: string, body: unknown): Promise<any> {
  return fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json())
}

/** Slack effects still in flight — drained by the stdin-end handler. */
export const pendingEffects = new Set<Promise<unknown>>()

export function trackEffect<T>(promise: Promise<T>): Promise<T> {
  pendingEffects.add(promise)
  promise.catch(() => {}).finally(() => pendingEffects.delete(promise))
  return promise
}

/**
 * Post a filing to its category's channel (create-on-miss, default-channel
 * fallback), then stamp the message ref back onto the stored item so the app
 * can thread recurrences + react on resolve. Best-effort, never blocks filing.
 */
export function mirrorHitlToSlack(item: Record<string, any>, hitlFile: string): void {
  const cfg = slackCfg()
  if (!cfg) return
  // `void`: the whole point of trackEffect is that the caller does NOT await —
  // the stdin-end handler drains the set instead.
  void trackEffect(
    (async () => {
      const channel = slackChannelFor(item.category, cfg)
      const fallback = slackChannelFor(undefined, cfg)
      const marker = item.source === 'completion-hook' ? '✅' : '⛔'
      const text = `${marker} ${item.title}${item.action ? ` — ${item.action}` : ''}`
      const post = (to: string): Promise<any> =>
        slackApi(cfg.botToken, 'chat.postMessage', { channel: to, text })
      let res = await post(`#${channel}`)
      if (!res?.ok && res?.error === 'channel_not_found' && cfg.autoCreateChannels) {
        const created = await slackApi(cfg.botToken, 'conversations.create', { name: channel })
        if (created?.ok && created.channel?.id) {
          // Invite the operator: a bot-created channel appears in nobody's
          // sidebar until joined. Best-effort — never blocks the post.
          if (cfg.inviteUserId)
            await slackApi(cfg.botToken, 'conversations.invite', {
              channel: created.channel.id,
              users: cfg.inviteUserId,
            }).catch(() => {})
          res = await post(created.channel.id)
        }
      }
      if (!res?.ok && channel !== fallback) res = await post(`#${fallback}`)
      if (res?.ok && typeof res.channel === 'string' && typeof res.ts === 'string') {
        updateJsonListShared<Record<string, any>>(hitlFile, (list) =>
          list.map((h) =>
            h.id === item.id ? { ...h, slackChannel: res.channel, slackTs: res.ts } : h,
          ),
        )
      }
    })().catch(() => {}),
  )
}

// Resolve usable Telegram creds: the app seals its token in settings.json via
// Electron safeStorage, which a plain Bun script can't decrypt — so the app
// mirrors decrypted creds to a 0600 sidecar we read here. A sealed
// {__terminalSecret} object is skipped (not a usable string token). Canonical
// impl + tests: src/main/settings.ts:resolveTelegramCreds — keep in sync.
function tgCreds(): { botToken: string; chatId: string } | null {
  const pick = (o: any): { botToken: string; chatId: string } | null => {
    const bt = o?.botToken
    const ci = o?.chatId
    return typeof bt === 'string' && bt && typeof ci === 'string' && ci
      ? { botToken: bt, chatId: ci }
      : null
  }
  let sc: any = null
  try {
    sc = JSON.parse(readFileSync(TG_SIDECAR(), 'utf8'))
  } catch {
    /* no sidecar — fall through to settings.json */
  }
  return pick(sc) ?? pick(readSettings()?.telegram)
}

export function pingTelegram(text: string, inlineKeyboard?: unknown[][]): void {
  const telegram = tgCreds()
  if (telegram) {
    fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram.chatId,
        text,
        ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {})
    return
  }
  if (existsSync(LEGACY_TG_SCRIPT())) {
    try {
      const child = spawn(LEGACY_TG_SCRIPT(), ['--kind=blocked', text], { stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
    } catch {
      /* best effort — missing/broken Telegram must not block HITL */
    }
  }
}
