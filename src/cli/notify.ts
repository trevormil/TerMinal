// Telegram + Slack fan-out for filings.
//
// Both destinations read a 0600 SIDECAR the app writes, not settings.json: the
// app seals its tokens with Electron safeStorage, which a plain Bun process
// cannot decrypt. No sidecar ⇒ that destination is simply off.
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { updateJsonListShared } from '../runner/state-io'
import { HITL_FILE, LEGACY_TG_SCRIPT, SETTINGS_FILE, SLACK_SIDECAR, TG_SIDECAR } from './env'
import type { HitlItem } from './types'

type TgCreds = { botToken: string; chatId: string }

// Canonical impl + tests: src/main/settings.ts:resolveTelegramCreds — keep in
// sync. A sealed {__terminalSecret} object is skipped (not a usable string).
export function tgCreds(): TgCreds | null {
  const pick = (o: any): TgCreds | null => {
    const bt = o?.botToken
    const ci = o?.chatId
    return typeof bt === 'string' && bt && typeof ci === 'string' && ci
      ? { botToken: bt, chatId: ci }
      : null
  }
  let sc: any = null
  let st: any = null
  try {
    sc = JSON.parse(readFileSync(TG_SIDECAR(), 'utf8'))
  } catch {
    /* no sidecar — fall through to settings.json */
  }
  try {
    st = JSON.parse(readFileSync(SETTINGS_FILE(), 'utf8'))?.telegram
  } catch {
    /* no settings, or no telegram block */
  }
  return pick(sc) ?? pick(st)
}

export function pingTelegram(text: string, inlineKeyboard?: unknown[][]): void {
  const t = tgCreds()
  if (t) {
    fetch(`https://api.telegram.org/bot${t.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: t.chatId,
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

export function hitlButtons(item: HitlItem): unknown[][] {
  const row: unknown[] = [{ text: '✅ Resolve', callback_data: `hitl:resolve:${item.id}` }]
  if (item.runId) row.push({ text: '🪵 Tail run', callback_data: `run:tail:${item.runId}` })
  return [row]
}

// ── slack inbox destination ──────────────────────────────────────────────
// Canonical impl + tests: src/shared/slack.ts + src/main/slack-mirror.ts — keep
// in sync. The app mirrors the decrypted bot token + channel config to
// slack.local.json whenever inbox.destination posts to Slack.
type SlackCfg = {
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

export function slackSlug(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[/\s]+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function slackChannelFor(category: string | undefined, cfg: SlackCfg): string {
  const fallback = slackSlug(cfg.defaultChannel).slice(0, 80) || 'terminal-inbox'
  const slug = category && category !== 'Uncategorized' ? slackSlug(category) : ''
  if (!slug) return fallback
  const prefix = slackSlug(cfg.channelPrefix)
  return (prefix ? `${prefix}-${slug}` : slug).slice(0, 80)
}

function slackApi(token: string, method: string, body: unknown): Promise<any> {
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

/**
 * Post a filing to its category's channel (create-on-miss, default-channel
 * fallback), then stamp the message ref back onto the stored item so the app
 * can thread recurrences + react on resolve. Best-effort, never blocks filing.
 */
export function mirrorHitlToSlack(item: HitlItem): void {
  const cfg = slackCfg()
  if (!cfg) return
  ;(async () => {
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
      updateJsonListShared<HitlItem>(HITL_FILE(), (list) =>
        list.map((h) =>
          h.id === item.id ? { ...h, slackChannel: res.channel, slackTs: res.ts } : h,
        ),
      )
    }
  })().catch(() => {})
}
