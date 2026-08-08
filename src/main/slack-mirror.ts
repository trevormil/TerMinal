// Slack delivery for inbox items (inbox.destination 'both' | 'slack').
//
// One-way in v1: filings post, dedup recurrences thread under the original
// message, resolves stamp a ✅ reaction. Interactivity (resolving FROM Slack)
// needs a Socket Mode app and is deliberately out of scope here.
//
// Delivery is best-effort and MUST never block or fail a filing — the durable
// record is hitl.json, Slack is a view of it. Everything here swallows errors.

import { blockEffect } from './effect-guard'
import {
  SLACK_RESOLVE_REACTION,
  mirrorsToSlack,
  slackChannelName,
  slackMessageFor,
  slackRecurrenceText,
} from '../shared/slack'
import { readSettings, type SlackCfg } from './settings'
import type { HitlItem } from './hitl'

export type SlackPostRef = { channelId: string; ts: string }

export type SlackApiCall = {
  token: string
  method: string
  body: Record<string, unknown>
}

/** Thin transport, injectable for tests. Slack errors arrive as {ok:false}. */
async function slackApi(call: SlackApiCall): Promise<unknown> {
  const res = await fetch(`https://slack.com/api/${call.method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${call.token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(call.body),
    signal: AbortSignal.timeout(8000),
  })
  return res.json()
}

type SlackApi = (call: SlackApiCall) => Promise<unknown>

type ApiResult = { ok?: boolean; error?: string; channel?: unknown; ts?: unknown }

function asResult(v: unknown): ApiResult {
  return v && typeof v === 'object' ? (v as ApiResult) : {}
}

/**
 * Create a channel and, when configured, invite the operator into it — a
 * bot-created channel appears in nobody's sidebar until joined, so without the
 * invite every new category means a manual channel-browser hunt. Best-effort:
 * already_in_channel (or any invite failure) never blocks the post.
 * Returns the new channel id, or null.
 */
async function createChannel(cfg: SlackCfg, name: string, api: SlackApi): Promise<string | null> {
  const created = asResult(
    await api({ token: cfg.botToken, method: 'conversations.create', body: { name } }),
  )
  const id = (created.channel as { id?: string } | undefined)?.id
  if (!created.ok || !id) return null
  if (cfg.inviteUserId) {
    try {
      await api({
        token: cfg.botToken,
        method: 'conversations.invite',
        body: { channel: id, users: cfg.inviteUserId },
      })
    } catch {
      /* best effort */
    }
  }
  return id
}

type SlackableHitl = Pick<
  HitlItem,
  | 'title'
  | 'source'
  | 'category'
  | 'repo'
  | 'action'
  | 'detail'
  | 'occurrenceCount'
  | 'slackChannel'
  | 'slackTs'
> & { severity?: 'urgent' | 'normal' | 'low' }

/**
 * Post a fresh filing. Routing ladder, one rung at a time, never a loop:
 *   1. the category's derived channel (by name)
 *   2. channel_not_found + autoCreate → conversations.create, retry by id
 *   3. still failing → the default channel (unless that's where we started)
 * Returns the message ref for later threading/reactions, or null.
 */
export async function deliverSlackPost(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<SlackPostRef | null> {
  try {
    const channel = slackChannelName(item.category, cfg)
    const fallback = slackChannelName(undefined, cfg)
    const message = slackMessageFor(item)
    const post = async (to: string): Promise<ApiResult> =>
      asResult(
        await api({
          token: cfg.botToken,
          method: 'chat.postMessage',
          body: { channel: to, ...message },
        }),
      )

    let res = await post(`#${channel}`)
    if (!res.ok && res.error === 'channel_not_found' && cfg.autoCreateChannels) {
      const id = await createChannel(cfg, channel, api)
      if (id) res = await post(id)
    }
    if (!res.ok && channel !== fallback) res = await post(`#${fallback}`)
    if (!res.ok || typeof res.channel !== 'string' || typeof res.ts !== 'string') return null
    return { channelId: res.channel, ts: res.ts }
  } catch {
    return null
  }
}

/** A dedup-window recurrence: thread under the original post, if we have one. */
export async function threadSlackRecurrence(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<void> {
  if (!item.slackChannel || !item.slackTs) return
  try {
    await api({
      token: cfg.botToken,
      method: 'chat.postMessage',
      body: {
        channel: item.slackChannel,
        thread_ts: item.slackTs,
        text: slackRecurrenceText({ title: item.title, occurrenceCount: item.occurrenceCount }),
      },
    })
  } catch {
    /* best effort */
  }
}

/** Resolve → ✅ on the original message. Slack rejects a duplicate reaction
 *  with already_reacted; that's success for our purposes. */
export async function reactSlackResolved(
  cfg: SlackCfg,
  item: SlackableHitl,
  api: SlackApi = slackApi,
): Promise<void> {
  if (!item.slackChannel || !item.slackTs) return
  try {
    await api({
      token: cfg.botToken,
      method: 'reactions.add',
      body: { channel: item.slackChannel, timestamp: item.slackTs, name: SLACK_RESOLVE_REACTION },
    })
  } catch {
    /* best effort */
  }
}

/** Live config when Slack delivery should run, else null. The effect guard
 *  makes this unreachable from tests, same as the Telegram path. */
export function slackDelivery(): SlackCfg | null {
  if (blockEffect('notify', 'hitl-slack')) return null
  const s = readSettings()
  if (!mirrorsToSlack(s.inbox.destination) || !s.slack.botToken) return null
  return s.slack
}

/** Slack's error slugs, mapped to what the operator should actually do. */
function friendlySlackError(error: string | undefined): string {
  switch (error) {
    case 'invalid_auth':
    case 'account_inactive':
    case 'token_revoked':
      return `Token rejected (${error}) — paste a valid xoxb- bot token.`
    case 'missing_scope':
      return 'Token is missing a scope — the app needs chat:write (+ channels:manage and channels:join for auto-create, reactions:write for resolves).'
    case 'channel_not_found':
      return 'Channel not found — create the default channel in Slack (and invite the bot), or enable auto-create.'
    case 'not_in_channel':
      return 'The bot is not in that channel — /invite it, or enable auto-create.'
    default:
      return `Slack API error: ${error || 'no response'}`
  }
}

/** The Test button's core: post to the default channel through the same
 *  create-on-miss ladder a real filing uses, and say WHY it failed. */
export async function testSlackDelivery(
  cfg: SlackCfg,
  api: SlackApi = slackApi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const channel = slackChannelName(undefined, cfg)
    const post = async (to: string): Promise<ApiResult> =>
      asResult(
        await api({
          token: cfg.botToken,
          method: 'chat.postMessage',
          body: {
            channel: to,
            text: 'TerMinal connected — inbox posts land here and in per-category channels.',
          },
        }),
      )
    let res = await post(`#${channel}`)
    if (!res.ok && res.error === 'channel_not_found' && cfg.autoCreateChannels) {
      const id = await createChannel(cfg, channel, api)
      if (id) res = await post(id)
    }
    return res.ok ? { ok: true } : { ok: false, error: friendlySlackError(res.error) }
  } catch (e) {
    return { ok: false, error: `Slack unreachable: ${e instanceof Error ? e.message : e}` }
  }
}

/** Settings → Slack "Test": works regardless of inbox.destination, so the
 *  token can be verified BEFORE flipping the destination over. */
export async function testSlack(): Promise<{ ok: boolean; error?: string }> {
  if (blockEffect('notify', 'slack-test'))
    return { ok: false, error: 'Notifications are blocked while running under test.' }
  const s = readSettings()
  if (!s.slack.botToken) return { ok: false, error: 'Set the bot token first.' }
  return testSlackDelivery(s.slack)
}
