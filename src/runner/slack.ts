// ── slack inbox destination ──────────────────────────────────────────────
// Canonical impl + tests: src/shared/slack.ts + src/main/slack-mirror.ts —
// keep in sync (this runner is a separate process baked into remote images
// with no sibling modules). The app mirrors the decrypted bot token + channel
// config to a 0600 sidecar (slack.local.json) whenever inbox.destination posts
// to Slack; no sidecar → Slack off, all no-ops.
import type { HitlItem } from '../shared/types/activity'
import { HITL_FILE, readJson, SLACK_SIDECAR } from './config'
import { inboxPathsFor, updateInbox } from '../shared/inbox-store'

export type SlackCfg = {
  botToken: string
  destination?: string
  defaultChannel?: string
  channelPrefix?: string
  autoCreateChannels?: boolean
  inviteUserId?: string
}

export function slackCfg(): SlackCfg | null {
  const c = readJson<SlackCfg>(SLACK_SIDECAR())
  return typeof c?.botToken === 'string' && c.botToken ? c : null
}

// In 'slack' mode Slack is the sole nag surface — the Telegram ping goes quiet.
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

type SlackResponse = {
  ok?: boolean
  error?: string
  channel?: string | { id?: string }
  ts?: string
}

export function slackApi(
  token: string,
  method: string,
  body: unknown,
): Promise<SlackResponse | undefined> {
  return fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json() as Promise<SlackResponse>)
}

// Post a filing to its category's channel (create-on-miss, default-channel
// fallback), then stamp the message ref back onto the stored item so the app
// can thread recurrences + react on resolve. Best-effort, never blocks filing.
export function mirrorHitlToSlack(item: HitlItem): void {
  const cfg = slackCfg()
  if (!cfg) return
  void (async () => {
    const channel = slackChannelFor(item.category, cfg)
    const fallback = slackChannelFor(undefined, cfg)
    const marker = item.source === 'completion-hook' ? '✅' : '⛔'
    const text = `${marker} ${item.title}${item.action ? ` — ${item.action}` : ''}`
    const post = (to: string): Promise<SlackResponse | undefined> =>
      slackApi(cfg.botToken, 'chat.postMessage', { channel: to, text })
    let res = await post(`#${channel}`)
    if (!res?.ok && res?.error === 'channel_not_found' && cfg.autoCreateChannels) {
      const created = await slackApi(cfg.botToken, 'conversations.create', { name: channel })
      const createdId =
        created?.channel && typeof created.channel === 'object' ? created.channel.id : undefined
      if (created?.ok && createdId) {
        // Invite the operator: a bot-created channel appears in nobody's
        // sidebar until joined. Best-effort — never blocks the post.
        if (cfg.inviteUserId)
          await slackApi(cfg.botToken, 'conversations.invite', {
            channel: createdId,
            users: cfg.inviteUserId,
          }).catch(() => undefined)
        res = await post(createdId)
      }
    }
    if (!res?.ok && channel !== fallback) res = await post(`#${fallback}`)
    if (res?.ok && typeof res.channel === 'string' && typeof res.ts === 'string') {
      const slackChannel = res.channel
      const slackTs = res.ts
      // Live items only: a stamp that arrives after the item was resolved is
      // a lost thread ref, never a lost item.
      updateInbox(inboxPathsFor(HITL_FILE()), (live) =>
        live.map((h) => (h.id === item.id ? { ...h, slackChannel, slackTs } : h)),
      )
    }
  })().catch(() => {})
}
